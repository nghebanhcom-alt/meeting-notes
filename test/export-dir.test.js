'use strict';

// T10 (BR-42, BR-43, BR-46, BR-47) — runs against real temp directories, no
// fs mocking (Protocol 5.3/5.4: this module's whole reason to exist is a
// real filesystem race — `open('wx')` vs `rename` — that a mock cannot
// reproduce faithfully).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateExportDir, writeExportFile } = require('../server/export/dir');

async function mkTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-export-dir-test-'));
}

test('validateExportDir accepts an existing writable directory', async () => {
  const dir = await mkTmp();
  const result = await validateExportDir(dir, { storageDir: '/nonexistent-storage', rootDir: '/nonexistent-root' });
  assert.strictEqual(result.dir, path.resolve(dir));
  await fs.rm(dir, { recursive: true, force: true });
});

test('validateExportDir rejects a relative path (BR-42d)', async () => {
  await assert.rejects(
    validateExportDir('relative/path', { storageDir: '/s', rootDir: '/r' }),
    err => err.code === 'EXPORT_DIR_NOT_ABSOLUTE'
  );
});

test('validateExportDir expands "~" against the home directory instead of rejecting it', async () => {
  const dir = await fs.mkdtemp(path.join(os.homedir(), '.meetnote-export-test-'));
  const rel = `~/${path.basename(dir)}`;
  const result = await validateExportDir(rel, { storageDir: '/nonexistent-storage', rootDir: '/nonexistent-root' });
  assert.strictEqual(result.dir, dir);
  await fs.rm(dir, { recursive: true, force: true });
});

test('validateExportDir rejects a directory inside STORAGE_DIR/ROOT_DIR (BR-42d)', async () => {
  const root = await mkTmp();
  const storageDir = path.join(root, 'storage');
  await fs.mkdir(storageDir, { recursive: true });
  const inside = path.join(storageDir, 'exports');

  await assert.rejects(
    validateExportDir(inside, { storageDir, rootDir: root }),
    err => err.code === 'EXPORT_DIR_INSIDE_APP'
  );
  await fs.rm(root, { recursive: true, force: true });
});

test('validateExportDir rejects a directory that is an ancestor of STORAGE_DIR (too broad)', async () => {
  const root = await mkTmp();
  const storageDir = path.join(root, 'nested', 'storage');
  await fs.mkdir(storageDir, { recursive: true });

  // rootDir deliberately does NOT equal `root` here — otherwise the
  // "resolved === rootDir" branch of EXPORT_DIR_INSIDE_APP would fire first
  // and this test would no longer be exercising the ancestor-of check.
  await assert.rejects(
    validateExportDir(root, { storageDir, rootDir: '/nonexistent-root-xyz' }),
    err => err.code === 'EXPORT_DIR_TOO_BROAD'
  );
  await fs.rm(root, { recursive: true, force: true });
});

test('validateExportDir creates exactly 1 missing level when the parent exists (BR-42e)', async () => {
  const parent = await mkTmp();
  const target = path.join(parent, 'MeetNoteExports');
  const result = await validateExportDir(target, { storageDir: '/nonexistent-storage', rootDir: '/nonexistent-root' });
  assert.strictEqual(result.dir, target);
  const stat = await fs.stat(target);
  assert.ok(stat.isDirectory());
  await fs.rm(parent, { recursive: true, force: true });
});

test('validateExportDir fails with EXPORT_DIR_NOT_FOUND when the parent does not exist either', async () => {
  const parent = await mkTmp();
  const target = path.join(parent, 'missing-parent', 'MeetNoteExports');
  await assert.rejects(
    validateExportDir(target, { storageDir: '/s', rootDir: '/r' }),
    err => err.code === 'EXPORT_DIR_NOT_FOUND'
  );
  await fs.rm(parent, { recursive: true, force: true });
});

test('validateExportDir dry-run never creates a missing directory (POST /api/export-settings/check)', async () => {
  const parent = await mkTmp();
  const target = path.join(parent, 'DryRunOnly');
  const result = await validateExportDir(target, { storageDir: '/s', rootDir: '/r', dryRun: true });
  assert.strictEqual(result.dir, target);
  assert.ok(!fsSync.existsSync(target), 'dry-run must not create the directory');
  await fs.rm(parent, { recursive: true, force: true });
});

test('validateExportDir reports EXPORT_DIR_NOT_WRITABLE for a 0o500 directory (real write probe, not access())', async function () {
  if (process.platform === 'win32') return; // chmod semantics differ on Windows.
  if (process.getuid && process.getuid() === 0) return; // root bypasses permission bits.
  const dir = await mkTmp();
  await fs.chmod(dir, 0o500);
  try {
    await assert.rejects(
      validateExportDir(dir, { storageDir: '/s', rootDir: '/r' }),
      err => err.code === 'EXPORT_DIR_NOT_WRITABLE'
    );
  } finally {
    await fs.chmod(dir, 0o700);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('writeExportFile: 3 exports in a row never overwrite — " (2)"/" (3)" suffixes, first file untouched (BR-46)', async () => {
  const dir = await mkTmp();
  const first = await writeExportFile(dir, '260918-Standup-GM', 'AAA');
  const second = await writeExportFile(dir, '260918-Standup-GM', 'BBB');
  const third = await writeExportFile(dir, '260918-Standup-GM', 'CCC');

  assert.strictEqual(first.fileName, '260918-Standup-GM.md');
  assert.strictEqual(second.fileName, '260918-Standup-GM (2).md');
  assert.strictEqual(third.fileName, '260918-Standup-GM (3).md');

  assert.strictEqual(await fs.readFile(first.fullPath, 'utf8'), 'AAA');
  assert.strictEqual(await fs.readFile(second.fullPath, 'utf8'), 'BBB');
  assert.strictEqual(await fs.readFile(third.fullPath, 'utf8'), 'CCC');

  await fs.rm(dir, { recursive: true, force: true });
});

test('writeExportFile leaves no .tmp file and no empty placeholder after a mid-write failure (BR-47)', async () => {
  const dir = await mkTmp();
  // Fault-injection on our own dependency (fs/promises), not a mock of an
  // external tool's contract (Protocol 5 is about NOT guessing a 3rd-party
  // contract — this instead forces a real, hard-to-reproduce-on-demand disk
  // error path so writeExportFile's own cleanup code in dir.js actually runs).
  const fspModule = require('node:fs/promises');
  const originalRename = fspModule.rename;
  fspModule.rename = async () => {
    throw Object.assign(new Error('simulated rename failure'), { code: 'EIO' });
  };

  try {
    await assert.rejects(
      writeExportFile(dir, 'will-fail', 'content'),
      err => err.code === 'EXPORT_DIR_UNAVAILABLE'
    );
  } finally {
    fspModule.rename = originalRename;
  }

  const entries = await fs.readdir(dir);
  assert.deepStrictEqual(entries, [], 'no .tmp file and no empty target placeholder must remain');
  await fs.rm(dir, { recursive: true, force: true });
});

test('writeExportFile leaves no .tmp litter behind after several successful writes', async () => {
  const dir = await mkTmp();
  await writeExportFile(dir, 'no-litter', 'one');
  await writeExportFile(dir, 'no-litter', 'two');
  await writeExportFile(dir, 'no-litter', 'three');
  const entries = await fs.readdir(dir);
  assert.deepStrictEqual(entries.sort(), ['no-litter (2).md', 'no-litter (3).md', 'no-litter.md']);
  await fs.rm(dir, { recursive: true, force: true });
});
