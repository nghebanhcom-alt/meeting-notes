'use strict';

// Unit tests for server/llm/preset-schema.js (T4, T5, T9).
// Pure functions only — no server spin-up needed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  sectionKeyFor,
  buildJsonSchema,
  buildGeminiSchema,
  buildNormalizer,
  buildSummaryFormat,
  snapshotOf,
  GENERAL_SECTIONS,
  GENERAL_SNAPSHOT
} = require('../server/llm/preset-schema');
const { buildSummaryPrompt, buildChunkPrompt, buildSynthesisPrompt } = require('../server/llm/prompts');
const { SUMMARY_SCHEMA } = require('../server/llm/providers/gemini');
const { instantiateBuiltIns } = require('../server/llm/presets');

const STATIC_JSON_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'schemas', 'meeting-summary.schema.json'), 'utf8')
);

function generalPreset() {
  const [general] = instantiateBuiltIns();
  return general;
}

// BR-20 virtual snapshot shape — the legacy 5 English keys. Since
// Architecture v2.0 §9.3, this is NOT the same as the "General Meeting"
// BUILT_IN_PRESETS seed anymore (that seed now has 7 Vietnamese sections,
// BR-64) — the two used to be identical by construction in v1.0, but that
// coupling was removed on purpose. Tests below must use this legacy shape,
// not `generalPreset()`, when checking the pinned static schemas.
function legacyGeneralPreset() {
  return { sections: GENERAL_SECTIONS };
}

// --- T4: regression tests against the two hand-written static schemas ---

test('buildJsonSchema(legacy GENERAL_SECTIONS) equals schemas/meeting-summary.schema.json exactly', () => {
  assert.deepStrictEqual(buildJsonSchema(legacyGeneralPreset()), STATIC_JSON_SCHEMA);
});

test('buildGeminiSchema(legacy GENERAL_SECTIONS) equals gemini.js SUMMARY_SCHEMA exactly', () => {
  assert.deepStrictEqual(buildGeminiSchema(legacyGeneralPreset()), SUMMARY_SCHEMA);
});

// --- sectionKeyFor (§3.1) ---

test('sectionKeyFor slugifies a label into camelCase', () => {
  assert.strictEqual(sectionKeyFor('Key Points', 0, new Set()), 'keyPoints');
  assert.strictEqual(sectionKeyFor('Bối cảnh khách hàng', 0, new Set()), 'boiCanhKhachHang');
});

test('sectionKeyFor falls back to a positional key for non-Latin labels', () => {
  assert.strictEqual(sectionKeyFor('議事録', 2, new Set()), 'section3');
});

test('sectionKeyFor avoids reserved keys and duplicates within the same preset', () => {
  const used = new Set(['title']);
  const key = sectionKeyFor('Title', 0, used);
  assert.notStrictEqual(key, 'title');
  assert.match(key, /^[a-z][A-Za-z0-9]{0,39}$/);

  const usedTwice = new Set(['summary']);
  const dup = sectionKeyFor('Summary', 0, usedTwice);
  assert.notStrictEqual(dup, 'summary');
});

// --- T5: preset sections must reach every builder (BR-11) ---

test('a preset applies to buildSummaryPrompt, buildChunkPrompt and buildSynthesisPrompt alike', () => {
  const preset = {
    instruction: 'Focus on customer sentiment.',
    sections: [
      { key: 'context', label: 'Context', type: 'paragraph', hint: '' },
      { key: 'risks', label: 'Risks', type: 'bulletList', hint: '' },
      { key: 'followUps', label: 'Follow ups', type: 'actionList', hint: '' }
    ]
  };
  const meeting = {
    title: 'Sync', date: '2026-09-18', duration: 300, participants: ['A', 'B'],
    transcript: [{ time: 0, speaker: 'A', text: 'hello' }]
  };

  const single = buildSummaryPrompt(meeting, '', preset);
  const chunk = buildChunkPrompt(meeting, meeting.transcript, 1, 1, '', preset);
  const synthesis = buildSynthesisPrompt(meeting, [{ context: 'x' }], '', preset);

  for (const section of preset.sections) {
    const needle = `"${section.key}"`;
    assert.ok(single.includes(needle), `buildSummaryPrompt missing ${section.key}`);
    assert.ok(chunk.includes(needle), `buildChunkPrompt missing ${section.key}`);
    assert.ok(synthesis.includes(needle), `buildSynthesisPrompt missing ${section.key}`);
  }
});

