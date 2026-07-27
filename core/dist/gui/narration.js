// PHASE-B #2 — the loop-narration chip's brain. The testuser8 run read as
// "incredibly slow" because the cockpit showed nothing moving between round
// transitions: a 6-minute coder turn LOOKS like a hang unless the masthead
// says what round the loop is in and whose move it is. Ground truth is
// events.log (same file the agents write via agentctl) — never a guess.
/** Narrate the CURRENT run: everything after the last START_IMPL (a new work
 * order resets the round count). Returns null when there is nothing to say
 * (no events yet) — the chip hides rather than invent a state. */
export function loopNarration(lines) {
    let start = 0;
    for (let i = 0; i < lines.length; i++)
        if (lines[i].includes(" START_IMPL "))
            start = i;
    const run = lines.slice(start);
    let state = "";
    let at = null;
    let rounds = 0; // CODE_READY count = completed build rounds this run
    for (const l of run) {
        const st = l.match(/ state=(\S+)/)?.[1];
        if (st) {
            state = st;
            at = l.match(/^\[([^\]]+)\]/)?.[1] ?? at;
        }
        if (/ CODE_READY /.test(l))
            rounds++;
    }
    if (!state)
        return null;
    const text = state === "implementing"
        ? rounds === 0
            ? "round 1 — the coder is building"
            : `round ${rounds + 1} — rework round (normal: review asked for changes)`
        : state === "code_ready"
            ? `round ${rounds} — review & QA are checking`
            : state === "approved"
                ? `approved — type "merge go" to ship`
                : state === "initialized"
                    ? "team booted — waiting for the first work order"
                    : state.replace(/_/g, " ");
    return { text, state, at };
}
//# sourceMappingURL=narration.js.map