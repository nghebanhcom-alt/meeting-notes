/* ============================================
   MeetNote AI — Meeting type table (BR-25)
   Single source of truth for meetingType codes, shared by the
   browser (New Meeting / Meeting Detail dropdowns, tag auto-add,
   export filename abbreviation) and the server (export filename,
   sanitize). Runs unmodified in both environments (Architecture
   §3.2 WHY-3) — do not require() anything browser-only here.

   `presetName` must match, character for character, the `name` of
   one of the 10 built-in presets seeded in server/llm/presets.js
   (BR-67) — that equality is the entire mechanism behind the
   "suggest preset by meetingType" feature (BR-57 step 2).
   ============================================ */

const MEETING_TYPES = [
  { code: 'general', label: 'General Meeting', abbr: 'GM', presetName: 'General Meeting' },
  { code: 'giao-ban', label: 'Họp giao ban', abbr: 'GB', presetName: 'Họp giao ban' },
  { code: 'kinh-doanh', label: 'Họp phòng kinh doanh', abbr: 'KD', presetName: 'Họp phòng kinh doanh' },
  { code: 'marketing', label: 'Họp phòng marketing', abbr: 'MKT', presetName: 'Họp phòng marketing' },
  { code: 'brainstorm', label: 'Brainstorming', abbr: 'BS', presetName: 'Brainstorming' },
  { code: 'hdqt', label: 'Họp HĐQT', abbr: 'HDQT', presetName: 'Họp HĐQT' },
  { code: 'sales-call', label: 'Sales call', abbr: 'SC', presetName: 'Sales call' },
  { code: 'training', label: 'Training', abbr: 'TR', presetName: 'Training' },
  { code: 'rnd', label: 'R&D sản phẩm', abbr: 'RD', presetName: 'R&D sản phẩm' },
  { code: 'okr', label: 'OKR — xây dựng & check-in', abbr: 'OKR', presetName: 'OKR — xây dựng & check-in' }
];

// Lookup by code, '' → undefined (never coerced to a fake "no type" entry —
// callers decide what '' means for their own context).
function meetingTypeByCode(code) {
  return MEETING_TYPES.find(entry => entry.code === code);
}

// BR-27: any code outside this table (stale import, hand-edited JSON) must
// resolve to '' (not-selected), never to 'general'.
function isKnownMeetingTypeCode(code) {
  return code === '' || MEETING_TYPES.some(entry => entry.code === code);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MEETING_TYPES, meetingTypeByCode, isKnownMeetingTypeCode };
}
