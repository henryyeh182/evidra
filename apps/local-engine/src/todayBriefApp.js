// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { TODAY_BRIEF_APP_SDK } from "./todayBriefAppSdk.js";

export const TODAY_BRIEF_RESOURCE_URI = "ui://pacevera/today-brief";

// A single-file MCP App. The host pushes the tool result through App.ontoolresult.
// Keep this self-contained so the packed .mcpb does not need a second asset tree.
export const TODAY_BRIEF_APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pacevera Today's Brief</title>
<style>
:root{color-scheme:dark;--bg:#111b30;--panel:#1e2a40;--line:#34445e;--ink:#eef4f5;--muted:#9daaba;--lime:#49d993;--amber:#ffd081;--red:#ffaaa4;--mono:ui-monospace,SFMono-Regular,Menlo,monospace;--body:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--ink);font:14px var(--body)}main{background:var(--bg);border:1px solid #0d172a;border-radius:14px;padding:18px;max-width:640px;box-shadow:0 16px 35px #10182855}.top{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font:11px var(--mono);letter-spacing:.08em;text-transform:uppercase}.live{color:var(--lime)}.live:before{content:"";display:inline-block;width:6px;height:6px;background:var(--lime);border-radius:50%;margin:0 7px 1px 0}.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:22px;margin-top:13px}.heading{display:flex;justify-content:space-between;gap:14px;align-items:start}.heading h1{font-size:25px;line-height:1.05;letter-spacing:-.04em;margin:0}.status{border-radius:99px;padding:8px 11px;background:#12573f;color:var(--lime);font-size:11px;font-weight:700;white-space:nowrap}.status.adjust{background:#5d4827;color:var(--amber)}.status.defer{background:#603a3a;color:var(--red)}dl{display:grid;grid-template-columns:1fr auto;gap:11px;border-bottom:1px solid var(--line);border-top:1px solid var(--line);padding:18px 0;margin:21px 0 0;font:12px var(--mono)}dt{color:var(--muted)}dd{margin:0}.decision{padding:18px 0;border-bottom:1px solid var(--line)}.label{color:var(--muted);font:10px var(--mono);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px}.fromto{display:grid;grid-template-columns:1fr 25px 1fr;gap:10px;align-items:center}.workout small{display:block;color:var(--muted);font:9px var(--mono);text-transform:uppercase;margin-bottom:5px}.workout b{display:block;font-size:15px}.workout span{display:block;color:#b2c0cc;font:11px var(--mono);margin-top:4px}.arrow{color:var(--lime);font-size:22px;text-align:center}.reason{color:#b8c4cf;line-height:1.55;margin:17px 0 0}.reason strong{color:#f0f4f6}.meta{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font:10px var(--mono);margin-top:17px}.empty{color:var(--muted);line-height:1.5;padding:18px 0}.error{color:var(--red)}
</style>
</head>
<body><main id="app" aria-live="polite"><div class="top"><span>Today's Brief</span><span class="live">Waiting for evidence</span></div><div class="card"><div class="empty">Loading Pacevera decision…</div></div></main>
<script type="module">
${TODAY_BRIEF_APP_SDK}
const root=document.getElementById("app");
const esc=value=>String(value??"—").replace(/[&<>\"]/g,c=>c===String.fromCharCode(34)?"&quot;":{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]);
const textOf=value=>Array.isArray(value)?value.join(", "):value;
const sourceText=value=>{if(!value)return "local evidence";if(typeof value==="string")return value;return Object.entries(value).filter(([,item])=>item?.status==="present").map(([name,item])=>name+" ("+(item.eventCount||0)+" records)").join(", ")||"local evidence"};
function render(raw){
  let payload=raw;
  if(typeof raw==="string"){try{payload=JSON.parse(raw)}catch{payload=null}}
  if(!payload){root.querySelector(".card").innerHTML='<div class="empty error">Pacevera returned an unreadable result.</div>';return}
  const brief=payload.todayBrief||payload.evidenceBrief;
  if(!brief){root.querySelector(".card").innerHTML='<div class="empty">Evidence preview received. Confirm it in the conversation before asking for a decision.</div>';return}
  if(payload.evidenceBrief && !payload.todayBrief && !payload.decision){
    const sources=sourceText(brief.sources),counts=brief.signalCounts||{};
    root.innerHTML='<div class="top"><span>Today\\'s Brief · '+esc(brief.date||payload.date)+'</span><span class="live">Evidence checked</span></div><div class="card"><div class="heading"><h1>Today\\'s<br>Brief</h1><span class="status">● Evidence checked</span></div><dl><dt>Workouts</dt><dd>'+esc(counts.workouts||0)+'</dd><dt>Health readings</dt><dd>'+esc(counts.healthMetrics||0)+'</dd><dt>Recovery readings</dt><dd>'+esc(counts.vendorAssessments||0)+'</dd></dl><p class="reason">已讀取你的健康資料：'+esc(sources)+'。接下來會直接根據你剛才提到的課表與這些資料給出建議。</p><div class="meta"><span>Source: '+esc(sources)+'</span></div></div></div>';
    return;
  }
  const decision=brief.decision||payload.decision||{};
  const state=brief.state||{};
  const from=brief.action?.from||payload.action?.from||{};
  const to=brief.action?.to||payload.action?.to||from;
  const type=decision.type||"preview";
  const status=type==="keep"?"Ready to train":type==="defer"?"Recovery first":type==="preview"?"Evidence checked":"Adjust today";
  const cls=type==="defer"?"defer":type==="keep"?"":"adjust";
  const metrics=[['Readiness',state.readinessScore],['Recovery',state.recoveryScore],['Fatigue',state.fatigueScore],['Confidence',brief.confidence||payload.confidence]];
  root.innerHTML='<div class="top"><span>Today\\'s Brief · '+esc(brief.date||payload.date)+'</span><span class="live">Evidence checked</span></div><div class="card"><div class="heading"><h1>Today\\'s<br>Brief</h1><span class="status '+cls+'">● '+esc(status)+'</span></div><dl>'+metrics.map(([k,v])=>'<dt>'+k+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl><div class="decision"><div class="label">Today\\'s decision</div><div class="fromto"><div class="workout"><small>Planned session</small><b>'+esc(from.focus||from.name||"Scheduled session")+'</b><span>'+esc(from.durationMinutes?from.durationMinutes+" min · ":"")+esc(from.intensity||"")+'</span></div><div class="arrow">→</div><div class="workout"><small>Today\\'s session</small><b>'+esc(to.focus||to.name||"No session")+'</b><span>'+esc(to.durationMinutes?to.durationMinutes+" min · ":"")+esc(to.intensity||"")+'</span></div></div></div><p class="reason"><strong>Why this changed:</strong> '+esc(textOf(brief.reason||payload.reason)||"Evidence checked; no additional reason returned.")+'</p><div class="meta"><span>Source: '+esc(sourceText(brief.evidence?.sources||payload.evidenceBrief?.sources))+'</span><span>'+esc(brief.evidence?.stateId||"")+'</span></div></div></div>';
}
const app=new App({name:"Pacevera Today's Brief",version:"0.5.1"});
app.ontoolresult=result=>{const text=result?.content?.find(item=>item.type==="text")?.text;render(text)};
app.connect();
</script></body></html>`;

export const TODAY_BRIEF_RESOURCE = Object.freeze({
  uri: TODAY_BRIEF_RESOURCE_URI,
  name: "Pacevera Today's Brief",
  title: "Pacevera Today's Brief",
  description: "Visual Today’s Brief card for Pacevera decision results.",
  mimeType: "text/html;profile=mcp-app",
  _meta: { ui: { prefersBorder: true, csp: { resourceDomains: [] } } }
});
