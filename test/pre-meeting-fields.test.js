'use strict';

// Tests for T2 (4 new meeting fields: server-side sanitize on PUT /api/meetings,
// BR-26/BR-27) — spawns the real server against a throwaway storage dir, same
// pattern as test/presets.test.js.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

// 8796 collides with test/export-routes.test.js's "fresh server" (PORT+1 =
// 8795+1 = 8796) — moved off that value to remove a pre-existing intermittent
// cross-file port collision (surfaced by running the suite repeatedly).
const PORT = 8802;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let storageDir;

async function startServer() {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-premeeting-test-'));
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

function baseMeeting(overrides = {}) {
  return {
    id: 'meeting-1',
    title: 'Test meeting',
    date: new Date().toISOString(),
    duration: 0,
    participants: [],
    status: 'draft',
    transcript: [],
    translations: [],
    actionItems: [],
    notes: '',
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

test('PUT /api/meetings normalizes an unknown meetingType to "" — never to "general" (BR-27)', async () => {
  const putRes = await fetch(`${BASE}/api/meetings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([baseMeeting({ meetingType: 'not-a-real-code' })])
  });
  assert.strictEqual(putRes.status, 200);

  const dataRes = await fetch(`${BASE}/api/data`);
  const { meetings } = await dataRes.json();
  assert.strictEqual(meetings[0].meetingType, '');
});

test('PUT /api/meetings clamps topic/leadBy to 200 chars and keeps a known meetingType (BR-26)', async () => {
  const longTopic = 'x'.repeat(500);
  const putRes = await fetch(`${BASE}/api/meetings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([baseMeeting({ id: 'meeting-2', meetingType: 'sales-call', topic: longTopic, leadBy: 'x'.repeat(500) })])
  });
  assert.strictEqual(putRes.status, 200);

  const dataRes = await fetch(`${BASE}/api/data`);
  const { meetings } = await dataRes.json();
  const meeting = meetings.find(m => m.id === 'meeting-2');
  assert.strictEqual(meeting.meetingType, 'sales-call');
  assert.strictEqual(meeting.topic.length, 200);
  assert.strictEqual(meeting.leadBy.length, 200);
});

test('PUT /api/meetings dedupes tags case-insensitively, keeps first casing, caps at 10 (BR-68)', async () => {
  const tags = ['VIP', 'vip', 'Q4', ...Array.from({ length: 12 }, (_, i) => `extra${i}`)];
  const putRes = await fetch(`${BASE}/api/meetings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([baseMeeting({ id: 'meeting-3', tags })])
  });
  assert.strictEqual(putRes.status, 200);

  const dataRes = await fetch(`${BASE}/api/data`);
  const { meetings } = await dataRes.json();
  const meeting = meetings.find(m => m.id === 'meeting-3');
  assert.strictEqual(meeting.tags.length, 10);
  assert.strictEqual(meeting.tags[0], 'VIP');
  assert.ok(!meeting.tags.includes('vip'), 'case-insensitive duplicate must be dropped');
});

test('other fields on the meeting pass through untouched by the pre-meeting sanitizer (§3.1)', async () => {
  const putRes = await fetch(`${BASE}/api/meetings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([baseMeeting({ id: 'meeting-4', title: 'Untouched Title', notes: 'Keep me' })])
  });
  assert.strictEqual(putRes.status, 200);

  const dataRes = await fetch(`${BASE}/api/data`);
  const { meetings } = await dataRes.json();
  const meeting = meetings.find(m => m.id === 'meeting-4');
  assert.strictEqual(meeting.title, 'Untouched Title');
  assert.strictEqual(meeting.notes, 'Keep me');
});
