import {
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import type {
  Express,
  Request,
  Response,
  NextFunction
} from 'express';
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
import {
  adminUpdateUser,
  isAdminUser,
  listPlans,
  listProviderHealth,
  listUsers,
  resetUserUsage,
  updatePlan,
  userUsageSummary,
  type PlanId,
  type AccountRole,
  type SubscriptionStatus
} from './services/billingStore.js';
import {
  getVoiceControlSettings,
  setVoiceControlSettings,
  type VoiceActivationMode,
  type FollowupSpeaker,
  type VoiceProductMode,
  type TranslationOutput,
  type TranslationQuality
} from './services/voiceControl.js';
import {
  ALLOWED_VOICES,
  getUserPersonalization,
  setUserPersonalization,
  type UserDensity,
  type UserHeadingSize
} from './services/userPersonalization.js';

const SESSION_COOKIE = 'td_dashboard_session';
const STATE_COOKIE = 'td_dashboard_state';
const SESSION_TTL_MS = 8 * 60 * 60_000;

function dashboardBaseUrl(): string | undefined {
  return env.DASHBOARD_PUBLIC_URL ?? env.PUBLIC_BASE_URL;
}

function dashboardEnabled(): boolean {
  return Boolean(
    env.DISCORD_CLIENT_SECRET &&
    env.DASHBOARD_SESSION_SECRET &&
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
  return createHmac(
    'sha256',
    env.DASHBOARD_SESSION_SECRET ?? 'disabled'
  )
    .update(value)
    .digest('base64url');
}

function encodeSession(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      exp: Date.now() + SESSION_TTL_MS
    })
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function decodeSession(
  raw: string | undefined
): { userId: string } | undefined {
  if (!raw) return undefined;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return undefined;

  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as {
      userId?: string;
      exp?: number;
    };

    if (
      !parsed.userId ||
      !parsed.exp ||
      parsed.exp < Date.now()
    ) {
      return undefined;
    }

    return {
      userId: parsed.userId
    };
  } catch {
    return undefined;
  }
}

function secureCookie(
  name: string,
  value: string,
  maxAgeSeconds: number
): string {
  return `${name}=${encodeURIComponent(value)}; Path=/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAgeSeconds}`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!dashboardEnabled()) {
    res.status(503).json({
      error: 'TD AI dashboard is not configured yet.'
    });
    return;
  }

  const session = decodeSession(
    parseCookies(req)[SESSION_COOKIE]
  );

  if (!session) {
    res.status(401).json({
      error: 'Not authenticated.'
    });
    return;
  }

  res.locals.dashboardUserId = session.userId;
  next();
}

function requireAdmin(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = String(
    res.locals.dashboardUserId ?? ''
  );

  void isAdminUser(userId)
    .then((admin) => {
      if (!admin) {
        res.status(403).json({
          error: 'Admin access is required.'
        });
        return;
      }

      next();
    })
    .catch((error) => {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Could not verify admin access.'
      });
    });
}

function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const base = dashboardBaseUrl();
  const origin = req.headers.origin;

  if (!base || !origin) {
    next();
    return;
  }

  try {
    if (
      new URL(origin).origin !==
      new URL(base).origin
    ) {
      res.status(403).json({
        error: 'Invalid origin.'
      });
      return;
    }
  } catch {
    res.status(403).json({
      error: 'Invalid origin.'
    });
    return;
  }

  next();
}

