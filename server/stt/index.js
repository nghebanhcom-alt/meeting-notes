/* ============================================
   MeetNote AI — STT service & provider registry
   The single surface server.js uses for file-upload
   transcription. Routes never learn a provider's format.
   (Live streaming stays in the browser transcriber.)
   ============================================ */

const { STT_ERROR, sttError, tagProvider, normalizeResult, DURATION_KINDS } = require('./contracts');
const { createSonioxAdapter } = require('./providers/soniox');
const { createDeepgramAdapter } = require('./providers/deepgram');
const { createWhisperAdapter } = require('./providers/whisper');
const { createGoogleAdapter } = require('./providers/google');

const DEFAULT_PROVIDER = 'soniox';

// Keychain account + dev env var per provider. OpenAI/Whisper shares the
// standard OpenAI key so it can coexist with other OpenAI usage.
const SECRET_CONFIG = {
  soniox: { account: 'soniox-api-key', envKey: 'SONIOX_API_KEY' },
  deepgram: { account: 'deepgram-api-key', envKey: 'DEEPGRAM_API_KEY' },
  whisper: { account: 'openai-api-key', envKey: 'OPENAI_API_KEY' },
  google: { account: 'google-api-key', envKey: 'GOOGLE_API_KEY' }
};

/**
 * @param {object} deps
 * @param {number} deps.timeoutMs per-HTTP-call timeout for API providers
 * @param {{read:Function, write:Function, remove:Function}} deps.secretStore Keychain access
 * @param {() => Promise<object>} deps.getSettings reads persisted settings.json
 */
