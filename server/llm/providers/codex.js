/* ============================================
   MeetNote AI — Codex adapter
   Wraps the local Codex CLI (ChatGPT/Codex account).
   Runs ephemeral, read-only, schema-enforced calls.
   Exposes prompt-level primitives; the service owns
   prompt building and long-transcript orchestration.
   ============================================ */

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { LLM_ERROR, llmError, normalizeSummary, normalizeTitle } = require('../contracts');

// Codex resolves its own model from the signed-in account. contextWindow 0
// means "let Codex handle length" — the service skips chunking for it.
const MODELS = [{ id: 'default', label: 'Account default', contextWindow: 0 }];

function codexArgs(schemaFile) {
  return [
    'exec',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--color', 'never',
    '--output-schema', schemaFile,
    '-'
  ];
}

/**
 * @param {object} deps
 * @param {Function} deps.runProcess shared child-process runner
 * @param {Function} deps.resolveCodexBinary returns the codex executable path
 * @param {string} deps.summarySchemaFile absolute path to summary JSON schema
 * @param {string} deps.titleSchemaFile absolute path to title JSON schema
 * @param {string} [deps.tmpSchemaDir] absolute dir for per-request preset schema files (§6.1)
 * @param {number} deps.timeoutMs per-invocation timeout
 */
function createCodexAdapter(deps) {
  const {
    runProcess, resolveCodexBinary, summarySchemaFile, titleSchemaFile, timeoutMs,
    tmpSchemaDir = path.join(path.dirname(summarySchemaFile), '.tmp')
  } = deps;
  const id = 'codex';

  // A preset's schema must live under schemas/ — the only path verified to
  // be readable under --sandbox read-only (§6.1, WHY-7) — and survive both
  // runStructured attempts (initial + one repair retry) before cleanup.
  async function withTempSchemaFile(jsonSchema, run) {
    await fsp.mkdir(tmpSchemaDir, { recursive: true });
    const file = path.join(tmpSchemaDir, `${crypto.randomUUID()}.json`);
    await fsp.writeFile(file, JSON.stringify(jsonSchema), 'utf8');
    try {
      return await run(file);
    } finally {
      await fsp.rm(file, { force: true });
    }
  }

  async function runCodex(prompt, schemaFile) {
    let result;
    try {
      result = await runProcess(resolveCodexBinary(), codexArgs(schemaFile), { input: prompt, timeoutMs });
    } catch (error) {
      if (error.statusCode === 504) {
        throw llmError(LLM_ERROR.TIMEOUT, 'Codex timed out while generating the response.', { provider: id });
      }
      throw llmError(LLM_ERROR.PROVIDER_UNAVAILABLE, 'Codex could not be started. Is it installed?', { provider: id });
    }

    if (result.code !== 0) {
      const detail = result.stderr.trim().split('\n').slice(-4).join(' ');
      if (/not logged in|login|unauthor/i.test(detail)) {
        throw llmError(LLM_ERROR.AUTH_REQUIRED, 'Codex is not logged in. Run "codex login" and sign in with ChatGPT.', { provider: id });
      }
      throw llmError(LLM_ERROR.PROVIDER_UNAVAILABLE, detail || 'Codex could not generate the response.', { provider: id });
    }
    return result.stdout.trim();
  }

  // Run a schema-enforced prompt, validate, and retry once on schema drift.
  async function runStructured(prompt, schemaFile, normalize) {
    let raw = await runCodex(prompt, schemaFile);
    try {
      return normalize(raw, id);
    } catch (error) {
      if (error.llmCode !== LLM_ERROR.INVALID_OUTPUT) throw error;
    }
    raw = await runCodex(prompt, schemaFile);
    return normalize(raw, id);
  }

  async function getStatus() {
    const result = await runProcess(resolveCodexBinary(), ['login', 'status'], { timeoutMs: 10_000 })
      .catch(error => ({ code: -1, stdout: '', stderr: error.message }));
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const installed = result.code !== -1;
    const loggedIn = result.code === 0 && /logged in/i.test(output);
    const method = /using chatgpt/i.test(output) ? 'chatgpt' : (/api key/i.test(output) ? 'api-key' : '');
    return {
      configured: installed,
      available: loggedIn,
      state: !installed ? 'unavailable' : (loggedIn ? 'ready' : 'setup_required'),
      method,
      message: loggedIn
        ? `Codex is logged in with ${method === 'chatgpt' ? 'a ChatGPT subscription' : 'an API key'}.`
        : (installed ? 'Run "codex login" in Terminal or PowerShell to enable summaries.' : 'Codex CLI was not found on this computer.')
    };
  }

  function listModels() {
    return MODELS.map(({ id: modelId, label }) => ({ id: modelId, label }));
  }

  function getModelSpec() {
    return MODELS[0];
  }

  async function testConnection() {
    const status = await getStatus();
    if (!status.available) throw llmError(LLM_ERROR.AUTH_REQUIRED, status.message, { provider: id });
    return { ok: true, message: status.message };
  }

  return {
    id,
    name: 'Codex (ChatGPT)',
    kind: 'cli',
    needsKey: false,
    getStatus,
    listModels,
    getModelSpec,
    testConnection,
    summarize: ({ prompt, format }) => (format
      ? withTempSchemaFile(format.jsonSchema, schemaFile => runStructured(prompt, schemaFile, format.normalize))
      : runStructured(prompt, summarySchemaFile, normalizeSummary)
    ).then(data => ({ data, usage: {}, model: 'default' })),
    title: ({ prompt }) => runStructured(prompt, titleSchemaFile, normalizeTitle)
      .then(data => ({ data, usage: {}, model: 'default' }))
  };
}

module.exports = { createCodexAdapter };
