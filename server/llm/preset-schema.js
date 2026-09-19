/* ============================================
   MeetNote AI — Summary preset schema builders
   Pure functions only (no filesystem/network I/O) so this
   module stays independently testable, per Architecture.md §7.
   Converts a Preset (server/llm/presets.js data shape) into the
   3 provider dialects plus a dynamic output normalizer.
   ============================================ */

const { LLM_ERROR, llmError, parseJsonLoose, cleanString, cleanStringList } = require('./contracts');
const { buildSectionsBlock } = require('./prompts');

const SECTION_TYPES = new Set(['paragraph', 'bulletList', 'actionList']);

// Keys the /api/summary response object also uses for metadata (§3.1).
// A generated section key must never collide with one of these.
const RESERVED_KEYS = new Set(['summaryGeneration', 'summaryPreset', 'meetingId', 'title', 'details', 'error']);

const KEY_REGEX = /^[a-z][A-Za-z0-9]{0,39}$/;

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

// "Key Points" -> "keyPoints". Non-Latin labels (e.g. Japanese) yield no
// ASCII words, so the caller falls back to a positional key.
function slugifyLabel(label) {
  const words = stripDiacritics(label).match(/[A-Za-z0-9]+/g) || [];
  if (!words.length) return '';
  const [first, ...rest] = words;
  const head = first.toLowerCase();
  const tail = rest.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return [head, ...tail].join('');
}

/**
 * Derive a stable, unique section key from a user-entered label.
 * @param {string} label
 * @param {number} index 0-based position of this section in the preset
 * @param {Set<string>} usedKeys keys already assigned within this preset
 */
function sectionKeyFor(label, index, usedKeys) {
  const used = usedKeys instanceof Set ? usedKeys : new Set(usedKeys || []);
  let base = slugifyLabel(label);
  if (!base) base = `section${index + 1}`;
  if (!/^[a-z]/.test(base)) base = `s${base}`;
  base = base.slice(0, 40);
  if (!KEY_REGEX.test(base)) base = `section${index + 1}`;

  let candidate = base;
  let suffix = 1;
  while (used.has(candidate) || RESERVED_KEYS.has(candidate)) {
    suffix += 1;
    const suffixText = String(suffix);
    candidate = `${base.slice(0, 40 - suffixText.length)}${suffixText}`;
  }
  return candidate;
}

function assertSectionType(type) {
  if (!SECTION_TYPES.has(type)) {
    throw new Error(`Unknown preset section type "${type}"`);
  }
}

// JSON Schema draft 2020-12 property per field type (Codex dialect).
function jsonSchemaPropertyFor(section) {
  assertSectionType(section.type);
  if (section.type === 'paragraph') return { type: 'string' };
  if (section.type === 'bulletList') return { type: 'array', items: { type: 'string' } };
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        assignee: { type: 'string' },
        dueDate: { type: 'string' }
      },
      required: ['text', 'assignee', 'dueDate'],
      additionalProperties: false
    }
  };
}

/** Codex dialect — must equal schemas/meeting-summary.schema.json for the General preset. */
function buildJsonSchema(preset) {
  const properties = {};
  const required = [];
  for (const section of preset.sections) {
    properties[section.key] = jsonSchemaPropertyFor(section);
    required.push(section.key);
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

// Gemini responseSchema property per field type (OpenAPI subset — no
// $schema / additionalProperties). Mirrors gemini.js:22-45 (verified, §6.2).
function geminiPropertyFor(section) {
  assertSectionType(section.type);
  if (section.type === 'paragraph') return { type: 'STRING' };
  if (section.type === 'bulletList') return { type: 'ARRAY', items: { type: 'STRING' } };
  return {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING' },
        assignee: { type: 'STRING' },
        dueDate: { type: 'STRING' }
      },
      required: ['text', 'assignee', 'dueDate'],
      propertyOrdering: ['text', 'assignee', 'dueDate']
    }
  };
}

/** Gemini dialect — must equal SUMMARY_SCHEMA in providers/gemini.js for the General preset. */
function buildGeminiSchema(preset) {
  const properties = {};
  const required = [];
  const propertyOrdering = [];
  for (const section of preset.sections) {
    properties[section.key] = geminiPropertyFor(section);
    required.push(section.key);
    propertyOrdering.push(section.key);
  }
  return { type: 'OBJECT', properties, required, propertyOrdering };
}

