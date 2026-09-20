/* ============================================
   MeetNote AI — Import pre-flight (TV9, Architecture v3.0 §V7.2)
   Pure functions, no DOM/fetch — dual-mode like js/meeting-types.js so
   `node --test` can exercise them directly.

   `classify(file, providerId, providersPayload)` answers ONE question:
   "does the currently selected provider accept this one file?" — it does
   NOT decide which of the 3 UX copy variants (B1/B2/B3) to show; that
   depends on which OTHER configured providers could take the file, which
   lives in the returned `alternatives` array. The renderer (js/import.js)
   combines `code`/`microcopyId` (the main reason line) with a second line
   picked from `alternatives`:
     - alternatives.some(a => a.ready)  -> B1 (ERR-03/03b, "Dùng X cho lần này")
     - alternatives.length > 0 (none ready) -> B2 (ERR-05/06, "Mở Cài đặt")
     - alternatives.length === 0             -> B3 (ERR-13)

   `providersPayload` is the exact object `GET /api/stt/providers` returns
   (BR-141: appAcceptedExtensions + providers[].formats/maxUploadBytes are the
   ONE source of truth this module reads — no second, hand-typed copy of any
   extension list or size limit lives here).
   ============================================ */

function extensionOf(filename) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : '';
}

// Mirrors server/stt/formats.js `statusFor`, but reads the CLIENT's copy of
// the table (providersPayload, itself sourced from the server) — never a
// separate hardcoded list (BR-141).
function formatStatusFromPayload(providerEntry, extension) {
  const formats = providerEntry && providerEntry.formats;
  if (!formats || !extension) return 'unknown';
  if (Array.isArray(formats.accepted) && formats.accepted.includes(extension)) return 'accepted';
  if (Array.isArray(formats.legacy) && formats.legacy.includes(extension)) return 'legacy';
  if (Array.isArray(formats.rejected) && formats.rejected.includes(extension)) return 'rejected';
  return 'unknown';
}

// Every OTHER configured provider that can take this file, format AND size
// (BR-85/86). `ready` distinguishes "usable right now" (B1) from "would take
// it but has no API key yet" (B2) — never filtered out here, the renderer
// decides what to show from the list shape.
function buildAlternatives(providers, excludeProviderId, extension, sizeBytes) {
  return providers
    .filter(provider => provider.id !== excludeProviderId)
    .filter(provider => {
      const status = formatStatusFromPayload(provider, extension);
      if (status === 'rejected' || status === 'unknown') return false;
      if (provider.maxUploadBytes && sizeBytes > provider.maxUploadBytes) return false;
      return true;
    })
    .map(provider => ({ id: provider.id, name: provider.name, ready: Boolean(provider.available) }));
}

/**
 * @param {{name:string,size:number}} file duck-typed File
 * @param {string} providerId currently selected provider for this import
 * @param {object|null} providersPayload GET /api/stt/providers response, or
 *   null/undefined when it could not be fetched (BR-142: fail-open, never
 *   fail-closed — a flaky localhost request must not block import entirely).
 * @returns {{level:'blockA'|'blockB'|'ok', code:string, extension:string,
 *   sizeBytes:number, provider:object|null, alternatives:Array,
 *   preflightUnavailable:boolean, microcopyId:string|null}}
 */
