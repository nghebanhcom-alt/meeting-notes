const http = require('http');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { spawn } = require('child_process');
const { createLlmService, DEFAULT_PROVIDER } = require('./server/llm');
const { createSttService, DEFAULT_PROVIDER: DEFAULT_STT_PROVIDER } = require('./server/stt');
const { instantiateBuiltIns, validatePreset } = require('./server/llm/presets');
const { snapshotOf } = require('./server/llm/preset-schema');
const { isKnownMeetingTypeCode } = require('./server/meeting-types');
const { resolveAudioMime, APP_ACCEPTED_EXTENSIONS, statusFor, extensionOf } = require('./server/stt/formats');
const {
  isValidPartId, MAX_PARTS_PER_MEETING, registerParts, applyPartResult, markPartFailed,
  markPartRunning, retryPart, dropPart, reorderParts, preserveServerOwnedFields
} = require('./server/meeting-parts');
const { buildFileName } = require('./server/export/filename');
const { validateExportDir, writeExportFile } = require('./server/export/dir');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8765;
const ROOT_DIR = __dirname;
const STORAGE_DIR = path.resolve(process.env.MEETNOTE_STORAGE_DIR || path.join(ROOT_DIR, 'storage'));
const AUDIO_DIR = path.join(STORAGE_DIR, 'audio');
const TRANSCRIPTS_DIR = path.join(STORAGE_DIR, 'transcripts');
const SUMMARIES_DIR = path.join(STORAGE_DIR, 'summaries');
const SECRETS_DIR = path.join(STORAGE_DIR, 'secrets');
const MEETINGS_FILE = path.join(STORAGE_DIR, 'meetings.json');
const SETTINGS_FILE = path.join(STORAGE_DIR, 'settings.json');
const JOBS_FILE = path.join(STORAGE_DIR, 'jobs.json');
const PRESETS_FILE = path.join(STORAGE_DIR, 'presets.json');
const EXPORT_SETTINGS_FILE = path.join(STORAGE_DIR, 'export-settings.json');
const MAX_EXPORT_CONTENT_BYTES = 8 * 1024 * 1024;
const LOGS_DIR = path.join(STORAGE_DIR, 'logs');
const APP_LOG_FILE = path.join(LOGS_DIR, 'meetnote.log');
const BUG_REPORTS_DIR = path.join(STORAGE_DIR, 'bug-reports');
const APP_VERSION = require('./package.json').version;
const SUMMARY_SCHEMA_FILE = path.join(ROOT_DIR, 'schemas', 'meeting-summary.schema.json');
const TITLE_SCHEMA_FILE = path.join(ROOT_DIR, 'schemas', 'meeting-title.schema.json');
const PRESET_SCHEMA_TMP_DIR = path.join(ROOT_DIR, 'schemas', '.tmp');
const MAX_JSON_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CODEX_OUTPUT_BYTES = 4 * 1024 * 1024;
const CODEX_TIMEOUT_MS = 3 * 60 * 1000;
const LLM_API_TIMEOUT_MS = 2 * 60 * 1000;
// Was sharing LLM_API_TIMEOUT_MS (2 min): Deepgram/Whisper upload the whole
// audio file IN this same HTTP call, so a large merged-part recording could
// never finish in 2 minutes (Architecture §V10/WHY-V10). 30 min covers the
// upload of the largest file the app itself allows (1 GB, Deepgram).
const STT_API_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_CONCURRENT_TRANSCRIPTIONS = 2; // BR-88; not yet measured under real 2×500MB load (U-V3)
// BR-102 watchdog: never stuck "processing" forever. Overridable so tests
// don't have to wait 6 real hours to see a job time out.
const JOB_MAX_WALL_MS = Number(process.env.MEETNOTE_JOB_MAX_WALL_MS) || 6 * 60 * 60 * 1000;
const KEYCHAIN_SERVICE = 'meetnote-local';
const SONIOX_KEYCHAIN_ACCOUNT = 'soniox-api-key';
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_CLIENT_LOG_MESSAGE = 4000;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

async function ensureStorage() {
  await Promise.all([
    fsp.mkdir(AUDIO_DIR, { recursive: true }),
    fsp.mkdir(TRANSCRIPTS_DIR, { recursive: true }),
    fsp.mkdir(SUMMARIES_DIR, { recursive: true }),
    fsp.mkdir(SECRETS_DIR, { recursive: true }),
    fsp.mkdir(LOGS_DIR, { recursive: true }),
    fsp.mkdir(BUG_REPORTS_DIR, { recursive: true })
  ]);
  await ensureJsonFile(MEETINGS_FILE, []);
  await ensureJsonFile(SETTINGS_FILE, {});
  await ensureJsonFile(JOBS_FILE, []);
  await ensureJsonFile(PRESETS_FILE, []);
  await ensureJsonFile(EXPORT_SETTINGS_FILE, {});
  await migrateLlmSettings();
}

// Default any pre-existing install to today's providers so upgrades keep working.
async function migrateLlmSettings() {
  const settings = await readJson(SETTINGS_FILE, {});
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
  let changed = false;
  if (typeof settings.llmProvider !== 'string' || !settings.llmProvider) {
    settings.llmProvider = DEFAULT_PROVIDER;
    if (!settings.llmModels || typeof settings.llmModels !== 'object') settings.llmModels = { codex: 'default' };
    changed = true;
  }
  if (typeof settings.sttProvider !== 'string' || !settings.sttProvider) {
    settings.sttProvider = DEFAULT_STT_PROVIDER;
    if (!settings.sttModels || typeof settings.sttModels !== 'object') settings.sttModels = {};
    changed = true;
  }
  if (changed) await atomicWriteJson(SETTINGS_FILE, settings);
}

async function ensureJsonFile(filePath, defaultValue) {
  try {
    await fsp.access(filePath);
  } catch {
    await atomicWriteJson(filePath, defaultValue);
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(tempPath, filePath);
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return value.slice(0, MAX_CLIENT_LOG_MESSAGE);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeDiagnosticValue(item, depth + 1));
  if (!value || typeof value !== 'object') return String(value || '');

  const sanitized = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    if (/api.?key|secret|token|authorization|password/i.test(key)) {
      sanitized[key] = '[redacted]';
    } else {
      sanitized[key] = sanitizeDiagnosticValue(item, depth + 1);
    }
  }
  return sanitized;
}

let logWriteQueue = Promise.resolve();

function logEvent(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
    event: String(event || 'app.event').slice(0, 120),
    details: sanitizeDiagnosticValue(details)
  };

  logWriteQueue = logWriteQueue.catch(() => {}).then(async () => {
    await fsp.mkdir(LOGS_DIR, { recursive: true });
    const stat = await fsp.stat(APP_LOG_FILE).catch(() => null);
    if (stat && stat.size >= MAX_LOG_BYTES) {
      await fsp.rm(`${APP_LOG_FILE}.1`, { force: true });
      await fsp.rename(APP_LOG_FILE, `${APP_LOG_FILE}.1`);
    }
    await fsp.appendFile(APP_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  });
  logWriteQueue.catch(error => console.error('Could not write diagnostic log:', error));
  return logWriteQueue;
}

