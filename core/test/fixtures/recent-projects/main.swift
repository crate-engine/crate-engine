import Foundation
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: root) }
let file = root.appendingPathComponent("recent-projects.json")
let store = RecentProjects(file: file)
assert(store.entries.isEmpty)
for i in 0..<7 { try store.record(RecentProject(host: "superman", path: "/projects/\(i)", name: "Same name", openedAt: Date(timeIntervalSince1970: Double(i)))) }
assert(store.entries.count == 5 && store.entries.first?.path == "/projects/6")
try store.record(RecentProject(host: "", path: "/projects/6", name: "Local", openedAt: Date(timeIntervalSince1970: 8)))
assert(store.entries.count == 5 && store.entries[1].host == "superman")
try store.record(RecentProject(host: "superman", path: "/projects/6", name: "Remote", openedAt: Date(timeIntervalSince1970: 9)))
assert(store.entries.count == 5 && store.entries[0].name == "Remote")
let restored = RecentProjects(file: file)
assert(restored.entries == store.entries)
// An offline host or missing path is retained: reading history never probes/removes it.
assert(restored.entries[0].path == "/projects/6")
let text = try String(contentsOf: file, encoding: .utf8)
assert(!text.contains("token") && !text.contains("http"))
let fresh = projectDoor(URL(string: "http://127.0.0.1:4242/?token=fresh&card=1")!, project: "/space & quote's/project")!
let parts = URLComponents(url: fresh, resolvingAgainstBaseURL: false)!
assert(parts.path == "/team" && parts.queryItems!.count == 2)
assert(parts.queryItems!.last!.value == "/space & quote's/project")
assert(projectDoor(URL(string: "https://example.com/?token=x")!, project: "/x") == nil)
try Data("broken".utf8).write(to: file)
assert(RecentProjects(file: file).entries.isEmpty)
print("Recent projects persistence and fresh-door tests PASS")
