// Regenerate config/loadouts/schema.json from the zod source of truth
// (adr-ts-scaffold.md: one definition, two artifacts).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LoadoutSchema } from "../src/manifest.js";

const schema = {
  $id: "crate-engine/loadout.schema.json",
  title: "Crate Engine seat loadout",
  description:
    "GENERATED from core/src/manifest.ts (npm run schema) — do not hand-edit. Rationale: dev/plan/phase-0/manifest-schema.md.",
  ...zodToJsonSchema(LoadoutSchema, { target: "jsonSchema2019-09" }),
};

const out = join(import.meta.dirname, "..", "..", "config", "loadouts", "schema.json");
writeFileSync(out, JSON.stringify(schema, null, 2) + "\n");
console.log(`wrote ${out}`);
