'use strict';

// TV6 — 5 multi-part routes: POST /parts, POST /parts/:id/retry,
// POST /parts/reorder, DELETE /parts/:id, GET /parts (BR-117, 122, 123, 124,
// 133, 138, 139; Q9; R-S), plus the security checklist (§V16).
// Spawns the real server against a throwaway storage dir, same pattern as
// test/jobs.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const { rebuildMergedMeeting } = require('../server/meeting-parts');

const PORT = 8800;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let storageDir;

async function startServer(extraEnv = {}) {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-parts-test-'));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    // No STT_API_KEY env vars on purpose: every provider is a KNOWN adapter
    // (passes the R-S whitelist) but unconfigured, so its job fails almost
    // instantly with STT_AUTH_REQUIRED — no real network call, deterministic.
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

async function putAudio(partId, bytes = 'fake-audio-bytes') {
  const r = await fetch(`${BASE}/api/audio/${partId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/mp4', 'X-Audio-Filename': `${partId}.m4a` },
    body: Buffer.from(bytes)
  });
  assert.strictEqual(r.status, 200);
}

async function seedDraftMeeting(meetingId) {
  const meetings = [{ id: meetingId, title: 'Merged import test', status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  const r = await fetch(`${BASE}/api/meetings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meetings) });
  assert.strictEqual(r.status, 200);
}

function partId(n) {
  return `part-test${String(n).padStart(4, '0')}`;
}

async function registerParts(meetingId, ids, overrides = {}) {
  return fetch(`${BASE}/api/meetings/${meetingId}/parts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parts: ids.map((id, i) => ({ partId: id, filename: `${id}.m4a`, sizeBytes: 100, clientDurationSeconds: 30, order: i + 1 })),
      provider: 'soniox',
      ...overrides
    })
  });
}

// Seeds a multi-part meeting directly via PUT /api/meetings, with `parts`
// already in whatever status the test wants — bypassing POST /parts (and
// therefore the real STT job/scheduler entirely). This is what makes the
// retry/reorder tests deterministic: they exercise the ROUTE logic without
// depending on a real (or even reachable) STT provider ever finishing.
async function putMergedMeeting(meetingId, parts, extraFields = {}) {
  const meeting = { id: meetingId, title: 'Merged meeting fixture', status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), parts, ...extraFields };
  const built = rebuildMergedMeeting(meeting);
  const r = await fetch(`${BASE}/api/meetings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([built]) });
  assert.strictEqual(r.status, 200);
  return built;
}

async function readJobsFile() {
  return JSON.parse(await fs.readFile(path.join(storageDir, 'jobs.json'), 'utf8'));
}

/* ── register ── */

test('POST /parts registers N parts on ONE meeting and creates N jobs', async () => {
  await startServer();
  try {
    const meetingId = 'merged-register-' + Date.now();
    await seedDraftMeeting(meetingId);
    const ids = [partId(1), partId(2), partId(3)];
    await Promise.all(ids.map(id => putAudio(id)));

    const r = await registerParts(meetingId, ids);
    assert.strictEqual(r.status, 201);
    const body = await r.json();
    assert.strictEqual(body.meetingId, meetingId);
    assert.strictEqual(body.queued, 3);
    assert.strictEqual(body.parts.length, 3);

    const fresh = await (await fetch(`${BASE}/api/data`)).json();
    const meetings = fresh.meetings.filter(m => m.id === meetingId);
    assert.strictEqual(meetings.length, 1, 'exactly one meeting, not N');
    assert.strictEqual(meetings[0].parts.length, 3);

    const jobsFile = path.join(storageDir, 'jobs.json');
    const jobs = JSON.parse(await fs.readFile(jobsFile, 'utf8'));
    assert.strictEqual(jobs.filter(j => j.meetingId === meetingId).length, 3);
  } finally {
    await cleanup();
  }
});

test('an unknown provider is rejected with a whitelist error (R-S) and no part/job is created', async () => {
  await startServer();
  try {
    const meetingId = 'merged-badprovider-' + Date.now();
    await seedDraftMeeting(meetingId);
    const id = partId(1);
    await putAudio(id);

    const r = await registerParts(meetingId, [id], { provider: 'not-a-real-provider' });
    // STT_PROVIDER_NOT_FOUND's registered HTTP status is 404 everywhere else
    // in this codebase (server/stt/contracts.js STATUS_BY_CODE) — Architecture
    // §V6.2 literally says "400 STT_PROVIDER_NOT_FOUND"; kept consistent with
    // the pre-existing convention instead, flagged to Tech Lead (see report).
    assert.ok([400, 404].includes(r.status), `expected a client error, got ${r.status}`);
    const body = await r.json();
    assert.strictEqual(body.error.code, 'STT_PROVIDER_NOT_FOUND');

    const data = await (await fetch(`${BASE}/api/data`)).json();
    const meeting = data.meetings.find(m => m.id === meetingId);
    assert.ok(!meeting.parts || meeting.parts.length === 0, 'no part must have been registered');
  } finally {
    await cleanup();
  }
});

