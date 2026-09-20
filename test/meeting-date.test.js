'use strict';

// BR-94 — js/meeting-date.js pure function, extracted from BUG-003: the
// import modal (js/import.js) and Meeting Detail's pre-meeting editor
// (js/app.js `save-premeeting`) both need this same plausibility check for
// HAND-TYPED dates, not just the file.lastModified auto-suggestion that
// already had it.

const { test } = require('node:test');
const assert = require('node:assert');
const { isPlausibleMeetingDate, FUTURE_GRACE_MS, MIN_PLAUSIBLE_MS } = require('../js/meeting-date');

test('isPlausibleMeetingDate: now is plausible', () => {
  assert.strictEqual(isPlausibleMeetingDate(new Date().toISOString()), true);
});

test('isPlausibleMeetingDate: 1 month in the future is rejected (BUG-003 repro)', () => {
  const oneMonthAhead = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  assert.strictEqual(isPlausibleMeetingDate(oneMonthAhead), false);
});

test('isPlausibleMeetingDate: a date before 2000-01-01 is rejected (BUG-003 repro)', () => {
  assert.strictEqual(isPlausibleMeetingDate('1999-12-31T23:59:59.000Z'), false);
});

test('isPlausibleMeetingDate: exactly 2000-01-01T00:00:00Z is the inclusive lower bound', () => {
  assert.strictEqual(isPlausibleMeetingDate(new Date(MIN_PLAUSIBLE_MS).toISOString()), true);
});

test('isPlausibleMeetingDate: just under 1 day in the future is still plausible, just over is not', () => {
  const justUnder = new Date(Date.now() + FUTURE_GRACE_MS - 60 * 1000).toISOString();
  const justOver = new Date(Date.now() + FUTURE_GRACE_MS + 60 * 1000).toISOString();
  assert.strictEqual(isPlausibleMeetingDate(justUnder), true);
  assert.strictEqual(isPlausibleMeetingDate(justOver), false);
});

test('isPlausibleMeetingDate: an unparsable string is rejected, never throws', () => {
  assert.strictEqual(isPlausibleMeetingDate('not-a-date'), false);
  assert.strictEqual(isPlausibleMeetingDate(''), false);
  assert.strictEqual(isPlausibleMeetingDate(undefined), false);
});
