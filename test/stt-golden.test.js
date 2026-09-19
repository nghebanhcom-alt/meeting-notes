'use strict';

// TV16 — golden fixtures captured from REAL provider runs (Protocol 5.3/5.4)
// + a Protocol 6.3-style end-to-end lineage test for the merged-recording
// pipeline (M5 -> M7 -> M9 -> M13), built from real captured transcript text
// wherever possible.
//
// Fixture provenance (see each fixture's own `_capturedBy`/`_method`):
// - tests/fixtures/soniox/real-transcribe-vi.json   — REAL run, real API key
//   already present in this dev machine's macOS Keychain.
// - tests/fixtures/deepgram/real-transcribe-vi.json — REAL run, same as above.
// - tests/fixtures/whisper/... and tests/fixtures/google/... DO NOT EXIST:
//   no OpenAI/Google API key was available on this dev machine (checked via
//   `security find-generic-password`, both accounts absent) or via env vars
//   (OPENAI_API_KEY/GOOGLE_API_KEY unset). Per Protocol 5.3, no fixture was
//   hand-written to fill the gap — the tests below SKIP for these two
//   providers instead. QA/Dev must re-run this once a key is available
//   before TV2/TV3/TV16 can be declared closed for Whisper/Google
//   (Architecture.md §V12.4 U-V7).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeResult } = require('../server/stt/contracts');
const { applyPartResult, markPartFailed } = require('../server/meeting-parts');
const {
  buildContextBlock, buildSummaryPrompt, buildChunkPrompt, buildSynthesisPrompt, formatTranscript
} = require('../server/llm/prompts');

