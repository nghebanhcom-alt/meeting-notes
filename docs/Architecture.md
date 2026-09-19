# Architecture — Pre-meeting Context, Notes-aware Summary, Export & Tags (MeetNote)

**Trạng thái**: Draft, chờ duyệt Checkpoint 2
**Phiên bản**: 2.0
**Ngày**: 2026-09-18
**Nguồn PRD**: `docs/PRD.md` v2.0 (BR-23 → BR-76) + `docs/preset-templates.md` (nguồn xác thực nội dung 10 preset + BLOCK DÙNG CHUNG)
**Feature trước**: `summary-presets` (Architecture v1.0) đã PASS QA. Bản v1.0 nằm trong lịch sử thư mục `docs/`; **mọi hợp đồng của v1.0 vẫn còn hiệu lực trừ những chỗ file này ghi rõ là thay đổi.** Tham chiếu dạng "§5.3 (v1.0)" trong PRD trỏ về tài liệu cũ.

> Tài liệu này chỉ chứa **hợp đồng hiện hành**. Lý do lựa chọn ở §12 "Technical Decisions (WHY)". Mọi thứ chưa tự kiểm chứng được trong phiên làm việc này đều mang nhãn `[UNVERIFIED]` kèm cách verify — Dev **không được** implement phần mang nhãn đó cho tới khi verify xong (Protocol 5.2).

---

## 0. Tóm tắt kết quả verify (đọc trước khi đọc phần còn lại)

PRD §8 liệt kê 4 rủi ro. Kết quả verify thật trong phiên này (máy macOS Darwin 25.6.0, **Node v26.8.1**, timezone `Asia/Saigon`):

| # | Câu hỏi của PRD | Kết quả | Nguồn |
|---|---|---|---|
| V1 | Ghi atomic (tmp + `rename`) có an toàn trên thư mục iCloud Drive không? | **CÓ, đã chạy thật.** `mkdir` + `writeFile` tmp + `rename` + đọc lại + `wx` → `EEXIST` đều đúng trong `~/Library/Mobile Documents/com~apple~CloudDocs/`, không để lại file `.tmp` | §7.1 |
| V2 | Thư mục đồng bộ kiểu **FileProvider** (Google Drive `~/Library/CloudStorage/…`) | **KHÔNG an toàn mặc định**: `mkdir` trả `ETIMEDOUT` (chưa kịp sync/không online). Đây là lỗi *thật đã bắt được*, không phải suy đoán → BR-42/43 phải xử lý `ETIMEDOUT`/`EIO` như lỗi thư mục, và mọi thao tác export phải có timeout + thông báo tiếng Việt thay vì treo | §7.1 |
| V3 | OneDrive / Windows | **`[UNVERIFIED]`** — máy này không có OneDrive, không có Windows | §7.1 |
| V4 | Mở Finder bằng `spawn` với `shell:false` | **CÓ, đã chạy thật.** `spawn('/usr/bin/open', [dir], {shell:false})` → `code 0`; test với thư mục tên `meetnote verify; rm -rf $(echo hi)` → thư mục **vẫn nguyên vẹn**, không có shell interpolation | §7.2 |
| V5 | Mở Explorer trên Windows | **`[UNVERIFIED]`** — xem §7.2, có phương án dự phòng bắt buộc |
| V6 | `rename` có ghi đè file đích không? | **CÓ, ghi đè im lặng** (đã chạy thật: rename `a.md`→`b.md` khi `b.md` đã tồn tại → nội dung `b.md` bị thay). ⇒ BR-46 **không thể** chỉ dựa vào rename; phải "đặt chỗ" tên đích bằng `open(target,'wx')` trước | §7.1 |
| V7 | 10 preset mẫu có lọt qua giới hạn validate hiện có không? | **CÓ** (đo thật, §9.2): `instruction` dài nhất 1808/2000 ký tự (OKR — sát trần), `label` dài nhất 32/60, `hint` dài nhất 198/300, tối đa 7 section/preset. `sectionKeyFor` thật sinh key **không trùng** trong mọi preset | §9.2 |
| V8 | Chi phí token của BLOCK DÙNG CHUNG (BR-61) | **447 token** (1563 ký tự, đo bằng chính `estimateTokens` của project); notes 4.000 ký tự ≈ **1143 token**. Tổng ≈ 1600 token *thêm vào mỗi chunk prompt* so với hằng số scaffold cũ là 2000 ⇒ BR-38 là bắt buộc, không phải tối ưu | §6.4 |

**Phát hiện kiến trúc quan trọng nhất (R-B)**: `PUT /api/settings` (`server.js:1347-1355`) **thay nguyên object settings bằng body của client và không validate gì**. Vì vậy thư mục export **không được** lưu trong `settings.json` — nếu lưu ở đó, mọi lớp kiểm tra BR-42/BR-43 đều bị vô hiệu bởi 1 request `PUT /api/settings` tự chế. Thiết kế: file server-owned riêng + route riêng có validate (§5.2, WHY-2).

---

## 1. Tech Stack