function commonCss(): string {
  return `
:root{
  --bg:#070a10;--surface:#0c111c;--surface2:#101827;--surface3:#151f31;
  --line:#22314a;--text:#f7f9fc;--muted:#8ea1bd;--cyan:#47d7ff;
  --violet:#8b75ff;--green:#4fe0a2;--yellow:#f5c65b;--red:#ff7184;
  --shadow:0 24px 70px rgba(0,0,0,.28)
}
*{box-sizing:border-box}
html{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",Tahoma,sans-serif;background:var(--bg);color:var(--text)}
body{margin:0;min-height:100vh;background:
radial-gradient(circle at 10% -10%,rgba(71,215,255,.13),transparent 31%),
radial-gradient(circle at 94% 2%,rgba(139,117,255,.14),transparent 28%),
var(--bg)}
button,input,select{font:inherit}
.shell{display:grid;grid-template-columns:236px 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;border-right:1px solid var(--line);background:rgba(7,10,16,.9);backdrop-filter:blur(18px);padding:22px 15px}
.brand{display:flex;gap:12px;align-items:center;padding:4px 8px 26px}
.logo{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-weight:900;color:#031018;background:linear-gradient(135deg,var(--cyan),var(--violet));box-shadow:0 12px 32px rgba(71,215,255,.16)}
.brand h1{font-size:18px;margin:0}.brand p{font-size:11px;color:var(--muted);margin:3px 0 0}
.nav{display:grid;gap:7px}.nav button{border:0;background:transparent;color:var(--muted);padding:11px 13px;border-radius:11px;text-align:left;cursor:pointer}
.nav button:hover,.nav button.active{color:var(--text);background:linear-gradient(90deg,rgba(71,215,255,.12),rgba(139,117,255,.08))}
.main{width:100%;max-width:1450px;margin:auto;padding:32px}
.top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}
.top h2{font-size:29px;line-height:1.15;margin:0}.top p{color:var(--muted);margin:6px 0 0}
.logout{border:1px solid var(--line);border-radius:11px;padding:9px 13px;text-decoration:none;color:var(--muted)}
.section{display:none}.section.active{display:block}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
.card{grid-column:span 12;background:linear-gradient(180deg,rgba(16,24,39,.98),rgba(10,16,28,.98));border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:var(--shadow)}
.third{grid-column:span 4}.half{grid-column:span 6}
.card h3{font-size:18px;margin:0 0 5px}.sub{font-size:13px;color:var(--muted);margin:0 0 16px}
.stat{font-size:30px;font-weight:850}.tiny{font-size:12px;color:var(--muted)}
.progress{height:11px;border-radius:999px;background:#060c15;border:1px solid var(--line);overflow:hidden}.progress span{display:block;height:100%;background:linear-gradient(90deg,var(--cyan),var(--violet));width:0}
.plan{background:linear-gradient(180deg,#111b2b,#0b1320);border:1px solid var(--line);border-radius:17px;padding:18px;min-height:250px;position:relative;overflow:hidden}
.plan.recommended:before{content:"POPULAR";position:absolute;right:14px;top:14px;font-size:10px;font-weight:800;letter-spacing:.12em;color:#061018;background:var(--cyan);padding:5px 7px;border-radius:999px}
.plan h3{font-size:21px}.plan .credits{font-size:27px;font-weight:850;margin:16px 0 5px}.feature{display:flex;gap:8px;align-items:center;margin:9px 0;color:#d7e0ee}
.field{display:grid;gap:6px}.field label{font-size:12px;color:var(--muted)}
input,select{width:100%;border:1px solid var(--line);background:#070e19;color:var(--text);padding:10px 11px;border-radius:10px;outline:none}
input:focus,select:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(71,215,255,.08)}
.btn{border:0;border-radius:10px;padding:10px 13px;font-weight:750;cursor:pointer}.primary{background:linear-gradient(135deg,var(--cyan),#7699ff);color:#041018}.secondary{background:#15213a;color:var(--text);border:1px solid var(--line)}.danger{background:rgba(255,113,132,.1);color:#ff9aa7;border:1px solid rgba(255,113,132,.28)}
.notice{padding:13px 14px;border:1px solid rgba(71,215,255,.22);background:rgba(71,215,255,.07);border-radius:12px;color:#d3f4ff}
.warn{padding:13px 14px;border:1px solid rgba(245,198,91,.24);background:rgba(245,198,91,.07);border-radius:12px;color:#ffe9a5}
.formGrid,.settingsGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:13px}.wide{grid-column:1/-1}
.toggle{display:flex;align-items:center;gap:9px;min-height:43px;padding:10px 11px;border:1px solid var(--line);background:#070e19;border-radius:10px}.toggle input{width:auto}
.preview{border:1px solid var(--line);background:#070e19;border-radius:14px;padding:18px;min-height:210px}
.voiceChoice{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.voiceChoice button{background:#0b1423;border:1px solid var(--line);color:var(--text);padding:11px;border-radius:11px;cursor:pointer;text-align:left}.voiceChoice button.selected{border-color:var(--cyan);box-shadow:0 0 0 2px rgba(71,215,255,.08)}
.table{width:100%;border-collapse:collapse}.table th,.table td{padding:10px 8px;border-bottom:1px solid rgba(34,49,74,.65);text-align:left;vertical-align:middle}.table th{font-size:12px;color:var(--muted)}
.route,.provider{display:grid;gap:10px;align-items:end;padding:12px 0;border-top:1px solid rgba(34,49,74,.65)}.route{grid-template-columns:1fr 1fr 1.4fr auto}.provider{grid-template-columns:1.2fr 1fr 1.5fr .8fr auto}.route:first-child,.provider:first-child{border-top:0}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.health{display:flex;gap:8px;align-items:center}.dot{width:8px;height:8px;border-radius:50%;background:var(--green)}.dot.bad{background:var(--red)}.dot.warn{background:var(--yellow)}
.toast{position:fixed;right:22px;bottom:22px;max-width:420px;padding:13px 15px;background:#111b2d;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);transform:translateY(100px);opacity:0;transition:.2s}.toast.show{transform:none;opacity:1}
code{background:#07101d;border:1px solid var(--line);border-radius:6px;padding:2px 6px}
@media(max-width:980px){.shell{grid-template-columns:1fr}.side{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}.nav{grid-template-columns:repeat(3,1fr)}.main{padding:20px}.third,.half{grid-column:span 12}.route,.provider,.formGrid,.settingsGrid{grid-template-columns:1fr}}
`;
}

function userPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<title>TD AI</title>
<style>${commonCss()}</style>
</head>
<body>
<div class="shell">
  <aside class="side">
    <div class="brand"><div class="logo">TD</div><div><h1>TD AI</h1><p>My dashboard</p></div></div>
    <div class="nav">
      <button class="active" data-tab="home">Home</button>
      <button data-tab="plans">Plans</button>
      <button data-tab="personalize">Personalize</button>
    </div>
  </aside>

  <main class="main">
    <div class="top"><div><h2 id="title">Home</h2><p>Plan, credits and personal TD AI settings.</p></div><a class="logout" href="/admin/logout">Log out</a></div>

    <section id="home" class="section active">
      <div class="grid">
        <div class="card third"><p class="sub">Current plan</p><div class="stat" id="planName">—</div></div>
        <div class="card third"><p class="sub">Credits remaining</p><div class="stat" id="remaining">—</div></div>
        <div class="card third"><p class="sub">Monthly usage</p><div class="stat" id="percent">—</div></div>
        <div class="card"><h3>Monthly credits</h3><p class="sub" id="usageLabel">Loading…</p><div class="progress"><span id="usageBar"></span></div></div>
        <div class="card half"><h3>Voice AI</h3><p class="sub">TD only answers after the wake word when Wake Mode is enabled.</p><div class="notice">Say <strong>TD</strong> first. After TD replies, you get a short follow-up window before it goes back to sleep.</div></div>
        <div class="card half"><h3>Live Translation</h3><p class="sub">Two-way voice translation between two languages.</p><div class="notice">Use <code>/voicechat translate</code> and choose your two languages. Translation mode listens continuously while active.</div></div>
      </div>
    </section>

    <section id="plans" class="section"><div class="grid" id="plansGrid"></div></section>

    <section id="personalize" class="section">
      <div class="grid">
        <div class="card half">
          <h3>Text appearance</h3>
          <p class="sub">Discord controls the actual font family. You can choose the Markdown size, spacing and visual style.</p>
          <div class="settingsGrid">
            <div class="field"><label>Heading size</label><select id="headingSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div>
            <div class="field"><label>Spacing</label><select id="density"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="relaxed">Relaxed</option></select></div>
            <label class="toggle"><input type="checkbox" id="showEmojis"/> Show emojis</label>
            <label class="toggle"><input type="checkbox" id="showOriginal"/> Show original-message preview</label>
          </div>
          <button class="btn primary" id="saveText" style="margin-top:14px">Save text style</button>
        </div>

        <div class="card half">
          <h3>Voice</h3>
          <p class="sub">Choose the voice TD uses for your sessions and Listen/TTS.</p>
          <div class="field"><label>Voice</label><select id="voiceName"></select></div>
          <div class="field" style="margin-top:13px"><label>Response delay</label><select id="delay"><option value="0">Instant</option><option value="250">0.25 sec</option><option value="500">0.5 sec</option><option value="1000">1 sec</option><option value="1500">1.5 sec</option><option value="2000">2 sec</option><option value="3000">3 sec</option></select></div>
          <button class="btn primary" id="saveVoice" style="margin-top:14px">Save voice settings</button>
        </div>

        <div class="card">
          <h3>Preview</h3>
          <p class="sub">Approximate Discord Markdown preview.</p>
          <div class="preview" id="preview"></div>
        </div>
      </div>
    </section>
  </main>
