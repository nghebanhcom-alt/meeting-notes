# UX Design — Import bản ghi âm từ điện thoại (`import-phone-recording`)

Tác giả: UX/UI Designer · Ngày: 2026-09-18 · Trạng thái: **rev 2 — đã áp 4 quyết định của user**

> **Rev 2 thay đổi gì so với rev 1** (đọc §12 để biết chi tiết):
> 1. Microcopy chốt **tiếng Việt**, bỏ cột tiếng Anh (§6 là bản chính thức để Dev copy).
> 2. Sửa `date` + `participants` ở Meeting Detail **vào scope** — thiết kế ở §5.9.
> 3. Pre-flight check **vào scope** (`/api/stt/providers` sẽ trả `maxUploadBytes` + mime) — UI chốt ở §5.6.
> 4. **Mới, lớn nhất**: chế độ **ghép nhiều file thành 1 cuộc họp** (ghi âm bị cắt khúc) — §4.2, §5.4b (modal), §5.2 + §5.4b (chờ), §5.7b (lỗi từng phần).

> Tài liệu này chỉ mô tả trải nghiệm. Không chọn tech stack, không viết code implement.
> Mọi claim về hành vi code hiện tại trong tài liệu này đều **đã verify bằng cách đọc source**
> (có ghi số dòng). Claim nào chưa verify được đánh dấu `[CHƯA VERIFY]`.

---

## 0. Hiện trạng đã verify (baseline)

| Sự thật | Nguồn |
| --- | --- |
| Dashboard có 3 nút: Quick Record / Meeting Setup / Upload Recording | `js/app.js:519-529` |
| `Upload Recording` mở thẳng file picker OS, 1 file, không có màn hình trung gian | `js/app.js:3810-3865` |
| Title tự sinh = tên file bỏ đuôi; `participants: []`; `date` = thời điểm upload | `js/app.js:3829`, `js/storage.js:191` |
| Định dạng đang nhận: aac, aiff, amr, asf, flac, mp3, ogg, wav, webm, m4a, mp4 | `js/app.js:3813,3819` |
| Meeting Setup có form đủ: title, participants, meetingType, topic, leadBy, language, translateTo | `js/app.js:697-788` |
| Meeting Detail đã có card **"Pre-meeting info"** (meetingType/topic/leadBy/tags + nút Save) | `js/app.js:1418-1450` |
| Meeting Detail **không** có ô sửa `date` và **không** có ô sửa `participants` | `js/app.js:1382-1395` (chỉ render read-only) |
| `date`, `meetingType`, `topic`, `leadBy`, `notes` được gửi vào prompt tóm tắt | `js/summary.js:21-43` |
| Badge trạng thái: `processing` → "Processing audio…", `failed` → "Processing failed" | `js/app.js:1317-1318`, `3659-3660` |
| Background task indicator = 1 nút ở header, chỉ hiện **số lượng** task, bấm vào → điều hướng sang All Meetings | `js/app.js:235-250` |
| Job transcribe sống ở server (`jobs.json`), reload trang vẫn resume được | `js/app.js:3981-4001`, `js/storage.js:114-117` |
| Server restart → job đang chạy bị đánh `failed` (client không được tự lật trạng thái) | `js/storage.js:114-117` |
| Endpoint `/api/import-transcription` **đã nhận** `provider` và `model` theo từng job | `server.js:1442-1443` |
| Giới hạn dung lượng theo provider: Soniox 500 MB · Deepgram 1 GB · Whisper 25 MB · Google 10 MB | `server/stt/providers/*.js`, kiểm tra tại `server/stt/index.js:94-98` |
| `/api/stt/providers` **chưa** trả `maxUploadBytes` về client | `server/stt/index.js:109-131` |
| `AudioStorage.save()` dùng `fetch` PUT → **không có sự kiện tiến độ upload** | `js/audio-storage.js:22-37` |
| Chưa có nút **Retry** cho meeting transcribe fail | grep `Retry` toàn `js/` — chỉ có comment retry của poller |

### Ngôn ngữ UI — ĐÃ CHỐT: tiếng Việt cho toàn bộ text mới

Source hiện đang trộn 2 ngôn ngữ:

- Tiếng Anh (màn hình cũ): Dashboard, Meeting Setup, Recording, tabs Meeting Detail, toast của luồng upload hiện tại.
- Tiếng Việt (feature mới): modal Export .md (`js/app.js:1749-1762`), kết quả export (`1836-1846`), placeholder tag "Nhập tag rồi bấm Enter" (`1444`), option "(chưa chọn)" của meetingType (`792`), gợi ý leadBy (`2047-2049`), hint stale summary (`2035`).

**Quyết định của user:** mọi text **mới** của luồng import viết bằng **tiếng Việt** (đi tiếp
hướng của các feature mới nhất). **Không** đụng vào text tiếng Anh cũ ở màn hình khác trong
feature này. §6 là bản microcopy chính thức, Dev copy thẳng vào code.

**Hệ quả cần Dev lưu ý — vùng giáp ranh:** một số chỗ của luồng import nằm **ngay cạnh** text
tiếng Anh cũ và sẽ trông lẫn lộn. Quy tắc xử lý:

| Vị trí | Xử lý |
| --- | --- |
| Nút `Upload Recording` trên Dashboard (`js/app.js:528`) | **Giữ nguyên tiếng Anh** — là text cũ, chỉ đổi hành vi. Đổi nhãn sẽ kéo theo việc phải Việt hoá cả 2 nút còn lại. |
| Badge `Processing audio…` / `Processing failed` (`js/app.js:1317-1318`) | **Giữ nguyên** — dùng chung với luồng ghi trực tiếp, đổi là đụng màn hình khác. Badge **mới** `Thiếu 1 phần` (FAI-12) thì tiếng Việt vì nó chỉ tồn tại ở luồng import. |
| Nhãn nút background indicator `2 audio tasks` (`js/app.js:246`) | **Giữ nguyên tiếng Anh**; toàn bộ nội dung popover mới bên dưới viết tiếng Việt. |
| Card lỗi `Audio processing failed` (`js/app.js:1408-1414`) | Tiêu đề giữ nguyên; **2 nút mới** (`Thử lại`, `Thử nhà cung cấp khác`) và dòng giải thích mới viết tiếng Việt. |
| Card "Pre-meeting info" (`js/app.js:1421`) | Tiêu đề + label cũ giữ nguyên; **field mới** (Ngày giờ họp, Người tham dự) label tiếng Việt, đúng như placeholder tag tiếng Việt đã nằm sẵn trong card này (`js/app.js:1444`). |
| Toàn bộ Import modal (mới 100%) | Tiếng Việt |

Việt hoá nốt màn hình cũ = task riêng, ngoài scope feature này.

---

## 1. User Persona & bối cảnh

**Persona: "Người đi họp ngoài văn phòng"**
- Đi họp ở chỗ khách hàng / họp ngoài / họp đột xuất, không mang laptop.
- Mở app ghi âm mặc định của điện thoại (iPhone Voice Memos → `.m4a`; Android → `.m4a`/`.3gp`/`.amr`; app chat → `.opus`).
- Đặt điện thoại giữa bàn hoặc trong túi áo. Chất lượng âm thanh **kém hơn hẳn** luồng ghi trực tiếp trên máy.
- File dài: 45 phút – 3 tiếng.
- Về đến bàn làm việc mới chuyển file sang máy → **không còn áp lực thời gian**. Ngồi trước màn hình desktop, có thể điền form dài hơn Meeting Setup.
- Đã **quên bớt** chi tiết cuộc họp so với lúc bấm Start ở Meeting Setup, nhưng vẫn nhớ chủ đề/người chủ trì/ngày họp.

**Khác biệt bối cảnh so với luồng ghi trực tiếp** (quyết định toàn bộ thiết kế bên dưới):

| | Meeting Setup (đang họp) | Import (sau họp) |
| --- | --- | --- |
| Áp lực thời gian | Cao — mọi giây trì hoãn là mất lời | Thấp — file đã nằm yên trên máy |
| Ma sát cho phép | Rất thấp, 1 nút Start | Chấp nhận 1 màn hình form |
| Ngữ cảnh trong đầu user | Đầy đủ (đang sắp họp) | Nhớ đại khái, cần gợi nhớ |
| Ngày giờ | = bây giờ, luôn đúng | ≠ bây giờ, **mặc định hiện tại đang SAI** |
| Rủi ro nếu làm sai | Mất buổi họp | Tốn tiền STT cho 1 file 2h chạy sai cấu hình |

---

## 2. Vấn đề của luồng hiện tại (why redesign)

1. **Không có điểm dừng nào để nhập context.** Chọn file xong là job chạy ngay → transcript có, nhưng summary thiếu meetingType/topic/leadBy/participants → chất lượng thấp hơn hẳn meeting tạo từ Meeting Setup. Mà `js/summary.js:34-41` cho thấy đúng 4 field này là thứ đi vào prompt.
2. **`date` sai một cách âm thầm.** Meeting họp thứ Hai, import thứ Tư → `date` = thứ Tư. Sai ở 3 nơi: sắp xếp danh sách, dòng "📅" ở Meeting Detail, và **prompt tóm tắt** (`js/summary.js:30`). Không có chỗ nào sửa được sau đó.
3. **Không có pre-flight check.** User đang để provider mặc định là Whisper (25 MB) rồi import file 2h (~60–120 MB) → job chạy, fail, mất thời gian chờ mới biết. Lỗi lẽ ra phát hiện được **trước khi bấm Start** vì đã biết cả `file.size` lẫn `maxUploadBytes`.
4. **Trạng thái chờ gần như vô hình.** Chỉ có 1 nút header ghi "2 audio tasks" và bấm vào thì nhảy sang All Meetings. Với file 2 tiếng, user không biết "đang ở bước nào", "bắt đầu lúc nào", "đóng tab được không".
5. **Fail là ngõ cụt.** `processingError` hiện dưới dạng card cảnh báo (`js/app.js:1408-1414`) nhưng không có nút làm lại → user phải xóa meeting rồi import lại từ đầu (upload lại file 100 MB).
6. **Nhiều file phải làm 1-1.** 3 buổi họp trong tuần = 3 lần lặp lại toàn bộ thao tác.

---

## 3. Nguyên tắc thiết kế cho feature này

- **D1 — Một điểm dừng duy nhất, trước khi tiêu tiền.** Chỉ chèn đúng **một** màn hình (modal) giữa "chọn file" và "bắt đầu transcribe". Không thêm wizard nhiều bước.
- **D2 — Bắt buộc tối thiểu, gợi ý tối đa.** Chỉ 2 field thực sự quan trọng hiển thị mặc định (**Title**, **Ngày giờ họp**); phần còn lại nằm trong khối thu gọn "Meeting details". Không field nào chặn nút Start (nhất quán với BR-24 đã có).
- **D3 — Đoán giùm, cho sửa.** Title đoán từ tên file, ngày giờ đoán từ `file.lastModified`, provider/language lấy từ Settings. User chỉ sửa khi đoán sai.
- **D4 — Chặn lỗi trước khi chạy, không báo lỗi sau khi chạy.** Định dạng + dung lượng so với provider đang chọn đều kiểm ngay trong modal.
- **D5 — Việc chờ phải nhìn thấy được từ mọi màn hình, và chờ không được là chết cứng.** Trong lúc chờ, user vẫn điền được context và xem được file khác.
- **D6 — Không phát minh pattern mới.** Drop zone + danh sách file + nút Import là pattern của Google Drive / Dropbox / Slack — user đã quen. Dùng lại y nguyên component có sẵn (`modal`, `card`, `input`, `badge`, `empty-state`, `tag-chip-row`).
- **D7 — Quyết định không đảo ngược được thì phải kiểm chứng được trước khi bấm.** Ghép sai thứ tự các phần = transcript lộn xộn, chỉ phát hiện sau khi đã trả tiền STT. Nên chế độ ghép bắt buộc phải có công cụ để user **tự nghe và tự xác nhận** thứ tự ngay trong modal, chứ không chỉ "tin là app sắp đúng".
- **D8 — Thiếu dữ liệu phải nhìn thấy được, không được im lặng.** Nếu phần 2 của 3 phần lỗi, transcript **tuyệt đối không** được nối phần 1 với phần 3 rồi coi như xong — đó là kết quả sai mà trông như đúng. Chỗ thiếu phải hiện thành một khoảng trống có nhãn.

---

## 4. User Flow chính

### 4.1 Happy path — 1 file (mục tiêu: **3 bước**)

```
Dashboard
   │  (1) bấm "Upload Recording"   ── hoặc ── kéo thả file vào bất kỳ đâu trên app
   ▼
Import modal  (file đã nằm sẵn trong danh sách nếu kéo thả)
   │  (2) [tuỳ chọn] sửa Tên / Ngày giờ / mở "Thông tin cuộc họp"
   │  (3) bấm "Bắt đầu tạo transcript"
   ▼
Về Dashboard + toast + thanh tiến độ ở header
   │  (chờ — user làm việc khác, hoặc mở meeting để điền context)
   ▼
Toast "Transcript sẵn sàng" → Meeting Detail
```

So với hiện tại: **thêm đúng 1 bước** (bước 2 có thể bỏ qua hoàn toàn — bấm Start ngay là ra
đúng hành vi cũ nhưng có `date` đúng). Nếu kéo thả thì vẫn là 2 thao tác như hiện tại.

### 4.2 Flow nhiều file — 2 chế độ

Khi có từ 2 file trở lên, modal hỏi **một câu duy nhất** ngay đầu danh sách:

```
Kéo 3 file vào app
   ▼
Import modal — hiện bộ chọn chế độ ở đầu danh sách:
   │
   ├── (•) "3 cuộc họp riêng"  ← MẶC ĐỊNH
   │      3 dòng file, mỗi dòng Tên + Ngày giờ riêng
   │      "Thông tin cuộc họp" / "Cấu hình nhận dạng" ÁP CHUNG cả 3
   │      ▼  "Bắt đầu — tạo 3 cuộc họp"
   │
   └── ( ) "1 cuộc họp gồm 3 phần"   ← ghi âm bị cắt khúc
          1 khối "Các phần" đánh số 1-2-3, kéo thả đổi thứ tự, nghe thử được
          MỘT bộ Tên + Ngày giờ + context cho cả cụm
          ▼  "Bắt đầu — tạo 1 cuộc họp gồm 3 phần"
```

