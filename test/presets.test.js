'use strict';

// Tests for server/llm/presets.js (T1, T2) and the /api/summary-presets +
// /api/summary routes wired in server.js (T3, T10).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const { BUILT_IN_PRESETS, instantiateBuiltIns, validatePreset, LIMITS } = require('../server/llm/presets');
const { MEETING_TYPES } = require('../js/meeting-types');
const { GENERAL_SECTIONS } = require('../server/llm/preset-schema');

/* ── T1 (BR-64..67): built-in presets ── */

test('BUILT_IN_PRESETS has exactly 10 templates, all marked isBuiltIn once instantiated', () => {
  assert.strictEqual(BUILT_IN_PRESETS.length, 10);
  const names = BUILT_IN_PRESETS.map(p => p.name);
  assert.deepStrictEqual(names, [
    'General Meeting', 'Họp giao ban', 'Họp phòng kinh doanh', 'Họp phòng marketing',
    'Brainstorming', 'Họp HĐQT', 'Sales call', 'Training', 'R&D sản phẩm',
    'OKR — xây dựng & check-in'
  ]);

  const instantiated = instantiateBuiltIns();
  assert.strictEqual(instantiated.length, 10);
  for (const preset of instantiated) {
    assert.strictEqual(preset.isBuiltIn, true);
    assert.ok(preset.id);
    assert.ok(preset.sections.length >= 1);
    // T16/§9.2: every seed must survive the real validator, not just look right.
    assert.doesNotThrow(() => validatePreset(
      { name: `${preset.name} copy`, description: preset.description, instruction: preset.instruction, sections: preset.sections },
      [], null
    ));
  }
});

test('BR-65: no built-in instruction contains the shared BLOCK DÙNG CHUNG text', () => {
  for (const preset of BUILT_IN_PRESETS) {
    assert.ok(!preset.instruction.includes('NGUYÊN TẮC BẮT BUỘC'), `${preset.name} instruction must not embed the shared block`);
  }
});

test('BR-67: MEETING_TYPES.presetName matches BUILT_IN_PRESETS.name 1-1', () => {
  assert.deepStrictEqual(MEETING_TYPES.map(t => t.presetName), BUILT_IN_PRESETS.map(p => p.name));
});

test('General Meeting seed is the BR-64 7-section shape, NOT the legacy GENERAL_SECTIONS (§9.3 trap)', () => {
  const [general] = instantiateBuiltIns();
  assert.strictEqual(general.name, 'General Meeting');
  assert.strictEqual(general.sections.length, 7);
  const legacyKeys = GENERAL_SECTIONS.map(s => s.key);
  const seedKeys = general.sections.map(s => s.key);
  assert.notDeepStrictEqual(seedKeys, legacyKeys);
});

/* ── T2: validate + CRUD logic (BR-2..BR-7) ── */

test('validatePreset rejects a preset with no sections (BR-2)', () => {
  assert.throws(
    () => validatePreset({ name: 'Empty', sections: [] }, [], null),
    error => error.code === 'PRESET_NO_SECTION'
  );
});

test('validatePreset rejects a duplicate name case-insensitively (BR-3)', () => {
  const existing = [{ id: 'a', name: 'Client Call', sections: [] }];
  assert.throws(
    () => validatePreset({ name: 'client call', sections: [{ label: 'X', type: 'paragraph' }] }, existing, null),
    error => error.code === 'PRESET_NAME_DUPLICATE'
  );
});

test('validatePreset enforces name/instruction/hint length limits (BR-4)', () => {
  assert.throws(
    () => validatePreset({ name: 'x'.repeat(61), sections: [{ label: 'A', type: 'paragraph' }] }, [], null),
    error => error.code === 'PRESET_NAME_TOO_LONG'
  );
  assert.throws(
    () => validatePreset({ name: 'OK', instruction: 'x'.repeat(2001), sections: [{ label: 'A', type: 'paragraph' }] }, [], null),
    error => error.code === 'PRESET_INSTRUCTION_TOO_LONG'
  );
  assert.throws(
    () => validatePreset({ name: 'OK', sections: [{ label: 'A', type: 'paragraph', hint: 'x'.repeat(301) }] }, [], null),
    error => error.code === 'PRESET_HINT_TOO_LONG'
  );
});

test('validatePreset rejects duplicate section labels within one preset (BR-5)', () => {
  assert.throws(
    () => validatePreset({
      name: 'Dup labels',
      sections: [{ label: 'Notes', type: 'paragraph' }, { label: 'notes', type: 'bulletList' }]
    }, [], null),
    error => error.code === 'PRESET_LABEL_DUPLICATE'
  );
});

test('validatePreset warns at 50 presets and blocks at 200 (BR-6)', () => {
  const existing = Array.from({ length: LIMITS.PRESET_COUNT_WARN - 1 }, (_, i) => ({ id: `p${i}`, name: `Preset ${i}`, sections: [] }));
  const { warnings } = validatePreset({ name: 'New one', sections: [{ label: 'A', type: 'paragraph' }] }, existing, null);
  assert.ok(warnings.some(w => w.code === 'PRESET_COUNT_WARN'));

  const tooMany = Array.from({ length: LIMITS.PRESET_COUNT_MAX }, (_, i) => ({ id: `p${i}`, name: `Preset ${i}`, sections: [] }));
  assert.throws(
    () => validatePreset({ name: 'Over limit', sections: [{ label: 'A', type: 'paragraph' }] }, tooMany, null),
    error => error.code === 'PRESET_LIMIT_REACHED'
  );
});

