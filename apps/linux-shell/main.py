#!/usr/bin/env python3
# Crate Engine — the native Linux shell (parity twin of apps/mac-shell/main.swift).
#
# Same doctrine as the Mac shell: a real desktop app that OWNS the cockpit
# window, built from the platform's own parts (GTK3 + WebKitGTK 4.1 via
# PyGObject — no compile step, no Electron download; these ship in every
# major distro's repos). The window's content is the engine's own cockpit
# page; this shell just runs the operator's launch flow (`crate open
# [--remote <host>] --print-url`) and loads the door it prints. Closing the
# window never stops the engine or the team — the shell is a viewport, the
# engine is the truth.
#
# Parity features carried over (each one a lesson the Mac shell paid for):
#   - branded starting/asleep/error screens with Retry (crate-retry://)
#   - crate-ext:// hands preview URLs to real Chrome / the default browser
#   - window.crateShell=true at document start (the page's shell detection)
#   - non-gesture window.open allowed (menu + auto-deploy are not gestures)
#   - View menu: Team Ctrl+1 / Context Ctrl+2 / Health Ctrl+3 / Design
#     Studio Ctrl+4 — items disabled until the cockpit page is loaded
#   - Edit>Copy runs the page's crateCopySelection bridge (xterm selections)
#   - satellite windows for window.open; /studio frames are FIXTURES:
#     remembered positions (~/.crate/shell-geometry.json), mobile 375x812
#     SIZE-LOCKED with a real iPhone UA, shown without stealing focus
#
# Probe mode (headless e2e): CRATE_SHELL_PROBE=1 runs the real launch flow
# under xvfb, prints "PROBE OK" once the cockpit page commits, and exits.
import json
import os
import re
import subprocess
import threading
import urllib.parse
import urllib.request

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402

HOME = os.path.expanduser("~")
CRATE = os.path.join(HOME, ".local", "bin", "crate")
CONF = os.path.join(HOME, ".crate", "app-shell.conf")
GEOM = os.path.join(HOME, ".crate", "shell-geometry.json")
IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)
PROBE = os.environ.get("CRATE_SHELL_PROBE") == "1"


