// Crate Engine — the native Mac shell (PDR dev/pdr/native-mac-shell.md).
//
// A real .app that OWNS the cockpit window: bolt in the Dock, bolt in
// Cmd-Tab. The window's content is the engine's own cockpit page; this shell
// just runs the operator's launch flow (`crate open [--remote <host>]
// --print-url`) and loads the door it prints. Closing the window never stops
// the engine or the team — the shell is a viewport, the engine is the truth.
//
// Config: ~/.crate/app-shell.conf — REMOTE="<ssh-host>" launches the remote
// flow (Adam's daily drive: superman-wifi); absent/empty = local engine.
import Cocoa
import WebKit

let BRAND_HTML = { (message: String, sub: String, retry: Bool) -> String in
  """
  <!doctype html><html><head><meta charset="utf-8"><style>
  body{background:#0b0e14;color:#f1f3f6;font:15px -apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .box{text-align:center;max-width:520px;padding:0 24px}
  .bolt{width:52px;height:52px;fill:#e2a33c;animation:pulse 1.2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  h1{font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:#e2a33c;margin:18px 0 10px;font-weight:600}
  p{color:#8b94a5;line-height:1.6;font-size:13.5px;white-space:pre-wrap}
  .retry{display:inline-block;margin-top:22px;padding:10px 26px;border:1px solid #e2a33c;color:#e2a33c;text-decoration:none;font:600 12px -apple-system,sans-serif;letter-spacing:.14em;text-transform:uppercase}
  .retry:hover{background:rgba(226,163,60,.12)}
  </style></head><body><div class="box">
  <svg class="bolt" viewBox="0 0 24 24"><path d="M13.2 2 4.8 13.4h5L8.6 22l10.6-13.2h-6.2L13.2 2z"/></svg>
  <h1>\(message)</h1><p>\(sub)</p>\(retry ? #"<a class="retry" href="crate-retry://go">Retry</a>"# : "")
  </div></body></html>
  """
}