function createSttService(deps) {
  const { timeoutMs, secretStore, getSettings } = deps;

  const makeGetKey = providerId => async () => {
    const config = SECRET_CONFIG[providerId];
    if (!config) return '';
    const fromEnv = (process.env[config.envKey] || '').trim();
    if (fromEnv) return fromEnv;
    return (await secretStore.read(config.account)) || '';
  };

  const adapters = {
    soniox: createSonioxAdapter({ getKey: makeGetKey('soniox') }),
    deepgram: createDeepgramAdapter({ getKey: makeGetKey('deepgram'), timeoutMs }),
    whisper: createWhisperAdapter({ getKey: makeGetKey('whisper'), timeoutMs }),
    google: createGoogleAdapter({ getKey: makeGetKey('google'), timeoutMs })
  };
  const ORDER = ['soniox', 'deepgram', 'whisper', 'google'];

  // One serial queue per provider so two long transcriptions never overlap.
  const queues = {};
  function enqueue(providerId, task) {
    const prev = queues[providerId] || Promise.resolve();
    const job = prev.then(task, task);
    queues[providerId] = job.catch(() => {});
    return job;
  }

  // R-S: server-side whitelist check used by routes that create a job
  // (POST /api/meetings/:id/parts) so a client can never queue work against an
  // unknown provider/model. Synchronous and side-effect free — no key lookup.
  function validateSelection(providerId, modelId) {
    const adapter = getAdapter(providerId);
    if (modelId) {
      const ids = adapter.listModels().map(model => model.id);
      if (!ids.includes(modelId)) {
        throw sttError(STT_ERROR.MODEL_NOT_SUPPORTED, `Model "${modelId}" is not supported for ${adapter.name}.`, { provider: adapter.id });
      }
    }
    return adapter;
  }

  function getAdapter(providerId) {
    const adapter = adapters[providerId];
    if (!adapter) {
      throw sttError(STT_ERROR.PROVIDER_NOT_FOUND, `Unknown provider "${providerId}".`, { provider: providerId });
    }
    return adapter;
  }

  function resolveModel(adapter, requestedModel, settings) {
    const ids = adapter.listModels().map(model => model.id);
    if (requestedModel) {
      if (!ids.includes(requestedModel)) {
        throw sttError(STT_ERROR.MODEL_NOT_SUPPORTED, `Model "${requestedModel}" is not supported for ${adapter.name}.`, { provider: adapter.id });
      }
      return requestedModel;
    }
    const preferred = settings?.sttModels?.[adapter.id];
    if (preferred && ids.includes(preferred)) return preferred;
    return ids[0];
  }

  function resolveDefaultProvider(settings) {
    const candidate = settings?.sttProvider;
    return candidate && adapters[candidate] ? candidate : DEFAULT_PROVIDER;
  }

  // Transcribe stored audio. `audioMeta` ({ size, mimeType, filename }) is
  // inspected first so an oversized file is rejected before `loadAudio()` reads
  // it into memory (guards the Node process). `loadAudio` returns the bytes.
  async function transcribe({ providerId, modelId, audioMeta, loadAudio, language, translationLanguage, meetingTitle, participants }) {
    const settings = await getSettings();
    const resolvedProvider = providerId || resolveDefaultProvider(settings);
    const adapter = getAdapter(resolvedProvider);
    const model = resolveModel(adapter, modelId, settings);

    const limit = Number(adapter.maxUploadBytes) || 0;
    if (limit && Number(audioMeta?.size) > limit) {
      const mb = Math.round(limit / (1024 * 1024));
      throw sttError(STT_ERROR.AUDIO_TOO_LARGE, `${adapter.name} accepts audio up to ${mb} MB. Use a smaller recording or another provider.`, { provider: adapter.id });
    }

    const buffer = await loadAudio();
    const audio = { buffer, mimeType: audioMeta?.mimeType, filename: audioMeta?.filename, size: audioMeta?.size ?? buffer.length };
    const raw = await enqueue(adapter.id, () =>
      adapter.transcribe({ audio, language, translationLanguage, model, meetingTitle, participants })
        .catch(error => { throw tagProvider(error, adapter.id); }));

    const normalized = normalizeResult(raw, adapter.id);
    // Protocol 8.3: ask the adapter's own declared capability rather than
    // trusting every adapter to echo `durationKind` correctly in its raw
    // result — one place decides, adapters just answer "what kind of number
    // is this for this model" (R-AC/WHY-V5).
    if (typeof adapter.durationKindFor === 'function') {
      const kind = adapter.durationKindFor(model);
      if (DURATION_KINDS.has(kind)) normalized.durationKind = kind;
    }
    return normalized;
  }

  async function listProviders() {
    const settings = await getSettings();
    const defaultProvider = resolveDefaultProvider(settings);
    const providers = await Promise.all(ORDER.map(async providerId => {
      const adapter = adapters[providerId];
      const status = await adapter.getStatus().catch(error => ({
        configured: false, available: false, state: 'unavailable', message: error.message || 'Status check failed.'
      }));
      return {
        id: adapter.id,
        name: adapter.name,
        kind: adapter.kind,
        needsKey: adapter.needsKey,
        supportsTranslation: Boolean(adapter.supportsTranslation),
        supportsLive: Boolean(adapter.supportsLive),
        configured: Boolean(status.configured),
        available: Boolean(status.available),
        state: status.state || (status.available ? 'ready' : 'setup_required'),
        // R-AE: built from an explicit field whitelist, same as every other
        // field here — never spread `status`/`adapter` (that would leak
        // whatever a future adapter change puts on those objects, keys
        // included). Test asserts the body never contains a live API key.
        message: status.message || '',
        // BR-141: read straight off the adapter — the exact value
        // `stt.transcribe` enforces (server/stt/index.js above) and the exact
        // table `server/stt/providers/*.js` declare via `../formats`.
        maxUploadBytes: Number(adapter.maxUploadBytes) || 0,
        formats: adapter.formats || { accepted: [], legacy: [], rejected: [], sourceVerified: false },
        models: adapter.listModels(),
        selectedModel: resolveModel(adapter, settings?.sttModels?.[adapter.id], settings)
      };
    }));
    return { defaultProvider, providers };
  }

  function requireConfig(providerId) {
    const config = SECRET_CONFIG[providerId];
    if (!adapters[providerId]) {
      throw sttError(STT_ERROR.PROVIDER_NOT_FOUND, `Unknown provider "${providerId}".`, { provider: providerId });
    }
    return config;
  }

  async function saveKey(providerId, apiKey) {
    await secretStore.write(requireConfig(providerId).account, apiKey);
  }

  async function removeKey(providerId) {
    await secretStore.remove(requireConfig(providerId).account);
  }

  async function testConnection(providerId) {
    const adapter = getAdapter(providerId);
    try {
      return await adapter.testConnection();
    } catch (error) {
      throw tagProvider(error, providerId);
    }
  }

  // Mint a short-lived credential for a browser live-streaming session.
  async function temporaryKey(providerId) {
    const adapter = getAdapter(providerId);
    if (typeof adapter.grantTemporaryKey !== 'function') {
      throw sttError(STT_ERROR.MODEL_NOT_SUPPORTED, `${adapter.name} does not support live streaming.`, { provider: providerId });
    }
    try {
      return await adapter.grantTemporaryKey();
    } catch (error) {
      throw tagProvider(error, providerId);
    }
  }

  return { transcribe, listProviders, saveKey, removeKey, testConnection, temporaryKey, validateSelection };
}

module.exports = { createSttService, DEFAULT_PROVIDER, SECRET_CONFIG };
