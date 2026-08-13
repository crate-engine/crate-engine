#!/usr/bin/env bash
# Build + install the native Mac shell (PDR dev/pdr/native-mac-shell.md).
# Local, unsigned — built on the operator's own machine with Apple's own
# tools (swiftc from the Command Line Tools). Produces:
#   /Applications/Crate Engine.app   (⚡ bolt icon, owns the cockpit window)
set -euo pipefail
cd "$(dirname "$0")"

APP="/Applications/Crate Engine.app"
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/crate-shell.XXXXXX")"

echo "== [1/3] icon (bolt → icns)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -x "$CHROME" ] && [ ! -f AppIcon.icns ]; then
  "$CHROME" --headless=new --screenshot="$BUILD/icon-1024.png" --window-size=1024,1024 \
    --default-background-color=00000000 --hide-scrollbars "file://$PWD/icon.html" >/dev/null 2>&1
  ICONSET="$BUILD/AppIcon.iconset"; mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$BUILD/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2))
    sips -z $d $d "$BUILD/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o AppIcon.icns
fi
[ -f AppIcon.icns ] || { echo "no AppIcon.icns and no Chrome to render one — need either"; exit 1; }

echo "== [2/3] compile (swiftc)"
swiftc -O -o "$BUILD/CrateEngine" main.swift -framework Cocoa -framework WebKit

echo "== [3/3] bundle → $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD/CrateEngine" "$APP/Contents/MacOS/CrateEngine"
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Crate Engine</string>
  <key>CFBundleDisplayName</key><string>Crate Engine</string>
  <key>CFBundleIdentifier</key><string>ai.crate-engine.shell</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>CrateEngine</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict></plist>
PLIST
rm -rf "$BUILD"
echo "done — Crate Engine.app installed (⚡ in the Dock; config: ~/.crate/app-shell.conf)"