test('a malformed partId is rejected with 400 before touching storage (BR-111)', async () => {
  await startServer();
  try {
    const meetingId = 'merged-badpartid-' + Date.now();
    await seedDraftMeeting(meetingId);
    const r = await fetch(`${BASE}/api/meetings/${meetingId}/parts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ partId: '../../etc/passwd', filename: 'x.m4a', sizeBytes: 1, order: 1 }], provider: 'soniox' })
    });
    assert.strictEqual(r.status, 400);
  } finally {
    await cleanup();
  }
});

test('registering an 11th part is rejected with PARTS_LIMIT_EXCEEDED (BR-122)', async () => {
  await startServer();
  try {
    const meetingId = 'merged-toomany-' + Date.now();
    await seedDraftMeeting(meetingId);
    const tenIds = Array.from({ length: 10 }, (_, i) => partId(i));
    await Promise.all(tenIds.map(id => putAudio(id)));
    const first = await registerParts(meetingId, tenIds);
    assert.strictEqual(first.status, 201);

    const eleventh = partId(10);
    await putAudio(eleventh);
    const r = await registerParts(meetingId, [eleventh]);
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.strictEqual(body.error.code, 'PARTS_LIMIT_EXCEEDED');
  } finally {
    await cleanup();
  }
});

test('a finished single-part meeting cannot be turned into a merged meeting (409 MEETING_NOT_MULTIPART, E-V4)', async () => {
  await startServer();
  try {
    const meetingId = 'single-finished-' + Date.now();
    const meetings = [{ id: meetingId, title: 'Old single recording', status: 'completed', transcript: [{ time: 0, speaker: 'A', text: 'x' }], audioId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    await fetch(`${BASE}/api/meetings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meetings) });
    const id = partId(1);
    await putAudio(id);
    const r = await registerParts(meetingId, [id]);
    assert.strictEqual(r.status, 409);
    const body = await r.json();
    assert.strictEqual(body.error.code, 'MEETING_NOT_MULTIPART');
  } finally {
    await cleanup();
  }
});

/* ── retry ──
   These 3 tests seed an already-terminal multi-part meeting directly via
   PUT /api/meetings (putMergedMeeting) rather than through POST /parts, so
   they exercise the retry ROUTE deterministically without depending on a
   real STT provider ever finishing (no network/Keychain access needed,
   unlike the registration tests above where jobs are allowed to run and
   fail on their own). */

function part(overrides) {
  return {
    partId: overrides.partId, order: overrides.order, filename: `${overrides.partId}.m4a`,
    status: 'completed', duration: 100, durationKind: 'audio-length',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: `content of ${overrides.partId}` }], translations: [],
    usage: { provider: 'soniox', model: 'stt-async-v5', billableDurationSeconds: 100, pricingUsdPerHour: 0.10, estimatedCostUsd: 0.0028, startedAt: 'a', endedAt: 'b', translationEnabled: false, source: 'file-upload' },
    ...overrides
  };
}