function classify(file, providerId, providersPayload) {
  const name = (file && file.name) || '';
  const sizeBytes = Number(file && file.size) || 0;
  const extension = extensionOf(name);

  // BR-142: no data to check against — do not block, flag it instead.
  if (!providersPayload || !Array.isArray(providersPayload.providers)) {
    return {
      level: 'ok', code: 'ok', extension, sizeBytes, provider: null,
      alternatives: [], preflightUnavailable: true, microcopyId: null
    };
  }

  const appAcceptedExtensions = Array.isArray(providersPayload.appAcceptedExtensions)
    ? providersPayload.appAcceptedExtensions : [];
  const providers = providersPayload.providers;
  const selected = providers.find(provider => provider.id === providerId) || null;

  // BR-83: empty/unreadable file — a hard, non-recoverable block regardless
  // of provider (ERR-04). Checked before format/size since a 0-byte file
  // cannot even be format-checked meaningfully.
  if (sizeBytes <= 0) {
    return {
      level: 'blockA', code: 'EMPTY_FILE', extension, sizeBytes, provider: selected,
      alternatives: [], preflightUnavailable: false, microcopyId: 'ERR-04'
    };
  }

  // BR-79/80: extension outside the app's own union — a dead end in this
  // app no matter which provider is selected (ERR-01).
  if (!extension || !appAcceptedExtensions.includes(extension)) {
    return {
      level: 'blockA', code: 'EXT_UNSUPPORTED', extension, sizeBytes, provider: selected,
      alternatives: [], preflightUnavailable: false, microcopyId: 'ERR-01',
      appAcceptedExtensions
    };
  }

  if (selected) {
    const status = formatStatusFromPayload(selected, extension);
    if (status === 'rejected' || status === 'unknown') {
      return {
        level: 'blockB', code: 'PROVIDER_REJECTS_FORMAT', extension, sizeBytes, provider: selected,
        alternatives: buildAlternatives(providers, selected.id, extension, sizeBytes),
        preflightUnavailable: false, microcopyId: 'ERR-02b'
      };
    }
    if (selected.maxUploadBytes && sizeBytes > selected.maxUploadBytes) {
      return {
        level: 'blockB', code: 'TOO_LARGE_FOR_PROVIDER', extension, sizeBytes, provider: selected,
        alternatives: buildAlternatives(providers, selected.id, extension, sizeBytes),
        // E-V2 (Architecture.md §V15, not yet PM/UX-approved): ERR-02's exact
        // wording ("OpenAI Whisper chỉ nhận tối đa 25 MB") is only literally
        // true for Whisper — the other 3 providers' limits are MeetNote's own,
        // not a vendor commitment. Flagging via a distinct id rather than
        // silently reusing ERR-02's Whisper-specific wording for every
        // provider (see Dev report to PM).
        preflightUnavailable: false, microcopyId: selected.id === 'whisper' ? 'ERR-02' : 'ERR-02-app-limit'
      };
    }
  }

  return {
    level: 'ok', code: 'ok', extension, sizeBytes, provider: selected,
    alternatives: [], preflightUnavailable: false, microcopyId: null
  };
}

// BR-109/BR-139.2: a file matching an EXISTING meeting's saved source file
// (name + byte size, never content hashing — zero-dependency, files can be
// huge). For a merged meeting, `sourceFilename`/`sourceSizeBytes` only ever
// hold PART 1's values (BR-137) — so part 2+ must be checked against
// `meeting.parts[]` too, or a duplicate of a later part silently passes
// (BUG-002). Returns the matching meeting or null.
function findDuplicateMeeting(file, existingMeetings) {
  const name = (file && file.name) || '';
  const sizeBytes = Number(file && file.size) || 0;
  if (!name) return null;
  return (existingMeetings || []).find(meeting => {
    if (!meeting) return false;
    if (meeting.sourceFilename === name && Number(meeting.sourceSizeBytes) === sizeBytes) return true;
    return (meeting.parts || []).some(part =>
      part && part.filename === name && Number(part.sizeBytes) === sizeBytes);
  }) || null;
}

// BR-139.1: two files picked in the SAME batch with identical name+size —
// likely the same file selected twice by mistake.
function findDuplicateInBatch(file, otherFiles) {
  const name = (file && file.name) || '';
  const sizeBytes = Number(file && file.size) || 0;
  return (otherFiles || []).some(other =>
    other !== file && (other && other.name) === name && (Number(other && other.size) || 0) === sizeBytes);
}

// BR-88: at most 10 files accepted per import action; the rest must be
// reported, never silently dropped.
function capImportBatch(fileList, maxFiles = 10) {
  const files = Array.from(fileList || []);
  return { accepted: files.slice(0, maxFiles), rejectedCount: Math.max(0, files.length - maxFiles) };
}

// Vietnamese decimal-comma MB formatting (UX §6 quy ước: "58,4 MB").
function formatMbVi(bytes) {
  const mb = Number(bytes) / (1024 * 1024);
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `${String(rounded).replace('.', ',')} MB`;
}

const ImportPreflight = {
  extensionOf, classify, findDuplicateMeeting, findDuplicateInBatch, capImportBatch, formatMbVi
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImportPreflight;
}
