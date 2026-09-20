'use strict';

// BR-146 — js/summary-staleness.js. BUG-004 regression: the "pre-meeting
// info may be newer than the summary" nudge must compare
// `promptContextUpdatedAt` (only bumps for the 8 prompt-context fields),
// never `updatedAt` (bumps on every save, e.g. tagging).

const { test } = require('node:test');
const assert = require('node:assert');
const { isPreMeetingInfoStale } = require('../js/summary-staleness');

test('isPreMeetingInfoStale: promptContextUpdatedAt after generatedAt -> stale', () => {
  const meeting = {
    summaryGeneration: { generatedAt: '2026-09-19T10:00:00.000Z' },
    promptContextUpdatedAt: '2026-09-19T11:00:00.000Z',
    updatedAt: '2026-09-19T09:00:00.000Z' // deliberately OLDER than generatedAt — must be ignored
  };
  assert.strictEqual(isPreMeetingInfoStale(meeting), true);
});

test('isPreMeetingInfoStale: BUG-004 repro — tagging (bumps updatedAt only) must NOT trigger the nudge', () => {
  const meeting = {
    summaryGeneration: { generatedAt: '2026-09-19T10:00:00.000Z' },
    promptContextUpdatedAt: '2026-09-19T09:00:00.000Z', // unchanged since before Generate
    updatedAt: '2026-09-19T12:00:00.000Z' // bumped by an unrelated tag/action-item save
  };
  assert.strictEqual(isPreMeetingInfoStale(meeting), false);
});

test('isPreMeetingInfoStale: no summaryGeneration yet -> never stale (nothing to compare against)', () => {
  assert.strictEqual(isPreMeetingInfoStale({ promptContextUpdatedAt: '2026-09-19T11:00:00.000Z' }), false);
});

test('isPreMeetingInfoStale: R-AF deny-by-default — a pre-BR-146 meeting with no promptContextUpdatedAt never nudges', () => {
  const meeting = { summaryGeneration: { generatedAt: '2026-09-19T10:00:00.000Z' } };
  assert.strictEqual(isPreMeetingInfoStale(meeting), false);
});

test('isPreMeetingInfoStale: exactly equal timestamps -> not stale (must be strictly after)', () => {
  const meeting = {
    summaryGeneration: { generatedAt: '2026-09-19T10:00:00.000Z' },
    promptContextUpdatedAt: '2026-09-19T10:00:00.000Z'
  };
  assert.strictEqual(isPreMeetingInfoStale(meeting), false);
});
