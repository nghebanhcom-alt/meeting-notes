/* ============================================
   MeetNote AI — Export filename builder (BR-45, BR-46)
   Pure functions, no I/O — Architecture.md §5.4. Reuses the diacritics
   stripping logic already verified in preset-schema.js (WHY: same rule,
   one place) instead of re-deriving the NFD/đ handling here.
   ============================================ */

const { meetingTypeByCode } = require('../meeting-types');
const { stripDiacritics } = require('../llm/preset-schema');

const MAX_SLUG_LENGTH = 60;

// Windows reserved device names (case-insensitive) — checked against the
// final joined base name, per Architecture §5.4.
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

// BR-45.1: local time, not UTC — an invalid/missing date falls back to "now"
// rather than producing "NaNNaNNaN".
function yymmdd(isoDate) {
  let date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// topic takes priority over title (§5.4); non-Latin/empty input falls back
// to "hop" rather than producing an empty filename segment.
function slugTopic(topic, title) {
  const source = String(topic || '').trim() || String(title || '').trim();
  if (!source) return 'hop';
  const slug = stripDiacritics(source)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug || 'hop';
}

function abbrFor(meetingType) {
  if (!meetingType) return '';
  const entry = meetingTypeByCode(meetingType);
  return entry ? entry.abbr : '';
}

// Appends `_` when `base` collides with a Windows reserved device name
// (case-insensitive) — kept as its own function so it is testable in
// isolation from the yymmdd/topic/meetingType composition above.
function applyReservedNameGuard(base) {
  return RESERVED_NAMES.has(String(base).toUpperCase()) ? `${base}_` : base;
}

// BR-45.3: never leaves a stray "-" when a component (topic/title or
// meetingType) is missing — `filter(Boolean)` drops the empty abbr instead
// of joining an empty string.
function buildFileName(meeting) {
  const parts = [
    yymmdd(meeting && meeting.date),
    slugTopic(meeting && meeting.topic, meeting && meeting.title),
    abbrFor(meeting && meeting.meetingType)
  ].filter(Boolean);
  return applyReservedNameGuard(parts.join('-'));
}

module.exports = {
  yymmdd,
  slugTopic,
  abbrFor,
  applyReservedNameGuard,
  buildFileName
};
