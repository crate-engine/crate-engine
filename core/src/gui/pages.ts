// The wizard screens (W2 shape): Crew → Team → Project → Start. Vanilla
// HTML/JS/CSS as template strings — zero dependencies, no build step (Q1),
// served by gui/server.ts. Every action is a fetch to /api/* (the thin law:
// the API is a pass-through to core). The per-launch token rides ?token= on
// every page and an X-Crate-Token header on every fetch.
// W1 (UX-QC P0s): Arm/Check/Boot folded into ONE Start-engine preflight that
// ends IN the cockpit (/team). W2: roster-first staffing, the cockpit's brand
// (Michroma/Barlow/JetBrains Mono, self-hosted at /fonts/), dot progress rail.
//
// Visual identity (run #3 "not premium" finding): the app is an engine room's
// head unit — graphite panels, one signal-amber accent, stencil-style mono
// eyebrows (crate markings), quiet hairlines. The acceptance script's button
// labels are LOAD-BEARING — never rename them casually.

/** Server-side HTML escape (the client JS has its own `esc`). */
function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const STYLE = `
/* W2: the brand faces, self-hosted (served by the engine at /fonts/ — no CDN,
   offline-safe). Fallback stacks keep every screen legible without them. */
@font-face { font-family:'Michroma'; font-style:normal; font-weight:400; font-display:swap; src:url('/fonts/michroma-400.woff2') format('woff2'); }
@font-face { font-family:'Barlow'; font-style:normal; font-weight:400; font-display:swap; src:url('/fonts/barlow-400.woff2') format('woff2'); }
@font-face { font-family:'Barlow'; font-style:normal; font-weight:500; font-display:swap; src:url('/fonts/barlow-500.woff2') format('woff2'); }
@font-face { font-family:'Barlow'; font-style:normal; font-weight:600; font-display:swap; src:url('/fonts/barlow-600.woff2') format('woff2'); }
@font-face { font-family:'Barlow'; font-style:normal; font-weight:700; font-display:swap; src:url('/fonts/barlow-700.woff2') format('woff2'); }
@font-face { font-family:'JetBrains Mono'; font-style:normal; font-weight:400; font-display:swap; src:url('/fonts/jetbrains-mono-400.woff2') format('woff2'); }
@font-face { font-family:'JetBrains Mono'; font-style:normal; font-weight:500; font-display:swap; src:url('/fonts/jetbrains-mono-500.woff2') format('woff2'); }
:root {
  /* Steel-blue carbon — the crate-engine.ai brand palette (brand pass,
     2026-07-11). Amber is the one accent; neutrals are cool, not green.
     W2: one design language wizard↔cockpit — same faces as teampage. */
  --bg:#0b0e14; --panel:#12161f; --panel2:#161b26; --line:#222835; --line2:#323a4b;
  --fg:#f1f3f6; --dim:#8b94a5; --faint:#6b7488; /* W3 a11y: faint lifted off the AA floor */
  --amber:#e2a33c; --amber-hi:#f0b654; --ok:#57c489; --warn:#e2a33c; --bad:#e4614d;
  --disp:"Michroma",sans-serif;
  --body:"Barlow",-apple-system,system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;
}
* { box-sizing:border-box; margin:0; }
html { color-scheme:dark; }
body { background:var(--bg); color:var(--fg);
  font:15.5px/1.55 var(--body);
  max-width:860px; margin:0 auto; padding:0 28px 64px; }
@media (max-width:640px){ body{ padding:0 16px 48px; } }

/* ── the masthead (the cockpit's mark, verbatim — one brand, one seam gone) ── */
header { padding:26px 0 14px; border-bottom:1px solid var(--line);
  display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.mark { font:400 13px/1 var(--disp); letter-spacing:.1em; text-transform:uppercase;
  color:var(--fg); display:inline-flex; align-items:center; }
.bolt { height:.72em; width:auto; fill:var(--amber); margin:0 .14em; transform:translateY(.02em); }
/* W2: the nav is a progress rail — dots fill as you move through. */
nav { display:flex; gap:20px; }
nav a { font:500 11px/1 var(--mono); letter-spacing:.14em; text-transform:uppercase;
  color:var(--faint); text-decoration:none; padding:4px 0;
  display:inline-flex; align-items:center; gap:7px; }
nav a::before { content:""; width:7px; height:7px; border-radius:4px; background:var(--line2); flex:0 0 auto; }
nav a:hover { color:var(--dim); }
nav a.done { color:var(--dim); }
nav a.done::before { background:var(--faint); }
nav a.here { color:var(--fg); }
nav a.here::before { background:var(--amber); }

h1 { font-size:24px; font-weight:650; letter-spacing:-.015em; margin:30px 0 6px; }
.lede { color:var(--dim); max-width:60ch; }
.eyebrow { font:600 10.5px/1 var(--mono); letter-spacing:.22em; text-transform:uppercase;
  color:var(--faint); margin-bottom:10px; }
h2 { font-size:15px; font-weight:650; letter-spacing:-.01em; margin:0 0 4px; }

.card { background:var(--panel); border:1px solid var(--line); border-radius:6px;
  padding:18px 20px; margin:14px 0; }
.card .hint { color:var(--dim); font-size:13px; }

button { background:var(--amber); color:#151109; border:0; border-radius:5px;
  padding:9px 18px; font:600 13.5px/1.3 var(--body); cursor:pointer; }
button:hover { background:var(--amber-hi); }
button.quiet { background:transparent; border:1px solid var(--line2); color:var(--fg); }
button.quiet:hover { border-color:var(--dim); background:var(--panel2); }
button:disabled { opacity:.4; cursor:default; }
:is(button,a,select,input):focus-visible { outline:2px solid var(--amber); outline-offset:2px; }

select, input[type=text] { background:var(--panel2); color:var(--fg);
  border:1px solid var(--line2); border-radius:5px; padding:8px 10px; font-size:13.5px; width:100%; }
input[type=text] { font-family:var(--mono); font-size:13px; }

table { width:100%; border-collapse:collapse; }
th { font:600 10.5px/1.4 var(--mono); letter-spacing:.14em; text-transform:uppercase;
  color:var(--faint); text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
td { padding:8px; border-bottom:1px solid var(--line); font-size:13.5px; vertical-align:top; }
tr:last-child td { border-bottom:0; }
code, .mono { font-family:var(--mono); font-size:12.5px; }

.ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)} .dim{color:var(--dim)}
.tag { display:inline-block; font:600 10px/1 var(--mono); letter-spacing:.16em;
  text-transform:uppercase; color:var(--dim); border:1px solid var(--line2);
  border-radius:3px; padding:4px 7px 3px; }
.pill { display:inline-block; font:600 11px/1 var(--mono); letter-spacing:.08em;
  border-radius:10px; padding:5px 10px 4px; }
.pill.ok { color:var(--ok); border:1px solid color-mix(in srgb, var(--ok) 40%, transparent); }
/* W2: the roster — staffing presented, not configured */
.roster { display:grid; grid-template-columns:repeat(auto-fit,minmax(152px,1fr)); gap:10px; margin-top:14px; }
.seatcard { background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:14px 14px 12px; }
.seatcard .st { font:400 10px/1.4 var(--disp); letter-spacing:.08em; text-transform:uppercase; color:var(--amber); }
.seatcard .sm { font-weight:600; font-size:13.5px; margin-top:8px; line-height:1.35; }
.seatcard .sb { font:500 10px/1.5 var(--mono); color:var(--faint); margin-top:6px; letter-spacing:.03em; }
.row { display:flex; gap:12px; align-items:center; } .grow { flex:1; }
button.mode { flex:1; text-align:left; padding:14px 16px; line-height:1.45; }
button.mode.active { border-color:var(--amber); background:var(--panel2); }
button.mode.active b { color:var(--amber); }
.overlay { position:fixed; inset:0; background:rgba(7,9,14,.72); display:flex;
  align-items:center; justify-content:center; z-index:10; }
.pickpanel { background:var(--panel); border:1px solid var(--line2); border-radius:8px;
  width:min(560px,92vw); max-height:72vh; display:flex; flex-direction:column; }
.pickhead { padding:14px 16px; border-bottom:1px solid var(--line); }
.picklist { overflow:auto; flex:1; min-height:120px; }
.pickrow { display:flex; gap:10px; align-items:center; width:100%; text-align:left;
  background:none; border:0; border-bottom:1px solid var(--line); color:var(--fg);
  padding:10px 16px; font:13px/1.4 var(--mono); cursor:pointer; border-radius:0; }
.pickrow:hover { background:var(--panel2); }
.pickfoot { padding:12px 16px; border-top:1px solid var(--line); display:flex; gap:10px; justify-content:flex-end; }
.dot { display:inline-block; width:9px; height:9px; border-radius:5px; margin-right:6px; }
#msg { margin-top:14px; white-space:pre-wrap; font-family:var(--mono); font-size:12.5px; }
.footline { margin-top:34px; padding-top:12px; border-top:1px solid var(--line);
  font:500 11px/1.6 var(--mono); letter-spacing:.06em; color:var(--faint); }
/* indeterminate progress (the Arm screen's live install bar) */
.bar { height:4px; margin-top:7px; border-radius:2px; overflow:hidden; background:var(--line); position:relative; }
.bar .fill { position:absolute; inset:0; width:38%; border-radius:2px; background:var(--amber);
  animation:slide 1.1s ease-in-out infinite alternate; }
@keyframes slide { from { transform:translateX(-30%); } to { transform:translateX(240%); } }
/* the Start-engine preflight rows */
.prow { display:flex; gap:12px; align-items:flex-start; padding:11px 0; border-top:1px solid var(--line); }
.prow:first-child { border-top:0; }
.prow.sub { padding:6px 0 6px 24px; border-top:0; }
.prow b { font-size:14px; }
.pdot { width:10px; height:10px; border-radius:5px; margin-top:6px; flex:0 0 auto; background:var(--line2); }
.pdot.ok { background:var(--ok); } .pdot.warn { background:var(--warn); }
.pdot.bad { background:var(--bad); } .pdot.run { background:var(--amber); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
@media (prefers-reduced-motion:no-preference){
  button { transition:background .12s ease, border-color .12s ease; }
  .pdot.run { animation:pulse 1.1s infinite; }
}
/* W3 a11y: a global belt for anything animated above */
@media (prefers-reduced-motion:reduce){ * { animation:none !important; transition:none !important; } }
`;

