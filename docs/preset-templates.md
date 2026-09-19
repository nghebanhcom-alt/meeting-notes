# PRESET TÓM TẮT CUỘC HỌP TỪ TRANSCRIPT

Bộ 10 preset cho công cụ tóm tắt cuộc họp bằng AI. Ngôn ngữ output: **tiếng Việt**.

## Cách setup

Mỗi preset trong file này gồm 4 phần, map thẳng vào giao diện:

| Phần trong file | Ô trên giao diện |
|---|---|
| Tên preset | Tên preset |
| Mô tả | Mô tả (tùy chọn) |
| Hướng dẫn cho AI | Hướng dẫn cho AI (tùy chọn) |
| Bảng Các mục | Các mục (section) — Tên mục / Kiểu / Gợi ý cho AI |

**Quan trọng (đã đổi so với bản nháp đầu):** **BLOCK DÙNG CHUNG** bên dưới **không** còn được dán thủ công vào từng preset nữa — nó đã trở thành nguyên tắc mặc định của hệ thống, áp dụng cứng trong prompt tóm tắt cho **mọi** preset (xem PRD `docs/PRD.md` BR-61, Architecture `docs/Architecture.md`). Ô "Hướng dẫn cho AI" (`instruction`) lưu xuống cho mỗi preset trong file này **chỉ** gồm đúng nội dung "Hướng dẫn cho AI" ghi dưới từng preset (block riêng) — không nối thêm BLOCK DÙNG CHUNG vào nữa, tránh lặp 2 lần trong prompt thật (1 lần từ system default, 1 lần từ `instruction` của preset).

BLOCK DÙNG CHUNG vẫn giữ trong file này chỉ để làm **nguồn xác thực nội dung** cho Tech Lead/Dev khi implement phần system default đó — không phải nội dung cần nhập vào form tạo preset.

Cột "Kiểu" chỉ có 3 giá trị, khớp với dropdown: `Đoạn văn` / `Danh sách` / `Việc cần làm`.

---

## MỤC LỤC

