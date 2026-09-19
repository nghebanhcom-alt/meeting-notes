/* ============================================
   MeetNote AI — Export directory validate + atomic write (BR-42, BR-43,
   BR-46, BR-47). Architecture.md §5.1/§5.4.

   Callers pass `storageDir`/`rootDir` explicitly instead of this module
   reaching into server.js constants — keeps this file requireable in
   isolation (no circular require with server.js) and testable against a
   real temp directory (Protocol 5.3/5.4 — no fs mocking).
   ============================================ */

const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const VALIDATE_TIMEOUT_MS = 5000;
const WRITE_TIMEOUT_MS = 30000;
const MAX_DIR_LENGTH = 400;
const MAX_EXPORT_ATTEMPTS = 99;
const PROBE_FILENAME = '.meetnote-write-test';

function dirError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function withTimeout(promise, ms, timeoutError) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Maps a Node fs error observed while touching the export directory to the
// machine-readable codes from Architecture.md §5.1 — mapping is backed by a
// real run against an offline Google Drive (FileProvider) mount (§0 V2),
// not guessed from documentation.
function mapFsError(error) {
  const code = error && error.code;
  if (code === 'EACCES' || code === 'EPERM') {
    return dirError('EXPORT_DIR_NOT_WRITABLE', 'Không có quyền ghi vào thư mục này.');
  }
  if (code === 'ETIMEDOUT' || code === 'EIO' || code === 'EHOSTDOWN') {
    return dirError(
      'EXPORT_DIR_UNAVAILABLE',
      'Thư mục đồng bộ (iCloud/Google Drive/OneDrive) không phản hồi. Kiểm tra kết nối hoặc chọn thư mục khác.'
    );
  }
  if (code === 'ENOSPC') {
    return dirError('EXPORT_DIR_NO_SPACE', 'Ổ đĩa đã hết dung lượng.', 507);
  }
  return error;
}

