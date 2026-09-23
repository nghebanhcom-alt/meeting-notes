'use strict';

// Tests for T-X1 (js/speaker-names.js, Architecture.md §X5.2/§X8).
// Uses the real captured Soniox final-token golden fixtures (§X11.8,
// Protocol 5.3) to derive the raw speaker labels a real session produced,
// instead of hand-picking "1"/"2"/"3" out of thin air.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { resolveSpeakerLabel, assignSpeakerName, listAssignedLabels } = require('../js/speaker-names');

function loadRawLabels(fixtureName) {
  const file = path.join(__dirname, '..', 'tests', 'fixtures', 'soniox', fixtureName);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const labels = [];
  for (const line of lines) {
    const message = JSON.parse(line);
    for (const token of message.tokens) {
      if (token.is_final && token.speaker && !labels.includes(token.speaker)) {
        labels.push(token.speaker);
      }
    }
  }
  return labels; // first-appearance order, per X11.3(d)
}

/* ── Pure logic, no fixture needed ── */

test('resolveSpeakerLabel: unknown/unassigned key passes the raw label through unchanged', () => {
  const result = resolveSpeakerLabel('Speaker 5', { 'Speaker 1': { name: 'Hiếu' } });
  assert.deepStrictEqual(result, { display: 'Speaker 5', raw: 'Speaker 5', isNamed: false });
});

test('resolveSpeakerLabel: assigned key shows "<name> · <rawLabel>" (original label never disappears)', () => {
  const result = resolveSpeakerLabel('Speaker 1', { 'Speaker 1': { name: 'Hiếu' } });
  assert.deepStrictEqual(result, { display: 'Hiếu · Speaker 1', raw: 'Speaker 1', isNamed: true });
});

test('resolveSpeakerLabel: falls back on empty/missing map without throwing', () => {
  assert.deepStrictEqual(resolveSpeakerLabel('Speaker 1', null), { display: 'Speaker 1', raw: 'Speaker 1', isNamed: false });
  assert.deepStrictEqual(resolveSpeakerLabel('Speaker 1', {}), { display: 'Speaker 1', raw: 'Speaker 1', isNamed: false });
});

test('assignSpeakerName: does not mutate the input map', () => {
  const original = { 'Speaker 1': { name: 'Hiếu' } };
  const snapshot = JSON.parse(JSON.stringify(original));
  assignSpeakerName(original, 'Speaker 2', 'Chị Hà', { source: 'live' });
  assert.deepStrictEqual(original, snapshot);
});

test('assignSpeakerName: empty name deletes the key (X4.1.4 "xoá = để trống → quay về nhãn thô")', () => {
  const map = assignSpeakerName({ 'Speaker 1': { name: 'Hiếu' }, 'Speaker 2': { name: 'Hà' } }, 'Speaker 1', '', {});
  assert.deepStrictEqual(map, { 'Speaker 2': { name: 'Hà' } });
});

test('assignSpeakerName: whitespace-only name also deletes the key', () => {
  const map = assignSpeakerName({ 'Speaker 1': { name: 'Hiếu' } }, 'Speaker 1', '   ', {});
  assert.deepStrictEqual(map, {});
});

test('assignSpeakerName: trims the name and keeps meta fields', () => {
  const map = assignSpeakerName({}, 'Speaker 1', '  Hiếu  ', { assignedAtSeconds: 132, source: 'live' });
  assert.deepStrictEqual(map, { 'Speaker 1': { name: 'Hiếu', assignedAtSeconds: 132, source: 'live' } });
});

