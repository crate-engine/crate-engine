---
name: markdown-audit
type: skill
version: 1.1
description: Read-only audit of the agent brain markdown for frontmatter completeness, prose efficiency, cross-reference integrity, and graph shape (broken-reference, orphan, and hub detection across the whole doctrine tree).
inputs: the doctrine .md tree (config/, adapters/, templates/, root docs)
outputs: MARKDOWN-AUDIT-<date>.md report
side_effects: none (read-only — writes a report only, edits NO files)
---

# Markdown Audit Skill

Run three focused checks on the agent brain. Checks 1–2 target the agent config
files; Check 3 covers reference integrity + graph shape across the whole doctrine
tree. Report pass/fail per file per check. Do NOT edit any file — write a report
with findings and suggested edits. Any rewrite flows through a normal pipeline loop.

**Rubric:** `config/standards/MARKDOWN-AUDIT-PATTERNS.md` defines good/bad
patterns for each check.

**Report path:** Write to `state/MARKDOWN-AUDIT-<YYYY-MM-DD>.md` (or a scratch
path if state/ is not writable). Include a summary table and per-file findings.

---

## Check 1 — Frontmatter Validation

**Target files:** Every `config/*.md` that is an agent config (has `# Role:`
heading — currently: orchestrator.md, coder.md, reviewer.md, designer.md,
tester.md). Do NOT check non-agent files (workspace.md, INDEX.md, handoff-protocol.md,
procedures/, standards/).

**What to check:**
- YAML frontmatter delimited by `---` exists at the very top of the file.
- Required fields present and non-empty: `name`, `type` (must be `agent`),
  `model`, `version`, `capabilities` (non-empty list), `must_refuse` (non-empty list).
- `canonical_rails` pointer present (mirrors state-machine.yaml + agent rails;
  not a second source of truth). OPTIONAL — missing does not cause a FAIL.

**Report:** PASS if all required fields present; FAIL with specifics if any
missing or empty.

---

## Check 2 — Prose Efficiency

**Target files:** All `config/*.md` agent files.

**What to check:**
- A `## Hard Constraints` section exists and appears within the first ~30
  lines after frontmatter.
- No avoidable prose paragraphs: rules/constraints are in bullet lists,
  not buried in long paragraphs.
- Signal names (`[CODE_READY]`, `[APPROVED]`, `design_locked`, etc.) are
  backticked where they appear as literal names.
- Dot-commands (`.recover`, `.resume`, `.handoff`, `.checkpoint`, `.status`)
  are backticked.

**Report:** PASS if all checks pass; FAIL with the specific issue per file.

---

## Check 3 — Cross-Reference Integrity & Graph Shape

**Target files:** ALL doctrine `.md` files — `config/`, `adapters/`, `templates/`,
and the root docs (`STATUS.md`, `FLAWS.md`, `README.md`, `VISION.md`). Exclude
`bin/`, `.git/`, and non-doctrine assets.

> The brain links files as backtick paths (`` `config/skills/README.md` ``) and bare
> path mentions — NOT Obsidian `[[wikilinks]]`. This is deliberate (lean,
> stranger-test-clean binders). The check parses those forms; do NOT convert them to
> wikilinks. (See the 2026-06-28 feasibility audit that rejected an Obsidian graph
> layer: net-new value was graph-only, already approximable here, and un-runnable on a
> headless host — this check IS that approximation, done agent-agnostically.)