async function readRecentLogEntries(limit = 200) {
  const text = await fsp.readFile(APP_LOG_FILE, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return text.trim().split('\n').filter(Boolean).slice(-limit).map(line => {
    try { return JSON.parse(line); } catch { return { timestamp: '', level: 'warn', event: 'log.parse_failed' }; }
  });
}

async function summarizeAudioStorage() {
  const files = await fsp.readdir(AUDIO_DIR, { withFileTypes: true }).catch(() => []);
  const audioFiles = files.filter(entry => entry.isFile() && entry.name.endsWith('.audio'));
  let totalBytes = 0;
  for (const entry of audioFiles) {
    const stat = await fsp.stat(path.join(AUDIO_DIR, entry.name)).catch(() => null);
    totalBytes += stat?.size || 0;
  }
  return { fileCount: audioFiles.length, totalBytes };
}

function safeSettingsForDiagnostics(settings) {
  const allowed = [
    'language', 'translationLanguage', 'theme', 'uiLanguage', 'autoSave',
    'showTimestamps', 'llmProvider', 'llmModels', 'sttProvider', 'sttModels'
  ];
  return Object.fromEntries(allowed.filter(key => settings[key] !== undefined).map(key => [key, settings[key]]));
}

async function createBugReport(input) {
  const [meetings, settings, audio, logs] = await Promise.all([
    readJson(MEETINGS_FILE, []),
    readJson(SETTINGS_FILE, {}),
    summarizeAudioStorage(),
    readRecentLogEntries()
  ]);
  const statusCounts = {};
  for (const meeting of meetings) {
    const status = String(meeting?.status || 'unknown');
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    id,
    createdAt,
    app: { name: 'MeetNote AI', version: APP_VERSION },
    userReport: {
      summary: String(input.summary || '').trim().slice(0, 200),
      description: String(input.description || '').trim().slice(0, 10000),
      contact: String(input.contact || '').trim().slice(0, 320)
    },
    environment: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      nodeVersion: process.version,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    diagnostics: {
      meetingCount: meetings.length,
      meetingStatusCounts: statusCounts,
      audio,
      settings: safeSettingsForDiagnostics(settings),
      recentLogs: logs
    },
    privacy: {
      excluded: ['audio content', 'transcripts', 'translations', 'notes', 'summaries', 'action items', 'meeting titles', 'API keys']
    }
  };
  const filename = `meetnote-bug-report-${createdAt.replace(/[:.]/g, '-')}-${id.slice(0, 8)}.json`;
  await atomicWriteJson(path.join(BUG_REPORTS_DIR, filename), report);
  await logEvent('info', 'bug_report.created', { reportId: id });
  return { filename, report };
}

// Serialize every read-modify-write operation for a JSON file. Atomic rename
// prevents torn files, while this queue prevents two requests from reading the
// same snapshot and then silently overwriting each other's changes.
const jsonMutationQueues = new Map();

function withJsonMutation(filePath, operation) {
  const previous = jsonMutationQueues.get(filePath) || Promise.resolve();
  const current = previous.then(operation, operation);
  jsonMutationQueues.set(filePath, current.catch(() => {}));
  return current;
}

function replaceJson(filePath, value) {
  return withJsonMutation(filePath, () => atomicWriteJson(filePath, value));
}

function mutateJson(filePath, fallback, mutation) {
  return withJsonMutation(filePath, async () => {
    const value = await readJson(filePath, fallback);
    const result = await mutation(value);
    await atomicWriteJson(filePath, value);
    return result;
  });
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

async function readRequestBody(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonRequest(request) {
  // Require an explicit JSON content type so a cross-site page cannot smuggle a
  // body through a CORS-safelisted text/plain "simple request".
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw Object.assign(new Error('Content-Type must be application/json'), { statusCode: 415 });
  }
  const body = await readRequestBody(request, MAX_JSON_BYTES);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

// Loopback origins the app is served from. Used to reject cross-site and
// DNS-rebinding requests against the local API.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

// A state-changing API request is trusted only when it targets our loopback
// Host (blocks DNS rebinding) and, if a browser attached an Origin, that Origin
// is ours (blocks cross-site requests). Non-browser callers omit Origin.
function isTrustedApiRequest(request) {
  if (!ALLOWED_HOSTS.has(String(request.headers.host || ''))) return false;
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return false;
  return true;
}

function hasTrustedHost(request) {
  return ALLOWED_HOSTS.has(String(request.headers.host || ''));
}

function audioKey(id) {
  return crypto.createHash('sha256').update(id).digest('hex');
}

function audioPaths(id) {
  const key = audioKey(id);
  return {
    data: path.join(AUDIO_DIR, `${key}.audio`),
    metadata: path.join(AUDIO_DIR, `${key}.json`)
  };
}

function artifactPath(directory, id) {
  return path.join(directory, `${audioKey(id)}.json`);
}

async function syncMeetingArtifacts(previousMeetings, meetings) {
  const previousById = new Map(previousMeetings.map(meeting => [meeting.id, meeting]));
  const activeArtifactNames = new Set();
  const writes = [];

  for (const meeting of meetings) {
    if (!meeting || typeof meeting.id !== 'string' || !meeting.id) continue;
    const artifactName = `${audioKey(meeting.id)}.json`;
    activeArtifactNames.add(artifactName);
    const previous = previousById.get(meeting.id);
    if (previous?.updatedAt === meeting.updatedAt) continue;

    writes.push(atomicWriteJson(artifactPath(TRANSCRIPTS_DIR, meeting.id), {
      meetingId: meeting.id,
      title: meeting.title || 'Untitled Meeting',
      language: meeting.language || '',
      translationLanguage: meeting.translationLanguage || '',
      updatedAt: meeting.updatedAt || new Date().toISOString(),
      transcript: Array.isArray(meeting.transcript) ? meeting.transcript : [],
      translations: Array.isArray(meeting.translations) ? meeting.translations : [],
      sonioxUsage: meeting.sonioxUsage || null
    }));

    if (meeting.summary || meeting.summaryDetails) {
      writes.push(atomicWriteJson(artifactPath(SUMMARIES_DIR, meeting.id), {
        meetingId: meeting.id,
        title: meeting.title || 'Untitled Meeting',
        updatedAt: meeting.updatedAt || new Date().toISOString(),
        summary: meeting.summary || '',
        details: meeting.summaryDetails || null,
        actionItems: Array.isArray(meeting.actionItems) ? meeting.actionItems : [],
        summaryPreset: meeting.summaryPreset || null
      }));
    }
  }

  await Promise.all(writes);
  await Promise.all([
    removeStaleArtifacts(TRANSCRIPTS_DIR, activeArtifactNames),
    removeStaleArtifacts(SUMMARIES_DIR, activeArtifactNames)
  ]);
}

async function removeStaleArtifacts(directory, activeNames) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json') && !activeNames.has(entry.name))
    .map(entry => fsp.rm(path.join(directory, entry.name), { force: true })));
}

function decodeAudioId(pathname) {
  try {
    const id = decodeURIComponent(pathname.slice('/api/audio/'.length));
    if (!id || id.length > 256 || id.includes('\0')) return null;
    return id;
  } catch {
    return null;
  }
}

async function saveAudio(request, id) {
  const paths = audioPaths(id);
  const tempPath = `${paths.data}.${process.pid}.${Date.now()}.tmp`;
  let total = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > MAX_AUDIO_BYTES) {
        callback(Object.assign(new Error('Audio file is too large'), { statusCode: 413 }));
        return;
      }
      callback(null, chunk);
    }
  });

  try {
    await pipeline(request, limiter, fs.createWriteStream(tempPath, { flags: 'wx' }));
    await fsp.rename(tempPath, paths.data);
    const filename = decodeAudioFilename(request.headers['x-audio-filename']);
    await atomicWriteJson(paths.metadata, {
      id,
      mimeType: resolveAudioMime(request.headers['content-type'], filename),
      filename,
      size: total,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
}

function decodeAudioFilename(value) {
  if (!value) return '';
  try {
    return path.basename(decodeURIComponent(String(value))).slice(0, 255);
  } catch {
    return '';
  }
}

function audioExtensionForMime(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('wav')) return 'wav';
  if (type.includes('flac')) return 'flac';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('aac')) return 'aac';
  return 'audio';
}

async function clearAudio() {
  await fsp.mkdir(AUDIO_DIR, { recursive: true });
  const entries = await fsp.readdir(AUDIO_DIR, { withFileTypes: true });
  await Promise.all(entries
    .filter(entry => entry.name !== '.gitkeep')
    .map(entry => fsp.rm(path.join(AUDIO_DIR, entry.name), {
      recursive: entry.isDirectory(),
      force: true
    })));
}

async function clearDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true });
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  await Promise.all(entries
    .filter(entry => entry.name !== '.gitkeep')
    .map(entry => fsp.rm(path.join(directory, entry.name), {
      recursive: entry.isDirectory(),
      force: true
    })));
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: options.env || process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(reject, Object.assign(new Error(`${path.basename(command)} timed out`), { statusCode: 504 }));
    }, options.timeoutMs || 15_000);

    child.on('error', error => finish(reject, error));
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > (options.maxOutputBytes || MAX_CODEX_OUTPUT_BYTES)) {
        child.kill('SIGTERM');
        finish(reject, Object.assign(new Error('Process output is too large'), { statusCode: 502 }));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_CODEX_OUTPUT_BYTES) stderr.push(chunk);
    });
    child.on('close', code => finish(resolve, {
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8')
    }));

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function readKeychainSecret(account) {
  if (process.platform === 'darwin') {
    const result = await runProcess('/usr/bin/security', [
      'find-generic-password',
      '-a', account,
      '-s', KEYCHAIN_SERVICE,
      '-w'
    ]).catch(() => null);
    return result?.code === 0 ? result.stdout.trim() : '';
  }
  if (process.platform === 'win32') {
    const result = await runWindowsDpapi('read', account).catch(() => null);
    return result?.code === 0 ? result.stdout.trim() : '';
  }
  return '';
}

async function writeKeychainSecret(account, secret) {
  if (process.platform === 'win32') {
    const result = await runWindowsDpapi('write', account, secret);
    if (result.code !== 0) {
      throw Object.assign(new Error('Could not save the API key with Windows Data Protection'), { statusCode: 500 });
    }
    return;
  }
  if (process.platform !== 'darwin') {
    throw Object.assign(new Error('Secure credential storage is unavailable on this platform'), { statusCode: 501 });
  }
  const result = await runProcess('/usr/bin/security', [
    'add-generic-password',
    '-U',
    '-a', account,
    '-s', KEYCHAIN_SERVICE,
    '-w', secret
  ]);
  if (result.code !== 0) {
    throw Object.assign(new Error('Could not save the API key in macOS Keychain'), { statusCode: 500 });
  }
}

async function deleteKeychainSecret(account) {
  if (process.platform === 'win32') {
    await fsp.rm(windowsSecretPath(account), { force: true });
    return;
  }
  if (process.platform !== 'darwin') return;
  // A missing item exits non-zero; treat that as already removed.
  await runProcess('/usr/bin/security', [
    'delete-generic-password',
    '-a', account,
    '-s', KEYCHAIN_SERVICE
  ]).catch(() => {});
}

function windowsSecretPath(account) {
  const key = crypto.createHash('sha256').update(`${KEYCHAIN_SERVICE}:${account}`).digest('hex');
  return path.join(SECRETS_DIR, `${key}.dpapi`);
}

async function runWindowsDpapi(action, account, secret = '') {
  await fsp.mkdir(SECRETS_DIR, { recursive: true });
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
  );
  const secretFile = windowsSecretPath(account);
  const readScript = [
    '$p=$args[0]',
    'if (!(Test-Path -LiteralPath $p)) { exit 0 }',
    '$b=[IO.File]::ReadAllBytes($p)',
    '$u=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($u))'
  ].join(';');
  const writeScript = [
    '$p=$args[0]',
    '$s=[Console]::In.ReadToEnd()',
    '$b=[Text.Encoding]::UTF8.GetBytes($s)',
    '$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[IO.File]::WriteAllBytes($p,$e)'
  ].join(';');
  return runProcess(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', action === 'write' ? writeScript : readScript,
    secretFile
  ], {
    input: action === 'write' ? secret : undefined,
    timeoutMs: 15_000,
    maxOutputBytes: 16 * 1024
  });
}

async function getSonioxApiKey() {
  return (process.env.SONIOX_API_KEY || '').trim() ||
    await readKeychainSecret(SONIOX_KEYCHAIN_ACCOUNT);
}

