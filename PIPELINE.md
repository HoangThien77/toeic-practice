# PIPELINE — Số hóa đề TOEIC upload thành bài luyện tập trong app

Tài liệu này dành cho Claude Code khi xử lý một đề trong `uploads/inbox/<upload-id>/`.

**TỐI ƯU THỜI GIAN — bắt buộc:** phóng subagent SONG SONG tối đa, không làm tuần tự:
- Ngay sau bước khảo sát: phóng đồng thời TẤT CẢ agent số hóa (mỗi part 1 agent) + transcribe audio (nếu có) cùng lúc.
- KHÔNG chờ mọi part số hóa xong mới giải: part nào có JSON xong thì phóng agent giải part đó ngay (pipeline, không barrier).
- Cắt ảnh (P1/P6/P7/graphic) chạy song song với việc giải đề.
- Không tự kiểm tra lại việc đã xong (agent con đã validate JSON); chỉ chạy sanity check cuối bằng assemble.py.

## Bối cảnh app

- App tĩnh (vanilla JS) đọc toàn bộ dữ liệu từ `js/data.js`, file này được sinh bởi `python3 data/assemble.py`.
- `assemble.py` tự gộp mọi file `data/custom/*.json` — mỗi file là MỘT test object hoàn chỉnh (schema bên dưới). Bạn chỉ cần tạo JSON đúng schema rồi chạy assemble.
- Audio đặt tại `assets/audio/`, ảnh custom đặt tại `assets/img/custom/<upload-id>/`.
- Công cụ có sẵn: `pdftoppm` (poppler, đã cài qua brew), `whisper-cli` (brew) + model `tools/ggml-small.en.bin`, Python3 + pypdf + PIL, node.

## Quy trình

### 1. Khảo sát file
- Đọc `uploads/inbox/<id>/manifest.json` (tên đề, files, kind: auto/reading/listening/both).
- PDF: thử trích text bằng pypdf; nếu trang không có text → là bản scan, phải đọc bằng vision.
- Render toàn bộ trang PDF thành ảnh để khảo sát: `pdftoppm -jpeg -r 50 <file>.pdf <outdir>/p` (thumbnail), sau đó dùng 1 subagent đọc toàn bộ thumbnail để lập bản đồ trang: phần nào (Part 1-7), câu số mấy, trang nào có ảnh/biểu đồ, có answer key/transcript in sẵn không.
- Nếu PDF có answer key in sẵn → dùng nó làm đáp án gốc (vẫn viết giải thích). Ghi chú trong desc là "đáp án theo đề gốc".

### 2. Số hóa nội dung (subagent song song, chia theo part)
- Mỗi subagent Read trực tiếp PDF theo trang (Read tool hỗ trợ `pages`), xuất JSON trung gian vào thư mục upload.
- Reading P5: `{questions:[{number, question("..._____..."), choices{A..D}}]}`
- Reading P6/P7: passages với `text` (giữ xuống dòng bằng \n, blank inline `[131]`), questions kèm stem (P7) hoặc chỉ choices (P6).
- Listening P3/P4: câu hỏi + choices in trên đề; ghi nhận graphic (bảng/biểu đồ) và trang của nó.
- Listening P1/P2: không có gì in trên đề ngoài ảnh P1 — chỉ cần vị trí ảnh.
- QUAN TRỌNG: yêu cầu subagent validate JSON parse được và đủ số câu, báo lại câu nào không đọc rõ.

### 3. Ảnh — BẮT BUỘC cho P1, graphic P3/P4, và bài đọc P6/P7
- Render trang liên quan ở 150dpi: `pdftoppm -jpeg -r 150 -f <from> -l <to> ...`
- Crop bằng PIL (xem vị trí bằng cách Read ảnh trang, crop, Read lại crop để kiểm tra, chỉnh nếu cắt hụt).
- Lưu vào `assets/img/custom/<upload-id>/`:
  - Listening P1: ảnh từng câu `p1-q1.jpg`...
  - Graphic P3/P4: `g-<tên>.jpg`
  - **Bài đọc Reading P6/P7: crop NGUYÊN passage (kèm dòng "Questions X-Y refer to...") thành `passage-q<câuĐầu>.jpg`** — app hiển thị ảnh gốc thay vì chữ gõ lại (giống đề thật). KHÔNG gồm question stems/choices bên dưới, không gồm header/footer trang. Vẫn phải transcribe text passage (bước 2) để giải đề, nhưng UI sẽ dùng ảnh.

### 4. Audio (nếu có file nghe)
- Convert + transcribe:
  ```
  ffmpeg -y -i <audio> -ar 16000 -ac 1 /tmp/a16k.wav
  whisper-cli -m tools/ggml-small.en.bin -f /tmp/a16k.wav -oj -of <outdir>/transcript -t 8
  ```
