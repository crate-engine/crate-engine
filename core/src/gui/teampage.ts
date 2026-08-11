// PHASE-8 T2 — the thin viewer v0 (/team). The cmux pane grid, reborn as
// read-only glass over the headless artifacts. Adam's first VISUAL gate:
// deliberately minimal (no Console, no gates, no polish) — the point is to
// LOOK at a real headless turn in Adam's pane layout and react. Brand
// palette matches the wizard; layout is a full-bleed grid (orchestrator
// left, workers right) instead of the stepper's 860px column.
import type { TeamView } from "./teamview.js";

/** Server-side HTML escape (the client has its own `esc` inside VIEW_JS). */
function escHtml(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

const VIEW_STYLE = `
/* crate-engine.ai brand — palette + faces verbatim from the site repo:
   Michroma display, Barlow body, JetBrains Mono readouts. W2: fonts are
   SELF-HOSTED (the engine serves them at /fonts/) — a local engine room
   phones nobody and never goes off-brand offline. */
@font-face{font-family:'Michroma';font-style:normal;font-weight:400;font-display:swap;src:url('/fonts/michroma-400.woff2') format('woff2')}
@font-face{font-family:'Barlow';font-style:normal;font-weight:400;font-display:swap;src:url('/fonts/barlow-400.woff2') format('woff2')}
@font-face{font-family:'Barlow';font-style:normal;font-weight:500;font-display:swap;src:url('/fonts/barlow-500.woff2') format('woff2')}
@font-face{font-family:'Barlow';font-style:normal;font-weight:600;font-display:swap;src:url('/fonts/barlow-600.woff2') format('woff2')}
@font-face{font-family:'Barlow';font-style:normal;font-weight:700;font-display:swap;src:url('/fonts/barlow-700.woff2') format('woff2')}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/fonts/jetbrains-mono-400.woff2') format('woff2')}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:500;font-display:swap;src:url('/fonts/jetbrains-mono-500.woff2') format('woff2')}
:root{--bg:#0b0e14;--carbon:#0b0e14;--panel:#12161f;--panel2:#161b26;--line:#222835;--line2:#323a4b;
--fg:#f1f3f6;--alu:#c7cdd8;--dim:#8b94a5;--faint:#6b7488;--amber:#e2a33c;--amber-hi:#f0b654;
--ok:#57c489;--warn:#e2a33c;--bad:#e4614d;
--disp:"Michroma",sans-serif;--body:"Barlow",-apple-system,system-ui,sans-serif;
--mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;}
*{box-sizing:border-box;margin:0}html{color-scheme:dark}
/* W3 a11y: visible keyboard focus + honor reduced-motion (audit X2) */
:is(button,a,select,input):focus-visible{outline:2px solid var(--amber);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
/* W3: in-app dialogs — native alert/confirm/prompt blocked the 2s poll loop (audit I2) */
.uidlg{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:90}
.uidlg .box{background:var(--panel);border:1px solid var(--line2);border-radius:0;box-shadow:0 12px 40px rgba(0,0,0,.5);width:min(460px,92vw);padding:18px 20px;max-height:80vh;display:flex;flex-direction:column}
.uidlg h3{font:600 11px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin-bottom:10px}
.uidlg .m{font-size:14px;color:var(--alu);line-height:1.6;white-space:pre-wrap}
.uidlg .btns{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex:0 0 auto}
.uidlg .btns button{border-radius:0;padding:9px 16px;font:600 12px/1 var(--body);cursor:pointer;background:var(--panel2);border:1px solid var(--line2);color:var(--fg)}
.uidlg .btns button.pri{background:var(--amber);border:0;color:#151109}
.uidlg .btns button.danger{background:var(--bad);border:0;color:#fff}
.uidlg .pklist{flex:1 1 auto;overflow-y:auto;margin:6px -20px 0;border-top:1px solid var(--line);min-height:120px}
.uidlg .pkrow{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line);color:var(--fg);padding:10px 20px;font:12.5px/1.4 var(--mono);cursor:pointer}
.uidlg .pkrow:hover{background:var(--panel2)}
.uidlg .pktag{font:600 9px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ok);border:1px solid var(--ok);border-radius:0;padding:3px 6px}
body{background:var(--bg);color:var(--fg);font:15.5px/1.55 var(--body);-webkit-font-smoothing:antialiased;height:100vh;display:flex;flex-direction:column;overflow:hidden}
/* PHASE-B #1: the dead-server banner — when polls fail the page must SAY the
   engine is offline, never keep rendering the last-known state as if live. */
.deadbar{display:none;background:#2a1210;border-bottom:1px solid var(--bad);color:var(--bad);font:600 10.5px/1.5 var(--mono);letter-spacing:.14em;text-transform:uppercase;padding:10px 16px;text-align:center;flex:0 0 auto}
.deadbar code{color:var(--fg);text-transform:none;letter-spacing:0}
body.dead .deadbar{display:block}
body.dead header,body.dead main{opacity:.4;pointer-events:none}
header{padding:12px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px;flex:0 0 auto}
.working{font:500 11px/1 var(--mono);letter-spacing:.04em;color:var(--amber);display:inline-flex;align-items:center;gap:7px}
.working .wd{width:5px;height:5px;border-radius:50%;background:var(--amber);animation:pulse 1.1s infinite}
.working .rmeta{color:var(--faint);letter-spacing:0}
.mark{font:400 13px/1 var(--disp);letter-spacing:.1em;text-transform:uppercase;display:inline-flex;align-items:center}
.bolt{height:.72em;width:auto;fill:var(--amber);margin:0 .14em;transform:translateY(.02em)}
.proj{font:500 11px/1 var(--mono);letter-spacing:.12em;color:var(--dim);text-transform:uppercase}
/* PHASE-B #2: the loop-narration chip — round N + whose move it is, straight
   from events.log. THE "it feels slow" fix: minutes-long agent turns must
   read as a loop in motion, not a frozen page. */
.loopchip{display:inline-flex;align-items:center;gap:7px;font:600 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--amber);white-space:nowrap}
.loopchip .ld{width:5px;height:5px;border-radius:50%;background:var(--amber);animation:pulse 1.1s infinite;flex:0 0 auto}
.loopchip .lm{color:var(--faint);letter-spacing:0;text-transform:none}
.loopchip.calm{color:var(--ok)}
.loopchip.calm .ld{animation:none;background:var(--ok)}
/* PHASE-B #5 (Adam): the top nav is CLEAN TEXT — no boxes anywhere in the
   masthead (nav items, hamburger, badges, toggle). Panel-openers carry an
   amber spin-down chevron that flips while their panel is open. */
.ver{font:500 10px/1 var(--mono);letter-spacing:.16em;color:var(--faint);text-transform:uppercase}
.ver b{color:var(--amber);font-weight:600}
.hbadge{font:500 9.5px/1 var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--ok)}
.navbtn{position:relative;background:transparent;border:0;color:var(--dim);padding:6px 0;font:600 10px/1 var(--body);letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
.navbtn::after{content:"▾";color:var(--amber);display:inline-block;margin-left:6px;transition:transform .18s ease;vertical-align:middle}
.navbtn.open::after{transform:rotate(180deg)}
.navbtn:hover{color:var(--fg)}
.navbtn.pending{color:var(--amber)}
.navbtn.pending::before{content:"";position:absolute;top:-1px;left:-12px;width:8px;height:8px;border-radius:50%;background:var(--amber);animation:pulse 1.2s infinite}
.navbtn.hidden{display:none}
/* Preview surface (T5) */
.pvwrap{position:absolute;top:53px;left:50%;transform:translateX(-50%);width:min(1100px,calc(100vw - 32px));max-height:86vh;background:var(--panel);border:1px solid var(--line2);border-top:0;border-radius:0;box-shadow:0 12px 50px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden}
.pvhead{display:flex;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid var(--line);flex:0 0 auto}
.pvhead h3{font:600 11px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--amber)}
.pvhead .pvurl{font:500 11.5px/1 var(--mono);color:var(--dim)}
.pvhead .pvsp{flex:1}
.vptoggle{display:flex;border:1px solid var(--line2);border-radius:0;overflow:hidden}
.vptoggle button{background:transparent;color:var(--dim);border:0;padding:7px 13px;font:600 10px/1 var(--body);letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.vptoggle button.on{background:var(--amber);color:#151109}
.pvstage{flex:1 1 auto;overflow:auto;background:var(--carbon);display:flex;justify-content:center;align-items:flex-start;padding:18px}
.pvframe{background:#fff;border:0;box-shadow:0 6px 24px rgba(0,0,0,.4)}
.pvframe.mobile{width:390px;height:844px;border-radius:14px}
.pvframe.desktop{width:1280px;height:800px;transform-origin:top center}
.pvfoot{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--line);flex:0 0 auto}
.pvfoot .pvnote{flex:1;background:var(--panel2);border:1px solid var(--line2);border-radius:0;color:var(--fg);padding:9px 12px;font-size:13px;outline:none}
.pvfoot .pvopen{background:transparent;border:1px solid var(--line2);border-radius:0;color:var(--dim);padding:9px 13px;font:600 10px/1 var(--body);letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.pvfoot .pvbad{background:transparent;border:1px solid var(--line2);border-radius:0;color:var(--fg);padding:9px 14px;font:600 11px/1 var(--body);cursor:pointer}
.pvfoot .pvok{background:var(--ok);color:#0b1410;border:0;border-radius:0;padding:9px 16px;font:600 11px/1 var(--body);cursor:pointer}
/* Context Console overlay (D12) */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;z-index:50}
.overlay.open{display:block}
/* PHASE-B #5: panels hang square off the nav — flush to the header's bottom
   edge, zero radius, no floating gap (Adam's restyle). */
.console{position:absolute;top:53px;right:0;width:460px;max-width:calc(100vw - 32px);max-height:80vh;overflow-y:auto;background:var(--panel);border:1px solid var(--line2);border-top:0;border-right:0;border-radius:0;box-shadow:0 12px 40px rgba(0,0,0,.5);padding:16px 18px}
.console h3{font:600 11px/1 var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--amber);margin-bottom:4px}
.console .csub{font-size:11.5px;color:var(--faint);margin-bottom:14px}
.crow{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)}
.crow .cname{font:500 10px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;flex:0 0 108px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crow .cbar{flex:1;height:7px;border-radius:0;background:var(--line2);overflow:hidden}
.crow .cfill{display:block;height:100%;border-radius:0;background:var(--ok)}
.crow.advisory .cfill{background:var(--amber)}.crow.high .cfill{background:var(--bad)}
.crow .cpc{font:600 10px/1 var(--mono);color:var(--faint);width:34px;text-align:right}
.crow .crefresh{background:transparent;border:1px solid var(--line2);border-radius:0;color:var(--dim);font:600 9px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;padding:6px 8px;cursor:pointer}
.crow .crefresh:hover{color:var(--amber);border-color:var(--amber)}
.cactions{display:flex;gap:8px;margin-top:14px}
.cactions button{flex:1;background:var(--panel2);border:1px solid var(--line2);border-radius:0;color:var(--fg);font:600 10px/1 var(--body);letter-spacing:.08em;text-transform:uppercase;padding:10px;cursor:pointer}
.cactions button:hover{border-color:var(--amber)}
.cpolicy{margin-top:14px;font-size:11px;color:var(--faint);line-height:1.6;border-top:1px solid var(--line);padding-top:10px}
.cpolicy b{color:var(--dim)}
.toggle{display:inline-flex;gap:14px}
.toggle button{background:transparent;color:var(--faint);border:0;padding:6px 0;font:600 10px/1 var(--body);letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
.toggle button:hover{color:var(--fg)}
.toggle button.on{color:var(--amber)}
/* T7-1: the workspace rail — a left drawer, HIDDEN by default so a
   single-project user gets the full-bleed grid edge-to-edge (Adam). */
.railbtn{background:transparent;border:0;color:var(--dim);width:30px;height:28px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto}
.railbtn:hover{color:var(--fg)}
.railbtn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.rail{position:fixed;top:0;left:0;bottom:0;width:270px;background:var(--panel);border-right:1px solid var(--line2);z-index:60;transform:translateX(-100%);transition:transform .18s ease;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,.5)}
.rail.open{transform:translateX(0)}
.railback{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:55;display:none}
.railback.open{display:block}
.railhd{padding:16px 18px 12px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}
.railhd h3{font:600 11px/1 var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--amber)}
.railhd .rx{background:transparent;border:0;color:var(--faint);font-size:18px;cursor:pointer;line-height:1}
.railhd .rx:hover{color:var(--fg)}
.wslist{flex:1 1 auto;overflow-y:auto;padding:8px}
.wsitem{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:0;cursor:pointer;border:1px solid transparent}
.wsitem:hover{background:var(--panel2)}
.wsitem.active{background:var(--panel2);border-color:var(--line2)}
.wsdot{width:8px;height:8px;border-radius:50%;background:var(--faint);flex:0 0 auto}
.wsdot.live{background:var(--ok);animation:pulse 1.4s infinite}.wsdot.idle{background:var(--dim)}.wsdot.gone{background:var(--bad)}
.wsmeta{flex:1;min-width:0}
.wsname{font:600 13px/1.2 var(--body);color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wsitem.active .wsname{color:var(--amber-hi)}
.wspath{font:400 10.5px/1.3 var(--mono);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wsstat{font:500 9px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--faint);flex:0 0 auto}
.wsrm{background:transparent;border:0;color:var(--faint);cursor:pointer;font-size:14px;flex:0 0 auto;opacity:0}
.wsitem:hover .wsrm{opacity:1}.wsrm:hover{color:var(--bad)}
.railft{padding:12px;border-top:1px solid var(--line)}
.wsadd{width:100%;background:var(--panel2);border:1px dashed var(--line2);border-radius:0;color:var(--dim);padding:11px;font:600 10px/1 var(--body);letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.wsadd:hover{color:var(--amber);border-color:var(--amber)}
main{flex:1 1 auto;display:grid;grid-template-columns:1.4fr 1fr 1fr;grid-auto-rows:1fr;gap:1px;background:var(--line);min-height:0;padding:1px}
.tile{background:var(--panel);display:flex;flex-direction:column;min-height:0;overflow:hidden}
.tile.orch{grid-row:span 2}
.thead{padding:10px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:8px;flex:0 0 auto}
.thead-r{display:inline-flex;align-items:center;gap:11px}
.tname{font:400 11px/1 var(--disp);letter-spacing:.1em;text-transform:uppercase}
.tagent{font:500 10px/1 var(--mono);color:var(--faint)}
/* D12 context gauge (fuel gauge per seat) */
.gauge{display:inline-flex;align-items:center;gap:5px;cursor:pointer}
.gauge:hover .gbar{outline:1px solid var(--line2)}
.gbar{width:34px;height:6px;border-radius:0;background:var(--line2);overflow:hidden}
.gfill{display:block;height:100%;border-radius:0;background:var(--ok);transition:width .4s}
.gpct{font:600 9.5px/1 var(--mono);color:var(--faint);min-width:26px;text-align:right}
.gauge.advisory .gfill{background:var(--amber)}.gauge.advisory .gpct{color:var(--amber)}
.gauge.high .gfill{background:var(--bad)}.gauge.high .gpct{color:var(--bad)}
.tstatus{font-size:12px;color:var(--dim);padding:7px 14px;border-bottom:1px solid var(--line);flex:0 0 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tstatus b{color:var(--amber);font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.1em;font-family:var(--mono)}
.feed{flex:1 1 auto;overflow-y:auto;padding:9px 15px;font-size:calc(13.5px * var(--tscale,1));display:flex;flex-direction:column;gap:4px}
.feed.eng{font-family:var(--mono);font-size:calc(12px * var(--tscale,1));line-height:1.5;color:var(--dim);white-space:pre-wrap;word-break:break-all;gap:1px}
.ev.think{color:var(--faint);font-style:italic}
.ev.handoff{color:var(--ok);font-size:.92em;padding-top:2px}
.live .ev{opacity:.92}
/* subtle live cursor (Adam: the bright blink got annoying) — a soft dim
   dot that breathes slowly, not a hard amber block */
.livecursor{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--faint);vertical-align:middle;margin-left:5px;animation:breathe 1.8s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:.25}50%{opacity:.7}}
.ev{color:var(--fg)}.ev.tool{color:var(--amber-hi)}.ev.result{color:var(--ok)}
.ev.system,.ev.other{color:var(--faint)}.ev.stderr{color:var(--bad)}.ev.meta{color:var(--dim);border-top:1px dashed var(--line2);padding-top:4px;margin-top:3px;font-family:var(--mono);font-weight:600;font-size:.8em;line-height:1.4;letter-spacing:.04em}
/* 2c-b merged timeline (Adam, 2026-07-26): conversation lines INSIDE the
   orchestrator's terminal feed — your input echoes into the flow, the
   orchestrator's replies and engine acks read as highlighted lines, nothing
   masked. */
.fmsg{line-height:1.6;color:var(--fg);white-space:pre-wrap}
.fmsg.op{background:rgba(255,255,255,.05);padding:6px 10px;margin:2px 0}
.fmsg.op .fwho{color:var(--amber);font:600 .78em var(--mono);letter-spacing:.14em;text-transform:uppercase;margin-right:.5em}
.fmsg.eng{color:var(--dim);font-size:.92em}
.fmsg.orch{color:var(--alu)}
/* 2c live stream (PDR live-seat-readout): agent text flows in full (pre-wrap);
   fold lines note dropped output honestly; a FAILED call shows its evidence */
.ev.text{white-space:pre-wrap}
.ev.fold{color:var(--faint);font-style:italic;font-size:.9em}
.ev.errtail{color:var(--bad);font-family:var(--mono);font-size:.86em;white-space:pre-wrap;border-left:2px solid var(--bad);padding-left:8px}
.idlechip{font:500 10px/1 var(--mono);letter-spacing:.04em;color:var(--faint);white-space:nowrap}
.turnsep{font:500 9px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--faint);padding:6px 0 2px;border-top:1px solid var(--line)}
.idle{color:var(--faint);font-style:italic;padding:4px 0}
/* first-run starter chips (W0): prefill the input, never auto-send */
.chips{display:flex;gap:8px;flex-wrap:wrap;padding:6px 0 2px}
.chip{background:transparent;border:1px solid var(--line2);border-radius:0;color:var(--dim);padding:7px 13px;font:500 12px/1 var(--body);cursor:pointer}
.chip:hover{color:var(--amber);border-color:var(--amber)}
/* orchestrator chat */
.chat{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
.chatlog{flex:1 1 auto;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:11px;font-family:var(--mono);font-size:calc(13px * var(--tscale,1))}
/* terminal feel: agent text is plain (+ slightly dimmed to differentiate);
   the USER's prompt sits in a subtle lighter box (Adam, Claude Code style) */
.msg{line-height:1.6;color:var(--fg);white-space:pre-wrap}
.msg.operator{background:rgba(255,255,255,.05);border-radius:0;padding:8px 12px}
.msg.orchestrator{color:var(--alu)}
/* 2d: the mechanical ENGINE voice — a third speaker, visibly machine, never
   the orchestrator's words. And a failed send stays visible, flagged. */
.msg.engine{color:var(--dim);font-size:.92em}
.msg.engine .who{color:var(--faint)}
.msg.failed{border:1px solid rgba(228,97,77,.45)}
.msg .nd{color:var(--bad);font:600 10px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;margin-left:.7em;white-space:nowrap}
.msg .who{font-family:var(--mono);font-weight:600;font-size:.78em;letter-spacing:.14em;text-transform:uppercase;margin-right:.7em;user-select:none}
.msg.operator .who{color:var(--amber)}
.msg.orchestrator .who{color:var(--alu)}
.who.bolt{margin-right:.55em;display:inline-flex;align-items:center;vertical-align:middle}
.wbolt{height:1em;width:auto;fill:var(--amber)}
.orchwork{color:var(--faint);font-size:.86em;font-style:italic;display:flex;flex-wrap:wrap;align-items:center;gap:.55em;padding-top:2px}
.orchwork .wl{opacity:.85}
.chatin{flex:0 0 auto;display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--line)}
.chatin input{flex:1;background:var(--panel2);border:1px solid var(--line2);border-radius:0;color:var(--fg);padding:11px 13px;font-size:calc(15px * var(--tscale,1));font-family:var(--body);outline:none}
.chatin input:focus{border-color:var(--amber)}
.chatin button{background:var(--amber);color:#151109;border:0;border-radius:0;padding:0 18px;font:600 13px/1 var(--body);cursor:pointer}
/* gate panel — lives ABOVE the orchestrator chat input (Adam) */
.gatepanel{flex:0 0 auto;margin:0 16px 4px;padding:11px 14px;border:1px solid rgba(226,163,60,.4);background:rgba(226,163,60,.07);border-radius:0}
.gatepanel .gp-head{font-family:var(--mono);font-weight:600;font-size:calc(12.5px * var(--tscale,1));color:var(--fg)}
.gatepanel .gp-head b{color:var(--amber)}
.gatepanel .gp-sub{color:var(--dim);font-size:calc(11.5px * var(--tscale,1));margin-top:4px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.gatepanel .gp-v{color:var(--ok);font-family:var(--mono);font-weight:600;font-size:.94em}
.gatepanel .gp-v.no{color:var(--faint)}
.gatepanel .gp-deploy{color:var(--warn)}
.gatepanel .gp-hint{color:var(--faint);font-size:calc(11px * var(--tscale,1));margin-top:6px}
.gatepanel .gp-hint b{color:var(--amber);font-family:var(--mono)}
.gatepanel .gp-err{color:var(--bad);font-size:calc(11.5px * var(--tscale,1));margin-top:5px}
/* Native seat access (PDR native-seat-access): the ⌨ door — a real PTY in
   the pane. The tile keeps its head; the body becomes the agent's own TUI. */
.keysbtn{background:transparent;border:1px solid var(--line2);border-radius:0;color:var(--dim);font:600 10px/1 var(--mono);letter-spacing:.04em;padding:5px 8px;cursor:pointer;flex:0 0 auto}
.keysbtn:hover{color:var(--amber);border-color:var(--amber)}
.keysbtn.on{background:var(--amber);color:#151109;border-color:var(--amber)}
.ttyhost{flex:1 1 auto;min-height:0;background:#0b0e14;padding:4px 6px;overflow:hidden;display:flex}
.ttywrap{flex:1;min-width:0;min-height:0}
.ttywait{color:var(--faint);font:12px/1.6 var(--mono);padding:14px}
.xterm .xterm-viewport{background:transparent!important}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}
.dot.ok{background:var(--ok)}.dot.run{background:var(--amber);animation:pulse 1.2s infinite}.dot.bad{background:var(--bad)}.dot.idle{background:var(--faint)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@media (max-width:820px){main{grid-template-columns:1fr 1fr;overflow-y:auto}.tile.orch{grid-row:span 1;grid-column:span 2}}
`;

const VIEW_JS = `
const TOKEN=new URLSearchParams(location.search).get("token");
// T7-1: the active workspace rides the URL so every API poll targets THIS team
// (the server routes read ?project=); switching workspaces is a reload to a
// different ?project=. Empty = the server's single attached project (back-compat).
const PROJECT=new URLSearchParams(location.search).get("project")||"";
function tq(){return "token="+TOKEN+(PROJECT?"&project="+encodeURIComponent(PROJECT):"");}
function api(p){return p+(p.indexOf("?")>=0?"&":"?")+tq();}
let lens=new URLSearchParams(location.search).get("lens")||localStorage.getItem("crate.lens")||"narrated";
let WORKSPACES=[];
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
// ── W3: in-app dialogs (audit I2) — replace native alert/confirm/prompt,
// which look foreign and BLOCK the poll loop while open. ──
function uiDialog(html){const d=document.createElement("div");d.className="uidlg";d.innerHTML='<div class="box">'+html+'</div>';document.body.appendChild(d);return d;}
function uiNotice(msg){return new Promise(res=>{const d=uiDialog('<div class="m">'+esc(msg)+'</div><div class="btns"><button class="pri" id="uidok">OK</button></div>');const done=()=>{d.remove();res();};d.querySelector("#uidok").onclick=done;d.addEventListener("click",e=>{if(e.target===d)done();});});}
function uiConfirm(msg,okLabel,danger){return new Promise(res=>{const d=uiDialog('<div class="m">'+esc(msg)+'</div><div class="btns"><button id="uidc">Cancel</button><button class="'+(danger?"danger":"pri")+'" id="uidok">'+esc(okLabel||"OK")+'</button></div>');const done=v=>{d.remove();res(v);};d.querySelector("#uidok").onclick=()=>done(true);d.querySelector("#uidc").onclick=()=>done(false);d.addEventListener("click",e=>{if(e.target===d)done(false);});});}
// the compact folder picker (reuses the wizard's /api/fs/dirs jail)
function pickFolder(title){return new Promise(res=>{
  let cur="";
  const d=uiDialog('<h3>'+esc(title)+'</h3><div class="m mono" id="pkpath" style="font-size:11.5px;color:var(--faint)"></div>'
    +'<div class="pklist" id="pklist"></div>'
    +'<div class="btns"><button id="pkup">↑ Up</button><button id="pkc">Cancel</button><button class="pri" id="pku">Use this folder</button></div>');
  const done=v=>{d.remove();res(v);};
  d.querySelector("#pkc").onclick=()=>done(null);
  d.querySelector("#pku").onclick=()=>done(cur);
  d.addEventListener("click",e=>{if(e.target===d)done(null);});
  let parent=null;
  d.querySelector("#pkup").onclick=()=>{if(parent)go(parent);};
  async function go(p){
    try{
      const r=await fetch(api("/api/fs/dirs"+(p?"?path="+encodeURIComponent(p):"")),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json());
      if(r.error){d.querySelector("#pkpath").textContent=r.error;return;}
      cur=r.path;parent=r.parent||null;
      d.querySelector("#pkpath").textContent=r.path;
      d.querySelector("#pklist").innerHTML=(r.dirs||[]).map(x=>'<button class="pkrow" data-d="'+esc(x.name)+'"><span style="flex:1">'+esc(x.name)+'</span>'+(x.isRepo?'<span class="pktag">git</span>':'')+'</button>').join('')||'<div style="padding:14px 20px;color:var(--faint);font-size:12.5px">no folders in here</div>';
      d.querySelectorAll(".pkrow").forEach(b=>b.onclick=()=>go(cur+"/"+b.getAttribute("data-d")));
    }catch(e){/* keep the dialog usable */}
  }
  go("~/Projects");
})}
function dotClass(t){const last=t.turns&&t.turns[0];if(!last)return"idle";if(last.ok===null)return"run";return last.ok?"ok":"bad"}
let CHAT=[];
let GATES=[];
let PREVIEWS=[];
// ── Native seat access: TTY = the one open door (seat, xterm, SSE). The
// terminal DOM node lives OUTSIDE the 2s repaint: renderTile leaves a host
// div, mountTty re-appends the living terminal into it after every paint. ──
let TTY=null;
function b64enc(s){const b=new TextEncoder().encode(s);let x="";b.forEach(c=>x+=String.fromCharCode(c));return btoa(x);}
function b64dec(s){const raw=atob(s);const u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);return u;}
async function openTty(seat){
  if(TTY)await closeTty();
  TTY={seat:seat,waiting:true};
  refresh();
  tryStartTty();
}
async function tryStartTty(){
  if(!TTY)return;
  const seat=TTY.seat;
  const r=await fetch(api("/api/tty/start"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({seat,cols:120,rows:32})}).then(r=>r.json()).catch(()=>null);
  if(!TTY||TTY.seat!==seat)return; // door changed hands while we waited
  if(!r){TTY=null;refresh();await uiNotice("Could not reach the engine — the keys stay with the team.");return;}
  if(r.busy){TTY.waiting=true;mountTty();setTimeout(tryStartTty,2000);return;} // mid-turn: keys arrive when it finishes
  if(r.error){TTY=null;refresh();await uiNotice(r.error);return;}
  attachTty(seat);
}
function attachTty(seat){
  TTY.waiting=false;
  const wrap=document.createElement("div");wrap.className="ttywrap";
  const term=new Terminal({fontFamily:"'JetBrains Mono',ui-monospace,Menlo,monospace",fontSize:12.5,cursorBlink:true,scrollback:5000,
    theme:{background:"#0b0e14",foreground:"#f1f3f6",cursor:"#e2a33c",selectionBackground:"#32405a"}});
  const fit=new FitAddon.FitAddon();term.loadAddon(fit);
  term.open(wrap);
  TTY.wrap=wrap;TTY.term=term;
  TTY.fit=()=>{try{fit.fit();
    fetch(api("/api/tty/resize"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({seat,cols:term.cols,rows:term.rows})}).catch(()=>{});
  }catch(e){}};
  // keystrokes → the PTY (8ms micro-batch so paste isn't a POST per char)
  let buf="",t=null;
  term.onData(d=>{buf+=d;if(!t)t=setTimeout(()=>{const s=buf;buf="";t=null;
    fetch(api("/api/tty/input"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({seat,data:b64enc(s)})}).catch(()=>{});
  },8);});
  const es=new EventSource(api("/api/tty/stream")+"&seat="+encodeURIComponent(seat));
  es.onmessage=e=>{let d;try{d=JSON.parse(e.data);}catch(err){return;}
    if(d.replay!==undefined){term.reset();term.write(b64dec(d.replay));return;} // (re)connect replaces, never duplicates
    if(d.d)term.write(b64dec(d.d));
    if(d.exit!==undefined){es.close();teardownTty();refresh();uiNotice("The agent session ended (exit "+d.exit+") — keys returned, deliveries resume.");}
  };
  TTY.es=es;
  refresh(); // repaint puts the host div in place; mountTty attaches the terminal
}
function teardownTty(){
  if(!TTY)return;
  try{TTY.es&&TTY.es.close();}catch(e){}
  try{TTY.ro&&TTY.ro.disconnect();}catch(e){}
  try{TTY.term&&TTY.term.dispose();}catch(e){}
  TTY=null;
}
async function closeTty(){
  if(!TTY)return;
  const seat=TTY.seat;
  teardownTty();
  await fetch(api("/api/tty/stop"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({seat})}).catch(()=>{});
  refresh();
}
function mountTty(){
  if(!TTY)return;
  const host=document.querySelector('[data-ttyhost="'+TTY.seat+'"]');
  if(!host)return;
  if(TTY.waiting){host.innerHTML='<div class="ttywait">seat is mid-turn — the keys are yours the moment it finishes…</div>';return;}
  if(TTY.wrap&&TTY.wrap.parentElement!==host){
    host.innerHTML="";host.appendChild(TTY.wrap);
    if(TTY.ro)TTY.ro.disconnect();
    TTY.ro=new ResizeObserver(()=>{if(TTY&&TTY.fit)TTY.fit();});
    TTY.ro.observe(host);
    TTY.fit&&TTY.fit();TTY.term&&TTY.term.focus();
  }
}
// 2d durable echo: messages the operator just sent, rendered instantly and
// kept until the durable copy arrives (pending) or the send provably failed
// (failed — stays visible, flagged; vanishing is never an outcome).
let PENDING=[];
// ── 2c LIVE seat readout: the SSE stream fills per-seat feed buffers; the
// 2s poll stays underneath as the fallback floor (push shortens the wait,
// polling carries the loop). Buffers survive the poll's grid repaint — the
// buffer is the truth, the DOM is a view of it. ──
let FEEDS={},SSELIVE=false,ES=null,PAINTQ={};
const FEEDCAP=240;
function feedArr(seat){return FEEDS[seat]||(FEEDS[seat]=[]);}
function pushItem(ev){
  const arr=feedArr(ev.seat);
  const last=arr[arr.length-1];
  if(ev.k==="td"){ // text deltas accumulate into one flowing block
    if(last&&last.k==="tstream")last.t+=ev.t;
    else arr.push({k:"tstream",t:ev.t,ms:Date.now()});
  }else if(ev.k==="text"&&last&&last.k==="tstream"){
    last.k="text";last.t=ev.t; // the final text replaces its own delta stream
  }else arr.push({k:ev.k,t:ev.t,p:ev.p,ok:ev.ok,ms:Date.now()});
  if(arr.length>FEEDCAP)arr.splice(0,arr.length-FEEDCAP);
}
// backlog items carry no wall-clock — anchor each to its turn seam so the
// merged orchestrator timeline can interleave conversation lines between
// turn blocks honestly (live items use real arrival time instead).
function stampBacklogMs(){
  Object.keys(FEEDS).forEach(seat=>{
    let cur=0;
    FEEDS[seat].forEach((it,i)=>{
      if(it.k==="seam"){const p=Date.parse(it.t);if(!isNaN(p))cur=p;}
      it.ms=cur+i;
    });
  });
}
function hhmmss(iso){const d=new Date(iso);return isNaN(d.getTime())?String(iso).slice(11,19):d.toLocaleTimeString([],{hour12:false});}
function feedItemHtml(it,seat){
  if(it.k==="seam")return '<div class="turnsep">turn · '+esc(hhmmss(it.t))+'</div>';
  if(it.k==="tool")return '<div class="ev tool">'+esc(lens==="engineer"?it.t:(it.p||it.t))+'</div>';
  if(it.k==="think")return '<div class="ev think">'+esc(it.t)+'</div>';
  if(it.k==="fold")return '<div class="ev fold">'+esc(it.t)+'</div>';
  if(it.k==="errtail")return '<div class="ev errtail">'+esc(it.t)+'</div>';
  if(it.k==="stderr")return '<div class="ev stderr">'+esc(it.t)+'</div>';
  if(it.k==="meta")return (it.ok&&seat!=="orchestrator"?'<div class="ev handoff">▸ delivered to orchestrator</div>':'')+'<div class="ev meta">'+esc(it.t)+'</div>';
  return '<div class="ev text">'+esc(it.t)+'</div>'; // text / tstream
}
function feedHtml(seat){return feedArr(seat).map(it=>feedItemHtml(it,seat)).join("");}
// ── 2c-b: the orchestrator's MERGED timeline — its real stream and the
// operator conversation in one chronological terminal feed (Adam: the chat
// view was "masking the real thing"). Stream items sort by arrival (live)
// or turn-seam anchor (backlog); conversation lines by their mirror stamp.
function chatFeedLine(m){
  if(m.from==="operator")return '<div class="fmsg op'+(m.status==="failed"?" failed":"")+'">❯ <span class="fwho">you</span>'+esc(m.text)
    +(m.status==="failed"?'<span class="nd">✗ not delivered</span>':'')+'</div>';
  if(m.from==="engine")return '<div class="fmsg eng">⚙ engine — '+esc(m.text)+'</div>';
  return '<div class="fmsg orch">'+whoLabel("orchestrator")+esc(m.text)+'</div>';
}
function orchFeedHtml(){
  const items=[];
  feedArr("orchestrator").forEach((it,i)=>items.push({ms:it.ms||0,o:i,html:feedItemHtml(it,"orchestrator")}));
  const base=items.length;
  CHAT.concat(PENDING).forEach((m,i)=>{
    const ms=Date.parse(m.at);
    items.push({ms:isNaN(ms)?Number.MAX_SAFE_INTEGER:ms,o:base+i,html:chatFeedLine(m)});
  });
  if(!items.length)return chatLogHtml(); // first-run greeting + starter chips
  items.sort((a,b)=>a.ms-b.ms||a.o-b.o);
  return items.map(x=>x.html).join("");
}
function paintFeed(seat){
  if(PAINTQ[seat])return;PAINTQ[seat]=true;
  requestAnimationFrame(()=>{PAINTQ[seat]=false;
    if(!SSELIVE)return;
    if(seat==="orchestrator"){
      const cl=document.getElementById("chatlog");
      if(cl){cl.innerHTML=orchFeedHtml();cl.scrollTop=cl.scrollHeight;}
      return;
    }
    const el=document.querySelector('.tile[data-seat="'+seat+'"] .feed');
    if(!el)return;
    el.innerHTML=feedHtml(seat);el.scrollTop=el.scrollHeight;
  });
}
function startStream(){
  try{ES=new EventSource(api("/api/stream"));}catch(e){return;} // no SSE → poll floor only
  ES.onopen=()=>{SSELIVE=true;};
  ES.onerror=()=>{SSELIVE=false;}; // EventSource auto-reconnects; the poll floor carries
  ES.onmessage=e=>{
    let d;try{d=JSON.parse(e.data);}catch(err){return;}
    if(d.backlog){ // connect/reconnect: REPLACE the buffers — never duplicate
      FEEDS={};d.backlog.forEach(pushItem);
      stampBacklogMs();
      SSELIVE=true;
      Object.keys(FEEDS).forEach(paintFeed);
      return;
    }
    pushItem(d);paintFeed(d.seat);
  };
}
let pvView=localStorage.getItem("crate.pvview")||"desktop";
const BOLT='<svg class="wbolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2 4.8 13.4h5L8.6 22l10.6-13.2h-6.2L13.2 2z"/></svg>';
// racing-inspired working words (Adam) — rotate like Claude Code's spinner
const RACING=["Revving","Shifting","Drafting","Redlining","Launching","Boosting","Cornering","Downshifting","Throttling","Tuning","Pitting","Gunning","Flooring","Hustling","Chasing the apex","Warming the tires","Hitting the gas"];
function fmtElapsed(ms){const s=Math.max(0,Math.floor(ms/1000));const m=Math.floor(s/60);return m>0?m+"m "+(s%60)+"s":s+"s";}
function fmtTok(n){return n>=1000?(n/1000).toFixed(1).replace(/\\.0$/,"")+"k":String(n);}
function racingText(start,tok){
  const s=start||Date.now();
  const el=Date.now()-s;
  // ONE word per task (Adam) — derived from the turn's start, stable for the
  // whole turn; only the elapsed/token readout ticks.
  const word=RACING[Math.floor(s/1000)%RACING.length];
  const t=tok?" · ↓ "+fmtTok(tok)+" tok":"";
  return word+"… <span class=\\"rmeta\\">("+fmtElapsed(el)+t+")</span>";
}
function workingSpan(run){
  return '<span class="working" data-start="'+(run.startedAtMs||Date.now())+'" data-tok="'+(run.liveTokens||0)+'">'
    +'<span class="wd"></span><span class="rtext">'+racingText(run.startedAtMs,run.liveTokens)+'</span></span>';
}
function gaugeHtml(g,seat){
  if(!g)return"";
  const pct=Math.round(g.pct*100);
  const hint=g.band==="ok"?"context "+pct+"% — click to refresh (fresh session)":"context "+pct+"% — "+(g.band==="advisory"?"past 40%, consider a refresh":"high — refresh recommended")+" · click to refresh";
  return '<span class="gauge '+g.band+'" data-seat="'+seat+'" title="'+hint+' ('+(g.tokens/1000).toFixed(0)+'k / '+(g.window/1000).toFixed(0)+'k tokens)">'
    +'<span class="gbar"><span class="gfill" style="width:'+Math.max(3,pct)+'%"></span></span>'
    +'<span class="gpct">'+pct+'%</span></span>';
}
function idleChip(s){
  // 2c: quiet must never read as dead — an idle seat says since when
  const last=s.turns&&s.turns[0];
  if(!last||last.ok===null||!last.startedAtMs)return"";
  const end=new Date(last.startedAtMs+(last.durationMs||0));
  return '<span class="idlechip">idle since '+end.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",hour12:false})+'</span>';
}
function tileHead(s){
  const run=s.turns&&s.turns.find(t=>t.ok===null);
  const right=run?workingSpan(run)
    :idleChip(s)+'<span class="tagent">'+esc(s.agent)+(s.model?"/"+esc(s.model.split("/").pop()):"")+'</span>';
  // Native seat access: ⌨ takes the keys — the seat's REAL agent TUI, live
  // in this pane, inside the wall. Lit amber while the human holds them.
  // Racing language (Adam's pick, 2026-08-10) — matches the cockpit's
  // revving/drafting spinner words. Plain text, never a glyph (U+2328
  // rendered as a broken "=" in the pane font).
  const keysOn=TTY&&TTY.seat===s.seat;
  const keys='<button class="keysbtn'+(keysOn?" on":"")+'" data-keys="'+s.seat+'" title="'
    +(keysOn?'Hand back the wheel — the engine resumes deliveries to this seat':'Take the wheel — open the real '+esc(s.agent)+' session in this pane; the team holds its deliveries while you drive')+'">'
    +(keysOn?'YOUR WHEEL · hand back':'TAKE THE WHEEL')+'</button>';
  return '<div class="thead"><span class="tname"><span class="dot '+dotClass(s)+'"></span>'+esc(s.title)+'</span>'
    +'<span class="thead-r">'+gaugeHtml(s.gauge,s.seat)+right+keys+'</span></div>';
}
function tickWorking(){
  if(document.body.classList.contains("dead"))return; // offline — no fake "working" ticks
  document.querySelectorAll(".working[data-start]").forEach(w=>{
    const rt=w.querySelector(".rtext");if(rt)rt.innerHTML=racingText(+w.dataset.start,+w.dataset.tok);
  });
}
function whoLabel(from){
  if(from==="operator")return '<span class="who">you</span>';
  if(from==="engine")return '<span class="who">⚙ engine</span>'; // 2d: the mechanical voice
  return '<span class="who bolt">'+BOLT+'</span>';
}
function chatLogHtml(){
  const items=CHAT.map(m=>'<div class="msg '+esc(m.from)+'">'+whoLabel(m.from)+esc(m.text)+'</div>')
    .concat(PENDING.map(m=>'<div class="msg operator'+(m.status==="failed"?" failed":"")+'">'+whoLabel("operator")+esc(m.text)
      +(m.status==="failed"?'<span class="nd">✗ not delivered</span>':'')+'</div>'));
  if(items.length)return items.join("");
  // W0 (audit I1): the first-run cockpit greets — what I do, what gates mean,
  // and starter chips that PREFILL the input (never auto-send).
  return '<div class="msg orchestrator">'+whoLabel("orchestrator")
    +'I\\'m your Orchestrator — the team lead you talk to. Say what you\\'d like built or fixed: I plan it, put the Coder, Reviewer, Designer, and QA on it, and hold at a merge gate for your go. Try one:</div>'
    +'<div class="chips">'
    +'<button class="chip" data-fill="Build me a small feature: ">Build a small feature</button>'
    +'<button class="chip" data-fill="Fix this bug: ">Fix a bug</button>'
    +'<button class="chip" data-fill="Audit this repo and report the top improvements you would make. Hold before changing anything.">Audit the repo</button>'
    +'</div>';
}
function gatePanelHtml(){
  if(!GATES.length)return"";
  const g=GATES[0];
  return '<div class="gatepanel" data-task="'+esc(g.task)+'">'
    +'<div class="gp-head">Ready to merge <b>'+esc(g.branch)+'</b> → '+esc(g.deploysTo)+'</div>'
    +'<div class="gp-sub"><span class="gp-v '+(g.reviewOk?"":"no")+'">review '+(g.reviewOk?"✓":"·")+'</span>'
    +'<span class="gp-v '+(g.qaOk?"":"no")+'">QA '+(g.qaOk?"✓":"·")+'</span>'
    +'<span class="gp-deploy">deploys to production</span></div>'
    +'<div class="gp-hint">Type <b>merge go</b> below to release.</div>'
    +'<div class="gp-err" id="gperr" style="display:none"></div></div>';
}
function renderTile(s){
  // Native seat access: while the human holds this seat's keys, the pane IS
  // the agent's terminal (the head stays; the living xterm node re-mounts
  // after each repaint via mountTty).
  if(TTY&&TTY.seat===s.seat){
    return '<div class="tile'+(s.seat==="orchestrator"?" orch":"")+'" data-seat="'+s.seat+'">'+tileHead(s)
      +'<div class="ttyhost" data-ttyhost="'+s.seat+'"></div></div>';
  }
  if(s.seat==="orchestrator"){
    const ph=GATES.length?'Type merge go to release, or message the orchestrator…':'Message the orchestrator…';
    // 2c-b (Adam): stream live → the MERGED timeline (real readout + the
    // conversation, one feed). SSE down → the legacy chat view, exactly as
    // before, with the last-action line so the pane still visibly thinks.
    let body;
    if(SSELIVE&&(feedArr("orchestrator").length||CHAT.length||PENDING.length)){
      body=orchFeedHtml();
    }else{
      const running=s.turns&&s.turns.find(t=>t.ok===null);
      const lastAction=running&&running.live&&running.live.length?running.live[running.live.length-1]:"";
      body=chatLogHtml()+(running?'<div class="orchwork">'+whoLabel("orchestrator")
        +(lastAction?'<span class="wl">'+esc(lastAction)+'</span>':'')
        +workingSpan(running)+'</div>':'');
    }
    return '<div class="tile orch" data-seat="orchestrator" style="--tscale:'+(SCALES.orchestrator||1)+'">'+tileHead(s)
      +'<div class="chat"><div class="chatlog" id="chatlog">'+body+'</div>'
      +gatePanelHtml()
      +'<div class="chatin"><input id="chatbox" placeholder="'+ph+'" autocomplete="off"><button id="chatsend">Send</button></div></div></div>';
  }
  const status=s.status?'<div class="tstatus"><b>'+esc(s.status)+'</b> · '+esc(s.lastActivity||"")+'</div>':'';
  let feed;
  // 2c: with the stream live, the pane renders its buffer — continuous
  // scroll across turns, the agent's own words + beats, ms lag. The legacy
  // poll rendering below is the SSE-down fallback (exactly today's page).
  if(SSELIVE&&FEEDS[s.seat]&&FEEDS[s.seat].length){feed=feedHtml(s.seat)}
  else if(!s.turns.length){feed='<div class="idle">idle — no turns yet</div>'}
  else{feed=s.turns.map((t,i)=>{
    const sep=i===0?'':'<div class="turnsep">turn · '+esc(t.startedAt.replace("T"," ").replace(/\\..*/,""))+'</div>';
    const metaEv=t.events.find(e=>e.kind==="meta");
    const handoff=(t.ok===true&&s.seat!=="orchestrator")?'<div class="ev handoff">▸ delivered to orchestrator</div>':'';
    // dedupe consecutive identical lines (message_end + turn_end repeat text)
    const dedupe=arr=>arr.filter((l,i)=>l!==arr[i-1]);
    let evs;
    if(lens==="engineer"){
      // clean terminal stream: real beats only (tool/text/result/stderr) —
      // NO thinking spam, NO raw JSON, NO doubles
      const keep=t.events.filter(e=>e.kind==="tool"||e.kind==="text"||e.kind==="result"||e.kind==="stderr");
      evs=dedupe(keep.map(e=>({k:e.kind,t:e.narrated})).map(x=>x.k+"\\x00"+x.t))
        .map(s2=>{const[k,tx]=s2.split("\\x00");return '<div class="ev '+k+'">'+esc(tx)+'</div>';}).join("")
        +handoff;
    }else if(t.ok===null){
      // RUNNING (narrated): the live tail of real actions; the header racing
      // spinner is the working indicator (no thinking… lines, no cursor)
      const lines=(t.live||[]);
      evs='<div class="live">'+dedupe(lines).map(l=>'<div class="ev tool">'+esc(l)+'</div>').join("")+'</div>';
    }else{
      evs=dedupe(t.digest||[]).map(l=>'<div class="ev text">'+esc(l)+'</div>').join("")
        +handoff
        +(metaEv?'<div class="ev meta">'+esc(metaEv.narrated)+'</div>':'');
    }
    return sep+evs;
  }).join("")}
  return '<div class="tile" data-seat="'+s.seat+'" style="--tscale:'+(SCALES[s.seat]||1)+'">'+tileHead(s)+status+'<div class="feed '+(lens==="engineer"?"eng":"")+'">'+feed+'</div></div>';
}
let POLLFAILS=0;
async function refresh(){
  try{
    const [tr,gr,cr,pv,lp]=await Promise.all([
      fetch(api("/api/team"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()),
      fetch(api("/api/gates"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()),
      fetch(api("/api/chat"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()),
      fetch(api("/api/preview"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()),
      fetch(api("/api/loop"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()),
    ]);
    CHAT=cr.messages||[];GATES=gr.gates||[];SEATSVIEW=tr.seats||[];PREVIEWS=pv.previews||[];
    renderLoopChip(lp&&lp.narration);
    syncPreviewTab();
    if(document.getElementById("pvoverlay").classList.contains("open"))renderPreview();
    if(document.getElementById("ctxoverlay").classList.contains("open"))renderConsole();
    // preserve in-progress chat typing across the re-render
    const cb=document.getElementById("chatbox");const chatVal=cb?cb.value:"";const chatFocused=document.activeElement===cb;
    document.getElementById("grid").innerHTML=tr.seats.map(renderTile).join("");
    wire();
    const cb2=document.getElementById("chatbox");if(cb2){cb2.value=chatVal;if(chatFocused)cb2.focus();}
    mountTty(); // native seat access: re-seat the living terminal after the repaint
    document.querySelectorAll(".feed").forEach(f=>{if(!f.hasAttribute("data-ttyhost"))f.scrollTop=f.scrollHeight;});
    const cl=document.getElementById("chatlog");if(cl)cl.scrollTop=cl.scrollHeight;
    POLLFAILS=0;document.body.classList.remove("dead");
  }catch(e){
    // PHASE-B #1: a dead server must LOOK dead. Two consecutive failed polls
    // (~4s) flips the offline banner; the stale page greys out underneath.
    if(++POLLFAILS>=2)document.body.classList.add("dead");
  }
}
// PHASE-B #2: the masthead loop chip — narrates round + state from events.log.
function agoText(at){
  if(!at)return"";const ms=Date.now()-new Date(at).getTime();if(!(ms>=0))return"";
  const m=Math.floor(ms/60000);return m<1?"just now":m<60?m+"m ago":Math.floor(m/60)+"h ago";
}
function renderLoopChip(n){
  const c=document.getElementById("loopchip");if(!c)return;
  if(!n){c.hidden=true;return;}
  const active=n.state==="implementing"||n.state==="code_ready";
  c.classList.toggle("calm",!active);
  const ago=agoText(n.at);
  c.innerHTML='<span class="ld"></span>'+esc(n.text)+(ago?'<span class="lm">· '+ago+'</span>':'');
  c.hidden=false;
}
function gateErr(msg){const e=document.getElementById("gperr");if(e){e.textContent=msg;e.style.display="";}}
async function sendChat(){
  const box=document.getElementById("chatbox");if(!box)return;const text=box.value.trim();if(!text)return;
  box.value="";
  // 2d durable echo: the line appears the instant it's sent (pending), the
  // durable server-side copy replaces it on refresh, and a failed send stays
  // visible flagged red — vanishing is never an outcome.
  const entry={at:new Date().toISOString(),text,status:"pending"};
  PENDING.push(entry);
  const cl=document.getElementById("chatlog");if(cl){cl.innerHTML=SSELIVE?orchFeedHtml():chatLogHtml();cl.scrollTop=cl.scrollHeight;}
  // "merge go" typed in the chat IS the gate release (Adam: one input only)
  if(text.toLowerCase()==="merge go"&&GATES.length){
    const task=GATES[0].task;
    const r=await fetch(api("/api/gates/release"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({task,phrase:"merge go"})}).then(r=>r.json()).catch(()=>null);
    if(!r||!r.ok){gateErr(((r&&r.out)||"release failed").split("\\n")[0]);}
    // any server response means releaseGate wrote the durable echo before
    // acting — drop the optimistic copy and render the real one. No response
    // at all (server unreachable) → the echo stays, flagged.
    if(r)PENDING.splice(PENDING.indexOf(entry),1);
    else entry.status="failed";
    await refresh();return;
  }
  const r=await fetch(api("/api/chat"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({text})}).then(r=>r.json()).catch(()=>null);
  if(!r||!r.ok){entry.status="failed";}
  else PENDING.splice(PENDING.indexOf(entry),1);
  await refresh();
}
let SEATSVIEW=[];
async function refreshSeat(seat){
  const r=await fetch(api("/api/context/refresh"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({seat})}).then(r=>r.json());
  if(!r.ok){
    if(await uiConfirm((r.reason||"refresh refused")+"\\n\\nForce a refresh anyway?","Force refresh",true)){
      await fetch(api("/api/context/refresh"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({seat,force:true})});
    }
  }
  refresh();renderConsole();
}
// ── Preview surface (T5) ──
function fullUrl(p){const u=p.url.replace(/\\/$/,"");const r=p.route&&p.route!=="/"?p.route:(p.route==="/"?"/":"");return u+(r||"");}
function renderPreview(){
  const w=document.getElementById("pvwrap");if(!w||!PREVIEWS.length)return;
  const p=PREVIEWS[0];const src=fullUrl(p);
  const frameCls=pvView==="mobile"?"mobile":"desktop";
  w.innerHTML='<div class="pvhead"><h3>Preview</h3><span class="pvurl">'+esc(p.label||p.route)+' · '+esc(src)+'</span><span class="pvsp"></span>'
    +'<div class="vptoggle"><button id="pvd" class="'+(pvView==="desktop"?"on":"")+'">Desktop</button><button id="pvm" class="'+(pvView==="mobile"?"on":"")+'">Mobile</button></div></div>'
    +'<div class="pvstage"><iframe class="pvframe '+frameCls+'" src="'+esc(src)+'"></iframe></div>'
    +'<div class="pvfoot"><button class="pvopen" id="pvopen">Open in a window</button>'
    +'<input class="pvnote" id="pvnote" placeholder="Notes if changes are needed (optional)…">'
    +'<button class="pvbad" id="pvbad">Needs changes</button><button class="pvok" id="pvok">Looks good ✓</button></div>';
  // W3 (audit J1): the desktop scale fits the stage instead of a magic 0.62
  if(pvView==="desktop"){const st=w.querySelector(".pvstage"),f=w.querySelector(".pvframe");
    if(st&&f){const s=Math.min(1,Math.max(.3,(st.clientWidth-36)/1280));f.style.transform="scale("+s+")";f.style.transformOrigin="top center";}}
  document.getElementById("pvd").onclick=()=>{pvView="desktop";localStorage.setItem("crate.pvview","desktop");renderPreview();};
  document.getElementById("pvm").onclick=()=>{pvView="mobile";localStorage.setItem("crate.pvview","mobile");renderPreview();};
  document.getElementById("pvopen").onclick=()=>window.open(src,"_blank");
  document.getElementById("pvok").onclick=()=>resolvePreview(true);
  document.getElementById("pvbad").onclick=()=>resolvePreview(false,document.getElementById("pvnote").value);
}
async function resolvePreview(approve,note){
  await fetch(api("/api/preview/resolve"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({approve,note:note||""})});
  document.getElementById("pvoverlay").classList.remove("open");refresh();
}
function syncPreviewTab(){
  const b=document.getElementById("pvbtn");if(!b)return;
  if(PREVIEWS.length){b.classList.remove("hidden");b.classList.add("pending");}
  else{b.classList.add("hidden");b.classList.remove("pending");document.getElementById("pvoverlay").classList.remove("open");}
}
async function refreshTeam(){for(const s of SEATSVIEW){await fetch(api("/api/context/refresh"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({seat:s.seat,force:false})});}refresh();renderConsole();}
async function checkpointTeam(){const r=await fetch(api("/api/context/checkpoint"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:"{}"}).then(r=>r.json());await uiNotice(r.ok?"Checkpoint saved — team state snapshotted.":"Checkpoint: "+(r.out||"failed").split("\\n")[0]);}
function renderConsole(){
  const el=document.getElementById("console");if(!el)return;
  const rows=SEATSVIEW.map(s=>{
    const g=s.gauge;const pct=g?Math.round(g.pct*100):0;const band=g?g.band:"ok";
    return '<div class="crow '+band+'"><span class="cname">'+esc(s.title)+'</span>'
      +'<span class="cbar"><span class="cfill" style="width:'+Math.max(3,pct)+'%"></span></span>'
      +'<span class="cpc">'+pct+'%</span>'
      +'<button class="crefresh" data-seat="'+s.seat+'">refresh</button></div>';
  }).join("");
  el.innerHTML='<h3>Context Console</h3><div class="csub">Each seat\\'s session fullness. Refresh drops a session so its next turn re-orients from saved state — refused if the seat\\'s state is stale (lossless by law).</div>'
    +rows
    +'<div class="cactions"><button id="crefall">Refresh all</button><button id="cckpt">Checkpoint team</button></div>'
    +'<div class="cpolicy"><b>Advisory:</b> 40% (amber) · <b>Ceiling:</b> 85% (red). Auto-refresh at the ceiling is opt-in per rig (CONTEXT_AUTO_REFRESH). Gauges stay visible so you always see what the engine manages.</div>';
  el.querySelectorAll(".crefresh").forEach(b=>b.onclick=()=>refreshSeat(b.getAttribute("data-seat")));
  const ra=document.getElementById("crefall");if(ra)ra.onclick=refreshTeam;
  const ck=document.getElementById("cckpt");if(ck)ck.onclick=checkpointTeam;
}
function wire(){
  const send=document.getElementById("chatsend");if(send)send.onclick=sendChat;
  const box=document.getElementById("chatbox");if(box)box.onkeydown=e=>{if(e.key==="Enter")sendChat();};
  document.querySelectorAll(".gauge[data-seat]").forEach(g=>{g.onclick=()=>refreshSeat(g.getAttribute("data-seat"));});
  document.querySelectorAll(".chip[data-fill]").forEach(c=>{c.onclick=()=>{const b=document.getElementById("chatbox");if(b){b.value=c.getAttribute("data-fill");b.focus();}};});
  document.querySelectorAll(".keysbtn[data-keys]").forEach(b=>{b.onclick=()=>{
    const s=b.getAttribute("data-keys");
    if(TTY&&TTY.seat===s)closeTty();else openTty(s);
  };});
}
function setLens(l){lens=l;localStorage.setItem("crate.lens",l);
  document.getElementById("bn").classList.toggle("on",l==="narrated");
  document.getElementById("be").classList.toggle("on",l==="engineer");refresh();}
document.getElementById("bn").onclick=()=>setLens("narrated");
document.getElementById("be").onclick=()=>setLens("engineer");
// Context Console open/close
const ctxOv=document.getElementById("ctxoverlay");
document.getElementById("ctxbtn").onclick=()=>{ctxOv.classList.add("open");renderConsole();};
ctxOv.onclick=e=>{if(e.target===ctxOv)ctxOv.classList.remove("open");};
const pvOv=document.getElementById("pvoverlay");
document.getElementById("pvbtn").onclick=()=>{if(PREVIEWS.length){pvOv.classList.add("open");renderPreview();}};
pvOv.onclick=e=>{if(e.target===pvOv)pvOv.classList.remove("open");};
window.addEventListener("keydown",e=>{if(e.key==="Escape"){ctxOv.classList.remove("open");pvOv.classList.remove("open");document.querySelectorAll(".overlay.open").forEach(o=>o.classList.remove("open"));}});
// Cmd +/- / 0 text zoom (cmux-style) — scales ONLY pane/chat TEXT, and each
// pane INDEPENDENTLY (Adam): the pane under the cursor is the target; with
// the cursor off the panes, all panes scale together. Persisted per seat.
let SCALES={};try{SCALES=JSON.parse(localStorage.getItem("crate.scales")||"{}");}catch(e){SCALES={};}
let hoveredSeat=null;
const SEATS_ALL=["orchestrator","coder","reviewer","designer","tester"];
function saveScales(){localStorage.setItem("crate.scales",JSON.stringify(SCALES));}
function setSeatScale(seat,v){SCALES[seat]=Math.min(2.4,Math.max(0.6,Math.round(v*100)/100));const el=document.querySelector('.tile[data-seat="'+seat+'"]');if(el)el.style.setProperty("--tscale",SCALES[seat]);}
function bumpScale(d){
  if(hoveredSeat){setSeatScale(hoveredSeat,(SCALES[hoveredSeat]||1)+d);}
  else{SEATS_ALL.forEach(s=>setSeatScale(s,(SCALES[s]||1)+d));}
  saveScales();
}
function resetScale(){
  if(hoveredSeat){SCALES[hoveredSeat]=1;const el=document.querySelector('.tile[data-seat="'+hoveredSeat+'"]');if(el)el.style.setProperty("--tscale",1);}
  else{SEATS_ALL.forEach(s=>{SCALES[s]=1;const el=document.querySelector('.tile[data-seat="'+s+'"]');if(el)el.style.setProperty("--tscale",1);});}
  saveScales();
}
document.getElementById("grid").addEventListener("mousemove",e=>{const t=e.target.closest?e.target.closest(".tile"):null;hoveredSeat=t?t.getAttribute("data-seat"):null;});
document.getElementById("grid").addEventListener("mouseleave",()=>{hoveredSeat=null;});
window.addEventListener("keydown",e=>{
  if(!(e.metaKey||e.ctrlKey))return;
  if(e.key==="="||e.key==="+"){e.preventDefault();bumpScale(0.1);}
  else if(e.key==="-"||e.key==="_"){e.preventDefault();bumpScale(-0.1);}
  else if(e.key==="0"){e.preventDefault();resetScale();}
});
// ── T7-1: the workspace rail ──
function wsStatus(w){
  if(!w.exists)return{cls:"gone",label:"missing"};
  if(!w.rig)return{cls:"gone",label:"not a rig"};
  if(w.lastActivityMs&&(Date.now()-w.lastActivityMs)<90000)return{cls:"live",label:"active"};
  return{cls:"idle",label:"idle"};
}
function renderRail(){
  const list=document.getElementById("wslist");if(!list)return;
  if(!WORKSPACES.length){list.innerHTML='<div style="padding:18px;color:var(--faint);font-size:12.5px;line-height:1.6">No workspaces yet. Attach a repo, or add one below — each becomes its own team on the rail.</div>';return;}
  const active=PROJECT;
  list.innerHTML=WORKSPACES.map(w=>{
    const st=wsStatus(w);
    return '<div class="wsitem'+(w.path===active?' active':'')+'" data-path="'+encodeURIComponent(w.path)+'">'
      +'<span class="wsdot '+st.cls+'"></span>'
      +'<div class="wsmeta"><div class="wsname">'+esc(w.name)+'</div><div class="wspath">'+esc(w.path)+'</div></div>'
      +'<span class="wsstat">'+st.label+'</span>'
      +'<button class="wsrm" data-rm="'+encodeURIComponent(w.path)+'" title="Remove from rail">×</button></div>';
  }).join("");
  list.querySelectorAll(".wsitem").forEach(el=>{
    el.onclick=e=>{if(e.target.closest(".wsrm"))return;switchWorkspace(decodeURIComponent(el.getAttribute("data-path")));};
  });
  list.querySelectorAll(".wsrm").forEach(b=>{
    b.onclick=async e=>{e.stopPropagation();const p=decodeURIComponent(b.getAttribute("data-rm"));
      await fetch(api("/api/workspaces/remove"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({path:p})});loadWorkspaces();};
  });
}
async function loadWorkspaces(){
  try{const r=await fetch(api("/api/workspaces"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json());WORKSPACES=r.workspaces||[];renderRail();}catch(e){}
}
function switchWorkspace(path){
  // switching = reload /team pointed at the other project (each team is independent)
  location.href="/team?token="+TOKEN+"&project="+encodeURIComponent(path)+"&lens="+lens;
}
function openRail(){document.getElementById("rail").classList.add("open");document.getElementById("railback").classList.add("open");loadWorkspaces();}
function closeRail(){document.getElementById("rail").classList.remove("open");document.getElementById("railback").classList.remove("open");}
async function addWorkspace(){
  // W3: a real folder picker (the wizard's /api/fs/dirs jail), not a prompt()
  const p=await pickFolder("Add a workspace — choose a crate rig");
  if(!p)return;
  const r=await fetch(api("/api/workspaces"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({path:p})}).then(r=>r.json());
  if(r.error){await uiNotice(r.error);return;}
  WORKSPACES=r.workspaces||[];renderRail();
}
document.getElementById("railbtn").onclick=openRail;
document.getElementById("railclose").onclick=closeRail;
document.getElementById("railback").onclick=closeRail;
document.getElementById("wsadd").onclick=addWorkspace;
// ── T7-2: the Health menu — doctor + version/update + seat auth, over the
// existing endpoints (thin front, per HEADLESS-DESIGN §6). ──
function statDot(s){return s==="ok"?'<span class="wsdot live"></span>':s==="warn"?'<span class="wsdot idle"></span>':'<span class="wsdot gone"></span>';}
async function renderHealth(){
  const panel=document.getElementById("healthpanel");if(!panel)return;
  panel.innerHTML='<h3>Health</h3><div class="csub">Loading…</div>';
  let ver={},doc=[],agents={};
  try{[ver,doc,agents]=await Promise.all([
    fetch(api("/api/version"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()),
    fetch(api("/api/doctor"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()).catch(()=>[]),
    fetch(api("/api/agents"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()).catch(()=>({})),
  ]);}catch(e){}
  const checks=Array.isArray(doc)?doc:(doc.checks||[]);
  const upd=ver.updateAvailable?'<button id="hupd" class="crefresh" style="margin-left:8px">Update</button>':'<span style="color:var(--faint)"> up to date</span>';
  let h='<h3>Health</h3><div class="csub">Engine '+esc(ver.version||"?")+upd+'</div>';
  h+=checks.map(c=>'<div class="crow">'+statDot(c.status)+'<div style="flex:1"><div style="font:600 12px/1.3 var(--body)">'+esc(c.name)+'</div>'
    +(c.detail?'<div style="font:400 10.5px/1.4 var(--mono);color:var(--faint)">'+esc(c.detail)+'</div>':'')
    +(c.status!=="ok"&&c.fix?'<div style="font:400 10.5px/1.4 var(--mono);color:var(--amber)">'+esc(c.fix)+'</div>':'')+'</div></div>').join("");
  if(!checks.length)h+='<div class="crow"><div style="color:var(--faint);font-size:12px">No project attached — attach a repo to run the doctor.</div></div>';
  h+='<div class="cpolicy">Seat auth + logs live in the turn logs on each tile. Doctor + version read from the engine tier.</div>';
  panel.innerHTML=h;
  // W3 (audit K2): "Update now" ends with the app BACK — update, then the
  // server restarts itself and we follow it to the fresh URL. No homework.
  const ub=document.getElementById("hupd");if(ub)ub.onclick=async()=>{ub.textContent="…";
    const r=await fetch(api("/api/update"),{method:"POST",headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()).catch(()=>null);
    if(!r||r.error){await uiNotice("Update: "+((r&&r.error)||"failed — see logs"));renderHealth();return;}
    const flg=(r.flagged&&r.flagged.length)?r.flagged.map(f=>"⚑ "+f.note).join("\\n"):"All your customizations are compatible.";
    if(!(await uiConfirm("Updated "+String(r.before).slice(0,7)+" → "+String(r.after).slice(0,7)+" (fast-forward).\\n"+flg+"\\n\\nRestart the app now to finish?","Restart now"))){renderHealth();return;}
    const rr=await fetch(api("/api/restart"),{method:"POST",headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()).catch(()=>null);
    if(rr&&rr.url)location.href=rr.url;else await uiNotice("The app is restarting — if this window goes quiet, reopen with: crate open");
  };
}
// ── T7-2: the Team menu — loop state + Abandon (headless verb). Boot/Resume +
// per-seat Relaunch light up when the GUI owns the team lifecycle (T7-3). ──
async function renderTeamMenu(){
  const panel=document.getElementById("teampanel");if(!panel)return;
  let ps={booted:false,seats:[]},hv={};
  try{[ps,hv]=await Promise.all([
    fetch(api("/api/team/status"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()),
    fetch(api("/api/health"),{headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json()).catch(()=>({})),
  ]);}catch(e){}
  const alive=(ps.seats||[]).filter(s=>s.alive).length;
  const tasks=(GATES||[]).map(g=>g.task);
  const working=SEATSVIEW.filter(s=>{const t=s.turns&&s.turns[0];return t&&t.ok===null;}).map(s=>s.seat);
  let h='<h3>Team</h3><div class="csub">'+(ps.booted?alive+'/5 seat runners alive (GUI-owned)':'not booted — the GUI can boot it')+'</div>';
  // per-seat lifecycle rows (boot lights these up)
  h+=(ps.seats||[]).map(s=>'<div class="crow">'+(s.alive?'<span class="wsdot live"></span>':'<span class="wsdot gone"></span>')
    +'<div style="flex:1;font:600 11px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase">'+esc(s.seat)+'</div>'
    +'<button class="crefresh" data-relaunch="'+esc(s.seat)+'">Relaunch</button></div>').join("");
  h+='<div class="crow"><div style="flex:1"><div style="font:600 11px/1.3 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)">Gates pending</div>'
    +'<div style="font:400 11px/1.4 var(--mono);color:var(--faint)">'+(tasks.length?tasks.map(esc).join(", "):"none")+'</div></div></div>';
  h+='<div class="crow"><div style="flex:1"><div style="font:600 11px/1.3 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)">Working now</div>'
    +'<div style="font:400 11px/1.4 var(--mono);color:var(--faint)">'+(working.length?working.map(esc).join(", "):"idle")+'</div></div></div>';
  // P7-T5 auto-revive card (moved here from the retired /health page, W1):
  // notes always win; otherwise a one-line "on" chip when the flag is set.
  const notes=(hv&&hv.reviveNotes)||[];
  if(notes.length||(hv&&hv.autoRevive)){
    h+='<div class="crow" id="revivecard"><div style="flex:1"><div style="font:600 11px/1.3 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)">Auto-revive '
      +(hv.autoRevive?'(on — rig.conf AUTO_REVIVE=1; dead seats relaunch with backoff, ceiling 3)':'(off; earlier notes below)')+'</div>'
      +'<div style="font:400 10.5px/1.6 var(--mono);color:var(--faint)">'
      +(notes.length?notes.slice(-8).map(n=>esc(n.at.replace("T"," ").slice(0,19))+' · <b>'+esc(n.seat)+'</b> — '+esc(n.detail)).join('<br>'):'no revives yet — the monitor is watching.')
      +'</div></div></div>';
  }
  h+='<div class="cactions">'+(ps.booted
    ?'<button id="tstop">Stop team</button><button id="tabandon">Abandon loop</button>'
    :'<button id="tboot">Boot / Resume team</button><button id="tabandon">Abandon loop</button>')+'</div>';
  h+='<div class="cpolicy">Boot / Resume spawns one supervised runner per seat (headless, no cmux). Resume is automatic — runners re-orient from state files. Relaunch restarts exactly one seat.</div>';
  panel.innerHTML=h;
  const bootB=document.getElementById("tboot");if(bootB)bootB.onclick=async()=>{bootB.textContent="Booting…";const r=await fetch(api("/api/team/boot"),{method:"POST",headers:{"X-Crate-Token":TOKEN}}).then(r=>r.json());if(r.error)await uiNotice(r.error);renderTeamMenu();refresh();};
  const stopB=document.getElementById("tstop");if(stopB)stopB.onclick=async()=>{if(!(await uiConfirm("Stop the whole team? Runners exit; the loop resumes from state files on the next boot.","Stop team",true)))return;await fetch(api("/api/team/stop"),{method:"POST",headers:{"X-Crate-Token":TOKEN}});renderTeamMenu();refresh();};
  panel.querySelectorAll("[data-relaunch]").forEach(b=>{b.onclick=async()=>{const seat=b.getAttribute("data-relaunch");b.textContent="…";await fetch(api("/api/team/relaunch"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({seat})});renderTeamMenu();refresh();};});
  const ab=document.getElementById("tabandon");if(ab)ab.onclick=async()=>{
    if(!(await uiConfirm("Abandon the current loop back to idle? The branch is left as-is; nothing merges.","Abandon loop",true)))return;
    const task=(GATES[0]&&GATES[0].task)||"";
    const r=await fetch(api("/api/team/abandon"),{method:"POST",headers:{"X-Crate-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({task})}).then(r=>r.json());
    await uiNotice(r.ok?"Loop abandoned — back to idle.":"Abandon: "+((r.out||"failed").split("\\n")[0]));refresh();
  };
}
const healthOv=document.getElementById("healthoverlay");
document.getElementById("healthbtn").onclick=()=>{healthOv.classList.add("open");renderHealth();};
healthOv.onclick=e=>{if(e.target===healthOv)healthOv.classList.remove("open");};
const teamOv=document.getElementById("teamoverlay");
document.getElementById("teambtn").onclick=()=>{teamOv.classList.add("open");renderTeamMenu();};
teamOv.onclick=e=>{if(e.target===teamOv)teamOv.classList.remove("open");};
window.addEventListener("keydown",e=>{if(e.key==="Escape")closeRail();});
// PHASE-B #5: the nav chevrons spin while their panel is open — observed off
// the overlay's class so every open/close path (click, outside, actions) syncs.
[["pvbtn","pvoverlay"],["teambtn","teamoverlay"],["ctxbtn","ctxoverlay"],["healthbtn","healthoverlay"]].forEach(p=>{
  const bt=document.getElementById(p[0]),ov=document.getElementById(p[1]);if(!bt||!ov)return;
  new MutationObserver(()=>bt.classList.toggle("open",ov.classList.contains("open"))).observe(ov,{attributes:true,attributeFilter:["class"]});
});
loadWorkspaces();
setLens(lens);setInterval(refresh,2000);setInterval(tickWorking,1000);
startStream(); // 2c: the SSE push channel — the poll above stays as the floor
`;

export function teamPage(view: TeamView): string {
  const badge = ""; // headless is the only mode — no badge needed (Adam)
  return `<!doctype html><html><head><meta charset="utf-8"><title>Crate Engine — ${view.project} team</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/assets/xterm.css">
<style>${VIEW_STYLE}</style></head>
<body>
<div class="deadbar" id="deadbar">engine offline — the app server is not responding. Reopen with <code>crate open</code>.</div>
<div class="railback" id="railback"></div>
<aside class="rail" id="rail">
  <div class="railhd"><h3>Workspaces</h3><button class="rx" id="railclose" title="Close">×</button></div>
  <div class="wslist" id="wslist"></div>
  <div class="railft"><button class="wsadd" id="wsadd">+ Add a workspace</button></div>
</aside>
<header>
  <div style="display:flex;align-items:center;gap:14px">
    <button class="railbtn" id="railbtn" title="Workspaces"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
    <span class="mark">CRATE<svg class="bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2 4.8 13.4h5L8.6 22l10.6-13.2h-6.2L13.2 2z"/></svg>ENGINE</span>
    <span class="ver">2.1 <b>BETA</b></span>
    <span class="proj" id="projlabel">${escHtml(view.project)}</span>
    <span class="loopchip" id="loopchip" hidden></span>
  </div>
  <div style="display:flex;align-items:center;gap:12px">
    ${badge}
    <button class="navbtn hidden" id="pvbtn">Preview</button>
    <button class="navbtn" id="teambtn">Team</button>
    <button class="navbtn" id="ctxbtn">Context</button>
    <button class="navbtn" id="healthbtn">Health</button>
    <div class="toggle"><button id="bn">Narrated</button><button id="be">Engineer</button></div>
  </div>
</header>
<div class="overlay" id="ctxoverlay"><div class="console" id="console"></div></div>
<div class="overlay" id="healthoverlay"><div class="console" id="healthpanel"></div></div>
<div class="overlay" id="teamoverlay"><div class="console" id="teampanel"></div></div>
<div class="overlay" id="pvoverlay"><div class="pvwrap" id="pvwrap"></div></div>
<main id="grid"></main>
<script src="/assets/xterm.js"></script>
<script src="/assets/addon-fit.js"></script>
<script>${VIEW_JS}</script>
</body></html>`;
}
