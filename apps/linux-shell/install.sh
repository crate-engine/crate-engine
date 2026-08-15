#!/usr/bin/env bash
# Install the native Linux shell (parity twin of mac-shell/build.sh).
# No compile: the shell is python3 + GTK3 + WebKitGTK 4.1 via PyGObject —
# distro-repo parts, checked here and named plainly when missing. Produces:
#   ~/.local/lib/crate-shell/main.py            (the app)
#   ~/.local/share/applications/crate-engine.desktop   (launcher entry)
#   ~/.local/share/icons/.../crate-engine.png   (bolt icon, when a chromium
#                                                can render it headless)
set -euo pipefail
cd "$(dirname "$0")"

echo "== [1/3] dependencies (distro parts, no downloads)"
if ! python3 -c 'import gi; gi.require_version("Gtk","3.0"); gi.require_version("WebKit2","4.1")' 2>/dev/null; then
  echo "missing GTK/WebKitGTK python bindings. Install them with your package manager:"
  echo "  Debian/Ubuntu: sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1"
  echo "  Fedora:        sudo dnf install python3-gobject gtk3 webkit2gtk4.1"
  echo "  Arch:          sudo pacman -S python-gobject gtk3 webkit2gtk-4.1"
  exit 1
fi
python3 -c "import ast; ast.parse(open('main.py').read())"

echo "== [2/3] app → ~/.local/lib/crate-shell"
LIB="$HOME/.local/lib/crate-shell"
mkdir -p "$LIB"
install -m 0755 main.py "$LIB/main.py"

echo "== [3/3] launcher entry (+ icon when renderable)"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
ICON="$ICON_DIR/crate-engine.png"
for CHROME in google-chrome chromium chromium-browser; do
  if command -v "$CHROME" >/dev/null && [ ! -f "$ICON" ] && [ -f ../mac-shell/icon.html ]; then
    mkdir -p "$ICON_DIR"
    "$CHROME" --headless=new --screenshot="$ICON" --window-size=512,512 \
      --default-background-color=00000000 --hide-scrollbars "file://$PWD/../mac-shell/icon.html" >/dev/null 2>&1 || true
    break
  fi
done
APPS="$HOME/.local/share/applications"
mkdir -p "$APPS"
cat > "$APPS/crate-engine.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Crate Engine
Comment=The cockpit window — the engine and the team live behind it
Exec=python3 $LIB/main.py
Icon=${ICON}
Terminal=false
Categories=Development;
EOF
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true

echo "done — Crate Engine is in your app launcher (config: ~/.crate/app-shell.conf)"
