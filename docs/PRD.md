# PRD — Pre-meeting Context, Notes-aware Summary, Export & Tags (MeetNote)

**Trạng thái**: Draft, chờ duyệt Checkpoint 1
**Phiên bản**: 2.0
**Ngày**: 2026-09-18
**Feature trước** (`summary-presets`, PRD v1.1) đã **PASS QA**, xem lịch sử tại `docs/CHANGELOG.md` và `docs/test-report.md` — không bị ảnh hưởng bởi feature này.

## 1. Mô tả sản phẩm

Sáu thay đổi liên kết với nhau, cùng phục vụ mục tiêu "biên bản họp sát thực tế hơn và dễ dùng lại hơn":

1. **Pre-meeting info** (tùy chọn): thêm loại cuộc họp, chủ đề, người chủ trì bên cạnh `participants` đã có sẵn.
2. **Notes làm ngữ cảnh AI, có quyền ghi đè khi transcript nhận nhầm**: trường "Ghi chú" đã có (hiện chỉ hiển thị) được đưa vào prompt tóm tắt, kèm bộ **nguyên tắc tóm tắt bắt buộc** mới (chính xác, không suy diễn, phân biệt đã chốt/đang bàn/ý kiến cá nhân, gắn tên người nói...).
3. **Xuất biên bản .md**: server ghi file trực tiếp vào thư mục do người dùng cấu hình sẵn trong Settings (không dùng hộp thoại Save-As của trình duyệt). **Không làm .docx** (quyết định user — xem D-2).
4. **Gợi ý preset tóm tắt theo loại cuộc họp**: tận dụng `meetingType` mới để tự chọn sẵn preset phù hợp trong dropdown (feature `summary-presets`).
5. **Thay bộ preset mẫu**: 10 preset chuyên biệt theo loại cuộc họp (`docs/preset-templates.md`, user cung cấp) thay cho 4 preset mẫu gốc (General Meeting/Sales Call/Technical Standup/Interview) của feature `summary-presets`.
6. **Tag cho bản ghi**: gắn nhiều tag tự do (có gợi ý) cho mỗi meeting, tự động gắn thêm 1 tag theo `meetingType`, và 4 cách hiển thị đi kèm trong thư viện: chip màu trên mỗi dòng, thanh lọc theo tag, tag vào tìm kiếm toàn cục, và chế độ xem nhóm theo tag.

## 2. Quyết định đã chốt với user (Checkpoint sơ bộ, trước khi viết PRD)

| # | Vấn đề | Quyết định |
|---|---|---|
| D-1 | Cơ chế "chọn nơi lưu" khi export | **Server ghi file trực tiếp** vào thư mục cấu hình sẵn trong Settings — không dùng File System Access API / Save-As dialog của trình duyệt (không chạy được trên mọi trình duyệt, không lưu được path mặc định). |
| D-2 | Cách tạo file .docx | **Bỏ hẳn — không xuất .docx** (quyết định user). Chỉ hỗ trợ .md ở feature này. Loại bỏ luôn rủi ro thêm dependency `docx` và rủi ro phá bản đóng gói DMG/EXE (không còn cần Tech Lead quyết R-A nữa). |
| D-3 | Nơi nhập pre-meeting info | Lúc tạo meeting / bắt đầu ghi âm (không bắt buộc), sửa được sau tại Meeting Detail. |
| D-4 | Tính năng gộp thêm vào scope | **Gợi ý preset theo loại cuộc họp**. Hai ý còn lại (dashboard action items xuyên suốt các cuộc họp; soạn sẵn email follow-up) chuyển vào mục 9 "Ý tưởng tương lai", **không** implement đợt này. |
| D-5 | Xác định "ai nói gì" trong transcript (nhãn gốc chỉ có "Speaker 1", "Speaker 2"...) | User chỉ thị trực tiếp: **để LLM tự suy luận tên người nói ngay trong lúc tóm tắt**, dựa vào participants + cách xưng hô trong transcript; không xác định được → ghi `[chưa rõ người nói]`. Không làm bước xử lý/API riêng, không có UI đổi tên speaker riêng ở v1 (xem BR-62). Sai → sửa qua `notes` rồi Generate lại (không thêm UI sửa tay). |
| D-6 | Transcript nhận dạng sai (số liệu/tên riêng) | **Notes có quyền ghi đè transcript** khi transcript nghe nhầm — không chỉ "xác nhận khi đã rõ ràng" như bản nháp trước, mà notes được ưu tiên hơn transcript đối với đúng phần nội dung notes đề cập tới (BR-63 đã cập nhật). |
| D-7 | Định dạng tên file export | `[yymmdd]-[chủ đề cuộc họp]-[tính chất cuộc họp viết tắt]` thay cho mẫu tên-cuộc-họp trước đó (BR-45 đã cập nhật). |
| D-8 | Bộ preset mẫu | Thay bằng 10 preset trong `docs/preset-templates.md` (nguồn: user cung cấp) — xem mục 4A mới và BR-64. |
| D-9 | Kiểu tag | Kết hợp: gợi ý tag đã dùng (autocomplete) nhưng vẫn cho gõ tự do tag mới, không giới hạn danh sách cố định (BR-68/69). |
| D-10 | Hiển thị tag | Cả 4 hình thức: chip màu trên dòng meeting, thanh lọc theo tag, tag vào search toàn cục, chế độ xem nhóm theo tag (BR-71→74). |
| D-11 | Quan hệ tag ↔ `meetingType` | Tự động gắn 1 tag theo `meetingType` khi chọn; tag và meetingType vẫn là 2 field độc lập, xóa tag không ảnh hưởng `meetingType` (BR-70). |

## 3. User Stories

**US-6**: Là người dùng, tôi muốn ghi loại cuộc họp/chủ đề/người chủ trì (tùy chọn) khi tạo meeting, để có thêm ngữ cảnh và tự động gợi ý preset phù hợp.

**US-7**: Là người dùng, tôi muốn tìm lại cuộc họp bằng chủ đề hoặc người chủ trì, không chỉ bằng tiêu đề.

**US-8**: Là người dùng, tôi muốn nội dung tôi ghi trong "Ghi chú" (tên viết tắt, mục tiêu họp, thông tin đúng mà transcript nghe nhầm) được AI dùng khi tóm tắt, thay vì chỉ đọc transcript.

**US-9**: Là người dùng, tôi muốn bản tóm tắt AI trung thực với transcript — không suy diễn, không tự "làm cho đầy đủ", phân biệt rõ cái gì đã chốt và cái gì mới chỉ bàn.

**US-10**: Là người dùng, tôi muốn xuất biên bản ra file .md lưu thẳng vào thư mục tôi đã chọn sẵn, không phải chọn nơi lưu thủ công mỗi lần.

**US-12**: Là người dùng, tôi muốn dropdown chọn preset tự nhảy tới preset phù hợp khi tôi đã khai loại cuộc họp, để đỡ phải chọn tay preset mỗi lần.

**US-13**: Là người dùng, tôi muốn gắn nhiều tag tự do cho mỗi cuộc họp (ví dụ "khách VIP", "ưu tiên Q4") và lọc/xem lại thư viện theo tag, để tìm lại nhanh nhóm cuộc họp liên quan mà không phụ thuộc vào tiêu đề hay loại cuộc họp cố định.

## 4. Business Rules

*(Tiếp nối đánh số từ `summary-presets`, kết thúc ở BR-22. Không rule nào dưới đây được phép phá vỡ BR-1 → BR-22, đặc biệt BR-15 → BR-20 về snapshot preset.)*

### A. Trạng thái hiện tại đã verify (để Tech Lead/Dev không phải đoán lại)

| Điểm | Kết quả verify | Nguồn |
|---|---|---|
| `participants` | Đã tồn tại, `string[]`, nhập ở New Meeting dạng chuỗi phân tách dấu phẩy, sanitize ≤ 200 phần tử × ≤ 200 ký tự. Tái sử dụng, không phải field mới. | `js/storage.js:160,407-409`; `js/app.js:709-711,790-791,811-812` |
| `notes` | Đã tồn tại, free-text ≤ 200.000 ký tự, hiện chỉ dùng cho tab Notes + search + export Markdown. Chưa từng vào prompt LLM. | `js/storage.js:169,443,303-307`; `js/app.js:1461-1463,1781-1789`; không có tham chiếu `notes` trong `server/llm/prompts.js` |
| Prompt hiện tại | 3 builder đều nhúng Title/Date/Duration/Participants vào `<meeting_data>`; `buildChunkPrompt` chỉ có Title + Participants. | `server/llm/prompts.js:97-105,153-159,184-189` |
| Speaker label gốc | STT trả về nhãn chung ("1", "2"...), hiển thị "Speaker 1"/"Speaker 2", không có tên thật. | `server/stt/contracts.js:107`; `js/app.js:972` |
| Export hiện tại | `toMarkdown` đã render theo snapshot preset (BR-16) và đã có mục Notes; xuất bằng `Blob` + `<a download>` (browser tự tải về Downloads), tên file `title.replace(/[^a-zA-Z0-9]/g,'_')` — không đọc được với tiêu đề tiếng Việt có dấu. | `js/export.js:22-34,60-66,128-147` |
| Ghi file phía server | Server hiện **chỉ** ghi trong `STORAGE_DIR`; mọi tên file artifact qua hash SHA-256 để chặn path traversal. | `server.js:18-33,323-329`; CLAUDE.md §Bảo mật |
| Đóng gói portable | `build-dmg.sh`/`build-exe.sh` copy danh sách trắng cố định (`server.js server index.html css js schemas package.json`) — **không có `node_modules`**. `package.json` hiện không có `dependencies`. | `macos/build-dmg.sh:45`, `windows/build-exe.sh:38`, `package.json` |

**Hệ quả quan trọng của dòng cuối**: thêm npm package `docx` mà không sửa 2 script đóng gói → bản DMG/EXE vĩnh viễn thiếu tính năng .docx dù bản chạy từ source có đủ. Xem R-A ở mục 8 — Tech Lead phải quyết trước khi Dev bắt đầu phần .docx.

### B. Pre-meeting info

- **BR-23**: Meeting có thêm 3 field tùy chọn: `meetingType` (mã cố định, bảng BR-25), `topic` (chủ đề, free-text), `leadBy` (người chủ trì, free-text). Cùng `participants` sẵn có, 4 field hợp thành "Pre-meeting info". Không field nào bắt buộc.
- **BR-24**: Pre-meeting info không bao giờ chặn "Start Recording"/"Save as Draft". Mọi field bổ sung được sau tại Meeting Detail.
- **BR-25**: `meetingType` là **mã ổn định**, không phải nhãn hiển thị. Bảng mã khớp 1-1 với 10 preset mẫu mới ở BR-64/`docs/preset-templates.md` — mỗi mã có thêm **viết tắt** dùng riêng cho tên file export (BR-45).

| Mã lưu | Nhãn hiển thị | Preset mẫu tương ứng (BR-55, BR-64) | Viết tắt (BR-45) |
|---|---|---|---|
| `general` | General Meeting | General Meeting | `GM` |
| `giao-ban` | Họp giao ban | Họp giao ban | `GB` |
| `kinh-doanh` | Họp phòng kinh doanh | Họp phòng kinh doanh | `KD` |
| `marketing` | Họp phòng marketing | Họp phòng marketing | `MKT` |
| `brainstorm` | Brainstorming | Brainstorming | `BS` |
| `hdqt` | Họp HĐQT | Họp HĐQT | `HDQT` |
| `sales-call` | Sales call | Sales call | `SC` |
| `training` | Training | Training | `TR` |
| `rnd` | R&D sản phẩm | R&D sản phẩm | `RD` |
| `okr` | OKR — xây dựng & check-in | OKR — xây dựng & check-in | `OKR` |
| `''` (rỗng) | *(chưa chọn)* | *(không gợi ý)* | *(bỏ segment viết tắt khỏi tên file)* |

  10 mã trùng khít tên 10 preset mẫu ở BR-64 — điều kiện để BR-55 hoạt động không cần bảng ánh xạ riêng. **Thay thế hoàn toàn** bảng `meetingType` cũ (`technical-standup`/`interview`/`one-on-one`/`client-call`/`workshop`/`other`) từng dự kiến khớp 4 preset gốc của `summary-presets` — bảng đó **chưa từng được Dev implement** (PRD trước ở trạng thái Draft khi bị thay), nên đây không phải migration dữ liệu, chỉ là chốt lại bảng mã trước khi code.
- **BR-26**: Validate ở cả client và server: `topic` ≤ 200 ký tự, `leadBy` ≤ 200 ký tự, `meetingType` phải thuộc tập BR-25. Vượt quá → cắt bớt, không chặn lưu (đây là metadata phụ trợ).
- **BR-27**: `meetingType` giá trị lạ (import backup cũ, sửa tay file JSON) → quy về `''` (chưa chọn), không quy về `general` — tránh gợi ý preset sai ở BR-55.
- **BR-28**: `leadBy` không tự động thêm vào `participants`. Nếu `leadBy` không rỗng và không khớp phần tử nào của `participants` (so trim + không phân biệt hoa/thường) → gợi ý mềm 1 lần "Thêm vào danh sách người tham dự?", bỏ qua được, không nhắc lại.
- **BR-29**: Sửa Pre-meeting info sau khi đã có summary → không tự sinh lại summary, không đổi summary/snapshot đã lưu (nhất quán BR-17). Chỉ ảnh hưởng lần Generate tiếp theo; hiển thị nhắc nhẹ khi thông tin mới hơn lần generate gần nhất.
- **BR-30**: Thêm vào tìm kiếm toàn cục: `topic` khớp +4 điểm, `leadBy` khớp +3 điểm, nhãn `meetingType` khớp +2 điểm (thang điểm hiện có: title 10, transcript 5, action 4, notes/summary 3 — `js/storage.js:279-327`).
- **BR-31**: Pre-meeting info có trong backup JSON và trong file export. Import backup thiếu field → mặc định `''`, không lỗi.

### C. `notes` làm ngữ cảnh cho AI + nguyên tắc tóm tắt bắt buộc

