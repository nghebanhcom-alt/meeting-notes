/* ============================================
   MeetNote AI — multi-part meeting model (R-Z, Architecture v3.0 §V3/§V4)
   Owns everything about `meeting.parts[]`: normalizing a part, deciding
   what a merged meeting's derived fields (transcript/duration/status/usage)
   are, and the PUT /api/meetings field-ownership rules (§V3.6, R-R) that
   stop a stale browser snapshot from clobbering server-owned data.
   Pure data transforms — no file I/O, no fetch. server.js wires this into
   the actual routes/job lifecycle.
   ============================================ */

const { computeTimeline, buildMergedTranscript } = require('./stt/merge');

const MAX_PARTS_PER_MEETING = 10;
const PART_STATUSES = new Set(['queued', 'processing', 'completed', 'failed', 'dropped']);
const DURATION_KINDS = new Set(['audio-length', 'speech-end', 'none']);
// BR-111: the only thing a partId is ever used for besides this validation is
// as the input to the SAME sha256(id) audio path a meetingId already uses
// (server.js `audioKey`) — never concatenated into a filesystem path.
const PART_ID_PATTERN = /^part-[a-z0-9-]{8,64}$/;

function isValidPartId(value) {
  return typeof value === 'string' && PART_ID_PATTERN.test(value);
}

function clampString(value, maxLength, fallback = '') {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function clampNonNegativeInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.round(num)) : fallback;
}

// `null`/`undefined` MUST stay `null` — not fall into `Number(null) === 0`.
// Re-running normalizePart on an already-normalized part (every route does
// this defensively) would otherwise silently turn "unknown duration" into
// "zero-second duration" on its second pass.
function clampNullableNonNegativeNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function normalizeTranscriptSegment(segment) {
  return {
    time: Number.isFinite(Number(segment?.time)) ? Math.max(0, Number(segment.time)) : 0,
    speaker: clampString(segment?.speaker, 200, 'Speaker'),
    text: clampString(segment?.text, 20000),
    language: clampString(segment?.language, 20)
  };
}

// Defensive re-normalization of a stored/incoming part-shaped object (§V3.2).
// Anything server-computed (spanSeconds/offsetSeconds/status/transcript
// content) is preserved as given here — computing those is rebuildMergedMeeting's
// job, not this function's.
function normalizePart(raw) {
  const part = raw && typeof raw === 'object' ? raw : {};
  return {
    partId: isValidPartId(part.partId) ? part.partId : '',
    order: Number.isFinite(Number(part.order)) ? Math.max(1, Math.round(Number(part.order))) : 1,
    filename: clampString(part.filename, 255),
    sizeBytes: clampNonNegativeInt(part.sizeBytes, 0),
    clientDurationSeconds: clampNullableNonNegativeNumber(part.clientDurationSeconds),
    status: PART_STATUSES.has(part.status) ? part.status : 'queued',
    jobId: clampString(part.jobId, 100),
    error: part.error && typeof part.error === 'object'
      ? { code: clampString(part.error.code, 100), message: clampString(part.error.message, 2000) }
      : null,
    provider: clampString(part.provider, 40),
    model: clampString(part.model, 100),
    language: clampString(part.language, 20, 'auto') || 'auto',
    translationLanguage: clampString(part.translationLanguage, 20),
    transcript: Array.isArray(part.transcript) ? part.transcript.slice(0, 50000).map(normalizeTranscriptSegment) : [],
    translations: Array.isArray(part.translations) ? part.translations.slice(0, 50000).map(normalizeTranscriptSegment) : [],
    duration: clampNonNegativeInt(part.duration, 0),
    durationKind: DURATION_KINDS.has(part.durationKind) ? part.durationKind : 'unknown',
    spanSeconds: Number.isFinite(Number(part.spanSeconds)) ? Math.max(0, Number(part.spanSeconds)) : 0,
    offsetSeconds: Number.isFinite(Number(part.offsetSeconds)) ? Math.max(0, Number(part.offsetSeconds)) : 0,
    usage: part.usage && typeof part.usage === 'object' ? part.usage : null,
    addedAt: clampString(part.addedAt, 64) || new Date().toISOString()
  };
}