Đổi chế độ → **danh sách file vẽ lại ngay lập tức** (3 form title thu lại còn 1, các dòng được
đánh số "Phần 1/2/3"). Chính cái vẽ lại đó là thứ dạy user hiểu hậu quả, không cần đọc hướng dẫn
(xem WHY-11).

### 4.3 Flow phục hồi lỗi

```
Modal chặn trước:      định dạng lạ / file quá lớn với provider  → sửa ngay trong modal
Sau khi chạy fail:     Meeting Detail hiện card lỗi + nút "Thử lại"
                       (audio đã nằm trên máy → KHÔNG phải upload lại)
```

---

## 5. Mô tả màn hình

### Screen 1 — Dashboard (thay đổi nhỏ)

**Mục tiêu:** vẫn là 1 màn hình 3 lựa chọn, không làm rối.

**Thay đổi:**
1. Nút `Upload Recording` giữ nguyên nhãn và vị trí thứ 3 (xem WHY-1), nhưng đổi hành vi:
   bấm → mở **Import modal** (không mở file picker OS nữa).
2. Thêm **global drop target**: kéo file audio vào bất kỳ đâu trong app → overlay che toàn màn
   hình, thả ra thì Import modal mở sẵn với file đã nạp.

```
┌──────────────────────────────────────────────────────────────┐
│  ⟵ overlay xuất hiện khi kéo file vào cửa sổ ⟶               │
│                                                              │
│                        ⬇                                     │
│              Thả file ghi âm vào đây                         │
│        Định dạng hỗ trợ: m4a, mp3, wav, aac, …               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**WHY:** desktop-first. Người dùng vừa AirDrop xong đang đứng ở Finder, kéo-thả là đường ngắn
nhất và là pattern họ dùng hằng ngày (Drive, Slack, Notion). Overlay toàn màn hình vì vùng thả
nhỏ rất khó trúng khi tay đang kéo file.

**Edge case:** kéo file không phải audio (ví dụ `.pdf`) → overlay đổi sang nền cảnh báo + chữ
DND-02 ("Định dạng file này chưa được hỗ trợ"); thả ra thì chỉ hiện toast, **không** mở modal.

---

### Screen 2 — Import modal, state A: rỗng

**Mục tiêu:** chọn file. Chỉ có 1 việc duy nhất.

```
┌───────────────────────────────────────────────────────────┐
│  Nhập bản ghi âm                                      ✕   │   ← .modal-header
├───────────────────────────────────────────────────────────┤
│                                                           │
│   ┌─────────────────────────────────────────────────┐    │
│   │                     ⬆                            │    │   ← component MỚI
│   │           Kéo file ghi âm vào đây                │    │     .import-dropzone
│   │                  hoặc                            │    │
│   │             [ Chọn file… ]                       │    │   ← .btn .btn-secondary
│   │                                                  │    │
│   │   m4a · mp3 · wav · aac · flac · ogg · webm …    │    │   ← .text-xs .text-tertiary
│   └─────────────────────────────────────────────────┘    │
│                                                           │
│   💡 Ghi âm bằng điện thoại? Hãy đặt máy gần người nói    │   ← gợi ý chất lượng (§5.8)
│      — tiếng thu từ trong túi rất khó nhận dạng.          │
│                                                           │
├───────────────────────────────────────────────────────────┤
│              [ Hủy ]  [ Bắt đầu tạo transcript ]          │   ← nút chính đang disabled
└───────────────────────────────────────────────────────────┘
```

**Interactions**
- Modal mở → focus vào nút "Chọn file…" (bấm Enter là mở picker ngay; phím tắt tự nhiên).
- `Esc` / click backdrop / ✕ → đóng, không tạo gì cả (hành vi `closeModal()` sẵn có).
- Có thể chọn **nhiều file** trong picker (`multiple`).

**Empty state:** chính state A này là empty state, không cần `.empty-state` riêng.

---

### Screen 3 — Import modal, state B: đã chọn 1 file

**Mục tiêu:** xác nhận file đúng + cho user cơ hội sửa 2 thứ dễ sai nhất (tên, ngày giờ) rồi bấm Start.

```
┌───────────────────────────────────────────────────────────────┐
│  Nhập bản ghi âm                                          ✕   │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 🎵  New Recording 12.m4a          58,4 MB          [✕]  │ │  ← .import-file-row (MỚI)
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  Tên cuộc họp                                                 │  ← .input-group + .input
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ New Recording 12                                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  Cuộc họp này diễn ra khi nào?                                │
│  ┌──────────────────────┐                                     │
│  │ 16/09/2026  14:30  📅│  Lấy từ thông tin file — bạn kiểm   │  ← hint .text-xs
│  └──────────────────────┘  tra lại giúp.                      │
│                                                               │
│  ▸ Thông tin cuộc họp (không bắt buộc — giúp tóm tắt tốt hơn) │  ← khối thu gọn (MỚI)
│                                                               │
│  ▸ Cấu hình nhận dạng giọng nói                               │  ← khối thu gọn (MỚI)
│    Soniox · Tự nhận diện · Không dịch                         │  ← dòng tóm tắt luôn hiện
│                                                               │
├───────────────────────────────────────────────────────────────┤
│                  [ Hủy ]   [ Bắt đầu tạo transcript ]         │
└───────────────────────────────────────────────────────────────┘
```

#### Khối "Thông tin cuộc họp" khi mở ra

```
  ▾ Thông tin cuộc họp (không bắt buộc — giúp tóm tắt tốt hơn)
    ┌───────────────────────────────────────────────────────┐
    │ Meeting type                                          │ ← giữ nhãn tiếng Anh của dropdown
    │ [ (chưa chọn)                                    ▾ ]  │   đã có (_meetingTypeOptions)
    │                                                       │
    │ Người tham dự (cách nhau bằng dấu phẩy)               │
    │ [ ví dụ: Hieu, Lan, khách ABC                      ]  │
    │                                                       │
    │ Chủ đề           [                                 ]  │ ← `topic`
    │ Người chủ trì    [                                 ]  │ ← `leadBy`
    └───────────────────────────────────────────────────────┘
```

> Ở **modal import** dùng ô-phẩy cho người tham dự (nhập mới cả danh sách, gõ một mạch nhanh nhất,
> giống Meeting Setup). Ở **Meeting Detail** dùng chip (sửa từng người trong danh sách đã có).
> Lý do đầy đủ ở WHY-16.

#### Khối "Cấu hình nhận dạng giọng nói" khi mở ra

```
  ▾ Cấu hình nhận dạng giọng nói
    ┌───────────────────────────────────────────────────────┐
    │ Nhà cung cấp  [ Soniox (mặc định)                 ▾ ] │
    │               Chỉ áp dụng cho lần nhập này.           │
    │ Ngôn ngữ nói      [ Tự nhận diện nhiều ngôn ngữ   ▾ ] │
    │ Dịch sang         [ Không dịch — chỉ bản gốc      ▾ ] │
    └───────────────────────────────────────────────────────┘
```

**Interactions & defaults (D3)**
| Field | Giá trị mặc định | Nguồn |
| --- | --- | --- |
| Title | tên file bỏ đuôi (giữ hành vi cũ, `js/app.js:3829`) | file |
| Ngày giờ | `file.lastModified` làm tròn xuống phút | file |
| Meeting type / topic / leadBy / participants | trống | — |
| Provider | provider mặc định trong Settings | `/api/stt/providers` |
| Spoken language / Translate to | `settings.language` / `settings.translationLanguage` | Settings |

- Chọn **Meeting type** → seed tag giống Meeting Setup (`_initialTagsForMeetingType`, `js/app.js:865-869`), để meeting import ra kết quả giống hệt meeting tạo bằng Meeting Setup.
- Đổi **Provider** ở đây **chỉ áp cho lần import này**, không ghi đè Settings — endpoint đã nhận
  `provider` theo job (`server.js:1442`). Phải nói rõ bằng dòng chữ nhỏ, nếu không user sẽ tưởng
  mình vừa đổi cấu hình toàn app.
- Hai khối thu gọn **mặc định đóng**; trạng thái mở/đóng **không** cần nhớ giữa các lần (giữ modal
  luôn mở ra ở dạng gọn nhất — D2).
- Nút Start luôn enable trừ khi có lỗi chặn (§5.6).

**Về ô "Ngày giờ họp" — chi tiết quan trọng nhất của thiết kế này**

- Prefill từ `file.lastModified`. Với AirDrop/cáp thì giá trị này thường là giờ ghi âm thật.
  `[CHƯA VERIFY]` — chưa đo được `lastModified` sống sót qua Zalo/Drive/Telegram hay không; Dev
  cần thử thực tế. Thiết kế đã phòng hờ bằng 2 lớp: (a) luôn cho sửa, (b) cảnh báo bên dưới.
- Nếu `lastModified` cách "bây giờ" **dưới 30 phút** → nhiều khả năng đó là giờ *copy file*, không
  phải giờ họp. Hiện hint đậm hơn: "This looks like the time you copied the file. Set the real
  meeting date." (không chặn Start).
- Không được phép để trống: nếu user xoá sạch → fallback về `lastModified`, không fallback về `now`.

**WHY đặt ngày giờ ở mức luôn-hiển-thị còn meetingType thì thu gọn:** ngày giờ là field duy nhất
mà **giá trị mặc định chắc chắn sai** trong luồng hiện tại, sai âm thầm, và hiện không có đường
sửa ở bất kỳ màn hình nào. meetingType/topic/leadBy thì mặc định trống (rõ ràng là chưa điền) và
**đã có** chỗ điền bù ở card "Pre-meeting info" của Meeting Detail (`js/app.js:1418-1450`).

---

### Screen 4 — Import modal, state C: nhiều file, chế độ **"nhiều cuộc họp riêng"** (mặc định)

**Mục tiêu:** import cả loạt mà không phải điền form N lần.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Nhập bản ghi âm (3 file)                                           ✕   │
├─────────────────────────────────────────────────────────────────────────┤
│  Ba file này là gì?                                                     │  ← bộ chọn chế độ (MỚI)
│  ┌───────────────────────────────┬───────────────────────────────────┐ │
│  │ (•) 3 cuộc họp riêng          │ ( ) 1 cuộc họp gồm 3 phần         │ │
│  │     Mỗi file thành một bản    │     Ghép nối tiếp thành một       │ │
│  │     ghi riêng.                │     transcript duy nhất.          │ │
│  └───────────────────────────────┴───────────────────────────────────┘ │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │🎵│ Tên  [ Standup 16-09            ] │ 16/09/2026 09:05  │  ✕  │   │
│  │  │ New Recording 12.m4a · 58,4 MB                               │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │🎵│ Tên  [ Khach hang ABC           ] │ 16/09/2026 14:30  │  ✕  │   │
│  │  │ REC_20260916_143012.m4a · 121 MB                             │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │🎵│ Tên  [ voice-note-3             ] │ 17/09/2026 10:12  │  ✕  │   │
│  │  │ voice-note-3.opus · 4,1 MB                                   │   │
│  │  ⚠ MeetNote chưa hỗ trợ định dạng .opus. Hãy bỏ file này ra,    │   │
│  │    hoặc chuyển sang m4a/mp3 trước rồi nhập lại.      [ Bỏ file ]│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                    [ + Thêm file ]      │
│                                                                         │
│  ▸ Thông tin cuộc họp — áp dụng cho tất cả file                         │
│  ▸ Cấu hình nhận dạng giọng nói — áp dụng cho tất cả file               │
│    Soniox · Tự nhận diện · Không dịch                                   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  1 file có lỗi sẽ không được nhập.                                      │
│                    [ Hủy ]   [ Bắt đầu — tạo 2 cuộc họp ]               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Quy tắc**
- **Mỗi file = 1 cuộc họp.**
- **Per-file:** chỉ Tên và Ngày giờ. **Áp chung:** meetingType, participants, topic, leadBy,
  provider, language, translateTo.
- File lỗi hiện inline ngay dưới dòng đó, **không chặn** các file hợp lệ (§5.6).
- Nhãn nút nói rõ **kết quả**, không nói thao tác: "Bắt đầu — tạo 2 cuộc họp".
- Tất cả file đều lỗi → nút disable.
- Cảnh báo mềm khi > 10 file (ERR-09). Không chặn cứng.

**WHY áp chung thay vì form riêng từng file:** người chuyển 3 file ghi âm từ điện thoại thường
là dọn dẹp cả tuần — cùng loại họp, cùng ngôn ngữ. Bắt điền 3 form là lý do khiến họ bỏ luôn
việc điền context (rồi summary kém). Tên/ngày giờ thì buộc phải per-file vì bản chất khác nhau,
nhưng cả hai đều đã được đoán sẵn nên phần lớn trường hợp không phải gõ gì.

**Gợi ý tự động khi phát hiện file liên tiếp** (không chặn, không tự đổi chế độ):

```
  ┌───────────────────────────────────────────────────────────────────┐
  │ 💡 Ba file này ghi liên tiếp nhau trong cùng buổi chiều 16/09.    │
  │    Chúng là các phần của cùng một cuộc họp?                       │
  │                                    [ Ghép thành 1 cuộc họp ]      │
  └───────────────────────────────────────────────────────────────────┘