- **BR-32**: Khi `notes.trim()` khác rỗng, nội dung được đưa vào **cả 3 builder**: `buildSummaryPrompt`, `buildChunkPrompt`, `buildSynthesisPrompt`. Một builder áp dụng được mà builder khác không → chặn Generate và báo lỗi rõ (nhất quán BR-11 — không âm thầm mất ngữ cảnh ở cuộc họp dài phải map-reduce).
- **BR-33**: `notes` được chèn trong khối dữ liệu **không tin cậy** (cùng cơ chế chống prompt-injection hiện có, `prompts.js:13-17`) — vì người dùng hay dán nội dung từ email/chat ngoài vào notes.
- **BR-34**: Vai trò của notes: giúp hiểu đúng ngữ cảnh (tên riêng, viết tắt, mục tiêu họp) và **xác nhận/sửa** giá trị transcript nghe nhầm (BR-63). **Cấm** dùng notes để tạo ra sự kiện/quyết định/action item chưa từng xuất hiện trong transcript dưới bất kỳ hình thức nào — khi transcript và notes mâu thuẫn về một nội dung mà notes không nêu rõ, giữ nguyên bản transcript kèm `[?]` (BR-63).
- **BR-35**: Chỉ 4.000 ký tự đầu của `notes` vào prompt, cắt ở ranh giới xuống dòng gần nhất; vượt quá → cảnh báo mềm trước khi Generate, không chặn. *(Ngưỡng phán đoán thận trọng, QA có thể đề xuất chỉnh sau khi có dữ liệu thật, giống tinh thần BR-7.)*
- **BR-36**: `notes` rỗng/chỉ khoảng trắng → bỏ hẳn khối notes khỏi prompt, giữ nguyên hành vi hôm nay — không gửi khối rỗng để LLM khỏi "cố tìm" ngữ cảnh không tồn tại.
- **BR-37**: Pre-meeting info vào phần header `<meeting_data>` của cả 3 builder: `Meeting type`, `Topic`, `Lead by`. Field rỗng → bỏ dòng đó, không in "Unknown". `buildChunkPrompt` bổ sung `Meeting type` + `Topic` (không thêm `Date/Duration`, không liên quan nội dung chunk).
- **BR-38**: Độ dài khối notes + pre-meeting info phải tính vào ngân sách chunk của map-reduce: mở rộng công thức `Architecture.md §5.3` (`2000 + estimateTokens(sectionsBlock)`) thành `2000 + estimateTokens(sectionsBlock) + estimateTokens(contextBlock)` — nếu không, prompt chunk có thể vượt context window đúng ở những cuộc họp dài nhất.
- **BR-39**: `summaryGeneration` ghi thêm cờ provenance `contextUsed: { notes: true|false, notesTruncated: true|false, preMeeting: true|false }` — để giải thích vì sao 2 lần Generate cùng preset cho kết quả khác nhau. Không thuộc snapshot preset (BR-16) — mô tả input, không mô tả cấu trúc output.
- **BR-61 — Nguyên tắc tóm tắt bắt buộc** *(nguồn xác thực duy nhất: khối "BLOCK DÙNG CHUNG" trong `docs/preset-templates.md` — không copy lại nội dung ở đây để tránh 2 nơi lệch nhau theo thời gian; đưa vào prompt của `buildSummaryPrompt` và `buildSynthesisPrompt` — bước tạo ra kết luận cuối cùng)*. Tóm tắt các điểm chính (xem file để lấy nguyên văn khi implement): viết bằng tiếng Việt, giữ nguyên thuật ngữ tiếng Anh gốc; chỉ ghi đúng nội dung có trong transcript, không suy diễn; số liệu/tên riêng chép chính xác, nghe không rõ ghi `[?]`; được sửa chính tả không được sửa nghĩa; gắn tên người nói (BR-62); phân biệt ĐÃ CHỐT / ĐANG BÀN / Ý KIẾN CÁ NHÂN; bỏ chào hỏi và lặp lại; việc cần làm phải đủ người-hạn chót; mục rỗng ghi "Không có"; văn phong ngắn gọn.

  `buildChunkPrompt` (trích xuất từng đoạn, chưa phải kết luận cuối) áp dụng **tập con** tương thích với việc trích xuất: chính xác số liệu/tên riêng + `[?]` khi nghe không rõ, sửa chính tả nhưng không sửa nghĩa, gắn tên người nói theo BR-62, bỏ chào hỏi/lặp lại. **Không** áp phần phân loại ĐÃ CHỐT/ĐANG BÀN/Ý KIẾN CÁ NHÂN và "không có nội dung → ghi Không có" ở bước chunk — kết luận toàn cục (1 ý được chốt hay chưa) chỉ có ý nghĩa ở `buildSynthesisPrompt` sau khi đã thấy hết các đoạn.
- **BR-62 — Gắn tên người nói**: Việc suy luận "Speaker N = tên thật" diễn ra **ngay trong prompt tóm tắt** (BR-61), dựa vào danh sách `participants` (BR-37) và cách xưng hô/gọi tên trong chính transcript. **Không** làm bước xử lý/lệnh gọi LLM riêng, **không** có UI đổi tên speaker thủ công ở v1 — quyết định trực tiếp của user (mục 2, D-5), thay cho việc tách thành 1 tính năng "speaker identification" độc lập. Không suy luận được → ghi `[chưa rõ người nói]`, không đoán đại 1 cái tên trong danh sách participants. Suy luận sai hoặc ghi `[chưa rõ người nói]` mà người dùng biết rõ ai đã nói → **không có UI sửa tên speaker riêng ở v1** (quyết định user, tránh phát sinh thêm 1 tính năng ở tab Transcript ngoài scope); cách sửa là ghi rõ vào `notes` (vd: "Speaker 2 là chị Lan") rồi Generate lại — LLM đọc notes và tự áp dụng theo BR-63.
- **BR-63 — Notes có quyền ghi đè transcript khi nhận dạng sai** *(cập nhật theo chỉ thị trực tiếp của user — mạnh hơn bản nháp đầu)*: Khi một giá trị trong transcript (số liệu, tên riêng, thuật ngữ, tên người) khác với thông tin tương ứng ghi trong `notes`, **ưu tiên bản trong `notes`** — coi đây là do transcript (bản ghi tự động) bắt nhầm, không phải do nội dung cuộc họp thực sự khác. Dùng thẳng giá trị từ `notes`, không cần đánh dấu `[?]` hay ghi chú gì thêm cho phần đã được notes xác nhận/sửa. Áp dụng cho *đúng phần nội dung notes có đề cập tới* — notes đề cập chung chung, không xác định được là ứng với giá trị nào đang nghi ngờ trong transcript → không tính là ghi đè, vẫn giữ transcript kèm `[?]` như bình thường. Ranh giới với BR-34 giữ nguyên: notes chỉ được **sửa** cái transcript đã thực sự nói ra (dù có thể nói sai/bị nghe nhầm), **không** được dùng để **bổ sung** một sự kiện/quyết định/action item mà transcript hoàn toàn không nhắc tới dưới bất kỳ hình thức nào — ghi đè khác với bịa đặt: ghi đè cần transcript đã có 1 giá trị (dù nghi ngờ) tại đúng vị trí đó, bịa đặt là tạo ra nội dung không tồn tại ở đâu trong transcript.

### D. Export ra .md (server ghi file trực tiếp)

*(Không làm .docx — quyết định user, D-2. Toàn bộ rủi ro/dependency liên quan `.docx` ở bản nháp trước đã loại bỏ.)*

**D1. Cấu hình thư mục**
- **BR-40**: Settings có 1 mục: thư mục lưu file export .md.
- **BR-41** *(câu chữ đã sửa tại Checkpoint 2 — E-1, theo đề xuất Tech Lead, PM đã xác nhận)*: Client không bao giờ gửi đường dẫn/thư mục đích trong request export — chỉ gửi `meetingId` + **nội dung markdown đã render sẵn ở client** (tránh viết lại renderer summary sang Node, nguy cơ 2 nơi lệch nhau — Protocol 6) (+ tùy chọn kèm transcript, BR-54). Server tự đọc thư mục đích từ cấu hình export riêng (Architecture.md §export-settings), tự sinh tên file, tự ghi. Đây là lần đầu app ghi ra ngoài `STORAGE_DIR` — nguyên tắc bảo mật cốt lõi (client không chọn *nơi* ghi) không đổi; chỉ *nội dung* file mới được gửi từ client.
- **BR-42**: Thư mục hợp lệ khi: (a) đường dẫn tuyệt đối; (b) ≤ 400 ký tự; (c) không chứa `\0`; (d) sau khi resolve không nằm trong `STORAGE_DIR` và không nằm trong thư mục cài đặt app (tránh bị `removeStaleArtifacts`/`clearDirectory` hiện có dọn mất, hoặc ghi vào bundle chỉ đọc trên macOS); (e) thư mục tồn tại hoặc thư mục cha tồn tại và tạo được. Vi phạm → chặn lưu Settings, báo lý do cụ thể bằng tiếng Việt.
- **BR-43**: Khi lưu Settings, server kiểm tra quyền ghi thật (ghi rồi xóa 1 file thăm dò). Thất bại → chặn lưu. Kiểm tra lại **mỗi lần export** (thư mục/ổ đĩa có thể đổi giữa chừng).
- **BR-44**: Gợi ý sẵn `<home>/Documents/MeetNote` trong ô nhập, nhưng chỉ tạo thật khi người dùng bấm lưu Settings hoặc export lần đầu. Chưa cấu hình mà bấm Export → mở thẳng Settings tương ứng kèm giải thích, không báo lỗi cụt.

**D2. Tên file và ghi đè**
- **BR-45** *(định dạng theo chỉ thị user, D-7 — thay hoàn toàn mẫu tên-cuộc-họp ở bản nháp trước)*: Tên file `<yymmdd>-<chủ-đề-đã-làm-sạch>-<viết-tắt-loại-họp>.md`, ghép 3 phần bằng dấu `-`:
  1. `yymmdd`: 6 chữ số từ `meeting.date` (giờ địa phương của máy).
  2. Chủ đề: ưu tiên `topic` (BR-23); `topic` rỗng → dùng `title` cuộc họp. Làm sạch: bỏ dấu tiếng Việt về ASCII, khoảng trắng/ký tự khác → `-`, gộp `-` liên tiếp, trim 2 đầu, cắt ≤ 60 ký tự, rỗng → `hop`.
  3. Viết tắt loại họp: tra bảng BR-25 theo `meetingType`. `meetingType` rỗng → **bỏ hẳn phần này**, tên file chỉ còn 2 phần `<yymmdd>-<chủ-đề>.md`.

  Trùng reserved name Windows (`CON`, `PRN`, `NUL`, `COM1-9`, `LPT1-9`, không phân biệt hoa/thường, sau khi ghép đủ 3 phần) → thêm hậu tố `_`. *(Mẫu tên cũ dựa theo tiêu đề cuộc họp của `js/export.js:145` — biến "Họp chốt giá Q4" thành `H_p_ch_t_gi__Q4` — không còn dùng nữa; format mới lấy chủ đề + loại họp theo đúng yêu cầu, và cũng nhân tiện tránh luôn lỗi làm sạch cũ vì slug dùng `-` có xử lý dấu tiếng Việt tử tế hơn.)*
- **BR-46**: File trùng tên → **không ghi đè**, tự thêm hậu tố ` (2)`…` (99)`; vượt 99 → báo lỗi, đề nghị đổi tên meeting hoặc dọn thư mục. *(Ưu tiên không mất dữ liệu người dùng đã sửa tay trên bản Word cũ, hơn là gọn số lượng file.)*
- **BR-47**: Ghi file kiểu atomic (ghi file tạm trong cùng thư mục đích rồi rename). Lỗi ở bất kỳ bước nào → xóa file tạm, không để lại file mang tên đích bị hỏng/rỗng. *(Xác nhận tại Checkpoint 2 — E-3, đo thật của Tech Lead: thư mục đồng bộ cloud (Google Drive/OneDrive) đang offline có thể treo `ETIMEDOUT` ngay ở bước tạo/ghi file. Bổ sung timeout + báo lỗi rõ "Thư mục không phản hồi" thay vì treo vô hạn — không hạ yêu cầu atomic cho trường hợp ghi được bình thường.)*
- **BR-48** *(phạm vi v1 đã xác nhận tại Checkpoint 2 — E-2)*: Export thành công → thông báo hiển thị **đường dẫn đầy đủ** file vừa ghi. **macOS**: kèm nút "Mở thư mục" thật (đã verify bằng `open`, `shell:false`, an toàn với path chứa ký tự đặc biệt). **Windows**: v1 chỉ có nút "Copy đường dẫn" — mở Explorer bằng `spawn`/`shell:false` chưa verify được trên máy thật (U2, Architecture.md §14), chặn triển khai nhánh Windows của nút "Mở thư mục" cho tới khi Dev có log thật từ máy Windows; không chặn phần còn lại của export. Nút "Mở thư mục"/"Copy đường dẫn" chỉ thao tác đúng thư mục đã cấu hình sẵn phía server, không bao giờ nhận path từ client.

**D3. Nội dung và định dạng**
- **BR-51**: Nội dung file .md: Tiêu đề → Pre-meeting info (chỉ in field khác rỗng) → Summary theo snapshot preset (mỗi section 1 heading, dùng `label` người dùng đặt) → Action Items → Notes → Transcript. Mục rỗng → bỏ hẳn, không in heading trống.
- **BR-52**: Summary trong file export ghi kèm tên preset đã dùng + thời điểm generate (từ snapshot + `summaryGeneration`). Preset đã bị xóa (BR-18) → vẫn in tên từ snapshot kèm "(preset đã bị xóa khỏi ứng dụng)". Summary legacy không có snapshot (BR-20) → hiển thị như General Meeting, không có ghi chú "đã bị xóa".
- **BR-53**: Meeting chưa có summary vẫn export được (chỉ gồm thông tin + notes + transcript), kèm cảnh báo mềm "Cuộc họp này chưa có bản tóm tắt".
- **BR-54**: Transcript kèm mặc định, có tùy chọn tắt trước khi export. > 20.000 segment → cảnh báo mềm về kích thước/thời gian chờ, vẫn cho export. *(Ngưỡng phán đoán thận trọng, QA điều chỉnh sau.)*

### E. Gợi ý preset theo `meetingType`

- **BR-55**: `meetingType` khác rỗng → dropdown preset ở Meeting Detail **chọn sẵn** preset tương ứng, kèm nhãn phụ "Gợi ý cho *<nhãn loại cuộc họp>*". Đổi tay tự do, không cần xác nhận. Gợi ý không bao giờ tự chạy Generate.
- **BR-56** *(sửa thứ tự ưu tiên so với BR-10 của `summary-presets` — đã là quyết định user tại mục 2, cần Tech Lead lưu ý khi review lại BR-10 cũ)*: Thứ tự chọn preset mặc định trong dropdown:
  1. Người dùng đã đổi preset thủ công cho chính meeting này trong phiên hiện tại → giữ nguyên, gợi ý không ghi đè.
  2. Meeting có `meetingType` và tìm được preset khớp (BR-57) → dùng preset đó.
  3. Ngược lại → `lastSummaryPresetId` (BR-10 cũ); chưa có → "General Meeting"; không còn nữa → phần tử đầu danh sách.

  BR-10 vẫn đúng nguyên vẹn cho mọi meeting không có `meetingType`.
- **BR-57**: Quy tắc tìm preset khớp cho 1 `meetingType`, theo thứ tự:
  1. Preset người dùng **đã dùng gần nhất** khi Generate cho `meetingType` đó trên máy này (map `meetingType → presetId` lưu trong settings), nếu preset đó còn tồn tại.
  2. Preset có `name` trùng (trim, không phân biệt hoa/thường) với tên preset mặc định ở bảng BR-25.
  3. Không thấy → không gợi ý, rơi về bước 3 của BR-56.

  Khớp theo tên ở bước 2 là hệ quả bắt buộc của BR-8 (preset mẫu sửa/xóa tự do, không có id neo cố định). Bước 1 là cơ chế tự chữa: chỉ cần chọn tay đúng 1 lần, gợi ý các lần sau bám theo lựa chọn thật thay vì bám theo tên.
- **BR-58**: Preset từng được nhớ cho 1 `meetingType` bị xóa (BR-18) → xóa luôn entry nhớ đó, quay về khớp theo tên (bước 2), rồi mới tới không gợi ý. Không báo lỗi, không chặn Generate, không tự khôi phục preset từ snapshot (việc khôi phục vẫn chỉ diễn ra khi người dùng chủ động bấm theo BR-19).
- **BR-59**: Đổi `meetingType` của meeting đã có summary → chỉ đổi gợi ý cho lần Generate sau, không đụng summary/snapshot đã lưu (BR-17), không hiện hộp xác nhận ghi đè (hộp đó chỉ xuất hiện khi thật sự bấm Generate — BR-15).
- **BR-60**: `meetingType` **không** được ghi vào snapshot preset — snapshot chỉ mô tả cấu trúc output (BR-16); loại cuộc họp là thuộc tính của meeting, được phép đổi mà không làm summary cũ "nói dối".

### F. Bộ preset mẫu mới (thay BR-8 cũ)

