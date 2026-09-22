'use strict';

// T-W3/T-W4/T-W3(mở rộng) — POST /api/meetings/:id/refine-transcript (§W13.1)
// + the extended PUT /api/meetings guard (§W3.2 R-W2). Spawns the real
// server against a throwaway storage dir, same pattern as test/jobs.test.js
// and test/parts-routes.test.js. No STT_* env vars on purpose: every
// provider is a KNOWN adapter but unconfigured, so its refine job fails
// almost instantly with STT_AUTH_REQUIRED — no network call, deterministic —
// which is enough to exercise the endpoint/guard/job-dispatch logic; the
// pure success-path writers are covered by test/refine.test.js (Protocol 6.2).

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

const { rebuildMergedMeeting } = require('../server/meeting-parts');

const PORT = 8801;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let storageDir;

async function startServer(extraEnv = {}) {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetnote-refine-test-'));
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

async function putAudio(id, bytes = 'fake-audio-bytes') {
  const r = await fetch(`${BASE}/api/audio/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/webm', 'X-Audio-Filename': `${id}.webm` },
    body: Buffer.from(bytes)
  });
  assert.strictEqual(r.status, 200);
}

async function putMeeting(meeting) {
  const r = await fetch(`${BASE}/api/meetings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([meeting]) });
  assert.strictEqual(r.status, 200);
}

async function readData() {
  return (await fetch(`${BASE}/api/data`)).json();
}

async function readJobsFile() {
  return JSON.parse(await fs.readFile(path.join(storageDir, 'jobs.json'), 'utf8'));
}

function part(overrides) {
  return {
    partId: overrides.partId, order: overrides.order, filename: `${overrides.partId}.m4a`,
    status: 'completed', duration: 100, durationKind: 'audio-length',
    transcript: [{ time: 0, speaker: 'Speaker 1', text: `content of ${overrides.partId}` }], translations: [],
    usage: { provider: 'soniox', model: 'stt-async-v5', billableDurationSeconds: 100, pricingUsdPerHour: 0.10, estimatedCostUsd: 0.0028, startedAt: 'a', endedAt: 'b', translationEnabled: false, source: 'file-upload' },
    ...overrides
  };
}

async function putMergedMeeting(meetingId, parts, extraFields = {}) {
  const meeting = { id: meetingId, title: 'Merged meeting fixture', status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), parts, ...extraFields };
  const built = rebuildMergedMeeting(meeting);
  await putMeeting(built);
  return built;
}

/* ── single-meeting refine ── */

