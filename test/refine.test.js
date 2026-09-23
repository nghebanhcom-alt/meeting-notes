'use strict';

// T-W1/T-W1(mở rộng) — server/refine.js pure writers (Architecture §W3.2,
// §W4.2, §W11.3, §W12, §W12.1). Unit tests, no server spawn (mirrors
// test/meeting-parts.test.js).

const { test } = require('node:test');
const assert = require('node:assert');

const {
  markRefineRunning, markRefineFailed, applyRefineResult,
  markPartRefineQueued, applyPartRefineResult, markPartRefineFailed,
  JOB_MODES, modeFor, MAX_REFINE_PART_SECONDS
} = require('../server/refine');
const { rebuildMergedMeeting, normalizePart } = require('../server/meeting-parts');

function usage(overrides = {}) {
  return {
    provider: 'soniox', model: 'stt-async-v5', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:05:00.000Z',
    billableDurationSeconds: 300, pricingUsdPerHour: 0.10, estimatedCostUsd: 0.0083, translationEnabled: false, source: 'file-upload',
    ...overrides
  };
}

/* ── single-meeting: markRefineRunning ── */

test('markRefineRunning snapshots the live transcript/translations exactly once', () => {
  const meeting = {
    id: 'm1', status: 'completed',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: 'live content' }],
    translations: [{ time: 0, speaker: 'Translation', text: 'ban dich' }]
  };
  const running = markRefineRunning(meeting, 'job-1');
  assert.deepStrictEqual(running.liveTranscript, meeting.transcript);
  assert.deepStrictEqual(running.liveTranslations, meeting.translations);
  assert.strictEqual(running.refine.status, 'running');
  assert.strictEqual(running.refine.jobId, 'job-1');
  assert.strictEqual(running.status, 'completed', 'WHY-W3: meeting.status is never touched by refine');

  // A second refine run (say, after the first refine finished and changed
  // `transcript` to a batch-refined version) must NOT overwrite the
  // ORIGINAL live snapshot with the already-refined one (WHY-W4).
  const afterFirstRefine = { ...running, transcript: [{ time: 0, speaker: 'Speaker 1', text: 'batch-refined content' }] };
  const runningAgain = markRefineRunning(afterFirstRefine, 'job-2');
  assert.deepStrictEqual(runningAgain.liveTranscript, meeting.transcript, 'must still be the ORIGINAL live transcript');
});

/* ── single-meeting: applyRefineResult / markRefineFailed ── */

test('applyRefineResult replaces transcript, keeps liveTranscript, keeps status completed, accumulates usage', () => {
  const meeting = markRefineRunning({
    id: 'm1', status: 'completed',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: 'live content' }],
    translations: [],
    sonioxUsage: usage({ source: 'live-realtime', estimatedCostUsd: 0.01 })
  }, 'job-1');

  const result = { transcript: [{ time: 0, speaker: 'Speaker 1', text: 'refined content' }], translations: [], duration: 320 };
  const refineUsage = usage({ estimatedCostUsd: 0.02 });
  const done = applyRefineResult(meeting, result, refineUsage);

  assert.deepStrictEqual(done.transcript, result.transcript, 'transcript is replaced by the batch result');
  assert.deepStrictEqual(done.liveTranscript, meeting.liveTranscript, 'liveTranscript is untouched (WHY-W4)');
  assert.strictEqual(done.status, 'completed');
  assert.strictEqual(done.refine.status, 'done');
  assert.strictEqual(done.transcriptSource, 'batch-refined');
  assert.strictEqual(done.usageBreakdown.length, 2, 'live-realtime entry + batch-refine entry');
  assert.strictEqual(done.usageBreakdown[1].source, 'batch-refine');
  assert.ok(Math.abs(done.sonioxUsage.estimatedCostUsd - 0.03) < 1e-9, 'sonioxUsage is the SUM of both runs, not the latest');
});

test('E-W3: an empty translations result does not blank out the meeting\'s existing translations', () => {
  const meeting = markRefineRunning({
    id: 'm1', status: 'completed',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: 'x' }],
    translations: [{ time: 0, speaker: 'Translation', text: 'ban dich cu' }]
  }, 'job-1');

  const done = applyRefineResult(meeting, { transcript: [{ time: 0, speaker: 'Speaker 1', text: 'refined' }], translations: [], duration: 10 }, usage());
  assert.deepStrictEqual(done.translations, meeting.translations, 'translations kept, not overwritten with []');
});

test('applyRefineResult failure path (markRefineFailed): transcript unchanged, refine.status=failed', () => {
  const meeting = markRefineRunning({
    id: 'm1', status: 'completed',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: 'live content, must survive' }],
    translations: []
  }, 'job-1');

  const failed = markRefineFailed(meeting, { code: 'STT_TRANSCRIBE_FAILED', message: 'boom' });
  assert.deepStrictEqual(failed.transcript, meeting.transcript, 'transcript must NOT change on failure (R-W1)');
  assert.strictEqual(failed.status, 'completed', 'meeting.status stays completed, never "failed" (WHY-W3)');
  assert.strictEqual(failed.refine.status, 'failed');
  assert.strictEqual(failed.refine.error.message, 'boom');
});

