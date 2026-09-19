'use strict';

// TV3 — server/stt/merge.js (BR-125, 126, 127, 129, 131, 136).

const { test } = require('node:test');
const assert = require('node:assert');

const { computeTimeline, buildMergedTranscript } = require('../server/stt/merge');

function completedPart(overrides = {}) {
  return {
    partId: 'part-a', order: 1, filename: 'a.m4a', status: 'completed',
    duration: 100, durationKind: 'audio-length', transcript: [], translations: [],
    ...overrides
  };
}

/* ── computeTimeline: the 5 provider scenarios from PRD §12 ── */

test('Soniox/Deepgram/whisper-1 (duration = real audio length): span = duration', () => {
  const [p] = computeTimeline([completedPart({ duration: 120, transcript: [{ time: 119, speaker: 'S', text: 'end' }] })]);
  assert.strictEqual(p.spanSeconds, 120, 'max(duration, lastSegmentTime) picks duration when it is already the larger value');
  assert.strictEqual(p.offsetSeconds, 0);
});

test('Whisper gpt-4o-* (duration=0, one segment at time:0): span = 0, next offset only +gapSeconds', () => {
  const parts = [
    completedPart({ partId: 'part-a', order: 1, duration: 0, durationKind: 'none', transcript: [{ time: 0, speaker: 'S', text: 'hi' }] }),
    completedPart({ partId: 'part-b', order: 2, duration: 50, durationKind: 'audio-length', transcript: [] })
  ];
  const [a, b] = computeTimeline(parts);
  assert.strictEqual(a.spanSeconds, 0);
  assert.strictEqual(b.offsetSeconds, 1, 'offset only advances by the 1s gap, never overlapping the next part');
});

test('Google (post R-AB fix, duration = end-of-speech which may be less than a later segment time): span = max(duration, lastSegmentTime)', () => {
  const [p] = computeTimeline([completedPart({ duration: 90, durationKind: 'speech-end', transcript: [{ time: 95, speaker: 'S', text: 'late word' }] })]);
  assert.strictEqual(p.spanSeconds, 95, 'lastSegmentTime wins when it exceeds the reported duration');
});

test('a non-completed part reserves clientDurationSeconds on the timeline, never counted as real duration', () => {
  const parts = [
    completedPart({ partId: 'part-a', order: 1, duration: 100 }),
    { partId: 'part-b', order: 2, filename: 'b.m4a', status: 'failed', clientDurationSeconds: 2880, transcript: [] },
    completedPart({ partId: 'part-c', order: 3, duration: 50 })
  ];
  const [a, b, c] = computeTimeline(parts);
  assert.strictEqual(b.spanSeconds, 2880);
  assert.strictEqual(c.offsetSeconds, a.spanSeconds + 1 + b.spanSeconds + 1, 'part 3 offset still accounts for the failed part as if it existed');
});

test('offsets are always strictly increasing across mixed statuses, never overlapping', () => {
  const parts = [
    completedPart({ partId: 'p1', order: 1, duration: 0, durationKind: 'none', transcript: [{ time: 0, speaker: 'S', text: 'x' }] }),
    { partId: 'p2', order: 2, filename: 'b.m4a', status: 'queued', clientDurationSeconds: 0, transcript: [] },
    completedPart({ partId: 'p3', order: 3, duration: 200 })
  ];
  const timed = computeTimeline(parts).sort((a, b) => a.order - b.order);
  for (let i = 1; i < timed.length; i += 1) {
    assert.ok(timed[i].offsetSeconds > timed[i - 1].offsetSeconds, `part ${timed[i].order} must start after part ${timed[i - 1].order}`);
  }
});

test('computeTimeline returns parts in their original array order, not sorted by order', () => {
  const parts = [completedPart({ partId: 'p2', order: 2 }), completedPart({ partId: 'p1', order: 1 })];
  const timed = computeTimeline(parts);
  assert.deepStrictEqual(timed.map(p => p.partId), ['p2', 'p1']);
});

/* ── buildMergedTranscript ── */

test('duration sums only completed spans — no gap seconds, no failed/dropped parts', () => {
  const parts = computeTimeline([
    completedPart({ partId: 'p1', order: 1, duration: 100 }),
    { partId: 'p2', order: 2, filename: 'b.m4a', status: 'failed', clientDurationSeconds: 60, transcript: [] },
    completedPart({ partId: 'p3', order: 3, duration: 50 })
  ]);
  const merged = buildMergedTranscript(parts);
  assert.strictEqual(merged.duration, 150);
});

