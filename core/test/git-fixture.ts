import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/** Protocol fixtures need real resolvable commits: approval no longer accepts
 * missing pins. No remotes, credentials or shared repositories are involved. */
export function initProtocolGit(root: string, branches: string[] = []): void {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-qb", "main");
  git("config", "user.name", "Protocol fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("commit", "-q", "--allow-empty", "-m", "fixture base");
  for (const branch of branches) git("branch", branch);
}

/** Supply the current brief identity for existing happy-path fixtures only.
 * Stale/missing-identity regressions call agentctl directly. */
export function verdictArgs(root: string, args: string[]): string[] {
  if (args[0] !== "emit" || !["verdict", "gate_release"].includes(args[1] ?? "")) return args;
  const conf = readFileSync(join(root, ".agents/rig.conf"), "utf8");
  const concurrent = /CONCURRENT_LOOPS=["']?(?:1|enabled)/.test(conf);
  const task = args.find(a => a.startsWith("task="))?.slice(5) ?? args.find(a => a.startsWith("branch="))?.slice(7);
  const path = concurrent && task ? "pins/" + task.replace(/[^A-Za-z0-9._-]/g, "-") : "pin-code_ready";
  let pin: Record<string, string> = {};
  try { pin = Object.fromEntries(readFileSync(join(root, ".agents/state", path), "utf8").trim().split(/\s+/).map(t => t.split("="))); } catch {}
  return [...args, ...["sha", "round"].filter(k => pin[k] && !args.some(a => a.startsWith(k + "="))).map(k => k + "=" + pin[k])];
}
