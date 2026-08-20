# The battle test — driving the shipped rig end to end

> **What this is.** A repeatable ladder that exercises the whole product, rung by
> rung, cheapest-and-most-diagnostic first. It exists because component tests
> pass on things that do not work: every entry in `dev/LEDGER.md` marked "battle
> test" was found by a human or an agent DRIVING the build, not by the suite.
>
> **How to use it.** Run rungs in order. A rung that fails STOPS the ladder —
> later rungs assume earlier ones hold, so pushing past a failure buys noise, not
> coverage. File every find in `dev/LEDGER.md` as a `CE-nnn` before fixing it.
>
> Written 2026-08-18, after the day that shipped the config wave (CE-145/005/
> 146/147), the `agy` seat + its blend promotion, CE-143, CE-144 and the CE-033
> retirement — none of which has been driven as a whole.

---

## 0. Safety rails — read before running anything

These are not suggestions. Each one is a scar.

1. **NEVER run this on `jdm-rush-crate` or any live team's repo.** Use a
   throwaway rig. One engine hosts several rigs and `crate open` on a host
   SILENTLY STOPS the other rig's seats — on Superman that means killing a live
   five-seat team mid-loop.
2. **Superman is not free.** Check `/api/workspaces` first: if `jdm-rush-crate`
   shows `liveSeats > 0`, do not open a workspace there, do not restart the
   engine. Mac is the default host for this ladder.
3. **Never `npm run build` in a live dev repo** (corrupts the shared `.next`).
4. **Publishing needs Adam's explicit "merge go".** Testing never publishes.
   Committing and pushing during a test session is fine; `publish.sh` is not.
5. **Do not use `~/Projects/delegation-probe`** as the rig. Its `rig.conf`
   carries explicit `_AGENT`/`_MODEL` lines appended mid-investigation, which
   mask exactly the staffing chain rung B1 is meant to prove.
6. **Token budget is real.** A five-seat loop on a subscription is not free, and
   a wedged loop can burn quota unattended. Set a wall-clock ceiling per rung and
   stop the team when it passes.
7. **Poll, never stream.** Watch long rungs on an interval; do not tail.
8. **Reproduce before believing** any report, including a seat's own.

---

## Phase A — mechanical (no seats, no cost, fully unattended)

> **RUN THIS AS A COMMAND, not by hand:**
> ```
> node dev/qa/engine-qa.mjs            # the installed engine
> node dev/qa/engine-qa.mjs --engine ~/Projects/crate-engine-2.0   # a workshop build
> ```
> `dev/qa/engine-qa.mjs` is Phase A plus the platform rungs, executable: it builds
> its own throwaway rig, prints evidence rather than summaries, and exits non-zero
> on any FAIL. It is OS-aware — it asserts what THIS platform should do rather
> than skipping, which is how CE-156 was found (11/11 on macOS, then a FAIL on its
> first Linux run). The prose below is kept as the SPEC each check implements; if
> the two ever disagree, that is itself a finding.
>
> **Run it on BOTH hosts.** The Linux paths — bwrap walls, the systemd
> dev-server rung — are the least-exercised code in the product, because the Linux
> host normally has a live team on it and cannot be experimented with.

Everything here is a shell command with a checkable answer. Run it first: it is
free, and it catches the class of bug where a fix shipped but never reached the
product.

### A1 — the staffing catalog offers only what we stand behind
```
curl -s "$B/api/staffing?token=$T" | python3 -m json.tool | grep -E '"agent"|"ready"'
```
**PASS:** exactly `pi, claude, codex, agy, gemini`. `agy` READY on a signed-in
host. `gemini` NOT ready with the API-key line. **opencode and aider absent**
(CE-033 retirement). Anything else present = a wire was added without a decision.

### A2 — `agy` detection tells the truth in both directions
```
node -e 'import("~/.crate/engine/core/dist/detect.js").then(async m=>{ … })'
```
Assert READY with a live credential, and NOT-ready with `HOME` pointed at a dir
with no `onboarding.json`. **PASS:** the marker alone never yields READY — the
deep probe (`agy models`) is what proves it. This is the CE-048/CE-138
false-READY family; a shallow pass here is the bug.

### A3 — preview base resolves a LAN host, not localhost (CE-146)
```
bash .agents/bin/preview-base "$RIG"
```
**PASS:** `REACH=lan` and `BASE=http://<real 192.168.x.x>:<port>` on a networked
host; `REACH=tunnel` when `PREVIEW_URL` is set; `REACH=local` ONLY when no LAN
address resolves — and in that case the card and the report must say the phone
half will not work.
**FAIL if** `BASE` carries `localhost` while `REACH=lan`, or if `DEV_URL` is
being used as the base anywhere.

### A4 — a fresh `rig.conf` names nobody's machine (CE-147)
```
crate attach <fresh scratch dir>   # then read .agents/rig.conf
```
**PASS:** `DEV_HOST="local"`, `DEV_HOST_IP=""`, and **no `SUPERMAN_` key at all**.
Then confirm the alias law: hand-write `SUPERMAN_IP="10.0.0.9"` into a rig and
re-run A3 — it must still be honoured (existing rigs keep working).