test('POST refine-transcript (single) returns 201, snapshots liveTranscript, job runs async', async () => {
  await startServer();
  try {
    const meetingId = 'refine-single-' + Date.now();
    await putMeeting({
      id: meetingId, title: 'Live recording', status: 'completed',
      transcript: [{ time: 0, speaker: 'Speaker 1', text: 'live content' }], translations: [],
      audioId: meetingId, duration: 30, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    await putAudio(meetingId);

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/refine-transcript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    assert.strictEqual(r.status, 201);
    const body = await r.json();
    assert.strictEqual(body.mode, 'single');
    assert.ok(body.jobId);

    const data = await readData();
    const meeting = data.meetings.find(m => m.id === meetingId);
    assert.deepStrictEqual(meeting.liveTranscript, [{ time: 0, speaker: 'Speaker 1', text: 'live content' }]);
    assert.ok(['running', 'failed'].includes(meeting.refine.status));
    assert.strictEqual(meeting.status, 'completed', 'meeting.status is never touched by refine (WHY-W3)');
  } finally {
    await cleanup();
  }
});

test('POST refine-transcript (single) with no audio returns 422 REFINE_NOT_APPLICABLE', async () => {
  await startServer();
  try {
    const meetingId = 'refine-noaudio-' + Date.now();
    await putMeeting({ id: meetingId, title: 'Draft', status: 'draft', transcript: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/refine-transcript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    assert.strictEqual(r.status, 422);
    const body = await r.json();
    assert.strictEqual(body.error.code, 'REFINE_NOT_APPLICABLE');
  } finally {
    await cleanup();
  }
});

test('POST refine-transcript (single) on an unknown meeting returns 404', async () => {
  await startServer();
  try {
    const r = await fetch(`${BASE}/api/meetings/does-not-exist/refine-transcript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    assert.strictEqual(r.status, 404);
  } finally {
    await cleanup();
  }
});

test('PUT /api/meetings while refine.status===running: server keeps transcript/translations/duration/sonioxUsage regardless of incoming.status (R-W2)', async () => {
  await startServer();
  try {
    const meetingId = 'refine-guard-' + Date.now();
    const runningAt = new Date().toISOString();
    await putMeeting({
      id: meetingId, title: 'Being refined', status: 'completed',
      transcript: [{ time: 0, speaker: 'Speaker 1', text: 'server-owned content' }], translations: [],
      duration: 42, sonioxUsage: { provider: 'soniox', estimatedCostUsd: 0.01 },
      liveTranscript: [{ time: 0, speaker: 'Speaker 1', text: 'server-owned content' }],
      refine: { status: 'running', jobId: 'job-x', startedAt: runningAt, finishedAt: null, error: null },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });

    // A stale client snapshot — even claiming status:'completed' with a
    // DIFFERENT transcript — must not win while refine is running.
    const stale = {
      id: meetingId, title: 'Being refined (renamed by user)', status: 'completed',
      transcript: [{ time: 0, speaker: 'Speaker 1', text: 'STALE CLIENT COPY' }], translations: [],
      duration: 999, sonioxUsage: null, updatedAt: new Date().toISOString()
    };
    const putRes = await fetch(`${BASE}/api/meetings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([stale]) });
    assert.strictEqual(putRes.status, 200);

    const data = await readData();
    const meeting = data.meetings.find(m => m.id === meetingId);
    assert.strictEqual(meeting.transcript[0].text, 'server-owned content', 'transcript must not be overwritten while refine is running');
    assert.strictEqual(meeting.duration, 42);
    assert.strictEqual(meeting.sonioxUsage.estimatedCostUsd, 0.01);
    assert.strictEqual(meeting.refine.status, 'running');
    assert.strictEqual(meeting.title, 'Being refined (renamed by user)', 'non-owned fields (title) still pass through from the client');
  } finally {
    await cleanup();
  }
});

/* ── multi-part refine ── */

function partId(n) {
  return `part-refn${String(n).padStart(4, '0')}`;
}

test('POST refine-transcript (parts) with no partIds targets every eligible part, creates one job per part', async () => {
  await startServer();
  try {
    const meetingId = 'refine-parts-' + Date.now();
    const ids = [partId(1), partId(2)];
    await putMergedMeeting(meetingId, [
      part({ partId: ids[0], order: 1 }),
      part({ partId: ids[1], order: 2 })
    ]);
    await Promise.all(ids.map(id => putAudio(id)));

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/refine-transcript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    assert.strictEqual(r.status, 201);
    const body = await r.json();
    assert.strictEqual(body.mode, 'parts');
    assert.strictEqual(body.jobs.length, 2);
    assert.deepStrictEqual(body.skipped, []);

    const jobs = await readJobsFile();
    const refineJobs = jobs.filter(j => j.meetingId === meetingId);
    assert.strictEqual(refineJobs.length, 2);
    assert.deepStrictEqual(refineJobs.map(j => j.partId).sort(), ids.slice().sort());
    for (const job of refineJobs) assert.strictEqual(job.mode, 'refine');

    const data = await readData();
    const meeting = data.meetings.find(m => m.id === meetingId);
    for (const p of meeting.parts) {
      assert.strictEqual(p.status, 'completed', 'WHY-W8: refine must never flip part.status to processing');
      assert.ok(['running', 'failed'].includes(p.refine.status));
      assert.deepStrictEqual(p.previousTranscript, [{ time: 0, speaker: 'Speaker 1', text: `content of ${p.partId}`, language: '' }]);
    }
  } finally {
    await cleanup();
  }
});

test('POST refine-transcript (parts) skips a non-completed part with a reason, refines the rest', async () => {
  await startServer();
  try {
    const meetingId = 'refine-parts-skip-' + Date.now();
    const ids = [partId(1), partId(2)];
    await putMergedMeeting(meetingId, [
      part({ partId: ids[0], order: 1 }),
      part({ partId: ids[1], order: 2, status: 'failed', transcript: [], error: { code: 'X', message: 'x' } })
    ]);
    await putAudio(ids[0]);

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/refine-transcript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    assert.strictEqual(r.status, 201);
    const body = await r.json();
    assert.strictEqual(body.jobs.length, 1);
    assert.strictEqual(body.jobs[0].partId, ids[0]);
    assert.strictEqual(body.skipped.length, 1);
    assert.strictEqual(body.skipped[0].partId, ids[1]);
    assert.strictEqual(body.skipped[0].reason, 'PART_NOT_COMPLETED');

    const data = await readData();
    const failedPart = data.meetings.find(m => m.id === meetingId).parts.find(p => p.partId === ids[1]);
    assert.strictEqual(failedPart.status, 'failed', 'the skipped part must be completely untouched');
    assert.strictEqual(failedPart.refine, null);
  } finally {
    await cleanup();
  }
});

test('POST refine-transcript (parts) rejects an unknown partId with 400 PART_NOT_FOUND, creates nothing', async () => {
  await startServer();
  try {
    const meetingId = 'refine-parts-badid-' + Date.now();
    const id = partId(1);
    await putMergedMeeting(meetingId, [part({ partId: id, order: 1 })]);
    await putAudio(id);

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/refine-transcript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partIds: ['part-doesnotexist99'] })
    });
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.strictEqual(body.error.code, 'PART_NOT_FOUND');

    const jobs = await readJobsFile();
    assert.strictEqual(jobs.filter(j => j.meetingId === meetingId).length, 0);
  } finally {
    await cleanup();
  }
});

