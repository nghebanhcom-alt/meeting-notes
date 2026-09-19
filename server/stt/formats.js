/* ============================================
   MeetNote AI — STT audio format capability table
   Single source for "which audio extension does provider X
   accept": both the pre-flight hint the client shows before
   upload and the server-side enforcement in this module read
   the exact same tables (Architecture v3.0 §V7, BR-79/82/84/141).

   `encodingForMime` here is not just reporting metadata — it is
   the literal function server/stt/providers/google.js calls to
   decide whether to reject an upload, so the "rejected" list
   below is DERIVED from it, not hand-typed (BR-141: the table
   sent to the client cannot silently drift from what the server
   enforces).
   ============================================ */

// Extension → a representative Content-Type, used to (a) resolve a browser's
// missing/octet-stream Content-Type on upload (resolveAudioMime) and (b)
// probe each provider's real format-acceptance function/table below.
const EXTENSION_MIME = {
  aac: 'audio/aac',
  aiff: 'audio/aiff',
  amr: 'audio/amr',
  asf: 'audio/x-ms-asf',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm'
};

// Google Speech-to-Text `RecognitionConfig.encoding` per container (verified
// against Google's REST reference, Architecture §V12.2). Kept here — not
// duplicated in google.js — so the enforcement function and the capability
// table below can never disagree (BR-141).
const MIME_ENCODINGS = {
  webm: 'WEBM_OPUS',
  ogg: 'OGG_OPUS',
  mpeg: 'MP3',
  mp3: 'MP3',
  wav: 'LINEAR16',
  flac: 'FLAC'
};

// Same behavior as the pre-v3.0 `encodingForMime` in google.js: null means
// Google's inline-audio API does not accept this container (m4a/mp4/aac/...).
function encodingForMime(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  for (const needle of Object.keys(MIME_ENCODINGS)) {
    if (type.includes(needle)) return MIME_ENCODINGS[needle];
  }
  return null;
}

// Google's accepted/rejected extensions are computed by running every known
// extension's representative mime through the SAME function google.js calls
// at transcribe time (Architecture §V7.1: "rejected của Google sinh ra từ
// chính encodingForMime()").
function computeGoogleFormats() {
  const accepted = [];
  const rejected = [];
  for (const extension of Object.keys(EXTENSION_MIME)) {
    (encodingForMime(EXTENSION_MIME[extension]) ? accepted : rejected).push(extension);
  }
  return { accepted, legacy: [], rejected, sourceVerified: true };
}

// Soniox/Deepgram/OpenAI Whisper have no format-checking code of their own
// today (they hand the file straight to the provider) — there is nothing to
// derive these three from, so they are declared data, sourced from each
// provider's official docs fetched in this session (Architecture §V12.2).
// `legacy` = extensions the app already sends this provider with no doc
// confirmation either way; kept accepted so v3.0 never rejects something
// that worked yesterday (BR-84/WHY-V7).
const PROVIDER_FORMATS = {
  soniox: {
    accepted: ['aac', 'aiff', 'amr', 'asf', 'flac', 'mp3', 'ogg', 'wav', 'webm'],
    legacy: ['m4a', 'mp4'],
    rejected: [],
    sourceVerified: true
  },
  deepgram: {
    accepted: ['aac', 'flac', 'm4a', 'mp3', 'mp4', 'ogg', 'wav', 'webm'],
    legacy: ['aiff', 'amr', 'asf'],
    rejected: [],
    sourceVerified: true
  },
  whisper: {
    accepted: ['m4a', 'mp3', 'mp4', 'wav', 'webm'],
    legacy: ['aac', 'aiff', 'amr', 'asf', 'flac', 'ogg'],
    rejected: [],
    sourceVerified: true
  },
  google: computeGoogleFormats()
};

// Union of every provider's accepted+legacy extensions — the full set the app
// UI will let a user pick at all (BR-79). An extension only ever appearing in
// some provider's `rejected` column still belongs here if another provider
// takes it (m4a/mp4 are Google-rejected but Deepgram/Whisper-accepted).
const APP_ACCEPTED_EXTENSIONS = Object.keys(EXTENSION_MIME)
  .filter(extension => Object.values(PROVIDER_FORMATS).some(table =>
    table.accepted.includes(extension) || table.legacy.includes(extension)))
  .sort();

function extensionOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : '';
}

// 'accepted' | 'legacy' | 'rejected' | 'unknown' — see Architecture §V7.1 for
// what each status means to pre-flight vs. server enforcement.
function statusFor(providerId, extension) {
  const table = PROVIDER_FORMATS[providerId];
  const ext = String(extension || '').toLowerCase();
  if (!table || !ext) return 'unknown';
  if (table.accepted.includes(ext)) return 'accepted';
  if (table.legacy.includes(ext)) return 'legacy';
  if (table.rejected.includes(ext)) return 'rejected';
  return 'unknown';
}

// Browsers send an empty or generic Content-Type for several containers
// (.amr, .asf, sometimes .m4a) — falling back to the header alone would make
// Google reject a perfectly valid .wav upload just because of a missing
// header (Architecture §V7.1).
function resolveAudioMime(headerContentType, filename) {
  const header = String(headerContentType || '').trim();
  const headerLower = header.toLowerCase();
  if (header && headerLower !== 'application/octet-stream') return header;
  const fromExtension = EXTENSION_MIME[extensionOf(filename)];
  return fromExtension || header || 'application/octet-stream';
}

module.exports = {
  EXTENSION_MIME,
  MIME_ENCODINGS,
  encodingForMime,
  PROVIDER_FORMATS,
  APP_ACCEPTED_EXTENSIONS,
  extensionOf,
  statusFor,
  resolveAudioMime
};