- **BR-64**: Bộ 10 preset mẫu trong `docs/preset-templates.md` (nguyên văn user cung cấp, đã copy vào repo — nguồn xác thực cho Tech Lead/Dev, không suy đoán lại nội dung) **thay thế hoàn toàn** 4 preset mẫu gốc của `summary-presets` (General Meeting/Sales Call/Technical Standup/Interview). Mỗi preset trong file map trực tiếp vào cấu trúc preset đã có (BR-1): `Tên preset` → `name`, `Mô tả` → `description`, `Hướng dẫn cho AI` → `instruction`, bảng `Các mục` → `sections[]` (`Tên mục` → `label`, `Gợi ý cho AI` → `hint`). Cột "Kiểu" map sang 3 field type hiện có (BR-1): `Đoạn văn` → `paragraph`, `Danh sách` → `bulletList`, `Việc cần làm` → `actionList`.
- **BR-65** *(đã sửa — bỏ việc nối block dùng chung vào từng preset)*: `instruction` lưu xuống của mỗi preset trong 10 preset mẫu = **chỉ** nội dung "Hướng dẫn cho AI" (block riêng) ghi dưới từng preset trong `docs/preset-templates.md`. **Không** nối thêm BLOCK DÙNG CHUNG vào `instruction` — khối đó đã là nguyên tắc mặc định của hệ thống (BR-61), áp dụng cứng ở tầng prompt cho **mọi** preset (kể cả preset người dùng tự tạo, không riêng 10 preset mẫu). Nối cả hai vào `instruction` sẽ khiến prompt thật có 2 bản sao cùng nguyên tắc — vừa tốn token, vừa là 2 nơi phải sửa mỗi khi cần chỉnh nguyên tắc chung thay vì 1 nơi (BR-61).
- **BR-66**: Phạm vi áp dụng bộ seed mới: (a) cài đặt lần đầu (chưa từng có `presets.json`), (b) mọi lần seed-lại khi danh sách preset rỗng (BR-9 của `summary-presets`). **Không** tự động ghi đè `presets.json` của bản cài đã có sẵn 4 preset mẫu cũ — người dùng cũ giữ nguyên preset đang dùng (kể cả bản họ đã sửa), tự tạo/copy thủ công preset mới nếu muốn dùng bộ 10 preset này. *(Giả định BA/PM — hợp lý vì tính đến thời điểm viết PRD này, `summary-presets` mới PASS QA, gần như chắc chắn chưa có người dùng thật nào đang chạy bản cài có sẵn 4 preset cũ; nêu rõ ở đây để Tech Lead lật lại nếu biết có bản cài đang chạy thật.)*
- **BR-67**: 10 mã `meetingType` ở BR-25 khớp tên 1-1 với 10 preset mẫu này theo đúng cơ chế khớp-theo-tên đã có ở BR-57 bước 2 — không cần logic ánh xạ mới, chỉ cần bảng BR-25 đúng.

### G. Tag cho bản ghi và hiển thị

- **BR-68**: Meeting có thêm `tags: string[]`, tự do, không entity riêng (không có id/bảng tag tập trung — tag chỉ là chuỗi lặp lại trên nhiều meeting, nhất quán tinh thần "lưu theo máy, không có tầng quản trị tập trung" của BR-21). Mỗi tag ≤ 30 ký tự sau `trim()`. Dedupe trên cùng 1 meeting theo `trim().toLowerCase()` (không phân biệt hoa/thường), giữ nguyên cách viết hoa/thường của lần gõ đầu tiên để hiển thị. ≤ 10 tag/meeting — vượt → chặn thêm, báo lỗi rõ.
- **BR-69**: Khi gõ tag, hệ thống gợi ý (autocomplete) từ tập hợp tất cả tag **đã từng dùng** trên máy này, so khớp không phân biệt hoa/thường, sắp theo tần suất dùng gần đây trước. Vẫn cho gõ hoàn toàn tự do một tag mới không có trong gợi ý — gợi ý không giới hạn lựa chọn (khác preset, không có khái niệm "tag hợp lệ/không hợp lệ").
- **BR-70**: Khi `meetingType` được chọn (lần đầu hoặc đổi sang giá trị khác — BR-23), hệ thống tự thêm 1 tag trùng đúng nhãn hiển thị của `meetingType` đó (bảng BR-25, vd chọn `sales-call` → tự thêm tag "Sales call") nếu tag đó **chưa có** trong `tags`. Không tự xóa tag ứng với `meetingType` cũ khi người dùng đổi sang loại khác — tránh xóa nhầm tag người dùng có thể chủ động muốn giữ. Người dùng xóa tag tự thêm này bất cứ lúc nào; hệ thống **không** tự thêm lại trong cùng 1 lần chỉnh sửa nếu `meetingType` không đổi tiếp.
- **BR-71**: Thư viện meeting hiển thị `tags` dạng chip có màu trên mỗi dòng, cạnh tiêu đề/ngày. Màu chip sinh ổn định từ hash tên tag (cùng tên tag luôn ra cùng màu trên máy đó) — không cần màn hình cấu hình màu tay.
- **BR-72**: Thư viện có thêm thanh chip lọc theo tag ở đầu danh sách, liệt kê các tag đang tồn tại (sắp theo tần suất dùng), bấm chọn 1 hoặc nhiều tag để lọc. Chọn nhiều tag = quan hệ **OR** (hiện meeting có ít nhất 1 trong các tag đã chọn); kết hợp **AND** với ô filter text sẵn có (`meetings-filter`, `js/app.js:1898`) — tức đồng thời thu hẹp theo cả text lẫn tag. *(OR giữa các tag đã chọn là mặc định đơn giản nhất cho v1; PM/QA có thể đổi sang AND sau khi có phản hồi thật, không phải quyết định khó đảo ngược vì chỉ là logic lọc phía client.)*
- **BR-73**: `tags` được đưa vào tìm kiếm toàn cục: tag khớp → +3 điểm (cùng thang điểm hiện có, `js/storage.js:279-327`, ngang mức notes/summary), snippet kết quả ghi rõ field `tags`.
- **BR-74**: Thư viện có thêm 1 nút chuyển chế độ xem "Danh sách" (mặc định, giữ nguyên hành vi hiện tại) / "Theo tag" — ở chế độ "Theo tag", meeting được nhóm thành từng khối theo tag (1 meeting nhiều tag → xuất hiện ở nhiều khối); meeting không có tag nào gom vào khối "Chưa gắn tag" hiển thị cuối cùng. Thanh lọc tag (BR-72) và ô filter text vẫn hoạt động trong chế độ này, thu hẹp nội dung từng khối.
- **BR-75**: Tag không phải entity có id — sửa cách viết 1 tag ở 1 meeting **không** ảnh hưởng tag cùng tên đang gắn ở meeting khác (mỗi meeting giữ bản sao chuỗi riêng). "Đổi tên tag ở tất cả meeting cùng lúc" (rename hàng loạt) **ngoài phạm vi v1** — xem Out of Scope.
- **BR-76**: `tags` có trong backup JSON và import backup; thiếu field (backup cũ trước feature này) → mặc định mảng rỗng, không lỗi.

## 5. Acceptance Criteria

| User Story | Acceptance Criteria |
|---|---|
| US-6 | New Meeting có 3 ô mới + participants sẵn có; bỏ trống hết vẫn Start Recording bình thường (BR-24). Sửa lại tại Meeting Detail → lưu đúng sau reload. Nhập `topic` 500 ký tự → lưu còn 200, không lỗi (BR-26). |
| US-7 | Từ khóa chỉ có ở `topic`/`leadBy` → meeting xuất hiện trong search kèm snippet đúng field (BR-30). |
| US-8 | Notes chứa 1 viết tắt nội bộ → summary dùng đúng nghĩa; `contextUsed.notes = true` (BR-39). Xóa hết notes rồi Generate lại → prompt không còn khối notes (BR-36). Meeting dài chạy map-reduce + có notes → cả `buildChunkPrompt` và `buildSynthesisPrompt` đều chứa notes (BR-32, test kiểu 3-builder giống T5 của feature trước). |
| US-9 | Notes ghi 1 việc chưa hề nói trong transcript → việc đó không xuất hiện như đã chốt (BR-34, BR-61). Transcript có 1 quyết định thực ra mới "đang bàn" → summary phải để ở mục ĐANG BÀN, không phải ĐÃ CHỐT (BR-61). Số liệu nghe không rõ trong transcript và notes không nhắc tới → giữ `[?]`, không đoán (BR-61, BR-63). Transcript nhận nhầm 1 con số/tên riêng và notes nêu đúng giá trị thật cho đúng chỗ đó → summary dùng thẳng giá trị từ notes, không còn `[?]` (BR-63 — notes ghi đè). |
| US-10 | Thư mục .md hợp lệ đã cấu hình → Export ra đúng thư mục, tên file đúng mẫu `yymmdd-chủ đề-viết tắt` (BR-45), thông báo hiện đường dẫn đầy đủ (BR-48). Export lần 2 → sinh `…-SC (2).md`, file cũ nguyên vẹn (BR-46). Meeting chưa có `topic`/`meetingType` → tên file rút gọn còn 2 hoặc 1 phần, không lỗi, không có đoạn rỗng thừa dấu `-` (BR-45). |
| US-12 | Meeting `meetingType = sales-call` → dropdown chọn sẵn "Sales call" kèm nhãn gợi ý (BR-55). Đổi tay sang preset khác rồi Generate → meeting `sales-call` sau đó gợi ý đúng preset vừa dùng (BR-57.1). Xóa preset đó → gợi ý quay về khớp theo tên, không lỗi (BR-58). Xóa cả 10 preset mẫu, không tạo preset trùng tên → mọi meeting có `meetingType` không còn gợi ý được nữa, Generate vẫn chạy bình thường (BR-57.3). |
| US-13 | Gắn 3 tag tự do cho 1 meeting → hiển thị đúng dạng chip màu trên dòng meeting ở thư viện (BR-71). Gõ lại tag đã dùng trước đó → xuất hiện trong gợi ý autocomplete (BR-69). Chọn `meetingType = sales-call` → tag "Sales call" tự xuất hiện; xóa tag đó rồi lưu → không tự thêm lại (BR-70). Bấm chip tag ở thanh lọc → thư viện chỉ còn meeting có tag đó (BR-72). Gõ tên tag vào ô search toàn cục → ra đúng meeting (BR-73). Chuyển chế độ xem "Theo tag" → meeting xuất hiện đúng khối tag tương ứng, meeting chưa gắn tag nằm ở khối "Chưa gắn tag" (BR-74). |

## 6. UI Flow Overview

1. **New Meeting**: thêm 3 ô tùy chọn (loại cuộc họp — dropdown theo bảng BR-25, chủ đề, người chủ trì) cạnh ô participants sẵn có.
2. **Meeting Detail**: cho sửa lại 4 field pre-meeting info (thêm 1 khu vực nhỏ, không chiếm chỗ tab Notes/Transcript/Summary hiện có).
3. **Meeting Detail → tab Summary**: dropdown preset tự chọn sẵn theo BR-55/56 khi có `meetingType`; thêm nút "Export .md" cạnh nút Generate Summary.
4. **Settings → mục mới "Xuất file"**: 1 ô chọn thư mục lưu .md, có nút "Kiểm tra thư mục" dùng chung logic BR-43.
5. Sau khi export: toast/hộp thoại hiện đường dẫn file + nút "Mở thư mục" (BR-48).
6. **Meeting Detail**: thêm ô nhập tag (autocomplete) cạnh khu vực pre-meeting info.
7. **Thư viện meeting**: mỗi dòng hiện thêm chip tag màu; thêm thanh chip lọc theo tag ở đầu danh sách (cạnh ô filter text hiện có); thêm nút chuyển "Danh sách" / "Theo tag".

## 7. Out of Scope (v1)

- Export hàng loạt nhiều cuộc họp một lần.
- **Export .docx** (quyết định user, D-2) và mọi template công ty (logo, header/footer, style riêng) cho export.
- Tự động export sau mỗi lần Generate Summary.
- Export .pdf.
- Bảng ánh xạ `meetingType → preset` cấu hình bằng UI (v1 chỉ ghi nhớ ngầm theo BR-57.1).
- Đồng bộ thư mục export giữa nhiều máy.
- UI đổi tên speaker thủ công / bước AI riêng để gán tên speaker (xem D-5, BR-62 — đã chuyển thành nguyên tắc trong prompt).
- Đổi tên 1 tag hàng loạt trên tất cả meeting đang dùng tag đó (BR-75).
- Tag phân cấp/lồng nhau (tag cha-con).
- Quản trị danh sách tag tập trung (tạo/sửa/xóa tag như 1 màn hình riêng) — v1 chỉ có autocomplete từ tag đã dùng (BR-69).

## 8. Rủi ro cần Tech Lead quyết trước khi Dev bắt đầu

| # | Rủi ro | Ghi chú |
|---|---|---|
| **R-B** | Endpoint export là bề mặt ghi file mới ra ngoài `STORAGE_DIR` — phá giả định "server chỉ ghi trong storage, mọi tên file đều hash" của baseline security đã review 2026-09-18 | BR-41/42/45 là các lớp bù; Reviewer bắt buộc kiểm mục này kỹ khi review code. |
| **R-D** | Notes làm dài prompt → có thể đẩy 1 số cuộc họp vốn chạy single-pass sang map-reduce mà người dùng không hiểu vì sao | Cần đo sau khi có BR-38; nếu xảy ra thường xuyên, cân nhắc hiển thị lý do trong provenance (BR-39) ở bản sau. |
| E-6/§D1 | [CHƯA VERIFY] hành vi ghi atomic (ghi tạm + rename) trên thư mục đồng bộ iCloud Drive/OneDrive placeholder | Tech Lead cần kiểm nếu muốn cam kết BR-47 ở mọi loại thư mục người dùng có thể chọn. |
| §D2 | [CHƯA VERIFY] khả năng mở Finder/Explorer bằng subprocess `shell:false` từ Node trên cả macOS và Windows | Nếu không làm an toàn được, BR-48 rút gọn còn "hiển thị đường dẫn + nút copy". |

## 9. Ý tưởng tương lai (đã cân nhắc, không vào scope lần này)

- **Dashboard action items xuyên suốt các cuộc họp**: gom `actionItems` chưa xong từ mọi meeting vào 1 màn hình, lọc theo người phụ trách/hạn. Hữu ích vì việc cần làm hiện bị chôn trong từng meeting riêng lẻ; dữ liệu đã có sẵn (`assignee`, `dueDate`, `done`), chủ yếu là việc tổng hợp/hiển thị.
- **Soạn sẵn email follow-up từ summary**: sinh nháp email tóm tắt/nhắc việc gửi cho `participants`, dựa trên summary + action items + `leadBy`. Hữu ích vì đây là việc gần như luôn làm ngay sau họp và hiện phải copy-paste thủ công.

## 10. Assumptions

1. Feature này không đổi cấu trúc output LLM → không đụng `schemas/meeting-summary.schema.json` và không đụng 3 cơ chế enforce schema của 3 provider. Notes/pre-meeting info chỉ là input context, đây là lý do chi phí thấp hơn hẳn `summary-presets`.
2. Export chỉ cho 1 meeting tại 1 thời điểm (không export hàng loạt ở v1), chỉ .md.
3. Ngưỡng 4.000 ký tự notes và 20.000 segment transcript là phán đoán thận trọng, chưa đo trên dữ liệu thật (giống tinh thần BR-7 của feature trước).
4. Bỏ hoàn toàn `.docx` giúp feature này **không cần thêm bất kỳ npm dependency nào** — vẫn giữ đúng đặc tính zero-dependency hiện tại của project (CLAUDE.md §Tech stack).

---

# PRD v3.0 — Import bản ghi âm từ điện thoại (import-phone-recording)

**Trạng thái**: Draft (phần Business Rules do BA soạn), chờ duyệt Checkpoint 1
**Phiên bản**: 3.0
**Ngày**: 2026-09-18
**Quan hệ với v2.0**: feature này **không thay thế** bất kỳ BR nào của v1.1/v2.0. Toàn bộ BR-1 → BR-76 giữ nguyên hiệu lực. Mục tiêu chính của v3.0 là làm cho bản ghi *nhập từ ngoài* hưởng đủ các tính năng v2.0 (pre-meeting context, preset theo loại họp, tag, export) — hiện đang không hưởng được.