```

Điều kiện hiện gợi ý (đề xuất, BA chốt số — OQ-8): tất cả file **cùng đuôi**, và thời điểm bắt đầu
của file N+1 nằm trong khoảng **0–15 phút** sau khi file N kết thúc (`lastModified` + thời lượng).
Bấm "Ghép thành 1 cuộc họp" = chuyển sang chế độ ghép với thứ tự đã sắp sẵn. **Không** tự chuyển
chế độ giùm user (WHY-12).

---

### Screen 4b — Import modal, chế độ **"1 cuộc họp gồm N phần"**

**Mục tiêu:** ghép các khúc ghi âm bị cắt của **cùng một buổi họp** thành 1 bản ghi, và cho user
**tự kiểm chứng thứ tự** trước khi tiêu tiền.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Nhập bản ghi âm (3 file)                                             ✕   │
├───────────────────────────────────────────────────────────────────────────┤
│  Ba file này là gì?                                                       │
│  ┌───────────────────────────────┬─────────────────────────────────────┐ │
│  │ ( ) 3 cuộc họp riêng          │ (•) 1 cuộc họp gồm 3 phần           │ │
│  └───────────────────────────────┴─────────────────────────────────────┘ │
│                                                                           │
│  Các phần · tổng 2 giờ 14 phút                                            │
│  Đang sắp theo thời gian tạo file.  [ Sắp theo tên file ]                 │  ← nói rõ quy tắc sắp
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │ ⠿ │ 1 │ REC_001.m4a                                               │   │  ← ⠿ = kéo để đổi chỗ
│  │   │   │ 14:30 → 15:18 · 48 phút · 52 MB                           │   │
│  │   │   │ ▶ Nghe 10 giây đầu    ▶ Nghe 10 giây cuối       [ ▲ ▼ ✕ ] │   │
│  ├───────────────────────────────────────────────────────────────────┤   │
│  │ ⠿ │ 2 │ REC_002.m4a                                               │   │
│  │   │   │ 15:19 → 16:07 · 48 phút · 51 MB     ⏱ cách phần 1: 1 phút │   │
│  │   │   │ ▶ Nghe 10 giây đầu    ▶ Nghe 10 giây cuối       [ ▲ ▼ ✕ ] │   │
│  ├───────────────────────────────────────────────────────────────────┤   │
│  │ ⠿ │ 3 │ REC_003.m4a                                               │   │
│  │   │   │ 16:08 → 16:46 · 38 phút · 40 MB     ⏱ cách phần 2: 1 phút │   │
│  │   │   │ ▶ Nghe 10 giây đầu    ▶ Nghe 10 giây cuối       [ ▲ ▼ ✕ ] │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                      [ + Thêm phần ]      │
│                                                                           │
│  ✓ Nghe thử 10 giây cuối phần 1 và 10 giây đầu phần 2 để chắc chắn        │
│    thứ tự đúng — sai thứ tự thì transcript sẽ lộn xộn.                    │
│                                                                           │
│  Tên cuộc họp                                                             │  ← MỘT bộ context
│  [ Họp khách hàng ABC                                                 ]   │
│                                                                           │
│  Cuộc họp này diễn ra khi nào?                                            │
│  [ 16/09/2026  14:30 📅 ]  Lấy từ phần 1 — bạn kiểm tra lại giúp.         │
│                                                                           │
│  ▸ Thông tin cuộc họp (không bắt buộc — giúp tóm tắt tốt hơn)             │
│  ▸ Cấu hình nhận dạng giọng nói                                           │
│    Soniox · Tự nhận diện · Không dịch                                     │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│              [ Hủy ]   [ Bắt đầu — tạo 1 cuộc họp gồm 3 phần ]            │
└───────────────────────────────────────────────────────────────────────────┘
```

#### 4b.1 Sắp xếp thứ tự các phần

| Khía cạnh | Thiết kế | WHY |
| --- | --- | --- |
| Mặc định sắp theo | `file.lastModified` **tăng dần** | Đây là giờ ghi thật, không bị lệ thuộc cách đặt tên. Sắp theo tên chết ở `REC_9` vs `REC_10` (so sánh chuỗi cho `REC_10` đứng trước `REC_9`). |
| Fallback | Nếu tất cả `lastModified` bằng nhau hoặc chênh < 1 giây (bị reset khi copy hàng loạt) → sắp theo **natural sort** tên file (số trong tên so sánh theo giá trị) | Mất tín hiệu thời gian thì tên file là tín hiệu duy nhất còn lại |
| Hiển thị quy tắc đang dùng | Luôn hiện 1 dòng "Đang sắp theo thời gian tạo file." + nút đổi sang "Sắp theo tên file" | User chỉ tin được thứ tự khi biết nó dựa trên cái gì. Đây là điều kiện để tự kiểm chứng (D7). |
| Đổi thứ tự thủ công | Kéo thả bằng tay cầm `⠿` **và** nút `▲ ▼` trên từng dòng | Kéo thả trong modal cuộn được rất dễ trượt tay; `▲ ▼` là đường chắc chắn. Không bắt user chọn 1 trong 2 — có cả hai. |
| Số thứ tự | Cột số `1 2 3` cập nhật ngay khi đổi chỗ | Phản hồi tức thì cho thao tác kéo |

#### 4b.2 Cách user **tự kiểm chứng** thứ tự (phần quan trọng nhất của chế độ này)

Bốn tín hiệu, xếp theo công sức user phải bỏ ra, từ 0 đến nhiều:

1. **Tổng thời lượng** (`tổng 2 giờ 14 phút`) — liếc một cái là biết có khớp với buổi họp mình
   nhớ không. Phát hiện được lỗi thiếu/thừa file.
2. **Dòng thời gian từng phần** (`14:30 → 15:18`) — tự nó phải tăng dần; user đọc lướt là thấy sai.
3. **Khoảng cách giữa các phần** (`⏱ cách phần 1: 1 phút`) — tự động tính. Có 2 trạng thái bất thường:
   - Âm (phần sau bắt đầu trước khi phần trước kết thúc) → cảnh báo ERR-10, **không chặn** Start.
   - Quá lớn (> 60 phút, OQ-8) → gợi ý ERR-11 "có thể đây là 2 buổi họp khác nhau".
4. **Nghe thử 10 giây** — nút `▶ Nghe 10 giây cuối` của phần N và `▶ Nghe 10 giây đầu` của phần
   N+1. Đây là cách con người thật sự xác nhận tính liên tục ("...vậy thì chúng ta chốt—" /
   "—chốt phương án B nhé"). Phát cục bộ từ chính file trên máy: **không tốn tiền, không gọi
   server, không cần transcribe**.

Thời lượng file đọc client-side từ metadata audio. `[CHƯA VERIFY]` — trình duyệt **không** đọc
được thời lượng của mọi định dạng MeetNote nhận (amr, asf nhiều khả năng không phát được trong
Chrome/Safari). Thiết kế phải chịu được trường hợp đó: cột thời lượng hiện `—`, dòng "cách phần
trước" ẩn đi, **nút nghe thử bị vô hiệu kèm tooltip** "Trình duyệt không phát được định dạng này
— kiểm tra thứ tự bằng tên file và giờ tạo file." Tổng thời lượng khi đó hiện "3 phần" thay vì
tổng giờ. Dev phải test đúng các định dạng này trước khi đóng task.

#### 4b.3 File lỗi trong chế độ ghép — khác hẳn chế độ riêng

Chế độ "nhiều cuộc họp riêng": file lỗi bị **bỏ qua**, các file khác vẫn chạy.
Chế độ ghép: file lỗi **chặn** nút Start cho tới khi user tự tay bỏ nó ra.

```
  │ ⠿ │ 2 │ voice-note-2.opus                                          │
  │   │   │ ⚠ MeetNote chưa hỗ trợ định dạng .opus.                    │
  │   │   │   Bỏ phần này ra thì cuộc họp sẽ thiếu đoạn giữa           │
  │   │   │   (15:19 → 16:07).            [ Vẫn bỏ phần này ]          │
```

**WHY:** bỏ qua một file trong 3 file rời = mất 1 cuộc họp, user thấy ngay. Bỏ qua phần 2 của
một cụm = ra một cuộc họp **trông có vẻ đầy đủ** nhưng thủng ruột — đúng loại lỗi im lặng mà D8
cấm. Vì vậy phải bắt user xác nhận bằng tay và nói rõ mất đoạn nào.

#### 4b.4 Layout modal đổi gì so với Screen 3

| Thành phần | Chế độ riêng | Chế độ ghép |
| --- | --- | --- |
| Bộ chọn chế độ | có (khi ≥ 2 file) | có |
| Ô Tên cuộc họp | mỗi dòng file 1 ô | **1 ô duy nhất** ở dưới danh sách phần |
| Ô Ngày giờ | mỗi dòng file 1 ô | **1 ô duy nhất**, prefill = `lastModified` của **phần 1** |
| Thứ tự / kéo thả | không có | có (`⠿`, `▲▼`, số thứ tự) |
| Nghe thử | không có | có |
| Tổng thời lượng | không hiện | hiện ở tiêu đề danh sách |
| Thông tin cuộc họp / Cấu hình STT | áp chung mọi file | áp cho cả cụm (giống hệt) |
| File lỗi | bỏ qua, không chặn | **chặn** tới khi user bỏ ra |
| Nhãn nút | "Bắt đầu — tạo 3 cuộc họp" | "Bắt đầu — tạo 1 cuộc họp gồm 3 phần" |

Tên mặc định trong chế độ ghép: lấy tên file **phần 1**, bỏ đuôi và bỏ hậu tố số/`phần N`/`part N`
ở cuối (`REC_001` → `REC`). Nếu sau khi cắt còn chuỗi rỗng hoặc quá ngắn (< 3 ký tự) thì giữ
nguyên tên file gốc.

#### 4b.5 Chia nhóm trong cùng một lần import (3 file là 1 buổi, 2 file còn lại là 2 buổi khác)

**KHÔNG đưa vào v1.** Lý do:

1. Nó biến modal từ "1 câu hỏi có 2 đáp án" thành thao tác gom nhóm nhiều lựa chọn (chọn nhiều
   dòng → gom → đặt tên nhóm → lặp lại) — phức tạp nhất app, trong khi cả app hiện chỉ có đúng
   một chỗ multi-select (xoá meeting hàng loạt).
2. **Đường vòng rất rẻ:** import 2 lần. Modal mở lại trong 1 giây, không mất dữ liệu gì. Bối cảnh
   sau-họp không có áp lực thời gian (§1) nên 2 lần import là chi phí gần bằng 0.
3. Rủi ro nhầm lẫn cao: khi trên màn hình cùng lúc tồn tại "nhóm" và "file lẻ", user rất dễ bấm
   Start khi còn file chưa gom đúng chỗ — mà hậu quả thì không hoàn tác được.

**Cách nói với user khi họ rơi vào tình huống này** — khi user đang ở chế độ ghép và bỏ bớt phần
ra bằng `✕`, hiện dòng gợi ý: IMP-27 *"Còn file của buổi họp khác? Nhập xong lần này rồi nhập
tiếp lần nữa — thông tin bạn vừa điền không mất đi đâu cả."*

**Thiết kế đã chừa đường mở rộng:** chế độ là thuộc tính của *cả lần import*, nên phiên bản sau
muốn thêm "nhiều nhóm trong 1 lần" chỉ cần cho phép tạo nhiều khối "Cuộc họp" trong cùng danh
sách, không phải đập đi làm lại mô hình dữ liệu của modal.

---

### Screen 5 — Sau khi bấm Start: trạng thái chờ

Modal **đóng ngay**, quay về màn hình user đang đứng (Dashboard). Không giữ user lại nhìn thanh
chạy — file 2 tiếng thì không ai ngồi nhìn.

#### 5.1 Toast xác nhận

```
┌──────────────────────────────────────────────┐
│ Đang tạo transcript cho 3 bản ghi.           │   type = info
│ Bạn cứ dùng MeetNote bình thường.            │
└──────────────────────────────────────────────┘
```

Chế độ ghép: *"Đang tạo transcript cho cuộc họp gồm 3 phần."* (PRG-11)

**Trường hợp ngày họp lùi về quá khứ** — toast bổ sung 1 dòng và 1 link:

```
┌──────────────────────────────────────────────┐
│ Đã thêm vào ngày 16/09.           [ Mở ]     │   type = success
└──────────────────────────────────────────────┘
```

**WHY:** All Meetings sắp theo `date` (`js/storage.js:441-471`). Nhập file họp tuần trước → meeting
mới tạo **rơi xuống giữa danh sách**, không nằm ở đầu như user mong đợi, và cũng không xuất hiện
trong "Recent Meetings" 5 dòng của Dashboard. Không nói gì thì user tưởng import thất bại. Xem
thêm badge "Mới nhập" ở §5.9.3.

#### 5.2 Header indicator — nâng cấp từ nút đếm hiện tại

Hiện tại: `<button>… 2 audio tasks</button>` bấm vào nhảy sang All Meetings (`js/app.js:243-249`).
Đề xuất: giữ nguyên nút, **bấm vào mở popover** liệt kê task thay vì điều hướng đi.

```
                                 ┌────────────────────────────────────────────┐
  [ ◌ 2 audio tasks ▾ ]  ───────▶│ Đang xử lý                                 │
                                 │ ────────────────────────────────────────── │
                                 │ 🎵 Họp khách hàng ABC                      │
                                 │    ▰▰▱  2/3 phần xong · đã 14 phút      →  │
                                 │ 🎵 Standup 16-09                           │
                                 │    Đang chờ tới lượt                    →  │
                                 │ ────────────────────────────────────────── │
                                 │ Giữ MeetNote chạy cho tới khi xong.        │
                                 └────────────────────────────────────────────┘
```

- Mỗi dòng bấm được → mở Meeting Detail tương ứng.
- Bản ghi 1 phần: `Đang chép file…` → `Đang chờ tới lượt` → `Đang tạo transcript · đã 4 phút`.
  (Phase `saving`/`transcribing` đã có sẵn trong `_backgroundAudioTasks`, `js/app.js:3841,3848`.)
- Bản ghi **N phần**: thanh đoạn `▰▰▱` + chữ `2/3 phần xong`. Nút header đếm theo **bản ghi**,
  không đếm theo phần — "2 audio tasks" nghĩa là 2 cuộc họp, dù một trong số đó có 3 phần.

**WHY dùng thanh đoạn cho N phần nhưng không dùng % cho 1 phần:** `2/3 phần` là con số **có thật
và đếm được** (mẫu số biết trước, tử số là số phần đã xong hẳn). Còn tiến độ *bên trong* một phần
thì server không cung cấp. Thanh đoạn rời rạc nói đúng những gì ta biết và không ngụ ý gì về
những gì ta không biết.

**KHÔNG hiển thị phần trăm và KHÔNG hiển thị "còn lại ~X phút".** Job API chỉ trả `status`, không
có progress (`server.js:1439-1450`) → mọi con số % đều là bịa. Thà hiện "4 min elapsed" thật còn
hơn thanh progress giả đứng im ở 80% (mất niềm tin nặng hơn là không có progress).