const SHELL_JS = `
const TOKEN = new URLSearchParams(location.search).get('token') || '';
const link = (p) => p + '?token=' + encodeURIComponent(TOKEN);
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'X-Crate-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: 'bad response' }));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('nav a[data-p]').forEach(a => { a.href = link(a.dataset.p); });
});
`;

function shell(title: string, here: string, body: string, js: string): string {
  // The wizard is a linear STEPPER (run #7 UX): one section per screen, moved
  // through with Continue/Back — no long scroll. Nav doubles as a progress
  // rail (W2: dots fill as you go). W1: three decisions + one press.
  const steps = [
    ["/", "Crew"],
    ["/staffing", "Team"],
    ["/attach", "Project"],
    ["/start", "Start"],
  ];
  const hereIdx = steps.findIndex(([p]) => p === here);
  const nav = steps
    .map(([p, label], i) => `<a data-p="${p}" class="${p === here ? "here" : i < hereIdx ? "done" : ""}">${label}</a>`)
    .join("");
  const bolt = `<svg class="bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2 4.8 13.4h5L8.6 22l10.6-13.2h-6.2L13.2 2z"/></svg>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Crate Engine — ${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head>
<body><header><span class="mark">CRATE${bolt}ENGINE</span><nav>${nav}</nav></header>
${body}<script>${SHELL_JS}${js}</script></body></html>`;
}