## 1. Bối cảnh nghiệp vụ

Người dùng đi họp không mang laptop, dùng app ghi âm có sẵn trên điện thoại (iPhone Voice Memos, Android Recorder, Zalo…). Về tới máy, họ tự chuyển file sang máy (AirDrop, cáp, Zalo, Drive) rồi muốn đưa vào MeetNote để có transcript + summary **chất lượng ngang luồng Meeting Setup trong app**.

Đặc điểm bối cảnh quyết định thiết kế nghiệp vụ:

- **Cuộc họp đã kết thúc rồi mới import** → không có áp lực thời gian thực, nhưng **không thể ghi âm lại**: mọi lỗi làm mất file/mất công đều là mất vĩnh viễn. Đây là lý do nhiều rule dưới đây ưu tiên "không mất dữ liệu" hơn "gọn gàng".
- **Thông tin cuộc họp nằm trong đầu người dùng, không nằm trong file**: file chỉ có tên kiểu "Bản ghi mới 3.m4a". Ngày ghi âm, ai chủ trì, chủ đề, loại họp — chỉ người dùng biết, và họ nhớ rõ nhất *ngay lúc import*, không phải 2 tuần sau.
- **Ghi âm điện thoại chất lượng kém hơn system audio**: máy đặt trên bàn, người ngồi xa nhỏ tiếng, có tiếng ồn/va chạm. Transcript sẽ tệ hơn luồng trong app — kỳ vọng phải được quản lý, không được để người dùng nghĩ app hỏng.
- **File dài (2–3 tiếng) là bình thường**, không phải ngoại lệ. Đây là khác biệt lớn nhất so với luồng recording trong app (người dùng đang ngồi trước máy, thấy tiến trình chạy).

## 2. Quyết định đã chốt với user (không hỏi lại)

| # | Vấn đề | Quyết định |
|---|---|---|
| D-12 | Cách đưa file từ điện thoại sang máy | **Người dùng tự chuyển** (AirDrop/cáp/Zalo/Drive). MeetNote **không** mở LAN, **không** QR pairing, **không** watch folder. Baseline 127.0.0.1-only + Host/Origin allowlist giữ nguyên tuyệt đối. |
| D-13 | Phạm vi pipeline | Làm trọn BA → Tech Lead → Dev → Reviewer → QA, dừng ở 2 checkpoint theo Protocol 2. |

## 3. Trạng thái hiện tại đã verify (BA tự đọc source — Tech Lead/Dev không phải đoán lại)

| Điểm | Kết quả verify | Nguồn |
|---|---|---|
| Luồng upload hiện có | `<input type=file>` ẩn → validate đuôi ở client → `Storage.saveMeeting({title: tên file bỏ đuôi, status:'processing', participants:[], duration:0, transcript:[]})` → `AudioStorage.save` (PUT) → POST `/api/import-transcription` → poll `/api/jobs/:id` (3s, ×1.5, trần 10s). 1 file/lần, không drag-drop. | `js/app.js:3810-3900`, `js/audio-storage.js:22-35` |
| Meeting tạo từ upload | **Không** set `meetingType`/`topic`/`leadBy`/`tags`/`notes`; `date` mặc định = thời điểm import (`new Date()`), không phải thời điểm họp. | `js/app.js:3828-3838`, `js/storage.js:188-212` |
| Đuôi file client chấp nhận | 11 đuôi hardcode: `aac, aiff, amr, asf, flac, mp3, ogg, wav, webm, m4a, mp4`. **Không có** `opus`, `3gp`, `3gpp`, `wma`, `mov`, `caf`. Server **không** kiểm lại đuôi. | `js/app.js:3813,3819`; `server.js:398-427` |
| Giới hạn dung lượng | Server: `MAX_AUDIO_BYTES = 2GB`. Nhưng giới hạn **thật sự chặn** là của từng provider: Soniox 500MB, Deepgram 1GB, OpenAI Whisper 25MB, Google 10MB (inline). Kiểm ở `stt.transcribe()` — tức **sau khi** file đã upload xong và meeting đã được tạo. | `server.js:40`; `server/stt/providers/soniox.js:11`, `deepgram.js:14`, `whisper.js:13`, `google.js:14`; `server/stt/index.js:94-98` |
| Google không nhận m4a/mp4/aac | `encodingForMime()` trả `null` cho m4a/mp4/aac → lỗi `UNSUPPORTED_AUDIO`. Đây đúng là định dạng iPhone Voice Memos hay xuất ra. | `server/stt/providers/google.js:23-30,91-96` |
| Client không biết giới hạn provider | `listProviders()` trả về `maxUploadBytes`? **Không** — field này có trên adapter nhưng **không** nằm trong object trả về cho client. | `server/stt/index.js:109-133` |
| Đọc audio vào RAM trước khi xếp hàng | `loadAudio()` chạy **trước** `enqueue()`. Hàng đợi chỉ serial hoá *lệnh gọi provider*, không serial hoá việc nạp buffer → N file import song song = N buffer cùng lúc trong RAM. | `server/stt/index.js:100-103` |
| Chống ghi đè transcript bởi snapshot cũ của browser | PUT `/api/meetings` có guard: nếu bản trên server đã `completed`/`failed` mà bản browser gửi lên còn `processing` → giữ lại `transcript/translations/duration/status/processingError/sonioxUsage` của server. | `server.js:1522-1533` |
| Dedupe job | POST `/api/import-transcription` dedupe theo `meetingId` (in-memory + trong mutation lock của `jobs.json`) → không tạo 2 worker cho cùng 1 meeting. | `server.js:1424-1459` |
| Job ghi transcript trước, mark completed sau | `runTranscriptionJob` merge transcript + `duration` + `status:'completed'` + `sonioxUsage.source = 'file-upload'` vào meeting **rồi mới** đánh dấu job xong. | `server.js:673-720` |
| Tên file ghi xuống đĩa | Luôn qua hash SHA-256 của meetingId; tên file gốc chỉ lưu làm metadata (`decodeAudioFilename`, basename + cắt 255). | `server.js:323-329,416-436` |
| Job bị gián đoạn do restart server | `recoverInterruptedJobs()` đánh dấu failed và **giữ lại audio** để thử lại. | `server.js:746-...` |

**Hệ quả nghiệp vụ quan trọng nhất của bảng trên**: hôm nay, một file `.m4a` 1 giờ (~30–60MB) từ iPhone, với provider mặc định là Whisper hoặc Google, sẽ **upload xong, tạo meeting xong, rồi mới báo lỗi** — người dùng mất thời gian chờ và còn lại một bản ghi hỏng trong thư viện. Đây là vấn đề số 1 feature này phải giải quyết, ngang hàng với việc bổ sung pre-meeting context.

## 4. User Stories

**US-14**: Là người dùng đi họp không mang laptop, tôi muốn đưa file ghi âm từ điện thoại vào MeetNote và nhận được transcript + summary như một cuộc họp ghi trong app, để không phải gõ lại biên bản bằng tay.

**US-15**: Là người dùng, tôi muốn khai loại cuộc họp / chủ đề / người chủ trì / người tham dự / tag / ghi chú **ngay lúc import** — khi tôi còn nhớ rõ — để bản ghi nhập từ ngoài cũng được gợi ý preset, gắn tag và đặt tên file export đúng như bản ghi trong app.

**US-16**: Là người dùng, tôi muốn sửa lại **ngày giờ cuộc họp thật** cho bản ghi vừa import, để nó nằm đúng chỗ trong thư viện và tên file export mang đúng ngày họp chứ không phải ngày tôi ngồi import.

**US-17**: Là người dùng, tôi muốn biết **trước khi chờ** rằng file của tôi có chạy được không (định dạng, dung lượng, dịch vụ đang chọn), thay vì chờ xong mới nhận thông báo lỗi.

**US-18**: Là người dùng có 4 file ghi âm của 4 cuộc họp tuần trước, tôi muốn chọn cả 4 một lần và để máy tự xử lý lần lượt, thay vì ngồi canh từng file.

**US-19**: Là người dùng có file dài 3 tiếng, tôi muốn đóng tab đi làm việc khác, quay lại vẫn thấy đúng tiến trình; nếu lỗi thì file gốc vẫn còn trong app và tôi bấm thử lại được (có thể đổi sang dịch vụ khác), vì cuộc họp đó không thể ghi âm lại.

**US-20**: Là người dùng, tôi muốn được nhắc khi bản ghi có vẻ nghe không rõ (mic điện thoại đặt xa), để hiểu vì sao transcript thưa và biết lần sau đặt máy thế nào — thay vì nghĩ app bị hỏng.

## 5. Business Rules

*(Đánh số tiếp từ BR-76. Không rule nào dưới đây được phép phá vỡ BR-1 → BR-76. Đặc biệt: BR-15 → BR-20 (snapshot preset), BR-23 → BR-31 (pre-meeting info), BR-45 (tên file export), BR-68 → BR-76 (tag) áp dụng nguyên vẹn cho meeting tạo bằng import.)*

### A. Nguồn file và phạm vi transport

- **BR-77**: "Import" trong feature này chỉ có nghĩa: người dùng chọn một hoặc nhiều file **đã nằm sẵn trên máy** qua hộp thoại chọn file hoặc kéo-thả vào cửa sổ app. MeetNote **không** mở thêm bất kỳ cổng/giao diện mạng nào, **không** nhận file từ thiết bị khác qua LAN, **không** theo dõi thư mục tự động, **không** tải file từ URL. Mọi thay đổi vi phạm điều này → Reviewer reject, bất kể tiện lợi tới đâu (quyết định user D-12 + baseline bảo mật CLAUDE.md §Bảo mật).
- **BR-78**: Kéo-thả là **cách thứ hai** để chọn file, không thay thế nút chọn file hiện có. Kéo vào một thư mục, một mục không phải file, hoặc thả ra ngoài vùng nhận → không xảy ra gì kèm thông báo ngắn, tuyệt đối không tạo meeting rỗng.

### B. Định dạng file

- **BR-79**: Danh sách đuôi file được chấp nhận phải là **một nguồn duy nhất** dùng chung cho cả kiểm tra phía trình duyệt lẫn phía server. Hôm nay danh sách chỉ tồn tại ở client (`js/app.js:3819`) và server không kiểm lại — sau feature này, server **phải** kiểm lại: kiểm ở client là để báo sớm cho người dùng, không phải là lớp bảo vệ.
- **BR-80**: File bị từ chối vì định dạng → thông báo phải nêu đủ 3 thứ: (a) tên file bị từ chối, (b) đuôi thực tế của nó, (c) danh sách đuôi đang chấp nhận, kèm 1 câu hành động cụ thể bằng tiếng Việt (ví dụ: "Hãy dùng chức năng chia sẻ/chuyển định dạng của app ghi âm để xuất ra .m4a hoặc .mp3 rồi import lại"). Không được dùng thông báo chung chung kiểu "Unsupported audio format".
- **BR-81**: Trong một lô nhiều file, file bị từ chối **không** làm huỷ cả lô: các file hợp lệ vẫn được import, các file bị từ chối được liệt kê riêng thành một danh sách nêu rõ lý do từng file. Người dùng không bao giờ được rơi vào tình huống "chọn 5 file, chỉ thấy 3 bản ghi xuất hiện mà không biết 2 file kia đi đâu".
- **BR-82** *(deny-by-default, tinh thần Protocol 8)*: Các đuôi phổ biến của điện thoại hiện **chưa** có trong danh sách (`opus`, `3gp`, `3gpp`, `caf`, `wma`, `mov`) chỉ được thêm vào khi có **nguồn xác thực** rằng ít nhất một provider đang tích hợp nhận được định dạng đó (Protocol 5: doc chính thức của provider hoặc log chạy thật). Chưa verify → **không thêm**, và thông báo từ chối theo BR-80 vẫn phải hữu ích. Cấm thêm đuôi vào danh sách chỉ vì "chắc là chạy được".
- **BR-83**: File 0 byte, hoặc trình duyệt không đọc được nội dung file → từ chối **trước khi** tạo meeting và trước khi gửi byte nào lên server. Thông báo phải gợi ý nguyên nhân thường gặp: file chưa tải xong từ dịch vụ đồng bộ (iCloud Drive/Google Drive để file ở dạng placeholder), hoặc file ghi âm bị lỗi. *(Cơ chế placeholder của iCloud/Drive: `[UNVERIFIED]` — rule chỉ yêu cầu nội dung thông báo khi đọc file thất bại, không phụ thuộc vào việc xác định chính xác nguyên nhân.)*

### C. Dung lượng và dịch vụ chuyển giọng nói (STT provider)

- **BR-84**: Giới hạn dung lượng có hiệu lực với một lần import = **giá trị nhỏ nhất** giữa giới hạn chung của app (2GB) và giới hạn của provider sẽ thực sự xử lý file đó. Giới hạn provider đang hiệu lực trong code: Soniox 500MB, Deepgram 1GB, OpenAI Whisper 25MB, Google 10MB. *(Đây là con số app **đang tự enforce** — không phải cam kết đã verify từ nhà cung cấp; xem R-M.)*
- **BR-85**: Kiểm tra giới hạn dung lượng và tính tương thích định dạng ↔ provider **trước khi** upload và **trước khi** tạo meeting. Vi phạm → không tạo meeting, không tốn thời gian upload, thông báo nêu rõ: dung lượng file, giới hạn của provider đang chọn, và **những provider nào trong máy này xử lý được file đó** (nếu có). Đây là rule quan trọng nhất mục C — hành vi hôm nay (tạo meeting rồi mới báo lỗi) bị coi là bug sau feature này.
- **BR-86**: Khi provider đang chọn không nhận được định dạng file (ví dụ đã verify: Google không nhận m4a/mp4/aac — `server/stt/providers/google.js:23-30`), hệ thống **đề nghị** đổi sang provider phù hợp và cho đổi ngay tại chỗ; **không tự ý đổi** provider thay người dùng — provider khác nhau về chi phí, chất lượng và khả năng dịch (BR-85 của v1.1 về chi phí Soniox vẫn áp dụng).
- **BR-87**: Form import cho phép chọn cho **từng lần import**: provider, model, ngôn ngữ nội dung, ngôn ngữ dịch (nếu provider hỗ trợ). Mặc định lấy từ Settings. Lựa chọn này phải được gửi kèm khi tạo job và được job dùng thật. *(Lý do nghiệp vụ: ghi âm điện thoại thường là cuộc họp tiếng Việt trong khi Settings có thể đang để ngôn ngữ khác; chọn sai ngôn ngữ = transcript rác + tốn tiền chạy lại. Ghi chú kỹ thuật: endpoint hiện đã nhận `provider`/`model` nhưng client chưa gửi — `server.js:1442-1443` vs `js/app.js:3872-3876`.)*
- **BR-88**: Số file tối đa cho một lần import: **10**. Số job chuyển giọng nói chạy đồng thời: tối đa **2**, các file còn lại xếp hàng và hiển thị trạng thái "đang chờ" phân biệt được với "đang xử lý". Vượt 10 file → nhận 10 file đầu và báo rõ phần còn lại chưa được nhận, không im lặng cắt bớt. *(Lý do: đã verify `loadAudio()` chạy trước hàng đợi provider — `server/stt/index.js:100-103` — nên N file lớn import cùng lúc nghĩa là N buffer cùng nằm trong RAM của server. Con số 10/2 là ngưỡng thận trọng của BA, Tech Lead được phép siết chặt hơn nhưng không được nới lỏng nếu chưa đo thật.)*

### D. Mỗi file là một cuộc họp + ngữ cảnh nhập lúc import