test('retrying part 2 only touches part 2 — part 1 stays byte-for-byte, exactly one new job is created', async () => {
  await startServer();
  try {
    const meetingId = 'merged-retry-' + Date.now();
    const ids = [partId(1), partId(2)];
    await putMergedMeeting(meetingId, [
      part({ partId: ids[0], order: 1 }),
      part({ partId: ids[1], order: 2, status: 'failed', transcript: [], error: { code: 'STT_RATE_LIMITED', message: 'rate limit' } })
    ]);
    const before = await (await fetch(`${BASE}/api/data`)).json();
    const part1Before = JSON.stringify(before.meetings.find(m => m.id === meetingId).parts.find(p => p.partId === ids[0]));
    const jobsBefore = await readJobsFile();
    assert.strictEqual(jobsBefore.filter(j => j.meetingId === meetingId).length, 0, 'no job exists yet — this meeting never went through POST /parts');

    const retryResponse = await fetch(`${BASE}/api/meetings/${meetingId}/parts/${ids[1]}/retry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    assert.strictEqual(retryResponse.status, 200);
    const retryBody = await retryResponse.json();
    assert.strictEqual(retryBody.partId, ids[1]);

    const jobsAfter = await readJobsFile();
    const newJobsForMeeting = jobsAfter.filter(j => j.meetingId === meetingId);
    assert.strictEqual(newJobsForMeeting.length, 1, 'exactly one new job — retry never touches other parts');
    assert.strictEqual(newJobsForMeeting[0].partId, ids[1]);

    const after = await (await fetch(`${BASE}/api/data`)).json();
    const meetingAfter = after.meetings.find(m => m.id === meetingId);
    const part1After = JSON.stringify(meetingAfter.parts.find(p => p.partId === ids[0]));
    assert.strictEqual(part1After, part1Before, "part 1's own record must be untouched by part 2's retry");
    // part 2's exact status right now is a timing detail (the scheduler may
    // have already picked it up and failed it against the unconfigured
    // provider) — what this test cares about is job COUNT, asserted above.
    assert.ok(['queued', 'processing', 'failed'].includes(meetingAfter.parts.find(p => p.partId === ids[1]).status));
  } finally {
    await cleanup();
  }
});

test('retrying an already-queued/processing part is rejected with 409 PART_ALREADY_RUNNING', async () => {
  await startServer();
  try {
    const meetingId = 'merged-retry-running-' + Date.now();
    const id = partId(1);
    await putMergedMeeting(meetingId, [part({ partId: id, order: 1, status: 'processing', transcript: [] })]);

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/parts/${id}/retry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    assert.strictEqual(r.status, 409);
    const body = await r.json();
    assert.strictEqual(body.error.code, 'PART_ALREADY_RUNNING');
  } finally {
    await cleanup();
  }
});

/* ── reorder ── */

test('reorder never calls a provider (0 new jobs), updates transcript order, and leaves summary fields untouched', async () => {
  await startServer();
  try {
    const meetingId = 'merged-reorder-' + Date.now();
    const ids = [partId(1), partId(2)];
    await putMergedMeeting(meetingId, [
      part({ partId: ids[0], order: 1 }),
      part({ partId: ids[1], order: 2 })
    ], {
      summary: 'existing summary',
      summaryPreset: { presetId: 'p1', name: 'General', sections: [] },
      summaryGeneration: { provider: 'codex', model: 'default', promptVersion: 'meeting-summary-v5' }
    });

    const jobsBefore = await readJobsFile();

    const reorderRes = await fetch(`${BASE}/api/meetings/${meetingId}/parts/reorder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: [ids[1], ids[0]] })
    });
    assert.strictEqual(reorderRes.status, 200);
    const reorderBody = await reorderRes.json();
    assert.strictEqual(reorderBody.parts.find(p => p.partId === ids[1]).order, 1);
    assert.strictEqual(reorderBody.parts.find(p => p.partId === ids[0]).order, 2);

    const jobsAfter = await readJobsFile();
    assert.strictEqual(jobsAfter.length, jobsBefore.length, 'reorder must call stt.transcribe zero times');

    const dataAfter = await (await fetch(`${BASE}/api/data`)).json();
    const meetingAfter = dataAfter.meetings.find(m => m.id === meetingId);
    assert.strictEqual(meetingAfter.summary, 'existing summary');
    assert.deepStrictEqual(meetingAfter.summaryPreset, { presetId: 'p1', name: 'General', sections: [] });
    assert.deepStrictEqual(meetingAfter.summaryGeneration, { provider: 'codex', model: 'default', promptVersion: 'meeting-summary-v5' });
  } finally {
    await cleanup();
  }
});

test('reorder rejects a non-permutation order with 400 PARTS_ORDER_INVALID and changes nothing', async () => {
  await startServer();
  try {
    const meetingId = 'merged-reorder-invalid-' + Date.now();
    await seedDraftMeeting(meetingId);
    const ids = [partId(1), partId(2)];
    await Promise.all(ids.map(id => putAudio(id)));
    await registerParts(meetingId, ids);

    const before = await (await fetch(`${BASE}/api/data`)).json();
    const ordersBefore = before.meetings.find(m => m.id === meetingId).parts.map(p => p.order);

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/parts/reorder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: [ids[0]] })
    });
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.strictEqual(body.error.code, 'PARTS_ORDER_INVALID');

    const after = await (await fetch(`${BASE}/api/data`)).json();
    const ordersAfter = after.meetings.find(m => m.id === meetingId).parts.map(p => p.order);
    assert.deepStrictEqual(ordersAfter, ordersBefore);
  } finally {
    await cleanup();
  }
});

/* ── drop ── */