export function welcomePage(version: string, project?: string): string {
  // Run #13 finding: after a restart the app RESUMES the last project, but the
  // Welcome screen never said so — it read as "starting from scratch" and sent
  // the user back through the wizard (duplicate projects, path typos). When a
  // project is attached, say it and make CONTINUE the first move.
  const resume = project
    ? `
<div class="card" style="margin-top:22px">
  <h2>Continue where you left off</h2>
  <p class="hint mono" style="font-size:12.5px">project: ${escHtml(project)}</p>
  <p class="hint">Your team and this project are still attached — one press brings it all back.</p>
  <p style="margin-top:14px"><button id="resume">Continue → Start the engine</button></p>
</div>`
    : "";
  return shell(
    "Welcome",
    "/",
    `
<p class="eyebrow" style="margin-top:34px">AI dev team · in a box</p>
<h1>A complete engineering team, shipped as one.</h1>
<p class="lede">An orchestrated team — Coder, Reviewer, Designer, QA, and the Orchestrator
you talk to — each sandboxed, each running on your own AI subscriptions.</p>
<div id="crew"></div>${resume}
<div class="card" style="margin-top:22px" id="cta">
  <h2>${project ? "Staff or switch" : "Staff your team &amp; start building"}</h2>
  <p class="hint">${project ? "Change seat models, or attach a different project." : "Pick a model for each seat once — every project you attach uses those defaults."}</p>
  <p style="margin-top:14px"><button id="go" ${project ? 'class="quiet"' : ""}>Staff your team${project ? "" : " &amp; start building"}</button></p>
</div>
<p class="footline">engine ${version} · <span id="upd">checking for updates…</span></p>
<div id="updbox"></div>`,
    `
el('go').onclick = () => location.href = link('/staffing');
const rz = el('resume'); if (rz) rz.onclick = () => location.href = link('/start');
// ── bring your crew (run #11 + W0): the Welcome screen SHOWS what Crate
// Engine sees — and WATCHES. Detection is push, not pull: while any agent is
// not ready, the page polls and the ✓ lights up BY ITSELF when a sign-in
// completes over in Terminal (no Refresh button, audit C1). Some crew ready →
// a one-line roster. NONE ready → the checklist replaces the CTA.
const HOW = {
  pi:     { cmd: 'pi',     how: 'type /login and sign in — ChatGPT covers the GPT-5.5 seats; DeepSeek seats take its API key — then quit (Ctrl+C twice)' },
  claude: { cmd: 'claude', how: 'finish its one-time setup (pick a theme, sign in with your Claude subscription), then type /exit' },
  codex:  { cmd: 'codex',  how: 'sign in with your ChatGPT account, then quit' },
};
let crewKey = null;
function renderCrew(ag) {
  const ready = ag.filter(a => a.ready);
  if (ready.length > 0) {
    el('cta').style.display = '';
    el('crew').innerHTML = '<p class="mono dim" style="margin-top:18px;font-size:12.5px">your crew · ' +
      ag.map(a => esc(a.label) + ' ' + (a.ready ? '<span class="ok">✓</span>' : '<span class="dim">—</span>')).join(' · ') +
      (ready.length < ag.length ? ' <span class="dim">(sign the others in anytime — this screen notices by itself)</span>' : '') + '</p>';
    return;
  }
  el('cta').style.display = 'none';
  el('crew').innerHTML = '<div class="card" style="margin-top:22px"><p class="eyebrow">Bring your crew</p>' +
    '<h2>Crate Engine ships the crate — you bring the crew</h2>' +
    '<p class="hint">Your team runs on YOUR agents and YOUR subscriptions, and none of them are connected on this Mac yet. ' +
    'Each one signs in its own way, once — Crate Engine never touches your accounts. Connect at least one:</p>' +
    ag.map(a => {
      const h = HOW[a.agent] || { cmd: a.agent, how: 'run it once and finish its own sign-in' };
      return '<div style="margin:14px 0;padding-top:12px;border-top:1px solid var(--line)">' +
        '<div class="row"><b class="grow">' + esc(a.label) + '</b>' +
        '<span class="tag" style="color:var(--warn);border-color:var(--warn)">' + (a.installed ? 'not signed in' : 'not installed') + '</span></div>' +
        (a.installed
          ? '<p class="dim" style="font-size:13px;margin:6px 0">One click opens Terminal with the sign-in started — ' + esc(h.how) + '.</p>' +
            '<div class="row" style="margin-top:6px"><code class="grow" style="padding:7px 10px;background:var(--panel2);border:1px solid var(--line2);border-radius:5px">' + esc(h.cmd) + '</code>' +
            '<button data-term="' + esc(a.agent) + '">Open Terminal &amp; sign in</button>' +
            '<button class="quiet" data-copy="' + esc(h.cmd) + '">Copy</button></div>'
          : '<p class="dim" style="font-size:13px;margin:6px 0">Install it first (its own installer, on their site), then run <code>' + esc(h.cmd) + '</code> once to sign in — ' + esc(h.how) + '.</p>') +
        '<div class="dim mono" id="note-' + esc(a.agent) + '" style="font-size:12px;margin-top:6px"></div></div>';
    }).join('') +
    '<p class="mono dim" style="margin-top:14px;font-size:12px"><span class="pdot run" style="display:inline-block;vertical-align:middle;margin-right:7px"></span>watching for sign-ins — the ✓ appears here by itself</p></div>';
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied ✓'; }
    catch (e) { b.textContent = 'select + copy it manually'; }
  });
  document.querySelectorAll('[data-term]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const r = await api('POST','/api/crew/terminal',{ agent: b.dataset.term });
          el('note-' + b.dataset.term).textContent = r.note; }
    catch (e) { el('note-' + b.dataset.term).textContent = e.message; }
    b.disabled = false;
  });
}
function watchCrew() {
  api('GET','/api/staffing').then(c => {
    const ag = c.agents || [];
    // re-render only when the picture CHANGES (no flicker mid-read)
    const key = ag.map(a => a.agent + ':' + (a.ready ? 1 : 0) + ':' + (a.installed ? 1 : 0)).join('|');
    if (key !== crewKey) { crewKey = key; renderCrew(ag); }
    if (ag.some(a => !a.ready)) setTimeout(watchCrew, 4000);
  }).catch(() => { /* detection unavailable — the CTA stays */ });
}
watchCrew();
api('GET','/api/version').then(v => {
  if (!v.updateAvailable) { el('upd').textContent = 'up to date'; return; }
  el('upd').innerHTML = '<span class="warn">update available</span> ';
  el('updbox').innerHTML = '<p style="margin-top:10px"><button id="dou">Update now (your customizations survive)</button></p>';
  el('dou').onclick = async () => {
    el('dou').disabled = true; el('dou').textContent = 'updating…';
    try {
      const r = await api('POST','/api/update',{});
      // W3 (audit K2): the app restarts ITSELF — no terminal homework.
      el('updbox').innerHTML = '<div class="card"><span class="ok">Updated ' + esc(r.before.slice(0,7)) + ' → ' + esc(r.after.slice(0,7)) + ' (fast-forward).</span>' +
        (r.flagged.length ? '<br>' + r.flagged.map(f => '<span class="warn">⚑</span> ' + esc(f.note)).join('<br>') : '<br><span class="dim">overlay: all your customizations compatible</span>') +
        '<p style="margin-top:12px"><button id="dorst">Restart the app to finish</button></p></div>';
      el('dorst').onclick = async () => {
        el('dorst').disabled = true; el('dorst').textContent = 'restarting…';
        try { const rr = await api('POST','/api/restart',{}); location.href = rr.url; }
        catch (e) { el('updbox').innerHTML += '<span class="dim">The app is restarting — if this window goes quiet, reopen with: crate open</span>'; }
      };
    } catch (e) { el('updbox').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; }
  };
}).catch(() => el('upd').textContent = '');`,
  );
}

