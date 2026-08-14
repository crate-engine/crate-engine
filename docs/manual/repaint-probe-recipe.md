# Probe — the quiet cockpit really is quiet (repaint damage tracking)

The suite pins the structure (repaint-damage.test.ts); this probe proves
the LIVE behavior in 60 seconds: an idle cockpit performs ZERO DOM writes.

## Recipe

1. Open the cockpit on a project whose team is idle (no running turn — the
   racing readout must not be ticking).
2. Open the browser console (in the mac app: open the same app-url in
   Chrome via the address it prints) and paste:

```js
(() => {
  let n = 0;
  const mo = new MutationObserver(rs => { n += rs.length; rs.forEach(r => console.log("mutation:", r.type, r.target)); });
  mo.observe(document.getElementById("grid"), { subtree: true, childList: true, attributes: true, characterData: true });
  console.log("watching #grid for 60s…");
  setTimeout(() => { mo.disconnect(); console.log(n === 0 ? "QUIET ✓ — 0 mutations" : "NOISY ✗ — " + n + " mutations (see log above)"); }, 60_000);
})();
```

3. Do not touch the page for the minute. Expected: `QUIET ✓ — 0 mutations`.

## Reading a failure

- Mutations naming `.rtext` or `.working` → a turn was actually running
  (that's the 1s elapsed ticker doing its job — re-run truly idle).
- Mutations naming `.gauge`/`.gfill`/`.gpct` → a session file grew (gauge
  moved — also real change, not a repaint bug).
- Whole `.tile` nodes appearing → a tile key went dirty on unchanged data:
  a volatile field leaked into `tileKey`. That IS the regression this
  probe exists to catch — file it in FLAWS with the logged target.