### A5 — `dev-server` picks the right backend inside a wall (CE-144)
Render a coder wall and run `dev-server up` **inside** it on a scratch rig.
**PASS:** it chooses `bare`, prints the honest note (names what you lose AND
that `restart` still works), and a port actually serves. **FAIL if** it errors
out, or if it silently picks `launchd` and dies on the plist write.
Then run the same command OUTSIDE the wall: **PASS:** `launchd`, supervised.

### A6 — the ledger index is internally consistent
Every id has both a table row and a detail section, in both directions.
```
python3 dev/reconcile-ledger.py
```
**PASS:** no drift reported, and the id count matches the detail-section count.
(2026-08-18: closing an item removed its only row and left a detail section
orphaned — older entries may have a row in the "Open" table ONLY.)

### A7 — the shipped docs agree with the shipped code
- `config/designer.md` does not gate the `design_locked` EMIT on human approval (CE-145)
- `config/skills/build-preview.md` step 4 offers **no** alternative to registering (CE-005)
- `config/coder.md` treats `[DESIGN_LOCKED]` as a heads-up, not a build order
**PASS:** all three. These are laws seats obey; drift here is silent.

---

## Phase B — one live seat (cheap, attended-optional)

Staff ONE seat with the agent under test and leave the rest claude. Isolates the
new harness without betting a whole loop on it.

### B1 — a blended `agy` seat boots, with no trust modal
`crate open <rig>` with `CODER_AGENT="agy"`.
**PASS:** the coder pane shows a live `agy` session; **the "Do you trust the
contents of this project?" modal never appears** (proves `preseedAgyProjectTrust`
fires on the real spawn path, not just in a unit test); the seat reads `live`.
**FAIL if** the modal appears — the first delivery will be eaten silently.

### B2 — the staffing chain agrees end to end
```
cd <rig> && node ~/.crate/engine/core/dist/cli.js print
```
**PASS:** `crate print`, `/api/staffing`, the Team view AND the actually-running
process all name the same agent+model. (CE-141: the blended path once ignored
`~/.crate/defaults.yaml` and booted `pi` while every display said otherwise.)

### B3 — delivery lands and VERIFIES on disk
Deliver mail to the seat; read `.agents/state/turns/<seat>/turns.log`.
**PASS:** `verified in Nms`, and the marker is present in the seat's real
transcript as a `USER_INPUT`/`USER_EXPLICIT` record. This proves the blend shapes
against live output rather than a captured fixture.

### B4 — ⚠ THE PIVOT: can the seat actually BUILD?
Give the seat a small real edit (add a file, change a line).
**PASS:** the change lands **in the project working tree**.
**FAIL if** it lands in `~/.gemini/antigravity-cli/` (or the harness's own
scratch) while the turn still reports success — that is the print-mode artifact
in a new costume, and it means the harness is a conversational seat, not a coder.
**Stop the ladder here on failure.** A five-seat loop on a harness that cannot
edit files proves nothing.

### B5 — context gauge is honest
**PASS:** a harness whose transcript carries no usage shows the dim placeholder
gauge, not a fabricated number. For `agy`, note the fixed prompt is ~13.7k tokens
per turn — against a 1M window that is noise, but the gauge must not read it as
claude-shaped.

---

## Phase C — the full loop (expensive, this is the real test)

### C1 — five-seat boot + restart-resume
Boot the whole team; restart the engine; **PASS:** exactly the recorded workspaces
come back, parked ones stay parked, and the seats rehydrate with their panes.

### C2 — one small work order, end to end
A real ticket: design (if front-end) → code → review + QA in parallel → gate →
merge gate hold. **PASS:** the loop completes without a human unblocking a
mechanical stall. Every stall is a find.

### C3 — the design-lock preview actually registers (CE-005)
On a front-end loop: **PASS:** `/api/preview` is NOT empty at the design-lock
hold, and the card is reachable from the cockpit. **FAIL if** the seat hands over
a raw URL, a `/tmp` screenshot, or an "opened in Chrome" claim. Two consecutive
loops failed this before the cure; this rung is its adoption watch.

### C4 — the phone QR is scannable (CE-146)
Scan the card's QR with an actual phone on the same Wi-Fi.
**PASS:** the page loads. **FAIL if** the QR encodes `localhost`.

### C5 — the gate holds
**PASS:** `code_ready` refuses without a SHA-tied `gate_pass` when
`NMGATE_ENFORCE=1`; the merge gate waits for the human's word; `deployed` is
refused unless state is `approved` AND the gate was released.

---

## Phase D — failure injection (the rungs that find the real bugs)

Healthy-path testing is the weakest kind. These deliberately break things.

### D1 — a usage-limited seat reads honestly (CE-143)
**Cheap and real: Fable is capped on Adam's account.** Staff a seat
`claude/fable`, let it hit the limit.
**PASS:** the cockpit reports that seat `usage-limited` with a plain-words detail,
NOT `alive: true` + green. **FAIL if** it reads live — that is the exact nine
silent minutes from 2026-08-18.
Also assert: auto-revive does **not** relaunch it (a relaunch cannot refill a
plan, and a backoff loop would burn the ceiling).