test('DELETE a part keeps its audio file on disk and leaves a permanent gap (BR-103/BR-134)', async () => {
  await startServer();
  try {
    const meetingId = 'merged-drop-' + Date.now();
    await seedDraftMeeting(meetingId);
    const ids = [partId(1), partId(2)];
    await Promise.all(ids.map(id => putAudio(id)));
    await registerParts(meetingId, ids);

    const audioFiles = await fs.readdir(path.join(storageDir, 'audio'));
    const audioCountBefore = audioFiles.filter(f => f.endsWith('.audio')).length;

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/parts/${ids[1]}`, { method: 'DELETE' });
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.deepStrictEqual(body.missingParts, [2]);

    const audioFilesAfter = await fs.readdir(path.join(storageDir, 'audio'));
    assert.strictEqual(audioFilesAfter.filter(f => f.endsWith('.audio')).length, audioCountBefore, 'audio must not be deleted');

    const data = await (await fetch(`${BASE}/api/data`)).json();
    const meeting = data.meetings.find(m => m.id === meetingId);
    assert.strictEqual(meeting.parts.find(p => p.partId === ids[1]).status, 'dropped');
    assert.ok(meeting.transcript.some(seg => seg.kind === 'part-gap' && seg.text.includes('đã bỏ phần 2')));
  } finally {
    await cleanup();
  }
});

test('DELETE an unknown part returns 404', async () => {
  await startServer();
  try {
    const meetingId = 'merged-drop-404-' + Date.now();
    await seedDraftMeeting(meetingId);
    const id = partId(1);
    await putAudio(id);
    await registerParts(meetingId, [id]);
    const r = await fetch(`${BASE}/api/meetings/${meetingId}/parts/part-doesnotexist99`, { method: 'DELETE' });
    assert.strictEqual(r.status, 404);
  } finally {
    await cleanup();
  }
});

/* ── poll ── */

test('GET /parts returns a compact status summary without transcript content', async () => {
  await startServer();
  try {
    const meetingId = 'merged-poll-' + Date.now();
    await seedDraftMeeting(meetingId);
    const ids = [partId(1), partId(2)];
    await Promise.all(ids.map(id => putAudio(id)));
    await registerParts(meetingId, ids);

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/parts`);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.parts.length, 2);
    for (const part of body.parts) {
      assert.ok(!('transcript' in part), 'poll response must not include transcript content');
      assert.ok('status' in part && 'offsetSeconds' in part && 'spanSeconds' in part);
    }
  } finally {
    await cleanup();
  }
});

test('GET /parts exposes per-part refine status and transcriptSource, plus meeting-level refiningParts (T-W13.2)', async () => {
  await startServer();
  try {
    const meetingId = 'merged-refine-poll-' + Date.now();
    const parts = [
      {
        partId: partId(1), order: 1, filename: 'a.m4a', status: 'completed',
        transcript: [{ start: 0, end: 1, text: 'hi', speaker: 'S1' }],
        transcriptSource: 'refined',
        refine: { status: 'running', jobId: 'job-refine-1', startedAt: new Date().toISOString(), finishedAt: null, error: null }
      },
      {
        partId: partId(2), order: 2, filename: 'b.m4a', status: 'completed',
        transcript: [{ start: 0, end: 1, text: 'yo', speaker: 'S1' }]
        // never refined — refine/transcriptSource intentionally absent
      }
    ];
    await putMergedMeeting(meetingId, parts);

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/parts`);
    assert.strictEqual(r.status, 200);
    const body = await r.json();

    assert.deepStrictEqual(body.refiningParts, [1], 'part 1 is running -> its order shows up in refiningParts');

    const [p1, p2] = body.parts;
    assert.strictEqual(p1.transcriptSource, 'refined');
    assert.strictEqual(p1.refine.status, 'running');
    assert.strictEqual(p1.refine.jobId, 'job-refine-1');

    // Regression: a part that never went through refine still gets a
    // backward-compatible default, not undefined/missing.
    assert.strictEqual(p2.transcriptSource, 'original');
    assert.strictEqual(p2.refine, null);
  } finally {
    await cleanup();
  }
});

/* ── security (§V16) — every new route goes through the same host/origin guard ── */

test('every new parts route returns 403 for a DNS-rebinding Host header', async () => {
  await startServer();
  try {
    const meetingId = 'merged-security-' + Date.now();
    const badHeaders = { Host: 'evil.example', Origin: 'http://evil.example', 'Content-Type': 'application/json' };

    const requests = [
      fetch(`${BASE}/api/meetings/${meetingId}/parts`, { method: 'GET', headers: badHeaders }),
      fetch(`${BASE}/api/meetings/${meetingId}/parts`, { method: 'POST', headers: badHeaders, body: '{}' }),
      fetch(`${BASE}/api/meetings/${meetingId}/parts/${partId(1)}/retry`, { method: 'POST', headers: badHeaders, body: '{}' }),
      fetch(`${BASE}/api/meetings/${meetingId}/parts/reorder`, { method: 'POST', headers: badHeaders, body: '{}' }),
      fetch(`${BASE}/api/meetings/${meetingId}/parts/${partId(1)}`, { method: 'DELETE', headers: badHeaders })
    ];
    const responses = await Promise.all(requests);
    for (const response of responses) assert.strictEqual(response.status, 403);
  } finally {
    await cleanup();
  }
});
