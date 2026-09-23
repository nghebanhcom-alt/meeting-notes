/* ============================================
   MeetNote AI — "refine transcript" writers (Architecture §W3/§W11/§W12)
   Pure (meeting-in, meeting-out) functions only — no file I/O, no fetch.
   server.js wires these into the job lifecycle (pumpJobQueue/runTranscriptionJob)
   and the POST /api/meetings/:id/refine-transcript route.

   Two things live here:
   1. The single-meeting (no parts) writers: applyRefineResult/markRefineRunning/
      markRefineFailed — mirror of server/meeting-parts.js's per-part writers,
      but for `meeting.refine` instead of `part.refine`.
   2. The multi-part writers: markPartRefineQueued/applyPartRefineResult/
      markPartRefineFailed, and JOB_MODES — the capability table Protocol 8.3
      asks pipeline steps to consult instead of branching on `job.mode` string
      comparisons scattered through server.js.
   ============================================ */

const { normalizePart, applyPartResult, markPartFailed, rebuildMergedMeeting } = require('./meeting-parts');

// Soniox async transcription's file-duration limit is fixed at 300 minutes
// and cannot be raised (Architecture §W9-S3) — a part longer than this on its
// own can never be refined, no matter how small the rest of the meeting is.
const MAX_REFINE_PART_SECONDS = 300 * 60;

function isoNow() {
  return new Date().toISOString();
}

function cloneSegments(segments) {
  return Array.isArray(segments) ? segments.map(segment => ({ ...segment })) : [];
}

// Sum a list of heterogeneous per-run usage objects into one display object,
// same shape/field names as server/meeting-parts.js's aggregateUsage so the
// existing Usage page (js/app.js:643-671) keeps working unmodified.
function sumUsageEntries(entries) {
  const list = (entries || []).filter(Boolean);
  if (list.length === 0) return null;
  const providers = new Set(list.map(u => u.provider));
  const models = new Set(list.map(u => u.model));
  const rates = new Set(list.map(u => u.pricingUsdPerHour));
  const costs = list.map(u => u.estimatedCostUsd);
  const allCostsNull = costs.every(cost => cost === null || cost === undefined);
  const startedTimes = list.map(u => u.startedAt).filter(Boolean).sort();
  const endedTimes = list.map(u => u.endedAt).filter(Boolean).sort();
  return {
    provider: providers.size === 1 ? [...providers][0] : 'mixed',
    model: models.size === 1 ? [...models][0] : 'mixed',
    startedAt: startedTimes[0] || null,
    endedAt: endedTimes[endedTimes.length - 1] || null,
    billableDurationSeconds: list.reduce((sum, u) => sum + (Number(u.billableDurationSeconds) || 0), 0),
    pricingUsdPerHour: rates.size === 1 ? [...rates][0] : null,
    estimatedCostUsd: allCostsNull ? null : costs.reduce((sum, cost) => sum + (Number(cost) || 0), 0),
    translationEnabled: list.some(u => Boolean(u.translationEnabled)),
    source: 'accumulated'
  };
}

// X5.4(a)/X6 — after refine replaces the transcript with an async run, its
// `Speaker N` numbering is INDEPENDENT of whatever numbering the live/previous
// batch run used (X1.8): the same key can now point at a different person.
// Rather than delete the map (destructive, no undo) or keep it as-is (X5.4(b),
// rejected — silently wrong), move it to `speakerNamesStale` so the UI can
// banner "gán lại" with the old names still there to re-apply quickly.
// Deny-by-default (X-X5/T-X5 acceptance): a meeting that never had any names
// assigned must not gain a stale banner out of nowhere.
//
// `partId` scopes this to ONE part's refine (multi-part `applyPartRefineResult`,
// composite keys `${partId}::${rawLabel}` per js/speaker-names.js) — only that
// part's entries go stale, other parts' names are untouched. Omitting `partId`
// (single-meeting `applyRefineResult`) staless the whole map.
function staleSpeakerNamesFields(meeting, partId) {
  const names = meeting.speakerNames;
  if (!names || typeof names !== 'object' || Object.keys(names).length === 0) return {};

  if (partId === undefined) {
    return { speakerNames: null, speakerNamesStale: { ...(meeting.speakerNamesStale || {}), ...names } };
  }

  const prefix = `${partId}::`;
  const staleEntries = {};
  const keptEntries = {};
  for (const [key, value] of Object.entries(names)) {
    if (key.startsWith(prefix)) staleEntries[key] = value;
    else keptEntries[key] = value;
  }
  if (Object.keys(staleEntries).length === 0) return {};
  return {
    speakerNames: Object.keys(keptEntries).length > 0 ? keptEntries : null,
    speakerNamesStale: { ...(meeting.speakerNamesStale || {}), ...staleEntries }
  };
}