Bước "Copying file" (PUT audio lên local server) hiện cũng không có progress vì `fetch` không phát
sự kiện upload (`js/audio-storage.js:27-34`). Với file trăm MB qua localhost thì bước này nhanh,
nên thiết kế chấp nhận trạng thái indeterminate (spinner + PRG-02 "Đang chép file…"). Nếu Tech Lead muốn
progress thật thì cần đổi sang XHR — **không bắt buộc cho v1**.

#### 5.3 All Meetings / Dashboard list

Dùng lại badge có sẵn `Processing…` (`js/app.js:3659`), thêm dòng phụ nhỏ dưới tiêu đề:
`Đang tạo transcript · bắt đầu 14:32`, hoặc `Đang tạo transcript · 2/3 phần` với bản ghi nhiều
phần. Meeting đang processing vẫn không cho chọn để xoá (hành vi sẵn có, `js/app.js:3667`) — giữ
nguyên, và với bản ghi nhiều phần thì càng phải giữ (xoá giữa chừng để lại phần mồ côi).

#### 5.4 Meeting Detail của meeting đang processing — **nơi user điền context trong lúc chờ**

```
┌───────────────────────────────────────────────────────────────┐
│  Khach hang ABC        ✎   [ Processing audio… ]              │
│  📅 16/09/2026 14:30   ⏱️ 1h 48m   👥 —                        │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ ◌  Đang tạo transcript cho bản ghi của bạn              │ │  ← card MỚI, chỉ khi processing
│  │    Bắt đầu 4 phút trước · REC_20260916_143012.m4a       │ │
│  │    Bạn có thể đóng tab — chỉ cần đừng thoát MeetNote.   │ │
│  │    Trang này sẽ tự cập nhật khi transcript xong.        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ▶ ──────────────────────────────  0:00        (audio player) │
│                                                               │
│  ┌─ Pre-meeting info ──────────────────────────── [ Save ] ─┐ │  ← CARD ĐÃ CÓ SẴN (§5.9)
│  │ 💡 Điền trong lúc chờ — bản tóm tắt sẽ dùng thông tin này│ │  ← thêm 1 dòng hint
│  │ Ngày giờ họp / Người tham dự / Meeting type / Topic /    │ │
│  │ Led by / Tags                                            │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  [Transcript] [Summary] [Translation] [Actions] [Notes]        │
│  ┌──────────────────────────────────────────────────────────┐│
│  │              ◌  Đang tạo transcript…                     ││  ← thay cho "No transcript"
│  └──────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

**WHY:** biến thời gian chết thành thời gian hữu ích, và đây chính là lý do modal import được phép
gọn nhẹ (D2) — context không mất đi, chỉ dời sang lúc rảnh hơn.

Tab Transcript/Summary khi đang processing phải nói "đang tạo", không được hiện empty state
"No transcript recorded." (`js/app.js:1334`) vì nó trông như đã xong và rỗng.

#### 5.4b Meeting Detail khi bản ghi có N phần và mới xong 2/3

**Có cho đọc transcript dở dang không? — CÓ.** Chờ 2 tiếng mà không được đọc gì là lãng phí; phần
1 và 2 đã xong thì đã dùng được ngay (tìm tên, tra lại một câu ai đó nói). Điều kiện duy nhất:
**phải nhìn thấy rõ chỗ nào chưa có**, không được để user tưởng đã đọc hết buổi họp.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Họp khách hàng ABC     ✎   [ Processing audio… ]                   │
│  📅 16/09/2026 14:30   ⏱️ 2h 14m (3 phần)   👥 4 người              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ◌  Đang tạo transcript · 2/3 phần xong                        │ │
│  │    ▰▰▱                                                        │ │
│  │    ✓ Phần 1  ·  14:30 → 15:18   Xong                          │ │
│  │    ✓ Phần 2  ·  15:19 → 16:07   Xong                          │ │
│  │    ◌ Phần 3  ·  16:08 → 16:46   Đang tạo transcript · đã 3 phút│ │
│  │    Bạn có thể đóng tab — chỉ cần đừng thoát MeetNote.         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  [Transcript] [Summary ⓘ] [Translation] [Actions] [Notes]           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ── Phần 1 · 14:30 ────────────────────────────────────────  │   │  ← dải phân cách (MỚI)
│  │  00:00  Speaker 1   Chào mọi người, hôm nay …                │   │
│  │  …                                                           │   │
│  │  ── Phần 2 · 15:19 ────────────────────────────────────────  │   │
│  │  48:12  Speaker 2   Về phần báo giá thì …                    │   │
│  │  …                                                           │   │
│  │  ┌───────────────────────────────────────────────────────┐  │   │
│  │  │  ◌  Phần 3 đang được tạo transcript…                  │  │   │  ← chỗ trống có nhãn (D8)
│  │  │     16:08 → 16:46 · 38 phút                           │  │   │
│  │  └───────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Quy tắc khi chưa đủ phần**

| Chức năng | Trạng thái | Lý do |
| --- | --- | --- |
| Đọc transcript | Cho phép, có dải phân cách từng phần + ô chờ ở đúng vị trí phần chưa xong | Hữu ích ngay, mà vẫn trung thực (D8) |
| Sửa transcript | Cho phép trên phần đã xong | Không có lý do chặn; chờ lâu mà không làm gì được thì phí |
| **Generate Summary** | **Vô hiệu**, tooltip PRG-13: *"Chờ đủ 3 phần rồi hãy tạo tóm tắt — tóm tắt trên transcript còn thiếu sẽ bỏ sót nội dung."* | Tóm tắt thiếu 1/3 buổi họp là kết quả **sai mà trông như đúng**, lại tốn tiền LLM. Đây là chỗ duy nhất trong thiết kế này tôi chủ động chặn user. |
| Export .md | Cho phép, kèm dòng cảnh báo trong file và trong modal export: *"Bản ghi này còn thiếu phần 3."* | Export chạy cục bộ, không tốn tiền; đã có tiền lệ BR-53 cho phép export khi chưa có summary |
| Dòng thời gian | Mốc thời gian của phần N cộng dồn theo tổng thời lượng các phần trước | Để transcript đọc như một buổi họp liền mạch, không phải 3 lần đếm lại từ 00:00 |

Mốc thời gian cộng dồn phụ thuộc thời lượng thật của từng phần do server đo được (không phải số
client đoán) — Tech Lead cần bảo đảm giá trị này có sẵn khi ghép. Đây là điểm nối dữ liệu thuộc
diện Protocol 6 (xem §11).

#### 5.5 Khi xong

- Toast success: "Transcript đã xong — Khach hang ABC" (DON-01), bấm vào mở meeting.
- Bản ghi nhiều phần: chỉ báo **một lần khi xong phần cuối**, không toast từng phần (3 toast cho
  1 buổi họp là ồn). Tiến độ từng phần đã có ở popover và Meeting Detail rồi.
- Nếu user đang đứng ở chính Meeting Detail đó → view tự refresh (hành vi `_refreshMeetingView`
  đã có).
- **Không** tự động nhảy màn hình khi user đang ở chỗ khác. Không tự động generate summary
  (giữ nguyên nguyên tắc hiện tại: Summary do user bấm).

#### 5.6 Pre-flight — chặn lỗi ngay trong modal (ĐÃ CHỐT: `/api/stt/providers` trả `maxUploadBytes` + danh sách mime)

Với dữ liệu này, modal phân biệt được **3 loại** tình huống, và chỉ 1 trong 3 là ngõ cụt:

| Loại | Nghĩa là gì | Hiển thị |
| --- | --- | --- |
| **A. MeetNote không hỗ trợ** | Đuôi file không nằm trong danh sách app nhận (`.opus`, `.3gp`, `.mov`…) | Ngõ cụt trong app. Chỉ có đường: bỏ file / convert bên ngoài. |
| **B. Provider đang chọn không nhận** | App hỗ trợ, nhưng provider đang chọn không nhận mime này **hoặc** file lớn hơn `maxUploadBytes` của nó | **Cứu được bằng 1 click** — đề nghị provider khác |
| **C. Cảnh báo, không phải lỗi** | Trùng file đã nhập, > 10 file, file rất lớn nhưng vẫn trong hạn mức | Chữ thông tin, không đổi màu cảnh báo, không chặn |

**Vị trí hiển thị: luôn inline trên chính dòng file đó.** Không dùng banner gộp ở đầu modal —
banner nói "có file lỗi" mà không nói file nào thì user phải tự dò. Chỉ thêm **một dòng tóm tắt
sát nút Start** (`1 file có lỗi sẽ không được nhập.`) để người đang định bấm Start không bỏ sót.

##### Loại A — định dạng app không hỗ trợ

```
  │🎵│ voice-note-3.opus · 4,1 MB                              [ ✕ ] │
  │  │ ⚠ MeetNote chưa hỗ trợ định dạng .opus. Hãy bỏ file này ra,   │
  │  │   hoặc chuyển sang m4a/mp3 trước rồi nhập lại.  [ Bỏ file ]   │
```

Không gợi ý mẹo "đổi đuôi file thành .ogg" — chưa verify (OQ-2). Không hứa điều chưa đo được.

##### Loại B — provider đang chọn không nhận (đây là chỗ đáng thiết kế kỹ nhất)

**Nguyên tắc tuyệt đối: KHÔNG tự đổi provider. Chỉ đề nghị.** App không được tự ý tiêu tiền của
user ở một dịch vụ mà user không chọn.

Ba biến thể tuỳ tình trạng provider thay thế:

**B1 — có provider khác nhận được file này VÀ đã cấu hình xong (trạng thái ready):**
```
  │🎵│ REC_20260916_143012.m4a · 121 MB                        [ ✕ ] │
  │  │ ⚠ File này nặng 121 MB. OpenAI Whisper chỉ nhận tối đa 25 MB. │
  │  │   Soniox nhận được file này.   [ Dùng Soniox cho lần này ]    │
```
Bấm nút → **không** chạy gì cả, chỉ:
1. Dòng lỗi biến thành dòng xác nhận: `✓ Sẽ dùng Soniox cho lần nhập này.` + link `Hoàn tác`.
2. Dòng tóm tắt trong khối "Cấu hình nhận dạng giọng nói" đổi thành
   `Soniox · chỉ cho lần nhập này · Tự nhận diện · Không dịch` và **nháy sáng 1 lần**
   (highlight ~600ms) để user thấy chỗ vừa đổi.
3. Mọi file khác trong danh sách được kiểm lại theo provider mới — có thể vài file khác cũng hết lỗi.

**WHY phải nháy sáng chỗ khác trên màn hình:** user bấm nút ở dòng file, nhưng thứ thay đổi lại
nằm ở khối khác. Không chỉ ra thì họ sẽ không biết cấu hình vừa đổi, và càng không biết nó chỉ áp
cho lần này. Link `Hoàn tác` có mặt vì đây là thay đổi do app đề xuất chứ không phải do user tự
nghĩ ra — thứ gì app đề xuất thì app phải cho rút lại dễ dàng.

**B2 — provider thay thế nhận được nhưng CHƯA có API key:**
```
  │  │ ⚠ File này nặng 121 MB. OpenAI Whisper chỉ nhận tối đa 25 MB. │
  │  │   Soniox nhận được file này nhưng chưa có API key.            │
  │  │                                              [ Mở Cài đặt ]  │
```
Không hiện nút "Dùng Soniox" ở trạng thái bấm-vào-thì-lỗi. Bấm "Mở Cài đặt" → cảnh báo mất lựa
chọn file (OQ-4).

**B3 — không provider nào đã cấu hình nhận được file:**
```
  │  │ ⚠ File này nặng 121 MB, lớn hơn hạn mức của mọi nhà cung cấp  │
  │  │   bạn đã cấu hình. Hãy nén hoặc cắt nhỏ file rồi nhập lại.    │