test('validatePreset blocks over 10 sections and warns over 6 (BR-7)', () => {
  const sixSections = Array.from({ length: 7 }, (_, i) => ({ label: `Section ${i}`, type: 'paragraph' }));
  const { warnings } = validatePreset({ name: 'Many sections', sections: sixSections }, [], null);
  assert.ok(warnings.some(w => w.code === 'PRESET_SECTIONS_WARN'));

  const elevenSections = Array.from({ length: 11 }, (_, i) => ({ label: `Section ${i}`, type: 'paragraph' }));
  assert.throws(
    () => validatePreset({ name: 'Too many', sections: elevenSections }, [], null),
    error => error.code === 'PRESET_TOO_MANY_SECTIONS'
  );
});

test('validatePreset rejects an unknown section type', () => {
  assert.throws(
    () => validatePreset({ name: 'Bad type', sections: [{ label: 'A', type: 'table' }] }, [], null),
    error => error.code === 'PRESET_INVALID_TYPE'
  );
});

test('validatePreset keeps a section key stable when only its label changes (§3.1 rule 5)', () => {
  const { preset: created } = validatePreset({ name: 'Original', sections: [{ label: 'Key Points', type: 'bulletList' }] }, [], null);
  const originalKey = created.sections[0].key;

  const { preset: edited } = validatePreset(
    { name: 'Original', sections: [{ key: originalKey, label: 'Highlights', type: 'bulletList' }] },
    [created],
    created.id
  );
  assert.strictEqual(edited.sections[0].key, originalKey);
  assert.strictEqual(edited.sections[0].label, 'Highlights');
});

test('validatePreset assigns a fresh key to a brand-new section on edit', () => {
  const { preset: created } = validatePreset({ name: 'Original', sections: [{ label: 'Summary', type: 'paragraph' }] }, [], null);
  const { preset: edited } = validatePreset(
    { name: 'Original', sections: [{ key: created.sections[0].key, label: 'Summary', type: 'paragraph' }, { label: 'Risks', type: 'bulletList' }] },
    [created],
    created.id
  );
  assert.strictEqual(edited.sections.length, 2);
  assert.notStrictEqual(edited.sections[1].key, edited.sections[0].key);
});

/* ── T3 / T10: HTTP routes, spawning the real server against a throwaway storage dir ── */

const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let storageDir;

async function startServer() {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-presets-test-'));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), MEETNOTE_STORAGE_DIR: storageDir },
    stdio: 'ignore'
  });
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server did not start');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

function stopServer() {
  if (server) { server.kill('SIGTERM'); server = null; }
}

before(startServer);
after(async () => {
  stopServer();
  if (storageDir) await fs.rm(storageDir, { recursive: true, force: true });
});

test('GET /api/summary-presets seeds the 10 built-ins on first read (BR-9)', async () => {
  const response = await fetch(`${BASE}/api/summary-presets`);
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.strictEqual(body.presets.length, 10);
});

test('POST → PUT → DELETE a preset round-trips, and DELETE-ing every preset re-seeds the built-ins (BR-9)', async () => {
  const createRes = await fetch(`${BASE}/api/summary-presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Custom preset', sections: [{ label: 'Notes', type: 'paragraph' }] })
  });
  assert.strictEqual(createRes.status, 201);
  const { preset } = await createRes.json();
  assert.strictEqual(preset.name, 'Custom preset');

  const updateRes = await fetch(`${BASE}/api/summary-presets/${preset.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Custom preset renamed', sections: [{ key: preset.sections[0].key, label: 'Notes', type: 'paragraph' }] })
  });
  assert.strictEqual(updateRes.status, 200);
  const { preset: updated } = await updateRes.json();
  assert.strictEqual(updated.name, 'Custom preset renamed');
  assert.strictEqual(updated.sections[0].key, preset.sections[0].key);

  // Delete every existing preset (the 10 built-ins + the custom one).
  const listRes = await fetch(`${BASE}/api/summary-presets`);
  const { presets } = await listRes.json();
  let lastBody = null;
  for (const item of presets) {
    const deleteRes = await fetch(`${BASE}/api/summary-presets/${item.id}`, { method: 'DELETE' });
    assert.strictEqual(deleteRes.status, 200);
    lastBody = await deleteRes.json();
  }
  assert.strictEqual(lastBody.success, true);
  assert.strictEqual(lastBody.presets.length, 10, 'deleting the last preset must re-seed the 10 built-ins');
});

test('POST /api/summary-presets validation failure returns 400 with a machine-readable code', async () => {
  const response = await fetch(`${BASE}/api/summary-presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '', sections: [] })
  });
  assert.strictEqual(response.status, 400);
  const body = await response.json();
  assert.strictEqual(body.error.code, 'PRESET_NAME_REQUIRED');
});

test('POST /api/summary-presets is rejected for a cross-site Origin (CSRF gate, reuses server.js isTrustedApiRequest)', async () => {
  const response = await fetch(`${BASE}/api/summary-presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
    body: JSON.stringify({ name: 'Should not be created', sections: [{ label: 'A', type: 'paragraph' }] })
  });
  assert.notStrictEqual(response.status, 201);
});

test('POST /api/summary with an unknown presetId returns 400 PRESET_NOT_FOUND (BR-19)', async () => {
  const response = await fetch(`${BASE}/api/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      presetId: 'does-not-exist',
      meeting: { title: 'T', transcript: [{ time: 0, speaker: 'A', text: 'hi' }] }
    })
  });
  assert.strictEqual(response.status, 400);
  const body = await response.json();
  assert.strictEqual(body.error.code, 'PRESET_NOT_FOUND');
});