/* ── multi-part: markPartRefineQueued / applyPartRefineResult / markPartRefineFailed ── */

function completedPart(overrides = {}) {
  return {
    partId: 'part-aaaaaaaa', order: 1, filename: 'a.m4a', status: 'completed',
    duration: 100, durationKind: 'audio-length',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: 'original content' }], translations: [],
    usage: usage({ estimatedCostUsd: 0.003 }),
    ...overrides
  };
}

function mergedMeeting(parts) {
  return rebuildMergedMeeting({ id: 'm1', title: 'Test', status: 'processing', parts });
}

test('markPartRefineQueued snapshots previousTranscript, sets refine.status=running, leaves part.status=completed', () => {
  const meeting = mergedMeeting([
    completedPart({ partId: 'part-aaaaaaaa', order: 1 }),
    completedPart({ partId: 'part-bbbbbbbb', order: 2, filename: 'b.m4a' })
  ]);
  const queued = markPartRefineQueued(meeting, 'part-bbbbbbbb', 'job-refine-1');
  const part = queued.parts.find(p => p.partId === 'part-bbbbbbbb');
  const untouched = queued.parts.find(p => p.partId === 'part-aaaaaaaa');

  assert.strictEqual(part.status, 'completed', 'WHY-W8: part.status must NOT flip to processing');
  assert.strictEqual(part.refine.status, 'running');
  assert.strictEqual(part.refine.jobId, 'job-refine-1');
  assert.deepStrictEqual(part.previousTranscript, normalizePart(completedPart()).transcript);
  assert.deepStrictEqual(untouched, meeting.parts.find(p => p.partId === 'part-aaaaaaaa'), 'part 1 is byte-for-byte untouched');
  assert.deepStrictEqual(queued.refiningParts, [2], 'refiningParts (derived) lists the refining part\'s order');
});

test('applyPartRefineResult only touches the target part, rebuilds duration/usage, keeps status completed', () => {
  const meeting = mergedMeeting([
    completedPart({ partId: 'part-aaaaaaaa', order: 1 }),
    completedPart({ partId: 'part-bbbbbbbb', order: 2, filename: 'b.m4a' })
  ]);
  const queued = markPartRefineQueued(meeting, 'part-bbbbbbbb', 'job-refine-1');
  const part1Before = JSON.stringify(queued.parts.find(p => p.partId === 'part-aaaaaaaa'));

  const result = { transcript: [{ time: 0, speaker: 'Speaker 1', text: 'refined content' }], translations: [], duration: 120 };
  const refineUsage = usage({ estimatedCostUsd: 0.004 });
  const done = applyPartRefineResult(queued, 'part-bbbbbbbb', result, refineUsage);

  const part1After = JSON.stringify(done.parts.find(p => p.partId === 'part-aaaaaaaa'));
  const part2 = done.parts.find(p => p.partId === 'part-bbbbbbbb');

  assert.strictEqual(part1After, part1Before, "part 1's own record must be untouched by part 2's refine");
  assert.strictEqual(part2.status, 'completed');
  assert.strictEqual(part2.transcriptSource, 'refined');
  assert.strictEqual(part2.refine.status, 'done');
  assert.deepStrictEqual(part2.transcript, normalizePart({ transcript: result.transcript }).transcript);
  assert.strictEqual(part2.usageBreakdown.length, 2, 'original run + refine run');
  assert.ok(Math.abs(done.sonioxUsage.estimatedCostUsd - (0.003 + 0.003 + 0.004)) < 1e-9, 'aggregateUsage sums BOTH parts across ALL their runs, not just the latest');
  assert.deepStrictEqual(done.refiningParts, [], 'no longer refining once done');
});

test('markPartRefineFailed keeps the part\'s transcript and status intact (the lỗ hổng retryPart has, refine must not)', () => {
  const meeting = mergedMeeting([completedPart({ partId: 'part-aaaaaaaa', order: 1 })]);
  const queued = markPartRefineQueued(meeting, 'part-aaaaaaaa', 'job-refine-1');
  const failed = markPartRefineFailed(queued, 'part-aaaaaaaa', { code: 'STT_TRANSCRIBE_FAILED', message: 'boom' });
  const part = failed.parts.find(p => p.partId === 'part-aaaaaaaa');

  assert.strictEqual(part.status, 'completed', 'part.status must NOT become "failed" (W11.3)');
  assert.deepStrictEqual(part.transcript, normalizePart(completedPart()).transcript, 'transcript must survive a failed refine, unlike retryPart');
  assert.strictEqual(part.refine.status, 'failed');
  assert.strictEqual(part.refine.error.message, 'boom');
  assert.ok(!failed.missingParts.includes(1), 'a refine failure must NOT be reported as a missing part');
});

/* ── JOB_MODES / modeFor (Protocol 8.3) ── */

