/* ============================================
   MeetNote AI — Tags (BR-68..BR-76)
   Pure functions, no DOM/network access, so this file is independently
   testable (Architecture.md §10.1) and — like meeting-types.js — runs
   unmodified in both the browser and Node (`require()` guard at the
   bottom), even though nothing here currently needs the Node side.
   ============================================ */

const TAG_MAX_LENGTH = 30;
const TAG_MAX_COUNT = 10;

function normalizeTag(value) {
  return typeof value === 'string' ? value.trim().slice(0, TAG_MAX_LENGTH) : '';
}

// Dedupe case-insensitively, keep the first-seen casing (BR-68).
function normalizeTagList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= TAG_MAX_COUNT) break;
  }
  return result;
}

// BR-68: report *why* a tag cannot be added, so the UI can show a specific
// message instead of silently doing nothing.
function canAddTag(tags, tag) {
  const normalized = normalizeTag(tag);
  if (!normalized) return { ok: false, code: 'TAG_EMPTY' };
  const list = Array.isArray(tags) ? tags : [];
  const key = normalized.toLowerCase();
  if (list.some(existing => String(existing).trim().toLowerCase() === key)) {
    return { ok: false, code: 'TAG_DUPLICATE' };
  }
  if (list.length >= TAG_MAX_COUNT) return { ok: false, code: 'TAG_LIMIT_REACHED' };
  return { ok: true, code: '' };
}

// 32-bit FNV-1a — deterministic, no Math.random/locale dependency, same
// value on every machine for the same tag (BR-71).
function _fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tagHue(tag) {
  return _fnv1a(String(tag || '').toLowerCase()) % 360;
}

// Only numbers from tagHue() ever reach the style string — the tag's own
// text is never interpolated here (§10.1 "chỉ sinh số"), so this is safe to
// use even though the tag text itself must go through Utils.escapeHtml
// wherever it is rendered as content.
function tagStyle(tag) {
  const hue = tagHue(tag);
  return `background:hsl(${hue} 65% 30%); color:hsl(${hue} 85% 85%); border-color:hsl(${hue} 60% 45%)`;
}

// BR-69: sorted by most-recently-used first, then by frequency.
function collectTags(meetings) {
  const byKey = new Map();
  for (const meeting of meetings || []) {
    const tags = Array.isArray(meeting?.tags) ? meeting.tags : [];
    const updatedAt = typeof meeting?.updatedAt === 'string' ? meeting.updatedAt : '';
    for (const raw of tags) {
      const tag = String(raw || '').trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        if (updatedAt > existing.lastUsedAt) existing.lastUsedAt = updatedAt;
      } else {
        byKey.set(key, { tag, count: 1, lastUsedAt: updatedAt });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt > b.lastUsedAt ? -1 : 1;
    return b.count - a.count;
  });
}

// BR-69: free-text autocomplete — a match outside this list is still a
// valid tag to type, this only orders/limits the suggestion dropdown.
function suggestTags(all, query) {
  const q = String(query || '').trim().toLowerCase();
  const tags = (all || []).map(entry => entry.tag);
  const filtered = q ? tags.filter(tag => tag.toLowerCase().includes(q)) : tags;
  return filtered.slice(0, 8);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeTag,
    normalizeTagList,
    canAddTag,
    tagHue,
    tagStyle,
    collectTags,
    suggestTags
  };
}