// A brand-new part registered through POST /api/meetings/:id/parts (§V6.2).
// Only the fields the client can legitimately know about a file it just
// picked go here; everything transcription-related starts empty/queued.
function buildRegisteredPart(input, order) {
  return normalizePart({
    partId: input.partId,
    order,
    filename: input.filename,
    sizeBytes: input.sizeBytes,
    clientDurationSeconds: input.clientDurationSeconds,
    status: 'queued',
    jobId: input.jobId,
    provider: input.provider,
    model: input.model,
    language: input.language || 'auto',
    translationLanguage: input.translationLanguage,
    addedAt: new Date().toISOString()
  });
}

// Protocol 8.3: pipeline steps ask this instead of branching on
// `meeting.source === 'import'` or similar. Anything not listed here behaves
// exactly like today because `hasParts` is false for every meeting that
// existed before this feature shipped (R-Z backward compatibility).
function meetingCapabilities(meeting) {
  const hasParts = Array.isArray(meeting?.parts) && meeting.parts.length > 0;
  const missingParts = Array.isArray(meeting?.missingParts) ? meeting.missingParts : [];
  return {
    multiPart: hasParts,
    singleAudioPlayback: !hasParts,
    inlineTranscriptEdit: true,
    durationIsAudioLength: !meeting?.durationEstimated,
    qualityWarningEligible: !meeting?.durationEstimated,
    summaryNeedsMissingPartConfirm: hasParts && missingParts.length > 0
  };
}

function overallStatus(parts) {
  if (parts.some(part => part.status === 'queued' || part.status === 'processing')) return 'processing';
  if (parts.every(part => part.status === 'completed')) return 'completed';
  if (parts.every(part => part.status === 'failed')) return 'failed';
  return 'completed'; // mix of completed + failed/dropped (BR-132)
}

// V3.4 — sonioxUsage becomes a SUM across completed parts. Field name is kept
// (not renamed) because every existing UI reads `meeting.sonioxUsage`
// (js/app.js:368,611,1385).
function aggregateUsage(parts) {
  const counted = parts.filter(part => part.status === 'completed' && part.usage);
  if (counted.length === 0) return null;

  const providers = new Set(counted.map(part => part.usage.provider));
  const models = new Set(counted.map(part => part.usage.model));
  const rates = new Set(counted.map(part => part.usage.pricingUsdPerHour));
  const costs = counted.map(part => part.usage.estimatedCostUsd);
  const allCostsNull = costs.every(cost => cost === null || cost === undefined);
  const startedTimes = counted.map(part => part.usage.startedAt).filter(Boolean).sort();
  const endedTimes = counted.map(part => part.usage.endedAt).filter(Boolean).sort();

  return {
    provider: providers.size === 1 ? [...providers][0] : 'mixed',
    model: models.size === 1 ? [...models][0] : 'mixed',
    startedAt: startedTimes[0] || null,
    endedAt: endedTimes[endedTimes.length - 1] || null,
    billableDurationSeconds: counted.reduce((sum, part) => sum + (Number(part.usage.billableDurationSeconds) || 0), 0),
    pricingUsdPerHour: rates.size === 1 ? [...rates][0] : null,
    estimatedCostUsd: allCostsNull ? null : costs.reduce((sum, cost) => sum + (Number(cost) || 0), 0),
    translationEnabled: counted.some(part => Boolean(part.usage.translationEnabled)),
    source: 'file-upload',
    partCount: parts.length,
    partsCounted: counted.length
  };
}

// The one function every part-mutating operation ends with (§V4.1 diagram —
// "BƯỚC NỐI QUAN TRỌNG NHẤT"). Never partially update transcript/duration/
// status by hand elsewhere; always go through here so they can't drift.
function rebuildMergedMeeting(meeting) {
  const parts = Array.isArray(meeting?.parts) ? meeting.parts.map(normalizePart) : [];
  if (parts.length === 0) return meeting;

  const timed = computeTimeline(parts);
  const merged = buildMergedTranscript(timed);

  return {
    ...meeting,
    parts: timed,
    transcript: merged.transcript,
    translations: merged.translations,
    duration: merged.duration,
    durationEstimated: merged.durationEstimated,
    missingParts: merged.missingParts,
    sonioxUsage: aggregateUsage(timed),
    status: overallStatus(timed)
  };
}

function findPartIndex(meeting, partId) {
  return (meeting.parts || []).findIndex(part => part.partId === partId);
}

