/* ============================================
   MeetNote AI — Meeting date plausibility (BR-94)
   Single source of truth for "is this a plausible meeting date", shared by
   both places a meeting `date` can be set by hand: the import modal
   (js/import.js, per-entry date field) and Meeting Detail's pre-meeting info
   editor (js/app.js, `_readDateEditor`). Pure function, no DOM/fetch — dual
   mode like js/meeting-types.js so `node --test` can exercise it directly.

   Threshold matches the ALREADY-approved logic import.js used for the
   file.lastModified auto-suggestion (`_suggestedDateIso`/`_suggestedDateSource`,
   BR-93) — reused here rather than re-derived, since BUG-003 found that logic
   correct and only the manually-typed path missing it.
   ============================================ */

const FUTURE_GRACE_MS = 24 * 3600 * 1000; // BR-94: more than 1 day in the future is implausible.
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1); // BR-94: before year 2000 is implausible.

// @param {string} iso a meeting `date` ISO string (typically freshly built
//   from a datetime-local/date+time input's `.value`).
// @returns {boolean} false for an unparsable string too, never throws.
function isPlausibleMeetingDate(iso) {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms <= Date.now() + FUTURE_GRACE_MS && ms >= MIN_PLAUSIBLE_MS;
}

const MeetingDate = { isPlausibleMeetingDate, FUTURE_GRACE_MS, MIN_PLAUSIBLE_MS };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MeetingDate;
}
