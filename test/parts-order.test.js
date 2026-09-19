'use strict';

// TV11/TV12/TV13/TV18 — js/parts.js pure functions: BR-119 ordering, the
// client meetingCapabilities mirror (Protocol 8.3), gap hints, BR-106
// quality warning, and the BR-121/MRG-18/19 reorder + confirm-before-remove
// helpers added for the reorder-after-transcribe/Q9/mid-cluster-removal UI.

const { test } = require('node:test');
const assert = require('node:assert');
const Parts = require('../js/parts');

/* ── meetingCapabilities mirror — must agree with server/meeting-parts.js ── */

test('meetingCapabilities: a legacy single-part meeting (no parts field) behaves exactly like today', () => {
  const caps = Parts.meetingCapabilities({ id: 'm1' });
  assert.deepStrictEqual(caps, {
    multiPart: false, singleAudioPlayback: true, inlineTranscriptEdit: true,
    durationIsAudioLength: true, qualityWarningEligible: true, summaryNeedsMissingPartConfirm: false
  });
});

test('meetingCapabilities: a merged meeting with a missing part needs summary confirmation and has no single-file playback', () => {
  const caps = Parts.meetingCapabilities({ id: 'm2', parts: [{ partId: 'part-a' }, { partId: 'part-b' }], missingParts: [2] });
  assert.strictEqual(caps.multiPart, true);
  assert.strictEqual(caps.singleAudioPlayback, false);
  assert.strictEqual(caps.summaryNeedsMissingPartConfirm, true);
});

test('meetingCapabilities: durationEstimated suppresses the quality warning eligibility', () => {
  const caps = Parts.meetingCapabilities({ id: 'm3', parts: [{ partId: 'part-a' }], durationEstimated: true });
  assert.strictEqual(caps.durationIsAudioLength, false);
  assert.strictEqual(caps.qualityWarningEligible, false);
});

/* ── BR-119: natural sort by filename ── */

test('naturalCompare: "phan-2" sorts before "phan-10" (numeric value, not string order)', () => {
  assert.ok(Parts.naturalCompare('phan-2.m4a', 'phan-10.m4a') < 0);
  assert.ok(Parts.naturalCompare('phan-10.m4a', 'phan-2.m4a') > 0);
});

test('suggestPartOrder: mixed-up selection order gets fixed to natural filename order', () => {
  const files = [{ name: 'phan-10.m4a', lastModified: 1000 }, { name: 'phan-2.m4a', lastModified: 2000 }, { name: 'phan-1.m4a', lastModified: 3000 }];
  const { order, method } = Parts.suggestPartOrder(files);
  assert.strictEqual(method, 'name');
  assert.deepStrictEqual(order.map(i => files[i].name), ['phan-1.m4a', 'phan-2.m4a', 'phan-10.m4a']);
});

test('suggestPartOrder: no digits anywhere in any filename falls back to lastModified, ascending, and says so', () => {
  const files = [{ name: 'ghi-am-chieu.m4a', lastModified: 5000 }, { name: 'cuoc-hop.m4a', lastModified: 1000 }, { name: 'tiep-theo.m4a', lastModified: 3000 }];
  const { order, method } = Parts.suggestPartOrder(files);
  assert.strictEqual(method, 'lastModified');
  assert.deepStrictEqual(order.map(i => files[i].lastModified), [1000, 3000, 5000]);
});

test('suggestPartOrder: no digits AND lastModified values too close together (or missing) keeps the user\'s original pick order', () => {
  const files = [{ name: 'a.m4a', lastModified: 1000 }, { name: 'b.m4a', lastModified: 1000 }, { name: 'c.m4a', lastModified: 1000 }];
  const { order, method } = Parts.suggestPartOrder(files);
  assert.strictEqual(method, 'original');
  assert.deepStrictEqual(order, [0, 1, 2]);
});

test('suggestPartOrder: identical filenames after natural compare (a tie) is not trusted as a name-based order even with digits present', () => {
  const files = [{ name: 'rec (1).m4a', lastModified: 2000 }, { name: 'rec (1).m4a', lastModified: 1000 }];
  const { method } = Parts.suggestPartOrder(files);
  assert.notStrictEqual(method, 'name');
});

test('suggestPartOrder: a single file or empty list is always "original" (nothing to sort)', () => {
  assert.strictEqual(Parts.suggestPartOrder([]).method, 'original');
  assert.strictEqual(Parts.suggestPartOrder([{ name: 'a.m4a', lastModified: 1 }]).method, 'original');
});

/* ── gap hint (soft warning only) ── */

test('classifyGap: negative gap (files out of chronological order for the chosen sequence) -> ERR-10 level', () => {
  assert.strictEqual(Parts.classifyGap(-30), 'negative');
});

