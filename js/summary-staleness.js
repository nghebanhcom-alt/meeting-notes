/* ============================================
   MeetNote AI — Pre-meeting info staleness vs. last Generate (BR-146)
   Pure function, no DOM/fetch — dual mode like js/meeting-types.js so
   `node --test` can exercise it directly. Used by Meeting Detail's
   "Pre-meeting info" card (js/app.js `_preMeetingStaleHint`) to decide
   whether to show the "thông tin có thể mới hơn bản tóm tắt" nudge.

   Compares `meeting.promptContextUpdatedAt` (bumped ONLY when one of the 8
   fields that actually feed the summary prompt changes — see
   js/storage.js `PROMPT_CONTEXT_FIELDS`/`_promptContextFieldsChanged`),
   never `meeting.updatedAt` (bumps on every save, including tags/action
   items/preset choice — that field mismatch was BUG-004).
   ============================================ */

// @returns {boolean} true when the pre-meeting info card should show the
//   "thông tin có thể mới hơn" nudge.
function isPreMeetingInfoStale(meeting) {
  const generatedAt = meeting && meeting.summaryGeneration && meeting.summaryGeneration.generatedAt;
  const contextUpdatedAt = meeting && meeting.promptContextUpdatedAt;
  // R-AF: a meeting without promptContextUpdatedAt yet (created before
  // BR-146, or never had a prompt-context field change) must default to NOT
  // stale — deny-by-default, never a false-positive nudge.
  if (!generatedAt || !contextUpdatedAt) return false;
  return new Date(contextUpdatedAt).getTime() > new Date(generatedAt).getTime();
}

const SummaryStaleness = { isPreMeetingInfoStale };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SummaryStaleness;
}
