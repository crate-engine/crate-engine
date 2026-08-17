// CE-106 — the ONE dev-port resolution, for the TypeScript side.
//
// The port used to be worked out independently in bin/dev-server,
// bin/preview-tunnel, core/src/doctor.ts and core/src/gui/servers.ts, with
// different precedences: the two bash scripts `source`d .agents/dev.conf ON TOP
// of rig.conf (so the helper file silently won), while the TS readers never
// looked at dev.conf at all. A rig could therefore run its dev server on one
// port while the cockpit diagnosed another — the "two sources of truth" the rig
// filed on 2026-08-12 and re-confirmed on 08-13.
//
// bin/serve-resolve owns the resolution now. This module ASKS it rather than
// re-implementing it, so there is one order in one place:
//   port        = DEV_PORT -> the last :port in DEV_URL -> 3000
//   previewPort = PREVIEW_DEV_PORT -> port
// with rig.conf beating dev.conf on every key.
//
// Fail-open: if serve-resolve is unreachable (a rig whose .agents/bin symlink is
// dangling — doctor's own check 1 reports that separately) we fall back to the
// same precedence read straight from the conf files, and say which path was
// taken. A diagnostic that dies because a helper is missing helps nobody.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DevPorts {
  port: number;
  previewPort: number;
  /** "serve-resolve" | "conf-fallback" — printed by callers that report provenance. */
  origin: "serve-resolve" | "conf-fallback";
}

/** One key from ONE conf file, quotes stripped. */
export function fileValue(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const m = new RegExp(`^\\s*${key}=(.*)$`, "m").exec(text);
  if (!m) return undefined;
  const v = m[1]!.trim().replace(/^["']|["']$/g, "").trim();
  return v || undefined;
}

/** rig.conf then dev.conf, FIRST hit wins (the rig's own sheet is authoritative).
 * For the dev PORT specifically use resolveDevPorts — that resolution is
 * file-major, which this per-key helper cannot express. */
export function confValue(projectRoot: string, key: string): string | undefined {
  return (
    fileValue(join(projectRoot, ".agents", "rig.conf"), key) ??
    fileValue(join(projectRoot, ".agents", "dev.conf"), key)
  );
}

function portFromUrl(url: string | undefined): number | undefined {
  const m = url?.match(/:(\d+)/g)?.pop();
  return m ? Number(m.slice(1)) : undefined;
}

/** One file's port, by either route: DEV_PORT, else the last :port in DEV_URL. */
function portFromFile(file: string): number | undefined {
  return Number(fileValue(file, "DEV_PORT")) || portFromUrl(fileValue(file, "DEV_URL")) || undefined;
}

/** The conf-only fallback — deliberately the SAME order serve-resolve documents.
 * The FILE is the outer key: rig.conf is asked for a port by either route before
 * dev.conf is consulted, so a stale dev.conf DEV_PORT cannot beat the rig's own
 * DEV_URL. Key-major order would reproduce the exact inversion CE-106 names. */
function fromConf(projectRoot: string): DevPorts {
  const rig = join(projectRoot, ".agents", "rig.conf");
  const dev = join(projectRoot, ".agents", "dev.conf");
  const port = portFromFile(rig) ?? portFromFile(dev) ?? 3000;
  const previewPort =
    Number(fileValue(rig, "PREVIEW_DEV_PORT")) || Number(fileValue(dev, "PREVIEW_DEV_PORT")) || port;
  return { port, previewPort, origin: "conf-fallback" };
}

export function resolveDevPorts(projectRoot: string): DevPorts {
  const resolver = join(projectRoot, ".agents", "bin", "serve-resolve");
  if (existsSync(resolver)) {
    try {
      const out = execFileSync("bash", [resolver, "dev", projectRoot], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      });
      const pick = (k: string): number => Number(new RegExp(`^${k}=(\\d+)$`, "m").exec(out)?.[1] ?? 0);
      const port = pick("PORT");
      const previewPort = pick("PREVIEW_PORT");
      if (port) return { port, previewPort: previewPort || port, origin: "serve-resolve" };
    } catch {
      /* unreachable resolver — fall through to the conf read */
    }
  }
  return fromConf(projectRoot);
}
