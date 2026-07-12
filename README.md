# TOEIC Practice — Web luyện thi TOEIC cá nhân

🌐 **Bản online**: https://hoangthien77.github.io/toeic-practice/ (GitHub Pages — dùng để học/làm bài; upload đề mới trên web chỉ gửi vào hàng chờ cloud, đề được xử lý khi máy cá nhân bật poller).

**Cập nhật web sau khi có đề mới**: đề gửi từ bản online sẽ nằm trong hàng chờ cloud. Khi máy cá nhân bật poller, máy tự kéo đề về xử lý, commit/push và web tự cập nhật. Nếu xử lý thủ công trên máy, sau khi xong chạy:
```bash
cd toeic-app && git add -A && git commit -m "them de moi" && git push
```
Web tự cập nhật sau ~1 phút.

Web app luyện thi TOEIC (Listening + Reading) dựng từ bộ đề của bạn:

| Đề | Nội dung | Số câu |
|---|---|---|
| Mock Test 5 — Listening | Part 1–4 đầy đủ, audio gốc ~46 phút | 100 |
| Mock Test 5 — Reading | Part 5–7, câu 101–163 (PDF gốc thiếu 164–200) | 63 |
| Mock Test 3 — Reading | Part 5–7, câu 101–168 (PDF gốc thiếu 169–200) | 68 |

## Cách chạy

**Cách 1 (dễ nhất):** nhấp đúp file `Start TOEIC App.command` → trình duyệt tự mở.

**Cách 2:** chạy tay trong Terminal:

```bash
cd toeic-app
python3 server.py
# rồi mở http://localhost:8765
```

> Cần chạy qua server (không mở trực tiếp `index.html`) để audio tua/seek được đúng đoạn.

## Tính năng

- **Thi thử**: Listening chạy theo audio gốc như thi thật (không tua được); Reading có đồng hồ đếm ngược, hết giờ tự nộp.
- **Luyện từng câu**: chọn đáp án → bấm "Kiểm tra" xem ngay đáp án + giải thích tiếng Việt; nghe lại đúng đoạn audio của từng câu/hội thoại.
- **Xem lại sau khi nộp**: đáp án đúng/sai từng câu, giải thích, transcript hội thoại, nghe lại từng đoạn.
- **Chấm điểm**: số câu đúng theo part + điểm quy đổi ước tính thang 495.
- **Xuất file đáp án**: sau khi nộp bài, bấm "📥 Xuất file đáp án đã chọn" để tải file .txt chỉ chứa các đáp án bạn đã chọn (không kèm đáp án đúng hay điểm) — tiện in ra hoặc gửi cho giáo viên chấm.
- **Công cụ luyện nghe cho người mất gốc**: nghe chậm 0.5x/0.75x + lặp đoạn (nút ở thanh audio); transcript hiện theo audio kiểu karaoke (bấm dòng để tua); bản dịch tiếng Việt từng đoạn; chế độ **✍️ Chép chính tả** chấm từng từ; **📒 Sổ từ vựng** 200+ từ trích từ chính bộ đề kèm flashcard ôn lặp lại ngắt quãng (từ Listening phát được đúng đoạn audio chứa từ).
- **📤 Upload đề mới**: trên bản online, bấm "Tải đề mới lên" để gửi PDF/audio vào hàng chờ cloud; khi máy cá nhân bật poller, đề sẽ được kéo về xử lý bằng Claude Code rồi tự cập nhật lên web. Khi chạy app local trên máy, upload đề sẽ lưu vào máy và khởi động xử lý ngay. Cần Claude Code CLI đã đăng nhập trên máy xử lý.
  - **Đề tổng hợp nhiều đề trong 1 file** (sách "RC1000", "10 Actual Tests"…): tick ô **"📚 File gồm nhiều đề"** khi upload — hệ thống tự **tách thành từng đề riêng** (mỗi đề 1 mục trong danh sách), không gộp chung. Kể cả không tick, pipeline vẫn tự phát hiện & tách (xem `PIPELINE.md` mục 1c).
- **Lịch sử làm bài** lưu trong trình duyệt (localStorage).

## Lưu ý quan trọng

- Bộ đề PDF gốc **không kèm answer key/transcript**. Toàn bộ đáp án, giải thích và transcript do AI (Claude) giải và biên soạn — Listening dựa trên transcript Whisper của audio gốc, Reading giải trực tiếp từ đề. Độ chính xác cao nhưng không tuyệt đối 100%; câu nào AI thấy chưa chắc sẽ có cờ ⚠ trong app.
- Phần Listening trong PDF "Mock Test 5" thực chất in footer "TEST 2" của sách gốc (Benzen English TOEIC) — audio khớp với phần này nên app dùng như một đề Listening hoàn chỉnh.

## Cấu trúc

```
toeic-app/
├── index.html          # app 1 trang (vanilla JS, không cần build)
├── css/style.css
├── js/app.js           # logic app
├── js/data.js          # toàn bộ dữ liệu đề (sinh tự động)
├── data/source/        # dữ liệu số hóa gốc (JSON) — để chỉnh sửa/mở rộng
├── assets/audio/mock5.mp3
├── assets/img/         # ảnh Part 1 + biểu đồ Part 3/4
├── server.py           # server local hỗ trợ HTTP Range cho audio
└── Start TOEIC App.command
```

Muốn sửa đáp án/giải thích: sửa JSON trong `data/source/` rồi chạy lại script ghép (hoặc sửa trực tiếp `js/data.js`).
