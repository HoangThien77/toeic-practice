#!/usr/bin/env python3
"""Inbox poller — chạy định kỳ trên máy Mac (launchd).

Kéo repo private toeic-inbox (nơi Worker cất đề giáo viên upload từ web),
đưa đề mới vào uploads/inbox/ rồi kích hoạt pipeline xử lý (Claude headless).
Pipeline xử lý xong sẽ tự git push app -> web online có đề. Poller cũng đồng bộ
trạng thái (processing/done/error) ngược lại repo inbox để web hiển thị đúng.
"""
import base64, fcntl, json, os, shutil, subprocess, sys, time

APP = os.path.dirname(os.path.abspath(__file__))
INBOX_REPO = os.path.join(os.path.dirname(APP), "toeic-inbox")
INBOX_URL = "https://github.com/HoangThien77/toeic-inbox.git"
LOCAL_INBOX = os.path.join(APP, "uploads", "inbox")
LOCK = "/tmp/toeic-poller.lock"
GIT_ENV = {**os.environ, "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, env=GIT_ENV, capture_output=True, text=True)


def sync_repo():
    if not os.path.isdir(INBOX_REPO):
        r = run(["git", "clone", "-q", INBOX_URL, INBOX_REPO], cwd=os.path.dirname(APP))
        if r.returncode != 0:
            log("clone lỗi: " + r.stderr.strip()[:200])
            return False
    r = run(["git", "pull", "-q", "--rebase"], cwd=INBOX_REPO)
    if r.returncode != 0:
        log("pull lỗi: " + r.stderr.strip()[:200])
    return True


def push_status(upload_id, status, extra=None):
    mf_path = os.path.join(INBOX_REPO, "inbox", upload_id, "manifest.json")
    if not os.path.isfile(mf_path):
        return
    m = json.load(open(mf_path))
    m["status"] = status
    if extra:
        m.update(extra)
    json.dump(m, open(mf_path, "w"), ensure_ascii=False, indent=1)
    run(["git", "add", "-A"], cwd=INBOX_REPO)
    run(["git", "commit", "-qm", f"status {upload_id}: {status}"], cwd=INBOX_REPO)
    run(["git", "push", "-q"], cwd=INBOX_REPO)


def reassemble(src_dir, dst_dir):
    """Ghép các file .chunkN thành file gốc trong dst_dir."""
    os.makedirs(dst_dir, exist_ok=True)
    chunks = {}
    for f in os.listdir(src_dir):
        if f == "manifest.json":
            continue
        if ".chunk" in f:
            base, idx = f.rsplit(".chunk", 1)
            chunks.setdefault(base, []).append((int(idx), f))
        else:
            shutil.copy2(os.path.join(src_dir, f), os.path.join(dst_dir, f))
    for base, parts in chunks.items():
        parts.sort()
        with open(os.path.join(dst_dir, base), "wb") as out:
            for _, f in parts:
                with open(os.path.join(src_dir, f), "rb") as chunk:
                    out.write(chunk.read())


def main():
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return  # lần chạy trước còn dang dở

    if not sync_repo():
        return

    sys.path.insert(0, APP)
    from server import process_upload  # tái dùng pipeline sẵn có (spawn claude headless)

    remote_root = os.path.join(INBOX_REPO, "inbox")
    if not os.path.isdir(remote_root):
        return
    for uid in sorted(os.listdir(remote_root)):
        src = os.path.join(remote_root, uid)
        mf_path = os.path.join(src, "manifest.json")
        if not os.path.isfile(mf_path):
            continue
        remote = json.load(open(mf_path))
        local_dir = os.path.join(LOCAL_INBOX, uid)
        local_mf = os.path.join(local_dir, "manifest.json")

        if remote.get("status") == "pending" and not os.path.isdir(local_dir):
            log(f"đề mới từ web: {uid} — tải về và xử lý")
            reassemble(src, local_dir)
            manifest = {
                "id": uid, "name": remote.get("name", uid), "kind": remote.get("kind", "auto"),
                "files": [{"name": f, "size": os.path.getsize(os.path.join(local_dir, f))}
                          for f in os.listdir(local_dir) if f != "manifest.json"],
                "uploadedAt": remote.get("uploadedAt"), "status": "pending", "fromWeb": True,
            }
            json.dump(manifest, open(local_mf, "w"), ensure_ascii=False, indent=1)
            err = process_upload(uid)
            push_status(uid, "error" if err else "processing", {"error": err} if err else None)
            if err:
                log(f"{uid}: không kích hoạt được — {err}")

        elif os.path.isfile(local_mf):
            local = json.load(open(local_mf))
            # watchdog: "processing" quá 45 phút mà log im lặng >20 phút → coi là treo, đánh dấu lỗi
            if local.get("status") == "processing":
                started = (local.get("processStartedAt") or 0) / 1000
                log_path = os.path.join(local_dir, "process.log")
                log_age = time.time() - os.path.getmtime(log_path) if os.path.isfile(log_path) else 1e9
                if time.time() - started > 45 * 60 and log_age > 20 * 60:
                    log(f"{uid}: xử lý treo quá hạn — đánh dấu lỗi để có thể thử lại")
                    subprocess.run(["pkill", "-f", uid], env=GIT_ENV, capture_output=True)
                    local["status"] = "error"
                    local["error"] = "Xử lý bị treo quá hạn — hãy bấm Thử lại"
                    json.dump(local, open(local_mf, "w"), ensure_ascii=False, indent=1)
            if local.get("status") in ("done", "error") and remote.get("status") not in ("done", "error"):
                log(f"{uid}: đồng bộ trạng thái {local['status']} lên web")
                # dọn rác: đề đã xong thì xoá file gốc khỏi kho chờ cloud, chỉ giữ manifest để hiển thị trạng thái
                if local.get("status") == "done":
                    for f in os.listdir(src):
                        if f != "manifest.json":
                            os.remove(os.path.join(src, f))
                push_status(uid, local["status"], {
                    "resultTestIds": local.get("resultTestIds"), "error": local.get("error"),
                })


if __name__ == "__main__":
    main()