</div>
<div class="toast" id="toast"></div>
<script>
const $=s=>document.querySelector(s);
let me=null,prefs=null,plans=[];
function fmt(n){return Number(n||0).toLocaleString()}
function toast(msg,bad=false){const t=$('#toast');t.textContent=msg;t.style.borderColor=bad?'var(--red)':'var(--line)';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
async function api(url,options={}){const r=await fetch(url,{headers:{'content-type':'application/json',...(options.headers||{})},...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}
function tab(id){document.querySelectorAll('.nav button,.section').forEach(x=>x.classList.remove('active'));document.querySelector('[data-tab="'+id+'"]')?.classList.add('active');$('#'+id)?.classList.add('active');$('#title').textContent=document.querySelector('[data-tab="'+id+'"]')?.textContent||id}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
function renderHome(){const u=me.usage;$('#planName').textContent=u.plan.name;$('#remaining').textContent=fmt(u.remaining);$('#percent').textContent=u.percent+'%';$('#usageLabel').textContent=fmt(u.used)+' / '+fmt(u.allowance)+' credits — resets '+new Date(u.account.periodEnd).toLocaleDateString();$('#usageBar').style.width=Math.min(100,u.percent)+'%'}
function renderPlans(){$('#plansGrid').innerHTML=plans.map((p,i)=>'<div class="card third"><div class="plan '+(i===1?'recommended':'')+'"><h3>'+p.name+'</h3><div class="credits">'+fmt(p.monthlyCredits)+'</div><div class="tiny">credits / month</div><div class="feature">✓ Voice AI</div><div class="feature">'+(p.liveTranslation?'✓':'—')+' Live Translation</div><div class="feature">✓ Thinking up to '+p.maxThinking+'</div><button class="btn '+(me.usage.account.planId===p.id?'secondary':'primary')+'" style="margin-top:15px;width:100%" disabled>'+(me.usage.account.planId===p.id?'Current plan':'Upgrade coming soon')+'</button></div></div>').join('')}
function renderPrefs(){const voices=me.voices||[];$('#voiceName').innerHTML=voices.map(v=>'<option value="'+v+'">'+v+'</option>').join('');$('#headingSize').value=prefs.headingSize;$('#density').value=prefs.density;$('#showEmojis').checked=prefs.showEmojis;$('#showOriginal').checked=prefs.showOriginal;$('#voiceName').value=prefs.voiceName;$('#delay').value=String(prefs.responseDelayMs);preview()}
function preview(){const size=$('#headingSize').value;const density=$('#density').value;const emojis=$('#showEmojis').checked;const original=$('#showOriginal').checked;const h=size==='large'?'28px':size==='small'?'18px':'22px';const gap=density==='compact'?'8px':density==='relaxed'?'22px':'14px';$('#preview').innerHTML='<div style="font-weight:850;font-size:'+h+';margin-bottom:'+gap+'">'+(emojis?'🌐 ':'')+'English</div><div>Your translated message will look clean and readable here.</div>'+(original?'<div class="tiny" style="margin-top:'+gap+'">Original message preview</div>':'')}
['headingSize','density','showEmojis','showOriginal'].forEach(id=>$('#'+id).addEventListener('input',preview));
async function save(){prefs=await api('/admin/api/personalization',{method:'PUT',body:JSON.stringify({headingSize:$('#headingSize').value,density:$('#density').value,showEmojis:$('#showEmojis').checked,showOriginal:$('#showOriginal').checked,voiceName:$('#voiceName').value,responseDelayMs:Number($('#delay').value)})});renderPrefs();toast('Saved')}
$('#saveText').onclick=()=>save().catch(e=>toast(e.message,true));$('#saveVoice').onclick=()=>save().catch(e=>toast(e.message,true));
Promise.all([api('/admin/api/me'),api('/admin/api/personalization')]).then(([m,p])=>{me=m;prefs=p;plans=m.plans;renderHome();renderPlans();renderPrefs()}).catch(e=>toast(e.message,true));
</script>
</body>
</html>`;
}

function adminPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="dark"/><title>TD AI Admin</title><style>${commonCss()}</style></head>
<body>
<div class="shell">
<aside class="side">
  <div class="brand"><div class="logo">TD</div><div><h1>TD AI</h1><p>Admin control center</p></div></div>
  <div class="nav">
    <button class="active" data-tab="overview">Overview</button>
    <button data-tab="users">Users & Plans</button>
    <button data-tab="routing">AI Routing</button>
    <button data-tab="providers">Providers & APIs</button>
    <button data-tab="voice">Voice System</button>
    <button data-tab="health">Provider Health</button>
  </div>
</aside>
<main class="main">
<div class="top"><div><h2 id="title">Overview</h2><p>Private system controls. Normal users never receive this page.</p></div><a class="logout" href="/admin/logout">Log out</a></div>

<section id="overview" class="section active"><div class="grid">
<div class="card third"><p class="sub">Registered users</p><div class="stat" id="userCount">—</div></div>
<div class="card third"><p class="sub">AI routes</p><div class="stat" id="routeCount">—</div></div>
<div class="card third"><p class="sub">Providers</p><div class="stat" id="providerCount">—</div></div>
<div class="card half"><h3>Admin separation</h3><p class="sub">AI models, provider keys and system routing are server-side admin controls only.</p><div class="notice">Users see only Home, Plans and Personalize.</div></div>
<div class="card half"><h3>Voice reliability</h3><p class="sub">Wake Mode keeps Gemini Live as the speaking engine and uses STT only to gate wake words/host actions.</p><div class="notice">This removes normal conversation dependence on the separate TTS pipeline.</div></div>
</div></section>

<section id="users" class="section"><div class="grid">
<div class="card"><h3>Users</h3><p class="sub">Manage plan, role, credits and account status by Discord User ID.</p><div class="row" style="margin-bottom:12px"><input id="newUserId" placeholder="Discord User ID" style="max-width:320px"/><button class="btn secondary" id="openUser">Open / Create</button></div><div style="overflow:auto"><table class="table"><thead><tr><th>ID</th><th>Role</th><th>Plan</th><th>Status</th><th>Used</th><th>Bonus</th><th>Suspended</th><th>Actions</th></tr></thead><tbody id="usersBody"></tbody></table></div></div>
<div class="card"><h3>Plan configuration</h3><p class="sub">Payment remains disconnected while the product is being tested.</p><div id="adminPlans"></div></div>
</div></section>

<section id="routing" class="section"><div class="card"><h3>AI Routing</h3><p class="sub">Admin only. Use <code>primary | fallback-1 | fallback-2</code>.</p><div id="routes"></div></div></section>

<section id="providers" class="section"><div class="grid">
<div class="card"><h3>Providers</h3><div id="providerList"></div></div>
<div class="card"><h3>Add provider</h3><form id="providerForm" class="formGrid"><div class="field"><label>Name</label><input name="name" required/></div><div class="field"><label>Type</label><select name="kind"><option value="openai-compatible">OpenAI-compatible</option><option value="gemini-native">Gemini Native</option></select></div><div class="field wide" id="urlField"><label>API URL</label><input name="apiUrl"/></div><div class="field wide"><label>API Key</label><input type="password" name="apiKey" autocomplete="new-password" required/></div><button class="btn primary wide">Save provider</button></form></div>
</div></section>

<section id="voice" class="section"><div class="grid">
<div class="card half"><h3>Voice engine</h3><div class="settingsGrid"><div class="field"><label>Thinking</label><select id="thinking"><option>minimal</option><option>low</option><option>medium</option><option>high</option></select></div><div class="field"><label>Who can talk</label><select id="speakerAccess"><option value="everyone">Everyone</option><option value="owner-only">Owner only</option></select></div><div class="field"><label>Global Live voice fallback</label><input id="liveVoice"/></div><div class="field"><label>Global TTS voice fallback</label><input id="ttsVoice"/></div><div class="field wide"><label>End-of-speech silence ms</label><input id="silence" type="number"/></div></div><button class="btn primary" id="saveVoice" style="margin-top:14px">Save engine</button></div>
<div class="card half"><h3>Wake defaults</h3><div class="settingsGrid"><div class="field"><label>Activation</label><select id="activationMode"><option value="wake-word">Wake word</option><option value="always">Always listening</option></select></div><div class="field"><label>Follow-up speaker</label><select id="followupSpeaker"><option value="same">Same speaker</option><option value="anyone">Anyone</option></select></div><div class="field wide"><label>Wake words</label><input id="wakeWords"/></div><div class="field"><label>Wake window ms</label><input id="wakeWindowMs" type="number"/></div><div class="field"><label>Follow-up window ms</label><input id="followupWindowMs" type="number"/></div></div><button class="btn primary" id="saveWake" style="margin-top:14px">Save wake defaults</button></div>
</div></section>

<section id="health" class="section"><div class="card"><h3>Provider Health</h3><p class="sub">Observed model health and rate-limit state.</p><div id="healthList"></div></div></section>
</main>
</div>
<div class="toast" id="toast"></div>
<script>
const $=s=>document.querySelector(s);let me,runtime,users,plans,health,voice;
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}function fmt(n){return Number(n||0).toLocaleString()}function toast(m,b=false){const t=$('#toast');t.textContent=m;t.style.borderColor=b?'var(--red)':'var(--line)';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}async function api(u,o={}){const r=await fetch(u,{headers:{'content-type':'application/json',...(o.headers||{})},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}function tab(id){document.querySelectorAll('.nav button,.section').forEach(x=>x.classList.remove('active'));document.querySelector('[data-tab="'+id+'"]')?.classList.add('active');$('#'+id)?.classList.add('active');$('#title').textContent=document.querySelector('[data-tab="'+id+'"]')?.textContent||id}document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
function providersFor(k){return runtime.providers.filter(p=>p.kind===k&&p.enabled)}
function render(){plans=me.plans;$('#userCount').textContent=users.length;$('#routeCount').textContent=runtime.tasks.length;$('#providerCount').textContent=runtime.providers.length;
$('#routes').innerHTML=runtime.tasks.map(t=>{const r=runtime.routes[t.id]||{};return '<div class="route"><div><strong>'+esc(t.label)+'</strong><div class="tiny">'+esc(t.id)+'</div></div><div class="field"><label>Provider</label><select data-provider="'+esc(t.id)+'">'+providersFor(t.kind).map(p=>'<option value="'+esc(p.id)+'" '+(r.providerId===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></div><div class="field"><label>Model chain</label><input data-model="'+esc(t.id)+'" value="'+esc(r.model||'')+'"/></div><button class="btn secondary" data-save-route="'+esc(t.id)+'">Save</button></div>'}).join('');
$('#providerList').innerHTML=runtime.providers.map(p=>'<div class="provider"><div><strong>'+esc(p.name)+'</strong><div class="tiny">'+esc(p.id)+'</div></div><div>'+esc(p.kind)+'</div><div class="tiny">'+esc(p.apiUrl||'Gemini native')+'</div><div>'+esc(p.apiKeyHint)+'</div><div>'+(p.builtIn?'Built-in':'<button class="btn danger" data-remove-provider="'+esc(p.id)+'">Delete</button>')+'</div></div>').join('');
$('#usersBody').innerHTML=users.map(row=>{const a=row.account;return '<tr data-user="'+esc(a.discordUserId)+'"><td><code>'+esc(a.discordUserId)+'</code></td><td><select data-role><option value="user" '+(a.role==='user'?'selected':'')+'>user</option><option value="admin" '+(a.role==='admin'?'selected':'')+'>admin</option></select></td><td><select data-plan>'+plans.map(p=>'<option value="'+p.id+'" '+(a.planId===p.id?'selected':'')+'>'+p.name+'</option>').join('')+'</select></td><td><select data-status><option value="active" '+(a.subscriptionStatus==='active'?'selected':'')+'>active</option><option value="paused" '+(a.subscriptionStatus==='paused'?'selected':'')+'>paused</option><option value="expired" '+(a.subscriptionStatus==='expired'?'selected':'')+'>expired</option></select></td><td><input data-used type="number" value="'+a.creditsUsed+'"/></td><td><input data-bonus type="number" value="'+a.bonusCredits+'"/></td><td><input data-disabled type="checkbox" '+(a.disabled?'checked':'')+'/></td><td><div class="row"><button class="btn secondary" data-save-user>Save</button><button class="btn danger" data-reset-user>Reset</button></div></td></tr>'}).join('');
$('#adminPlans').innerHTML=plans.map(p=>'<div class="route" data-plan-row="'+p.id+'"><div><strong>'+p.name+'</strong><div class="tiny">'+p.id+'</div></div><div class="field"><label>Monthly credits</label><input data-credits type="number" value="'+p.monthlyCredits+'"/></div><div class="field"><label>Max thinking</label><select data-thinking><option value="minimal" '+(p.maxThinking==='minimal'?'selected':'')+'>minimal</option><option value="low" '+(p.maxThinking==='low'?'selected':'')+'>low</option><option value="medium" '+(p.maxThinking==='medium'?'selected':'')+'>medium</option><option value="high" '+(p.maxThinking==='high'?'selected':'')+'>high</option></select></div><div><label class="toggle"><input data-voice type="checkbox" '+(p.voiceAi?'checked':'')+'/> Voice</label><label class="toggle"><input data-live type="checkbox" '+(p.liveTranslation?'checked':'')+'/> Live translation</label><button class="btn secondary" data-save-plan style="margin-top:7px">Save</button></div></div>').join('');
$('#thinking').value=runtime.voice.thinkingLevel;$('#speakerAccess').value=runtime.voice.speakerAccess;$('#liveVoice').value=runtime.voice.liveVoice;$('#ttsVoice').value=runtime.voice.ttsVoice;$('#silence').value=runtime.voice.silenceMs;$('#activationMode').value=voice.activationMode;$('#followupSpeaker').value=voice.followupSpeaker;$('#wakeWords').value=voice.wakeWords.join(', ');$('#wakeWindowMs').value=voice.wakeWindowMs;$('#followupWindowMs').value=voice.followupWindowMs;
$('#healthList').innerHTML=health.map(h=>'<div class="provider"><div><strong>'+esc(h.provider)+'</strong><div class="tiny">'+esc(h.model)+'</div></div><div class="health"><span class="dot '+(h.status==='healthy'?'':h.status==='busy'?'warn':'bad')+'"></span>'+esc(h.status)+'</div><div class="tiny">'+esc(h.lastMessage||'OK')+'</div><div>'+esc(h.lastStatusCode||'—')+'</div><div class="tiny">'+new Date(h.lastUpdatedAt).toLocaleString()+'</div></div>').join('')||'<div class="tiny">No provider events yet.</div>'}
async function refresh(){[me,runtime,users,health,voice]=await Promise.all([api('/admin/api/me'),api('/admin/api/config'),api('/admin/api/users'),api('/admin/api/provider-health'),api('/admin/api/voice-control')]);render()}
document.addEventListener('click',async e=>{const sr=e.target.closest('[data-save-route]');if(sr){const t=sr.dataset.saveRoute;try{await api('/admin/api/routes/'+encodeURIComponent(t),{method:'PUT',body:JSON.stringify({providerId:document.querySelector('[data-provider="'+CSS.escape(t)+'"]').value,model:document.querySelector('[data-model="'+CSS.escape(t)+'"]').value})});toast('Route saved');await refresh()}catch(x){toast(x.message,true)}return}const rp=e.target.closest('[data-remove-provider]');if(rp){if(!confirm('Delete provider?'))return;try{await api('/admin/api/providers/'+encodeURIComponent(rp.dataset.removeProvider),{method:'DELETE'});toast('Deleted');await refresh()}catch(x){toast(x.message,true)}return}const su=e.target.closest('[data-save-user]');if(su){const tr=su.closest('tr'),id=tr.dataset.user;try{await api('/admin/api/users/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({role:tr.querySelector('[data-role]').value,planId:tr.querySelector('[data-plan]').value,subscriptionStatus:tr.querySelector('[data-status]').value,creditsUsed:Number(tr.querySelector('[data-used]').value),bonusCredits:Number(tr.querySelector('[data-bonus]').value),disabled:tr.querySelector('[data-disabled]').checked})});toast('User saved');await refresh()}catch(x){toast(x.message,true)}return}const ru=e.target.closest('[data-reset-user]');if(ru){const id=ru.closest('tr').dataset.user;try{await api('/admin/api/users/'+encodeURIComponent(id)+'/reset',{method:'POST',body:'{}'});toast('Usage reset');await refresh()}catch(x){toast(x.message,true)}return}const sp=e.target.closest('[data-save-plan]');if(sp){const r=sp.closest('[data-plan-row]'),id=r.dataset.planRow;try{await api('/admin/api/plans/'+id,{method:'PUT',body:JSON.stringify({monthlyCredits:Number(r.querySelector('[data-credits]').value),maxThinking:r.querySelector('[data-thinking]').value,voiceAi:r.querySelector('[data-voice]').checked,liveTranslation:r.querySelector('[data-live]').checked})});toast('Plan saved');await refresh()}catch(x){toast(x.message,true)}}});
$('#providerForm').onsubmit=async e=>{e.preventDefault();try{await api('/admin/api/providers',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});e.target.reset();toast('Provider saved');await refresh()}catch(x){toast(x.message,true)}};$('#providerForm select[name="kind"]').onchange=e=>$('#urlField').style.display=e.target.value==='gemini-native'?'none':'grid';
$('#saveVoice').onclick=async()=>{try{await api('/admin/api/voice',{method:'PUT',body:JSON.stringify({thinkingLevel:$('#thinking').value,speakerAccess:$('#speakerAccess').value,liveVoice:$('#liveVoice').value,ttsVoice:$('#ttsVoice').value,silenceMs:Number($('#silence').value)})});toast('Voice system saved');await refresh()}catch(x){toast(x.message,true)}};
$('#saveWake').onclick=async()=>{try{await api('/admin/api/voice-control',{method:'PUT',body:JSON.stringify({activationMode:$('#activationMode').value,followupSpeaker:$('#followupSpeaker').value,wakeWords:$('#wakeWords').value.split(',').map(x=>x.trim()).filter(Boolean),wakeWindowMs:Number($('#wakeWindowMs').value),followupWindowMs:Number($('#followupWindowMs').value)})});toast('Wake defaults saved');await refresh()}catch(x){toast(x.message,true)}};
$('#openUser').onclick=async()=>{const id=$('#newUserId').value.trim();if(!id)return toast('Enter a Discord User ID',true);try{await api('/admin/api/users/'+encodeURIComponent(id),{method:'PUT',body:'{}'});toast('User opened');await refresh()}catch(x){toast(x.message,true)}};
refresh().catch(e=>toast(e.message,true));
</script>
</body></html>`;
}

export function registerAdminDashboard(
  app: Express
): void {
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
    );
    next();
  });

  router.get('/login', (_req, res) => {
    if (!dashboardEnabled()) {
      res.status(503).send(
        'TD AI dashboard is not configured.'
      );
      return;
    }

    const state =
      randomBytes(24).toString('base64url');

    res.setHeader(
      'Set-Cookie',
      secureCookie(
        STATE_COOKIE,
        state,
        600
      )
    );

    const redirectUri =
      `${dashboardBaseUrl()!.replace(/\/$/, '')}/admin/callback`;

    const url =
      new URL(
        'https://discord.com/oauth2/authorize'
      );

    url.searchParams.set(
      'client_id',
      env.DISCORD_APP_ID
    );
    url.searchParams.set(
      'response_type',
      'code'
    );
    url.searchParams.set(
      'scope',
      'identify'
    );
    url.searchParams.set(
      'redirect_uri',
      redirectUri
    );
    url.searchParams.set(
      'state',
      state
    );

    res.redirect(url.toString());
  });

  router.get('/callback', async (req, res) => {
    try {
      if (!dashboardEnabled()) {
        throw new Error(
          'TD AI dashboard is disabled.'
        );
      }

      const code =
        typeof req.query.code === 'string'
          ? req.query.code
          : '';

      const state =
        typeof req.query.state === 'string'
          ? req.query.state
          : '';

      const expectedState =
        parseCookies(req)[STATE_COOKIE];

      if (
        !code ||
        !state ||
        !expectedState ||
        state !== expectedState
      ) {
        throw new Error(
          'Invalid OAuth state.'
        );
      }

      const redirectUri =
        `${dashboardBaseUrl()!.replace(/\/$/, '')}/admin/callback`;

      const tokenResponse =
        await fetch(
          'https://discord.com/api/v10/oauth2/token',
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              client_id:
                env.DISCORD_APP_ID,
              client_secret:
                env.DISCORD_CLIENT_SECRET!,
              grant_type:
                'authorization_code',
              code,
              redirect_uri:
                redirectUri
            }),
            signal:
              AbortSignal.timeout(15_000)
          }
        );

      if (!tokenResponse.ok) {
        throw new Error(
          `Discord OAuth failed (${tokenResponse.status}).`
        );
      }

      const token =
        await tokenResponse.json() as {
          access_token?: string
        };

      if (!token.access_token) {
        throw new Error(
          'Discord did not return an access token.'
        );
      }

      const userResponse =
        await fetch(
          'https://discord.com/api/v10/users/@me',
          {
            headers: {
              authorization:
                `Bearer ${token.access_token}`
            },
            signal:
              AbortSignal.timeout(15_000)
          }
        );

      if (!userResponse.ok) {
        throw new Error(
          'Could not read Discord identity.'
        );
      }

      const user =
        await userResponse.json() as {
          id?: string
        };

      if (!user.id) {
        throw new Error(
          'Discord identity does not contain a user ID.'
        );
      }

      await userUsageSummary(user.id);

      res.setHeader(
        'Set-Cookie',
        [
          secureCookie(
            SESSION_COOKIE,
            encodeSession(user.id),
            Math.floor(
              SESSION_TTL_MS / 1000
            )
          ),
          clearCookie(
            STATE_COOKIE
          )
        ]
      );

      res.redirect('/admin');
    } catch (error) {
      res.status(400).send(
        `TD AI login failed: ${
          error instanceof Error
            ? error.message
            : 'Unknown error'
        }`
      );
    }
  });

  router.get('/logout', (_req, res) => {
    res.setHeader(
      'Set-Cookie',
      clearCookie(
        SESSION_COOKIE
      )
    );

    res.redirect('/admin/login');
  });

  router.get('/', async (req, res) => {
    if (!dashboardEnabled()) {
      res.status(503).send(
        'TD AI dashboard is not configured.'
      );
      return;
    }

    const session =
      decodeSession(
        parseCookies(req)[SESSION_COOKIE]
      );

    if (!session) {
      res.redirect('/admin/login');
      return;
    }

    const admin =
      await isAdminUser(
        session.userId
      ).catch(() => false);

    res
      .type('html')
      .send(
        admin
          ? adminPage()
          : userPage()
      );
  });

  router.use(
    '/api',
    express.json({
      limit: '64kb'
    }),
    requireAuth,
    requireSameOrigin
  );

  router.get('/api/me', async (_req, res) => {
    try {
      const userId =
        String(
          res.locals.dashboardUserId
        );

      res.json({
        userId,
        admin:
          await isAdminUser(userId),
        usage:
          await userUsageSummary(userId),
        plans:
          await listPlans(),
        voices:
          [...ALLOWED_VOICES]
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Could not load account.'
      });
    }
  });

  router.get(
    '/api/personalization',
    async (_req, res) => {
      const userId =
        String(
          res.locals.dashboardUserId
        );

      res.json(
        await getUserPersonalization(
          userId
        )
      );
    }
  );

  router.put(
    '/api/personalization',
    async (req, res) => {
      try {
        const userId =
          String(
            res.locals.dashboardUserId
          );

        const result =
          await setUserPersonalization(
            userId,
            {
              headingSize:
                req.body.headingSize as UserHeadingSize,
              density:
                req.body.density as UserDensity,
              showEmojis:
                req.body.showEmojis !== false,
              showOriginal:
                req.body.showOriginal !== false,
              voiceName:
                typeof req.body.voiceName === 'string'
                  ? req.body.voiceName
                  : undefined,
              responseDelayMs:
                req.body.responseDelayMs === undefined
                  ? undefined
                  : Number(req.body.responseDelayMs)
            }
          );

        res.json(result);
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not save personalization.'
        });
      }
    }
  );

  router.get(
    '/api/config',
    requireAdmin,
    async (_req, res) => {
      try {
        res.json(
          await getAdminRuntimeSnapshot()
        );
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not load configuration.'
        });
      }
    }
  );

  router.get(
    '/api/voice-control',
    requireAdmin,
    async (_req, res) => {
      res.json(
        await getVoiceControlSettings()
      );
    }
  );

  router.put(
    '/api/voice-control',
    requireAdmin,
    async (req, res) => {
      try {
        res.json(
          await setVoiceControlSettings({
            activationMode:
              req.body.activationMode as VoiceActivationMode,
            wakeWords:
              Array.isArray(req.body.wakeWords)
                ? req.body.wakeWords.map(String)
                : undefined,
            wakeResponse:
              typeof req.body.wakeResponse === 'string'
                ? req.body.wakeResponse
                : undefined,
            wakeWindowMs:
              req.body.wakeWindowMs === undefined
                ? undefined
                : Number(req.body.wakeWindowMs),
            followupWindowMs:
              req.body.followupWindowMs === undefined
                ? undefined
                : Number(req.body.followupWindowMs),
            followupSpeaker:
              req.body.followupSpeaker as FollowupSpeaker,
            productMode:
              req.body.productMode as VoiceProductMode,
            translationLanguageA:
              typeof req.body.translationLanguageA === 'string'
                ? req.body.translationLanguageA
                : undefined,
            translationLanguageB:
              typeof req.body.translationLanguageB === 'string'
                ? req.body.translationLanguageB
                : undefined,
            translationQuality:
              req.body.translationQuality as TranslationQuality,
            translationOutput:
              req.body.translationOutput as TranslationOutput
          })
        );
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not save voice control.'
        });
      }
    }
  );

  router.get(
    '/api/users',
    requireAdmin,
    async (_req, res) => {
      res.json(
        await listUsers()
      );
    }
  );

  router.put(
    '/api/users/:id',
    requireAdmin,
    async (req, res) => {
      try {
        res.json(
          await adminUpdateUser(
            String(
              req.params.id ?? ''
            ),
            {
              role:
                req.body.role as AccountRole | undefined,
              planId:
                req.body.planId as PlanId | undefined,
              subscriptionStatus:
                req.body.subscriptionStatus as SubscriptionStatus | undefined,
              bonusCredits:
                req.body.bonusCredits === undefined
                  ? undefined
                  : Number(req.body.bonusCredits),
              creditsUsed:
                req.body.creditsUsed === undefined
                  ? undefined
                  : Number(req.body.creditsUsed),
              expiresAt:
                typeof req.body.expiresAt === 'string'
                  ? req.body.expiresAt
                  : undefined,
              disabled:
                req.body.disabled === true
            }
          )
        );
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not update user.'
        });
      }
    }
  );

  router.post(
    '/api/users/:id/reset',
    requireAdmin,
    async (req, res) => {
      try {
        await resetUserUsage(
          String(
            req.params.id ?? ''
          )
        );

        res.json({
          ok: true
        });
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not reset usage.'
        });
      }
    }
  );

  router.put(
    '/api/plans/:id',
    requireAdmin,
    async (req, res) => {
      try {
        res.json(
          await updatePlan(
            String(
              req.params.id ?? ''
            ) as PlanId,
            {
              monthlyCredits:
                req.body.monthlyCredits === undefined
                  ? undefined
                  : Number(req.body.monthlyCredits),
              voiceAi:
                req.body.voiceAi === undefined
                  ? undefined
                  : req.body.voiceAi === true,
              liveTranslation:
                req.body.liveTranslation === undefined
                  ? undefined
                  : req.body.liveTranslation === true,
              maxThinking:
                req.body.maxThinking
            }
          )
        );
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not update plan.'
        });
      }
    }
  );

  router.get(
    '/api/provider-health',
    requireAdmin,
    async (_req, res) => {
      res.json(
        await listProviderHealth()
      );
    }
  );

  router.post(
    '/api/providers',
    requireAdmin,
    async (req, res) => {
      try {
        const id =
          await upsertRuntimeProvider({
            id:
              typeof req.body.id === 'string'
                ? req.body.id
                : undefined,
            name:
              String(req.body.name ?? ''),
            kind:
              req.body.kind as ProviderKind,
            apiUrl:
              typeof req.body.apiUrl === 'string'
                ? req.body.apiUrl
                : undefined,
            apiKey:
              typeof req.body.apiKey === 'string'
                ? req.body.apiKey
                : undefined,
            enabled:
              req.body.enabled !== false
          });

        res.json({
          ok: true,
          id
        });
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not save provider.'
        });
      }
    }
  );

  router.delete(
    '/api/providers/:id',
    requireAdmin,
    async (req, res) => {
      try {
        await deleteRuntimeProvider(
          String(
            req.params.id ?? ''
          )
        );

        res.json({
          ok: true
        });
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not delete provider.'
        });
      }
    }
  );

  router.put(
    '/api/routes/:task',
    requireAdmin,
    async (req, res) => {
      try {
        await setRuntimeRoute(
          String(
            req.params.task ?? ''
          ) as RuntimeTask,
          {
            providerId:
              String(
                req.body.providerId ?? ''
              ),
            model:
              String(
                req.body.model ?? ''
              )
          }
        );

        res.json({
          ok: true
        });
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not update route.'
        });
      }
    }
  );

  router.put(
    '/api/voice',
    requireAdmin,
    async (req, res) => {
      try {
        await setVoiceRuntimeSettings({
          thinkingLevel:
            req.body.thinkingLevel as ThinkingLevelName,
          silenceMs:
            Number(
              req.body.silenceMs
            ),
          liveVoice:
            String(
              req.body.liveVoice ?? ''
            ),
          ttsVoice:
            String(
              req.body.ttsVoice ?? ''
            ),
          speakerAccess:
            req.body.speakerAccess as VoiceSpeakerAccess
        });

        res.json({
          ok: true
        });
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not update voice settings.'
        });
      }
    }
  );

  router.put(
    '/api/display',
    requireAdmin,
    async (req, res) => {
      try {
        await setDisplayRuntimeSettings({
          headingSize:
            req.body.headingSize as DisplayHeadingSize,
          density:
            req.body.density as DisplayDensity,
          divider:
            req.body.divider as DisplayDivider,
          showEmojis:
            req.body.showEmojis !== false,
          showDetectedLanguage:
            req.body.showDetectedLanguage !== false,
          showProvider:
            req.body.showProvider === true,
          showOriginal:
            req.body.showOriginal !== false,
          quoteArabic:
            req.body.quoteArabic !== false,
          originalPreviewChars:
            Number(
              req.body.originalPreviewChars
            ),
          smartAnswerArabicFirst:
            req.body.smartAnswerArabicFirst !== false
        });

        res.json({
          ok: true
        });
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not update display settings.'
        });
      }
    }
  );

  app.use(
    '/admin',
    router
  );
}