- **BR-89**: Mỗi file = **một** meeting độc lập. Hệ thống không bao giờ tự ghép nhiều file thành một cuộc họp, kể cả khi tên file trông như các phần liên tiếp ("phần 1", "part 2"). Ghép nhiều phần: xem Out of Scope.
- **BR-90**: Import mở một bước nhập ngữ cảnh dùng **đúng** các field của v2.0, không tạo field song song: `title`, `date` (BR-92), `meetingType`, `topic`, `leadBy`, `participants`, `tags`, `notes`. Mọi rule v2.0 áp dụng nguyên vẹn: giới hạn 200 ký tự cho `topic`/`leadBy` (BR-26), mã lạ quy về `''` (BR-27), gợi ý thêm `leadBy` vào participants (BR-28), tự thêm tag theo `meetingType` (BR-70), giới hạn 10 tag × 30 ký tự (BR-68).
- **BR-91**: Không field ngữ cảnh nào là bắt buộc và không field nào được chặn việc bắt đầu chuyển giọng nói. Bỏ trống toàn bộ → import vẫn chạy y như hôm nay.
- **BR-92 — Ngày giờ cuộc họp**: `date` của meeting mang nghĩa **thời điểm cuộc họp diễn ra** và phải sửa được ngay trong bước import cũng như sau này tại Meeting Detail. `createdAt` giữ nguyên nghĩa "thời điểm bản ghi được tạo trong app" và **không** bị ghi đè bởi giá trị người dùng nhập. *(Hệ quả dây chuyền phải kiểm: BR-45 lấy `meeting.date` để sinh `yymmdd` trong tên file export; thư viện và thống kê "tuần này" cũng dựa trên `date` — `js/storage.js:298`.)*
- **BR-93 — Giá trị mặc định của `date`**: ưu tiên theo thứ tự: (1) thời điểm ghi âm suy ra được từ chính file, nếu đáng tin; (2) thời điểm import. Giao diện phải nói rõ giá trị đang dùng đến từ đâu ("lấy từ file" / "ngày import") để người dùng biết có cần sửa không. Hệ thống **không được** trình bày một ngày suy đoán như thể đó là ngày họp chắc chắn. *(`[UNVERIFIED]`: `.m4a` của iPhone Voice Memos có nhúng ngày ghi âm hay không; `file.lastModified` còn đúng sau khi file đi qua AirDrop/Drive/Zalo hay không. Nếu Tech Lead không verify được nguồn (1) → bỏ hẳn nguồn (1), dùng thẳng (2); rule không phụ thuộc vào việc nguồn (1) tồn tại.)*
- **BR-94 — Ngày vô lý**: `date` ở tương lai quá 1 ngày so với đồng hồ máy, hoặc trước `2000-01-01` → không nhận, quay về thời điểm import kèm giải thích ngắn. Áp dụng cho cả giá trị suy ra từ file lẫn giá trị người dùng gõ tay.
- **BR-95**: `title` mặc định vẫn là tên file bỏ đuôi (giữ hành vi hiện tại) nhưng sửa được ngay trong bước import. Tên file export tiếp tục ưu tiên `topic` theo BR-45 — không đổi quy tắc đặt tên.
- **BR-96 — Chuyển giọng nói chạy song song với việc nhập ngữ cảnh**: việc chuyển giọng nói bắt đầu **ngay khi file được lưu xong**, không chờ người dùng nhập xong ngữ cảnh. Người dùng bỏ dở bước nhập ngữ cảnh (đóng cửa sổ, chuyển màn hình khác) → bản ghi vẫn được tạo và vẫn chạy transcript với phần ngữ cảnh đã nhập tới thời điểm đó; phần còn lại bổ sung sau tại Meeting Detail như mọi meeting khác (BR-24).
- **BR-97 — Không được mất dữ liệu do sửa ngữ cảnh trong lúc đang chạy**: sửa và lưu ngữ cảnh khi job chuyển giọng nói đang chạy **không được** làm mất `transcript`/`translations`/`duration`/`status`/`sonioxUsage` do server ghi, và **không được** đẩy một bản ghi đã `completed` trở về `processing`. *(Cơ chế bảo vệ đã tồn tại ở `server.js:1522-1533`; rule này biến nó thành cam kết bắt buộc có test — QA phải có một test case chạy thật: lưu ngữ cảnh đúng lúc job vừa hoàn tất, xác nhận transcript còn nguyên.)*
- **BR-98 — Gắn file vào bản ghi đã có**: từ Meeting Detail của một bản ghi **chưa có audio và có transcript rỗng** (ví dụ meeting tạo bằng "Save as Draft" trước khi đi họp), người dùng gắn được một file ghi âm vào chính bản ghi đó thay vì tạo bản ghi mới — toàn bộ ngữ cảnh đã nhập trước đó được giữ nguyên. Bản ghi đã có audio hoặc đã có transcript → chặn, nêu rõ lý do và đề nghị tạo bản ghi mới. Ở v1 không có thao tác thay thế audio của bản ghi đã có (tránh phá `duration`/`transcript` đã lưu).

### E. Chờ lâu, thất bại, thử lại

- **BR-99**: Import chạy nền: người dùng vẫn điều hướng, sửa bản ghi khác, xem summary cũ bình thường. Import **không** được làm gián đoạn một phiên ghi âm trực tiếp đang chạy.
- **BR-100**: Đóng tab / reload trình duyệt / tắt trình duyệt **không** huỷ công việc đang chạy trên server. Mở lại app phải hiển thị đúng trạng thái hiện tại của từng bản ghi đang xử lý và tiếp tục theo dõi tới khi kết thúc, không cần người dùng thao tác gì.
- **BR-101**: Không hiển thị phần trăm tiến trình nếu không có số liệu tiến trình thật từ provider. Chỉ hiển thị trạng thái (đang chờ / đang tải lên / đang chuyển giọng nói / xong / lỗi) và thời gian đã trôi qua. Chỉ hiển thị ước lượng thời gian còn lại khi có cơ sở đo thật; không bịa thanh tiến trình chạy đều.
- **BR-102**: Một job vượt quá ngưỡng thời gian tối đa cho phép phải kết thúc ở trạng thái **thất bại có lý do rõ ràng**, không được treo vô hạn ở "đang xử lý". Ngưỡng phải đủ lớn cho file 3 giờ. *(Cần Tech Lead chốt con số và rà lại các timeout đang có — ví dụ Google `POLL_TIMEOUT_MS = 15 phút`, `server/stt/providers/google.js:15`, có thể quá ngắn cho ghi âm dài; xem R-P.)*
- **BR-103 — Không bao giờ xoá audio khi chuyển giọng nói thất bại**: job lỗi vì bất kỳ lý do gì (hết hạn mức, mất mạng, key sai, quá dung lượng, server restart) → file audio đã lưu **được giữ nguyên**, bản ghi ở trạng thái lỗi và có thao tác "Thử lại", cho phép **đổi provider/ngôn ngữ trước khi thử lại**. Lý do nghiệp vụ: cuộc họp đã qua, không ghi âm lại được, và người dùng có thể đã xoá file gốc trên điện thoại.
- **BR-104**: Thông báo lỗi khi import phải bằng tiếng Việt, nêu nguyên nhân theo ngôn ngữ người dùng hiểu được và việc cần làm tiếp theo. Cấm hiển thị mã lỗi kỹ thuật trần (`STT_TRANSCRIBE_FAILED`, HTTP 413…) làm nội dung chính; mã lỗi chỉ được nằm ở phần chi tiết phụ.
- **BR-105 — Không để lại bản ghi mồ côi**: nếu việc lưu file audio thất bại (hết dung lượng đĩa, đọc file lỗi giữa chừng), hệ thống không được để lại trong thư viện một bản ghi vĩnh viễn không dùng được: hoặc không tạo bản ghi, hoặc bản ghi lỗi đó phải có sẵn hai thao tác "Chọn lại file" và "Xoá bản ghi này". *(Hành vi hôm nay: meeting đã tạo vẫn nằm lại với `status:'failed'` — `js/app.js:3853-3862`.)*

### F. Chất lượng ghi âm điện thoại

- **BR-106 — Cảnh báo chất lượng dựa trên số đo, không dựa trên cảm tính**: sau khi có transcript, nếu bản ghi dài ≥ 5 phút và **mật độ chữ** (tổng số từ trong transcript chia cho số phút thời lượng) thấp hơn ngưỡng cấu hình sẵn (đề xuất khởi điểm: **60 từ/phút**) → hiển thị cảnh báo mềm: bản ghi có thể nghe không rõ, kèm gợi ý kiểm tra lại và mẹo ghi âm lần sau. Cảnh báo **không** chặn thao tác nào, **không** ngăn Generate Summary, và bỏ qua được. *(Ngưỡng là phán đoán thận trọng, chưa đo trên dữ liệu thật — giống tinh thần BR-7/BR-35; QA được đề xuất chỉnh sau khi có dữ liệu.)*
- **BR-107**: Không hiển thị bất kỳ đánh giá chất lượng nào **trước khi** chạy chuyển giọng nói (app không giải mã được audio, mọi phán đoán trước đó đều là đoán mò). Thay vào đó, khu vực import có một mục mẹo ghi âm bằng điện thoại thu gọn được (đặt máy giữa bàn, không úp mặt mic xuống, tắt rung/thông báo, kiểm tra pin và dung lượng trống), ẩn vĩnh viễn được sau khi người dùng đã đọc.
- **BR-108**: Bản ghi được tạo bằng import phải **phân biệt được** với bản ghi ghi trực tiếp trong app (một dấu hiệu nguồn lưu trên bản ghi + nhãn nhẹ trong Meeting Detail). Lý do nghiệp vụ: giải thích vì sao chất lượng/độ dài/không có bản dịch trực tiếp khác nhau, và để người dùng biết bản ghi này có file gốc đến từ ngoài. Dấu hiệu này **không** được ảnh hưởng tới preset, snapshot, hay bất kỳ logic tóm tắt nào.

### G. Trùng lặp và toàn vẹn dữ liệu

- **BR-109 — Cảnh báo import trùng**: nếu file đang import khớp với một bản ghi đã có theo **cả hai** tiêu chí (tên file gốc giống nhau **và** kích thước byte giống hệt), hệ thống cảnh báo "Có thể bạn đã import file này ngày …" và cho 3 lựa chọn: mở bản ghi đã có / vẫn import thành bản ghi mới / bỏ qua file này. **Không** tự chặn và **không** tự gộp — tên file điện thoại rất dễ trùng ("Bản ghi mới 1.m4a") nên chỉ khớp tên là không đủ để kết luận. Lý do nghiệp vụ: import trùng = trả tiền chuyển giọng nói hai lần cho cùng một nội dung.
- **BR-110**: Một thao tác chọn file chỉ tạo **một** bản ghi và **một** job cho mỗi file, kể cả khi người dùng bấm nút hai lần liên tiếp hoặc thả file hai lần. *(Server đã dedupe theo `meetingId` — `server.js:1424-1459`; rule này bổ sung yêu cầu phía client không tạo hai meeting khác id cho cùng một lần chọn.)*
- **BR-111**: Tên file gốc chỉ là dữ liệu hiển thị và gợi ý tiêu đề. Cấm dùng tên file gốc (hoặc bất kỳ chuỗi nào do client cung cấp) để đặt tên/đường dẫn file ghi xuống đĩa — giữ nguyên cơ chế hash SHA-256 hiện có. Tên file chứa emoji, dấu tiếng Việt, ký tự `/`, `..`, hoặc dài bất thường phải được xử lý an toàn và vẫn hiển thị đọc được.
- **BR-112**: Mọi field mới sinh ra bởi feature này có mặt trong backup JSON; khi import backup cũ thiếu field → nhận giá trị mặc định, không lỗi (nhất quán BR-31, BR-76).

### H. Sau khi import xong

- **BR-113**: Sau khi import, người dùng luôn nhìn thấy được bản ghi vừa tạo, kể cả khi `date` đã lùi về quá khứ khiến nó không còn nằm đầu thư viện (điều hướng tới bản ghi, hoặc đánh dấu nổi bật nó trong danh sách). Không chấp nhận tình huống "import xong không biết bản ghi đi đâu".
- **BR-114**: Hệ thống **không** tự động Generate Summary sau khi import xong (tốn chi phí LLM ngoài ý muốn và người dùng có thể chưa nhập xong notes). Summary vẫn do người dùng chủ động bấm, theo đúng BR-15.
- **BR-115**: Khi transcript đã xong mà `title` vẫn y hệt tên file gốc (người dùng chưa sửa), gợi ý mềm dùng tính năng đặt tiêu đề tự động sẵn có. Gợi ý bỏ qua được và không tự đổi tiêu đề.
- **BR-116 — Không có nhánh riêng cho bản ghi import**: sau khi transcript hoàn tất, bản ghi tạo bằng import phải dùng **cùng** đường đi với bản ghi ghi trong app cho: gợi ý preset theo `meetingType` (BR-55→58), sinh summary và map-reduce cho transcript dài (BR-32, BR-38), tag (BR-68→74), tìm kiếm (BR-30, BR-73), export .md (BR-40→54). Nếu một bước nào đó **không** áp dụng được cho bản ghi import, điều đó phải được nêu tường minh trong Architecture.md kèm lý do và mặc định là **bỏ qua bước đó** cho tới khi verify — không được để chạy ngầm rồi "chắc là ổn vì dùng chung code" (Protocol 8).

## 6. Acceptance Criteria