// M3 — register N new parts (import or "add part to an existing merged
// meeting", Q9) and hand back the rebuilt meeting. Job creation itself is
// server.js's job (jobs.json is a different file with its own mutation
// queue); this only ever touches `meeting.parts`.
function registerParts(meeting, rawParts, sttConfig) {
  const current = Array.isArray(meeting.parts) ? meeting.parts.map(normalizePart) : [];
  if (current.length + rawParts.length > MAX_PARTS_PER_MEETING) {
    throw Object.assign(new Error(`A meeting can have at most ${MAX_PARTS_PER_MEETING} parts.`), { statusCode: 400, code: 'PARTS_LIMIT_EXCEEDED' });
  }
  let nextOrder = current.reduce((max, part) => Math.max(max, part.order), 0) + 1;
  const created = rawParts.map(raw => {
    const part = buildRegisteredPart({ ...raw, ...sttConfig }, nextOrder);
    nextOrder += 1;
    return part;
  });
  const meetingWithParts = { ...meeting, parts: [...current, ...created] };
  return { meeting: rebuildMergedMeeting(meetingWithParts), createdParts: created };
}

// M7 — write one job's STT result onto its part, then rebuild (§V4.2).
function applyPartResult(meeting, partId, result) {
  const index = findPartIndex(meeting, partId);
  if (index < 0) return meeting;
  const parts = meeting.parts.map(normalizePart);
  parts[index] = {
    ...parts[index],
    status: 'completed',
    error: null,
    transcript: Array.isArray(result.transcript) ? result.transcript : [],
    translations: Array.isArray(result.translations) ? result.translations : [],
    duration: clampNonNegativeInt(result.duration, 0),
    durationKind: DURATION_KINDS.has(result.durationKind) ? result.durationKind : 'unknown',
    provider: result.provider || parts[index].provider,
    model: result.model || parts[index].model,
    usage: result.usage || null
  };
  return rebuildMergedMeeting({ ...meeting, parts });
}

function markPartFailed(meeting, partId, errorInfo) {
  const index = findPartIndex(meeting, partId);
  if (index < 0) return meeting;
  const parts = meeting.parts.map(normalizePart);
  parts[index] = { ...parts[index], status: 'failed', error: errorInfo || null };
  return rebuildMergedMeeting({ ...meeting, parts });
}

// BR-133/BR-136 — re-run exactly one part. Only ever touches that part: no
// other part's transcript/job is created or altered (test in
// test/parts-routes.test.js counts `stt.transcribe` calls to prove this).
function retryPart(meeting, partId, overrides = {}) {
  const index = findPartIndex(meeting, partId);
  if (index < 0) {
    throw Object.assign(new Error('Part not found'), { statusCode: 404, code: 'PART_NOT_FOUND' });
  }
  const parts = meeting.parts.map(normalizePart);
  const current = parts[index];
  if (current.status === 'queued' || current.status === 'processing') {
    throw Object.assign(new Error('This part is already running'), { statusCode: 409, code: 'PART_ALREADY_RUNNING' });
  }
  parts[index] = {
    ...current,
    status: 'queued',
    error: null,
    transcript: [],
    translations: [],
    provider: overrides.provider || current.provider,
    model: overrides.model || current.model,
    language: overrides.language || current.language,
    translationLanguage: overrides.translationLanguage !== undefined ? overrides.translationLanguage : current.translationLanguage
  };
  return rebuildMergedMeeting({ ...meeting, parts });
}

function markPartRunning(meeting, partId, jobId) {
  const index = findPartIndex(meeting, partId);
  if (index < 0) return meeting;
  const parts = meeting.parts.map(normalizePart);
  parts[index] = { ...parts[index], status: 'processing', jobId: jobId || parts[index].jobId, error: null };
  return rebuildMergedMeeting({ ...meeting, parts });
}

// FAI-07/BR-103/BR-134 — audio is NEVER removed here, only the part's status.
function dropPart(meeting, partId) {
  const index = findPartIndex(meeting, partId);
  if (index < 0) {
    throw Object.assign(new Error('Part not found'), { statusCode: 404, code: 'PART_NOT_FOUND' });
  }
  const parts = meeting.parts.map(normalizePart);
  parts[index] = { ...parts[index], status: 'dropped' };
  return rebuildMergedMeeting({ ...meeting, parts });
}

