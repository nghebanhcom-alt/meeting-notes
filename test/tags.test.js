'use strict';

// T14/T15 (BR-68..BR-74) — js/tags.js is pure, dual-mode (browser + Node),
// same pattern as js/meeting-types.js.

const test = require('node:test');
const assert = require('node:assert');

const { normalizeTag, normalizeTagList, canAddTag, tagHue, tagStyle, collectTags, suggestTags } = require('../js/tags');

test('normalizeTag trims and caps at 30 chars', () => {
  assert.strictEqual(normalizeTag('  Sales call  '), 'Sales call');
  assert.strictEqual(normalizeTag('a'.repeat(40)).length, 30);
  assert.strictEqual(normalizeTag(42), '');
});

test('normalizeTagList dedupes case-insensitively, keeps first-seen casing, caps at 10 (BR-68)', () => {
  const result = normalizeTagList(['Sales', 'sales', 'SALES', 'Ops', '', '  ']);
  assert.deepStrictEqual(result, ['Sales', 'Ops']);

  const many = normalizeTagList(Array.from({ length: 15 }, (_, i) => `tag${i}`));
  assert.strictEqual(many.length, 10);
});

test('normalizeTagList returns [] for non-array input', () => {
  assert.deepStrictEqual(normalizeTagList(null), []);
  assert.deepStrictEqual(normalizeTagList('not-an-array'), []);
});

test('canAddTag: empty, duplicate (case-insensitive), and limit-reached are distinct codes (BR-68)', () => {
  assert.strictEqual(canAddTag([], '').ok, false);
  assert.strictEqual(canAddTag([], '').code, 'TAG_EMPTY');

  assert.strictEqual(canAddTag(['Sales'], 'sales').ok, false);
  assert.strictEqual(canAddTag(['Sales'], 'sales').code, 'TAG_DUPLICATE');

  const full = Array.from({ length: 10 }, (_, i) => `tag${i}`);
  assert.strictEqual(canAddTag(full, 'new-tag').ok, false);
  assert.strictEqual(canAddTag(full, 'new-tag').code, 'TAG_LIMIT_REACHED');

  const result = canAddTag(['Sales'], 'Marketing');
  assert.deepStrictEqual(result, { ok: true, code: '' });
});

test('tagHue is deterministic and case-insensitive, always 0..359', () => {
  assert.strictEqual(tagHue('Sales call'), tagHue('sales call'));
  assert.strictEqual(tagHue('Sales call'), tagHue('SALES CALL'));
  for (const tag of ['a', 'Sales call', 'Họp giao ban', '']) {
    const hue = tagHue(tag);
    assert.ok(hue >= 0 && hue < 360);
  }
});

test('tagStyle only interpolates numbers from tagHue, never the tag text itself', () => {
  const style = tagStyle('<script>alert(1)</script>');
  assert.ok(!style.includes('<script>'));
  assert.match(style, /^background:hsl\(\d+ 65% 30%\); color:hsl\(\d+ 85% 85%\); border-color:hsl\(\d+ 60% 45%\)$/);
});

test('collectTags counts per meeting, sorts by most-recent-use then frequency (BR-69)', () => {
  const meetings = [
    { tags: ['Sales', 'VIP'], updatedAt: '2026-01-01T00:00:00Z' },
    { tags: ['sales'], updatedAt: '2026-03-01T00:00:00Z' },
    { tags: ['Ops'], updatedAt: '2026-02-01T00:00:00Z' }
  ];
  const result = collectTags(meetings);
  assert.deepStrictEqual(result.map(r => r.tag), ['Sales', 'Ops', 'VIP']);
  const sales = result.find(r => r.tag === 'Sales');
  assert.strictEqual(sales.count, 2);
  assert.strictEqual(sales.lastUsedAt, '2026-03-01T00:00:00Z');
});

test('collectTags ignores meetings with no tags / malformed tags field', () => {
  const result = collectTags([{ tags: [] }, {}, { tags: null }]);
  assert.deepStrictEqual(result, []);
});

test('suggestTags: case-insensitive substring match, preserves collectTags order, capped at 8', () => {
  const meetings = Array.from({ length: 10 }, (_, i) => ({ tags: [`Project-${i}`], updatedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
  const all = collectTags(meetings);
  const suggestions = suggestTags(all, 'project');
  assert.strictEqual(suggestions.length, 8);
  assert.strictEqual(suggestions[0], 'Project-9'); // most recently used first

  const filtered = suggestTags(all, 'Project-3');
  assert.deepStrictEqual(filtered, ['Project-3']);
});

test('suggestTags with no query returns the full collectTags order (capped)', () => {
  const all = collectTags([{ tags: ['A'], updatedAt: '2026-01-01T00:00:00Z' }, { tags: ['B'], updatedAt: '2026-01-02T00:00:00Z' }]);
  assert.deepStrictEqual(suggestTags(all, ''), ['B', 'A']);
});
