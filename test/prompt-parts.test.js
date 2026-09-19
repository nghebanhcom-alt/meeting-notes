'use strict';

// TV7 — per-part speaker labels + merged-recording context in all 3 prompt
// builders, and the M11→M12→M13 lineage that carries `kind`/`part`/
// `missingParts` from the client payload all the way into the rendered
// prompt (BR-130, BR-135; R-AD; Protocol 6).

const { test } = require('node:test');
const assert = require('node:assert');

const {
  formatTranscript, buildContextBlock, buildSummaryPrompt, buildChunkPrompt,
  buildSynthesisPrompt, buildTitlePrompt
} = require('../server/llm/prompts');

function twoPartMeeting(overrides = {}) {
  return {
    id: 'm1', title: 'Sales call', date: '2026-09-18', duration: 20,
    participants: ['Alice', 'Bob'],
    notes: '', meetingType: '', topic: '', leadBy: '',
    partCount: 2,
    missingParts: [],
    transcript: [
      { time: 0, kind: 'part-divider', part: 1, partId: 'part-a', speaker: '', text: '— Phần 1/2 · a.m4a —' },
      { time: 0, part: 1, partId: 'part-a', srcIndex: 0, speaker: 'Speaker 1', text: 'Chào mọi người.' },
      { time: 11, kind: 'part-divider', part: 2, partId: 'part-b', speaker: '', text: '— Phần 2/2 · b.m4a —' },
      { time: 11, part: 2, partId: 'part-b', srcIndex: 0, speaker: 'Speaker 1', text: 'Tiếp tục nhé.' }
    ],
    ...overrides
  };
}

/* ── formatTranscript (V5.1) ── */

test('formatTranscript renders a divider/gap as "--- text ---" and a per-part segment with "(Phần N)"', () => {
  const rendered = formatTranscript(twoPartMeeting().transcript);
  assert.ok(rendered.includes('--- — Phần 1/2 · a.m4a — ---'), rendered);
  assert.ok(rendered.includes('(Phần 1): Chào mọi người.'));
  assert.ok(rendered.includes('(Phần 2): Tiếp tục nhé.'));
});

test('formatTranscript renders a single-part meeting exactly as before v5 (no ".part", no "(Phần" anywhere)', () => {
  const rendered = formatTranscript([{ time: 0, speaker: 'Alice', text: 'Hi there.' }]);
  assert.strictEqual(rendered, '[0:00] Alice: Hi there.');
  assert.ok(!rendered.includes('Phần'));
});

/* ── buildContextBlock (V5.3) ── */

test('buildContextBlock adds merged-recording lines only when partCount > 0', () => {
  const ctx = buildContextBlock(twoPartMeeting());
  assert.ok(ctx.headerLines.some(line => line.includes('Recording parts: 2')));
  assert.ok(ctx.headerLines.some(line => line.includes('Speaker labels are per-part')));
  assert.deepStrictEqual(ctx.contextUsed.merged, true);
  assert.strictEqual(ctx.contextUsed.partCount, 2);
});

test('buildContextBlock adds a "Missing parts" line only when missingParts is non-empty', () => {
  const noneMissing = buildContextBlock(twoPartMeeting());
  assert.ok(!noneMissing.headerLines.some(line => line.startsWith('Missing parts')));

  const withMissing = buildContextBlock(twoPartMeeting({ missingParts: [2] }));
  const missingLine = withMissing.headerLines.find(line => line.startsWith('Missing parts'));
  assert.ok(missingLine, 'expected a Missing parts line');
  assert.ok(missingLine.includes('2 of 2'));
  assert.deepStrictEqual(withMissing.contextUsed.missingParts, [2]);
});

test('a single-part meeting (partCount 0/undefined) gets no merged-recording lines and the old contextUsed shape (test hồi quy)', () => {
  const ctx = buildContextBlock({ meetingType: '', topic: '', leadBy: '', notes: '' });
  assert.deepStrictEqual(ctx.headerLines, []);
  assert.deepStrictEqual(ctx.contextUsed, { notes: false, notesTruncated: false, preMeeting: false });
});

/* ── all 3 builders carry the part info through (Protocol 6 lineage) ── */

test('buildSummaryPrompt and buildChunkPrompt both label part-2 content with "(Phần 2)"', () => {
  const meeting = twoPartMeeting();
  const summaryPrompt = buildSummaryPrompt(meeting, '', null);
  assert.ok(summaryPrompt.includes('(Phần 2): Tiếp tục nhé.'));

  const part2Segment = meeting.transcript[3];
  const chunkPrompt = buildChunkPrompt(meeting, [part2Segment], 2, 2, '', null);
  assert.ok(chunkPrompt.includes('(Phần 2): Tiếp tục nhé.'), 'a chunk starting mid-part-2 must still carry the label');
});

test('buildSynthesisPrompt states the recording is merged and forbids merging speakers across parts', () => {
  const meeting = twoPartMeeting();
  const prompt = buildSynthesisPrompt(meeting, [{ summary: 'part 1 notes' }, { summary: 'part 2 notes' }], '', null);
  assert.ok(prompt.includes('Recording parts: 2'));
  assert.ok(prompt.toLowerCase().includes('do not merge speakers across parts'));
});

test('a single-part meeting\'s buildSummaryPrompt is byte-for-byte unchanged from before v5 (test hồi quy)', () => {
  const meeting = {
    id: 'm1', title: 'Weekly sync', date: '2026-09-18', duration: 10,
    participants: ['Alice'], notes: '', meetingType: '', topic: '', leadBy: '',
    transcript: [{ time: 0, speaker: 'Alice', text: 'Ship it.' }]
  };
  const prompt = buildSummaryPrompt(meeting, '', null);
  assert.ok(!prompt.includes('Phần'));
  assert.ok(!prompt.includes('Recording parts'));
});

/* ── buildTitlePrompt filters out non-content segments (V11#20) ── */

test('buildTitlePrompt drops part-divider/part-gap segments instead of rendering garbage lines', () => {
  const prompt = buildTitlePrompt(twoPartMeeting());
  assert.ok(!prompt.includes('— Phần'));
  assert.ok(prompt.includes('Speaker 1: Chào mọi người.'));
});
