import Foundation

struct RecentProject: Codable, Equatable {
  var host: String // empty = this computer; never a tunnel URL or credential
  var path: String
  var name: String
  var openedAt: Date
  var id: String { host + "\n" + path }
  var valid: Bool {
    path.hasPrefix("/") && !path.contains("\n") && !name.isEmpty &&
      (host.isEmpty || host.range(of: "^[A-Za-z0-9][A-Za-z0-9_.@-]*$", options: .regularExpression) != nil)
  }
}

final class RecentProjects {
  let file: URL
  private(set) var entries: [RecentProject] = []
  init(file: URL) {
    self.file = file
    if let data = try? Data(contentsOf: file),
       let saved = try? JSONDecoder().decode([RecentProject].self, from: data) {
      var seen = Set<String>()
      entries = Array(saved.filter { $0.valid }.sorted { $0.openedAt > $1.openedAt }
        .filter { seen.insert($0.id).inserted }.prefix(5))
    }
  }
  func record(_ entry: RecentProject) throws {
    guard entry.valid else { return }
    var next = entries.filter { $0.id != entry.id }
    next.insert(entry, at: 0)
    next = Array(next.prefix(5))
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(next).write(to: file, options: .atomic)
    entries = next
  }
}

/// Rebuild each connection from a fresh authenticated door, never a saved port/token.
func projectDoor(_ door: URL, project: String) -> URL? {
  guard var c = URLComponents(url: door, resolvingAgainstBaseURL: false),
        c.scheme == "http", c.host == "127.0.0.1" || c.host == "localhost",
        let token = c.queryItems?.first(where: { $0.name == "token" }) else { return nil }
  c.path = "/team"; c.fragment = nil
  c.queryItems = [token, URLQueryItem(name: "project", value: project)]
  return c.url
}
