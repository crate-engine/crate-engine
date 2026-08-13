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
    win.makeKeyAndOrderFront(nil)
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
editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
editItem.submenu = editMenu
app.mainMenu = mainMenu

let delegate = AppDelegate()
app.delegate = delegate
app.run()
