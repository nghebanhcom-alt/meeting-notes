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

// @returns {boolean} true when the summary tab should show the "transcript đã
//   đổi, cân nhắc tạo lại tóm tắt" nudge (Architecture §W4.4/§T-W8).
// Compares `meeting.summaryGeneration.generatedAt` against every refine
// `finishedAt` that actually replaced a transcript (`status === 'done'`) —
// both the single-meeting `meeting.refine` and, for merged recordings, every
// `part.refine` (§W14: "kích hoạt khi bất kỳ part nào refine xong"). A
// meeting that was never summarized, or never refined, has nothing to
// compare against and must default to NOT stale (R-AF-style deny-by-default,
// same discipline as isPreMeetingInfoStale — never a false-positive nudge).
function isTranscriptStaleAfterRefine(meeting) {
  const generatedAt = meeting && meeting.summaryGeneration && meeting.summaryGeneration.generatedAt;
  if (!generatedAt) return false;
  const generatedTime = new Date(generatedAt).getTime();

  const refineFinishedAts = [];
  if (meeting.refine && meeting.refine.status === 'done' && meeting.refine.finishedAt) {
    refineFinishedAts.push(meeting.refine.finishedAt);
  }
  for (const part of Array.isArray(meeting.parts) ? meeting.parts : []) {
    if (part && part.refine && part.refine.status === 'done' && part.refine.finishedAt) {
      refineFinishedAts.push(part.refine.finishedAt);
    }
  }
  if (refineFinishedAts.length === 0) return false;

  return refineFinishedAts.some(finishedAt => new Date(finishedAt).getTime() > generatedTime);
}

const SummaryStaleness = { isPreMeetingInfoStale, isTranscriptStaleAfterRefine };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SummaryStaleness;
}