Run the deterministic recipe below (don't eyeball), then report three things:

**3a — Broken / stale references — FAIL on any.**
Every `*.md` reference — backtick `` `path/name.md` `` or bare `path/name.md` — must
resolve to a file that exists in the tree. A pointer to a moved/renamed/deleted file
is a FAIL listing the source file + the dangling target. Includes the legacy checks:
`See procedures/<name>.md` / `See standards/<name>.md` pointers resolve; `INDEX.md`
lists every agent/procedures/standards/skills file that exists and none that don't.

**3b — Orphans — ADVISORY (review, do not auto-fail).**
A doctrine file nothing else references. Some orphans are legitimate: entrypoints
(`STATUS.md`, `README.md`), templates, and **skills referenced by NAME in a catalog,
not by `file.md`** (e.g. `INDEX.md`/`skills/README.md` list `planning-artifact`, not
`planning-artifact.md`). Resolve name-based catalog references before flagging, then
report the residual orphans for a human glance — not a failure.

**3c — Hubs / over-coupling — ADVISORY.**
A file with an unusually high inbound-reference degree is a "god file" risk. Report the
top inbound-degree files so a human can judge whether a binder is accreting too many
responsibilities. A review prompt, not a failure.

**Deterministic recipe (run it; adapt freely — the contract is broken=FAIL, orphans/hubs=advisory):**
```python
import os, re, glob
ROOT="."  # brain root
mds=[f for f in glob.glob(ROOT+"/**/*.md", recursive=True)
     if not any(p in f for p in ("/.git/","/bin/"))]
rel=lambda f: os.path.relpath(f,ROOT)
names={os.path.basename(f) for f in mds}
ref=re.compile(r"([A-Za-z0-9_./-]+\.md)")
# exclusions so the check never cries wolf (validated to 0-broken on a clean brain):
EX_T=("checkpoints/","CHECKPOINT-",".claude",".agents/state","path/name.md")  # runtime/external/placeholder targets
EX_S=("markdown-audit.md","MARKDOWN-AUDIT-PATTERNS.md")                       # files holding deliberate example refs
prose_join=lambda t: any(x.endswith(".md") for x in t.split("/")[:-1])       # "A.md/B.md" = prose list, not a path
inbound={rel(f):0 for f in mds}; broken=[]
for f in mds:
    s=open(f,encoding="utf-8",errors="replace").read()
    for m in set(ref.findall(s)):
        bn=os.path.basename(m)
        if bn in names:                                    # resolves -> count an inbound edge
            for t in mds:
                if os.path.basename(t)==bn and rel(t)!=rel(f): inbound[rel(t)]+=1
            continue
        if ("/" not in m or os.path.basename(f) in EX_S or m.startswith(("/","~"))
            or any(x in m for x in EX_T) or prose_join(m)): continue
        broken.append((rel(f), m))                         # pathful, unresolved, real = broken
orphans=[p for p,n in inbound.items() if n==0]             # then subtract name-cataloged skills/templates (3b)
hubs=sorted(inbound.items(), key=lambda x:-x[1])[:5]
print("BROKEN:",broken); print("ORPHANS:",orphans); print("HUBS:",hubs)
```

**Report:** PASS if no broken references; FAIL with each broken source→target.
List orphans (post name-resolution) and top hubs as advisory findings.

---

## Report Format

```markdown
# Markdown Audit — YYYY-MM-DD

## Summary
| Check | Scope | Pass | Fail |
|-------|-------|------|------|
| 1 Frontmatter         | 5 agent files     | 5  | 0 |
| 2 Prose Efficiency    | 5 agent files     | 4  | 1 |
| 3 Cross-Ref Integrity | 40 doctrine files | 40 | 0 |

## Findings

### Check 1 — Frontmatter: PASS (5/5)
No issues.

### Check 2 — Prose Efficiency: FAIL (1)
- **config/reviewer.md** — Missing `## Hard Constraints` section near top.
  Suggested: add constraints before the first procedure section.

### Check 3 — Cross-Reference Integrity & Graph Shape: PASS (no broken refs)
- **Broken / stale (FAIL):** none — all `*.md` references resolve.
- **Orphans (advisory):** none after resolving name-cataloged skills.
- **Hubs (advisory, top inbound):** templates/state/session.md, config/coder.md,
  config/orchestrator.md — expected state/index hubs; no action unless a binder over-accretes.
```