test('assignSpeakerName + resolveSpeakerLabel: partId scoping keeps "Speaker 1" in part A and part B independent (X1.7 comment, js/app.js:4676-4681)', () => {
  let map = assignSpeakerName({}, 'Speaker 1', 'Hiếu', { source: 'post-hoc' }, 'part-aaaa');
  map = assignSpeakerName(map, 'Speaker 1', 'Chị Hà', { source: 'post-hoc' }, 'part-bbbb');
  assert.deepStrictEqual(resolveSpeakerLabel('Speaker 1', map, 'part-aaaa'), { display: 'Hiếu · Speaker 1', raw: 'Speaker 1', isNamed: true });
  assert.deepStrictEqual(resolveSpeakerLabel('Speaker 1', map, 'part-bbbb'), { display: 'Chị Hà · Speaker 1', raw: 'Speaker 1', isNamed: true });
  // No partId (live recording / single-part meeting) is a third, separate slot.
  assert.deepStrictEqual(resolveSpeakerLabel('Speaker 1', map), { display: 'Speaker 1', raw: 'Speaker 1', isNamed: false });
});

test('listAssignedLabels: round-trips raw label + partId back out of the composite key', () => {
  let map = assignSpeakerName({}, 'Speaker 1', 'Hiếu', {});
  map = assignSpeakerName(map, 'Speaker 2', 'Chị Hà', {}, 'part-aaaa');
  const list = listAssignedLabels(map).sort((a, b) => a.raw.localeCompare(b.raw));
  assert.deepStrictEqual(list, [
    { raw: 'Speaker 1', name: 'Hiếu' },
    { raw: 'Speaker 2', partId: 'part-aaaa', name: 'Chị Hà' }
  ]);
});

/* ── Golden-fixture-backed: real raw labels a real Soniox session produced
   (§X11.8) — not hand-picked, per Protocol 5.3. ── */

test('golden fixture (3 voices, X11.3d): raw labels "1","2","3" appear in first-speak order A,B,C and resolve after assignment', () => {
  const rawLabels = loadRawLabels('live-final-tokens-synth-3voices.jsonl');
  assert.deepStrictEqual(rawLabels, ['1', '2', '3'], 'first-appearance order must match the measured Run 3 result');

  let speakerNames = {};
  speakerNames = assignSpeakerName(speakerNames, `Speaker ${rawLabels[0]}`, 'A (Daniel)', { source: 'live' });
  speakerNames = assignSpeakerName(speakerNames, `Speaker ${rawLabels[1]}`, 'B (Samantha)', { source: 'live' });
  speakerNames = assignSpeakerName(speakerNames, `Speaker ${rawLabels[2]}`, 'C (Aman)', { source: 'live' });

  assert.strictEqual(resolveSpeakerLabel('Speaker 1', speakerNames).display, 'A (Daniel) · Speaker 1');
  assert.strictEqual(resolveSpeakerLabel('Speaker 2', speakerNames).display, 'B (Samantha) · Speaker 2');
  assert.strictEqual(resolveSpeakerLabel('Speaker 3', speakerNames).display, 'C (Aman) · Speaker 3');
});

test('golden fixture (reentry, X11.3c): the raw label speaker A gets after a 193.9s silence is still "1", so a name assigned early still resolves after re-entry', () => {
  const rawLabels = loadRawLabels('live-final-tokens-synth-reentry.jsonl');
  assert.ok(rawLabels.includes('1') && rawLabels.includes('2') && rawLabels.includes('3'));

  const speakerNames = assignSpeakerName({}, 'Speaker 1', 'A (Daniel)', { source: 'live', assignedAtSeconds: 30 });

  // The measured fact (X11.3c): every final token after re-entry (>229.1s
  // into the run) still carries speaker "1" — no renumbering. So the name
  // assigned during A's first turn resolves correctly for A's last turn too.
  const file = path.join(__dirname, '..', 'tests', 'fixtures', 'soniox', 'live-final-tokens-synth-reentry.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const lastMessage = JSON.parse(lines[lines.length - 1]);
  const lastToken = lastMessage.tokens[lastMessage.tokens.length - 1];
  assert.strictEqual(lastToken.speaker, '1', 'sanity check on the fixture itself');
  assert.strictEqual(resolveSpeakerLabel(`Speaker ${lastToken.speaker}`, speakerNames).display, 'A (Daniel) · Speaker 1');
});