- Parse transcript JSON tìm marker thời gian (xem mẫu regex trong `data/source/` pipeline cũ):
  - `part one|two|three|four` → mốc part
  - `number N` (số hoặc chữ one..ten) → mốc từng câu; end = start của marker kế tiếp
  - `questions X through Y refer` (kể cả bị tách 2 segment liên tiếp "questions 83" + "through 85 refer...") → block hội thoại P3/P4; block end = start block kế / hết part
- Sinh `timings` (schema dưới) + transcript group theo câu/block để subagent giải đề dùng.
- Copy audio gốc vào `assets/audio/<upload-id>.mp3`.

### 5. Giải đề + giải thích (subagent song song)
- Nếu đề không có answer key: giải từng câu — Reading từ nội dung, Listening từ transcript (P1 phải Read ảnh đã crop).
- Mỗi câu: `answer` (chữ cái) + `explanation` TIẾNG VIỆT ngắn gọn (1-3 câu; Reading P5/P6 nêu điểm ngữ pháp/từ vựng; P7 & Listening trích câu tiếng Anh làm bằng chứng). Câu không chắc chắn → `"uncertain": true`.
- Listening: kèm transcript đã làm sạch cho từng câu (P1/P2 dạng spoken) / từng block (P3/P4).

### 6. Ghép thành test object và build
Tạo `data/custom/<test-id>.json` cho MỖI section (một upload có thể ra 2 test: một listening, một reading). `<test-id>` đặt theo upload, vd `de-co-giao-15-listening`. Schema:

```jsonc
{
  "id": "de-co-giao-15-reading",
  "kind": "reading",                  // "reading" | "listening"
  "title": "Đề cô giáo 15 — Reading", // lấy tên từ manifest
  "desc": "Part 5–7, câu 101–200",   // mô tả thật (số câu, thiếu gì ghi rõ)
  "timerMin": 75,                     // reading only; tỉ lệ 75' cho 100 câu, làm tròn 5'
  "custom": true,
  "audioSrc": "assets/audio/<id>.mp3",// listening only
  "timings": {                        // listening only
    "parts": {"1": {"start": 31.7, "end": 266.4}},
    "questions": {"1": {"start": 98.8, "end": 123.0}},
    "blocks": [{"questions": [32,33,34], "start": 832.8, "end": 906.2, "convEnd": 869.3}]
  },
  "parts": [
    {
      "part": 5,
      "directions": "chỉ dẫn ngắn tiếng Việt",
      "items": [
        // câu đơn (P1/P2/P5):
        {"n": 101, "question": "câu có _____", "choices": {"A": "..","B":"..","C":"..","D":".."},
         "answer": "C", "explanation": "vi...", "uncertain": false,
         "image": "assets/img/custom/<uid>/p1-q1.jpg",   // P1 only
         "spoken": {"question": "..", "choices": {"A": ".."}}, // P1/P2 only
         "audio": {"start": 98.8, "end": 123.0}},            // P1/P2 only
        // nhóm (P3/P4 hội thoại, P6/P7 passage):
        {"questions": [{"n": 32, "question": "..", "choices": {...}, "answer": "B", "explanation": ".."}],
         "audio": {"start": 832.8, "end": 906.2},   // P3/P4 only
         "transcript": "hội thoại đã làm sạch",      // P3/P4 only
         "graphicImg": "assets/img/custom/<uid>/g-x.jpg", // nếu có
         "img": "assets/img/custom/<uid>/passage-q147.jpg", // P6/P7: ảnh passage gốc — BẮT BUỘC nếu PDF là scan
         "ptype": "e-mail", "title": "..", "text": "passage với [131] blank markers"} // P6/P7 (text vẫn giữ làm dự phòng)
      ]
    }
  ]
}
```

Lưu ý bắt buộc:
- P2 choices chỉ có A,B,C. P1 A-D với giá trị "" (nội dung nằm trong spoken).
- Mỗi test: số câu `n` không trùng nhau. `answer` phải là key có trong `choices`.
- Chạy `python3 data/assemble.py` — phải thấy dòng `custom test loaded: <id>` và sanity check pass.
- `node --check js/data.js` phải OK.

### 7. Hoàn tất
- Cập nhật `uploads/inbox/<id>/manifest.json`: `"status": "done"`, `"resultTestIds": [...]`.
- Nếu lỗi không khắc phục được: `"status": "error"`, `"error": "<lý do ngắn tiếng Việt>"`.
- Dọn file trung gian (ảnh render tạm) khỏi thư mục upload, giữ lại file gốc + manifest + các JSON số hóa (để sửa sau nếu cần).
- **Tự động đăng web online**: nếu project là git repo có remote → `git add -A && git commit -m "Thêm đề: <tên>" && git push` (GitHub Pages tự cập nhật sau ~1 phút; uploads/ và tools/ đã nằm trong .gitignore nên không bị đẩy lên).