export function staffingPage(): string {
  // W2 (audit D1): roster-first — the recommended team is PRESENTED (five seat
  // cards you can admire), not configured. One primary action accepts it;
  // Customize expands the full per-seat pickers (today's form) as the escape
  // hatch. Provenance strings live behind Customize, not on the happy path.
  return shell(
    "Your team",
    "/staffing",
    `
<h1>Your team</h1>
<p class="lede">Five seats, staffed with the battle-tested picks from the agents already on
this Mac. Use it as-is — or open the seats and make them yours. These become your defaults
for every project (a repo's <code>rig.conf</code> can still override per seat).</p>
<div id="crewline" class="mono dim" style="font-size:12.5px;margin-top:16px"></div>
<div class="roster" id="roster"></div>
<div class="row" style="margin-top:16px">
  <button id="use">Use this team → pick your project</button>
  <button class="quiet" id="customize">Customize seats</button>
</div>
<div id="custom" style="display:none;margin-top:14px">
  <div class="card">
    <p class="eyebrow">Detected on this machine</p>
    <h2>Your AI agents</h2>
    <p class="hint">Crate Engine doesn't install or sign in agents — it offers whatever is
    already installed and signed in on this Mac (the seats run on YOUR accounts).
    Sign into another agent in its own way, then Refresh.</p>
    <div id="agents" class="dim" style="margin-top:10px">checking…</div>
    <p style="margin-top:10px"><button class="quiet" id="rescan">Refresh</button></p>
  </div>
  <p class="eyebrow" style="margin-top:22px">Seats</p>
  <div id="seats"></div>
  <p style="margin-top:12px"><button class="quiet" id="save">Save without continuing</button></p>
</div>
<div id="msg"></div>`,
    `
let CATALOG = null, DIRTY = false;
function billOf(o) { return /METERED/i.test(o.billing) ? '<span class="warn">⚠ metered</span>' : 'flat-rate'; }
function detailFor(value, seat) {
  const [agent, model] = value.split('|');
  const o = CATALOG.models.find(m => m.agent === agent && m.model === model);
  if (!o) return '';
  if (!o.ready) return '<span class="bad">not detected on this machine</span>' + (o.fix ? ' — <span class="dim">' + esc(o.fix) + '</span>' : '');
  const v = o.verifiedFor.includes(seat);
  // run #4: "untested" read as an ERROR — a custom pick is a choice, not a fault.
  const badge = v ? '<span class="ok">✓ recommended — battle-tested on this seat</span>'
                  : '<span class="dim">your pick — works here, not yet battle-tested on this seat</span>';
  const metered = /METERED/i.test(o.billing);
  return (metered ? '<span class="bad">' + esc(o.billing) + '</span>' : esc(o.billing)) + ' · ' + badge;
}
function effectivePick(s) {
  // The vision's §11 rule: the seat's VERIFIED default is pre-selected for a
  // fresh user; an EXPLICIT choice (user default / rig.conf) wins over it.
  const offered = CATALOG.models.filter(o => o.ready);
  const explicit = s.current.agentSource === 'user default' || s.current.agentSource === 'rig.conf'
                || s.current.modelSource === 'user default' || s.current.modelSource === 'rig.conf';
  const verified = offered.find(o => o.verifiedFor.includes(s.seat));
  return explicit || !verified ? { agent: s.current.agent, model: s.current.model }
                               : { agent: verified.agent, model: verified.model };
}
function pickOf(seat) {
  const sel = document.querySelector('select[data-seat="' + seat + '"]');
  if (sel) { const [agent, model] = sel.value.split('|'); return { agent, model }; }
  return effectivePick(CATALOG.seats.find(s => s.seat === seat));
}
function renderRoster() {
  el('crewline').innerHTML = 'your crew · ' + CATALOG.agents.map(a =>
    esc(a.label) + ' ' + (a.ready ? '<span class="ok">✓</span>' : '<span class="dim">—</span>')).join(' · ');
  el('roster').innerHTML = CATALOG.seats.map(s => {
    const p = pickOf(s.seat);
    const o = CATALOG.models.find(m => m.agent === p.agent && m.model === p.model);
    const name = o ? o.display.replace(/ — ⚠ metered$/, '') : p.agent + (p.model ? '/' + p.model : '');
    const badge = o ? ((o.verifiedFor.includes(s.seat) ? '✓ battle-tested' : 'your pick') + ' · ' + billOf(o))
                    : '<span class="warn">not detected</span>';
    return '<div class="seatcard"><div class="st">' + esc(s.title) + '</div>' +
      '<div class="sm">' + esc(name) + '</div><div class="sb">' + badge + '</div></div>';
  }).join('');
  const anyReady = CATALOG.agents.some(a => a.ready);
  el('use').disabled = !anyReady;
  if (!anyReady) el('msg').innerHTML = '<span class="warn">No agents ready on this Mac yet</span> — <span class="dim">connect your crew on the Crew screen first.</span>';
}
function renderAgents() {
  el('agents').innerHTML = CATALOG.agents.map(a =>
    '<div class="row" style="margin:8px 0"><div class="grow"><b>' + esc(a.label) + '</b></div>' +
    (a.ready ? '<span class="pill ok">✓ ready</span>'
             : '<span class="tag" style="color:var(--warn);border-color:var(--warn)">' + (a.installed ? 'not signed in' : 'not installed') + '</span>') +
    '</div>' +
    (!a.ready && a.fix ? '<div class="dim" style="font-size:13px;margin:0 0 8px">' + esc(a.fix) + '</div>' : '')
  ).join('') || '<span class="dim">no supported agents detected yet</span>';
}
function renderSeats() {
  renderAgents();
  el('seats').innerHTML = CATALOG.seats.map(s => {
    // Since the P6-6 direction change, only DETECTED agents are offered.
    const offered = CATALOG.models.filter(o => o.ready);
    const pick = effectivePick(s);
    let opts = offered.map(o => {
      const sel = (o.agent === pick.agent && o.model === pick.model) ? ' selected' : '';
      return '<option value="' + esc(o.agent + '|' + o.model) + '"' + sel + '>' + esc(o.display) + '</option>';
    }).join('');
    // Pi-discovered but BLOCKED (e.g. a custom provider whose $ENV_VAR key
    // isn't set): shown disabled with the fix — a configured provider that
    // silently vanished would be the exact silent-lie this page forbids.
    opts += CATALOG.models.filter(o => o.discovered && !o.ready).map(o =>
      '<option disabled>' + esc(o.display) + ' — ' + esc(o.fix || 'not ready') + '</option>').join('');
    // the current pick's agent isn't detected: show it honestly, never hide it
    if (!offered.some(o => o.agent === pick.agent && o.model === pick.model)) {
      const ghost = CATALOG.models.find(o => o.agent === pick.agent && o.model === pick.model);
      opts = '<option value="' + esc(pick.agent + '|' + pick.model) + '" selected>' +
        esc(ghost ? ghost.display : pick.agent + '/' + pick.model) + ' — not detected</option>' + opts;
    }
    return '<div class="card"><div class="row"><div style="width:132px"><b>' + esc(s.title) + '</b><br>' +
      '<span class="tag" style="margin-top:6px">' + esc(s.seat) + '</span></div>' +
      '<div class="grow"><select data-seat="' + esc(s.seat) + '">' + opts + '</select>' +
      '<div class="mono" id="detail-' + esc(s.seat) + '" style="margin-top:7px;color:var(--dim)"></div>' +
      '<div class="mono" style="font-size:11px;margin-top:4px;color:var(--faint)">source: agent [' + esc(s.current.agentSource) + '] · model [' + esc(s.current.modelSource) + ']</div>' +
      '</div></div></div>';
  }).join('');
  document.querySelectorAll('select[data-seat]').forEach(sel => {
    const upd = () => el('detail-' + sel.dataset.seat).innerHTML = detailFor(sel.value, sel.dataset.seat);
    sel.onchange = () => { DIRTY = true; upd(); renderRoster(); }; upd();
  });
}
function load() {
  return api('GET','/api/staffing').then(c => {
    CATALOG = c;
    renderRoster();
    if (el('custom').style.display !== 'none') renderSeats();
  }).catch(e => el('msg').textContent = String(e));
}
load();
el('customize').onclick = () => {
  const open = el('custom').style.display !== 'none';
  el('custom').style.display = open ? 'none' : '';
  el('customize').textContent = open ? 'Customize seats' : 'Hide the seat pickers';
  if (!open) renderSeats();
};
el('rescan').onclick = async () => {
  el('rescan').disabled = true; el('rescan').textContent = 'rescanning…';
  await load();
  el('rescan').disabled = false; el('rescan').textContent = 'Refresh';
};
async function saveSeats() {
  const seats = {};
  CATALOG.seats.forEach(s => { seats[s.seat] = pickOf(s.seat); });
  el('msg').textContent = 'saving…';
  try { const r = await api('POST','/api/defaults',{ seats });
        el('msg').innerHTML = '<span class="ok">Saved.</span> ' + esc(r.file);
        DIRTY = false; return true; }
  catch (e) { el('msg').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; return false; }
}
el('save').onclick = saveSeats;
el('use').onclick = async () => {
  // accepting the roster SAVES it (idempotent when nothing changed) — the
  // run #4 rule survives: picks never silently vanish on continue.
  if (!(await saveSeats())) return;
  location.href = link('/attach');
};`,
  );
}