| # | Preset | Dùng khi |
|---|---|---|
| 0 | [BLOCK DÙNG CHUNG](#block-dùng-chung) | Nguồn xác thực cho system default (BR-61) — **không** dán vào từng preset |
| 1 | [General Meeting](#1-general-meeting) | Mẫu chung, không rõ loại họp |
| 2 | [Họp giao ban](#2-họp-giao-ban) | Giao ban định kỳ liên bộ phận |
| 3 | [Họp phòng kinh doanh](#3-họp-phòng-kinh-doanh) | Nội bộ sales |
| 4 | [Họp phòng marketing](#4-họp-phòng-marketing) | Nội bộ marketing |
| 5 | [Brainstorming](#5-brainstorming) | Buổi nghĩ ý tưởng |
| 6 | [Họp HĐQT](#6-họp-hđqt) | Hội đồng quản trị |
| 7 | [Sales call](#7-sales-call) | Gọi/gặp khách hàng |
| 8 | [Training](#8-training) | Đào tạo, hướng dẫn |
| 9 | [R&D sản phẩm](#9-rd-sản-phẩm) | Nghiên cứu phát triển |
| 10 | [OKR — xây dựng & check-in](#10-okr--xây-dựng--check-in) | Đặt mục tiêu và rà soát tiến độ |

---

## BLOCK DÙNG CHUNG

*Đã trở thành nguyên tắc mặc định của hệ thống (BR-61) — áp dụng cứng cho mọi preset ở tầng prompt, **không** còn dán vào ô "Hướng dẫn cho AI" của từng preset. Giữ nguyên văn ở đây làm nguồn xác thực khi implement.*

```
Viết toàn bộ bản tóm tắt bằng tiếng Việt. Giữ nguyên thuật ngữ tiếng Anh mà người nói dùng (KPI, pipeline, SKU, brief, deadline...), không dịch sang tiếng Việt.

NGUYÊN TẮC BẮT BUỘC:
- Chỉ ghi những gì thực sự có trong transcript. Tuyệt đối không suy diễn, không bổ sung kiến thức bên ngoài, không "làm cho đầy đủ" những phần cuộc họp bàn dở.
- Số liệu, ngày tháng, tên sản phẩm, tên khách hàng: chép chính xác như người nói. Không làm tròn, không quy đổi đơn vị.
- Nếu một con số hoặc tên riêng nghe không rõ trong transcript, ghi kèm dấu [?] ngay sau nó thay vì đoán.
- Transcript là bản ghi tự động nên có lỗi nhận dạng. Được phép sửa lỗi chính tả và thuật ngữ khi ngữ cảnh đã rõ ràng; không được phép sửa nội dung hay ý nghĩa.
- Gắn tên người vào từng ý kiến, quyết định và việc cần làm. Nếu transcript chỉ có nhãn "Speaker 1", "Người nói 2"... thì suy ra tên từ cách những người khác xưng hô; nếu vẫn không xác định được thì ghi [chưa rõ người nói].
- Phân biệt rạch ròi ba trạng thái: ĐÃ CHỐT (có người ra quyết định cuối), ĐANG BÀN (nêu ra nhưng chưa kết luận), và Ý KIẾN CÁ NHÂN (một người đề xuất, chưa ai đồng ý). Không được biến "đang bàn" thành "đã chốt".
- Bỏ qua chào hỏi, nói chuyện ngoài lề, trùng lặp và những đoạn nói lại cùng một ý.
- Mọi việc cần làm phải có đủ: làm gì — ai làm — hạn chót. Thiếu người phụ trách ghi [chưa phân công]; thiếu hạn chót ghi [chưa có hạn].
- Nếu một mục không có nội dung nào trong cuộc họp, ghi "Không có" thay vì tự nghĩ ra nội dung.
- Viết ngắn gọn, mỗi gạch đầu dòng là một ý hoàn chỉnh, không dùng từ hoa mỹ.
```

---

## 1. GENERAL MEETING

**Tên preset:** `General Meeting`

**Mô tả:** Mẫu tóm tắt tổng quát, dùng được cho mọi cuộc họp khi chưa có preset chuyên biệt.

**Hướng dẫn cho AI** *(nối sau block chung)*

```
Đây là preset dùng chung cho mọi loại cuộc họp. Không biết trước cuộc họp thuộc dạng nào, nên phải tự nhận diện từ nội dung transcript rồi điều chỉnh trọng tâm cho phù hợp.

Ở đầu bản tóm tắt, tự xác định: cuộc họp này thuộc dạng gì (ra quyết định / cập nhật thông tin / giải quyết vấn đề / lên ý tưởng / đào tạo) và ai là người chủ trì. Nếu không xác định được thì bỏ qua, đừng đoán.

Điều chỉnh trọng tâm theo dạng họp nhận diện được:
- Họp ra quyết định: dồn trọng tâm vào phần quyết định và căn cứ dẫn tới quyết định đó.
- Họp cập nhật: dồn trọng tâm vào tiến độ, số liệu và vấn đề phát sinh.
- Họp giải quyết vấn đề: ghi rõ vấn đề, các phương án đã cân nhắc, phương án được chọn và lý do.
- Họp lên ý tưởng: giữ trọn vẹn các ý tưởng thay vì cô đọng lại.
- Họp đào tạo: giữ chi tiết các bước và thông số kỹ thuật.

Sắp xếp nội dung theo THỨ TỰ TẦM QUAN TRỌNG, không theo thứ tự thời gian của cuộc họp. Điều quan trọng nhất phải nằm ở trên cùng.

Ưu tiên giữ lại: quyết định, con số, cam kết, thời hạn, tên người phụ trách. Ưu tiên lược bỏ: trao đổi qua lại, ví dụ minh họa dài dòng, những đoạn nói lại cùng một ý.

Nếu cuộc họp bàn nhiều chủ đề rời rạc, nhóm nội dung theo chủ đề và đặt tiêu đề ngắn cho từng nhóm.
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Tổng quan | Đoạn văn | 3-5 câu: cuộc họp bàn gì, ai chủ trì, kết quả quan trọng nhất là gì. Nếu cuộc họp không đi tới kết luận nào, nói thẳng điều đó. |
| Nội dung chính | Danh sách | Nhóm theo chủ đề nếu cuộc họp bàn nhiều việc. Mỗi dòng một ý hoàn chỉnh, kèm tên người nêu ý đó. Sắp xếp theo mức độ quan trọng. |
| Số liệu & thông tin quan trọng | Danh sách | Mọi con số, ngày tháng, tên riêng, thông số được nêu. Chép chính xác. Ghi "Không có" nếu cuộc họp không nhắc tới số liệu nào. |
| Quyết định đã chốt | Danh sách | Nội dung chốt — ai chốt — căn cứ dẫn tới quyết định. Chỉ ghi những gì đã kết luận dứt khoát. |
| Vấn đề & rủi ro | Danh sách | Vấn đề được nêu trong họp, kèm ai nêu và hướng xử lý nếu đã bàn tới. |
| Việc cần làm | Việc cần làm | Việc gì — ai làm — hạn chót. Mỗi dòng một việc. |
| Chưa chốt / cần bàn tiếp | Danh sách | Vấn đề đã nêu nhưng chưa có kết luận, kèm lý do chưa chốt được. |

---

## 2. HỌP GIAO BAN

**Tên preset:** `Họp giao ban`

**Mô tả:** Tóm tắt họp giao ban định kỳ — tiến độ từng bộ phận, vướng mắc và phân công tuần tới.

**Hướng dẫn cho AI**

```
Đây là họp giao ban định kỳ giữa các bộ phận. Mục đích của bản tóm tắt là để người vắng mặt nắm được tình hình trong 2 phút, và để người phụ trách biết mình phải làm gì tiếp theo.

Tổ chức phần tiến độ theo TỪNG BỘ PHẬN hoặc từng người, không gộp chung thành một danh sách hỗn hợp.
Với mỗi vướng mắc, ghi rõ nó đang chặn việc gì và ai là người có thể tháo gỡ.
Nếu một việc đã được nhắc ở kỳ giao ban trước mà vẫn chưa xong, đánh dấu "tồn đọng".
Ưu tiên nội dung có tác động đến vận hành hoặc doanh thu; những trao đổi mang tính thông báo nhẹ thì gộp lại thành một dòng.
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Tổng quan | Đoạn văn | Tóm tắt 3-5 câu: cuộc họp bàn những gì, tình hình chung đang tốt hay đang có vấn đề, điều gì cần chú ý nhất. |
| Tiến độ theo bộ phận | Danh sách | Nhóm theo từng bộ phận hoặc từng người. Mỗi dòng: việc đã hoàn thành và việc đang làm dở, kèm % hoặc mốc cụ thể nếu người nói có đề cập. |
| Vướng mắc & rủi ro | Danh sách | Vấn đề đang chặn tiến độ. Ghi rõ đang chặn việc gì, nguyên nhân, và ai cần xử lý. Đánh dấu "tồn đọng" nếu là vấn đề cũ lặp lại. |
| Quyết định đã chốt | Danh sách | Chỉ ghi những gì có người ra quyết định dứt khoát. Mỗi dòng: nội dung chốt — ai chốt. |
| Việc cần làm | Việc cần làm | Việc gì — ai làm — hạn chót. Mỗi dòng một việc, không gộp nhiều việc vào một dòng. |
| Chưa chốt / kỳ sau bàn tiếp | Danh sách | Vấn đề đã nêu nhưng chưa có kết luận, kèm lý do vì sao chưa chốt được. |

---

## 3. HỌP PHÒNG KINH DOANH

**Tên preset:** `Họp phòng kinh doanh`

**Mô tả:** Tóm tắt họp kinh doanh — số liệu, tình hình khách hàng, deal đang chạy và hành động bán hàng.

**Hướng dẫn cho AI**

```
Đây là họp nội bộ phòng kinh doanh. Người đọc bản tóm tắt cần biết: đang đạt bao nhiêu so với chỉ tiêu, deal nào đáng chú ý, và tuần tới phải đẩy cái gì.

Số liệu là phần quan trọng nhất — chép chính xác mọi con số về doanh số, sản lượng, chỉ tiêu, tỉ lệ chốt, công nợ. Khi người nói so sánh (so với tháng trước, so với kế hoạch), giữ nguyên cả hai vế của phép so sánh.
Với mỗi khách hàng hoặc deal được nhắc tên, ghi trạng thái hiện tại và bước tiếp theo.
Phân biệt rõ khách hàng mới, khách hàng đang chăm, và khách hàng đang có vấn đề (giảm đơn, khiếu nại, nợ quá hạn).
Nếu có trao đổi về giá, chiết khấu hoặc chính sách bán hàng, tách riêng thành một quyết định — đây là loại thông tin dễ bị hiểu sai nhất sau cuộc họp.
Không tự đánh giá hiệu suất của nhân viên nếu trong họp không ai nhận xét.
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Tổng quan | Đoạn văn | 3-5 câu: kỳ này đạt hay không đạt, nguyên nhân chính, trọng tâm sắp tới. |
| Số liệu & chỉ tiêu | Danh sách | Mọi con số được nêu: doanh số, sản lượng, % hoàn thành chỉ tiêu, công nợ. Giữ nguyên mốc so sánh người nói dùng. |
| Khách hàng & deal | Danh sách | Mỗi khách hàng/deal một dòng: tên — trạng thái hiện tại — giá trị (nếu có) — bước tiếp theo. |
| Vấn đề cản trở doanh số | Danh sách | Lý do khiến deal chậm hoặc mất: giá, hàng hóa, đối thủ, năng lực đội ngũ. Ghi kèm ai nêu vấn đề đó. |
| Chính sách giá & quyết định | Danh sách | Mọi thay đổi về giá, chiết khấu, điều khoản thanh toán, chính sách bán hàng đã được chốt. Ghi rõ áp dụng cho ai, từ khi nào. |
| Việc cần làm | Việc cần làm | Việc gì — ai làm — hạn chót. Ưu tiên việc gắn với khách hàng cụ thể lên trước. |

---

## 4. HỌP PHÒNG MARKETING

**Tên preset:** `Họp phòng marketing`

**Mô tả:** Tóm tắt họp marketing — hiệu quả chiến dịch, kế hoạch nội dung, ngân sách và phân công.

**Hướng dẫn cho AI**

```
Đây là họp nội bộ phòng marketing. Bản tóm tắt phải trả lời được: cái gì đang chạy hiệu quả, cái gì không, và sắp tới làm gì.

Với mỗi chiến dịch hoặc kênh được nhắc tới, ghi rõ tên chiến dịch, kênh, và số liệu đi kèm (reach, engagement, chi phí, lượt đăng ký, đơn hàng). Chép chính xác, không làm tròn.
Phân biệt rõ ba loại nội dung: KẾT QUẢ đã có, GIẢ THUYẾT về nguyên nhân, và KẾ HOẠCH sắp làm. Không được trình bày giả thuyết như thể là kết luận đã xác nhận.
Với phần kế hoạch nội dung, ghi cụ thể: định dạng, kênh đăng, thông điệp chính, thời gian dự kiến.
Mọi trao đổi về ngân sách phải tách riêng, kèm con số và ai là người duyệt.
Nếu có nhận xét về thiết kế, hình ảnh hoặc nội dung cụ thể, ghi lại yêu cầu chỉnh sửa dưới dạng việc cần làm, đừng để lẫn vào phần thảo luận chung.
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Tổng quan | Đoạn văn | 3-5 câu: tình hình marketing kỳ này, điểm sáng và điểm yếu, hướng đi sắp tới. |
| Kết quả chiến dịch & kênh | Danh sách | Mỗi chiến dịch/kênh một dòng: tên — số liệu thực tế — đánh giá của người trong họp (không phải đánh giá của bạn). |
| Nhận định & giả thuyết | Danh sách | Lý giải vì sao số liệu tăng/giảm, theo lời người trong họp. Ghi rõ đây là giả thuyết chưa kiểm chứng nếu chưa ai xác nhận. |
| Kế hoạch nội dung & chiến dịch | Danh sách | Mỗi hạng mục: nội dung gì — định dạng — kênh — thời gian dự kiến — ai phụ trách. |
| Ngân sách & nguồn lực | Danh sách | Con số ngân sách, phân bổ, đề xuất tăng/giảm, ai duyệt. Ghi "Không có" nếu cuộc họp không bàn tới. |
| Quyết định đã chốt | Danh sách | Nội dung chốt — ai chốt. Chỉ ghi những gì đã kết luận dứt khoát. |
| Việc cần làm | Việc cần làm | Việc gì — ai làm — hạn chót. Gộp cả yêu cầu chỉnh sửa design/content vào đây. |

---

## 5. BRAINSTORMING

**Tên preset:** `Brainstorming`

**Mô tả:** Tóm tắt buổi brainstorm — giữ trọn vẹn mọi ý tưởng, kể cả ý tưởng bị bác.

**Hướng dẫn cho AI**

```
Đây là buổi brainstorm. Nguyên tắc tóm tắt khác hẳn các cuộc họp khác: mục tiêu là BẢO TOÀN Ý TƯỞNG, không phải cô đọng nội dung.

Ghi lại TOÀN BỘ ý tưởng được nêu ra, kể cả ý tưởng bị bác bỏ ngay, ý tưởng nói đùa, hoặc ý tưởng nghe có vẻ không khả thi. Ý tưởng bị loại hôm nay thường là nguyên liệu cho ý tưởng đúng vào lần sau.
KHÔNG gộp hai ý tưởng gần giống nhau thành một. Sự khác biệt nhỏ giữa chúng chính là phần có giá trị.
KHÔNG tự sắp xếp lại ý tưởng theo logic của bạn, và KHÔNG tự bổ sung ý tưởng mà không ai nói ra.
Luôn ghi tên người đề xuất cạnh mỗi ý tưởng.
Giữ nguyên cách diễn đạt gốc nếu người nói dùng một hình ảnh, ví von hoặc cách gọi đặc trưng — đừng viết lại cho "chuẩn" hơn.
Tách riêng phần phản biện: ý tưởng nào bị phản đối, ai phản đối, lý do gì.
Cuối cùng chỉ đánh dấu ưu tiên nếu trong họp có người thực sự chọn. Nếu không ai chọn, ghi "Chưa chốt ưu tiên".
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Bài toán cần giải | Đoạn văn | 2-4 câu nêu đúng vấn đề hoặc câu hỏi mà buổi brainstorm muốn giải quyết, theo cách người chủ trì đặt ra. |
| Toàn bộ ý tưởng | Danh sách | Liệt kê mọi ý tưởng, mỗi ý một dòng, kèm tên người đề xuất. Không lọc, không gộp, không sắp xếp lại. Giữ nguyên cách diễn đạt gốc. |
| Ý tưởng được ưu tiên | Danh sách | Chỉ những ý tưởng có người trong họp thực sự chọn hoặc đồng thuận. Kèm lý do được chọn. Nếu không có, ghi "Chưa chốt ưu tiên". |
| Phản biện & rủi ro | Danh sách | Ý tưởng nào bị phản đối — ai phản đối — lý do. Kèm cả những lo ngại chung về nguồn lực, chi phí, thời gian. |
| Câu hỏi còn bỏ ngỏ | Danh sách | Những điều cần tìm hiểu thêm trước khi quyết định được. |
| Bước tiếp theo | Việc cần làm | Việc gì — ai làm — hạn chót. Bao gồm cả việc đi tìm thông tin, làm thử, hoặc hẹn buổi họp tiếp. |

---

## 6. HỌP HĐQT

**Tên preset:** `Họp HĐQT`

**Mô tả:** Biên bản họp Hội đồng quản trị — nghị quyết, ý kiến các thành viên và chỉ đạo điều hành.

**Hướng dẫn cho AI**

```
Đây là họp Hội đồng quản trị. Bản tóm tắt này có giá trị như một biên bản nội bộ, nên độ chính xác quan trọng hơn độ ngắn gọn.

Viết văn phong trang trọng, khách quan, không dùng từ suồng sã.
Với mỗi quyết định: ghi rõ ai đề xuất, các ý kiến ủng hộ và phản đối, và kết luận cuối cùng của người chủ trì. Nếu có biểu quyết, ghi rõ kết quả biểu quyết như người nói công bố.
GHI LẠI CẢ Ý KIẾN TRÁI CHIỀU, kể cả khi ý kiến đó không được chấp thuận. Tuyệt đối không lược bỏ bất đồng để bản tóm tắt trông thuận hơn.
Không diễn giải, không tóm lược ý nghĩa của phát biểu. Khi một phát biểu mang tính cam kết, chỉ đạo hoặc ràng buộc, giữ sát nguyên văn.
Mọi con số tài chính, tỉ lệ sở hữu, hạn mức, ngân sách phải chép chính xác tuyệt đối; nghe không rõ thì ghi [?], tuyệt đối không đoán.
Phân biệt rõ: nội dung đã thành nghị quyết, nội dung mới chỉ là chỉ đạo định hướng, và nội dung được hoãn sang kỳ sau.
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Tóm tắt điều hành | Đoạn văn | 4-6 câu: phiên họp bàn những nội dung gì, kết luận trọng yếu nhất là gì. Văn phong trang trọng. |
| Nội dung trình bày & thảo luận | Danh sách | Mỗi nội dung một dòng: chủ đề — người trình bày — các luận điểm chính — các ý kiến trao đổi (ghi cả ý kiến trái chiều, kèm tên người). |
| Nghị quyết & quyết định | Danh sách | Mỗi quyết định: nội dung — người đề xuất — ý kiến phản đối (nếu có) — kết luận của chủ trì — kết quả biểu quyết (nếu có). |
| Số liệu tài chính & chỉ tiêu | Danh sách | Mọi con số được công bố hoặc phê duyệt. Chép chính xác, không làm tròn, không quy đổi. |
| Rủi ro & vấn đề trọng yếu | Danh sách | Rủi ro được nêu trong phiên họp, kèm mức độ nghiêm trọng theo đánh giá của người nêu và hướng xử lý nếu đã bàn. |
| Chỉ đạo cho ban điều hành | Việc cần làm | Nội dung chỉ đạo — giao cho ai — thời hạn báo cáo. |
| Nội dung hoãn sang kỳ sau | Danh sách | Vấn đề đưa ra nhưng chưa kết luận, kèm lý do hoãn và dự kiến thời điểm bàn lại. |

---

## 7. SALES CALL

**Tên preset:** `Sales call`

**Mô tả:** Tóm tắt cuộc gọi/gặp khách hàng — nhu cầu, phản đối, cam kết và bước chốt tiếp theo.

**Hướng dẫn cho AI**

```
Đây là cuộc trao đổi với khách hàng (gọi điện hoặc gặp trực tiếp). Người đọc bản tóm tắt cần biết khách thực sự muốn gì và deal này đang ở đâu.

Phân biệt tuyệt đối rạch ròi giữa ĐIỀU KHÁCH HÀNG NÓI và ĐIỀU NGƯỜI BÁN SUY ĐOÁN. Nếu một thông tin do người bán tự nhận định chứ khách không nói, đánh dấu rõ "(nhận định của người bán)".
Với những câu quan trọng của khách — về nhu cầu, ngân sách, lo ngại, hoặc cam kết — trích gần nguyên văn thay vì diễn giải lại. Cách khách hàng dùng từ chứa nhiều thông tin hơn bản tóm lược.
Ghi lại mọi phản đối và lo ngại của khách, kể cả khi người bán đã xử lý được ngay tại chỗ.
Ghi lại mọi cam kết mà người bán đã đưa ra: giá, thời gian giao, điều khoản, hàng mẫu. Đây là phần dễ gây tranh chấp nhất về sau.
Tìm và ghi rõ nếu có thông tin về: ngân sách, người ra quyết định cuối, mốc thời gian, và tình hình nhà cung cấp hiện tại của khách. Mục nào khách không đề cập thì ghi "Khách không đề cập".
Chỉ đánh giá mức độ tiềm năng dựa trên tín hiệu có thật trong cuộc gọi, và nêu rõ căn cứ.
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Thông tin khách hàng | Đoạn văn | Tên khách/công ty, ngành nghề, quy mô, người tham gia trao đổi và vai trò — chỉ những gì được nói ra trong cuộc gọi. |
| Nhu cầu & vấn đề của khách | Danh sách | Điều khách đang cần và vấn đề khách đang gặp. Trích gần nguyên văn lời khách. Đánh dấu "(nhận định của người bán)" nếu là suy đoán. |
| Phản đối & lo ngại | Danh sách | Mỗi dòng: khách lo ngại điều gì — người bán đã phản hồi thế nào — khách có vẻ đã yên tâm hay chưa. |
| Ngân sách, thẩm quyền, thời gian | Danh sách | Ngân sách dự kiến, ai ra quyết định cuối, mốc thời gian khách muốn, nhà cung cấp hiện tại. Mục nào không có thì ghi "Khách không đề cập". |
| Cam kết đã đưa ra | Danh sách | Mọi lời hứa của người bán: giá, chiết khấu, thời gian giao, hàng mẫu, hỗ trợ kỹ thuật. Ghi chính xác con số và thời hạn. |
| Đánh giá & bước tiếp theo | Việc cần làm | Mức độ tiềm năng kèm căn cứ cụ thể, sau đó là các việc cần làm: việc gì — ai làm — hạn chót. |

---

## 8. TRAINING

**Tên preset:** `Training`

**Mô tả:** Tóm tắt buổi đào tạo — kiến thức, quy trình thao tác, hỏi đáp và bài tập sau buổi học.

**Hướng dẫn cho AI**

```
Đây là buổi đào tạo/hướng dẫn. Bản tóm tắt sẽ được dùng làm tài liệu ôn lại cho người tham dự và cho người vắng mặt, nên phải đủ chi tiết để làm theo được.

Mọi thông số kỹ thuật phải chép chính xác tuyệt đối: nhiệt độ, thời gian, tỉ lệ, khối lượng, tốc độ, số vòng, cài đặt máy. Không làm tròn, không quy đổi đơn vị. Nghe không rõ thì ghi [?].
Với phần quy trình thao tác, trình bày theo đúng THỨ TỰ CÁC BƯỚC mà người hướng dẫn nói, đánh số rõ ràng. Không đảo thứ tự, không rút gọn bước.
Ghi lại nguyên nhân và lý do đằng sau mỗi thao tác nếu người hướng dẫn có giải thích — phần "vì sao" quan trọng ngang phần "làm thế nào".
Phần hỏi đáp phải giữ cả câu hỏi lẫn câu trả lời. Đây thường là phần giá trị nhất của buổi học và cũng là phần dễ bị lược mất nhất.
Ghi riêng những lỗi sai thường gặp và cảnh báo mà người hướng dẫn nhấn mạnh.
Nếu người hướng dẫn nhắc lại một điểm nhiều lần, đánh dấu là nội dung trọng tâm.
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Chủ đề & mục tiêu buổi học | Đoạn văn | 2-4 câu: buổi học dạy gì, dành cho ai, sau buổi học người tham dự phải làm được gì. |
| Kiến thức chính | Danh sách | Các khái niệm, nguyên lý, kiến thức nền được truyền đạt. Mỗi dòng một ý, kèm giải thích ngắn theo lời người hướng dẫn. |
| Quy trình & thao tác | Danh sách | Trình bày theo thứ tự các bước, đánh số. Mỗi bước: thao tác gì — thông số cụ thể — lý do (nếu có giải thích). Chép thông số chính xác tuyệt đối. |
| Lỗi thường gặp & lưu ý | Danh sách | Những lỗi người hướng dẫn cảnh báo, hậu quả nếu làm sai, và cách phòng tránh. |
| Hỏi đáp | Danh sách | Mỗi dòng: câu hỏi của học viên (kèm tên nếu có) — câu trả lời của người hướng dẫn. Giữ đầy đủ, không lược. |
| Việc cần làm sau buổi học | Việc cần làm | Bài tập, việc thực hành, tài liệu cần đọc: việc gì — ai làm — hạn chót. |

---

## 9. R&D SẢN PHẨM

**Tên preset:** `R&D sản phẩm`

**Mô tả:** Tóm tắt họp R&D — kết quả thử nghiệm, thông số công thức, đánh giá cảm quan và hướng thử tiếp.

**Hướng dẫn cho AI**

```
Đây là họp nghiên cứu & phát triển sản phẩm. Bản tóm tắt là hồ sơ thử nghiệm, sẽ được đọc lại sau nhiều tháng để tra cứu, nên độ chính xác của thông số là tối quan trọng.

MỌI THÔNG SỐ PHẢI CHÉP CHÍNH XÁC TUYỆT ĐỐI: tỉ lệ nguyên liệu, khối lượng, nhiệt độ, thời gian, độ ẩm, pH, tốc độ, thông số máy. Không làm tròn, không quy đổi đơn vị, không "chuẩn hóa" cách viết. Nếu nghe không rõ, ghi [?] — sai một con số ở đây là hỏng cả mẻ thử sau.
Ghi rõ mã hoặc tên gọi của từng mẫu thử (mẫu 1, mẫu A, batch 03...) theo đúng cách người trong họp gọi.
Với mỗi lần điều chỉnh công thức, ghi rõ: thay đổi từ thông số cũ sang thông số mới, và lý do thay đổi.
Tách riêng nhận xét cảm quan (vị, mùi, kết cấu, màu sắc, độ nở) khỏi số liệu kỹ thuật. Với nhận xét cảm quan, ghi kèm tên người nhận xét vì đây là đánh giá chủ quan.
Ghi lại cả những thử nghiệm THẤT BẠI và nguyên nhân. Đây là phần có giá trị lâu dài nhất của hồ sơ R&D.
Phân biệt rõ kết luận đã được xác nhận qua thử nghiệm và giả thuyết chưa kiểm chứng.
Nếu có bàn về chi phí nguyên liệu, giá thành hoặc khả năng sản xuất quy mô lớn, tách thành ý riêng.
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Đề tài & mục tiêu | Đoạn văn | 2-4 câu: đang phát triển sản phẩm gì, mục tiêu cần đạt, đang ở giai đoạn nào. |
| Mẫu thử & kết quả | Danh sách | Mỗi mẫu một dòng: mã mẫu — điều kiện thử — kết quả đạt/không đạt — nguyên nhân nếu thất bại. |
| Công thức & thông số điều chỉnh | Danh sách | Mỗi thay đổi: thông số nào — từ giá trị cũ sang giá trị mới — lý do. Chép số liệu chính xác tuyệt đối, ghi [?] nếu không rõ. |
| Nhận xét cảm quan | Danh sách | Vị, mùi, kết cấu, màu sắc, độ nở, hạn sử dụng cảm nhận. Mỗi dòng kèm tên người nhận xét. |
| Vấn đề kỹ thuật chưa giải quyết | Danh sách | Lỗi hoặc hạn chế còn tồn tại, các giả thuyết về nguyên nhân (ghi rõ là giả thuyết chưa kiểm chứng). |
| Chi phí & khả năng sản xuất | Danh sách | Giá nguyên liệu, giá thành ước tính, vướng mắc khi làm quy mô lớn. Ghi "Không có" nếu cuộc họp không bàn. |
| Hướng thử nghiệm tiếp theo | Việc cần làm | Thử nghiệm gì — thông số dự kiến — ai làm — hạn chót. |

---

## 10. OKR — XÂY DỰNG & CHECK-IN

**Tên preset:** `OKR — xây dựng & check-in`

**Mô tả:** Tóm tắt họp OKR — mục tiêu, kết quả then chốt, tiến độ và điều chỉnh.

**Hướng dẫn cho AI**

```
Đây là họp về OKR. Có thể là buổi XÂY DỰNG OKR (đặt mục tiêu đầu kỳ) hoặc buổi CHECK-IN (rà soát tiến độ giữa kỳ). Tự nhận diện từ nội dung transcript và ghi rõ loại nào ở đầu bản tóm tắt.

CẤU TRÚC BẮT BUỘC: mọi nội dung phải được gắn vào đúng Objective mà nó thuộc về. Trình bày theo dạng phân cấp — mỗi Objective là một khối, các Key Result nằm bên trong khối đó. Không trộn lẫn KR của các Objective khác nhau vào cùng một danh sách.

Với mỗi Objective: ghi nguyên văn cách phát biểu mục tiêu, tên người chủ trì (owner), và kỳ áp dụng nếu có nói.
Với mỗi Key Result: ghi rõ chỉ số đo lường, giá trị xuất phát (baseline), giá trị mục tiêu (target), giá trị hiện tại, và đơn vị. Chép chính xác mọi con số. Nếu một KR được nêu mà không có con số đo lường, ghi rõ "[chưa có chỉ số đo lường]" — đây là lỗi thiết kế OKR cần được chỉ ra, không được tự bịa con số vào.
Nếu trong họp có công bố mức độ hoàn thành (%, thang 0-1, màu xanh/vàng/đỏ), chép đúng như người nói công bố. KHÔNG TỰ TÍNH TOÁN hay tự suy ra mức hoàn thành nếu không ai nói.

Phân biệt rạch ròi:
- Objective: mục tiêu định tính, mô tả trạng thái muốn đạt tới.
- Key Result: kết quả đo lường được bằng con số.
- Initiative / việc cần làm: hành động cụ thể để đạt KR.
Nếu trong họp có người nhầm lẫn giữa ba loại này (ví dụ nêu một hành động và gọi nó là KR), ghi đúng như họ nói nhưng đánh dấu "[cần làm rõ: đây là hành động, chưa phải kết quả đo lường]".

Ghi riêng mọi trao đổi về việc ĐIỀU CHỈNH OKR: hạ target, bỏ bớt KR, thêm KR mới, đổi owner. Ghi rõ lý do điều chỉnh và ai phê duyệt. Đây là thông tin quan trọng nhất của một buổi check-in.
Ghi lại các yếu tố cản trở tiến độ (blocker) và nguồn lực được đề nghị bổ sung.
Nếu có OKR nào cả buổi không ai nhắc tới, và transcript đủ thông tin để nhận ra điều đó, ghi vào mục "Chưa rà soát".
```

**Các mục:**

| Tên mục | Kiểu | Gợi ý cho AI |
|---|---|---|
| Loại buổi họp & bối cảnh | Đoạn văn | 3-5 câu: đây là buổi xây dựng OKR hay check-in, cho kỳ nào, cấp nào (công ty/phòng ban/cá nhân), ai tham dự, tình hình chung đang trên đà hay đang chậm. |
| Objective & Key Results | Danh sách | Trình bày phân cấp. Mỗi Objective: nội dung mục tiêu — owner. Bên dưới là các KR của nó: chỉ số — baseline — target — giá trị hiện tại — đơn vị. Ghi "[chưa có chỉ số đo lường]" nếu KR không đo được. |
| Tiến độ & mức hoàn thành | Danh sách | Mức hoàn thành của từng KR đúng như người trong họp công bố (%, thang 0-1, hoặc màu). Không tự tính. Ghi "[không công bố]" nếu cuộc họp không nêu. |
| Blocker & rủi ro | Danh sách | Yếu tố đang cản trở từng KR: nguyên nhân — đang chặn KR nào — ai cần tháo gỡ — nguồn lực đề nghị bổ sung. |
| Điều chỉnh OKR | Danh sách | Mọi thay đổi: hạ/nâng target, thêm/bỏ KR, đổi owner, đổi kỳ. Mỗi dòng: thay đổi gì — từ giá trị cũ sang giá trị mới — lý do — ai phê duyệt. Ghi "Không có" nếu không điều chỉnh gì. |
| Initiative & việc cần làm | Việc cần làm | Hành động cụ thể để đẩy KR: việc gì — phục vụ KR nào — ai làm — hạn chót. |
| Chưa thống nhất / chưa rà soát | Danh sách | OKR hoặc KR còn đang tranh luận chưa chốt được, kèm lý do. Và những OKR đã có nhưng cả buổi không ai nhắc tới. |

---

## PHỤ LỤC — Đối chiếu nhanh

| Preset | Đặc thù cần nhớ khi chỉnh sửa về sau |
|---|---|
| General Meeting | AI tự nhận diện dạng họp rồi đổi trọng tâm; sắp xếp theo tầm quan trọng chứ không theo thời gian |
| Họp giao ban | Nhóm theo bộ phận; đánh dấu việc tồn đọng |
| Phòng kinh doanh | Số liệu và cam kết giá là phần dễ sai nhất |
| Phòng marketing | Tách kết quả / giả thuyết / kế hoạch |
| Brainstorming | Bảo toàn ý tưởng, cấm gộp và cấm lọc |
| Họp HĐQT | Giữ ý kiến trái chiều; văn phong biên bản |
| Sales call | Tách lời khách nói khỏi suy đoán của người bán |
| Training | Giữ đúng thứ tự bước và toàn bộ phần hỏi đáp |
| R&D sản phẩm | Thông số chính xác tuyệt đối; giữ cả thử nghiệm thất bại |
| OKR | Cấu trúc phân cấp O → KR; cấm tự tính % hoàn thành |
