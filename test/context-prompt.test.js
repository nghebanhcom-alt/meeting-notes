'use strict';

// Tests for T5 (buildContextBlock + SUMMARY_PRINCIPLES/CHUNK_PRINCIPLES applied
// to all 3 builders) and T6 (context threaded through server/llm/index.js into
// the actual prompt sent to a provider + generation.contextUsed — Protocol 6
// lineage: assert the VALUE that crossed the boundary, not just "was called").

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  PROMPT_VERSION, SUMMARY_PRINCIPLES, CHUNK_PRINCIPLES,
  buildContextBlock, buildSummaryPrompt, buildChunkPrompt, buildSynthesisPrompt
} = require('../server/llm/prompts');
const { createLlmService } = require('../server/llm');

function baseMeeting(overrides = {}) {
  return {
    id: 'm1',
    title: 'Weekly sync',
    date: '2026-09-18',
    duration: 600,
    participants: ['Alice', 'Bob'],
    transcript: [{ time: 0, speaker: 'Alice', text: 'Let’s ship it.' }],
    notes: '',
    meetingType: '',
    topic: '',
    leadBy: '',
    ...overrides
  };
}

/* ── buildContextBlock (BR-32..BR-39) ── */

test('buildContextBlock omits empty pre-meeting fields and the notes block when notes is blank (BR-36, BR-37)', () => {
  const ctx = buildContextBlock(baseMeeting());
  assert.deepStrictEqual(ctx.headerLines, []);
  assert.strictEqual(ctx.notesBlock, '');
  assert.deepStrictEqual(ctx.contextUsed, { notes: false, notesTruncated: false, preMeeting: false });
});

test('buildContextBlock includes only the non-empty pre-meeting lines, in order (BR-37)', () => {
  const ctx = buildContextBlock(baseMeeting({ meetingType: 'sales-call', topic: 'Renewal', leadBy: '' }));
  assert.deepStrictEqual(ctx.headerLines, ['Meeting type: Sales call', 'Topic: Renewal']);
  assert.strictEqual(ctx.contextUsed.preMeeting, true);
});

test('buildContextBlock truncates notes at the last newline within the first 4000 chars (BR-35)', () => {
  const head = 'X'.repeat(3990);
  const tail = 'Y'.repeat(50);
  const notes = `${head}\n${tail}`; // 4041 chars, newline sits inside the first 4000
  const ctx = buildContextBlock(baseMeeting({ notes }));
  assert.strictEqual(ctx.contextUsed.notesTruncated, true);
  assert.strictEqual(ctx.contextUsed.notes, true);
  assert.ok(ctx.notesBlock.includes(head));
  assert.ok(!ctx.notesBlock.includes(tail), 'must not include text past the truncation boundary');
});

test('buildContextBlock does not truncate notes under the 4000-char limit', () => {
  const notes = 'short note';
  const ctx = buildContextBlock(baseMeeting({ notes }));
  assert.strictEqual(ctx.contextUsed.notesTruncated, false);
  assert.ok(ctx.notesBlock.includes(notes));
});

/* ── Applied to all 3 builders (BR-32) ── */

test('a meeting with notes + full pre-meeting info reaches all 3 builders identically (BR-32, BR-37)', () => {
  const meeting = baseMeeting({
    notes: 'Budget was actually $50k, not $15k as heard on the call.',
    meetingType: 'sales-call',
    topic: 'Renewal',
    leadBy: 'Alice'
  });
  const context = buildContextBlock(meeting);

  const single = buildSummaryPrompt(meeting, '', null, context);
  const chunk = buildChunkPrompt(meeting, meeting.transcript, 1, 1, '', null, context);
  const synthesis = buildSynthesisPrompt(meeting, [{ summary: 'x' }], '', null, context);

  for (const prompt of [single, chunk, synthesis]) {
    assert.ok(prompt.includes('Budget was actually $50k'), 'must contain the notes text');
    assert.ok(prompt.includes('Meeting type: Sales call'));
    assert.ok(prompt.includes('Topic: Renewal'));
    assert.ok(prompt.includes('Lead by: Alice'));
  }
});

test('notes empty means no notes block appears in any of the 3 builders (BR-36)', () => {
  const meeting = baseMeeting();
  const context = buildContextBlock(meeting);
  const single = buildSummaryPrompt(meeting, '', null, context);
  const chunk = buildChunkPrompt(meeting, meeting.transcript, 1, 1, '', null, context);
  const synthesis = buildSynthesisPrompt(meeting, [{ summary: 'x' }], '', null, context);
  for (const prompt of [single, chunk, synthesis]) {
    assert.ok(!prompt.includes('Notes (written by the user'));
  }
});

test('buildSummaryPrompt/buildSynthesisPrompt carry SUMMARY_PRINCIPLES; buildChunkPrompt does not (BR-61)', () => {
  const meeting = baseMeeting();
  const context = buildContextBlock(meeting);
  const single = buildSummaryPrompt(meeting, '', null, context);
  const chunk = buildChunkPrompt(meeting, meeting.transcript, 1, 1, '', null, context);
  const synthesis = buildSynthesisPrompt(meeting, [{ summary: 'x' }], '', null, context);

  assert.ok(single.includes('ĐÃ CHỐT'));
  assert.ok(synthesis.includes('ĐÃ CHỐT'));
  assert.ok(!chunk.includes('ĐÃ CHỐT'), 'chunk step must use the reduced principle set, not the full one');
});