/* ── Single-meeting (no parts) writers — W3.2 / W4.2 ── */

// Called by the route handler when a refine job is created (W3.2 step 3).
// Snapshots the live transcript exactly ONCE — a second refine run must not
// overwrite the ORIGINAL live snapshot with an already-refined one (WHY-W4).
function markRefineRunning(meeting, jobId) {
  const alreadySnapshotted = Array.isArray(meeting.liveTranscript);
  return {
    ...meeting,
    liveTranscript: alreadySnapshotted ? meeting.liveTranscript : cloneSegments(meeting.transcript),
    liveTranslations: alreadySnapshotted ? meeting.liveTranslations : cloneSegments(meeting.translations),
    transcriptSource: meeting.transcriptSource || 'live',
    refine: { status: 'running', jobId, startedAt: isoNow(), finishedAt: null, error: null }
  };
}

// R-W1: transcript/translations/duration/usage are UNCHANGED on failure —
// the meeting keeps whatever it had (the live transcript, on a first run).
function markRefineFailed(meeting, errorInfo) {
  return {
    ...meeting,
    refine: { ...(meeting.refine || {}), status: 'failed', finishedAt: isoNow(), error: errorInfo || null }
  };
}

// W3.2 step 5 / E-W3. `status` is deliberately left untouched (WHY-W3) — the
// recording was already usable before refine ran and stays usable after.
function applyRefineResult(meeting, result, usage) {
  const transcript = Array.isArray(result.transcript) ? result.transcript : [];
  // E-W3: an empty new `translations` (user never picked a translation
  // language for this run) must not blank out whatever translation the
  // meeting already had — keep the current value instead of overwriting.
  const newTranslations = Array.isArray(result.translations) ? result.translations : [];
  const translations = newTranslations.length > 0 ? newTranslations : (meeting.translations || []);

  const existingBreakdown = Array.isArray(meeting.usageBreakdown)
    ? meeting.usageBreakdown
    : (meeting.sonioxUsage ? [{ ...meeting.sonioxUsage, source: meeting.sonioxUsage.source || 'live-realtime' }] : []);
  const usageBreakdown = [...existingBreakdown, { ...usage, source: 'batch-refine' }];

  return {
    ...meeting,
    transcript,
    translations,
    duration: Number(result.duration) || 0,
    transcriptSource: 'batch-refined',
    refine: { ...(meeting.refine || {}), status: 'done', finishedAt: isoNow(), error: null },
    usageBreakdown,
    sonioxUsage: sumUsageEntries(usageBreakdown),
    ...staleSpeakerNamesFields(meeting)
  };
}

/* ── Multi-part writers — W11.3 / W12 / W12.1 ── */

function findPartIndex(meeting, partId) {
  return (meeting.parts || []).findIndex(part => part.partId === partId);
}

// Called by the route handler for EACH part being refined, before any job is
// created (W12.1 step 1). Snapshots `previousTranscript` — never `retryPart`
// (meeting-parts.js), which blanks `transcript` before running and would
// destroy a part's already-good result if refine then fails (G2, W10.16).
// Deliberately does NOT touch `part.status` (stays 'completed', WHY-W8) —
// the merged transcript must not blink to a "processing" gap mid-refine.
function markPartRefineQueued(meeting, partId, jobId) {
  const index = findPartIndex(meeting, partId);
  if (index < 0) return meeting;
  const parts = meeting.parts.map(normalizePart);
  const part = parts[index];
  parts[index] = {
    ...part,
    previousTranscript: cloneSegments(part.transcript),
    previousTranslations: cloneSegments(part.translations),
    refine: { status: 'running', jobId, startedAt: isoNow(), finishedAt: null, error: null }
  };
  return rebuildMergedMeeting({ ...meeting, parts });
}

