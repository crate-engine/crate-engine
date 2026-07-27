# Markdown Audit Patterns — Rubric

Concise good-vs-bad examples the `markdown-audit` skill checks against.
These patterns cover the three audit checks: frontmatter, prose efficiency,
and cross-reference integrity.

---

## 1. Frontmatter Completeness

Every `config/*.md` agent file must have valid YAML frontmatter.

**Good:**
```yaml
---
name: Coder
type: agent
model: deepseek-v4-pro
version: 1.0
authority: implementation
capabilities: [code_generation, commit_verification, state_emission]
must_refuse: [invent_tooling, skip_commit_verify, push_to_main]
---
```

**Bad — missing required fields:**
```yaml
---
name: Coder
type: agent
# missing model, version, capabilities, must_refuse
---
```

**Required fields:** `name`, `type`, `model`, `version`, `capabilities`, `must_refuse`.
Optional: `authority`, `legal_states`, `must_emit`, `canonical_rails`.

---

## 2. Lists Over Prose

Prose paragraphs containing steps or rules should be bullets.

**Good — rules as bullets:**
```markdown
## Hard Constraints
- Never push to main. All work on feature branches.
- Build must pass before every push.
- Merge ONLY on [MERGE] from the orchestrator.
```

**Bad — rules buried in prose:**
```markdown
It is important that you never push to main, and you should always work on
feature branches. The build must pass before every push, and you should
merge only when the orchestrator sends [MERGE].
```

Signal/transition names should be backticked.

**Good:** `[CODE_READY]`, `code_ready`, `[MERGE] <branch>`
**Bad:** [CODE_READY] (no backtick), code ready (not exact name)

---

## 3. Constraints Early

Each agent file should have a `## Hard Constraints` section near the top
(before detailed procedures).

**Good:** `## Hard Constraints` appears within the first ~30 lines after frontmatter.
**Bad:** Constraints scattered through body paragraphs, no dedicated section.

---

## 4. Backticked Signal/Transition Names

All handoff signals and state transition names must be backticked.

**Good:** `[CODE_READY]`, `code_ready`, `design_locked`, `[MERGE] <branch>`
**Bad:** [CODE_READY] (bare brackets), code ready (plain text)

Applies to: signal names (`[DESIGN_LOCKED]`, `[APPROVED]`, `[CHANGES_NEEDED]`,
`[BUGS_FOUND]`, `[VERIFIED]`, `[RETEST]`, `[MERGE]`), transition names
(`code_ready`, `design_locked`, `start_impl`, `approved`, `deployed`),
and dot-commands (`.recover`, `.resume`, `.handoff`, `.checkpoint`, `.status`).

---

## 5. Valid Cross-References

Every pointer in the form `See procedures/<name>.md` or `See standards/<name>.md`
or `config/<path>` must resolve to an existing file in the config tree.

**Good:**
```markdown
See `procedures/recovery.md` for the full sequence.
```
→ file `config/procedures/recovery.md` exists.

**Bad:**
```markdown
See `procedures/handoff.md` for the full sequence.
```
→ file `config/procedures/handoff.md` does NOT exist.

INDEX.md must list every agent file, procedures file, and standards file that
exists, and must not reference files that don't exist.

**Reference forms the check parses:** backtick `` `path/name.md` ``, bare
`path/name.md`, and `See procedures/<name>.md`. The brain does NOT use Obsidian
`[[wikilinks]]` — keep it that way (lean, stranger-test-clean binders).

---

## 6. Graph Shape — Orphans & Hubs (advisory)

Beyond broken-link detection, the audit reports graph SHAPE:

- **Orphan** — a doctrine file nothing references. LEGITIMATE orphans: entrypoints
  (`STATUS.md`, `README.md`), templates, and skills referenced by NAME in a catalog
  (`INDEX.md` lists `planning-artifact`, not `planning-artifact.md`). Resolve
  name-based references before flagging; a residual orphan is a review prompt, not a FAIL.
- **Hub** — a file with unusually high inbound references (a "god file" risk). Report the
  top inbound-degree files; a human judges whether a binder is over-accreting. Advisory.

**Good:** every pathful `*.md` reference resolves; orphans are only legitimate
entrypoints/templates/name-cataloged skills; hubs are the expected indexes.
**Bad:** a backtick ref to a renamed file (e.g. `hermes.md` after the rename to
`coder.md`); a binder that has become an inbound hub for unrelated concerns.