Không đổi so với baseline (`CLAUDE.md` §"Tech stack thực tế"). Feature này **không thêm bất kỳ npm dependency nào** (PRD Assumption #4) — `package.json` giữ nguyên zero-dependency.

| Lớp | Công nghệ | Ghi chú |
|---|---|---|
| Backend | Node.js built-in `http` trong `server.js` | Không thêm framework |
| Module server | CommonJS trong `server/` | Thêm `server/export/` (2 file) |
| Frontend | Vanilla JS `js/*.js` classic script + `innerHTML` + `Utils.escapeHtml` | Không build step |
| Lưu trữ | File JSON phẳng trong `storage/` | Thêm `storage/export-settings.json` (server-owned) |
| Ghi file ra ngoài | `fs/promises` (`open 'wx'`, `writeFile`, `rename`, `rm`) | Bề mặt MỚI — xem §5 |
| Mở thư mục | `child_process.spawn`, luôn `shell:false` | Dùng lại `runProcess` sẵn có (`server.js:466`) |
| Test | `node --test test/*.test.js` | Thêm 3 file test |

---

## 2. Project Structure

Chỉ liệt kê file bị ảnh hưởng. `+` = tạo mới, `~` = sửa.

```
MeetNote/
├─ server.js                              ~ 4 route mới (export settings + export + open folder),
│                                           sanitize 4 field mới ở PUT /api/meetings,
│                                           validateMeetingForSummary nhận notes + pre-meeting
├─ server/
│  ├─ meeting-types.js                  + (re-export bảng BR-25 cho phía server — xem WHY-3)
│  ├─ export/
│  │  ├─ filename.js                    + slug + yymmdd + viết tắt + reserved name (thuần hàm)
│  │  └─ dir.js                         + validate thư mục (BR-42) + write probe (BR-43) + ghi file (BR-46/47)
│  └─ llm/
│     ├─ prompts.js                       ~ buildContextBlock + SUMMARY_PRINCIPLES/CHUNK_PRINCIPLES,
│     │                                     áp vào CẢ 3 builder; PROMPT_VERSION → v4
│     ├─ index.js                          ~ tính contextBlock 1 lần, cộng vào scaffold (BR-38),
│     │                                     trả contextUsed lên generation (BR-39)
│     └─ presets.js                        ~ BUILT_IN_PRESETS: 4 preset cũ → 10 preset mới (BR-64)
├─ js/
│  ├─ meeting-types.js                  + bảng BR-25, dùng được ở CẢ browser lẫn `require()` (WHY-3)
│  ├─ tags.js                           + chuẩn hóa/dedupe/màu hash/tần suất tag (thuần hàm)
│  ├─ exporter.js                       + client wrapper cho /api/export* (đặt tên khác `export.js` sẵn có)
│  ├─ storage.js                          ~ 4 field mới trong default + sanitize import + search BR-30/BR-73
│  ├─ summary.js                          ~ _payload gửi thêm notes + pre-meeting
│  ├─ export.js                           ~ toMarkdown: thứ tự BR-51, pre-meeting, nhãn preset BR-52, tùy chọn transcript
│  ├─ app.js                              ~ form New Meeting, khu pre-meeting + tag ở Detail, nút Export,
│  │                                        dropdown preset BR-55/56/57, thư viện: chip/lọc/nhóm theo tag
│  └─ presets.js                          (không đổi)
├─ index.html                             ~ thêm 3 <script> mới (meeting-types, tags, exporter)
├─ css/                                   ~ style chip tag, thanh lọc, khối nhóm theo tag
├─ storage/
│  └─ export-settings.json              + (runtime, server-owned, trong .gitignore của storage)
└─ test/
   ├─ export-filename.test.js           + BR-45/46 (thuần hàm)
   ├─ export-dir.test.js                + BR-42/43/47 (dùng thư mục tạm thật, không mock fs)
   ├─ context-prompt.test.js            + BR-32/35/36/37/61 — test 3-builder
   └─ tags.test.js                      + BR-68/69/71
```

---

## 3. Data Model

### 3.1 Meeting object — 4 field mới (BR-23, BR-68)

```jsonc
{
  // … toàn bộ field cũ giữ nguyên …
  "meetingType": "",        // '' | 1 trong 10 mã BR-25. Mã ổn định, KHÔNG phải nhãn
  "topic": "",              // free-text ≤ 200 ký tự
  "leadBy": "",             // free-text ≤ 200 ký tự
  "tags": []                // string[], ≤ 10 phần tử, mỗi tag ≤ 30 ký tự sau trim
}
```

Quy tắc chuẩn hóa (áp dụng **giống hệt** ở client và server — cùng một bảng quy tắc, 2 lần thi hành, BR-26):

| Field | Chuẩn hóa | Giá trị lạ |
|---|---|---|
| `meetingType` | `String(v).trim()`; phải thuộc `MEETING_TYPES` | → `''` (**không** → `general`, BR-27) |
| `topic` / `leadBy` | `String(v).trim().slice(0, 200)` | không phải string → `''` |
| `tags` | map `String(t).trim().slice(0,30)`, bỏ rỗng, dedupe theo `toLowerCase()` (giữ cách viết đầu tiên), cắt còn 10 | không phải mảng → `[]` |

Vị trí thi hành:
1. **Client**: `Storage.saveMeeting` default (`js/storage.js:155-175`), `_sanitizeImportedMeeting` (`:402-450`, BR-31/BR-76 — thiếu field → mặc định, không lỗi), và tại chỗ nhập liệu (`js/app.js`).
2. **Server**: hàm mới `sanitizePreMeetingFields(meeting)` gọi trong vòng merge của `PUT /api/meetings` (`server.js:1317-1336`) — **chỉ chạm 4 field này**, mọi field khác giữ nguyên pass-through như hôm nay.
3. **Server, đường summary**: `validateMeetingForSummary` (`server.js:784-806`) bổ sung `notes`, `meetingType`, `topic`, `leadBy` vào object trả về (hiện đang **cắt bỏ** chúng — nếu quên bước này thì BR-32 không bao giờ chạy được, xem §6.1).

### 3.2 Bảng `MEETING_TYPES` (BR-25) — 1 nguồn duy nhất

File `js/meeting-types.js`, mảng **có thứ tự** (thứ tự dropdown):

```js
[{ code, label, abbr, presetName }, …]
```

| code | label | abbr | presetName (= label) |
|---|---|---|---|
| `general` | General Meeting | `GM` | General Meeting |
| `giao-ban` | Họp giao ban | `GB` | Họp giao ban |
| `kinh-doanh` | Họp phòng kinh doanh | `KD` | Họp phòng kinh doanh |
| `marketing` | Họp phòng marketing | `MKT` | Họp phòng marketing |
| `brainstorm` | Brainstorming | `BS` | Brainstorming |
| `hdqt` | Họp HĐQT | `HDQT` | Họp HĐQT |
| `sales-call` | Sales call | `SC` | Sales call |
| `training` | Training | `TR` | Training |
| `rnd` | R&D sản phẩm | `RD` | R&D sản phẩm |
| `okr` | OKR — xây dựng & check-in | `OKR` | OKR — xây dựng & check-in |

`presetName` **phải trùng khít** `name` của 10 preset seed (§9) — đó là toàn bộ cơ chế của BR-67, không có bảng ánh xạ thứ hai. Test bắt buộc: `MEETING_TYPES.map(t => t.presetName)` bằng đúng `BUILT_IN_PRESETS.map(p => p.name)`.

File này chạy ở **cả 2 môi trường**: khai báo `const MEETING_TYPES = […]` (global cho browser) + đuôi `if (typeof module !== 'undefined' && module.exports) module.exports = { MEETING_TYPES, … };`. `server/meeting-types.js` chỉ là `module.exports = require('../js/meeting-types.js')` để phía server không phải import xuyên thư mục `js/` ở nhiều chỗ. Lý do: WHY-3.

### 3.3 `storage/settings.json` (client-owned, không validate ở server)

Thêm **1 field**:

```jsonc
"presetByMeetingType": { "sales-call": "b1f2…", "okr": "9ac0…" }   // BR-57.1, tối đa 10 entry
```

Ghi khi Generate thành công (`js/app.js`, cạnh chỗ ghi `lastSummaryPresetId` hiện có tại `:1709`). Đọc/prune ở client: entry trỏ tới preset không còn tồn tại → xóa entry, rơi về khớp theo tên (BR-58). Sanitize import: chỉ nhận object phẳng `code → string ≤128`, key phải thuộc `MEETING_TYPES`.

**Không** đưa thư mục export vào đây — xem §5.2 và WHY-2.

### 3.4 `storage/export-settings.json` (server-owned, MỚI)

```jsonc
{
  "markdownDir": "/Users/hieu/Documents/MeetNote",   // luôn là absolute path ĐÃ resolve, đã validate
  "updatedAt": "2026-09-18T…"
}
```

Chỉ được ghi qua `PUT /api/export-settings` (§5.2), luôn đi qua `mutateJson` + `atomicWriteJson` sẵn có. Không bao giờ được `replaceJson` từ body client. **Không** nằm trong backup JSON (đường dẫn máy này không có nghĩa trên máy khác — PRD §7 "Đồng bộ thư mục export giữa nhiều máy" là out of scope).

### 3.5 `summaryGeneration.contextUsed` (BR-39)

```jsonc
"contextUsed": { "notes": true, "notesTruncated": false, "preMeeting": true }
```

Server sinh (không phải client), nằm trong `generation` trả về từ `POST /api/summary`. **Không** thuộc snapshot preset (BR-16 giữ nguyên) — mô tả input, không mô tả cấu trúc output. Artifact `storage/summaries/<hash>.json` đã ghi cả object `summaryGeneration` nên tự động có field này, không cần sửa (`server.js:1187-1193`).

---

## 4. Pipeline & artifact từng bước (Protocol 6)

### 4.1 Luồng Generate Summary (đã có, nay thêm context)

| Bước | Ở đâu | Input đọc chính xác cái gì | Output (artifact chính xác) |
|---|---|---|---|
| G1 | `js/summary.js` `_payload` | `meeting.notes`, `.meetingType`, `.topic`, `.leadBy` (**mới — hôm nay 4 field này bị bỏ rơi tại `js/summary.js:27-34`**) | body JSON gửi `/api/summary` |
| G2 | `server.js` `validateMeetingForSummary` | `body.meeting.notes/meetingType/topic/leadBy` | object `meeting` đã clamp, **có** 4 field đó |
| G3 | `server/llm/index.js` `summarizeMeeting` | `meeting` (G2) | `context = buildContextBlock(meeting)` → `{ headerLines[], notesBlock, text, contextUsed }` |
| G4 | `index.js` | `context.text` + `format.sectionsBlock` | `scaffoldTokens` (BR-38, §6.4) |
| G5 | `prompts.js` 3 builder | **`context` được TRUYỀN VÀO**, không builder nào tự dựng lại | chuỗi prompt (§6.2) |
| G6 | adapter provider | prompt + `format` (không đổi so với v1.0) | raw text |
| G7 | `index.js` `generateSummary` | `context.contextUsed` (cùng object của G3) | `generation.contextUsed` (BR-39) |
| G8 | `server.js` route | `result.data` + `result.generation` | response + artifact `summaries/<hash>.json` |

**Ràng buộc chống lỗi lineage**: `contextUsed` ở G7 **bắt buộc** phải là object do chính lần gọi `buildContextBlock` ở G3 sinh ra. Cấm cho builder tự gọi lại `buildContextBlock` bên trong rồi báo cáo cờ riêng — 2 nguồn sẽ lệch nhau khi ngưỡng cắt notes đổi. Test bắt buộc (Protocol 6.2): dựng meeting có notes 5.000 ký tự → assert **giá trị cụ thể**: prompt chứa đúng 4.000 ký tự đầu đã cắt ở ranh giới xuống dòng **và** `generation.contextUsed.notesTruncated === true` trong cùng một lần chạy.

### 4.2 Luồng Export .md (mới)

| Bước | Ở đâu | Input | Output |
|---|---|---|---|
| E1 | `js/app.js` nút "Export .md" | `meetingId`, checkbox `includeTranscript` (BR-54) | gọi `Storage.flush()` trước, để `meetings.json` trên đĩa là bản mới nhất |
| E2 | `js/export.js` `toMarkdown(meeting, {includeTranscript})` | meeting trong bộ nhớ client | chuỗi markdown (§5.4) |
| E3 | `js/exporter.js` | `{ meetingId, content, includeTranscript }` | `POST /api/export/markdown` |
| E4 | `server.js` route | `body.meetingId` → **đọc meeting từ `MEETINGS_FILE`** (không tin body cho metadata) | `meetingRecord` |
| E5 | `server/export/dir.js` `resolveExportDir()` | `storage/export-settings.json` | `dir` đã validate + **write probe lại** (BR-43) |
| E6 | `server/export/filename.js` `buildFileName(meetingRecord)` | `meetingRecord.date/topic/title/meetingType` | `baseName` (chưa có `.md`) |
| E7 | `dir.js` `writeExportFile(dir, baseName, content)` | E5 + E6 + `body.content` | `{ fullPath, fileName, attempt }` |
| E8 | route | E7 | `200 { path, fileName, warnings[] }` |
| E9 | `js/app.js` | `path` từ E8 | toast + nút "Mở thư mục" → `POST /api/export/open-folder` (**không kèm path**, §5.3) |

`content` (E3) là **nội dung file**, không phải đường dẫn — không mở bề mặt path nào. Tên file luôn do server sinh từ dữ liệu trên đĩa của chính server (E4→E6). Xem §5.5 phân tích bảo mật R-B và §11 E-1 (điểm lệch so với câu chữ BR-41, cần PM xác nhận).

---

## 5. Export .md — thiết kế chi tiết

### 5.1 Validate thư mục (BR-42) — `server/export/dir.js` `validateExportDir(input)`

Thứ tự kiểm tra, dừng ở lỗi đầu tiên, mỗi lỗi có `code` máy đọc + message tiếng Việt:

| # | Điều kiện | Code lỗi |
|---|---|---|
| 1 | là string, `trim()` khác rỗng | `EXPORT_DIR_REQUIRED` |
| 2 | không chứa `\0` | `EXPORT_DIR_INVALID_CHAR` |
| 3 | độ dài ≤ 400 ký tự | `EXPORT_DIR_TOO_LONG` |
| 4 | `path.isAbsolute(input)` — **`~` KHÔNG được coi là tuyệt đối**; `path.resolve('~/Documents')` cho ra đường dẫn dựa trên cwd (đã chạy thật, ra `/private/tmp/~/Documents`). Client phải thay `~` bằng `os.homedir()` **ở server** trước bước 4, hoặc báo lỗi rõ | `EXPORT_DIR_NOT_ABSOLUTE` |
| 5 | `resolved = path.resolve(input)`; `resolved` **không** nằm trong `STORAGE_DIR` và **không** nằm trong `ROOT_DIR` (thư mục cài app) — so bằng `resolved === base \|\| resolved.startsWith(base + path.sep)` | `EXPORT_DIR_INSIDE_APP` |
| 6 | `resolved` không phải là tổ tiên của `STORAGE_DIR`/`ROOT_DIR` (chọn `/` hay `$HOME` thì `clearDirectory` không đụng tới, nhưng cho phép sẽ khiến file export lẫn vào chỗ nguy hiểm) | `EXPORT_DIR_TOO_BROAD` |
| 7 | `stat(resolved)`: tồn tại và là thư mục → OK. Không tồn tại → `stat(dirname)` phải tồn tại và là thư mục, rồi `mkdir(resolved)` (chỉ tạo **1 cấp**, BR-42e) | `EXPORT_DIR_NOT_FOUND` / `EXPORT_DIR_NOT_A_DIRECTORY` |
| 8 | **Write probe thật** (BR-43): `open(path.join(resolved,'.meetnote-write-test'),'wx')` → close → `rm`. | `EXPORT_DIR_NOT_WRITABLE` |

Xử lý mã lỗi hệ thống khi bắt được ở bước 7/8 (V2 — đã đo thật trên Google Drive FileProvider): `EACCES`/`EPERM` → `EXPORT_DIR_NOT_WRITABLE`; `ETIMEDOUT`/`EIO`/`EHOSTDOWN` → `EXPORT_DIR_UNAVAILABLE` ("Thư mục đồng bộ (iCloud/Google Drive/OneDrive) không phản hồi. Kiểm tra kết nối hoặc chọn thư mục khác."); `ENOSPC` → `EXPORT_DIR_NO_SPACE`. Toàn bộ `validateExportDir` chạy dưới `Promise.race` timeout **5 giây** → `EXPORT_DIR_UNAVAILABLE`; nếu không có timeout, một thư mục cloud offline sẽ treo cả request (bằng chứng V2).

**Không dùng `fsp.access(dir, W_OK)` làm bằng chứng ghi được** — đã đo: trên thư mục `0o500` cả `access` lẫn `writeFile` đều `EACCES` (khớp nhau), nhưng `access` không bao gồm trường hợp filesystem read-only/ACL/cloud-offline. Write probe là điều kiện đủ, `access` không phải. BR-43 đã chọn đúng.

### 5.2 API mới

Tất cả nằm dưới `/api/` nên **tự động** đi qua lớp `hasTrustedHost` + `isTrustedApiRequest` (`server.js:1480`, đã verify) — route mới **không được** tự tạo đường vòng.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/export-settings` | — | `200 { markdownDir, suggestedDir, configured, status }` — `suggestedDir` = `path.join(os.homedir(),'Documents','MeetNote')` (BR-44, **chỉ gợi ý, không tạo**) |
| PUT | `/api/export-settings` | `{ markdownDir: string }` | `200 { markdownDir }` / `400 { error:{code,message} }` theo §5.1 |
| POST | `/api/export-settings/check` | `{ markdownDir?: string }` | `200 { ok:true }` / `400 …` — chạy đúng `validateExportDir` nhưng **không lưu**, và **không** `mkdir` (dry-run: bước 7 chỉ kiểm tra khả năng tạo). Phục vụ nút "Kiểm tra thư mục" (PRD §6.4) |
| POST | `/api/export/markdown` | `{ meetingId, content, includeTranscript }` | `200 { path, fileName, warnings[] }` / `400` / `409` / `507` |
| POST | `/api/export/open-folder` | *(body rỗng)* | `200 { opened:true }` / `501 { error:{code:'OPEN_FOLDER_UNSUPPORTED'} }` |

Chi tiết `POST /api/export/markdown`:
- `content`: string, bắt buộc, `Buffer.byteLength(content,'utf8')` ≤ **8 MB** (dưới `MAX_JSON_BYTES = 20MB` sẵn có, `server.js:34`) → vượt `413 EXPORT_CONTENT_TOO_LARGE`.
- `meetingId` phải tồn tại trong `meetings.json` → không có: `404 EXPORT_MEETING_NOT_FOUND`. `meetingId` **chỉ dùng để tra trong mảng JSON**, không bao giờ ghép vào đường dẫn (giống cách xử lý `:id` của preset ở v1.0).
- Chưa cấu hình thư mục → `400 EXPORT_DIR_NOT_CONFIGURED`, client mở thẳng Settings §Xuất file (BR-44, không báo lỗi cụt).
- Cảnh báo mềm (không chặn, trả trong `warnings[]`): `EXPORT_NO_SUMMARY` (BR-53), `EXPORT_LARGE_TRANSCRIPT` khi `transcript.length > 20000` (BR-54 — client cảnh báo *trước* khi gửi, server chỉ ghi nhận).
- Ghi log `logEvent('info','export.markdown',{ fileName, attempt })` — **chỉ tên file và số lần thử, không ghi đường dẫn đầy đủ và không ghi nội dung** (`sanitizeDiagnosticValue` không biết đường dẫn là dữ liệu cá nhân).

### 5.3 Mở thư mục (BR-48) — `POST /api/export/open-folder`

```js
// macOS — ĐÃ VERIFY THẬT (§7.2)
runProcess('/usr/bin/open', [dir], { timeoutMs: 5000 });
// Windows — [UNVERIFIED], xem §7.2
```

- Body **rỗng**: server tự đọc `markdownDir` từ `export-settings.json` và validate lại trước khi mở. Client không có cách nào chỉ định thư mục khác.
- `shell: false` luôn (mặc định của `runProcess`, `server.js:471`).
- Platform ngoài `darwin`/`win32`, hoặc Windows khi chưa gỡ nhãn `[UNVERIFIED]` → trả `501 OPEN_FOLDER_UNSUPPORTED`; client **tự động** rút gọn UI còn "Copy đường dẫn" (phương án dự phòng PRD §8/§D2). Nút "Copy đường dẫn" **luôn hiện** kể cả khi mở được — rẻ và không phụ thuộc verify.

### 5.4 Tên file + ghi file (BR-45, BR-46, BR-47)

`server/export/filename.js` — thuần hàm, không I/O:

| Hàm | Signature | Hành vi |
|---|---|---|
| `yymmdd` | `(isoDate) => string` | `new Date(iso)`, dùng `getFullYear/getMonth/getDate` (**giờ địa phương**, BR-45.1 — đã verify: `2026-09-18T23:30:00Z` ở `Asia/Saigon` ra `260919`). Ngày không hợp lệ → dùng `new Date()` |
| `slugTopic` | `(topic, title) => string` | nguồn = `topic.trim() \|\| title.trim()`; `normalize('NFD')` bỏ dấu, `đ→d`/`Đ→D` (NFD **không** tách `đ` — đã verify), `[^A-Za-z0-9]+ → '-'`, gộp `-`, trim `-`, cắt ≤ 60, rỗng → `hop`. Đã chạy thật: `"Họp chốt giá Q4" → "Hop-chot-gia-Q4"`, `"Đánh giá KPI — tháng 9" → "Danh-gia-KPI-thang-9"`, `"こんにちは" → ""` → `hop` |
| `abbrFor` | `(meetingType) => string` | tra `MEETING_TYPES`; không khớp hoặc `''` → `''` |
| `buildFileName` | `(meeting) => string` | `[yymmdd, slug, abbr].filter(Boolean).join('-')` → **không bao giờ có `-` thừa** khi thiếu phần (BR-45.3, AC của US-10). Sau khi ghép: nếu base (không phân biệt hoa/thường) ∈ `{CON,PRN,AUX,NUL,COM1..9,LPT1..9}` → thêm `_` |

`server/export/dir.js` `writeExportFile(dir, baseName, content)` — trình tự **bắt buộc** (thứ tự này là kết quả của V6):

1. `candidate = baseName + '.md'`; nếu `attempt > 1` → `` `${baseName} (${attempt}).md` `` (BR-46: ` (2)` … ` (99)`).
2. **Đặt chỗ**: `handle = await fsp.open(path.join(dir, candidate), 'wx')` → `EEXIST` → tăng `attempt`, lặp lại. `attempt > 99` → `409 EXPORT_TOO_MANY_FILES`.
   *Vì sao cần bước này*: `rename` **ghi đè im lặng** file đích (đã chạy thật, V6). Nếu chỉ "tmp rồi rename" thì BR-46 sẽ bị vi phạm khi 2 lần export chạy sát nhau. `open('wx')` là thao tác tạo file **nguyên tử** của OS → vừa kiểm tra vừa giữ chỗ.
3. `await handle.close()`.
4. Ghi tmp **trong cùng thư mục đích**: `tmp = target + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp'` (đúng khuôn `atomicWriteJson`, `server.js:107`) → `writeFile(tmp, content, 'utf8')`.
5. `rename(tmp, target)` — ghi đè đúng file 0 byte mình vừa đặt chỗ.
6. `catch` bất kỳ bước 4–5: `rm(tmp, {force:true})` **và** `rm(target, {force:true})` (dọn cả file đặt chỗ, nếu không sẽ để lại file rỗng mang tên đích — đúng điều BR-47 cấm), rồi ném lỗi đã map mã (§5.1).
7. Trả `{ fullPath: path.join(dir, candidate), fileName: candidate, attempt }`.

Toàn bộ `writeExportFile` chạy dưới timeout 30 giây (transcript lớn + thư mục cloud), quá hạn → `EXPORT_DIR_UNAVAILABLE` sau khi dọn như bước 6.

Serialize: bọc bằng `withJsonMutation`-style queue theo key `'export:' + dir` hoặc đơn giản 1 promise chain toàn cục cho export — 2 request export song song cùng lúc vẫn an toàn nhờ `wx`, nhưng queue giúp số hậu tố ` (n)` tăng đều và log dễ đọc.

### 5.5 Vì sao endpoint export vẫn an toàn (trả lời R-B của PRD §8)

| Bề mặt | Lớp phòng thủ | Nguồn đã verify |
|---|---|---|
| Client chỉ định path tùy ý | **Không tồn tại**: không request nào nhận path. `markdownDir` chỉ vào hệ thống qua `PUT /api/export-settings` và bị `validateExportDir` chặn (§5.1); `export/markdown` và `open-folder` đọc lại từ file server-owned | Thiết kế §5.2 |
| Bypass validate bằng cách ghi thẳng `settings.json` | **Bị vô hiệu bởi thiết kế**: thư mục export **không** nằm trong `settings.json` (nơi `PUT /api/settings` thay nguyên object không validate) | `server.js:1347-1355` (đọc source) |
| Path traversal qua tên file | Tên file do server sinh; slug chỉ giữ `[A-Za-z0-9-]` → không thể chứa `/`, `\`, `..`, `\0`. `meetingId` chỉ dùng tra mảng | §5.4 + `server.js:328` (quy ước hash sẵn có không áp dụng vì đây là file cho người đọc — xem WHY-4) |
| Ghi đè file người dùng | `open('wx')` + hậu tố ` (n)` (BR-46) | V6 |
| CSRF / DNS-rebinding | Route nằm dưới `/api/`, dùng chung gate `hasTrustedHost` + `isTrustedApiRequest`; `POST` bắt buộc `Content-Type: application/json` (`readJsonRequest`, `server.js:282-295`) chặn simple-request | đọc source `server.js:1474-1490` |
| Command injection khi mở thư mục | `spawn(..., {shell:false})`, path là **1 argument riêng** | V4 (chạy thật) + doc Node (§7.2) |
| Ghi đè chính app / bị app tự xóa | BR-42 bước 5/6 loại `STORAGE_DIR`, `ROOT_DIR` và các thư mục tổ tiên | §5.1 |

**Reviewer bắt buộc kiểm**: không có code path nào lấy đường dẫn từ `request` body/query/header; `validateExportDir` được gọi lại ở **mỗi** lần export chứ không chỉ lúc lưu Settings (BR-43).

### 5.6 Nội dung file .md (BR-51, BR-52, BR-53, BR-54) — `js/export.js` `toMarkdown`

Thứ tự khối, **bỏ hẳn khối rỗng** (không in heading trống):

```
# <title>
**Ngày:** … **Thời lượng:** …
**Loại cuộc họp:** <label>          ← chỉ in khi khác rỗng (BR-51)
**Chủ đề:** <topic>
**Chủ trì:** <leadBy>
**Người tham dự:** …
**Tag:** a, b, c                     ← BR-31/BR-76: tag có trong file export
## <label section 1>                 ← theo snapshot preset (BR-16 giữ nguyên)
…
> Tóm tắt bằng preset "<name>"<, đã bị xóa khỏi ứng dụng> · <generatedAt>   (BR-52)
## Việc cần làm                      ← meeting.actionItems (list của user, không đổi)
## Ghi chú                           ← notes
## Transcript                        ← chỉ khi includeTranscript (BR-54)
```

Thay đổi so với hôm nay (`js/export.js:9-68`): **Notes chuyển lên TRƯỚC Transcript** (hiện đang sau), thêm khối pre-meeting + tag, thêm dòng ghi chú preset, transcript thành tùy chọn. Summary legacy không có snapshot → dùng virtual snapshot General Meeting, **không** in "(preset đã bị xóa)" (BR-52). `Export.downloadMarkdown` (tải qua trình duyệt) **giữ nguyên** làm đường dự phòng khi chưa cấu hình thư mục.

---

## 6. Prompt — notes + pre-meeting + nguyên tắc bắt buộc

### 6.1 `buildContextBlock(meeting, options)` — hàm mới trong `server/llm/prompts.js`

```js
buildContextBlock(meeting, { maxNotesChars = 4000 })
  → { headerLines: string[], notesBlock: string, text: string, contextUsed: {notes, notesTruncated, preMeeting} }
```

- `headerLines`: chỉ các dòng **khác rỗng** (BR-37), theo thứ tự `Meeting type: <label tiếng Việt>`, `Topic: …`, `Lead by: …`. Field rỗng → **bỏ dòng**, không in `Unknown`.
- `notesBlock`: rỗng khi `notes.trim() === ''` (BR-36 — bỏ hẳn khối, không gửi khối rỗng). Ngược lại:
  ```
  Notes (written by the user before/after the meeting — quoted untrusted data):
  <4.000 ký tự đầu, cắt ở ký tự '\n' cuối cùng trong khoảng đó; không tìm thấy '\n' → cắt cứng>
  ```
- `text = [...headerLines, notesBlock].filter(Boolean).join('\n')` — dùng cho tính token (§6.4).
- `contextUsed.preMeeting = headerLines.length > 0`; `notes = notesBlock !== ''`; `notesTruncated = notes.length > maxNotesChars`.

### 6.2 Vị trí chèn trong từng builder (chi tiết đủ để Dev không phải đoán)

Hai hằng số mới, **nội dung lấy nguyên văn từ BLOCK DÙNG CHUNG** của `docs/preset-templates.md` (BR-61 — file đó là nguồn xác thực duy nhất, Dev copy nguyên văn, không diễn đạt lại):

- `SUMMARY_PRINCIPLES` = nguyên văn cả khối.
- `CHUNK_PRINCIPLES` = **tập con** theo BR-61 đoạn 2: giữ các gạch đầu dòng về (a) chỉ ghi nội dung có trong transcript, (b) chép chính xác số liệu/tên riêng, (c) `[?]` khi nghe không rõ, (d) được sửa chính tả không sửa nghĩa, (e) gắn tên người nói / `[chưa rõ người nói]`, (f) bỏ chào hỏi & lặp lại. **Bỏ**: phân loại ĐÃ CHỐT/ĐANG BÀN/Ý KIẾN CÁ NHÂN, quy tắc "mục rỗng ghi Không có", quy tắc "việc cần làm phải đủ người-hạn chót" (đều là kết luận toàn cục, chỉ có nghĩa ở bước reduce).
- 1 câu bổ sung cho cả 2 (BR-63, đặt ngay sau khối nguyên tắc, **chỉ khi `contextUsed.notes === true`**):
  > "Notes trong `<meeting_data>` là do người dùng viết và được coi là đáng tin hơn transcript: khi một giá trị (số liệu, tên riêng, thuật ngữ, tên người) trong transcript khác với thông tin tương ứng trong Notes, hãy dùng giá trị trong Notes và không đánh dấu `[?]`. Chỉ áp dụng cho đúng phần nội dung mà Notes có đề cập; Notes nói chung chung → giữ transcript kèm `[?]`. Notes **không** được dùng để thêm sự kiện/quyết định/việc cần làm mà transcript hoàn toàn không nhắc tới."

Bố cục prompt sau thay đổi (phần **in đậm** là mới):

| Builder | Thứ tự khối | Ghi chú |
|---|---|---|
| `buildSummaryPrompt` (`prompts.js:76-106`) | câu mở đầu → cảnh báo untrusted → `Requirements:` (languageClause, "Summarize the main discussion…", **`SUMMARY_PRINCIPLES`**, **câu BR-63 nếu có notes**, `dynamicBlock` preset, "Return only JSON…") → `<meeting_data>`: Title, Date, Duration, **`headerLines`**, Participants, **`notesBlock`**, Transcript | Notes đặt **trước** Transcript để LLM đọc "từ điển sửa lỗi" trước khi đọc dữ liệu cần sửa |
| `buildChunkPrompt` (`:134-160`) | như trên nhưng `Requirements:` dùng **`CHUNK_PRINCIPLES`** → `<meeting_data>`: Title, **`Meeting type`**, **`Topic`** (BR-37: **không** thêm Date/Duration), Participants, **`notesBlock`**, Transcript excerpt | `headerLines` được lọc còn 2 dòng bằng `context.headerLines.filter(l => !l.startsWith('Lead by'))`? **Không** — BR-37 chỉ loại Date/Duration, `Lead by` vẫn hữu ích cho việc gán tên người nói (BR-62). Dev dùng nguyên `headerLines` |
| `buildSynthesisPrompt` (`:163-194`) | `Requirements:` dùng **`SUMMARY_PRINCIPLES`** + câu BR-63 → `<meeting_data>`: Title, Date, Duration, **`headerLines`**, Participants, **`notesBlock`** → `<partial_notes>` | Bước ra kết luận cuối ⇒ dùng bản đầy đủ (BR-61) |

Chữ ký: `buildSummaryPrompt(meeting, outputLanguage, preset, context)`, `buildChunkPrompt(meeting, segments, index, total, outputLanguage, preset, context)`, `buildSynthesisPrompt(meeting, partials, outputLanguage, preset, context)`. `context` thiếu → builder tự gọi `buildContextBlock(meeting)` (giữ test cũ chạy được), nhưng **đường production luôn truyền vào** (§4.1 G5).

`PROMPT_VERSION` → **`meeting-summary-v4`**.

**Test bắt buộc (BR-32, kiểu T5 của feature trước)**: 1 meeting có notes + đủ 3 field pre-meeting → cả 3 builder đều chứa (a) chuỗi notes, (b) `Meeting type:`, (c) `Topic:`; và `buildSummaryPrompt`/`buildSynthesisPrompt` chứa 1 câu mốc của `SUMMARY_PRINCIPLES` mà `buildChunkPrompt` **không** chứa (chứng minh tập con đúng, không phải copy nguyên).

### 6.3 Prompt injection (BR-33)

`notesBlock` nằm **bên trong** `<meeting_data>` — khối đã được `SYSTEM_INSTRUCTION` (`prompts.js:13-17`) và câu cảnh báo trong từng prompt tuyên bố là untrusted. Không thêm cơ chế mới. Ngược lại, `SUMMARY_PRINCIPLES` và câu BR-63 nằm **ngoài** `<meeting_data>` (phần trusted) — người dùng không ghi đè được bằng cách gõ vào notes.

Mâu thuẫn cần Dev ý thức (không phải lỗi): BR-63 cố tình cho phép dữ liệu untrusted (notes) *ghi đè* dữ liệu untrusted khác (transcript). Đây là quyết định sản phẩm của user (D-6), không mở thêm quyền gì cho notes ngoài phạm vi nội dung bản tóm tắt — notes vẫn không thể khiến LLM gọi tool/đọc file vì `SYSTEM_INSTRUCTION` giữ nguyên.

### 6.4 Ngân sách map-reduce (BR-38) — `server/llm/index.js`

```js
const context = buildContextBlock(meeting);                    // G3, gọi ĐÚNG 1 LẦN
const scaffoldTokens =
    CHUNK_SCAFFOLD_BASE_TOKENS                                  // 2000, giữ nguyên
  + (format ? estimateTokens(format.sectionsBlock) : 0)         // đã có từ v1.0
  + estimateTokens(context.text)                                // MỚI — BR-38
  + estimateTokens(CHUNK_PRINCIPLES);                           // MỚI — xem dưới
```

`CHUNK_PRINCIPLES` phải được tính vào scaffold vì nó nằm trong **mọi** chunk prompt. Số đo thật (§0 V8): principles đầy đủ 447 token, notes tối đa ≈1143 token ⇒ phần mới có thể chiếm tới ~1.6k token/chunk — lớn hơn cả phần dư của hằng số 2000 cũ. Bỏ qua bước này = đúng loại lỗi Protocol 8 mà bản v1.0 đã bắt được một lần với `sectionsBlock`.

`MAX_CHUNKS = 40` và `MIN_CHUNK_TOKENS = 2000` giữ nguyên (xem audit §6.5).

### 6.5 Protocol 8 — audit từng bước hiện có với "biến thể" = summary có context

Biến thể mới đi qua đúng pipeline `summarizeMeeting`. Audit **tất cả** các bước đã có (không chỉ bước mới):

| Bước hiện có | Giải quyết vấn đề gì trước đây | Biến thể mới có cùng vấn đề không? | Kết luận |
|---|---|---|---|
| `inputBudget(contextWindow)` (`index.js:135`) | Chặn prompt vượt context | Có, y hệt | **GIỮ** |
| Bỏ chunking khi `contextWindow === 0` (Codex, `codex.js`) | Codex tự lo độ dài | Có, không phụ thuộc context block | **GIỮ** |
| `CHUNK_SCAFFOLD_BASE_TOKENS` + `sectionsBlock` (`index.js:133`) | Chừa chỗ cho template | **KHÔNG đủ** — context block + principles là phần template mới | **SỬA** (§6.4) |
| `chunkTranscript` | Cắt theo segment, giữ thứ tự thời gian | Có; notes không nằm trong transcript nên không ảnh hưởng cách cắt | **GIỮ** |
| `MAX_CHUNKS = 40` | Chặn reduce không nhét vừa | Có; context làm mỗi chunk *nhỏ hơn* ⇒ số chunk *tăng*. 40 vẫn là trần bảo thủ, nhưng cuộc họp trước đây vừa đủ 40 chunk nay có thể vượt → **báo lỗi rõ ràng `CONTEXT_TOO_LARGE`, không im lặng** (hành vi hiện có đã đúng) | **GIỮ** + ghi nhận là hệ quả đã biết của R-D |
| `buildSynthesisPrompt` kiểm tra `estimateTokens > budget` (`index.js:162`) | Reduce vượt budget | Có, và nay synthesis còn cõng thêm context block → kiểm tra này **quan trọng hơn trước** | **GIỮ** |
| `withRepair` (`contracts.js`) | Sửa JSON hỏng 1 lần | Có; repair hint không nhắc tới notes | **GIỮ** |
| `format.normalize` động (v1.0) | Ép kiểu output theo preset | Có; feature này **không đổi output structure** (PRD Assumption #1) | **GIỮ** |
| `withRetry` chỉ cho `kind==='api'` | Retry lỗi mạng | Có | **GIỮ** |
| Queue tuần tự per-provider | Không chạy song song Codex | Có | **GIỮ** |
| 3 cơ chế enforce schema (Codex `--output-schema` / Gemini `responseSchema` / DeepSeek prompt-only) | Ràng buộc hình dạng output | Có, **và không đổi** — context chỉ là input text | **GIỮ NGUYÊN, CẤM ĐỘNG VÀO** |

Không bước nào rơi vào trạng thái "chưa rõ" ⇒ không bước nào bị SKIP mặc định. Dev phát hiện bước thứ 12 chưa có trong bảng → dừng, hỏi Tech Lead.

---

## 7. External / Built-in Contracts + Nguồn xác thực

Mọi mục dưới đây đã chạy thật trong phiên này trừ chỗ ghi `[UNVERIFIED]`. Script verify: `scratchpad/verify.js` (không commit); Dev **phải** biến các phép đo này thành test thật ở T14/T15.

### 7.1 Node.js `fs/promises` — ghi file ra thư mục ngoài

| Mục | Giá trị |
|---|---|
| Version đã verify | **Node v26.8.1**, macOS Darwin 25.6.0, APFS + iCloud Drive |
| `rename(tmp, target)` khi `target` đã tồn tại | **Ghi đè im lặng**, `tmp` biến mất. Chạy thật: ghi `AAA`→`a.md`, `BBB`→`b.md`, `rename(a,b)` → `b.md` = `AAA`, `a.md` không còn |
| `open(path,'wx')` khi file đã tồn tại | Ném lỗi `code: 'EEXIST'` — chạy thật ở cả tmpdir lẫn iCloud Drive |
| tmp + rename trên **iCloud Drive** | **OK**: `mkdir` → `writeFile` tmp → `rename` → đọc lại đúng nội dung UTF-8 tiếng Việt → không còn file `.tmp` nào trong thư mục |
| tmp + rename trên **Google Drive (`~/Library/CloudStorage/`, FileProvider)** | **THẤT BẠI ngay ở `mkdir`**: `ETIMEDOUT: connection timed out`. ⇒ mọi thao tác thư mục phải có timeout + map mã lỗi (§5.1) |
| tmp + rename trên **OneDrive / Windows placeholder** | **`[UNVERIFIED]`** — máy này không có. **Cách verify trước khi Dev đóng task**: trên 1 máy Windows có OneDrive, chạy `node -e` đúng chuỗi ở trên với thư mục `%USERPROFILE%\OneDrive\Documents\MeetNote`, dán log vào `docs/test-report.md`. Nếu thất bại → **không được** quảng cáo BR-47 là an toàn cho OneDrive; hành vi thay thế đã có sẵn: lỗi được map thành `EXPORT_DIR_UNAVAILABLE` và người dùng chọn thư mục khác. Dev **được phép** implement §5.4 ngay (thiết kế đã bao gồm đường lỗi), **không được** viết tài liệu/ toast khẳng định "an toàn trên mọi thư mục đồng bộ" |
| `access(dir, W_OK)` vs write probe | Trên thư mục `0o500`: cả hai cùng `EACCES`. `access` **không** được dùng thay probe (§5.1) |
| Cross-device `rename` (`EXDEV`) | Không tái hiện được trên máy này (tmpdir và iCloud cùng volume). Thiết kế **đã miễn nhiễm**: file tmp luôn nằm **trong chính thư mục đích** ⇒ không bao giờ rename xuyên volume. Không cần verify thêm |

### 7.2 Node.js `child_process.spawn` với `shell:false`

| Mục | Giá trị |
|---|---|
| Doc chính thức (đã fetch trong phiên này, nodejs.org/api/child_process.html) | `shell` … **Default: `false` (no shell)**; cảnh báo bảo mật chỉ áp dụng chiều ngược lại: *"**If the `shell` option is enabled**, do not pass unsanitized user input to this function. Any input containing shell metacharacters may be used to trigger arbitrary command execution."* ⇒ với `shell:false`, `command` + `args` đi thẳng tới OS, không qua shell interpretation |
| macOS — chạy thật | `spawn('/usr/bin/open', ['/…/meetnote verify; rm -rf $(echo hi)'], {shell:false})` → `code 0`, `stderr` rỗng, **thư mục vẫn tồn tại sau đó** (`fs.existsSync` = true) ⇒ `;` và `$( )` không bị diễn giải. Đây là bằng chứng trực tiếp cho BR-48 phần macOS |
| `open` không có `--version`; `open --help` → exit 1 + usage | Nguồn: chạy thật. Usage xác nhận `open [filenames]` mở bằng app mặc định (Finder cho thư mục) |
| Đường dẫn binary | Dùng **đường dẫn tuyệt đối `/usr/bin/open`** (đã `ls -l` xác nhận tồn tại, root:wheel 0755), không dựa vào `PATH` — cùng phong cách với `/usr/bin/security` đang dùng (`server.js:519`) |
| Windows `explorer` | **`[UNVERIFIED]`** ở cả 3 điểm: (a) đường dẫn binary đúng (`%SystemRoot%\explorer.exe`), (b) explorer có chấp nhận path làm argument khi `shell:false` không, (c) **đã biết có tin đồn explorer.exe trả exit code ≠ 0 dù mở thành công** — nếu đúng, code không được coi `code !== 0` là thất bại. **Cách verify**: trên máy Windows chạy `node -e "require('child_process').spawn(process.env.SystemRoot+'\\\\explorer.exe',[dir],{shell:false}).on('close',c=>console.log('code',c))"`, dán log vào `docs/test-report.md`. **Chặn Dev implement nhánh `win32`** (Protocol 5.2) — cho tới lúc đó nhánh `win32` trả `501 OPEN_FOLDER_UNSUPPORTED`, client hiển thị "Copy đường dẫn". Phần macOS **không bị chặn** |

### 7.3 Chuẩn hóa chuỗi & ngày tháng (built-in, đã chạy thật)

| Mục | Kết quả |
|---|---|
| `String.prototype.normalize('NFD')` + `/[̀-ͯ]/g` | Bỏ được toàn bộ dấu tiếng Việt **trừ `đ`/`Đ`** (phải thay riêng — `preset-schema.js:20-26` đã làm đúng như vậy, tái dùng logic đó) |
| `Date#getFullYear/getMonth/getDate` | Giờ **địa phương**: `2026-09-18T23:30:00Z` ở `Asia/Saigon` → `260919`. Đúng ý BR-45.1 |
| `crypto.randomUUID()` | Có sẵn, đang dùng (`server.js:107`) |

### 7.4 Nguồn xác thực nội dung (không phải tool bên thứ 3, nhưng vẫn cần chốt)

| Mục | Nguồn |
|---|---|
| Nội dung 10 preset + BLOCK DÙNG CHUNG | `docs/preset-templates.md` (user cung cấp, đã trong repo). Dev copy **nguyên văn**, không diễn đạt lại, không thêm/bớt gạch đầu dòng |
| Giới hạn validate hiện hành | `server/llm/presets.js:13-24` (`LIMITS`) — đọc source |
| Cơ chế enforce schema 3 provider | Không đổi trong feature này; hợp đồng đã verify ở Architecture v1.0 §6 (Codex `--output-schema`; Gemini `responseSchema` dialect OpenAPI không `$schema`/`additionalProperties`; DeepSeek `response_format:{type:'json_object'}` — **không** enforce schema, chỉ prompt + normalize) |

---

## 8. Gợi ý preset theo `meetingType` (BR-55 → BR-60)

Toàn bộ ở **client**, trong `js/app.js` `_renderSummaryPresetSelect` (hiện tại `:1540-1570`). Không cần route mới.

```
chooseDefaultPresetId(presets, meeting, session) :
  1. session.manualPresetByMeetingId[meeting.id] còn trong presets  → dùng (BR-56.1)
  2. meeting.meetingType !== '' :
     2a. settings.presetByMeetingType[meetingType] còn trong presets → dùng (BR-57.1)
     2b. presets.find(p => p.name.trim().toLowerCase()
                        === MEETING_TYPES[meetingType].presetName.trim().toLowerCase()) (BR-57.2)
  3. settings.lastSummaryPresetId còn trong presets                 → dùng (BR-10 cũ)
  4. presets.find(p => p.name === 'General Meeting')                → dùng
  5. presets[0]                                                     → dùng
  6. không có preset nào → giá trị rỗng, Generate vẫn chạy đường legacy
```

- Nhánh 2a/2b trúng → hiện nhãn phụ "Gợi ý cho *<label>*" cạnh dropdown (BR-55). Nhánh 3/4/5 → không hiện nhãn.
- `session.manualPresetByMeetingId` là **state trong bộ nhớ của App**, không persist — "phiên hiện tại" theo đúng câu chữ BR-56.1. Đặt tại `App._manualPresetByMeeting = {}` (Map), set trong handler `change` của `#summary-preset`.
- BR-58: khi nhánh 2a trỏ tới preset không còn → **xóa entry** khỏi `settings.presetByMeetingType` (ghi lại settings) rồi tiếp tục xuống 2b. Không báo lỗi.
- BR-59/BR-60: đổi `meetingType` **không** đụng `summary`, `summaryDetails`, `summaryPreset`; `meetingType` **không** được ghi vào snapshot. Chỉ `_renderSummaryPresetSelect` chạy lại.
- Gợi ý **không bao giờ** tự gọi Generate.

---

## 9. Bộ 10 preset mẫu (BR-64 → BR-67)

### 9.1 Nơi thay

`BUILT_IN_PRESETS` trong `server/llm/presets.js:29-68` — thay **toàn bộ** 4 phần tử cũ bằng 10 phần tử mới. `instantiateBuiltIns()` (`:73-93`) **không đổi logic**: vẫn sinh `id`, timestamps, `isBuiltIn:true`, và key qua `sectionKeyFor`. Được gọi ở `seedPresetsIfEmpty` (`server.js:861`) — chỉ khi danh sách **rỗng** ⇒ BR-66 (cài mới + seed lại khi rỗng) **đã đúng sẵn**, không cần code mới, và `presets.json` đang có 4 preset cũ **không** bị đụng tới.

Mapping (BR-64): `Tên preset → name`, `Mô tả → description`, `Hướng dẫn cho AI → instruction` (**chỉ block riêng của preset, KHÔNG nối BLOCK DÙNG CHUNG** — BR-65), bảng `Các mục → sections[]` với `Tên mục → label`, `Gợi ý cho AI → hint`, `Kiểu`: `Đoạn văn → paragraph`, `Danh sách → bulletList`, `Việc cần làm → actionList`.

### 9.2 Kết quả đo thật trên 10 preset (chạy `sectionKeyFor` thật + đếm ký tự)

| Preset | instruction | sections | label dài nhất | hint dài nhất |
|---|---|---|---|---|
| General Meeting | 1219 | 7 | 30 | 128 |
| Họp giao ban | 570 | 6 | 27 | 136 |
| Họp phòng kinh doanh | 798 | 6 | 27 | 124 |
| Họp phòng marketing | 786 | 7 | 30 | 122 |
| Brainstorming | 887 | 6 | 20 | 130 |
| Họp HĐQT | 899 | 7 | 30 | 134 |
| Sales call | 1025 | 6 | 32 | 137 |
| Training | 917 | 6 | 26 | 144 |
| R&D sản phẩm | 1104 | 7 | 31 | 124 |
| OKR — xây dựng & check-in | **1808** | 7 | 30 | 198 |

Kết luận: mọi preset **lọt** giới hạn hiện hành (`INSTRUCTION_MAX 2000`, `LABEL_MAX 60`, `HINT_MAX 300`, `SECTIONS_MAX 10`). Ghi chú cho Dev:
- OKR ở 1808/2000 — **sửa nhẹ instruction là có thể vượt trần**. Test T16 phải assert mọi preset seed đi qua `validatePreset` không ném lỗi (dù `instantiateBuiltIns` không gọi validate), để lần sau ai sửa nội dung sẽ fail test thay vì fail lúc người dùng bấm Sửa preset.
- 4 preset có 7 section > `SECTIONS_WARN = 6` → nếu người dùng mở ra và bấm Lưu, sẽ nhận cảnh báo mềm `PRESET_SECTIONS_WARN`. Đây là **hành vi chấp nhận được**, không chặn lưu.
- `sectionKeyFor` thật cho ra key **không trùng** trong từng preset (đã chạy: `tongQuan`, `noiDungChinh`, `soLieuThongTinQuanTrong`, …, `objectiveKeyResults`, `dieuChinhOkr`).

### 9.3 Bẫy phải tránh — BR-20 (summary cũ) không được vỡ

`GENERAL_SECTIONS` trong `server/llm/preset-schema.js` và `Summary.GENERAL_SECTIONS` trong `js/summary.js:13-19` (5 key `summary/keyPoints/decisions/actionItems/openQuestions`) là **snapshot ảo cho summary legacy**, KHÔNG phải nội dung của preset seed. Preset seed "General Meeting" mới có 7 section tiếng Việt.

⇒ Trong `BUILT_IN_PRESETS` mới, phần tử General Meeting **phải khai section riêng theo file template**, **không** dùng `sections: GENERAL_SECTIONS` như hôm nay (`presets.js:34`). Hai hằng số `GENERAL_SECTIONS` / `Summary.GENERAL_SECTIONS` **giữ nguyên không đổi** — sửa chúng sẽ làm mọi summary đã sinh trước đây hiển thị sai. Test hồi quy bắt buộc (T16): meeting có `summaryDetails` 5 key cũ + `summaryPreset: null` → `Summary.format` vẫn ra đúng như trước.

---

## 10. Tag (BR-68 → BR-76)

### 10.1 `js/tags.js` — thuần hàm, test độc lập

| Hàm | Signature | Hành vi |
|---|---|---|
| `normalizeTag` | `(v) => string` | `String(v).trim().slice(0,30)` |
| `normalizeTagList` | `(arr) => string[]` | map `normalizeTag`, bỏ rỗng, dedupe theo `toLowerCase()` **giữ bản viết đầu tiên**, cắt 10 |
| `canAddTag` | `(tags, tag) => {ok, code}` | `TAG_EMPTY` / `TAG_DUPLICATE` / `TAG_LIMIT_REACHED` (>10 → chặn thêm, báo rõ — BR-68) |
| `tagHue` | `(tag) => number` | FNV-1a 32-bit trên `tag.toLowerCase()` → `% 360`. Ổn định, không phụ thuộc thứ tự/locale/`Math.random` |
| `tagStyle` | `(tag) => string` | `background:hsl(H 65% 30%); color:hsl(H 85% 85%); border-color:hsl(H 60% 45%)` cho theme tối (biến thể sáng trong CSS). **Chỉ sinh số**, không chèn chuỗi người dùng vào style |
| `collectTags` | `(meetings) => [{tag, count, lastUsedAt}]` | Gom mọi tag, đếm theo `toLowerCase()`, `lastUsedAt = max(meeting.updatedAt)`; sort `lastUsedAt` desc rồi `count` desc (BR-69 "tần suất dùng gần đây trước") |
| `suggestTags` | `(all, query) => string[]` | lọc `includes` không phân biệt hoa/thường, giữ thứ tự của `collectTags`, tối đa 8 |

**Bảo mật hiển thị**: tag là chuỗi tự do do user gõ, render bằng `innerHTML` như toàn app ⇒ **bắt buộc** `Utils.escapeHtml(tag)` cho phần text và chỉ dùng số từ `tagHue` cho phần style. Reviewer kiểm điểm này.

### 10.2 Tự thêm tag theo `meetingType` (BR-70)

Tại chỗ đổi `meetingType` (New Meeting + Meeting Detail), sau khi set `meetingType = code`:
```
label = MEETING_TYPES[code].label
nếu code !== '' và không tag nào trong meeting.tags khớp label (so toLowerCase) và tags.length < 10:
    tags.push(label)
```
- **Không** xóa tag của `meetingType` cũ (BR-70).
- Cờ trong bộ nhớ `App._autoTagSuppressed[meetingId]` được set khi user xóa tag vừa tự thêm → không tự thêm lại trong cùng lần chỉnh sửa nếu `meetingType` không đổi tiếp (BR-70 câu cuối). Không persist.
- Đã đủ 10 tag → không thêm, không báo lỗi (tag tự động không được phép chiếm chỗ tag người dùng).

### 10.3 Thư viện meeting (BR-71 → BR-74) — `js/app.js`

Thay đổi cấu trúc quan trọng: bộ lọc hiện tại lọc bằng **ẩn/hiện DOM** (`js/app.js:2024-2035`, so khớp trên `.meeting-title` textContent). Không mở rộng được cho nhóm-theo-tag. ⇒ Chuyển sang **render từ dữ liệu**:

```
App._meetingsView = { mode: 'list' | 'byTag', text: '', tags: Set<string(lowercase)> }

visible(meetings) =
  meetings
    .filter(m => matchText(m, view.text))                 // giữ đúng ngữ nghĩa hiện tại: khớp title
    .filter(m => view.tags.size === 0 ||                  // AND giữa text và tag (BR-72)
                 m.tags.some(t => view.tags.has(t.toLowerCase())))   // OR giữa các tag
```

- `mode === 'list'`: render phẳng như hôm nay.
- `mode === 'byTag'` (BR-74): nhóm theo tag, mỗi khối 1 heading + danh sách; 1 meeting có n tag xuất hiện ở n khối; thứ tự khối theo `collectTags`; khối "Chưa gắn tag" (meeting có `tags.length === 0`) **luôn cuối cùng**. Bộ lọc text + tag vẫn áp dụng trước khi nhóm.
- Thanh chip lọc (BR-72) đặt cạnh `#meetings-filter`, dựng từ `collectTags(Storage.getAllMeetings())`, chip đang chọn có class `is-active`.
- `_renderMeetingItem` (`:2964-3010`) thêm hàng chip tag dưới `.meeting-meta` (BR-71).
- **Giữ nguyên** logic chọn nhiều + xóa hàng loạt: sau mỗi lần re-render phải gọi lại `_bindMeetingItemClicks()` và `updateSelectionUi()`; `_selectedMeetingIds` lọc lại theo meeting **đang hiển thị** đúng như hôm nay. Đây là điểm dễ vỡ nhất của phần tag — QA phải test "chọn 2 meeting → đổi bộ lọc tag → xóa" không xóa nhầm.

### 10.4 Tìm kiếm toàn cục (BR-30, BR-73) — `js/storage.js` `searchMeetings` (`:279-327`)

Thang điểm sau khi thêm (giữ nguyên các mục cũ): title 10, transcript 5, **topic 4**, action 4, **leadBy 3**, notes 3, summary 3, **tags 3**, **nhãn `meetingType` 2**. Snippet ghi rõ `field`: `'topic'`, `'leadBy'`, `'tags'`, `'meetingType'` (`js/app.js:2099` in thẳng `s.field`, nên tên field sẽ hiện ra UI — dùng đúng các chuỗi này).

---

## 11. Task Breakdown

Thứ tự: hằng số dùng chung → data layer → prompt → export server → export client → tag/UI → test. Dev làm theo `depends`.

| ID | Task | Files | Depends | Acceptance criteria |
|---|---|---|---|---|
| **T1** | Bảng `MEETING_TYPES` dùng chung 2 môi trường | `js/meeting-types.js` +, `server/meeting-types.js` +, `index.html` | — | `require('./js/meeting-types.js')` trong Node trả về 10 phần tử; mở app trong browser không lỗi console; test khẳng định `presetName` trùng khít `BUILT_IN_PRESETS.map(p=>p.name)` (chạy được sau T7) |
| **T2** | 4 field mới trong meeting: default + sanitize import + sanitize server | `js/storage.js`, `server.js` | T1 | Meeting mới có `meetingType:'' , topic:'', leadBy:'', tags:[]`; import backup thiếu field → mặc định, không lỗi (BR-31/76); `meetingType` lạ → `''` **không** → `general` (BR-27); `topic` 500 ký tự → còn 200 |
| **T3** | UI nhập pre-meeting: New Meeting + Meeting Detail | `js/app.js`, `index.html`, `css/` | T2 | Bỏ trống hết vẫn Start Recording/Save Draft (BR-24); sửa ở Detail lưu đúng sau reload; gợi ý mềm 1 lần khi `leadBy` không có trong `participants` (BR-28), bỏ qua được, không nhắc lại; nhắc nhẹ khi pre-meeting mới hơn lần generate gần nhất (BR-29) |
| **T4** | Search: topic/leadBy/meetingType/tags | `js/storage.js` | T2 | Từ khóa chỉ có ở `topic` → meeting xuất hiện, snippet `field='topic'` (BR-30); tag khớp +3 (BR-73) |
| **T5** | `buildContextBlock` + `SUMMARY_PRINCIPLES` / `CHUNK_PRINCIPLES` + áp vào **cả 3** builder + `PROMPT_VERSION` v4 | `server/llm/prompts.js` | T1 | Test 3-builder theo §6.2; notes rỗng → **không** có khối notes trong cả 3 prompt (BR-36); notes 5.000 ký tự → cắt tại `\n` trong 4.000 đầu (BR-35); `CHUNK_PRINCIPLES` không chứa cụm "ĐÃ CHỐT" |
| **T6** | Đưa context vào service + scaffold BR-38 + `contextUsed` BR-39 | `server/llm/index.js`, `server.js` (`validateMeetingForSummary`), `js/summary.js` (`_payload`) | T5 | Notes thật đi hết đường từ client tới prompt (test lineage §4.1, assert **giá trị**, không chỉ "đã gọi"); `generation.contextUsed` đúng 3 cờ; scaffold cộng đủ 3 thành phần |
| **T7** | Thay `BUILT_IN_PRESETS` bằng 10 preset | `server/llm/presets.js` | T1 | Nội dung khớp **nguyên văn** `docs/preset-templates.md`; `instruction` **không** chứa BLOCK DÙNG CHUNG (BR-65); xóa hết preset → seed lại ra đúng 10 (BR-66); `presets.json` đang có dữ liệu → **không** bị ghi đè |
| **T8** | Gợi ý preset theo `meetingType` | `js/app.js`, `js/storage.js` (settings `presetByMeetingType`) | T7, T3 | Thuật toán §8 đúng thứ tự 1→6; đổi tay rồi Generate → lần sau meeting cùng `meetingType` gợi ý preset vừa dùng (BR-57.1); xóa preset đó → rơi về khớp theo tên, entry bị prune (BR-58); xóa cả 10 preset → không gợi ý, Generate vẫn chạy |
| **T9** | `server/export/filename.js` | file mới | T1 | Test BR-45: `"Họp chốt giá Q4"` + `sales-call` + `2026-09-18` → `260918-Hop-chot-gia-Q4-SC`; thiếu `meetingType` → 2 phần; thiếu cả topic/title → `…-hop`; `CON` → `CON_`; **không có `-` thừa** trong mọi tổ hợp thiếu field |
| **T10** | `server/export/dir.js`: validate + probe + ghi atomic không ghi đè | file mới | — | Test chạy trên thư mục tạm **thật** (không mock `fs`): đường dẫn tương đối/`~`/trong `STORAGE_DIR`/`ROOT_DIR` bị chặn đúng code lỗi; thư mục `0o500` → `EXPORT_DIR_NOT_WRITABLE`; export 3 lần → `x.md`, `x (2).md`, `x (3).md`, **file đầu nguyên vẹn**; ép lỗi giữa chừng → không còn `.tmp` **và** không còn file đích rỗng (BR-47) |
| **T11** | 3 route export settings + route export markdown | `server.js` | T9, T10 | Không route nào đọc path từ request; validate lại thư mục **mỗi lần export** (BR-43); cấu hình chưa có → `EXPORT_DIR_NOT_CONFIGURED`; content > 8MB → 413; log không chứa đường dẫn đầy đủ/nội dung |
| **T12** | Route mở thư mục (chỉ nhánh macOS) | `server.js` | T11 | macOS: `spawn('/usr/bin/open',[dir],{shell:false})`, thư mục có ký tự `;`/khoảng trắng vẫn mở đúng và không thực thi gì; **nhánh `win32` trả 501** cho tới khi §7.2 gỡ `[UNVERIFIED]` |
| **T13** | Client: Settings §Xuất file + nút Export + toast/kết quả | `js/exporter.js` +, `js/app.js`, `js/export.js`, `index.html`, `css/` | T11, T12 | `toMarkdown` đúng thứ tự BR-51 + nhãn preset BR-52 + tùy chọn transcript BR-54; chưa có summary vẫn export kèm cảnh báo mềm (BR-53); toast hiện **đường dẫn đầy đủ** + nút Mở thư mục (ẩn khi server trả 501) + nút Copy đường dẫn |
| **T14** | Tag: model + `js/tags.js` + UI nhập autocomplete + tự thêm theo `meetingType` | `js/tags.js` +, `js/app.js`, `js/storage.js`, `index.html`, `css/` | T2 | ≤10 tag, dedupe không phân biệt hoa/thường, giữ cách viết đầu (BR-68); autocomplete từ tag đã dùng, vẫn gõ tự do được (BR-69); chọn `sales-call` → tự thêm tag "Sales call", xóa rồi lưu → không tự thêm lại (BR-70) |
| **T15** | Thư viện: chip màu + thanh lọc OR + chế độ "Theo tag" | `js/app.js`, `css/` | T14 | Render từ dữ liệu (§10.3); chọn 2 tag → hiện meeting có **ít nhất 1** trong 2 (BR-72); kết hợp AND với ô filter text; chế độ "Theo tag" nhóm đúng, "Chưa gắn tag" cuối; **chọn nhiều + xóa hàng loạt vẫn đúng sau khi đổi bộ lọc**; mọi tag qua `escapeHtml` |
| **T16** | Test suite | `test/export-filename.test.js`, `test/export-dir.test.js`, `test/context-prompt.test.js`, `test/tags.test.js` + | T5, T7, T9, T10, T14 | `npm test` xanh; có test hồi quy BR-20 (§9.3); có test lineage §4.1; có test 10 preset đi qua `validatePreset` không lỗi |

**Cổng chặn (Protocol 5.2)**:
- Nhánh Windows của T12 **không được implement** cho tới khi §7.2 có log thật.
- T10/T13 **không được** tuyên bố "an toàn trên mọi thư mục đồng bộ"; QA phải chạy 1 lần export thật vào iCloud Drive (đã verify khả thi) và 1 lần vào thư mục cloud offline để xác nhận thông báo lỗi tiếng Việt xuất hiện thay vì treo (V2).
- Protocol 6.3: trước release, QA chạy **xuyên suốt** 1 cuộc họp thật dài (đủ để kích hoạt map-reduce) có notes, rồi **đọc nội dung file .md cuối cùng** — không chỉ tin `status: 200`.

---

## 12. Technical Decisions (WHY)

**WHY-1 — Thư mục export nằm ở file server-owned riêng, không ở `settings.json`.** `PUT /api/settings` thay nguyên object bằng body client và không validate (`server.js:1347-1355`, đọc source). Nếu `markdownDir` sống ở đó, mọi lớp BR-42/BR-43 chỉ là trang trí: một request duy nhất ghi được `markdownDir` tùy ý, và lần export kế tiếp sẽ ghi file vào đúng chỗ đó. File riêng + route riêng có validate là cách duy nhất giữ lời hứa "client không bao giờ chỉ định path" mà không phải viết lại `PUT /api/settings` (ngoài phạm vi PRD). Cùng lý do với WHY-2 của Architecture v1.0 (preset).

**WHY-2 — `open(target,'wx')` đặt chỗ trước, rồi mới tmp + rename.** BR-46 (không ghi đè) và BR-47 (atomic) mâu thuẫn nhau nếu chỉ dùng `rename`: đã đo thật, `rename` ghi đè im lặng. Kiểm tra `existsSync` rồi mới ghi là TOCTOU. `open('wx')` là thao tác tạo file nguyên tử của OS, vừa kiểm tra vừa giữ chỗ, và vẫn giữ được rename cho phần nội dung.

**WHY-3 — Bảng `MEETING_TYPES` là 1 file chạy được ở cả browser và Node.** Bảng này là *cùng một sự thật* được dùng ở 4 nơi: dropdown, tag tự động, khớp tên preset, viết tắt tên file. Hai bản sao (một `js/`, một `server/`) sẽ lệch nhau đúng vào lúc ai đó thêm loại họp thứ 11 — và triệu chứng sẽ là "tên file thiếu viết tắt" rất khó truy. Phương án "fetch từ API" bắt form New Meeting phải chờ mạng để render. File dual-mode là lựa chọn rẻ nhất giữ được 1 nguồn, và cả `js/` lẫn `server/` đều đã nằm trong danh sách trắng đóng gói DMG/EXE (PRD §4A).

**WHY-4 — Tên file export KHÔNG hash SHA-256, khác với mọi file server đang ghi.** Quy tắc hash (`server.js:328`) tồn tại để chặn path traversal cho file **máy đọc** trong `STORAGE_DIR`. File export là file **người đọc** ở thư mục của người dùng — hash sẽ phá toàn bộ mục đích của BR-45. Lớp phòng thủ tương đương được giữ bằng cách khác: tên file sinh từ dữ liệu server-side qua slug chỉ cho phép `[A-Za-z0-9-]` (không thể chứa `/`, `..`, `\0`), và thư mục đích đã được validate trước đó. Đây là khác biệt có chủ ý so với baseline bảo mật đã review — Reviewer phải xác nhận đúng 2 điều kiện bù này.

**WHY-5 — Client render markdown, server chỉ đặt tên và ghi.** Renderer summary phải đi theo snapshot preset (BR-16) và hiện sống ở `js/summary.js` + `js/export.js`. Dựng bản sao thứ hai trong Node để server tự render sẽ tạo đúng loại lỗi mà Protocol 6 cảnh báo: hai renderer trôi dạt, bản export im lặng khác bản hiển thị. Thuộc tính bảo mật không suy giảm vì client gửi **nội dung**, không gửi **vị trí** — vị trí vẫn 100% do server quyết. Xem escalation E-1: đây là điểm lệch so với câu chữ BR-41.

**WHY-6 — `context` được tính 1 lần ở service và truyền vào cả 3 builder.** Nếu mỗi builder tự gọi `buildContextBlock`, ngưỡng cắt notes hoặc quy tắc lọc field đổi ở một chỗ sẽ khiến prompt và cờ provenance `contextUsed` (BR-39) nói hai chuyện khác nhau — và người dùng sẽ tin vào cờ. Một nguồn, truyền xuống, là cách duy nhất đảm bảo cờ mô tả đúng cái đã gửi đi.

**WHY-7 — Notes đặt trước Transcript trong `<meeting_data>`.** BR-63 cho notes quyền ghi đè giá trị trong transcript. Mô hình đọc tuần tự, nên "từ điển sửa lỗi" đặt trước dữ liệu cần sửa có cơ hội được áp dụng cao hơn. Không có bằng chứng đo lường — đây là phán đoán, ghi ra để QA có thể lật lại nếu kết quả thực tế kém.

**WHY-8 — Thư viện chuyển sang render-từ-dữ liệu thay vì ẩn/hiện DOM.** Bộ lọc hiện tại đọc `textContent` của `.meeting-title` để lọc — không thể mở rộng sang lọc theo tag (dữ liệu không có trong DOM) và không thể nhóm lại. Giữ cách cũ rồi chắp vá sẽ sinh hai đường lọc song song. Đổi 1 lần, mọi chế độ dùng chung `visible()`.

**WHY-9 — Không đụng `schemas/meeting-summary.schema.json` và 3 cơ chế enforce schema.** PRD Assumption #1: feature này chỉ đổi **input context**. Output structure vẫn do preset quyết định như v1.0. Đây là lý do feature này rẻ hơn hẳn `summary-presets` — và cũng là ranh giới Dev không được bước qua: bất kỳ nhu cầu "thêm 1 field output cho notes/provenance" nào đều phải quay lại PM, không tự thêm.

**WHY-10 — Nút "Copy đường dẫn" luôn tồn tại, không chỉ khi mở-thư-mục thất bại.** Khả năng mở Explorer trên Windows còn `[UNVERIFIED]` (§7.2). Thiết kế UI dựa vào một thứ chưa verify sẽ buộc phải sửa UI khi verify ra kết quả xấu. Copy đường dẫn không tốn gì và làm phương án dự phòng thành mặc định.

---

## 13. Escalation lên PM (không tự quyết)

| ID | Vấn đề | Đề xuất của Tech Lead |
|---|---|---|
| **E-1** | BR-41 viết "Client … chỉ gửi `meetingId` (+ tùy chọn kèm transcript)". Thiết kế §4.2 cho client gửi thêm **`content`** (nội dung markdown đã render) | Giữ như thiết kế (WHY-5). Thuộc tính bảo mật mà BR-41 bảo vệ — *client không chỉ định vị trí ghi* — vẫn nguyên vẹn; cái được thêm là **nội dung file**, không phải path. Phương án thay thế (server tự render) buộc phải nhân đôi renderer summary sang Node = rủi ro Protocol 6 cao hơn hẳn. **Cần PM xác nhận sửa câu chữ BR-41** |
| **E-2** | BR-48 hứa nút "Mở thư mục" cho cả 2 OS, nhưng phần Windows không verify được trên máy này | v1: macOS mở thật (đã verify), Windows trả 501 + "Copy đường dẫn" cho tới khi có log thật từ máy Windows. **Cần PM chấp nhận** rằng bản đầu tiên có thể thiếu nút này trên Windows |
| **E-3** | BR-47 hứa atomic "ở mọi loại thư mục người dùng có thể chọn". Đo thật cho thấy thư mục FileProvider (Google Drive) có thể `ETIMEDOUT` ngay từ `mkdir` | Không hạ yêu cầu BR-47 (atomic vẫn đúng **khi ghi được**), nhưng bổ sung nhóm lỗi `EXPORT_DIR_UNAVAILABLE` + timeout để người dùng nhận thông báo thay vì treo. **Cần PM xác nhận** đây là hành vi mong muốn cho thư mục cloud offline |
| **E-4** | BR-66 giả định "gần như chắc chắn chưa có người dùng thật nào đang chạy bản cài có 4 preset cũ" | Tech Lead **không có cách nào biết** có bản cài thật ngoài kia hay không. Thiết kế đã chọn phương án an toàn (không bao giờ ghi đè `presets.json` có sẵn), nên dù giả định sai cũng không mất dữ liệu. Không cần hành động, chỉ ghi nhận |
| **E-5** | BR-72 chọn OR giữa các tag; BR-35 ngưỡng 4.000 ký tự; BR-54 ngưỡng 20.000 segment — đều là phán đoán chưa đo | Giữ nguyên v1. Cả 3 đều là hằng số một chỗ, đổi không phá dữ liệu. Đề nghị QA ghi lại số liệu thật để PM chỉnh ở bản sau |

---

## 14. Danh sách `[UNVERIFIED]` còn lại (Dev/QA phải xử lý)

| # | Nội dung | Ai xử lý | Cách gỡ nhãn |
|---|---|---|---|
| U1 | Ghi tmp + rename trên **OneDrive / Windows placeholder** (§7.1) | Dev trên máy Windows | Chạy đúng chuỗi thao tác §7.1 vào thư mục OneDrive, dán log vào `docs/test-report.md`. Không chặn implement §5.4 (đường lỗi đã có), chặn mọi tuyên bố "an toàn trên OneDrive" |
| U2 | Mở Explorer bằng `spawn` `shell:false` trên Windows: đường dẫn binary, cách truyền path, **exit code khi thành công** (§7.2) | Dev trên máy Windows | Chạy lệnh mẫu ở §7.2, dán log. **CHẶN implement nhánh `win32` của T12** cho tới lúc đó |
| U3 | Hành vi thực tế của BR-63 (notes ghi đè transcript) trên cả 3 provider — prompt-only, không có cơ chế cưỡng chế nào | QA | Chạy thật với 1 transcript có số liệu sai + notes nêu đúng, trên **cả 3** provider; ghi kết quả vào `docs/test-report.md`. Nếu 1 provider không tuân thủ → báo PM, **không** tự thêm hậu xử lý |
| U4 | Ngưỡng BR-35 (4.000 ký tự notes) và BR-54 (20.000 segment) chưa đo trên dữ liệu thật | QA | Ghi số liệu quan sát được; PM quyết chỉnh |
| U5 | Ảnh hưởng R-D: notes + principles đẩy cuộc họp vốn single-pass sang map-reduce | QA | Sau T6, đo 1 cuộc họp nằm sát ngưỡng trước/sau khi có notes; nếu xảy ra thường xuyên → đề xuất PM hiển thị lý do trong provenance |

---

⏸ **CHECKPOINT 2 — ĐÃ DUYỆT** (user, cùng ngày):
- **E-1**: Đồng ý sửa BR-41 — client gửi thêm nội dung markdown đã render, không gửi path. Đã cập nhật `docs/PRD.md` BR-41.
- **E-2**: Đồng ý — macOS có nút "Mở thư mục" thật ở v1; Windows dùng "Copy đường dẫn" tạm, nâng cấp sau khi Dev verify được trên máy Windows (U2 vẫn chặn nhánh `win32` của T12). Đã cập nhật `docs/PRD.md` BR-48.
- **E-3**: Đồng ý — thêm timeout + báo lỗi rõ cho thư mục cloud không phản hồi, giữ nguyên yêu cầu atomic khi ghi được bình thường. Đã cập nhật `docs/PRD.md` BR-47.
- **E-4, E-5**: Chỉ ghi nhận, không cần hành động — giữ nguyên như Tech Lead đề xuất.

Dev có thể bắt đầu implement theo Task Breakdown (§11), tôn trọng toàn bộ ràng buộc `[UNVERIFIED]` ở §14 (U1–U5).

---
---

# Architecture v3.0 — Import bản ghi âm từ điện thoại (import-phone-recording)

**Trạng thái**: Draft, chờ duyệt Checkpoint 2
**Phiên bản**: 3.0 — **append** vào tài liệu này, **không** thay thế Architecture v2.0 ở trên. Mọi hợp đồng của v1.0/v2.0 vẫn còn hiệu lực trừ những chỗ dưới đây ghi rõ là thay đổi.
**Ngày**: 2026-09-18
**Nguồn**: `docs/PRD.md` v3.0 §11–17 (BR-77 → BR-147) + `docs/ux-import-phone-recording.md` rev 2 (bảng microcopy §6 là **nguồn text chính thức**, Dev copy nguyên văn, không diễn đạt lại — BR-147).

> Quy ước nhãn trong tài liệu này: `[UNVERIFIED]` = **chặn Dev implement đúng phần đó** (Protocol 5.2). `[SKIP-v1]` = bước pipeline mặc định bỏ qua cho biến thể mới vì chưa verify (Protocol 8.2), hiện thực bằng **thuộc tính năng lực khai báo trên object**, không rẽ nhánh cứng theo tên biến thể.

---

## V0. Quyết định kiến trúc lớn nhất — R-Z (mô hình 1 meeting ↔ N phần)

**Chốt: `meeting.parts[]` nhúng trong chính meeting object, nội dung do server sở hữu, thứ tự do người dùng quyết định qua route riêng; `meeting.transcript` vẫn là transcript phẳng đã ghép và vẫn là thứ mọi pipeline cũ đọc.**

Ba phương án đã cân nhắc:

| PA | Mô tả | Vì sao loại/chọn |
|---|---|---|
| A | File server-owned riêng `storage/meeting-parts.json`, meeting chỉ giữ `partIds` | **Loại.** Mọi consumer hiện có (`searchMeetings`, `toMarkdown`, `js/summary.js:_payload`, backup JSON, `/api/data`) phải thêm bước join. Quên join ở 1 chỗ = đúng loại lỗi im lặng Protocol 6 mô tả (bản ghi có transcript, nhưng export/summary rỗng). Backup (BR-112) phải viết lại. |
| B | Không có transcript ghép; client tự nối khi render | **Loại.** Sẽ tồn tại 2 bản "sự thật" về transcript (client nối để hiển thị, server nối để gửi LLM) → lệch nhau theo thời gian (WHY-5 của v2.0 đã chọn nguyên tắc ngược lại). |
| **C (chọn)** | `parts[]` nhúng trong meeting; `transcript` = hàm thuần của `parts[]` (`buildMergedTranscript`), **chỉ server ghi** | Mọi pipeline v1.0/v2.0 chạy **nguyên trạng** vì `meeting.transcript` vẫn đúng hình dạng cũ (BR-116/BR-140). Backup tự động có `parts` vì nó nằm trong meeting. Không thêm file, không thêm route đọc dữ liệu. |

**Tương thích ngược — không có migration, không đụng dữ liệu cũ:**

- Bản ghi một phần (mọi bản ghi đang có trong `storage/meetings.json` của người dùng, kể cả bản ghi live) **không có** field `parts` → mọi code đường cũ chạy y hệt hôm nay. `parts` vắng mặt ⇔ `parts.length === 0` ⇔ "bản ghi một phần".
- Import **một** file (chế độ mặc định) tiếp tục đi **đúng đường hiện tại**, **không** sinh `parts`. Lý do: giữ bán kính ảnh hưởng nhỏ nhất cho luồng phổ biến nhất; và vì bản ghi cũ dù sao cũng không có `parts`, "thống nhất hoá" bằng cách bắt mọi bản ghi mới có `parts` **không** loại bỏ được nhánh nào cả — chỉ làm tăng rủi ro.
- `sourceFilename` (đã có) tiếp tục là tên file của **phần 1** với bản ghi ghép → mọi chỗ đang đọc field này (`js/app.js:_resumeProcessingJobs`, ERR-07 dedupe) không đổi (BR-137).
- Audio: đường dẫn đã là `sha256(<id bất kỳ>)` (`server.js:322-332`), và `PUT /api/audio/:id` nhận **id bất kỳ** ≤256 ký tự (`decodeAudioId`, `server.js:389-397`) — **không phải** bắt buộc là `meetingId`. Vì vậy N audio/1 meeting **không cần route mới, không cần cách ghi file mới, không đụng lớp chống path traversal**: mỗi phần lưu tại `PUT /api/audio/<partId>`.

---

## V1. Tech Stack

Không đổi. **Zero npm dependency** vẫn giữ (`package.json` không thêm gì — PRD Assumption #6). Không ffmpeg, không thư viện đọc metadata audio: thời lượng/khả năng phát thử đọc bằng `HTMLAudioElement` của trình duyệt (§V8.3), ghép audio thành 1 file **không** làm (Out of Scope, BR-134).

| Lớp | Bổ sung của v3.0 |
|---|---|
| Server module | `server/stt/formats.js` (bảng năng lực định dạng), `server/stt/merge.js` (hàm thuần: timeline + ghép transcript), `server/meeting-parts.js` (chuẩn hoá + quyền sở hữu field của `parts`) |
| Client module | `js/import-preflight.js` (hàm thuần), `js/import.js` (modal import 2 chế độ), `js/parts.js` (render trạng thái phần, dải phân cách, ô trống) |
| Test | `node --test`, thêm 6 file; golden fixture tại `tests/fixtures/<provider>/` (Protocol 5.3) |

---

## V2. Project Structure (file sẽ đụng tới)

```
MeetNote/
├─ server.js                                ~ scheduler 2 job đồng thời; job có partId;
│                                             4 route /api/meetings/:id/parts*; mở rộng
│                                             /api/stt/providers; ownership merge ở PUT /api/meetings;
│                                             STT_API_TIMEOUT_MS tách khỏi LLM_API_TIMEOUT_MS
├─ server/
│  ├─ meeting-parts.js                     + chuẩn hoá part, quyền sở hữu field, áp edit text về part
│  ├─ stt/
│  │  ├─ formats.js                        + PROVIDER_FORMATS (accepted/legacy/rejected) + union đuôi app nhận
│  │  ├─ contracts.js                        ~ normalizeResult trả thêm durationKind (R-AC)
│  │  ├─ merge.js                           + computeTimeline / buildMergedTranscript (hàm thuần)
│  │  ├─ index.js                            ~ listProviders trả maxUploadBytes + formats; describeCapabilities
│  │  └─ providers/
│  │     ├─ google.js                        ~ SỬA duration (R-AB) + POLL_TIMEOUT_MS + durationKind
│  │     ├─ soniox.js / deepgram.js / whisper.js ~ khai báo formats + durationKind (+ poll timeout Soniox)
│  └─ llm/
│     ├─ prompts.js                          ~ formatTranscript nhận segment có kind/part; context ghi rõ
│     │                                        bản ghi ghép + phần thiếu; PROMPT_VERSION → v5
│     └─ index.js                            (không đổi logic, chỉ đi theo context mới)
├─ js/
│  ├─ import.js                             + modal import (state A/B/C + chế độ ghép)
│  ├─ import-preflight.js                   + hàm thuần: phân loại lỗi A/B/C, chọn provider thay thế
│  ├─ parts.js                              + render danh sách phần, dải phân cách, ô trống, tiến độ N phần
│  ├─ app.js                                 ~ thay `_handleUpload` bằng modal; card chờ; card lỗi phần;
│  │                                           pre-meeting card thêm date + participants; badge "Mới nhập"
│  ├─ storage.js                             ~ default + sanitize `parts`, `source`, `promptContextUpdatedAt`,
│  │                                           `sourceFilename`, `durationEstimated`; bump BR-146
│  ├─ export.js                              ~ toMarkdown render dải phân cách + ô trống + cảnh báo thiếu phần
│  └─ summary.js                             ~ _payload gửi thêm segment.kind/part + missingParts
├─ index.html                                ~ thêm 3 <script> (import-preflight, import, parts)
├─ css/components.css                        ~ 12 class mới theo UX §7
└─ test/
   ├─ stt-formats.test.js                   + BR-79/82/84/141
   ├─ merge-timeline.test.js                + BR-125/126/127/129/131/136
   ├─ meeting-parts.test.js                 + BR-121/132/133/137 + ownership merge (R-R)
   ├─ parts-routes.test.js                  + BR-123/133/139 + bảo mật route
   ├─ import-preflight.test.js              + BR-80/85/86/138/142
   └─ prompt-parts.test.js                  + BR-130/135 (cả 3 builder, R-AD)
```

---

## V3. Data Model

### V3.1 Meeting — field mới (tất cả đều **tuỳ chọn**, thiếu = hành vi cũ)

```jsonc
{
  // … toàn bộ field v1.0/v2.0 giữ nguyên …
  "source": "import",              // 'live' | 'import'  (BR-108). Thiếu → 'live' khi có audioId cũ, ngược lại ''
  "sourceFilename": "REC_001.m4a", // ĐÃ CÓ. Bản ghi ghép: tên file phần 1 (BR-137)
  "sourceSizeBytes": 54525952,     // MỚI, phục vụ dedupe BR-109/BR-139 (tên + kích thước)
  "durationEstimated": false,      // BR-126. true ⇒ UI ghi "thời lượng chỉ là ước lượng", BR-128 tắt cảnh báo chất lượng
  "promptContextUpdatedAt": "",    // BR-146. ISO string. Thiếu → KHÔNG bật nhắc nhở (R-AF, deny-by-default)
  "missingParts": [2],             // BR-132/135. Số thứ tự phần đang thiếu (failed hoặc dropped). [] = đủ
  "parts": []                      // R-Z. VẮNG MẶT hoặc [] = bản ghi một phần (đường cũ, không đổi gì)
}
```

### V3.2 Part object (chỉ tồn tại với bản ghi ghép)

```jsonc
{
  "partId": "part-3f0c…",          // ID ổn định; audio nằm tại PUT/GET /api/audio/<partId> (hash SHA-256 như cũ)
  "order": 2,                       // 1-based, thứ tự người dùng xác nhận (BR-119/BR-120)
  "filename": "REC_002.m4a",       // chỉ để hiển thị + dedupe. KHÔNG BAO GIỜ vào đường dẫn file (BR-111)
  "sizeBytes": 53477376,
  "clientDurationSeconds": 2880,    // trình duyệt đo lúc import. KHÔNG dùng để tính tiền, chỉ hiển thị + độ rộng ô trống
  "status": "completed",            // queued | processing | completed | failed | dropped
  "jobId": "job-7ac1…",
  "error": null,                    // { code, message } khi failed (BR-104 dịch sang tiếng Việt ở client)
  "provider": "soniox",
  "model": "stt-async-v5",
  "language": "auto",
  "translationLanguage": "",
  "transcript": [                   // RAW, mốc thời gian LOCAL của phần (bắt đầu từ 0) — server-owned
    { "time": 0, "speaker": "Speaker 1", "text": "…", "language": "vi" }
  ],
  "translations": [],
  "duration": 2880,                 // provider trả về, đã normalize
  "durationKind": "audio-length",   // 'audio-length' | 'speech-end' | 'none'  (R-AC — phân biệt 0 thật với không biết)
  "spanSeconds": 2880,              // BR-125 "độ dài quy ước" = max(duration, time của segment cuối)
  "offsetSeconds": 2881,            // BR-125, do server tính lại mỗi lần rebuild
  "usage": {                        // BR-137 — chi phí của RIÊNG phần này
    "provider": "soniox", "model": "stt-async-v5",
    "startedAt": "2026-09-18T07:10:02.113Z", "endedAt": "2026-09-18T07:18:44.902Z",
    "billableDurationSeconds": 2880, "pricingUsdPerHour": 0.10,
    "estimatedCostUsd": 0.08, "translationEnabled": false, "source": "file-upload"
  },
  "addedAt": "2026-09-18T07:09:58.000Z"
}
```

### V3.3 Ví dụ JSON thật — bản ghi ghép 3 phần, phần 2 đang lỗi

```jsonc
{
  "id": "5f9c2b7a-1d44-4e0b-9a2e-7c1f0b6d33aa",
  "title": "Họp khách hàng ABC",
  "date": "2026-09-16T14:30:00.000+07:00",
  "createdAt": "2026-09-18T07:09:55.000Z",
  "updatedAt": "2026-09-18T07:26:31.204Z",
  "status": "completed",
  "duration": 5160,
  "durationEstimated": false,
  "missingParts": [2],
  "source": "import",
  "sourceFilename": "REC_001.m4a",
  "sourceSizeBytes": 54525952,
  "participants": ["Hieu", "Lan"],
  "meetingType": "sales-call", "topic": "Báo giá Q4", "leadBy": "Hieu", "tags": ["Sales call"],
  "promptContextUpdatedAt": "2026-09-18T07:20:10.000Z",
  "audioId": null,
  "sonioxUsage": {
    "provider": "soniox", "model": "stt-async-v5",
    "startedAt": "2026-09-18T07:10:02.113Z", "endedAt": "2026-09-18T07:26:31.204Z",
    "billableDurationSeconds": 5160, "pricingUsdPerHour": 0.10,
    "estimatedCostUsd": 0.1433, "translationEnabled": false,
    "source": "file-upload", "partCount": 3, "partsCounted": 2
  },
  "transcript": [
    { "time": 0,    "kind": "part-divider", "part": 1, "partId": "part-a1", "speaker": "", "text": "— Phần 1/3 · REC_001.m4a —" },
    { "time": 0,    "part": 1, "partId": "part-a1", "srcIndex": 0, "speaker": "Speaker 1", "text": "Chào mọi người, hôm nay…" },
    { "time": 2881, "kind": "part-gap", "part": 2, "partId": "part-b2", "speaker": "", "text": "⚠ Phần 2 chưa có transcript · 15:19 → 16:07" },
    { "time": 5762, "kind": "part-divider", "part": 3, "partId": "part-c3", "speaker": "", "text": "— Phần 3/3 · REC_003.m4a —" },
    { "time": 5762, "part": 3, "partId": "part-c3", "srcIndex": 0, "speaker": "Speaker 2", "text": "Về phần báo giá thì…" }
  ],
  "parts": [
    { "partId": "part-a1", "order": 1, "filename": "REC_001.m4a", "status": "completed", "duration": 2880,
      "durationKind": "audio-length", "spanSeconds": 2880, "offsetSeconds": 0, "transcript": [ /* … */ ] },
    { "partId": "part-b2", "order": 2, "filename": "REC_002.m4a", "status": "failed", "duration": 0,
      "durationKind": "none", "spanSeconds": 0, "clientDurationSeconds": 2880, "offsetSeconds": 2881,
      "error": { "code": "STT_RATE_LIMITED", "message": "rate limit reached" }, "transcript": [] },
    { "partId": "part-c3", "order": 3, "filename": "REC_003.m4a", "status": "completed", "duration": 2280,
      "durationKind": "audio-length", "spanSeconds": 2280, "offsetSeconds": 5762, "transcript": [ /* … */ ] }
  ]
}
```

Giải thích 2 con số dễ hiểu nhầm: `duration = 5160` = 2880 + 2280 (**chỉ** phần có transcript, BR-127 — không cộng `clientDurationSeconds` của phần lỗi, không cộng khoảng ngăn cách 1 giây). `offsetSeconds` của phần 3 = 2881 + 2880 + 1 = 5762, tức **vẫn cộng dồn như thể phần 2 tồn tại** (dùng `clientDurationSeconds` làm độ rộng ô trống) — đúng yêu cầu UX §5.7b để mốc thời gian phần 3 còn đối chiếu được với file audio gốc.

### V3.4 Chi phí cộng dồn (BR-137) — `sonioxUsage` trở thành **tổng**

`sonioxUsage` giữ nguyên tên (mọi UI hiện có đọc field này: `js/app.js:368,611,1385`) nhưng với bản ghi ghép được server tính lại sau mỗi lần rebuild:

| Field | Cách tính khi có `parts` |
|---|---|
| `billableDurationSeconds` | Σ `part.usage.billableDurationSeconds` của phần `completed` |
| `estimatedCostUsd` | Σ `part.usage.estimatedCostUsd` (bỏ qua `null`); mọi phần đều `null` → `null` |
| `pricingUsdPerHour` | đơn giá nếu **mọi** phần cùng đơn giá; lệch nhau → `null` |
| `provider` / `model` | giá trị chung nếu mọi phần giống nhau; lệch (BR-124 ngoại lệ) → `'mixed'` |
| `startedAt` / `endedAt` | min / max của các phần |
| `partCount`, `partsCounted` | MỚI: tổng số phần / số phần đã tính vào tổng (để UI nói rõ "chi phí của 2/3 phần") |

### V3.5 `jobs.json` — job có `partId`

```jsonc
{ "id": "job-…", "meetingId": "5f9c…", "partId": "part-b2",   // '' với bản ghi một phần (tương thích ngược)
  "provider": "soniox", "model": "", "language": "auto", "translationLanguage": "",
  "status": "queued",                                          // queued | processing | completed | failed
  "error": null, "createdAt": "…", "updatedAt": "…" }
```

- Khoá dedupe đổi từ `meetingId` thành **`meetingId + '#' + (partId || '')`** ở cả `runningJobs` (Map in-memory) lẫn `findActiveJob` (`server.js:1424-1459`). Bản ghi một phần: `partId === ''` ⇒ khoá bằng `meetingId + '#'` ⇒ hành vi dedupe **không đổi**.
- `status: 'queued'` đã tồn tại trong model job hôm nay nhưng **chưa từng được dùng** (`findActiveJob` đã tính tới nó) — v3.0 dùng đúng nó cho hàng đợi 2 job đồng thời (BR-88).
- `recoverInterruptedJobs` (`server.js:744`): job `processing` → `failed` (giữ nguyên, vì lệnh gọi provider đã mất). Job `queued` → **giữ nguyên `queued` và được scheduler nhặt lại** (chưa gọi provider lần nào, đánh `failed` là sai và tốn 1 lần bấm "Thử lại" vô nghĩa).

### V3.6 Quyền sở hữu field — bảng quyết định cho `PUT /api/meetings` (R-R)

Nền tảng: `PUT /api/meetings` thay **nguyên mảng** meetings bằng body của client (`server.js:1504-1537`); guard hiện tại chỉ bật khi `incoming.status === 'processing'`. Với bản ghi ghép, guard đó **không đủ** — một snapshot cũ của browser ở trạng thái `completed` có thể xoá sạch `parts`.

Quy tắc mới (hàm `preserveServerOwnedFields(current, incoming)` trong `server/meeting-parts.js`), áp dụng **khi `current.parts?.length > 0`**, bất kể `status`:

| Field | Ai sở hữu | Xử lý khi client gửi lên |
|---|---|---|
| `parts` (toàn bộ) | **Server** | Bỏ qua hoàn toàn giá trị của client, giữ `current.parts` |
| `duration`, `durationEstimated`, `missingParts`, `sonioxUsage`, `status`, `processingError`, `_activeJobId` | **Server** | Giữ `current` |
| `transcript`, `translations` | **Server (dẫn xuất)** | Không lưu thẳng. Xem quy tắc "áp edit" dưới đây |
| `title`, `date`, `participants`, `notes`, `tags`, `meetingType`, `topic`, `leadBy`, `actionItems`, `summary*`, `promptContextUpdatedAt` | **Client** | Nhận bình thường (đi qua `sanitizePreMeetingFields` như v2.0) |

**Áp edit transcript về đúng phần** (giữ tính năng sửa transcript inline đang có — `js/app.js:1331` `contenteditable`):
1. Chỉ xét segment của `incoming.transcript` có **cùng số lượng và cùng chuỗi `partId`+`srcIndex`** với transcript dẫn xuất hiện tại. Lệch cấu trúc (snapshot cũ) → **bỏ qua toàn bộ**, giữ bản dẫn xuất.
2. Với mỗi segment khớp, **chỉ** lấy `text`; ghi ngược vào `current.parts[p].transcript[srcIndex].text`.
3. Segment `kind: 'part-divider' | 'part-gap'` → bỏ qua (client render chúng **không** `contenteditable`).
4. Sau đó gọi lại `buildMergedTranscript(parts)` → `transcript` dẫn xuất mới.

Lý do không chọn "khoá sửa transcript cho bản ghi ghép": tính năng sửa đã tồn tại và người dùng ghi âm điện thoại là người **cần** sửa nhất (chất lượng kém hơn). Nếu chỉ chặn ở UI mà server vẫn nhận, ta sẽ có đúng loại lỗi im lặng Protocol 6 mô tả: user sửa, thấy chữ đổi trên màn hình, reload thì mất.

### V3.7 Chuẩn hoá phía client (`js/storage.js`)

- `saveMeeting` default: **không** thêm `parts` (bản ghi mới mặc định là một phần). Chỉ luồng import ghép mới gắn `parts` — và `parts` đến từ **response của server**, client không tự chế.
- `_sanitizeImportedMeeting` (BR-112, `js/storage.js:434`): thêm whitelist cho `source`, `sourceFilename` (**hiện đang bị rơi mất khi import backup** — sửa kèm), `sourceSizeBytes`, `durationEstimated`, `missingParts`, `promptContextUpdatedAt`, `parts` (≤10 phần, mỗi phần chuẩn hoá theo V3.2, transcript ≤ 50.000 segment). Thiếu field → mặc định, không lỗi.
- `promptContextUpdatedAt` (BR-146) được **bump trong `saveMeeting`**, là nơi duy nhất: so field cũ/mới của đúng 8 field đi vào prompt (`title`, `date`, `duration`, `participants`, `meetingType`, `topic`, `leadBy`, `notes`). Không đặt logic này ở từng chỗ gọi — 1 nguồn, mọi call site hưởng.

---

## V4. Luồng dữ liệu chế độ ghép (Protocol 6 — ghi rõ artifact từng bước)

### V4.1 Sơ đồ

```
 [Trình duyệt]                                   [Server]                        [Provider]
 ──────────────                                  ─────────                       ──────────
 1. chọn N file  ─┐
 2. preflight     │  GET /api/stt/providers  →  { providers[].maxUploadBytes,
    (client)      │                               providers[].formats, appAcceptedExtensions }
 3. xác nhận thứ tự (BR-120)
 4. tạo meeting   │  PUT /api/meetings           (meeting chưa có parts, status='processing')
 5. mỗi phần:     │  PUT /api/audio/<partId>     (body = bytes; tên file chỉ ở header X-Audio-Filename)
 6. đăng ký phần  │  POST /api/meetings/:id/parts
                  │        body { parts:[{partId,filename,sizeBytes,clientDurationSeconds,order}],
                  │                provider, model, language, translationLanguage }
                  │      → server: chuẩn hoá parts → tạo N job status='queued' → scheduler
 7. poll          │  GET /api/meetings/:id/parts  (1 request cho cả N phần)
                  ▼
                                    scheduler (≤2 job đồng thời)
                                      └─ runTranscriptionJob(job)
                                           ├─ openStoredAudio(job.partId || job.meetingId)   ── audioMeta
                                           ├─ stt.transcribe(...)  ──────────────────────────→  provider
                                           │     ← { transcript, translations, duration, durationKind }
                                           ├─ mergePartResult(meetingId, partId, result)
                                           │     ghi vào parts[i]: transcript/duration/durationKind/usage/status
                                           └─ rebuildMergedMeeting(meetingId)      ← BƯỚC NỐI QUAN TRỌNG NHẤT
                                                 ├─ computeTimeline(parts)   → offsetSeconds/spanSeconds
                                                 ├─ buildMergedTranscript()  → meeting.transcript (+ translations)
                                                 ├─ Σ duration, Σ usage      → meeting.duration, meeting.sonioxUsage
                                                 └─ status tổng hợp + missingParts (BR-132)
```

### V4.2 Bảng lineage — bước N tạo ra gì, bước N+1 đọc đúng cái gì

| Bước | Ở đâu | Đọc **chính xác** | Ghi ra **chính xác** |
|---|---|---|---|
| M1 | `js/import.js` `_collectParts()` | `File[]` + thứ tự người dùng xác nhận | `partsDraft[] = { partId: 'part-'+uuid, file, order, clientDurationSeconds }` |
| M2 | `js/import.js` → `AudioStorage.save(partId, file)` | `partsDraft[i].partId`, `.file` | `PUT /api/audio/<partId>` (metadata `{mimeType, filename, size}` do server ghi) |
| M3 | `js/import.js` → `POST /api/meetings/:id/parts` | `partsDraft[].{partId,filename,sizeBytes,clientDurationSeconds,order}` + cấu hình STT của lần import | `meeting.parts[]` (status `queued`), N job trong `jobs.json` với `job.partId` |
| M4 | `server.js` scheduler | `jobs.json` nơi `status==='queued'`, tối đa 2 job `processing` toàn hệ thống | `job.status='processing'`, gọi `runTranscriptionJob(job)` |
| M5 | `runTranscriptionJob` | **`job.partId`** (không phải `job.meetingId`) → `openStoredAudio(job.partId)` | `audio.meta` + `audio.load` |
| M6 | `stt.transcribe` | `audio.meta.size` so `adapter.maxUploadBytes`; `audioMeta.mimeType` | `{ transcript, translations, duration, durationKind, model, provider }` |
| M7 | `mergePartResult(meetingId, partId, result)` | `result.transcript` (**mốc thời gian local, chưa cộng offset**), `result.duration`, `result.durationKind` | `parts[i].transcript` = `result.transcript` **nguyên vẹn**; `parts[i].duration/durationKind/usage`; `parts[i].status='completed'` |
| M8 | `computeTimeline(parts)` | `parts[].{status, duration, transcript, clientDurationSeconds, order}` | `parts[].spanSeconds`, `parts[].offsetSeconds` (BR-125) |
| M9 | `buildMergedTranscript(parts)` | `parts[].transcript` + `parts[].offsetSeconds` từ **M8** | `meeting.transcript[]` — mỗi segment `{ time: offset+src.time, speaker, text, language, part, partId, srcIndex }`, kèm segment `kind:'part-divider'`/`'part-gap'` |
| M10 | `rebuildMergedMeeting` | kết quả M8 + M9 | `meeting.duration` (Σ, BR-127), `meeting.durationEstimated` (BR-126), `meeting.missingParts` (BR-132), `meeting.sonioxUsage` (Σ, V3.4), `meeting.status` |
| M11 | `js/summary.js` `_payload` | `meeting.transcript` **kèm `kind` và `part`** của từng segment (hôm nay `_payload` cắt bớt field) + `meeting.missingParts` | body `/api/summary` |
| M12 | `server.js` `validateMeetingForSummary` | `segment.kind`, `segment.part`, `body.meeting.missingParts` | object meeting có `transcript[].{time,speaker,text,kind,part}` + `missingParts` |
| M13 | `server/llm/prompts.js` `formatTranscript` | `segment.part`, `segment.kind` từ **M12** | dòng prompt: `[12:00] Speaker 1 (Phần 2): …` / `--- Phần 2/3 · REC_002.m4a ---` |
| M14 | `buildContextBlock` | `meeting.parts?.length` (qua field dẫn xuất `partCount`) + `meeting.missingParts` | `headerLines` thêm 2 dòng (§V5.3) → vào **cả 3** builder |

**Ràng buộc chống lỗi lineage (test bắt buộc, Protocol 6.2)**
- M5: test phải assert `openStoredAudio` được gọi với **`job.partId`**, không phải `job.meetingId` — đây chính là chỗ dễ nhất để mọi phần cùng transcribe nhầm file của meeting.
- M7 → M9: test phải assert **giá trị**: `merged[k].time === parts[1].offsetSeconds + parts[1].transcript[0].time`, không chỉ "đã gọi".
- M9 → M13: test dựng meeting 2 phần, chạy **cả 3** builder, assert chuỗi `(Phần 2)` có mặt trong `buildSummaryPrompt` **và** `buildChunkPrompt` cho đúng segment của phần 2, và chuỗi "gồm 2 phần" có mặt trong cả `buildSynthesisPrompt`.
- M11: test lineage client→server: sửa 1 segment của phần 2 → assert body gửi đi giữ nguyên `part: 2`.

### V4.3 `server/stt/merge.js` — hàm thuần, test độc lập

```js
computeTimeline(parts, { gapSeconds = 1 })
  → parts.map(p => ({ ...p, spanSeconds, offsetSeconds }))
```
- `lastSegmentTime(p) = p.transcript.length ? p.transcript[p.transcript.length-1].time : 0`
- `spanSeconds(p)`:
  - `status === 'completed'` → **`max(p.duration, lastSegmentTime(p))`** (BR-125 — bắt buộc lấy max, không dùng thẳng `duration`)
  - `status` khác (`queued|processing|failed|dropped`) → `max(0, p.clientDurationSeconds || 0)` (chỉ để giữ chỗ trên dòng thời gian, **không** vào `duration` và **không** vào chi phí)
- `offsetSeconds(1) = 0`; `offsetSeconds(n+1) = offsetSeconds(n) + spanSeconds(n) + gapSeconds`
- Hệ quả đã kiểm bằng tay cho cả 5 trường hợp §12 của PRD: Soniox/Deepgram (`duration` thật) → max = duration; Whisper `whisper-1` → max = duration; Whisper `gpt-4o-*` (`duration=0`, 1 segment tại `time:0`) → max = 0 ⇒ offset chỉ tăng 1 giây/phần, dòng thời gian **vẫn tăng dần, không chồng lấn** (BR-131 — không bịa mốc thời gian); Google (sau khi sửa R-AB) → max = kết thúc từ cuối.

```js
buildMergedTranscript(parts)   // parts ĐÃ qua computeTimeline
  → { transcript, translations, duration, durationEstimated, missingParts, partCount }
```
- Duyệt `parts` theo `order` tăng dần.
- Mỗi phần chèn **1 segment `kind:'part-divider'`** tại `time = offsetSeconds`, `text = "— Phần <order>/<total> · <filename> —"` (MRG-22/BR-129). Với bản ghi **1 phần** (`parts.length === 1`) vẫn chèn (chỉ xảy ra khi người dùng đã bỏ bớt phần) — dải phân cách là thứ giải thích vì sao thiếu.
- Phần `completed`: nối `transcript` với `time += offsetSeconds`, gắn `part`, `partId`, `srcIndex` (chỉ số gốc trong phần — khoá để áp edit ngược, V3.6).
- Phần `queued|processing`: 1 segment `kind:'part-gap'`, text = PRG-16 (`Phần 3 đang được tạo transcript…`).
- Phần `failed`: 1 segment `kind:'part-gap'`, text = FAI-11 (`Phần 2 chưa có transcript`).
- Phần `dropped`: 1 segment `kind:'part-gap'`, text = FAI-10 (`Thiếu đoạn …  (đã bỏ phần 2).`) — **vĩnh viễn**, và vì nó nằm trong `meeting.transcript` nên nó tự động đi vào file export (BR-129 + UX D8).
- `duration` = Σ `spanSeconds` của phần `completed` (BR-127 — **không** cộng `gapSeconds`, **không** cộng phần lỗi/bỏ).
- `durationEstimated` = `true` nếu **bất kỳ** phần `completed` nào có `durationKind !== 'audio-length'` (BR-126).
- `missingParts` = `order` của mọi phần `failed` hoặc `dropped`.
- `translations`: ghép cùng cách (offset + divider), không có `srcIndex` (không sửa tay được).

### V4.4 Trạng thái tổng hợp (BR-132) — bảng đóng

| Điều kiện trên `parts` | `meeting.status` | Hiển thị |
|---|---|---|
| có ≥1 phần `queued`/`processing` | `processing` | PRG-15 `2/3 phần xong · đã 14 phút` |
| mọi phần `completed` | `completed` | bình thường |
| mọi phần `failed` (không có phần nào completed) | `failed` | card lỗi |
| có ≥1 `completed` **và** ≥1 `failed`/`dropped` | `completed` + `missingParts.length > 0` | badge FAI-12 `Thiếu 1 phần` |

`missingParts` là **dữ liệu**, không phải trạng thái — nhờ vậy bộ lọc/thư viện/export hiện có không cần biết thêm giá trị `status` mới nào (một giá trị `status` mới sẽ phải cập nhật `js/storage.js:475` whitelist, `js/app.js` badge map, và mọi chỗ so sánh `=== 'completed'`).

---

## V5. Prompt — bản ghi ghép (R-AD, BR-130, BR-135) — áp cho **cả 3** builder

`PROMPT_VERSION` → **`meeting-summary-v5`**.

### V5.1 Nhãn người nói theo phần — sửa đúng **một** hàm

`formatTranscript(segments)` (`server/llm/prompts.js:47-52`) là **nguồn duy nhất** render transcript cho `buildSummaryPrompt` **và** `buildChunkPrompt`. Sửa ở đây là cách duy nhất đảm bảo map-reduce không bị bỏ sót (BR-32/Protocol 6):

```js
// segment.kind === 'part-divider' | 'part-gap'  → `--- ${segment.text} ---`
// segment.part                                   → `[m:ss] ${speaker} (Phần ${part}): ${text}`
// không có .part (bản ghi một phần)              → giữ NGUYÊN định dạng cũ
```

Vì sao gắn nhãn vào **từng segment** chứ không chỉ dựa vào dải phân cách: `chunkTranscript` cắt theo token, một chunk hoàn toàn có thể **bắt đầu ở giữa phần 2** và không chứa dải phân cách nào → LLM mất thông tin. Nhãn per-segment đúng trong mọi cách cắt.

### V5.2 `buildSynthesisPrompt` — không có transcript, nên cần đường riêng

Bước reduce chỉ nhận `partials`, không nhận transcript ⇒ nhãn per-segment không tới được. Do đó thông tin "bản ghi gồm N phần, nhãn người nói chỉ có giá trị trong phạm vi một phần" phải đi qua **context block** (V5.3), thứ đã được truyền vào cả 3 builder từ v2.0.

### V5.3 `buildContextBlock` — 2 dòng mới trong `headerLines`

```
Recording parts: 3 (merged from 3 separate audio files)
Speaker labels are per-part: "Speaker 1" in one part is NOT necessarily the same person as "Speaker 1" in another part. Do not merge speakers across parts; when unsure use [chưa rõ người nói].
Missing parts: 2 of 3 (that part has no transcript; do not guess its content)   ← chỉ khi missingParts.length > 0
```

- Nguồn: `meeting.partCount` + `meeting.missingParts` — hai field **phải** được `validateMeetingForSummary` giữ lại (hôm nay hàm này cắt bỏ mọi field lạ; quên bước này = BR-130 không bao giờ chạy, đúng vết xe của BR-32 ở v2.0).
- `contextUsed` (BR-39) mở rộng: `{ notes, notesTruncated, preMeeting, merged: true, partCount: 3, missingParts: [2] }` → thoả BR-135 (provenance ghi nhận bản ghi thiếu phần) mà **không** đụng `schemas/meeting-summary.schema.json` và **không** đụng 3 cơ chế enforce schema của 3 provider LLM (WHY-9 của v2.0 giữ nguyên hiệu lực).
- Vì `context.text` đã được tính vào `scaffoldTokens` (BR-38, `server/llm/index.js:137`), 3 dòng mới **tự động** vào ngân sách map-reduce — không cần sửa công thức.

---

## V6. API Design

Tất cả route mới nằm dưới `/api/` ⇒ **tự động** đi qua `hasTrustedHost` + `isTrustedApiRequest` (`server.js:1680`), và mọi `POST` bắt buộc `Content-Type: application/json` qua `readJsonRequest` (chặn simple-request/CSRF). **Không** route nào nhận đường dẫn file; **không** route nào mở thêm cổng (BR-77). `partId` do client sinh nhưng **chỉ** được dùng làm khoá tra trong mảng `parts` và làm đầu vào của `sha256()` khi suy ra tên file audio — **không bao giờ** ghép thẳng vào đường dẫn (BR-111, giữ nguyên cơ chế `audioKey` `server.js:322`). Ràng buộc: `partId` khớp `/^part-[a-z0-9-]{8,64}$/`, từ chối nếu không khớp.

### V6.1 `GET /api/stt/providers` — MỞ RỘNG (BR-141, D-16, R-L, R-AE)

```jsonc
{
  "defaultProvider": "soniox",
  "maxAudioBytes": 2147483648,                       // MỚI — trần chung của app (MAX_AUDIO_BYTES)
  "appAcceptedExtensions": ["aac","aiff","amr","asf","flac","m4a","mp3","mp4","ogg","wav","webm"],
  "providers": [
    { "id": "whisper", "name": "OpenAI Whisper", "configured": true, "state": "ready",
      /* … các field cũ giữ nguyên … */
      "maxUploadBytes": 26214400,                    // MỚI — đúng giá trị server đang enforce
      "formats": {                                   // MỚI
        "accepted": ["mp3","mp4","m4a","wav","webm"],
        "legacy":   [],
        "rejected": ["aac","aiff","amr","asf","flac","ogg"],
        "sourceVerified": true
      } }
  ]
}
```

- **Một nguồn sự thật (BR-141)**: `maxUploadBytes` đọc thẳng từ `adapter.maxUploadBytes` — chính hằng số mà `stt.transcribe` dùng để chặn (`server/stt/index.js:94-98`). `formats` đọc từ `server/stt/formats.js`, và **chính bảng đó** được dùng ở bước server kiểm lại (V7.2). Client **cấm** giữ bảng chép tay.
- **R-AE (không lộ bí mật)**: response được dựng từ **danh sách field trắng** đã liệt kê ở trên. Cấm trải (`...adapter`) hoặc trả `status` thô. Reviewer kiểm: không có `apiKey`, không có tiền tố/hậu tố key, `message` vẫn là chuỗi `getStatus()` như hôm nay (không đổi bề mặt cũ). Test bắt buộc: set key giả `SONIOX_API_KEY=SECRET-123`, gọi endpoint, assert body **không chứa** chuỗi `SECRET`.

### V6.2 `POST /api/meetings/:id/parts` — đăng ký phần + tạo job (BR-117, 122, 123, 124; Q9)

```jsonc
// request
{ "parts": [ { "partId":"part-a1","filename":"REC_001.m4a","sizeBytes":54525952,
               "clientDurationSeconds":2880,"order":1 }, … ],
  "provider":"soniox","model":"","language":"auto","translationLanguage":"" }
// 201
{ "meetingId":"5f9c…","parts":[ {partId,order,status,jobId} … ],"queued":3 }
```

- Dùng cho **cả** lần import ghép đầu tiên **và** "thêm phần vào bản ghi ghép đã xong" (Q9): phần mới được `order` nối tiếp rồi người dùng kéo về đúng chỗ bằng `/parts/reorder`, hoặc gửi kèm `order` mong muốn (server tự đánh lại 1..N theo thứ tự tăng dần). Server **không** tự sinh lại summary (BR-121/BR-29) — chỉ bump `promptContextUpdatedAt` để nhắc nhở BR-146 bật.
- Ràng buộc server: `parts.length + current.parts.length ≤ 10` (BR-122) → `400 PARTS_LIMIT_EXCEEDED`; audio của từng `partId` phải tồn tại (`openStoredAudio(partId)`) → `404 PART_AUDIO_NOT_FOUND`; `provider`/`model`/`language` kiểm bằng **danh sách trắng ở server** (R-S) → `400 STT_PROVIDER_NOT_FOUND` / `STT_MODEL_NOT_SUPPORTED`.
- Kiểm lại định dạng + dung lượng theo **từng phần** (BR-138, BR-143): đuôi suy từ `filename` phải thuộc `appAcceptedExtensions` **và** được provider chấp nhận; `sizeBytes` thật lấy từ `fs.stat` của audio đã lưu (không tin `sizeBytes` của client) so với `adapter.maxUploadBytes`.
- Bản ghi **chưa có** `parts` mà lại đang có `transcript`/`audioId` (bản ghi một phần đã xong) → `409 MEETING_NOT_MULTIPART` kèm message tiếng Việt. v1 **không** hỗ trợ "nâng cấp" bản ghi một phần thành bản ghi ghép (xem E-V4).

### V6.3 `POST /api/meetings/:id/parts/:partId/retry` (BR-133, BR-124 ngoại lệ, BR-136)

```jsonc
// request (mọi field tuỳ chọn; thiếu → dùng lại cấu hình cũ của phần đó)
{ "provider":"deepgram","model":"nova-3","language":"vi","translationLanguage":"" }
// 200 → { partId, jobId, status:"queued" }
```
Chỉ chạy lại **đúng phần đó**: không đụng `transcript` của phần khác, không tạo job cho phần khác (test bắt buộc: đếm số lần `stt.transcribe` được gọi = 1). Phần đang `queued`/`processing` → `409 PART_ALREADY_RUNNING`.

### V6.4 `POST /api/meetings/:id/parts/reorder` (BR-119, BR-121)

```jsonc
{ "order": ["part-c3","part-a1","part-b2"] }        // hoán vị ĐẦY ĐỦ của parts hiện có
// 200 → { parts:[{partId,order,offsetSeconds,spanSeconds}], duration, transcriptLength }
```
Không hợp lệ (thiếu/thừa/lạ id) → `400 PARTS_ORDER_INVALID`, **không** sửa gì. Hợp lệ → đánh lại `order`, `rebuildMergedMeeting`, **không** gọi provider (test bắt buộc: `stt.transcribe` không được gọi lần nào), không đụng `summary`/`summaryPreset`/`summaryGeneration`, bump `promptContextUpdatedAt`.

### V6.5 `DELETE /api/meetings/:id/parts/:partId` — "Bỏ phần" (FAI-07, BR-134)

Đặt `status='dropped'`, **giữ nguyên audio trên đĩa** (BR-103/BR-134 — không `rm` gì cả), rebuild → ô trống FAI-10 nằm vĩnh viễn trong transcript. `200 { missingParts, duration }`.

### V6.6 `GET /api/meetings/:id/parts` — poll gọn cho N phần

```jsonc
{ "status":"processing","missingParts":[],"duration":5160,"durationEstimated":false,
  "parts":[ { "partId","order","filename","status","error","spanSeconds","offsetSeconds",
              "hasTranscript":true,"startedAt","endedAt" } ] }
```
**Không** trả transcript (giữ response nhỏ để poll 3s). Client vẫn lấy nội dung qua `/api/data` khi có phần vừa xong.

### V6.7 `POST /api/import-transcription` — mở rộng tương thích ngược

Thêm `partId` (tuỳ chọn) vào body; thiếu → hành vi **y hệt hôm nay** (bản ghi một phần). Thêm: kiểm `provider`/`model` bằng danh sách trắng (R-S), job tạo ở trạng thái `queued` và do scheduler khởi động (BR-88).

### V6.8 Không đổi

`PUT/GET/DELETE /api/audio/:id` giữ nguyên **hoàn toàn** (đã nhận id bất kỳ, đã hash SHA-256, đã giới hạn `MAX_AUDIO_BYTES`). `GET /api/jobs/:id` giữ nguyên (client cũ vẫn chạy).

---

## V7. Định dạng & pre-flight (BR-79 → BR-87, BR-138, BR-141 → BR-143)

### V7.1 `server/stt/formats.js` — một nguồn duy nhất

```js
// Mỗi provider khai báo NĂNG LỰC của mình (Protocol 8.3: thuộc tính trên object,
// không rẽ nhánh `if provider === 'google'` rải rác trong thân hàm).
PROVIDER_FORMATS = {
  soniox:   { accepted: [...], legacy: [...], rejected: [] , source: '…' },
  deepgram: { … }, whisper: { … }, google: { … }
}
APP_ACCEPTED_EXTENSIONS = union(accepted ∪ legacy của mọi provider)   // BR-79
EXTENSION_MIME = { m4a:'audio/mp4', mp4:'audio/mp4', mp3:'audio/mpeg', … }
extensionOf(filename) / statusFor(providerId, extension) → 'accepted'|'legacy'|'rejected'|'unknown'
```

Ý nghĩa 4 trạng thái — **quy tắc quyết định, không phải gợi ý**:

| Trạng thái | Nghĩa | Pre-flight | Server enforce |
|---|---|---|---|
| `accepted` | có **nguồn xác thực** provider nhận (§V12) | cho chạy, không cảnh báo | cho chạy |
| `legacy` | app **đã** gửi đuôi này cho provider này từ trước v3.0, doc không nói gì | cho chạy, **không** cảnh báo (không được tự nhiên chặn thứ hôm qua vẫn chạy — BR-84 "enforce chặt hơn thực tế → từ chối oan") | cho chạy |
| `rejected` | có nguồn xác thực provider **không** nhận | lỗi loại B, đề nghị provider khác (ERR-02b), **không tự đổi** (BR-86) | `422 STT_UNSUPPORTED_AUDIO` trước khi tạo job |
| `unknown` | đuôi không thuộc `APP_ACCEPTED_EXTENSIONS` | lỗi loại A (ERR-01) | `400 IMPORT_EXTENSION_NOT_SUPPORTED` |

Bảng giá trị v1 (nguồn xác thực đầy đủ ở §V12):

| Provider | `accepted` | `legacy` | `rejected` | `maxUploadBytes` (server đang enforce) |
|---|---|---|---|---|
| Soniox | aac, aiff, amr, asf, flac, mp3, ogg, wav, webm | m4a, mp4 | — | 500 MB |
| Deepgram | aac, flac, m4a, mp3, mp4, ogg, wav, webm | aiff, amr, asf | — | 1 GB |
| OpenAI Whisper | m4a, mp3, mp4, wav, webm | aac, aiff, amr, asf, flac, ogg | — | 25 MB |
| Google STT | flac, mp3, ogg, wav, webm | — | aac, aiff, amr, asf, m4a, mp4 | 10 MB |

`rejected` của Google **sinh ra từ chính `encodingForMime()`** (`server/stt/providers/google.js:23-30`) — refactor thành 1 bảng `MIME_ENCODINGS` rồi `encodingForMime` tra bảng đó, để "bảng trả cho client" và "bảng dùng để enforce" **không thể** lệch nhau (BR-141).

**Mime của file đã lưu**: `saveAudio` (`server.js:398-427`) hiện lấy nguyên `Content-Type` của request. Trình duyệt trả rỗng/`application/octet-stream` cho nhiều đuôi (`.amr`, `.asf`, đôi khi `.m4a`) ⇒ Google sẽ từ chối **oan** một file `.wav` hợp lệ. Sửa kèm: `resolveAudioMime(headerContentType, filename)` — header rỗng/octet-stream → suy từ đuôi qua `EXTENSION_MIME`. Đây là điều kiện để pre-flight (theo đuôi) và enforce (theo mime) nói **cùng một chuyện**.

### V7.2 Ba tầng kiểm tra

| Tầng | Ở đâu | Mục đích | Không được làm gì |
|---|---|---|---|
| 1. Pre-flight | `js/import-preflight.js` (hàm thuần) + modal | Báo **sớm** trước khi tạo meeting và trước khi gửi byte nào (BR-85) | Không phải lớp bảo vệ (BR-143). Lỗi khi lấy `/api/stt/providers` → **không chặn**, hiện IMP "chưa kiểm tra trước được" (BR-142) |
| 2. Khi đăng ký phần / tạo job | `POST /api/meetings/:id/parts`, `POST /api/import-transcription` | Kiểm lại đuôi + kích thước thật trên đĩa + provider whitelist | Không tin `sizeBytes` client gửi |
| 3. Khi chạy | `stt.transcribe` (đã có) | Chặn cuối theo `adapter.maxUploadBytes` trước khi `loadAudio()` | Không đổi |

`classify(file, provider, providersPayload)` (hàm thuần, test độc lập) trả:

```js
{ level: 'blockA'|'blockB'|'warn'|'ok',
  code: 'EXT_UNSUPPORTED'|'PROVIDER_REJECTS_FORMAT'|'TOO_LARGE_FOR_PROVIDER'|'EMPTY_FILE'|'DUPLICATE'|'TOO_MANY_FILES',
  alternatives: [{ id, name, ready: true|false }],   // provider khác xử lý được file này (BR-85/86)
  microcopyId: 'ERR-02' }
```
- `alternatives` chỉ liệt kê provider `configured && available` (ready) → B1; có provider nhận được nhưng **chưa có key** → B2 (`ready:false`, nút "Mở Cài đặt"); rỗng → B3 (ERR-13).
- Đổi provider "chỉ cho lần nhập này" (ERR-03b) là **biến cục bộ của modal**, **không** ghi vào `settings.json` (BR-87: lựa chọn theo từng lần import; không được âm thầm đổi mặc định của người dùng).
- Chế độ ghép: `classify` chạy cho **từng phần** (BR-138); tổng dung lượng **không** được cộng lại để so với giới hạn provider. Màn hình xác nhận hiển thị tổng chi phí = tổng các phần, và **không** có chỗ nào gợi ý chia nhỏ file để lách hạn mức (BR-138).

---

## V8. Client — cấu trúc và 4 điểm kỹ thuật đáng chú ý

### V8.1 Phân chia file

- `js/import-preflight.js`: **hàm thuần**, không DOM, không fetch → test bằng `node --test` (khai báo `const ImportPreflight = …` + đuôi `module.exports` như `js/meeting-types.js` đang làm, WHY-3 của v2.0).
- `js/import.js`: state của modal (`files[]`, `mode: 'separate'|'merged'`, `order[]`, `sttOverride`), render, kéo-thả, nghe thử. Dùng `.modal-backdrop`/`.modal` + `App.showModal()` sẵn có.
- `js/parts.js`: render dải phân cách/ô trống trong tab Transcript, card trạng thái N phần, thanh `▰▰▱`.
- `js/app.js`: `_handleUpload` (`:3810`) đổi thành `App.openImportModal()`; giữ lại **đúng** đường `_processUploadedRecording` + `_pollJobStatus` cho bản ghi một phần (không viết lại luồng đang chạy tốt).

### V8.2 Thứ tự phần đề xuất (BR-119) — **PRD thắng UX ở điểm này**

BR-119 quy định: (1) so tên file theo kiểu **tự nhiên**; (2) `lastModified` là **gợi ý phụ**, phải nói rõ là suy đoán; (3) không có căn cứ → giữ thứ tự người dùng chọn. UX §4b.1 rev 2 mô tả ngược lại (mặc định theo `lastModified`). Thiết kế theo **BR-119** vì `lastModified` là thứ đã bị đánh dấu `[UNVERIFIED]` sau AirDrop/Drive/Zalo (R-O), còn chỉ số trong tên file thì không đi đâu mất. Giao diện **giữ nguyên** 2 nút đổi cách sắp của UX (MRG-09/MRG-10) và dòng trạng thái MRG-07/MRG-08, chỉ đổi cái nào là **mặc định**. Thuật toán:

```
naturalCompare(a,b): tách chuỗi thành [text, number, text, …]; so number theo giá trị, text theo localeCompare('vi', {sensitivity:'base'})
if (mọi tên file khác nhau sau khi bỏ phần số && có ≥1 file chứa chữ số)  → sắp theo naturalCompare, hiện MRG-08
else if (mọi lastModified phân biệt được, chênh nhau ≥ 1 giây)            → sắp theo lastModified tăng dần, hiện MRG-07 + nhãn "suy đoán"
else                                                                      → giữ nguyên thứ tự chọn file
```

### V8.3 Nghe thử 10 giây + đọc thời lượng — trả lời `[CHƯA VERIFY]` của UX bằng **feature-detect lúc chạy**

Không hardcode danh sách "định dạng trình duyệt phát được" (sẽ sai giữa Chrome/Safari/phiên bản). Thay vào đó, với mỗi file:

```
url = URL.createObjectURL(file); audio = new Audio(url);
audio.addEventListener('loadedmetadata', …) → clientDurationSeconds = audio.duration (hữu hạn?), bật 2 nút nghe thử
audio.addEventListener('error',          …) → clientDurationSeconds = null, nút nghe thử disabled + tooltip MRG-14
timeout 5 giây không có sự kiện nào       → xử lý như 'error'
```
Luôn `URL.revokeObjectURL` khi đóng modal. Hệ quả dây chuyền đã thiết kế sẵn: `clientDurationSeconds = null` ⇒ tiêu đề danh sách dùng MRG-06b ("Các phần · 3 phần"), ẩn dòng MRG-15 (khoảng cách giữa các phần), ẩn ERR-10/ERR-11, và ô trống của phần lỗi có bề rộng thời gian = 0 (V4.3). **Không** có định dạng nào bị chặn vì trình duyệt không phát được — nghe thử là lớp kiểm chứng phụ, mất nó không mất tính năng.

### V8.4 `date` mặc định (BR-93, BR-94) — chốt: **chỉ** dùng `file.lastModified`, có nhãn nguồn

Không đọc metadata nhúng trong file (`.m4a` creation date) — cần thư viện parse, phá zero-dependency, và bản thân giá trị đó cũng `[UNVERIFIED]` (R-O). Quy tắc:
1. `file.lastModified` hợp lệ theo BR-94 (không ở tương lai > 1 ngày, không trước 2000-01-01) → prefill + nhãn IMP-11 "Lấy từ thông tin file — bạn kiểm tra lại giúp".
2. `lastModified` cách **thời điểm hiện tại < 30 phút** → vẫn prefill nhưng thêm IMP-12 ("Có vẻ đây là lúc bạn chép file vào máy…").
3. Không hợp lệ → thời điểm import, nhãn "ngày import".
`createdAt` **không bao giờ** nhận giá trị người dùng nhập (BR-92). Chế độ ghép: lấy của **phần 1** + IMP-11b (BR-137).

---

## V9. R-AB — sửa bug `duration` của Google (ảnh hưởng **mọi** bản ghi dùng Google)

**Hiện trạng (đọc source, `server/stt/providers/google.js:159`)**: `duration: words.length ? Math.round(words[words.length-1].start) : 0` — đây là **thời điểm bắt đầu của từ cuối cùng**, không phải thời lượng audio. Hệ quả: thời lượng hiển thị ngắn hơn thực tế, `billableDurationSeconds` sai, và với BR-125 thì phần sau sẽ **chồng lên** phần trước.

**Sửa (đã có nguồn xác thực, §V12.3)**: Google trả `WordInfo.endTime` và `SpeechRecognitionResult.resultEndTime`.

```
duration = max(
    max(resultEndTime của mọi result),      // "Time offset of the end of this result relative to the beginning of the audio"
    max(endTime của mọi word)               // chỉ có khi enableWordTimeOffsets = true (adapter đang bật)
)   // chuỗi dạng "1234.500s" → parseFloat sau khi bỏ hậu tố 's'
→ không có giá trị nào hữu hạn > 0 → giữ hành vi cũ (start của từ cuối) và đặt durationKind = 'speech-end'
```
`durationKind` của Google = **`'speech-end'`** kể cả sau khi sửa: đây vẫn là thời điểm kết thúc lời nói cuối, **không** gồm im lặng cuối file. Nhờ `durationKind`, BR-126 tự động bật `durationEstimated` cho bản ghi ghép dùng Google và BR-128 tắt cảnh báo chất lượng — đúng ý "thà không cảnh báo còn hơn cảnh báo sai".

**Ảnh hưởng dữ liệu cũ đã lưu sai** (bắt buộc nói rõ):
- **Không viết migration**. `duration` của bản ghi cũ dùng Google nằm trong `meetings.json` của người dùng; ta không có cách nào tính lại mà không gọi lại provider (tốn tiền, và audio có thể đã bị xoá).
- Bản ghi cũ do đó **vẫn hiển thị thời lượng ngắn hơn thực tế**. Đây là hạn chế đã biết, ghi vào `docs/CHANGELOG.md` mục "Known issues" và vào `HUONG-DAN-SU-DUNG.md` nếu PM muốn.
- Bản ghi cũ **không có** `durationKind` ⇒ mọi chỗ đọc field này phải coi `undefined` là `'unknown'` và **không** kết luận gì (không tự gắn nhãn "ước lượng" cho bản ghi cũ — sẽ là báo động sai hàng loạt).
- Người dùng muốn số đúng: chạy lại transcript (đã có nút "Thử lại" khi bản ghi còn audio). Không tự động chạy lại (tốn tiền, BR-114 tinh thần).

---

## V10. Hàng đợi, đồng thời, timeout (BR-88, BR-102; R-N, R-P)

| Hằng số | Giá trị v1 | Vì sao |
|---|---|---|
| `MAX_CONCURRENT_TRANSCRIPTIONS` | **2** | BR-88. Đã verify `loadAudio()` chạy **trước** hàng đợi per-provider (`server/stt/index.js:100-103`) ⇒ N job song song = N buffer trong RAM. 2 × 500 MB là mức Node chịu được một cách thận trọng. **Chưa đo thật** → xem U-V3 |
| `MAX_PARTS_PER_MEETING` | 10 (cảnh báo từ 6) | BR-122 |
| `MAX_FILES_PER_IMPORT` | 10 | BR-88 |
| `STT_API_TIMEOUT_MS` | **30 phút** (mới, tách khỏi `LLM_API_TIMEOUT_MS = 2 phút`) | **Bug đang tồn tại**: `createSttService({ timeoutMs: LLM_API_TIMEOUT_MS })` (`server.js:620`) đặt timeout 2 phút cho **mỗi lệnh HTTP** của STT — trong đó Deepgram/Whisper **upload cả file trong đúng lệnh đó**. File 1 GB không thể upload trong 2 phút ⇒ hỏng đúng ca dùng chính của feature này |
| Soniox `POLL_TIMEOUT_MS` | 30 phút → **3 giờ** | BR-102 phải đủ cho file 3 giờ |
| Google `POLL_TIMEOUT_MS` | 15 phút → **3 giờ** | R-P |
| `JOB_MAX_WALL_MS` | **6 giờ** | BR-102: watchdog cuối cùng — job vượt ngưỡng → `failed` với `code: 'STT_JOB_TIMEOUT'` + message tiếng Việt, **không bao giờ** treo mãi ở "đang xử lý" |

Scheduler (trong `server.js`, cạnh `runningJobs`): sau khi tạo job và sau khi mỗi job kết thúc → `pumpJobQueue()` đọc `jobs.json`, đếm `processing`, khởi động job `queued` cũ nhất cho tới khi đủ 2. Hàng đợi là **toàn cục** (không theo provider) vì ràng buộc là RAM của process, không phải rate limit.

---

## V11. Protocol 8 — audit TỪNG bước pipeline hiện có với biến thể mới "bản ghi ghép N phần"

Biến thể mới đi qua **cùng** pipeline với bản ghi thường (BR-116/BR-140). Bảng dưới liệt kê **mọi** bước đang tồn tại, không chỉ bước mới viết. Cột "Cùng vấn đề?" phải có **nguồn** (đọc source / đo thật), không suy đoán.

Cơ chế thực thi "skip có điều kiện" (Protocol 8.3): **thuộc tính năng lực khai báo trên object**, pipeline hỏi object thay vì so tên biến thể:
- `meetingCapabilities(meeting)` trong `server/meeting-parts.js` (và bản mirror cho client): `{ multiPart, singleAudioPlayback, inlineTranscriptEdit, durationIsAudioLength, qualityWarningEligible, summaryNeedsMissingPartConfirm }`
- `adapter.formats`, `adapter.maxUploadBytes`, `adapter.durationKindFor(model)` trên **từng** STT adapter.

| # | Bước hiện có | Giải quyết vấn đề gì (biến thể cũ) | Bản ghi ghép có cùng vấn đề? (nguồn) | Kết luận |
|---|---|---|---|---|
| 1 | `PUT /api/audio/:id` + hash SHA-256 | Chặn path traversal khi ghi audio | Có, y hệt; id nhận **chuỗi bất kỳ** ≤256 ký tự (`server.js:389-397`) nên `partId` chạy được ngay | **GIỮ NGUYÊN** |
| 2 | `openStoredAudio(meetingId)` | Nạp audio của meeting | Có, nhưng khoá phải là `partId` (`server.js:770`) | **SỬA**: nhận `audioId = job.partId \|\| job.meetingId` |
| 3 | Dedupe job theo `meetingId` (`server.js:1424-1459`) | Không tạo 2 worker cho 1 meeting | **KHÔNG** — 1 meeting ghép hợp lệ có tới 10 job cùng lúc | **SỬA**: khoá `meetingId#partId` |
| 4 | `mergeTranscriptionIntoMeeting` ghi `transcript/duration/status/sonioxUsage` (`server.js:673-720`) | Server là người ghi duy nhất của kết quả STT | Có, nhưng phải ghi vào `parts[i]` rồi **rebuild**, không ghi thẳng | **SỬA** (M7→M10) |
| 5 | Guard chống snapshot cũ ở `PUT /api/meetings` (`server.js:1522-1533`) | Browser cũ không lật ngược kết quả server | Có và **nặng hơn**: guard chỉ bật khi `incoming.status==='processing'` ⇒ snapshot `completed` sẽ xoá sạch `parts` | **SỬA** (V3.6, R-R) |
| 6 | `recoverInterruptedJobs` (`server.js:744`) | Job mất khi restart → failed, giữ audio | Có với job `processing`. Job `queued` thì **khác**: chưa gọi provider lần nào | **SỬA**: `queued` được giữ và chạy lại |
| 7 | `syncMeetingArtifacts` → `storage/transcripts/<hash>.json` | Artifact máy đọc cho mỗi meeting | Có; artifact đọc `meeting.transcript` = bản đã ghép ⇒ đúng tự nhiên | **GIỮ NGUYÊN** |
| 8 | Xoá meeting → xoá audio theo `meetingId` | Không để audio mồ côi | **KHÔNG** — audio của N phần nằm ở `partId` khác, sẽ ở lại vĩnh viễn trên đĩa | **SỬA**: xoá theo danh sách `parts[].partId` (R-Q: kho audio phình to) |
| 9 | `validateMeetingForSummary` (`server.js:784`) | Clamp input trước khi vào LLM | Có, nhưng đang **cắt bỏ** `kind`/`part`/`missingParts` ⇒ BR-130 không bao giờ chạy | **SỬA** (M12) |
| 10 | `buildContextBlock` | notes + pre-meeting vào cả 3 builder | Có + cần 2 dòng mới | **SỬA** (V5.3) |
| 11 | `formatTranscript` (dùng chung summary + chunk) | 1 định dạng transcript cho mọi prompt | Có + cần nhãn phần per-segment | **SỬA** (V5.1) |
| 12 | `chunkTranscript` | Cắt theo segment, giữ thứ tự thời gian | Có; merged transcript **đã** tăng dần đều (V4.3) nên cắt vẫn đúng. Rủi ro "chunk không chứa dải phân cách" đã bị vô hiệu bằng nhãn per-segment | **GIỮ NGUYÊN** |
| 13 | `CHUNK_SCAFFOLD_BASE_TOKENS + sectionsBlock + context.text + CHUNK_PRINCIPLES` | Chừa chỗ cho template trong mỗi chunk | Có; 2–3 dòng mới nằm trong `context.text` nên **tự động** được cộng | **GIỮ NGUYÊN** |
| 14 | `MAX_CHUNKS = 40` + lỗi `CONTEXT_TOO_LARGE` | Chặn reduce không nhét vừa | Có, và bản ghi ghép dài hơn ⇒ chạm trần thường xuyên hơn. Hành vi hiện tại (báo lỗi rõ, không im lặng) vẫn đúng | **GIỮ NGUYÊN** + ghi nhận |
| 15 | 3 cơ chế enforce schema LLM (Codex `--output-schema` / Gemini `responseSchema` / DeepSeek prompt-only) | Ràng buộc hình dạng output | Có, **và không đổi**: v3.0 chỉ thêm *input text* | **GIỮ NGUYÊN, CẤM ĐỘNG VÀO** |
| 16 | Snapshot preset BR-15→20 | Summary cũ render đúng cấu trúc cũ | Có, y hệt; reorder/retry **không** đụng `summaryPreset` (BR-121) | **GIỮ NGUYÊN** |
| 17 | Gợi ý preset theo `meetingType` (BR-55→58) | Chọn sẵn preset | Có, không phụ thuộc transcript | **GIỮ NGUYÊN** |
| 18 | `searchMeetings` (`js/storage.js:279-327`) | Tìm trong transcript/notes/… | Có; segment dải phân cách là text thường ⇒ tìm theo tên file phần cũng ra (tác dụng phụ vô hại) | **GIỮ NGUYÊN** |
| 19 | `toMarkdown` (export .md) | Xuất biên bản | Có + phải render dải phân cách/ô trống và cảnh báo thiếu phần (BR-129, PRG-17) | **SỬA** |
| 20 | `buildTitlePrompt` (`prompts.js:210`) | Gợi ý tiêu đề | **Khác**: hàm này render `speaker: text` không có timestamp; segment `kind` sẽ thành dòng rác `": — Phần 1/3 …"` | **SỬA**: lọc bỏ segment có `kind` |
| 21 | Cảnh báo chất lượng BR-106 | Báo bản ghi nghe không rõ | **KHÔNG hoàn toàn**: mẫu số `duration` có thể là ước lượng (Google/gpt-4o) | **SKIP có điều kiện** qua `capabilities.qualityWarningEligible = !durationEstimated` (BR-128) |
| 22 | Audio player 1 file ở Meeting Detail (`meeting.audioId`) | Nghe lại bản ghi | **KHÔNG**: không có file audio ghép (Out of Scope, BR-134) | **`[SKIP-v1]`** qua `capabilities.singleAudioPlayback = false`; thay bằng danh sách phát **từng phần** (`GET /api/audio/<partId>`) |
| 23 | Sửa transcript inline (`contenteditable`, `js/app.js:1331`) | Sửa lỗi nhận dạng | Có; cần map edit về đúng phần | **SỬA** (V3.6) — nếu T-task này không kịp, hạ xuống `[SKIP-v1]` bằng `capabilities.inlineTranscriptEdit = false` (khoá ô sửa) thay vì để mất chữ âm thầm |
| 24 | `_resumeProcessingJobs` (`js/app.js:3981`) | Mở lại tab thì bắt lại tiến trình | Có, nhưng phải resume theo **N phần**, không theo `_activeJobId` đơn lẻ | **SỬA**: `parts.length` > 0 → poll `GET /api/meetings/:id/parts` |
| 25 | Chỉ báo tác vụ nền `_backgroundAudioTasks` | Hiện "đang xử lý N bản ghi" | Có; 3 phần của 1 bản ghi phải đếm là **1** bản ghi (UX §5.5: chỉ toast 1 lần) | **SỬA** |
| 26 | Backup/import backup `_sanitizeImportedMeeting` | Backup không mất dữ liệu | Có; thiếu whitelist cho `parts` ⇒ restore backup sẽ **mất sạch phần** | **SỬA** (BR-112) |
| 27 | Dashboard chi phí (`js/app.js:611`) | Tổng chi phí STT | Có; đọc `sonioxUsage` — nay là **tổng** của các phần (V3.4) | **GIỮ NGUYÊN** |
| 28 | Generate Summary (BR-15, người dùng bấm) | Không tự tiêu tiền LLM | Có + cần bước xác nhận khi thiếu phần | **SỬA** qua `capabilities.summaryNeedsMissingPartConfirm` (BR-135) |

Dev phát hiện bước thứ 29 chưa có trong bảng → **dừng, hỏi Tech Lead**, không tự quyết.

---

## V12. External Contracts + Nguồn xác thực (Protocol 5)

### V12.1 Đọc source trong repo (đã đọc trực tiếp trong phiên này, 2026-09-18)

| Nội dung | Nguồn |
|---|---|
| Đường dẫn audio = `sha256(id)`, `PUT /api/audio/:id` nhận id bất kỳ ≤256 ký tự | `server.js:322-332, 389-397, 398-427` |
| Guard snapshot cũ chỉ bật khi `incoming.status==='processing'` | `server.js:1522-1533` |
| Dedupe job theo `meetingId`, job model có sẵn trạng thái `queued` | `server.js:1424-1459`, `server.js:654-657` |
| `loadAudio()` chạy **trước** hàng đợi per-provider | `server/stt/index.js:100-103` |
| `timeoutMs` của STT = `LLM_API_TIMEOUT_MS = 2 phút` | `server.js:43, 620` |
| `normalizeResult` coi `duration` không hữu hạn → `0`; transcript rỗng → ném `STT_TRANSCRIBE_FAILED` | `server/stt/contracts.js:69, 82-84` |
| `duration` từng provider: Soniox `audio_duration_ms/1000`; Deepgram `metadata.duration`; Whisper `body.duration` (0 với `gpt-4o-*`, 1 segment tại `time:0`); Google `words[last].start` | `soniox.js:160`, `deepgram.js:143`, `whisper.js:111-120`, `google.js:159` |
| Google từ chối m4a/mp4/aac qua `encodingForMime()` | `google.js:23-30, 91-96` |
| `maxUploadBytes`: Soniox 500MB, Deepgram 1GB, Whisper 25MB, Google 10MB — **do app tự enforce** | `soniox.js:11`, `deepgram.js:14`, `whisper.js:13`, `google.js:14`, `server/stt/index.js:94-98` |
| `listProviders()` **không** trả `maxUploadBytes`/định dạng | `server/stt/index.js:109-133` |
| `formatTranscript` dùng chung cho `buildSummaryPrompt` + `buildChunkPrompt`; `buildSynthesisPrompt` không nhận transcript | `server/llm/prompts.js:47-52, 186, 233, 268` |
| `validateMeetingForSummary` cắt segment còn `{time,speaker,text}` | `server.js:805-810` |
| `_sanitizeImportedMeeting` là whitelist ⇒ `sourceFilename` **đang bị rơi mất** khi restore backup | `js/storage.js:434-521` |
| Transcript sửa inline được (`contenteditable`, ghi theo `data-seg-index`) | `js/app.js:1331, 2108-2115` |

### V12.2 Doc chính thức của provider — **đã fetch thật trong phiên này (2026-09-18)**

| Provider | Nội dung trích | URL |
|---|---|---|
| Soniox | Định dạng tự nhận diện: **"aac, aiff, amr, asf, flac, mp3, ogg, wav, webm"**. Doc **không** nêu m4a/mp4/opus, **không** nêu giới hạn dung lượng async | https://soniox.com/docs/speech-to-text/core-concepts/audio-formats |
| Deepgram | "nearly all audio formats and encodings available (over 100+)", liệt kê **MP3, MP4, MP2, AAC, WAV, FLAC, PCM, M4A, Ogg, Opus, WebM**. Không nêu amr/asf/3gp/wma. Trang này **không** nêu giới hạn dung lượng | https://developers.deepgram.com/docs/supported-audio-formats |
| OpenAI Whisper | **"Supported input formats are `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, and `webm`."** và **"Files can be up to 25 MB."** | https://developers.openai.com/api/docs/guides/speech-to-text |
| Google STT v1 | `WordInfo.endTime` — *"Time offset relative to the beginning of the audio, and corresponding to the end of the spoken word"* (cần `enableWordTimeOffsets=true`, adapter đang bật); `SpeechRecognitionResult.resultEndTime` — *"Time offset of the end of this result relative to the beginning of the audio"*; response có `totalBilledTime` | https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v1/speech/recognize |

**Cách đọc bảng này cho đúng**: đây là bằng chứng để đưa một đuôi vào cột `accepted`. Doc **không nhắc** tới một đuôi **không** phải bằng chứng từ chối ⇒ đuôi đó nằm ở cột `legacy` (giữ nguyên hành vi hôm nay), **không** phải `rejected`. Cột `rejected` của v1 chỉ có Google, và nguồn là **chính source code đang enforce**.

### V12.3 Suy ra trực tiếp cho thiết kế

- **R-AB có đường sửa đúng**: `resultEndTime` / `endTime` là field tồn tại trong contract Google ⇒ §V9 implement được ngay, không cần `[UNVERIFIED]`.
- **Giới hạn dung lượng 500MB/1GB/10MB là số của app, không phải cam kết nhà cung cấp** (Whisper 25MB thì **là** cam kết đã verify). BR-141 yêu cầu trả "giá trị server đang enforce" ⇒ trả đúng số app dùng, và **không** quảng cáo nó là giới hạn của nhà cung cấp. UI nói "OpenAI Whisper chỉ nhận tối đa 25 MB" (ERR-02) — đúng với Whisper; với 3 provider còn lại, microcopy phải là "MeetNote giới hạn … cho nhà cung cấp này" (xem E-V2).

### V12.4 `[UNVERIFIED]` — chặn đúng phần nào

| # | Nội dung | Chặn gì | Cách gỡ |
|---|---|---|---|
| **U-V1** | `.opus` chạy thật với Deepgram (doc có nêu, **chưa** chạy thật một lần nào) | **Chặn T17** (mở rộng danh sách đuôi). Không chặn task nào khác | Import 1 file `.opus` thật với key Deepgram thật, dán log vào `docs/test-report.md`. Không chạy được → `.opus` **không** vào danh sách, và microcopy IMP-06 giữ nguyên 11 đuôi |
| **U-V2** | `.3gp`/`.3gpp`/`.caf`/`.wma`/`.mov`: **không có** nguồn nào | Không thêm (deny-by-default, BR-82). Không chặn task nào | — |
| **U-V3** | RAM thật khi 2 job × file 500 MB chạy song song (R-N) | Chặn **tuyên bố** "2 job đồng thời an toàn", không chặn implement | Đo `process.memoryUsage().rss` khi chạy thật 2 file lớn; nếu xấu → hạ `MAX_CONCURRENT_TRANSCRIPTIONS` xuống 1 (hằng số 1 chỗ) |
| **U-V4** | `file.lastModified` sống sót qua AirDrop/Drive/Zalo (R-O) | Không chặn: thiết kế đã hạ `lastModified` xuống **gợi ý phụ** (V8.2) và luôn cho sửa `date` | QA đo trên 3 đường truyền thật, ghi vào `docs/test-report.md` |
| **U-V5** | Trình duyệt phát/đọc thời lượng `.amr`/`.asf` | Không chặn: đã thay bằng feature-detect lúc chạy (V8.3) | QA ghi nhận định dạng nào phát được trên Chrome/Safari của máy thật |
| **U-V6** | `<input type="datetime-local">` trên Safari | Không chặn T13; **chặn tuyên bố** "giao diện đồng nhất". Fallback đã thiết kế: 2 ô `date` + `time` | Dev mở Safari thật, chụp lại |
| **U-V7** | Smoke test thật cho **mỗi** STT provider sau khi đổi `durationKind`/timeout (Protocol 5.4) | **Chặn đóng task T2/T3** | Chạy 1 file ngắn thật với từng provider có key trên máy Dev; provider không có key → ghi rõ vào `docs/test-report.md` là **chưa chạy**, không được coi là pass |
| **U-V8** | Giới hạn dung lượng thật của Soniox/Deepgram/Google (doc không nêu) | Không chặn (app giữ số của chính mình) | Nếu sau này nhà cung cấp công bố, cập nhật 1 hằng số/adapter |

Mock/fixture: Dev/QA **không** được viết tay response provider theo tài liệu này. Golden file phải capture từ lần chạy thật và lưu ở `tests/fixtures/<provider>/` (Protocol 5.3) — đã có tiền lệ `tests/fixtures/deepseek/`.

---

## V13. Task Breakdown

Thứ tự: năng lực provider → contract dữ liệu → hàm thuần ghép → hàng đợi → route → prompt → model client → UI → export → test. Dev làm theo `Depends`. Mỗi task xong phải chạy `npm test` xanh.

| ID | Task | BR thoả mãn | Files | Depends | Điều kiện hoàn thành (acceptance) |
|---|---|---|---|---|---|
| **TV1** | `server/stt/formats.js` + khai báo năng lực định dạng trên 4 adapter + `resolveAudioMime` + mở rộng `GET /api/stt/providers` | BR-79, 82, 84, 141, 143; R-L, R-AE | `server/stt/formats.js`+, `server/stt/index.js`, `server/stt/providers/*.js`, `server.js` | — | Endpoint trả `maxUploadBytes` + `formats` + `appAcceptedExtensions`; giá trị **đọc từ cùng hằng số** mà `stt.transcribe` enforce (test: đổi hằng số trong adapter → endpoint đổi theo); Google `rejected` sinh từ bảng `MIME_ENCODINGS` dùng chung với `encodingForMime`; test set `SONIOX_API_KEY=SECRET-123` → body response **không chứa** `SECRET`; file `.wav` upload với `Content-Type` rỗng → mime suy từ đuôi |
| **TV2** | Sửa `duration` Google (R-AB) + `durationKind` trong `normalizeResult` + `durationKindFor(model)` trên 4 adapter | BR-125, 126; R-AB, R-AC | `server/stt/providers/google.js`, `server/stt/contracts.js`, `server/stt/providers/*.js` | — | Google: fixture thật (golden file) có `resultEndTime`/`endTime` → `duration` = kết thúc từ cuối, **lớn hơn** giá trị công thức cũ; thiếu cả hai field → rơi về hành vi cũ; `durationKind` đúng cho 5 trường hợp bảng PRD §12 (`soniox`/`deepgram`/`whisper-1` = `audio-length`, `gpt-4o-*` = `none`, `google` = `speech-end`); bản ghi cũ không có field → mọi consumer coi là `'unknown'` và **không** gắn nhãn ước lượng. **Chặn đóng task**: U-V7 (smoke test thật) |
| **TV3** | `server/stt/merge.js`: `computeTimeline` + `buildMergedTranscript` (hàm thuần) | BR-125, 126, 127, 129, 131, 136 | `server/stt/merge.js`+, `test/merge-timeline.test.js`+ | TV2 | Test bảng 5 provider: mốc thời gian **luôn tăng dần, không chồng lấn**, kể cả `duration=0` và `duration` = start-từ-cuối; `duration` tổng = Σ span của phần completed (không cộng 1s ngăn cách, không cộng phần lỗi); `durationEstimated` bật đúng; phần lỗi/bỏ sinh **1** segment `kind:'part-gap'` tại đúng offset và các phần sau **vẫn** cộng dồn như thể phần đó tồn tại; phần im lặng (transcript rỗng, `STT_TRANSCRIBE_FAILED`) xử lý như phần lỗi, không hỏng cả bản ghi |
| **TV4** | `server/meeting-parts.js`: chuẩn hoá part, `meetingCapabilities`, `preserveServerOwnedFields`, áp edit text về part; nối vào `PUT /api/meetings` | BR-121, 132, 134, 137, 140; R-R, R-Z | `server/meeting-parts.js`+, `server.js`, `test/meeting-parts.test.js`+ | TV3 | Snapshot client `completed` **không** xoá được `parts`/`transcript`/`duration`/`sonioxUsage`; snapshot `processing` (guard cũ) vẫn chạy như trước với bản ghi một phần (test hồi quy); sửa 1 chữ trong segment của phần 2 → chữ đó nằm trong `parts[1].transcript[i].text` sau reload; snapshot lệch cấu trúc → bỏ qua toàn bộ, không mất dữ liệu; `sonioxUsage` = tổng đúng của 2/3 phần kèm `partsCounted:2` |
| **TV5** | Hàng đợi 2 job đồng thời + `partId` trong job + `STT_API_TIMEOUT_MS` + poll timeout + watchdog + recover `queued` | BR-88, 100, 102, 103; R-N, R-P | `server.js`, `server/stt/providers/{soniox,google}.js` | — | 5 job tạo cùng lúc → đúng 2 `processing`, 3 `queued`, chạy hết không mất job nào; restart server: `processing`→`failed` (giữ audio), `queued` **vẫn chạy lại**; job vượt `JOB_MAX_WALL_MS` → `failed` có lý do, **không** treo; dedupe theo `meetingId#partId` (bản ghi một phần: hành vi cũ, test hồi quy) |
| **TV6** | 5 route phần: `POST /parts`, `POST /parts/:partId/retry`, `POST /parts/reorder`, `DELETE /parts/:partId`, `GET /parts`; mở rộng `/api/import-transcription` | BR-117, 122, 123, 124, 133, 138, 139; Q9; R-S | `server.js`, `test/parts-routes.test.js`+ | TV4, TV5 | Đăng ký 3 phần → **1** meeting + 3 job; retry phần 2 → `stt.transcribe` gọi **đúng 1 lần**, transcript phần 1/3 byte-for-byte không đổi; reorder → **0** lệnh gọi provider, transcript đổi đúng thứ tự, `summary`/`summaryPreset`/`summaryGeneration` không đổi; `DELETE part` → audio **vẫn còn trên đĩa**, ô trống FAI-10 xuất hiện; `provider` lạ → 400 theo danh sách trắng; `partId` sai khuôn → 400; thêm phần thứ 11 → 400; mọi route trả 403 khi `Host` header lạ |
| **TV7** | Prompt: nhãn phần per-segment + 2–3 dòng context + provenance `missingParts`; `validateMeetingForSummary` giữ `kind`/`part`/`partCount`/`missingParts`; `buildTitlePrompt` lọc segment `kind`; `PROMPT_VERSION` → v5 | BR-130, 135; R-AD; Protocol 6 | `server/llm/prompts.js`, `server.js`, `js/summary.js`, `test/prompt-parts.test.js`+ | TV3 | Meeting 2 phần → **cả 3** builder mang thông tin phần: `buildSummaryPrompt` và `buildChunkPrompt` có `(Phần 2)` trên đúng segment của phần 2; `buildSynthesisPrompt` có dòng "gồm 2 phần" + câu cấm gộp người nói; chunk cắt **giữa** phần 2 vẫn còn nhãn; bản ghi một phần → prompt **không đổi một ký tự** so với v4 (test hồi quy diff chuỗi); `contextUsed.missingParts` đúng; **không** đụng `schemas/meeting-summary.schema.json` |
| **TV8** | Client data layer: `parts` + 5 field mới trong default/sanitize/backup; bump `promptContextUpdatedAt`; xoá meeting → xoá audio mọi phần | BR-112, 137, 146; R-AF; V11#8, #26 | `js/storage.js`, `js/app.js` | TV4 | Restore backup có `parts` → đủ phần, đủ transcript; backup **thiếu** field mới → mặc định, không lỗi; `sourceFilename` không còn bị rơi mất; gắn tag → `promptContextUpdatedAt` **không** đổi; sửa `participants`/`date`/`notes` → đổi; bản ghi cũ thiếu field → **không** hiện nhắc nhở; xoá bản ghi ghép → 3 file audio biến mất khỏi `storage/audio/` |
| **TV9** | `js/import-preflight.js` (hàm thuần) + test | BR-80, 81, 83, 84, 85, 86, 87, 109, 138, 142 | `js/import-preflight.js`+, `test/import-preflight.test.js`+ | TV1 | 40MB + Whisper → `blockB` + `alternatives` chỉ gồm provider ready nhận được file; `.txt` → `blockA` kèm đuôi thực tế + danh sách đuôi chấp nhận; 0 byte → chặn; file trùng (tên + size) → `warn`, không chặn; provider payload `null` (endpoint lỗi) → **mọi file `ok`** kèm cờ `preflightUnavailable` (BR-142); chế độ ghép: chạy theo từng phần, **không** cộng dung lượng |
| **TV10** | Modal import: state A/B/C, kéo-thả, chế độ "nhiều bản ghi riêng", ngữ cảnh 1 lần cho cả lô, cấu hình STT cho lần import | BR-77, 78, 81, 87, 90–96, 104, 105, 107, 110, 113, 115, 147 | `js/import.js`+, `js/app.js`, `index.html`, `css/components.css` | TV9 | Text **100% tiếng Việt** lấy nguyên văn §6 UX; chọn 5 file (2 lỗi) → tạo 3 bản ghi, 2 dòng lỗi **vẫn hiển thị**, nút ghi "Bắt đầu — tạo 3 cuộc họp"; 15 file → nhận 10, báo rõ; bấm 2 lần nhanh → 1 bản ghi/1 job; đóng modal giữa chừng → bản ghi vẫn chạy với ngữ cảnh đã nhập; lưu audio thất bại → bản ghi lỗi có sẵn "Chọn lại file" + "Xoá bản ghi" (BR-105); kéo thư mục vào → không tạo gì |
| **TV11** | Chế độ ghép trong modal: bộ chọn chế độ, danh sách phần, thứ tự (natural sort + `lastModified`), nghe thử 10s, cảnh báo khoảng cách, gợi ý mềm | BR-117, 118, 119, 120, 122, 124, 137, 139 | `js/import.js`, `js/parts.js`+, `css/components.css` | TV10, TV6 | `phan-2` đứng trước `phan-10`; không có số → sắp theo `lastModified` + nhãn "suy đoán"; kéo thả **và** `▲▼` đều đổi được thứ tự; **chưa bấm xác nhận → không có request nào rời máy** (BR-120: kiểm bằng devtools/network mock); file lỗi **chặn** Start cho tới khi bỏ ra (khác chế độ riêng); định dạng trình duyệt không phát được → nút nghe thử disabled + MRG-14, mọi thứ khác vẫn chạy; ≥6 phần → cảnh báo mềm; >10 → chặn |
| **TV12** | Meeting Detail cho bản ghi ghép: card tiến độ N phần, card lỗi phần (thử lại / đổi provider / bỏ phần), dải phân cách + ô trống trong transcript, phát lại từng phần, cảnh báo chất lượng | BR-101, 106, 128, 129, 132, 133, 134, 135, 136; V11#21, #22, #23 | `js/app.js`, `js/parts.js`, `css/components.css` | TV6, TV8 | 2/3 phần xong → đọc được phần 1–2, ô trống có nhãn ở đúng chỗ phần 3, **không** có thanh tiến trình phần trăm giả; phần 2 lỗi → badge FAI-12, 3 nút đúng thứ tự UX; "Bỏ phần 2" → xác nhận, sau đó ô trống FAI-10 **vĩnh viễn**; Generate Summary khi thiếu phần → hộp xác nhận nêu rõ thiếu phần nào rồi mới chạy (BR-135); `durationEstimated` → hiện "thời lượng chỉ là ước lượng" và **không** hiện cảnh báo chất lượng |
| **TV13** | Card Pre-meeting info: sửa `date` (ngày + giờ) và `participants` (chip), badge "Mới nhập", DAT-01/03, nhắc nhở BR-146 | BR-144, 145, 146, 147; D-17 | `js/app.js`, `css/components.css` | TV8 | Áp dụng cho **mọi** bản ghi kể cả bản ghi live; sửa `date` → `createdAt` **không** đổi, transcript không đổi, toast DAT-03 khi đổi sang ngày khác; ngày tương lai 1 tháng → từ chối theo BR-94; xoá trắng ô ngày → khôi phục giá trị cũ khi blur; gắn tag → **không** nhắc nhở, sửa participants → **có** nhắc nhở; Safari: nếu `datetime-local` vỡ → fallback 2 ô (U-V6) |
| **TV14** | Export .md cho bản ghi ghép | BR-129, 51; PRG-17, FAI-10 | `js/export.js` | TV3, TV12 | File .md có dải phân cách "Phần 2/3 · tên file" đúng vị trí; bản ghi thiếu phần → có dòng cảnh báo trong file **và** trong modal export; bản ghi một phần → file .md **không đổi** so với v2.0 (test hồi quy) |
| **TV15** | Gắn file vào bản ghi draft (chưa có audio, transcript rỗng) | BR-98 | `js/app.js`, `js/import.js`, `server.js` | TV10 | Draft có sẵn ngữ cảnh → gắn file → **không** tạo bản ghi thứ hai, ngữ cảnh giữ nguyên; bản ghi đã có transcript/audio → chặn kèm lý do |
| **TV16** | Golden fixture + smoke test thật cho 4 STT provider; test lineage đầu-cuối chế độ ghép | Protocol 5.3/5.4, Protocol 6.3 | `tests/fixtures/<provider>/`+, `test/*` | TV2, TV6, TV7 | Mỗi provider có ≥1 golden file **capture từ chạy thật** (không có key → ghi rõ "chưa chạy" trong `docs/test-report.md`, **không** được viết tay fixture); 1 test chạy xuyên suốt 3 phần giả lập assert **giá trị** truyền giữa M5→M7→M9→M13 |
| **TV17** | *(Gated)* Mở rộng `.opus` cho Deepgram | BR-82 | `server/stt/formats.js`, microcopy IMP-06 | U-V1 gỡ nhãn | **CHẶN** cho tới khi có log import `.opus` thật chạy xanh với Deepgram. Gỡ được: thêm `opus` vào `accepted` của Deepgram (1 dòng) + cập nhật IMP-06 theo E-V3. Không gỡ được: không làm gì, không hứa trên UI |

**Cổng chặn (Protocol 5.2 / 8.2)**
- TV17 bị chặn bởi U-V1. TV2/TV3 **không được tuyên bố xong** khi chưa có smoke test U-V7.
- Bước pipeline `[SKIP-v1]` (V11 #22 phát audio gộp) **không được** implement "tạm" bằng cách nối file — Out of Scope, cần công cụ xử lý media.
- Nếu TV4 (áp edit về part) trượt khỏi scope vì thời gian: **phải** đồng thời đặt `capabilities.inlineTranscriptEdit = false` và khoá ô sửa ở UI. Cấm để trạng thái "sửa được trên màn hình nhưng mất sau reload".
- QA trước release (Protocol 6.3): chạy **thật** 3 file của cùng một buổi họp bị cắt khúc, đọc **nội dung** transcript ở 2 chỗ nối, rồi export .md và đọc file — không chỉ tin `status: completed`.

---

## V14. Technical Decisions (WHY)

**WHY-V1 — `parts[]` nhúng trong meeting, `transcript` là dẫn xuất.** Lựa chọn này mua được điều quý nhất: **mọi pipeline v1.0/v2.0 không phải biết bản ghi ghép tồn tại**. Preset, snapshot, map-reduce, tag, search, export, dashboard chi phí đều tiếp tục đọc `meeting.transcript`/`meeting.duration` như cũ. Giá phải trả: server phải là người ghi duy nhất của `transcript` khi có `parts`, nên `PUT /api/meetings` cần bảng quyền sở hữu field (V3.6). Đó là một chỗ phức tạp, đổi lấy việc không phải sửa 8 chỗ khác — và 8 chỗ kia mới là nơi lỗi im lặng hay xảy ra.

**WHY-V2 — `partId` là khoá audio, không phải `meetingId + index`.** Chỉ số phần thay đổi khi người dùng sắp xếp lại (BR-119/BR-121). Nếu đường dẫn audio suy từ chỉ số, một lần kéo thả sẽ khiến phần 2 phát ra tiếng của phần 3. `partId` bất biến, `order` thay đổi tự do.

**WHY-V3 — Import 1 file **không** sinh `parts`.** Bản ghi cũ dù sao cũng không có `parts`, nên code vẫn phải xử lý shape cũ. "Thống nhất hoá" bằng cách bắt mọi bản ghi mới có `parts` không xoá được nhánh nào, chỉ làm luồng phổ biến nhất đi qua nhiều code mới hơn. KISS thắng ở đây.

**WHY-V4 — Nhãn người nói gắn vào **từng segment**, không chỉ ở dải phân cách.** `chunkTranscript` cắt theo token; một chunk hoàn toàn có thể bắt đầu giữa phần 2. Nhãn per-segment là cách duy nhất đúng trong mọi cách cắt — đúng loại lỗi Protocol 6 mô tả: chạy xong, báo thành công, biên bản gán nhầm người mà không ai phát hiện.

**WHY-V5 — `durationKind` là thuộc tính của **kết quả**, không phải bảng `if provider === 'google'`.** BR-126 cần biết "thời lượng này có phải thời lượng audio thật không". Nếu hỏi bằng cách so tên provider, mỗi chỗ cần biết sẽ tự chép lại bảng đó và chúng sẽ lệch nhau (Whisper còn khác nhau theo **model**, không theo provider). Adapter khai báo `durationKindFor(model)`, pipeline hỏi kết quả — đúng tinh thần Protocol 8.3.

**WHY-V6 — `missingParts` là dữ liệu, không phải một giá trị `status` mới.** Thêm `status: 'partial'` sẽ buộc phải cập nhật whitelist trong `js/storage.js:475`, bản đồ badge, và **mọi** chỗ so `=== 'completed'` trong client — mỗi chỗ bỏ sót là một bản ghi biến mất khỏi một màn hình nào đó.

**WHY-V7 — `legacy` tồn tại bên cạnh `accepted`/`rejected`.** Doc của Soniox/Deepgram/OpenAI không liệt kê hết mọi đuôi app đang gửi. Nếu quy "không có trong doc" thành "bị từ chối", v3.0 sẽ **chặn những file hôm qua vẫn chạy được** — vi phạm đúng cảnh báo của BR-84 ("enforce chặt hơn thực tế → từ chối oan"). `legacy` = giữ nguyên hành vi, không hứa hẹn gì trên UI.

**WHY-V8 — Nghe thử/đo thời lượng bằng feature-detect lúc chạy, không bằng danh sách định dạng.** Danh sách "trình duyệt phát được" khác nhau giữa Chrome/Safari/phiên bản/hệ điều hành; viết cứng là cầm chắc sai. Hỏi trực tiếp `HTMLAudioElement` cho câu trả lời đúng trên đúng máy đó, và biến một `[CHƯA VERIFY]` của UX thành chuyện không cần verify.

**WHY-V9 — Sửa `duration` của Google ngay vòng này, nhưng **không** migrate dữ liệu cũ.** Công thức cũ sai bản chất và BR-125 khuếch đại nó thành lỗi chồng lấn dòng thời gian. Nhưng tính lại số cũ đòi hỏi gọi provider lần nữa (tốn tiền, audio có thể đã bị xoá) ⇒ ghi nhận là hạn chế đã biết, cung cấp đường thủ công ("Thử lại"), không âm thầm sửa số liệu chi phí lịch sử của người dùng.

**WHY-V10 — Tách `STT_API_TIMEOUT_MS` khỏi `LLM_API_TIMEOUT_MS`.** 2 phút là hợp lý cho một lệnh gọi LLM, và là sai hoàn toàn cho một lệnh POST kèm 1 GB audio. Hai loại tải hoàn toàn khác nhau dùng chung một hằng số là lỗi có sẵn mà feature này sẽ chạm vào ngay ngày đầu.

**WHY-V11 — Ưu tiên PRD khi PRD và UX lệch nhau, và nói rõ chỗ lệch.** Hai chỗ đã xử lý: thứ tự phần mặc định (V8.2) và quyền tóm tắt khi thiếu phần (E-V1). Không im lặng chọn một bên.

---

## V15. Escalation lên PM — cần chốt ở ⏸ CHECKPOINT 2

| ID | Vấn đề | Đề xuất của Tech Lead |
|---|---|---|
| **E-V1** | **UX §5.4b/§5.7b vô hiệu hoá nút Generate Summary khi bản ghi thiếu phần** (tooltip PRG-13), trong khi **BR-135 (user chốt Q10)** nói "cho tóm tắt, kèm xác nhận + provenance" | Theo **BR-135**: phần còn đang chạy (`processing`) → nút vô hiệu (đúng hành vi hiện tại của app với bản ghi chưa có transcript); phần đã **lỗi/bị bỏ** → nút **bật**, có hộp xác nhận nêu rõ thiếu phần nào. Cần PM xác nhận để UX cập nhật PRG-13 |
| **E-V2** | Microcopy ERR-02 nói "OpenAI Whisper **chỉ nhận** tối đa 25 MB" — đúng với Whisper (doc đã verify) nhưng sẽ **sai sự thật** nếu dùng nguyên khuôn đó cho Soniox/Deepgram/Google (500MB/1GB/10MB là **giới hạn của MeetNote**, nhà cung cấp không công bố) | Giữ ERR-02 cho Whisper; thêm 1 biến thể cho 3 provider còn lại: *"File này nặng 121 MB. MeetNote giới hạn 10 MB cho Google Speech-to-Text."* Cần PM/UX duyệt câu chữ mới |
| **E-V3** | `.opus`: doc Deepgram có nêu, nhưng **chưa chạy thật** ⇒ nếu bật, IMP-06 phải đổi thành "…, mp4, opus (chỉ Deepgram)" — tức microcopy đã duyệt bị đổi | Mặc định **không bật** ở v1 (TV17 bị chặn). Nếu PM muốn có: cần 1 key Deepgram thật để Dev chạy 1 lần + duyệt câu IMP-06 mới |
| **E-V4** | **Q9 chỉ áp dụng cho bản ghi đã ở chế độ ghép.** Người dùng import 1 file (bản ghi một phần, không có `parts`) rồi hôm sau tìm thấy phần 2 → v1 **không** cho thêm phần vào bản ghi đó | Đề xuất giữ nguyên giới hạn này ở v1 (quyết định user viết rõ "bản ghi **ghép** đã xong"). Nâng cấp bản ghi một phần thành bản ghi ghép là một thao tác biến đổi dữ liệu có thật (dời transcript/audio vào part 1) — làm được nhưng là task riêng, nên để v1.1 sau khi mô hình `parts` đã chạy ổn định |
| **E-V5** | `MAX_CONCURRENT_TRANSCRIPTIONS = 2` **chưa đo thật** với 2 file 500 MB (U-V3); nếu RAM xấu, phải hạ xuống 1 và người dùng chờ lâu gấp đôi | Ship với 2, đo trong QA, hạ xuống 1 nếu cần (hằng số 1 chỗ, không phá dữ liệu). Chỉ cần PM ghi nhận |
| **E-V6** | Bản ghi cũ dùng Google **vẫn** mang `duration` sai sau khi sửa R-AB (không migrate) | Ghi vào CHANGELOG "Known issues" + 1 dòng trong `HUONG-DAN-SU-DUNG.md`. Cần PM duyệt việc công bố |
| **E-V7** | BR-119 (PRD) và UX §4b.1 lệch nhau về **thứ tự mặc định** của các phần | Theo PRD: natural sort tên file là chính, `lastModified` là gợi ý phụ (V8.2). Cần PM xác nhận để UX rev 3 sửa lại 1 dòng |

---

## V16. Danh sách kiểm tra bảo mật cho Reviewer (v3.0)

| Điểm | Yêu cầu |
|---|---|
| Cổng vào | 5 route mới đều nằm dưới `/api/` và **không** có nhánh nào bỏ qua `hasTrustedHost` + `isTrustedApiRequest`; không mở cổng mới, không nghe trên interface khác `127.0.0.1` (BR-77) |
| Ghi file | Không route nào nhận đường dẫn/tên file từ client. Audio vẫn ghi qua `sha256(partId)`; `partId` phải khớp `/^part-[a-z0-9-]{8,64}$/` trước khi dùng (BR-111) |
| Subprocess | v3.0 **không thêm** `child_process.spawn` nào. Nếu Dev thêm → bắt buộc `shell:false` + đường dẫn binary tuyệt đối |
| Rò rỉ bí mật | `GET /api/stt/providers` dựng bằng danh sách field trắng; có test assert không chứa API key (R-AE) |
| Tin dữ liệu client | `sizeBytes`, `clientDurationSeconds`, `filename` của client **chỉ** để hiển thị; kiểm tra thật lấy từ `fs.stat` + metadata server ghi. `provider`/`model`/`language` lọc bằng danh sách trắng server (R-S) |
| Không mất dữ liệu | Không có đường nào xoá audio khi job lỗi (BR-103/134); "Bỏ phần" chỉ đổi `status`, không `rm` |

---

⏸ **CHECKPOINT 2 — CHỜ NGƯỜI DUYỆT.** Đây là thiết kế cho `import-phone-recording`. Cần quyết 7 điểm ở §V15 (E-V1 → E-V7) trước khi Dev bắt đầu. Dev **không** được implement TV17 và không được tuyên bố TV2/TV3 hoàn tất khi các nhãn `[UNVERIFIED]` ở §V12.4 chưa được gỡ theo đúng cách ghi ở đó.