/// Pack 5 ("server machine looks asleep", FLAWS 2026-08-12): the server host
/// sleeping overnight is the COMMON morning failure — name the likely cause in
/// plain words instead of a bare connection error, and offer Retry in place.
func looksAsleep(_ msg: String) -> Bool {
  let needles = [
    "no route to host", "operation timed out", "timed out", "connection refused",
    "connection timed out", "could not resolve", "network is unreachable", "host is down",
  ]
  let low = msg.lowercased()
  return needles.contains { low.contains($0) }
}

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  var window: NSWindow!
  var webView: WKWebView!
  /// Satellite preview windows (Adam, 2026-08-13): retained here — a closed
  /// window is pruned by the willClose observer, never left dangling.
  var satellites: [NSWindow] = []
  /// Backlog 11: the View menu's panel items stay DISABLED until the cockpit
  /// page is actually loaded (error/boot screens have no panels to open).
  var cockpitReady = false
  /// THE FLEET RAIL (PDR fleet-rail): the LOCAL hub engine's tokened door.
  /// The window is the multiplexer — the Fleet menu reads the hub's
  /// /api/fleet and swaps this webview between engine cockpits. Set once
  /// the hub answers; nil = the Fleet menu says so instead of hanging.
  var hubURL: URL?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
    window = NSWindow(
      contentRect: frame,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    window.title = "Crate Engine"
    window.center()
    window.setFrameAutosaveName("CrateEngineMain")
    window.minSize = NSSize(width: 900, height: 600)

    let conf = WKWebViewConfiguration()
    conf.preferences.setValue(true, forKey: "developerExtrasEnabled")
    // Design Studio (backlog 10, QA find 2026-08-14): the studio frames open
    // via window.open from a MENU action (evaluateJavaScript) and from the
    // AUTO-DEPLOY watcher (setInterval) — neither is a user gesture, and
    // WebKit silently drops non-gesture window.open by default. The popups
    // still route through our UIDelegate (real NSWindows), so allowing them
    // is safe: only the cockpit's own page runs here.
    conf.preferences.javaScriptCanOpenWindowsAutomatically = true
    // The page detects the shell via window.crateShell (satellite windows +
    // Launch in Chrome take the shell-native paths; a plain browser falls
    // back to window.open). Injected at document start, inherited by
    // satellites (same configuration).
    conf.userContentController.addUserScript(
      WKUserScript(source: "window.crateShell=true", injectionTime: .atDocumentStart, forMainFrameOnly: false))
    webView = WKWebView(frame: frame, configuration: conf)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self // the Retry link routes back into the launch flow
    webView.uiDelegate = self // window.open → real satellite windows
    window.contentView = webView
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    startLaunch()
  }

  /// The launch flow — first boot AND every Retry press run exactly this.
  func startLaunch() {
    let remote = readRemoteHost()
    let where_ = remote.isEmpty ? "on this Mac" : "on \(remote)"
    webView.loadHTMLString(
      BRAND_HTML("Starting the engine", "Bringing the Crate Engine up \(where_) — checking the server, opening the tunnel. A few seconds.", false),
      baseURL: nil)

    DispatchQueue.global(qos: .userInitiated).async { [self] in
      let result = launchEngine(remote: remote)
      // FLEET (PDR fleet-rail): the LOCAL engine is the fleet brain — ensure
      // it is up even when the window points at a remote (a bare local open
      // boots no teams since the lifecycle ship, so this is cheap). The hub
      // feeds the Fleet menu regardless of where the glass looks.
      if remote.isEmpty {
        if case .success(let url) = result { DispatchQueue.main.async { self.hubURL = url } }
      } else {
        DispatchQueue.global(qos: .utility).async { [self] in
          if case .success(let url) = launchEngine(remote: "") {
            DispatchQueue.main.async { self.hubURL = url }
          }
        }
      }
      DispatchQueue.main.async { [self] in
        switch result {
        case .success(let url):
          webView.load(URLRequest(url: url))
        case .failure(let msg):
          if looksAsleep(msg), !remote.isEmpty {
            webView.loadHTMLString(
              BRAND_HTML(
                "The server machine looks asleep",
                "\(remote) is not answering — if it sleeps overnight, that's all this is.\n"
                  + "Wake it (power button / network wake), give it a few seconds, then hit Retry.\n\nDetail: \(msg)",
                true),
              baseURL: nil)
          } else {
            webView.loadHTMLString(
              BRAND_HTML("The engine did not come up", msg + "\n\nFix it in a terminal, then hit Retry.", true),
              baseURL: nil)
          }
        }
      }
    }
  }

  /// Backlog 11: the cockpit is "connected" when the MAIN webview finishes
  /// loading a loopback page (the engine's door is always a tunneled/local
  /// loopback URL; brand/error screens load via loadHTMLString → no host).
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard webView == self.webView else { return }
    let host = webView.url?.host ?? ""
    cockpitReady = (host == "127.0.0.1" || host == "localhost")
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if navigationAction.request.url?.scheme == "crate-retry" {
      decisionHandler(.cancel)
      startLaunch()
      return
    }
    // Launch in Chrome (Adam, 2026-08-13): the page hands the proxied
    // preview URL out via crate-ext:// — real Chrome when installed, the
    // default browser otherwise. The URL is the tunneled loopback proxy, so
    // it works from this machine by construction.
    if let u = navigationAction.request.url, u.scheme == "crate-ext" {
      decisionHandler(.cancel)
      if let comps = URLComponents(url: u, resolvingAgainstBaseURL: false),
        let target = comps.queryItems?.first(where: { $0.name == "url" })?.value,
        let real = URL(string: target)
      {
        let chrome = URL(fileURLWithPath: "/Applications/Google Chrome.app")
        if FileManager.default.fileExists(atPath: chrome.path) {
          NSWorkspace.shared.open([real], withApplicationAt: chrome, configuration: NSWorkspace.OpenConfiguration())
        } else {
          NSWorkspace.shared.open(real)
        }
      }
      return
    }
    decisionHandler(.allow)
  }

  /// Satellite windows (Adam, 2026-08-13): the cockpit's window.open becomes
  /// a REAL macOS window — phone-shaped or desktop per the requested
  /// features — instead of being silently ignored (WKWebView drops
  /// window.open without a UIDelegate; the old "Open in a window" button
  /// did nothing in the app). WebKit loads the request into the returned
  /// view itself.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    let w = CGFloat(truncating: windowFeatures.width ?? 1280)
    let h = CGFloat(truncating: windowFeatures.height ?? 860)
    let win = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: max(320, w), height: max(400, h)),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    win.title = "Crate Preview"
    win.isReleasedWhenClosed = false
    let wv = WKWebView(frame: win.contentView!.bounds, configuration: configuration)
    wv.autoresizingMask = [.width, .height]
    wv.navigationDelegate = self
    wv.uiDelegate = self
    win.contentView = wv
    win.center()
    // Design Studio frames (backlog 10, PDR dev/pdr/design-studio.md): the
    // /studio windows are FIXTURES — they remember their exact monitor
    // position across launches (autosave restores over the center() above),
    // and they NEVER steal focus: auto-deploy means a frame appearing on the
    // side monitor while Adam keeps typing in the cockpit, so they order
    // front without becoming key. The mobile frame carries a real iPhone UA
    // so the build renders its mobile experience (viewport parity with QA's
    // device profile; real-device truth stays the QR ritual).
    if let u = navigationAction.request.url, u.path == "/studio" {
      let comps = URLComponents(url: u, resolvingAgainstBaseURL: false)
      let mobile = comps?.queryItems?.first(where: { $0.name == "frame" })?.value == "mobile"
      win.title = mobile ? "Crate Studio — Mobile" : "Crate Studio — Desktop"
      win.setFrameAutosaveName(mobile ? "CrateStudioMobile" : "CrateStudioDesktop")
      if mobile {
        wv.customUserAgent =
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        // Adam's call (2026-08-14): the mobile frame IS a device — its size
        // is the device's, only its position is yours. Desktop stays free.
        win.styleMask.remove(.resizable)
      }
      win.orderFrontRegardless()
    } else {
      win.makeKeyAndOrderFront(nil)
    }
    satellites.append(win)
    NotificationCenter.default.addObserver(
      forName: NSWindow.willCloseNotification, object: win, queue: .main
    ) { [weak self] _ in
      self?.satellites.removeAll { $0 == win }
    }
    return wv
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true // the window IS the app; the engine + team keep running without us
  }
}

