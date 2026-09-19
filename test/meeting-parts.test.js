'use strict';

// TV4 — server/meeting-parts.js (BR-121, 132, 133, 137; R-R ownership merge).

const { test } = require('node:test');
const assert = require('node:assert');

const {
  meetingCapabilities, rebuildMergedMeeting, registerParts, applyPartResult,
  markPartFailed, dropPart, reorderParts, preserveServerOwnedFields, isValidPartId
} = require('../server/meeting-parts');

function completedPart(overrides = {}) {
  return {
    partId: 'part-aaaaaaaa', order: 1, filename: 'a.m4a', status: 'completed',
    duration: 100, durationKind: 'audio-length',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: 'hello' }], translations: [],
    usage: {
      provider: 'soniox', model: 'stt-async-v5', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z',
      billableDurationSeconds: 100, pricingUsdPerHour: 0.10, estimatedCostUsd: 0.0028, translationEnabled: false, source: 'file-upload'
    },
    ...overrides
  };
}

function mergedMeeting(parts) {
  return rebuildMergedMeeting({ id: 'm1', title: 'Test', status: 'processing', parts });
}

/* ── isValidPartId / meetingCapabilities ── */

test('isValidPartId enforces the "part-" + 8-64 chars pattern (BR-111)', () => {
  assert.strictEqual(isValidPartId('part-aaaaaaaa'), true);
  assert.strictEqual(isValidPartId('part-a'), false, 'too short');
  assert.strictEqual(isValidPartId('../../etc/passwd'), false);
  assert.strictEqual(isValidPartId('part-Aaaaaaaa'), false, 'uppercase not allowed');
});

test('meetingCapabilities: a meeting with no parts behaves exactly like today (R-Z deny-by-default)', () => {
  const caps = meetingCapabilities({ id: 'm1', status: 'completed' });
  assert.deepStrictEqual(caps, {
    multiPart: false, singleAudioPlayback: true, inlineTranscriptEdit: true,
    durationIsAudioLength: true, qualityWarningEligible: true, summaryNeedsMissingPartConfirm: false
  });
});

test('meetingCapabilities: durationEstimated=true disables the quality-warning capability (BR-128)', () => {
  const caps = meetingCapabilities({ durationEstimated: true });
  assert.strictEqual(caps.qualityWarningEligible, false);
  assert.strictEqual(caps.durationIsAudioLength, false);
});

test('meetingCapabilities: summaryNeedsMissingPartConfirm only true for a multi-part meeting with missing parts (BR-135)', () => {
  assert.strictEqual(meetingCapabilities({ parts: [completedPart()], missingParts: [] }).summaryNeedsMissingPartConfirm, false);
  assert.strictEqual(meetingCapabilities({ parts: [completedPart()], missingParts: [2] }).summaryNeedsMissingPartConfirm, true);
});

/* ── rebuildMergedMeeting / registerParts / applyPartResult / dropPart / reorderParts ── */

test('rebuildMergedMeeting is a no-op for a meeting without parts (single-part path unchanged)', () => {
  const meeting = { id: 'm1', transcript: [{ time: 0, speaker: 'A', text: 'hi' }], duration: 5 };
  assert.deepStrictEqual(rebuildMergedMeeting(meeting), meeting);
});

test('registerParts rejects a request that would exceed MAX_PARTS_PER_MEETING (BR-122)', () => {
  const meeting = { id: 'm1', parts: Array.from({ length: 9 }, (_, i) => completedPart({ partId: `part-existing${i}`, order: i + 1 })) };
  assert.throws(() => registerParts(meeting, [
    { partId: 'part-new0000', filename: 'x.m4a', sizeBytes: 10 },
    { partId: 'part-new1111', filename: 'y.m4a', sizeBytes: 10 }
  ], { provider: 'soniox' }), (error) => error.statusCode === 400 && error.code === 'PARTS_LIMIT_EXCEEDED');
});

test('registerParts assigns order continuing after the existing parts and starts them queued', () => {
  const meeting = { id: 'm1', parts: [completedPart({ partId: 'part-existing0', order: 1 })] };
  const { meeting: updated, createdParts } = registerParts(meeting, [
    { partId: 'part-new00000', filename: 'b.m4a', sizeBytes: 10, clientDurationSeconds: 30 }
  ], { provider: 'soniox', model: '', language: 'auto', translationLanguage: '' });
  assert.strictEqual(createdParts[0].order, 2);
  assert.strictEqual(createdParts[0].status, 'queued');
  assert.strictEqual(updated.parts.length, 2);
  assert.strictEqual(updated.status, 'processing', 'a queued part keeps the overall meeting processing (BR-132)');
});

test('applyPartResult writes the STT result onto the right part only, and rebuilds duration/status', () => {
  const meeting = mergedMeeting([
    completedPart({ partId: 'part-aaaaaaaa', order: 1 }),
    { partId: 'part-bbbbbbbb', order: 2, filename: 'b.m4a', status: 'queued', clientDurationSeconds: 30, transcript: [] }
  ]);
  const updated = applyPartResult(meeting, 'part-bbbbbbbb', {
    transcript: [{ time: 0, speaker: 'Speaker 1', text: 'part 2 content' }], translations: [], duration: 50,
    durationKind: 'audio-length', provider: 'soniox', model: 'stt-async-v5',
    usage: { provider: 'soniox', model: 'stt-async-v5', billableDurationSeconds: 50, pricingUsdPerHour: 0.10, estimatedCostUsd: 0.0014, startedAt: 'a', endedAt: 'b', translationEnabled: false, source: 'file-upload' }
  });
  const part1 = updated.parts.find(p => p.partId === 'part-aaaaaaaa');
  const part2 = updated.parts.find(p => p.partId === 'part-bbbbbbbb');
  assert.strictEqual(part1.transcript[0].text, 'hello', 'part 1 must be untouched');
  assert.strictEqual(part2.status, 'completed');
  assert.strictEqual(part2.transcript[0].text, 'part 2 content');
  assert.strictEqual(updated.status, 'completed');
  assert.strictEqual(updated.duration, 150);
  assert.strictEqual(updated.sonioxUsage.partsCounted, 2);
});