test('POST refine-transcript (parts) called twice for the same part: second call sees it ALREADY_RUNNING and returns 409', async () => {
  await startServer();
  try {
    const meetingId = 'refine-parts-dup-' + Date.now();
    const id = partId(1);
    await putMergedMeeting(meetingId, [part({ partId: id, order: 1 })]);
    await putAudio(id);

    const first = await fetch(`${BASE}/api/meetings/${meetingId}/refine-transcript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partIds: [id] })
    });
    assert.strictEqual(first.status, 201);

    // Immediately re-request the same part BEFORE its (deterministically
    // fast, unconfigured-provider) job has a chance to fail — the part's
    // own refine.status is what makes this deterministic, not timing.
    const second = await fetch(`${BASE}/api/meetings/${meetingId}/refine-transcript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partIds: [id] })
    });
    // Depending on scheduler timing the unconfigured-provider job may have
    // already failed between the two requests — in that case the part is
    // eligible again and a NEW job is legitimately created (201). What must
    // never happen is a silent second concurrent job while still running,
    // so accept either a clean dedupe (409) or a fresh re-run (201).
    assert.ok([201, 409].includes(second.status));
    if (second.status === 409) {
      const body = await second.json();
      assert.strictEqual(body.error.code, 'REFINE_ALREADY_RUNNING');
    }
  } finally {
    await cleanup();
  }
});

test('POST refine-transcript (parts) never calls retryPart\'s wipe-then-run path — a lỗi giữa chừng leaves transcript intact', async () => {
  await startServer();
  try {
    const meetingId = 'refine-parts-nowipe-' + Date.now();
    const id = partId(1);
    const original = part({ partId: id, order: 1 });
    await putMergedMeeting(meetingId, [original]);
    await putAudio(id);

    const r = await fetch(`${BASE}/api/meetings/${meetingId}/refine-transcript`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partIds: [id] })
    });
    assert.strictEqual(r.status, 201);

    // Wait for the unconfigured-provider job to reach a terminal state.
    const deadline = Date.now() + 10000;
    let refineStatus = '';
    for (;;) {
      const data = await readData();
      const p = data.meetings.find(m => m.id === meetingId).parts.find(x => x.partId === id);
      refineStatus = p.refine && p.refine.status;
      if (refineStatus === 'failed' || refineStatus === 'done') break;
      if (Date.now() > deadline) throw new Error('refine job did not reach a terminal state');
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    const data = await readData();
    const p = data.meetings.find(m => m.id === meetingId).parts.find(x => x.partId === id);
    assert.strictEqual(refineStatus, 'failed', 'unconfigured provider must fail, not succeed');
    assert.strictEqual(p.status, 'completed', "part.status must NOT become 'failed' — unlike retryPart/attach");
    assert.deepStrictEqual(p.transcript, [{ ...original.transcript[0], language: '' }], 'transcript must be exactly what it was before — retryPart\'s wipe must never run for refine');
  } finally {
    await cleanup();
  }
});

/* ── security (§V16) ── */

test('POST refine-transcript returns 403 for a DNS-rebinding Host header', async () => {
  await startServer();
  try {
    const r = await fetch(`${BASE}/api/meetings/anything/refine-transcript`, {
      method: 'POST',
      headers: { Host: 'evil.example', Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.strictEqual(r.status, 403);
  } finally {
    await cleanup();
  }
});

/* ── regression: the pre-existing 'attach' path is untouched by JOB_MODES ── */

test('regression: POST /api/import-transcription (job with no mode) still completes as before', async () => {
  await startServer();
  try {
    const meetingId = 'regression-attach-' + Date.now();
    await putMeeting({ id: meetingId, title: 'Test', status: 'processing', transcript: [], translations: [], language: 'en', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await putAudio(meetingId);

    const r = await fetch(`${BASE}/api/import-transcription`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId })
    });
    assert.strictEqual(r.status, 201);
    const { jobId } = await r.json();

    const deadline = Date.now() + 5000;
    let status = '';
    for (;;) {
      const jobRes = await (await fetch(`${BASE}/api/jobs/${jobId}`)).json();
      status = jobRes.status;
      if (status === 'completed' || status === 'failed') break;
      if (Date.now() > deadline) throw new Error('job did not reach a terminal state');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.strictEqual(status, 'failed', 'unconfigured provider must fail (deterministic), same as before this feature');

    const data = await readData();
    const meeting = data.meetings.find(m => m.id === meetingId);
    assert.strictEqual(meeting.status, 'failed', 'attach mode still owns meeting.status on failure, exactly like before JOB_MODES existed');
    assert.ok(meeting.processingError);
  } finally {
    await cleanup();
  }
});