enum LaunchResult {
  case success(URL)
  case failure(String)
}

func readRemoteHost() -> String {
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  guard let text = try? String(contentsOfFile: home + "/.crate/app-shell.conf", encoding: .utf8) else { return "" }
  for line in text.split(separator: "\n") {
    let t = line.trimmingCharacters(in: .whitespaces)
    if t.hasPrefix("REMOTE=") {
      return t.dropFirst("REMOTE=".count).trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
    }
  }
  return ""
}

func launchEngine(remote: String) -> LaunchResult {
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  let crate = home + "/.local/bin/crate"
  guard FileManager.default.isExecutableFile(atPath: crate) else {
    return .failure("crate isn't installed at ~/.local/bin/crate — install it first:\ncurl -fsSL https://crate-engine.ai/get | bash")
  }
  var args = [crate, "open"]
  if !remote.isEmpty { args += ["--remote", remote] }
  args += ["--print-url"]

  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  p.arguments = args
  var env = ProcessInfo.processInfo.environment
  env["PATH"] = "\(home)/.local/bin:/usr/local/bin:/opt/homebrew/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
  p.environment = env
  let out = Pipe(), err = Pipe()
  p.standardOutput = out
  p.standardError = err
  do { try p.run() } catch {
    return .failure("could not run the crate launcher: \(error.localizedDescription)")
  }
  // the remote flow can take a while (ssh + engine boot + tunnel); 150s cap
  let deadline = Date().addingTimeInterval(150)
  while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.25) }
  if p.isRunning {
    p.terminate()
    return .failure("the launch flow timed out (150s) — try it by hand to see why:\ncrate open\(remote.isEmpty ? "" : " --remote " + remote)")
  }
  let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  // the door is the last http(s) line the flow printed
  let urlLine = stdout.split(separator: "\n").map(String.init).last { $0.hasPrefix("http://") || $0.hasPrefix("https://") }
  guard let line = urlLine, let url = URL(string: line.trimmingCharacters(in: .whitespaces)) else {
    let detail = (stderr + "\n" + stdout).trimmingCharacters(in: .whitespacesAndNewlines)
    return .failure(detail.isEmpty ? "the launch flow printed no cockpit URL" : detail)
  }
  return .success(url)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
