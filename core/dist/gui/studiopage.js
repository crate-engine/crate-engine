// The Design Studio glass (backlog 10, PDR dev/pdr/design-studio.md).
// One page, framed "mobile" or "desktop" by the query. PURE GLASS by law:
// when the slot is LIVE it is nothing but the running build (a real
// interactive webview through the engine's proxy — clicks, hovers, scroll;
// never an image); when the slot is free or its server died it shows the
// branded WAITING screen naming the honest reason. Zero added chrome — no
// toolbars, no feedback UI: Adam speaks verdicts in the cockpit panes.
// The frame polls the derived slot state lightly (a tiny JSON every 4s —
// this is a satellite, not the cockpit; the quiet-cockpit laws govern the
// cockpit's own surfaces) and wakes on its own when a design goes live.
export function studioPage(frame) {
    const nice = frame === "mobile" ? "Mobile" : "Desktop";
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Crate Studio — ${nice}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{height:100%;margin:0;background:#0b0e14;color:#f1f3f6;font:15px -apple-system,system-ui,sans-serif}
#stage{position:fixed;inset:0;display:none}
#stage iframe{width:100%;height:100%;border:0;display:block;background:#0b0e14}
#wait{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;text-align:center}
.box{max-width:420px;padding:0 24px}
.bolt{width:44px;height:44px;fill:#e2a33c;animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
h1{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#e2a33c;margin:16px 0 8px;font-weight:600}
p{color:#8b94a5;line-height:1.6;font-size:13px;margin:0}
.frame{color:#6b7488;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-top:18px}
</style></head><body>
<div id="stage"><iframe id="pv"></iframe></div>
<div id="wait"><div class="box">
<svg class="bolt" viewBox="0 0 24 24"><path d="M13.2 2 4.8 13.4h5L8.6 22l10.6-13.2h-6.2L13.2 2z"/></svg>
<h1>Design Studio</h1><p id="reason">awaiting the next design task</p>
<div class="frame">${nice} frame</div>
</div></div>
<script>
const TOKEN=new URLSearchParams(location.search).get("token");
const PROJECT=new URLSearchParams(location.search).get("project")||"";
const tq="token="+TOKEN+(PROJECT?"&project="+encodeURIComponent(PROJECT):"");
let SRC="";
function show(live){document.getElementById("stage").style.display=live?"block":"none";document.getElementById("wait").style.display=live?"none":"flex";}
async function poll(){
  let s=null;
  try{s=await fetch("/api/studio/state?"+tq).then(r=>r.json());}catch(e){}
  if(!s){document.getElementById("reason").textContent="the engine is not answering — the frame reconnects on its own";show(false);SRC="";return;}
  if(s.mode!=="live"){document.getElementById("reason").textContent=s.reason||"awaiting the next design task";show(false);SRC="";return;}
  // the routing law: an http target renders through the engine's proxy —
  // the glass never holds a raw dev URL; other schemes pass through
  const src=s.proxyPort?("http://"+location.hostname+":"+s.proxyPort+(s.route&&s.route!=="/"?s.route:"/")):s.url;
  if(src!==SRC){SRC=src;document.getElementById("pv").src=src;}
  show(true);
}
poll();setInterval(poll,4000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll();});
</script>
</body></html>`;
}
//# sourceMappingURL=studiopage.js.map