// Speech-to-text service for the file-upload flow. Providers stay decoupled
// from routing; the live streaming path stays in the browser transcriber.
const stt = createSttService({
  timeoutMs: STT_API_TIMEOUT_MS,
  secretStore: {
    read: readKeychainSecret,
    write: writeKeychainSecret,
    remove: deleteKeychainSecret
  },
  getSettings: () => readJson(SETTINGS_FILE, {})
});

// ── Server-owned transcription job lifecycle ──────────────────────────────────
// In-memory map of running jobs (`meetingId#partId` → { jobId, promise }).
// Used for dedupe within a single process; jobs.json is the source of truth
// across restarts. Empty partId ('') is the single-part meeting case, so its
// key (`${meetingId}#`) is exactly what the pre-v3.0 `meetingId`-only key was.
const runningJobs = new Map();

function jobKey(meetingId, partId) {
  return `${meetingId}#${partId || ''}`;
}

async function readJobs() {
  return readJson(JOBS_FILE, []);
}

const MAX_TERMINAL_JOBS = 200;

function pruneTerminalJobs(jobs) {
  const active = jobs.filter(job => job.status === 'processing' || job.status === 'queued');
  const terminal = jobs
    .filter(job => job.status !== 'processing' && job.status !== 'queued')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_TERMINAL_JOBS);
  jobs.splice(0, jobs.length, ...active, ...terminal);
}

// `partId` defaults to '' so a single-part meeting's dedupe behaves exactly
// as it did before jobs had a partId field (Architecture §V3.5).
function findActiveJob(jobs, meetingId, partId = '') {
  return jobs.find(j => j.meetingId === meetingId && (j.partId || '') === (partId || '') &&
    (j.status === 'processing' || j.status === 'queued'));
}

function countProcessingJobs(jobs) {
  return jobs.filter(job => job.status === 'processing').length;
}

// BR-88: promotes the oldest queued jobs to 'processing' up to the global
// concurrency cap, mutating `jobs` in place. The cap is global (not
// per-provider) because the constraint is this Node process's RAM holding
// full audio buffers (`loadAudio()` runs before any per-provider queue —
// server/stt/index.js), not a provider's rate limit.
function promoteQueuedJobs(jobs) {
  let processing = countProcessingJobs(jobs);
  const promoted = [];
  const queued = jobs
    .filter(job => job.status === 'queued')
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const job of queued) {
    if (processing >= MAX_CONCURRENT_TRANSCRIPTIONS) break;
    job.status = 'processing';
    job.updatedAt = new Date().toISOString();
    processing += 1;
    promoted.push(job);
  }
  return promoted;
}

// Single entry point for "start whatever can start now". Called after a job
// is created AND after any job finishes (a freed slot must be picked up
// immediately, BR-88) AND once at boot (recovered queued jobs never got a
// chance to run before the restart).
async function pumpJobQueue() {
  const promoted = await mutateJson(JOBS_FILE, [], jobs => promoteQueuedJobs(jobs));
  for (const job of promoted) {
    const key = jobKey(job.meetingId, job.partId);
    if (runningJobs.has(key)) continue; // defensive; should not happen
    if (job.partId) {
      await mutateMeeting(job.meetingId, meeting => markPartRunning(meeting, job.partId, job.id));
    }
    const promise = runTranscriptionJob(job).finally(() => {
      runningJobs.delete(key);
      pumpJobQueue().catch(err => console.error('job scheduler failed:', err));
    });
    runningJobs.set(key, { jobId: job.id, promise });
  }
}

// Targeted merge: update only transcription-related fields on a single-part
// meeting. This keeps the server as a single-field writer and avoids
// clobbering client fields (notes, actionItems, summary, etc.).
async function mergeTranscriptionIntoMeeting(meetingId, updates) {
  return mutateJson(MEETINGS_FILE, [], async meetings => {
    const index = meetings.findIndex(m => m.id === meetingId);
    if (index < 0) return false; // meeting was deleted while job was running
    const previousMeetings = meetings.map(meeting => ({ ...meeting }));
    Object.assign(meetings[index], updates, { updatedAt: new Date().toISOString() });
    await syncMeetingArtifacts(previousMeetings, meetings)
      .catch(err => console.error('artifact sync failed:', err));
    return true;
  });
}

// Multi-part equivalent of mergeTranscriptionIntoMeeting: `transform` gets the
// WHOLE current meeting and must return the whole next meeting (the
// server/meeting-parts.js functions are exactly this shape — pure
// meeting-in, meeting-out — so rebuildMergedMeeting always runs as part of
// the same transaction as the part-level write, never as a separate step
// that could be skipped).
async function mutateMeeting(meetingId, transform) {
  return mutateJson(MEETINGS_FILE, [], async meetings => {
    const index = meetings.findIndex(m => m.id === meetingId);
    if (index < 0) return false;
    const previousMeetings = meetings.map(m => ({ ...m }));
    meetings[index] = { ...transform(meetings[index]), updatedAt: new Date().toISOString() };
    await syncMeetingArtifacts(previousMeetings, meetings)
      .catch(err => console.error('artifact sync failed:', err));
    return true;
  });
}

// Only overwrites a job that is still 'processing' — a job the watchdog
// (sweepStuckJobs) already declared 'failed' for running too long must never
// be flipped back to 'completed' by a stray late response from the provider.
async function finishJob(job, patch) {
  return mutateJson(JOBS_FILE, [], jobs => {
    const stored = jobs.find(item => item.id === job.id);
    const applied = Boolean(stored && stored.status === 'processing');
    if (applied) Object.assign(stored, patch, { updatedAt: new Date().toISOString() });
    pruneTerminalJobs(jobs);
    return applied;
  });
}

// Runs stt.transcribe, persists the result onto the meeting/part BEFORE
// marking the job complete (acceptance criterion). `job.partId` (M5) — not
// `job.meetingId` — is the audio to load, so retrying/running part 2 can
// never accidentally transcribe part 1's or the whole meeting's audio.
async function runTranscriptionJob(job) {
  try {
    const audio = await openStoredAudio(job.partId || job.meetingId);
    const result = await stt.transcribe({
      providerId: job.provider,
      modelId: job.model,
      audioMeta: audio.meta,
      loadAudio: audio.load,
      language: job.language,
      translationLanguage: job.translationLanguage
    });

    const provider = result.provider || job.provider || 'soniox';
    const duration = Number(result.duration) || 0;
    const isSoniox = provider === 'soniox';
    const sonioxRate = job.translationLanguage ? 0.16 : 0.10;
    const usage = {
      provider,
      model: result.model || job.model || '',
      startedAt: job.createdAt,
      endedAt: new Date().toISOString(),
      billableDurationSeconds: duration,
      pricingUsdPerHour: isSoniox ? sonioxRate : null,
      estimatedCostUsd: isSoniox ? (duration / 3600) * sonioxRate : null,
      translationEnabled: Boolean(job.translationLanguage),
      source: 'file-upload'
    };

    if (job.partId) {
      await mutateMeeting(job.meetingId, meeting => applyPartResult(meeting, job.partId, { ...result, usage }));
    } else {
      await mergeTranscriptionIntoMeeting(job.meetingId, {
        transcript: Array.isArray(result.transcript) ? result.transcript : [],
        translations: Array.isArray(result.translations) ? result.translations : [],
        duration,
        status: 'completed',
        processingError: '',
        _activeJobId: null,
        sonioxUsage: usage
      });
    }

    // THEN mark the job completed. Keep a bounded terminal record so an unknown
    // id is never mistaken for a successfully completed job.
    await finishJob(job, { status: 'completed', error: null });
  } catch (error) {
    const errorInfo = {
      code: error.llmCode || 'STT_TRANSCRIBE_FAILED',
      message: error.message || 'Transcription failed.'
    };
    if (job.partId) {
      await mutateMeeting(job.meetingId, meeting => markPartFailed(meeting, job.partId, errorInfo));
    } else {
      await mergeTranscriptionIntoMeeting(job.meetingId, {
        status: 'failed',
        processingError: errorInfo.message,
        _activeJobId: null
      });
    }
    await finishJob(job, { status: 'failed', error: errorInfo });
  }
}

// Recover jobs that were actually processing when the server last exited —
// they cannot resume a lost provider call, so mark them failed and preserve
// the audio for retry. A 'queued' job never got a chance to call the
// provider at all, so marking it failed would be wrong (and would cost the
// user a pointless "Retry" click) — it is left exactly as-is for
// pumpJobQueue() to pick up right after this (Architecture §V3.5).
async function recoverInterruptedJobs() {
  const jobs = await readJobs();
  const stuckProcessing = jobs.filter(j => j.status === 'processing');
  if (stuckProcessing.length === 0) return;
  const now = new Date().toISOString();
  for (const job of stuckProcessing) {
    job.status = 'failed';
    job.error = { code: 'STT_SERVER_RESTARTED', message: 'The server restarted before transcription finished. The original audio is preserved — please try again.' };
    job.updatedAt = now;
    if (job.partId) {
      await mutateMeeting(job.meetingId, meeting => markPartFailed(meeting, job.partId, job.error));
    } else {
      await mergeTranscriptionIntoMeeting(job.meetingId, {
        status: 'failed',
        processingError: job.error.message,
        _activeJobId: null
      });
    }
  }
  await replaceJson(JOBS_FILE, jobs);
}

// BR-102 last-resort watchdog: a job stuck 'processing' for longer than
// JOB_MAX_WALL_MS is declared failed even though its provider call never
// actually returned — it must never look like it is stuck "processing"
// forever. Interval/threshold are overridable so tests don't wait 6 real hours.
const JOB_WATCHDOG_INTERVAL_MS = Number(process.env.MEETNOTE_JOB_WATCHDOG_INTERVAL_MS) || 5 * 60 * 1000;