test('modeFor: a job with no mode field resolves to JOB_MODES.attach (pre-existing behavior, unaffected)', () => {
  assert.strictEqual(modeFor({ meetingId: 'm1', partId: '' }), JOB_MODES.attach);
  assert.strictEqual(modeFor({ meetingId: 'm1', partId: 'part-a', mode: undefined }), JOB_MODES.attach);
});

test('modeFor: mode "refine" resolves to JOB_MODES.refine, which does not own meeting/part status', () => {
  const mode = modeFor({ mode: 'refine' });
  assert.strictEqual(mode, JOB_MODES.refine);
  assert.strictEqual(mode.ownsMeetingStatus, false);
  assert.strictEqual(mode.ownsPartStatus, false);
  assert.strictEqual(JOB_MODES.attach.ownsMeetingStatus, true);
  assert.strictEqual(JOB_MODES.attach.ownsPartStatus, true);
});

test('MAX_REFINE_PART_SECONDS matches the fixed 300-minute Soniox async limit (§W9-S3)', () => {
  assert.strictEqual(MAX_REFINE_PART_SECONDS, 300 * 60);
});

/* ── T-X5 (Architecture §X5.4(a)/§X6): applyRefineResult/applyPartRefineResult
   must move `speakerNames` to `speakerNamesStale` instead of leaving it as-is
   (X5.4(b), rejected) or silently dropping it. Protocol 6 test: assert the
   VALUE that moved, not just "the field changed". ── */

test('applyRefineResult: a meeting WITH speakerNames gets them moved to speakerNamesStale, speakerNames is gone', () => {
  const meeting = markRefineRunning({
    id: 'm1', status: 'completed',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: 'live content' }],
    translations: [],
    speakerNames: { 'Speaker 1': { name: 'Hiếu', source: 'live' } }
  }, 'job-1');

  const result = { transcript: [{ time: 0, speaker: 'Speaker 1', text: 'refined content' }], translations: [], duration: 320 };
  const done = applyRefineResult(meeting, result, usage());

  assert.strictEqual(done.speakerNames, null, 'the old map must not still be readable as "current" names');
  assert.deepStrictEqual(done.speakerNamesStale, { 'Speaker 1': { name: 'Hiếu', source: 'live' } }, 'exact old map value must be preserved for the "gán lại" banner');
});

test('applyRefineResult: a meeting that NEVER had speakerNames stays without speakerNamesStale (deny-by-default, no banner out of nowhere)', () => {
  const meeting = markRefineRunning({
    id: 'm1', status: 'completed',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: 'live content' }],
    translations: []
  }, 'job-1');

  const result = { transcript: [{ time: 0, speaker: 'Speaker 1', text: 'refined content' }], translations: [], duration: 320 };
  const done = applyRefineResult(meeting, result, usage());

  assert.strictEqual(done.speakerNames, undefined);
  assert.strictEqual(done.speakerNamesStale, undefined);
});

test('applyPartRefineResult: only the refined part\'s speakerNames entries go stale, other parts\' names are untouched', () => {
  const meeting = mergedMeeting([
    completedPart({ partId: 'part-aaaaaaaa', order: 1 }),
    completedPart({ partId: 'part-bbbbbbbb', order: 2, filename: 'b.m4a' })
  ]);
  meeting.speakerNames = {
    'part-aaaaaaaa::Speaker 1': { name: 'Hiếu', source: 'post-hoc' },
    'part-bbbbbbbb::Speaker 1': { name: 'Chị Hà', source: 'post-hoc' }
  };
  const queued = markPartRefineQueued(meeting, 'part-bbbbbbbb', 'job-refine-1');
  const result = { transcript: [{ time: 0, speaker: 'Speaker 1', text: 'refined content' }], translations: [], duration: 120 };
  const done = applyPartRefineResult(queued, 'part-bbbbbbbb', result, usage());

  assert.deepStrictEqual(done.speakerNames, { 'part-aaaaaaaa::Speaker 1': { name: 'Hiếu', source: 'post-hoc' } }, 'part A\'s name survives untouched');
  assert.deepStrictEqual(done.speakerNamesStale, { 'part-bbbbbbbb::Speaker 1': { name: 'Chị Hà', source: 'post-hoc' } }, 'only part B\'s name became stale');
});

test('applyPartRefineResult: refining the ONLY part with names clears speakerNames down to null (not an empty {})', () => {
  const meeting = mergedMeeting([completedPart({ partId: 'part-aaaaaaaa', order: 1 })]);
  meeting.speakerNames = { 'part-aaaaaaaa::Speaker 1': { name: 'Hiếu' } };
  const queued = markPartRefineQueued(meeting, 'part-aaaaaaaa', 'job-refine-1');
  const result = { transcript: [{ time: 0, speaker: 'Speaker 1', text: 'refined content' }], translations: [], duration: 120 };
  const done = applyPartRefineResult(queued, 'part-aaaaaaaa', result, usage());

  assert.strictEqual(done.speakerNames, null);
  assert.deepStrictEqual(done.speakerNamesStale, { 'part-aaaaaaaa::Speaker 1': { name: 'Hiếu' } });
});