test('omitting a preset keeps the legacy hardcoded 5-field prompt text (backward compatibility)', () => {
  const meeting = { title: 'T', date: '2026', duration: 1, participants: [], transcript: [] };
  const prompt = buildSummaryPrompt(meeting, '');
  assert.ok(prompt.includes('List concrete key points and explicit decisions.'));
  assert.ok(prompt.includes('Return only JSON matching the provided output schema.'));
});

// --- buildNormalizer: BR-13 / BR-14 ---

function threeSectionPreset() {
  return {
    sections: [
      { key: 'context', label: 'Context', type: 'paragraph', hint: '' },
      { key: 'risks', label: 'Risks', type: 'bulletList', hint: '' },
      { key: 'followUps', label: 'Follow ups', type: 'actionList', hint: '' }
    ]
  };
}

test('normalize keeps individually empty sections without throwing (BR-13)', () => {
  const normalize = buildNormalizer(threeSectionPreset());
  const data = normalize(JSON.stringify({ context: '', risks: ['ok'], followUps: [] }), 'deepseek');
  assert.deepStrictEqual(data, { context: '', risks: ['ok'], followUps: [] });
});

test('normalize throws INVALID_OUTPUT only when every section is empty (BR-13)', () => {
  const normalize = buildNormalizer(threeSectionPreset());
  assert.throws(
    () => normalize(JSON.stringify({ context: '', risks: [], followUps: [] }), 'deepseek'),
    error => error.llmCode === 'LLM_INVALID_OUTPUT'
  );
});

test('normalize drops keys outside the preset instead of surfacing them (BR-14)', () => {
  const normalize = buildNormalizer(threeSectionPreset());
  const data = normalize(
    JSON.stringify({ context: 'ok', risks: [], followUps: [], secretInternalField: 'leak' }),
    'deepseek'
  );
  assert.deepStrictEqual(Object.keys(data).sort(), ['context', 'followUps', 'risks']);
});

test('normalize preserves declared section order regardless of raw key order', () => {
  const normalize = buildNormalizer(threeSectionPreset());
  const data = normalize(JSON.stringify({ followUps: [], risks: ['x'], context: 'y' }), 'codex');
  assert.deepStrictEqual(Object.keys(data), ['context', 'risks', 'followUps']);
});

// --- buildSummaryFormat / snapshotOf ---

test('buildSummaryFormat bundles schema + normalizer + sectionsBlock for a preset', () => {
  const format = buildSummaryFormat(threeSectionPreset());
  assert.ok(format.jsonSchema.properties.context);
  assert.ok(format.geminiSchema.properties.risks);
  assert.strictEqual(typeof format.normalize, 'function');
  assert.ok(format.sectionsBlock.includes('"context"'));
});

test('snapshotOf captures presetId, name, sections and a timestamp', () => {
  const preset = { id: 'abc', name: 'Sales Call', sections: threeSectionPreset().sections };
  const snapshot = snapshotOf(preset);
  assert.strictEqual(snapshot.presetId, 'abc');
  assert.strictEqual(snapshot.name, 'Sales Call');
  assert.strictEqual(snapshot.sections.length, 3);
  assert.ok(snapshot.capturedAt);
});

test('GENERAL_SNAPSHOT matches the legacy GENERAL_SECTIONS keys (BR-20)', () => {
  assert.deepStrictEqual(
    GENERAL_SNAPSHOT.sections.map(s => s.key),
    GENERAL_SECTIONS.map(s => s.key)
  );
});

// Architecture §9.3 trap: the BUILT_IN "General Meeting" seed (BR-64, 7
// Vietnamese sections) must NOT be confused with the legacy BR-20 virtual
// snapshot (5 English keys) — they used to be identical by construction in
// v1.0 and no longer are.
test('the built-in "General Meeting" seed keys differ from the legacy GENERAL_SECTIONS keys (Architecture §9.3)', () => {
  const general = generalPreset();
  assert.notDeepStrictEqual(
    general.sections.map(s => s.key),
    GENERAL_SECTIONS.map(s => s.key)
  );
});

// --- T9: DeepSeek golden fixture (Protocol 5.3 — no hand-written mock) ---

test('DeepSeek dynamic-sections golden fixture normalizes to the captured shape', () => {
  const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'deepseek', 'dynamic-sections.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const normalize = buildNormalizer(fixture.preset);
  const data = normalize(fixture.raw, 'deepseek');
  assert.deepStrictEqual(data, fixture.expected);
});