def brand_html(message, sub, retry):
    retry_html = '<a class="retry" href="crate-retry://go">Retry</a>' if retry else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{background:#0b0e14;color:#f1f3f6;font:15px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}
.box{{text-align:center;max-width:520px;padding:0 24px}}
.bolt{{width:52px;height:52px;fill:#e2a33c;animation:pulse 1.2s infinite}}
@keyframes pulse{{0%,100%{{opacity:1}}50%{{opacity:.35}}}}
h1{{font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:#e2a33c;margin:18px 0 10px;font-weight:600}}
p{{color:#8b94a5;line-height:1.6;font-size:13.5px;white-space:pre-wrap}}
.retry{{display:inline-block;margin-top:22px;padding:10px 26px;border:1px solid #e2a33c;color:#e2a33c;text-decoration:none;font:600 12px sans-serif;letter-spacing:.14em;text-transform:uppercase}}
.retry:hover{{background:rgba(226,163,60,.12)}}
</style></head><body><div class="box">
<svg class="bolt" viewBox="0 0 24 24"><path d="M13.2 2 4.8 13.4h5L8.6 22l10.6-13.2h-6.2L13.2 2z"/></svg>
<h1>{message}</h1><p>{sub}</p>{retry_html}
</div></body></html>"""


def looks_asleep(msg):
    """Pack 5: the server host sleeping overnight is the COMMON morning
    failure — name the likely cause in plain words and offer Retry."""
    needles = [
        "no route to host", "operation timed out", "timed out", "connection refused",
        "connection timed out", "could not resolve", "network is unreachable", "host is down",
    ]
    low = msg.lower()
    return any(n in low for n in needles)


def read_remote_host():
    try:
        with open(CONF, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if line.startswith("REMOTE="):
                    return line[len("REMOTE="):].strip("\"' ")
    except OSError:
        pass
    return ""


def launch_engine(remote):
    """Run the launch flow; return ("ok", url) or ("err", message)."""
    if not os.access(CRATE, os.X_OK):
        return ("err", "crate isn't installed at ~/.local/bin/crate — install it first:\ncurl -fsSL https://crate-engine.ai/get | bash")
    argv = [CRATE, "open"] + (["--remote", remote] if remote else []) + ["--print-url"]
    env = dict(os.environ)
    env["PATH"] = f"{HOME}/.local/bin:/usr/local/bin:" + env.get("PATH", "/usr/bin:/bin")
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=150, env=env)
    except subprocess.TimeoutExpired:
        return ("err", "the launch flow timed out (150s) — try it by hand to see why:\ncrate open" + (f" --remote {remote}" if remote else ""))
    except OSError as e:
        return ("err", f"could not run the crate launcher: {e}")
    lines = [l.strip() for l in p.stdout.split("\n") if l.strip().startswith(("http://", "https://"))]
    if not lines:
        detail = (p.stderr + "\n" + p.stdout).strip()
        return ("err", detail or "the launch flow printed no cockpit URL")
    return ("ok", lines[-1])


def load_geometry():
    try:
        with open(GEOM, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_geometry(key, win, size=True):
    g = load_geometry()
    x, y = win.get_position()
    if size:
        w, h = win.get_size()
        g[key] = [x, y, w, h]
    else:
        g[key] = [x, y] + list(g.get(key, [0, 0, 0, 0])[2:4])
    try:
        os.makedirs(os.path.dirname(GEOM), exist_ok=True)
        with open(GEOM, "w", encoding="utf-8") as fh:
            json.dump(g, fh)
    except OSError:
        pass


def restore_geometry(key, win):
    g = load_geometry().get(key)
    if isinstance(g, list) and len(g) >= 2:
        win.move(int(g[0]), int(g[1]))
        if len(g) >= 4 and g[2] and g[3] and win.get_resizable():
            win.resize(int(g[2]), int(g[3]))
        return True
    return False


class Shell:
    def __init__(self):
        self.cockpit_ready = False
        self.view_items = []
        # THE FLEET RAIL (PDR fleet-rail): the LOCAL hub engine's tokened
        # door — the Fleet menu reads its /api/fleet and swaps this webview
        # between engine cockpits. None until the hub answers.
        self.hub_url = None
        self.satellites = []

        self.win = Gtk.Window(title="Crate Engine")
        self.win.set_default_size(1440, 900)
        restore_geometry("main", self.win) or self.win.set_position(Gtk.WindowPosition.CENTER)
        self.win.connect("destroy", Gtk.main_quit)
        self.win.connect("configure-event", lambda w, e: (save_geometry("main", w), False)[1])

        # One content manager for the whole shell: the page detects the shell
        # via window.crateShell (satellites inherit — same configuration).
        ucm = WebKit2.UserContentManager()
        ucm.add_script(WebKit2.UserScript(
            "window.crateShell=true",
            WebKit2.UserContentInjectedFrames.ALL_FRAMES,
            WebKit2.UserScriptInjectionTime.START, None, None,
        ))
        self.web = WebKit2.WebView(user_content_manager=ucm)
        self._settings(self.web)
        self.web.connect("decide-policy", self.on_policy)
        self.web.connect("create", self.on_create)
        self.web.connect("load-changed", self.on_load_changed)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        box.pack_start(self.build_menubar(), False, False, 0)
        box.pack_start(self.web, True, True, 0)
        self.win.add(box)
        self.win.show_all()
        self.start_launch()

    def _settings(self, web):
        s = web.get_settings()
        s.set_enable_developer_extras(True)
        # The studio bug, learned once on the Mac: the frames open from a MENU
        # action and a WATCHER — neither is a user gesture, and WebKit drops
        # non-gesture window.open by default. Popups still route through our
        # create handler (real GTK windows).
        s.set_javascript_can_open_windows_automatically(True)

    # ── launch flow (first boot AND every Retry press run exactly this) ──
    def start_launch(self):
        remote = read_remote_host()
        where = f"on {remote}" if remote else "on this machine"
        self.web.load_html(brand_html(
            "Starting the engine",
            f"Bringing the Crate Engine up {where} — checking the server, opening the tunnel. A few seconds.",
            False), None)

        def work():
            status, payload = launch_engine(remote)
            # FLEET: the LOCAL engine is the fleet brain — ensure it is up
            # even when the window points at a remote (a bare local open
            # boots no teams since the lifecycle ship, so this is cheap).
            if remote:
                def hub_work():
                    hstatus, hpayload = launch_engine("")
                    if hstatus == "ok":
                        self.hub_url = hpayload
                threading.Thread(target=hub_work, daemon=True).start()
            elif status == "ok":
                self.hub_url = payload
            def apply():
                if status == "ok":
                    self.web.load_uri(payload)
                elif looks_asleep(payload) and remote:
                    self.web.load_html(brand_html(
                        "The server machine looks asleep",
                        f"{remote} is not answering — if it sleeps overnight, that's all this is.\n"
                        "Wake it (power button / network wake), give it a few seconds, then hit Retry.\n\n"
                        f"Detail: {payload}", True), None)
                else:
                    self.web.load_html(brand_html(
                        "The engine did not come up", payload + "\n\nFix it in a terminal, then hit Retry.", True), None)
                return False
            GLib.idle_add(apply)
        threading.Thread(target=work, daemon=True).start()

    # ── navigation policy: retry + external-browser schemes ──
    def on_policy(self, web, decision, dtype):
        if dtype != WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            return False
        uri = decision.get_navigation_action().get_request().get_uri() or ""
        if uri.startswith("crate-retry://"):
            decision.ignore()
            self.start_launch()
            return True
        if uri.startswith("crate-ext://"):
            decision.ignore()
            q = urllib.parse.parse_qs(urllib.parse.urlparse(uri).query)
            target = (q.get("url") or [""])[0]
            if target:
                for browser in ("google-chrome", "chromium", "chromium-browser", "xdg-open"):
                    try:
                        subprocess.Popen([browser, target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        break
                    except OSError:
                        continue
            return True
        return False

    def on_load_changed(self, web, event):
        if event == WebKit2.LoadEvent.FINISHED:
            host = urllib.parse.urlparse(web.get_uri() or "").hostname or ""
            self.cockpit_ready = host in ("127.0.0.1", "localhost")
            for item in self.view_items:
                item.set_sensitive(self.cockpit_ready)
            if PROBE and self.cockpit_ready:
                print("PROBE OK", flush=True)
                Gtk.main_quit()

    # ── satellite + studio windows (window.open → real GTK windows) ──
    def on_create(self, web, nav):
        uri = nav.get_request().get_uri() or ""
        parsed = urllib.parse.urlparse(uri)
        is_studio = parsed.path == "/studio"
        frame = (urllib.parse.parse_qs(parsed.query).get("frame") or ["desktop"])[0] if is_studio else ""

        view = WebKit2.WebView.new_with_related_view(web)
        self._settings(view)
        view.connect("decide-policy", self.on_policy)
        view.connect("create", self.on_create)

        win = Gtk.Window(title="Crate Preview")
        win.add(view)
        if is_studio:
            mobile = frame == "mobile"
            key = "studioMobile" if mobile else "studioDesktop"
            win.set_title("Crate Studio — Mobile" if mobile else "Crate Studio — Desktop")
            if mobile:
                # Adam's call: the mobile frame IS a device — its size is the
                # device's, only its position is yours. Desktop stays free.
                win.set_default_size(375, 812)
                win.set_resizable(False)
                view.get_settings().set_user_agent(IPHONE_UA)
            else:
                win.set_default_size(1280, 860)
            restore_geometry(key, win) or win.set_position(Gtk.WindowPosition.CENTER)
            win.connect("configure-event", lambda w, e, k=key: (save_geometry(k, w, size=not mobile), False)[1])
            # Auto-deploy never steals focus: the frame appears on its
            # remembered monitor while the operator keeps typing.
            win.set_focus_on_map(False)
        else:
            win.set_default_size(1280, 860)
            win.set_position(Gtk.WindowPosition.CENTER)
        self.satellites.append(win)
        win.connect("destroy", lambda w: self.satellites.remove(w) if w in self.satellites else None)

        def ready(v):
            win.show_all()
        view.connect("ready-to-show", ready)
        return view

    # ── menus ──
    def build_menubar(self):
        accel = Gtk.AccelGroup()
        self.win.add_accel_group(accel)
        bar = Gtk.MenuBar()

        def item(menu, label, key, mods, cb):
            it = Gtk.MenuItem(label=label)
            it.connect("activate", cb)
            if key:
                it.add_accelerator("activate", accel, key, mods, Gtk.AccelFlags.VISIBLE)
            menu.append(it)
            return it

        app_root = Gtk.MenuItem(label="Crate Engine")
        app_menu = Gtk.Menu()
        app_root.set_submenu(app_menu)
        item(app_menu, "Quit", Gdk.KEY_q, Gdk.ModifierType.CONTROL_MASK, lambda *_: Gtk.main_quit())
        bar.append(app_root)

        edit_root = Gtk.MenuItem(label="Edit")
        edit_menu = Gtk.Menu()
        edit_root.set_submenu(edit_menu)
        # The COPY bridge, ported from the Mac's live find: WebKit's native
        # copy only knows DOM selections — xterm paints its own. Copy asks the
        # PAGE (crateCopySelection: xterm first, DOM fallback) and writes the
        # clipboard here. Empty selection = silence.
        item(edit_menu, "Copy", Gdk.KEY_c, Gdk.ModifierType.CONTROL_MASK, self.on_copy)
        item(edit_menu, "Paste", Gdk.KEY_v, Gdk.ModifierType.CONTROL_MASK,
             lambda *_: self.active_view().execute_editing_command("Paste"))
        item(edit_menu, "Select All", Gdk.KEY_a, Gdk.ModifierType.CONTROL_MASK,
             lambda *_: self.active_view().execute_editing_command("SelectAll"))
        bar.append(edit_root)

        view_root = Gtk.MenuItem(label="View")
        view_menu = Gtk.Menu()
        view_root.set_submenu(view_menu)
        for label, key, panel in (("Team", Gdk.KEY_1, "team"), ("Context", Gdk.KEY_2, "context"), ("Health", Gdk.KEY_3, "health")):
            it = item(view_menu, label, key, Gdk.ModifierType.CONTROL_MASK,
                      lambda _w, p=panel: self.run_js(f"window.crateOpenPanel && window.crateOpenPanel('{p}')"))
            it.set_sensitive(False)
            self.view_items.append(it)
        view_menu.append(Gtk.SeparatorMenuItem())
        studio = item(view_menu, "Design Studio", Gdk.KEY_4, Gdk.ModifierType.CONTROL_MASK, self.on_studio)
        studio.set_sensitive(False)
        self.view_items.append(studio)
        bar.append(view_root)

        # UPDATE menu (Adam, 2026-08-15): one click updates BOTH sides — the
        # page bridge updates the ENGINE HOST via the API (compat report +
        # restart confirm), and when the topology is remote this machine's
        # own engine copy + shell need the same update: local `crate update`
        # fans out (its linux-shell hook refreshes this very app).
        # THE FLEET RAIL, F2 (PDR fleet-rail): the window is the multiplexer.
        # Rows rebuilt from the hub's /api/fleet on every open (the "show"
        # signal); click swaps the webview to that workspace's cockpit. The
        # fetch caps at 1.2s — an asleep host must never hang the menu.
        fleet_root = Gtk.MenuItem(label="Fleet")
        fleet_menu = Gtk.Menu()
        fleet_root.set_submenu(fleet_menu)
        fleet_menu.connect("show", self.on_fleet_open)
        bar.append(fleet_root)
        upd_root = Gtk.MenuItem(label="Update")
        upd_menu = Gtk.Menu()
        upd_root.set_submenu(upd_menu)
        upd_now = item(upd_menu, "Update Engine Now", Gdk.KEY_u, Gdk.ModifierType.CONTROL_MASK, self.on_update)
        upd_now.set_sensitive(False)
        self.view_items.append(upd_now)
        upd_check = item(upd_menu, "Check for Updates", None, None,
                         lambda *_: self.run_js("window.crateOpenPanel && window.crateOpenPanel('health')"))
        upd_check.set_sensitive(False)
        self.view_items.append(upd_check)
        bar.append(upd_root)
        return bar

    # ── the Fleet menu (PDR fleet-rail F2) ──
    def _hub_api(self, path):
        if not self.hub_url:
            return None
        u = urllib.parse.urlparse(self.hub_url)
        tok = urllib.parse.parse_qs(u.query).get("token", [""])[0]
        return f"http://127.0.0.1:{u.port}{path}?token={tok}"

    def on_fleet_open(self, menu):
        for child in menu.get_children():
            menu.remove(child)
        def row(label, cb=None, arg=None):
            it = Gtk.MenuItem(label=label)
            if cb is None:
                it.set_sensitive(False)
            else:
                it.connect("activate", lambda *_: cb(arg))
            menu.append(it)
        api = self._hub_api("/api/fleet")
        fleet = None
        if api:
            try:
                with urllib.request.urlopen(api, timeout=1.2) as r:
                    fleet = json.load(r)
            except OSError:
                fleet = None
        if not fleet:
            row("fleet brain unreachable — is the local engine up?" if api else "fleet brain starting — the local engine is not up yet")
            menu.show_all()
            return
        for host in fleet.get("hosts", []):
            skew = "  ⚠ engine differs — Update menu fans out" if host.get("skew") else ""
            row(f"{host.get('host', '?')}{skew}")
            if host.get("state") == "connected" or host.get("local"):
                # CE-136: an empty host must never dead-end — the ＋ new rig
                # row is the door to the card (&card=1 on the host's cockpit).
                if host.get("cockpitUrl"):
                    row(f"   ＋ new rig on {host.get('host', '?')}…",
                        lambda u: self.web.load_uri(u), host["cockpitUrl"] + "&card=1")
                for w in host.get("workspaces", []):
                    live = w.get("liveSeats", 0)
                    state = f"{live} live" if live else ("resuming" if w.get("desired") == "running" else "parked")
                    row(f"   {w.get('name', '?')} · {state}", lambda u: self.web.load_uri(u), w.get("url"))
            else:
                note = host.get("note") or host.get("state", "unknown")
                row(f"   {note} — Connect", self._fleet_connect, host.get("host"))
            menu.append(Gtk.SeparatorMenuItem())
        menu.show_all()

    def _fleet_connect(self, host):
        api = self._hub_api("/api/fleet/connect")
        if not api or not host:
            return
        def work():
            try:
                req = urllib.request.Request(api, data=json.dumps({"host": host}).encode(),
                                             headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=150).read()  # dial + boot can take a while; reopen the menu when done
            except OSError:
                pass
        threading.Thread(target=work, daemon=True).start()

    def on_update(self, *_):
        self.run_js("window.crateUpdate && window.crateUpdate()")
        if read_remote_host():
            def fan_out():
                env = dict(os.environ)
                env["PATH"] = f"{HOME}/.local/bin:/usr/local/bin:" + env.get("PATH", "/usr/bin:/bin")
                try:
                    subprocess.run([CRATE, "update"], capture_output=True, timeout=300, env=env)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            threading.Thread(target=fan_out, daemon=True).start()

    def active_view(self):
        w = self.win.get_window()
        for s in self.satellites:
            if s.is_active():
                return s.get_child()
        return self.web

    def run_js(self, js):
        if self.cockpit_ready:
            self.web.run_javascript(js, None, None, None)

    def on_studio(self, *_):
        # cmd-4's Mac lesson, same here: RAISE existing frames (a buried studio
        # must always surface), then let the page open any missing ones.
        for s in self.satellites:
            if (s.get_title() or "").startswith("Crate Studio"):
                s.present()
        self.run_js("window.crateOpenStudio && window.crateOpenStudio()")

    def on_copy(self, *_):
        js = "window.crateCopySelection ? window.crateCopySelection() : (window.getSelection ? String(window.getSelection()) : '')"
        view = self.active_view()

        def done(view_, result):
            try:
                r = view_.run_javascript_finish(result)
                value = r.get_js_value()
                text = value.to_string() if value else ""
            except Exception:
                return
            if text:
                clip = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
                clip.set_text(text, -1)
                clip.store()
        view.run_javascript(js, None, done)


def main():
    shell = Shell()
    if PROBE:
        GLib.timeout_add_seconds(45, lambda: (print("PROBE TIMEOUT", flush=True), os._exit(3)))
    Gtk.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