export function attachPage(): string {
  return shell(
    "Your project",
    "/attach",
    `
<h1>What are we building?</h1>
<p class="lede">Name your project and go — Crate Engine sets up the folder, git, and starter
docs for you. Nothing is written until you see exactly what will be added and confirm.</p>
<div class="card">
  <p class="eyebrow">Project</p>
  <div id="modebody"></div>
  <p style="margin-top:14px"><button class="quiet" id="modeswap"></button></p>
</div>
<div id="disclosure"></div>
<div id="msg"></div>
<div id="picker" style="display:none"></div>`,
    `
let PLAN = null, MODE = null, DEST = '~/Projects';
// W1.5 (name-first): the screen opens READY — "Start a new project" is the
// default with one focused field; the location is a sensible default behind a
// quiet "change location" link, never an up-front question. "I already have a
// project" is the secondary path, one click away.
function setMode(m) {
  MODE = m;
  el('disclosure').innerHTML = ''; el('msg').textContent = '';
  if (m === 'existing') {
    el('modebody').innerHTML =
      '<label class="dim" style="font-size:13px">Your project folder — the team joins it as-is</label>' +
      '<div class="row" style="margin:8px 0"><input type="text" id="target" class="grow" placeholder="~/Projects/my-app">' +
      '<button class="quiet" id="browse">Browse…</button></div>' +
      '<p style="margin-top:10px"><button id="plan" disabled>Show me what will be added</button></p>';
    el('browse').onclick = () => openPicker('Choose your project folder', el('target').value, p => { el('target').value = p; sync(); });
    el('target').addEventListener('input', sync);
    el('target').focus();
  } else {
    el('modebody').innerHTML =
      '<label class="dim" style="font-size:13px">Name your project</label>' +
      '<div style="margin:8px 0"><input type="text" id="pname" placeholder="my-app" autocomplete="off"></div>' +
      '<div class="dim" id="newpath" style="font-size:12.5px;min-height:18px"></div>' +
      '<div class="row" id="locrow" style="margin:8px 0;display:none"><input type="text" id="dest" class="grow" value="' + esc(DEST) + '">' +
      '<button class="quiet" id="browse">Browse…</button></div>' +
      '<p style="margin-top:10px"><button id="plan" disabled>Show me what will be added</button></p>';
    el('browse').onclick = () => openPicker('Choose where the new project goes', el('dest').value, p => { DEST = p; el('dest').value = p; sync(); });
    el('dest').addEventListener('input', sync);
    el('pname').addEventListener('input', sync);
    el('pname').focus();
  }
  el('plan').onclick = plan;
  el('modeswap').textContent = m === 'new' ? 'I already have a project folder →' : '← Start a new project instead';
  sync();
}
function targetValue() {
  if (MODE === 'existing') return el('target').value.trim();
  let d = el('dest').value.trim(); const n = el('pname').value.trim();
  while (d.endsWith('/')) d = d.slice(0, -1);
  return d && n ? d + '/' + n : '';
}
function sync() {
  const t = targetValue();
  if (MODE === 'new') {
    const revealed = el('locrow').style.display !== 'none';
    el('newpath').innerHTML = 'set up for you at <code>' + esc(t || el('dest').value.trim() + '/…') + '</code>' +
      (revealed ? '' : ' — <a href="#" id="chgloc" style="color:var(--amber)">change location</a>');
    const c = el('chgloc');
    if (c) c.onclick = (ev) => { ev.preventDefault(); el('locrow').style.display = ''; el('dest').focus(); sync(); };
  }
  el('plan').disabled = t === '';
}
el('modeswap').onclick = () => setMode(MODE === 'new' ? 'existing' : 'new');
setMode('new');

// the folder picker — a real browse dialog, served by the engine (home-only)
function openPicker(title, startPath, onChoose) {
  const pk = el('picker'); pk.style.display = '';
  function close() { pk.innerHTML = ''; pk.style.display = 'none'; }
  async function go(path) {
    try {
      const l = await api('GET', '/api/fs/dirs' + (path ? '?path=' + encodeURIComponent(path) : ''));
      pk.innerHTML = '<div class="overlay"><div class="pickpanel">' +
        '<div class="pickhead"><p class="eyebrow" style="margin-bottom:6px">' + esc(title) + '</p>' +
        '<div class="row"><span class="mono grow" style="font-size:12px">' + esc(l.path) + '</span>' +
        (l.parent ? '<button class="quiet" id="pk-up">↑ Up</button>' : '') + '</div></div>' +
        '<div class="picklist">' + (l.dirs.length ? l.dirs.map(d =>
          '<button class="pickrow" data-d="' + esc(d.name) + '"><span class="grow">' + esc(d.name) + '</span>' +
          (d.isRepo ? '<span class="tag" style="color:var(--ok);border-color:var(--ok)">git</span>' : '') + '</button>').join('')
          : '<p class="dim" style="padding:14px 16px;font-size:13px">no folders in here yet</p>') + '</div>' +
        '<div class="pickfoot" style="justify-content:space-between">' +
        '<div class="row grow" id="pk-newrow"><button class="quiet" id="pk-new">＋ New folder</button></div>' +
        '<div class="row"><button class="quiet" id="pk-cancel">Cancel</button>' +
        '<button id="pk-use">Use this folder</button></div></div>' +
        '<div id="pk-err" class="bad" style="padding:0 16px 12px;font-size:12.5px"></div></div></div>';
      if (el('pk-up')) el('pk-up').onclick = () => go(l.parent);
      pk.querySelectorAll('[data-d]').forEach(b => b.onclick = () => go(l.path + '/' + b.dataset.d));
      el('pk-cancel').onclick = close;
      el('pk-use').onclick = () => { close(); onChoose(l.path); };
      // run #6: create a folder right here — no Finder round-trip
      el('pk-new').onclick = () => {
        el('pk-newrow').innerHTML = '<input type="text" id="pk-name" placeholder="folder name" style="max-width:200px">' +
          '<button class="quiet" id="pk-mk">Create</button>';
        el('pk-name').focus();
        const make = async () => {
          try {
            const made = await api('POST', '/api/fs/mkdir', { path: l.path, name: el('pk-name').value });
            go(made.path); // step into the new folder
          } catch (e) { el('pk-err').textContent = e.message; }
        };
        el('pk-mk').onclick = make;
        el('pk-name').addEventListener('keydown', ev => { if (ev.key === 'Enter') make(); });
      };
    } catch (e) { close(); el('msg').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; }
  }
  go(startPath && startPath.trim() ? startPath : '~/Projects');
}

async function plan() {
  el('msg').textContent = ''; el('disclosure').innerHTML = '';
  try {
    PLAN = await api('POST','/api/attach/plan',{ target: targetValue(), create: MODE === 'new' });
    const committed = PLAN.writes.filter(w => w.action !== 'keep' && w.kind === 'committed');
    const local = PLAN.writes.filter(w => w.action !== 'keep' && w.kind === 'local');
    const keeps = PLAN.writes.filter(w => w.action === 'keep');
    const rows = (ws) => ws.map(w => '<tr><td><code>' + esc(w.rel) + '</code></td><td class="dim">' + esc(w.note) + '</td></tr>').join('');
    el('disclosure').innerHTML =
      '<div class="card"><p class="eyebrow">Disclosure</p><h2>' + (PLAN.mode === 'create' ? 'Creating' : 'Attaching') + ': ' + esc(PLAN.project) + '</h2>' +
      (committed.length ? '<h2 style="margin-top:14px;font-size:13.5px">Added to YOUR repo (committed with your code)</h2><table>' + rows(committed) + '</table>' : '') +
      (local.length ? '<h2 style="margin-top:14px;font-size:13.5px">Local-only wiring (never pushed — auto-gitignored)</h2><table>' + rows(local) + '</table>' : '') +
      (keeps.length ? '<p class="dim" style="margin-top:10px;font-size:13px">Already present, kept as-is: ' + keeps.map(w => esc(w.rel)).join(', ') + '</p>' : '') +
      (PLAN.needsGit && PLAN.mode === 'attach' ? '<p class="warn" style="margin-top:10px">This folder is not a git repository. <label><input type="checkbox" id="gitinit" checked> Initialize git (recommended)</label></p>' : '') +
      (PLAN.mode === 'create' ? '<p style="margin-top:10px"><label><input type="checkbox" id="ghrepo"> Also create a private GitHub repo and push (off-box backup — needs the gh CLI signed in)</label></p>' : '') +
      '<p style="margin-top:14px"><button id="confirm">Looks right — attach the team</button></p></div>';
    el('confirm').onclick = execute;
  } catch (e) { el('msg').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; }
}
async function execute() {
  el('confirm').disabled = true; el('msg').textContent = 'attaching…';
  try {
    const gi = document.getElementById('gitinit');
    const gr = document.getElementById('ghrepo');
    const r = await api('POST','/api/attach/execute',
      { target: targetValue(), create: MODE === 'new', gitInit: gi ? gi.checked : false, githubRepo: gr ? gr.checked : false });
    el('msg').innerHTML = '<span class="ok">Done — ' + r.report.changed.length + ' paths written' +
      (r.report.firstCommit ? ', first commit ' + esc(r.report.firstCommit) : '') +
      (r.report.githubRepo ? ', GitHub: ' + esc(r.report.githubRepo) : '') + '.</span>' +
      (r.report.githubNote ? ' <span class="warn">' + esc(r.report.githubNote) + '</span>' : '') +
      ' <span class="dim">Taking you to start your engine…</span>';
    // W1: tooling + wiring + boot are ONE preflight now — go to Start.
    setTimeout(() => location.href = link('/start'), 500);
  } catch (e) { el('confirm').disabled = false; el('msg').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; }
}`,
  );
}

