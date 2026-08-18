// The Linux headless server's pure plans (PDR dev/pdr/linux-headless-server.md):
// app-url parsing, the tunnel plan, the display gate, the operator handoff.
import test from "node:test";
import assert from "node:assert/strict";
import { parseAppUrl, tunnelPlan } from "../src/gui/remote.js";
import { hasDisplay, headlessHandoff } from "../src/gui/appwindow.js";

test("parseAppUrl: a real app-url payload parses (port + token)", () => {
  const app = parseAppUrl("http://127.0.0.1:58582/team?token=abc-123\n");
  assert.deepEqual(app, { port: "58582", token: "abc-123" });
});

test("parseAppUrl: refuses non-loopback, portless, tokenless, and garbage", () => {
  assert.equal(parseAppUrl("http://0.0.0.0:5858/team?token=x"), undefined);
  assert.equal(parseAppUrl("http://127.0.0.1/team?token=x"), undefined);
  assert.equal(parseAppUrl("http://127.0.0.1:5858/team"), undefined);
  assert.equal(parseAppUrl("not a url at all"), undefined);
  assert.equal(parseAppUrl(""), undefined);
});

test("tunnelPlan: same port both ends, BatchMode + ExitOnForwardFailure, tokened URLs", () => {
  const plan = tunnelPlan({ port: "58582", token: "abc" }, "superman-wifi");
  assert.deepEqual(plan.tunnelArgv, [
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-N", "-L", "58582:127.0.0.1:58582",
    "superman-wifi",
  ]);
  assert.equal(plan.probeUrl, "http://127.0.0.1:58582/health?token=abc");
  assert.equal(plan.teamUrl, "http://127.0.0.1:58582/team?token=abc");
});

test("parseAppUrl + tunnelPlan: &pv= (the preview proxy) rides the handshake and gets its own forward", () => {
  const app = parseAppUrl("http://127.0.0.1:58582/start?token=abc&pv=58600\n");
  assert.deepEqual(app, { port: "58582", token: "abc", previewPort: "58600", previewPorts: ["58600"] });
  const plan = tunnelPlan(app!, "superman");
  assert.deepEqual(plan.tunnelArgv, [
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-N",
    "-L", "58582:127.0.0.1:58582",
    "-L", "58600:127.0.0.1:58600",
    "superman",
  ]);
  // lifecycle PDR: pv is a comma LIST now — every workspace's proxy gets a forward
  const multi = parseAppUrl("http://127.0.0.1:58582/team?token=abc&pv=58600,58601");
  assert.deepEqual(multi!.previewPorts, ["58600", "58601"]);
  const mplan = tunnelPlan(multi!, "superman").tunnelArgv.join(" ");
  assert.match(mplan, /-L 58600:127\.0\.0\.1:58600/);
  assert.match(mplan, /-L 58601:127\.0\.0\.1:58601/);
  // a junk entry inside a list is dropped, valid neighbours survive
  assert.deepEqual(parseAppUrl("http://127.0.0.1:1/team?token=t&pv=58600,nope")!.previewPorts, ["58600"]);
  // a pre-preview server (no pv) keeps the single-forward plan byte-identical
  const old = parseAppUrl("http://127.0.0.1:58582/team?token=abc");
  assert.deepEqual(old, { port: "58582", token: "abc" });
  assert.ok(!tunnelPlan(old!, "superman").tunnelArgv.includes("-L 58600:127.0.0.1:58600"));
  // junk pv never produces a forward
  assert.deepEqual(parseAppUrl("http://127.0.0.1:58582/team?token=abc&pv=nope"), { port: "58582", token: "abc" });
});

test("hasDisplay: darwin always; linux only with DISPLAY or WAYLAND_DISPLAY", () => {
  assert.equal(hasDisplay("darwin", {}), true);
  assert.equal(hasDisplay("linux", {}), false);
  assert.equal(hasDisplay("linux", { DISPLAY: ":0" }), true);
  assert.equal(hasDisplay("linux", { WAYLAND_DISPLAY: "wayland-0" }), true);
  assert.equal(hasDisplay("linux", { DISPLAY: "" }), false);
});

test("headlessHandoff: names the port, the URL, and both open paths", () => {
  const lines = headlessHandoff("http://127.0.0.1:58582/team?token=abc").join("\n");
  assert.match(lines, /headless server/);
  assert.match(lines, /crate open --remote/);
  assert.match(lines, /ssh -N -L 58582:127\.0\.0\.1:58582/);
  assert.match(lines, /http:\/\/127\.0\.0\.1:58582\/team\?token=abc/);
});
