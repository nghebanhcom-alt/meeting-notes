'use strict';

// Tests for server/stt/soniox-context.js (T-W6, Architecture §W5.4/§W6).
// Pure function — no network calls. Soniox smoke test is T-W7, out of scope here.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  buildSonioxContext,
  MAX_GENERAL_PAIRS,
  MAX_CONTEXT_CHARS,
  MAX_SPEAKERS_FOR_DIARIZATION
} = require('../server/stt/soniox-context');

test('D-W1: always includes domain and topic even with no participants', () => {
  const context = buildSonioxContext({ title: 'Q3 planning', participants: [] });
  assert.deepStrictEqual(context.general, [
    { key: 'domain', value: 'Business meeting' },
    { key: 'topic', value: 'Q3 planning' }
  ]);
});

test('falls back to "Meeting" topic when title is missing', () => {
  const context = buildSonioxContext({});
  const topic = context.general.find(pair => pair.key === 'topic');
  assert.strictEqual(topic.value, 'Meeting');
});

test('D-W2: adds "speakers" as "<N> speakers" only when participants are known', () => {
  const withParticipants = buildSonioxContext({ title: 'Standup', participants: ['Alice', 'Bob'] });
  const speakers = withParticipants.general.find(pair => pair.key === 'speakers');
  assert.deepStrictEqual(speakers, { key: 'speakers', value: '2 speakers' });

  const withoutParticipants = buildSonioxContext({ title: 'Standup', participants: [] });
  assert.strictEqual(withoutParticipants.general.find(pair => pair.key === 'speakers'), undefined);

  const undefinedParticipants = buildSonioxContext({ title: 'Standup' });
  assert.strictEqual(undefinedParticipants.general.find(pair => pair.key === 'speakers'), undefined);
});

test('D-W2: also includes a "participants" pair with the joined names', () => {
  const context = buildSonioxContext({ title: 'Standup', participants: ['Alice', 'Bob'] });
  const participants = context.general.find(pair => pair.key === 'participants');
  assert.strictEqual(participants.value, 'Alice, Bob');
});

test('D-W2: blank/whitespace-only participant names are filtered out and do not count toward N', () => {
  const context = buildSonioxContext({ title: 'Standup', participants: ['Alice', '  ', '', 'Bob'] });
  const speakers = context.general.find(pair => pair.key === 'speakers');
  assert.strictEqual(speakers.value, '2 speakers');
});

test('D-W3: warns (does not throw) when participants exceed 15', () => {
  const participants = Array.from({ length: 16 }, (_, i) => `Person ${i + 1}`);
  const warnings = [];
  const context = buildSonioxContext(
    { title: 'All-hands', participants },
    { onWarning: message => warnings.push(message) }
  );

  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /15/);
  assert.match(warnings[0], /16/);
  // Still builds a usable context — a warning, not a block.
  const speakers = context.general.find(pair => pair.key === 'speakers');
  assert.strictEqual(speakers.value, '16 speakers');
});

test('D-W3: exactly 15 participants does not warn', () => {
  const participants = Array.from({ length: MAX_SPEAKERS_FOR_DIARIZATION }, (_, i) => `Person ${i + 1}`);
  const warnings = [];
  buildSonioxContext({ title: 'All-hands', participants }, { onWarning: message => warnings.push(message) });
  assert.strictEqual(warnings.length, 0);
});

test('does not throw when onWarning callback is not provided', () => {
  const participants = Array.from({ length: 20 }, (_, i) => `Person ${i + 1}`);
  assert.doesNotThrow(() => buildSonioxContext({ title: 'Big meeting', participants }));
});

test('hard cap: general never exceeds MAX_GENERAL_PAIRS entries', () => {
  // Only 4 pairs are ever produced today (domain/topic/speakers/participants),
  // so this asserts the cap mechanism itself rather than relying on it being hit.
  const context = buildSonioxContext({ title: 'x', participants: ['a', 'b'] });
  assert.ok(context.general.length <= MAX_GENERAL_PAIRS);
});

test('hard cap: total context stays within MAX_CONTEXT_CHARS, keeping speakers and topic', () => {
  const hugeTitle = 'T'.repeat(9_500);
  const participants = Array.from({ length: 50 }, (_, i) => `Participant Number ${i + 1} With A Long Name`);
  const context = buildSonioxContext({ title: hugeTitle, participants });

  assert.ok(JSON.stringify(context).length <= MAX_CONTEXT_CHARS);
  const keys = context.general.map(pair => pair.key);
  assert.ok(keys.includes('speakers'), 'speakers must be kept over participants/domain');
  assert.ok(keys.includes('topic'), 'topic must be kept over participants/domain');
});

test('hard cap: truncation drops participants pair before dropping speakers/topic', () => {
  const participants = Array.from({ length: 200 }, (_, i) => `Participant Number ${i + 1} With A Really Long Display Name`);
  const context = buildSonioxContext({ title: 'Long participant list', participants });

  assert.ok(JSON.stringify(context).length <= MAX_CONTEXT_CHARS);
  const keys = context.general.map(pair => pair.key);
  assert.ok(keys.includes('speakers'));
  assert.ok(keys.includes('topic'));
  assert.ok(!keys.includes('participants'), 'participants pair should be dropped first when over budget');
});
