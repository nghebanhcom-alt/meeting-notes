'use strict';

// Bug fix (2026-09-20): DeepSeek summary generation failed with "The provider
// returned an unreadable summary." for a preset that must preserve every item
// (Brainstorming) on a long meeting. Root cause verified with a REAL call to
// https://api.deepseek.com/chat/completions (Protocol 5.1/5.3): DeepSeek
// defaults max_tokens to 8K in non-thinking mode when the request omits it,
// silently truncating the JSON output (finish_reason "length") instead of
// erroring — the code never set max_tokens and never checked finish_reason.
// A synthetic 955-segment meeting from the real user's own "University
// dashboard" recording needed ~27K completion tokens and hit exactly the
// 8192-token default. That real meeting's content is NOT committed here
// (it's a real user's private meeting) — these tests use synthetic dummy
// data (same convention as tests/fixtures/deepseek/dynamic-sections.json)
// to exercise the same code path cheaply and repeatably.
//
// Fix: server/llm/providers/deepseek.js now sends an explicit
// max_tokens (half the model's declared contextWindow) and treats
// finish_reason "length" as its own clear error instead of letting the
// cut-off JSON fall through to a generic parse failure.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFile } = require('node:child_process');
const { createDeepSeekAdapter, MODELS } = require('../server/llm/providers/deepseek');

function readKeychainSecret(account) {
  return new Promise(resolve => {
    execFile('security', ['find-generic-password', '-a', account, '-s', 'meetnote-local', '-w'], (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

async function resolveKey() {
  return (process.env.DEEPSEEK_API_KEY || '').trim() || readKeychainSecret('deepseek-api-key');
}

/* ── Unit tests: our own request/response handling, mocked fetch ──
   The mocked response shape (choices[].finish_reason, usage.*) is the
   standard OpenAI-compatible completions contract this codebase already
   relies on elsewhere (deepseek.js's existing body?.choices?.[0]?...) — not
   a new claim about DeepSeek being asserted here, only OUR reaction to it. */

function withMockedFetch(handler, run) {
  const original = global.fetch;
  global.fetch = handler;
  return run().finally(() => { global.fetch = original; });
}

test('deepseek adapter: sends an explicit max_tokens (half the model contextWindow), not DeepSeek\'s own low default', async () => {
  let capturedBody = null;
  await withMockedFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"summary":"ok","keyPoints":[],"decisions":[],"actionItems":[],"openQuestions":[]}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    };
  }, async () => {
    const adapter = createDeepSeekAdapter({ getKey: async () => 'fake-key', timeoutMs: 5000 });
    await adapter.summarize({ prompt: 'dummy prompt', model: 'deepseek-chat' });
  });

  const spec = MODELS.find(m => m.id === 'deepseek-chat');
  assert.strictEqual(capturedBody.max_tokens, Math.floor(spec.contextWindow / 2));
});

test('deepseek adapter: does NOT override max_tokens for deepseek-reasoner (unverified for "thinking mode" — see CHANGELOG Known issues)', async () => {
  let capturedBody = null;
  await withMockedFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"summary":"ok","keyPoints":[],"decisions":[],"actionItems":[],"openQuestions":[]}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    };
  }, async () => {
    const adapter = createDeepSeekAdapter({ getKey: async () => 'fake-key', timeoutMs: 5000 });
    await adapter.summarize({ prompt: 'dummy prompt', model: 'deepseek-reasoner' });
  });

  assert.strictEqual(capturedBody.max_tokens, undefined, 'deepseek-reasoner should keep using DeepSeek\'s own default until verified for real');
});

test('deepseek adapter: finish_reason "length" raises a clear cut-off error instead of a generic parse failure, without retrying via withRepair', async () => {
  let fetchCallCount = 0;
  await withMockedFetch(async () => {
    fetchCallCount += 1;
    return {
      ok: true,
      json: async () => ({
        // Deliberately-synthetic placeholder content, cut off mid-string —
        // only the SHAPE matters (unterminated JSON string), not real words.
        // NOT derived from any real meeting; every "real repro" claim in
        // this file/CHANGELOG refers to metadata (finish_reason, token
        // counts) captured separately, never this literal string.
        choices: [{ message: { content: '{"summary":"placeholder","keyPoints":["placeholder-item-one","placeholder-item-tw' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 40000, completion_tokens: 8192 }
      })
    };
  }, async () => {
    const adapter = createDeepSeekAdapter({ getKey: async () => 'fake-key', timeoutMs: 5000 });
    await assert.rejects(
      () => adapter.summarize({ prompt: 'dummy prompt', model: 'deepseek-chat' }),
      error => {
        assert.strictEqual(error.llmCode, 'LLM_INVALID_OUTPUT');
        assert.match(error.message, /cut.*short|too long/i);
        return true;
      }
    );
  });
  // withRepair must NOT retry a truncation failure (same max_tokens would
  // just truncate again) — exactly one HTTP call, not the usual two.
  assert.strictEqual(fetchCallCount, 1, 'expected no repair retry for a length-truncated response');
});

/* ── Real smoke test (Protocol 5.4) — cheap, synthetic dummy meeting so it
   stays fast; skipped when no DeepSeek key is available on this machine. ── */

test('deepseek adapter: real API smoke test — small dummy meeting completes without truncation', async t => {
  const key = await resolveKey();
  if (!key) {
    t.skip('No DEEPSEEK_API_KEY env var and no "deepseek-api-key" entry in the macOS Keychain (service "meetnote-local"). Not counted as passing coverage — see Protocol 5.4.');
    return;
  }

  const adapter = createDeepSeekAdapter({ getKey: async () => key, timeoutMs: 60000 });
  const prompt = `You are a meeting analyst. Return only JSON matching this schema: ` +
    `{"summary": string, "keyPoints": string[], "decisions": string[], "actionItems": [], "openQuestions": string[]}.\n\n` +
    `<meeting_data>\nTitle: Weekly sync\nParticipants: Alex, Jamie\nTranscript:\n` +
    `[0:00] Alex: Let's push the pilot to Friday.\n[0:05] Jamie: Agreed, I'll own load testing.\n</meeting_data>`;

  const result = await adapter.summarize({ prompt, model: 'deepseek-chat' });
  assert.ok(result.data.summary, 'expected a non-empty summary');
  assert.ok(result.usage.outputTokens > 0);
});