// Backlog 11 polish (QA find 2026-08-14): macOS injects "Show Tab Bar" items
// into any menu titled View — the cockpit has no window tabs, so keep the
// menu exactly the four items we built.
NSWindow.allowsAutomaticWindowTabbing = false

// The COPY bridge (Adam's live find, 2026-08-14 — "error chime, no copy"):
// the Edit menu's Cmd+C key equivalent fires BEFORE the page ever sees the
// keystroke, and WebKit's native copy: only knows DOM selections — xterm
// paints its OWN selection, so copy: found nothing, validation failed, and
// macOS beeped. (This is exactly why the 08-13 JS clipboard rework fixed
// Chrome but never the app: the page's Cmd+C handler is unreachable here.)
// Cure: Copy targets the shell, which asks the PAGE for the real selection
// (window.crateCopySelection — xterm selection first, DOM selection as the
// fallback) and writes the pasteboard natively. Empty selection = silence,
// never a beep.
final class EditActions: NSObject {
  static let shared = EditActions()
  private func activeWebView() -> WKWebView? {
    guard let win = NSApp.keyWindow else { return nil }
    if let wv = win.contentView as? WKWebView { return wv }
    return win.contentView?.subviews.compactMap { $0 as? WKWebView }.first
  }
  @objc func copySelection(_ sender: Any?) {
    guard let wv = activeWebView() else { return }
    let js = "window.crateCopySelection ? window.crateCopySelection() : (window.getSelection ? String(window.getSelection()) : '')"
    wv.evaluateJavaScript(js) { result, _ in
      let text = (result as? String) ?? ""
      guard !text.isEmpty else { return } // nothing selected — stay silent
      let pb = NSPasteboard.general
      pb.clearContents()
      pb.setString(text, forType: .string)
    }
  }
}

// Backlog 11 (Adam, 2026-08-12; shipped 2026-08-14): the cockpit's STATIC
// panels move into the OS chrome — a real View menu opens Team/Context/
// Health through the page's crateOpenPanel bridge (⌘1/⌘2/⌘3). Items
// validate against cockpitReady, so they sit disabled on boot/error
// screens. The page retires its three in-page buttons when crateShell —
// one home per control. Preview/Servers stay in-page (stateful chrome).
final class PanelActions: NSObject, NSMenuItemValidation {
  static let shared = PanelActions()
  private func cockpit() -> WKWebView? {
    guard let d = NSApp.delegate as? AppDelegate, d.cockpitReady else { return nil }
    return d.webView
  }
  private func open(_ name: String) {
    cockpit()?.evaluateJavaScript("window.crateOpenPanel && window.crateOpenPanel('\(name)')", completionHandler: nil)
  }
  @objc func openTeam(_ sender: Any?) { open("team") }
  @objc func openContext(_ sender: Any?) { open("context") }
  @objc func openHealth(_ sender: Any?) { open("health") }
  /// Backlog 10: the Design Studio — one item opens BOTH frames (Adam's
  /// call: the pair is the default; closing either one is free). cmd-4 also
  /// RAISES frames that already exist (QA find: a frame buried behind the
  /// cockpit re-navigates via its named target but never surfaces — "bring
  /// me my studio" must always mean visible).
  @objc func openStudio(_ sender: Any?) {
    if let d = NSApp.delegate as? AppDelegate {
      for w in d.satellites where w.title.hasPrefix("Crate Studio") { w.orderFrontRegardless() }
    }
    cockpit()?.evaluateJavaScript("window.crateOpenStudio && window.crateOpenStudio()", completionHandler: nil)
  }
  /// UPDATE menu (Adam, 2026-08-15): one click updates BOTH sides. The page
  /// bridge runs the engine-host update through the API (correct for remote
  /// topologies — the engine lives where the repos live) with the existing
  /// compat report + restart confirm; and when the topology IS remote, this
  /// machine's own engine copy + app bundle need the same update (the
  /// by-hand fan-out ritual, made a door) — run local `crate update` too.
  @objc func updateNow(_ sender: Any?) {
    cockpit()?.evaluateJavaScript("window.crateUpdate && window.crateUpdate()", completionHandler: nil)
    let remote = readRemoteHost()
    if !remote.isEmpty {
      DispatchQueue.global(qos: .utility).async {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let p = Process()
        p.executableURL = URL(fileURLWithPath: home + "/.local/bin/crate")
        p.arguments = ["update"]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "\(home)/.local/bin:/usr/local/bin:/opt/homebrew/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        p.environment = env
        try? p.run()
        p.waitUntilExit()
      }
    }
  }
  @objc func checkUpdates(_ sender: Any?) { open("health") }
  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool { cockpit() != nil }
}