| User Story | Acceptance Criteria |
|---|---|
| US-14 | Import một file `.m4a` ~10 phút với provider đã cấu hình → bản ghi xuất hiện, transcript có nội dung, `duration` > 0, `status = completed` (BR-89, BR-96). Bản ghi đó Generate Summary được và kết quả đúng cấu trúc preset như bản ghi ghi trong app (BR-116). |
| US-15 | Trong bước import, nhập `meetingType = sales-call` + `topic` + `leadBy` + 2 tag → sau khi transcript xong, Meeting Detail hiện đủ các giá trị đó, dropdown preset tự chọn "Sales call" (BR-55), tag "Sales call" tự xuất hiện (BR-70), export ra tên file `<yymmdd>-<topic>-SC.md` (BR-45). Bỏ trống toàn bộ ngữ cảnh → import vẫn chạy, không có thông báo chặn nào (BR-91). |
| US-15 | Đóng bước nhập ngữ cảnh giữa chừng → bản ghi vẫn được tạo, transcript vẫn chạy, các field bỏ dở để trống và sửa được sau tại Meeting Detail (BR-96). |
| US-15 | Sửa và lưu ngữ cảnh đúng lúc job vừa chạy xong → transcript, `duration`, `status` vẫn nguyên; bản ghi không bị quay về "đang xử lý" (BR-97). Test này bắt buộc chạy thật, không mock. |
| US-16 | Import một file có `date` mặc định lấy từ thời điểm import → sửa thành ngày họp thật (tuần trước) → bản ghi nằm đúng vị trí theo ngày trong thư viện và tên file export mang `yymmdd` của ngày họp, không phải ngày import (BR-92, BR-45). `createdAt` không đổi (BR-92). |
| US-16 | Nhập ngày ở tương lai 1 tháng → bị từ chối, quay về thời điểm import kèm giải thích (BR-94). |
| US-17 | Chọn file `.m4a` 40MB khi provider đang chọn là OpenAI Whisper (giới hạn 25MB) → **không** có bản ghi nào được tạo, **không** có byte nào được upload, thông báo nêu dung lượng file + giới hạn + danh sách provider xử lý được file này (BR-85). |
| US-17 | Chọn file `.m4a` khi provider đang chọn là Google → cảnh báo không hỗ trợ định dạng và đề nghị đổi provider; hệ thống không tự đổi (BR-86). |
| US-17 | Chọn file `.txt` (hoặc `.opus` khi chưa verify) → bị từ chối kèm thông báo nêu tên file, đuôi thực tế, danh sách đuôi chấp nhận và một câu hành động cụ thể bằng tiếng Việt (BR-80, BR-82). |
| US-17 | Chọn file 0 byte → bị từ chối trước khi tạo bản ghi, thông báo nhắc khả năng file chưa tải xong từ dịch vụ đồng bộ (BR-83). |
| US-18 | Chọn 4 file hợp lệ cùng lúc → tạo đúng 4 bản ghi riêng biệt, mỗi bản ghi đúng tên file của nó, tối đa 2 job chạy đồng thời, 2 file còn lại hiển thị "đang chờ" phân biệt được với "đang xử lý" (BR-88, BR-89). |
| US-18 | Chọn 5 file trong đó 2 file sai định dạng → 3 bản ghi được tạo, 2 file bị từ chối liệt kê rõ ràng, không có bản ghi rỗng nào (BR-81). |
| US-18 | Chọn 15 file → 10 file đầu được nhận, phần còn lại được báo rõ là chưa nhận (BR-88). |
| US-19 | Import file dài, đóng tab sau 10 giây, mở lại app → bản ghi vẫn ở trạng thái đúng và tiếp tục cập nhật tới khi xong, không cần thao tác thủ công (BR-100). |
| US-19 | Cắt mạng/dùng key sai để ép job thất bại → bản ghi ở trạng thái lỗi với thông báo tiếng Việt dễ hiểu (BR-104), file audio vẫn còn (kiểm tra phát lại được), bấm "Thử lại" sau khi đổi provider → chạy lại thành công trên chính file cũ (BR-103). |
| US-19 | Trong lúc job đang chạy, giao diện không hiển thị phần trăm/thanh tiến trình giả; chỉ có trạng thái + thời gian đã trôi (BR-101). |
| US-20 | Dùng một file ghi âm rất nhỏ tiếng dài ≥ 5 phút cho ra transcript thưa → cảnh báo chất lượng xuất hiện, không chặn Generate Summary, bỏ qua được (BR-106). File chất lượng tốt → không có cảnh báo (BR-106, tránh báo động giả). |
| US-14 | Import lại đúng file vừa import → cảnh báo trùng với 3 lựa chọn; chọn "vẫn import" → tạo bản ghi thứ hai bình thường; chọn "bỏ qua" → không tạo gì, không job nào chạy (BR-109). |
| US-14 | Bấm nút import hai lần thật nhanh cho cùng một file → đúng 1 bản ghi, đúng 1 job (BR-110). |
| US-15 | Từ một bản ghi draft đã nhập sẵn ngữ cảnh (chưa có audio, transcript rỗng) → gắn file vào chính bản ghi đó; ngữ cảnh giữ nguyên, transcript chạy trên bản ghi đó, không tạo bản ghi thứ hai (BR-98). Thử gắn file vào bản ghi đã có transcript → bị chặn kèm lý do (BR-98). |
| — | Kiểm tra bảo mật: trong toàn bộ luồng import, server không mở thêm cổng nào ngoài 127.0.0.1, không có endpoint nào nhận đường dẫn/tên file do client chỉ định để ghi xuống đĩa; file với tên chứa `../`, emoji, độ dài 255 ký tự vẫn import được và vẫn ghi qua hash (BR-77, BR-111). |

## 7. Out of Scope (v1)

- **Nhận file qua LAN, QR pairing, watch folder, đồng bộ cloud, import từ URL/link Drive** — quyết định user D-12.
- **Ghép nhiều file thành một cuộc họp** (ghi âm bị cắt thành nhiều phần do hết pin/nghe điện thoại giữa chừng). v1: mỗi file là một bản ghi riêng; người dùng tự ghép file bằng công cụ ngoài trước khi import nếu muốn một bản ghi duy nhất. *(Xem câu hỏi Q1 — nếu user coi đây là tình huống thường gặp thì phải đưa lên v1.)*
- **Tách audio từ file video** (cần ffmpeg — app hiện zero-dependency, không có binary xử lý media).
- **Tự động chuyển đổi/nén định dạng** để lách giới hạn dung lượng của provider (cùng lý do trên).
- **Tự động tóm tắt ngay sau khi transcript xong** — xem Q2.
- **Import file transcript/phụ đề có sẵn** (`.txt`, `.srt`, `.vtt`) mà không có audio — xem Q6.
- **Thay thế audio của một bản ghi đã có transcript** (BR-98 chỉ cho gắn vào bản ghi trống).
- **Cắt/chọn khoảng thời gian trong file để chuyển giọng nói** (ví dụ bỏ 10 phút đầu lúc chờ mọi người vào phòng).
- **Nhận diện người nói bằng giọng** — đã out of scope từ v2.0 (D-5, BR-62), không đổi.
- **Quản lý dung lượng đĩa cho kho audio** (dọn file cũ, xem tổng dung lượng đang dùng) — xem R-Q.

## 8. Rủi ro cần Tech Lead quyết trước khi Dev bắt đầu

| # | Rủi ro | Ghi chú |
|---|---|---|
| **R-L** | Client hiện **không** biết `maxUploadBytes` của provider (đã verify: `listProviders()` không trả field này — `server/stt/index.js:109-133`) → BR-85 không thực hiện được nếu không mở thêm dữ liệu cho client | Tech Lead quyết cách để client biết giới hạn + định dạng hỗ trợ của từng provider mà không phá nguyên tắc "route không học format của provider" (`server/stt/index.js:3-5`). |
| **R-M** | Các con số giới hạn/định dạng trong repo (500MB/1GB/25MB/10MB, danh sách mime của Google) là thứ **app đang tự enforce**, `[UNVERIFIED]` so với doc chính thức của nhà cung cấp. Enforce chặt hơn thực tế → từ chối oan file chạy được; lỏng hơn thực tế → lỗi vẫn xảy ra sau khi chờ | Protocol 5: cần nguồn xác thực (doc chính thức hoặc log chạy thật) trước khi BR-84/85/86 được coi là đúng. Đây cũng là cửa để mở rộng danh sách đuôi ở BR-82. |
| **R-N** | Nạp audio vào RAM xảy ra **trước** hàng đợi provider (đã verify `server/stt/index.js:100-103`) → import lô nhiều file lớn có thể làm process Node phình bộ nhớ/crash | BR-88 (10 file, 2 job đồng thời) là lớp bù nghiệp vụ. Tech Lead cần đo thật với file 500MB × 2 và quyết ngưỡng cuối; được siết chặt hơn, không được nới lỏng nếu chưa đo. |
| **R-O** | `[UNVERIFIED]` ngày ghi âm nhúng trong `.m4a` của iPhone Voice Memos; `[UNVERIFIED]` độ tin cậy của `file.lastModified` sau AirDrop/Drive/Zalo | BR-93 đã viết để **không phụ thuộc** vào việc này (fallback = thời điểm import). Nếu không verify được → bỏ hẳn nguồn suy ra từ file, không đoán. |
| **R-P** | Ngưỡng timeout hiện có có thể quá ngắn cho file 3 giờ — ví dụ Google `POLL_TIMEOUT_MS = 15 phút` (`server/stt/providers/google.js:15`); các provider khác cần rà tương tự | BR-102 yêu cầu job luôn kết thúc có lý do. Tech Lead chốt ngưỡng cho từng provider và cách phân biệt "chưa xong" với "treo". |
| **R-Q** | Kho audio phình to: file 2GB/bản ghi được phép, import nhiều cuộc họp dài → đĩa đầy; BR-103 lại cấm xoá audio khi lỗi | v1 chấp nhận đánh đổi này (ưu tiên không mất dữ liệu). Tech Lead cần ít nhất đảm bảo lỗi "hết dung lượng đĩa" được báo rõ (BR-104, BR-105), không làm hỏng `meetings.json`. |
| **R-R** | Guard chống ghi đè transcript ở PUT `/api/meetings` chỉ kích hoạt khi bản browser gửi lên có `status === 'processing'` (`server.js:1522`). Luồng import mới cho phép người dùng sửa ngữ cảnh ở nhiều thời điểm khác nhau → cần xác nhận guard còn đủ cho mọi tổ hợp | BR-97 bắt buộc có test thật. Nếu guard không đủ, Tech Lead phải mở rộng nó, không được chỉ dựa vào "client thường gửi đúng". |
| **R-S** | BR-87 cho chọn provider/model theo từng lần import → mở rộng bề mặt input của endpoint `/api/import-transcription` (hiện đã nhận `provider`/`model` nhưng client chưa gửi) | Reviewer kiểm: giá trị lạ phải bị từ chối bằng danh sách trắng ở server, không tin dữ liệu client. |

## 9. Assumptions

1. Feature này **không** đụng `schemas/meeting-summary.schema.json` và không đụng 3 cơ chế enforce schema của 3 provider LLM — import chỉ tạo ra một bản ghi có transcript giống hệt bản ghi trong app, phần tóm tắt đi đường cũ (BR-116).
2. Người dùng đã tự chuyển được file sang máy. Việc hướng dẫn cách AirDrop/cắm cáp/tải từ Drive nằm ngoài phần mềm (có thể bổ sung vào `HUONG-DAN-SU-DUNG.md`, không phải code).
3. Ngưỡng 10 file/lần, 2 job đồng thời, 60 từ/phút, 5 phút tối thiểu để cảnh báo chất lượng đều là **phán đoán thận trọng chưa đo trên dữ liệu thật** (cùng tinh thần BR-7, BR-35, BR-54).
4. Dữ liệu vẫn là single-user, không có tài khoản/phân quyền — import không tạo ra khái niệm "file của ai".
5. v1 không thêm cảnh báo pháp lý/consent khi import bản ghi âm; giữ nguyên chính sách đã công bố tại `SECURITY.md` — xem Q8.
6. Feature này không cần thêm npm dependency nào; nếu một phương án bắt buộc phải thêm (ví dụ thư viện đọc metadata audio) thì phải kiểm tra lại 2 script đóng gói DMG/EXE vì chúng copy danh sách trắng cố định, không có `node_modules` (xem bảng verify PRD v2.0 §4A).

## 10. Câu hỏi còn cần user chốt (kèm đề xuất mặc định)

| # | Câu hỏi | Phát sinh từ | Chặn bước nào | Đề xuất mặc định |
|---|---|---|---|---|
| Q1 | Ghi âm bị cắt thành nhiều phần (hết pin, nghe điện thoại giữa chừng) có phải chuyện anh gặp thường không? Nếu có thì 2–3 file đó cần thành **một** bản ghi duy nhất hay để riêng cũng được? | BR-89 | Chỉ chặn nếu câu trả lời là "thường gặp" — khi đó phải thiết kế lại luồng, ảnh hưởng Tech Lead | **Để riêng, mỗi file một bản ghi ở v1**; ghép file bằng công cụ ngoài nếu cần |
| Q2 | File 3 tiếng chạy rất lâu — anh có muốn app **tự tóm tắt luôn** sau khi transcript xong (đi ngủ, sáng dậy có sẵn biên bản) không? | BR-114 | Tech Lead (thêm một chuỗi job transcript→summary, phải verify theo Protocol 6) | **Không làm ở v1** — tránh tốn chi phí LLM ngoài ý muốn; người dùng tự bấm Generate |
| Q3 | Có bao giờ anh tạo sẵn bản ghi trong app trước khi đi họp (nhập chủ đề, người tham dự) rồi mới ghi âm bằng điện thoại không? | BR-98 | Không chặn (nếu "không" thì BR-98 rơi khỏi scope, tiết kiệm công) | **Có làm ở v1** — chi phí thấp vì dùng lại đúng luồng import |
| Q4 | Một lần anh thường import mấy file? 10 file/lần có đủ không? | BR-88 | Không chặn | **10 file/lần, 2 file xử lý cùng lúc** |
| Q5 | Khi bản ghi nghe không rõ, anh muốn app cảnh báo hay im lặng để khỏi phiền? | BR-106 | Không chặn | **Cảnh báo mềm, bỏ qua được, có thể tắt vĩnh viễn** |
| Q6 | Anh có sẵn file transcript/phụ đề từ nguồn khác (`.txt`, `.srt`) muốn nhập thẳng vào app để tóm tắt không? | Out of Scope | Không chặn | **Không làm ở v1** |
| Q7 | Khi file vượt giới hạn của dịch vụ đang chọn nhưng dịch vụ khác nhận được — app nên **tự đổi** hay **hỏi** anh? | BR-86 | Không chặn | **Hỏi, không tự đổi** (khác chi phí và chất lượng) |
| Q8 | Có cần app nhắc một dòng về việc xin phép người tham dự trước khi ghi âm không? | Assumption 5 | Không chặn | **Không thêm ở v1** |

---

# PRD v3.0 — Bổ sung sau vòng trả lời của user (import-phone-recording)

**Ngày**: 2026-09-18
**Quan hệ với phần trên**: phần này **bổ sung**, không thay thế mục 1–10 của PRD v3.0 ở trên. Ngoại lệ duy nhất được ghi rõ: **BR-89 bị thay thế bởi BR-117**.

## 11. Quyết định mới của user

| # | Vấn đề | Quyết định |
|---|---|---|
| D-14 | Q1 — ghi âm bị cắt khúc | **Đảo ngược mặc định của BA**: cắt khúc (hết pin, nghe điện thoại giữa chừng) là chuyện **hay gặp**. Luồng import phải hỗ trợ **cả hai** chế độ: nhiều file = nhiều bản ghi (mặc định), và nhiều file = **một** bản ghi ghép (người dùng chọn). BR-89 viết lại thành BR-117. |
| D-15 | Ngôn ngữ giao diện | Toàn bộ text **mới** của luồng import viết bằng **tiếng Việt**. Không đụng text tiếng Anh cũ ở nơi khác. |
| D-16 | Pre-flight check (BR-85 + R-L) | **Nằm trong scope**. Được phép sửa server để `/api/stt/providers` trả thêm `maxUploadBytes` và danh sách định dạng provider nhận được. Đây là **yêu cầu bắt buộc**, không còn là "nếu Tech Lead cho phép". R-L chuyển từ rủi ro-cần-quyết sang việc-phải-làm. |
| D-17 | Sửa thông tin ở Meeting Detail | Sửa `date` + `participants` (và các pre-meeting field cùng card) ở Meeting Detail **nằm trong scope**, áp dụng cho **mọi** bản ghi, không riêng bản ghi import. |

## 12. Trạng thái đã verify — bổ sung cho việc ghép nhiều phần

BA đã đọc source để trả lời câu hỏi PM đặt ra ("`result.duration` có tin được không"). Kết quả **quyết định toàn bộ thiết kế ghép timestamp**:

| Provider | `duration` trả về là gì | Có phải thời lượng audio thật? | Nguồn |
|---|---|---|---|
| Soniox | `audio_duration_ms / 1000` | **Có** | `server/stt/providers/soniox.js:160` |
| Deepgram | `metadata.duration` | **Có** | `server/stt/providers/deepgram.js:143` |
| Whisper — model verbose | `body.duration` (từ `response_format=verbose_json`) | **Có** (khi API trả) | `server/stt/providers/whisper.js:82-84,120` |
| Whisper — model `gpt-4o-*` | không có → `0`; transcript là **một segment duy nhất tại `time: 0`** | **Không** | `server/stt/providers/whisper.js:85-87,111-115,120` |
| Google | **thời điểm bắt đầu của TỪ CUỐI CÙNG** (`words[last].start`) | **Không** — luôn ngắn hơn thời lượng thật, bỏ qua độ dài từ cuối và toàn bộ im lặng cuối file | `server/stt/providers/google.js:159` |

Thêm hai điểm đã verify, ảnh hưởng trực tiếp tới rule ghép:

| Điểm | Kết quả verify | Nguồn |
|---|---|---|
| `duration` và `time` có thể về 0 một cách hợp lệ | `normalizeResult` trả `duration: 0` khi giá trị không hữu hạn; `normalizeSegments` đặt `time: 0` khi không hữu hạn — không ném lỗi, không phân biệt được "0 thật" với "không biết" | `server/stt/contracts.js:69,88` |
| Phần audio không có giọng nói = **lỗi toàn phần** | `normalizeResult` ném `STT_TRANSCRIBE_FAILED` khi `transcript.length === 0` | `server/stt/contracts.js:82-84` |
| Staleness hint BR-29 bám vào `updatedAt` | `_preMeetingStaleHint` so `meeting.updatedAt` với `summaryGeneration.generatedAt`. Mọi lần lưu bất kỳ (sửa tag, tick action item, server ghi transcript) đều bump `updatedAt` → hint bật cả khi không có gì liên quan tới prompt thay đổi | `js/app.js:2027-2036`; `js/storage.js:186`; `server.js:664` |
| Audio là quan hệ 1–1 với meeting | Đường dẫn audio suy ra từ `meetingId` (hash), meeting có đúng một `audioId` | `server.js:399,770-775`; `js/storage.js:515` |

**Kết luận nghiệp vụ**: `result.duration` **không** dùng làm offset ghép được một cách vô điều kiện. Với Google và Whisper `gpt-4o-*`, dùng thẳng nó sẽ làm phần sau **chồng lên** phần trước. BR-125 dưới đây được viết để đúng trong cả 5 trường hợp của bảng trên.

## 13. Business Rules bổ sung (BR-117 → BR-146)

### I. Hai chế độ import — nhiều bản ghi hoặc một bản ghi ghép

- **BR-117** *(thay thế hoàn toàn BR-89)*: Khi người dùng chọn từ 2 file trở lên, luồng import cung cấp hai chế độ:
  1. **Mỗi file một bản ghi** — mặc định, giữ đúng hành vi mô tả ở BR-88/BR-81.
  2. **Ghép thành một bản ghi** — N file được coi là N **phần** liên tiếp của cùng một cuộc họp, cho ra **đúng một** bản ghi trong thư viện.

  Hệ thống **không bao giờ** tự chuyển sang chế độ ghép. Việc chọn chế độ là hành động tường minh của người dùng. Lý do: 4 file có thể là 4 phần của một cuộc họp, cũng có thể là 4 cuộc họp khác nhau trong tuần — đoán sai theo hướng ghép sẽ trộn nội dung 4 cuộc họp vào một biên bản, hậu quả nặng hơn hẳn đoán sai theo hướng tách.
- **BR-118**: Hệ thống **được phép gợi ý mềm** chế độ ghép khi tên các file được chọn tạo thành một dãy có chỉ số liên tiếp (ví dụ `hop-phan-1.m4a`, `hop-phan-2.m4a`), dưới dạng một câu hỏi bỏ qua được. Gợi ý không bao giờ tự áp dụng và không được chọn sẵn chế độ ghép.
- **BR-119 — Thứ tự các phần**: thứ tự cuối cùng luôn là thứ tự **người dùng nhìn thấy và xác nhận**. Hệ thống đề xuất thứ tự ban đầu theo, lần lượt:
  1. So sánh tên file theo kiểu **tự nhiên** (chuỗi số trong tên so theo giá trị số, nên `phần 2` đứng trước `phần 10`), không phân biệt hoa/thường.
  2. Nếu tên file không chứa chỉ số phân biệt được → dùng thời điểm sửa đổi file làm gợi ý phụ, và **phải** ghi rõ trên giao diện rằng đây là suy đoán.
  3. Không có căn cứ nào → giữ nguyên đúng thứ tự người dùng đã chọn file.

  Người dùng sắp xếp lại thứ tự được (kéo thả hoặc nút lên/xuống) trong mọi trường hợp. Rule này phải hoạt động kể cả khi thời điểm sửa đổi file hoàn toàn sai — đó là lý do nguồn (2) chỉ là **gợi ý phụ** và không bao giờ là căn cứ cuối cùng. *(`[UNVERIFIED]` độ tin cậy của `file.lastModified` sau AirDrop/Drive/Zalo — xem R-O.)*
- **BR-120**: Chế độ ghép **không được** bắt đầu chạy trước khi người dùng xác nhận thứ tự các phần trên một danh sách hiển thị rõ ràng (số thứ tự + tên file). Không có xác nhận → không tạo bản ghi, không gọi provider. Lý do: sai thứ tự làm sai dòng thời gian của biên bản và khiến AI phân loại nhầm "đã chốt" / "đang bàn" (BR-61), mà người dùng rất khó phát hiện khi đọc summary.
- **BR-121 — Sắp xếp lại sau khi đã chạy**: dữ liệu transcript của **từng phần** phải được giữ nguyên vẹn, tách bạch, để bản transcript ghép có thể được **dựng lại** khi người dùng sắp xếp lại thứ tự các phần. Sắp xếp lại **không** được gọi lại provider và **không** được phát sinh chi phí. Sắp xếp lại sau khi đã có summary → không tự sinh lại summary, không đụng snapshot đã lưu (nhất quán BR-17, BR-29).
- **BR-122**: Tối đa **10 phần** cho một bản ghi ghép (bằng giới hạn file/lần ở BR-88). Từ **6 phần trở lên** → cảnh báo mềm về thời gian chờ và chi phí trước khi xác nhận. Vượt 10 → báo rõ, không im lặng cắt bớt.
- **BR-123 — N phần = N job, 1 bản ghi**: mỗi phần là một lần gọi provider riêng (provider nhận một file mỗi request), nên bản ghi ghép 5 phần sinh ra **5 job**, tuân thủ nguyên vẹn giới hạn 2 job đồng thời của BR-88. Nhưng trong thư viện chỉ xuất hiện **một** bản ghi ngay từ đầu, với trạng thái tổng hợp của các phần (BR-131) — không được hiện 5 bản ghi rồi gộp lại sau.
- **BR-124 — Đồng nhất cấu hình giữa các phần**: mọi phần của một bản ghi ghép dùng **cùng** provider, cùng model, cùng ngôn ngữ, cùng ngôn ngữ dịch. Ngoại lệ duy nhất: khi thử lại một phần bị lỗi (BR-132), người dùng được đổi provider cho riêng phần đó, và hệ thống phải cảnh báo trước rằng nhãn người nói và văn phong của phần đó có thể lệch so với các phần còn lại.

### J. Ghép dòng thời gian và thời lượng

- **BR-125 — Cách tính offset**: các phần được nối tiếp nhau trên một dòng thời gian tăng dần. Offset của phần đầu tiên là 0. Offset của phần N+1 = offset của phần N **+ độ dài quy ước của phần N** + một khoảng ngăn cách cố định nhỏ (đề xuất 1 giây). Trong đó **độ dài quy ước của phần N** = giá trị **lớn nhất** giữa: (a) `duration` do provider trả về cho phần đó, và (b) mốc thời gian của segment cuối cùng trong phần đó. Không được dùng thẳng (a).

  Lý do bắt buộc phải lấy max: đã verify Google trả `duration` = thời điểm bắt đầu của **từ cuối cùng** (`server/stt/providers/google.js:159`) và Whisper `gpt-4o-*` trả `duration = 0` (`server/stt/providers/whisper.js:120`). Dùng thẳng (a) trong hai trường hợp đó khiến phần sau **chồng lên** phần trước trên dòng thời gian. Công thức max + khoảng ngăn cách đảm bảo dòng thời gian **luôn tăng dần và không chồng lấn** với cả 5 trường hợp trong bảng §12.
- **BR-126 — Độ dài quy ước không đáng tin phải được đánh dấu**: khi độ dài quy ước của bất kỳ phần nào **không** bắt nguồn từ thời lượng audio thật (provider trả `duration = 0`, hoặc provider nằm trong nhóm đã biết là không trả thời lượng thật), bản ghi ghép phải mang dấu hiệu "**thời lượng chỉ là ước lượng**". Dấu hiệu này hiển thị được cho người dùng ở chỗ nào có hiện thời lượng, và phải có trong dữ liệu để các rule khác đọc được (BR-127).
- **BR-127 — Thời lượng bản ghi ghép**: `duration` của bản ghi ghép = **tổng thời lượng audio của các phần**. **Không** cộng khoảng nghỉ thực tế giữa các phần (người dùng dừng ghi 5 phút rồi ghi tiếp) — khoảng nghỉ đó không đo được từ dữ liệu app có, và cộng vào sẽ làm sai cả thời lượng hiển thị lẫn con số chi phí. Khoảng ngăn cách kỹ thuật ở BR-125 **không** được cộng vào `duration`.
- **BR-128 — Không để cảnh báo chất lượng báo oan**: mật độ chữ ở BR-106 tính trên `duration` theo BR-127 (tức không bị khoảng nghỉ giữa các phần kéo xuống). Nếu bản ghi mang dấu hiệu "thời lượng chỉ là ước lượng" (BR-126) → **bỏ qua** cảnh báo chất lượng cho bản ghi đó, vì mẫu số không đáng tin. Thà không cảnh báo còn hơn cảnh báo sai.
- **BR-129 — Không bịa timestamp cho khoảng nghỉ**: khoảng nghỉ giữa các phần **không** được biểu diễn bằng một khoảng trống thời gian giả trong transcript. Thay vào đó, transcript ghép phải có **dấu phân cách hiển thị rõ** giữa hai phần, nêu số thứ tự phần và tên file nguồn (ví dụ "— Phần 2/3 · hop-phan-2.m4a —"). Dấu phân cách phải xuất hiện cả trong transcript trên màn hình lẫn trong file export .md (BR-51).
- **BR-130 — Nhãn người nói chỉ có giá trị trong phạm vi một phần**: "Speaker 1" của phần 1 và "Speaker 1" của phần 2 do provider đánh độc lập, **không** đảm bảo là cùng một người. Với bản ghi ghép, nhãn người nói phải phân biệt được theo phần, và prompt tóm tắt phải được cho biết điều này để BR-62 (LLM suy luận tên người nói) **không** gộp nhầm hai người khác nhau thành một. Không suy luận được → giữ `[chưa rõ người nói]` theo đúng BR-62, không đoán.

  *(Đây là điểm dễ bị bỏ sót nhất của feature: từng phần transcribe đúng, ghép đúng thứ tự, nhưng biên bản vẫn sai người — và người dùng gần như không thể phát hiện khi chỉ đọc summary. Áp dụng nhất quán cho cả 3 builder prompt, đúng tinh thần BR-32/Protocol 6.)*
- **BR-131 — Provider không trả timestamp vẫn phải ghép được**: đã verify Whisper `gpt-4o-*` trả **một segment duy nhất tại `time: 0`** cho cả file. Bản ghi ghép trong trường hợp này vẫn phải ghép đúng **thứ tự các phần** và vẫn hiển thị dấu phân cách BR-129; hệ thống **không** được bịa ra mốc thời gian không có thật để làm đẹp giao diện.

### K. Một phần thất bại

- **BR-132 — Trạng thái của bản ghi ghép**:
  - Còn ít nhất một phần chưa kết thúc → `processing`.
  - Tất cả các phần thành công → `completed`.
  - Tất cả các phần thất bại → `failed`.
  - Có phần thành công **và** có phần thất bại → `completed` **kèm dấu hiệu "thiếu phần"** hiển thị nổi bật, kèm danh sách phần nào thiếu và vì sao.

  Lý do không đặt là `failed` ở trường hợp cuối: người dùng vẫn cần đọc được 2/3 nội dung đã có; đặt `failed` sẽ chôn luôn phần chạy được. Nhưng tuyệt đối **không** được hiển thị bản ghi thiếu phần y như bản ghi đầy đủ.
- **BR-133 — Thử lại từng phần**: chỉ chạy lại **đúng phần bị lỗi**, không đụng các phần đã xong và không phát sinh chi phí cho phần đã xong. Thử lại thành công → phần đó được chèn vào đúng vị trí theo thứ tự đã xác nhận (BR-119), dòng thời gian được tính lại theo BR-125, dấu hiệu "thiếu phần" được gỡ khi không còn phần nào lỗi.
- **BR-134**: Audio của **từng phần** được giữ riêng và không bị xoá khi phần đó lỗi — mở rộng nguyên vẹn BR-103 sang bản ghi ghép. Người dùng phát lại được từng phần. *(v1 không tạo ra một file audio ghép duy nhất — việc nối audio cần công cụ xử lý media, xem Out of Scope.)*
- **BR-135 — Tóm tắt trên bản ghi thiếu phần**: Generate Summary trên bản ghi mang dấu hiệu "thiếu phần" phải có bước xác nhận nêu rõ đang thiếu phần nào, và bản tóm tắt sinh ra phải ghi nhận điều đó trong thông tin provenance (cùng chỗ với `contextUsed` của BR-39). Không chặn — người dùng có quyền tóm tắt phần đang có.
- **BR-136 — Phần không có giọng nói**: đã verify hệ thống coi transcript rỗng là lỗi toàn phần (`server/stt/contracts.js:82-84`). Với bản ghi ghép, một phần im lặng (bấm nhầm, ghi hụt) **không** được làm hỏng cả bản ghi: xử lý như một phần lỗi theo BR-132/133, và thông báo phải nêu đúng nguyên nhân ("không nghe thấy giọng nói trong phần này") thay vì lỗi kỹ thuật chung chung (BR-104).

### L. Metadata của bản ghi ghép

- **BR-137**: Giá trị mặc định của bản ghi ghép:
  - `title`: tên file của **phần đầu tiên** (bỏ đuôi), sửa được ngay trong bước import (BR-95). Hệ thống **không** cố cắt bỏ hậu tố kiểu "phần 1"/"(1)" — cắt sai còn khó chịu hơn để nguyên.
  - `date`: suy ra từ **phần đầu tiên** theo đúng BR-93/BR-94 (đó là lúc cuộc họp bắt đầu), luôn sửa được.
  - `duration`: theo BR-127.
  - Tên các file nguồn: lưu **đầy đủ danh sách theo thứ tự**, không chỉ file đầu tiên. Trường `sourceFilename` hiện có phải tiếp tục dùng được với bản ghi một phần (tương thích ngược) — cách lưu danh sách do Tech Lead quyết (R-Z).
  - Thông tin chi phí/hạn mức: **cộng dồn** từ tất cả các phần (thời lượng tính phí, chi phí ước tính), không chỉ lấy phần cuối cùng ghi đè.
- **BR-138 — Pre-flight áp theo TỪNG phần**: kiểm tra định dạng và dung lượng (BR-85, BR-140) áp cho **từng file phần một**, vì provider giới hạn theo **từng request**. Không cộng dồn dung lượng các phần để so với giới hạn provider.

  Hệ quả phải nói thẳng: việc một cuộc họp được ghi thành nhiều file nhỏ **trên thực tế làm lọt qua** giới hạn 25MB của Whisper trong khi cùng nội dung ghi liền một file sẽ bị chặn. Hệ thống **chấp nhận** thực tế này (các file đó do app ghi âm của điện thoại tự cắt, không phải do MeetNote tạo ra) nhưng **cấm** biến nó thành tính năng: không được gợi ý "hãy chia nhỏ file để lách giới hạn", không được tự động chia file, và khi người dùng chọn chế độ ghép phải hiển thị rõ **tổng chi phí là tổng của các phần**, không phải chi phí của một lần gọi.
- **BR-139 — Chống trùng khi ghép**: kiểm tra trùng (BR-109, khớp tên file **và** kích thước byte) áp theo **từng phần**, không theo cả cụm, và bổ sung hai tình huống riêng của chế độ ghép:
  1. Hai phần **trong cùng một lô** trùng nhau cả tên lẫn kích thước → cảnh báo có thể đã chọn nhầm cùng một file hai lần, cho bỏ bớt ngay tại màn hình xác nhận thứ tự.
  2. Một phần trùng với file đã thuộc **một bản ghi khác** → cảnh báo nêu rõ tên bản ghi đó, vẫn cho tiếp tục (người dùng có thể cố ý dùng lại một phần), không tự chặn.
- **BR-140 — Không có nhánh riêng cho bản ghi ghép**: sau khi các phần đã xong, bản ghi ghép đi **cùng** đường với mọi bản ghi khác cho preset, tag, tìm kiếm, export, map-reduce — mở rộng nguyên vẹn BR-116. Bước nào không áp dụng được cho bản ghi ghép phải được nêu tường minh trong Architecture.md và **mặc định bỏ qua** cho tới khi verify (Protocol 8), không để chạy ngầm.