test('durationEstimated is true when any completed part is not audio-length', () => {
  const allAudioLength = computeTimeline([completedPart({ durationKind: 'audio-length' })]);
  assert.strictEqual(buildMergedTranscript(allAudioLength).durationEstimated, false);

  const oneEstimated = computeTimeline([
    completedPart({ partId: 'p1', order: 1, durationKind: 'audio-length' }),
    completedPart({ partId: 'p2', order: 2, durationKind: 'speech-end' })
  ]);
  assert.strictEqual(buildMergedTranscript(oneEstimated).durationEstimated, true);
});

test('a failed part produces exactly one part-gap segment at its offset, and missingParts records it', () => {
  const parts = computeTimeline([
    completedPart({ partId: 'p1', order: 1, duration: 100 }),
    { partId: 'p2', order: 2, filename: 'b.m4a', status: 'failed', clientDurationSeconds: 60, transcript: [], error: { code: 'STT_RATE_LIMITED', message: 'x' } }
  ]);
  const merged = buildMergedTranscript(parts);
  const gaps = merged.transcript.filter(seg => seg.kind === 'part-gap');
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].part, 2);
  assert.strictEqual(gaps[0].time, parts.find(p => p.partId === 'p2').offsetSeconds);
  assert.deepStrictEqual(merged.missingParts, [2]);
});

test('a dropped part stays as a permanent gap and is counted in missingParts', () => {
  const parts = computeTimeline([
    completedPart({ partId: 'p1', order: 1, duration: 100 }),
    { partId: 'p2', order: 2, filename: 'b.m4a', status: 'dropped', clientDurationSeconds: 60, transcript: [] }
  ]);
  const merged = buildMergedTranscript(parts);
  assert.deepStrictEqual(merged.missingParts, [2]);
  const gap = merged.transcript.find(seg => seg.kind === 'part-gap');
  assert.ok(gap.text.includes('đã bỏ phần 2'));
});

test('a queued/processing part does not count as missing (it is still coming)', () => {
  const parts = computeTimeline([
    completedPart({ partId: 'p1', order: 1, duration: 100 }),
    { partId: 'p2', order: 2, filename: 'b.m4a', status: 'processing', clientDurationSeconds: 60, transcript: [] }
  ]);
  const merged = buildMergedTranscript(parts);
  assert.deepStrictEqual(merged.missingParts, []);
});

test('every part gets exactly one part-divider segment, even a single-part meeting', () => {
  const parts = computeTimeline([completedPart({ filename: 'only.m4a', duration: 30 })]);
  const merged = buildMergedTranscript(parts);
  const dividers = merged.transcript.filter(seg => seg.kind === 'part-divider');
  assert.strictEqual(dividers.length, 1);
  assert.strictEqual(dividers[0].text, '— Phần 1/1 · only.m4a —');
});

test('a merged part\'s segments carry part/partId/srcIndex and offset time, in ascending order overall', () => {
  const parts = computeTimeline([
    completedPart({ partId: 'p1', order: 1, duration: 10, transcript: [{ time: 0, speaker: 'A', text: 'first' }] }),
    completedPart({ partId: 'p2', order: 2, duration: 10, transcript: [{ time: 3, speaker: 'B', text: 'second' }] })
  ]);
  const merged = buildMergedTranscript(parts);
  const content = merged.transcript.filter(seg => !seg.kind);
  assert.strictEqual(content.length, 2);
  assert.strictEqual(content[0].part, 1);
  assert.strictEqual(content[0].srcIndex, 0);
  assert.strictEqual(content[1].part, 2);
  // Lineage assertion (Protocol 6.2): the exact VALUE crossing computeTimeline
  // → buildMergedTranscript, not just "a segment exists".
  const p2 = parts.find(p => p.partId === 'p2');
  assert.strictEqual(content[1].time, p2.offsetSeconds + 3);
  assert.ok(content[1].time > content[0].time);
});

test('a provider that returned an empty transcript is treated exactly like a failed part, not a crash', () => {
  // normalizeResult already turns "no transcript at all" into STT_TRANSCRIBE_FAILED
  // upstream (server/stt/contracts.js) — by the time a part reaches merge.js it is
  // simply status:'failed' with an empty transcript array.
  const parts = computeTimeline([
    completedPart({ partId: 'p1', order: 1, duration: 100 }),
    { partId: 'p2', order: 2, filename: 'silent.m4a', status: 'failed', clientDurationSeconds: 30, transcript: [], error: { code: 'STT_TRANSCRIBE_FAILED', message: 'no transcript' } }
  ]);
  assert.doesNotThrow(() => buildMergedTranscript(parts));
  const merged = buildMergedTranscript(parts);
  assert.deepStrictEqual(merged.missingParts, [2]);
});
