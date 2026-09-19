'use strict';

// T9 (BR-45, BR-46) — server/export/filename.js is pure, no I/O.

const test = require('node:test');
const assert = require('node:assert');

const { yymmdd, slugTopic, abbrFor, applyReservedNameGuard, buildFileName } = require('../server/export/filename');

test('yymmdd uses local date fields (BR-45.1)', () => {
  // A fixed instant far from local midnight so timezone shifts (this repo's
  // dev/CI runs in Asia/Saigon per Architecture §0) don't flip the day.
  assert.strictEqual(yymmdd('2026-09-18T12:00:00Z'), '260918');
});

test('yymmdd falls back to "now" for an invalid/missing date instead of NaN', () => {
  const now = new Date();
  const expected = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  assert.strictEqual(yymmdd('not-a-date'), expected);
  assert.strictEqual(yymmdd(undefined), expected);
});

test('slugTopic strips diacritics (keeping đ/Đ handling) and collapses separators — real example from Architecture §5.4', () => {
  assert.strictEqual(slugTopic('Họp chốt giá Q4', ''), 'Hop-chot-gia-Q4');
  assert.strictEqual(slugTopic('', 'Đánh giá KPI — tháng 9'), 'Danh-gia-KPI-thang-9');
});

test('slugTopic prefers topic over title', () => {
  assert.strictEqual(slugTopic('Topic here', 'Title here'), 'Topic-here');
});

test('slugTopic falls back to "hop" for non-Latin or empty input', () => {
  assert.strictEqual(slugTopic('こんにちは', ''), 'hop');
  assert.strictEqual(slugTopic('', ''), 'hop');
  assert.strictEqual(slugTopic('   ', '   '), 'hop');
});

test('slugTopic caps at 60 chars with no trailing separator', () => {
  const longTopic = 'a'.repeat(80);
  const slug = slugTopic(longTopic, '');
  assert.ok(slug.length <= 60);
  assert.ok(!slug.endsWith('-'));
});

test('abbrFor looks up MEETING_TYPES, unknown/empty codes yield ""', () => {
  assert.strictEqual(abbrFor('sales-call'), 'SC');
  assert.strictEqual(abbrFor('unknown-code'), '');
  assert.strictEqual(abbrFor(''), '');
});

test('applyReservedNameGuard appends "_" for Windows reserved device names, case-insensitively', () => {
  assert.strictEqual(applyReservedNameGuard('CON'), 'CON_');
  assert.strictEqual(applyReservedNameGuard('con'), 'con_');
  assert.strictEqual(applyReservedNameGuard('LPT1'), 'LPT1_');
  assert.strictEqual(applyReservedNameGuard('260918-Hop-chot-gia-Q4-SC'), '260918-Hop-chot-gia-Q4-SC');
});

test('buildFileName: full example from Architecture §11 T9 acceptance', () => {
  const name = buildFileName({ date: '2026-09-18T12:00:00Z', topic: 'Họp chốt giá Q4', title: '', meetingType: 'sales-call' });
  assert.strictEqual(name, '260918-Hop-chot-gia-Q4-SC');
});

test('buildFileName: missing meetingType yields exactly 2 joined parts, no stray "-"', () => {
  const name = buildFileName({ date: '2026-09-18T12:00:00Z', topic: 'Họp chốt giá Q4', title: '', meetingType: '' });
  assert.strictEqual(name, '260918-Hop-chot-gia-Q4');
  assert.ok(!name.includes('--'));
  assert.ok(!name.endsWith('-'));
});

test('buildFileName: missing topic AND title falls back to "hop", still no stray "-"', () => {
  const name = buildFileName({ date: '2026-09-18T12:00:00Z', topic: '', title: '', meetingType: '' });
  assert.strictEqual(name, '260918-hop');
});

test('buildFileName: missing date falls back to "now" without throwing or producing NaN', () => {
  const name = buildFileName({ date: '', topic: 'Standup', title: '', meetingType: '' });
  assert.match(name, /^\d{6}-Standup$/);
});