### M. Pre-flight check — bắt buộc (D-16)

- **BR-141**: Endpoint liệt kê provider phải trả thêm, cho mỗi provider: **giới hạn dung lượng một request** và **danh sách định dạng/đuôi file nhận được**. Đây là yêu cầu bắt buộc của feature, không phải tuỳ chọn. Giá trị trả về phải bắt nguồn từ chính cấu hình mà server dùng để enforce (một nguồn sự thật duy nhất) — cấm client giữ một bảng giới hạn chép tay song song, vì hai nơi sẽ lệch nhau ngay khi một provider đổi giới hạn.
- **BR-142**: Pre-flight chạy **trước** khi tạo bản ghi và trước khi gửi byte nào lên server (BR-85). Nếu không lấy được thông tin provider (server chưa sẵn sàng, lỗi mạng nội bộ) → **không chặn** import, nhưng phải báo rõ rằng lần này chưa kiểm tra trước được và lỗi có thể xuất hiện muộn hơn. Lý do không fail-closed: server chạy ở localhost, chặn cứng vì một lỗi hiếm sẽ khiến người dùng không import được gì cả.
- **BR-143**: Pre-flight ở trình duyệt chỉ để **báo sớm**. Server **vẫn phải** kiểm lại định dạng và dung lượng khi nhận file và khi chạy job (nhất quán BR-79). Endpoint mở rộng ở BR-141 chỉ trả thông tin năng lực của provider — **cấm** trả API key, một phần key, hay bất kỳ dữ liệu bí mật nào, và không được đổi bất kỳ lớp phòng thủ nào của baseline bảo mật (CLAUDE.md §Bảo mật).

### N. Sửa thông tin cuộc họp ở Meeting Detail (D-17)

- **BR-144**: Khu vực pre-meeting info ở Meeting Detail cho sửa, cho **mọi** bản ghi (ghi trong app, import một phần, import ghép): `date` (ngày **và** giờ), `participants`, cùng `meetingType`/`topic`/`leadBy` đã có sẵn. Mọi rule v2.0 giữ nguyên: giới hạn ký tự (BR-26), mã lạ quy về `''` (BR-27), gợi ý thêm `leadBy` vào participants (BR-28), tự thêm tag theo `meetingType` (BR-70).
- **BR-145**: Sửa `date` **không** làm đổi `createdAt` (BR-92), **không** đụng transcript/translations/duration, **không** sửa lại file .md đã export trước đó (file đã ghi ra đĩa là bản chụp tại thời điểm export). Chỉ ảnh hưởng tên file của lần export **sau** (BR-45). Validate theo BR-94 áp dụng y nguyên cho ô sửa này.
- **BR-146 — Sửa lại điều kiện bật nhắc nhở "thông tin mới hơn bản tóm tắt"**: nhắc nhở của BR-29 chỉ được bật khi có ít nhất một thông tin **thực sự đi vào prompt tóm tắt** thay đổi sau lần Generate gần nhất — cụ thể: `title`, `date`, `duration`, `participants`, `meetingType`, `topic`, `leadBy`, `notes`. Các thay đổi **không** vào prompt (gắn/bỏ tag, tick action item, đổi preset đang chọn, server ghi transcript) **không** được bật nhắc nhở.

  *(Hôm nay nhắc nhở bám vào `meeting.updatedAt` — `js/app.js:2031-2036` — mà `updatedAt` bị bump bởi **mọi** lần lưu, kể cả lần lưu do server ghi transcript. D-17 mở rộng số thứ sửa được ở màn hình này nên tần suất báo oan sẽ tăng, tới mức người dùng bắt đầu bỏ qua nhắc nhở — lúc đó nhắc nhở mất tác dụng cả khi nó đúng. Cần một mốc thời gian riêng cho "lần cuối sửa thông tin đi vào prompt"; mốc này là field mới → chịu BR-112 về backup.)*
- **BR-147 — Ngôn ngữ giao diện (D-15)**: toàn bộ text **mới** sinh ra bởi feature này (màn hình import, màn hình xác nhận thứ tự ghép, thông báo pre-flight, thông báo lỗi, cảnh báo chất lượng, nhãn trạng thái phần, khu vực sửa thông tin cuộc họp) viết bằng **tiếng Việt**, thuật ngữ kỹ thuật giữ nguyên tiếng Anh khi không có từ tiếng Việt thông dụng. **Không** sửa text tiếng Anh cũ ở những nơi feature này không đụng tới. Trong cùng một câu không được trộn nửa Anh nửa Việt.

## 14. Acceptance Criteria bổ sung

| User Story | Acceptance Criteria |
|---|---|
| US-21 *(mới)*: Là người dùng có bản ghi âm bị cắt thành 3 phần vì hết pin, tôi muốn nhập cả 3 file thành **một** cuộc họp duy nhất, đúng thứ tự, để biên bản không bị xé thành 3 mảnh. | Chọn 3 file → mặc định là chế độ "mỗi file một bản ghi"; bật chế độ ghép → hiện danh sách 3 phần có số thứ tự, sắp xếp lại được, phải bấm xác nhận mới chạy (BR-117, BR-119, BR-120). Kết quả: **một** bản ghi trong thư viện, transcript nối tiếp đúng thứ tự, có dấu phân cách "Phần 2/3 · <tên file>" giữa các phần (BR-129), và dấu phân cách đó cũng có trong file .md export (BR-129, BR-51). |
| US-21 | Đặt tên file lẫn lộn (`phan-10.m4a`, `phan-2.m4a`) → thứ tự đề xuất là 2 trước 10, không phải so chuỗi (BR-119). Đổi tên file thành chuỗi không có số → hệ thống vẫn đề xuất một thứ tự và ghi rõ đó là suy đoán, người dùng kéo thả sửa được (BR-119). |
| US-21 | Mốc thời gian trong transcript ghép **tăng dần đều**, không có segment nào của phần sau nằm trước segment của phần trước — kiểm với **cả** provider trả thời lượng thật (Soniox/Deepgram) **và** provider không trả (Google, Whisper `gpt-4o-*`) (BR-125). Đây là test bắt buộc, không được chỉ test với một provider. |
| US-21 | Ghép 3 phần mỗi phần 10 phút, giữa phần 1 và 2 người dùng đã nghỉ 30 phút ngoài đời → `duration` bản ghi ≈ 30 phút (tổng audio), **không** phải 60 phút (BR-127); cảnh báo chất lượng không bật oan vì khoảng nghỉ (BR-128). |
| US-21 | Ghép bằng provider không trả thời lượng thật → bản ghi mang dấu hiệu "thời lượng chỉ là ước lượng" và **không** hiện cảnh báo chất lượng (BR-126, BR-128). |
| US-21 | Bản ghi ghép có 2 người nói khác nhau ở 2 phần, cả hai đều được provider đánh nhãn "Speaker 1" → summary **không** gộp hai người thành một; không suy luận được thì ghi `[chưa rõ người nói]` (BR-130, BR-62). |
| US-22 *(mới)*: Là người dùng, khi một phần bị lỗi tôi muốn chạy lại đúng phần đó, không phải làm lại từ đầu và không phải trả tiền lại cho phần đã xong. | Ép phần 2/3 thất bại → bản ghi ở trạng thái `completed` kèm dấu hiệu "thiếu phần 2/3" nêu lý do (BR-132), phần 1 và 3 vẫn đọc được. Bấm thử lại **chỉ** phần 2 → chỉ một lần gọi provider mới được thực hiện, phần 1/3 không bị gọi lại (BR-133). Thử lại thành công → phần 2 nằm đúng vị trí giữa, dòng thời gian được tính lại, dấu hiệu "thiếu phần" biến mất (BR-133). |
| US-22 | Trong lúc mới 2/3 phần xong → bản ghi ở `processing`, không phải `completed` (BR-132). Tất cả 3 phần lỗi → `failed` (BR-132). |
| US-22 | Một phần là đoạn im lặng → phần đó báo "không nghe thấy giọng nói", hai phần còn lại **vẫn** ra transcript bình thường (BR-136). |
| US-22 | Generate Summary trên bản ghi thiếu phần → có bước xác nhận nêu rõ thiếu phần nào; sau khi tạo, thông tin provenance ghi nhận bản ghi thiếu phần (BR-135). |
| US-21 | Sắp xếp lại thứ tự các phần **sau khi** đã transcribe xong → transcript ghép đổi thứ tự đúng theo, **không** có lệnh gọi provider nào mới, không phát sinh chi phí; summary cũ và snapshot preset không bị đụng (BR-121). |
| US-17 | Chọn file `.m4a` 40MB với provider Whisper → bị chặn **trước** khi upload, thông báo nêu dung lượng, giới hạn, và provider nào xử lý được (BR-85, BR-142). Dữ liệu giới hạn đến từ endpoint provider, không từ bảng chép tay ở client (BR-141). |
| US-17 | Tắt/giả lập lỗi endpoint provider → import **vẫn chạy được**, kèm thông báo rằng lần này chưa kiểm tra trước được (BR-142). |
| US-17 | Ghép 4 phần mỗi phần 20MB với Whisper (giới hạn 25MB/request) → cả 4 phần qua pre-flight vì kiểm theo từng phần (BR-138); màn hình xác nhận hiển thị tổng chi phí là tổng 4 phần; không có chỗ nào trong giao diện gợi ý "chia nhỏ file để lách giới hạn" (BR-138). |
| US-23 *(mới)*: Là người dùng, tôi muốn sửa lại ngày giờ và danh sách người tham dự của **bất kỳ** cuộc họp nào, kể cả cuộc họp ghi trực tiếp trong app. | Ở Meeting Detail của một bản ghi ghi trực tiếp trong app: sửa `date` và `participants` → lưu đúng sau reload (BR-144), `createdAt` không đổi, transcript không đổi (BR-145). Nhập ngày tương lai 1 tháng → bị từ chối theo BR-94 (BR-145). |
| US-23 | Sau khi Generate Summary: gắn thêm một tag → **không** hiện nhắc nhở "thông tin mới hơn bản tóm tắt"; sửa `participants` hoặc `date` → **có** hiện nhắc nhở (BR-146). |
| — | Toàn bộ text mới của luồng import/ghép/pre-flight/sửa thông tin hiển thị bằng tiếng Việt; không có câu nào trộn nửa Anh nửa Việt; text tiếng Anh ở các màn hình khác không bị đổi (BR-147). |

## 15. Out of Scope — bổ sung

- **Tự động phát hiện và ghép file mà không hỏi** (BR-117 cấm; BR-118 chỉ gợi ý).
- **Tạo một file audio ghép duy nhất** từ các phần (cần công cụ xử lý media; v1 phát lại từng phần — BR-134).
- **Tự động chia nhỏ file lớn** để lách giới hạn dung lượng của provider (BR-138).
- **Ghép hai bản ghi đã tồn tại trong thư viện** thành một (v1 chỉ ghép tại thời điểm import, hoặc thêm phần vào bản ghi ghép theo Q9).
- **Căn chỉnh/khử chồng lấn nội dung** khi hai phần thực sự có đoạn trùng nhau (người dùng ghi đè lên nhau vài giây) — v1 nối thẳng theo thứ tự.
- **Đồng nhất nhãn người nói xuyên các phần** bằng phân tích giọng (v1 xử lý bằng nguyên tắc trong prompt — BR-130).

## 16. Rủi ro bổ sung cần Tech Lead quyết

| # | Rủi ro | Ghi chú |
|---|---|---|
| **R-Z** | **Mô hình dữ liệu 1 meeting ↔ N phần**: hôm nay audio là quan hệ **1–1** với meeting (đường dẫn suy từ `meetingId`, meeting có đúng một `audioId` — `server.js:399,770-775`; `js/storage.js:515`), và thông tin chi phí là **một object** không cộng dồn được (`server.js:697-707`). Bản ghi ghép cần N audio + N transcript phần + N bản ghi chi phí, **và** phải giữ tương thích ngược với bản ghi một phần | Đây là quyết định kiến trúc lớn nhất của đợt bổ sung này, chặn BR-121/132/133/134/137. Tech Lead phải chốt trước khi Dev bắt đầu. |
| **R-AA** | `duration` không đồng nhất giữa các provider (bảng §12): Google trả thời điểm từ cuối cùng, Whisper `gpt-4o-*` trả 0 | BR-125 (lấy max + khoảng ngăn cách) là lớp bù nghiệp vụ. Tech Lead xác nhận công thức này đủ, và quyết cách đánh dấu "thời lượng ước lượng" (BR-126). |
| **R-AB** | Google trả `duration` = thời điểm bắt đầu của **từ cuối cùng** — đây là **sai bản chất và đã tồn tại từ trước feature này**: nó ảnh hưởng thời lượng hiển thị và con số chi phí của **mọi** bản ghi dùng Google, không riêng bản ghi ghép | Nằm ngoài scope sửa của feature này, nhưng BA nêu ra để Tech Lead quyết có sửa kèm hay ghi nhận thành nợ kỹ thuật. Không được im lặng bỏ qua vì "phát hiện tình cờ". |
| **R-AC** | `duration = 0` và `time = 0` là giá trị **hợp lệ** trong contract hiện tại (`server/stt/contracts.js:69,88`) — không phân biệt được "0 thật" với "không biết" | Ảnh hưởng trực tiếp BR-125/126. Tech Lead quyết có cần phân biệt hai trạng thái này ở tầng contract không. |
| **R-AD** | Nhãn người nói phải được phân biệt theo phần và điều đó phải tới được **cả 3 builder prompt** (`buildSummaryPrompt`, `buildChunkPrompt`, `buildSynthesisPrompt`) — bản ghi ghép nhiều phần rất dễ dài tới mức chạy map-reduce | BR-130 + BR-32. Protocol 6: phải assert giá trị cụ thể truyền giữa các bước, không chỉ "đã gọi". |
| **R-AE** | Endpoint provider trả thêm năng lực (BR-141) = bề mặt dữ liệu mới rời server | Reviewer bắt buộc kiểm: không lộ key/một phần key, giữ nguyên `isTrustedApiRequest`/`hasTrustedHost`. |
| **R-AF** | BR-146 cần một mốc thời gian mới cho "lần cuối sửa thông tin đi vào prompt" → thêm field vào meeting → ảnh hưởng backup/import backup (BR-112) và bản ghi cũ chưa có field | Mặc định an toàn cho bản ghi cũ: thiếu field → giữ nguyên hành vi hiện tại, không bật nhắc nhở sai. |

## 17. Câu hỏi còn lại — chỉ cần gật/lắc, KHÔNG chặn Tech Lead

*(Cả 3 câu đều đã có mặc định an toàn. Tech Lead bắt đầu thiết kế được ngay với các mặc định này; nếu user đổi ý sau, thay đổi nằm gọn trong luồng import, không đảo kiến trúc.)*

| # | Câu hỏi | Đề xuất mặc định |
|---|---|---|
| Q9 | Vài ngày sau anh tìm thấy file phần 3 còn sót trong điện thoại — có muốn **thêm phần vào một bản ghi ghép đã xong** không? | **Có** — cho thêm phần vào bản ghi ghép đã có, chèn theo đúng thứ tự, summary cũ không tự sinh lại (chỉ hiện nhắc nhở BR-29/BR-146) |
| Q10 | Bản ghi thiếu một phần (phần đó lỗi) — có cho tóm tắt luôn phần đang có không, hay bắt sửa xong mới cho tóm tắt? | **Cho tóm tắt**, kèm xác nhận nêu rõ đang thiếu phần nào và ghi nhận vào provenance (BR-135) |
| Q11 | Tối đa 10 phần cho một bản ghi ghép, cảnh báo từ phần thứ 6 — có hợp với thực tế của anh không? | **10 phần / cảnh báo từ 6** (BR-122) |

