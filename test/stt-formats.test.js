'use strict';

// TV1 — server/stt/formats.js + GET /api/stt/providers extension
// (BR-79, BR-82, BR-84, BR-141, BR-143; R-L, R-AE).

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const {
  PROVIDER_FORMATS, APP_ACCEPTED_EXTENSIONS, extensionOf, statusFor, resolveAudioMime, encodingForMime
} = require('../server/stt/formats');
const { createGoogleAdapter } = require('../server/stt/providers/google');
const { createSonioxAdapter } = require('../server/stt/providers/soniox');

/* ── pure helpers ── */

test('extensionOf lowercases and strips the leading dot', () => {
  assert.strictEqual(extensionOf('REC_001.M4A'), 'm4a');
  assert.strictEqual(extensionOf('no-extension'), '');
  assert.strictEqual(extensionOf(''), '');
});

test('APP_ACCEPTED_EXTENSIONS is the union of every provider\'s accepted+legacy (BR-79)', () => {
  assert.deepStrictEqual(APP_ACCEPTED_EXTENSIONS, [
    'aac', 'aiff', 'amr', 'asf', 'flac', 'm4a', 'mp3', 'mp4', 'ogg', 'wav', 'webm'
  ]);
});

test('statusFor returns accepted/legacy/rejected/unknown per the declared table', () => {
  assert.strictEqual(statusFor('whisper', 'm4a'), 'accepted');
  assert.strictEqual(statusFor('whisper', 'flac'), 'legacy'); // BR-84: no doc confirmation, must not reject
  assert.strictEqual(statusFor('google', 'm4a'), 'rejected');
  assert.strictEqual(statusFor('soniox', 'txt'), 'unknown'); // BR-82: outside the app's known universe
});

test('Google rejected/accepted are derived from encodingForMime, not hand-typed (BR-141)', () => {
  // Every extension the table calls "rejected" must really make encodingForMime
  // return null, and vice versa — this is the refactor that makes the
  // client-facing table and the server enforcement impossible to drift apart.
  for (const ext of PROVIDER_FORMATS.google.accepted) {
    assert.ok(encodingForMime(require('../server/stt/formats').EXTENSION_MIME[ext]),
      `${ext} is marked accepted but encodingForMime rejects its mime`);
  }
  for (const ext of PROVIDER_FORMATS.google.rejected) {
    assert.strictEqual(encodingForMime(require('../server/stt/formats').EXTENSION_MIME[ext]), null,
      `${ext} is marked rejected but encodingForMime accepts its mime`);
  }
});

test('resolveAudioMime falls back to the extension when Content-Type is empty/octet-stream', () => {
  assert.strictEqual(resolveAudioMime('', 'clip.wav'), 'audio/wav');
  assert.strictEqual(resolveAudioMime('application/octet-stream', 'clip.wav'), 'audio/wav');
  assert.strictEqual(resolveAudioMime('audio/mpeg', 'clip.wav'), 'audio/mpeg', 'an explicit non-generic header always wins');
  assert.strictEqual(resolveAudioMime('', 'clip.unknownext'), 'application/octet-stream', 'unknown extension keeps the generic fallback');
});

test('changing an adapter\'s maxUploadBytes constant is reflected by the adapter object directly', () => {
  // Regression guard for BR-141's "single source" requirement: listProviders()
  // (server/stt/index.js) reads `adapter.maxUploadBytes` verbatim — there is no
  // second constant anywhere that could drift from it.
  const google = createGoogleAdapter({ getKey: async () => 'k', timeoutMs: 5000 });
  assert.strictEqual(google.maxUploadBytes, 10 * 1024 * 1024);
  assert.deepStrictEqual(google.formats, PROVIDER_FORMATS.google);

  const soniox = createSonioxAdapter({ getKey: async () => 'k' });
  assert.strictEqual(soniox.maxUploadBytes, 500 * 1024 * 1024);
  assert.deepStrictEqual(soniox.formats, PROVIDER_FORMATS.soniox);
});

/* ── GET /api/stt/providers — integration, real server ── */

const PORT = 8801;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let storageDir;

async function startServer(extraEnv = {}) {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-formats-test-'));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), MEETNOTE_STORAGE_DIR: storageDir, ...extraEnv },
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
}

async function cleanup() {
  if (server) { server.kill('SIGTERM'); server = null; }
  if (storageDir) await fs.rm(storageDir, { recursive: true, force: true }).catch(() => {});
  storageDir = null;
}

test('GET /api/stt/providers exposes maxUploadBytes/formats/appAcceptedExtensions and never leaks the API key', async () => {
  await startServer({ SONIOX_API_KEY: 'SECRET-123' });
  try {
    const response = await fetch(`${BASE}/api/stt/providers`);
    assert.strictEqual(response.status, 200);
    const rawBody = await response.text();
    assert.ok(!rawBody.includes('SECRET'), 'response body must never contain the API key');

    const body = JSON.parse(rawBody);
    assert.strictEqual(body.maxAudioBytes, 2 * 1024 * 1024 * 1024);
    assert.deepStrictEqual(body.appAcceptedExtensions, APP_ACCEPTED_EXTENSIONS);

    const soniox = body.providers.find(p => p.id === 'soniox');
    assert.strictEqual(soniox.maxUploadBytes, 500 * 1024 * 1024);
    assert.deepStrictEqual(soniox.formats, PROVIDER_FORMATS.soniox);
    assert.strictEqual(soniox.configured, true, 'the env key must still be detected');

    const google = body.providers.find(p => p.id === 'google');
    assert.strictEqual(google.maxUploadBytes, 10 * 1024 * 1024);
    assert.deepStrictEqual(google.formats.rejected.sort(), ['aac', 'aiff', 'amr', 'asf', 'm4a', 'mp4'].sort());
  } finally {
    await cleanup();
  }
});

test('a .wav upload with an empty Content-Type still stores a usable mime (resolveAudioMime wired into saveAudio)', async () => {
  await startServer();
  try {
    const id = 'formats-wav-test';
    const put = await fetch(`${BASE}/api/audio/${id}`, {
      method: 'PUT',
      // Browsers send exactly this generic value for several containers
      // (Architecture §V7.1) — the case resolveAudioMime exists to fix.
      headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Filename': 'clip.wav' },
      body: Buffer.from('fake-wav-bytes')
    });
    assert.strictEqual(put.status, 200);

    const get = await fetch(`${BASE}/api/audio/${id}`);
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.headers.get('content-type'), 'audio/wav');
  } finally {
    await cleanup();
  }
});
