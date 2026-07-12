#!/bin/zsh
# Cài "người đưa thư": máy Mac tự kiểm tra hộp đề trên cloud mỗi 1 phút,
# có đề mới thì tự tải về, tự xử lý bằng Claude, tự đăng lên web online.

# Đường dẫn VẬT LÝ (pwd -P giải hết symlink) — bắt buộc, để plist không bao giờ
# trỏ vào một symlink nằm trong Documents.
APP="$(cd "$(dirname "$0")" && pwd -P)"

# CHẶN TÁI DIỄN LỖI: macOS (nhất là 26+) chặn tiến trình nền (launchd) truy cập
# ~/Documents, ~/Desktop, ~/Downloads (quyền riêng tư TCC) -> poller sẽ chết
# ngay (exit 78 EX_CONFIG). Nếu project nằm trong các thư mục này, dừng lại.
case "$APP" in
  "$HOME/Documents/"*|"$HOME/Desktop/"*|"$HOME/Downloads/"*)
    echo "⚠️  KHÔNG cài được: project đang ở '$APP'."
    echo "   macOS chặn tiến trình nền truy cập Documents/Desktop/Downloads,"
    echo "   nên poller sẽ không chạy được ở đây."
    echo "   → Hãy chuyển cả thư mục project ra ngoài (ví dụ ~/toeic-practice)"
    echo "     rồi chạy lại file này từ vị trí mới."
    read -k 1 -s "?Nhấn phím bất kỳ để đóng..."
    exit 1 ;;
esac

PLIST="$HOME/Library/LaunchAgents/com.toeic.poller.plist"
LABEL="com.toeic.poller"
mkdir -p "$HOME/Library/LaunchAgents" "$APP/uploads"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string>
    <string>$APP/poller.py</string>
  </array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$APP/uploads/poller.log</string>
  <key>StandardErrorPath</key><string>$APP/uploads/poller.log</string>
</dict></plist>
EOF

# Nạp lại (bootout/bootstrap là API mới của macOS; fallback về load/unload nếu cần)
GUI="gui/$(id -u)"
launchctl bootout "$GUI/$LABEL" 2>/dev/null
launchctl unload "$PLIST" 2>/dev/null
if ! launchctl bootstrap "$GUI" "$PLIST" 2>/dev/null; then
  launchctl load "$PLIST"
fi
launchctl kickstart -k "$GUI/$LABEL" 2>/dev/null

# Kiểm tra nhanh: chạy thử poller 1 lần ngay để xác nhận không lỗi cấu hình
sleep 2
CODE="$(launchctl print "$GUI/$LABEL" 2>/dev/null | awk -F'= ' '/last exit code/{print $2}')"
echo "✅ Đã cài poller — máy tự kiểm tra đề mới mỗi 1 phút (log: uploads/poller.log)"
echo "   Vị trí: $APP"
echo "   Trạng thái lần chạy gần nhất: ${CODE:-(chưa có)}"
case "$CODE" in
  0|"") echo "   → OK." ;;
  *78*) echo "   ⚠️ Vẫn lỗi EX_CONFIG (78) — thư mục có thể vẫn bị macOS chặn. Kiểm tra lại vị trí." ;;
  *)    echo "   ⚠️ Poller thoát mã $CODE — xem log: $APP/uploads/poller.log" ;;
esac
read -k 1 -s "?Nhấn phím bất kỳ để đóng..."
