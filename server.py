#!/usr/bin/env python3
"""Local server for the TOEIC app.

- Serves the static app with HTTP Range support (needed for audio seeking/Safari).
- Upload API: teacher/student uploads test PDFs (+ optional MP3) into uploads/inbox/.
- Process API: launches Claude Code headless to digitize a pending upload into a playable test.

Usage:
    python3 server.py [port] [--lan]
    --lan : listen on 0.0.0.0 so người cùng mạng LAN (vd: cô giáo) mở được web để upload.
"""
import json, os, re, subprocess, sys, time, unicodedata
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import base64

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
INBOX = os.path.join(ROOT, "uploads", "inbox")

args = [a for a in sys.argv[1:]]
PORT = int(next((a for a in args if a.isdigit()), 8765))
HOST = "0.0.0.0" if "--lan" in args else "127.0.0.1"

ALLOWED_EXT = {".pdf", ".mp3", ".m4a", ".wav", ".png", ".jpg", ".jpeg"}
MAX_BODY = 300 * 1024 * 1024  # 300MB


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:40] or "de-moi"


def load_manifests():
    out = []
    if not os.path.isdir(INBOX):
        return out
    for d in sorted(os.listdir(INBOX), reverse=True):
        mf = os.path.join(INBOX, d, "manifest.json")
        if os.path.isfile(mf):
            try:
                m = json.load(open(mf))
                m["folder"] = d
                out.append(m)
            except Exception:
                pass
    return out