test('classifyGap: gap over 2 hours -> ERR-11 level; otherwise "normal"', () => {
  assert.strictEqual(Parts.classifyGap(Parts.GAP_LARGE_SECONDS + 1), 'large');
  assert.strictEqual(Parts.classifyGap(60), 'normal');
  assert.strictEqual(Parts.classifyGap(null), 'unknown');
});

test('gapWarningSeconds returns null when either file has no lastModified signal (never a confident-looking wrong number)', () => {
  assert.strictEqual(Parts.gapWarningSeconds({ lastModified: 0 }, { lastModified: 1000 }), null);
});

/* ── BR-106 quality warning ── */

test('qualityWarning: below the 5-minute floor is never eligible (denominator too small to trust)', () => {
  const result = Parts.qualityWarning({ duration: 60, transcript: [] });
  assert.strictEqual(result.eligible, false);
  assert.strictEqual(result.warn, false);
});

test('qualityWarning: sparse transcript over a long duration warns; a normal-density transcript does not', () => {
  const sparse = { duration: 600, transcript: [{ text: 'chi mot vai tu thoi' }] }; // ~5 words / 10 min
  const dense = { duration: 600, transcript: Array.from({ length: 100 }, () => ({ text: 'mot hai ba bon nam sau bay' })) }; // 700 words / 10 min
  assert.strictEqual(Parts.qualityWarning(sparse).warn, true);
  assert.strictEqual(Parts.qualityWarning(dense).warn, false);
});

test('formatDDMM renders a Vietnamese dd/mm date for inline microcopy (ERR-07/DAT-01/DAT-03)', () => {
  assert.strictEqual(Parts.formatDDMM(new Date(2026, 8, 5, 10, 0)), '05/09');
});

test('qualityWarning ignores part-divider/part-gap segment text when counting words', () => {
  const meeting = {
    duration: 600,
    transcript: [
      { kind: 'part-divider', text: 'Phần 1/2 · nhieu tu giai thich o day nhung khong phai loi noi that' },
      { text: 'mot hai ba' }
    ]
  };
  assert.strictEqual(Parts.qualityWarning(meeting).wordsPerMinute, 0.3);
});

/* ── TV18 — BR-121 reorder-after-transcribe (Meeting Detail ▲/▼) ── */

test('computeReorderedPartIds: moving the 2nd of 3 parts up swaps it with the 1st, keeping the 3rd untouched', () => {
  const parts = [{ partId: 'a', order: 1 }, { partId: 'b', order: 2 }, { partId: 'c', order: 3 }];
  assert.deepStrictEqual(Parts.computeReorderedPartIds(parts, 'b', -1), ['b', 'a', 'c']);
});

test('computeReorderedPartIds: moving the last part down is a no-op (null, caller must skip the fetch)', () => {
  const parts = [{ partId: 'a', order: 1 }, { partId: 'b', order: 2 }];
  assert.strictEqual(Parts.computeReorderedPartIds(parts, 'b', 1), null);
});

test('computeReorderedPartIds: sorts by `.order` first, not array position — an out-of-order `parts` array still moves the right neighbor', () => {
  const parts = [{ partId: 'b', order: 2 }, { partId: 'a', order: 1 }, { partId: 'c', order: 3 }];
  assert.deepStrictEqual(Parts.computeReorderedPartIds(parts, 'c', -1), ['a', 'c', 'b']);
});

test('computeReorderedPartIds: unknown partId is a no-op (null)', () => {
  const parts = [{ partId: 'a', order: 1 }, { partId: 'b', order: 2 }];
  assert.strictEqual(Parts.computeReorderedPartIds(parts, 'missing', -1), null);
});

/* ── TV18 — MRG-18/19 confirm-before-remove in the import modal ── */

test('removingCreatesGap: true for every position except the last one', () => {
  assert.strictEqual(Parts.removingCreatesGap(0, 3), true);
  assert.strictEqual(Parts.removingCreatesGap(1, 3), true);
  assert.strictEqual(Parts.removingCreatesGap(2, 3), false); // last of 3 -> no confirm
});

test('removingCreatesGap: a single-entry list is never a "middle" removal', () => {
  assert.strictEqual(Parts.removingCreatesGap(0, 1), false);
});

test('formatGapRangeClock: renders HH:mm -> HH:mm from two lastModified timestamps', () => {
  const prev = new Date(2026, 8, 16, 15, 19).getTime();
  const next = new Date(2026, 8, 16, 16, 7).getTime();
  assert.strictEqual(Parts.formatGapRangeClock(prev, next), '15:19 → 16:07');
});

test('formatGapRangeClock: degrades to "" when either timestamp is missing (never guesses)', () => {
  assert.strictEqual(Parts.formatGapRangeClock(0, Date.now()), '');
  assert.strictEqual(Parts.formatGapRangeClock(Date.now(), 0), '');
});
