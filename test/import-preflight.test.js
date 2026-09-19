'use strict';

// TV9 — js/import-preflight.js pure functions (BR-80/81/83/84/85/86/87/109/138/142).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  classify, findDuplicateMeeting, findDuplicateInBatch, capImportBatch, formatMbVi
} = require('../js/import-preflight');

const MB = 1024 * 1024;

function providersPayload(overrides = {}) {
  return {
    defaultProvider: 'soniox',
    appAcceptedExtensions: ['aac', 'aiff', 'amr', 'asf', 'flac', 'm4a', 'mp3', 'mp4', 'ogg', 'wav', 'webm'],
    providers: [
      {
        id: 'soniox', name: 'Soniox', configured: true, available: true, state: 'ready',
        maxUploadBytes: 500 * MB,
        formats: { accepted: ['aac', 'aiff', 'amr', 'asf', 'flac', 'mp3', 'ogg', 'wav', 'webm'], legacy: ['m4a', 'mp4'], rejected: [], sourceVerified: true }
      },
      {
        id: 'deepgram', name: 'Deepgram', configured: true, available: true, state: 'ready',
        maxUploadBytes: 1024 * MB,
        formats: { accepted: ['aac', 'flac', 'm4a', 'mp3', 'mp4', 'ogg', 'wav', 'webm'], legacy: ['aiff', 'amr', 'asf'], rejected: [], sourceVerified: true }
      },
      {
        id: 'whisper', name: 'OpenAI Whisper', configured: true, available: true, state: 'ready',
        maxUploadBytes: 25 * MB,
        formats: { accepted: ['m4a', 'mp3', 'mp4', 'wav', 'webm'], legacy: ['aac', 'aiff', 'amr', 'asf', 'flac', 'ogg'], rejected: [], sourceVerified: true }
      },
      {
        id: 'google', name: 'Google Speech-to-Text', configured: false, available: false, state: 'setup_required',
        maxUploadBytes: 10 * MB,
        formats: { accepted: ['flac', 'mp3', 'ogg', 'wav', 'webm'], legacy: [], rejected: ['aac', 'aiff', 'amr', 'asf', 'm4a', 'mp4'], sourceVerified: true }
      }
    ],
    ...overrides
  };
}

test('40MB .m4a with Whisper selected -> blockB TOO_LARGE_FOR_PROVIDER, alternatives only list providers ready for THIS file', () => {
  const file = { name: 'REC_20260916.m4a', size: 40 * MB };
  const result = classify(file, 'whisper', providersPayload());
  assert.strictEqual(result.level, 'blockB');
  assert.strictEqual(result.code, 'TOO_LARGE_FOR_PROVIDER');
  assert.strictEqual(result.microcopyId, 'ERR-02', 'Whisper is the one provider ERR-02s exact wording is literally true for');
  const ids = result.alternatives.map(a => a.id).sort();
  // soniox/deepgram accept m4a (legacy) and are well under their own limits;
  // google REJECTS m4a outright so it must never appear as an alternative.
  assert.deepStrictEqual(ids, ['deepgram', 'soniox']);
  assert.ok(result.alternatives.every(a => a.ready === true));
});

test('.txt file -> blockA EXT_UNSUPPORTED regardless of provider, reports the real extension + accepted list', () => {
  const file = { name: 'meeting-notes.txt', size: 1000 };
  const result = classify(file, 'soniox', providersPayload());
  assert.strictEqual(result.level, 'blockA');
  assert.strictEqual(result.code, 'EXT_UNSUPPORTED');
  assert.strictEqual(result.extension, 'txt');
  assert.strictEqual(result.microcopyId, 'ERR-01');
  assert.ok(result.appAcceptedExtensions.includes('m4a'));
  assert.deepStrictEqual(result.alternatives, []);
});

test('0-byte file -> blockA EMPTY_FILE, not recoverable by switching provider', () => {
  const file = { name: 'recording.m4a', size: 0 };
  const result = classify(file, 'soniox', providersPayload());
  assert.strictEqual(result.level, 'blockA');
  assert.strictEqual(result.code, 'EMPTY_FILE');
  assert.strictEqual(result.microcopyId, 'ERR-04');
});

test('Google selected + .m4a -> blockB PROVIDER_REJECTS_FORMAT (format, not size)', () => {
  const file = { name: 'voice.m4a', size: 5 * MB };
  const result = classify(file, 'google', providersPayload());
  assert.strictEqual(result.level, 'blockB');
  assert.strictEqual(result.code, 'PROVIDER_REJECTS_FORMAT');
  assert.strictEqual(result.microcopyId, 'ERR-02b');
});

