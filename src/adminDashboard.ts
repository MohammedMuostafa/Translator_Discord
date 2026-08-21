import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import { env } from './config.js';
import {
  deleteRuntimeProvider,
  getAdminRuntimeSnapshot,
  setRuntimeRoute,
  setVoiceRuntimeSettings,
  setDisplayRuntimeSettings,
  upsertRuntimeProvider,
  type ProviderKind,
  type RuntimeTask,
  type ThinkingLevelName,
  type VoiceSpeakerAccess,
  type DisplayHeadingSize,
  type DisplayDensity,
  type DisplayDivider
} from './services/runtimeConfig.js';

const SESSION_COOKIE = 'td_admin_session';
const STATE_COOKIE = 'td_admin_state';
const SESSION_TTL_MS = 8 * 60 * 60_000;

function dashboardBaseUrl(): string | undefined {
  return env.DASHBOARD_PUBLIC_URL ?? env.PUBLIC_BASE_URL;
}

function adminEnabled(): boolean {
  return Boolean(
    env.DISCORD_CLIENT_SECRET &&
    env.ADMIN_DISCORD_IDS?.length &&
    env.DASHBOARD_SESSION_SECRET &&
    env.DASHBOARD_ENCRYPTION_KEY &&
    dashboardBaseUrl()
  );
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (!key) continue;
    result[key] = decodeURIComponent(valueParts.join('='));
  }
  return result;
}

function sign(value: string): string {
  return createHmac('sha256', env.DASHBOARD_SESSION_SECRET ?? 'disabled')
    .update(value)
    .digest('base64url');
}

function encodeSession(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    userId,
    exp: Date.now() + SESSION_TTL_MS
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function decodeSession(raw: string | undefined): { userId: string } | undefined {
  if (!raw) return undefined;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return undefined;

  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      userId?: string;
      exp?: number;
    };
    if (!parsed.userId || !parsed.exp || parsed.exp < Date.now()) return undefined;
    if (!env.ADMIN_DISCORD_IDS?.includes(parsed.userId)) return undefined;
    return { userId: parsed.userId };
  } catch {
    return undefined;
  }
}

function secureCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAgeSeconds}`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!adminEnabled()) {
    res.status(503).json({ error: 'Admin dashboard is not configured yet.' });
    return;
  }
  const session = decodeSession(parseCookies(req)[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  res.locals.adminUserId = session.userId;
  next();
}

function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const base = dashboardBaseUrl();
  const origin = req.headers.origin;
  if (!base || !origin) {
    next();
    return;
  }
  try {
    if (new URL(origin).origin !== new URL(base).origin) {
      res.status(403).json({ error: 'Invalid origin.' });
      return;
    }
  } catch {
    res.status(403).json({ error: 'Invalid origin.' });
    return;
  }
  next();
}

function adminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>TD AI Control Center</title>
<style>
:root{--bg:#070a12;--panel:#0d1320;--panel2:#111a2b;--line:#23314d;--text:#f5f7fb;--muted:#9aa9c1;--cyan:#36d7ff;--violet:#8d6bff;--green:#4fe0a2;--danger:#ff6b7a;--shadow:0 20px 70px rgba(0,0,0,.38)}
*{box-sizing:border-box}html{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",Tahoma,sans-serif;background:var(--bg);color:var(--text);font-size:16px;line-height:1.55}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% -10%,rgba(54,215,255,.13),transparent 34%),radial-gradient(circle at 90% 0,rgba(141,107,255,.15),transparent 30%),var(--bg)}button,input,select{font:inherit}.shell{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.side{position:sticky;top:0;height:100vh;border-right:1px solid var(--line);padding:26px 18px;background:rgba(7,10,18,.82);backdrop-filter:blur(18px)}.brand{display:flex;gap:12px;align-items:center;padding:0 8px 26px}.logo{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--violet));color:#071018;box-shadow:0 12px 32px rgba(54,215,255,.2)}.brand h1{font-size:18px;margin:0}.brand p{margin:2px 0 0;color:var(--muted);font-size:12px}.nav{display:grid;gap:8px}.nav button{background:transparent;color:var(--muted);border:0;text-align:left;padding:12px 14px;border-radius:12px;cursor:pointer}.nav button.active,.nav button:hover{background:linear-gradient(90deg,rgba(54,215,255,.12),rgba(141,107,255,.08));color:var(--text)}.main{padding:34px;max-width:1460px;width:100%;margin:auto}.top{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:28px}.top h2{font-size:30px;line-height:1.2;margin:0}.top p{margin:7px 0 0;color:var(--muted)}.logout{color:var(--muted);text-decoration:none;border:1px solid var(--line);padding:10px 14px;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:18px}.card{grid-column:span 12;background:linear-gradient(180deg,rgba(17,26,43,.96),rgba(12,18,31,.96));border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:var(--shadow)}.half{grid-column:span 6}.third{grid-column:span 4}.card h3{font-size:18px;margin:0 0 4px}.sub{color:var(--muted);font-size:14px;margin:0 0 18px}.stat{font-size:28px;font-weight:800}.pill{display:inline-flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 16px var(--green)}.section{display:none}.section.active{display:block}.route{display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) minmax(220px,1.3fr) auto;gap:10px;align-items:end;padding:14px 0;border-top:1px solid rgba(35,49,77,.65)}.route:first-of-type{border-top:0}.label{font-weight:700}.tiny{color:var(--muted);font-size:12px}.field{display:grid;gap:7px}.field label{font-size:12px;color:var(--muted)}input,select{width:100%;background:#090f1b;color:var(--text);border:1px solid var(--line);border-radius:11px;padding:11px 12px;outline:none}input:focus,select:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(54,215,255,.09)}.btn{border:0;border-radius:11px;padding:11px 14px;cursor:pointer;font-weight:750}.primary{background:linear-gradient(135deg,var(--cyan),#6f93ff);color:#051018}.secondary{background:#152037;color:var(--text);border:1px solid var(--line)}.danger{background:rgba(255,107,122,.1);color:#ff91a0;border:1px solid rgba(255,107,122,.32)}.provider{display:grid;grid-template-columns:1.3fr 1fr 1.6fr .8fr auto;gap:10px;align-items:center;padding:13px 0;border-top:1px solid rgba(35,49,77,.65)}.provider:first-child{border-top:0}.provider strong{display:block}.provider span{font-size:12px;color:var(--muted)}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.wide{grid-column:1/-1}.voice-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.range-line{display:grid;grid-template-columns:1fr 90px;gap:12px;align-items:center}.notice{padding:13px 14px;border:1px solid rgba(54,215,255,.24);background:rgba(54,215,255,.07);border-radius:12px;color:#cfeeff;font-size:14px}.toast{position:fixed;right:24px;bottom:24px;max-width:420px;background:#101a2c;border:1px solid var(--line);padding:14px 16px;border-radius:13px;box-shadow:var(--shadow);transform:translateY(120px);opacity:0;transition:.25s}.toast.show{transform:translateY(0);opacity:1}.rtl-demo{direction:rtl;text-align:right;font-size:17px;line-height:1.9;background:#090f1b;border:1px solid var(--line);border-radius:14px;padding:18px}.rtl-demo bdi{direction:ltr;unicode-bidi:isolate}.toggle{display:flex;align-items:center;gap:10px;min-height:44px;padding:10px 12px;background:#090f1b;border:1px solid var(--line);border-radius:11px}.toggle input{width:auto;accent-color:var(--cyan)}.preview-shell{background:#090f1b;border:1px solid var(--line);border-radius:14px;padding:18px;min-height:240px}.preview-shell.compact{line-height:1.35}.preview-shell.comfortable{line-height:1.65}.preview-shell.relaxed{line-height:1.95}.preview-shell .preview-title{font-weight:850;margin-bottom:12px}.preview-shell .preview-section{margin:12px 0}.preview-shell .quote{border-left:3px solid var(--line);padding-left:12px;color:#d6e0ef}.preview-shell.rtl-quote .quote{direction:rtl;text-align:right;border-left:0;border-right:3px solid var(--line);padding-left:0;padding-right:12px}.code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;background:#090f1b;border:1px solid var(--line);padding:12px;border-radius:12px;color:#c5d5f1;overflow:auto}
@media(max-width:980px){.shell{grid-template-columns:1fr}.side{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}.nav{grid-template-columns:repeat(4,1fr)}.main{padding:22px}.half,.third{grid-column:span 12}.route{grid-template-columns:1fr}.provider{grid-template-columns:1fr}.form-grid,.voice-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="shell">
  <aside class="side">
    <div class="brand"><div class="logo">TD</div><div><h1>TD AI</h1><p>Private Control Center</p></div></div>
    <div class="nav">
      <button class="active" data-tab="overview">Overview</button>
      <button data-tab="routing">AI Routing</button>
      <button data-tab="providers">Providers & APIs</button>
      <button data-tab="voice">Voice AI</button>
      <button data-tab="display">Display</button>
    </div>
  </aside>
  <main class="main">
    <div class="top"><div><h2 id="pageTitle">Control Center</h2><p>Change models and voice behavior without redeploying the bot.</p></div><a class="logout" href="/admin/logout">Log out</a></div>

    <section id="overview" class="section active">
      <div class="grid">
        <div class="card third"><span class="pill"><span class="dot"></span> Runtime</span><p class="sub">Configuration mode</p><div class="stat">Live</div></div>
        <div class="card third"><span class="pill">AI routing</span><p class="sub">Independent model routes</p><div class="stat" id="routeCount">0</div></div>
        <div class="card third"><span class="pill">Providers</span><p class="sub">Encrypted API profiles</p><div class="stat" id="providerCount">0</div></div>
        <div class="card half"><h3>How routing works</h3><p class="sub">Assign a different API + model to every capability.</p><div class="code">Translation → Gemini Fast\nAI Chat → Advanced text model\nSmart Answer → High-quality reply model\nLive Voice → Gemini Live\nSTT → Fast audio model\nTTS → Gemini TTS</div></div>
        <div class="card half"><h3>Security</h3><p class="sub">Provider keys are encrypted with AES-256-GCM before being written to DATA_DIR.</p><div class="notice">The dashboard never sends saved API keys back to the browser. Keep DASHBOARD_ENCRYPTION_KEY only in Railway Variables.</div></div>
      </div>
    </section>

    <section id="routing" class="section"><div class="card"><h3>AI Model Routing</h3><p class="sub">Changes apply immediately to new text requests. Live Voice model changes apply after leaving and rejoining the voice channel.</p><div id="routes"></div></div></section>

    <section id="providers" class="section">
      <div class="grid">
        <div class="card"><h3>Providers</h3><p class="sub">Add multiple API keys. Text providers use an OpenAI-compatible Chat Completions endpoint; Gemini Native is used for Live/STT/TTS.</p><div id="providerList"></div></div>
        <div class="card"><h3>Add provider</h3><p class="sub">Saved API keys are encrypted server-side.</p><form id="providerForm" class="form-grid">
          <div class="field"><label>Name</label><input name="name" placeholder="Gemini Production" required /></div>
          <div class="field"><label>Type</label><select name="kind"><option value="openai-compatible">OpenAI-compatible Text API</option><option value="gemini-native">Gemini Native</option></select></div>
          <div class="field wide" id="urlField"><label>Chat Completions URL</label><input name="apiUrl" placeholder="https://.../chat/completions" /></div>
          <div class="field wide"><label>API key</label><input name="apiKey" type="password" autocomplete="new-password" placeholder="Paste key" required /></div>
          <div class="wide"><button class="btn primary" type="submit">Save Provider</button></div>
        </form></div>
      </div>
    </section>

    <section id="voice" class="section"><div class="card"><h3>Live Voice Tuning</h3><p class="sub">Tune intelligence, turn timing, and who is allowed to speak with TD AI.</p><div class="voice-grid">
      <div class="field"><label>Thinking level</label><select id="thinking"><option>minimal</option><option>low</option><option>medium</option><option>high</option></select></div>
      <div class="field"><label>Who can talk to TD AI?</label><select id="speakerAccess"><option value="everyone">Everyone in the voice channel</option><option value="owner-only">Session owner only</option></select></div>
      <div class="field"><label>Live voice</label><input id="liveVoice" placeholder="Kore" /></div>
      <div class="field"><label>Listen / TTS voice</label><input id="ttsVoice" placeholder="Kore" /></div>
      <div class="field wide"><label>End-of-speech delay</label><div class="range-line"><input id="silenceRange" type="range" min="200" max="1500" step="50" /><input id="silence" type="number" min="200" max="5000" /></div></div>
      <div class="wide notice"><b>Group Voice:</b> choose <b>Everyone</b> and any non-bot human in the same voice channel can take a turn. TD AI processes one spoken turn at a time so overlapping voices are never mixed together.</div>
      <div class="wide notice">Recommended: <b>low/medium</b> thinking + <b>550–750ms</b> silence for natural conversation.</div>
      <div class="wide"><button id="saveVoice" class="btn primary">Save Voice Settings</button></div>
    </div></div></section>

    <section id="display" class="section"><div class="grid">
      <div class="card half"><h3>Discord Output Studio</h3><p class="sub">Discord owns the actual font family/body size, but TD AI can control heading size, density, metadata, quotes, emojis, and preview layout.</p><div class="form-grid">
        <div class="field"><label>Heading size</label><select id="headingSize"><option value="large">Large (#)</option><option value="medium">Medium (##)</option><option value="small">Small (###)</option></select></div>
        <div class="field"><label>Text density</label><select id="density"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="relaxed">Relaxed</option></select></div>
        <div class="field"><label>Section divider</label><select id="divider"><option value="none">None</option><option value="line">Horizontal line</option><option value="spaced">Extra spacing</option></select></div>
        <div class="field"><label>Original preview length</label><input id="originalPreviewChars" type="number" min="80" max="1200" step="20" /></div>
        <label class="toggle"><input id="showEmojis" type="checkbox" /> Show section emojis</label>
        <label class="toggle"><input id="showDetectedLanguage" type="checkbox" /> Show detected language</label>
        <label class="toggle"><input id="showProvider" type="checkbox" /> Show provider name</label>
        <label class="toggle"><input id="showOriginal" type="checkbox" /> Show original message preview</label>
        <label class="toggle"><input id="quoteArabic" type="checkbox" /> Quote Arabic explanation blocks</label>
        <label class="toggle"><input id="smartAnswerArabicFirst" type="checkbox" /> Arabic explanation first in Smart Answer</label>
        <div class="wide"><button id="saveDisplay" class="btn primary">Save Display Settings</button></div>
      </div></div>
      <div class="card half"><h3>Live preview</h3><p class="sub">This approximates Discord Markdown. Use Heading size to get visibly larger/smaller titles in Discord.</p><div id="displayPreview" class="preview-shell comfortable rtl-quote"></div></div>
      <div class="card"><h3>What can and cannot change</h3><div class="notice">✅ Can control headings, spacing, section order, emojis, metadata, quotes and original-message preview. &nbsp; ❌ Discord does not allow bots to force a custom font family or arbitrary body font size.</div></div>
    </div></section>
  </main>
</div>
<div class="toast" id="toast"></div>
<script>
const state={config:null};
const $=s=>document.querySelector(s);
const toast=(msg,bad=false)=>{const t=$('#toast');t.textContent=msg;t.style.borderColor=bad?'rgba(255,107,122,.5)':'rgba(79,224,162,.45)';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)};
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{'content-type':'application/json',...(opts.headers||{})}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Request failed');return j}
function providersFor(kind){return state.config.providers.filter(p=>p.kind===kind&&p.enabled)}
function defaultModel(task){const env={translation:'gemini-3.7-flash',chat:'gemini-3.7-flash',ai_tools:'gemini-3.7-flash',smart_reply:'gemini-3.7-flash',voice_live:'gemini-3.1-flash-live-preview',stt:'gemini-3.1-flash-lite',tts:'gemini-3.1-flash-tts-preview'};return env[task]||''}
function esc(value){return String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
function render(){const c=state.config;$('#providerCount').textContent=c.providers.length;$('#routeCount').textContent=Object.keys(c.routes||{}).length;
  $('#routes').innerHTML=c.tasks.map(task=>{const route=c.routes[task.id]||{};const ps=providersFor(task.kind);const options=ps.map(p=>'<option value="'+esc(p.id)+'" '+(route.providerId===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('');return '<div class="route"><div><div class="label">'+esc(task.label)+'</div><div class="tiny">'+esc(task.id)+'</div></div><div class="field"><label>Provider</label><select data-provider="'+esc(task.id)+'">'+options+'</select></div><div class="field"><label>Model</label><input data-model="'+esc(task.id)+'" value="'+esc(route.model||defaultModel(task.id))+'" /></div><button class="btn secondary" type="button" data-save-route="'+esc(task.id)+'">Save</button></div>'}).join('');
  $('#providerList').innerHTML=c.providers.map(p=>'<div class="provider"><div><strong>'+esc(p.name)+'</strong><span>'+esc(p.id)+'</span></div><div>'+esc(p.kind)+'</div><div><span>'+esc(p.apiUrl||'Gemini native API')+'</span></div><div>'+esc(p.apiKeyHint)+'</div><div>'+(p.builtIn?'Built-in':'<button class="btn danger" type="button" data-remove-provider="'+esc(p.id)+'">Delete</button>')+'</div></div>').join('');
  $('#thinking').value=c.voice.thinkingLevel;$('#speakerAccess').value=c.voice.speakerAccess||'everyone';$('#liveVoice').value=c.voice.liveVoice;$('#ttsVoice').value=c.voice.ttsVoice;$('#silence').value=c.voice.silenceMs;$('#silenceRange').value=Math.min(1500,c.voice.silenceMs);
  const d=c.display||{};$('#headingSize').value=d.headingSize||'medium';$('#density').value=d.density||'comfortable';$('#divider').value=d.divider||'none';$('#originalPreviewChars').value=d.originalPreviewChars||420;$('#showEmojis').checked=d.showEmojis!==false;$('#showDetectedLanguage').checked=d.showDetectedLanguage!==false;$('#showProvider').checked=d.showProvider===true;$('#showOriginal').checked=d.showOriginal!==false;$('#quoteArabic').checked=d.quoteArabic!==false;$('#smartAnswerArabicFirst').checked=d.smartAnswerArabicFirst!==false;renderDisplayPreview();
}
function renderDisplayPreview(){const density=$('#density')?.value||'comfortable';const heading=$('#headingSize')?.value||'medium';const showEmoji=$('#showEmojis')?.checked!==false;const showDetected=$('#showDetectedLanguage')?.checked!==false;const showOriginal=$('#showOriginal')?.checked!==false;const quoteArabic=$('#quoteArabic')?.checked!==false;const arabicFirst=$('#smartAnswerArabicFirst')?.checked!==false;const box=$('#displayPreview');if(!box)return;box.className='preview-shell '+density+(quoteArabic?' rtl-quote':'');const size=heading==='large'?'26px':heading==='small'?'18px':'22px';const icon=showEmoji?'💬 ':'';const detected=showDetected?'<div class="tiny">Detected: English</div>':'';const ar='<div class="preview-section"><strong>🇸🇦 الرسالة بالعربي</strong><div class="quote">صورتك الشخصية جامدة جدًا يا صاحبي 👏</div></div>';const reply='<div class="preview-section"><strong>'+icon+'Reply — English</strong><div>Thanks a lot, brother! Really appreciate it! 🙌</div></div>';box.innerHTML='<div class="preview-title" style="font-size:'+size+'">'+icon+'Smart Answer</div>'+detected+(arabicFirst?ar+reply:reply+ar)+(showOriginal?'<div class="preview-section tiny">Original preview enabled</div>':'');}
async function load(){state.config=await api('/admin/api/config');render()}
async function saveRoute(task){try{const provider=document.querySelector('[data-provider="'+CSS.escape(task)+'"]');const model=document.querySelector('[data-model="'+CSS.escape(task)+'"]');if(!provider||!model)throw new Error('Route controls are missing. Refresh the dashboard.');await api('/admin/api/routes/'+encodeURIComponent(task),{method:'PUT',body:JSON.stringify({providerId:provider.value,model:model.value})});toast('Route saved');await load()}catch(e){toast(e.message,true)}}
async function removeProvider(id){if(!confirm('Delete this provider? Routes using it will return to environment defaults.'))return;try{await api('/admin/api/providers/'+encodeURIComponent(id),{method:'DELETE'});toast('Provider deleted');await load()}catch(e){toast(e.message,true)}}
document.addEventListener('click',e=>{const save=e.target.closest('[data-save-route]');if(save){void saveRoute(save.dataset.saveRoute);return}const remove=e.target.closest('[data-remove-provider]');if(remove){void removeProvider(remove.dataset.removeProvider)}});
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav button,.section').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.tab).classList.add('active');$('#pageTitle').textContent=b.textContent});
$('#providerForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);try{await api('/admin/api/providers',{method:'POST',body:JSON.stringify(Object.fromEntries(f.entries()))});e.target.reset();toast('Provider saved');await load()}catch(err){toast(err.message,true)}});
$('#providerForm select[name="kind"]').onchange=e=>{$('#urlField').style.display=e.target.value==='gemini-native'?'none':'grid'};
$('#silenceRange').oninput=e=>$('#silence').value=e.target.value;$('#silence').oninput=e=>$('#silenceRange').value=Math.min(1500,Number(e.target.value)||200);
$('#saveVoice').onclick=async()=>{try{await api('/admin/api/voice',{method:'PUT',body:JSON.stringify({thinkingLevel:$('#thinking').value,speakerAccess:$('#speakerAccess').value,silenceMs:Number($('#silence').value),liveVoice:$('#liveVoice').value,ttsVoice:$('#ttsVoice').value})});toast('Voice settings saved — rejoin voice to apply session changes');await load()}catch(e){toast(e.message,true)}};
['headingSize','density','divider','originalPreviewChars','showEmojis','showDetectedLanguage','showProvider','showOriginal','quoteArabic','smartAnswerArabicFirst'].forEach(id=>$('#'+id)?.addEventListener('input',renderDisplayPreview));
$('#saveDisplay').onclick=async()=>{try{await api('/admin/api/display',{method:'PUT',body:JSON.stringify({headingSize:$('#headingSize').value,density:$('#density').value,divider:$('#divider').value,showEmojis:$('#showEmojis').checked,showDetectedLanguage:$('#showDetectedLanguage').checked,showProvider:$('#showProvider').checked,showOriginal:$('#showOriginal').checked,quoteArabic:$('#quoteArabic').checked,originalPreviewChars:Number($('#originalPreviewChars').value),smartAnswerArabicFirst:$('#smartAnswerArabicFirst').checked})});toast('Display settings saved');await load()}catch(e){toast(e.message,true)}};
load().catch(e=>toast(e.message,true));
</script>
</body></html>`;
}

