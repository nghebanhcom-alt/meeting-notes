'use strict';

// Regression tests for the rotating backup that atomicWriteJson() takes
// before overwriting a critical metadata file (meetings.json, settings.json,
// jobs.json, presets.json). Added after a real incident where meetings.json
// was wiped with no way to recover it.
//
// Spawns the real server against a throwaway storage dir, exactly like
// test/http.test.js, since the backup logic lives inside atomicWriteJson()
// in server.js and is not exported for direct unit testing.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const PORT = 8803;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let storageDir;
let backupDir;

before(async () => {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-backup-test-'));
  backupDir = path.join(storageDir, '.backups');
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
    await new Promise(res => setTimeout(res, 150));
  }
});

after(async () => {
  if (server) server.kill('SIGTERM');
  if (storageDir) await fs.rm(storageDir, { recursive: true, force: true });
});

async function putSettings(body) {
  const r = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.strictEqual(r.status, 200);
}

async function listBackups(prefix) {
  const entries = await fs.readdir(backupDir).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter(name => name.startsWith(prefix));
}

test('overwriting an important file backs up the pre-overwrite content', async () => {
  // First write: whatever ensureStorage() defaulted settings.json to gets
  // backed up before it's replaced.
  await putSettings({ marker: 'first' });
  // Second write: this is the one whose backup we assert on — it must hold
  // 'first', never 'second' (the value written by this same call).
  await putSettings({ marker: 'second' });

  const backups = await listBackups('settings-');
  assert.ok(backups.length > 0, 'expected at least one settings backup');

  const contents = await Promise.all(
    backups.map(name => fs.readFile(path.join(backupDir, name), 'utf8').then(JSON.parse))
  );
  assert.ok(
    contents.some(value => value.marker === 'first'),
    'a backup must contain the content from before the second write'
  );
  assert.ok(
    !contents.some(value => value.marker === 'second'),
    'the value from the write that triggered the backup must not appear inside the backup itself'
  );
});

test('only the 5 most recent backups per file are kept', async () => {
  for (let i = 0; i < 7; i++) {
    await putSettings({ marker: `rotate-${i}` });
    await new Promise(resolve => setTimeout(resolve, 5)); // keep timestamps distinct
  }

  const backups = await listBackups('settings-');
  assert.strictEqual(backups.length, 5, 'expected exactly 5 retained backups, not 6 or more');
});

test('writing a file outside the important list creates no backup', async () => {
  const reportBody = { summary: 'test summary', description: 'test description' };
  const first = await fetch(`${BASE}/api/bug-reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reportBody)
  });
  assert.strictEqual(first.status, 201);
  const second = await fetch(`${BASE}/api/bug-reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reportBody)
  });
  assert.strictEqual(second.status, 201);

  const backups = await listBackups('meetnote-bug-report');
  assert.strictEqual(backups.length, 0, 'bug reports are not in the important-file backup list');
});

test('a backup failure never blocks the real write', async () => {
  // Force the backup step to fail: replace the backups directory with a
  // plain file, so fsp.mkdir(BACKUP_DIR, { recursive: true }) throws ENOTDIR.
  await fs.rm(backupDir, { recursive: true, force: true });
  await fs.writeFile(backupDir, 'not a directory');

  const r = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marker: 'survives-broken-backup-dir' })
  });
  assert.strictEqual(r.status, 200, 'the real write must still succeed even if backup fails');

  const data = await (await fetch(`${BASE}/api/data`)).json();
  assert.strictEqual(data.settings.marker, 'survives-broken-backup-dir');

  await fs.rm(backupDir, { force: true });
});