// `~` is not absolute to Node (path.resolve('~/x') resolves against cwd —
// verified, Architecture §5.1 step 4) — expand it against the home
// directory ourselves before the isAbsolute check.
function expandHome(input) {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function isInside(base, resolved) {
  return resolved === base || resolved.startsWith(base + path.sep);
}

async function probeWritable(dir) {
  const probePath = path.join(dir, PROBE_FILENAME);
  let handle;
  try {
    handle = await fsp.open(probePath, 'wx');
  } catch (error) {
    throw mapFsError(error);
  }
  await handle.close();
  await fsp.rm(probePath, { force: true });
}

async function statOrNull(target) {
  try {
    return await fsp.stat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw mapFsError(error);
  }
}

async function validateExportDirInner(input, context) {
  const { storageDir, rootDir, dryRun = false } = context || {};

  if (typeof input !== 'string' || !input.trim()) {
    throw dirError('EXPORT_DIR_REQUIRED', 'Vui lòng chọn một thư mục để lưu file .md.');
  }
  const trimmed = input.trim();
  if (trimmed.includes('\0')) {
    throw dirError('EXPORT_DIR_INVALID_CHAR', 'Đường dẫn chứa ký tự không hợp lệ.');
  }
  if (trimmed.length > MAX_DIR_LENGTH) {
    throw dirError('EXPORT_DIR_TOO_LONG', `Đường dẫn không được dài quá ${MAX_DIR_LENGTH} ký tự.`);
  }

  const expanded = expandHome(trimmed);
  if (!path.isAbsolute(expanded)) {
    throw dirError('EXPORT_DIR_NOT_ABSOLUTE', 'Vui lòng nhập đường dẫn tuyệt đối, ví dụ /Users/ban/Documents/MeetNote.');
  }
  const resolved = path.resolve(expanded);

  const boundaries = [storageDir, rootDir].filter(Boolean).map(dir => path.resolve(dir));
  for (const base of boundaries) {
    if (isInside(base, resolved)) {
      throw dirError('EXPORT_DIR_INSIDE_APP', 'Không thể chọn thư mục dữ liệu hoặc thư mục cài đặt của MeetNote.');
    }
  }
  for (const base of boundaries) {
    if (isInside(resolved, base)) {
      throw dirError(
        'EXPORT_DIR_TOO_BROAD',
        'Thư mục này quá rộng (chứa cả thư mục dữ liệu của MeetNote). Vui lòng chọn một thư mục con cụ thể hơn.'
      );
    }
  }

  const stat = await statOrNull(resolved);

  if (!stat) {
    const parent = path.dirname(resolved);
    const parentStat = await statOrNull(parent);
    if (!parentStat || !parentStat.isDirectory()) {
      throw dirError('EXPORT_DIR_NOT_FOUND', 'Thư mục cha không tồn tại. Vui lòng chọn một thư mục khác.');
    }
    // BR-42e: only ever create exactly 1 level.
    if (dryRun) {
      // §5.2 dry-run never creates the directory — the parent existing is
      // as far as "ability to create" can be confirmed without mutating.
      return { dir: resolved, created: false };
    }
    await fsp.mkdir(resolved).catch(error => { throw mapFsError(error); });
    await probeWritable(resolved);
    return { dir: resolved, created: true };
  }

  if (!stat.isDirectory()) {
    throw dirError('EXPORT_DIR_NOT_A_DIRECTORY', 'Đường dẫn đã tồn tại nhưng không phải là thư mục.');
  }

  // BR-43: always a real write probe, even in dry-run — the directory
  // already exists so there is nothing left to "not create".
  await probeWritable(resolved);
  return { dir: resolved, created: false };
}

async function validateExportDir(input, context = {}) {
  const timeoutError = dirError(
    'EXPORT_DIR_UNAVAILABLE',
    'Thư mục đồng bộ (iCloud/Google Drive/OneDrive) không phản hồi. Kiểm tra kết nối hoặc chọn thư mục khác.'
  );
  return withTimeout(
    validateExportDirInner(input, context),
    context.timeoutMs || VALIDATE_TIMEOUT_MS,
    timeoutError
  );
}

// Serializes every export write behind one global chain (§5.4) — `wx`
// placement already makes concurrent exports safe, the queue just keeps the
// " (n)" suffix sequence and logs easy to read.
let exportQueue = Promise.resolve();

function queueExportWrite(task) {
  const run = exportQueue.then(task, task);
  exportQueue = run.catch(() => {});
  return run;
}

async function writeExportFileInner(dir, baseName, content) {
  let attempt = 1;
  let handle;
  let candidate;

  for (;;) {
    candidate = attempt === 1 ? `${baseName}.md` : `${baseName} (${attempt}).md`;
    try {
      // WHY-2: `open(path, 'wx')` both checks-for and reserves the target
      // name atomically — `rename` alone silently overwrites (verified,
      // Architecture §0 V6), and existsSync-then-write is TOCTOU.
      handle = await fsp.open(path.join(dir, candidate), 'wx');
      break;
    } catch (error) {
      if (error.code === 'EEXIST') {
        attempt += 1;
        if (attempt > MAX_EXPORT_ATTEMPTS) {
          throw dirError(
            'EXPORT_TOO_MANY_FILES',
            'Đã có quá nhiều file trùng tên trong thư mục này. Hãy đổi tên cuộc họp hoặc dọn bớt thư mục.',
            409
          );
        }
        continue;
      }
      throw mapFsError(error);
    }
  }

  const target = path.join(dir, candidate);
  await handle.close();
  const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, target);
  } catch (error) {
    // BR-47: never leave a stray tmp file, nor a 0-byte placeholder wearing
    // the target's name.
    await fsp.rm(tmp, { force: true });
    await fsp.rm(target, { force: true });
    throw mapFsError(error);
  }

  return { fullPath: target, fileName: candidate, attempt };
}

function writeExportFile(dir, baseName, content) {
  const timeoutError = dirError(
    'EXPORT_DIR_UNAVAILABLE',
    'Thư mục đồng bộ không phản hồi khi ghi file. Vui lòng thử lại hoặc chọn thư mục khác.'
  );
  return queueExportWrite(() => withTimeout(
    writeExportFileInner(dir, baseName, content),
    WRITE_TIMEOUT_MS,
    timeoutError
  ));
}

module.exports = {
  validateExportDir,
  writeExportFile,
  dirError,
  mapFsError
};