// W12.1 step 5. Always ends with rebuildMergedMeeting (§V4.1 "bước nối quan
// trọng nhất") so meeting.transcript/duration/sonioxUsage/refiningParts never
// drift from parts[] (Protocol 6 bất biến #3).
function applyPartRefineResult(meeting, partId, result, usage) {
  const index = findPartIndex(meeting, partId);
  if (index < 0) return meeting;
  const parts = meeting.parts.map(normalizePart);
  const part = parts[index];
  const transcript = Array.isArray(result.transcript) ? result.transcript : [];
  const newTranslations = Array.isArray(result.translations) ? result.translations : [];
  const translations = newTranslations.length > 0 ? newTranslations : part.translations; // E-W3, same rule as single-meeting

  const existingBreakdown = Array.isArray(part.usageBreakdown) && part.usageBreakdown.length > 0
    ? part.usageBreakdown
    : (part.usage ? [part.usage] : []);
  const usageBreakdown = [...existingBreakdown, usage];

  parts[index] = {
    ...part,
    transcript,
    translations,
    transcriptSource: 'refined',
    usage, // most recent run — kept for aggregateUsage's pre-usageBreakdown fallback shape
    usageBreakdown,
    refine: { ...(part.refine || {}), status: 'done', finishedAt: isoNow(), error: null }
    // status intentionally untouched (WHY-W8)
  };
  return rebuildMergedMeeting({ ...meeting, parts, ...staleSpeakerNamesFields(meeting, partId) });
}

// W11.3: unlike markPartFailed (attach mode), this must NOT flip
// `part.status` to 'failed' and must NOT touch `part.transcript` — the part
// was already good before this refine attempt, and still is.
function markPartRefineFailed(meeting, partId, errorInfo) {
  const index = findPartIndex(meeting, partId);
  if (index < 0) return meeting;
  const parts = meeting.parts.map(normalizePart);
  parts[index] = {
    ...parts[index],
    refine: { ...(parts[index].refine || {}), status: 'failed', finishedAt: isoNow(), error: errorInfo || null }
  };
  return rebuildMergedMeeting({ ...meeting, parts });
}

/* ── Protocol 8.3 capability table ──
   server.js's job-lifecycle functions (pumpJobQueue/runTranscriptionJob/
   recoverInterruptedJobs/sweepStuckJobs) ask this table instead of writing
   `if (job.mode === 'refine')` at each call site. A job with no `mode` (every
   job created before this feature, and every 'attach' job) resolves to
   JOB_MODES.attach — byte-for-byte the pre-existing behavior. */
const JOB_MODES = {
  attach: {
    ownsMeetingStatus: true,
    ownsPartStatus: true,
    usage: 'replace',
    writePartSuccess: applyPartResult,
    writePartFailure: markPartFailed
    // No writeSingleSuccess/writeSingleFailure here on purpose: the
    // single-meeting 'attach' path predates JOB_MODES and is file I/O
    // (mergeTranscriptionIntoMeeting in server.js), not a pure meeting
    // transform — server.js keeps calling it directly when partId is absent
    // and the resolved mode has no writeSingleSuccess.
  },
  refine: {
    ownsMeetingStatus: false,
    ownsPartStatus: false,
    usage: 'accumulate',
    writeSingleSuccess: applyRefineResult,
    writeSingleFailure: markRefineFailed,
    writePartSuccess: applyPartRefineResult,
    writePartFailure: markPartRefineFailed
  }
};

function modeFor(job) {
  return JOB_MODES[job && job.mode] || JOB_MODES.attach;
}

module.exports = {
  MAX_REFINE_PART_SECONDS,
  markRefineRunning,
  markRefineFailed,
  applyRefineResult,
  markPartRefineQueued,
  applyPartRefineResult,
  markPartRefineFailed,
  JOB_MODES,
  modeFor
};
