#!/bin/zsh
# Cài "người đưa thư": máy Mac tự kiểm tra hộp đề trên cloud mỗi 10 phút,
# có đề mới thì tự tải về, tự xử lý bằng Claude, tự đăng lên web online.
APP="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.toeic.poller.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$APP/uploads"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.toeic.poller</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string>
    <string>$APP/poller.py</string>
  </array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$APP/uploads/poller.log</string>
  <key>StandardErrorPath</key><string>$APP/uploads/poller.log</string>
</dict></plist>
EOF
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"
echo "✅ Đã cài poller — máy sẽ tự kiểm tra đề mới mỗi 2 phút (log: uploads/poller.log)"
read -k 1 -s "?Nhấn phím bất kỳ để đóng..."
