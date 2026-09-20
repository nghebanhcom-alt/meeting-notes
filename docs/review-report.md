# Review Report — 2026-09-18

## Verdict: REQUEST_CHANGES

Lý do duy nhất chặn: vi phạm Protocol 5.3 tại T9 (mục Critical #1). Toàn bộ phần còn lại của
feature (17 task) đạt chất lượng cao, đã tự kiểm chứng độc lập — xem chi tiết bên dưới.

## Issues Found

### Critical
- [ ] `tests/fixtures/deepseek/dynamic-sections.json` (T9) — **Vi phạm Protocol 5.3 (cấm mock
  viết tay theo giả định), xác nhận đúng như Dev tự báo cáo**. Đã đọc trực tiếp file: trường
  `raw` là chuỗi JSON do Dev tự soạn ("Client wants a pilot rollout in Q4...", "Send pilot
  proposal draft"/"Alex"/"2026-09-25") — không phải bytes thật lấy từ response HTTP của
  DeepSeek ngày 2026-09-18. `_note` trong chính file cũng tự thú nhận điều này ("Dev did not
  have access to a raw HTTP capture to paste here verbatim"). Architecture.md §6.3 mô tả smoke
  test thật đã chạy và cho biết *shape* đúng (key set, order, 3 type, no extra key), nhưng
  không có capture verbatim — nghĩa là ngay cả nguồn xác thực trong Architecture.md cũng chưa
  đủ để sinh golden file theo đúng tinh thần Protocol 5.3 ("mock phải sinh từ output thật đã
  capture"). Đây chính xác là "mock tự xác nhận giả định" mà CLAUDE.md liệt kê: fixture giả
  định DeepSeek trả về đúng những gì prompt yêu cầu (không lệch key, không thêm field, không
  format lạ) — là chính giả định mà smoke test tồn tại để kiểm chứng, chưa ai kiểm chứng bằng
  byte thật.
  → **Gợi ý sửa**: Trước khi merge, chạy lại smoke test DeepSeek thật (có key trong Keychain
  `meetnote-local/deepseek-api-key`), capture response HTTP nguyên văn, thay `raw` trong
  fixture bằng bytes thật đó (không sửa lại cho "đẹp"). Nếu không có máy có key trong phiên
  review này → **không đóng T9**, tag task như T7/T8 ("CODE COMPLETE, NOT CLOSED", chặn theo
  Protocol 5.4) thay vì để CHANGELOG ghi "48/48 passing" ngụ ý T9 đã xong. QA không được
  duyệt T9 tới khi có golden file thật.
  Đây REQUEST_CHANGES ngay theo CLAUDE.md, **không tính vào giới hạn 3 vòng Dev↔Reviewer**
  (Protocol 5, process gate).

### High
(none)

### Medium
- [ ] `server/llm/preset-schema.js:180-188` (BR-14 qua `console.warn`) — Chấp nhận được về mặt
  kỹ thuật (xem Positive Notes), nhưng làm mất khả năng audit lâu dài: `console.warn` không
  vào `storage/logs*` nên không tra cứu được sau khi tiến trình dừng, không có trong
  `client diagnostics`/log file mà `logEvent` ghi. Đây là quyết định kiến trúc (đánh đổi giữa
  "module thuần" và "audit log"), không phải bug — nhưng đúng như Dev tự nhận, **đây là việc
  Tech Lead nên xác nhận lại, không nên để Dev tự quyết vĩnh viễn** vì nó đụng tới một business
  rule (BR-14) đã được duyệt ở Checkpoint 2 với kỳ vọng có audit trail. Gợi ý: escalate 1 dòng
  cho Tech Lead giống mẫu E1-E5 (không cần chặn merge, không phải Critical vì hành vi
  drop-key vẫn đúng, thứ mất chỉ là khả năng tra cứu về sau) — ví dụ chọn giữa (a) chấp nhận
  `console.warn` vĩnh viễn, (b) đổi `logEvent` thành hàm nhận callback tuỳ chọn để tránh
  circular require thay vì import thẳng từ `server.js`.
- [ ] `docs/CHANGELOG.md` dòng "npm test is green (48/48)" đặt ngay đầu file, trước khi đọc
  xuống tới ghi chú T9 mới thấy gap Protocol 5.3 — nên ghi rõ ngay từ đầu rằng T9 (không chỉ
  T7/T8) chưa thực sự đóng theo Protocol 5.4, để người đọc lướt nhanh không hiểu nhầm "xanh
  100%" nghĩa là "đủ điều kiện merge toàn bộ".

### Low
- [ ] `server/llm/index.js:131` — tham số đặt tên `preset` thay vì `format` như Architecture.md
  §9 T6 ghi. Đã verify: object thực sự truyền xuống adapter (`adapter.summarize({ prompt,
  model, format })`) vẫn đúng `buildSummaryFormat(preset)`, hành vi tương đương 100%. Chỉ là
  lệch tên tham số ngoài so với văn bản đặc tả — không cần sửa, nhưng nếu Tech Lead cập nhật
  Architecture.md ở version sau nên đồng bộ tên cho khỏi gây nhầm khi đọc song song 2 tài liệu.

## External contract verification
YES (nguồn: đọc trực tiếp source code đã sửa — `server.js`, `server/llm/index.js`,
`server/llm/prompts.js`, `server/llm/preset-schema.js`, `js/app.js`, `test/presets.test.js`,
`test/http.test.js` — và tự chạy `npm test`). Riêng contract DeepSeek dynamic-sections (T9):
**NO** — golden fixture không phải capture thật, xem Critical #1.

## Đánh giá chi tiết 5 điểm Dev tự báo cáo

1. **`console.warn` thay `logEvent` (BR-14)** — Hợp lý về kỹ thuật và không chỉ vì "giữ đúng
   không I/O" theo lời Dev: đã tự kiểm chứng thêm `logEvent` được định nghĩa trong `server.js`
   (dùng `logWriteQueue`, ghi file async) trong khi `server.js` lại `require('./server/llm/
   preset-schema')` — nếu `preset-schema.js` import `logEvent` từ `server.js` sẽ tạo
   circular require, không chỉ là vi phạm "pure module" trên giấy. Console.warn vẫn giữ được
   hành vi "không log nội dung, chỉ tên key" đúng BR-14. Tuy nhiên mất khả năng audit lâu dài
   (log biến mất sau khi tắt process/không gom vào bug report). Đây đúng là quyết định nên
   escalate cho Tech Lead thay vì Dev tự quyết vĩnh viễn — đã ghi Medium ở trên, không đủ
   nghiêm trọng để REQUEST_CHANGES vì hành vi nghiệp vụ (drop unknown key) vẫn đúng.

2. **Tên tham số `preset` vs `format`** — Đã tự trace code (không tin lời Dev): tương đương
   thật. Xem Low ở trên.

3. **Golden fixture T9 viết tay theo shape, không phải capture thật** — Đã tự đọc file fixture
   và xác nhận đúng như Dev khai báo: `raw` là JSON tự soạn, không phải bytes thật. **Đây là
   Critical, REQUEST_CHANGES, không tính vòng lặp Protocol 3** — xem Critical #1. Đánh giá:
   không thể "chấp nhận có điều kiện" bằng cách merge trước rồi vá sau, vì Protocol 5.3 nói rõ
   vi phạm này Reviewer reject ngay; nhưng khác T7/T8, task T9 đã bị CHANGELOG mô tả kiểu dễ
   gây hiểu lầm là "hoàn thành" — cần sửa CHANGELOG để phản ánh đúng trạng thái NOT CLOSED của
   T9 trước khi coi đây là "nợ kỹ thuật tạm thời có thể merge".

4. **BR-15 "cảnh báo mạnh hơn nếu sửa tay" — claim "không có UI sửa summary"** — Đã tự verify
   trong `js/app.js`/`index.html`: chỉ có `js/app.js:1283`
   (`<div class="transcript-text" contenteditable="true">`) cho tab Transcript; không tìm thấy
   `contenteditable`, `textarea`, hay bất kỳ control edit nào gắn với tab Summary. Claim đúng.
   Việc Dev triển khai 1 modal xác nhận chung (bỏ qua nhánh "đã sửa tay") là hợp lý cho v1 vì
   không có tín hiệu nào để phát hiện "đã sửa tay" — tự chế 1 flag mới trong data model là đi
   ngược nguyên tắc "không tự quyết đổi data model" mà chính Architecture.md nhấn mạnh (giống
   tinh thần E3). Dev đã escalate đúng cách (flag lại cho Tech Lead thay vì âm thầm bỏ qua) —
   chấp nhận được, không cần REQUEST_CHANGES cho điểm này.

5. **Đổi port test 8799 → 8797** — Đã tự verify bằng cách đọc cả 2 file
   (`test/http.test.js:13` dùng `PORT = 8799`, `test/presets.test.js:145` dùng
   `PORT = 8797`) và tự chạy `npm test` — 48/48 pass, không có `ECONNREFUSED`/`ECONNRESET`.
   Xác nhận đây là bug thật (2 test file cùng chiếm 1 port khi chạy chung qua
   `node --test test/*.test.js`), không phải Dev che giấu vấn đề khác.

## Checklist theo persona

**Correctness** — Đạt. Đã trace toàn bộ luồng S1→S7 trong `server.js:1152-1196`: preset đọc
từ `presets.json` ngay đầu request (S1), `snapshotOf(preset)` chụp **trước khi** gọi
`llm.generateSummary` (có thể chạy vài phút với map-reduce) → khớp đúng WHY-4/BR-16
("snapshot do server trả về, không do client tự chụp"). `PRESET_NOT_FOUND` trả 400 đúng BR-19,
không fallback ngầm.

**Security** — Đạt, đã tự đọc code xác nhận (không tin lời Dev):
- `requestHandler` (`server.js:1474-1487`) chặn **mọi** path `/api/*` bằng
  `hasTrustedHost(request) && isTrustedApiRequest(request)` trước khi gọi `handleApi`, và
  route `/api/summary-presets*` được dispatch **bên trong** `handleApi` (`server.js:1147-1148`
  gọi `handlePresetsRoute`) — nghĩa là route preset không có đường nào bỏ qua trust gate.
  Test `POST /api/summary-presets is rejected for a cross-site Origin` tự chạy PASS.
- `:id` chỉ dùng làm khóa tra mảng JSON (`presets.find(item => item.id === presetId)`), không
  ghép vào filesystem path — đúng yêu cầu baseline "ID dùng làm tên file phải hash trước".
  Route preset không tạo file theo ID client gửi nên không áp dụng, nhưng không vi phạm.
- API key: không phần nào trong diff đọc/ghi API key qua đường khác ngoài Keychain đã có sẵn
  — feature này không chạm luồng key.
- Không có `child_process.spawn` mới trong diff review được.

**Process gate** — REQUEST_CHANGES do T9 (Critical #1). T7/T8 tự Dev đã đúng quy trình: code
xong nhưng gắn nhãn "CODE COMPLETE, NOT CLOSED" theo Protocol 5.4, ghi backlog rõ ràng trong
`project_state.json`, không đóng task khi `[UNVERIFIED-LIVE]` — đây là hành xử đúng, không bị
tính là vi phạm.

**Data lineage (Protocol 6)** — Đạt. Tự trace: `buildSectionsBlock(preset)` (`prompts.js:53`)
được gọi trong cả 3 builder (`buildSummaryPrompt:78-79`, `buildChunkPrompt:135-136`,
`buildSynthesisPrompt:167-168`) — xác nhận bằng grep trực tiếp, không tin lời kể. Test
"a preset applies to buildSummaryPrompt, buildChunkPrompt and buildSynthesisPrompt alike" chạy
PASS. Đây là lỗi Architecture.md cảnh báo dễ sót nhất — đã verify không sót.

**Performance (Protocol 8)** — Đạt. `CHUNK_SCAFFOLD_BASE_TOKENS = 2000` cộng động
`estimateTokens(format.sectionsBlock)` tại `server/llm/index.js:133`, đúng khớp bảng audit
Protocol 8 trong Architecture.md §5.3 (bước duy nhất bị đánh dấu SỬA, các bước còn lại GIỮ
nguyên đúng như audit).

**Code Quality** — Tốt. `preset-schema.js` các hàm ngắn, mỗi hàm 1 trách nhiệm rõ
(`sectionKeyFor`, `jsonSchemaPropertyFor`, `geminiPropertyFor`, `coerceSectionValue`,
`buildNormalizer`). Không thấy code trùng lặp rõ rệt giữa 3 dialect converter — mỗi cái có lý
do khác biệt hợp lý (Codex lowercase type, Gemini uppercase + propertyOrdering).

**Conventions** — Đạt. CommonJS đúng baseline project, không dùng TypeScript/framework, comment
chỉ giải thích WHY (vd dòng 28-29, 164-167, 180-183 trong `preset-schema.js` đều là WHY, không
phải WHAT). Tiếng Việt dùng cho message lỗi user-facing, tiếng Anh cho code/comment — đúng quy
ước.

## Positive Notes
- Snapshot lineage (BR-16/WHY-4) triển khai chính xác tinh vi: chụp preset **trước** khi gọi
  LLM chứ không phải sau, nên nếu user sửa preset giữa lúc job map-reduce đang chạy vài phút,
  snapshot trả về vẫn khớp đúng cái đã thực sự gửi cho model — đây là chi tiết dễ làm sai và
  Dev đã làm đúng.
- Trust gate cho route mới không có bất kỳ đường tắt nào — route preset nằm hoàn toàn trong
  `handleApi`, không tự mở listener/route riêng bên ngoài `requestHandler`.
- `GENERAL_SECTIONS` được định nghĩa 1 chỗ (`preset-schema.js`) và built-in preset +
  BR-20 virtual snapshot đều tái dùng cùng hằng số thay vì duplicate — đúng tinh thần WHY-1
  ("chi phí migrate bằng 0 bằng construction, không bằng convention").
- Cách Dev báo cáo minh bạch cả 5 điểm sai lệch (kể cả điểm bất lợi như gap Protocol 5.3) thay
  vì giấu, giúp review nhanh và chính xác hơn nhiều so với việc Reviewer phải tự đào ra.
- Test suite T17 không chỉ test happy path — có test CSRF cross-origin cho route mới, test
  "omitting preset keeps legacy prompt text byte-for-byte" (bảo vệ đường tương thích ngược),
  và test thứ tự key trong output normalize luôn theo `sections[]` bất kể thứ tự key trong raw
  JSON.

## Re-verify — 2026-09-18 (sau fix T9)

## Verdict: APPROVE

Điểm Critical duy nhất chặn lần trước (`tests/fixtures/deepseek/dynamic-sections.json` là mock
viết tay, vi phạm Protocol 5.3) đã được đóng đúng cách. Không tìm thấy vấn đề Critical/High mới.
Không review lại 17 task còn lại (đã APPROVE ngầm ở report trước).

### 1. Fixture `tests/fixtures/deepseek/dynamic-sections.json` — đã đọc trực tiếp
- `_source`: khai báo là HTTP 200 thật từ `POST /api/summary` (server MeetNote thật,
  provider=deepseek, model=deepseek-chat, preset 3 section context/risks/followUps), captured
  `2026-09-17T21:11:43.888Z` bởi PM.
- `preset.sections` khớp key/label/type/hint của preset 3-section mô tả trong CHANGELOG — không
  còn placeholder label kiểu cũ.
- `raw`/`expected`: nội dung cụ thể, có tên riêng (Alex, Jamie), ngày cụ thể (Friday, September
  25th), không còn dấu hiệu văn bản mẫu chung chung như bản cũ ("Client wants a pilot rollout in
  Q4..."). Nội dung có tính đặc thù (staging chưa load-test, rollback plan) khớp với 1 tình huống
  cụ thể hơn là văn bản generic Dev có thể tự bịa nhanh.
- `_rawDerivation` (mới, không có ở bản cũ): giải thích rõ vì sao `raw` không phải byte HTTP
  nguyên văn — `POST /api/summary` trả về object đã normalize (`{context, risks, followUps}`),
  không expose text thô của provider (text thô chỉ tồn tại tạm thời trong
  `server/llm/providers/deepseek.js`). Đã tự đọc `server/llm/providers/deepseek.js:79` xác nhận
  `response_format: { type: 'json_object' }` — đúng như derivation mô tả, nghĩa là với DeepSeek ở
  chế độ này, response text về bản chất chính là JSON object không có wrapper, nên
  `JSON.stringify` của giá trị đã capture là tái tạo trung thực về nội dung (dù không đảm bảo
  byte-for-byte whitespace/key-order như response HTTP gốc). Suy luận này hợp lý và có nguồn
  (đọc code thật, không suy đoán).
- **Khác biệt về mức độ chặt của "golden file" so với tinh thần Protocol 5.3 gốc**: đây vẫn không
  phải là capture HTTP thô 100% (không có file log/HAR nào lưu request/response gốc trong repo —
  đã `find` không thấy). Việc "capture thật đã xảy ra" hiện dựa vào lời khai của PM (nội dung cụ
  thể, `_rawDerivation` có lý, và thời điểm capture khớp mốc thời gian giữa 2 lần sửa — xem mục
  3) chứ Reviewer không có cách nào độc lập replay lại request đó. Đây là giới hạn thực tế của
  review (Reviewer không có DeepSeek key trong phiên này để tự gọi lại), không phải lỗi của Dev/
  PM. Khuyến nghị (không chặn merge): lưu kèm 1 file log request/response gốc (đã redact key)
  cạnh fixture trong lần capture tiếp theo để tăng khả năng audit độc lập về sau.
- Kết luận: đây là cải thiện chất lượng rõ rệt so với bản cũ — nội dung bắt nguồn từ dữ liệu thật
  đã capture qua đúng luồng sản phẩm (không phải Dev tự soạn theo shape), có lý giải kỹ thuật
  đúng cho phần suy luận (`raw` reconstruction), và tự khai báo giới hạn thay vì che giấu. Đủ để
  đóng T9 theo tinh thần Protocol 5.3/5.4.

### 2. `npm test`
Đã tự chạy `node --test test/*.test.js`: **48/48 pass, 0 fail, 0 skip**, bao gồm
`DeepSeek dynamic-sections golden fixture normalizes to the captured shape` — PASS.

### 3. Phạm vi sửa đổi — không đụng ngoài phạm vi được giao
So sánh mtime các file bằng `stat`:
- `tests/fixtures/deepseek/dynamic-sections.json` — 04:12:50
- `docs/CHANGELOG.md` — 04:13:18
- `project_state.json` — 04:13:48
- Các file nguồn khác liên quan tới feature (`server/llm/providers/deepseek.js`,
  `server/llm/preset-schema.js`, `js/app.js`, ...) đều có mtime **trước** 04:10 (thời điểm
  report REQUEST_CHANGES trước được ghi lúc 04:10:46) — tức không bị chạm lại trong vòng fix
  này. `git status`/`git diff --stat` cho thấy cùng danh sách file đã sửa như trạng thái ban đầu
  của phiên (không có file mới nào xuất hiện ngoài fixture/CHANGELOG/project_state.json, cả 3 đều
  vốn đã untracked từ trước feature này). Xác nhận: Dev/PM chỉ sửa đúng fixture T9 +
  CHANGELOG + project_state.json, không lan sang code khác.

### 4. Ghi nhận quyết định `console.warn` (Medium, không chặn merge)
Đã đọc `docs/CHANGELOG.md` mục "Medium issue — `console.warn` vs `logEvent`...": PM đã ghi rõ
ràng, không lờ đi — xác nhận lại lý do kỹ thuật (circular require) đã được Reviewer verify độc
lập ở report trước, chấp nhận giữ `console.warn`, và note rõ điều kiện để revisit sau này ("chỉ
xem lại nếu có task cần query `summary.unknown_key` sau khi restart process"). Đúng yêu cầu
"quyết định phải traceable, không âm thầm đứng yên" từ report trước — không có gì bị bỏ sót.

## External contract verification
YES (nguồn: đọc trực tiếp `tests/fixtures/deepseek/dynamic-sections.json`,
`server/llm/providers/deepseek.js`, tự chạy `npm test`). Về việc capture HTTP thật có thực sự
xảy ra: dựa một phần vào khai báo của PM (nội dung cụ thể + `_rawDerivation` hợp lý kỹ thuật +
mốc thời gian nhất quán) do Reviewer không có DeepSeek key để tự replay trong phiên này — xem
khuyến nghị lưu log capture ở mục 1.

## Positive Notes (bổ sung)
- PM không chỉ thay nội dung fixture mà còn thêm `_rawDerivation` — biến 1 chỗ "khó verify" (vì
  sao `raw` không phải byte gốc) thành minh bạch, tự giải thích, có thể đọc lại bất cứ lúc nào mà
  không cần cross-reference CHANGELOG.
- CHANGELOG round 2 dẫn lại đúng issue Critical #1 gốc, không viết lại lịch sử — dễ trace
  "trước sửa gì, sau sửa gì".
- Phạm vi sửa cực kỳ gọn: chỉ 3 file (fixture, CHANGELOG, project_state.json), không tranh thủ
  sửa thêm chỗ khác — giảm rủi ro regression ngoài ý muốn khi đang trong vòng fix 1 issue cụ thể.

---

# Review Report — 2026-09-18 (Part 2)

## Feature: Pre-meeting Context, Notes-aware Summary, Export & Tags
(`docs/Architecture.md` v2.0, §11 Task Breakdown T1→T16; `docs/PRD.md` v2.0 BR-23→BR-76)

## Verdict: APPROVE

`npm test` được tự chạy lại độc lập (không tin số Dev báo): **115/115 passing**, khớp báo cáo
CHANGELOG (70 cũ + 45 mới, Part A T1-T8 + Part B T9-T16). Đã đọc trực tiếp code (không chỉ đọc
CHANGELOG) cho toàn bộ 8 điểm rủi ro cao được giao trong brief. Không phát hiện Critical/High.
Có vài Medium/Low đáng ghi nhận để cải thiện, không chặn merge.

## Issues Found

### Critical
(none)

### High
(none)

### Medium
- [ ] `js/export.js:16-90` `toMarkdown` — nội dung ghép trực tiếp `meeting.title`,
  `meeting.notes`, tag, transcript... vào chuỗi Markdown mà không escape ký tự Markdown đặc
  biệt (`#`, `*`, `` ` ``, `[...]`, v.v.). Không phải lỗ hổng bảo mật (đây là file .md người
  dùng tự đọc/mở bằng editor, không phải HTML render), nhưng 1 tiêu đề cuộc họp chứa `# ` hoặc
  1 dòng notes bắt đầu bằng `- ` có thể làm hỏng cấu trúc heading/list của file export. → Gợi ý:
  không bắt buộc sửa ngay, nhưng nên có 1 test case ghi nhận hành vi hiện tại (ví dụ title chứa
  `#` → xem file export ra sao) để không bị coi là bug "mới phát hiện" ở version sau.
- [ ] `docs/CHANGELOG.md` Part B, mục "Decisions made without an explicit Architecture answer"
  — mục `GET /api/export-settings` `status` field (`'configured'|'not_configured'`) là quyết
  định tự ý hợp lý (đã tự flag đúng tinh thần Protocol 1 "gắn nhãn khi chưa verify/chưa có
  hướng dẫn rõ"), nhưng chưa thấy PM/Tech Lead xác nhận lại trong `project_state.json` hay
  CHANGELOG round tiếp theo. → Gợi ý: PM đọc và xác nhận (hoặc yêu cầu đổi) trong lần tổng kết
  phase kế tiếp, không cần action ngay từ Reviewer.

### Low
- [ ] `server/export/filename.js:55-57` `applyReservedNameGuard` — Dev tự nhận (đúng, đã kiểm
  chứng lại) rằng vì `buildFileName` luôn prepend `yymmdd-`, một collision "trần" với
  `CON`/`PRN`/... gần như không thể xảy ra trong thực tế (chỉ xảy ra nếu `yymmdd` rỗng bằng
  cách nào đó, không có đường nào dẫn tới việc đó qua `buildFileName`). Test hiện tại
  (`applyReservedNameGuard('CON') === 'CON_'`) chỉ chứng minh hàm con đúng, không chứng minh
  `buildFileName` không bao giờ cho ra tên trùng reserved name trong thực tế (nhưng đúng như
  Architecture §5.4 đặc tả — bản thân đặc tả có góc khuất này, không phải lỗi Dev). Ghi nhận,
  không cần sửa.

## External contract verification
N/A cho phần lớn — feature này chủ yếu dùng `fs/promises`/`child_process` built-in đã verify
thật trong Architecture.md §7 (đọc lại, xác nhận đúng: rename ghi đè im lặng, `open('wx')`
atomic, `spawn shell:false` an toàn với path chứa `;`/`$()`, `access()` không đủ làm write
probe — tất cả đều có bằng chứng chạy thật trong Architecture.md, không suy đoán).

Riêng nhánh Windows (U1: OneDrive atomic write, U2: `explorer.exe` qua `spawn shell:false`) —
**đã xác nhận đúng là còn `[UNVERIFIED]` và bị chặn implement đúng theo Protocol 5.2**: đọc
trực tiếp `server.js:1118-1121` xác nhận `process.platform !== 'darwin'` trả `501
OPEN_FOLDER_UNSUPPORTED` **trước khi** chạm `child_process` — không có đường vòng nào âm thầm
thử chạy lệnh Windows. Đây không phải vi phạm Protocol 5 — đây chính là cổng chặn hoạt động
đúng như thiết kế.

## Chi tiết verify theo 8 điểm rủi ro cao trong brief

1. **Bảo mật export (quan trọng nhất)** — PASS, đọc code trực tiếp xác nhận:
   - Không route export nào đọc path từ request. `js/exporter.js` chỉ gửi `meetingId`+
     `content` (BR-41 đã sửa); mọi route server tự đọc `storage/export-settings.json`
     (`server.js:1006-1131`).
   - `PUT /api/export-settings` validate đầy đủ 8 bước BR-42/43 qua `validateExportDir`
     (`server/export/dir.js:91-153`): required/`\0`/length/absolute (`~` expand)/inside-app/
     too-broad/exists-or-create-1-level/write-probe thật (`open(...,'wx')` + `rm`, không dùng
     `access()`).
   - Tên file: `slugTopic` chỉ giữ `[A-Za-z0-9-]` sau khi strip diacritics
     (`server/export/filename.js:34-44`) — không thể chứa `/`, `..`, `\0`. `meetingId` chỉ
     dùng `Array.find` tra cứu (`server.js:1064`), không ghép vào path. Đúng như WHY-4 mô tả
     — 2 lớp bù (slug an toàn + dir đã validate) thay cho hash SHA-256, có lý do chính đáng
     (file người đọc, không phải file máy đọc).
   - `POST /api/export/open-folder`: `shell:false`, arg riêng (`server.js:1124`), nhánh
     `win32`/khác `darwin` trả `501` **trước khi** gọi `spawn` — đúng cổng chặn Protocol 5.2.
   - Toàn bộ 4 route export nằm dưới dispatch chung `hasTrustedHost`+`isTrustedApiRequest`
     tại `requestHandler` (`server.js:1677-1684`) — không có đường vòng riêng.

2. **Protocol 6 lineage (notes/pre-meeting → 3 builder)** — PASS, trace tay xác nhận đủ 8 bước
   G1→G8 (`js/summary.js:37-40` → `server.js:790-818` giữ 4 field thay vì cắt bỏ →
   `server/llm/index.js:137` gọi `buildContextBlock` đúng 1 lần → truyền `context` xuống mọi
   builder → `contextUsed` cùng object). `test/context-prompt.test.js` có bài test lineage
   thật assert **giá trị cụ thể** (chuỗi notes đã cắt, `Meeting type: Sales call`) xuất hiện
   trong từng request `fetch` thực sự gửi đi qua map-reduce thật (không mock builder, chỉ mock
   `global.fetch`) — đúng tinh thần Protocol 6.2, không phải kiểu `assert_called()`.

3. **BR-16→20 snapshot không vỡ** — PASS. `GENERAL_SECTIONS`/`Summary.GENERAL_SECTIONS` (5 key
   tiếng Anh, snapshot ảo legacy) giữ nguyên, không đụng. Preset seed "General Meeting" mới có
   7 section tiếng Việt, khai riêng trong `BUILT_IN_PRESETS`, không dùng lại
   `GENERAL_SECTIONS`. Có test hồi quy riêng (`test/presets.test.js` "§9.3 trap") xác nhận 2
   bộ key khác nhau.

4. **BR-65 instruction không lẫn BLOCK DÙNG CHUNG** — PASS. Đối chiếu trực tiếp
   `docs/preset-templates.md` (nguồn xác thực) với `server/llm/prompts.js`
   `SUMMARY_PRINCIPLES`/`CHUNK_PRINCIPLES`: khớp nguyên văn. `server/llm/presets.js` 10
   preset chỉ chứa block "Hướng dẫn cho AI" riêng; có test regex xác nhận không preset nào
   chứa "NGUYÊN TẮC BẮT BUỘC".

5. **Atomic write không ghi đè** — PASS. `writeExportFile` (`server/export/dir.js:178-222`)
   đúng thứ tự `open(target,'wx')` đặt chỗ → tăng attempt khi `EEXIST` → `writeFile` tmp cùng
   thư mục → `rename` → dọn cả tmp lẫn target khi lỗi. Không phải chỉ check `existsSync`.

6. **Filename** — kiểm tra tay 2 case biên: thiếu `topic`+`title` → fallback `hop`; thiếu
   `meetingType` → bỏ hẳn segment abbr, không có `-` thừa (`.filter(Boolean)` trước `.join('-')`
   — đúng). `CON` → `CON_` qua `applyReservedNameGuard` (xem Low #1 ở trên về giới hạn thực tế
   của check này).

7. **Tag dedupe + escape** — PASS. `js/tags.js` `normalizeTagList` dedupe theo
   `toLowerCase()`, giữ bản viết hoa/thường đầu tiên (đã có test riêng). Mọi nơi render tag ra
   DOM (`_renderTagChips`, `_tagFilterBarHtml`, `_renderMeetingsByTag` trong `js/app.js`) đều
   qua `Utils.escapeHtml`; phần style chỉ nội suy số từ `tagHue`, không nội suy chuỗi tag —
   đúng yêu cầu chống XSS qua tag tự do.

8. **WHY-8 đổi kiến trúc filter thư viện** — Rủi ro regression cao nhất đã đọc kỹ: `_visibleMeetings`
   giữ đúng ngữ nghĩa cũ (chỉ khớp `title`, không đổi hành vi search-bar hiện có), AND giữa
   text/tag, OR giữa các tag đúng BR-72. Selection + bulk-delete được tách riêng
   `_bindMeetingSelectionHandlers()`, gọi lại sau mỗi `_refreshMeetingsList()`; `_selectedMeetingIds`
   lọc lại theo `selectableIds` chứ không reset — đúng lo ngại "chọn 2 → đổi filter tag → xóa"
   trong Architecture §10.3. Không phát hiện regression.

## Positive Notes
- Tài liệu hoá cực kỳ kỷ luật: mọi quyết định tự ý của Dev khi Architecture chưa nói rõ (BR-29
  staleness signal, `status` field, tag-editor-không-chờ-Save, nút Mở-thư-mục-reactive) đều
  được flag tường minh trong CHANGELOG với lý do — đúng tinh thần Protocol 1 mở rộng, giúp
  Reviewer không phải đoán "đây có phải bug không".
- Test lineage T6 (`test/context-prompt.test.js`) là ví dụ tốt cho Protocol 6: stub đúng 1 điểm
  biên ngoài cùng (`global.fetch`), chạy pipeline thật, assert giá trị cụ thể qua từng hop —
  không phải kiểu test mock từng bước rồi chỉ assert "đã gọi".
- Cổng chặn Protocol 5.2 (Windows `open-folder`) triển khai đúng tinh thần "deny-by-default":
  check platform xảy ra trước khi chạm `child_process`, không phải try-catch bọc quanh lỗi.
- `server/export/dir.js`/`filename.js` là pure/isolated-IO module, dễ test độc lập với thư mục
  tạm thật (không mock `fs`) — đúng yêu cầu Protocol 5.4 "smoke test gọi thật, không mock viết
  tay".
- 2 Dev tuần tự không đụng file nhau (Part A/Part B tách rõ theo Task Breakdown), không có dấu
  hiệu xung đột hay merge ẩu.

---

# Review — Fix: stale meeting snapshot in Generate Summary (js/app.js)

## Verdict: APPROVE

Fix 1 dòng đúng và đủ cho bug đã báo cáo (notes sửa xong, Save Notes, Generate Summary vẫn dùng
notes cũ → BR-63 không áp dụng). Đã tự đọc code xung quanh `_bindMeetingDetail`
(`js/app.js:2099-2362`), trace nguồn gốc bug, chạy `npm test` (174/174 pass), và rà soát toàn bộ
closure `meeting` còn lại trong hàm này cho các side-effect quan trọng khác. Không có Critical/
High mới.

## Xác nhận nguyên nhân + fix

- `_bindMeetingDetail(meetingId)` fetch `const meeting = Storage.getMeeting(meetingId)` một lần
  khi mở trang (`js/app.js:2100`). `Storage.getMeeting` (`js/storage.js:172-179`) trả về **shallow
  clone** (`{...meeting}`) mỗi lần gọi — object top-level mới, nhưng field mảng/object lồng nhau
  (`transcript`, `participants`, `tags`...) vẫn **share cùng reference** với bản lưu trong
  `this._meetings` (vì `{...x}` không deep-clone).
- Handler "Save Notes" (`js/app.js:2265-2272`) tự fetch fresh `m` và gán `m.notes = <giá trị mới>`
  — đây là gán primitive (string) lên field top-level của clone `m`, **không phải** mutate 1 object
  lồng nhau dùng chung reference → biến `meeting` ở scope ngoài (`_bindMeetingDetail`) hoàn toàn
  không thấy thay đổi này. Đây chính xác là root cause.
- Handler "Generate Summary" (`js/app.js:2156-2173`) đã tự fetch `before = Storage.getMeeting(...)`
  ngay đầu — đúng, có notes mới — nhưng dòng gọi thật `Summary.generate(meeting, ...)` lại dùng
  biến `meeting` cũ (bug). Fix đổi `meeting` → `before` tại đúng dòng đó
  (`js/app.js:2173`) — khớp 100% với mô tả bug, không có tác dụng phụ.

## Kiểm tra `before` có bị dùng conflict không

Không. `before` chỉ dùng 2 chỗ trong cùng handler: (1) `if (before?.summary)` để quyết định có
hiện confirm dialog "Tạo lại bản tóm tắt?" hay không (`js/app.js:2158`), (2) làm input cho
`Summary.generate` sau fix. Cả hai đều nhất quán — `before` đại diện đúng "trạng thái meeting tại
thời điểm bấm Generate", dùng cho cả check và cho payload gửi đi là hợp lý, không có xung đột.

Có 1 điểm biên đáng ghi nhận (không chặn merge): `before` được fetch **trước** dòng
`await this._confirmRegenerateSummary()` (dòng 2159). Nếu user có thể tương tác với textarea Notes
trong lúc modal confirm đang mở (tuỳ CSS overlay có chặn pointer-events nền hay không — chưa tự
verify CSS modal), `before` có thể lỗi thời tại thời điểm gọi `Summary.generate`. Đây là pattern đã
tồn tại từ trước ở việc dùng `showModal`/`await` khắp app (không phải do fix này gây ra), rủi ro
thấp vì modal overlay theo quy ước app thường chặn tương tác nền. Gợi ý (Low, không chặn merge):
fetch lại `Storage.getMeeting(meetingId)` ngay sau khi `confirmed === true` thay vì tái dùng
`before` đã fetch trước dialog, để loại hẳn khả năng này thay vì dựa vào giả định CSS overlay.

## Rà soát closure `meeting` còn lại trong `_bindMeetingDetail` (theo yêu cầu mục 3)

Đã audit từng chỗ đọc `meeting.notes`/`participants`/`transcript`/`title`/`meetingType` trong toàn
bộ `js/app.js` (grep + đọc trực tiếp), không chỉ trong phạm vi `_bindMeetingDetail`:

- **`copy-transcript` handler (`js/app.js:2131-2134`)** gọi `Export.copyTranscript(meeting)` dùng
  closure `meeting` cũ. Ban đầu nghi ngờ đây là cùng loại bug (nếu user sửa transcript inline rồi
  copy mà không reload). Đã tự trace kỹ: handler inline-edit transcript (`js/app.js:2119-2128`)
  mutate `m.transcript[idx].text = ...` — đây là **mutate property của object phần tử trong mảng
  dùng chung reference**, không phải gán lại `m.transcript = [...]`. Vì `transcript` là mảng chia
  sẻ reference giữa mọi clone (do shallow clone), mutation này phản ánh ngay cả trên `meeting`
  đóng ở scope ngoài. Đã verify bằng cách đọc `getAllMeetings()`/`getMeeting()`
  (`js/storage.js:172-179`) xác nhận không có `structuredClone`/deep copy. **Kết luận: không phải
  bug** — nhưng đây là hành vi đúng "nhờ may mắn" vào chi tiết implement (shallow clone + mutate
  in-place) chứ không phải thiết kế tường minh, nên xếp Low để lưu ý — nếu sau này ai đổi
  `getAllMeetings()` sang deep-clone (`structuredClone`) để tránh chính loại bug này ở chỗ khác,
  `copy-transcript` sẽ âm thầm bị stale.
- **`_bindPreMeetingInfo` (`meetingType`/`topic`/`leadBy`), `_bindTagEditor` (`tags`),
  `_autoAddMeetingTypeTag` (`tags`)** — đều tự `Storage.getMeeting(meetingId)` fresh ngay trong
  chính handler, không dùng closure `meeting` của `_bindMeetingDetail`. Không dính bug.
- **`_openExportModal`/`_runExport`/`_openMeetingTitleEditor`/`_suggestMeetingTitle`** — mỗi hàm
  tự fetch `Storage.getMeeting(meetingId)` riêng ở đầu hàm, không phụ thuộc closure `meeting` từ
  `_bindMeetingDetail`. Không dính bug. `_openMeetingTitleEditor` sau khi save còn
  `this.navigate(route, {force:true})` re-render toàn view (kéo theo chạy lại `_bindMeetingDetail`
  với `meeting` mới), nên rename tiêu đề không để lại closure cũ nào sống sót.
- **Delete confirm dialog (`js/app.js:2286`, `2293`)** dùng closure `meeting.title` (chỉ hiển thị
  text) và `meeting` cho `_audioIdsForMeeting(meeting)` — cả hai đều là dữ liệu không đổi trong
  phiên xem trang (audioId gắn cố định với recording, không có luồng nào sửa audioId tại chỗ này).
  Không dính bug.

Không tìm thấy chỗ nào khác cùng loại bug (fetch fresh xong nhưng lại dùng nhầm biến cũ) trong
phạm vi được giao.

## `npm test`

Chạy `node --test test/*.test.js`: **174/174 pass, 0 fail**. Không có test frontend nào cho
`js/app.js` (đúng như kỳ vọng — codebase không có jsdom/browser test harness, `_bindMeetingDetail`
không nằm trong phạm vi test hiện tại), nên thay đổi này không thể có test tự động xác nhận trực
tiếp — đã verify bằng đọc code + trace tay thay thế. Ghi nhận (Low, không chặn merge): đây là toàn
bộ lớp bug (closure fetch-once vs fetch-fresh) hiện không có bất kỳ test nào bảo vệ khỏi tái phát ở
chỗ khác trong tương lai.

## Đánh giá mức độ nghiêm trọng bug gốc

Nghiêm trọng thật — không phải chỉ ảnh hưởng hiển thị. Đã đọc `js/summary.js:20-48`
(`Summary._payload`) xác nhận `meeting.notes` được gửi **trực tiếp, nguyên văn** trong payload tới
`/api/summary` (comment tại chỗ: "notes/pre-meeting info... reached the prompt"), tức đây chính là
kênh duy nhất để BR-63 (notes ghi đè transcript khi nghe nhầm) và các suy luận phụ thuộc ngữ cảnh
(gợi ý tên người nói thay "Speaker 1/2", theo mô tả case của user) hoạt động. Trước fix: bất kỳ lúc
nào user sửa Notes/pre-meeting rồi bấm Generate **ngay trong cùng phiên xem trang** (không
F5/reload) — không riêng trường hợp "nghe nhầm tên món ăn" mà user báo — hệ thống lặng lẽ gửi bản
notes **cũ hơn 1 bước** lên server, không có lỗi/cảnh báo nào hiển thị (silent staleness, đúng
tinh thần rủi ro Protocol 6 dù đây là stale trong client, không phải giữa 2 bước server). Đây là
đúng loại lỗi "chạy đúng khi test riêng từng phần (Save Notes lưu đúng, Generate Summary gửi đúng
format) nhưng sai khi nối 2 luồng lại trong 1 phiên UI".

## External contract verification
N/A — đây là bug data-flow phía client (biến JS trỏ nhầm), không liên quan tool/API bên thứ 3.

## Positive Notes
- Fix tối thiểu, đúng vị trí, không mở rộng phạm vi ngoài dòng bug — giảm rủi ro regression.
- `Storage.getMeeting` trả clone (không phải reference sống) là quyết định phòng thủ tốt nói
  chung (tránh mutate ngầm storage khi chỉ đọc để hiển thị); bug này không phải do bản thân quyết
  định "trả clone" mà do 1 chỗ quên re-sync biến local sau khi biết trước storage đã đổi.
- Handler `Generate Summary` đã tự đúng thói quen "fetch fresh trước khi dùng" (biến `before`) —
  chỉ sai ở bước cuối cùng dùng nhầm tên biến; các handler khác trong cùng file
  (`_bindPreMeetingInfo`, `_bindTagEditor`, `_openExportModal`...) đều theo đúng pattern này, cho
  thấy đây là lỗi cục bộ 1 dòng, không phải lỗ hổng hệ thống trong cách viết code của Dev.

# Review — Thử nghiệm hạ bitrate ghi âm xuống 32kbps (js/recorder.js)

## Verdict: APPROVE

## Phạm vi
Diff duy nhất trong `startRecording()` (`js/recorder.js:139-154`): thêm `audioBitsPerSecond: 32000`
vào `MediaRecorderOptions`, giữ `mimeType` cũ khi có. Không đụng tới feature
`import-phone-recording` đang chạy song song (đã kiểm tra không có overlap file/hàm).

## Correctness & code review
- `js/recorder.js:106-112` xác nhận `recordingStream` (dù là mic-only hay stream mix qua
  `AudioContext.createMediaStreamDestination()`) chỉ có audio track — không track video nào được
  add vào graph. `audioBitsPerSecond` do đó là field duy nhất cần set, đúng như diff làm; không có
  video track nào bị ảnh hưởng bởi field `videoBitsPerSecond` (không dùng).
- **Nhánh `supportedMimeType === undefined`** (khi trình duyệt không hỗ trợ cả 3 mime type liệt
  kê): code mới luôn tạo `new MediaRecorder(recordingStream, { audioBitsPerSecond: 32000 })` —
  không gán `mimeType`. Đã verify qua MDN (`MediaRecorder` constructor, fetch trực tiếp lúc review,
  2026-09-18): `mimeType`, `audioBitsPerSecond`, `videoBitsPerSecond`, `bitsPerSecond` đều là field
  **độc lập, optional**, không phụ thuộc lẫn nhau — `mimeType` mặc định là chuỗi rỗng (browser tự
  chọn codec mặc định) khi không truyền. Do đó truyền `audioBitsPerSecond` mà thiếu `mimeType`
  **không throw** — hành vi tương đương "dùng options object thiếu 1 field optional", không phải
  trường hợp đặc biệt cần `[UNVERIFIED]`. Việc gắn `mimeType` có điều kiện (`if (supportedMimeType)
  recorderOptions.mimeType = ...`) là đúng, giữ nguyên logic fallback của code cũ.
- Comment `[CHƯA VERIFY — Protocol 5]` trong code đặt đúng chỗ, đúng nội dung: field đang gắn nhãn
  chưa verify (ảnh hưởng chất lượng transcript qua 4 STT provider ở 32kbps) đúng là phần duy nhất
  còn là suy luận/giả định (dựa trên hiểu biết chung về VoIP/Opus), không phải phần đã verify được
  qua code (routing option) hay qua spec (tính hợp lệ của field).

## Live transcription / streaming impact
- Đã trace `js/app.js:1110` → `Transcriber.sendAudio(chunk)` → `js/transcriber.js` (Soniox &
  Deepgram): cả 2 provider nhận **chuỗi blob nối tiếp qua cùng 1 WebSocket đang mở**
  (`socket.send(chunk)`), không phải file độc lập được decode riêng lẻ per-chunk. Soniox cấu hình
  `audio_format: 'auto'`; Deepgram không set `encoding` (auto-detect container). Cả hai kỳ vọng
  một **stream WebM/Opus liên tục** — init segment (EBML header) nằm trong chunk đầu tiên do
  `MediaRecorder.start(500)` phát ra, không phụ thuộc bitrate. Hạ `audioBitsPerSecond` chỉ đổi mật
  độ bit trong mỗi Opus frame, không đổi cấu trúc container hay tần suất phát chunk (vẫn 500ms) —
  do đó về mặt **framing/container, không có rủi ro decode-chunk-độc-lập** như prompt lo ngại. Đây
  là kết luận rút ra từ đọc source thật (`js/transcriber.js`), không phải suy đoán.
- Phần còn lại — Opus ở 32kbps có đủ giữ được các đặc trưng âm học (formant, phụ âm bật hơi, thanh
  điệu tiếng Việt) để 4 STT engine transcribe chính xác như trước hay không — **không thể verify
  bằng đọc code hay spec**, đây đúng là phạm vi Protocol 5 mà comment trong code đã tự gắn nhãn.
  Agent review không có microphone/audio input thật trong môi trường này nên không tự chạy được.

## Kiểm tra tài liệu/tài sản khác
- Grep toàn repo (`.js`, `.md`) không tìm thấy chỗ nào khác hardcode/document con số bitrate cụ thể
  (128kbps hay tương tự) — `README.md`, `HUONG-DAN-SU-DUNG.md` không đề cập chất lượng ghi âm theo
  bitrate, không có gì cần sửa theo.
- Ghi nhận thêm (không phải bug, chỉ note): `server/stt/providers/whisper.js` giới hạn upload
  cứng 25MB (giới hạn thật của OpenAI, không phải MeetNote tự đặt). Ở ~130kbps cũ, giới hạn này rơi
  vào ~26 phút ghi âm; ở 32kbps, ngưỡng tăng lên ~1h45. Đây là tác dụng phụ có lợi tình cờ của thay
  đổi này với người dùng Whisper ghi họp dài, không phải điều diff chủ đích làm.

## `npm test`
Chạy lại độc lập: `node --test test/*.test.js` → **174/174 pass, 0 fail** — khớp với số PM báo.

## External contract verification
YES (nguồn: MDN `MediaRecorder`/`MediaRecorderOptions`, fetch trực tiếp trong lúc review,
2026-09-18) cho phần "field hợp lệ, không throw khi thiếu mimeType". NO — chỉ theo hiểu biết
chung, chưa verify bằng dữ liệu thật — cho phần "chất lượng transcript của Soniox/Deepgram/
Whisper/Google ở audio 32kbps Opus", đúng như comment trong code đã tự khai báo.

## Việc cần làm thủ công trước khi coi 32kbps là mặc định production (không phải việc của Reviewer)
1. Ghi âm thật tối thiểu 2 mẫu, mỗi mẫu ≥5 phút: (a) 1 người nói rõ ràng, phòng yên tĩnh; (b) có
   nhiễu nền + ≥2 người nói chồng tiếng — đây là 2 điều kiện dễ lộ mất mát chất lượng ở bitrate
   thấp nhất.
2. Chạy qua **cả 4 provider** (Soniox, Deepgram, Whisper, Google) với cùng 2 file audio, so
   transcript sinh ra ở 32kbps với transcript ở bitrate mặc định cũ (~128kbps) trên cùng nội dung.
3. Tiêu chí đánh giá: đếm số từ sai/thiếu (đặc biệt tên riêng, số liệu, thuật ngữ chuyên ngành —
   đúng loại nội dung MeetNote quan tâm nhất theo BR-63), không chỉ nghe "có hiểu được không".
   Chênh lệch WER (word error rate) đáng kể giữa 2 bitrate ở bất kỳ provider nào → không nên đặt
   32kbps làm mặc định chung, có thể cân nhắc mức trung gian (ví dụ 48-64kbps).
4. Test riêng luồng **live transcription** (không chỉ file ghi xong): nói liên tục trong lúc
   recording đang chạy, xác nhận kết quả interim/final hiển thị trong `js/app.js` giống chất lượng
   cũ — vì đây là luồng dùng chung `MediaRecorder` với chunk 500ms, khác pipeline với file hoàn
   chỉnh upload sau khi dừng ghi.
5. Việc này KHÔNG chặn merge diff hiện tại (đúng như comment trong code đã note rõ đây là thử
   nghiệm theo yêu cầu trực tiếp của user, có nhãn `[CHƯA VERIFY]`, chưa phải đổi mặc định âm
   thầm) — nhưng chặn việc coi 32kbps là giá trị production/final cho tới khi có kết quả bước 1-4.

## Positive Notes
- Comment trong code tự gắn `[CHƯA VERIFY — Protocol 5]` đúng chỗ, đúng tinh thần: nêu rõ cái gì
  đã biết (VoIP dùng 16-32kbps) và cái gì chưa đo (tác động thật lên 4 STT provider của MeetNote) —
  không lẫn lộn 2 loại claim.
- Xử lý `mimeType` optional đúng, giữ nguyên hành vi fallback của code cũ khi trình duyệt không hỗ
  trợ mime type nào trong danh sách ưu tiên.
- Thay đổi tối thiểu, đúng phạm vi (1 field trong 1 constructor call), không đụng tới
  pause/resume/mix system-audio hay logic chunk upload — giảm rủi ro regression ở các luồng khác.

---

# Review — import-phone-recording (gộp TV1-TV16, trước khi commit/push)

## Verdict: REJECT (không tính vòng lặp Protocol 3 — 2 lý do High là scope gap giữa
Architecture.md/PRD, không phải lỗi kỹ thuật của Dev; xem "Đánh giá nguyên nhân" cuối mục High)

`npm test` tự chạy lại độc lập: **211 passing, 2 skipped, 0 failing** — khớp đúng số Dev báo cáo cả
2 đợt (batch 1: 174/174; batch 2: 211/211 + 2 skip). Đã đọc trực tiếp code cho toàn bộ 8 trọng tâm
trong brief (bảo mật, tương thích ngược, lineage Protocol 6, capability Protocol 8, 2 lệch đợt 1, 6
quyết định đợt 2, golden fixture, microcopy) — không tin số liệu/báo cáo suông của Dev ở bất kỳ mục
nào. Không phát hiện Critical. Có 2 vấn đề High là **gap giữa PRD/UX và Architecture.md** (không
phải Dev làm sai so với Architecture — Dev làm đúng 100% acceptance criteria mà Architecture.md
giao, nhưng 2 acceptance criteria của PRD/UX chưa từng được Tech Lead đưa vào bảng Task Breakdown
§V13, nên "xong" theo Architecture vẫn để lại 1 khoảng trống thật cho end user). Đây là lý do verdict
là REJECT nhưng **không tính vào quota 3 vòng Dev↔Reviewer** — đúng tinh thần Protocol 3 áp dụng
cho vi phạm quy trình/thiếu sót nằm ở tầng bàn giao Architecture chứ không phải lỗi code.

## Issues Found

### Critical
(none)

### High
- [ ] **`js/app.js`, `js/import.js` — BR-121 (sắp xếp lại sau khi đã transcribe) và Q9 (thêm
  phần vào một bản ghi ghép đã hoàn tất) không có bất kỳ đường vào UI nào**, dù cả hai đã được
  Dev triển khai và test đầy đủ ở tầng server:
  - `POST /api/meetings/:id/parts/reorder` tồn tại, có 15 test trong `test/parts-routes.test.js`
    xác nhận đúng hành vi (0 lệnh gọi provider, `summary`/`summaryPreset` không đổi) — nhưng
    grep toàn bộ `js/app.js`/`js/import.js` không có bất kỳ `fetch` nào gọi route này. Trong
    Meeting Detail, phần đã hoàn tất (`_renderMultiPartSection`) chỉ hiển thị progress card khi
    `processing` và error card cho phần `failed` — không có danh sách phần đã xong kèm kéo-thả/
    `▲▼` nào để người dùng thực sự đổi thứ tự sau khi đã có transcript.
  - `POST /api/meetings/:id/parts` hỗ trợ đăng ký thêm phần vào một meeting **đã** có
    `parts.length > 0` (đúng thiết kế Q9 — `registerParts` cộng dồn `nextOrder` từ
    `current.length`), nhưng nút "Gắn file ghi âm" ở Meeting Detail (`js/app.js:1466`) chủ ý
    **loại trừ** `caps.multiPart` (`!caps.multiPart` trong điều kiện hiển thị), và
    `Import.open({attachMeetingId})` (TV15) đi qua nhánh `_startAttach` gọi
    `/api/import-transcription` (single-part), không phải `/api/meetings/:id/parts`. Không có
    nút/đường nào khác trong toàn bộ `js/app.js` mở modal import ở chế độ "thêm phần" cho một
    meeting đã multi-part.
  - Hậu quả: 2 acceptance criteria PRD tường minh — "US-21: Sắp xếp lại thứ tự các phần **sau
    khi** đã transcribe xong..." (PRD §14) và Q9 ("Vài ngày sau anh tìm thấy file phần 3... có
    thêm phần vào bản ghi ghép đã xong") — không thể thực hiện được bởi người dùng thật qua giao
    diện, dù test API cho cả hai đều pass. Không mục nào trong CHANGELOG batch 1/batch 2 (mục
    "Known gaps"/"Decisions made without an explicit Architecture/UX answer") nhắc tới khoảng
    trống này — nghĩa là nó chưa được flag cho PM/QA biết để tránh hiểu nhầm "TV6 xong nghĩa là
    BR-121/Q9 dùng được".
  → **Gợi ý sửa**: hoặc (a) thêm UI tối thiểu — 1 khu vực trong `_renderMultiPartSection` cho
  phần trạng thái `completed` với `▲▼`/kéo-thả gọi `/parts/reorder`, và cho phép
  `Import.open({attachMeetingId})` đi qua `/api/meetings/:id/parts` khi meeting đích đã
  `caps.multiPart` — hoặc (b) nếu quyết định hoãn sang v1.1, phải ghi rõ trong
  `docs/CHANGELOG.md`/`docs/Architecture.md` rằng BR-121 (nửa sau)/Q9 "server-only, chưa có UI"
  để QA không tự ý coi US-21/Q9 là đã kiểm thử được và để không lặp lại đúng lớp lỗi "trông như
  xong nhưng thủng ruột" mà chính D8 của UX doc cảnh báo.

- [ ] **`js/import.js` — thiếu cảnh báo xác nhận khi bỏ 1 phần ra khỏi cụm ghép TRƯỚC khi bấm
  Start (MRG-18/MRG-19/IMP-27, UX §4b.3)**. Nút `✕` (`data-action="remove"`, dùng chung cho cả
  chế độ riêng lẫn chế độ ghép, `js/import.js:484` → `removeEntry()`) xoá thẳng entry khỏi mảng
  `_state.entries` và render lại — không có modal xác nhận, không có dòng "Bỏ phần này ra thì
  cuộc họp sẽ thiếu đoạn giữa (X → Y)." / nút "Vẫn bỏ phần này" như UX §4b.3 mô tả (kèm lý do rõ
  ràng: "loại lỗi im lặng mà D8 cấm"), và cũng không có gợi ý IMP-27 sau khi bỏ. Grep toàn bộ
  `js/`/`css/`/`index.html` cho "Vẫn bỏ phần này"/"thiếu đoạn giữa"/"IMP-27" chỉ ra đúng 1 kết
  quả — nút cùng tên trong `js/app.js:1706`, thuộc luồng **khác** (bỏ phần **sau khi** đã đăng ký
  và transcribe, qua `DELETE /api/meetings/:id/parts/:partId`, nơi hệ thống **có** ghi lại dấu
  vết `dropped` + gap FAI-10 vĩnh viễn trong transcript).
  Đây không phải khác biệt cosmetic: bỏ 1 phần **trước khi** đăng ký (`POST /parts` chưa từng
  chạy cho phần đó) khiến phần đó **biến mất hoàn toàn** khỏi dữ liệu — không `dropped`, không
  `missingParts`, không gap segment nào được tạo ra, vì `computeTimeline`/`buildMergedTranscript`
  chỉ nhìn thấy các phần thực sự có trong `meeting.parts[]`. Kết quả: dòng thời gian của các phần
  còn lại nối liền nhau (chỉ cách nhau đúng `gapSeconds=1`) như thể không hề có phần nào bị bỏ —
  đúng kịch bản "trông có vẻ đầy đủ nhưng thủng ruột" mà chính UX doc dùng để giải thích tại sao
  bước xác nhận này **bắt buộc** phải có, khác hẳn trường hợp bỏ sau khi đã chạy (có FAI-10 làm
  bằng chứng vĩnh viễn).
  → **Gợi ý sửa**: khi `removeEntry` được gọi ở chế độ `merged` với >1 phần còn lại (tức đang bỏ
  1 phần khỏi 1 cụm, không phải bỏ file cuối cùng), chèn bước xác nhận đúng MRG-18/19 (tính
  khoảng trống bằng `Parts.gapWarningSeconds`/`lastModified` sẵn có của 2 phần liền kề, hiển thị
  dạng giờ ước lượng), và hiện IMP-27 sau khi xác nhận. Nếu quyết định KHÔNG làm ở v1 (ví dụ vì
  entries chưa có audio thật trên server nên "khoảng trống" chỉ là ước lượng thô), phải ghi quyết
  định này tường minh vào CHANGELOG như 6 quyết định khác của batch 2 — hiện tại nó hoàn toàn
  không được nhắc tới.

**Đánh giá nguyên nhân (vì sao REJECT nhưng không tính vòng lặp Protocol 3)**: đã đọc lại
`docs/Architecture.md` §V13 (toàn bộ TV1-TV17) — không dòng acceptance nào của TV6/TV11/TV12 yêu
cầu UI cho reorder-sau-khi-xong, Q9, hay xác nhận-trước-khi-bỏ-phần. Dev đã làm đúng 100% những gì
Architecture.md giao (kể cả 2 lệch đã tự flag ở TV5/TV6, xem mục Medium bên dưới). Đây là chỗ
PRD/UX (đã duyệt ở Checkpoint 1/2) có yêu cầu tường minh mà Architecture.md's Task Breakdown bỏ
sót khi chuyển hoá — lỗi nằm ở tầng bàn giao PRD→Architecture, không phải Architecture→code. Theo
đúng tinh thần Protocol 3 ("Reject do vi phạm quy trình... không tính vào bộ đếm — vi phạm quy
trình không được ăn mòn quota sửa lỗi kỹ thuật"), việc thiếu sót nằm ở tài liệu thiết kế chứ
không phải Dev code sai so với spec được giao, nên 2 issue High này không nên trừ vào 3 vòng
Dev↔Reviewer — cần PM/Tech Lead quyết định bổ sung task (TV18/TV19?) rồi giao lại cho Dev, không
phải một vòng "sửa lỗi" thông thường.

### Medium
- [ ] `js/app.js:1701-1707` — modal xác nhận "Bỏ phần" (post-hoc, sau khi đã transcribe) dùng
  thân modal tự viết ("Bản ghi sẽ thiếu nội dung của phần N. File ghi âm vẫn được giữ trên máy.
  Bản ghi sẽ được đánh dấu là thiếu nội dung.") thay vì FAI-09 đã duyệt ("Bản ghi sẽ chỉ còn phần
  1 và phần 3, thiếu đoạn 15:19 → 16:07 (48 phút). File ghi âm vẫn được giữ trên máy. Bản ghi sẽ
  được đánh dấu là thiếu nội dung."). Khác với 2 modal Dev đã chủ động flag là "microcopy mới, UX
  không có sẵn" (E-V1 confirm-thiếu-phần, retry-provider-khác — cả hai đúng là UX §6 không phủ
  tới), **FAI-08/FAI-09 CÓ tồn tại sẵn trong bảng đã duyệt** và tiêu đề FAI-08 ("Bỏ phần 2?") đã
  được Dev copy đúng — chỉ riêng thân FAI-09 bị thay bằng bản tự viết, thiếu chính xác cái thông
  tin quan trọng nhất mà bản duyệt đưa vào (khoảng thời gian cụ thể sẽ mất: "15:19 → 16:07 (48
  phút)"), và điều này không được liệt vào danh sách "Decisions made without an explicit
  Architecture/UX answer" của CHANGELOG batch 2 — tức đây là 1 chỗ lệch bản duyệt chưa được flag,
  khác diện với 2 chỗ Dev đã chủ động báo cáo. → Gợi ý: đổi lại đúng FAI-09, dùng
  `Parts.gapWarningSeconds`/dữ liệu `offsetSeconds`/`spanSeconds` hai phần liền kề (đã có sẵn ở
  server, `GET /api/meetings/:id/parts` trả `offsetSeconds`/`spanSeconds`) để tính khoảng giờ
  thật thay vì bỏ hẳn thông tin đó.
- [ ] `index.html:113` — dòng chữ overlay kéo-thả toàn app là "📁 Thả file ghi âm vào đây để
  nhập", trong khi DND-01 đã duyệt là **"Thả file ghi âm vào đây"** (không có "để nhập"). UX §6
  ghi rõ "Đây là bản chính thức để Dev copy thẳng vào code... Không tự diễn đạt lại — nếu thấy
  câu nào sai/thiếu, báo lại để sửa ở đây trước". Đây là câu duy nhất trong toàn bộ rà soát
  microcopy (đối chiếu tay ~40 ID trong §6.1-6.8 với `js/import.js`/`js/app.js`/`index.html`) bị
  thêm chữ ngoài bản duyệt mà không có ghi chú lý do. Mức độ thấp (không đổi nghĩa, không lẫn
  ngôn ngữ, không vi phạm BR-147 về mặt ngôn ngữ) nhưng nên sửa vì đúng quy ước đã thống nhất.
- [ ] `js/app.js` — thời gian "đã X phút" hiển thị không nhất quán giữa 2 nơi cùng mô tả tiến độ
  một bản ghi ghép: `_renderMultiPartSection` (`js/app.js:1633`, render tĩnh khi mở trang Meeting
  Detail) tính `elapsedMin` từ `part.addedAt` thật (mốc thời gian phần được đăng ký) — đúng; còn
  `_pollPartsStatus` (`js/app.js:4319-4335`, dùng cho toast nền + chỉ báo tác vụ nền) tính
  `elapsedMin` từ `startedAt = Date.now()` tại **thời điểm gọi hàm poll**, tức bị reset về 0 mỗi
  khi trang được tải lại giữa lúc đang xử lý (`_resumeProcessingJobs` gọi `_pollPartsStatus` mới
  sau F5). Hệ quả: user F5 lúc job đã chạy 20 phút sẽ thấy chỉ báo tác vụ nền báo "đã 0 phút" rồi
  tăng dần lại từ đầu, trong khi mở đúng trang Meeting Detail của bản ghi đó lại thấy "đã 20
  phút" chính xác — hai con số mâu thuẫn nhau trên cùng 1 màn hình tại cùng 1 thời điểm nếu cả
  hai đều hiển thị (background indicator + trang detail). Không ảnh hưởng dữ liệu, chỉ gây khó
  hiểu. → Gợi ý: `_pollPartsStatus` nên tính `elapsedMin` từ `min(part.addedAt)` của dữ liệu vừa
  fetch (giống `_renderMultiPartSection`) thay vì mốc `Date.now()` cục bộ của phiên poll.

### Low
- [ ] `js/import.js:494` (MRG-13) — dòng hướng dẫn nghe thử dùng "phần trước"/"phần sau" thay vì
  đúng nguyên văn duyệt "phần 1"/"phần 2" (dòng này hiện 1 lần cho cả danh sách thay vì lặp lại
  theo từng cặp liền kề như bản gốc ngụ ý). Đây là thích nghi hợp lý về mặt hiển thị (không lặp
  lại số cụ thể cho từng cặp), nhưng vẫn là diễn đạt lại thay vì copy nguyên văn — ghi nhận theo
  đúng tinh thần "báo lại nếu thấy câu nào cần sửa" của UX §6, không cần sửa gấp.
- [ ] `js/app.js:1688` nút "Thử lại" trong card lỗi phần dùng FAI-01 ("Thử lại") thay vì FAI-01b
  ("Thử lại phần 2") dù ngữ cảnh là 1 card riêng cho từng phần lỗi (đã có tiêu đề "Phần N chưa
  tạo được transcript" ngay phía trên nên không thực sự gây nhầm lẫn khi có ≥2 card lỗi cùng
  lúc) — không cần sửa, ghi nhận cho đồng bộ nếu có đợt chỉnh microcopy sau.
- [ ] `server/stt/index.js` `getAdapter(providerId)`/`validateSelection` tra cứu bằng
  `adapters[providerId]` (object literal, key cố định 4 provider) — không dùng `Object.hasOwn`/
  `Map`. Với `providerId` là chuỗi bất kỳ từ client (chặn ở `POST /parts` bằng whitelist trước khi
  gọi, nhưng `POST /api/import-transcription` legacy vẫn truyền thẳng `body.provider` không qua
  whitelist — xem mục "External contract verification" bên dưới), `adapters['__proto__']` trả về
  `Object.prototype` (truthy) thay vì `undefined`, khiến nhánh `if (!adapter) throw
  PROVIDER_NOT_FOUND` bị bỏ qua và code sẽ crash muộn hơn ở `adapter.listModels()`/`transcribe()`
  (nằm trong try/catch của job runner nên chỉ khiến 1 job `failed`, không sập server) — **tồn tại
  từ trước feature này**, không phải lỗi mới của TV1-16, và không phải lỗ hổng khai thác được
  (không có filesystem/network side-effect), nhưng đáng ghi nhận vì `POST /api/import-transcription`
  vẫn là cửa ngỏ duy nhất trong app còn nhận `provider` dạng free-text sau feature này. Không chặn
  merge.

## External contract verification
YES cho phần lớn (nguồn: đọc trực tiếp `server.js`, `server/meeting-parts.js`, `server/stt/*.js`,
`server/llm/prompts.js`, `js/app.js`, `js/import.js`, `js/import-preflight.js`, `js/parts.js`,
`js/export.js`, `js/storage.js`, `js/summary.js`, và tự chạy `npm test`/đối chiếu `git diff`).

Riêng 2 golden fixture `tests/fixtures/{soniox,deepgram}/real-transcribe-vi.json` (Protocol 5.3):
**có bằng chứng gián tiếp mạnh** nhưng không tuyệt đối chứng minh được là capture thật trong
phiên review này (không có key để tự replay) — cùng giới hạn đã ghi nhận ở lần review T9 trước.
Điểm củng cố niềm tin, tự kiểm tra được mà không cần key: giá trị `raw.duration` của Deepgram là
`4.9255624` (độ chính xác lẻ đặc trưng của response thật, khó bịa hợp lý), và
`Math.round(4.9255624) = 5` khớp chính xác `expectedNormalized.duration: 5` sau khi chạy qua
`normalizeResult` thật (`server/stt/contracts.js:88`) — tự chạy lại phép tính này xác nhận đúng,
không phải trùng hợp ngẫu nhiên nếu là số bịa tay. Transcript hai provider cũng khác nhau đúng
kiểu biến thiên thật của 2 model khác nhau trên cùng 1 audio (Soniox chuẩn hoá "quý bốn" → "quý
4.", Deepgram giữ nguyên "quý bốn" không dấu chấm cuối) — khó giả lập nhất quán nếu viết tay.
`test/stt-golden.test.js` skip Whisper/Google đúng cách (`t.skip()` với message trỏ về
Architecture §V12.4 U-V7, không giả vờ pass, không viết fixture bịa để lấp chỗ trống) — xác nhận
qua log test thật: `﹣ whisper: ... SKIPPED` / `﹣ google: ... SKIPPED`, đúng 2/213 test bị skip
khớp con số Dev báo.

Riêng `tests/fixtures/deepseek/dynamic-sections.json` (feature summary-presets, không thuộc phạm
vi TV1-16) — không review lại theo đúng chỉ dẫn của brief.

## Đối chiếu 2 lệch Architecture.md Dev tự báo cáo (batch 1)
1. **`POST /parts` provider lạ trả 404 (`STT_PROVIDER_NOT_FOUND`) thay vì 400 theo văn bản
   Architecture §V6.2** — đã verify `STATUS_BY_CODE[STT_ERROR.PROVIDER_NOT_FOUND] = 404`
   (`server/stt/contracts.js:23`) là quy ước **đã có từ trước**, dùng thống nhất bởi mọi route
   STT khác trong toàn bộ codebase (không riêng route mới). Chấp nhận được — Dev ưu tiên đúng
   nguyên tắc "1 code lỗi = 1 status code" nhất quán toàn hệ thống thay vì tạo ngoại lệ cho 1
   route, đúng tinh thần giảm rủi ro lệch quy ước rải rác. Không cần sửa.
2. **`POST /api/import-transcription` không thêm whitelist R-S** — đã verify đúng như Dev báo:
   route legacy này (`server.js:1869`) nhận thẳng `body.provider`/`body.model` không qua
   `stt.validateSelection`, trong khi route mới `POST /parts` có whitelist đầy đủ. Lý do Dev nêu
   (sửa sẽ phá `test/jobs.test.js` cố tình dùng `provider: 'invalid-test-provider'` để giả lập lỗi
   async không cần network) — đã đọc `test/jobs.test.js` xác nhận đúng, test đó thật sự dựa vào
   hành vi 201-rồi-fail-async này. Chấp nhận được cho vòng này vì route legacy chỉ phục vụ luồng
   một-phần (đã tồn tại từ trước, rủi ro không tăng thêm do feature mới) — nhưng đây vẫn là 1 lỗ
   hổng validate input thật (server tin `provider`/`model` dạng chuỗi tự do từ client, dù hậu quả
   hiện tại chỉ là job fail muộn, xem Low cuối cùng ở trên) nên nên đưa vào backlog dọn dẹp kỹ
   thuật thay vì để treo vô thời hạn — không chặn merge.

## Đối chiếu 6 quyết định Dev đợt 2 tự quyết (batch 2)
1. **E-V1 modal copy + retry-provider modal copy** — đúng như Dev tự nhận, UX §6 không phủ tới,
   đã flag rõ trong CHANGELOG. Chấp nhận, chờ PM/UX duyệt câu chữ chính thức.
2. **BR-106 quality warning chỉ mức toàn-meeting (QLT-01), không làm per-part (QLT-02)** — đã đọc
   `_renderQualityWarning`/`Parts.qualityWarning`, xác nhận đúng như Dev mô tả (chỉ 1 kiểm tra
   toàn bộ `meeting`, không lặp qua từng `part`). Lý do Dev nêu (đọc chữ BR-106 "bất kỳ phần nào"
   là mô tả ngữ cảnh multi-part, không phải yêu cầu literal per-part text; Architecture TV12's
   acceptance row không đòi QLT-02) — hợp lý, đã tự đọc lại TV12 acceptance xác nhận đúng không
   có dòng nào bắt buộc QLT-02. Chấp nhận, đã flag đúng cho PM/UX xác nhận.
3. **TV15 guard theo `transcript` rỗng, không theo `audioId`** — đã đọc `server.js:1887-1906` xác
   nhận đúng lý do Dev nêu (một meeting có `audioId` nhưng job FAILED thì `transcript` vẫn rỗng →
   "Thử lại" không bị chặn oan; chỉ meeting đã có transcript thật mới bị bảo vệ khỏi ghi đè). Hợp
   lý, đúng tinh thần BR-98, có test hồi quy riêng trong `test/jobs.test.js`. Chấp nhận.
4. **BR-119 "mọi tên file khác nhau sau khi bỏ số" đọc là "không có tie" thay vì "mọi tên khác
   nhau tuyệt đối"** — đã đọc `suggestPartOrder`/comment trong `js/parts.js`, xác nhận cách đọc
   của Dev là cách duy nhất hợp lý (đọc theo nghĩa đen sẽ loại bỏ chính ví dụ kinh điển
   `phan-1.m4a`/`phan-2.m4a` mà rule này sinh ra để xử lý). Chấp nhận, không cần escalate.
5. **BR-128/`durationEstimated` không áp dụng cho bản ghi MỘT phần dùng Google/`gpt-4o-*`** — đã
   đọc `runTranscriptionJob` nhánh single-part, xác nhận đúng: `durationEstimated` chỉ được set
   qua `applyPartResult` (multi-part). Đây là **hành vi có từ trước** TV1-16 (không phải regression
   do feature này gây ra) và đúng là nằm ngoài phạm vi TV9-16 được giao — Dev flag đúng cách thay
   vì tự ý sửa lan sang pipeline cũ. Chấp nhận, cần Tech Lead quyết có mở task riêng không.
6. **Golden fixture Soniox/Deepgram capture thật, Whisper/Google skip có nhãn rõ** — xem mục
   "External contract verification" ở trên. Chấp nhận.

## Rà soát bảo mật (đối chiếu §V16 Architecture.md)
- **Cổng vào**: `requestHandler` (`server.js:2163-2176`) chặn **mọi** path bắt đầu `/api/` bằng
  `hasTrustedHost && isTrustedApiRequest` trước khi vào `handleApi` — đã xác nhận bằng cách đọc
  ranh giới hàm (`handleApi` chạy nguyên khối dòng 1308-2115), cả 5 route `/api/meetings/:id/parts*`
  nằm **bên trong** khối đó (dòng 1591-1866), không có `http.createServer`/listener/route thứ 2
  nào khác trong `server.js`. Không có đường vòng.
- **Ghi file / hash id**: `openStoredAudio(id)` dùng chung `audioPaths()` → `audioKey()` =
  `sha256(id)` cho cả `meetingId` lẫn `partId` (`server.js:336-337, 907-925`) — xác nhận `partId`
  không bao giờ ghép trực tiếp vào đường dẫn. `isValidPartId` (regex `/^part-[a-z0-9-]{8,64}$/`)
  được gọi **trước** `openStoredAudio(raw.partId)` ở route đăng ký phần (`server.js:1637` trước
  `1660`) và trước khi dùng ở route retry (`server.js:1749`). Route DELETE không validate hình
  dạng `partId` trước khi gọi `dropPart`, nhưng đã verify `dropPart`/`retryPart`/`reorderParts`
  trong `server/meeting-parts.js` chỉ dùng `partId` để `Array.find`/`Map.get` tra cứu trong
  `meeting.parts` (không chạm filesystem) — không có rủi ro path traversal dù thiếu check hình
  dạng ở route này.
- **Rò rỉ bí mật**: `listProviders()` (`server/stt/index.js:139-163`) dựng response bằng danh
  sách field trắng tường minh, không `...spread` object nội bộ nào — tự chạy lại test
  `GET /api/stt/providers exposes maxUploadBytes/formats/appAcceptedExtensions and never leaks
  the API key` xác nhận PASS.
- **Tin dữ liệu client**: `POST /parts` bỏ qua hoàn toàn `sizeBytes` client gửi, dùng lại
  `audio.meta.size` từ `fs.stat` thật (`server.js:1678`); `provider`/`model` qua
  `stt.validateSelection` (whitelist) trước khi tạo job. Riêng `POST /api/import-transcription`
  (route cũ) không có whitelist này — xem mục "2 lệch" ở trên, chấp nhận có ghi chú.
- **Subprocess**: `git diff -- server.js | grep '^+.*spawn'` không có kết quả — xác nhận feature
  này không thêm bất kỳ `child_process.spawn` nào.
- **Không mất dữ liệu**: `DELETE /parts/:partId` chỉ đổi `status: 'dropped'`
  (`server/meeting-parts.js:269-277`), không có lệnh `fs.unlink`/`rm` nào trong đường đi của route
  này — audio giữ nguyên trên đĩa đúng BR-103/134.

## Tương thích ngược — xác nhận bằng test tự chạy + đọc code
- `test/prompt-parts.test.js`: "a single-part meeting's buildSummaryPrompt is byte-for-byte
  unchanged from before v5" — PASS. Cơ chế: `formatTranscript`/`buildContextBlock` đều rẽ nhánh
  theo `segment.part`/`meeting.partCount > 0`, không có nhánh nào chạy cho meeting không có
  `parts` (đã đọc code xác nhận, không chỉ tin tên test).
- `test/export-markdown.test.js`: case byte-for-byte cho bản ghi một phần — PASS; cơ chế giống
  hệt (nhánh `.kind` chỉ tồn tại khi có `parts`).
- `server.js` `PUT /api/meetings`: guard cũ (`incoming.status==='processing'` cho bản ghi một
  phần) **không đổi 1 dòng** — nhánh mới `current.parts?.length > 0` được thêm **trước** và tách
  biệt hoàn toàn (`server.js:2005` so với nhánh cũ ở `2011`), xác nhận bằng cách đọc thứ tự if/else
  thật, không suy đoán từ comment.
- Job dedupe key `meetingId#${partId||''}`: bản ghi một phần luôn có `partId=''` nên khoá không
  đổi hình dạng so với trước — xác nhận đọc `jobKey`/`findActiveJob` thật.

## Positive Notes
- Bảo mật giữ nguyên baseline tuyệt đối: không route nào lách qua trust gate, không endpoint nào
  lộ key/hé lộ 1 phần key, hash SHA-256 áp dụng nhất quán cho id bất kỳ (meetingId lẫn partId),
  không subprocess mới. Đây là điểm quan trọng nhất của brief và Dev đã giữ vững qua cả 2 đợt.
- Golden fixture Soniox/Deepgram có dấu hiệu xác thực mạnh (độ chính xác số thập phân lẻ khớp
  công thức làm tròn thật, khác biệt transcript hợp lý giữa 2 model) — đúng tinh thần Protocol
  5.3, khác hẳn với việc "viết tay theo shape" đã từng bị reject ở feature summary-presets.
  Cách skip Whisper/Google minh bạch, không giả vờ pass.
- Kỷ luật tài liệu hoá xuất sắc ở cả 2 đợt: mọi lệch Architecture (2 chỗ đợt 1) và mọi quyết định
  tự ý (6 chỗ đợt 2) đều được flag tường minh kèm lý do kỹ thuật xác đáng, đa số đã tự verify lại
  đúng — giúp review nhanh và tin cậy hơn nhiều so với việc phải tự đào ra từ code không có dấu
  vết. Cả 2 điểm High tìm thấy trong lần review này (reorder/Q9 không có UI, thiếu xác nhận
  MRG-18/19) không nằm trong danh sách Dev tự báo — nhưng cũng không phải lỗi Dev, mà là khoảng
  trống nằm ở Architecture.md's Task Breakdown, như đã phân tích ở mục "Đánh giá nguyên nhân".
- Test suite cho pipeline ghép rất kỹ theo đúng tinh thần Protocol 6.2: `test/merge-timeline.test.js`,
  `test/prompt-parts.test.js`, `test/stt-golden.test.js`'s lineage test đều assert **giá trị cụ
  thể** (thời điểm chính xác, chuỗi text chính xác, `(Phần N)` đúng segment) thay vì chỉ
  `assert_called()` — đúng yêu cầu khắt khe nhất của brief.
- `preserveServerOwnedFields`/`applyTranscriptEdits` (R-R) triển khai đúng và tinh vi: so khớp
  toàn bộ cấu trúc transcript (không chỉ độ dài) trước khi áp edit, bỏ qua toàn bộ thay vì áp
  từng phần khi lệch cấu trúc — đúng tinh thần "thà không áp còn hơn áp sai" của Architecture.
- Capability object (Protocol 8.3) được triển khai và dùng nhất quán ở cả server
  (`server/meeting-parts.js`) lẫn client (`js/parts.js`, cố ý duplicate có ghi chú lý do thay vì
  share qua require, vì client chạy không qua bundler) — hai bản khớp nhau 100% (đã diff tay).

## Khuyến nghị cho PM
An toàn để **commit lên 1 branch mới** (không phải `main`) ngay bây giờ — không có Critical, bảo
mật giữ nguyên baseline, tương thích ngược được test và verify chắc chắn, 211/211 test xanh. Đây
KHÔNG phải khuyến nghị merge vào main/coi feature là hoàn thiện: 2 issue High (reorder/Q9 thiếu UI,
thiếu xác nhận bỏ-phần-giữa-cụm) là gap sản phẩm thật cần PM/Tech Lead quyết trước khi thông báo
với end user là "đã hỗ trợ ghép nhiều phần" đầy đủ theo PRD — nếu release ở trạng thái hiện tại,
nên ghi rõ trong ghi chú phát hành rằng "sắp xếp lại sau khi xong"/"thêm phần vào bản ghi đã ghép"
chưa khả dụng qua giao diện.

# Review — import-phone-recording, vòng 2 (fix 2 issue High)

## Verdict: APPROVE

`npm test` tự chạy lại độc lập: **219 passing, 2 skipped (Whisper/Google golden fixtures), 0
failing, tổng 221** — khớp đúng số Dev báo cáo. Đã đọc trực tiếp code cho cả 2 fix (không tin báo
cáo CHANGELOG suông), trace tay toàn bộ đường đi UI → fetch → server route → server logic cho cả
hai luồng. Cả 2 issue High của vòng 1 đã được đóng đúng, không phát sinh Critical/High mới.

## Verify Việc 1 — UI cho BR-121 (reorder) + Q9 (thêm phần)

- **▲▼ thực sự gọi đúng route, không chỉ đổi DOM**: `js/app.js:1791-1807` `_movePart()` gọi
  `Parts.computeReorderedPartIds(meeting.parts || [], partId, delta)` (đọc trực tiếp
  `js/parts.js:169-177` — hàm thuần, sort theo `.order` chứ không theo vị trí mảng, trả về `null`
  ở biên để caller bỏ qua fetch — đã tự chạy lại 4 test case mới trong
  `test/parts-order.test.js:122-140`, tất cả assert giá trị mảng cụ thể chứ không chỉ "được gọi")
  rồi `fetch(POST /api/meetings/:id/parts/reorder, {order})` thật (`js/app.js:1797-1799`). Nút
  ▲▼ chỉ render khi `canReorder = meeting.status !== 'processing' && parts.length > 1`
  (`js/app.js:1618`) — đã verify `overallStatus()` (`server/meeting-parts.js:122-127`) trả
  `'processing'` khi và chỉ khi có part `queued`/`processing`, nên gate này đúng ngữ nghĩa "không
  job nào đang chạy", khớp với gate của `_anyPartRunning` dùng cho Generate Summary.
- **Server route reorder không đụng STT thật**: đọc trực tiếp `server.js:1805-1838` —
  `reorderParts(meetings[index], order)` (thuần, không `await`, không import module STT nào) rồi
  ghi lại, không có bất kỳ lời gọi `stt.transcribe`/`runTranscriptionJob` nào trên đường đi. Route
  nằm bên trong khối `handleApi` đã được xác nhận qua trust gate `hasTrustedHost &&
  isTrustedApiRequest` ở vòng review trước — không thêm entrypoint mới. `reorderParts`
  (`server/meeting-parts.js:281-294`) validate `orderedPartIds` là **permutation đầy đủ** của
  toàn bộ `meeting.parts` hiện có (kể cả `failed`/`dropped`) trước khi áp — khớp đúng comment của
  `computeReorderedPartIds` phía client ("phải gồm mọi part bất kể status").
- **"+ Thêm phần" nối vào bản ghi có sẵn, không tạo nhầm bản ghi mới**: `js/import.js:913-949`
  `_startAppendParts()` dùng `this._attachMeetingId` (id bản ghi đã tồn tại, được set từ
  `Import.open({attachMeetingId, mode:'appendPart'})`, `js/app.js:1783`) và `fetch(POST
  /api/meetings/${meetingId}/parts, ...)` — cùng route TV6 đã dùng cho lần import ghép đầu tiên,
  không phải route tạo meeting mới. Đọc `registerParts` (`server/meeting-parts.js:190-203`) xác
  nhận nó cộng dồn vào `current = meeting.parts` sẵn có, tự tính lại `nextOrder` từ
  `Math.max(current.order)+1` — **bỏ qua hoàn toàn** field `order` client gửi
  (`js/import.js:929` gửi `order: partsPayload.length+1` nhưng vô hại vì server không đọc field
  này, xem `buildRegisteredPart(input, order)` nhận `order` là tham số thứ 2 do `registerParts`
  tính, không phải từ `input.order`) — không có đường nào tạo record trùng/mới.
- **Guard đúng theo E-V4** (Q9 chỉ áp dụng cho bản ghi đã ở chế độ ghép): `Import.open()`
  (`js/import.js:53-66`) khi `mode==='appendPart'` bắt buộc `meeting.parts.length > 0`, nếu không
  toast lỗi và abort — khớp đúng PRD Architecture.md §E-V4 (đã đọc `docs/Architecture.md:1423`).
  Nút "+ Thêm phần" cũng chỉ render trong nhánh `caps.multiPart` (`js/app.js:1395`), không lộ ra
  ở bản ghi một phần.
- **Không tự sinh lại summary, chỉ nhắc nhở**: cả 2 route (`/parts/reorder`,
  `/parts` mới) đều bump `promptContextUpdatedAt`/`updatedAt` (đã đọc `server.js:1822`,
  batch 2's `/parts` route) — cơ chế "thông tin mới hơn tóm tắt" đã có sẵn từ trước tự động chạy,
  không cần code mới, khớp đúng BR-121/BR-29.

Kết luận Việc 1: cả 3 điểm brief yêu cầu xác nhận đều đúng như Dev báo cáo.

## Verify Việc 2 — hộp xác nhận MRG-18/19 khi bỏ phần giữa cụm trước Start

- Đối chiếu `docs/ux-import-phone-recording.md:1062-1063`: MRG-18 = *"Bỏ phần này ra thì cuộc họp
  sẽ thiếu đoạn giữa (15:19 → 16:07)."*, MRG-19 = *"Vẫn bỏ phần này"*. Code
  (`js/import.js:164-184` `_confirmRemoveEntry`) dùng đúng câu MRG-18 làm thân modal
  (`Bỏ phần này ra thì cuộc họp sẽ thiếu đoạn giữa${range ? ` (${range})` : ''}.`), nút xác nhận
  đúng chữ MRG-19 nguyên văn. `range` tính bằng `Parts.formatGapRangeClock(prev.lastModified,
  next.lastModified)` — đã tự chạy lại test `formatGapRangeClock` (`test/parts-order.test.js:154-163`)
  xác nhận format `HH:mm → HH:mm` đúng và degrade về `''` (bỏ hẳn ngoặc) khi thiếu 1 mốc, không
  đoán mò — đúng tinh thần "never guesses" đã ghi trong comment `js/parts.js:191-195`.
- **Mức độ cảnh báo/microcopy khớp bản duyệt về nội dung**; điểm khác: bản UX mock-up ở §4b.3
  (dòng 488-493) vẽ cảnh báo này **lồng trực tiếp trong hàng file lỗi** (inline, không có nút
  Hủy) còn Dev dựng thành **modal riêng** (`App.showModal`, có cả nút "Hủy" lẫn "Vẫn bỏ phần
  này", tái dùng đúng pattern của modal FAI-08/09 sẵn có trong `js/app.js`). Nội dung câu chữ
  đúng 100% nguyên văn, hành vi (không mất dữ liệu ngầm) đúng tinh thần D8 — chỉ khác về **layout
  container** (modal vs. inline). Đây là sai lệch trình bày nhỏ, không đổi nghĩa hay hạ mức cảnh
  báo — xếp Low, nên PM/UX xác nhận cho vòng sau chứ không chặn merge vòng này.
- **Logic "không phải phần cuối" — đã tự trace tay đúng theo THỨ TỰ HIỂN THỊ HIỆN TẠI**, không
  phải thứ tự file gốc: `removeEntry()` (`js/import.js:148-157`) lấy `index` bằng
  `this._state.entries.findIndex(...)` trên **chính mảng `_state.entries` đang hiển thị** — mảng
  này đã qua `_applySuggestedOrder()` (natural-sort) hoặc qua thao tác kéo/▲▼ thủ công của user
  trong chính modal import (tính năng có từ TV11, không đổi ở đợt này) trước khi tới lúc bấm ✕,
  nên "cuối" ở đây luôn là cuối theo thứ tự đã sắp/đã chỉnh tay, không phải cuối theo tên file gốc
  hay thứ tự chọn file. `removingCreatesGap(index, length)` (`js/parts.js:187-189`) trả
  `length > 1 && index < length - 1` — tự kiểm tra bằng tay 2 case brief nêu:
  - 3 phần, bỏ phần **giữa** (index 1 của 3): `removingCreatesGap(1,3)` = `3>1 && 1<2` = `true` →
    có xác nhận. Đúng.
  - 3 phần, bỏ phần **cuối** (index 2 của 3): `removingCreatesGap(2,3)` = `2<2` = `false` → không
    xác nhận. Đúng, vì phần cuối không tạo lỗ giữa mà chỉ rút ngắn cuộc họp.
  - Case brief hỏi thêm — sau khi đã bỏ phần giữa (còn lại 2 phần A, C, tự động liền kề trong
    mảng), bỏ tiếp phần cuối mới (index 1 của 2): `removingCreatesGap(1,2)` = `2<1` = `false` →
    không xác nhận. Đây **đúng** chứ không phải lỗ hổng: vì `_state.entries` luôn là mảng đã sắp
    theo thời gian hiển thị (natural-sort hoặc user tự kéo), phần tử cuối mảng luôn là phần cuối
    cùng theo thứ tự đó — bỏ nó không bao giờ tạo lỗ ở giữa các phần **còn lại**, bất kể phần nào
    đã bị bỏ trước đó. Rủi ro duy nhất còn sót là nếu user tự kéo thứ tự SAI (không khớp thời gian
    thật) trước khi bỏ — nhưng đó là lỗi nhập liệu của chính user với thứ tự họ tự chọn, không
    phải lỗi logic của `removingCreatesGap` (hàm này đúng theo đúng định nghĩa "thứ tự hiển thị
    hiện tại" được giao, không phải theo tên file/mốc thời gian tuyệt đối).
- **IMP-27**: `_notifyRemovedEntry()` (`js/import.js:186-190`) — đúng nguyên văn UX doc
  (`docs/ux-import-phone-recording.md:1037`), gọi bằng `App.toast(..., 'info')` sau **mọi** lần
  bỏ phần ở mode `merged` (cả nhánh có confirm lẫn nhánh exempt-phần-cuối,
  `js/import.js:156,182`) — khớp đúng điều kiện UX doc ghi ("khi user bỏ bớt phần ra ở chế độ
  ghép", không giới hạn riêng case tạo lỗ).

Kết luận Việc 2: logic, microcopy, và điều kiện kích hoạt đều đúng bản duyệt. Chỉ có 1 điểm Low
(modal vs. inline layout) đáng ghi nhận cho vòng chỉnh sửa UI sau.

## Việc chung

1. **`npm test`**: tự chạy lại, `221 tests / 219 pass / 2 skip / 0 fail` — khớp Dev báo cáo.
2. **Không phá vỡ điều đã APPROVE trước đó**:
   - Bảo mật: route reorder/append nằm trong `handleApi` (trust gate cũ), không thêm
     `child_process.spawn`, không đổi cơ chế hash id — đã tự đọc lại, không lệch baseline.
   - Tương thích ngược: không đụng `js/export.js`/`server/llm/prompts.js`/pipeline single-part;
     đợt này chỉ thêm code trong `js/app.js`/`js/import.js`/`js/parts.js`, không sửa gì ở
     `server/llm/*`, `server/stt/*`.
   - `test/parts-routes.test.js`, `test/prompt-parts.test.js`, `test/export-markdown.test.js`,
     `test/stt-golden.test.js` đều còn nằm trong bộ 221 test pass — không bị xoá/skip thêm.
3. **3 điểm Dev tự quyết**:
   - (a) Chỉ ▲▼, không kéo-thả ở Meeting Detail — chấp nhận được, rủi ro thấp, nhất quán với việc
     modal import (nơi đã có kéo-thả từ TV11) và Meeting Detail (nơi mới có ▲▼) là 2 ngữ cảnh
     UI khác nhau; không có yêu cầu tường minh nào trong UX doc bắt buộc kéo-thả ở Meeting Detail.
   - (b) Modal "+ Thêm phần" chỉ đếm file mới, không đếm phần đã có — chấp nhận tạm thời nhưng
     **nên sửa ở vòng UI polish tiếp theo**: `_title()` trả "Thêm phần vào bản ghi này" (không có
     số), nhưng `_startLabel()` (`js/import.js:647`) hiện "Thêm phần"/"Thêm N phần" mà không cho
     biết bản ghi đã có sẵn bao nhiêu phần — dễ khiến người dùng tưởng nhầm tổng số phần sau khi
     thêm. Không chặn merge (không phải lỗi dữ liệu, chỉ là thiếu ngữ cảnh hiển thị), nhưng nên
     đưa vào backlog UX vì đúng đúng loại "trông thiếu thông tin" mà D8 quan tâm.
   - (c) IMP-27 hiện bằng toast — chấp nhận được, tái dùng đúng pattern `App.toast` sẵn có, UX doc
     không chỉ định cơ chế hiển thị cụ thể.
4. **Protocol 6 — giá trị cụ thể hay chỉ "được gọi"**: test mới trong `test/parts-order.test.js`
   (`computeReorderedPartIds`, `removingCreatesGap`, `formatGapRangeClock`) đều assert **giá trị
   cụ thể** (mảng partId chính xác, boolean chính xác cho từng vị trí, chuỗi giờ chính xác) —
   không có test nào chỉ `assert_called()`. Điểm cần lưu ý: **không có test tự động nào cho
   `js/app.js`/`js/import.js` chính nó** (glue code DOM-dependent, đúng quy ước "không test DOM"
   đã áp dụng nhất quán cho toàn bộ `js/app.js`/`js/import.js`/`js/export.js` từ trước tới giờ,
   không phải điều mới của riêng đợt này) — Dev tự báo đã chạy smoke test tay với server thật
   (đăng ký 2 phần → reorder → thêm phần 3), nhưng **không có bằng chứng log/output nào của smoke
   test này được đính kèm hay lưu lại** trong repo để Reviewer verify độc lập (khác hẳn golden
   fixture STT — có file capture lưu vết). Đã tự bù bằng cách đọc code đường đi fetch→route→logic
   tay từng bước (liệt kê ở trên) để xác nhận lineage đúng thay vì tin báo cáo suông — nhưng đây
   là khoảng trống về "để lại dấu vết verify" nên ghi nhận là Low, không chặn.

## Issues Found

### Critical
(none)

### High
(none — cả 2 issue High của vòng 1 đã đóng đúng, xem "Verify Việc 1/2" ở trên)

### Medium
(none mới trong phạm vi vòng này — 3 issue Medium của vòng 1, gồm FAI-09 body copy chưa đúng bản
duyệt (`js/app.js:1720`), microcopy DND-01 thừa chữ (`index.html:113`), và
`_pollPartsStatus`/`_renderMultiPartSection` tính `elapsedMin` lệch nhau, **vẫn còn nguyên, chưa
được sửa trong đợt fix này** — brief round 2 chỉ yêu cầu fix 2 issue High nên không tính vào
verdict vòng này, nhưng nhắc PM đưa vào backlog để không bị quên)

### Low
- [ ] `js/import.js:164-176` `_confirmRemoveEntry` — modal xác nhận MRG-18/19 dùng container
  dạng popup (`App.showModal`, có nút Hủy) thay vì layout inline-trong-hàng-file như mock-up UX
  §4b.3 vẽ. Nội dung câu chữ đúng 100%, hành vi an toàn hơn (có Hủy tường minh) — chỉ khác cách
  trình bày. → Gợi ý: xác nhận với PM/UX xem có cần đổi sang inline để khớp mock-up pixel-perfect,
  hay giữ modal (nhất quán với FAI-08/09) là đủ.
- [ ] `js/import.js:647,918` modal "+ Thêm phần" chỉ đếm/label theo số file MỚI, không cho biết
  tổng số phần của bản ghi sau khi thêm. → Gợi ý: đổi nhãn thành dạng "Thêm 2 phần (bản ghi sẽ có
  5 phần)" hoặc tương tự, cần UX duyệt câu chữ.
- [ ] `js/app.js:1791-1807` `_movePart`, và nút ▲▼/`add-part` nói chung — không disable nút trong
  lúc đang chờ fetch, có thể double-click gây gọi API 2 lần (server vẫn xử lý đúng vì có
  validate/permutation nên không hỏng dữ liệu, chỉ lãng phí 1 request). → Gợi ý: disable nút ngay
  khi click, theo đúng pattern đã dùng ở nút "Thử lại"/"Bỏ phần" trong cùng file
  (`btn.disabled = true`).
- [ ] Không có bằng chứng lưu vết (log/output file) cho smoke test tay Dev tự báo đã chạy với
  server thật cho luồng reorder/append-part — khác với golden fixture STT (có file capture).
  → Gợi ý: lần sau, dán output thật của smoke test (request/response JSON) vào CHANGELOG hoặc
  `tests/fixtures/` để Reviewer verify được mà không phải tự dựng lại server để test tay.

## External contract verification
N/A — cả 2 fix trong vòng này thuần là UI/orchestration nội bộ (gọi lại route server đã có sẵn từ
batch 2, không có tool/API bên thứ 3 mới nào liên quan).

## Đối chiếu baseline bảo mật (CLAUDE.md)
- Route `/parts/reorder` và `/parts` (dùng lại cho append) đều nằm trong khối `handleApi` đã qua
  `hasTrustedHost && isTrustedApiRequest` — không thêm entrypoint `/api/*` nào bỏ qua check này.
- Không có `child_process.spawn` mới trong đợt này (đợt này không đụng `server.js` phần
  subprocess, chỉ đụng route đã tồn tại + 3 file JS phía client).
- `partId`/`meetingId` vẫn chỉ dùng để `Array.find`/tra cứu logic hoặc `encodeURIComponent` trong
  URL path (`/api/audio/${encodeURIComponent(part.partId)}`, `js/app.js:1623`) — không có chỗ nào
  nối trực tiếp id vào đường dẫn filesystem phía client; phía server vẫn dùng `audioKey()` =
  `sha256(id)` như đã xác nhận ở vòng review trước, không đổi.
- Không có API key nào xuất hiện trong code mới của đợt này.

## Positive Notes
- Cả 2 fix đúng chính xác theo gợi ý Reviewer đưa ra ở vòng 1 (kể cả chi tiết kỹ thuật như "phải
  gồm mọi part bất kể status" khi tính permutation cho reorder) — cho thấy Dev đọc kỹ issue thay
  vì chỉ vá bề mặt.
- `computeReorderedPartIds`/`removingCreatesGap`/`formatGapRangeClock` được tách thành hàm thuần,
  test riêng với giá trị cụ thể — đúng tinh thần Protocol 6, dễ verify hơn nhiều so với việc nhét
  logic thẳng vào DOM handler.
- Tự phát hiện và document rõ chỗ field `order` gửi lên server bị bỏ qua (không phải bug, nhưng
  đáng lẽ dễ gây hiểu nhầm) — kỷ luật ghi chú tốt, giúp review nhanh hơn.
- Toàn bộ đường dẫn dữ liệu (UI → fetch → route → hàm thuần server) đều trace được bằng tay không
  có "đứt gãy" nào — không có trường hợp nào giống lỗi round 1 (route có sẵn nhưng không ai gọi).
- Giữ đúng ranh giới bảo mật/tương thích ngược đã duyệt, không mở rộng phạm vi sửa đổi ra ngoài 2
  issue được giao.

## Khuyến nghị cho PM
An toàn để commit + push. Verdict APPROVE cho vòng 2 — 2 issue High đã đóng đúng, không phát sinh
Critical/High mới. Còn 1 issue Medium tồn đọng từ vòng 1 (FAI-09 copy, DND-01 copy,
`_pollPartsStatus` elapsed-time lệch) và 4 issue Low mới (3 ở trên + Medium tồn đọng) nên đưa vào
backlog cho một đợt polish UI riêng, không cần chặn commit lần này.

---

# Review — Rotating backup cho JSON metadata (fix sự cố mất dữ liệu 2026-09-19)

## Verdict: APPROVE

## Phạm vi review
Chỉ `server.js` (thêm `BACKUP_DIR`, `BACKED_UP_FILES`, `MAX_BACKUPS_PER_FILE`,
`backupBeforeOverwrite`, `pruneOldBackups`, hook vào `atomicWriteJson`) + `test/atomic-backup.test.js`
(mới). Đây là fix độc lập với `import-phone-recording`, không đụng route mới, không đụng client JS.

## Đối chiếu bằng tay với `docs/CHANGELOG.md` mục 2026-09-19
Đã đọc trực tiếp `git diff server.js`, không tin báo cáo suông của Dev.

1. **Thứ tự đọc-cũ-trước-khi-ghi-đè (điểm dễ sai nhất của loại fix này) — ĐÚNG.**
   `atomicWriteJson` gọi `await backupBeforeOverwrite(filePath)` là dòng đầu tiên, **trước** khi
   tạo `tempPath`/ghi/`rename`. Bên trong `backupBeforeOverwrite`, `fsp.readFile(filePath, 'utf8')`
   chạy khi `filePath` chưa hề bị đụng tới bởi lần ghi này — nội dung đọc được chắc chắn là nội
   dung TRƯỚC lần ghi hiện tại, không phải nội dung mới. Test `overwriting an important file backs
   up the pre-overwrite content` xác nhận đúng bằng giá trị cụ thể (`marker: 'first'` có trong
   backup, `marker: 'second'` không có) — không chỉ assert "có file backup".
   ENOENT (lần ghi đầu tiên, file chưa tồn tại) → trả `null` → bỏ qua backup, không lỗi. Đúng.

2. **Best-effort, không chặn đường ghi chính — ĐÚNG.**
   Toàn bộ thân `backupBeforeOverwrite` nằm trong 1 try/catch bao ngoài cùng
   (`mkdir`/`writeFile`/`pruneOldBackups` đều nằm trong try); catch chỉ `console.error` rồi kết
   thúc hàm, không throw lại, không return giá trị làm hỏng luồng gọi. Vì hàm không bao giờ throw,
   `await backupBeforeOverwrite(filePath)` ở `atomicWriteJson` không cần try/catch riêng vẫn an
   toàn. Test "a backup failure never blocks the real write" giả lập `ENOTDIR` (thay `.backups/`
   bằng 1 file thường) và xác nhận `PUT /api/settings` vẫn trả 200 và giá trị mới thực sự được
   `GET /api/data` đọc lại đúng — verify tận gốc thay vì chỉ tin status code.

3. **Race condition khi ghi đồng thời — ĐÃ KIỂM, không phải vấn đề nhờ cơ chế có sẵn.**
   Mọi lần gọi `atomicWriteJson` cho 4 file nằm trong `BACKED_UP_FILES` đều đi qua
   `mutateJson`/`replaceJson`, và cả hai đều dùng `withJsonMutation` (hàng đợi Promise theo từng
   `filePath`, đã có từ trước, dòng ~297-311) để serialize hoàn toàn read-modify-write theo từng
   file — kể cả `JOBS_FILE` vốn được ghi thường xuyên trong lúc nhiều job STT chạy song song
   (feature import-phone-recording). Nghĩa là không có 2 lần `backupBeforeOverwrite`/
   `pruneOldBackups` nào chạy đồng thời trên cùng 1 file → không có nguy cơ trùng tên backup hay
   prune xoá nhầm do race. Tên file backup còn có thêm timestamp ISO (mili-giây) + 8 ký tự
   `crypto.randomUUID()` ngẫu nhiên, đủ để tránh trùng ngay cả khi giả định không có hàng đợi.
   Ngoại lệ duy nhất gọi `atomicWriteJson(SETTINGS_FILE, ...)` trực tiếp không qua hàng đợi là
   `migrateLlmSettings()` (dòng 112) — chạy 1 lần lúc khởi động server trước khi nhận request, không
   có nguy cơ đồng thời.

4. **`pruneOldBackups` — logic sort/xoá đúng, không off-by-one.**
   Tên file có dạng `<basename>-<ISO timestamp, `:`/`.` → `-`>-<8 hex>.json`; sort chuỗi tăng dần
   tương đương sort theo thời gian tăng dần (ISO 8601 sort lexicographic đúng thứ tự thời gian).
   `excess = matching.length - MAX_BACKUPS_PER_FILE`; nếu `length === 5` → `excess = 0` → giữ đủ 5;
   nếu `length === 6` → xoá đúng 1 (phần tử đầu mảng đã sort = cũ nhất) → còn lại đúng 5 bản MỚI
   NHẤT. Không có off-by-one. Test "only the 5 most recent backups per file are kept" ghi 7 lần liên
   tiếp (có `sleep 5ms` giữa mỗi lần để timestamp không trùng) và assert `length === 5` chính xác
   (không phải `<= 5`).

5. **Hiệu năng — overhead thấp hơn lo ngại ban đầu trong brief, đã verify bằng cách đọc thêm các
   call site của `JOBS_FILE`/`MEETINGS_FILE`, không chỉ đọc riêng đoạn diff.**
   - `MEETINGS_FILE` chỉ lưu metadata (transcript/summary được lưu tách trong
     `TRANSCRIPTS_DIR`/`SUMMARIES_DIR` qua `artifactPath`, ghi bằng `atomicWriteJson` riêng — các
     file này KHÔNG nằm trong `BACKED_UP_FILES` nên không phát sinh backup) → kích thước file được
     backup nhỏ hơn nhiều so với lo ngại "vài MB" trong brief.
   - `JOBS_FILE` chỉ được ghi tại các mốc vòng đời job (tạo job, promote từ queued→processing,
     `finishJob`, watchdog dọn job kẹt) — không có polling ghi liên tục; watchdog
     (`JOB_WATCHDOG_INTERVAL_MS = 5 phút`) cũng chỉ ghi khi thực sự có job kẹt, không ghi mỗi tick.
   - Với tần suất ghi theo sự kiện (không phải theo thời gian) như trên, overhead 1 lần đọc file cũ
     + 1 lần ghi backup + 1 lần `readdir` liệt kê tối đa vài chục file trong `.backups/` là không
     đáng kể. Không thấy nguy cơ nghẽn I/O ở mức hiện tại của app (single-user, local-first).

6. **Test tự chạy lại — khớp báo cáo Dev.** `npm test` (chạy trực tiếp, không dùng lại log cũ):
   `223 passing, 2 skipped, 0 failing` — khớp chính xác con số Dev báo. 4 test mới trong
   `test/atomic-backup.test.js` đều pass và đều assert giá trị cụ thể (nội dung backup, đúng số
   lượng file còn lại, đúng 0 backup cho file ngoài allowlist, request vẫn 200 khi backup lỗi) —
   không có test nào chỉ `assert_called()`/kiểm sự tồn tại file suông.

7. **Không xung đột với các thay đổi khác.**
   - `git status` cho thấy `js/app.js`, `js/recorder.js` (2 fix đã APPROVE trước đó) không nằm
     trong diff hiện tại — đã được commit ở vòng trước, không bị đụng lại.
   - `grep` xác nhận `server/meeting-parts.js` (route parts mới của import-phone-recording) không
     gọi `atomicWriteJson` trực tiếp — route parts ghi qua `mutateJson(MEETINGS_FILE, ...)` ở
     `server.js`, tức là vẫn đi qua đúng 1 điểm chốt `atomicWriteJson` duy nhất, được backup tự
     động, không cần Dev sửa thêm ở `meeting-parts.js`.
   - `EXPORT_SETTINGS_FILE` và thư mục `BUG_REPORTS_DIR` cố tình **không** nằm trong
     `BACKED_UP_FILES` — đúng như Dev mô tả, test "writing a file outside the important list
     creates no backup" xác nhận bằng `/api/bug-reports` (0 backup sinh ra).

## External contract verification
N/A — không có tool/API bên thứ 3 nào trong thay đổi này (chỉ đọc/ghi file cục bộ bằng `node:fs`).

## Đối chiếu baseline bảo mật (CLAUDE.md)
- Không thêm endpoint `/api/*` nào — thay đổi nằm hoàn toàn trong hàm nội bộ `atomicWriteJson`,
  vẫn được gọi từ các route đã qua `hasTrustedHost`/`isTrustedApiRequest` như trước.
- Không đụng tới API key/keychain.
- Tên file backup (`basename` lấy từ hằng số server tự định nghĩa: `meetings`, `settings`, `jobs`,
  `presets` — không phải input từ client) + timestamp/UUID tự sinh phía server → không có input
  người dùng nào chạm trực tiếp vào đường dẫn filesystem ở đây, không vi phạm quy tắc hash-id.
- Không có `child_process.spawn` mới.
- Lưu ý Low (không chặn merge): các file backup là bản sao plaintext y hệt nội dung đã lưu tại chỗ
  (`storage/*.json` vốn đã là plaintext theo thiết kế hiện tại của app) — không tạo ra lớp rò rỉ dữ
  liệu mới, nhưng nhân đôi bề mặt nếu sau này `settings.json`/`meetings.json` chứa dữ liệu nhạy cảm
  hơn. Không cần hành động ngay, chỉ ghi chú cho lần review kế tiếp nếu scope 2 file này mở rộng.

## Issues Found

### Critical
(none)

### High
(none)

### Medium
(none)

### Low
- [ ] [server.js, comment phía trên `backupBeforeOverwrite`] Quy trình khôi phục thủ công (dừng
  server → copy file từ `storage/.backups/` đè lên `storage/<name>.json` → khởi động lại) hiện chỉ
  được ghi trong 1 comment code. Vì mục tiêu của cả tính năng này là để xử lý đúng loại sự cố vừa
  xảy ra (mất dữ liệu thật), người sẽ cần quy trình này khi hoảng loạn giữa 1 sự cố thật nhiều khả
  năng không mở `server.js` ra đọc comment trước. Gợi ý: thêm 1 đoạn ngắn (5-6 dòng) vào
  `SECURITY.md` hoặc 1 file `docs/RECOVERY.md` mới, trỏ rõ vị trí `storage/.backups/` và các bước
  khôi phục — việc này không cần code, có thể làm ở đợt sau, không chặn merge.
- [ ] [project_state.json] `blockers` hiện vẫn còn nguyên
  `incident-2026-09-19-qa-wiped-real-storage-meetings-json...` (ghi rõ "BLOCKS merge của PR-1 cho
  tới khi PM/user acknowledge"). Fix này giải quyết đúng NGUYÊN NHÂN GỐC (không có backup nào để
  khôi phục), nhưng bản thân sự cố mất dữ liệu thật đã xảy ra vẫn cần PM báo cho user xác nhận đã
  biết — đây không phải lỗi code, chỉ nhắc PM đừng để việc fix xong (tốt) bị hiểu nhầm là sự cố đã
  "xong" theo nghĩa nhân sự/quy trình.

## Positive Notes
- Fix bám sát chính xác điểm chết người của loại bug này (đọc cũ trước khi ghi đè) và có test assert
  bằng giá trị cụ thể để chứng minh, không chỉ tin cấu trúc code "nhìn có vẻ đúng thứ tự".
- Tận dụng đúng hàng đợi `withJsonMutation` đã có sẵn thay vì tự chế thêm 1 lớp lock riêng cho
  backup — giảm bề mặt bug mới, và đúng tinh thần "1 điểm chốt duy nhất" (`atomicWriteJson`) mà
  codebase này đang theo.
- Phạm vi backup được giới hạn có chủ đích (`BACKED_UP_FILES` allowlist, không backup mọi
  `atomicWriteJson`) và có test xác nhận rõ ranh giới đó (file ngoài allowlist → 0 backup) — tránh
  biến backup thành noise vô nghĩa.
- Test mới đúng tinh thần Protocol 6: assert nội dung cụ thể (giá trị `marker`) truyền/giữ lại giữa
  các bước ghi, không chỉ assert "có gọi hàm"/"có file".
- Best-effort error handling được test bằng cách giả lập lỗi thật (`ENOTDIR`) thay vì mock hàm nội
  bộ để "chắc chắn nó throw" — test này vẫn còn giá trị nếu Dev sau này đổi cách hiện thực bên
  trong `backupBeforeOverwrite`.
- CHANGELOG ghi rất rõ ràng, kể cả các quyết định "không làm gì" (không thêm guard "mảng nhỏ hơn
  là bug" vì xung đột với bulk-delete hợp lệ) — giúp review nhanh hơn nhiều vì không phải tự suy
  đoán Dev có cân nhắc trường hợp đó chưa.

# Review — 4 bug fix sau QA vòng 2 (import-phone-recording)

## Verdict: APPROVE

## Tóm tắt cho PM
Đã đọc `docs/CHANGELOG.md` mục Dev vừa append, sau đó tự đọc code độc lập (không tin lời Dev
mô tả) cho cả 4 fix + 2 file mới, đối chiếu BR-94/BR-139/BR-146/BR-104/BR-136 trong `docs/PRD.md`,
và tự chạy `npm test`. Không tìm thấy Critical/High. Đề nghị PM chuyển sang QA re-test (vẫn tính
Dev↔QA round 1/5 theo Protocol 3 — không có vi phạm Protocol 5/8 nào ở đợt fix này).

## Verify từng fix

### BUG-003 (High) — BR-94 áp dụng cho ngày gõ tay
- Đọc `docs/PRD.md:329`: BR-94 = tương lai quá 1 ngày HOẶC trước 2000-01-01 → từ chối, "áp dụng
  cho cả giá trị suy ra từ file lẫn giá trị người dùng gõ tay". Đối chiếu `js/meeting-date.js`:
  `FUTURE_GRACE_MS = 24*3600*1000`, `MIN_PLAUSIBLE_MS = Date.UTC(2000,0,1)`, điều kiện
  `ms <= now+grace && ms >= min` — khớp chính xác ngưỡng PRD, không phải số Dev tự nhớ.
- Áp dụng nhất quán ở CẢ 2 nơi, đã grep xác nhận: `js/import.js:712` (handler `[data-field="date"]`
  cho browser hỗ trợ `datetime-local`) và `:726` (fallback `date-day`/`date-time`), cùng
  `js/app.js:2512` (`save-premeeting`). Cả 3 nơi cùng gọi `MeetingDate.isPlausibleMeetingDate`,
  không có nhánh nào bị bỏ sót.
- Vi phạm → giữ giá trị cũ + báo lỗi, không silent fail: cả 3 handler đều `App.toast(...,'error')`
  tiếng Việt rồi phục hồi input về giá trị cũ (`entry.dateIso` ở import.js,
  `_setDateEditorValue(m.date)` ở app.js) trước khi `return`/bỏ qua gán — không có đường nào rơi
  qua để gán giá trị bất hợp lệ. Ở `app.js:2508-2517`: `newDateIso` bị set về `null` sau khi
  reject, nên `if (newDateIso) m.date = newDateIso;` đúng là skip — đã trace tay, không suy đoán.
- Điểm Dev tự quyết (chỉ chặn riêng field `date`, các field khác `meetingType/topic/leadBy` vẫn
  lưu khi date invalid): chấp nhận được — BR-94/BR-145 chỉ nói về hành vi của riêng `date`, không
  có yêu cầu nào trong PRD về việc phải abort toàn bộ Save khi 1 field không liên quan bị lỗi;
  khớp tinh thần "mỗi editor tự lo phần của nó" đã có sẵn trong file này (participants, tags...).
- Test `test/meeting-date.test.js` (đọc trực tiếp): 6 case gồm đúng biên dưới inclusive
  (`MIN_PLAUSIBLE_MS` chính nó phải plausible=true), biên trên ±60s quanh `FUTURE_GRACE_MS`, và
  input không parse được (`'not-a-date'`, `''`, `undefined`) không throw — coverage boundary tốt,
  không chỉ test giá trị giữa khoảng.

### BUG-002 — `findDuplicateMeeting` duyệt cả `parts[]`
- Đọc `js/import-preflight.js:140-150`: logic mới `.some(part => part.filename === name &&
  Number(part.sizeBytes) === sizeBytes)` kết hợp OR với check top-level cũ — đúng cấu trúc BR-139.2.
- Không false-positive: điều kiện dùng `&&` (tên VÀ size), không phải `||` — file trùng tên khác
  size, hoặc trùng size khác tên, đều không match. Xác nhận bằng test đã có sẵn
  (`test/import-preflight.test.js:122-127`, viết từ trước) + test mới (`:129-143`) cover đúng 4
  case: part 2 của bản ghi ghép phải bắt được (repro chính xác BUG-002), part 1/top-level vẫn hoạt
  động, không match gì trả `null`, và `parts: []` rỗng trên bản ghi đơn không vỡ gì (không
  `.some()` trên `undefined`). Đã tự chạy `npm test` xác nhận cả 4 test pass.

### BUG-004 — so đúng `promptContextUpdatedAt`
- Đọc `js/storage.js:186`: `PROMPT_CONTEXT_FIELDS` = đúng 8 field BR-146 liệt kê
  (title/date/duration/participants/meetingType/topic/leadBy/notes), field này bump
  `promptContextUpdatedAt` — xác nhận cơ chế gốc đã đúng từ trước (batch 1), bug chỉ nằm ở chỗ đọc
  sai field.
- `git diff` xác nhận đúng bug gốc: code cũ `_preMeetingStaleHint` so `meeting.updatedAt` (bump ở
  mọi lần save) với `generatedAt`; code mới gọi thẳng `SummaryStaleness.isPreMeetingInfoStale`,
  không còn đụng `updatedAt` ở đâu trong hàm này nữa.
- `js/summary-staleness.js` áp dụng đúng R-AF deny-by-default: thiếu `generatedAt` HOẶC thiếu
  `contextUpdatedAt` → trả `false` (không nudge oan), và so sánh dùng `>` (strictly after) chứ
  không phải `>=` — có test riêng cho case "equal timestamps -> not stale" xác nhận không phải
  off-by-one.
- Test mới (`isPreMeetingInfoStale`, đọc trực tiếp trong file test, đã pass khi tự chạy `npm test`)
  tái hiện đúng bug gốc: case "tagging bumps updatedAt only" không nudge, và có case riêng chứng
  minh 1 prompt-context change thật với `updatedAt` CŨ HƠN vẫn nudge đúng (chứng minh `updatedAt`
  thực sự không còn được dùng, không chỉ test cho qua).

### BUG-001 — `Parts.partErrorCopy` + escape HTML
- `js/parts.js:218-230`: hàm trả plain text (title/detail), có comment JSDoc nói rõ caller chịu
  trách nhiệm escape — đúng convention `js/app.js` đang dùng cho các field khác trong cùng file
  (`Utils.escapeHtml` bọc mọi nội dung động).
- Render tại `js/app.js` (`_renderMultiPartSection`): cả `copy.title` và `copy.detail` đều đi qua
  `Utils.escapeHtml(...)` trước khi nội suy vào template string — đã đọc đúng dòng code
  (`<strong>${Utils.escapeHtml(copy.title)}</strong>`, `<p ...>${Utils.escapeHtml(copy.detail)}</p>`),
  không có field nào lọt escape. Đây là điểm brief nhấn mạnh dễ tạo XSS — đã đọc kỹ, không chỉ tin
  báo cáo của Dev: `copy.detail` cho case không phải `STT_TRANSCRIBE_FAILED` nội suy trực tiếp
  `part.error.message` (dữ liệu từ provider bên ngoài, không tin cậy) vào `detail`, và field này
  vẫn được escape đúng ở nơi render — không có đường nào để provider message chèn HTML sống.
- Mã lỗi khác vẫn giữ hành vi cũ: nhánh `else` trả nguyên title cũ ("Phần N chưa tạo được
  transcript") + `Nhà cung cấp báo: ${message}` làm detail phụ — đúng BR-104 (mã lỗi/message ở
  dòng phụ, không phải headline) và giữ nguyên hành vi các code khác. Test
  `test/parts-order.test.js:175-186` xác nhận đúng: `STT_RATE_LIMITED` giữ generic title, và
  trường hợp `error: null` không throw.

## File mới — convention & wiring
- `js/meeting-date.js`, `js/summary-staleness.js`: cả 2 đều pure function, không đụng DOM/fetch,
  có `module.exports` guard giống hệt `js/meeting-types.js`/`js/tags.js`/`js/parts.js` — đúng
  convention project đã xác lập.
- `index.html:121-122`: 2 script tag mới nằm SAU `parts.js`, TRƯỚC `import-preflight.js`,
  `storage.js`, và quan trọng nhất là TRƯỚC `import.js`/`app.js` (2 file thực sự gọi
  `MeetingDate`/`SummaryStaleness`) — thứ tự load không vỡ dependency, đã đọc toàn bộ khối script
  tag để xác nhận, không chỉ xem đoạn diff quanh 2 dòng mới.
- Quyết định tạo 2 file mới thay vì nhét vào file cũ: chấp nhận được — lý do Dev nêu (để có
  `node --test` trực tiếp, không phụ thuộc browser) hợp lý và nhất quán với pattern hiện có; đây
  đúng là loại thay đổi nhỏ nên note cho Tech Lead cân nhắc đưa vào Architecture.md module list ở
  lần review kiến trúc kế tiếp, không phải lỗi cần sửa ngay.

## Test suite — tự chạy độc lập
`npm test` (chạy trực tiếp, không dùng lại số Dev báo): **239 passing, 2 skipped, 0 failing** —
khớp chính xác báo cáo trong CHANGELOG. 2 skip là golden fixture Whisper/Google do thiếu API key
trên máy dev (Protocol 5.4, không liên quan tới 4 fix này).

## Đối chiếu các APPROVE trước đó (không phá vỡ gì)
- `js/recorder.js` và phần backup JSON (2 vòng review TV1-16, review atomic-backup) không nằm
  trong diff của đợt fix này — `git status`/CHANGELOG xác nhận 4 fix chỉ chạm
  `js/meeting-date.js` (mới), `js/summary-staleness.js` (mới), `js/import.js`, `js/app.js`,
  `js/import-preflight.js`, `js/parts.js`, `index.html`, và các file test tương ứng.
- Blocker Critical còn mở trong `project_state.json` (sự cố mất dữ liệu `storage/meetings.json`)
  không liên quan tới 4 fix này (đã lưu ý ở review trước) — không phải lý do chặn đợt review này,
  chỉ nhắc lại PM vẫn cần xử lý riêng.

## External contract verification
N/A — cả 4 fix đều là logic thuần phía client (không gọi STT/LLM provider, không thêm
`child_process.spawn`, không thêm endpoint `/api/*`).

## Đối chiếu baseline bảo mật (CLAUDE.md)
- Không thêm endpoint `/api/*` nào.
- Không đụng API key/keychain.
- Không có ID nào từ input người dùng chạm filesystem trong 4 fix này (toàn bộ là logic hiển
  thị/validate phía client, thao tác trên object `meeting` đã có sẵn trong bộ nhớ).
- Không có `child_process.spawn` mới.

## Issues Found

### Critical
(none)

### High
(none)

### Medium
(none)

### Low
- [ ] [js/parts.js:227-229, generic error branch] `detail` cho các mã lỗi khác `STT_TRANSCRIBE_FAILED`
  vẫn hiển thị nguyên message tiếng Anh của provider (`Nhà cung cấp báo: ${message}`) — đúng BR-104
  (mã lỗi/message chỉ ở dòng phụ, không phải headline, nên không vi phạm) nhưng vẫn là text tiếng
  Anh xen giữa câu tiếng Việt ở dòng phụ. Không chặn merge (đây là hành vi CŨ, không phải do 4 fix
  này gây ra, và BR-147 cũng chỉ yêu cầu text MỚI của feature phải tiếng Việt) — chỉ ghi chú để
  backlog xem có cần Việt hoá message của toàn bộ provider ở một đợt riêng.
- [ ] [docs/Architecture.md] `js/meeting-date.js`/`js/summary-staleness.js` chưa được thêm vào
  module list của Architecture.md (tự Dev đã flag trong CHANGENOG). Không chặn merge — đề nghị
  Tech Lead cập nhật ở lần review kiến trúc kế tiếp cho đồng bộ tài liệu.

## Positive Notes
- Cả 4 fix đều bám sát chính xác root cause đã mô tả trong `docs/test-report.md`, không có fix nào
  "vá triệu chứng" — ví dụ BUG-004 sửa đúng vào chỗ đọc field, không thêm debounce/workaround che
  triệu chứng.
- Ngưỡng BR-94 lấy đúng từ nguồn PRD (đã tự đối chiếu số, không tin lại lời Dev tự thuật) và dùng
  chung 1 hằng số duy nhất (`js/meeting-date.js`) cho cả 3 điểm áp dụng — tránh đúng kiểu bug "2
  nhánh lệch nhau" mà Protocol 8 cảnh báo.
- Test cho cả 4 fix đều assert giá trị cụ thể (chuỗi tiếng Việt chính xác, `null` object cụ thể,
  boundary chính xác từng mốc thời gian) chứ không chỉ "không throw"/"có gọi hàm" — đúng tinh thần
  Protocol 6.
- BUG-001 xử lý escape HTML đúng ở điểm dễ sai nhất (dữ liệu detail chứa message provider không
  tin cậy) — đã tự đọc kỹ dòng render, không chỉ tin lời Dev báo "đã sửa ở `_renderMultiPartSection`".
- CHANGELOG minh bạch 2 điểm tự quyết (partial-save khi date invalid, tạo file mới thay vì inline)
  kèm lý do rõ ràng — giảm thời gian review vì không phải đoán Dev có cân nhắc case đó chưa.

# Review Report — 2026-09-20 (DeepSeek "unreadable summary" on long/Brainstorming meetings)

## Verdict: REQUEST_CHANGES

Root cause verification (Protocol 5) đạt chuẩn — PM tái hiện bằng real call thật tới
`api.deepseek.com`, bắt đúng `finish_reason: "length"` + `completion_tokens: 8192` khớp default
docs, và verify lại fix bằng real call thứ hai (`finish_reason: "stop"`, đủ 6 section). Không có
issue Critical (không đụng baseline bảo mật 4 mục — không có endpoint mới, không đụng key/keychain,
không có filesystem path từ input client, không có `child_process`). Nhưng có 1 issue High về logic
(đã trace bằng tay qua `contracts.js`, không suy đoán) và 1 issue High cần Dev xác nhận trực tiếp
(không thể tự kết luận chỉ bằng đọc code) trước khi APPROVE.

## Issues Found

### High
- [ ] `server/llm/providers/deepseek.js:110-117` + `server/llm/contracts.js:159-177` (`withRepair`) —
  Lỗi truncation được throw bằng đúng `LLM_ERROR.INVALID_OUTPUT`. Nhưng `withRepair` bắt lỗi ở dòng
  164-165: `if (error.llmCode && error.llmCode !== LLM_ERROR.INVALID_OUTPUT) throw error;` — nghĩa
  là **mọi** lỗi mang code `INVALID_OUTPUT` (kể cả lỗi truncation mới thêm) đều rơi xuống nhánh
  "repair" và kích hoạt gọi lại `callModel(repairHint)` — tức 1 lần gọi API thật thứ hai, với đúng
  `max_tokens` cũ (không giảm nội dung cần sinh) và chỉ thêm prompt xin sửa JSON hợp lệ. Với 1 case
  bị cắt do vượt token budget, repair hint hoàn toàn không có tác dụng khắc phục (không giảm được số
  ý tưởng cần giữ) → gần như chắc chắn bị cắt lần 2, ném đúng lỗi "cut short" ra ngoài — kết quả cuối
  đúng, nhưng người dùng phải chờ thêm 1 lượt gọi DeepSeek thật đầy đủ (case repro gốc mất ~95s/lượt
  → gần gấp đôi latency) và tốn thêm ~đầy `max_tokens` token trả phí, một cách âm thầm, không log,
  không có trong CHANGELOG. Điều này ngược lại đúng tinh thần entry CHANGELOG tự mô tả ("Surface
  truncation as its own clear error instead of letting cut-off JSON fall through") — lỗi có "rõ" hơn
  nhưng chưa "sớm" hơn ở case thực sự vượt 32768 token output.
  2 unit test mới **không** phát hiện được gap này vì mock `global.fetch` không đếm số lần gọi (test
  ở dòng 71-92 chỉ assert lỗi cuối cùng đúng code/message, không assert `fetch` được gọi bao nhiêu
  lần) — nên test xanh dù có 1 hay 2 lượt gọi thật.
  → **Gợi ý sửa**: cho lỗi truncation bỏ qua nhánh repair của `withRepair` — ví dụ thêm 1 field kiểu
  `error.skipRepair = true` khi throw ở `deepseek.js`, và sửa điều kiện ở `contracts.js:165` thành
  `if (error.llmCode && (error.llmCode !== LLM_ERROR.INVALID_OUTPUT || error.skipRepair)) throw
  error;` (không cần thêm `LLM_ERROR` code mới, giữ nguyên status/retryable hiện có). Thêm 1 test
  đếm số lần `fetch` được gọi cho case `finish_reason: 'length'` để khoá lại hành vi "chỉ 1 lượt gọi
  thật khi chắc chắn không thể phục hồi bằng repair".

- [ ] `server/llm/providers/deepseek.js:16-17` (MODELS, `deepseek-reasoner`) — Fix áp dụng
  `max_tokens = Math.floor(spec.contextWindow / 2)` đồng nhất cho cả `deepseek-chat` và
  `deepseek-reasoner`, nhưng theo đúng bối cảnh PM cung cấp, việc verify bằng real call **chỉ** chạy
  trên `deepseek-chat` — `deepseek-reasoner` (thinking mode) chưa được verify riêng, kể cả smoke test
  mới (`test/deepseek-provider.test.js:97-113`) cũng chỉ gọi `model: 'deepseek-chat'`. Các model dạng
  "reasoning" ở nhiều provider khác (OpenAI o-series, v.v.) thường có ngân sách token riêng cho
  reasoning/thinking tách khỏi `max_tokens` của phần completion hiển thị — chưa có nguồn xác thực nào
  (đọc doc thật hoặc gọi thật) xác nhận DeepSeek Reasoner có cùng hành vi `max_tokens`/`finish_reason`
  như `deepseek-chat` hay không. Đây không hẳn vi phạm Process gate (không có Architecture.md nào ghi
  `[UNVERIFIED]` cho case này vì đây là bugfix, không qua bước Tech Lead), nhưng là 1 external-contract
  claim chưa verify đang được áp dụng âm thầm vào code thật cho 1 model thật user có thể chọn — đúng
  loại rủi ro Protocol 5 muốn chặn. Mục "Known issues" trong CHANGELOG entry hiện có ghi rõ gap tương
  tự cho Gemini nhưng **không** ghi gap này cho `deepseek-reasoner`, dù nó nằm trong đúng phạm vi file
  vừa sửa.
  → **Gợi ý sửa**: tối thiểu thêm 1 dòng vào mục "Known issues" của CHANGENLOG entry này ghi rõ
  `deepseek-reasoner` chưa được verify riêng cho hành vi `max_tokens`/`finish_reason`. Tốt hơn: chạy
  1 real call thật với `model: 'deepseek-reasoner'` (có thể dùng lại API key hiện có) để xác nhận
  cùng hành vi trước khi coi fix áp dụng an toàn cho cả 2 model.

- [ ] `test/deepseek-provider.test.js:78` — Chuỗi mock dùng để giả lập JSON bị cắt cụt:
  `'{"summary":"ok","keyPoints":["a","b September lo'` — comment ngay phía trên khẳng định "matching
  the SHAPE of the real captured truncation... without reusing any real user content", nhưng cụm
  `"b September lo"` không giống filler ngẫu nhiên thông thường (vd `"idea-1"`, `"idea-2"`) — nó đọc
  như 1 mảnh câu tiếng Anh bị cắt giữa chừng, và "September" là loại từ dễ xuất hiện trong nội dung
  cuộc họp thật (ngày tháng). Không thể tự kết luận đây có phải mảnh nội dung thật bị dán nhầm vào
  hay không chỉ bằng cách đọc code — cần Dev xác nhận trực tiếp nguồn gốc chuỗi này. Rủi ro nếu đúng
  là nội dung thật: vi phạm chính cam kết CHANGELOG tự đặt ra ("real meeting content... NOT committed
  here") và commit dữ liệu riêng tư của user thật vào git.
  → **Gợi ý sửa**: Dev xác nhận rõ chuỗi này là gõ tay 100% (không copy-paste từ output thật), và đổi
  sang 1 placeholder rõ ràng là giả (vd `"idea one","idea two","unterminated str`) để không còn nghi
  ngờ, dù giữ nguyên chức năng test (JSON cú pháp không hợp lệ, cắt giữa mảng).

### Medium
- [ ] `server/llm/providers/deepseek.js:74-77` (comment) — Comment giải thích lý do chọn
  `Math.floor(spec.contextWindow / 2)` viết: "matching the output headroom transcript-budget.js
  already reserves (INPUT_BUDGET_RATIO)". Đã đọc `server/llm/transcript-budget.js:14`:
  `INPUT_BUDGET_RATIO = 0.7` — nghĩa là input được phép dùng tới 70% context window, output headroom
  giả định bởi `inputBudget()` chỉ là ~30% (~19660 token cho model 65536), **không phải 50%** như
  comment khẳng định "matching". Comment hiện tại gây hiểu lầm rằng 2 con số đến từ cùng 1 ngân sách
  nhất quán trong khi thực tế không phải — dễ khiến người đọc sau này tưởng đã có 1 invariant được
  giữ (`input + output <= contextWindow`) trong khi thực tế input tối đa (45875 token, ứng với 70%)
  cộng output tối đa mới (32768 token, 50%) có thể cộng lại vượt `contextWindow` khai báo (65536) tới
  ~13107 token trong trường hợp xấu nhất. PM đã verify thực tế 1 case (`prompt_tokens=35638` +
  `max_tokens=60000`) không lỗi 400, nên rủi ro vận hành có vẻ thấp, nhưng đó là câu trả lời cho "có
  lỗi không", không phải "comment có đúng không".
  → **Gợi ý sửa**: sửa lại comment cho khớp thực tế (ví dụ: "chosen as a generous fixed fraction,
  independent of transcript-budget.js's INPUT_BUDGET_RATIO — verified in practice not to trigger a
  400 even when prompt + max_tokens exceeds the declared contextWindow, see CHANGELOG") thay vì dùng
  từ "matching" cho 2 con số không khớp nhau.

## External contract verification
YES (nguồn: real call thật tới `https://api.deepseek.com/chat/completions` bằng key thật từ macOS
Keychain, cả trước và sau fix, cho model `deepseek-chat` — xác nhận `finish_reason`/`completion_tokens`
đúng như PM mô tả, đối chiếu thêm với `api-docs.deepseek.com` 2026-09-20 cho default `max_tokens`
8K. Riêng `deepseek-reasoner`: NO — chưa có real call nào verify riêng, xem issue High ở trên.)

## Positive Notes
- Root cause được xác nhận bằng real call thật (đúng Protocol 5), không đoán từ tên field hay suy
  luận lý thuyết — trích dẫn cụ thể `finish_reason`/`completion_tokens` khớp chính xác con số default
  8192, là bằng chứng mạnh, không phải correlation ngẫu nhiên.
- `console.warn('[deepseek.output_truncated] ...')` đã tự kiểm tra lại dòng code thật
  (`server/llm/providers/deepseek.js:111`): chỉ log `model`/`maxTokens`/`completionTokens`, không có
  biến nào chứa nội dung cuộc họp/transcript/prompt — xác nhận đúng như PM khẳng định, không phải tin
  theo lời khai. Format cũng khớp đúng convention log hiện có (`[summary.unknown_key] ...` trong
  `preset-schema.js` §7) — không tự chế 1 kiểu logging mới.
- Giá trị `max_tokens` mới không gây lỗi 400 mới: PM đã tự verify bằng real call với `max_tokens`
  lớn hơn nhiều headroom còn lại (60000) — đúng kỷ luật kiểm chứng thay vì để lại rủi ro tiềm ẩn chưa
  biết.
- CHANGENLOG entry rất đầy đủ: có "Known issues" chủ động flag gap chưa xử lý ở Gemini
  (`server/llm/providers/gemini.js`) theo đúng tinh thần Protocol 8 thay vì im lặng bỏ qua — chỉ thiếu
  đúng 1 gap tương tự cho `deepseek-reasoner` như đã nêu ở issue High.
  Không đụng vào Codex/Gemini dù về mặt kỹ thuật có thể tiện tay sửa luôn — giữ đúng phạm vi bug report
  gốc.
- Test mới không viết mock tuỳ tiện: comment tự giải thích rõ mocked response shape dựa trên contract
  OpenAI-compatible codebase đã dùng sẵn (`body?.choices?.[0]`), không phải claim mới về DeepSeek —
  đúng tinh thần Protocol 5.3 (mock không tự bịa theo giả định riêng). Smoke test thật có skip rõ lý
  do khi thiếu key, đúng convention đã có ở `test/stt-golden.test.js`.
- `npm test` xanh toàn bộ (242 pass, 2 skip pre-existing, 0 fail) — đã tự chạy lại xác nhận không có
  gì trong diff làm vỡ test khác ngoài phạm vi sửa.

# Review Report — 2026-09-20 round 2 (DeepSeek fix, Dev↔Reviewer round 1/3 hoàn tất)

## Verdict: APPROVE

Đã đọc lại `git diff server/llm/contracts.js server/llm/providers/deepseek.js`, đọc lại toàn bộ
`test/deepseek-provider.test.js`, và đọc đoạn CHANGENLOG "Dev↔Reviewer round 1 fixes" — trace bằng
tay từng issue trước đó, không tin theo mô tả của Dev:

1. **withRepair retry lãng phí** — đã fix đúng cơ chế, không phải patch cục bộ: `skipRepair` thêm
   vào `llmError()` meta dùng chung cho mọi provider (`server/llm/contracts.js:52`), `withRepair`
   rethrow ngay khi `error.skipRepair` true (`contracts.js:172`, đã đọc lại điều kiện mới:
   `error.llmCode !== LLM_ERROR.INVALID_OUTPUT || error.skipRepair`) — đúng, không còn rơi vào nhánh
   repair. `deepseek.js` set `skipRepair: true` khi throw lỗi truncation. Test mới đếm
   `fetchCallCount`, assert đúng bằng 1 (`test/deepseek-provider.test.js:90-120`) — đã tự chạy
   `npm test` độc lập (không chỉ tin số Dev báo): **245 total, 243 pass, 2 skip pre-existing, 0
   fail** — khớp đúng claim.
2. **`deepseek-reasoner` chưa verify** — cách sửa đúng tinh thần deny-by-default (Protocol 8):
   không cố áp `max_tokens` mới lên 1 model chưa verify, mà **giữ nguyên hành vi cũ** (không set
   `max_tokens`) cho `deepseek-reasoner`, chỉ scope override vào đúng
   `spec.id === 'deepseek-chat'` (`deepseek.js:90`). Đã tự kiểm chứng: khi `maxTokens` là
   `undefined`, `JSON.stringify` bỏ hẳn key `max_tokens` khỏi request body (không gửi
   `"max_tokens":null`) → đúng như hành vi trước khi có fix, không thoái lui. Test mới
   (`test/deepseek-provider.test.js:71-88`) assert đúng field này `undefined` cho reasoner. Claim
   "default 64K" trong comment/CHANGENLOG có hedge rõ ràng "no real call... has been made to check"
   — đúng disclosure Protocol 5, và quan trọng hơn: code không dựa vào con số 64K đó để quyết định
   gì cả (chỉ dùng để giải thích lý do KHÔNG động vào), nên kể cả con số đó sai thì cũng không có
   rủi ro hành vi mới. Không thấy Known-issues bullet riêng cho việc này trong CHANGELOG, nhưng
   thông tin đã nằm đầy đủ, dễ tìm trong chính bullet "round 1 fixes" — đủ đáp ứng ý ban đầu, không
   cần yêu cầu sửa thêm.
3. **Chuỗi test mơ hồ** — đã thay bằng `"placeholder-item-one"`/`"placeholder-item-tw` (cắt giữa
   từ, không còn đọc như mảnh câu tiếng Anh thật) kèm comment phủ định trực tiếp
   ("NOT derived from any real meeting"). Dev cũng tự thừa nhận rõ ràng đây là lỗi chọn từ dở của
   chính mình, không né tránh câu hỏi — chấp nhận được.
4. **Comment sai lệch INPUT_BUDGET_RATIO** — đã đọc lại comment mới (`deepseek.js:67-80`): không
   còn dùng từ "match", giải thích đúng: mức reserve ~30% (~19.7K) đã đo được là không đủ so với
   nhu cầu thật (~26-27K), nên chọn half-window rộng rãi hơn có chủ đích — khớp đúng số liệu đã có
   trong CHANGENLOG gốc, không có claim mới nào chưa verify.

Không phát sinh issue mới khi đọc lại toàn bộ diff (kể cả phần không đổi) — `finish_reason ===
'length'` check vẫn áp dụng cho cả 2 model (kể cả reasoner dùng default riêng của DeepSeek), nghĩa
là nếu reasoner cũng bị cắt thì vẫn được báo lỗi rõ ràng thay vì rơi về generic — cải thiện thêm mà
không cần ép `max_tokens`, hợp lý.

## Issues Found
Không còn issue Critical/High/Medium/Low nào mở từ 2 vòng review. 4/4 issue vòng 1 đã đóng, có bằng
chứng cụ thể (diff + test + npm test tự chạy lại), không chỉ tin lời khai của Dev.

## External contract verification
YES (nguồn: real call thật của PM tới `api.deepseek.com` cho `deepseek-chat`, trước/sau fix, cộng
`api-docs.deepseek.com` cho default 8K/64K) cho phần đã áp dụng vào code (`deepseek-chat`).
`deepseek-reasoner`: N/A cho phần `max_tokens` — code cố tình không động vào (deny-by-default,
không áp dụng contract chưa verify), nên không có claim chưa-verify nào đang chạy trong production
path của model đó.

## Positive Notes
- Không có fix nào chỉ vá triệu chứng: `skipRepair` sửa đúng ở tầng `contracts.js` dùng chung, không
  phải if-else riêng trong `deepseek.js` — sửa đúng root cause, tự động có lợi cho provider khác nếu
  sau này gặp case tương tự.
- Xử lý gap `deepseek-reasoner` bằng cách **không hành động** (giữ nguyên default) thay vì đoán 1 số
  mới rồi áp đặt — đúng tinh thần "chưa rõ → SKIP" của Protocol 8, dù Protocol 8 vốn viết cho use
  case nhiều biến thể pipeline, tinh thần áp dụng đúng ở đây.
- Dev thừa nhận thẳng lỗi chọn từ filler dở ở vòng 1 thay vì biện minh, sửa nhanh gọn.
- Vòng lặp Dev↔Reviewer dùng đúng 1/3 round theo Protocol 3, có ghi rõ trong CHANGENLOG
  ("Protocol 3, 1/3 rounds used") — minh bạch, đúng quy trình Protocol 4 (state) lẫn Protocol 1
  (structured handoff).