export function registerAdminDashboard(app: Express): void {
  const router = express.Router();
  router.use((_, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    next();
  });

  router.get('/login', (req, res) => {
    if (!adminEnabled()) {
      res.status(503).send('Admin dashboard is not configured. Add Discord OAuth + dashboard security variables first.');
      return;
    }
    const state = randomBytes(24).toString('base64url');
    res.setHeader('Set-Cookie', secureCookie(STATE_COOKIE, state, 600));
    const redirectUri = `${dashboardBaseUrl()!.replace(/\/$/, '')}/admin/callback`;
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', env.DISCORD_APP_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  });

  router.get('/callback', async (req, res) => {
    try {
      if (!adminEnabled()) throw new Error('Admin dashboard is disabled.');
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const expectedState = parseCookies(req)[STATE_COOKIE];
      if (!code || !state || !expectedState || state !== expectedState) throw new Error('Invalid OAuth state.');

      const redirectUri = `${dashboardBaseUrl()!.replace(/\/$/, '')}/admin/callback`;
      const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_APP_ID,
          client_secret: env.DISCORD_CLIENT_SECRET!,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!tokenResponse.ok) throw new Error(`Discord OAuth failed (${tokenResponse.status}).`);
      const token = await tokenResponse.json() as { access_token?: string };
      if (!token.access_token) throw new Error('Discord did not return an access token.');

      const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(15_000)
      });
      if (!userResponse.ok) throw new Error('Could not read Discord identity.');
      const user = await userResponse.json() as { id?: string };
      if (!user.id || !env.ADMIN_DISCORD_IDS?.includes(user.id)) {
        res.status(403).send('This Discord account is not allowed to access TD AI Admin.');
        return;
      }

      res.setHeader('Set-Cookie', [
        secureCookie(SESSION_COOKIE, encodeSession(user.id), Math.floor(SESSION_TTL_MS / 1000)),
        clearCookie(STATE_COOKIE)
      ]);
      res.redirect('/admin');
    } catch (error) {
      res.status(400).send(`Admin login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  router.get('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE));
    res.redirect('/admin/login');
  });

  router.get('/', (req, res) => {
    if (!adminEnabled()) {
      res.status(503).send('Admin dashboard is not configured. See UPGRADE-V3.9-AR.md.');
      return;
    }
    const session = decodeSession(parseCookies(req)[SESSION_COOKIE]);
    if (!session) {
      res.redirect('/admin/login');
      return;
    }
    res.type('html').send(adminPage());
  });

  router.use('/api', express.json({ limit: '64kb' }), requireAdmin, requireSameOrigin);
  router.get('/api/config', async (_req, res) => {
    try { res.json(await getAdminRuntimeSnapshot()); }
    catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load configuration.' }); }
  });

  router.post('/api/providers', async (req, res) => {
    try {
      const id = await upsertRuntimeProvider({
        id: typeof req.body.id === 'string' ? req.body.id : undefined,
        name: String(req.body.name ?? ''),
        kind: req.body.kind as ProviderKind,
        apiUrl: typeof req.body.apiUrl === 'string' ? req.body.apiUrl : undefined,
        apiKey: typeof req.body.apiKey === 'string' ? req.body.apiKey : undefined,
        enabled: req.body.enabled !== false
      });
      res.json({ ok: true, id });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save provider.' }); }
  });

  router.delete('/api/providers/:id', async (req, res) => {
    try { await deleteRuntimeProvider(req.params.id); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not delete provider.' }); }
  });

  router.put('/api/routes/:task', async (req, res) => {
    try {
      await setRuntimeRoute(req.params.task as RuntimeTask, {
        providerId: String(req.body.providerId ?? ''),
        model: String(req.body.model ?? '')
      });
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update route.' }); }
  });

  router.put('/api/voice', async (req, res) => {
    try {
      await setVoiceRuntimeSettings({
        thinkingLevel: req.body.thinkingLevel as ThinkingLevelName,
        silenceMs: Number(req.body.silenceMs),
        liveVoice: String(req.body.liveVoice ?? ''),
        ttsVoice: String(req.body.ttsVoice ?? ''),
        speakerAccess: req.body.speakerAccess as VoiceSpeakerAccess
      });
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update voice settings.' }); }
  });

  router.put('/api/display', async (req, res) => {
    try {
      await setDisplayRuntimeSettings({
        headingSize: req.body.headingSize as DisplayHeadingSize,
        density: req.body.density as DisplayDensity,
        divider: req.body.divider as DisplayDivider,
        showEmojis: req.body.showEmojis !== false,
        showDetectedLanguage: req.body.showDetectedLanguage !== false,
        showProvider: req.body.showProvider === true,
        showOriginal: req.body.showOriginal !== false,
        quoteArabic: req.body.quoteArabic !== false,
        originalPreviewChars: Number(req.body.originalPreviewChars),
        smartAnswerArabicFirst: req.body.smartAnswerArabicFirst !== false
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update display settings.' });
    }
  });

  app.use('/admin', router);
}
