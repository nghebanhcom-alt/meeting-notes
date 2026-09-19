/* ============================================
   MeetNote AI — Summary presets
   Built-in preset templates + pure validate/CRUD logic.
   No I/O: server.js owns reading/writing storage/presets.json.
   ============================================ */

const crypto = require('crypto');
const { sectionKeyFor } = require('./preset-schema');

const SECTION_TYPES = new Set(['paragraph', 'bulletList', 'actionList']);

// Validation limits (BR-4, BR-6, BR-7, E4).
const LIMITS = {
  NAME_MAX: 60,
  DESCRIPTION_MAX: 300,
  INSTRUCTION_MAX: 2000,
  LABEL_MAX: 60,
  HINT_MAX: 300,
  SECTIONS_MIN: 1,
  SECTIONS_MAX: 10,
  SECTIONS_WARN: 6,
  PRESET_COUNT_WARN: 50,
  PRESET_COUNT_MAX: 200
};

// Built-in preset templates (BR-64..BR-67). Nguồn xác thực duy nhất:
// docs/preset-templates.md — nội dung dưới đây copy NGUYÊN VĂN từ đó, không
// diễn đạt lại. `instruction` = CHỈ block "Hướng dẫn cho AI" riêng của từng
// preset (BR-65) — BLOCK DÙNG CHUNG (BR-61) đã trở thành nguyên tắc mặc định
// ở tầng prompt (server/llm/prompts.js SUMMARY_PRINCIPLES/CHUNK_PRINCIPLES)
// và KHÔNG được nối vào đây, nếu không prompt thật sẽ có 2 bản sao.
//
// Sections omit `key` — instantiateBuiltIns() below generates stable keys via
// sectionKeyFor(). General Meeting here is the BR-64 seed (7 sections, tiếng
// Việt) và KHÔNG được nhầm với GENERAL_SECTIONS (preset-schema.js, 5 key
// tiếng Anh) — đó là virtual snapshot riêng cho summary legacy trước feature
// preset (BR-20), không phải nội dung preset seed (Architecture §9.3).
const BUILT_IN_PRESETS = [
  {
    name: 'General Meeting',
    description: 'Mẫu tóm tắt tổng quát, dùng được cho mọi cuộc họp khi chưa có preset chuyên biệt.',
    instruction: `Đây là preset dùng chung cho mọi loại cuộc họp. Không biết trước cuộc họp thuộc dạng nào, nên phải tự nhận diện từ nội dung transcript rồi điều chỉnh trọng tâm cho phù hợp.

Ở đầu bản tóm tắt, tự xác định: cuộc họp này thuộc dạng gì (ra quyết định / cập nhật thông tin / giải quyết vấn đề / lên ý tưởng / đào tạo) và ai là người chủ trì. Nếu không xác định được thì bỏ qua, đừng đoán.

Điều chỉnh trọng tâm theo dạng họp nhận diện được:
- Họp ra quyết định: dồn trọng tâm vào phần quyết định và căn cứ dẫn tới quyết định đó.
- Họp cập nhật: dồn trọng tâm vào tiến độ, số liệu và vấn đề phát sinh.
- Họp giải quyết vấn đề: ghi rõ vấn đề, các phương án đã cân nhắc, phương án được chọn và lý do.
- Họp lên ý tưởng: giữ trọn vẹn các ý tưởng thay vì cô đọng lại.
- Họp đào tạo: giữ chi tiết các bước và thông số kỹ thuật.

Sắp xếp nội dung theo THỨ TỰ TẦM QUAN TRỌNG, không theo thứ tự thời gian của cuộc họp. Điều quan trọng nhất phải nằm ở trên cùng.

Ưu tiên giữ lại: quyết định, con số, cam kết, thời hạn, tên người phụ trách. Ưu tiên lược bỏ: trao đổi qua lại, ví dụ minh họa dài dòng, những đoạn nói lại cùng một ý.

Nếu cuộc họp bàn nhiều chủ đề rời rạc, nhóm nội dung theo chủ đề và đặt tiêu đề ngắn cho từng nhóm.`,
    sections: [
      { label: 'Tổng quan', type: 'paragraph', hint: '3-5 câu: cuộc họp bàn gì, ai chủ trì, kết quả quan trọng nhất là gì. Nếu cuộc họp không đi tới kết luận nào, nói thẳng điều đó.' },
      { label: 'Nội dung chính', type: 'bulletList', hint: 'Nhóm theo chủ đề nếu cuộc họp bàn nhiều việc. Mỗi dòng một ý hoàn chỉnh, kèm tên người nêu ý đó. Sắp xếp theo mức độ quan trọng.' },
      { label: 'Số liệu & thông tin quan trọng', type: 'bulletList', hint: 'Mọi con số, ngày tháng, tên riêng, thông số được nêu. Chép chính xác. Ghi "Không có" nếu cuộc họp không nhắc tới số liệu nào.' },
      { label: 'Quyết định đã chốt', type: 'bulletList', hint: 'Nội dung chốt — ai chốt — căn cứ dẫn tới quyết định. Chỉ ghi những gì đã kết luận dứt khoát.' },
      { label: 'Vấn đề & rủi ro', type: 'bulletList', hint: 'Vấn đề được nêu trong họp, kèm ai nêu và hướng xử lý nếu đã bàn tới.' },
      { label: 'Việc cần làm', type: 'actionList', hint: 'Việc gì — ai làm — hạn chót. Mỗi dòng một việc.' },
      { label: 'Chưa chốt / cần bàn tiếp', type: 'bulletList', hint: 'Vấn đề đã nêu nhưng chưa có kết luận, kèm lý do chưa chốt được.' }
    ]
  },
  {
    name: 'Họp giao ban',
    description: 'Tóm tắt họp giao ban định kỳ — tiến độ từng bộ phận, vướng mắc và phân công tuần tới.',
    instruction: `Đây là họp giao ban định kỳ giữa các bộ phận. Mục đích của bản tóm tắt là để người vắng mặt nắm được tình hình trong 2 phút, và để người phụ trách biết mình phải làm gì tiếp theo.

Tổ chức phần tiến độ theo TỪNG BỘ PHẬN hoặc từng người, không gộp chung thành một danh sách hỗn hợp.
Với mỗi vướng mắc, ghi rõ nó đang chặn việc gì và ai là người có thể tháo gỡ.
Nếu một việc đã được nhắc ở kỳ giao ban trước mà vẫn chưa xong, đánh dấu "tồn đọng".
Ưu tiên nội dung có tác động đến vận hành hoặc doanh thu; những trao đổi mang tính thông báo nhẹ thì gộp lại thành một dòng.`,
    sections: [
      { label: 'Tổng quan', type: 'paragraph', hint: 'Tóm tắt 3-5 câu: cuộc họp bàn những gì, tình hình chung đang tốt hay đang có vấn đề, điều gì cần chú ý nhất.' },
      { label: 'Tiến độ theo bộ phận', type: 'bulletList', hint: 'Nhóm theo từng bộ phận hoặc từng người. Mỗi dòng: việc đã hoàn thành và việc đang làm dở, kèm % hoặc mốc cụ thể nếu người nói có đề cập.' },
      { label: 'Vướng mắc & rủi ro', type: 'bulletList', hint: 'Vấn đề đang chặn tiến độ. Ghi rõ đang chặn việc gì, nguyên nhân, và ai cần xử lý. Đánh dấu "tồn đọng" nếu là vấn đề cũ lặp lại.' },
      { label: 'Quyết định đã chốt', type: 'bulletList', hint: 'Chỉ ghi những gì có người ra quyết định dứt khoát. Mỗi dòng: nội dung chốt — ai chốt.' },
      { label: 'Việc cần làm', type: 'actionList', hint: 'Việc gì — ai làm — hạn chót. Mỗi dòng một việc, không gộp nhiều việc vào một dòng.' },
      { label: 'Chưa chốt / kỳ sau bàn tiếp', type: 'bulletList', hint: 'Vấn đề đã nêu nhưng chưa có kết luận, kèm lý do vì sao chưa chốt được.' }
    ]
  },
  {
    name: 'Họp phòng kinh doanh',
    description: 'Tóm tắt họp kinh doanh — số liệu, tình hình khách hàng, deal đang chạy và hành động bán hàng.',
    instruction: `Đây là họp nội bộ phòng kinh doanh. Người đọc bản tóm tắt cần biết: đang đạt bao nhiêu so với chỉ tiêu, deal nào đáng chú ý, và tuần tới phải đẩy cái gì.

Số liệu là phần quan trọng nhất — chép chính xác mọi con số về doanh số, sản lượng, chỉ tiêu, tỉ lệ chốt, công nợ. Khi người nói so sánh (so với tháng trước, so với kế hoạch), giữ nguyên cả hai vế của phép so sánh.
Với mỗi khách hàng hoặc deal được nhắc tên, ghi trạng thái hiện tại và bước tiếp theo.
Phân biệt rõ khách hàng mới, khách hàng đang chăm, và khách hàng đang có vấn đề (giảm đơn, khiếu nại, nợ quá hạn).
Nếu có trao đổi về giá, chiết khấu hoặc chính sách bán hàng, tách riêng thành một quyết định — đây là loại thông tin dễ bị hiểu sai nhất sau cuộc họp.
Không tự đánh giá hiệu suất của nhân viên nếu trong họp không ai nhận xét.`,
    sections: [
      { label: 'Tổng quan', type: 'paragraph', hint: '3-5 câu: kỳ này đạt hay không đạt, nguyên nhân chính, trọng tâm sắp tới.' },
      { label: 'Số liệu & chỉ tiêu', type: 'bulletList', hint: 'Mọi con số được nêu: doanh số, sản lượng, % hoàn thành chỉ tiêu, công nợ. Giữ nguyên mốc so sánh người nói dùng.' },
      { label: 'Khách hàng & deal', type: 'bulletList', hint: 'Mỗi khách hàng/deal một dòng: tên — trạng thái hiện tại — giá trị (nếu có) — bước tiếp theo.' },
      { label: 'Vấn đề cản trở doanh số', type: 'bulletList', hint: 'Lý do khiến deal chậm hoặc mất: giá, hàng hóa, đối thủ, năng lực đội ngũ. Ghi kèm ai nêu vấn đề đó.' },
      { label: 'Chính sách giá & quyết định', type: 'bulletList', hint: 'Mọi thay đổi về giá, chiết khấu, điều khoản thanh toán, chính sách bán hàng đã được chốt. Ghi rõ áp dụng cho ai, từ khi nào.' },
      { label: 'Việc cần làm', type: 'actionList', hint: 'Việc gì — ai làm — hạn chót. Ưu tiên việc gắn với khách hàng cụ thể lên trước.' }
    ]
  },
  {
    name: 'Họp phòng marketing',
    description: 'Tóm tắt họp marketing — hiệu quả chiến dịch, kế hoạch nội dung, ngân sách và phân công.',
    instruction: `Đây là họp nội bộ phòng marketing. Bản tóm tắt phải trả lời được: cái gì đang chạy hiệu quả, cái gì không, và sắp tới làm gì.

Với mỗi chiến dịch hoặc kênh được nhắc tới, ghi rõ tên chiến dịch, kênh, và số liệu đi kèm (reach, engagement, chi phí, lượt đăng ký, đơn hàng). Chép chính xác, không làm tròn.
Phân biệt rõ ba loại nội dung: KẾT QUẢ đã có, GIẢ THUYẾT về nguyên nhân, và KẾ HOẠCH sắp làm. Không được trình bày giả thuyết như thể là kết luận đã xác nhận.
Với phần kế hoạch nội dung, ghi cụ thể: định dạng, kênh đăng, thông điệp chính, thời gian dự kiến.
Mọi trao đổi về ngân sách phải tách riêng, kèm con số và ai là người duyệt.
Nếu có nhận xét về thiết kế, hình ảnh hoặc nội dung cụ thể, ghi lại yêu cầu chỉnh sửa dưới dạng việc cần làm, đừng để lẫn vào phần thảo luận chung.`,
    sections: [
      { label: 'Tổng quan', type: 'paragraph', hint: '3-5 câu: tình hình marketing kỳ này, điểm sáng và điểm yếu, hướng đi sắp tới.' },
      { label: 'Kết quả chiến dịch & kênh', type: 'bulletList', hint: 'Mỗi chiến dịch/kênh một dòng: tên — số liệu thực tế — đánh giá của người trong họp (không phải đánh giá của bạn).' },
      { label: 'Nhận định & giả thuyết', type: 'bulletList', hint: 'Lý giải vì sao số liệu tăng/giảm, theo lời người trong họp. Ghi rõ đây là giả thuyết chưa kiểm chứng nếu chưa ai xác nhận.' },
      { label: 'Kế hoạch nội dung & chiến dịch', type: 'bulletList', hint: 'Mỗi hạng mục: nội dung gì — định dạng — kênh — thời gian dự kiến — ai phụ trách.' },
      { label: 'Ngân sách & nguồn lực', type: 'bulletList', hint: 'Con số ngân sách, phân bổ, đề xuất tăng/giảm, ai duyệt. Ghi "Không có" nếu cuộc họp không bàn tới.' },
      { label: 'Quyết định đã chốt', type: 'bulletList', hint: 'Nội dung chốt — ai chốt. Chỉ ghi những gì đã kết luận dứt khoát.' },
      { label: 'Việc cần làm', type: 'actionList', hint: 'Việc gì — ai làm — hạn chót. Gộp cả yêu cầu chỉnh sửa design/content vào đây.' }
    ]
  },
  {
    name: 'Brainstorming',
    description: 'Tóm tắt buổi brainstorm — giữ trọn vẹn mọi ý tưởng, kể cả ý tưởng bị bác.',
    instruction: `Đây là buổi brainstorm. Nguyên tắc tóm tắt khác hẳn các cuộc họp khác: mục tiêu là BẢO TOÀN Ý TƯỞNG, không phải cô đọng nội dung.

Ghi lại TOÀN BỘ ý tưởng được nêu ra, kể cả ý tưởng bị bác bỏ ngay, ý tưởng nói đùa, hoặc ý tưởng nghe có vẻ không khả thi. Ý tưởng bị loại hôm nay thường là nguyên liệu cho ý tưởng đúng vào lần sau.
KHÔNG gộp hai ý tưởng gần giống nhau thành một. Sự khác biệt nhỏ giữa chúng chính là phần có giá trị.
KHÔNG tự sắp xếp lại ý tưởng theo logic của bạn, và KHÔNG tự bổ sung ý tưởng mà không ai nói ra.
Luôn ghi tên người đề xuất cạnh mỗi ý tưởng.
Giữ nguyên cách diễn đạt gốc nếu người nói dùng một hình ảnh, ví von hoặc cách gọi đặc trưng — đừng viết lại cho "chuẩn" hơn.
Tách riêng phần phản biện: ý tưởng nào bị phản đối, ai phản đối, lý do gì.
Cuối cùng chỉ đánh dấu ưu tiên nếu trong họp có người thực sự chọn. Nếu không ai chọn, ghi "Chưa chốt ưu tiên".`,
    sections: [
      { label: 'Bài toán cần giải', type: 'paragraph', hint: '2-4 câu nêu đúng vấn đề hoặc câu hỏi mà buổi brainstorm muốn giải quyết, theo cách người chủ trì đặt ra.' },
      { label: 'Toàn bộ ý tưởng', type: 'bulletList', hint: 'Liệt kê mọi ý tưởng, mỗi ý một dòng, kèm tên người đề xuất. Không lọc, không gộp, không sắp xếp lại. Giữ nguyên cách diễn đạt gốc.' },
      { label: 'Ý tưởng được ưu tiên', type: 'bulletList', hint: 'Chỉ những ý tưởng có người trong họp thực sự chọn hoặc đồng thuận. Kèm lý do được chọn. Nếu không có, ghi "Chưa chốt ưu tiên".' },
      { label: 'Phản biện & rủi ro', type: 'bulletList', hint: 'Ý tưởng nào bị phản đối — ai phản đối — lý do. Kèm cả những lo ngại chung về nguồn lực, chi phí, thời gian.' },
      { label: 'Câu hỏi còn bỏ ngỏ', type: 'bulletList', hint: 'Những điều cần tìm hiểu thêm trước khi quyết định được.' },
      { label: 'Bước tiếp theo', type: 'actionList', hint: 'Việc gì — ai làm — hạn chót. Bao gồm cả việc đi tìm thông tin, làm thử, hoặc hẹn buổi họp tiếp.' }
    ]
  },
  {
    name: 'Họp HĐQT',
    description: 'Biên bản họp Hội đồng quản trị — nghị quyết, ý kiến các thành viên và chỉ đạo điều hành.',
    instruction: `Đây là họp Hội đồng quản trị. Bản tóm tắt này có giá trị như một biên bản nội bộ, nên độ chính xác quan trọng hơn độ ngắn gọn.

Viết văn phong trang trọng, khách quan, không dùng từ suồng sã.
Với mỗi quyết định: ghi rõ ai đề xuất, các ý kiến ủng hộ và phản đối, và kết luận cuối cùng của người chủ trì. Nếu có biểu quyết, ghi rõ kết quả biểu quyết như người nói công bố.
GHI LẠI CẢ Ý KIẾN TRÁI CHIỀU, kể cả khi ý kiến đó không được chấp thuận. Tuyệt đối không lược bỏ bất đồng để bản tóm tắt trông thuận hơn.
Không diễn giải, không tóm lược ý nghĩa của phát biểu. Khi một phát biểu mang tính cam kết, chỉ đạo hoặc ràng buộc, giữ sát nguyên văn.
Mọi con số tài chính, tỉ lệ sở hữu, hạn mức, ngân sách phải chép chính xác tuyệt đối; nghe không rõ thì ghi [?], tuyệt đối không đoán.
Phân biệt rõ: nội dung đã thành nghị quyết, nội dung mới chỉ là chỉ đạo định hướng, và nội dung được hoãn sang kỳ sau.`,
    sections: [
      { label: 'Tóm tắt điều hành', type: 'paragraph', hint: '4-6 câu: phiên họp bàn những nội dung gì, kết luận trọng yếu nhất là gì. Văn phong trang trọng.' },
      { label: 'Nội dung trình bày & thảo luận', type: 'bulletList', hint: 'Mỗi nội dung một dòng: chủ đề — người trình bày — các luận điểm chính — các ý kiến trao đổi (ghi cả ý kiến trái chiều, kèm tên người).' },
      { label: 'Nghị quyết & quyết định', type: 'bulletList', hint: 'Mỗi quyết định: nội dung — người đề xuất — ý kiến phản đối (nếu có) — kết luận của chủ trì — kết quả biểu quyết (nếu có).' },
      { label: 'Số liệu tài chính & chỉ tiêu', type: 'bulletList', hint: 'Mọi con số được công bố hoặc phê duyệt. Chép chính xác, không làm tròn, không quy đổi.' },
      { label: 'Rủi ro & vấn đề trọng yếu', type: 'bulletList', hint: 'Rủi ro được nêu trong phiên họp, kèm mức độ nghiêm trọng theo đánh giá của người nêu và hướng xử lý nếu đã bàn.' },
      { label: 'Chỉ đạo cho ban điều hành', type: 'actionList', hint: 'Nội dung chỉ đạo — giao cho ai — thời hạn báo cáo.' },
      { label: 'Nội dung hoãn sang kỳ sau', type: 'bulletList', hint: 'Vấn đề đưa ra nhưng chưa kết luận, kèm lý do hoãn và dự kiến thời điểm bàn lại.' }
    ]
  },
  {
    name: 'Sales call',
    description: 'Tóm tắt cuộc gọi/gặp khách hàng — nhu cầu, phản đối, cam kết và bước chốt tiếp theo.',
    instruction: `Đây là cuộc trao đổi với khách hàng (gọi điện hoặc gặp trực tiếp). Người đọc bản tóm tắt cần biết khách thực sự muốn gì và deal này đang ở đâu.

Phân biệt tuyệt đối rạch ròi giữa ĐIỀU KHÁCH HÀNG NÓI và ĐIỀU NGƯỜI BÁN SUY ĐOÁN. Nếu một thông tin do người bán tự nhận định chứ khách không nói, đánh dấu rõ "(nhận định của người bán)".
Với những câu quan trọng của khách — về nhu cầu, ngân sách, lo ngại, hoặc cam kết — trích gần nguyên văn thay vì diễn giải lại. Cách khách hàng dùng từ chứa nhiều thông tin hơn bản tóm lược.
Ghi lại mọi phản đối và lo ngại của khách, kể cả khi người bán đã xử lý được ngay tại chỗ.
Ghi lại mọi cam kết mà người bán đã đưa ra: giá, thời gian giao, điều khoản, hàng mẫu. Đây là phần dễ gây tranh chấp nhất về sau.
Tìm và ghi rõ nếu có thông tin về: ngân sách, người ra quyết định cuối, mốc thời gian, và tình hình nhà cung cấp hiện tại của khách. Mục nào khách không đề cập thì ghi "Khách không đề cập".
Chỉ đánh giá mức độ tiềm năng dựa trên tín hiệu có thật trong cuộc gọi, và nêu rõ căn cứ.`,
    sections: [
      { label: 'Thông tin khách hàng', type: 'paragraph', hint: 'Tên khách/công ty, ngành nghề, quy mô, người tham gia trao đổi và vai trò — chỉ những gì được nói ra trong cuộc gọi.' },
      { label: 'Nhu cầu & vấn đề của khách', type: 'bulletList', hint: 'Điều khách đang cần và vấn đề khách đang gặp. Trích gần nguyên văn lời khách. Đánh dấu "(nhận định của người bán)" nếu là suy đoán.' },
      { label: 'Phản đối & lo ngại', type: 'bulletList', hint: 'Mỗi dòng: khách lo ngại điều gì — người bán đã phản hồi thế nào — khách có vẻ đã yên tâm hay chưa.' },
      { label: 'Ngân sách, thẩm quyền, thời gian', type: 'bulletList', hint: 'Ngân sách dự kiến, ai ra quyết định cuối, mốc thời gian khách muốn, nhà cung cấp hiện tại. Mục nào không có thì ghi "Khách không đề cập".' },
      { label: 'Cam kết đã đưa ra', type: 'bulletList', hint: 'Mọi lời hứa của người bán: giá, chiết khấu, thời gian giao, hàng mẫu, hỗ trợ kỹ thuật. Ghi chính xác con số và thời hạn.' },
      { label: 'Đánh giá & bước tiếp theo', type: 'actionList', hint: 'Mức độ tiềm năng kèm căn cứ cụ thể, sau đó là các việc cần làm: việc gì — ai làm — hạn chót.' }
    ]
  },
  {
    name: 'Training',
    description: 'Tóm tắt buổi đào tạo — kiến thức, quy trình thao tác, hỏi đáp và bài tập sau buổi học.',
    instruction: `Đây là buổi đào tạo/hướng dẫn. Bản tóm tắt sẽ được dùng làm tài liệu ôn lại cho người tham dự và cho người vắng mặt, nên phải đủ chi tiết để làm theo được.

Mọi thông số kỹ thuật phải chép chính xác tuyệt đối: nhiệt độ, thời gian, tỉ lệ, khối lượng, tốc độ, số vòng, cài đặt máy. Không làm tròn, không quy đổi đơn vị. Nghe không rõ thì ghi [?].
Với phần quy trình thao tác, trình bày theo đúng THỨ TỰ CÁC BƯỚC mà người hướng dẫn nói, đánh số rõ ràng. Không đảo thứ tự, không rút gọn bước.
Ghi lại nguyên nhân và lý do đằng sau mỗi thao tác nếu người hướng dẫn có giải thích — phần "vì sao" quan trọng ngang phần "làm thế nào".
Phần hỏi đáp phải giữ cả câu hỏi lẫn câu trả lời. Đây thường là phần giá trị nhất của buổi học và cũng là phần dễ bị lược mất nhất.
Ghi riêng những lỗi sai thường gặp và cảnh báo mà người hướng dẫn nhấn mạnh.
Nếu người hướng dẫn nhắc lại một điểm nhiều lần, đánh dấu là nội dung trọng tâm.`,
    sections: [
      { label: 'Chủ đề & mục tiêu buổi học', type: 'paragraph', hint: '2-4 câu: buổi học dạy gì, dành cho ai, sau buổi học người tham dự phải làm được gì.' },
      { label: 'Kiến thức chính', type: 'bulletList', hint: 'Các khái niệm, nguyên lý, kiến thức nền được truyền đạt. Mỗi dòng một ý, kèm giải thích ngắn theo lời người hướng dẫn.' },
      { label: 'Quy trình & thao tác', type: 'bulletList', hint: 'Trình bày theo thứ tự các bước, đánh số. Mỗi bước: thao tác gì — thông số cụ thể — lý do (nếu có giải thích). Chép thông số chính xác tuyệt đối.' },
      { label: 'Lỗi thường gặp & lưu ý', type: 'bulletList', hint: 'Những lỗi người hướng dẫn cảnh báo, hậu quả nếu làm sai, và cách phòng tránh.' },
      { label: 'Hỏi đáp', type: 'bulletList', hint: 'Mỗi dòng: câu hỏi của học viên (kèm tên nếu có) — câu trả lời của người hướng dẫn. Giữ đầy đủ, không lược.' },
      { label: 'Việc cần làm sau buổi học', type: 'actionList', hint: 'Bài tập, việc thực hành, tài liệu cần đọc: việc gì — ai làm — hạn chót.' }
    ]
  },
  {
    name: 'R&D sản phẩm',
    description: 'Tóm tắt họp R&D — kết quả thử nghiệm, thông số công thức, đánh giá cảm quan và hướng thử tiếp.',
    instruction: `Đây là họp nghiên cứu & phát triển sản phẩm. Bản tóm tắt là hồ sơ thử nghiệm, sẽ được đọc lại sau nhiều tháng để tra cứu, nên độ chính xác của thông số là tối quan trọng.

MỌI THÔNG SỐ PHẢI CHÉP CHÍNH XÁC TUYỆT ĐỐI: tỉ lệ nguyên liệu, khối lượng, nhiệt độ, thời gian, độ ẩm, pH, tốc độ, thông số máy. Không làm tròn, không quy đổi đơn vị, không "chuẩn hóa" cách viết. Nếu nghe không rõ, ghi [?] — sai một con số ở đây là hỏng cả mẻ thử sau.
Ghi rõ mã hoặc tên gọi của từng mẫu thử (mẫu 1, mẫu A, batch 03...) theo đúng cách người trong họp gọi.
Với mỗi lần điều chỉnh công thức, ghi rõ: thay đổi từ thông số cũ sang thông số mới, và lý do thay đổi.
Tách riêng nhận xét cảm quan (vị, mùi, kết cấu, màu sắc, độ nở) khỏi số liệu kỹ thuật. Với nhận xét cảm quan, ghi kèm tên người nhận xét vì đây là đánh giá chủ quan.
Ghi lại cả những thử nghiệm THẤT BẠI và nguyên nhân. Đây là phần có giá trị lâu dài nhất của hồ sơ R&D.
Phân biệt rõ kết luận đã được xác nhận qua thử nghiệm và giả thuyết chưa kiểm chứng.
Nếu có bàn về chi phí nguyên liệu, giá thành hoặc khả năng sản xuất quy mô lớn, tách thành ý riêng.`,
    sections: [
      { label: 'Đề tài & mục tiêu', type: 'paragraph', hint: '2-4 câu: đang phát triển sản phẩm gì, mục tiêu cần đạt, đang ở giai đoạn nào.' },
      { label: 'Mẫu thử & kết quả', type: 'bulletList', hint: 'Mỗi mẫu một dòng: mã mẫu — điều kiện thử — kết quả đạt/không đạt — nguyên nhân nếu thất bại.' },
      { label: 'Công thức & thông số điều chỉnh', type: 'bulletList', hint: 'Mỗi thay đổi: thông số nào — từ giá trị cũ sang giá trị mới — lý do. Chép số liệu chính xác tuyệt đối, ghi [?] nếu không rõ.' },
      { label: 'Nhận xét cảm quan', type: 'bulletList', hint: 'Vị, mùi, kết cấu, màu sắc, độ nở, hạn sử dụng cảm nhận. Mỗi dòng kèm tên người nhận xét.' },
      { label: 'Vấn đề kỹ thuật chưa giải quyết', type: 'bulletList', hint: 'Lỗi hoặc hạn chế còn tồn tại, các giả thuyết về nguyên nhân (ghi rõ là giả thuyết chưa kiểm chứng).' },
      { label: 'Chi phí & khả năng sản xuất', type: 'bulletList', hint: 'Giá nguyên liệu, giá thành ước tính, vướng mắc khi làm quy mô lớn. Ghi "Không có" nếu cuộc họp không bàn.' },
      { label: 'Hướng thử nghiệm tiếp theo', type: 'actionList', hint: 'Thử nghiệm gì — thông số dự kiến — ai làm — hạn chót.' }
    ]
  },
  {
    name: 'OKR — xây dựng & check-in',
    description: 'Tóm tắt họp OKR — mục tiêu, kết quả then chốt, tiến độ và điều chỉnh.',
    instruction: `Đây là họp về OKR. Có thể là buổi XÂY DỰNG OKR (đặt mục tiêu đầu kỳ) hoặc buổi CHECK-IN (rà soát tiến độ giữa kỳ). Tự nhận diện từ nội dung transcript và ghi rõ loại nào ở đầu bản tóm tắt.

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
Nếu có OKR nào cả buổi không ai nhắc tới, và transcript đủ thông tin để nhận ra điều đó, ghi vào mục "Chưa rà soát".`,
    sections: [
      { label: 'Loại buổi họp & bối cảnh', type: 'paragraph', hint: '3-5 câu: đây là buổi xây dựng OKR hay check-in, cho kỳ nào, cấp nào (công ty/phòng ban/cá nhân), ai tham dự, tình hình chung đang trên đà hay đang chậm.' },
      { label: 'Objective & Key Results', type: 'bulletList', hint: 'Trình bày phân cấp. Mỗi Objective: nội dung mục tiêu — owner. Bên dưới là các KR của nó: chỉ số — baseline — target — giá trị hiện tại — đơn vị. Ghi "[chưa có chỉ số đo lường]" nếu KR không đo được.' },
      { label: 'Tiến độ & mức hoàn thành', type: 'bulletList', hint: 'Mức hoàn thành của từng KR đúng như người trong họp công bố (%, thang 0-1, hoặc màu). Không tự tính. Ghi "[không công bố]" nếu cuộc họp không nêu.' },
      { label: 'Blocker & rủi ro', type: 'bulletList', hint: 'Yếu tố đang cản trở từng KR: nguyên nhân — đang chặn KR nào — ai cần tháo gỡ — nguồn lực đề nghị bổ sung.' },
      { label: 'Điều chỉnh OKR', type: 'bulletList', hint: 'Mọi thay đổi: hạ/nâng target, thêm/bỏ KR, đổi owner, đổi kỳ. Mỗi dòng: thay đổi gì — từ giá trị cũ sang giá trị mới — lý do — ai phê duyệt. Ghi "Không có" nếu không điều chỉnh gì.' },
      { label: 'Initiative & việc cần làm', type: 'actionList', hint: 'Hành động cụ thể để đẩy KR: việc gì — phục vụ KR nào — ai làm — hạn chót.' },
      { label: 'Chưa thống nhất / chưa rà soát', type: 'bulletList', hint: 'OKR hoặc KR còn đang tranh luận chưa chốt được, kèm lý do. Và những OKR đã có nhưng cả buổi không ai nhắc tới.' }
    ]
  }
];