async function sweepStuckJobs() {
  const jobs = await readJobs();
  const now = Date.now();
  const stuck = jobs.filter(job => job.status === 'processing' &&
    (now - new Date(job.createdAt || 0).getTime()) > JOB_MAX_WALL_MS);
  for (const job of stuck) {
    const errorInfo = { code: 'STT_JOB_TIMEOUT', message: 'This transcription took too long and was stopped automatically. Try again, or use a smaller file.' };
    const applied = await finishJob(job, { status: 'failed', error: errorInfo });
    if (!applied) continue;
    if (job.partId) {
      await mutateMeeting(job.meetingId, meeting => markPartFailed(meeting, job.partId, errorInfo));
    } else {
      await mergeTranscriptionIntoMeeting(job.meetingId, {
        status: 'failed',
        processingError: errorInfo.message,
        _activeJobId: null
      });
    }
    runningJobs.delete(jobKey(job.meetingId, job.partId));
  }
  if (stuck.length > 0) await pumpJobQueue();
}

function startJobWatchdog() {
  const timer = setInterval(() => {
    sweepStuckJobs().catch(error => console.error('job watchdog failed:', error));
  }, JOB_WATCHDOG_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

// Stat a stored recording and return its metadata + a lazy byte loader. The
// caller checks size against the provider limit before invoking the loader, so
// an oversized file is never read into memory. `id` is a meetingId (single-part
// meeting) or a partId (multi-part) — both live at the same sha256(id) path
// (Architecture §V0: "N audio/1 meeting không cần route mới").
async function openStoredAudio(id) {
  const paths = audioPaths(id);
  const [metadata, stat] = await Promise.all([
    readJson(paths.metadata, {}),
    fsp.stat(paths.data).catch(error => {
      if (error.code === 'ENOENT') throw Object.assign(new Error('Uploaded audio file was not found'), { statusCode: 404 });
      throw error;
    })
  ]);
  const mimeType = metadata.mimeType || 'application/octet-stream';
  return {
    meta: {
      mimeType,
      filename: metadata.filename || `${id}.${audioExtensionForMime(mimeType)}`,
      size: stat.size
    },
    load: () => fsp.readFile(paths.data)
  };
}

function validateMeetingForSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Meeting must be an object'), { statusCode: 400 });
  }
  const transcript = Array.isArray(value.transcript) ? value.transcript : [];
  if (transcript.length === 0) {
    throw Object.assign(new Error('The meeting has no transcript to summarize'), { statusCode: 400 });
  }
  return {
    id: typeof value.id === 'string' ? value.id.slice(0, 256) : '',
    title: typeof value.title === 'string' ? value.title.slice(0, 500) : 'Untitled Meeting',
    date: typeof value.date === 'string' ? value.date.slice(0, 64) : '',
    duration: Number.isFinite(Number(value.duration)) ? Math.max(0, Number(value.duration)) : 0,
    participants: Array.isArray(value.participants)
      ? value.participants.slice(0, 200).map(item => String(item).slice(0, 200))
      : [],
    transcript: transcript.slice(0, 50000).map(segment => ({
      time: Number.isFinite(Number(segment?.time)) ? Math.max(0, Number(segment.time)) : 0,
      speaker: typeof segment?.speaker === 'string' ? segment.speaker.slice(0, 200) : 'Speaker',
      text: typeof segment?.text === 'string' ? segment.text.slice(0, 20000) : '',
      // M12/BR-130: without `kind`/`part` here, formatTranscript never learns
      // a segment belongs to a merged recording, no matter what the client
      // sends — this used to strip them silently, the same class of bug
      // BR-32 fixed for notes/pre-meeting info.
      ...(segment?.kind === 'part-divider' || segment?.kind === 'part-gap' ? { kind: segment.kind } : {}),
      ...(Number.isFinite(Number(segment?.part)) ? { part: Math.max(0, Math.round(Number(segment.part))) } : {})
    })).filter(segment => segment.text),
    // BR-32/BR-37: without these 4 fields here, notes/pre-meeting info never
    // reach buildContextBlock (G2 of Architecture §4.1) no matter what the
    // client sends — this used to strip them silently.
    notes: typeof value.notes === 'string' ? value.notes.slice(0, 200000) : '',
    meetingType: normalizeMeetingTypeCode(value.meetingType),
    topic: normalizeShortText(value.topic),
    leadBy: normalizeShortText(value.leadBy),
    // M12/BR-130/BR-135: same reasoning — buildContextBlock's merged-recording
    // lines (§V5.3) only ever fire when these survive this clamp.
    partCount: Number.isFinite(Number(value.partCount)) ? Math.max(0, Math.round(Number(value.partCount))) : 0,
    missingParts: Array.isArray(value.missingParts)
      ? value.missingParts.filter(n => Number.isFinite(Number(n))).map(Number).slice(0, 10)
      : []
  };
}

function resolveCodexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const appBinary = '/Applications/ChatGPT.app/Contents/Resources/codex';
  if (fs.existsSync(appBinary)) return appBinary;
  return 'codex';
}

// Single LLM service the routes talk to. Providers stay decoupled from routing.
const llm = createLlmService({
  runProcess,
  resolveCodexBinary,
  summarySchemaFile: SUMMARY_SCHEMA_FILE,
  titleSchemaFile: TITLE_SCHEMA_FILE,
  tmpSchemaDir: PRESET_SCHEMA_TMP_DIR,
  apiTimeoutMs: LLM_API_TIMEOUT_MS,
  codexTimeoutMs: CODEX_TIMEOUT_MS,
  secretStore: {
    read: readKeychainSecret,
    write: writeKeychainSecret,
    remove: deleteKeychainSecret
  },
  getSettings: () => readJson(SETTINGS_FILE, {})
});

// Pull the meeting payload from either { meeting } or a legacy flat body.
function extractMeetingPayload(body) {
  return body && typeof body.meeting === 'object' && body.meeting ? body.meeting : body;
}

// Server-side half of the pre-meeting normalization table (§3.1 Architecture,
// BR-26/27/68). Mirrors js/storage.js's client-side normalize* helpers as an
// independent implementation, not a shared module — each side must keep
// enforcing its own rules even if the other is bypassed.
function normalizeMeetingTypeCode(value) {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!code) return '';
  return isKnownMeetingTypeCode(code) ? code : '';
}

function normalizeShortText(value, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeTagList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    const tag = typeof raw === 'string' ? raw.trim().slice(0, 30) : '';
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= 10) break;
  }
  return result;
}

// Only touches the 4 pre-meeting/tag fields (BR-23, BR-68) — every other
// field on `meeting` passes through untouched, same as today (§3.1).
function sanitizePreMeetingFields(meeting) {
  if (!meeting || typeof meeting !== 'object') return meeting;
  return {
    ...meeting,
    meetingType: normalizeMeetingTypeCode(meeting.meetingType),
    topic: normalizeShortText(meeting.topic),
    leadBy: normalizeShortText(meeting.leadBy),
    tags: normalizeTagList(meeting.tags)
  };
}

// Normalize a typed LLM error into the standard error envelope.
function sendLlmError(response, error) {
  sendJson(response, error.statusCode || 500, {
    error: {
      code: error.llmCode || 'LLM_PROVIDER_UNAVAILABLE',
      message: error.message || 'The provider request failed.',
      provider: error.provider || '',
      retryable: Boolean(error.retryable)
    }
  });
}

function decodePathSegment(value, maxLength = 256) {
  try {
    const decoded = decodeURIComponent(String(value || ''));
    if (!decoded || decoded.length > maxLength || decoded.includes('\0')) return null;
    return decoded;
  } catch {
    return null;
  }
}

// server/meeting-parts.js throws plain Error objects with {statusCode, code}
// (not the {llmCode,...} shape sttError/llmError use) — this is the matching
// envelope builder for those.
function sendMeetingPartsError(response, error) {
  if (error.llmCode) return sendLlmError(response, error);
  sendJson(response, error.statusCode || 400, {
    error: { code: error.code || 'BAD_REQUEST', message: error.message || 'Invalid request', provider: '', retryable: false }
  });
}

function decodePresetId(pathname) {
  try {
    const id = decodeURIComponent(pathname.slice('/api/summary-presets/'.length));
    if (!id || id.length > 128 || id.includes('\0')) return null;
    return id;
  } catch {
    return null;
  }
}

// BR-9: whenever the preset list is empty (first run, or the user deleted
// every preset) re-seed the 4 built-ins in place.
function seedPresetsIfEmpty(list) {
  if (list.length > 0) return;
  list.splice(0, list.length, ...instantiateBuiltIns());
}

function sendPresetValidationError(response, error) {
  sendJson(response, 400, { error: { code: error.code, message: error.message } });
}

// CRUD for /api/summary-presets[/:id]. `:id` is only ever used as a lookup
// key into presets.json — never joined into a filesystem path (§4.1).
async function handlePresetsRoute(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/summary-presets') {
    const presets = await mutateJson(PRESETS_FILE, [], list => {
      seedPresetsIfEmpty(list);
      return list.slice();
    });
    sendJson(response, 200, { presets });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/summary-presets') {
    const body = await readJsonRequest(request);
    try {
      const result = await mutateJson(PRESETS_FILE, [], list => {
        seedPresetsIfEmpty(list);
        const { preset, warnings } = validatePreset(body, list, null);
        list.push(preset);
        return { preset, warnings };
      });
      sendJson(response, 201, result);
    } catch (error) {
      if (error.code) { sendPresetValidationError(response, error); return true; }
      throw error;
    }
    return true;
  }

  if (url.pathname.startsWith('/api/summary-presets/')) {
    const id = decodePresetId(url.pathname);
    if (!id) {
      sendError(response, 400, 'Invalid preset id');
      return true;
    }

    if (request.method === 'PUT') {
      const body = await readJsonRequest(request);
      try {
        const result = await mutateJson(PRESETS_FILE, [], list => {
          seedPresetsIfEmpty(list);
          const index = list.findIndex(preset => preset.id === id);
          if (index === -1) {
            const notFound = new Error('Preset not found');
            notFound.notFound = true;
            throw notFound;
          }
          const { preset, warnings } = validatePreset(body, list, id);
          list[index] = preset;
          return { preset, warnings };
        });
        sendJson(response, 200, result);
      } catch (error) {
        if (error.notFound) { sendError(response, 404, 'Preset not found'); return true; }
        if (error.code) { sendPresetValidationError(response, error); return true; }
        throw error;
      }
      return true;
    }

    if (request.method === 'DELETE') {
      const presets = await mutateJson(PRESETS_FILE, [], list => {
        const index = list.findIndex(preset => preset.id === id);
        if (index !== -1) list.splice(index, 1);
        seedPresetsIfEmpty(list);
        return list.slice();
      });
      sendJson(response, 200, { success: true, presets });
      return true;
    }
  }

  return false;
}