```
Nếu file bị cắt nhỏ thành nhiều khúc để lách hạn mức → đó chính là ca dùng của **chế độ ghép**
(§5.4b). Thêm 1 dòng gợi ý: IMP-28 *"Cắt thành nhiều file? Nhập cả loạt rồi chọn '1 cuộc họp gồm
nhiều phần'."* — đây là chỗ hai tính năng nối được vào nhau.

##### Loại C — cảnh báo mềm

| Tình huống | Nội dung | Hành vi |
| --- | --- | --- |
| Trùng file đã nhập (cùng tên + cùng dung lượng) | ERR-07 + nút `Vẫn nhập` | Không chặn |
| Hơn 10 file | ERR-09 (nhắc tốn thời gian và có thể tốn phí từng file) | Không chặn |
| File 0 byte | ERR-04 | Chặn file đó (không cứu được) |

##### 5 file mà chỉ 2 file hợp lệ thì sao?

**Chế độ "nhiều cuộc họp riêng"** — không chặn, nhưng phải minh bạch tuyệt đối:

```
├─────────────────────────────────────────────────────────────────┤
│  3 file có lỗi sẽ không được nhập.                              │  ← dòng tóm tắt, màu cảnh báo
│                     [ Hủy ]   [ Bắt đầu — tạo 2 cuộc họp ]      │  ← nhãn đếm file HỢP LỆ
└─────────────────────────────────────────────────────────────────┘
```

- Nhãn nút nói **kết quả thật** ("tạo 2 cuộc họp"), không nói "Bắt đầu (5 file)".
- Các dòng file lỗi **vẫn nằm nguyên trong danh sách**, không tự biến mất. App không được im lặng
  vứt file đi — user phải nhìn thấy cái bị bỏ lại.
- Sau khi bấm Start: modal đóng, toast ghi rõ `Đã bắt đầu 2 cuộc họp. 3 file bị bỏ qua do lỗi
  định dạng hoặc dung lượng.` (PRG-12).
- 0 file hợp lệ → nút disable, nhãn giữ nguyên `Bắt đầu tạo transcript`, dòng tóm tắt giải thích lý do.

**Chế độ ghép** — ngược lại: **chặn** cho tới khi user tự bỏ file lỗi ra (§4b.3). Nhãn nút vẫn
hiện số phần hiện tại nhưng disable, kèm dòng `Bỏ phần bị lỗi ra trước khi bắt đầu.` (ERR-12).

#### 5.7 Lỗi sau khi Start

| Tình huống | Hiển thị | Hành động phục hồi |
| --- | --- | --- |
| Transcribe fail giữa chừng | Card cảnh báo sẵn có ở Meeting Detail (`js/app.js:1408`) + **thêm 2 nút**: `Thử lại` và `Thử nhà cung cấp khác ▾` | Audio đã nằm trên máy → chạy lại **không cần tải lên lại** (FAI-04). Đây là điểm ăn tiền lớn nhất của luồng import. |
| Mất mạng giữa chừng | Poller đã tự retry backoff; hiện dòng "Mất kết nối — đang thử lại…" trong card chờ | Tự hồi phục, không cần user làm gì |
| Thoát hẳn MeetNote lúc đang chạy | Mở lại app → meeting `failed` (server đánh dấu, `js/storage.js:114-117`), card lỗi ghi rõ FAI-03 | Nút `Thử lại` |
| Đóng tab trình duyệt | Không sao — job sống ở server, mở lại tab thì `_resumeProcessingJobs` bắt lại (`js/app.js:3981`) | Không cần hành động |
| Server trả lỗi key/quota | Message của provider + link `Mở Cài đặt` | Sửa key rồi `Thử lại` |

**Nguyên tắc microcopy lỗi:** 1 câu chuyện gì đã xảy ra + 1 câu phải làm gì. Không hiện raw error
code ở dòng đầu (để nguyên message provider ở dòng phụ, chữ nhỏ). Không dùng từ "Lỗi" trần trụi
làm tiêu đề card.

#### 5.7b Một phần trong cụm bị lỗi — **thử lại đúng phần đó, không làm lại cả cụm**

Đây là yêu cầu bắt buộc chứ không phải tối ưu: chạy lại cả 3 phần vì hỏng 1 phần = trả tiền STT
gấp 3 cho cùng một kết quả.

**Trạng thái bản ghi:** không phải `failed` mà là một trạng thái riêng — badge `Thiếu 1 phần`
(kiểu `badge-warning`). Bản ghi **vẫn dùng được** với các phần đã xong.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Họp khách hàng ABC     ✎   [ Thiếu 1 phần ]                        │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ⚠  Phần 2 chưa tạo được transcript                            │ │
│  │    Nhà cung cấp báo: rate limit reached.                      │ │  ← message gốc, chữ nhỏ
│  │                                                               │ │
│  │    ✓ Phần 1  ·  14:30 → 15:18   Xong                          │ │
│  │    ⚠ Phần 2  ·  15:19 → 16:07   Chưa xong   [ Thử lại phần 2 ]│ │
│  │    ✓ Phần 3  ·  16:08 → 16:46   Xong                          │ │
│  │                                                               │ │
│  │    File ghi âm của phần 2 vẫn nằm trên máy bạn — thử lại       │ │
│  │    không phải tải lên lần nữa.                                │ │
│  │                                                               │ │
│  │    [ Thử lại phần 2 ]  [ Thử nhà cung cấp khác ▾ ]            │ │
│  │    [ Bỏ phần 2 khỏi bản ghi này ]                             │ │  ← nút hạng 3, chữ thường
│  └───────────────────────────────────────────────────────────────┘ │
```

**Ba đường ra, xếp đúng theo thứ tự user nên thử:**

1. **`Thử lại phần 2`** (primary) — chạy lại **đúng một phần**. Bản ghi quay về trạng thái
   processing với `2/3 phần xong`.
2. **`Thử nhà cung cấp khác ▾`** — cho ca lỗi do provider (quá hạn mức, hết quota, không nhận
   định dạng). Dropdown chỉ liệt kê provider **đã cấu hình xong và nhận được file này**. Cũng chỉ
   áp cho lần chạy này.
3. **`Bỏ phần 2 khỏi bản ghi này`** (hạng ba, không nổi bật) — lối thoát cuối khi thử mãi không
   được. Bấm → modal xác nhận:
   > **Bỏ phần 2?**
   > Bản ghi sẽ chỉ còn phần 1 và phần 3, thiếu đoạn 15:19 → 16:07 (48 phút). File ghi âm vẫn
   > được giữ trên máy. Bản ghi sẽ được đánh dấu là **thiếu nội dung**.
   > `[ Hủy ]` `[ Bỏ phần 2 ]`

   Sau khi bỏ: bản ghi chuyển `completed` **nhưng giữ vĩnh viễn** một dòng ghi chú trong
   transcript tại đúng vị trí đó: `⚠ Thiếu đoạn 15:19 → 16:07 (đã bỏ phần 2).` — và dòng này
   **phải đi vào file export**. Lý do: 6 tháng sau đọc lại biên bản, không ai nhớ là đã thiếu.

**Transcript khi phần 2 lỗi (D8 — quan trọng nhất mục này):**

```
  ── Phần 1 · 14:30 ──────────────────────────
  00:00  Speaker 1   …
  ┌──────────────────────────────────────────┐
  │ ⚠ Phần 2 chưa có transcript              │   ← KHÔNG được nối thẳng phần 1 vào phần 3
  │   15:19 → 16:07 · 48 phút                │
  │   [ Thử lại phần 2 ]                     │
  └──────────────────────────────────────────┘
  ── Phần 3 · 16:08 ──────────────────────────
  1:37:42  Speaker 2   …
```

Mốc thời gian của phần 3 **vẫn cộng dồn như thể phần 2 tồn tại**, để đối chiếu được với file audio
gốc. Nếu dồn sát lại thì mọi mốc thời gian phần 3 sẽ lệch 48 phút so với bản ghi thật.

**Generate Summary khi đang thiếu phần:** vô hiệu như §5.4b. Sau khi user chủ động "Bỏ phần 2",
nút **mở lại**, nhưng Summary tab hiện dòng cảnh báo thường trực: PRG-14 *"Bản ghi này thiếu đoạn
15:19 → 16:07 — bản tóm tắt sẽ không có nội dung đoạn đó."*

**WHY cho user bỏ phần thay vì bắt sửa bằng được:** không có đường bỏ thì bản ghi kẹt ở trạng thái
"thiếu" vĩnh viễn, không tóm tắt được, không export sạch được — user sẽ xoá cả buổi họp đi cho
xong, mất luôn 2 phần đã trả tiền. Cho lối thoát, nhưng bắt xác nhận có ý thức và để lại vết.

### 5.8 Nhắc về chất lượng âm thanh — nhắc ở đâu cho không phiền

3 vị trí, tăng dần theo mức độ "có bằng chứng là đã xảy ra":

1. **Trong modal, state rỗng** (Screen 2): 1 dòng hint tĩnh, màu phụ, không icon cảnh báo.
   Đọc lướt qua cũng được — đây là nơi duy nhất nhắc *phòng ngừa cho lần sau*.