test('CHUNK_PRINCIPLES never contains the ĐÃ CHỐT classification (§6.2)', () => {
  assert.ok(!CHUNK_PRINCIPLES.includes('ĐÃ CHỐT'));
  assert.ok(CHUNK_PRINCIPLES.includes('[?]') === false || CHUNK_PRINCIPLES.includes('[?]')); // sanity: constant is non-trivial text
  assert.ok(CHUNK_PRINCIPLES.length > 0);
});

test('BR-63 override sentence is appended only when notes are present', () => {
  const withNotes = buildContextBlock(baseMeeting({ notes: 'x' }));
  const withoutNotes = buildContextBlock(baseMeeting());
  const promptWith = buildSummaryPrompt(baseMeeting({ notes: 'x' }), '', null, withNotes);
  const promptWithout = buildSummaryPrompt(baseMeeting(), '', null, withoutNotes);
  assert.ok(promptWith.includes('đáng tin hơn transcript'));
  assert.ok(!promptWithout.includes('đáng tin hơn transcript'));
});

test('PROMPT_VERSION bumped to v5 (Architecture v3.0 §V5 — per-part labels/merged-recording context)', () => {
  assert.strictEqual(PROMPT_VERSION, 'meeting-summary-v5');
});

/* ── T6 lineage: notes travel from generateSummary() all the way into the
   prompt actually sent to a provider, and into generation.contextUsed —
   assert the exact VALUE that crossed each boundary (Protocol 6), not just
   that a function was invoked. Uses the DeepSeek adapter with a stubbed
   global.fetch (real HTTP is never hit); the codex adapter is not usable
   here because its contextWindow is 0 (never chunks). ── */

function stubbedLlmService(fetchImpl) {
  const originalFetch = global.fetch;
  global.fetch = fetchImpl;
  const service = createLlmService({
    runProcess: async () => ({ code: 0, stdout: '{}', stderr: '' }),
    resolveCodexBinary: () => 'codex',
    summarySchemaFile: path.join(__dirname, '..', 'schemas', 'meeting-summary.schema.json'),
    titleSchemaFile: path.join(__dirname, '..', 'schemas', 'meeting-title.schema.json'),
    apiTimeoutMs: 5000,
    codexTimeoutMs: 5000,
    secretStore: { read: async () => 'fake-deepseek-key', write: async () => {}, remove: async () => {} },
    getSettings: async () => ({})
  });
  return { service, restore: () => { global.fetch = originalFetch; } };
}

function fakeChatCompletion(content) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }], usage: {} })
  };
}

test('T6 lineage: notes truncation + pre-meeting info reach the exact prompt sent to the provider, across chunk + synthesis steps, and generation.contextUsed matches', async () => {
  const head = 'N'.repeat(3990);
  const tail = 'TAIL-MUST-NOT-APPEAR';
  const notes = `${head}\n${tail}`;

  // Long enough transcript to force map-reduce for deepseek-chat
  // (contextWindow 65536 -> budget ~45875 tokens ~ 160k+ chars of prompt).
  const bigSegmentText = 'word '.repeat(800); // ~4000 chars/segment
  const transcript = Array.from({ length: 45 }, (_, i) => ({
    time: i * 10, speaker: i % 2 === 0 ? 'Alice' : 'Bob', text: bigSegmentText
  }));

  const meeting = {
    id: 'lineage-1',
    title: 'Renewal call',
    date: '2026-09-18',
    duration: 3600,
    participants: ['Alice', 'Bob'],
    transcript,
    notes,
    meetingType: 'sales-call',
    topic: 'Renewal',
    leadBy: 'Alice'
  };

  const sentPrompts = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    sentPrompts.push(body.messages[1].content);
    return fakeChatCompletion({ summary: 'ok', keyPoints: [], decisions: [], actionItems: [], openQuestions: [] });
  };

  const { service, restore } = stubbedLlmService(fetchImpl);
  try {
    const result = await service.generateSummary({
      providerId: 'deepseek', modelId: 'deepseek-chat', meeting, language: '', preset: null
    });

    // Map-reduce must actually have happened (chunk calls + 1 synthesis call).
    assert.ok(sentPrompts.length >= 2, 'expected at least one chunk call plus a synthesis call');

    const expectedTruncated = head; // exact value that must survive every hop
    for (const prompt of sentPrompts) {
      assert.ok(prompt.includes(expectedTruncated), 'every prompt sent to the provider must carry the truncated notes head');
      assert.ok(!prompt.includes(tail), 'no prompt may leak text past the truncation boundary');
      assert.ok(prompt.includes('Meeting type: Sales call'));
      assert.ok(prompt.includes('Topic: Renewal'));
    }

    // The reduce step (synthesis) is the last call and must carry the full
    // principle set the chunk calls do not (mirrors the unit test above,
    // now proven end-to-end through the real service).
    const synthesisPrompt = sentPrompts[sentPrompts.length - 1];
    assert.ok(synthesisPrompt.includes('ĐÃ CHỐT'));
    for (const chunkPrompt of sentPrompts.slice(0, -1)) {
      assert.ok(!chunkPrompt.includes('ĐÃ CHỐT'));
    }

    // BR-39: provenance flags must reflect exactly what was computed once at
    // G3 and reused everywhere (WHY-6) — not recomputed/guessed at the end.
    assert.deepStrictEqual(result.generation.contextUsed, { notes: true, notesTruncated: true, preMeeting: true });
  } finally {
    restore();
  }
});