function sendExportDirError(response, error) {
  if (!error || !error.code) throw error;
  sendJson(response, error.statusCode || 400, { error: { code: error.code, message: error.message } });
}

async function readExportSettings() {
  return readJson(EXPORT_SETTINGS_FILE, {});
}

// WHY-1: this is the ONLY place that persists `markdownDir`. It never lives
// in settings.json, because `PUT /api/settings` (below) replaces that file
// wholesale with an unvalidated client body — storing the export directory
// there would let a single crafted request bypass every BR-42/BR-43 check.
async function handleExportRoute(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/export-settings') {
    const settings = await readExportSettings();
    const markdownDir = typeof settings.markdownDir === 'string' ? settings.markdownDir : '';
    sendJson(response, 200, {
      markdownDir,
      suggestedDir: path.join(os.homedir(), 'Documents', 'MeetNote'),
      configured: Boolean(markdownDir),
      status: markdownDir ? 'configured' : 'not_configured'
    });
    return true;
  }

  if (request.method === 'PUT' && url.pathname === '/api/export-settings') {
    const body = await readJsonRequest(request);
    const input = typeof body?.markdownDir === 'string' ? body.markdownDir : '';
    try {
      const { dir } = await validateExportDir(input, { storageDir: STORAGE_DIR, rootDir: ROOT_DIR });
      await replaceJson(EXPORT_SETTINGS_FILE, { markdownDir: dir, updatedAt: new Date().toISOString() });
      sendJson(response, 200, { markdownDir: dir });
    } catch (error) {
      sendExportDirError(response, error);
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/export-settings/check') {
    const body = await readJsonRequest(request);
    const settings = await readExportSettings();
    const input = typeof body?.markdownDir === 'string' ? body.markdownDir : (settings.markdownDir || '');
    try {
      await validateExportDir(input, { storageDir: STORAGE_DIR, rootDir: ROOT_DIR, dryRun: true });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendExportDirError(response, error);
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/export/markdown') {
    const body = await readJsonRequest(request);
    const meetingId = typeof body?.meetingId === 'string' ? body.meetingId : '';
    const content = typeof body?.content === 'string' ? body.content : '';

    if (Buffer.byteLength(content, 'utf8') > MAX_EXPORT_CONTENT_BYTES) {
      sendJson(response, 413, { error: { code: 'EXPORT_CONTENT_TOO_LARGE', message: 'Nội dung file vượt quá 8 MB.' } });
      return true;
    }

    const meetings = await readJson(MEETINGS_FILE, []);
    const meetingRecord = meetings.find(m => m && m.id === meetingId);
    if (!meetingRecord) {
      sendJson(response, 404, { error: { code: 'EXPORT_MEETING_NOT_FOUND', message: 'Không tìm thấy cuộc họp này.' } });
      return true;
    }

    const exportSettings = await readExportSettings();
    if (!exportSettings.markdownDir) {
      sendJson(response, 400, { error: { code: 'EXPORT_DIR_NOT_CONFIGURED', message: 'Chưa cấu hình thư mục xuất file. Vui lòng chọn thư mục trong Cài đặt.' } });
      return true;
    }

    try {
      // BR-43: re-validate on every export, not just when Settings was saved
      // — the directory/volume can change or go offline in between.
      const { dir } = await validateExportDir(exportSettings.markdownDir, { storageDir: STORAGE_DIR, rootDir: ROOT_DIR });
      const baseName = buildFileName(meetingRecord);
      const written = await writeExportFile(dir, baseName, content);

      const warnings = [];
      if (!meetingRecord.summary && !meetingRecord.summaryDetails) warnings.push('EXPORT_NO_SUMMARY');
      if (Array.isArray(meetingRecord.transcript) && meetingRecord.transcript.length > 20000) warnings.push('EXPORT_LARGE_TRANSCRIPT');

      // Only filename + attempt — never the full path or file content
      // (sanitizeDiagnosticValue has no way to know a path is personal data).
      await logEvent('info', 'export.markdown', { fileName: written.fileName, attempt: written.attempt });

      sendJson(response, 200, { path: written.fullPath, fileName: written.fileName, warnings });
    } catch (error) {
      sendExportDirError(response, error);
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/export/open-folder') {
    const exportSettings = await readExportSettings();
    if (!exportSettings.markdownDir) {
      sendJson(response, 400, { error: { code: 'EXPORT_DIR_NOT_CONFIGURED', message: 'Chưa cấu hình thư mục xuất file.' } });
      return true;
    }

    let dir;
    try {
      ({ dir } = await validateExportDir(exportSettings.markdownDir, { storageDir: STORAGE_DIR, rootDir: ROOT_DIR }));
    } catch (error) {
      sendExportDirError(response, error);
      return true;
    }

    // U2 (Architecture §7.2/§14): Windows `explorer.exe` behavior under
    // `shell:false` is unverified (binary path, argument handling, and a
    // rumored non-zero exit code on success). This is a hard Protocol 5.2
    // gate — the win32 branch stays a 501 until a real Windows log is
    // captured. Only macOS is implemented, matching the verified §7.2 V4 run.
    if (process.platform !== 'darwin') {
      sendJson(response, 501, { error: { code: 'OPEN_FOLDER_UNSUPPORTED', message: 'Mở thư mục tự động chưa hỗ trợ trên hệ điều hành này. Hãy dùng nút Copy đường dẫn.' } });
      return true;
    }

    try {
      const result = await runProcess('/usr/bin/open', [dir], { timeoutMs: 5000 });
      if (result.code !== 0) {
        sendJson(response, 500, { error: { code: 'OPEN_FOLDER_FAILED', message: 'Không thể mở thư mục.' } });
        return true;
      }
      sendJson(response, 200, { opened: true });
    } catch (error) {
      sendJson(response, 500, { error: { code: 'OPEN_FOLDER_FAILED', message: error.message || 'Không thể mở thư mục.' } });
    }
    return true;
  }

  return false;
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, storage: 'file', version: APP_VERSION });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/logs') {
    sendJson(response, 200, { logs: await readRecentLogEntries(), version: APP_VERSION });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/logs') {
    const body = await readJsonRequest(request);
    await logEvent(body?.level, `client.${body?.event || 'event'}`, {
      message: String(body?.message || '').slice(0, MAX_CLIENT_LOG_MESSAGE),
      context: body?.context || {}
    });
    sendJson(response, 202, { success: true });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/bug-reports') {
    const body = await readJsonRequest(request);
    const summary = String(body?.summary || '').trim();
    const description = String(body?.description || '').trim();
    if (!summary || !description) {
      sendError(response, 400, 'Summary and description are required');
      return true;
    }
    sendJson(response, 201, await createBugReport(body));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/integrations/status') {
    const sonioxApiKey = await getSonioxApiKey();
    sendJson(response, 200, {
      soniox: {
        configured: Boolean(sonioxApiKey),
        source: process.env.SONIOX_API_KEY ? 'environment' : (sonioxApiKey ? 'keychain' : '')
      }
    });
    return true;
  }

  // Safe provider metadata for the settings UI (never returns secrets).
  if (request.method === 'GET' && url.pathname === '/api/llm/providers') {
    sendJson(response, 200, await llm.listProviders());
    return true;
  }

  // Save / remove / test a provider API key (API providers only).
  const providerKeyMatch = url.pathname.match(/^\/api\/llm\/providers\/([a-z0-9-]{1,40})\/key$/);
  if (providerKeyMatch) {
    const providerId = providerKeyMatch[1];
    if (request.method === 'PUT') {
      const body = await readJsonRequest(request);
      const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
      if (!apiKey || apiKey.length > 4000) {
        sendError(response, 400, 'Enter a valid API key');
        return true;
      }
      try {
        await llm.saveKey(providerId, apiKey);
      } catch (error) {
        if (error.llmCode) return sendLlmError(response, error), true;
        throw error;
      }
      sendJson(response, 200, { success: true });
      return true;
    }
    if (request.method === 'DELETE') {
      try {
        await llm.removeKey(providerId);
      } catch (error) {
        if (error.llmCode) return sendLlmError(response, error), true;
        throw error;
      }
      sendJson(response, 200, { success: true });
      return true;
    }
  }

  const providerTestMatch = url.pathname.match(/^\/api\/llm\/providers\/([a-z0-9-]{1,40})\/test$/);
  if (request.method === 'POST' && providerTestMatch) {
    try {
      const result = await llm.testConnection(providerTestMatch[1]);
      sendJson(response, 200, result);
    } catch (error) {
      if (error.llmCode) sendLlmError(response, error);
      else throw error;
    }
    return true;
  }

  // Speech-to-text provider management (mirrors the LLM provider endpoints).
  if (request.method === 'GET' && url.pathname === '/api/stt/providers') {
    const result = await stt.listProviders();
    sendJson(response, 200, { ...result, maxAudioBytes: MAX_AUDIO_BYTES, appAcceptedExtensions: APP_ACCEPTED_EXTENSIONS });
    return true;
  }

  const sttKeyMatch = url.pathname.match(/^\/api\/stt\/providers\/([a-z0-9-]{1,40})\/key$/);
  if (sttKeyMatch) {
    const providerId = sttKeyMatch[1];
    if (request.method === 'PUT') {
      const body = await readJsonRequest(request);
      const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
      if (!apiKey || apiKey.length > 4000) {
        sendError(response, 400, 'Enter a valid API key');
        return true;
      }
      try {
        await stt.saveKey(providerId, apiKey);
      } catch (error) {
        if (error.llmCode) return sendLlmError(response, error), true;
        throw error;
      }
      sendJson(response, 200, { success: true });
      return true;
    }
    if (request.method === 'DELETE') {
      try {
        await stt.removeKey(providerId);
      } catch (error) {
        if (error.llmCode) return sendLlmError(response, error), true;
        throw error;
      }
      sendJson(response, 200, { success: true });
      return true;
    }
  }

  const sttTestMatch = url.pathname.match(/^\/api\/stt\/providers\/([a-z0-9-]{1,40})\/test$/);
  if (request.method === 'POST' && sttTestMatch) {
    try {
      sendJson(response, 200, await stt.testConnection(sttTestMatch[1]));
    } catch (error) {
      if (error.llmCode) sendLlmError(response, error);
      else throw error;
    }
    return true;
  }

  // Short-lived credential for a browser live-streaming session (e.g. Deepgram).
  const sttTempKeyMatch = url.pathname.match(/^\/api\/stt\/providers\/([a-z0-9-]{1,40})\/temporary-key$/);
  if (request.method === 'POST' && sttTempKeyMatch) {
    try {
      sendJson(response, 201, await stt.temporaryKey(sttTempKeyMatch[1]));
    } catch (error) {
      if (error.llmCode) sendLlmError(response, error);
      else throw error;
    }
    return true;
  }

  if (request.method === 'PUT' && url.pathname === '/api/soniox/key') {
    const body = await readJsonRequest(request);
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey || apiKey.length > 1000) {
      sendError(response, 400, 'Enter a valid Soniox API key');
      return true;
    }
    await writeKeychainSecret(SONIOX_KEYCHAIN_ACCOUNT, apiKey);
    sendJson(response, 200, { success: true });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/soniox/temporary-key') {
    const body = await readJsonRequest(request);
    const apiKey = await getSonioxApiKey();
    if (!apiKey) {
      sendError(response, 400, 'Soniox is not configured. Add the API key in Settings.');
      return true;
    }
    const clientReferenceId = typeof body?.meetingId === 'string'
      ? body.meetingId.slice(0, 256)
      : undefined;
    const sonioxResponse = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        usage_type: 'transcribe_websocket',
        expires_in_seconds: 60,
        single_use: true,
        max_session_duration_seconds: 5 * 60 * 60,
        ...(clientReferenceId ? { client_reference_id: clientReferenceId } : {})
      })
    });
    const data = await sonioxResponse.json().catch(() => ({}));
    if (!sonioxResponse.ok) {
      const message = data.message || data.error_message || 'Soniox rejected the API key request';
      throw Object.assign(new Error(message), { statusCode: sonioxResponse.status });
    }
    sendJson(response, 201, {
      apiKey: data.api_key,
      expiresAt: data.expires_at
    });
    return true;
  }

  if (url.pathname === '/api/summary-presets' || url.pathname.startsWith('/api/summary-presets/')) {
    const handled = await handlePresetsRoute(request, response, url);
    if (handled) return true;
  }

  if (url.pathname === '/api/export-settings' || url.pathname === '/api/export-settings/check' ||
      url.pathname === '/api/export/markdown' || url.pathname === '/api/export/open-folder') {
    const handled = await handleExportRoute(request, response, url);
    if (handled) return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/summary') {
    const body = await readJsonRequest(request);
    const meeting = validateMeetingForSummary(extractMeetingPayload(body));

    // §4.2: a presetId must resolve to a real preset — no silent fallback
    // (BR-19). Omitting presetId keeps the legacy static-schema behavior.
    let preset = null;
    let summaryPresetSnapshot = null;
    const presetId = typeof body?.presetId === 'string' ? body.presetId.trim() : '';
    if (presetId) {
      const presets = await readJson(PRESETS_FILE, []);
      preset = presets.find(item => item.id === presetId) || null;
      if (!preset) {
        sendJson(response, 400, {
          error: { code: 'PRESET_NOT_FOUND', message: 'Preset không tồn tại hoặc đã bị xóa.', provider: '', retryable: false }
        });
        return true;
      }
      summaryPresetSnapshot = snapshotOf(preset);
    }

    let result;
    try {
      result = await llm.generateSummary({
        providerId: typeof body?.provider === 'string' ? body.provider : '',
        modelId: typeof body?.model === 'string' ? body.model : '',
        language: typeof body?.language === 'string' ? body.language.slice(0, 20) : '',
        meeting,
        preset
      });
    } catch (error) {
      if (error.llmCode) return sendLlmError(response, error), true;
      throw error;
    }
    if (meeting.id) {
      await atomicWriteJson(artifactPath(SUMMARIES_DIR, meeting.id), {
        meetingId: meeting.id,
        title: meeting.title,
        summaryGeneration: result.generation,
        details: result.data,
        summaryPreset: summaryPresetSnapshot
      });
    }
    sendJson(response, 200, { ...result.data, summaryGeneration: result.generation, summaryPreset: summaryPresetSnapshot });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/title-suggestion') {
    const body = await readJsonRequest(request);
    const meeting = validateMeetingForSummary(extractMeetingPayload(body));
    try {
      const result = await llm.suggestTitle({
        providerId: typeof body?.provider === 'string' ? body.provider : '',
        modelId: typeof body?.model === 'string' ? body.model : '',
        meeting
      });
      sendJson(response, 200, { ...result.data, generation: result.generation });
    } catch (error) {
      if (error.llmCode) sendLlmError(response, error);
      else throw error;
    }
    return true;
  }

  // ── Multi-part meetings (import-phone-recording, Architecture §V6.2-§V6.6) ──
  // All 5 routes below live under /api/ so they already go through
  // hasTrustedHost + isTrustedApiRequest (requestHandler, above) like every
  // other route — nothing here re-implements or bypasses that check.

  const partsCollectionMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/parts$/);
  if (partsCollectionMatch && (request.method === 'GET' || request.method === 'POST')) {
    const meetingId = decodePathSegment(partsCollectionMatch[1]);
    if (!meetingId) { sendError(response, 400, 'Invalid meeting id'); return true; }

    if (request.method === 'GET') {
      const meetings = await readJson(MEETINGS_FILE, []);
      const meeting = meetings.find(m => m.id === meetingId);
      if (!meeting) { sendError(response, 404, 'Meeting not found'); return true; }
      const parts = Array.isArray(meeting.parts) ? meeting.parts : [];
      // §V6.6: deliberately small — no transcript here, so a 3s poll for N
      // parts stays cheap. Clients fetch content via /api/data once a part
      // finishes.
      sendJson(response, 200, {
        status: meeting.status || '',
        missingParts: Array.isArray(meeting.missingParts) ? meeting.missingParts : [],
        duration: Number(meeting.duration) || 0,
        durationEstimated: Boolean(meeting.durationEstimated),
        parts: parts.map(part => ({
          partId: part.partId,
          order: part.order,
          filename: part.filename,
          status: part.status,
          error: part.error || null,
          spanSeconds: part.spanSeconds || 0,
          offsetSeconds: part.offsetSeconds || 0,
          hasTranscript: Array.isArray(part.transcript) && part.transcript.length > 0,
          startedAt: part.usage?.startedAt || null,
          endedAt: part.usage?.endedAt || null
        }))
      });
      return true;
    }

    // POST — register new parts: either the first parts of a brand-new merged
    // meeting, or "add a part to an existing merged meeting" (Q9). Job
    // creation is a separate jobs.json mutation below; this only ever writes
    // meeting.parts.
    const body = await readJsonRequest(request);
    const rawParts = Array.isArray(body?.parts) ? body.parts : [];
    if (rawParts.length === 0) { sendError(response, 400, 'parts must be a non-empty array'); return true; }
    if (rawParts.length > MAX_PARTS_PER_MEETING) {
      sendJson(response, 400, { error: { code: 'PARTS_LIMIT_EXCEEDED', message: `A single request cannot register more than ${MAX_PARTS_PER_MEETING} parts.`, provider: '', retryable: false } });
      return true;
    }
    for (const raw of rawParts) {
      if (!isValidPartId(raw?.partId)) { sendError(response, 400, `Invalid partId "${raw?.partId}"`); return true; }
    }

    // R-S: provider/model come from the server's own whitelist, never trusted
    // as free text (unlike the legacy /api/import-transcription below, which
    // predates this feature and keeps its existing lenient contract).
    let adapter;
    try {
      adapter = stt.validateSelection(
        typeof body?.provider === 'string' ? body.provider : '',
        typeof body?.model === 'string' ? body.model : ''
      );
    } catch (error) {
      sendMeetingPartsError(response, error);
      return true;
    }

    // BR-138/BR-143: re-check format + real on-disk size for EVERY part —
    // never trust the client's sizeBytes, never skip a part's own check.
    const withRealSize = [];
    for (const raw of rawParts) {
      let audio;
      try {
        audio = await openStoredAudio(raw.partId);
      } catch {
        sendJson(response, 404, { error: { code: 'PART_AUDIO_NOT_FOUND', message: `No uploaded audio was found for part "${raw.partId}". Upload it before registering the part.`, provider: '', retryable: false } });
        return true;
      }
      const extension = extensionOf(raw?.filename);
      if (!APP_ACCEPTED_EXTENSIONS.includes(extension)) {
        sendJson(response, 400, { error: { code: 'IMPORT_EXTENSION_NOT_SUPPORTED', message: `MeetNote does not support the ".${extension || '?'}" file type.`, provider: '', retryable: false } });
        return true;
      }
      if (statusFor(adapter.id, extension) === 'rejected') {
        sendJson(response, 422, { error: { code: 'STT_UNSUPPORTED_AUDIO', message: `${adapter.name} does not accept ".${extension}" files.`, provider: adapter.id, retryable: false } });
        return true;
      }
      if (adapter.maxUploadBytes && audio.meta.size > adapter.maxUploadBytes) {
        sendJson(response, 413, { error: { code: 'STT_AUDIO_TOO_LARGE', message: `${adapter.name} accepts audio up to ${Math.round(adapter.maxUploadBytes / (1024 * 1024))} MB.`, provider: adapter.id, retryable: false } });
        return true;
      }
      withRealSize.push({ ...raw, sizeBytes: audio.meta.size, jobId: `job-${crypto.randomUUID()}` });
    }

    const sttConfig = {
      provider: adapter.id,
      model: typeof body.model === 'string' ? body.model : '',
      language: typeof body.language === 'string' ? body.language.slice(0, 20) : 'auto',
      translationLanguage: typeof body.translationLanguage === 'string' ? body.translationLanguage.slice(0, 20) : ''
    };

    let outcome;
    try {
      outcome = await mutateJson(MEETINGS_FILE, [], async meetings => {
        const index = meetings.findIndex(m => m.id === meetingId);
        if (index < 0) return { notFound: true };
        const current = meetings[index];
        const alreadyMultiPart = Array.isArray(current.parts) && current.parts.length > 0;
        const isFinishedSinglePart = !alreadyMultiPart &&
          ((Array.isArray(current.transcript) && current.transcript.length > 0) || current.audioId);
        if (isFinishedSinglePart) return { conflict: true };

        const { meeting: updated, createdParts } = registerParts(current, withRealSize, sttConfig);
        const previousMeetings = meetings.map(m => ({ ...m }));
        // Registering a part is new meeting content, same spirit as editing
        // participants (BR-146) — the prompt-context reminder should notice.
        meetings[index] = { ...updated, promptContextUpdatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await syncMeetingArtifacts(previousMeetings, meetings).catch(err => console.error('artifact sync failed:', err));
        return { createdParts };
      });
    } catch (error) {
      sendMeetingPartsError(response, error);
      return true;
    }
    if (outcome.notFound) { sendError(response, 404, 'Meeting not found'); return true; }
    if (outcome.conflict) {
      sendJson(response, 409, { error: { code: 'MEETING_NOT_MULTIPART', message: 'This meeting already holds a finished single-part recording — it cannot be converted into a merged, multi-part meeting.', provider: '', retryable: false } });
      return true;
    }

    const now = new Date().toISOString();
    await mutateJson(JOBS_FILE, [], jobs => {
      for (const part of outcome.createdParts) {
        jobs.push({
          id: part.jobId, meetingId, partId: part.partId,
          provider: sttConfig.provider, model: sttConfig.model, language: sttConfig.language,
          translationLanguage: sttConfig.translationLanguage, status: 'queued', error: null,
          createdAt: now, updatedAt: now
        });
      }
      pruneTerminalJobs(jobs);
    });
    await pumpJobQueue();

    const finalJobs = await readJobs();
    sendJson(response, 201, {
      meetingId,
      parts: outcome.createdParts.map(part => ({
        partId: part.partId,
        order: part.order,
        status: finalJobs.find(job => job.id === part.jobId)?.status || 'queued',
        jobId: part.jobId
      })),
      queued: outcome.createdParts.length
    });
    return true;
  }

  const partRetryMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/parts\/([^/]+)\/retry$/);
  if (request.method === 'POST' && partRetryMatch) {
    const meetingId = decodePathSegment(partRetryMatch[1]);
    const partId = decodePathSegment(partRetryMatch[2]);
    if (!meetingId || !partId || !isValidPartId(partId)) { sendError(response, 400, 'Invalid meeting or part id'); return true; }
    const body = await readJsonRequest(request).catch(() => ({}));

    let adapter = null;
    if (typeof body?.provider === 'string' && body.provider) {
      try {
        adapter = stt.validateSelection(body.provider, typeof body.model === 'string' ? body.model : '');
      } catch (error) {
        sendMeetingPartsError(response, error);
        return true;
      }
    }

    const jobId = `job-${crypto.randomUUID()}`;
    let outcome;
    try {
      outcome = await mutateJson(MEETINGS_FILE, [], async meetings => {
        const index = meetings.findIndex(m => m.id === meetingId);
        if (index < 0) return { notFound: true };
        const overrides = {
          provider: adapter?.id,
          model: typeof body?.model === 'string' ? body.model : '',
          language: typeof body?.language === 'string' ? body.language.slice(0, 20) : '',
          translationLanguage: typeof body?.translationLanguage === 'string' ? body.translationLanguage.slice(0, 20) : undefined
        };
        const updated = retryPart(meetings[index], partId, overrides);
        const part = (updated.parts || []).find(p => p.partId === partId);
        part.jobId = jobId;
        const previousMeetings = meetings.map(m => ({ ...m }));
        meetings[index] = { ...updated, updatedAt: new Date().toISOString() };
        await syncMeetingArtifacts(previousMeetings, meetings).catch(err => console.error('artifact sync failed:', err));
        return { part };
      });
    } catch (error) {
      sendMeetingPartsError(response, error);
      return true;
    }
    if (outcome.notFound) { sendError(response, 404, 'Meeting not found'); return true; }

    const now = new Date().toISOString();
    await mutateJson(JOBS_FILE, [], jobs => {
      jobs.push({
        id: jobId, meetingId, partId,
        provider: outcome.part.provider, model: outcome.part.model, language: outcome.part.language,
        translationLanguage: outcome.part.translationLanguage, status: 'queued', error: null,
        createdAt: now, updatedAt: now
      });
      pruneTerminalJobs(jobs);
    });
    await pumpJobQueue();

    const finalJobs = await readJobs();
    sendJson(response, 200, { partId, jobId, status: finalJobs.find(job => job.id === jobId)?.status || 'queued' });
    return true;
  }

  const partsReorderMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/parts\/reorder$/);
  if (request.method === 'POST' && partsReorderMatch) {
    const meetingId = decodePathSegment(partsReorderMatch[1]);
    if (!meetingId) { sendError(response, 400, 'Invalid meeting id'); return true; }
    const body = await readJsonRequest(request);
    const order = Array.isArray(body?.order) ? body.order : null;
    if (!order) { sendError(response, 400, 'order must be an array of partId'); return true; }

    let outcome;
    try {
      outcome = await mutateJson(MEETINGS_FILE, [], async meetings => {
        const index = meetings.findIndex(m => m.id === meetingId);
        if (index < 0) return { notFound: true };
        // Pure and provider-free (Architecture §V6.4): reordering never calls
        // stt.transcribe — test/parts-routes.test.js asserts the call count.
        const updated = reorderParts(meetings[index], order);
        const previousMeetings = meetings.map(m => ({ ...m }));
        meetings[index] = { ...updated, promptContextUpdatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await syncMeetingArtifacts(previousMeetings, meetings).catch(err => console.error('artifact sync failed:', err));
        return { meeting: meetings[index] };
      });
    } catch (error) {
      sendMeetingPartsError(response, error);
      return true;
    }
    if (outcome.notFound) { sendError(response, 404, 'Meeting not found'); return true; }

    sendJson(response, 200, {
      parts: outcome.meeting.parts.map(part => ({ partId: part.partId, order: part.order, offsetSeconds: part.offsetSeconds, spanSeconds: part.spanSeconds })),
      duration: outcome.meeting.duration,
      transcriptLength: outcome.meeting.transcript.length
    });
    return true;
  }

  const partDeleteMatch = url.pathname.match(/^\/api\/meetings\/([^/]+)\/parts\/([^/]+)$/);
  if (request.method === 'DELETE' && partDeleteMatch) {
    const meetingId = decodePathSegment(partDeleteMatch[1]);
    const partId = decodePathSegment(partDeleteMatch[2]);
    if (!meetingId || !partId) { sendError(response, 400, 'Invalid meeting or part id'); return true; }

    let outcome;
    try {
      outcome = await mutateJson(MEETINGS_FILE, [], async meetings => {
        const index = meetings.findIndex(m => m.id === meetingId);
        if (index < 0) return { notFound: true };
        // BR-103/BR-134: the audio file is intentionally left on disk — only
        // the part's status changes.
        const updated = dropPart(meetings[index], partId);
        const previousMeetings = meetings.map(m => ({ ...m }));
        meetings[index] = { ...updated, updatedAt: new Date().toISOString() };
        await syncMeetingArtifacts(previousMeetings, meetings).catch(err => console.error('artifact sync failed:', err));
        return { meeting: meetings[index] };
      });
    } catch (error) {
      sendMeetingPartsError(response, error);
      return true;
    }
    if (outcome.notFound) { sendError(response, 404, 'Meeting not found'); return true; }

    sendJson(response, 200, { missingParts: outcome.meeting.missingParts, duration: outcome.meeting.duration });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/import-transcription') {
    const body = await readJsonRequest(request);
    const meetingId = typeof body?.meetingId === 'string' ? body.meetingId.slice(0, 256) : '';
    if (!meetingId) {
      sendError(response, 400, 'Meeting id is required');
      return true;
    }
    // §V6.7: optional, backward-compatible — a single-part meeting (the only
    // caller today) omits it and gets exactly the old behavior.
    const partId = typeof body?.partId === 'string' && isValidPartId(body.partId) ? body.partId : '';

    // Dedupe: return the existing active job for this meeting/part if one exists.
    const existingInMemory = runningJobs.get(jobKey(meetingId, partId));
    if (existingInMemory) {
      sendJson(response, 200, { jobId: existingInMemory.jobId, status: 'processing' });
      return true;
    }

    // BR-98 (TV15): a single-part meeting that already has a real transcript
    // must never be silently overwritten by a fresh "attach a file" submission.
    // A meeting that never succeeded (draft, or a previous run that FAILED
    // before ever writing a transcript) still has an empty transcript here,
    // so a legitimate "Thử lại" resubmission is unaffected — only a meeting
    // that already finished successfully is protected.
    if (!partId) {
      const meetings = await readJson(MEETINGS_FILE, []);
      const current = meetings.find(m => m.id === meetingId);
      if (current && Array.isArray(current.transcript) && current.transcript.length > 0) {
        sendJson(response, 409, {
          error: {
            code: 'MEETING_ALREADY_HAS_TRANSCRIPT',
            message: 'Bản ghi này đã có transcript — không thể gắn thêm file mới vào đây. Hãy tạo bản ghi mới.',
            provider: '', retryable: false
          }
        });
        return true;
      }
    }

    // Verify audio exists before creating the job.
    await openStoredAudio(partId || meetingId);

    // Check-and-create under one file mutation lock so concurrent submissions
    // for the same meeting cannot both create workers or lose job records.
    // Jobs always start 'queued' — pumpJobQueue() below decides, under the
    // global concurrency cap, which ones actually start now (BR-88).
    const transaction = await mutateJson(JOBS_FILE, [], jobs => {
      const existing = findActiveJob(jobs, meetingId, partId);
      if (existing) return { job: existing, created: false };
      const now = new Date().toISOString();
      const job = {
        id: `job-${crypto.randomUUID()}`,
        meetingId,
        partId,
        provider: typeof body.provider === 'string' ? body.provider : '',
        model: typeof body.model === 'string' ? body.model : '',
        language: typeof body.language === 'string' ? body.language.slice(0, 20) : 'auto',
        translationLanguage: typeof body.translationLanguage === 'string' ? body.translationLanguage.slice(0, 20) : '',
        status: 'queued',
        error: null,
        createdAt: now,
        updatedAt: now
      };
      jobs.push(job);
      pruneTerminalJobs(jobs);
      return { job, created: true };
    });
    const { job, created } = transaction;
    if (!created) {
      sendJson(response, 200, { jobId: job.id, status: job.status });
      return true;
    }

    if (!partId) {
      // The association is server-owned; the browser never needs to PUT a
      // stale meeting snapshot merely to remember which job it should poll.
      const associated = await mergeTranscriptionIntoMeeting(meetingId, {
        status: 'processing',
        processingError: '',
        _activeJobId: job.id
      });
      if (!associated) {
        await mutateJson(JOBS_FILE, [], jobs => {
          const index = jobs.findIndex(item => item.id === job.id);
          if (index >= 0) jobs.splice(index, 1);
        });
        sendError(response, 404, 'Meeting not found');
        return true;
      }
    }

    await pumpJobQueue();
    const currentJobs = await readJobs();
    const currentStatus = currentJobs.find(item => item.id === job.id)?.status || job.status;
    sendJson(response, 201, { jobId: job.id, status: currentStatus });
    return true;
  }

  // Poll a transcription job's status.
  const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-z0-9-]{1,80})$/);
  if (request.method === 'GET' && jobMatch) {
    const jobId = jobMatch[1];
    const jobs = await readJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      sendError(response, 404, 'Transcription job not found');
      return true;
    }
    sendJson(response, 200, { id: job.id, meetingId: job.meetingId, status: job.status, error: job.error });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/data') {
    const [meetings, settings] = await Promise.all([
      readJson(MEETINGS_FILE, []),
      readJson(SETTINGS_FILE, {})
    ]);
    sendJson(response, 200, { meetings, settings });
    return true;
  }

  if (request.method === 'PUT' && url.pathname === '/api/meetings') {
    const incomingMeetings = await readJsonRequest(request);
    if (!Array.isArray(incomingMeetings)) {
      sendError(response, 400, 'Meetings must be an array');
      return true;
    }
    await mutateJson(MEETINGS_FILE, [], async meetings => {
      const previousMeetings = meetings.map(meeting => ({ ...meeting }));
      const currentById = new Map(meetings.map(meeting => [meeting.id, meeting]));
      const merged = incomingMeetings.map(incoming => {
        const current = currentById.get(incoming?.id);
        // R-R (Architecture §V3.6): a multi-part meeting's `parts`/duration/
        // status/etc are server-owned regardless of what status the client
        // sends — the single-part guard below only covers 'processing', which
        // is not enough once a `completed` snapshot could otherwise wipe `parts`.
        if (current && Array.isArray(current.parts) && current.parts.length > 0) {
          return preserveServerOwnedFields(current, incoming);
        }
        // A stale browser snapshot must never roll a server-owned terminal STT
        // result back to processing. Explicit future retries should go through
        // the transcription endpoint, which sets processing server-side.
        if (current && ['completed', 'failed'].includes(current.status) && incoming?.status === 'processing') {
          return {
            ...incoming,
            transcript: current.transcript,
            translations: current.translations,
            duration: current.duration,
            status: current.status,
            processingError: current.processingError,
            sonioxUsage: current.sonioxUsage,
            _activeJobId: current._activeJobId || null,
            updatedAt: current.updatedAt
          };
        }
        return incoming;
      }).map(sanitizePreMeetingFields);
      meetings.splice(0, meetings.length, ...merged);
      await syncMeetingArtifacts(previousMeetings, meetings);
      const remainingIds = new Set(merged.map(meeting => meeting.id));
      const removedCount = previousMeetings.filter(previous => !remainingIds.has(previous.id)).length;
      if (removedCount > 0) await logEvent('info', 'meetings.deleted', { count: removedCount });
    });
    sendJson(response, 200, { success: true });
    return true;
  }

  if (request.method === 'PUT' && url.pathname === '/api/settings') {
    const settings = await readJsonRequest(request);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      sendError(response, 400, 'Settings must be an object');
      return true;
    }
    await replaceJson(SETTINGS_FILE, settings);
    sendJson(response, 200, { success: true });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/clear') {
    const body = await readJsonRequest(request);
    if (body?.confirmation !== 'CLEAR_ALL_DATA') {
      sendError(response, 400, 'Explicit clear confirmation is required');
      return true;
    }
    await Promise.all([
      replaceJson(MEETINGS_FILE, []),
      replaceJson(SETTINGS_FILE, {}),
      replaceJson(JOBS_FILE, []),
      clearAudio(),
      clearDirectory(TRANSCRIPTS_DIR),
      clearDirectory(SUMMARIES_DIR)
    ]);
    sendJson(response, 200, { success: true });
    return true;
  }

  if (url.pathname === '/api/audio' && request.method === 'DELETE') {
    await clearAudio();
    sendJson(response, 200, { success: true });
    return true;
  }

  if (url.pathname.startsWith('/api/audio/')) {
    const id = decodeAudioId(url.pathname);
    if (!id) {
      sendError(response, 400, 'Invalid audio id');
      return true;
    }
    const paths = audioPaths(id);

    if (request.method === 'PUT') {
      await saveAudio(request, id);
      sendJson(response, 200, { success: true });
      return true;
    }

    if (request.method === 'GET') {
      try {
        const [metadata, stat] = await Promise.all([
          readJson(paths.metadata, {}),
          fsp.stat(paths.data)
        ]);
        response.writeHead(200, {
          'Content-Type': metadata.mimeType || 'application/octet-stream',
          'Content-Length': stat.size,
          'Cache-Control': 'no-store'
        });
        fs.createReadStream(paths.data).pipe(response);
      } catch (error) {
        if (error.code === 'ENOENT') sendError(response, 404, 'Audio not found');
        else throw error;
      }
      return true;
    }

    if (request.method === 'DELETE') {
      await Promise.all([
        fsp.rm(paths.data, { force: true }),
        fsp.rm(paths.metadata, { force: true })
      ]);
      sendJson(response, 200, { success: true });
      return true;
    }
  }

  return false;
}

