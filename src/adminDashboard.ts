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

    if (!parsed.userId || !parsed.exp || parsed.exp < Date.now()) {
      return undefined;
    }

    return { userId: parsed.userId };
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
  const userId = String(res.locals.dashboardUserId ?? '');

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
        error: error instanceof Error
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
    if (new URL(origin).origin !== new URL(base).origin) {
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

function dashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>TD AI Dashboard</title>
<style>
:root{
  --bg:#070b13;
  --panel:#0d1422;
  --panel2:#111b2d;
  --line:#22314c;
  --text:#f6f8fc;
  --muted:#91a2bd;
  --cyan:#37d7ff;
  --violet:#8d70ff;
  --green:#46dfa1;
  --yellow:#f4c95d;
  --red:#ff6f7f;
}
*{box-sizing:border-box}
html{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",Tahoma,sans-serif;background:var(--bg);color:var(--text)}
body{margin:0;background:radial-gradient(circle at 12% 0,rgba(55,215,255,.12),transparent 30%),radial-gradient(circle at 90% 0,rgba(141,112,255,.14),transparent 28%),var(--bg);min-height:100vh}
button,input,select{font:inherit}
.shell{display:grid;grid-template-columns:245px 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;padding:24px 16px;background:rgba(7,11,19,.9);border-right:1px solid var(--line);backdrop-filter:blur(18px)}
.brand{display:flex;align-items:center;gap:12px;padding:0 8px 24px}
.logo{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-weight:900;color:#051018;background:linear-gradient(135deg,var(--cyan),var(--violet))}
.brand h1{margin:0;font-size:18px}.brand p{margin:2px 0 0;font-size:12px;color:var(--muted)}
.badge{display:inline-flex;padding:4px 8px;border:1px solid var(--line);border-radius:999px;font-size:11px;color:var(--muted)}
.nav{display:grid;gap:6px}
.nav button{background:transparent;border:0;color:var(--muted);text-align:left;padding:11px 13px;border-radius:11px;cursor:pointer}
.nav button:hover,.nav button.active{background:linear-gradient(90deg,rgba(55,215,255,.12),rgba(141,112,255,.08));color:var(--text)}
.nav .adminOnly{display:none}.nav.admin .adminOnly{display:block}
.main{max-width:1450px;width:100%;margin:auto;padding:32px}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px}
.top h2{font-size:30px;margin:0}.top p{color:var(--muted);margin:6px 0 0}
.logout{color:var(--muted);text-decoration:none;border:1px solid var(--line);padding:9px 13px;border-radius:11px}
.section{display:none}.section.active{display:block}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
.card{grid-column:span 12;background:linear-gradient(180deg,rgba(17,27,45,.97),rgba(11,18,31,.97));border:1px solid var(--line);border-radius:18px;padding:20px}
.third{grid-column:span 4}.half{grid-column:span 6}
.card h3{margin:0 0 5px;font-size:18px}.sub{color:var(--muted);font-size:13px;margin:0 0 16px}
.stat{font-size:30px;font-weight:850}.tiny{font-size:12px;color:var(--muted)}
.progress{height:12px;border-radius:999px;background:#070d18;border:1px solid var(--line);overflow:hidden}.progress>span{display:block;height:100%;background:linear-gradient(90deg,var(--cyan),var(--violet));width:0}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.route{display:grid;grid-template-columns:minmax(160px,1fr) minmax(180px,1fr) minmax(240px,1.4fr) auto;gap:10px;align-items:end;padding:13px 0;border-top:1px solid rgba(34,49,76,.7)}
.route:first-child{border-top:0}
.field{display:grid;gap:6px}.field label{color:var(--muted);font-size:12px}
input,select{width:100%;background:#080f1b;color:var(--text);border:1px solid var(--line);padding:10px 11px;border-radius:10px;outline:none}
input:focus,select:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(55,215,255,.08)}
.btn{border:0;border-radius:10px;padding:10px 13px;cursor:pointer;font-weight:750}
.primary{background:linear-gradient(135deg,var(--cyan),#7497ff);color:#041018}
.secondary{background:#15213a;color:var(--text);border:1px solid var(--line)}
.danger{background:rgba(255,111,127,.1);color:#ff95a2;border:1px solid rgba(255,111,127,.3)}
.notice{padding:12px 13px;background:rgba(55,215,255,.07);border:1px solid rgba(55,215,255,.22);border-radius:11px;color:#d1f2ff}
.warn{padding:12px 13px;background:rgba(244,201,93,.07);border:1px solid rgba(244,201,93,.24);border-radius:11px;color:#ffe9a9}
.table{width:100%;border-collapse:collapse}.table th,.table td{padding:11px 8px;border-bottom:1px solid rgba(34,49,76,.65);text-align:left;vertical-align:middle}.table th{color:var(--muted);font-size:12px}
.plan{border:1px solid var(--line);border-radius:15px;padding:17px;background:#09111f}.plan h3{margin:0}.plan .price{font-size:26px;font-weight:850;margin:10px 0}
.featureBar{display:grid;gap:9px}.featureLine{display:grid;grid-template-columns:150px 1fr 90px;gap:10px;align-items:center}
.provider{display:grid;grid-template-columns:1.2fr 1fr 1.6fr .8fr auto;gap:10px;align-items:center;padding:12px 0;border-top:1px solid rgba(34,49,76,.65)}
.voiceGrid,.formGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:13px}.wide{grid-column:1/-1}
.toggle{display:flex;align-items:center;gap:9px;min-height:42px;background:#080f1b;border:1px solid var(--line);border-radius:10px;padding:9px 11px}.toggle input{width:auto}
.health{display:flex;align-items:center;gap:8px}.dot{width:8px;height:8px;border-radius:50%;background:var(--green)}.dot.bad{background:var(--red)}.dot.warn{background:var(--yellow)}
.toast{position:fixed;right:20px;bottom:20px;background:#111c30;border:1px solid var(--line);border-radius:12px;padding:12px 15px;max-width:420px;opacity:0;transform:translateY(100px);transition:.2s}.toast.show{opacity:1;transform:none}
code{background:#07101d;border:1px solid var(--line);padding:2px 6px;border-radius:6px}
@media(max-width:980px){.shell{grid-template-columns:1fr}.side{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}.nav{grid-template-columns:repeat(3,1fr)}.main{padding:20px}.third,.half{grid-column:span 12}.route,.provider{grid-template-columns:1fr}.voiceGrid,.formGrid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="shell">
<aside class="side">
  <div class="brand">
    <div class="logo">TD</div>
    <div><h1>TD AI</h1><p>Control Center</p><span class="badge" id="roleBadge">User</span></div>
  </div>
  <div class="nav" id="nav">
    <button class="active" data-tab="overview">Overview</button>
    <button data-tab="usage">Usage & Credits</button>
    <button data-tab="plans">Plans</button>
    <button class="adminOnly" data-tab="routing">AI Routing</button>
    <button class="adminOnly" data-tab="providers">Providers & APIs</button>
    <button class="adminOnly" data-tab="voice">Voice AI</button>
    <button class="adminOnly" data-tab="display">Display</button>
    <button class="adminOnly" data-tab="users">Admin — Users</button>
    <button class="adminOnly" data-tab="health">Provider Health</button>
  </div>
</aside>

<main class="main">
  <div class="top">
    <div><h2 id="pageTitle">Overview</h2><p id="pageSub">Your TD AI plan, usage and runtime status.</p></div>
    <a class="logout" href="/admin/logout">Log out</a>
  </div>

  <section id="overview" class="section active">
    <div class="grid">
      <div class="card third"><p class="sub">Current plan</p><div class="stat" id="overviewPlan">—</div></div>
      <div class="card third"><p class="sub">Credits remaining</p><div class="stat" id="overviewRemaining">—</div></div>
      <div class="card third"><p class="sub">Monthly usage</p><div class="stat" id="overviewPercent">—</div></div>
      <div class="card">
        <h3>Monthly credits</h3>
        <p class="sub" id="usageLabel">Loading…</p>
        <div class="progress"><span id="usageProgress"></span></div>
      </div>
      <div class="card half">
        <h3>Voice AI</h3>
        <p class="sub">Conversation mode uses wake-word activation by default so TD does not interrupt normal conversations.</p>
        <div class="notice">Say <strong>TD</strong>, then your request. After a reply, the follow-up window stays open briefly and then TD goes back to sleep.</div>
      </div>
      <div class="card half">
        <h3>Live Translation</h3>
        <p class="sub">Two-way voice translation is continuous while translation mode is active.</p>
        <div class="notice">Start with <code>/voicechat translate</code>. Choose two languages, quality, and Voice / Captions / Both.</div>
      </div>
    </div>
  </section>

  <section id="usage" class="section">
    <div class="grid">
      <div class="card">
        <h3>Usage & Credits</h3>
        <p class="sub">One shared credit pool across TD AI features.</p>
        <div class="featureBar" id="featureUsage"></div>
      </div>
      <div class="card half"><h3>Period</h3><p class="sub">Current billing / usage cycle</p><div id="periodInfo"></div></div>
      <div class="card half"><h3>Important</h3><p class="sub">Provider quota and TD AI credits are different.</p><div class="warn">A Gemini 429 means the provider/model is rate-limited. It does not necessarily mean your TD AI plan credits are finished. Model failover handles provider limits separately.</div></div>
    </div>
  </section>

  <section id="plans" class="section">
    <div class="grid" id="planCards"></div>
  </section>

  <section id="routing" class="section">
    <div class="card"><h3>AI Model Routing</h3><p class="sub">Use a model chain like <code>primary | fallback-1 | fallback-2</code>. 429/503 automatically moves to the next model.</p><div id="routes"></div></div>
  </section>

  <section id="providers" class="section">
    <div class="grid">
      <div class="card"><h3>Providers</h3><p class="sub">Saved custom API keys are encrypted server-side.</p><div id="providerList"></div></div>
      <div class="card">
        <h3>Add provider</h3>
        <form id="providerForm" class="formGrid">
          <div class="field"><label>Name</label><input name="name" required placeholder="Gemini Secondary" /></div>
          <div class="field"><label>Type</label><select name="kind"><option value="openai-compatible">OpenAI-compatible Text API</option><option value="gemini-native">Gemini Native</option></select></div>
          <div class="field wide" id="providerUrlField"><label>Chat Completions URL</label><input name="apiUrl" placeholder="https://.../chat/completions" /></div>
          <div class="field wide"><label>API Key</label><input type="password" name="apiKey" autocomplete="new-password" required /></div>
          <button class="btn primary wide">Save Provider</button>
        </form>
      </div>
    </div>
  </section>

  <section id="voice" class="section">
    <div class="grid">
      <div class="card half">
        <h3>Voice Engine</h3>
        <p class="sub">Gemini Live / STT / TTS behavior.</p>
        <div class="voiceGrid">
          <div class="field"><label>Thinking level</label><select id="thinking"><option>minimal</option><option>low</option><option>medium</option><option>high</option></select></div>
          <div class="field"><label>Who can talk</label><select id="speakerAccess"><option value="everyone">Everyone</option><option value="owner-only">Owner only</option></select></div>
          <div class="field"><label>Live voice</label><input id="liveVoice" /></div>
          <div class="field"><label>TTS voice</label><input id="ttsVoice" /></div>
          <div class="field wide"><label>End-of-speech silence (ms)</label><input id="silence" type="number" min="200" max="5000" /></div>
        </div>
        <button class="btn primary" id="saveVoice" style="margin-top:14px">Save Voice Engine</button>
      </div>

      <div class="card half">
        <h3>Activation / Wake Mode</h3>
        <p class="sub">Prevent TD AI from jumping into normal conversation.</p>
        <div class="voiceGrid">
          <div class="field"><label>Activation</label><select id="activationMode"><option value="wake-word">Wake word required</option><option value="always">Always listening</option></select></div>
          <div class="field"><label>Follow-up speaker</label><select id="followupSpeaker"><option value="same">Same speaker</option><option value="anyone">Anyone</option></select></div>
          <div class="field wide"><label>Wake words (comma separated)</label><input id="wakeWords" /></div>
          <div class="field"><label>Wake response</label><input id="wakeResponse" /></div>
          <div class="field"><label>Wake window (ms)</label><input id="wakeWindowMs" type="number" /></div>
          <div class="field"><label>Follow-up window (ms)</label><input id="followupWindowMs" type="number" /></div>
          <label class="toggle"><input id="humanLikeMode" type="checkbox" /> Human-like TTS delivery</label>
        </div>
        <button class="btn primary" id="saveVoiceControl" style="margin-top:14px">Save Activation</button>
      </div>

      <div class="card">
        <h3>Live Translation Defaults</h3>
        <p class="sub">Translation mode is continuous; wake word is not required while it is active.</p>
        <div class="voiceGrid">
          <div class="field"><label>Language A</label><input id="translationLanguageA" placeholder="en" /></div>
          <div class="field"><label>Language B</label><input id="translationLanguageB" placeholder="ar-eg" /></div>
          <div class="field"><label>Quality</label><select id="translationQuality"><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="accurate">Accurate</option></select></div>
          <div class="field"><label>Output</label><select id="translationOutput"><option value="both">Voice + Captions</option><option value="voice">Voice only</option><option value="captions">Captions only</option></select></div>
        </div>
        <button class="btn primary" id="saveTranslationDefaults" style="margin-top:14px">Save Translation Defaults</button>
      </div>
    </div>
  </section>

  <section id="display" class="section">
    <div class="card">
      <h3>Discord Output Studio</h3>
      <p class="sub">Control headings, density, metadata and Arabic layout. Discord still owns the actual font family.</p>
      <div class="voiceGrid">
        <div class="field"><label>Heading size</label><select id="headingSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div>
        <div class="field"><label>Density</label><select id="density"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="relaxed">Relaxed</option></select></div>
        <div class="field"><label>Divider</label><select id="divider"><option value="none">None</option><option value="line">Line</option><option value="spaced">Spaced</option></select></div>
        <div class="field"><label>Original preview chars</label><input id="originalPreviewChars" type="number" /></div>
        <label class="toggle"><input id="showEmojis" type="checkbox" /> Show emojis</label>
        <label class="toggle"><input id="showDetectedLanguage" type="checkbox" /> Show detected language</label>
        <label class="toggle"><input id="showProvider" type="checkbox" /> Show provider</label>
        <label class="toggle"><input id="showOriginal" type="checkbox" /> Show original preview</label>
        <label class="toggle"><input id="quoteArabic" type="checkbox" /> Quote Arabic blocks</label>
        <label class="toggle"><input id="smartAnswerArabicFirst" type="checkbox" /> Arabic explanation first</label>
      </div>
      <button class="btn primary" id="saveDisplay" style="margin-top:14px">Save Display</button>
    </div>
  </section>

  <section id="users" class="section">
    <div class="grid">
      <div class="card">
        <h3>Admin — Users</h3>
        <p class="sub">Manage plan, credits, subscription state and admin role by Discord User ID.</p>
        <div class="row" style="margin-bottom:12px"><input id="userSearchId" placeholder="Discord User ID" style="max-width:330px" /><button class="btn secondary" id="addUser">Open / Create User</button></div>
        <div style="overflow:auto"><table class="table"><thead><tr><th>Discord ID</th><th>Role</th><th>Plan</th><th>Status</th><th>Used</th><th>Bonus</th><th>Suspended</th><th>Actions</th></tr></thead><tbody id="usersBody"></tbody></table></div>
      </div>
      <div class="card">
        <h3>Plan Configuration</h3>
        <p class="sub">Payment is intentionally not connected yet. Plans can be assigned manually while testing.</p>
        <div id="adminPlans"></div>
      </div>
    </div>
  </section>

  <section id="health" class="section">
    <div class="card"><h3>Provider Health</h3><p class="sub">Observed runtime state from model requests. Exact remaining Gemini provider quota is not exposed here; TD AI tracks 429/503 and fallback health.</p><div id="healthList"></div></div>
  </section>
</main>
</div>
<div class="toast" id="toast"></div>

<script>
const $=s=>document.querySelector(s);
let me=null, runtime=null, plans=[], users=[], health=[], voiceControl=null;

function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function toast(msg,bad=false){const t=$('#toast');t.textContent=msg;t.style.borderColor=bad?'var(--red)':'var(--line)';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
async function api(url,options={}){const r=await fetch(url,{headers:{'content-type':'application/json',...(options.headers||{})},...options});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||('HTTP '+r.status));return data}
function fmt(n){return Number(n||0).toLocaleString()}
function featureLabel(k){return ({translation:'Translation',chat:'AI Chat',ai_tools:'AI Tools',smart_reply:'Smart Answer',voice_ai:'Voice AI',live_translation:'Live Translation',stt:'Speech Recognition',tts:'TTS / Listen'})[k]||k}

function selectTab(id){
  document.querySelectorAll('.nav button,.section').forEach(x=>x.classList.remove('active'));
  const b=document.querySelector('[data-tab="'+id+'"]'); if(b)b.classList.add('active');
  const s=$('#'+id); if(s)s.classList.add('active');
  $('#pageTitle').textContent=b?.textContent||id;
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)selectTab(b.dataset.tab)});

function renderMe(){
  $('#roleBadge').textContent=me.admin?'Admin':'User';
  if(me.admin)$('#nav').classList.add('admin');
  const u=me.usage;
  $('#overviewPlan').textContent=u.plan.name;
  $('#overviewRemaining').textContent=fmt(u.remaining);
  $('#overviewPercent').textContent=u.percent+'%';
  $('#usageLabel').textContent=fmt(u.used)+' / '+fmt(u.allowance)+' credits — resets '+new Date(u.account.periodEnd).toLocaleDateString();
  $('#usageProgress').style.width=Math.min(100,u.percent)+'%';
  $('#periodInfo').innerHTML='<div><strong>'+esc(new Date(u.account.periodStart).toLocaleDateString())+'</strong> → <strong>'+esc(new Date(u.account.periodEnd).toLocaleDateString())+'</strong></div><p class="tiny">Subscription: '+esc(u.account.subscriptionStatus)+'</p>';
  const max=Math.max(1,...Object.values(u.byFeature||{}).map(Number));
  $('#featureUsage').innerHTML=Object.entries(u.byFeature||{}).sort((a,b)=>Number(b[1])-Number(a[1])).map(([k,v])=>'<div class="featureLine"><div>'+esc(featureLabel(k))+'</div><div class="progress"><span style="width:'+Math.max(2,Number(v)/max*100)+'%"></span></div><div>'+fmt(v)+'</div></div>').join('')||'<div class="tiny">No metered usage yet.</div>';
}

function renderPlans(){
  $('#planCards').innerHTML=plans.map(p=>'<div class="card third"><div class="plan"><h3>'+esc(p.name)+'</h3><div class="price">'+fmt(p.monthlyCredits)+' <span class="tiny">credits/mo</span></div><p>Voice AI: <strong>'+(p.voiceAi?'Yes':'No')+'</strong></p><p>Live Translation: <strong>'+(p.liveTranslation?'Yes':'No')+'</strong></p><p>Max thinking: <strong>'+esc(p.maxThinking)+'</strong></p></div></div>').join('');
}

function providersFor(kind){return (runtime?.providers||[]).filter(p=>p.kind===kind&&p.enabled)}
function renderRuntime(){
  if(!runtime)return;
  $('#routes').innerHTML=runtime.tasks.map(task=>{
    const route=runtime.routes[task.id]||{};
    const opts=providersFor(task.kind).map(p=>'<option value="'+esc(p.id)+'" '+(route.providerId===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('');
    return '<div class="route"><div><strong>'+esc(task.label)+'</strong><div class="tiny">'+esc(task.id)+'</div></div><div class="field"><label>Provider</label><select data-provider="'+esc(task.id)+'">'+opts+'</select></div><div class="field"><label>Model chain</label><input data-model="'+esc(task.id)+'" value="'+esc(route.model||'')+'" /></div><button class="btn secondary" data-save-route="'+esc(task.id)+'">Save</button></div>';
  }).join('');

  $('#providerList').innerHTML=runtime.providers.map(p=>'<div class="provider"><div><strong>'+esc(p.name)+'</strong><div class="tiny">'+esc(p.id)+'</div></div><div>'+esc(p.kind)+'</div><div class="tiny">'+esc(p.apiUrl||'Gemini native')+'</div><div>'+esc(p.apiKeyHint)+'</div><div>'+(p.builtIn?'Built-in':'<button class="btn danger" data-remove-provider="'+esc(p.id)+'">Delete</button>')+'</div></div>').join('');

  const v=runtime.voice||{};
  $('#thinking').value=v.thinkingLevel||'minimal';
  $('#speakerAccess').value=v.speakerAccess||'everyone';
  $('#liveVoice').value=v.liveVoice||'Kore';
  $('#ttsVoice').value=v.ttsVoice||'Kore';
  $('#silence').value=v.silenceMs||300;

  const d=runtime.display||{};
  $('#headingSize').value=d.headingSize||'medium';
  $('#density').value=d.density||'comfortable';
  $('#divider').value=d.divider||'none';
  $('#originalPreviewChars').value=d.originalPreviewChars||420;
  $('#showEmojis').checked=d.showEmojis!==false;
  $('#showDetectedLanguage').checked=d.showDetectedLanguage!==false;
  $('#showProvider').checked=d.showProvider===true;
  $('#showOriginal').checked=d.showOriginal!==false;
  $('#quoteArabic').checked=d.quoteArabic!==false;
  $('#smartAnswerArabicFirst').checked=d.smartAnswerArabicFirst!==false;
}

function renderVoiceControl(){
  if(!voiceControl)return;
  $('#activationMode').value=voiceControl.activationMode;
  $('#followupSpeaker').value=voiceControl.followupSpeaker;
  $('#wakeWords').value=(voiceControl.wakeWords||[]).join(', ');
  $('#wakeResponse').value=voiceControl.wakeResponse||'Yes?';
  $('#wakeWindowMs').value=voiceControl.wakeWindowMs;
  $('#followupWindowMs').value=voiceControl.followupWindowMs;
  $('#humanLikeMode').checked=voiceControl.humanLikeMode!==false;
  $('#translationLanguageA').value=voiceControl.translationLanguageA;
  $('#translationLanguageB').value=voiceControl.translationLanguageB;
  $('#translationQuality').value=voiceControl.translationQuality;
  $('#translationOutput').value=voiceControl.translationOutput;
}

function renderUsers(){
  $('#usersBody').innerHTML=users.map(row=>{
    const a=row.account;
    return '<tr data-user="'+esc(a.discordUserId)+'"><td><code>'+esc(a.discordUserId)+'</code></td><td><select data-role><option value="user" '+(a.role==='user'?'selected':'')+'>user</option><option value="admin" '+(a.role==='admin'?'selected':'')+'>admin</option></select></td><td><select data-plan>'+plans.map(p=>'<option value="'+p.id+'" '+(a.planId===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></td><td><select data-status><option value="active" '+(a.subscriptionStatus==='active'?'selected':'')+'>active</option><option value="paused" '+(a.subscriptionStatus==='paused'?'selected':'')+'>paused</option><option value="expired" '+(a.subscriptionStatus==='expired'?'selected':'')+'>expired</option></select></td><td><input data-used type="number" value="'+Number(a.creditsUsed||0)+'" /></td><td><input data-bonus type="number" value="'+Number(a.bonusCredits||0)+'" /></td><td><input data-disabled type="checkbox" '+(a.disabled?'checked':'')+' /></td><td><div class="row"><button class="btn secondary" data-save-user>Save</button><button class="btn danger" data-reset-user>Reset usage</button></div></td></tr>';
  }).join('');
}

function renderAdminPlans(){
  $('#adminPlans').innerHTML=plans.map(p=>'<div class="route" data-plan-row="'+esc(p.id)+'"><div><strong>'+esc(p.name)+'</strong><div class="tiny">'+esc(p.id)+'</div></div><div class="field"><label>Monthly credits</label><input data-plan-credits type="number" value="'+p.monthlyCredits+'" /></div><div class="field"><label>Max thinking</label><select data-plan-thinking><option value="minimal" '+(p.maxThinking==='minimal'?'selected':'')+'>minimal</option><option value="low" '+(p.maxThinking==='low'?'selected':'')+'>low</option><option value="medium" '+(p.maxThinking==='medium'?'selected':'')+'>medium</option><option value="high" '+(p.maxThinking==='high'?'selected':'')+'>high</option></select></div><div><label class="toggle"><input data-plan-voice type="checkbox" '+(p.voiceAi?'checked':'')+' /> Voice</label><label class="toggle"><input data-plan-translation type="checkbox" '+(p.liveTranslation?'checked':'')+' /> Live Translation</label><button class="btn secondary" data-save-plan style="margin-top:8px">Save</button></div></div>').join('');
}

function renderHealth(){
  $('#healthList').innerHTML=health.map(h=>{
    const cls=h.status==='healthy'?'':h.status==='busy'?'warn':'bad';
    return '<div class="provider"><div><strong>'+esc(h.provider)+'</strong><div class="tiny">'+esc(h.model)+'</div></div><div class="health"><span class="dot '+cls+'"></span>'+esc(h.status)+'</div><div class="tiny">'+esc(h.lastMessage||'OK')+'</div><div>'+esc(h.lastStatusCode||'—')+'</div><div class="tiny">'+esc(new Date(h.lastUpdatedAt).toLocaleString())+'</div></div>';
  }).join('')||'<div class="tiny">No provider health events yet.</div>';
}

async function load(){
  me=await api('/admin/api/me');
  plans=me.plans;
  renderMe();
  renderPlans();

  if(me.admin){
    [runtime,voiceControl,users,health]=await Promise.all([
      api('/admin/api/config'),
      api('/admin/api/voice-control'),
      api('/admin/api/users'),
      api('/admin/api/provider-health')
    ]);
    renderRuntime();renderVoiceControl();renderUsers();renderAdminPlans();renderHealth();
  }
}

document.addEventListener('click',async e=>{
  const route=e.target.closest('[data-save-route]');
  if(route){
    const task=route.dataset.saveRoute;
    const provider=document.querySelector('[data-provider="'+CSS.escape(task)+'"]');
    const model=document.querySelector('[data-model="'+CSS.escape(task)+'"]');
    try{await api('/admin/api/routes/'+encodeURIComponent(task),{method:'PUT',body:JSON.stringify({providerId:provider.value,model:model.value})});toast('Route saved');runtime=await api('/admin/api/config');renderRuntime()}catch(err){toast(err.message,true)}
    return;
  }

  const remove=e.target.closest('[data-remove-provider]');
  if(remove){
    if(!confirm('Delete this provider?'))return;
    try{await api('/admin/api/providers/'+encodeURIComponent(remove.dataset.removeProvider),{method:'DELETE'});toast('Provider deleted');runtime=await api('/admin/api/config');renderRuntime()}catch(err){toast(err.message,true)}
    return;
  }

  const saveUser=e.target.closest('[data-save-user]');
  if(saveUser){
    const tr=saveUser.closest('tr'); const id=tr.dataset.user;
    const body={role:tr.querySelector('[data-role]').value,planId:tr.querySelector('[data-plan]').value,subscriptionStatus:tr.querySelector('[data-status]').value,creditsUsed:Number(tr.querySelector('[data-used]').value),bonusCredits:Number(tr.querySelector('[data-bonus]').value),disabled:tr.querySelector('[data-disabled]').checked};
    try{await api('/admin/api/users/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(body)});toast('User updated');users=await api('/admin/api/users');renderUsers()}catch(err){toast(err.message,true)}
    return;
  }

  const resetUser=e.target.closest('[data-reset-user]');
  if(resetUser){
    const id=resetUser.closest('tr').dataset.user;
    try{await api('/admin/api/users/'+encodeURIComponent(id)+'/reset',{method:'POST',body:'{}'});toast('Usage reset');users=await api('/admin/api/users');renderUsers()}catch(err){toast(err.message,true)}
    return;
  }

  const savePlan=e.target.closest('[data-save-plan]');
  if(savePlan){
    const row=savePlan.closest('[data-plan-row]'); const id=row.dataset.planRow;
    const body={monthlyCredits:Number(row.querySelector('[data-plan-credits]').value),maxThinking:row.querySelector('[data-plan-thinking]').value,voiceAi:row.querySelector('[data-plan-voice]').checked,liveTranslation:row.querySelector('[data-plan-translation]').checked};
    try{await api('/admin/api/plans/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(body)});toast('Plan saved');plans=await api('/admin/api/plans');renderPlans();renderAdminPlans()}catch(err){toast(err.message,true)}
  }
});

$('#providerForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.target);
  try{await api('/admin/api/providers',{method:'POST',body:JSON.stringify(Object.fromEntries(f.entries()))});e.target.reset();toast('Provider saved');runtime=await api('/admin/api/config');renderRuntime()}catch(err){toast(err.message,true)}
});
$('#providerForm select[name="kind"]').onchange=e=>{$('#providerUrlField').style.display=e.target.value==='gemini-native'?'none':'grid'};

$('#saveVoice').onclick=async()=>{
  try{await api('/admin/api/voice',{method:'PUT',body:JSON.stringify({thinkingLevel:$('#thinking').value,speakerAccess:$('#speakerAccess').value,silenceMs:Number($('#silence').value),liveVoice:$('#liveVoice').value,ttsVoice:$('#ttsVoice').value})});toast('Voice engine saved');runtime=await api('/admin/api/config');renderRuntime()}catch(e){toast(e.message,true)}
};

async function saveControl(extra={}){
  const body={activationMode:$('#activationMode').value,followupSpeaker:$('#followupSpeaker').value,wakeWords:$('#wakeWords').value.split(',').map(x=>x.trim()).filter(Boolean),wakeResponse:$('#wakeResponse').value,wakeWindowMs:Number($('#wakeWindowMs').value),followupWindowMs:Number($('#followupWindowMs').value),humanLikeMode:$('#humanLikeMode').checked,translationLanguageA:$('#translationLanguageA').value,translationLanguageB:$('#translationLanguageB').value,translationQuality:$('#translationQuality').value,translationOutput:$('#translationOutput').value,...extra};
  await api('/admin/api/voice-control',{method:'PUT',body:JSON.stringify(body)});
  voiceControl=await api('/admin/api/voice-control');renderVoiceControl();
}
$('#saveVoiceControl').onclick=()=>saveControl().then(()=>toast('Activation settings saved')).catch(e=>toast(e.message,true));
$('#saveTranslationDefaults').onclick=()=>saveControl().then(()=>toast('Translation defaults saved')).catch(e=>toast(e.message,true));

$('#saveDisplay').onclick=async()=>{
  try{await api('/admin/api/display',{method:'PUT',body:JSON.stringify({headingSize:$('#headingSize').value,density:$('#density').value,divider:$('#divider').value,showEmojis:$('#showEmojis').checked,showDetectedLanguage:$('#showDetectedLanguage').checked,showProvider:$('#showProvider').checked,showOriginal:$('#showOriginal').checked,quoteArabic:$('#quoteArabic').checked,originalPreviewChars:Number($('#originalPreviewChars').value),smartAnswerArabicFirst:$('#smartAnswerArabicFirst').checked})});toast('Display settings saved')}catch(e){toast(e.message,true)}
};

$('#addUser').onclick=async()=>{
  const id=$('#userSearchId').value.trim(); if(!id)return toast('Enter a Discord User ID',true);
  try{await api('/admin/api/users/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({})});users=await api('/admin/api/users');renderUsers();toast('User opened / created')}catch(e){toast(e.message,true)}
};

load().catch(e=>toast(e.message,true));
</script>
</body>
</html>`;
}

export function registerAdminDashboard(app: Express): void {
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
        'TD AI dashboard is not configured. Add Discord OAuth + dashboard session variables first.'
      );
      return;
    }

    const state = randomBytes(24).toString('base64url');
    res.setHeader(
      'Set-Cookie',
      secureCookie(STATE_COOKIE, state, 600)
    );

    const redirectUri =
      `${dashboardBaseUrl()!.replace(/\/$/, '')}/admin/callback`;

    const url = new URL(
      'https://discord.com/oauth2/authorize'
    );

    url.searchParams.set('client_id', env.DISCORD_APP_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);

    res.redirect(url.toString());
  });

  router.get('/callback', async (req, res) => {
    try {
      if (!dashboardEnabled()) {
        throw new Error('TD AI dashboard is disabled.');
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
        throw new Error('Invalid OAuth state.');
      }

      const redirectUri =
        `${dashboardBaseUrl()!.replace(/\/$/, '')}/admin/callback`;

      const tokenResponse = await fetch(
        'https://discord.com/api/v10/oauth2/token',
        {
          method: 'POST',
          headers: {
            'content-type':
              'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            client_id: env.DISCORD_APP_ID,
            client_secret: env.DISCORD_CLIENT_SECRET!,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
          }),
          signal: AbortSignal.timeout(15_000)
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

      const userResponse = await fetch(
        'https://discord.com/api/v10/users/@me',
        {
          headers: {
            authorization:
              `Bearer ${token.access_token}`
          },
          signal: AbortSignal.timeout(15_000)
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

      // Every Discord user may view their own plan/usage.
      // Admin-only controls are authorized separately by API middleware.
      await userUsageSummary(user.id);

      res.setHeader('Set-Cookie', [
        secureCookie(
          SESSION_COOKIE,
          encodeSession(user.id),
          Math.floor(SESSION_TTL_MS / 1000)
        ),
        clearCookie(STATE_COOKIE)
      ]);

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
      clearCookie(SESSION_COOKIE)
    );
    res.redirect('/admin/login');
  });

  router.get('/', (req, res) => {
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

    res.type('html').send(dashboardPage());
  });

  router.use(
    '/api',
    express.json({ limit: '64kb' }),
    requireAuth,
    requireSameOrigin
  );

  router.get('/api/me', async (_req, res) => {
    try {
      const userId = String(
        res.locals.dashboardUserId
      );

      res.json({
        userId,
        admin: await isAdminUser(userId),
        usage: await userUsageSummary(userId),
        plans: await listPlans()
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

  router.get('/api/plans', async (_req, res) => {
    res.json(await listPlans());
  });

  router.get('/api/config', requireAdmin, async (_req, res) => {
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
  });

  router.get('/api/voice-control', requireAdmin, async (_req, res) => {
    res.json(await getVoiceControlSettings());
  });

  router.put('/api/voice-control', requireAdmin, async (req, res) => {
    try {
      const updated =
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
            Number(req.body.wakeWindowMs),
          followupWindowMs:
            Number(req.body.followupWindowMs),
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
            req.body.translationOutput as TranslationOutput,
          humanLikeMode:
            req.body.humanLikeMode !== false
        });

      res.json(updated);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : 'Could not save voice control.'
      });
    }
  });

  router.get('/api/users', requireAdmin, async (_req, res) => {
    res.json(await listUsers());
  });

  router.put('/api/users/:id', requireAdmin, async (req, res) => {
    try {
      const updated =
        await adminUpdateUser(
          req.params.id,
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
        );

      res.json(updated);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : 'Could not update user.'
      });
    }
  });

  router.post('/api/users/:id/reset', requireAdmin, async (req, res) => {
    try {
      await resetUserUsage(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : 'Could not reset usage.'
      });
    }
  });

  router.put('/api/plans/:id', requireAdmin, async (req, res) => {
    try {
      const planId = req.params.id as PlanId;

      res.json(
        await updatePlan(
          planId,
          {
            name:
              typeof req.body.name === 'string'
                ? req.body.name
                : undefined,
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
  });

  router.get('/api/provider-health', requireAdmin, async (_req, res) => {
    res.json(await listProviderHealth());
  });

  router.post('/api/providers', requireAdmin, async (req, res) => {
    try {
      const id =
        await upsertRuntimeProvider({
          id:
            typeof req.body.id === 'string'
              ? req.body.id
              : undefined,
          name: String(req.body.name ?? ''),
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
  });

  router.delete('/api/providers/:id', requireAdmin, async (req, res) => {
    try {
      await deleteRuntimeProvider(
        req.params.id
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
  });

  router.put('/api/routes/:task', requireAdmin, async (req, res) => {
    try {
      await setRuntimeRoute(
        req.params.task as RuntimeTask,
        {
          providerId:
            String(req.body.providerId ?? ''),
          model:
            String(req.body.model ?? '')
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
  });

  router.put('/api/voice', requireAdmin, async (req, res) => {
    try {
      await setVoiceRuntimeSettings({
        thinkingLevel:
          req.body.thinkingLevel as ThinkingLevelName,
        silenceMs:
          Number(req.body.silenceMs),
        liveVoice:
          String(req.body.liveVoice ?? ''),
        ttsVoice:
          String(req.body.ttsVoice ?? ''),
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
  });

  router.put('/api/display', requireAdmin, async (req, res) => {
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
          Number(req.body.originalPreviewChars),
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
  });

  app.use('/admin', router);
}