test('dropPart never touches audio, just flips status and leaves a permanent gap (BR-103/BR-134)', () => {
  const meeting = mergedMeeting([
    completedPart({ partId: 'part-aaaaaaaa', order: 1 }),
    completedPart({ partId: 'part-cccccccc', order: 2, filename: 'c.m4a' })
  ]);
  const updated = dropPart(meeting, 'part-cccccccc');
  const dropped = updated.parts.find(p => p.partId === 'part-cccccccc');
  assert.strictEqual(dropped.status, 'dropped');
  assert.deepStrictEqual(updated.missingParts, [2]);
  assert.ok(updated.transcript.some(seg => seg.kind === 'part-gap' && seg.part === 2));
});

test('dropPart on an unknown partId throws 404 PART_NOT_FOUND, changing nothing', () => {
  const meeting = mergedMeeting([completedPart()]);
  assert.throws(() => dropPart(meeting, 'part-doesnotexist'), (error) => error.statusCode === 404 && error.code === 'PART_NOT_FOUND');
});

test('reorderParts requires a full permutation of the current partIds (BR-119/BR-121)', () => {
  const meeting = mergedMeeting([
    completedPart({ partId: 'part-aaaaaaaa', order: 1 }),
    completedPart({ partId: 'part-bbbbbbbb', order: 2, filename: 'b.m4a' })
  ]);
  assert.throws(() => reorderParts(meeting, ['part-aaaaaaaa']), (error) => error.statusCode === 400 && error.code === 'PARTS_ORDER_INVALID');
  assert.throws(() => reorderParts(meeting, ['part-aaaaaaaa', 'part-unknown0']), (error) => error.code === 'PARTS_ORDER_INVALID');

  const reordered = reorderParts(meeting, ['part-bbbbbbbb', 'part-aaaaaaaa']);
  assert.strictEqual(reordered.parts.find(p => p.partId === 'part-bbbbbbbb').order, 1);
  assert.strictEqual(reordered.parts.find(p => p.partId === 'part-aaaaaaaa').order, 2);
});

/* ── preserveServerOwnedFields (R-R, §V3.6) ── */

test('a stale COMPLETED client snapshot cannot wipe parts/duration/status on a multi-part meeting', () => {
  const current = mergedMeeting([completedPart(), completedPart({ partId: 'part-cccccccc', order: 2, filename: 'c.m4a' })]);
  const staleIncoming = { ...current, status: 'completed', parts: [], transcript: [], duration: 0, sonioxUsage: null, title: 'Renamed by user' };

  const merged = preserveServerOwnedFields(current, staleIncoming);
  assert.strictEqual(merged.parts.length, 2, 'parts must survive');
  assert.strictEqual(merged.duration, current.duration);
  assert.deepStrictEqual(merged.transcript, current.transcript);
  assert.strictEqual(merged.title, 'Renamed by user', 'client-owned fields still pass through');
});

test('a single-part meeting is untouched by preserveServerOwnedFields (test hồi quy — R-R only applies when parts exist)', () => {
  const current = { id: 'm1', status: 'completed', transcript: [{ time: 0, speaker: 'A', text: 'x' }], duration: 5 };
  const incoming = { id: 'm1', status: 'processing', transcript: [], duration: 0 };
  assert.deepStrictEqual(preserveServerOwnedFields(current, incoming), incoming);
});

test('editing one segment\'s text in the incoming transcript writes it back to the correct part (§V3.6 inline edit)', () => {
  const current = mergedMeeting([completedPart(), completedPart({ partId: 'part-cccccccc', order: 2, filename: 'c.m4a', transcript: [{ time: 0, speaker: 'Speaker 1', text: 'original text' }] })]);
  const incomingTranscript = current.transcript.map(seg =>
    (seg.part === 2 && !seg.kind) ? { ...seg, text: 'corrected text' } : seg);

  const merged = preserveServerOwnedFields(current, { ...current, transcript: incomingTranscript });
  const part2 = merged.parts.find(p => p.partId === 'part-cccccccc');
  assert.strictEqual(part2.transcript[0].text, 'corrected text');
  // The other part's own transcript is untouched.
  const part1 = merged.parts.find(p => p.partId === 'part-aaaaaaaa');
  assert.strictEqual(part1.transcript[0].text, 'hello');
});

test('a structurally mismatched incoming transcript (stale snapshot) is entirely ignored, not partially applied', () => {
  const current = mergedMeeting([completedPart(), completedPart({ partId: 'part-cccccccc', order: 2, filename: 'c.m4a' })]);
  const incomingTranscript = [{ time: 0, speaker: 'Someone', text: 'a snapshot from before the merge existed' }];

  const merged = preserveServerOwnedFields(current, { ...current, transcript: incomingTranscript });
  assert.deepStrictEqual(merged.transcript, current.transcript, 'must fall back to the derived transcript untouched');
});