function isEmptySectionValue(type, value) {
  if (type === 'paragraph') return value === '';
  return Array.isArray(value) && value.length === 0;
}

function normalizeActionListValue(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (item && typeof item === 'object' ? item : {}))
    .map(item => ({
      text: cleanString(item.text, 2000),
      assignee: cleanString(item.assignee, 200),
      dueDate: cleanString(item.dueDate, 100)
    }))
    .filter(item => item.text)
    .slice(0, 200);
}

function coerceSectionValue(section, rawValue) {
  if (section.type === 'paragraph') return cleanString(rawValue, 20000);
  if (section.type === 'bulletList') return cleanStringList(rawValue, 100, 2000);
  return normalizeActionListValue(rawValue);
}

/**
 * Build the dynamic normalizer for a preset (§7). DeepSeek has no schema
 * enforcement (§6.3) so this normalizer — not the provider — is the real
 * contract boundary for BR-13/BR-14 across all 3 providers.
 * @param {object} preset
 * @returns {(raw: unknown, providerId: string) => object}
 */
function buildNormalizer(preset) {
  const knownKeys = new Set(preset.sections.map(section => section.key));
  return function normalize(raw, providerId) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : parseJsonLoose(raw);
    if (!source || typeof source !== 'object') {
      throw llmError(LLM_ERROR.INVALID_OUTPUT, 'The provider returned an unreadable summary.', { provider: providerId });
    }

    // BR-14: unrecognized keys are dropped, never surfaced to the client.
    // Deviation note: Architecture.md §7 calls for logEvent (file-backed),
    // but this module is documented as I/O-free and independently testable
    // (§7 header). console.warn keeps the drop-and-report behavior without
    // adding filesystem/network I/O to a pure module — see docs/CHANGELOG.md.
    for (const key of Object.keys(source)) {
      if (!knownKeys.has(key)) {
        console.warn(`[summary.unknown_key] provider=${providerId} key=${key}`);
      }
    }

    const data = {};
    let hasContent = false;
    for (const section of preset.sections) {
      const value = coerceSectionValue(section, source[section.key]);
      if (!isEmptySectionValue(section.type, value)) hasContent = true;
      data[section.key] = value;
    }

    // BR-13: individual empty sections are kept as-is; only an entirely
    // empty result is treated as a failed generation.
    if (!hasContent) {
      throw llmError(LLM_ERROR.INVALID_OUTPUT, 'The provider returned a summary without any content.', { provider: providerId });
    }
    return data;
  };
}

/** Bundle handed down to provider adapters (S2/S4, WHY-5). */
function buildSummaryFormat(preset) {
  return {
    jsonSchema: buildJsonSchema(preset),
    geminiSchema: buildGeminiSchema(preset),
    normalize: buildNormalizer(preset),
    sectionsBlock: buildSectionsBlock(preset)
  };
}

/** Immutable summary provenance snapshot stored with a meeting (BR-16). */
function snapshotOf(preset) {
  return {
    presetId: preset.id,
    name: preset.name,
    sections: preset.sections.map(section => ({
      key: section.key,
      label: section.label,
      type: section.type,
      hint: section.hint || ''
    })),
    capturedAt: new Date().toISOString()
  };
}

// Canonical 5-field shape (§3.2). Shared by the built-in General Meeting
// preset (server/llm/presets.js) and the BR-20 virtual snapshot below, so
// both stay identical by construction rather than by convention.
const GENERAL_SECTIONS = [
  { key: 'summary', label: 'Summary', type: 'paragraph', hint: '' },
  { key: 'keyPoints', label: 'Key Points', type: 'bulletList', hint: '' },
  { key: 'decisions', label: 'Decisions', type: 'bulletList', hint: '' },
  { key: 'actionItems', label: 'Action Items', type: 'actionList', hint: '' },
  { key: 'openQuestions', label: 'Open Questions', type: 'bulletList', hint: '' }
];

// BR-20: virtual snapshot for summaries created before this feature existed.
// Never persisted — built on demand wherever a meeting lacks summaryPreset.
const GENERAL_SNAPSHOT = {
  presetId: null,
  name: 'General Meeting',
  sections: GENERAL_SECTIONS,
  capturedAt: null
};

module.exports = {
  sectionKeyFor,
  buildJsonSchema,
  buildGeminiSchema,
  buildNormalizer,
  buildSummaryFormat,
  snapshotOf,
  stripDiacritics,
  GENERAL_SECTIONS,
  GENERAL_SNAPSHOT
};