2. **Không nhắc gì** ở state B/C. Lúc này file đã ghi xong rồi, nhắc nữa chỉ là trách móc.
3. **Sau khi có transcript, chỉ khi có dấu hiệu thật**: nếu transcript rỗng hoặc rất ngắn so với
   độ dài audio (đề xuất: < 200 từ cho file > 30 phút), Meeting Detail hiện 1 card gợi ý QLT-01
   + gợi ý thử nhà cung cấp khác. Ngưỡng cụ thể để BA/Domain Expert chốt (OQ-5).
   Với bản ghi nhiều phần: đánh giá **theo từng phần**, và chỉ cảnh báo khi có phần cụ thể bị
   ngắn bất thường (QLT-02: *"Phần 2 có transcript ngắn bất thường so với độ dài — có thể lúc đó
   micro ở quá xa."*). Đánh giá trên tổng sẽ bị các phần tốt pha loãng, không phát hiện được.

**WHY:** nhắc trước khi ghi thì user không có mặt (họ ghi bằng điện thoại, ở chỗ khác); nhắc
lúc import thì đã muộn; chỉ có nhắc *có điều kiện, sau khi thấy hậu quả* là vừa đúng lúc vừa
không phiền người ghi tốt.

---

### 5.9 Sửa **Ngày giờ họp** và **Người tham dự** ở Meeting Detail (ĐÃ CHỐT: trong scope, áp dụng cho **mọi** bản ghi)

**Mục tiêu:** mọi thông tin đi vào prompt tóm tắt đều phải sửa được sau khi bản ghi đã tồn tại —
không riêng bản ghi import.

#### 5.9.1 Đặt ở đâu và sửa kiểu gì

**Mở rộng card "Pre-meeting info" đã có** (`js/app.js:1418-1450`), sửa **inline**, không modal.

WHY inline, không modal:
- Card đó đã có sẵn nút `Save` và đã là "chỗ sửa thông tin cuộc họp" trong đầu user. Thêm modal
  nữa = 2 mô hình song song cho cùng một việc.
- Bối cảnh xem lại sau họp cho phép mật độ thông tin cao (§1) — không cần giấu vào modal.
- Sửa Title vẫn giữ ở header (đã có, `js/app.js:1376-1379`). **Không** nhân đôi Title xuống card
  này, nếu không user sẽ gặp 2 ô Title trên cùng màn hình.

```
┌─ Pre-meeting info ─────────────────────────────────────── [ Save ] ─┐
│ ℹ️ Thông tin cuộc họp có thể mới hơn lần tạo tóm tắt gần nhất…       │  ← hint stale ĐÃ CÓ
│                                                                     │
│ Ngày giờ họp                                                        │  ← MỚI
│ [ 16/09/2026  14:30  📅 ]   Nhập vào MeetNote ngày 18/09.           │  ← dòng phụ, xem 5.9.3
│                                                                     │
│ Người tham dự                                                       │  ← MỚI
│ [ Hieu ✕ ] [ Lan ✕ ] [ khách ABC ✕ ]                                │  ← .tag-chip-row tái dùng
│ [ Nhập tên rồi bấm Enter                                        ]   │
│                                                                     │
│ Meeting type   [ Họp khách hàng                                 ▾ ] │  ← đã có
│ Topic          [ Báo giá Q4                                     ]   │  ← đã có
│ Led by         [ Hieu                                           ]   │  ← đã có
│ Tags           [ Họp khách hàng ✕ ] [ báo giá ✕ ]                    │  ← đã có
│                [ Nhập tag rồi bấm Enter                         ]   │
└─────────────────────────────────────────────────────────────────────┘
```

| Field | Kiểu nhập | Tái dùng gì |
| --- | --- | --- |
| Ngày giờ họp | `<input type="datetime-local" class="input">` | `.input`, `.input-group` |
| Người tham dự | Chip + ô nhập, Enter để thêm, `✕` để bỏ | **Giống hệt** editor Tags đang chạy ngay bên dưới (`js/app.js:1441-1447`) |

**WHY dùng chip cho participants thay vì 1 ô "ngăn cách bằng dấu phẩy" như Meeting Setup:**
ở Meeting Setup, ô phẩy thắng vì đang vội, gõ một mạch nhanh nhất. Ở đây thì thao tác chính là
**sửa/thêm 1 người vào danh sách đã có** — với ô phẩy, user phải tự dò giữa chuỗi văn bản để sửa,
rất dễ làm hỏng tên người khác. Chip cho phép bỏ đúng 1 người bằng 1 click. Và user đã học pattern
này ở editor Tags ngay dưới đó, không phải học lại.

- Cả hai field **không bắt buộc**, không field nào chặn Save (nhất quán BR-24).
- Xoá sạch ô ngày giờ → khôi phục giá trị đang lưu khi blur, **không** để rỗng và **không** nhảy
  về "bây giờ".
- Bấm Save → toast `Đã lưu thông tin cuộc họp` + hint stale-summary sẵn có tự xuất hiện nếu bản
  ghi đã có summary (`js/app.js:2031-2035`) — user được nhắc Generate lại. Cơ chế này đã đúng sẵn,
  chỉ cần `updatedAt` được cập nhật khi sửa 2 field mới.
- Sửa được **kể cả khi đang processing** (đó chính là ca dùng chính, §5.4) và cả khi đã completed.

#### 5.9.2 Sửa ngày giờ có làm bản ghi "biến mất" không?

Có, và đây là rủi ro thật: đổi ngày từ 18/09 về 16/09 → bản ghi **nhảy vị trí** trong All Meetings
(danh sách sắp theo `date`). User vừa bấm Save thì thấy nó trôi đi mất.

**Xử lý:** sau khi Save mà `date` đổi sang một **ngày khác** (không chỉ đổi giờ), toast nói rõ
chuyện gì vừa xảy ra: DAT-03 *"Đã chuyển bản ghi này sang ngày 16/09 — trong danh sách nó sẽ nằm
ở vị trí của ngày đó."* Không tự điều hướng đi đâu cả.

#### 5.9.3 Hiển thị khi `date` khác `createdAt`

Hai mốc thời gian khác nhau tồn tại song song: **ngày họp** (`date`, user quan tâm) và **ngày nhập
vào máy** (`createdAt`, dùng để giải thích "sao hôm nay mới thấy nó").

| Chỗ hiển thị | Quy tắc |
| --- | --- |
| Header Meeting Detail (`js/app.js:1383`) | Luôn hiện `📅 <date>`. **Nếu lệch `createdAt` quá 1 ngày** → thêm chữ nhỏ, màu phụ: `· Nhập vào MeetNote ngày 18/09` (DAT-01) |
| Card Pre-meeting info | Dòng phụ dưới ô ngày giờ, cùng nội dung DAT-01 |
| Dòng trong All Meetings | Hiện `date` như thường. Nếu `createdAt` trong **24 giờ gần đây** và lệch `date` > 1 ngày → thêm badge `Mới nhập` (`.badge .badge-primary`) |

**WHY badge "Mới nhập":** đây là cách duy nhất để một bản ghi mang ngày quá khứ vẫn tìm lại được
sau khi user đóng toast. Không có nó, người vừa nhập file họp tuần trước sẽ mở All Meetings, nhìn
đầu danh sách, không thấy gì, và kết luận là import hỏng.

**Ngưỡng "lệch quá 1 ngày"** để tránh nhiễu cho bản ghi trực tiếp (ghi lúc 23:50, lưu xong 00:05
hôm sau — lệch ngày lịch nhưng không có gì bất thường). BA chốt lại nếu cần (OQ-9).

---

## 6. Microcopy chính thức (tiếng Việt)

**Đây là bản chính thức để Dev copy thẳng vào code.** Cột tiếng Anh của rev 1 đã bỏ theo Quyết
định 1. Không tự diễn đạt lại — nếu thấy câu nào sai/thiếu, báo lại để sửa ở đây trước.

Quy ước: xưng "bạn", không xưng "chúng tôi". Không dùng dấu chấm than. Số thập phân dùng dấu phẩy
(`58,4 MB`) theo chuẩn tiếng Việt. Không viết hoa giữa câu kiểu tiếng Anh.

### 6.1 Kéo thả (DND)

| ID | Nội dung |
| --- | --- |
| DND-01 | Thả file ghi âm vào đây |
| DND-02 | Định dạng file này chưa được hỗ trợ |

### 6.2 Modal nhập file — khung chung (IMP)

| ID | Nội dung | Ghi chú |
| --- | --- | --- |
| IMP-01 | Nhập bản ghi âm | tiêu đề modal, 1 file |
| IMP-02 | Nhập bản ghi âm (3 file) | tiêu đề modal, nhiều file; số thay động |
| IMP-03 | Kéo file ghi âm vào đây | |
| IMP-04 | hoặc | |
| IMP-05 | Chọn file… | |
| IMP-06 | Định dạng hỗ trợ: m4a, mp3, wav, aac, flac, ogg, webm, amr, aiff, asf, mp4 | |
| IMP-07 | Ghi âm bằng điện thoại? Hãy đặt máy gần người nói — tiếng thu từ trong túi rất khó nhận dạng. | chỉ hiện ở state rỗng |
| IMP-09 | Tên cuộc họp | |
| IMP-10 | Cuộc họp này diễn ra khi nào? | |
| IMP-11 | Lấy từ thông tin file — bạn kiểm tra lại giúp. | |
| IMP-11b | Lấy từ phần 1 — bạn kiểm tra lại giúp. | chế độ ghép |
| IMP-12 | Có vẻ đây là lúc bạn chép file vào máy. Hãy chọn đúng ngày họp. | khi `lastModified` cách hiện tại < 30 phút |
| IMP-13 | Thông tin cuộc họp (không bắt buộc — giúp tóm tắt tốt hơn) | 1 file |
| IMP-14 | Thông tin cuộc họp — áp dụng cho tất cả file | nhiều file, chế độ riêng |
| IMP-15 | Cấu hình nhận dạng giọng nói | |
| IMP-16 | Chỉ áp dụng cho lần nhập này. | dưới ô chọn nhà cung cấp |
| IMP-17 | + Thêm file | |
| IMP-18 | Bắt đầu tạo transcript | 1 file |
| IMP-19 | Bắt đầu — tạo 2 cuộc họp | nhiều file, chế độ riêng; số = số file **hợp lệ** |
| IMP-20 | Hủy | |
| IMP-22 | Người tham dự (cách nhau bằng dấu phẩy) | label trong modal import |
| IMP-23 | ví dụ: Hieu, Lan, khách ABC | placeholder |
| IMP-24 | Chủ đề | label cho `topic` |
| IMP-25 | Người chủ trì | label cho `leadBy` |
| IMP-26 | Nhà cung cấp / Ngôn ngữ nói / Dịch sang | 3 label trong khối cấu hình |
| IMP-26b | Soniox (mặc định) · Tự nhận diện nhiều ngôn ngữ · Không dịch — chỉ bản gốc | mẫu giá trị trong 3 dropdown |
| IMP-27 | Còn file của buổi họp khác? Nhập xong lần này rồi nhập tiếp lần nữa — thông tin bạn vừa điền không mất đi đâu cả. | khi user bỏ bớt phần ra ở chế độ ghép |
| IMP-28 | Cắt thành nhiều file? Nhập cả loạt rồi chọn "1 cuộc họp gồm nhiều phần". | dưới lỗi B3 |

### 6.3 Chế độ ghép nhiều phần (MRG)

| ID | Nội dung | Ghi chú |
| --- | --- | --- |
| MRG-01 | Ba file này là gì? | câu hỏi chọn chế độ; "Ba"/"Năm"… đổi theo số file, ≥ 10 thì dùng "Các file này là gì?" |
| MRG-02 | 3 cuộc họp riêng | nhãn lựa chọn 1 |
| MRG-03 | Mỗi file thành một bản ghi riêng. | mô tả lựa chọn 1 |
| MRG-04 | 1 cuộc họp gồm 3 phần | nhãn lựa chọn 2 |
| MRG-05 | Ghép nối tiếp thành một transcript duy nhất. | mô tả lựa chọn 2 |
| MRG-06 | Các phần · tổng 2 giờ 14 phút | tiêu đề danh sách phần |
| MRG-06b | Các phần · 3 phần | khi không đọc được thời lượng |
| MRG-07 | Đang sắp theo thời gian tạo file. | |
| MRG-08 | Đang sắp theo tên file. | |
| MRG-09 | Sắp theo tên file | nút đổi cách sắp |
| MRG-10 | Sắp theo thời gian tạo file | nút đổi cách sắp |
| MRG-11 | Nghe 10 giây đầu | |
| MRG-12 | Nghe 10 giây cuối | |
| MRG-13 | Nghe thử 10 giây cuối phần 1 và 10 giây đầu phần 2 để chắc chắn thứ tự đúng — sai thứ tự thì transcript sẽ lộn xộn. | dòng hướng dẫn dưới danh sách |
| MRG-14 | Trình duyệt không phát được định dạng này — kiểm tra thứ tự bằng tên file và giờ tạo file. | tooltip nút nghe bị vô hiệu |
| MRG-15 | cách phần 1: 1 phút | khoảng cách với phần trước |
| MRG-16 | + Thêm phần | |
| MRG-17 | Bắt đầu — tạo 1 cuộc họp gồm 3 phần | nhãn nút chính |
| MRG-18 | Bỏ phần này ra thì cuộc họp sẽ thiếu đoạn giữa (15:19 → 16:07). | cảnh báo khi bỏ 1 phần khỏi cụm |
| MRG-19 | Vẫn bỏ phần này | |
| MRG-20 | Ba file này ghi liên tiếp nhau trong cùng buổi chiều 16/09. Chúng là các phần của cùng một cuộc họp? | gợi ý tự động |
| MRG-21 | Ghép thành 1 cuộc họp | nút của gợi ý MRG-20 |
| MRG-22 | Phần 1 · 14:30 | dải phân cách trong transcript |

### 6.4 Lỗi và cảnh báo trước khi chạy (ERR)

| ID | Nội dung | Ghi chú |
| --- | --- | --- |
| ERR-01 | MeetNote chưa hỗ trợ định dạng .opus. Hãy bỏ file này ra, hoặc chuyển sang m4a/mp3 trước rồi nhập lại. | đuôi file thay động |
| ERR-01b | Bỏ file | |
| ERR-02 | File này nặng 121 MB. OpenAI Whisper chỉ nhận tối đa 25 MB. | tên provider + số MB lấy từ `/api/stt/providers` |
| ERR-02b | OpenAI Whisper không nhận định dạng .amr. | biến thể mime thay vì dung lượng |
| ERR-03 | Soniox nhận được file này. | dòng dẫn trước nút ERR-03b |
| ERR-03b | Dùng Soniox cho lần này | |
| ERR-03c | ✓ Sẽ dùng Soniox cho lần nhập này. | sau khi bấm |
| ERR-03d | Hoàn tác | |
| ERR-04 | File này rỗng. | |
| ERR-05 | Soniox nhận được file này nhưng chưa có API key. | |
| ERR-06 | Mở Cài đặt | |
| ERR-06b | Bạn sẽ phải chọn lại file sau khi lưu cấu hình. | cảnh báo trước khi rời modal |
| ERR-07 | Có vẻ bạn đã nhập file này ngày 16/09. | |
| ERR-08 | Vẫn nhập | |
| ERR-09 | Nhập nhiều file dài sẽ mất thời gian, và nhà cung cấp có thể tính phí từng file. | > 10 file |
| ERR-10 | Phần 2 bắt đầu trước khi phần 1 kết thúc — kiểm tra lại thứ tự. | khoảng cách âm |
| ERR-11 | Phần 2 cách phần 1 hơn 2 tiếng — có thể đây là hai buổi họp khác nhau. | khoảng cách quá lớn |
| ERR-12 | Bỏ phần bị lỗi ra trước khi bắt đầu. | dòng cạnh nút Start bị vô hiệu |
| ERR-13 | File này nặng 121 MB, lớn hơn hạn mức của mọi nhà cung cấp bạn đã cấu hình. Hãy nén hoặc cắt nhỏ file rồi nhập lại. | B3 |
| ERR-14 | 3 file có lỗi sẽ không được nhập. | dòng tóm tắt cạnh nút Start |

### 6.5 Đang xử lý (PRG)

| ID | Nội dung | Ghi chú |
| --- | --- | --- |
| PRG-01 | Đang tạo transcript cho 3 bản ghi. Bạn cứ dùng MeetNote bình thường. | toast |
| PRG-02 | Đang chép file… | |
| PRG-03 | Đang chờ tới lượt | |
| PRG-04 | Đang tạo transcript · đã 4 phút | |
| PRG-05 | Đang tạo transcript cho bản ghi của bạn | tiêu đề card chờ |
| PRG-06 | Bạn có thể đóng tab — chỉ cần đừng thoát MeetNote. Trang này sẽ tự cập nhật khi transcript xong. | |
| PRG-07 | Điền trong lúc chờ — bản tóm tắt sẽ dùng những thông tin này. | hint trong card Pre-meeting info |
| PRG-08 | Đang tạo transcript… | trong tab Transcript |
| PRG-09 | Giữ MeetNote chạy cho tới khi xong. | chân popover |
| PRG-10 | Mất kết nối — đang thử lại… | |
| PRG-11 | Đang tạo transcript cho cuộc họp gồm 3 phần. | toast, chế độ ghép |
| PRG-12 | Đã bắt đầu 2 cuộc họp. 3 file bị bỏ qua do lỗi định dạng hoặc dung lượng. | toast khi có file bị bỏ |
| PRG-13 | Chờ đủ 3 phần rồi hãy tạo tóm tắt — tóm tắt trên transcript còn thiếu sẽ bỏ sót nội dung. | tooltip nút Generate Summary bị vô hiệu |
| PRG-14 | Bản ghi này thiếu đoạn 15:19 → 16:07 — bản tóm tắt sẽ không có nội dung đoạn đó. | cảnh báo thường trực sau khi bỏ 1 phần |
| PRG-15 | 2/3 phần xong · đã 14 phút | dòng tiến độ cụm |
| PRG-16 | Phần 3 đang được tạo transcript… | ô chờ trong transcript |
| PRG-17 | Bản ghi này còn thiếu phần 3. | cảnh báo khi export lúc chưa đủ phần |

### 6.6 Xong và thất bại (DON / FAI)

| ID | Nội dung | Ghi chú |
| --- | --- | --- |
| DON-01 | Transcript đã xong — Họp khách hàng ABC | toast, chỉ bắn 1 lần khi xong phần cuối |
| FAI-01 | Thử lại | |
| FAI-01b | Thử lại phần 2 | |
| FAI-02 | Thử nhà cung cấp khác | |
| FAI-03 | MeetNote bị tắt trước khi chạy xong. File ghi âm vẫn còn — bạn có thể thử lại. | |
| FAI-04 | File ghi âm vẫn nằm trên máy bạn — thử lại không phải tải lên lần nữa. | |
| FAI-05 | Phần 2 chưa tạo được transcript | tiêu đề card lỗi cụm |
| FAI-06 | Nhà cung cấp báo: {message} | dòng phụ, chữ nhỏ, giữ nguyên message gốc |
| FAI-07 | Bỏ phần 2 khỏi bản ghi này | nút hạng ba |
| FAI-08 | Bỏ phần 2? | tiêu đề modal xác nhận |
| FAI-09 | Bản ghi sẽ chỉ còn phần 1 và phần 3, thiếu đoạn 15:19 → 16:07 (48 phút). File ghi âm vẫn được giữ trên máy. Bản ghi sẽ được đánh dấu là thiếu nội dung. | thân modal xác nhận |
| FAI-10 | Thiếu đoạn 15:19 → 16:07 (đã bỏ phần 2). | dấu vết vĩnh viễn trong transcript **và** trong file export |
| FAI-11 | Phần 2 chưa có transcript | ô trống trong transcript khi phần lỗi |
| FAI-12 | Thiếu 1 phần | badge trạng thái |

### 6.7 Chất lượng âm thanh (QLT)

| ID | Nội dung |
| --- | --- |
| QLT-01 | Transcript ngắn hơn nhiều so với độ dài bản ghi. Thường là do micro đặt quá xa người nói. |
| QLT-02 | Phần 2 có transcript ngắn bất thường so với độ dài — có thể lúc đó micro ở quá xa. |

### 6.8 Ngày giờ và người tham dự ở Meeting Detail (DAT)

| ID | Nội dung | Ghi chú |
| --- | --- | --- |
| DAT-01 | Nhập vào MeetNote ngày 18/09. | chỉ hiện khi `date` lệch `createdAt` > 1 ngày |
| DAT-02 | Đã lưu thông tin cuộc họp | toast sau khi Save |
| DAT-03 | Đã chuyển bản ghi này sang ngày 16/09 — trong danh sách nó sẽ nằm ở vị trí của ngày đó. | chỉ khi đổi sang **ngày** khác |
| DAT-04 | Ngày giờ họp | label |
| DAT-05 | Người tham dự | label |
| DAT-06 | Nhập tên rồi bấm Enter | placeholder, cố tình đặt song song với "Nhập tag rồi bấm Enter" đã có |
| DAT-07 | Mới nhập | badge trong All Meetings |

---

## 7. Component & CSS — tái dùng vs. làm mới

### Tái dùng nguyên trạng (không sửa CSS)

| Dùng ở đâu | Class / helper có sẵn | Nguồn |
| --- | --- | --- |
| Khung modal import | `.modal-backdrop`, `.modal`, `.modal-header`, `.modal-footer` + `App.showModal()/closeModal()` | `css/components.css:312-378`, `js/app.js:468-481` |
| Nút | `.btn .btn-primary .btn-secondary .btn-ghost .btn-icon .btn-sm .btn-lg` | `components.css:6-95` |
| Ô nhập, nhãn | `.input-group`, `.input` | `components.css:174-215` |
| Dropdown meeting type | `App._meetingTypeOptions()` (giữ nguyên danh sách 10 loại) | `js/app.js:791-797` |
| Badge trạng thái | `.badge .badge-warning .badge-success` | `components.css:236-272` |
| Card cảnh báo lỗi | pattern `card` + `--color-warning` + `--color-warning-muted` đang dùng ở `processingError` | `js/app.js:1408-1414` |
| Toast | `App.toast()`, `.toast-info/-success/-error/-warning` | `components.css:380-408` |
| Spinner | `.spinner` (đang dùng ở background indicator) | `js/app.js:245` |
| Tag chips (nếu hiện tag seed) | `.tag-chip-row`, `.tag-chip` | `components.css:996-1026` |
| Empty state trong tab khi chờ | `.empty-state` + `.spinner` | `components.css:411-442` |
| Danh sách trong popover | `.meeting-item`, `.meeting-info`, `.meeting-title`, `.meeting-meta`, `.dot` | `components.css:497-599` |

### Bắt buộc thêm mới (CSS + markup)

| Tên đề xuất | Mô tả | Ghi chú |
| --- | --- | --- |
| `.import-dropzone` | Vùng kéo thả trong modal: viền đứt, bo góc, icon ⬆, state `.is-dragover` (đổi màu viền/nền) | Không có component tương đương trong `css/` hiện tại |
| `.import-file-row` | 1 dòng file: icon · tên file · dung lượng · ô Title · ô ngày giờ · nút ✕; có `.has-error` | Có thể dựng từ `.card` nhưng cần layout grid riêng |
| `.import-app-dropzone` (overlay) | Lớp phủ toàn app khi kéo file từ Finder/Explorer vào cửa sổ | Cần `z-index` dưới `.modal-backdrop` |
| `.collapsible` / `.disclosure` | Khối thu gọn "Thông tin cuộc họp" / "Cấu hình nhận dạng giọng nói" (▸/▾) | Dùng được `<details>/<summary>` native + style tối thiểu |
| `.bg-task-popover` | Popover dưới nút background indicator | Có thể dựng từ `.card-glass` + `position:absolute` |
| `.processing-card` | Card "Đang tạo transcript cho bản ghi của bạn" ở Meeting Detail | Có thể tái dùng `.card` + `.spinner`, chỉ cần layout 2 cột |
| `.import-mode-switch` | Bộ chọn 2 chế độ (riêng / ghép): 2 ô radio lớn nằm ngang, mỗi ô có nhãn + 1 dòng mô tả hậu quả, ô đang chọn đổi viền + nền | Không dùng `.toggle` có sẵn — toggle 2 trạng thái không chỗ nào ghi được mô tả, mà mô tả mới là thứ dạy user |
| `.import-part-row` | Dòng 1 phần trong chế độ ghép: tay cầm `⠿` · số thứ tự · tên file · dòng giờ/thời lượng/dung lượng · 2 nút nghe thử · `▲▼✕` | Biến thể của `.import-file-row`, khác đủ nhiều để tách riêng |
| `.import-part-row.is-dragging` / `.is-drop-target` | Trạng thái khi kéo thả đổi thứ tự | |
| `.segment-progress` | Thanh đoạn `▰▰▱` cho tiến độ N phần | Dùng ở popover, dòng All Meetings và card chờ |
| `.transcript-part-divider` | Dải phân cách "── Phần 2 · 15:19 ──" trong tab Transcript | Đặt cạnh `.transcript-block` có sẵn |
| `.transcript-gap` | Ô có nhãn cho phần chưa có/đã bỏ transcript (D8) | Dùng nền cảnh báo nhạt, **không** giống `.transcript-block` để không bị đọc nhầm là nội dung họp |
| `.part-status-list` | Danh sách trạng thái từng phần (✓/◌/⚠) trong card chờ và card lỗi | |

Input ngày giờ: dùng `<input type="datetime-local" class="input">` — native, không cần
component lịch tự viết, và desktop browser (Chrome/Edge/Safari) đều có picker sẵn.
`[CHƯA VERIFY]` mức độ đồng nhất giao diện của `datetime-local` giữa Safari và Chrome — Dev cần
xem thực tế; nếu Safari quá lệch thì fallback 2 ô `type="date"` + `type="time"`.

Ô nhập người tham dự ở Meeting Detail (§5.9): **không cần component mới** — dùng lại nguyên
`.tag-chip-row` + `.tag-chip` + `.tag-chip-remove` + ô input đang chạy cho Tags
(`css/components.css:996-1026`, `js/app.js:1441-1447`).

### Cần backend/data bổ trợ (Tech Lead quyết cách làm)

1. `/api/stt/providers` trả thêm `maxUploadBytes` + danh sách mime/đuôi file mỗi provider
   (pre-flight §5.6). **ĐÃ CHỐT là có** (Quyết định 3) — toàn bộ §5.6 phụ thuộc vào nó.
2. Meeting lưu được `date` do user nhập, tách khỏi `createdAt`, và `participants` sửa được sau
   (§5.9). Cả hai phải làm `updatedAt` đổi theo để hint stale-summary sẵn có chạy đúng
   (`js/app.js:2031-2035`).
3. `Thử lại` tạo job mới trên audio đã lưu, không upload lại. `POST /api/import-transcription`
   hiện đã đủ (verify: `server.js:1416-1451` — dedupe theo `meetingId`; meeting đã fail thì không
   còn active job nên tạo job mới được).
4. **Mô hình dữ liệu cho bản ghi nhiều phần** — quyết định của Tech Lead, nhưng UX ở §5.4b/§5.7b
   chỉ thành lập được nếu thoả 3 điều: (a) từng phần có trạng thái riêng, (b) thử lại được **một**
   phần mà không đụng phần khác, (c) biết thời lượng thật từng phần để cộng dồn mốc thời gian.
   Xem OQ-10 — đây là điểm ràng buộc mạnh nhất mà thiết kế này đặt lên backend.
5. Ghi lại `sourceFilename`/`size` để phát hiện trùng (ERR-07). `sourceFilename` **đã có**
   (`js/app.js:3837`), thiếu `size`. **Ưu tiên thấp.**

---

## 8. Design Decisions (WHY) & đánh đổi

**WHY-1 — Vẫn giữ nhãn "Upload Recording", không đổi thành "Import from phone".**
Nguồn file không chỉ là điện thoại (máy ghi âm, file người khác gửi, Zoom recording). Đặt tên theo
1 ca sử dụng sẽ khiến ca khác tưởng không dùng được. Nội dung bên trong modal mới là nơi nói
chuyện điện thoại.
*Đánh đổi:* user đi tìm chữ "import" sẽ hơi khựng. Chấp nhận, vì chỉ có 3 nút trên Dashboard.

**WHY-2 — Chèn modal thay vì giữ file-picker-thẳng.**
Cái giá là +1 bước. Cái được: (a) `date` đúng, (b) chặn được file quá khổ **trước khi** tốn tiền
và tốn 20 phút chờ, (c) có chỗ đặt context. Trong bối cảnh "sau họp, không vội" (§1), +1 bước là
chi phí rẻ. Nếu đây là luồng *đang họp* thì tôi sẽ không đề xuất modal.
*Phương án đã cân nhắc và loại:* giữ picker thẳng rồi hiện toast "Đặt lại ngày họp?" sau khi tạo
meeting — loại vì toast biến mất, và lúc đó job đã chạy rồi, không cứu được lỗi provider/size.

**WHY-3 — Chỉ 2 field hiện mặc định, phần còn lại thu gọn.**
Dump cả form Meeting Setup vào modal sẽ làm modal cao gần bằng màn hình, và user học được bài
"import = phải điền form dài" → lần sau họ né. Progressive disclosure giữ modal ở mức nhìn phát
hiểu, mà vẫn cho người kỹ tính điền đủ.
*Đánh đổi:* người mới có thể không mở khối "Meeting details" và bỏ lỡ chất lượng summary. Bù bằng
nhãn nói rõ lợi ích ("improves the summary") và bằng hint ở Pre-meeting info lúc chờ (PRG-07).

**WHY-4 — Ngày giờ là field hạng nhất, không nằm trong khối thu gọn.**
Đây là field duy nhất mà *mặc định hiện tại chắc chắn sai*, sai **âm thầm**, ảnh hưởng cả sắp xếp
danh sách lẫn prompt tóm tắt (`js/summary.js:30`), và **không có màn hình nào sửa được**. Các
field khác chỉ "trống" — trống thì thấy ngay và sửa được ở Meeting Detail.
*Hệ quả bắt buộc — user đã duyệt (Quyết định 2):* Meeting Detail bổ sung khả năng sửa ngày giờ và
participants cho **mọi** bản ghi, ngay trong card "Pre-meeting info" đã có, không phát sinh màn
hình mới. Thiết kế chi tiết ở §5.9.

**WHY-5 — Context áp chung khi nhiều file, chỉ Title/Ngày giờ riêng.**
Xem §4 Screen 4. Đây là đánh đổi có ý thức: sai chút context còn hơn user bỏ trắng toàn bộ.
Mọi thứ đều sửa lại được ở Meeting Detail sau.

**WHY-6 — Không có progress %, chỉ có phase + thời gian đã trôi.**
Job API không có progress thật. Progress giả là loại UI gây mất niềm tin nặng nhất khi chờ lâu
(user nhìn thanh đứng im 15 phút sẽ kết luận app treo và tắt đi — mà tắt app thì job **thật sự**
hỏng, theo `js/storage.js:114-117`). "Đã 4 phút" luôn đúng và luôn nhúc nhích.

**WHY-7 — Nói thẳng "đóng tab được, đừng thoát app".**
Đây là mô hình hệ thống thật (job ở server, server chết thì job fail) và user không thể tự đoán
ra. Với file 2 tiếng, hiểu sai chỗ này = mất công chờ + mất tiền provider. Câu này xuất hiện ở
2 nơi: card chờ ở Meeting Detail và chân popover.

**WHY-8 — Nút "Thử lại" phải nhấn mạnh "không phải tải lên lại".**
Người dùng vừa chờ 20 phút rồi fail sẽ sợ phải làm lại từ đầu. Một câu (FAI-04) đổi được quyết
định "bỏ luôn" thành "thử lại".

**WHY-9 — Đổi provider trong modal không ghi đè Settings.**
Import 1 file lớn không nên âm thầm đổi cấu hình cho toàn bộ ghi âm trực tiếp sau này. Nguyên tắc
chung: thay đổi phạm vi hẹp thì không được rò rỉ ra phạm vi rộng. Bắt buộc có dòng IMP-16 nói rõ.

**WHY-10 — Nhắc chất lượng âm thanh có điều kiện, không nhắc mặc định.**
Xem §5.8. Cảnh báo mặc định cho mọi lần import sẽ bị mù thị giác (banner blindness) sau 3 lần.

**WHY-11 — Chọn chế độ bằng 2 ô radio có mô tả hậu quả, không bằng toggle/checkbox.**
Ba lý do: (a) checkbox "Ghép thành 1 cuộc họp" chỉ mô tả *thao tác*, còn 2 ô radio đặt cạnh nhau
buộc user **so sánh 2 kết quả** ("3 cuộc họp riêng" vs "1 cuộc họp gồm 3 phần") — người ta chọn
đúng hơn khi nhìn thấy cả hai đầu ra; (b) mỗi ô có chỗ cho 1 dòng mô tả, checkbox thì không;
(c) đổi chế độ làm **danh sách file vẽ lại ngay** (3 ô tên thu còn 1, các dòng được đánh số
"Phần 1/2/3") — user thấy hậu quả bằng mắt trong vòng nửa giây, không cần đọc chữ nào. Đây mới là
thứ thay thế được tài liệu hướng dẫn.
*Đánh đổi:* bộ chọn chiếm thêm ~70px chiều cao modal. Chỉ hiện khi có ≥ 2 file nên luồng 1 file
(phổ biến nhất) không phải trả giá này.

**WHY-12 — Mặc định là "nhiều cuộc họp riêng", và gợi ý ghép thì không tự bấm hộ.**
Hai loại sai không đối xứng nhau: ghép nhầm 2 buổi họp khác nhau → ra **một** transcript trộn lẫn
nội dung, tóm tắt sai một cách khó phát hiện, và không tách ra được nếu không nhập lại (mất tiền
STT lần nữa). Không ghép trong khi đáng lẽ phải ghép → ra 3 bản ghi rời, đọc vẫn hiểu, ghép lại
được bằng cách nhập lại. Sai theo hướng ít thiệt hại hơn thì để làm mặc định.
Gợi ý tự động (MRG-20) chỉ **đề nghị**, vì heuristic "file liên tiếp nhau" có thể trúng nhầm:
2 cuộc họp back-to-back trong cùng buổi chiều trông y hệt 1 cuộc họp bị cắt khúc. Máy không phân
biệt được, chỉ con người biết.

**WHY-13 — Nghe thử 10 giây là công cụ kiểm chứng chính, không phải trang trí.**
Tất cả tín hiệu khác (thứ tự, giờ, khoảng cách) đều là **suy luận từ metadata** — mà metadata là
thứ hay sai nhất trong luồng này (`lastModified` có thể bị reset khi truyền qua Zalo/Drive). Chỉ
có nội dung âm thanh là không nói dối. Nghe 10 giây cuối phần 1 rồi 10 giây đầu phần 2 là thao tác
mất 20 giây để tránh một sai lầm tốn tiền và không hoàn tác được. Và nó chạy hoàn toàn cục bộ:
không gọi server, không tốn phí, không cần transcribe.
*Đánh đổi:* thêm nút vào một modal vốn đã muốn tối giản. Chấp nhận vì D7 — quyết định không đảo
ngược được thì phải kiểm chứng được.

**WHY-14 — Chặn Generate Summary khi chưa đủ phần (chỗ duy nhất thiết kế này chặn user).**
Bình thường tôi chọn "cảnh báo, không chặn". Ở đây thì không, vì hội đủ cả 4 điều kiện xấu nhất:
kết quả sai **trông như đúng** (một bản tóm tắt hoàn chỉnh, chỉ thiếu 1/3 nội dung), tốn tiền LLM,
ghi đè lên summary cũ, và phần thiếu thì **sắp có** chỉ sau vài phút nữa. Chờ là lựa chọn đúng gần
như 100% trường hợp. Sau khi user chủ động "Bỏ phần 2" — tức là đã biết và đã chấp nhận thiếu —
thì mở khoá, vì lúc đó đủ điều kiện "user biết mình đang làm gì".

**WHY-15 — Thử lại từng phần, không thử lại cả cụm.**
Chạy lại 3 phần cho 1 phần hỏng = trả tiền STT gấp 3 cho cùng kết quả, và ghi đè lên 2 transcript
đã tốt (kèm mọi chỉnh sửa tay user đã làm trên đó trong lúc chờ — xem §5.4b cho phép sửa transcript
phần đã xong). Ràng buộc này là lý do §7 mục 4 đòi mô hình "mỗi phần một job".

**WHY-16 — Người tham dự dùng chip ở Meeting Detail nhưng vẫn giữ ô-phẩy ở Meeting Setup.**
Không phải bất nhất — hai thao tác khác nhau. Meeting Setup = **nhập mới cả danh sách khi đang
vội** → gõ một mạch "Alice, Bob, Charlie" là nhanh nhất. Meeting Detail = **sửa một phần tử trong
danh sách đã có, lúc rảnh** → chip cho phép bỏ đúng 1 người bằng 1 click, không phải dò trong chuỗi
văn bản và không rủi ro làm hỏng tên người khác. Chọn pattern theo thao tác chính của từng bối
cảnh, đúng tinh thần §1.

---

## 9. Non-goals (nằm ngoài thiết kế này)

- LAN / QR pairing / watch folder — user đã chốt loại bỏ.
- ~~Gộp nhiều file thành 1 meeting~~ → **đã đưa vào scope** (Quyết định 4, §5.4b).
- **Chia nhóm trong cùng một lần import** (3 file là 1 buổi, 2 file còn lại là 2 buổi khác) —
  hoãn sang sau v1, lý do đầy đủ ở §4b.5. Đường vòng: import 2 lần.
- Cắt/chia file lớn tự động để lách giới hạn Whisper/Google.
- Chuyển đổi định dạng (`.opus`, `.3gp`) trong app — cần ffmpeg, thuộc quyết định của Tech Lead.
- Tự động generate summary sau khi transcript xong.
- Bản mobile của MeetNote.

---

## 10. Open Questions

### 10.1 Đã chốt (rev 2)

| ID | Quyết định |
| --- | --- |
| ~~OQ-1~~ | **Tiếng Việt** cho toàn bộ text mới của luồng import. Không đụng text tiếng Anh cũ ở màn hình khác. Vùng giáp ranh xử lý theo bảng ở §0. §6 là bản chính thức. |
| ~~OQ-3~~ | Sửa `date` + `participants` ở Meeting Detail **trong scope**, áp dụng cho **mọi** bản ghi. Thiết kế ở §5.9. |
| ~~OQ-backend~~ | `/api/stt/providers` sẽ trả `maxUploadBytes` + danh sách mime → pre-flight vào scope. UI chốt ở §5.6. |
| **(mới)** | Luồng import hỗ trợ **2 chế độ**: nhiều file → nhiều bản ghi (mặc định), và nhiều file → 1 bản ghi ghép. Thiết kế ở §4.2 (chọn chế độ), §5.4b (modal ghép), §5.2 + §5.4b (trạng thái chờ N phần), §5.7b (một phần lỗi). |

### 10.2 Còn treo

| ID | Câu hỏi | Vì sao cần chốt | Đề xuất của tôi |
| --- | --- | --- | --- |
| **OQ-2** | Có mở rộng danh sách định dạng nhận thêm `.opus` / `.3gp` không? | Đây là 2 định dạng phổ biến nhất từ Android/app chat và đang bị chặn ở client (`js/app.js:3819`). Có khả năng Soniox/Deepgram xử lý được. | Cần verify thật với từng provider (Protocol 5) trước khi hứa trên UI. Chưa verify thì UI chỉ nói "chưa hỗ trợ", **không** gợi ý mẹo đổi đuôi file. |
| **OQ-4** | Khi user bấm "Mở Cài đặt" từ trong modal thì file đang chọn có được giữ lại không? | Trình duyệt không cho giữ `File` object qua điều hướng một cách đơn giản. Ở chế độ ghép thì mất mát lớn hơn — mất cả thứ tự user vừa sắp. | v1: đóng modal, mất lựa chọn file, cảnh báo trước bằng ERR-06b. Chấp nhận được vì hiếm. Tech Lead xác nhận khả thi. |
| **OQ-5** | Ngưỡng nào coi là "transcript ngắn bất thường" để hiện QLT-01/QLT-02? | Đặt sai ngưỡng sẽ hoặc spam cảnh báo, hoặc không bao giờ hiện. | Gợi ý khởi điểm: `< 200 từ` với audio `> 30 phút`, tính **theo từng phần**. Nhờ BA/Domain Expert chốt số. |
| **OQ-6** | Có hiển thị **ước tính chi phí** trước khi bấm Start không? | Đây là nút tiêu tiền lớn nhất trong app, và chế độ ghép còn nhân số phần lên. App hiện chỉ có đơn giá **realtime** của Soniox (`SONIOX_REALTIME_USD_PER_HOUR`), chưa chắc áp được cho async/file. | Chỉ hiện nếu có đơn giá đã verify cho từng provider. Chưa có thì **không hiện** — con số sai về tiền tệ hại hơn không có số. |
| **OQ-7** | Bấm nút background indicator: mở popover (đề xuất) hay giữ nguyên hành vi nhảy sang All Meetings? | Thay đổi hành vi của một nút đang tồn tại. | Popover — vì nó trả lời được "bản ghi nào, mấy phần xong, bao lâu rồi", còn All Meetings thì không. |
| **OQ-8** | Ba ngưỡng số của chế độ ghép: (a) khoảng cách tối đa giữa 2 phần để coi là "liên tiếp" và gợi ý ghép; (b) khoảng cách bao nhiêu thì cảnh báo "có thể là 2 buổi khác nhau"; (c) số phần tối đa cho 1 bản ghi. | Gợi ý sai quá nhiều lần thì user tắt não với mọi gợi ý sau đó. | Khởi điểm: (a) 0–15 phút; (b) > 60 phút; (c) 10 phần. Nhờ BA chốt. |
| **OQ-9** | Ngưỡng "lệch quá 1 ngày" để hiện DAT-01 và badge "Mới nhập" có hợp lý không? | Quá nhạy thì bản ghi trực tiếp lúc nửa đêm cũng bị gắn nhãn. | Giữ 1 ngày. BA xác nhận. |
| **OQ-10** | **Cho Tech Lead:** bản ghi nhiều phần làm theo mô hình nào — N job transcribe rồi ghép transcript, hay ghép audio trước rồi 1 job? | Quyết định này chặn phần lớn UX ở §5.4b/§5.7b. Mô hình "ghép audio trước, 1 job" **không** đỡ được: tiến độ "2/3 phần", thử lại 1 phần, đánh dấu phần nào lỗi — tức là mất cả 3 thứ đắt giá nhất của thiết kế này. Nó còn đẩy tổng dung lượng lên quá hạn mức provider (3 × 50 MB = 150 MB > 25 MB của Whisper) trong khi từng phần thì lọt. | **N job, mỗi phần một job**, ghép transcript sau kèm cộng dồn mốc thời gian. Nếu Tech Lead có lý do kỹ thuật buộc phải làm cách kia, báo lại — tôi phải thiết kế lại §5.2, §5.4b và §5.7b, không vá được. |
| **OQ-11** | Bản ghi đã bỏ bớt phần (FAI-07) thì tính là `completed` hay cần trạng thái riêng? | Ảnh hưởng badge, bộ lọc trong All Meetings, và nội dung file export. | `completed` + cờ "thiếu nội dung" hiện thành dòng cảnh báo (PRG-14) và dấu vết trong transcript/export (FAI-10). Không đẻ thêm trạng thái mới trong danh sách. BA chốt. |

---

## 11. Checklist bàn giao cho BA/Tech Lead

- [ ] **Chốt OQ-10 trước mọi thứ khác** — mô hình N-job quyết định được/không được phần lớn UX
      của chế độ ghép. Đây là việc cần làm sớm nhất.
- [ ] BA viết Business Rules cho: mặc định `date` từ `lastModified`; phạm vi áp dụng của provider
      override (chỉ 1 lần import); quy tắc mặc định "mỗi file 1 bản ghi"; quy tắc sắp thứ tự phần
      và fallback khi mất `lastModified`; điều kiện hiện QLT-01/QLT-02; hành vi `Thử lại` cấp phần
      và cấp bản ghi; hệ quả của "Bỏ phần N" (OQ-11); ngưỡng ở OQ-8 và OQ-9.
- [ ] Tech Lead xác nhận: `maxUploadBytes` + mime trong `/api/stt/providers`; mô hình nhiều phần
      (OQ-10); `datetime-local` trên Safari; `Thử lại` tái dùng audio đã lưu không tải lên lại;
      thời lượng thật từng phần có sẵn để cộng dồn mốc thời gian.
- [ ] Dev test sớm 2 thứ dễ vỡ, **trước khi** dựng giao diện quanh chúng:
      (a) `file.lastModified` sống sót qua AirDrop / cáp / Zalo / Drive tới đâu;
      (b) trình duyệt đọc được thời lượng và phát được thử 10 giây với những định dạng nào trong
      danh sách app nhận (nghi ngờ `amr`, `asf`). Cả hai đang là `[CHƯA VERIFY]`.
- [ ] Protocol 6 — 3 điểm nối dữ liệu phải trace bằng tay, đều thuộc loại "chạy xong, báo thành
      công, kết quả rỗng/sai mà không ai biết":
      1. `date`/`meetingType`/`topic`/`leadBy`/`participants` nhập ở modal → `Storage.saveMeeting()`
         → payload của `js/summary.js:_payload()`. Bản ghi tạo được, transcript có, mà summary vẫn
         không thấy context = đúng loại lỗi im lặng Protocol 6 mô tả.
      2. **Thứ tự phần** user sắp trong modal → thứ tự job → thứ tự ghép transcript cuối cùng.
         Sắp đúng trên màn hình mà ghép sai thứ tự ở bước cuối thì không test nào bắt được nếu chỉ
         assert "đã gọi đủ 3 lần".
      3. **Thời lượng từng phần** → mốc thời gian cộng dồn của phần sau. Sai chỗ này thì transcript
         vẫn ra, đọc vẫn xuôi, chỉ có mọi mốc thời gian là vô nghĩa.
- [ ] QA chạy xuyên suốt **ít nhất 1 lần với 3 file thật của cùng một buổi họp bị cắt khúc**, và
      kiểm tra **nội dung** transcript ở chỗ nối giữa phần 1-2 và 2-3 (Protocol 6 mục 3) — không
      chỉ nhìn `status: completed`.

---

## 12. Rev 2 đã đổi những gì

| Mục | Rev 1 | Rev 2 |
| --- | --- | --- |
| Ngôn ngữ | Bảng microcopy 2 cột EN/VI, chờ chốt | **Tiếng Việt**, §6 là bản chính thức; thêm bảng xử lý vùng giáp ranh ở §0 |
| Sửa ngày giờ / người tham dự | Chỉ nêu là "hệ quả bắt buộc", để ngỏ ở OQ-3 | Vào scope, thiết kế đầy đủ ở §5.9 (kể cả badge "Mới nhập" và toast DAT-03 cho chuyện bản ghi nhảy vị trí trong danh sách) |
| Pre-flight | Mô tả ngắn trong 1 bảng, phụ thuộc field backend chưa có | §5.6 đầy đủ: 3 loại tình huống, 3 biến thể của "đề nghị đổi provider", quy tắc hiển thị inline, ca 5 file / 2 hợp lệ |
| Nhiều file | Chỉ 1 chế độ: mỗi file 1 bản ghi | **2 chế độ** + bộ chọn + gợi ý tự động + toàn bộ thiết kế sắp thứ tự, nghe thử, tiến độ N phần, lỗi từng phần |
| Non-goals | "Gộp nhiều file" nằm trong non-goals | Chuyển vào scope; thay bằng "chia nhóm trong cùng 1 lần import" (hoãn, có lý do) |
| Nguyên tắc | D1–D6 | Thêm **D7** (quyết định không đảo ngược phải kiểm chứng được) và **D8** (thiếu dữ liệu phải nhìn thấy được) |
| WHY | WHY-1…WHY-10 | Thêm WHY-11…WHY-16 |
| Open Questions | 7 câu, tất cả đang treo | 3 đã chốt; còn 5 cũ + 4 mới (OQ-8…OQ-11) |

### Ba rủi ro UX cao nhất của rev 2 (theo thứ tự)

1. **Ghép sai thứ tự mà không ai phát hiện cho tới khi đọc transcript.** Hậu quả: transcript lộn
   xộn, tóm tắt sai, tiền STT đã trả. Thiết kế chống bằng 4 lớp (§4b.2) nhưng lớp mạnh nhất —
   nghe thử 10 giây — lại **phụ thuộc vào việc trình duyệt phát được định dạng đó**, hiện đang
   `[CHƯA VERIFY]` với `amr`/`asf`. Nếu không phát được, chế độ ghép chỉ còn tín hiệu metadata,
   mà metadata chính là thứ hay sai nhất trong luồng này. **Đây là việc Dev nên đo trước tiên.**
2. **Modal phình to thành form khai báo.** Rev 2 thêm bộ chọn chế độ, danh sách phần, nút nghe
   thử, dòng cảnh báo pre-flight — nguy cơ trực tiếp cho D1/D2. Đã giữ bằng cách: bộ chọn chế độ
   chỉ hiện khi ≥ 2 file, danh sách phần chỉ hiện ở chế độ ghép, context vẫn thu gọn mặc định,
   luồng 1 file (phổ biến nhất) **không đổi gì** so với rev 1. Cần kiểm lại bằng mắt khi có bản
   chạy thật: nếu modal chế độ ghép phải cuộn trên màn hình laptop 13", phải cắt bớt.
3. **Bản ghi thiếu phần bị hiểu nhầm là đầy đủ.** Nếu Dev cài đặt "nối phần 1 với phần 3 cho gọn"
   thì toàn bộ D8 sụp, và đây là lỗi **không thể phát hiện bằng mắt** khi đọc transcript. Đã chống
   bằng ô `.transcript-gap` có nhãn, mốc thời gian vẫn cộng dồn như thể phần thiếu tồn tại, và dấu
   vết FAI-10 đi vào cả file export. Reviewer cần kiểm đúng 3 điểm này.