async function serveStatic(request, response, url) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    sendError(response, 405, 'Method not allowed');
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    // Malformed percent-encoding (e.g. /%E0%A4%A) — reject cleanly, don't 500.
    sendError(response, 400, 'Bad request');
    return;
  }
  const filePath = path.resolve(ROOT_DIR, `.${decodedPath}`);
  const relativePath = path.relative(ROOT_DIR, filePath);

  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    relativePath === 'storage' ||
    relativePath.startsWith(`storage${path.sep}`) ||
    relativePath === 'server.js' ||
    relativePath === 'package.json'
  ) {
    sendError(response, 404, 'Not found');
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store'
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === 'ENOENT') sendError(response, 404, 'Not found');
    else throw error;
  }
}

async function requestHandler(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) {
      // Guard reads as well as mutations. Checking only writes still lets a DNS
      // rebinding origin read transcripts, settings, and stored audio.
      if (!hasTrustedHost(request) || !isTrustedApiRequest(request)) {
        sendError(response, 403, 'Forbidden');
        return;
      }
      const handled = await handleApi(request, response, url);
      if (!handled) sendError(response, 404, 'API endpoint not found');
      return;
    }
    await serveStatic(request, response, url);
  } catch (error) {
    console.error(error);
    await logEvent('error', 'server.request_failed', {
      method: request.method,
      path: String(request.url || '').split('?')[0],
      statusCode: error.statusCode || 500,
      error: error.message || 'Internal server error',
      stack: error.stack || ''
    }).catch(() => {});
    if (response.headersSent) {
      response.destroy();
    } else if (error.llmCode) {
      sendLlmError(response, error);
    } else {
      sendError(response, error.statusCode || 500, error.message || 'Internal server error');
    }
  }
}

ensureStorage()
  .then(() => recoverInterruptedJobs())
  // Any 'queued' job recovered above (or left over from before a restart)
  // never got a chance to run — start it now instead of waiting for the next
  // unrelated job event to trigger the scheduler.
  .then(() => pumpJobQueue())
  .then(() => startJobWatchdog())
  .then(() => logEvent('info', 'server.started', {
    version: APP_VERSION,
    platform: process.platform,
    architecture: process.arch,
    port: PORT
  }))
  .then(() => {
    http.createServer(requestHandler).listen(PORT, HOST, () => {
      console.log(`MeetNote is running at http://${HOST}:${PORT}`);
      console.log(`Data is stored in ${STORAGE_DIR}`);
    });
  })
  .catch(error => {
    console.error('Could not initialize local storage:', error);
    process.exitCode = 1;
  });
