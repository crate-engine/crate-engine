// Crate Engine — the native Mac shell (PDR dev/pdr/native-mac-shell.md).
//
// A real .app that OWNS the cockpit window: bolt in the Dock, bolt in
// Cmd-Tab. The window's content is the engine's own cockpit page; this shell
// just runs the operator's launch flow (`crate open [--remote <host>]
// --print-url`) and loads the door it prints. Closing the window never stops
// the engine or the team — the shell is a viewport, the engine is the truth.
//
// App launch shows recent projects; selecting one reconnects to its computer.
// Explicit CLI --url launches still open the requested workspace directly.
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

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
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
  /// A Retry press abandons the CLI-supplied door and runs the full flow.
  var retriedOnce = false
  let recentProjects = RecentProjects(file: FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".crate/recent-projects.json"))
  var knownOrigins: [String: String] = [:]
  var connectionGeneration = 0
  var recentError = ""
  var recentErrorID = ""


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
    conf.userContentController.add(self, name: "crateRecent")
    webView = WKWebView(frame: frame, configuration: conf)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self // the Retry link routes back into the launch flow
    webView.uiDelegate = self // window.open → real satellite windows
    window.contentView = webView
    // The window title follows the page's title ("Crate Engine — <rig> team"):
    // the header's project label retired 2026-09-13 (the name lives in the
    // Workspaces drawer + here), so the title is where the eye finds it.
    webView.addObserver(self, forKeyPath: "title", options: [.new], context: nil)
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    startLaunch()
  }

  /// The launch flow — first boot AND every Retry press run exactly this.
  func startLaunch() {
    connectionGeneration += 1
    let generation = connectionGeneration
    let direct = retriedOnce ? nil : directDoorURL()
    webView.loadHTMLString(BRAND_HTML("Opening your workspace", "Connecting to the local engine…", false), baseURL: nil)
    DispatchQueue.global(qos: .userInitiated).async { [self] in
      let result = launchEngine(remote: "")
      DispatchQueue.main.async { [self] in
        guard generation == connectionGeneration else { return }
        switch result {
        case .success(let hub):
          hubURL = hub
          knownOrigins[origin(hub)] = ""
          if let direct = direct {
            webView.load(URLRequest(url: direct))
          } else {
            // App launch is a project chooser, even when a previous view or
            // legacy REMOTE preference exists. Only an explicit selection opens it.
            showRecentProjects()
          }
        case .failure(let message):
          webView.loadHTMLString(BRAND_HTML("The engine did not come up", htmlEscape(message), true), baseURL: nil)
        }
      }
    }
  }

  func origin(_ url: URL) -> String {
    let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
    return "\(url.scheme ?? "")://\(url.host ?? ""):\(url.port ?? 80)/\(token)"
  }

  func sameEngine(_ a: URL, _ b: URL) -> Bool {
    let tokenA = URLComponents(url: a, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "token" })?.value
    let tokenB = URLComponents(url: b, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "token" })?.value
    return tokenA != nil && tokenA != "" && tokenA == tokenB
  }

  func showRecentFailure(_ entry: RecentProject?, _ message: String) {
    recentError = message
    recentErrorID = entry?.id ?? ""
    showRecentProjects()
  }

  func showRecentProjects() {
    if let hub = hubURL, var c = URLComponents(url: hub, resolvingAgainstBaseURL: false) {
      c.path = "/team"
      c.queryItems = (c.queryItems ?? []).filter { $0.name == "token" } + [URLQueryItem(name: "card", value: "1")]
      if let url = c.url { webView.load(URLRequest(url: url)) }
    }
  }

  func openRecent(_ entry: RecentProject) { openConnection(host: entry.host, entry: entry) }

  func openConnection(host: String, entry: RecentProject?) {
    connectionGeneration += 1
    let generation = connectionGeneration
    cockpitReady = false
    let label = host.isEmpty ? "This Mac" : host
    webView.loadHTMLString(BRAND_HTML("Opening your workspace", htmlEscape("Connecting to \(label)…"), false), baseURL: nil)
    let localDoor = hubURL
    DispatchQueue.global(qos: .userInitiated).async { [self] in
      let result: LaunchResult = host.isEmpty && localDoor != nil ? .success(localDoor!) : launchEngine(remote: host)
      var door: URL?
      var failure = "Couldn’t connect to \(label). Retry when the computer is available."
      if case .success(let fresh) = result {
        if let entry = entry {
          if let data = shellJSON(fresh, route: "/api/workspaces"), let rows = data["workspaces"] as? [[String: Any]] {
            if rows.contains(where: { $0["path"] as? String == entry.path && $0["exists"] as? Bool == true && $0["rig"] as? Bool == true }) {
              door = projectDoor(fresh, project: entry.path)
            } else {
              failure = "Project unavailable on \(label). It may have moved or its drive may be disconnected. Retry or use Open Project to locate it."
            }
          }
        } else { door = fresh }
      }
      DispatchQueue.main.async { [self] in
        guard generation == connectionGeneration else { return }
        if let door = door {
          recentError = ""; recentErrorID = ""
          knownOrigins[origin(door)] = host
          webView.load(URLRequest(url: door)) // view only: never boot, dispatch or resume a task
        } else { showRecentFailure(entry, failure) }
      }
    }
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.webView == webView, message.frameInfo.isMainFrame,
      let frameURL = message.frameInfo.request.url, frameURL.path == "/team",
      frameURL.host == "127.0.0.1" || frameURL.host == "localhost",
      message.name == "crateRecent", let id = message.body as? String,
      let entry = recentProjects.entries.first(where: { $0.id == id }) else { return }
    openRecent(entry)
  }

  func renderRecents() {
    let rows: [[String: Any]] = recentProjects.entries.map {
      ["id": $0.id, "name": $0.name, "path": $0.path, "host": $0.host.isEmpty ? "This Mac" : $0.host,
       "openedAt": $0.openedAt.timeIntervalSince1970 * 1000]
    }
    guard let data = try? JSONSerialization.data(withJSONObject: ["rows": rows, "error": recentError, "errorID": recentErrorID]),
      let json = String(data: data, encoding: .utf8) else { return }
    webView.evaluateJavaScript("window.crateSetRecentProjects && window.crateSetRecentProjects(\(json))", completionHandler: nil)
  }

  func rememberView(attempt: Int = 0) {
    guard let viewedURL = webView.url, viewedURL.path == "/team" else { return }
    webView.evaluateJavaScript("typeof PROJECT === 'string' ? PROJECT : ''") { [weak self] value, _ in
      guard let self = self, self.webView.url == viewedURL, let project = value as? String, !project.isEmpty else { return }
      let capturedHub = self.hubURL
      let known = self.knownOrigins[self.origin(viewedURL)]
      DispatchQueue.global(qos: .utility).async {
        var host = known
        if host == nil, let hub = capturedHub,
           let fleet = shellJSON(hub, route: "/api/fleet"), let hosts = fleet["hosts"] as? [[String: Any]] {
          for h in hosts {
            if let s = h["cockpitUrl"] as? String, let u = URL(string: s), self.sameEngine(u, viewedURL) {
              host = h["local"] as? Bool == true ? "" : h["host"] as? String
              break
            }
          }
        }
        if host == nil && attempt < 10 {
          DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            if self.webView.url == viewedURL { self.rememberView(attempt: attempt + 1) }
          }
        }
        // Unknown tunnels must never be mislabelled as local projects.
        guard let host = host,
          let data = shellJSON(viewedURL, route: "/api/workspaces"), let rows = data["workspaces"] as? [[String: Any]],
          let row = rows.first(where: { $0["path"] as? String == project && $0["rig"] as? Bool == true }) else { return }
        let entry = RecentProject(host: host, path: project, name: row["name"] as? String ?? URL(fileURLWithPath: project).lastPathComponent, openedAt: Date())
        DispatchQueue.main.async {
          guard self.webView.url == viewedURL else { return }
          do { try self.recentProjects.record(entry) }
          catch { self.recentError = "Couldn’t save recent projects. Check that your Crate settings folder is writable." }
          self.renderRecents()
        }
      }
    }
  }

  override func observeValue(
    forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?, context: UnsafeMutableRawPointer?
  ) {
    if keyPath == "title", let t = webView.title, !t.isEmpty { window.title = t }
  }

  /// Backlog 11: the cockpit is "connected" when the MAIN webview finishes
  /// loading a loopback page (the engine's door is always a tunneled/local
  /// loopback URL; brand/error screens load via loadHTMLString → no host).
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard webView == self.webView else { return }
    let host = webView.url?.host ?? ""
    cockpitReady = (host == "127.0.0.1" || host == "localhost")
    if cockpitReady { renderRecents(); rememberView() }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if navigationAction.targetFrame?.isMainFrame == true,
      let host = navigationAction.request.url?.host, host == "127.0.0.1" || host == "localhost" {
      connectionGeneration += 1 // cancel a pending reconnect if the operator navigates elsewhere
    }
    if navigationAction.request.url?.scheme == "crate-retry" {
      decisionHandler(.cancel)
      retriedOnce = true
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

  /// S4 — quitting SAYS what happens (Adam, 2026-09-24): teams keep running by
  /// law (cmux), but never invisibly. Once, with "don't show again".
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    let key = "crate.quitNote.suppressed"
    if UserDefaults.standard.bool(forKey: key) { return .terminateNow }
    let f = FleetActions.shared
    guard let url = f.hubFleetURL("/api/fleet"), let data = f.fetchJSON(url, timeout: 1.0),
      let hosts = data["hosts"] as? [[String: Any]] else { return .terminateNow }
    var running: [(host: String, row: [String: Any])] = []
    for h in hosts {
      for w in (h["workspaces"] as? [[String: Any]]) ?? [] where (w["liveSeats"] as? Int ?? 0) > 0 {
        running.append((h["host"] as? String ?? "", w))
      }
    }
    if running.isEmpty { return .terminateNow }
    let a = NSAlert()
    a.messageText = "\(running.count) workspace\(running.count == 1 ? "" : "s") keep\(running.count == 1 ? "s" : "") running in the background"
    a.informativeText = running.map { "• \($0.row["name"] as? String ?? "?") on \($0.host)" }.joined(separator: "\n")
      + "\n\nYour agents keep working after the app closes. Reopen Crate Engine anytime to check on them."
    a.addButton(withTitle: "Quit")
    a.addButton(withTitle: "Stop Them Too")
    a.addButton(withTitle: "Cancel")
    a.showsSuppressionButton = true
    a.suppressionButton?.title = "Don't show this again"
    let choice = a.runModal()
    if a.suppressionButton?.state == .on { UserDefaults.standard.set(true, forKey: key) }
    switch choice {
    case .alertFirstButtonReturn:
      return .terminateNow
    case .alertSecondButtonReturn:
      DispatchQueue.global(qos: .userInitiated).async {
        for r in running { if let p = r.row["path"] as? String { _ = WorkspacesMenu.shared.post(host: r.host, path: p, action: "stop") } }
        DispatchQueue.main.async { NSApp.reply(toApplicationShouldTerminate: true) }
      }
      return .terminateLater
    default:
      return .terminateCancel
    }
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

/// `--url <door>` from the launching CLI (`open <app> --args --url …`); nil
/// when the app was started from the Dock / Finder / Spotlight.
func directDoorURL() -> URL? {
  let args = CommandLine.arguments
  guard let i = args.firstIndex(of: "--url"), i + 1 < args.count else { return nil }
  guard let u = URL(string: args[i + 1]), let host = u.host, host == "127.0.0.1" || host == "localhost" else { return nil }
  return u
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

func htmlEscape(_ value: String) -> String {
  value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
}

func shellJSON(_ door: URL, route: String) -> [String: Any]? {
  guard var c = URLComponents(url: door, resolvingAgainstBaseURL: false) else { return nil }
  c.path = route; c.fragment = nil
  c.queryItems = (c.queryItems ?? []).filter { $0.name == "token" }
  guard let url = c.url else { return nil }
  var result: [String: Any]?
  let done = DispatchSemaphore(value: 0)
  let task = URLSession.shared.dataTask(with: URLRequest(url: url, timeoutInterval: 5)) { data, response, _ in
    if (response as? HTTPURLResponse)?.statusCode == 200, let data = data {
      result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    done.signal()
  }
  task.resume()
  if done.wait(timeout: .now() + 6) == .timedOut { task.cancel() }
  return result
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
  @objc func openServers(_ sender: Any?) { open("servers") } // the header's Servers button moved here (2026-09-13)
  @objc func openWorkspaces(_ sender: Any?) { open("workspaces") } // toggles the drawer
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
  // (updateNow/checkUpdates RETIRED 2026-08-18 with the top-level Update
  // menu — the app-menu "Update Crate Engine…" updates the WHOLE fleet via
  // the hub; the Health panel keeps its per-engine page button.)
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

  func hubFleetURL(_ path: String) -> URL? {
    guard let d = NSApp.delegate as? AppDelegate, let hub = d.hubURL,
      let comps = URLComponents(url: hub, resolvingAgainstBaseURL: false),
      let token = comps.queryItems?.first(where: { $0.name == "token" })?.value
    else { return nil }
    return URL(string: "http://127.0.0.1:\(comps.port ?? 0)\(path)?token=\(token)")
  }

  func fetchJSON(_ url: URL, method: String = "GET", body: Data? = nil, timeout: Double) -> [String: Any]? {
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

  // no shortcut lives here — answer key events without a fleet fetch
  func menuHasKeyEquivalent(_ menu: NSMenu, for event: NSEvent, target: AutoreleasingUnsafeMutablePointer<AnyObject?>, action: UnsafeMutablePointer<Selector?>) -> Bool { false }

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
      let header = NSMenuItem(title: "\(name)\(skew ? "  ⚠ engine differs — Update Crate Engine (app menu) fans out" : "")", action: nil, keyEquivalent: "")
      header.isEnabled = false
      menu.addItem(header)
      let workspaces = host["workspaces"] as? [[String: Any]] ?? []
      if state == "connected" || host["local"] as? Bool == true {
        // CE-136: an empty host must never dead-end — its row is the door to
        // the card (＋ new rig), loading the host's cockpit with &card=1.
        // This machine's doors live in File; another computer's row opens the
        // Open Project dialog with that computer selected (PDR open-project-doors).
        // Workspace Controls (Adam, 2026-09-24): Computers is about MACHINES —
        // projects live in the Workspaces menu. Each computer says plainly
        // whether its engine is current, and "Restart to finish" is one click.
        if let restart = host["restartNeeded"] as? Bool {
          if restart {
            let r = NSMenuItem(title: "   Restart to finish update…", action: #selector(restartHostItem(_:)), keyEquivalent: "")
            r.target = self
            r.representedObject = host
            menu.addItem(r)
          } else {
            let ok = NSMenuItem(title: "   Up to date", action: nil, keyEquivalent: "")
            ok.isEnabled = false
            menu.addItem(ok)
          }
        }
        let running = workspaces.filter { ($0["liveSeats"] as? Int ?? 0) > 0 }.count
        let summary = NSMenuItem(title: "   \(workspaces.filter { $0["archived"] as? Bool != true }.count) workspaces · \(running) running — see Workspaces", action: nil, keyEquivalent: "")
        summary.isEnabled = false
        menu.addItem(summary)
        if host["local"] as? Bool != true, host["cockpitUrl"] != nil {
          let add = NSMenuItem(title: "   Open a project on \(name)…", action: #selector(AppActions.openProjectOn(_:)), keyEquivalent: "")
          add.target = AppActions.shared
          add.representedObject = name
          menu.addItem(add)
        }
      } else {
        // asleep/failed/unknown: one calm row; click = Connect. Connecting: say so.
        if state == "connecting" {
          let w = NSMenuItem(title: "   connecting…", action: nil, keyEquivalent: "")
          w.isEnabled = false
          menu.addItem(w)
        } else {
          let note = host["note"] as? String ?? state
          let item = NSMenuItem(title: "   \(note) — Connect", action: #selector(connectHost(_:)), keyEquivalent: "")
          item.target = self
          item.representedObject = name
          menu.addItem(item)
        }
      }
      menu.addItem(NSMenuItem.separator())
    }
    let add = NSMenuItem(title: "Add a Computer…", action: #selector(AppActions.addServer(_:)), keyEquivalent: "")
    add.target = AppActions.shared
    menu.addItem(add)
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

  // ── S4: Restart to finish (Adam, 2026-09-24: one click, never automatic,
  // offered only when no team on that computer is mid-task — busy ones are
  // named). Restart = the proven launch flow (`crate open [--remote]`), which
  // detects the stale server and restarts it in place; running workspaces
  // stop for a few seconds and come straight back.
  @objc func restartHostItem(_ sender: NSMenuItem) {
    guard let host = sender.representedObject as? [String: Any] else { return }
    restartHosts([host], confirm: true)
  }

  func restartHosts(_ hosts: [[String: Any]], confirm: Bool) {
    let blocked = hosts.filter { !(($0["busy"] as? [String]) ?? []).isEmpty }
    let ready = hosts.filter { (($0["busy"] as? [String]) ?? []).isEmpty }
    if !blocked.isEmpty {
      let a = NSAlert()
      a.messageText = ready.isEmpty ? "Not yet — a team is in the middle of a task" : "Some computers must wait"
      a.informativeText = blocked.map { h in
        let names = (h["busy"] as? [String] ?? []).joined(separator: ", ")
        return "\(h["host"] as? String ?? "?"): \(names) \((h["busy"] as? [String] ?? []).count == 1 ? "is" : "are") mid-task."
      }.joined(separator: "\n") + "\n\nRestarting now would cut those turns off. Try again when they finish."
      a.runModal()
    }
    if ready.isEmpty { return }
    if confirm {
      let a = NSAlert()
      let names = ready.map { $0["host"] as? String ?? "?" }.joined(separator: " and ")
      a.messageText = "Restart \(names) to finish the update?"
      a.informativeText = "Running workspaces stop for a few seconds and come straight back on the new engine. Nothing is lost."
      a.addButton(withTitle: "Restart")
      a.addButton(withTitle: "Cancel")
      if a.runModal() != .alertFirstButtonReturn { return }
    }
    guard let d = NSApp.delegate as? AppDelegate else { return }
    let remotes = ready.filter { $0["local"] as? Bool != true }
    let local = ready.contains { $0["local"] as? Bool == true }
    let viewing = d.webView.url
    DispatchQueue.global(qos: .userInitiated).async { [self] in
      for h in remotes {
        let name = h["host"] as? String ?? ""
        let oldPort = (h["cockpitUrl"] as? String).flatMap { URL(string: $0)?.port }
        if case .success(let door) = launchEngine(remote: name) {
          if let u = hubFleetURL("/api/fleet/connect"), let body = try? JSONSerialization.data(withJSONObject: ["host": name]) {
            _ = fetchJSON(u, method: "POST", body: body, timeout: 150) // re-dial the fleet link onto the new server
          }
          if let old = oldPort, viewing?.port == old {
            DispatchQueue.main.async { d.webView.load(URLRequest(url: door)) } // the window was showing that computer
          }
        }
      }
      if local { DispatchQueue.main.async { d.startLaunch() } } // this Mac's engine last: the window rides it
    }
  }

  /// Adam's ask (2026-08-18): crate-update lives IN the app — the app-menu
  /// item (where Preferences would be) updates the hub + EVERY remembered
  /// host in one click, then reports per host. Running engines keep their
  /// loaded code until relaunch — the Fleet menu's ⚠ skew markers are the
  /// honest "restart to finish" signal. The old top-level Update menu (which
  /// only covered the viewed host + a REMOTE=-gated local fan-out) retires:
  /// one home per control.
  @objc func updateFleet(_ sender: Any?) {
    guard let url = hubFleetURL("/api/fleet/update") else {
      let a = NSAlert()
      a.messageText = "Fleet brain not up yet"
      a.informativeText = "The local engine hasn't answered — give it a few seconds and try again."
      a.runModal()
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [self] in
      // npm install per host — minutes, not seconds
      let res = fetchJSON(url, method: "POST", body: Data("{}".utf8), timeout: 900)
      // S4: read which computers still run the old engine HERE, off the main thread
      let hosts = (hubFleetURL("/api/fleet").flatMap { fetchJSON($0, timeout: 3) }?["hosts"] as? [[String: Any]]) ?? []
      DispatchQueue.main.async { [self] in
        let a = NSAlert()
        if let results = res?["results"] as? [[String: Any]] {
          // S4: the update FINISHES here — which computers still run the old
          // engine, and a one-click Restart for them (busy teams are named).
          let behind = hosts.filter { $0["restartNeeded"] as? Bool == true }
          a.messageText = behind.isEmpty ? "Crate Engine is up to date everywhere" : "Crate Engine updated — restart to finish"
          a.informativeText = results.map { r in
            let host = r["local"] as? Bool == true ? "This Mac" : (r["host"] as? String ?? "?")
            let ok = r["ok"] as? Bool == true ? "✓" : "✗"
            return "\(ok) \(host) — \(r["note"] as? String ?? "")"
          }.joined(separator: "\n") + (behind.isEmpty ? "" : "\n\nStill running the old engine: \(behind.map { $0["host"] as? String ?? "?" }.joined(separator: ", ")). Restart finishes it — workspaces stop for a few seconds and come straight back.")
          if !behind.isEmpty {
            a.addButton(withTitle: "Restart Now")
            a.addButton(withTitle: "Later")
            if a.runModal() == .alertFirstButtonReturn { restartHosts(behind, confirm: false) }
            return
          }
        } else {
          a.messageText = "Fleet update did not answer"
          a.informativeText = "The hub stopped responding mid-update — check the Fleet menu, or run `crate update` in a terminal to see the detail."
        }
        a.runModal()
      }
    }
  }
}

/// THE WORKSPACES MENU (Workspace Controls S3 — Adam, 2026-09-24): every
/// project on every computer, its plain status, and Open · Stop · Resume ·
/// Resume Fresh · Archive — the same engine routes the drawer uses, so the two
/// can never disagree. Rebuilt from the hub's /api/fleet on every open.
/// Stopping agents always asks first and says what a mid-task stop costs.
final class WorkspacesMenu: NSObject, NSMenuDelegate {
  static let shared = WorkspacesMenu()
  private var fleet: FleetActions { FleetActions.shared }

  static func ago(_ ms: Double?) -> String {
    guard let ms = ms, ms > 0 else { return "" }
    let m = max(0, Int((Date().timeIntervalSince1970 * 1000 - ms) / 60000))
    return m < 1 ? "just now" : m < 60 ? "\(m)m" : m < 1440 ? "\(m / 60)h" : "\(m / 1440)d"
  }
  static func status(_ w: [String: Any]) -> String {
    let live = w["liveSeats"] as? Int ?? 0
    if live > 0 {
      let busy = !((w["busySeats"] as? [String]) ?? []).isEmpty
      var parts = [busy ? "working" : "idle" + { let a = ago(w["lastActivityMs"] as? Double); return a.isEmpty ? "" : " \(a)" }(), "\(live) agents"]
      if let mb = w["memMB"] as? Int, mb > 0 { parts.append(mb >= 1024 ? String(format: "%.1f GB", Double(mb) / 1024) : "\(mb) MB") }
      return parts.joined(separator: " · ")
    }
    return w["desired"] as? String == "running" ? "resuming" : "stopped"
  }

  private func actionItem(_ title: String, _ action: String, _ ctx: [String: Any]) -> NSMenuItem {
    let it = NSMenuItem(title: title, action: #selector(act(_:)), keyEquivalent: "")
    it.target = self
    var c = ctx
    c["action"] = action
    it.representedObject = c
    return it
  }

  /// ⌃⌘S must work before the menu was ever opened (Adam's docket test,
  /// 2026-09-24): a lazily built menu has no item to match, so answer the key
  /// equivalent here — and answer every OTHER key without populating, so no
  /// shortcut anywhere in the app ever waits on a fleet fetch.
  func menuHasKeyEquivalent(_ menu: NSMenu, for event: NSEvent, target: AutoreleasingUnsafeMutablePointer<AnyObject?>, action: UnsafeMutablePointer<Selector?>) -> Bool {
    let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    if event.charactersIgnoringModifiers?.lowercased() == "s" && mods == [.command, .control] {
      target.pointee = PanelActions.shared
      action.pointee = #selector(PanelActions.openWorkspaces(_:))
      return true
    }
    return false
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    guard let url = fleet.hubFleetURL("/api/fleet"), let data = fleet.fetchJSON(url, timeout: 1.5),
      let hosts = data["hosts"] as? [[String: Any]]
    else {
      menu.addItem(withTitle: "The local engine isn't answering yet — give it a moment", action: nil, keyEquivalent: "")
      return
    }
    for host in hosts {
      let name = host["host"] as? String ?? "?"
      let reachable = host["local"] as? Bool == true || host["state"] as? String == "connected"
      let header = NSMenuItem(title: name, action: nil, keyEquivalent: "")
      header.isEnabled = false
      menu.addItem(header)
      if !reachable {
        if host["state"] as? String == "connecting" {
          // a dial is already in flight (e.g. the first minute after launch) —
          // say so; offering "Connect" here read as broken
          let w = NSMenuItem(title: "   connecting…", action: nil, keyEquivalent: "")
          w.isEnabled = false
          menu.addItem(w)
        } else {
          let note = host["note"] as? String ?? (host["state"] as? String ?? "not connected")
          let c = NSMenuItem(title: "   \(note) — Connect", action: #selector(FleetActions.connectHost(_:)), keyEquivalent: "")
          c.target = fleet
          c.representedObject = name
          menu.addItem(c)
        }
        menu.addItem(NSMenuItem.separator())
        continue
      }
      let rows = (host["workspaces"] as? [[String: Any]]) ?? []
      let current = rows.filter { $0["archived"] as? Bool != true }
      let archived = rows.filter { $0["archived"] as? Bool == true }
      if current.isEmpty {
        let none = NSMenuItem(title: "   No workspaces", action: nil, keyEquivalent: "")
        none.isEnabled = false
        menu.addItem(none)
      }
      for w in current {
        let live = (w["liveSeats"] as? Int ?? 0) > 0
        let item = NSMenuItem(title: "\(live ? "●" : "○")  \(w["name"] as? String ?? "?")  —  \(WorkspacesMenu.status(w))", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        let ctx: [String: Any] = ["host": name, "row": w]
        sub.addItem(actionItem("Open", "open", ctx))
        sub.addItem(NSMenuItem.separator())
        if live {
          sub.addItem(actionItem("Stop…", "stop", ctx))
        } else {
          sub.addItem(actionItem("Resume", "resume", ctx))
          sub.addItem(actionItem("Resume Fresh…", "resume-fresh", ctx))
          sub.addItem(actionItem("Archive…", "archive", ctx))
        }
        item.submenu = sub
        menu.addItem(item)
      }
      if !archived.isEmpty {
        let arch = NSMenuItem(title: "   Archived (\(archived.count))", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for w in archived {
          let row = NSMenuItem(title: w["name"] as? String ?? "?", action: nil, keyEquivalent: "")
          let rs = NSMenu()
          let ctx: [String: Any] = ["host": name, "row": w]
          rs.addItem(actionItem("Restore", "unarchive", ctx))
          rs.addItem(actionItem("Resume", "resume", ctx))
          row.submenu = rs
          sub.addItem(row)
        }
        arch.submenu = sub
        menu.addItem(arch)
      }
      let running = current.filter { ($0["liveSeats"] as? Int ?? 0) > 0 }
      if !running.isEmpty {
        let all = NSMenuItem(title: "   Stop All on \(name)…", action: #selector(stopAll(_:)), keyEquivalent: "")
        all.target = self
        all.representedObject = ["host": name, "rows": running]
        menu.addItem(all)
      }
      menu.addItem(NSMenuItem.separator())
    }
    let panel = NSMenuItem(title: "Show Workspaces Panel", action: #selector(PanelActions.openWorkspaces(_:)), keyEquivalent: "s")
    panel.keyEquivalentModifierMask = [.command, .control] // ⌃⌘S — the Mac's "Show Sidebar" chord
    panel.target = PanelActions.shared
    menu.addItem(panel)
  }

  /// The open drawer re-reads its list the moment an action lands.
  static func refreshDrawer() {
    (NSApp.delegate as? AppDelegate)?.webView.evaluateJavaScript("window.crateRefreshWorkspaces && window.crateRefreshWorkspaces()", completionHandler: nil)
  }

  /// Plain-words confirmation for anything that closes agent sessions.
  static func confirmStop(_ name: String, host: String, row: [String: Any], archive: Bool) -> Bool {
    let live = row["liveSeats"] as? Int ?? 0
    let busy = (row["busySeats"] as? [String]) ?? []
    if live == 0 && !archive { return true }
    let a = NSAlert()
    a.messageText = "\(archive ? "Archive" : "Stop") \(name)?"
    var info = live > 0 ? "This closes its \(live) agent session\(live == 1 ? "" : "s") on \(host). " : ""
    info += archive ? "Everything is saved — it moves to Archived, and one click restores it." : "Everything is saved — resume it anytime from the Workspaces menu."
    if !busy.isEmpty { info += "\n\n⚠ \(busy.joined(separator: ", ")) \(busy.count == 1 ? "is" : "are") in the middle of a task — that turn will be lost." }
    a.informativeText = info
    a.alertStyle = busy.isEmpty ? .informational : .warning
    a.addButton(withTitle: archive ? "Archive Workspace" : "Stop Workspace")
    a.addButton(withTitle: "Cancel")
    return a.runModal() == .alertFirstButtonReturn
  }

  func post(host: String, path: String, action: String) -> [String: Any]? {
    guard let u = fleet.hubFleetURL("/api/fleet/workspace"),
      let body = try? JSONSerialization.data(withJSONObject: ["host": host, "path": path, "action": action])
    else { return nil }
    return fleet.fetchJSON(u, method: "POST", body: body, timeout: 120)
  }

  @objc func act(_ sender: NSMenuItem) {
    guard let c = sender.representedObject as? [String: Any], let action = c["action"] as? String,
      let host = c["host"] as? String, let row = c["row"] as? [String: Any], let path = row["path"] as? String
    else { return }
    let name = row["name"] as? String ?? "this workspace"
    switch action {
    case "open":
      if let s = row["url"] as? String, let u = URL(string: s), let d = NSApp.delegate as? AppDelegate { d.webView.load(URLRequest(url: u)) }
      return
    case "stop", "archive":
      if !WorkspacesMenu.confirmStop(name, host: host, row: row, archive: action == "archive") { return }
    case "resume-fresh":
      let a = NSAlert()
      a.messageText = "Resume \(name) fresh?"
      a.informativeText = "Every agent starts a clean conversation, reads the note written when it stopped, then scouts the project before doing anything."
      a.addButton(withTitle: "Resume Fresh")
      a.addButton(withTitle: "Cancel")
      if a.runModal() != .alertFirstButtonReturn { return }
    default:
      break
    }
    DispatchQueue.global(qos: .userInitiated).async { [self] in
      let r = post(host: host, path: path, action: action)
      DispatchQueue.main.async {
        WorkspacesMenu.refreshDrawer()
        if let err = r?["error"] as? String {
          let a = NSAlert(); a.messageText = "\(name): that didn't work"; a.informativeText = err; a.runModal()
        } else if let left = (r?["teardown"] as? [String: Any])?["remaining"] as? Int, left > 0 {
          let a = NSAlert(); a.messageText = "\(name) stopped — \(left) process(es) held on"
          a.informativeText = "The engine's sweep retries within 5 minutes."; a.runModal()
        }
      }
    }
  }

  @objc func stopAll(_ sender: NSMenuItem) {
    guard let c = sender.representedObject as? [String: Any], let host = c["host"] as? String,
      let rows = c["rows"] as? [[String: Any]] else { return }
    let busy = rows.flatMap { r in ((r["busySeats"] as? [String]) ?? []).isEmpty ? [] : [r["name"] as? String ?? "?"] }
    let agents = rows.reduce(0) { $0 + ($1["liveSeats"] as? Int ?? 0) }
    let a = NSAlert()
    a.messageText = "Stop all \(rows.count) workspace\(rows.count == 1 ? "" : "s") on \(host)?"
    a.informativeText = "This closes \(agents) agent session\(agents == 1 ? "" : "s"). Everything is saved — resume any of them from the Workspaces menu."
      + (busy.isEmpty ? "" : "\n\n⚠ Mid-task right now: \(busy.joined(separator: ", ")) — those turns will be lost.")
    a.alertStyle = busy.isEmpty ? .informational : .warning
    a.addButton(withTitle: "Stop All")
    a.addButton(withTitle: "Cancel")
    if a.runModal() != .alertFirstButtonReturn { return }
    DispatchQueue.global(qos: .userInitiated).async { [self] in
      for r in rows { if let p = r["path"] as? String { _ = post(host: host, path: p, action: "stop") } }
      DispatchQueue.main.async { WorkspacesMenu.refreshDrawer() }
    }
  }
}

/// App-level actions (chrome reorg, Adam 2026-09-13): About shows the LIVE
/// engine version (asked of the local hub at click time — the shell is a
/// frame, the engine is what gets released), and the File menu's doors land
/// on the New Rig card with the right door pre-opened.
final class AppActions: NSObject {
  static let shared = AppActions()
  private func hub() -> (base: String, token: String)? {
    guard let d = NSApp.delegate as? AppDelegate, let hub = d.hubURL,
      let comps = URLComponents(url: hub, resolvingAgainstBaseURL: false),
      let token = comps.queryItems?.first(where: { $0.name == "token" })?.value
    else { return nil }
    return ("http://127.0.0.1:\(comps.port ?? 0)", token)
  }
  @objc func about(_ sender: Any?) {
    var engine = "engine not reachable — is the local engine up?"
    if let h = hub(), let url = URL(string: "\(h.base)/api/version?token=\(h.token)") {
      var out: [String: Any]?
      let sem = DispatchSemaphore(value: 0)
      URLSession.shared.dataTask(with: URLRequest(url: url, timeoutInterval: 1.5)) { data, _, _ in
        if let d = data { out = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] }
        sem.signal()
      }.resume()
      _ = sem.wait(timeout: .now() + 1.5)
      if let v = out {
        let loaded = v["loadedSha"] as? String ?? "?"
        let disk = v["version"] as? String ?? loaded
        engine = "Engine \(loaded)" + (disk != loaded ? "  (update \(disk) on disk — relaunch to load it)" : "")
      }
    }
    let shell = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    NSApp.orderFrontStandardAboutPanel(options: [
      .applicationName: "Crate Engine",
      .applicationVersion: engine,
      .version: "app shell \(shell)",
      .credits: NSAttributedString(string: "crate-engine.ai\nThe app is a native frame around the engine's cockpit; the engine version above is what updates."),
    ])
  }
  /// New/Clone land on the New Project card; Open/Add-a-computer are DIALOGS
  /// over whatever cockpit is showing (no navigation) — the page opens them
  /// itself when it is ready, else the hub loads with the door in the URL.
  private func openDoor(_ door: String, computer: String = "") {
    guard let d = NSApp.delegate as? AppDelegate, let hub = d.hubURL else { return }
    if (door == "open" || door == "computer") && d.cockpitReady {
      let arg = door == "open" ? "'open','\(computer)'" : "'computer'"
      d.webView.evaluateJavaScript("window.crateOpenDoor && window.crateOpenDoor(\(arg))", completionHandler: nil)
      return
    }
    let tail = door == "open" || door == "computer" ? "&door=\(door)&computer=\(computer)" : "&card=1&door=\(door)"
    if let url = URL(string: hub.absoluteString + tail) { d.webView.load(URLRequest(url: url)) }
  }
  @objc func newRig(_ sender: Any?) { openDoor("new") }
  @objc func openRig(_ sender: Any?) { openDoor("open") }
  @objc func cloneRig(_ sender: Any?) { openDoor("clone") }
  @objc func addServer(_ sender: Any?) { openDoor("computer") }
  @objc func openProjectOn(_ sender: NSMenuItem) { openDoor("open", computer: sender.representedObject as? String ?? "") }
  @objc func website(_ sender: Any?) { NSWorkspace.shared.open(URL(string: "https://crate-engine.ai")!) }
}

final class RecentMenu: NSObject, NSMenuDelegate {
  static let shared = RecentMenu()
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    guard let d = NSApp.delegate as? AppDelegate else { return }
    for entry in d.recentProjects.entries {
      let item = NSMenuItem(title: "\(entry.name) — \(entry.host.isEmpty ? "This Mac" : entry.host)", action: #selector(open(_:)), keyEquivalent: "")
      item.target = self; item.representedObject = entry.id
      item.toolTip = entry.path
      menu.addItem(item)
    }
    if menu.items.isEmpty { menu.addItem(withTitle: "No recent projects yet", action: nil, keyEquivalent: "") }
  }
  @objc func open(_ sender: NSMenuItem) {
    guard let d = NSApp.delegate as? AppDelegate, let id = sender.representedObject as? String,
      let entry = d.recentProjects.entries.first(where: { $0.id == id }) else { return }
    d.openRecent(entry)
  }
}

// Minimal real menus — copy/paste and Cmd-Q must work inside the cockpit
// (and inside TUI panes). Without an Edit menu, WKWebView eats shortcuts.
let mainMenu = NSMenu()
let appItem = NSMenuItem(); mainMenu.addItem(appItem)
let appMenu = NSMenu()
let aboutItem = NSMenuItem(title: "About Crate Engine", action: #selector(AppActions.about(_:)), keyEquivalent: "")
aboutItem.target = AppActions.shared // live engine version, not the plist's
appMenu.addItem(aboutItem)
appMenu.addItem(NSMenuItem.separator())
// Adam's ask (2026-08-18): the updater lives where Preferences would —
// one click, whole fleet (⌘U kept from the retired Update menu).
let fleetUpdItem = NSMenuItem(title: "Update Crate Engine…", action: #selector(FleetActions.updateFleet(_:)), keyEquivalent: "u")
fleetUpdItem.target = FleetActions.shared
appMenu.addItem(fleetUpdItem)
appMenu.addItem(NSMenuItem.separator())
appMenu.addItem(withTitle: "Hide Crate Engine", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
appMenu.addItem(withTitle: "Quit Crate Engine", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appItem.submenu = appMenu
// File (chrome reorg, Adam 2026-09-13): the doors a person reaches for first,
// where every Mac app keeps them. Each lands on the New Rig card with that
// door open — "+ new rig on this Mac" left the Servers menu for here.
let fileItem = NSMenuItem(); mainMenu.addItem(fileItem)
let fileMenu = NSMenu(title: "File")
for (title, sel, key) in [
  ("New Project…", #selector(AppActions.newRig(_:)), "n"),
  ("Open Project…", #selector(AppActions.openRig(_:)), "o"),
  ("Clone from GitHub…", #selector(AppActions.cloneRig(_:)), ""),
  ("Add a Computer…", #selector(AppActions.addServer(_:)), ""),
] {
  let it = NSMenuItem(title: title, action: sel, keyEquivalent: key)
  it.target = AppActions.shared
  fileMenu.addItem(it)
}
let recentItem = NSMenuItem(title: "Recent Projects", action: nil, keyEquivalent: "")
let recentMenu = NSMenu(title: "Recent Projects")
recentMenu.delegate = RecentMenu.shared
recentItem.submenu = recentMenu
fileMenu.addItem(recentItem)
fileMenu.addItem(NSMenuItem.separator())
fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
fileItem.submenu = fileMenu
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
// View = what is shown: the four panels, the studio. (The Workspaces drawer's
// ⌃⌘S moved into the Workspaces menu — one home per control, 2026-09-24.)
let teamMenuItem = NSMenuItem(title: "Team", action: #selector(PanelActions.openTeam(_:)), keyEquivalent: "1")
teamMenuItem.target = PanelActions.shared
viewMenu.addItem(teamMenuItem)
let contextMenuItem = NSMenuItem(title: "Context", action: #selector(PanelActions.openContext(_:)), keyEquivalent: "2")
contextMenuItem.target = PanelActions.shared
viewMenu.addItem(contextMenuItem)
let healthMenuItem = NSMenuItem(title: "Health", action: #selector(PanelActions.openHealth(_:)), keyEquivalent: "3")
healthMenuItem.target = PanelActions.shared
viewMenu.addItem(healthMenuItem)
let serversMenuItem = NSMenuItem(title: "Dev Servers", action: #selector(PanelActions.openServers(_:)), keyEquivalent: "5")
serversMenuItem.target = PanelActions.shared
viewMenu.addItem(serversMenuItem)
viewMenu.addItem(NSMenuItem.separator())
let studioMenuItem = NSMenuItem(title: "Design Studio", action: #selector(PanelActions.openStudio(_:)), keyEquivalent: "4")
studioMenuItem.target = PanelActions.shared
viewMenu.addItem(studioMenuItem)
viewItem.submenu = viewMenu
// Workspaces (Workspace Controls S3): projects on every computer + their actions.
let workspacesItem = NSMenuItem(); mainMenu.addItem(workspacesItem)
let workspacesMenu = NSMenu(title: "Workspaces")
workspacesMenu.delegate = WorkspacesMenu.shared // rebuilt from /api/fleet each open
workspacesMenu.autoenablesItems = false
workspacesItem.submenu = workspacesMenu
let fleetItem = NSMenuItem(); mainMenu.addItem(fleetItem)
let fleetMenu = NSMenu(title: "Computers") // was "Fleet", then "Servers" (Adam, 2026-09-13): the operator's word
fleetMenu.delegate = FleetActions.shared // rows rebuilt from /api/fleet each open
fleetMenu.autoenablesItems = false
fleetItem.submenu = fleetMenu
// (The top-level Update menu RETIRED 2026-08-18 — the fleet-wide updater
// lives in the app menu now; the Health panel keeps its per-engine button.)
// Window + Help — the standard pair every Mac app carries.
let windowItem = NSMenuItem(); mainMenu.addItem(windowItem)
let windowMenu = NSMenu(title: "Window")
windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
windowMenu.addItem(NSMenuItem.separator())
windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
windowItem.submenu = windowMenu
app.windowsMenu = windowMenu
let helpItem = NSMenuItem(); mainMenu.addItem(helpItem)
let helpMenu = NSMenu(title: "Help")
let siteItem = NSMenuItem(title: "Crate Engine Website", action: #selector(AppActions.website(_:)), keyEquivalent: "")
siteItem.target = AppActions.shared
helpMenu.addItem(siteItem)
helpItem.submenu = helpMenu
app.helpMenu = helpMenu
app.mainMenu = mainMenu

let delegate = AppDelegate()
app.delegate = delegate
app.run()
