/* ============================================
   MeetNote AI — DeepSeek adapter
   DeepSeek Chat Completions with JSON output.
   Endpoint is a fixed constant (no client-supplied
   base URL) to avoid SSRF.
   ============================================ */

const { LLM_ERROR, llmError, normalizeSummary, normalizeTitle, withRepair } = require('../contracts');
const { SYSTEM_INSTRUCTION } = require('../prompts');
const { postJson, httpErrorFor } = require('./api-helpers');

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

// Server-owned allowlist. Client-supplied model ids are validated against this.
const MODELS = [
  { id: 'deepseek-chat', label: 'DeepSeek Chat', contextWindow: 65536 },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', contextWindow: 65536 }
];

/**
 * @param {object} deps
 * @param {() => Promise<string>} deps.getKey resolves the API key (env or Keychain)
 * @param {number} deps.timeoutMs per-request timeout
 */
function createDeepSeekAdapter(deps) {
  const { getKey, timeoutMs } = deps;
  const id = 'deepseek';

  function modelSpec(modelId) {
    return MODELS.find(model => model.id === modelId) || MODELS[0];
  }

  async function requireKey() {
    const key = (await getKey()) || '';
    if (!key) throw llmError(LLM_ERROR.AUTH_REQUIRED, 'DeepSeek API key is not configured.', { provider: id });
    return key;
  }

  async function getStatus() {
    const configured = Boolean(await getKey());
    return {
      configured,
      available: configured,
      state: configured ? 'ready' : 'setup_required',
      message: configured ? 'DeepSeek API key is configured.' : 'Add a DeepSeek API key to enable this provider.'
    };
  }

  function listModels() {
    return MODELS.map(({ id: modelId, label }) => ({ id: modelId, label }));
  }

  function getModelSpec(model) {
    return modelSpec(model);
  }

  // Shared call path for summary + title on an already-built prompt.
  // Returns { data, usage, model }. Budget is enforced by the service.
  // DeepSeek never enforces a schema (§6.3) — `format.normalize` (when
  // present) is the entire structural contract for a preset's sections.
  async function run({ prompt, model, normalize, format }) {
    if (format) normalize = format.normalize;
    const key = await requireKey();
    const spec = modelSpec(model);

    let usage = {};
    // DeepSeek defaults max_tokens to 8K in non-thinking mode when the request
    // omits it (verified against api-docs.deepseek.com, 2026-09-20) and simply
    // truncates the JSON output past that — no error, just finish_reason
    // "length" and a cut-off response body. A preset that must preserve every
    // item (e.g. Brainstorming's "toàn bộ ý tưởng") on a long meeting easily
    // needs far more than that: a real repro (955-segment meeting, real API
    // call) needed ~27K completion tokens and hit exactly the 8192 default,
    // breaking JSON parsing downstream. Fixing that needs MORE than the ~30%
    // output reserve transcript-budget.js's INPUT_BUDGET_RATIO implies for a
    // 65536-token context window (~19.7K) — real usage came in above that
    // too — so this deliberately asks for half the window instead, verified
    // safe against a real call (an oversized max_tokens does not error; the
    // model just stops naturally at finish_reason "stop").
    //
    // deepseek-reasoner ("thinking mode") is NOT covered by this — its
    // default max_tokens is documented as 64K, i.e. already above this half-
    // window value, and no real call against it has been made to check
    // whether an explicit lower max_tokens changes its behavior (e.g. a
    // separate reasoning-token budget). Only override for deepseek-chat,
    // the model this bug was actually reported and verified against; leave
    // deepseek-reasoner requesting DeepSeek's own default until that's
    // verified for real too (see docs/CHANGELOG.md Known issues).
    const maxTokens = spec.id === 'deepseek-chat' ? Math.floor(spec.contextWindow / 2) : undefined;
    const callModel = async repairHint => {
      const messages = [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt }
      ];
      if (repairHint) messages.push({ role: 'user', content: repairHint });

      const response = await postJson(ENDPOINT, {
        headers: { Authorization: `Bearer ${key}` },
        body: {
          model: spec.id,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: maxTokens,
          stream: false
        },
        timeoutMs,
        provider: id
      });
      if (!response.ok) throw await httpErrorFor(response, id, body => body?.error?.message);

      const body = await response.json().catch(() => ({}));
      const choice = body?.choices?.[0];
      usage = {
        inputTokens: Number(body?.usage?.prompt_tokens) || 0,
        outputTokens: Number(body?.usage?.completion_tokens) || 0
      };
      // Surface truncation as its own clear error instead of letting the
      // cut-off JSON fall through to normalize()'s generic "unreadable
      // summary" message, which gave no hint at the actual cause. skipRepair
      // is set because withRepair's one-shot "ask it to fix the JSON" retry
      // reuses this exact same max_tokens — a length-truncated response would
      // just truncate again the same way, silently doubling latency/cost for
      // a retry that can never succeed.
      if (choice?.finish_reason === 'length') {
        console.warn(`[deepseek.output_truncated] model=${spec.id} maxTokens=${maxTokens ?? '(provider default)'} completionTokens=${usage.outputTokens}`);
        throw llmError(
          LLM_ERROR.INVALID_OUTPUT,
          'DeepSeek cut the response short before it finished (too long for the current output limit). Try Regenerate, or use a preset with fewer/shorter sections.',
          { provider: id, skipRepair: true }
        );
      }
      return choice?.message?.content || '';
    };

    const data = await withRepair(callModel, raw => normalize(raw, id), id);
    return { data, usage, model: spec.id };
  }

  async function testConnection() {
    // Minimal, cheap round trip to verify the key works.
    const key = await requireKey();
    const response = await postJson(ENDPOINT, {
      headers: { Authorization: `Bearer ${key}` },
      body: { model: MODELS[0].id, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false },
      timeoutMs,
      provider: id
    });
    if (!response.ok) throw await httpErrorFor(response, id, body => body?.error?.message);
    return { ok: true, message: 'DeepSeek connection succeeded.' };
  }

  return {
    id,
    name: 'DeepSeek',
    kind: 'api',
    needsKey: true,
    getStatus,
    listModels,
    getModelSpec,
    testConnection,
    summarize: ({ prompt, model, format }) => run({ prompt, model, normalize: normalizeSummary, format }),
    title: ({ prompt, model }) => run({ prompt, model, normalize: normalizeTitle })
  };
}

module.exports = { createDeepSeekAdapter, MODELS };
