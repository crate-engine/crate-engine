#!/usr/bin/env node
// conf-set <file> <KEY> <VALUE> — write KEY="VALUE" into a shell-style conf
// (rig.conf/dev.conf): replace the existing KEY= line in place, else append.
// P4-8: this is the phase-law conf writer — TypeScript, macOS-native by
// construction; it replaces preview-tunnel's GNU `sed -i` (which silently
// breaks on BSD sed, leaving PREVIEW_URL unwritten on a Mac). Every line it
// does not own is preserved byte-exact.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function setConf(text: string, key: string, value: string): string {
  // A value carrying `$` (e.g. DEV_CMD/GATE_START_CMD referencing $DEV_PORT) is
  // single-quoted so sourcing the conf never expands it at source time — the
  // run-time expansion contract, and `set -u` sourcing safety.
  const line = value.includes("$") ? `${key}='${value}'` : `${key}="${value}"`;
  const lines = text.split("\n");
  const re = new RegExp(`^[ \\t]*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`);
  let replaced = false;
  const out = lines.map((l) => {
    if (!replaced && re.test(l)) {
      replaced = true;
      return line;
    }
    return l;
  });
  if (replaced) return out.join("\n");
  const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${body}${line}\n`;
}

// CLI entry (the core/tools/conf-set shim execs this file).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , file, key, value] = process.argv;
  if (!file || !key || value === undefined) {
    console.error("usage: conf-set <file> <KEY> <VALUE>");
    process.exit(1);
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    console.error(`conf-set: "${key}" is not a KEY (expected A-Z/0-9/_ shell-style name)`);
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`conf-set: no such file: ${file}`);
    process.exit(1);
  }
  writeFileSync(file, setConf(readFileSync(file, "utf8"), key, value));
}
