# CLAUDE.md — MeetNote (Project-specific conventions)

Kế thừa toàn bộ Global Conventions tại `~/Vibe Code/CLAUDE.md` (ngôn ngữ, Protocol 1–8, cấu trúc thư mục). File này ghi phần riêng cho MeetNote.

## MeetNote là gì
App ghi âm & tóm tắt cuộc họp bằng AI, local-first. Chạy như local server (`http://127.0.0.1:8765`), UI là web app mở trong trình duyệt. Có bản đóng gói portable cho macOS (DMG) và Windows (EXE) — xem `macos/`, `windows/`.

## Nguồn sự thật
- `README.md` — tổng quan tính năng, tech stack
- `HUONG-DAN-SU-DUNG.md` — hướng dẫn sử dụng đầy đủ bằng tiếng Việt, coi đây là đặc tả hành vi UI hiện hành khi cần biết "tính năng X hoạt động thế nào"
- `SECURITY.md` — chính sách bảo mật đã công bố

## Tech stack thực tế (đã verify từ code — Tech Lead/Dev đọc đây thay vì suy đoán)
- **Không dùng TypeScript, không framework, không build step.** Backend: Node.js built-in `http` module thuần (`server.js`, ~1400 dòng). Frontend: vanilla JS (`js/*.js`), không React/Vue, DOM thao tác trực tiếp qua `innerHTML`.
- Phần "Code Conventions" (TypeScript/Node) trong CLAUDE.md global **không áp dụng nguyên xi** cho project này — không có `pnpm`/`eslint`/`vitest`. Test chạy bằng `node --test test/*.test.js` (built-in test runner của Node, không phải vitest). Không có linter cấu hình sẵn.
- Lưu trữ: file JSON phẳng trong `storage/` (`meetings.json`, `settings.json`, `jobs.json`) — không có database. API key lưu qua OS keychain (`security` CLI trên macOS, DPAPI trên Windows), không bao giờ trong file JSON hay trả về client.
- 4 provider STT (Soniox, Deepgram, OpenAI Whisper, Google Speech-to-Text) tại `server/stt/`. 3 provider LLM tóm tắt (Codex/ChatGPT, DeepSeek, Gemini) tại `server/llm/providers/`.
- Output tóm tắt hiện dùng **schema cố định** (`schemas/meeting-summary.schema.json`, `additionalProperties: false`), enforce theo 3 cơ chế khác nhau mỗi provider (Codex: file JSON Schema qua CLI flag; Gemini: `responseSchema` dialect riêng không hỗ trợ `$schema`/`additionalProperties`; DeepSeek: xem `server/llm/providers/deepseek.js`). Đổi schema động → phải verify lại cách convert cho từng provider (Protocol 5).
- Có luồng map-reduce riêng cho transcript dài (`buildChunkPrompt` + `buildSynthesisPrompt` trong `server/llm/prompts.js`) tách biệt với luồng single-pass (`buildSummaryPrompt`) — mọi thay đổi prompt/schema phải áp dụng nhất quán cả 2 luồng (Protocol 6).

## Chạy & test
```bash
npm start   # server tại http://127.0.0.1:8765, Ctrl+C để dừng
npm test    # node --test test/*.test.js
```
Không cần build/compile — sửa file `.js`/`.html`/`.css` rồi reload trình duyệt là thấy ngay.

## Bảo mật — điểm cần Reviewer luôn kiểm tra
Đã security-review toàn bộ `server.js` (2026-09-18): app tự chống CSRF/DNS-rebinding vào localhost server bằng kiểm tra `Host`/`Origin` header (`isTrustedApiRequest`/`hasTrustedHost`, `server.js`), path traversal bị chặn bằng hash SHA-256 tên file, `child_process.spawn` luôn `shell:false`. Đây là baseline đã xác nhận tốt — thay đổi liên quan tới các cơ chế này (thêm endpoint mới, thêm cách ghi file, thêm subprocess call) phải giữ nguyên các lớp phòng thủ đó, không được bỏ qua vì "endpoint local thôi, không cần".

## Trạng thái
`project_state.json` ở root. Feature đang track: `summary-presets` (xem `docs/PRD.md` khi có).