// THE FLEET RAIL, F2 (PDR fleet-rail, Adam's option A): the WINDOW is the
// multiplexer. A native Fleet menu, rebuilt each time it opens from the
// LOCAL hub's /api/fleet (cache-first server-side, so this stays instant),
// lists every host's workspaces — "name · 5 live / parked" — and a click
// swaps the webview to that workspace's cockpit (local or tunneled). An
// asleep host is a calm row with Connect; engine skew carries an amber ⚠
// pointing at the Update menu's existing fan-out. The menu never hangs:
// the fetch is capped at 1.2s and a silent hub degrades to one honest row.
final class FleetActions: NSObject, NSMenuDelegate {
  static let shared = FleetActions()

  private func hubFleetURL(_ path: String) -> URL? {
    guard let d = NSApp.delegate as? AppDelegate, let hub = d.hubURL,
      let comps = URLComponents(url: hub, resolvingAgainstBaseURL: false),
      let token = comps.queryItems?.first(where: { $0.name == "token" })?.value
    else { return nil }
    return URL(string: "http://127.0.0.1:\(comps.port ?? 0)\(path)?token=\(token)")
  }

  private func fetchJSON(_ url: URL, method: String = "GET", body: Data? = nil, timeout: Double) -> [String: Any]? {
    var req = URLRequest(url: url, timeoutInterval: timeout)
    req.httpMethod = method
    if let b = body {
      req.httpBody = b
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    var out: [String: Any]?
    let sem = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: req) { data, _, _ in
      if let d = data { out = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] }
      sem.signal()
    }.resume()
    _ = sem.wait(timeout: .now() + timeout)
    return out
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    guard let url = hubFleetURL("/api/fleet") else {
      menu.addItem(withTitle: "fleet brain starting — the local engine is not up yet", action: nil, keyEquivalent: "")
      return
    }
    guard let fleet = fetchJSON(url, timeout: 1.2), let hosts = fleet["hosts"] as? [[String: Any]] else {
      menu.addItem(withTitle: "fleet brain unreachable — is the local engine up?", action: nil, keyEquivalent: "")
      return
    }
    for host in hosts {
      let name = host["host"] as? String ?? "?"
      let state = host["state"] as? String ?? "unknown"
      let skew = host["skew"] as? Bool ?? false
      let header = NSMenuItem(title: "\(name)\(skew ? "  ⚠ engine differs — Update menu fans out" : "")", action: nil, keyEquivalent: "")
      header.isEnabled = false
      menu.addItem(header)
      let workspaces = host["workspaces"] as? [[String: Any]] ?? []
      if state == "connected" || host["local"] as? Bool == true {
        if workspaces.isEmpty {
          menu.addItem(withTitle: "   no workspaces yet", action: nil, keyEquivalent: "")
        }
        for w in workspaces {
          let live = w["liveSeats"] as? Int ?? 0
          let desired = w["desired"] as? String
          let stateLabel = live > 0 ? "\(live) live" : (desired == "running" ? "resuming" : "parked")
          let item = NSMenuItem(
            title: "   \(w["name"] as? String ?? "?") · \(stateLabel)",
            action: #selector(switchTo(_:)), keyEquivalent: "")
          item.target = self
          item.representedObject = w["url"] as? String
          menu.addItem(item)
        }
      } else {
        // asleep/failed/unknown/connecting: one calm row; click = Connect
        let note = host["note"] as? String ?? state
        let item = NSMenuItem(title: "   \(note) — Connect", action: #selector(connectHost(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = name
        menu.addItem(item)
      }
      menu.addItem(NSMenuItem.separator())
    }
  }

  @objc func switchTo(_ sender: NSMenuItem) {
    guard let s = sender.representedObject as? String, let url = URL(string: s),
      let d = NSApp.delegate as? AppDelegate
    else { return }
    d.webView.load(URLRequest(url: url)) // a pure view swap — lifecycle untouched
  }

  @objc func connectHost(_ sender: NSMenuItem) {
    guard let host = sender.representedObject as? String,
      let url = hubFleetURL("/api/fleet/connect"),
      let body = try? JSONSerialization.data(withJSONObject: ["host": host])
    else { return }
    DispatchQueue.global(qos: .userInitiated).async { [self] in
      _ = fetchJSON(url, method: "POST", body: body, timeout: 150) // dial + boot can take a while; reopen the menu when done
    }
  }
}

// Minimal real menus — copy/paste and Cmd-Q must work inside the cockpit
// (and inside TUI panes). Without an Edit menu, WKWebView eats shortcuts.
let mainMenu = NSMenu()
let appItem = NSMenuItem(); mainMenu.addItem(appItem)
let appMenu = NSMenu()
appMenu.addItem(withTitle: "About Crate Engine", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
appMenu.addItem(NSMenuItem.separator())
appMenu.addItem(withTitle: "Hide Crate Engine", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
appMenu.addItem(withTitle: "Quit Crate Engine", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appItem.submenu = appMenu
let editItem = NSMenuItem(); mainMenu.addItem(editItem)
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
editMenu.addItem(NSMenuItem.separator())
editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
let copyItem = NSMenuItem(title: "Copy", action: #selector(EditActions.copySelection(_:)), keyEquivalent: "c")
copyItem.target = EditActions.shared // explicit target: never falls to WebKit's DOM-only copy: (the beep)
editMenu.addItem(copyItem)
editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
editItem.submenu = editMenu
let viewItem = NSMenuItem(); mainMenu.addItem(viewItem)
let viewMenu = NSMenu(title: "View")
let teamMenuItem = NSMenuItem(title: "Team", action: #selector(PanelActions.openTeam(_:)), keyEquivalent: "1")
teamMenuItem.target = PanelActions.shared
viewMenu.addItem(teamMenuItem)
let contextMenuItem = NSMenuItem(title: "Context", action: #selector(PanelActions.openContext(_:)), keyEquivalent: "2")
contextMenuItem.target = PanelActions.shared
viewMenu.addItem(contextMenuItem)
let healthMenuItem = NSMenuItem(title: "Health", action: #selector(PanelActions.openHealth(_:)), keyEquivalent: "3")
healthMenuItem.target = PanelActions.shared
viewMenu.addItem(healthMenuItem)
viewMenu.addItem(NSMenuItem.separator())
let studioMenuItem = NSMenuItem(title: "Design Studio", action: #selector(PanelActions.openStudio(_:)), keyEquivalent: "4")
studioMenuItem.target = PanelActions.shared
viewMenu.addItem(studioMenuItem)
viewItem.submenu = viewMenu
let fleetItem = NSMenuItem(); mainMenu.addItem(fleetItem)
let fleetMenu = NSMenu(title: "Fleet")
fleetMenu.delegate = FleetActions.shared // rows rebuilt from /api/fleet each open
fleetMenu.autoenablesItems = false
fleetItem.submenu = fleetMenu
let updateItem = NSMenuItem(); mainMenu.addItem(updateItem)
let updateMenu = NSMenu(title: "Update")
let updNowItem = NSMenuItem(title: "Update Engine Now", action: #selector(PanelActions.updateNow(_:)), keyEquivalent: "u")
updNowItem.target = PanelActions.shared
updateMenu.addItem(updNowItem)
let updCheckItem = NSMenuItem(title: "Check for Updates", action: #selector(PanelActions.checkUpdates(_:)), keyEquivalent: "")
updCheckItem.target = PanelActions.shared
updateMenu.addItem(updCheckItem)
updateItem.submenu = updateMenu
app.mainMenu = mainMenu

let delegate = AppDelegate()
app.delegate = delegate
app.run()
