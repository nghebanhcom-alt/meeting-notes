'use strict';

// Tests for T1 (js/meeting-types.js + server/meeting-types.js re-export, BR-25).

const { test } = require('node:test');
const assert = require('node:assert');

const jsMeetingTypes = require('../js/meeting-types');
const serverMeetingTypes = require('../server/meeting-types');
const { MEETING_TYPES, meetingTypeByCode, isKnownMeetingTypeCode } = jsMeetingTypes;

test('MEETING_TYPES has exactly the 10 BR-25 entries with code/label/abbr/presetName', () => {
  assert.strictEqual(MEETING_TYPES.length, 10);
  for (const entry of MEETING_TYPES) {
    assert.strictEqual(typeof entry.code, 'string');
    assert.strictEqual(typeof entry.label, 'string');
    assert.strictEqual(typeof entry.abbr, 'string');
    assert.strictEqual(typeof entry.presetName, 'string');
    assert.strictEqual(entry.presetName, entry.label, 'presetName must equal label per BR-25 table');
  }
  const codes = MEETING_TYPES.map(entry => entry.code);
  assert.strictEqual(new Set(codes).size, codes.length, 'codes must be unique');
});

test('server/meeting-types.js re-exports the exact same table as js/meeting-types.js (WHY-3)', () => {
  assert.strictEqual(serverMeetingTypes.MEETING_TYPES, jsMeetingTypes.MEETING_TYPES);
});

test('meetingTypeByCode finds a known code and returns undefined for an unknown one', () => {
  assert.strictEqual(meetingTypeByCode('sales-call').label, 'Sales call');
  assert.strictEqual(meetingTypeByCode('does-not-exist'), undefined);
});

test('isKnownMeetingTypeCode: "" is valid (not-selected); unknown codes are not (BR-27)', () => {
  assert.strictEqual(isKnownMeetingTypeCode(''), true);
  assert.strictEqual(isKnownMeetingTypeCode('sales-call'), true);
  assert.strictEqual(isKnownMeetingTypeCode('technical-standup'), false, 'the retired v1 table must not leak back in');
});
