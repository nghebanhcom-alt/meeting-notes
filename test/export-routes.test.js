'use strict';

// T11/T12 (BR-41..BR-48) — spawns the real server against a throwaway
// storage dir (same pattern as test/presets.test.js / pre-meeting-fields),
// and writes into a real temp export directory (Protocol 5.3/5.4 — no fs
// mocking for the write path).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const PORT = 8795;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let storageDir;
let exportDir;

async function startServer() {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-export-routes-test-storage-'));
  exportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-export-routes-test-target-'));
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
  if (exportDir) await fs.rm(exportDir, { recursive: true, force: true });
});

function baseMeeting(overrides = {}) {
  return {
    id: 'meeting-export-1',
    title: 'Standup',
    date: new Date().toISOString(),
    duration: 0,
    participants: [],
    status: 'draft',
    transcript: [],
    translations: [],
    actionItems: [],
    notes: '',
    tags: [],
    meetingType: '',
    topic: '',
    leadBy: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

test('GET /api/export-settings starts out not configured, with a suggested dir', async () => {
  const res = await fetch(`${BASE}/api/export-settings`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.configured, false);
  assert.ok(data.suggestedDir.includes('MeetNote'));
});

test('PUT /api/export-settings rejects a relative path (BR-42)', async () => {
  const res = await fetch(`${BASE}/api/export-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdownDir: 'relative/dir' })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.error.code, 'EXPORT_DIR_NOT_ABSOLUTE');
});

test('PUT /api/export-settings is rejected for a cross-site Origin (CSRF gate)', async () => {
  const res = await fetch(`${BASE}/api/export-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://evil.example' },
    body: JSON.stringify({ markdownDir: exportDir })
  });
  assert.strictEqual(res.status, 403);
});

test('PUT /api/export-settings accepts a real writable temp dir, then GET reflects it', async () => {
  const res = await fetch(`${BASE}/api/export-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdownDir: exportDir })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.markdownDir, exportDir);

  const getRes = await fetch(`${BASE}/api/export-settings`);
  const getData = await getRes.json();
  assert.strictEqual(getData.configured, true);
  assert.strictEqual(getData.markdownDir, exportDir);
});

test('POST /api/export-settings/check validates without persisting or mkdir-ing a missing dir', async () => {
  const missing = path.join(exportDir, 'not-created-yet');
  const res = await fetch(`${BASE}/api/export-settings/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdownDir: missing })
  });
  assert.strictEqual(res.status, 200);
  const exists = await fs.stat(missing).then(() => true).catch(() => false);
  assert.strictEqual(exists, false, 'dry-run check must not create the directory');

  // Configured dir must be unaffected by the check call.
  const settingsRes = await fetch(`${BASE}/api/export-settings`);
  const settings = await settingsRes.json();
  assert.strictEqual(settings.markdownDir, exportDir);
});

test('POST /api/export/markdown writes the real file, no meetingId path traversal surface (BR-41/BR-45)', async () => {
  const putRes = await fetch(`${BASE}/api/meetings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([baseMeeting({ meetingType: 'sales-call', topic: 'Q4 pricing' })])
  });
  assert.strictEqual(putRes.status, 200);

  const content = '# Standup\n\nHello export.';
  const exportRes = await fetch(`${BASE}/api/export/markdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId: 'meeting-export-1', content, includeTranscript: true })
  });
  assert.strictEqual(exportRes.status, 200);
  const data = await exportRes.json();
  assert.match(data.fileName, /^\d{6}-/);
  assert.ok(data.fileName.endsWith('-SC.md'));
  assert.deepStrictEqual(data.warnings, ['EXPORT_NO_SUMMARY']);

  const written = await fs.readFile(data.path, 'utf8');
  assert.strictEqual(written, content);
});

test('POST /api/export/markdown a second time for the same meeting appends " (2)" without overwriting the first (BR-46)', async () => {
  const secondContent = '# Standup v2';
  const exportRes = await fetch(`${BASE}/api/export/markdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId: 'meeting-export-1', content: secondContent, includeTranscript: true })
  });
  assert.strictEqual(exportRes.status, 200);
  const data = await exportRes.json();
  assert.ok(data.fileName.includes('(2)'));
  const written = await fs.readFile(data.path, 'utf8');
  assert.strictEqual(written, secondContent);
});

test('POST /api/export/markdown with an unknown meetingId returns 404 EXPORT_MEETING_NOT_FOUND', async () => {
  const res = await fetch(`${BASE}/api/export/markdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId: 'does-not-exist', content: 'x' })
  });
  assert.strictEqual(res.status, 404);
  const data = await res.json();
  assert.strictEqual(data.error.code, 'EXPORT_MEETING_NOT_FOUND');
});

test('POST /api/export/markdown rejects content over 8 MB with 413', async () => {
  const res = await fetch(`${BASE}/api/export/markdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId: 'meeting-export-1', content: 'a'.repeat(9 * 1024 * 1024) })
  });
  assert.strictEqual(res.status, 413);
  const data = await res.json();
  assert.strictEqual(data.error.code, 'EXPORT_CONTENT_TOO_LARGE');
});

test('POST /api/export/open-folder — macOS smoke test opens the real configured folder; other platforms get 501', async () => {
  const res = await fetch(`${BASE}/api/export/open-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (process.platform === 'darwin') {
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.opened, true);
  } else {
    assert.strictEqual(res.status, 501);
    const data = await res.json();
    assert.strictEqual(data.error.code, 'OPEN_FOLDER_UNSUPPORTED');
  }
});

test('POST /api/export/markdown returns EXPORT_DIR_NOT_CONFIGURED when no directory has been saved yet', async () => {
  // Independent server instance with a fresh storage dir so this does not
  // interfere with the configured-dir tests above.
  const port = PORT + 1;
  const freshStorage = await fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-export-routes-test-fresh-'));
  const freshServer = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), MEETNOTE_STORAGE_DIR: freshStorage },
    stdio: 'ignore'
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 10000;
    for (;;) {
      try {
        const r = await fetch(`${base}/api/health`);
        if (r.ok) break;
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('server did not start');
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    await fetch(`${base}/api/meetings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([baseMeeting({ id: 'fresh-meeting' })])
    });

    const res = await fetch(`${base}/api/export/markdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId: 'fresh-meeting', content: 'x' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error.code, 'EXPORT_DIR_NOT_CONFIGURED');
  } finally {
    freshServer.kill('SIGTERM');
    await fs.rm(freshStorage, { recursive: true, force: true });
  }
});
