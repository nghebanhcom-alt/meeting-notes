/* ============================================
   MeetNote AI — Multi-part meeting client helpers (TV11/TV12/TV13/TV18,
   Architecture v3.0 §V8.2, §V11). Pure functions only, no DOM/fetch — dual
   mode like js/meeting-types.js/js/tags.js so `node --test` can exercise
   them directly. Rendering (HTML strings, Utils.escapeHtml) stays in
   js/app.js, same convention as tags.js/meeting-types.js.
   ============================================ */

// Client-side mirror of server/meeting-parts.js `meetingCapabilities`
// (Protocol 8.3). Deliberately re-implemented rather than shared via a
// require() — this file runs in the browser with no bundler, and the
// server module only ever needs the 3 fields already present on any
// meeting object the client already has from GET /api/data
// (`parts`, `missingParts`, `durationEstimated`). Keep in sync by hand if
// server/meeting-parts.js's meetingCapabilities changes.
function meetingCapabilities(meeting) {
  const hasParts = Array.isArray(meeting && meeting.parts) && meeting.parts.length > 0;
  const missingParts = Array.isArray(meeting && meeting.missingParts) ? meeting.missingParts : [];
  return {
    multiPart: hasParts,
    singleAudioPlayback: !hasParts,
    inlineTranscriptEdit: true,
    durationIsAudioLength: !(meeting && meeting.durationEstimated),
    qualityWarningEligible: !(meeting && meeting.durationEstimated),
    summaryNeedsMissingPartConfirm: hasParts && missingParts.length > 0
  };
}

// BR-119 step 1: split into [text, number, text, ...] tokens, compare
// numeric tokens by value and text tokens with Vietnamese collation.
function tokenize(value) {
  return String(value || '').match(/(\d+|\D+)/g) || [];
}