test('provider payload unavailable (server error) -> every file is "ok" with preflightUnavailable:true (BR-142 fail-open)', () => {
  const file = { name: 'anything.opus', size: 1 };
  const result = classify(file, 'soniox', null);
  assert.strictEqual(result.level, 'ok');
  assert.strictEqual(result.preflightUnavailable, true);
});

test('file with no configured provider able to take it -> alternatives is empty (B3)', () => {
  // 40MB .flac: Whisper rejects the format outright (flac is only "legacy"
  // for Whisper... wait it IS legacy-accepted); use google (not configured)
  // + a size that exceeds every accepted provider instead.
  const file = { name: 'huge.wav', size: 2000 * MB };
  const result = classify(file, 'soniox', providersPayload());
  assert.strictEqual(result.level, 'blockB');
  assert.strictEqual(result.code, 'TOO_LARGE_FOR_PROVIDER');
  assert.deepStrictEqual(result.alternatives, []);
});

test('a provider with the right format but no API key yet is still listed as an alternative, with ready:false (B2)', () => {
  const file = { name: 'call.wav', size: 800 * MB }; // over Soniox's 500MB but Google (not configured) rejects wav format anyway
  const payload = providersPayload();
  // Make Google accept wav conceptually for this test by using deepgram-as-unconfigured instead:
  payload.providers.find(p => p.id === 'deepgram').configured = false;
  payload.providers.find(p => p.id === 'deepgram').available = false;
  const result = classify(file, 'soniox', payload);
  assert.strictEqual(result.level, 'blockB');
  const deepgramAlt = result.alternatives.find(a => a.id === 'deepgram');
  assert.ok(deepgramAlt, 'deepgram accepts wav and has enough headroom (1GB) even though unconfigured');
  assert.strictEqual(deepgramAlt.ready, false);
});

test('merged mode: classify runs per part and never sums sizes — two 20MB parts each pass Whisper 25MB individually', () => {
  const parts = [{ name: 'phan-1.m4a', size: 20 * MB }, { name: 'phan-2.m4a', size: 20 * MB }];
  const results = parts.map(part => classify(part, 'whisper', providersPayload()));
  assert.ok(results.every(r => r.level === 'ok'), 'each 20MB part individually fits under Whisper 25MB, even though the pair totals 40MB');
});

/* ── duplicate detection (BR-109/BR-139) ── */

test('findDuplicateMeeting matches on BOTH filename and byte size', () => {
  const existing = [{ id: 'm1', sourceFilename: 'REC_001.m4a', sourceSizeBytes: 54525952 }];
  assert.strictEqual(findDuplicateMeeting({ name: 'REC_001.m4a', size: 54525952 }, existing), existing[0]);
  assert.strictEqual(findDuplicateMeeting({ name: 'REC_001.m4a', size: 999 }, existing), null, 'same name, different size is NOT a duplicate');
  assert.strictEqual(findDuplicateMeeting({ name: 'REC_002.m4a', size: 54525952 }, existing), null, 'same size, different name is NOT a duplicate');
});

test('findDuplicateInBatch flags two picks of the same file within one import action', () => {
  const a = { name: 'x.m4a', size: 100 };
  const b = { name: 'x.m4a', size: 100 };
  const c = { name: 'y.m4a', size: 100 };
  assert.strictEqual(findDuplicateInBatch(a, [b, c]), true);
  assert.strictEqual(findDuplicateInBatch(a, [c]), false);
});

/* ── batch cap (BR-88) ── */

test('capImportBatch accepts the first 10 and reports the rest as rejected, never silently drops them', () => {
  const files = Array.from({ length: 15 }, (_, i) => ({ name: `f${i}.m4a`, size: 10 }));
  const { accepted, rejectedCount } = capImportBatch(files, 10);
  assert.strictEqual(accepted.length, 10);
  assert.strictEqual(rejectedCount, 5);
});

test('capImportBatch with 10 or fewer files rejects nothing', () => {
  const files = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.m4a`, size: 10 }));
  const { accepted, rejectedCount } = capImportBatch(files, 10);
  assert.strictEqual(accepted.length, 4);
  assert.strictEqual(rejectedCount, 0);
});

/* ── formatting ── */

test('formatMbVi uses a Vietnamese decimal comma below 10MB and rounds to whole MB above it', () => {
  assert.strictEqual(formatMbVi(121 * MB), '121 MB');
  assert.strictEqual(formatMbVi(5.4 * MB), '5,4 MB');
});
