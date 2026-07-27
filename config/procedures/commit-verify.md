# Commit-Verify Gate

**Extracted from:** `config/orchestrator.md` — LOOP A brain hardening

Before relaying `[CODE_READY]` to the Reviewer, independently verify the branch
via SSH: working tree clean, `main...<branch>` shows the expected delta, and the
origin branch HEAD is a new commit (not main's SHA). Never relay a `code_ready`
whose branch has no committed delta — the Reviewer would review nothing. Verify
from git directly; an agent saying "already committed" is not sufficient.