function naturalCompare(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i += 1) {
    const xa = ta[i];
    const xb = tb[i];
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    const numericA = /^\d+$/.test(xa);
    const numericB = /^\d+$/.test(xb);
    if (numericA && numericB) {
      const diff = Number(xa) - Number(xb);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else {
      const cmp = xa.localeCompare(xb, 'vi', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

// BR-119: suggest an initial part order, in priority order:
//   1. Natural sort by filename, IF at least one filename contains a digit
//      AND that sort actually distinguishes every file (no ties) — a tie
//      means natural sort cannot tell two files apart, so it would not be a
//      meaningful basis for ordering.
//   2. `lastModified`, IF every file's timestamp differs from its neighbors
//      by at least 1 second once sorted (otherwise the signal is too weak
//      to trust — R-O, `[UNVERIFIED]` reliability of lastModified after
//      AirDrop/Drive/Zalo).
//   3. The order the user originally picked the files in.
// @param {Array<{name:string,lastModified:number}>} files in ORIGINAL
//   selection order.
// @returns {{order:Array<number>, method:'name'|'lastModified'|'original'}}
//   `order` is a permutation of [0..files.length-1] in SUGGESTED order.
function suggestPartOrder(files) {
  const list = Array.isArray(files) ? files : [];
  const indices = list.map((_, i) => i);
  if (list.length <= 1) return { order: indices, method: 'original' };

  // Strip the extension before checking for a digit — otherwise every plain
  // .m4a/.mp4 file would "contain a digit" from its own extension and
  // trigger natural-name sorting even for files with no real numbering
  // (e.g. "ghi-am-chieu.m4a" has no meaningful number, but "m4a" does).
  const basename = name => String(name || '').replace(/\.[a-zA-Z0-9]+$/, '');
  const hasDigit = list.some(file => /\d/.test(basename(file && file.name)));
  const byName = [...indices].sort((a, b) => naturalCompare(list[a].name, list[b].name));
  const namesDistinguish = byName.every((idx, pos) =>
    pos === 0 || naturalCompare(list[byName[pos - 1]].name, list[idx].name) !== 0);
  if (hasDigit && namesDistinguish) {
    return { order: byName, method: 'name' };
  }

  const times = list.map(file => Number(file && file.lastModified) || 0);
  const sortedTimes = [...times].sort((a, b) => a - b);
  const timesDistinguish = sortedTimes.every((t, i) => i === 0 || (t - sortedTimes[i - 1]) >= 1000);
  if (timesDistinguish) {
    const byTime = [...indices].sort((a, b) => times[a] - times[b]);
    return { order: byTime, method: 'lastModified' };
  }

  return { order: indices, method: 'original' };
}

// Soft, non-blocking gap hint between two CONSECUTIVE parts in the confirmed
// order (MRG-15/ERR-10/ERR-11). `prev`/`next` are the same file-shaped
// objects `suggestPartOrder` takes, plus `clientDurationSeconds` (from the
// §V8.3 feature-detected audio duration, may be null). Approximates each
// file's `lastModified` as roughly "when that recording finished" — this is
// a heuristic on top of an already-`[UNVERIFIED]` signal (R-O), so it is
// ONLY ever a soft warning, never a block.
function gapWarningSeconds(prev, next) {
  const prevEnd = Number(prev && prev.lastModified) || 0;
  const nextEnd = Number(next && next.lastModified) || 0;
  if (!prevEnd || !nextEnd) return null;
  const prevDuration = Number(prev && prev.clientDurationSeconds) || 0;
  const prevStartApprox = prevEnd - prevDuration * 1000;
  return (nextEnd - prevStartApprox - prevDuration * 1000) / 1000;
}

const GAP_LARGE_SECONDS = 2 * 3600; // ERR-11

function classifyGap(gapSeconds) {
  if (gapSeconds === null || gapSeconds === undefined) return 'unknown';
  if (gapSeconds < 0) return 'negative'; // ERR-10
  if (gapSeconds > GAP_LARGE_SECONDS) return 'large'; // ERR-11
  return 'normal'; // MRG-15, informational only
}

// BR-106 — quality warning is a measured signal (words/min), not a guess.
// Caller MUST gate this behind `meetingCapabilities(meeting).qualityWarningEligible`
// (BR-128: a durationEstimated recording's denominator is not trustworthy).
const QUALITY_MIN_DURATION_SECONDS = 5 * 60;
const QUALITY_MIN_WORDS_PER_MINUTE = 60;

function wordsPerMinute(transcript, durationSeconds) {
  const minutes = Number(durationSeconds) / 60;
  if (!minutes || minutes <= 0) return null;
  const wordCount = (Array.isArray(transcript) ? transcript : [])
    .filter(segment => !segment || (segment.kind !== 'part-divider' && segment.kind !== 'part-gap'))
    .reduce((sum, segment) => sum + String((segment && segment.text) || '').trim().split(/\s+/).filter(Boolean).length, 0);
  return wordCount / minutes;
}

// @returns {{eligible:boolean, warn:boolean, wordsPerMinute:number|null}}
function qualityWarning(meeting) {
  const duration = Number(meeting && meeting.duration) || 0;
  if (duration < QUALITY_MIN_DURATION_SECONDS) return { eligible: false, warn: false, wordsPerMinute: null };
  const wpm = wordsPerMinute(meeting && meeting.transcript, duration);
  if (wpm === null) return { eligible: false, warn: false, wordsPerMinute: null };
  return { eligible: true, warn: wpm < QUALITY_MIN_WORDS_PER_MINUTE, wordsPerMinute: wpm };
}

// Vietnamese dd/mm date — used by microcopy that spells a date out inline
// (ERR-07, DAT-01, DAT-03). Deliberately separate from js/utils.js's
// (English) date formatting — BR-147 forbids touching text elsewhere.
function formatDDMM(dateStr) {
  const date = new Date(dateStr);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

// TV18 (BR-121) — pure computation of the full permutation `POST
// /api/meetings/:id/parts/reorder` needs when the user clicks a single
// part's ▲/▼ in Meeting Detail. The server rejects anything that is not an
// exact permutation of ALL current parts (`reorderParts`,
// server/meeting-parts.js) — including failed/dropped ones — so `parts`
// here must be the meeting's full list, not just the visible/completed ones.
// @param {Array<{partId:string, order:number}>} parts
// @param {string} partId — the part being moved
// @param {number} delta — -1 (up) or +1 (down)
// @returns {Array<string>|null} full ordered partId list, or null if the
//   move is a no-op (already at that edge) — callers should skip the fetch.
function computeReorderedPartIds(parts, partId, delta) {
  const sorted = [...(Array.isArray(parts) ? parts : [])].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex(part => part.partId === partId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= sorted.length) return null;
  const ids = sorted.map(part => part.partId);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

// TV18 (MRG-18/19) — whether removing the entry at `index` (of `length`
// total, in the import modal's current display order, BEFORE Start is
// pressed) opens a hole in the MIDDLE of a merged cluster and therefore
// needs a confirm step first. The only removal that never creates a hole is
// the very last one, which just shortens the meeting instead — same spirit
// as FAI-08/09's distinction, but for parts that have not been registered
// on the server yet (removing them here leaves no `dropped`/gap trace at
// all, so skipping the confirm on a middle part would be a silent loss).
function removingCreatesGap(index, length) {
  return length > 1 && index >= 0 && index < length - 1;
}

// TV18 (MRG-18) — best-effort wall-clock boundary of the gap that removing a
// part would leave, from the two neighboring entries' client-side
// `lastModified` file timestamps. Same [UNVERIFIED]-reliability signal as
// `gapWarningSeconds` (R-O) — degrades to '' instead of guessing when either
// side is missing, so the caller can fall back to the range-less copy.
function formatGapRangeClock(prevLastModified, nextLastModified) {
  const start = Number(prevLastModified) || 0;
  const end = Number(nextLastModified) || 0;
  if (!start || !end) return '';
  const clock = ms => {
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `${clock(start)} → ${clock(end)}`;
}

const Parts = {
  meetingCapabilities,
  naturalCompare,
  suggestPartOrder,
  gapWarningSeconds,
  classifyGap,
  GAP_LARGE_SECONDS,
  qualityWarning,
  QUALITY_MIN_DURATION_SECONDS,
  QUALITY_MIN_WORDS_PER_MINUTE,
  formatDDMM,
  computeReorderedPartIds,
  removingCreatesGap,
  formatGapRangeClock
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Parts;
}