### D2 — a seat killed by signal reads dead, not phantom-alive (CE-140)
`kill -9` a seat's child. **PASS:** the seat reads `dead`, and the crash record
survives so the downchip has its evidence.

### D3 — a scoped stop parks without corpses (CE-135)
`crate stop <path>`. **PASS:** parked seats read as calm invitations
("Staff this seat"), not as dead sessions.

### D4 — removing the ACTIVE workspace (CE-142)
**PASS:** the server repoints at what is left, `active` is never a ghost path,
and an empty registry reads as an honest empty state.

### D5 — a zero-output turn does not hang forever (CE-139)
**PASS:** the first-output fuse fires with an honest stamp rather than silence.

### D6 — a stale dev server is not tested by mistake
Restart the dev server after a commit before runtime QA. **PASS:** QA exercises
the new code. (The `:3005` stale-module scar.)

---

## Phase L — Linux and cross-machine (the rungs the Mac cannot reach)

These need the Linux host FREE, which is rare: `jdm-rush-crate` normally has five
live seats and rail 2 forbids touching it. When Superman is genuinely idle, this
phase is the perishable opportunity — take it before the Mac work, which keeps.
Superman suspends ~22:30, so the window is shorter than it looks.

### L1 — the wall renders on bwrap AND actually contains
`node dev/qa/engine-qa.mjs --only L1` on the Linux host.
**PASS:** `backend=bwrap`, and a write aimed OUTSIDE the rig from inside the
prefix is refused. **The containment half is the point** — a wall that renders
but does not contain is walled in name only, and the plan alone cannot tell you
which you have.

### L2 — the dev-server demotion is ANNOUNCED, not just correct
**PASS:** `systemd` outside the wall (with `MemoryMax`), `bare` inside it, AND a
note naming what is lost and what still works. Both platforms picked the right
backend long before either explained itself; CE-156 was the silent Linux half of
CE-144, and it survived because the note was written into the launchd branch only.

### L3 — a WALLED LINUX SEAT CAN ACTUALLY BUILD
The Linux twin of B4, and never driven before 2026-08-18. Boot a scratch rig on
the Linux host, deliver a small real edit to the coder.
**PASS:** the change lands in the project working tree, from inside a bwrap wall.
**FAIL if** the seat sits on a boot modal (CE-154/CE-155), or the write is denied
by the wall it is supposed to be able to work inside.
*First run: codex coder, both files written in 20s, boot modals swept.*

### L4 — the remote window reaches the other machine
From the Mac: `crate open --remote <host> --print-url`, then ask the printed URL.
**PASS:** `/api/version` reports the REMOTE engine's pid and sha, `/api/workspaces`
lists the REMOTE host's paths, and the local hub is still separately alive on its
own port. **FAIL if** the tunnel silently serves the local engine — the failure
mode that makes a fleet look healthy from the wrong machine.

### L5 — both hosts run the SAME engine
`/api/version` on each. **PASS:** identical `loadedSha`, and `updateAvailable:
false` on both. A fleet split across two engines is how a fix "that shipped" is
still absent where the team actually runs.

---

## Phase E — human-only rungs

These cannot be automated and should not be faked.

### E1 — fresh-account onboarding (CE-034)
A genuinely fresh account: install → sign in → first work order. **PASS:** the
GUI walks the sign-in; no step sends the user to a terminal without saying so.

### E2 — the operator's own merge gate
Adam reads the diff and says "merge go". **PASS:** nothing merges before that,
from any surface.

### E4 — the three untested doors (from the 2026-08-20 E1 re-run)
Every first-hour door that has been walked has produced a finding; these three
have never been walked:
- **Browse** (attach an existing folder) — HUMAN: the native choose-folder panel
  needs real hands. PASS: feels like the Save panel minus the name field; the
  picked folder attaches, no nesting surprises.
- **Clone from GitHub** — DRIVABLE: an in-page flow; the autonomous driver can
  point it at the public dist repo. PASS: clone + attach + team page, no manual
  rescue.
- **+ Add a server** (the fleet door) — MOSTLY DRIVABLE against the Linux host:
  the machinery is proven (L4) but the GUI door — host entry, tunnel, the rig
  list appearing — has never been driven as a user experiences it.

### E3 — the design-lock confirm on a real device
Desktop + phone, both viewports, at the hold. **PASS:** Adam can actually judge
the design from what the engine handed him.

---

## Recording the run

One file per run under `dev/plan/proofs/battle-test-<date>.md`:
- rung id, PASS/FAIL, the evidence (command output, not a summary)
- every FAIL filed as `CE-nnn` in `dev/LEDGER.md` BEFORE it is fixed
- what was NOT run, and why — a silently skipped rung reads as coverage later

A rung that needed a human rescue to pass is a **FAIL**. The engine is the
product; a model-dependent rescue is exactly the failure CE-146 was filed for.