def process_upload(upload_id):
    """Launch Claude Code headless to digitize one pending upload. Returns error string or None."""
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", upload_id or ""):
        return "id không hợp lệ"
    folder = os.path.join(INBOX, upload_id)
    mf_path = os.path.join(folder, "manifest.json")
    if not os.path.isfile(mf_path):
        return "không tìm thấy đề này"
    manifest = json.load(open(mf_path))
    if manifest.get("status") == "processing":
        return "đề này đang được xử lý"
    claude = None
    for cand in [os.path.expanduser("~/.local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"]:
        if os.path.isfile(cand):
            claude = cand
            break
    if not claude:
        return "không tìm thấy Claude Code CLI trên máy"

    manifest["status"] = "processing"
    manifest["processStartedAt"] = int(time.time() * 1000)
    json.dump(manifest, open(mf_path, "w"), ensure_ascii=False, indent=1)

    multi_hint = (
        "\n\nLƯU Ý QUAN TRỌNG: người dùng đã đánh dấu file này GỒM NHIỀU ĐỀ trong 1 (đề tổng hợp). "
        "BẮT BUỘC tách thành từng đề riêng theo mục 1c của PIPELINE.md — mỗi đề ra 1 file "
        "data/custom/<id>-testNN-<kind>.json độc lập, TUYỆT ĐỐI KHÔNG gộp tất cả câu vào 1 test. "
        "Xử lý theo lô từng đề, commit dần để không bị treo quá hạn."
        if manifest.get("multi") else
        "\n\nLƯU Ý: hãy tự kiểm tra xem file có phải đề tổng hợp NHIỀU ĐỀ trong 1 không (số câu reset "
        "về 101 nhiều lần, lặp header 'READING TEST'/'Part 5', bìa 'TEST 1/2/3…'). Nếu đúng, TÁCH thành "
        "từng đề riêng theo mục 1c PIPELINE.md — không gộp chung thành 1 đề."
    )
    prompt = f"""Bạn đang ở project TOEIC app tại {ROOT}.
Nhiệm vụ: số hóa đề TOEIC vừa được upload trong thư mục uploads/inbox/{upload_id}/ thành bài luyện tập chạy được trong app.

Đọc kỹ và làm đúng theo quy trình trong file {ROOT}/PIPELINE.md (bắt buộc đọc trước khi làm).
Manifest của đề: uploads/inbox/{upload_id}/manifest.json (tên đề, danh sách file, loại đề, cờ "multi" nếu là đề tổng hợp).{multi_hint}

Khi hoàn tất: cập nhật manifest.json của đề với "status": "done" và "resultTestIds": [danh sách test id đã tạo].
Sau đó, nếu thư mục project là git repo có remote: chạy `git add -A && git commit -m "Thêm đề: <tên đề>" && git push` để web online (GitHub Pages) tự cập nhật đề mới.
Nếu thất bại không khắc phục được: đặt "status": "error" và "error": "<mô tả ngắn lý do bằng tiếng Việt>".
"""
    log = open(os.path.join(folder, "process.log"), "ab")
    # Scoped permissions: only the tools the digitization pipeline needs — no
    # unrestricted shell, no network tools, edits limited to this project dir (cwd).
    allowed = [
        "Read", "Write", "Edit", "Glob", "Grep", "Task", "Agent", "TodoWrite",
        "Bash(pdftoppm:*)", "Bash(pdfinfo:*)", "Bash(ffmpeg:*)", "Bash(whisper-cli:*)",
        "Bash(python3:*)", "Bash(node:*)",
        "Bash(mkdir:*)", "Bash(cp:*)", "Bash(mv:*)", "Bash(ls:*)", "Bash(rm:*)",
        "Bash(git add:*)", "Bash(git commit:*)", "Bash(git push:*)", "Bash(git status:*)",
    ]
    # Prompt đưa qua file. Trên macOS dùng caffeinate để máy không ngủ; trên Linux
    # VPS thì chạy trực tiếp để poller có thể hoạt động như cloud processor.
    prompt_path = os.path.join(folder, "prompt.txt")
    with open(prompt_path, "w") as pf:
        pf.write(prompt)
    import shlex
    keep_awake = "/usr/bin/caffeinate -i " if os.path.isfile("/usr/bin/caffeinate") else ""
    cmd = (
        f'cd {shlex.quote(ROOT)} && exec {keep_awake}{shlex.quote(claude)} '
        f'-p "$(cat {shlex.quote(prompt_path)})" --permission-mode acceptEdits '
        f'--allowedTools {shlex.quote(" ".join(allowed))}'
    )
    shell = "/bin/zsh" if os.path.isfile("/bin/zsh") else "/bin/sh"
    env = {
        **os.environ,
        "PATH": "/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
        "HOME": os.path.expanduser("~"),
        "SHELL": shell,
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "TERM": "dumb",
    }
    proc = subprocess.Popen(
        # Shell KHÔNG login (-c): tránh nạp profile người dùng (đụng dữ liệu app khác
        # → macOS hỏi quyền mỗi lần). Env cần thiết đã khai báo tường minh ở trên.
        [shell, "-c", cmd],
        cwd=ROOT, stdout=log, stderr=log, env=env,
        stdin=subprocess.DEVNULL, start_new_session=True,
    )
    log.close()
    # Claude auth/env errors fail immediately; surface them now instead of
    # leaving the upload as "processing" until poller watchdog times out.
    time.sleep(1.5)
    if proc.poll() is not None and proc.returncode != 0:
        try:
            tail = open(os.path.join(folder, "process.log"), "rb").read()[-1200:].decode("utf-8", "replace").strip()
        except Exception:
            tail = ""
        if "Not logged in" in tail or "Please run /login" in tail:
            msg = "Claude Code chưa đăng nhập — mở Terminal chạy `claude /login` rồi thử lại"
        else:
            msg = "Claude Code thoát ngay khi khởi động" + (f": {tail.splitlines()[-1]}" if tail else "")
        manifest = json.load(open(mf_path))
        if manifest.get("status") == "processing":
            manifest["status"] = "error"
            manifest["error"] = msg
            json.dump(manifest, open(mf_path, "w"), ensure_ascii=False, indent=1)
        return msg
    return None


class Handler(SimpleHTTPRequestHandler):
    # ---------- Range support ----------
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        rng = self.headers.get("Range")
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        if not m:
            return super().send_head()
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_error(416)
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._range_remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "_range_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        self._range_remaining = None

    # ---------- API ----------
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/uploads":
            return self._json(200, {"uploads": load_manifests()})
        return super().do_GET()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BODY:
                return self._json(413, {"error": "File quá lớn (giới hạn 300MB)"})
            body = json.loads(self.rfile.read(length))
        except Exception:
            return self._json(400, {"error": "Body không hợp lệ"})

        if self.path == "/api/upload":
            name = (body.get("name") or "").strip() or "Đề mới"
            files = body.get("files") or []
            kind = body.get("kind") or "auto"
            multi = bool(body.get("multi"))
            if not files:
                return self._json(400, {"error": "Chưa chọn file nào"})
            saved = []
            upload_id = time.strftime("%Y%m%d-%H%M%S") + "-" + slugify(name)
            folder = os.path.join(INBOX, upload_id)
            os.makedirs(folder, exist_ok=True)
            for f in files:
                fname = os.path.basename(f.get("name") or "file")
                ext = os.path.splitext(fname)[1].lower()
                if ext not in ALLOWED_EXT:
                    return self._json(400, {"error": f"Loại file không hỗ trợ: {fname}"})
                try:
                    raw = base64.b64decode(f.get("data") or "")
                except Exception:
                    return self._json(400, {"error": f"File lỗi: {fname}"})
                with open(os.path.join(folder, fname), "wb") as out:
                    out.write(raw)
                saved.append({"name": fname, "size": len(raw)})
            manifest = {
                "id": upload_id, "name": name, "kind": kind, "multi": multi,
                "files": saved, "uploadedAt": int(time.time() * 1000),
                "status": "pending",
            }
            json.dump(manifest, open(os.path.join(folder, "manifest.json"), "w"), ensure_ascii=False, indent=1)
            return self._json(200, {"ok": True, "id": upload_id})

        if self.path == "/api/process":
            err = process_upload(body.get("id") or "")
            if err:
                return self._json(400, {"error": err})
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "Không tồn tại"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    os.makedirs(INBOX, exist_ok=True)
    print(f"TOEIC app đang chạy tại: http://localhost:{PORT}")
    if HOST == "0.0.0.0":
        print("Chế độ LAN: người cùng mạng có thể truy cập qua IP máy này (xem ipconfig getifaddr en0)")
    print("Nhấn Ctrl+C để dừng.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