// ── Step: Start the engine (W1) — Arm + Check + Boot as ONE preflight ────────
// One press: heavy seat tooling installs (per-tool live clock, run #11 UI),
// the doctor's ambers surface (never block), crew sign-ins gate HARD (the old
// up() refusal, now client-visible), then the headless boot with all five
// seats lighting up live — and the page hands off INTO the cockpit (/team).
// Failures hold the row open with the honest fix and a Retry that resumes at
// the failed step (everything underneath is idempotent).
export function startPage(): string {
  return shell(
    "Start the engine",
    "/start",
    `
<h1>Start the engine</h1>
<p class="lede mono" id="proj" style="font-size:12.5px">project: —</p>
<p class="lede">One press. The engine arms any tools your seats need, checks its wiring,
verifies your crew's sign-ins, and boots all five seats — and it tells you plainly if
anything needs you.</p>
<div class="card">
  <p class="eyebrow">Preflight &amp; boot</p>
  <div id="steps" class="dim">checking the project…</div>
  <div class="row" style="margin-top:16px" id="actions">
    <button id="go" disabled>Start engine</button>
    <button class="quiet" id="back">← Back</button>
  </div>
</div>
<div id="msg"></div>`,
    `
const SEAT_TITLES = { orchestrator:'Orchestrator', coder:'Coder', reviewer:'Reviewer', designer:'Designer', tester:'QA' };
el('back').onclick = () => location.href = link('/attach');
function row(id, label) {
  return '<div class="prow" id="prow-' + id + '"><span class="pdot" id="pdot-' + id + '"></span>' +
    '<div class="grow"><b>' + label + '</b><div class="mono dim" id="pnote-' + id + '" style="font-size:12px;margin-top:2px"></div></div></div>';
}
function set(id, state, note) {
  const d = el('pdot-' + id); if (d) d.className = 'pdot ' + state;
  if (note !== undefined) { const n = el('pnote-' + id); if (n) n.innerHTML = note; }
}
function renderRows() {
  el('steps').innerHTML = row('tools', 'Tools your seats need') + row('wiring', 'Wiring check') +
    row('crew', 'Crew sign-ins') + row('boot', 'Boot the team') + '<div id="seatrows"></div>';
}
async function stepTools() {
  set('tools', 'run', 'checking…');
  let deps;
  try { deps = await api('GET', '/api/deps'); }
  catch (e) { set('tools', 'bad', esc(e.message)); throw { cont: true }; }
  if (!deps.length) { set('tools', 'ok', 'everything your seats need is already in the box'); return; }
  for (const d of deps) {
    const t0 = Date.now();
    set('tools', 'run', '<b>' + esc(d.name) + '</b> downloading… <span id="tclock">0s</span> <span class="dim">(one-time; big ones take a few minutes)</span>');
    const tick = setInterval(() => { const c = el('tclock'); if (c) c.textContent = Math.round((Date.now() - t0) / 1000) + 's'; }, 1000);
    let r;
    try { r = await api('POST', '/api/deps/install-one', { name: d.name }); }
    catch (e) { clearInterval(tick); set('tools', 'bad', esc(d.name) + ' — ' + esc(e.message)); throw { cont: true }; }
    clearInterval(tick);
    if (!r.ok) {
      set('tools', 'bad', esc(d.name) + ' failed — ' + esc(r.detail || '') + ' <span class="dim">(a seat that needs it refuses to boot and names it)</span>');
      throw { cont: true };
    }
  }
  set('tools', 'ok', 'armed — you won\\'t see these downloads again on this Mac');
}
async function stepWiring() {
  set('wiring', 'run', 'checking…');
  let rows;
  try { rows = await api('GET', '/api/doctor'); }
  catch (e) { set('wiring', 'warn', esc(e.message)); return; }
  const attn = rows.filter(d => d.status !== 'ok' && d.status !== 'info');
  if (!attn.length) { set('wiring', 'ok', 'all wiring green'); return; }
  set('wiring', 'warn', attn.map(d => esc(d.name) + (d.fix ? ' — <span class="dim">fix: ' + esc(d.fix) + '</span>' : '')).join('<br>') +
    '<br><span class="dim">nothing here blocks the boot</span>');
}
async function stepCrew() {
  set('crew', 'run', 'verifying…');
  let ag;
  try { ag = await api('GET', '/api/agents'); }
  catch (e) { set('crew', 'bad', esc(e.message)); throw {}; }
  const out = ag.filter(a => !a.ready);
  if (out.length) {
    set('crew', 'bad', out.map(a => '<b>' + esc(a.label) + '</b> (' + (a.installed ? 'not signed in' : 'not installed') + ')' +
      (a.fix ? ' — <span class="dim">' + esc(a.fix) + '</span>' : '')).join('<br>') +
      '<br><a href="#" id="tostaff" style="color:var(--amber)">Re-staff your team</a>');
    const ts = el('tostaff'); if (ts) ts.onclick = (ev) => { ev.preventDefault(); location.href = link('/staffing'); };
    throw {};
  }
  set('crew', 'ok', ag.map(a => esc(a.label)).join(' · ') + ' — signed in and ready');
}
async function stepBoot() {
  set('boot', 'run', 'spawning seat runners…');
  try { await api('POST', '/api/team/boot', {}); }
  catch (e) { set('boot', 'bad', esc(e.message)); throw {}; }
  el('seatrows').innerHTML = Object.keys(SEAT_TITLES).map(s =>
    '<div class="prow sub"><span class="pdot run" id="sdot-' + s + '"></span>' +
    '<div class="grow"><b>' + SEAT_TITLES[s] + '</b> <span class="mono dim" id="snote-' + s + '" style="font-size:12px">starting…</span></div></div>').join('');
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    let st = null;
    try { st = await api('GET', '/api/team/status'); } catch (e) { /* poll again */ }
    if (st && st.seats) {
      let alive = 0;
      for (const s of st.seats) {
        const d = el('sdot-' + s.seat), n = el('snote-' + s.seat);
        if (s.alive) { alive++; if (d) d.className = 'pdot ok'; if (n) n.textContent = 'live'; }
      }
      if (alive === st.seats.length && alive > 0) {
        set('boot', 'ok', 'all seats live in ' + Math.max(1, Math.round((Date.now() - t0) / 1000)) + 's');
        return;
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  set('boot', 'bad', 'some seats did not come up in 90s — Retry is safe (live seats are left alone); the Team menu in the engine room can relaunch one seat.');
  throw {};
}
const STEPS = [stepTools, stepWiring, stepCrew, stepBoot];
async function run(from) {
  el('actions').innerHTML = '';
  if (!from) renderRows();
  for (let i = from || 0; i < STEPS.length; i++) {
    try { await STEPS[i](); }
    catch (e) {
      el('actions').innerHTML = '<button id="go2">Retry</button>' +
        (e && e.cont ? ' <button class="quiet" id="cont">Continue anyway</button>' : '');
      el('go2').onclick = () => run(i);
      const c = el('cont'); if (c) c.onclick = () => run(i + 1);
      return;
    }
  }
  el('steps').insertAdjacentHTML('beforeend',
    '<p style="margin-top:12px"><span class="ok">✓ Your team is up.</span> <span class="dim">Opening your engine room…</span></p>');
  setTimeout(() => { location.href = link('/team'); }, 900);
}
async function init() {
  let h;
  try { h = await api('GET', '/api/health'); }
  catch (e) {
    el('steps').innerHTML = '<span class="bad">' + esc(e.message) + '</span> — <span class="dim">pick your project first.</span>';
    el('back').textContent = '← Pick your project';
    return;
  }
  el('proj').textContent = 'project: ' + h.project;
  const alive = (h.seats || []).filter(s => s.liveness === 'live').length;
  if (h.booted && alive === (h.seats || []).length && alive > 0) {
    el('steps').innerHTML = '<p><span class="ok">✓ Your team is already up (' + alive + '/' + h.seats.length + ' seats live).</span></p>';
    const go = el('go'); go.disabled = false; go.textContent = 'Open the engine room →';
    go.onclick = () => location.href = link('/team');
    return;
  }
  el('steps').innerHTML = '<p class="hint">Ready when you are.</p>';
  const go = el('go'); go.disabled = false;
  go.onclick = () => run(0);
}
init();`,
  );
}