function loadFixture(provider, name) {
  const file = path.join(__dirname, '..', 'tests', 'fixtures', provider, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const PROVIDERS_WITH_GOLDEN_FIXTURE = ['soniox', 'deepgram'];
const PROVIDERS_WITHOUT_KEY_ON_THIS_MACHINE = ['whisper', 'google'];

/* ── Per-provider golden fixture: normalizeResult() against a REAL captured
   raw provider response (not hand-written) ── */

for (const provider of PROVIDERS_WITH_GOLDEN_FIXTURE) {
  test(`${provider}: normalizeResult() on the real captured raw response matches the real captured normalized shape`, () => {
    const fixture = loadFixture(provider, 'real-transcribe-vi.json');
    assert.ok(fixture, `expected tests/fixtures/${provider}/real-transcribe-vi.json to exist`);
    const normalized = normalizeResult(fixture.raw, provider);
    assert.deepStrictEqual(normalized, fixture.expectedNormalized);
  });
}

for (const provider of PROVIDERS_WITHOUT_KEY_ON_THIS_MACHINE) {
  test(`${provider}: golden fixture smoke test — SKIPPED (no API key on this dev machine, Protocol 5.4)`, t => {
    const fixture = loadFixture(provider, 'real-transcribe-vi.json');
    if (fixture) {
      // A future Dev/QA session added a real fixture — run the same check.
      const normalized = normalizeResult(fixture.raw, provider);
      assert.deepStrictEqual(normalized, fixture.expectedNormalized);
      return;
    }
    t.skip(`No tests/fixtures/${provider}/real-transcribe-vi.json and no API key available to capture one. ` +
      'Not counted as passing coverage for this provider — see Architecture.md §V12.4 U-V7.');
  });
}

/* ── Protocol 6.3 — end-to-end lineage for a 3-part merged recording ──
   Part 1 and part 3 use the REAL transcript text captured above (from two
   different real providers, on purpose — this is exactly the "mixed
   provider" shape BR-124's retry-with-a-different-provider exception
   produces). Part 2 is a deliberately synthetic FAILED part: failure/gap
   rendering is this codebase's own logic, not a provider contract, so there
   is nothing to capture from a real run for that half of the scenario. */

function makeQueuedPart(partId, order, filename) {
  return {
    partId, order, filename, sizeBytes: 1000, clientDurationSeconds: 5,
    status: 'queued', jobId: '', provider: '', model: '', language: 'auto',
    translationLanguage: '', transcript: [], translations: [], duration: 0,
    durationKind: 'unknown', spanSeconds: 0, offsetSeconds: 0, usage: null,
    addedAt: '2026-09-18T00:00:00.000Z'
  };
}

test('3-part merged meeting: real Soniox + failed part + real Deepgram lineage all the way into the 3 prompt builders', () => {
  const sonioxFixture = loadFixture('soniox', 'real-transcribe-vi.json');
  const deepgramFixture = loadFixture('deepgram', 'real-transcribe-vi.json');
  assert.ok(sonioxFixture && deepgramFixture, 'both golden fixtures are required for this lineage test');

  let meeting = {
    id: 'lineage-1', title: 'Golden lineage', date: '2026-09-18',
    participants: [], notes: '', meetingType: '', topic: '', leadBy: '',
    parts: [
      makeQueuedPart('part-aaaaaaaa', 1, 'phan-1.wav'),
      makeQueuedPart('part-bbbbbbbb', 2, 'phan-2.wav'),
      makeQueuedPart('part-cccccccc', 3, 'phan-3.wav')
    ]
  };

  // M7: mergePartResult(meetingId, partId, result) equivalent — real captured
  // normalized results written onto the correct part only.
  meeting = applyPartResult(meeting, 'part-aaaaaaaa', sonioxFixture.expectedNormalized);
  meeting = markPartFailed(meeting, 'part-bbbbbbbb', { code: 'STT_TRANSCRIBE_FAILED', message: 'The provider did not return any transcript for this audio.' });
  meeting = applyPartResult(meeting, 'part-cccccccc', deepgramFixture.expectedNormalized);

  // M8/M9/M10 (rebuildMergedMeeting, called internally by applyPartResult/markPartFailed):
  // assert VALUES, not just "it ran".
  assert.deepStrictEqual(meeting.missingParts, [2]);
  assert.strictEqual(meeting.status, 'completed');
  assert.strictEqual(meeting.durationEstimated, false, 'both real providers report durationKind=audio-length');
  // duration = Σ spanSeconds of completed parts only (BR-127) — NOT the failed
  // part's clientDurationSeconds, and NOT the 1s gaps between parts.
  assert.strictEqual(meeting.duration, sonioxFixture.expectedNormalized.duration + deepgramFixture.expectedNormalized.duration);

  const part1 = meeting.parts.find(p => p.partId === 'part-aaaaaaaa');
  const part2 = meeting.parts.find(p => p.partId === 'part-bbbbbbbb');
  const part3 = meeting.parts.find(p => p.partId === 'part-cccccccc');
  assert.strictEqual(part1.offsetSeconds, 0);
  // part2 is not completed -> its span is its clientDurationSeconds (5), only
  // to reserve a plausible timeline gap; never counted into `duration` above.
  assert.strictEqual(part2.offsetSeconds, part1.offsetSeconds + part1.spanSeconds + 1);
  assert.strictEqual(part3.offsetSeconds, part2.offsetSeconds + part2.spanSeconds + 1);

  // M9: the merged transcript carries the REAL text at the REAL computed
  // offset, tagged with the correct part/partId/srcIndex — not just "some
  // segment exists somewhere".
  const realPart1Segment = meeting.transcript.find(seg => seg.partId === 'part-aaaaaaaa' && seg.srcIndex === 0);
  assert.ok(realPart1Segment, 'expected the real Soniox segment to survive the merge');
  assert.strictEqual(realPart1Segment.text, sonioxFixture.expectedNormalized.transcript[0].text);
  assert.strictEqual(realPart1Segment.time, part1.offsetSeconds + sonioxFixture.expectedNormalized.transcript[0].time);

  const realPart3Segment = meeting.transcript.find(seg => seg.partId === 'part-cccccccc' && seg.srcIndex === 0);
  assert.ok(realPart3Segment, 'expected the real Deepgram segment to survive the merge');
  assert.strictEqual(realPart3Segment.text, deepgramFixture.expectedNormalized.transcript[0].text);
  assert.strictEqual(realPart3Segment.time, part3.offsetSeconds + deepgramFixture.expectedNormalized.transcript[0].time);

  const gapSegment = meeting.transcript.find(seg => seg.kind === 'part-gap' && seg.part === 2);
  assert.ok(gapSegment, 'expected a part-gap segment for the failed part 2');
  assert.strictEqual(gapSegment.text, 'Phần 2 chưa có transcript');

  // Timeline strictly increasing, no overlap (BR-125/131), across a mix of a
  // real Soniox part, a synthetic failed part, and a real Deepgram part.
  const times = meeting.transcript.map(seg => seg.time);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] >= times[i - 1], `time regressed at index ${i}`);

  meeting.partCount = meeting.parts.length; // M11/M12: what validateMeetingForSummary preserves.

  // M13: buildSummaryPrompt / buildChunkPrompt both carry the real text with
  // the correct per-part label.
  const summaryPrompt = buildSummaryPrompt(meeting, '', null);
  assert.ok(summaryPrompt.includes(`(Phần 1): ${sonioxFixture.expectedNormalized.transcript[0].text}`));
  assert.ok(summaryPrompt.includes(`(Phần 3): ${deepgramFixture.expectedNormalized.transcript[0].text}`));
  assert.ok(summaryPrompt.includes('--- Phần 2 chưa có transcript ---'));

  const chunkPrompt = buildChunkPrompt(meeting, [realPart3Segment], 2, 2, '', null);
  assert.ok(chunkPrompt.includes(`(Phần 3): ${deepgramFixture.expectedNormalized.transcript[0].text}`),
    'a chunk that starts mid-part-3 must still carry the real text with its label');

  const synthesisPrompt = buildSynthesisPrompt(meeting, [{ summary: 'part 1' }, { summary: 'part 3' }], '', null);
  assert.ok(synthesisPrompt.includes('Recording parts: 3'));
  assert.ok(synthesisPrompt.includes('Missing parts: 2 of 3'));

  const ctx = buildContextBlock(meeting);
  assert.deepStrictEqual(ctx.contextUsed.missingParts, [2]);
  assert.strictEqual(ctx.contextUsed.partCount, 3);

  // formatTranscript is the single function both buildSummaryPrompt and
  // buildChunkPrompt delegate to (V5.1) — confirm both dividers for the
  // failed part actually reach it (divider AND gap, not just one).
  const rendered = formatTranscript(meeting.transcript);
  assert.ok(rendered.includes('--- — Phần 2/3 · phan-2.wav — ---'));
  assert.ok(rendered.includes('--- Phần 2 chưa có transcript ---'));
});