// BR-119/BR-121 — `orderedPartIds` must be a full permutation of the meeting's
// current part ids; anything else is rejected untouched (400 upstream).
function reorderParts(meeting, orderedPartIds) {
  const current = (meeting.parts || []).map(normalizePart);
  const currentIds = new Set(current.map(part => part.partId));
  const incomingIds = new Set(orderedPartIds);
  const isPermutation = orderedPartIds.length === current.length &&
    incomingIds.size === current.length &&
    [...incomingIds].every(id => currentIds.has(id));
  if (!isPermutation) {
    throw Object.assign(new Error('order must be a permutation of the meeting\'s current parts'), { statusCode: 400, code: 'PARTS_ORDER_INVALID' });
  }
  const byId = new Map(current.map(part => [part.partId, part]));
  const parts = orderedPartIds.map((partId, i) => ({ ...byId.get(partId), order: i + 1 }));
  return rebuildMergedMeeting({ ...meeting, parts });
}

// §V3.6 — a transcript segment's identity for edit-matching purposes: which
// part it came from + its index within that part's OWN raw transcript. Divider/
// gap segments have no `srcIndex` and are intentionally never editable.
function segmentKey(segment) {
  return `${segment?.partId || ''}#${Number.isInteger(segment?.srcIndex) ? segment.srcIndex : ''}`;
}

// §V3.6 "Áp edit transcript về đúng phần". Returns `meeting` UNCHANGED when the
// incoming transcript's shape doesn't match the derived one 1:1 (stale
// snapshot) — never partially applies a structural mismatch.
function applyTranscriptEdits(meeting, incomingTranscript) {
  const currentTranscript = Array.isArray(meeting.transcript) ? meeting.transcript : [];
  const incoming = Array.isArray(incomingTranscript) ? incomingTranscript : [];
  if (incoming.length !== currentTranscript.length) return meeting;
  for (let i = 0; i < currentTranscript.length; i += 1) {
    if (segmentKey(incoming[i]) !== segmentKey(currentTranscript[i])) return meeting;
  }

  const parts = (meeting.parts || []).map(part => ({
    ...normalizePart(part),
    transcript: part.transcript.map(segment => ({ ...segment }))
  }));
  const partsById = new Map(parts.map(part => [part.partId, part]));
  let changed = false;

  currentTranscript.forEach((segment, i) => {
    if (segment.kind === 'part-divider' || segment.kind === 'part-gap') return;
    const part = partsById.get(segment.partId);
    if (!part || !Number.isInteger(segment.srcIndex) || !part.transcript[segment.srcIndex]) return;
    const incomingText = typeof incoming[i]?.text === 'string' ? incoming[i].text : part.transcript[segment.srcIndex].text;
    if (incomingText !== part.transcript[segment.srcIndex].text) {
      part.transcript[segment.srcIndex].text = incomingText;
      changed = true;
    }
  });

  return changed ? rebuildMergedMeeting({ ...meeting, parts }) : meeting;
}

// §V3.6 (R-R) — called from PUT /api/meetings for every meeting whose
// SERVER-SIDE copy already has parts, regardless of what status the client
// sends. `parts`/duration/status/etc are server-owned; transcript edits are
// applied field-by-field instead of accepted wholesale.
const SERVER_OWNED_STATIC_FIELDS = ['duration', 'durationEstimated', 'missingParts', 'sonioxUsage', 'status', 'processingError', '_activeJobId'];

function preserveServerOwnedFields(current, incoming) {
  if (!current || !Array.isArray(current.parts) || current.parts.length === 0) return incoming;
  const withEdits = applyTranscriptEdits(current, incoming?.transcript);
  const merged = { ...incoming, parts: withEdits.parts, transcript: withEdits.transcript, translations: withEdits.translations };
  for (const field of SERVER_OWNED_STATIC_FIELDS) merged[field] = withEdits[field];
  return merged;
}

module.exports = {
  MAX_PARTS_PER_MEETING,
  PART_ID_PATTERN,
  isValidPartId,
  normalizePart,
  buildRegisteredPart,
  meetingCapabilities,
  aggregateUsage,
  overallStatus,
  rebuildMergedMeeting,
  registerParts,
  applyPartResult,
  markPartFailed,
  markPartRunning,
  retryPart,
  dropPart,
  reorderParts,
  applyTranscriptEdits,
  preserveServerOwnedFields
};