// Assign fresh id/timestamps and generate stable section keys for the
// built-in templates above. Called whenever storage/presets.json is empty
// (BR-9: first run, or after the user deletes every preset).
function instantiateBuiltIns() {
  const now = new Date().toISOString();
  return BUILT_IN_PRESETS.map(template => {
    const usedKeys = new Set();
    const sections = template.sections.map((section, index) => {
      const key = section.key || sectionKeyFor(section.label, index, usedKeys);
      usedKeys.add(key);
      return { key, label: section.label, type: section.type, hint: section.hint || '' };
    });
    return {
      id: crypto.randomUUID(),
      name: template.name,
      description: template.description || '',
      instruction: template.instruction || '',
      sections,
      isBuiltIn: true,
      createdAt: now,
      updatedAt: now
    };
  });
}

function validationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Validate + normalize a preset create/update payload (BR-2..BR-7).
 * @param {object} input raw request body
 * @param {object[]} existingPresets current presets.json contents
 * @param {string|null} currentId id of the preset being edited, or null when creating
 * @returns {{preset: object, warnings: {code:string,message:string}[]}}
 * @throws {Error} with a machine-readable `.code` on validation failure
 */
function validatePreset(input, existingPresets = [], currentId = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('PRESET_NAME_REQUIRED', 'Preset payload is required.');
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw validationError('PRESET_NAME_REQUIRED', 'Tên preset là bắt buộc.');
  if (name.length > LIMITS.NAME_MAX) {
    throw validationError('PRESET_NAME_TOO_LONG', `Tên preset không được vượt quá ${LIMITS.NAME_MAX} ký tự.`);
  }
  const duplicateName = existingPresets.some(preset =>
    preset.id !== currentId && String(preset.name || '').trim().toLowerCase() === name.toLowerCase());
  if (duplicateName) throw validationError('PRESET_NAME_DUPLICATE', 'Đã tồn tại preset khác cùng tên.');

  if (input.description !== undefined && typeof input.description === 'string' && input.description.trim().length > LIMITS.DESCRIPTION_MAX) {
    throw validationError('PRESET_DESCRIPTION_TOO_LONG', `Mô tả không được vượt quá ${LIMITS.DESCRIPTION_MAX} ký tự.`);
  }
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, LIMITS.DESCRIPTION_MAX) : '';

  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
  if (instruction.length > LIMITS.INSTRUCTION_MAX) {
    throw validationError('PRESET_INSTRUCTION_TOO_LONG', `Hướng dẫn không được vượt quá ${LIMITS.INSTRUCTION_MAX} ký tự.`);
  }

  if (!Array.isArray(input.sections) || input.sections.length < LIMITS.SECTIONS_MIN) {
    throw validationError('PRESET_NO_SECTION', 'Preset phải có ít nhất 1 mục.');
  }
  if (input.sections.length > LIMITS.SECTIONS_MAX) {
    throw validationError('PRESET_TOO_MANY_SECTIONS', `Preset không được vượt quá ${LIMITS.SECTIONS_MAX} mục.`);
  }

  const existingPreset = currentId ? existingPresets.find(preset => preset.id === currentId) : null;
  const existingSectionsByKey = new Map((existingPreset?.sections || []).map(section => [section.key, section]));

  const usedKeys = new Set();
  const usedLabels = new Set();
  const sections = input.sections.map((rawSection, index) => {
    if (!rawSection || typeof rawSection !== 'object') {
      throw validationError('PRESET_INVALID_TYPE', 'Mục preset không hợp lệ.');
    }
    const label = typeof rawSection.label === 'string' ? rawSection.label.trim() : '';
    if (!label) throw validationError('PRESET_LABEL_REQUIRED', 'Tên mục là bắt buộc.');
    if (label.length > LIMITS.LABEL_MAX) {
      throw validationError('PRESET_LABEL_TOO_LONG', `Tên mục không được vượt quá ${LIMITS.LABEL_MAX} ký tự.`);
    }
    const labelKey = label.toLowerCase();
    if (usedLabels.has(labelKey)) throw validationError('PRESET_LABEL_DUPLICATE', 'Hai mục không được trùng tên.');
    usedLabels.add(labelKey);

    if (!SECTION_TYPES.has(rawSection.type)) {
      throw validationError('PRESET_INVALID_TYPE', `Kiểu mục "${rawSection.type}" không hợp lệ.`);
    }

    const hint = typeof rawSection.hint === 'string' ? rawSection.hint.trim() : '';
    if (hint.length > LIMITS.HINT_MAX) {
      throw validationError('PRESET_HINT_TOO_LONG', `Gợi ý không được vượt quá ${LIMITS.HINT_MAX} ký tự.`);
    }

    // §3.1 rule 5: reuse the key of the section being edited so it stays
    // stable across label edits; only brand-new sections get a fresh key.
    let key = null;
    if (typeof rawSection.key === 'string' && existingSectionsByKey.has(rawSection.key)) {
      key = rawSection.key;
    }
    if (!key) key = sectionKeyFor(label, index, usedKeys);
    usedKeys.add(key);

    return { key, label, type: rawSection.type, hint };
  });

  const warnings = [];
  if (sections.length > LIMITS.SECTIONS_WARN) {
    warnings.push({ code: 'PRESET_SECTIONS_WARN', message: 'Quá nhiều mục có thể làm bản tóm tắt loãng.' });
  }

  if (!existingPreset) {
    const total = existingPresets.length + 1;
    if (total > LIMITS.PRESET_COUNT_MAX) {
      throw validationError('PRESET_LIMIT_REACHED', `Đã đạt giới hạn ${LIMITS.PRESET_COUNT_MAX} preset.`);
    }
    if (total >= LIMITS.PRESET_COUNT_WARN) {
      warnings.push({ code: 'PRESET_COUNT_WARN', message: 'Bạn đang có rất nhiều preset, cân nhắc dọn bớt.' });
    }
  }

  const now = new Date().toISOString();
  const preset = {
    id: currentId || crypto.randomUUID(),
    name,
    description,
    instruction,
    sections,
    isBuiltIn: existingPreset ? Boolean(existingPreset.isBuiltIn) : false,
    createdAt: existingPreset?.createdAt || now,
    updatedAt: now
  };

  return { preset, warnings };
}

module.exports = {
  LIMITS,
  BUILT_IN_PRESETS,
  instantiateBuiltIns,
  validatePreset
};
