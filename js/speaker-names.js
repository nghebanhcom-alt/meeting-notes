/* ============================================
   MeetNote AI — Speaker naming (Architecture.md §X5.2, T-X1)
   Pure functions, no DOM, no fetch — testable with `node --test` directly.

   `meeting.speakerNames` maps a KEY to `{ name, assignedAt, assignedAtSeconds,
   source }`. The key is normally just the raw label as it appears in
   `seg.speaker` ("Speaker 1", X5.1) so live naming (single continuous
   recording, segments never carry `partId`, X1.5) and the pre-existing
   post-hoc rename both share one flat namespace.

   WHY the optional `partId` parameter (not in the literal X5.2 signature):
   on a merged (multi-part) recording, "Speaker 1" in part A and "Speaker 1"
   in part B come from two INDEPENDENT diarization runs and are not the same
   person (js/app.js:4676-4681, already-shipped post-hoc rename comment).
   Composing the key as `${partId}::${rawLabel}` when a segment carries a
   `partId` preserves that already-verified per-part scoping while still
   living in one shared map (E-X4). A segment with no `partId` (live
   recording, or a single-part meeting) keys on the raw label alone —
   byte-for-byte the X5.2 example. */

function _keyFor(rawLabel, partId) {
  return partId === undefined || partId === null ? rawLabel : `${partId}::${rawLabel}`;
}

// resolveSpeakerLabel(rawLabel, speakerNames, partId) -> { display, raw, isNamed }
// - Unknown/unassigned key -> raw label passed through unchanged (isNamed:false).
// - Assigned key -> "<name> · <rawLabel>" so the original label never
//   disappears from view (X4.1.3 / X5.3 — needed to spot a merged label).
function resolveSpeakerLabel(rawLabel, speakerNames, partId) {
  const raw = rawLabel || 'Speaker';
  const entry = speakerNames && typeof speakerNames === 'object' ? speakerNames[_keyFor(raw, partId)] : null;
  const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name) return { display: raw, raw, isNamed: false };
  return { display: `${name} · ${raw}`, raw, isNamed: true };
}

// assignSpeakerName(speakerNames, rawLabel, name, meta, partId) -> new map
// - Never mutates the input map (returns a new object).
// - Empty/whitespace-only `name` DELETES the key (X4.1.4 "xoá = để trống →
//   quay về nhãn thô"), it does not store an empty-string entry.
function assignSpeakerName(speakerNames, rawLabel, name, meta, partId) {
  const current = speakerNames && typeof speakerNames === 'object' ? speakerNames : {};
  const key = _keyFor(rawLabel || 'Speaker', partId);
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const next = { ...current };
  if (!trimmed) {
    delete next[key];
    return next;
  }
  next[key] = { name: trimmed, ...(meta || {}) };
  return next;
}

// listAssignedLabels(speakerNames) -> [{ raw, name, partId? }]
// `raw` strips any `partId::` prefix back out so callers never need to know
// about the composite-key detail above.
function listAssignedLabels(speakerNames) {
  if (!speakerNames || typeof speakerNames !== 'object') return [];
  return Object.entries(speakerNames).map(([key, entry]) => {
    const separatorIndex = key.indexOf('::');
    if (separatorIndex === -1) return { raw: key, name: entry?.name || '' };
    return {
      raw: key.slice(separatorIndex + 2),
      partId: key.slice(0, separatorIndex),
      name: entry?.name || ''
    };
  });
}

const SpeakerNames = { resolveSpeakerLabel, assignSpeakerName, listAssignedLabels };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpeakerNames;
}
