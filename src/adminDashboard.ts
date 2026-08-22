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
  deleteRuntimeModel,
  deleteRuntimeProvider,
  getAdminRuntimeSnapshot,
  setDisplayRuntimeSettings,
  setRuntimeRoute,
  setVoiceRuntimeSettings,
  testRuntimeProvider,
  toggleRuntimeModel,
  toggleRuntimeProvider,
  upsertRuntimeModel,
  upsertRuntimeProvider,
  type DisplayDensity,
  type DisplayDivider,
  type DisplayHeadingSize,
  type ProviderKind,
  type RuntimeTask,
  type ThinkingLevelName,
  type VoiceSpeakerAccess
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
  type FollowupSpeaker
} from './services/voiceControl.js';
import {
  ALLOWED_VOICES,
  getUserPersonalization,
  setUserPersonalization,
  type UserDensity,
  type UserHeadingSize
} from './services/userPersonalization.js';
import {
  publicModelCatalog
} from './services/modelCatalog.js';

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
  return createHmac('sha256', env.DASHBOARD_SESSION_SECRET ?? 'disabled')
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

function decodeSession(raw: string | undefined): { userId: string } | undefined {
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
    ) as { userId?: string; exp?: number };

    if (!parsed.userId || !parsed.exp || parsed.exp < Date.now()) {
      return undefined;
    }

    return { userId: parsed.userId };
  } catch {
    return undefined;
  }
}

function secureCookie(name: string, value: string, maxAgeSeconds: number): string {
  return (
    `${name}=${encodeURIComponent(value)}; ` +
    'Path=/admin; HttpOnly; SameSite=Lax; Secure; ' +
    `Max-Age=${maxAgeSeconds}`
  );
}

function clearCookie(name: string): string {
  return `${name}=; Path=/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!dashboardEnabled()) {
    res.status(503).json({ error: 'TD AI dashboard is not configured yet.' });
    return;
  }

  const session = decodeSession(parseCookies(req)[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  res.locals.dashboardUserId = session.userId;
  next();
}

function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  const userId = String(res.locals.dashboardUserId ?? '');

  void isAdminUser(userId)
    .then((admin) => {
      if (!admin) {
        res.status(403).json({ error: 'Admin access is required.' });
        return;
      }
      next();
    })
    .catch((error) => {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Could not verify admin access.'
      });
    });
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

function themeCss(): string {
  return `
:root{
  --bg:#05070d;
  --bg2:#080c15;
  --glass:rgba(15,22,36,.75);
  --glass2:rgba(19,29,48,.86);
  --line:rgba(151,173,214,.16);
  --line2:rgba(120,224,255,.24);
  --text:#f6f8fd;
  --muted:#8fa3c2;
  --cyan:#56e0ff;
  --blue:#6f86ff;
  --violet:#a279ff;
  --pink:#f07aff;
  --green:#50e7a3;
  --yellow:#ffd166;
  --red:#ff7184;
  --shadow:0 35px 90px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
html{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",Tahoma,sans-serif;background:var(--bg);color:var(--text)}
body{margin:0;min-height:100vh;background:
radial-gradient(circle at 15% -4%,rgba(86,224,255,.16),transparent 28%),
radial-gradient(circle at 86% 0%,rgba(162,121,255,.18),transparent 30%),
radial-gradient(circle at 60% 90%,rgba(111,134,255,.08),transparent 35%),
linear-gradient(180deg,#05070d,#070b12 55%,#05070d);overflow-x:hidden}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.32;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to bottom,black,transparent 78%)}
button,input,select,textarea{font:inherit}
a{color:inherit}
.shell{display:grid;grid-template-columns:260px 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;padding:22px 15px;border-right:1px solid var(--line);background:rgba(5,8,14,.78);backdrop-filter:blur(22px);z-index:5;overflow-y:auto}
.brand{display:flex;align-items:center;gap:12px;padding:5px 8px 24px}
.logo{position:relative;width:48px;height:48px;border-radius:15px;display:grid;place-items:center;font-weight:950;letter-spacing:-.04em;color:#041018;background:linear-gradient(135deg,var(--cyan),var(--blue) 52%,var(--violet));box-shadow:0 12px 35px rgba(86,224,255,.18)}
.brand h1{margin:0;font-size:19px;letter-spacing:-.02em}
.brand p{margin:3px 0 0;color:var(--muted);font-size:11px}
.planPill{display:inline-flex;margin-top:5px;padding:3px 7px;border:1px solid var(--line);border-radius:999px;color:#c8d6ea;font-size:10px;background:rgba(255,255,255,.03)}
.nav{display:grid;gap:5px}
.nav button,.nav a{display:flex;align-items:center;gap:10px;width:100%;border:0;text-decoration:none;background:transparent;color:var(--muted);padding:9px 11px;border-radius:11px;text-align:left;cursor:pointer;transition:.18s ease;font-size:13px}
.nav button:hover,.nav a:hover,.nav button.active{color:var(--text);transform:translateX(2px);background:linear-gradient(90deg,rgba(86,224,255,.12),rgba(162,121,255,.08));box-shadow:inset 0 0 0 1px rgba(103,199,255,.12)}
.navIcon{width:20px;text-align:center}
.adminLink{margin-top:10px!important;color:#e3dcff!important;background:linear-gradient(135deg,rgba(162,121,255,.14),rgba(240,122,255,.08))!important;border:1px solid rgba(162,121,255,.24)!important}
.sideBottom{margin-top:20px}
.main{width:100%;max-width:1500px;margin:auto;padding:34px 38px 70px}
.top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:25px;animation:fadeUp .45s ease both}
.top h2{margin:0;font-size:30px;letter-spacing:-.04em}
.top p{margin:7px 0 0;color:var(--muted);font-size:13px}
.topActions{display:flex;gap:9px}
.ghost{display:inline-flex;align-items:center;gap:7px;padding:9px 13px;border-radius:11px;border:1px solid var(--line);background:rgba(255,255,255,.02);text-decoration:none;color:var(--muted);transition:.18s}
.ghost:hover{color:var(--text);border-color:var(--line2);transform:translateY(-1px)}
.section{display:none}.section.active{display:block;animation:fadeUp .38s ease both}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
.card{position:relative;grid-column:span 12;border:1px solid var(--line);border-radius:20px;padding:20px;background:linear-gradient(180deg,var(--glass2),var(--glass));backdrop-filter:blur(18px);box-shadow:var(--shadow);overflow:hidden}
.card:before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent)}
.card h3{margin:0 0 6px;font-size:18px;letter-spacing:-.02em}
.sub{margin:0 0 16px;color:var(--muted);font-size:12px;line-height:1.6}
.third{grid-column:span 4}.half{grid-column:span 6}.twoThird{grid-column:span 8}
.hero{min-height:240px;padding:28px;background:
radial-gradient(circle at 85% 15%,rgba(162,121,255,.2),transparent 34%),
radial-gradient(circle at 65% 95%,rgba(86,224,255,.14),transparent 34%),
linear-gradient(135deg,rgba(18,28,47,.95),rgba(10,15,27,.92))}
.heroTag{display:inline-flex;gap:7px;align-items:center;padding:6px 9px;border-radius:999px;background:rgba(86,224,255,.08);border:1px solid rgba(86,224,255,.18);font-size:11px;color:#c7f8ff}
.hero h1{max-width:800px;margin:18px 0 10px;font-size:clamp(32px,4vw,56px);line-height:1.02;letter-spacing:-.06em}
.gradientText{background:linear-gradient(100deg,#fff 10%,var(--cyan) 45%,#cdbdff 75%,var(--pink));-webkit-background-clip:text;color:transparent}
.hero p{max-width:670px;color:#a9b9d2;line-height:1.7}
.heroActions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:11px;padding:9px 14px;font-weight:750;cursor:pointer;text-decoration:none;transition:.18s ease}
.btn:hover{transform:translateY(-1px)}
.btn.small{padding:5px 9px;font-size:11px;border-radius:8px}
.primary{color:#041018;background:linear-gradient(135deg,var(--cyan),#8ba3ff);box-shadow:0 12px 32px rgba(86,224,255,.13)}
.secondary{color:var(--text);background:#121c2f;border:1px solid var(--line)}
.danger{color:#ff9daa;background:rgba(255,113,132,.09);border:1px solid rgba(255,113,132,.25)}
.stat{font-size:30px;font-weight:900;letter-spacing:-.04em}
.statLabel{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:9px}
.progress{height:10px;border-radius:999px;background:#050a12;border:1px solid var(--line);overflow:hidden}
.progress span{height:100%;display:block;width:0;background:linear-gradient(90deg,var(--cyan),var(--blue),var(--violet));box-shadow:0 0 20px rgba(86,224,255,.35)}
.meterRow{display:grid;grid-template-columns:140px 1fr auto;gap:12px;align-items:center;margin-top:12px}
.featureGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.featureCard{position:relative;min-height:150px;padding:16px;border-radius:16px;border:1px solid var(--line);background:linear-gradient(145deg,rgba(15,24,41,.9),rgba(7,12,21,.9));transition:.2s}
.featureCard:hover{transform:translateY(-3px);border-color:rgba(86,224,255,.25)}
.featureIcon{font-size:26px;margin-bottom:12px}.featureCard h4{margin:0 0 6px;font-size:15px}.featureCard p{margin:0;color:var(--muted);font-size:12px;line-height:1.6}
.quota{margin-top:10px;font-size:11px;color:#d7e2f1}
.planCard{position:relative;min-height:385px;padding:22px;border-radius:20px;border:1px solid var(--line);background:radial-gradient(circle at 100% 0%,rgba(111,134,255,.12),transparent 35%),linear-gradient(180deg,rgba(17,27,45,.96),rgba(8,13,23,.95));transition:.2s}
.planCard:hover{transform:translateY(-4px);border-color:rgba(119,190,255,.28)}
.planCard.featured{border-color:rgba(86,224,255,.34);box-shadow:0 24px 65px rgba(48,174,218,.1)}
.planCard.featured:before{content:"MOST POPULAR";position:absolute;right:16px;top:16px;padding:5px 8px;border-radius:999px;background:linear-gradient(135deg,var(--cyan),#9caeff);color:#041018;font-size:9px;font-weight:900;letter-spacing:.11em}
.planName{font-size:22px;font-weight:900}.planCredits{font-size:34px;font-weight:950;letter-spacing:-.05em;margin:20px 0 2px}.planCredits small{font-size:11px;color:var(--muted);font-weight:500;letter-spacing:0}
.planFeatures{display:grid;gap:10px;margin:20px 0}.planFeature{display:flex;gap:9px;color:#d9e4f3;font-size:13px}.yes{color:var(--green)}.no{color:#596983}
.notice,.warn{padding:13px 14px;border-radius:13px;font-size:12px;line-height:1.6}
.notice{border:1px solid rgba(86,224,255,.2);background:rgba(86,224,255,.06);color:#d4f6ff}
.warn{border:1px solid rgba(255,209,102,.22);background:rgba(255,209,102,.06);color:#ffe8a1}
.settingsGrid,.formGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:13px}.wide{grid-column:1/-1}
.field{display:grid;gap:6px}.field label{font-size:11px;color:var(--muted)}
input,select,textarea{width:100%;border:1px solid var(--line);background:rgba(4,9,17,.74);color:var(--text);padding:10px 11px;border-radius:11px;outline:none;transition:.18s}
textarea{min-height:100px;resize:vertical}
input:focus,select:focus,textarea:focus{border-color:rgba(86,224,255,.48);box-shadow:0 0 0 3px rgba(86,224,255,.07)}
.toggle{display:flex;align-items:center;gap:9px;min-height:43px;padding:10px 11px;border:1px solid var(--line);background:rgba(4,9,17,.62);border-radius:11px}.toggle input{width:auto}
.preview{min-height:220px;padding:20px;border-radius:16px;border:1px solid var(--line);background:radial-gradient(circle at 90% 10%,rgba(162,121,255,.1),transparent 35%),#060b13}
.quickCommand{padding:12px;border-radius:12px;border:1px solid var(--line);background:#050b14;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#cfeaff;word-break:break-word}
.tableWrap{overflow:auto}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:11px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}.table th{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.09em}
.categoryHeader{padding:14px 0 6px;margin-top:16px;font-size:14px;font-weight:800;letter-spacing:.02em;color:#cfeaff;border-bottom:1px solid rgba(86,224,255,.18);display:flex;align-items:center;gap:8px}
.categoryHeader:first-child{margin-top:0}
.routeRow{display:grid;grid-template-columns:1.2fr 1fr 1.6fr 1fr 1.6fr auto;gap:12px;align-items:start;padding:14px 0;border-top:1px solid var(--line)}.routeRow:first-child{border-top:0}
.providerRow{display:grid;grid-template-columns:1.2fr 1.1fr 1.6fr .9fr auto;gap:10px;align-items:center;padding:13px 0;border-top:1px solid var(--line)}.providerRow:first-child{border-top:0}
.modelRow{display:grid;grid-template-columns:1.2fr 1.1fr .8fr 2fr .8fr auto;gap:10px;align-items:center;padding:13px 0;border-top:1px solid var(--line)}.modelRow:first-child{border-top:0}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.badge{display:inline-flex;padding:3px 7px;border-radius:999px;border:1px solid var(--line);font-size:10px;color:#cbd7e9;background:rgba(255,255,255,.025)}
.badge.pro{color:#ecdfff;border-color:rgba(162,121,255,.28);background:rgba(162,121,255,.08)}.badge.plus{color:#c9f7ff;border-color:rgba(86,224,255,.24);background:rgba(86,224,255,.06)}
.badge.kind{color:#c7f8ff;border-color:rgba(86,224,255,.3);background:rgba(86,224,255,.08)}
.badge.cap{color:#eedcff;border-color:rgba(162,121,255,.3);background:rgba(162,121,255,.08)}
.badge.disabled{color:#ff9daa;border-color:rgba(255,113,132,.3);background:rgba(255,113,132,.08)}
.chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:7px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:#b3cbe8;font-size:11px;cursor:pointer;transition:.15s}
.chip:hover{background:rgba(86,224,255,.12);border-color:rgba(86,224,255,.3);color:#fff;transform:translateY(-1px)}
.chip.active{background:linear-gradient(135deg,rgba(86,224,255,.2),rgba(162,121,255,.15));border-color:rgba(86,224,255,.4);color:#fff}
.health{display:flex;gap:8px;align-items:center}.dot{width:8px;height:8px;border-radius:50%;background:var(--green)}.dot.bad{background:var(--red)}.dot.warnDot{background:var(--yellow)}
.toast{position:fixed;right:22px;bottom:22px;z-index:20;max-width:420px;padding:13px 15px;border:1px solid var(--line);border-radius:13px;background:#10192a;box-shadow:var(--shadow);opacity:0;transform:translateY(80px);transition:.22s}.toast.show{opacity:1;transform:none}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#050b14;border:1px solid var(--line);padding:2px 6px;border-radius:6px}
.spark{position:absolute;border-radius:50%;filter:blur(1px);animation:float 6s ease-in-out infinite}.spark.a{width:8px;height:8px;right:13%;top:20%;background:var(--cyan)}.spark.b{width:5px;height:5px;right:23%;top:42%;background:var(--violet);animation-delay:-2s}.spark.c{width:4px;height:4px;right:8%;top:65%;background:var(--pink);animation-delay:-4s}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes float{0%,100%{transform:translateY(0) scale(1);opacity:.7}50%{transform:translateY(-18px) scale(1.2);opacity:1}}
@media(max-width:1150px){.shell{grid-template-columns:1fr}.side{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}.nav{grid-template-columns:repeat(4,1fr)}.main{padding:22px}.third,.half,.twoThird{grid-column:span 12}.featureGrid{grid-template-columns:1fr 1fr}.routeRow,.providerRow,.modelRow{grid-template-columns:1fr}}
@media(max-width:650px){.nav{grid-template-columns:1fr 1fr}.featureGrid,.settingsGrid,.formGrid{grid-template-columns:1fr}.hero{padding:20px}.hero h1{font-size:34px}.main{padding:16px}.top{align-items:flex-start}.topActions{flex-direction:column}.meterRow{grid-template-columns:1fr}}
`;
}

function userPage(showAdminButton: boolean): string {
  const adminButton = showAdminButton
    ? `<a class="adminLink" href="/admin?view=admin"><span class="navIcon">⚡</span> Admin Hub</a>`
    : '';

  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(env.DISCORD_APP_ID)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<title>TD AI</title>
<style>${themeCss()}</style>
</head>
<body>
<div class="shell">
<aside class="side">
  <div class="brand">
    <div class="logo">TD</div>
    <div>
      <h1>TD AI</h1>
      <p>Personal AI inside Discord</p>
      <span class="planPill" id="sidePlan">Loading plan…</span>
    </div>
  </div>

  <div class="nav">
    <button class="active" data-tab="home"><span class="navIcon">⌂</span> Home</button>
    <button data-tab="create"><span class="navIcon">✦</span> Creative Studio</button>
    <button data-tab="plans"><span class="navIcon">◈</span> Plans</button>
    <button data-tab="personalize"><span class="navIcon">◌</span> Personalize</button>
    ${adminButton}
  </div>

  <div class="sideBottom">
    <a class="ghost" style="width:100%;justify-content:center" href="${inviteUrl}" target="_blank" rel="noopener">Open TD AI in Discord ↗</a>
  </div>
</aside>

<main class="main">
  <div class="top">
    <div>
      <h2 id="pageTitle">Home</h2>
      <p id="pageSubtitle">Your plan, creative tools and TD AI preferences.</p>
    </div>
    <div class="topActions">
      <a class="ghost" href="/admin/logout">Log out</a>
    </div>
  </div>

  <section id="home" class="section active">
    <div class="grid">
      <div class="card hero">
        <span class="spark a"></span><span class="spark b"></span><span class="spark c"></span>
        <span class="heroTag">✦ TD AI • Multi-Provider Discord Hub</span>
        <h1>One AI.<br/><span class="gradientText">Inside your Discord.</span></h1>
        <p>Chat, translate, code, talk naturally in voice, generate images and render videos — with routing matched to your plan and preferences.</p>
        <div class="heroActions">
          <button class="btn primary" data-go="create">Creative Studio ✦</button>
          <button class="btn secondary" data-go="personalize">Personalize TD</button>
        </div>
      </div>

      <div class="card third"><div class="statLabel">Current plan</div><div class="stat" id="homePlan">—</div><div class="sub" style="margin-top:6px">Your active TD AI tier</div></div>
      <div class="card third"><div class="statLabel">Credits remaining</div><div class="stat" id="homeCredits">—</div><div class="sub" style="margin-top:6px" id="homeReset">—</div></div>
      <div class="card third"><div class="statLabel">Monthly usage</div><div class="stat" id="homePercent">—</div><div class="progress" style="margin-top:12px"><span id="homeBar"></span></div></div>

      <div class="card twoThird">
        <h3>What you can do</h3>
        <p class="sub">TD chooses the best configured models automatically based on your plan.</p>
        <div class="featureGrid">
          <div class="featureCard"><div class="featureIcon">💬</div><h4>AI Chat & Code</h4><p>Chat, code review, summarize, explain, and draft replies.</p></div>
          <div class="featureCard"><div class="featureIcon">🎙️</div><h4>Voice AI</h4><p>Talk naturally in voice channels with live speech recognition.</p></div>
          <div class="featureCard"><div class="featureIcon">🖼️</div><h4>Image Studio</h4><p>Generate and edit visuals from natural language prompts.</p><div class="quota" id="imageQuota">—</div></div>
          <div class="featureCard"><div class="featureIcon">🎬</div><h4>Video Studio</h4><p>Generate high-quality short AI videos.</p><div class="quota" id="videoQuota">—</div></div>
          <div class="featureCard"><div class="featureIcon">✨</div><h4>Smart Answer</h4><p>Understand foreign messages with reply-ready answers.</p></div>
          <div class="featureCard"><div class="featureIcon">🌐</div><h4>Smart Translate</h4><p>High-accuracy translation with Arabic dialect detection.</p></div>
        </div>
      </div>

      <div class="card third">
        <h3>Usage mix</h3>
        <p class="sub">Your current monthly credit usage.</p>
        <div id="usageMix"></div>
      </div>
    </div>
  </section>

  <section id="create" class="section">
    <div class="grid">
      <div class="card hero">
        <span class="heroTag">Creative Studio</span>
        <h1 style="font-size:46px">Turn prompts into<br/><span class="gradientText">images & video.</span></h1>
        <p>Pick a quality preset and TD routes your request to the best model your plan permits.</p>
      </div>

      <div class="card half">
        <h3>🖼️ Image Studio</h3>
        <p class="sub">Generate a new image or edit an existing one in Discord.</p>
        <div class="settingsGrid">
          <div class="field"><label>Action</label><select id="imgAction"><option value="generate">Generate</option><option value="edit">Edit existing image</option></select></div>
          <div class="field"><label>Quality</label><select id="imgQuality"><option value="draft">Draft</option><option value="standard">Standard</option><option value="premium">Premium</option></select></div>
          <div class="field"><label>Aspect</label><select id="imgAspect"><option>1:1</option><option>16:9</option><option>9:16</option><option>3:2</option><option>2:3</option><option>4:3</option><option>3:4</option></select></div>
          <div class="field"><label>Images left this month</label><input id="imgLeft" readonly/></div>
          <div class="field wide"><label>Prompt</label><textarea id="imgPrompt" placeholder="A cinematic futuristic street at night, neon lights, rain reflections…"></textarea></div>
        </div>
        <div class="quickCommand" id="imgCommand" style="margin-top:13px">/image generate …</div>
        <button class="btn primary" id="copyImage" style="margin-top:12px">Copy Discord command</button>
      </div>

      <div class="card half">
        <h3>🎬 Video Studio</h3>
        <p class="sub">Create videos with the quality available on your plan.</p>
        <div class="settingsGrid">
          <div class="field"><label>Quality</label><select id="vidQuality"><option value="lite">Lite</option><option value="fast">Fast</option><option value="cinematic">Cinematic</option></select></div>
          <div class="field"><label>Aspect</label><select id="vidAspect"><option>16:9</option><option>9:16</option></select></div>
          <div class="field wide"><label>Videos left this month</label><input id="vidLeft" readonly/></div>
          <div class="field wide"><label>Prompt</label><textarea id="vidPrompt" placeholder="Drone shot through a mountain canyon at sunrise, atmospheric lighting, 4k…"></textarea></div>
        </div>
        <div class="quickCommand" id="vidCommand" style="margin-top:13px">/video generate …</div>
        <button class="btn primary" id="copyVideo" style="margin-top:12px">Copy Discord command</button>
      </div>

      <div class="card">
        <div class="notice">Media generation runs directly in Discord using <code>/image</code> and <code>/video</code>. TD automatically manages quotas and never charges credits for failed jobs.</div>
      </div>
    </div>
  </section>

  <section id="plans" class="section">
    <div class="grid">
      <div class="card hero">
        <span class="heroTag">Subscription Plans</span>
        <h1 style="font-size:46px">Upgrade your<br/><span class="gradientText">AI power & creative tools.</span></h1>
        <p>Higher tiers unlock advanced models, video generation, and higher credit limits.</p>
      </div>
      <div class="card" style="padding:0;background:transparent;border:0;box-shadow:none">
        <div c  <section id="personalize" class="section">
    <div class="grid">
      <div class="card half">
        <h3>Translation Preferences</h3>
        <p class="sub">Configure your primary language and one-click translation behavior.</p>
        <div class="settingsGrid">
          <div class="field"><label>My Language (Default Incoming)</label><input id="myLanguage" placeholder="ar-eg, en, fr..."/></div>
          <div class="field"><label>Outgoing Language</label><input id="outgoingLanguage" placeholder="en, ar-eg..."/></div>
          <div class="field"><label>Translation Style</label><select id="translationStyle"><option value="natural">Natural (Default)</option><option value="casual">Casual / Slang</option><option value="formal">Formal</option><option value="literal">Literal</option></select></div>
          <div class="field"><label>Translation Provider</label><select id="translationProvider"><option value="default">Default Router</option><option value="ai">AI Model</option><option value="google">Google Translate</option><option value="deepl">DeepL</option><option value="libretranslate">LibreTranslate</option></select></div>
          <label class="toggle wide"><input id="autoTranslateToMyLanguage" type="checkbox"/> <strong>Auto-translate directly to My Language</strong> (No menu on right-click)</label>
        </div>
        <button class="btn primary" id="saveTrans" style="margin-top:14px">Save Translation Preferences</button>
      </div>

      <div class="card half">
        <h3>Voice & Wake-Word Agent</h3>
        <p class="sub">Configure wake name, follow-up window, and voice personality.</p>
        <div class="settingsGrid">
          <div class="field"><label>Wake Name</label><input id="wakeName" placeholder="TD"/></div>
          <div class="field"><label>Follow-up Window (ms)</label><input id="followupWindowMs" type="number" min="1000" max="30000" step="500" placeholder="5000"/></div>
          <div class="field"><label>Voice</label><select id="voiceName"></select></div>
          <div class="field"><label>Response Delay (ms)</label><input id="delay" type="number" min="0" max="3000" step="50"/></div>
        </div>
        <button class="btn primary" id="saveVoice" style="margin-top:14px">Save Voice Preferences</button>
      </div>

      <div class="card half">
        <h3>Assistant & Media Routing</h3>
        <p class="sub">Choose where generated media and voice responses are delivered.</p>
        <div class="settingsGrid">
          <div class="field"><label>Result Destination</label><select id="resultDestination"><option value="channel">Channel (Voice text channel)</option><option value="dm">Direct Message (DM)</option><option value="both">Both (Channel + DM)</option></select></div>
          <div class="field"><label>Default Reply Language</label><select id="defaultReplyLanguage"><option value="auto">Auto Match User</option><option value="ar-eg">Egyptian Arabic (عربي مصري)</option><option value="ar-msa">Modern Standard Arabic (فصحى)</option><option value="en">English</option><option value="fa">Persian (فارسی)</option></select></div>
          <div class="field"><label>Default Image Aspect</label><select id="defaultImageAspect"><option value="1:1">1:1 (Square)</option><option value="16:9">16:9 (Landscape)</option><option value="9:16">9:16 (Portrait)</option><option value="3:2">3:2</option><option value="4:3">4:3</option></select></div>
          <div class="field"><label>Default Image Quality</label><select id="userImageQuality"><option value="standard">Standard</option><option value="draft">Draft</option><option value="premium">Premium</option></select></div>
          <div class="field"><label>Default Video Aspect</label><select id="defaultVideoAspect"><option value="16:9">16:9 (Landscape)</option><option value="9:16">9:16 (Portrait)</option></select></div>
          <div class="field"><label>Default Video Quality</label><select id="userVideoQuality"><option value="fast">Fast</option><option value="lite">Lite</option><option value="cinematic">Cinematic</option></select></div>
        </div>
        <button class="btn primary" id="saveAssistant" style="margin-top:14px">Save Assistant Preferences</button>
      </div>

      <div class="card half">
        <h3>Formatting & Aesthetics</h3>
        <p class="sub">Personalize how TD formats responses for your user account.</p>
        <div class="settingsGrid">
          <div class="field"><label>Heading Size</label><select id="headingSize"><option value="large">Large (#)</option><option value="medium">Medium (##)</option><option value="small">Small (###)</option></select></div>
          <div class="field"><label>Density</label><select id="density"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="relaxed">Relaxed</option></select></div>
          <label class="toggle"><input id="showEmojis" type="checkbox"/> Section Emojis</label>
          <label class="toggle"><input id="showOriginal" type="checkbox"/> Show Original</label>
        </div>
        <button class="btn primary" id="saveText" style="margin-top:14px">Save Display Preferences</button>
      </div>

      <div class="card">
        <h3>Response Preview</h3>
        <div class="preview" id="preview"></div>
      </div>
    </div>
  </section>
</main>
</div>
<div class="toast" id="toast"></div>

<script>
const $=s=>document.querySelector(s);
let me, prefs, plans=[];
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function fmt(n){return Number(n||0).toLocaleString()}
function toast(m,b=false){const t=$('#toast');t.textContent=m;t.style.borderColor=b?'var(--red)':'var(--line)';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
async function api(u,o={}){const r=await fetch(u,{headers:{'content-type':'application/json',...(o.headers||{})},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}

function tab(id){
  document.querySelectorAll('.nav button,.section').forEach(x=>x.classList.remove('active'));
  document.querySelector('[data-tab="'+id+'"]')?.classList.add('active');
  $('#'+id)?.classList.add('active');
  $('#pageTitle').textContent=document.querySelector('[data-tab="'+id+'"]')?.textContent.trim()||id;
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
document.addEventListener('click',e=>{const g=e.target.closest('[data-go]');if(g)tab(g.dataset.go)});

function renderHome(){
  if(!me)return;
  const u=me.usage;
  $('#sidePlan').textContent=u.plan.name+' Plan';
  $('#homePlan').textContent=u.plan.name;
  $('#homeCredits').textContent=fmt(u.remaining);
  $('#homeReset').textContent='Resets in '+u.daysUntilReset+' days';
  const pct=Math.min(100,Math.round((u.account.creditsUsed/u.totalCredits)*100))||0;
  $('#homePercent').textContent=pct+'%';
  $('#homeBar').style.width=pct+'%';
  $('#imageQuota').textContent=u.plan.imageGenerate?fmt(u.remainingImages)+' left this month':'Requires Plus or Pro';
  $('#videoQuota').textContent=u.plan.videoGenerate?fmt(u.remainingVideos)+' left this month':'Requires Plus or Pro';
  $('#imgLeft').value=u.plan.imageGenerate?fmt(u.remainingImages):'Upgrade needed';
  $('#vidLeft').value=u.plan.videoGenerate?fmt(u.remainingVideos):'Upgrade needed';
  $('#usageMix').innerHTML=Object.entries(u.categoryBreakdown).map(([k,v])=> '<div class="meterRow"><span class="statLabel" style="margin:0">'+esc(k)+'</span><div class="progress"><span style="width:'+Math.min(100,Math.round((v/Math.max(1,u.account.creditsUsed))*100))+'%"></span></div><span style="font-size:12px;font-weight:700">'+fmt(v)+'</span></div>').join('') || '<div class="sub">No usage recorded yet this billing period.</div>';
}

function renderPlans(){$('#planGrid').innerHTML=plans.map(p=>'<div class="card third" style="padding:0;background:transparent;border:0;box-shadow:none"><div class="planCard '+(p.id==='plus'?'featured':'')+'"><div class="planName">'+esc(p.name)+'</div><div class="planCredits">'+fmt(p.monthlyCredits)+' <small>credits / month</small></div><div class="planFeatures"><div class="planFeature"><span class="yes">✓</span> Voice AI & Chat</div><div class="planFeature"><span class="'+(p.imageGenerate?'yes':'no')+'">'+(p.imageGenerate?'✓':'—')+'</span> '+fmt(p.maxImageJobsPerMonth)+' image generations</div><div class="planFeature"><span class="'+(p.imageEdit?'yes':'no')+'">'+(p.imageEdit?'✓':'—')+'</span> '+fmt(p.maxImageEditJobsPerMonth)+' image edits</div><div class="planFeature"><span class="'+(p.videoGenerate?'yes':'no')+'">'+(p.videoGenerate?'✓':'—')+'</span> '+fmt(p.maxVideoJobsPerMonth)+' videos</div><div class="planFeature"><span class="yes">✓</span> '+(p.id==='pro'?'Premium Tier':'Plan-matched')+' AI Quality</div></div><button class="btn '+(me.usage.account.planId===p.id?'secondary':'primary')+'" style="width:100%;margin-top:8px" disabled>'+(me.usage.account.planId===p.id?'Current plan':'Upgrade coming soon')+'</button></div></div>').join('')}
function renderPrefs(){
  const voices=me.voices||[];
  $('#voiceName').innerHTML=voices.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  $('#myLanguage').value=prefs.myLanguage||'ar-eg';
  $('#outgoingLanguage').value=prefs.outgoingLanguage||'en';
  $('#translationStyle').value=prefs.translationStyle||'natural';
  $('#translationProvider').value=prefs.translationProvider||'default';
  $('#autoTranslateToMyLanguage').checked=prefs.autoTranslateToMyLanguage!==false;

  $('#wakeName').value=prefs.wakeName||'TD';
  $('#followupWindowMs').value=prefs.followupWindowMs||5000;
  $('#voiceName').value=prefs.voiceName||'Kore';
  $('#delay').value=String(prefs.responseDelayMs||250);

  $('#resultDestination').value=prefs.resultDestination||'channel';
  $('#defaultReplyLanguage').value=prefs.defaultReplyLanguage||'auto';
  $('#defaultImageAspect').value=prefs.defaultImageAspect||'1:1';
  $('#userImageQuality').value=prefs.imageQuality||'standard';
  $('#defaultVideoAspect').value=prefs.defaultVideoAspect||'16:9';
  $('#userVideoQuality').value=prefs.videoQuality||'fast';

  $('#headingSize').value=prefs.headingSize||'medium';
  $('#density').value=prefs.density||'comfortable';
  $('#showEmojis').checked=prefs.showEmojis!==false;
  $('#showOriginal').checked=prefs.showOriginal!==false;
  preview();
}
function preview(){const size=$('#headingSize').value,density=$('#density').value,em=$('#showEmojis').checked,orig=$('#showOriginal').checked;const h=size==='large'?'30px':size==='small'?'18px':'23px',gap=density==='compact'?'8px':density==='relaxed'?'24px':'15px';$('#preview').innerHTML='<div style="font-weight:900;font-size:'+h+';margin-bottom:'+gap+'">'+(em?'🌐 ':'')+'Translation</div><div style="line-height:1.7">This is how a clean TD AI response feels inside Discord.</div>'+(orig?'<div class="tiny" style="margin-top:'+gap+';border-left:2px solid var(--line2);padding-left:10px">Original message preview</div>':'')}
['headingSize','density','showEmojis','showOriginal'].forEach(id=>$('#'+id).addEventListener('input',preview));
async function savePrefs(){
  prefs=await api('/admin/api/personalization',{
    method:'PUT',
    body:JSON.stringify({
      myLanguage:$('#myLanguage').value,
      outgoingLanguage:$('#outgoingLanguage').value,
      translationStyle:$('#translationStyle').value,
      translationProvider:$('#translationProvider').value,
      autoTranslateToMyLanguage:$('#autoTranslateToMyLanguage').checked,
      wakeName:$('#wakeName').value,
      followupWindowMs:Number($('#followupWindowMs').value),
      voiceName:$('#voiceName').value,
      responseDelayMs:Number($('#delay').value),
      resultDestination:$('#resultDestination').value,
      defaultReplyLanguage:$('#defaultReplyLanguage').value,
      defaultImageAspect:$('#defaultImageAspect').value,
      imageQuality:$('#userImageQuality').value,
      defaultVideoAspect:$('#defaultVideoAspect').value,
      videoQuality:$('#userVideoQuality').value,
      headingSize:$('#headingSize').value,
      density:$('#density').value,
      showEmojis:$('#showEmojis').checked,
      showOriginal:$('#showOriginal').checked
    })
  });
  renderPrefs();
  toast('Preferences saved');
}
$('#saveText').onclick=()=>savePrefs().catch(e=>toast(e.message,true));
$('#saveVoice').onclick=()=>savePrefs().catch(e=>toast(e.message,true));
$('#saveTrans').onclick=()=>savePrefs().catch(e=>toast(e.message,true));
$('#saveAssistant').onclick=()=>savePrefs().catch(e=>toast(e.message,true));
function applyPlanToStudio(){if(!me)return;const id=me.usage.account.planId;const img=$('#imgQuality'),vid=$('#vidQuality');[...img.options].forEach(o=>{o.disabled=id==='free'&&o.value==='premium'});[...vid.options].forEach(o=>{o.disabled=id==='free'||(id==='plus'&&o.value==='cinematic')});if(id==='free'){vid.value='lite';vid.disabled=true;$('#vidPrompt').disabled=true;$('#vidAspect').disabled=true;$('#copyVideo').disabled=true;$('#copyVideo').textContent='Upgrade to Plus for video'}else{vid.disabled=false;$('#vidPrompt').disabled=false;$('#vidAspect').disabled=false;$('#copyVideo').disabled=false;$('#copyVideo').textContent='Copy Discord command'}if(id==='free'&&img.value==='premium')img.value='standard';if(id==='plus'&&vid.value==='cinematic')vid.value='fast'}
function mediaCommand(){applyPlanToStudio();const action=$('#imgAction').value,q=$('#imgQuality').value,a=$('#imgAspect').value,p=$('#imgPrompt').value.trim()||'<your prompt>';$('#imgCommand').textContent=action==='edit'?'/image edit image:<attach> prompt:'+p+' quality:'+q+' aspect:'+a:'/image generate prompt:'+p+' quality:'+q+' aspect:'+a;const vq=$('#vidQuality').value,va=$('#vidAspect').value,vp=$('#vidPrompt').value.trim()||'<your prompt>';$('#vidCommand').textContent='/video generate prompt:'+vp+' quality:'+vq+' aspect:'+va}
['imgAction','imgQuality','imgAspect','imgPrompt','vidQuality','vidAspect','vidPrompt'].forEach(id=>$('#'+id).addEventListener('input',mediaCommand));
async function copyText(text){await navigator.clipboard.writeText(text);toast('Command copied')}
$('#copyImage').onclick=()=>copyText($('#imgCommand').textContent).catch(e=>toast(e.message,true));$('#copyVideo').onclick=()=>copyText($('#vidCommand').textContent).catch(e=>toast(e.message,true));
Promise.all([api('/admin/api/me'),api('/admin/api/personalization')]).then(([m,p])=>{me=m;prefs=p;plans=m.plans;renderHome();renderPlans();renderPrefs();mediaCommand()}).catch(e=>toast(e.message,true));
</script>
</body>
</html>`;
}

function adminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<title>TD AI Control Center</title>
<style>${themeCss()}</style>
</head>
<body>
<div class="shell">
<aside class="side">
  <div class="brand"><div class="logo">TD</div><div><h1>TD AI Hub</h1><p>Multi-Provider Control Plane</p><span class="planPill">ADMIN ACCESS</span></div></div>
  <div class="nav">
    <a class="adminLink" href="/admin"><span class="navIcon">←</span> User View</a>
    <button class="active" data-tab="overview"><span class="navIcon">⌂</span> Overview</button>
    <button data-tab="providers"><span class="navIcon">⌁</span> Providers</button>
    <button data-tab="models"><span class="navIcon">◫</span> Model Registry</button>
    <button data-tab="routing"><span class="navIcon">⇄</span> Task Routing</button>
    <button data-tab="media"><span class="navIcon">✦</span> Media Studio</button>
    <button data-tab="voice"><span class="navIcon">◉</span> Voice Engine</button>
    <button data-tab="translation"><span class="navIcon">🌐</span> Translation</button>
    <button data-tab="display"><span class="navIcon">🎨</span> Display Settings</button>
    <button data-tab="users"><span class="navIcon">♙</span> Plans & Credits</button>
    <button data-tab="health"><span class="navIcon">♥</span> Provider Health</button>
  </div>
  <div class="sideBottom"><a class="ghost" style="width:100%;justify-content:center" href="/admin/logout">Log out</a></div>
</aside>

<main class="main">
<div class="top">
  <div><h2 id="pageTitle">Overview</h2><p id="pageSubtitle">Multi-provider routing, model registry, credentials and system control.</p></div>
  <div class="topActions"><a class="ghost" href="/admin">Back to User View</a></div>
</div>

<!-- OVERVIEW TAB -->
<section id="overview" class="section active">
<div class="grid">
  <div class="card hero">
    <span class="heroTag">⚡ Multi-Provider AI Routing Hub</span>
    <h1>Configure any AI.<br/><span class="gradientText">Seamless failover for Discord.</span></h1>
    <p>Route ChatGPT for text, Claude for code, Gemini for images/videos, and Gemini Live for voice — with automatic failover to fallback models whenever rate limits occur.</p>
    <div class="heroActions">
      <button class="btn primary" data-go="routing">Configure Task Routes ⇄</button>
      <button class="btn secondary" data-go="providers">Add AI Provider ⌁</button>
      <button class="btn secondary" data-go="models">Manage Models ◫</button>
    </div>
  </div>
  <div class="card third"><div class="statLabel">Registered Providers</div><div class="stat" id="providerCount">—</div></div>
  <div class="card third"><div class="statLabel">Active Models</div><div class="stat" id="modelCount">—</div></div>
  <div class="card third"><div class="statLabel">Task Routes</div><div class="stat" id="routeCount">12</div></div>

  <div class="card half">
    <h3>Supported Provider Ecosystem</h3>
    <p class="sub">Native protocol adapters and generic OpenAI-compatible endpoints.</p>
    <div class="notice">
      • <strong>Google Gemini Native:</strong> Gemini 3.7 Flash, Nano Banana Images, Veo Videos, Live Audio<br/>
      • <strong>Anthropic Native:</strong> Claude 3.7 Sonnet, Claude 3.5 Haiku, Opus<br/>
      • <strong>OpenAI Native:</strong> Official GPT-4o, o3, DALL-E, Whisper, TTS<br/>
      • <strong>OpenRouter:</strong> Unified aggregator routing with dynamic headers<br/>
      • <strong>OpenAI-Compatible:</strong> Any custom LLM / Local vLLM / Ollama server
    </div>
  </div>
  <div class="card half">
    <h3>Enterprise Failover & Quota Protection</h3>
    <p class="sub">Automatic failover chains and model cooldowns protect user experience.</p>
    <div class="notice">
      • <strong>Primary & Fallback Chains:</strong> Walk <code>model1 | model2 | model3</code> automatically<br/>
      • <strong>Provider-level Fallback:</strong> If primary provider fails completely, routes failover to secondary provider<br/>
      • <strong>Zero Failed Charge:</strong> Media jobs never deduct user credits on provider errors
    </div>
  </div>
</div>
</section>

<!-- PROVIDERS TAB -->
<section id="providers" class="section">
<div class="grid">
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div><h3>Active AI Providers</h3><p class="sub">Encrypted API keys, connectivity testing, and connection settings.</p></div>
      <button class="btn primary" id="btnShowAddProvider">+ Add New Provider</button>
    </div>
    <div id="providerList" style="margin-top:14px"></div>
  </div>

  <div class="card" id="addProviderCard">
    <h3 id="providerFormTitle">Register Provider</h3>
    <p class="sub">Keys are encrypted with AES-256-GCM before storage.</p>
    <form id="providerForm" class="formGrid">
      <input type="hidden" name="id" id="provId"/>
      <div class="field"><label>Provider Name</label><input name="name" id="provName" required placeholder="e.g. Anthropic Production, OpenAI Primary"/></div>
      <div class="field"><label>Provider Protocol / Kind</label>
        <select name="kind" id="provKind">
          <option value="gemini-native">Google Gemini Native</option>
          <option value="anthropic-native">Anthropic Native (Claude API)</option>
          <option value="openai-native">OpenAI Native (Official API)</option>
          <option value="openrouter">OpenRouter</option>
          <option value="openai-compatible">Custom OpenAI-Compatible API</option>
        </select>
      </div>
      <div class="field wide" id="provUrlField"><label>API Endpoint URL</label><input name="apiUrl" id="provUrl" placeholder="https://api.openai.com/v1"/></div>
      <div class="field wide"><label>API Key / Secret</label><input type="password" name="apiKey" id="provKey" placeholder="Paste API secret key" autocomplete="new-password"/></div>
      <div class="field wide"><label>Notes / Tag (Optional)</label><input name="notes" id="provNotes" placeholder="e.g. Paid Tier 2 account"/></div>
      <div class="row wide" style="margin-top:8px">
        <button class="btn primary" type="submit">Save Provider</button>
        <button class="btn secondary" type="button" id="btnCancelProvider">Cancel</button>
      </div>
    </form>
  </div>
</div>
</section>

<!-- MODEL REGISTRY TAB -->
<section id="models" class="section">
<div class="grid">
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div><h3>Model Registry</h3><p class="sub">Register and assign capability tags to models under your providers.</p></div>
      <div class="row">
        <button class="btn primary" id="btnShowAddModel">+ Register Model</button>
      </div>
    </div>
    <div class="row" style="margin-top:12px;gap:6px" id="modelFilterBar">
      <button class="chip active" data-mod-filter="all">All</button>
      <button class="chip" data-mod-filter="text">Text & Dev</button>
      <button class="chip" data-mod-filter="media">Media Studio</button>
      <button class="chip" data-mod-filter="voice">Voice & Audio</button>
    </div>
    <div id="modelList" style="margin-top:14px"></div>
  </div>

  <div class="card" id="addModelCard">
    <h3 id="modelFormTitle">Register / Configure Model</h3>
    <p class="sub">Models registered here become available for task routing and failover chains.</p>
    <div class="row" id="modelSuggestions" style="margin-bottom:12px"></div>
    <form id="modelForm" class="formGrid">
      <div class="field"><label>Provider</label><select name="providerId" id="modelProvSelect" required></select></div>
      <div class="field"><label>Model ID (exact API identifier)</label><input name="id" id="modelIdInput" required placeholder="e.g. claude-3-7-sonnet-20250219, gpt-4o, gemini-3.7-flash"/></div>
      <div class="field wide"><label>Display Label</label><input name="label" id="modelLabelInput" required placeholder="e.g. Claude 3.7 Sonnet, ChatGPT 4o"/></div>
      <div class="field wide">
        <label>Supported Capabilities / Tasks</label>
        <div class="row" id="capabilitiesCheckboxes" style="margin-top:6px;gap:8px"></div>
      </div>
      <div class="field"><label>Priority / Weight (1-100)</label><input name="priority" id="modelPriorityInput" type="number" value="50" min="1" max="100"/></div>
      <div class="field"><label>Notes (Optional)</label><input name="notes" id="modelNotesInput" placeholder="e.g. Recommended for code & analysis"/></div>
      <div class="row wide" style="margin-top:8px">
        <button class="btn primary" type="submit">Save Model</button>
        <button class="btn secondary" type="button" id="btnCancelModel">Cancel</button>
      </div>
    </form>
  </div>
</div>
</section>

<!-- TASK ROUTING TAB -->
<section id="routing" class="section">
<div class="grid">
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div>
        <h3>Task Routing & Failover Matrix</h3>
        <p class="sub">Route individual Discord tasks to specific providers and model chains. Specify fallback providers and chains for full redundancy.</p>
      </div>
      <div class="row">
        <button class="btn secondary" id="btnPresetGemini">Preset: All Gemini</button>
        <button class="btn secondary" id="btnPresetHybrid">Preset: Hybrid Hub</button>
      </div>
    </div>
    <div id="routeRows" style="margin-top:16px"></div>
  </div>
</div>
</section>

<!-- MEDIA SETTINGS TAB -->
<section id="media" class="section">
<div class="grid">
  <div class="card half">
    <h3>Image Generation Routing</h3>
    <p class="sub">Image tasks route through your primary provider's models (Gemini Nano Banana or OpenAI DALL-E).</p>
    <div class="notice">
      <strong>Task: image_generate & image_edit</strong><br/>
      Configured under Task Routing. Automatically checks user plan and quality preset (Draft / Standard / Premium).<br/><br/>
      • <strong>Draft:</strong> Gemini 3.1 Flash Lite Image / DALL-E (Fast)<br/>
      • <strong>Standard:</strong> Gemini 3.1 Flash Image / Nano Banana<br/>
      • <strong>Premium:</strong> Gemini 3 Pro Image (4K) / DALL-E 3 HD
    </div>
  </div>
  <div class="card half">
    <h3>Video Generation Routing</h3>
    <p class="sub">Video generation uses Google Veo 3.1 or Gemini Omni Flash pipelines.</p>
    <div class="notice">
      <strong>Task: video_generate</strong><br/>
      Veo Lite, Fast, and Cinematic qualities are allocated according to user tiers (Plus and Pro).<br/><br/>
      • <strong>Lite:</strong> <code>veo-3.1-lite-generate-preview</code> (Fast short clips)<br/>
      • <strong>Fast:</strong> <code>veo-3.1-fast-generate-preview</code> (Standard definition)<br/>
      • <strong>Cinematic:</strong> <code>veo-3.1-generate-preview</code> (High-fidelity Pro tier)
    </div>
  </div>
  <div class="card">
    <div class="warn"><strong>Credit Safety Guarantee:</strong> If a media generation request fails due to provider rate-limits, errors, or content policies, TD AI will NEVER deduct credits from the user's account.</div>
  </div>
</div>
</section>

<!-- VOICE SETTINGS TAB -->
<section id="voice" class="section">
<div class="grid">
  <div class="card half">
    <h3>Voice AI Engine</h3>
    <p class="sub">Configure live voice processing and silence thresholds.</p>
    <div class="settingsGrid">
      <div class="field"><label>Thinking level</label><select id="thinking"><option>minimal</option><option>low</option><option>medium</option><option>high</option></select></div>
      <div class="field"><label>Who can talk</label><select id="speakerAccess"><option value="everyone">Everyone</option><option value="owner-only">Owner only</option></select></div>
      <div class="field"><label>Global Live voice fallback</label><input id="liveVoice"/></div>
      <div class="field"><label>Global TTS fallback</label><input id="ttsVoice"/></div>
      <div class="field wide"><label>End-of-speech silence ms</label><input id="silence" type="number"/></div>
    </div>
    <button class="btn primary" id="saveVoice" style="margin-top:14px">Save Voice Engine</button>
  </div>
  <div class="card half">
    <h3>Conversation Behavior & Live Translate</h3>
    <p class="sub">Continuous PCM output queue with 200ms pre-buffer ensures zero audio stutter on Discord.</p>
    <div class="notice">
      <strong>Voice Tasks:</strong><br/>
      • <code>voice_live</code>: Interactive conversational Voice AI<br/>
      • <code>voice_translate</code>: Two-way live voice translation (with dual-target session isolation)<br/>
      • <code>stt</code>: Voice message audio transcription<br/>
      • <code>tts</code>: Text-to-speech generation
    </div>
  </div>
</div>
</section>

<!-- TRANSLATION TAB -->
<section id="translation" class="section">
<div class="grid">
  <div class="card half">
    <h3>Translation Engine & Intelligence</h3>
    <p class="sub">TD AI features high-accuracy multi-dialect translation and smart source detection.</p>
    <div class="notice">
      • <strong>Arabic Dialect Awareness:</strong> Distinguishes Egyptian Arabic from Modern Standard Arabic.<br/>
      • <strong>Quick Translate:</strong> When enabled, users translate immediately to their saved default target without seeing a language menu.<br/>
      • <strong>Multi-Provider Routing:</strong> Route the <code>translation</code> task in the Task Routing matrix to Gemini, OpenAI, Claude, or DeepSeek.
    </div>
  </div>
  <div class="card half">
    <h3>User Preferences Overview</h3>
    <p class="sub">Users configure their personal language settings via <code>/settings</code>.</p>
    <div class="notice">
      • <code>quick_translate</code>: ON / OFF<br/>
      • <code>translate_target</code>: Saved target language (Egyptian Arabic, English, MSA, etc.)<br/>
      • <code>my_language</code>: Personal incoming language for Smart Answer<br/>
      • <code>outgoing</code>: Default language for <code>/say</code>
    </div>
  </div>
</div>
</section>

<!-- DISPLAY SETTINGS TAB -->
<section id="display" class="section">
<div class="grid">
  <div class="card half">
    <h3>Global Output Formatting</h3>
    <p class="sub">Set the global default message layout for translation and AI tools.</p>
    <div class="settingsGrid">
      <div class="field"><label>Heading size</label><select id="dispHeading"><option value="large">Large (#)</option><option value="medium">Medium (##)</option><option value="small">Small (###)</option></select></div>
      <div class="field"><label>Spacing / Density</label><select id="dispDensity"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="relaxed">Relaxed</option></select></div>
      <div class="field"><label>Divider line</label><select id="dispDivider"><option value="none">None</option><option value="line">Line (---)</option><option value="spaced">Spaced</option></select></div>
      <div class="field"><label>Original Preview Max Chars</label><input id="dispChars" type="number" min="80" max="1200"/></div>
      <label class="toggle"><input id="dispEmojis" type="checkbox"/> Show section emojis</label>
      <label class="toggle"><input id="dispDetected" type="checkbox"/> Show detected source language</label>
      <label class="toggle"><input id="dispProvider" type="checkbox"/> Show provider badge in footer</label>
      <label class="toggle"><input id="dispOriginal" type="checkbox"/> Show original message block</label>
      <label class="toggle wide"><input id="dispQuoteArabic" type="checkbox"/> Quote Arabic translation text (&gt;)</label>
      <label class="toggle wide"><input id="dispSmartArabicFirst" type="checkbox"/> Smart Answer: Display Arabic translation first</label>
    </div>
    <button class="btn primary" id="saveDisplay" style="margin-top:14px">Save Display Settings</button>
  </div>
  <div class="card half">
    <h3>Formatting Preview</h3>
    <p class="sub">Live simulation of how formatted Discord output renders.</p>
    <div class="preview" id="dispPreview"></div>
  </div>
</div>
</section>

<!-- USERS & PLANS TAB -->
<section id="users" class="section">
<div class="grid">
  <div class="card">
    <h3>User Accounts</h3><p class="sub">Manage roles, subscriptions, plans and credits by Discord ID.</p>
    <div class="row" style="margin-bottom:13px"><input id="newUserId" placeholder="Discord User ID" style="max-width:320px"/><button class="btn secondary" id="openUser">Open / Create User</button></div>
    <div class="tableWrap"><table class="table"><thead><tr><th>Discord ID</th><th>Role</th><th>Plan</th><th>Status</th><th>Used</th><th>Bonus</th><th>Suspended</th><th>Actions</th></tr></thead><tbody id="usersBody"></tbody></table></div>
  </div>
  <div class="card">
    <h3>Plan Definitions</h3><p class="sub">Configure monthly credits and media entitlements per tier.</p>
    <div id="adminPlans"></div>
  </div>
</div>
</section>

<!-- PROVIDER HEALTH TAB -->
<section id="health" class="section">
<div class="grid">
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div><h3>Provider Health & Error Telemetry</h3><p class="sub">Real-time status, latency, cooldowns, and error responses.</p></div>
      <button class="btn secondary" id="btnRefreshHealth">Refresh Health</button>
    </div>
    <div id="healthList" style="margin-top:14px"></div>
  </div>
</div>
</section>

</main>
</div>
<div class="toast" id="toast"></div>

<script>
const $=s=>document.querySelector(s);
let me, runtime, users, health, voice, models, plans=[];
let activeModelFilter = 'all';

function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function fmt(n){return Number(n||0).toLocaleString()}
function toast(m,b=false){const t=$('#toast');t.textContent=m;t.style.borderColor=b?'var(--red)':'var(--line)';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
async function api(u,o={}){const r=await fetch(u,{headers:{'content-type':'application/json',...(o.headers||{})},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}

function tab(id){
  document.querySelectorAll('.nav button,.section').forEach(x=>x.classList.remove('active'));
  document.querySelector('[data-tab="'+id+'"]')?.classList.add('active');
  $('#'+id)?.classList.add('active');
  $('#pageTitle').textContent=document.querySelector('[data-tab="'+id+'"]')?.textContent.trim()||id;
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
document.addEventListener('click',e=>{const g=e.target.closest('[data-go]');if(g)tab(g.dataset.go)});

function providersForTask(task){
  return runtime.providers.filter(p=>{
    if(!p.enabled)return false;
    const caps=runtime.providerKindCapabilities[p.kind]||[];
    return caps.includes(task);
  });
}

function renderOverview(){
  $('#providerCount').textContent=runtime.providers.length;
  $('#modelCount').textContent=runtime.models.length;
  $('#routeCount').textContent=runtime.tasks.length;
}

function renderProviders(){
  $('#providerList').innerHTML=runtime.providers.map(p=>\`
    <div class="providerRow">
      <div>
        <strong>\${esc(p.name)}</strong>
        <div class="sub" style="margin:2px 0 0"><code>\${esc(p.id)}</code></div>
        \${p.notes ? '<div class="tiny" style="color:var(--muted);margin-top:2px">'+esc(p.notes)+'</div>' : ''}
      </div>
      <div><span class="badge kind">\${esc(p.kind)}</span></div>
      <div class="sub" style="margin:0;word-break:break-all">\${esc(p.apiUrl||'Built-in / Native endpoint')}</div>
      <div>\${esc(p.apiKeyHint)}</div>
      <div class="row">
        <button class="btn small secondary" data-test-provider="\${esc(p.id)}">Test</button>
        \${p.builtIn ? '<span class="badge">Built-in</span>' : \`
          <button class="btn small \${p.enabled?'secondary':'primary'}" data-toggle-provider="\${esc(p.id)}">\${p.enabled?'Disable':'Enable'}</button>
          <button class="btn small secondary" data-edit-provider="\${esc(p.id)}">Edit</button>
          <button class="btn small danger" data-remove-provider="\${esc(p.id)}">Delete</button>
        \`}
      </div>
    </div>
  \`).join('');

  $('#modelProvSelect').innerHTML=runtime.providers.map(p=>\`
    <option value="\${esc(p.id)}">\${esc(p.name)} (\${esc(p.kind)})\${p.enabled?'':' [Disabled]'}</option>
  \`).join('');
}

const TEMPLATES = {
  'gemini-native': [
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', caps: ['translation','chat','code','ai_tools','smart_reply','stt'] },
    { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2 (Image)', caps: ['image_generate','image_edit'] },
    { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast Video', caps: ['video_generate'] },
    { id: 'gemini-3.1-flash-live-preview', label: 'Gemini 3.1 Flash Live', caps: ['voice_live'] }
  ],
  'anthropic-native': [
    { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus', caps: ['translation','chat','code','ai_tools','smart_reply'] }
  ],
  'openai-native': [
    { id: 'gpt-4o', label: 'GPT-4o (Omni)', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'o3-mini', label: 'o3-mini (Reasoning)', caps: ['chat','code','ai_tools'] },
    { id: 'dall-e-3', label: 'DALL-E 3', caps: ['image_generate'] }
  ],
  'openrouter': [
    { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', caps: ['chat','code','ai_tools'] },
    { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 (OpenRouter)', caps: ['translation','chat','code','ai_tools','smart_reply'] },
    { id: 'openai/gpt-4o', label: 'GPT-4o (OpenRouter)', caps: ['translation','chat','code','ai_tools','smart_reply'] }
  ]
};

function updateModelFormSuggestions(){
  const provId = $('#modelProvSelect').value;
  const prov = runtime.providers.find(p=>p.id===provId);
  const kind = prov?.kind || 'gemini-native';
  const tmpls = TEMPLATES[kind] || [];

  $('#modelSuggestions').innerHTML = tmpls.length ? '<span class="sub" style="margin:0 4px 0 0">Suggested:</span>' + tmpls.map(t=>\`
    <button type="button" class="chip" data-fill-model="\${esc(t.id)}" data-label="\${esc(t.label)}" data-caps="\${esc(t.caps.join(','))}">+ \${esc(t.label)}</button>
  \`).join('') : '';

  const allowedCaps = runtime.providerKindCapabilities[kind] || [];
  document.querySelectorAll('#capabilitiesCheckboxes label').forEach(lbl=>{
    const input = lbl.querySelector('input');
    const allowed = allowedCaps.includes(input.value);
    input.disabled = !allowed;
    lbl.style.opacity = allowed ? '1' : '0.4';
    if(!allowed) input.checked = false;
  });
}

function renderModels(){
  const filtered = runtime.models.filter(m=>{
    if(activeModelFilter==='text') return m.capabilities.some(c=>['translation','chat','code','ai_tools','smart_reply'].includes(c));
    if(activeModelFilter==='media') return m.capabilities.some(c=>['image_generate','image_edit','video_generate'].includes(c));
    if(activeModelFilter==='voice') return m.capabilities.some(c=>['voice_live','voice_translate','stt','tts'].includes(c));
    return true;
  });

  $('#modelList').innerHTML=filtered.map(m=>{
    const prov=runtime.providers.find(p=>p.id===m.providerId);
    return \`
      <div class="modelRow">
        <div>
          <strong>\${esc(m.label)}</strong>
          <div class="sub" style="margin:2px 0 0"><code>\${esc(m.id)}</code></div>
        </div>
        <div>
          <span class="badge">\${esc(prov?.name||m.providerId)}</span>
        </div>
        <div>
          <span class="badge pro">P \${m.priority||50}</span>
        </div>
        <div class="row">
          \${m.capabilities.map(c=>'<span class="badge cap">'+esc(c)+'</span>').join(' ')}
        </div>
        <div>
          <span class="badge \${m.enabled?'plus':'disabled'}">\${m.enabled?'Enabled':'Disabled'}</span>
        </div>
        <div class="row">
          <button class="btn small \${m.enabled?'secondary':'primary'}" data-toggle-model="\${esc(m.providerId)}:::\${esc(m.id)}">\${m.enabled?'Disable':'Enable'}</button>
          <button class="btn small secondary" data-edit-model="\${esc(m.providerId)}:::\${esc(m.id)}">Edit</button>
          <button class="btn small danger" data-remove-model="\${esc(m.providerId)}:::\${esc(m.id)}">Delete</button>
        </div>
      </div>
    \`;
  }).join('') || '<div class="sub">No models match this filter.</div>';

  $('#capabilitiesCheckboxes').innerHTML=runtime.tasks.map(t=>\`
    <label class="toggle" style="font-size:12px;padding:6px 10px;min-height:auto">
      <input type="checkbox" name="capabilities" value="\${esc(t.id)}"/> \${esc(t.label)}
    </label>
  \`).join('');

  updateModelFormSuggestions();
}

function renderRoutes(){
  const categories = [
    { title: '📝 Text, Code & Intelligence', tasks: runtime.tasks.filter(t=>['translation','chat','code','ai_tools','smart_reply'].includes(t.id)) },
    { title: '🎨 Creative Media Studio', tasks: runtime.tasks.filter(t=>['image_generate','image_edit','video_generate'].includes(t.id)) },
    { title: '🎙️ Voice & Audio AI', tasks: runtime.tasks.filter(t=>['voice_live','voice_translate','stt','tts'].includes(t.id)) }
  ];

  $('#routeRows').innerHTML=categories.map(cat=>\`
    <div class="categoryHeader">\${cat.title}</div>
    \${cat.tasks.map(t=>{
      const r=runtime.routes[t.id]||{};
      const availableProviders=providersForTask(t.id);
      const primaryProv=r.providerId||availableProviders[0]?.id||'';

      const primaryModels=runtime.models.filter(m=>m.providerId===primaryProv && m.capabilities.includes(t.id) && m.enabled);
      const fbProv=r.fallbackProviderId||'';
      const fbModels=runtime.models.filter(m=>m.providerId===fbProv && m.capabilities.includes(t.id) && m.enabled);

      return \`
        <div class="routeRow" data-task="\${esc(t.id)}">
          <div>
            <strong>\${esc(t.label)}</strong>
            <div class="sub" style="margin:2px 0 0"><code>\${esc(t.id)}</code></div>
          </div>
          <div class="field">
            <label>Primary Provider</label>
            <select data-field="providerId" class="routeProvSelect">
              \${availableProviders.map(p=>\`<option value="\${esc(p.id)}" \${p.id===r.providerId?'selected':''}>\${esc(p.name)}</option>\`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Primary Model Chain</label>
            <input data-field="model" value="\${esc(r.model||'')}" placeholder="e.g. gpt-4o | gpt-4o-mini"/>
            \${primaryModels.length ? \`
              <div class="row" style="margin-top:3px">
                <span style="font-size:10px;color:var(--muted)">Pick:</span>
                \${primaryModels.slice(0,3).map(pm=>\`
                  <button type="button" class="chip" style="padding:1px 6px;font-size:10px" data-append-model="\${esc(pm.id)}">+\${esc(pm.label)}</button>
                \`).join('')}
              </div>
            \` : ''}
          </div>
          <div class="field">
            <label>Fallback Provider (Optional)</label>
            <select data-field="fallbackProviderId" class="routeFbSelect">
              <option value="">None</option>
              \${availableProviders.map(p=>\`<option value="\${esc(p.id)}" \${p.id===r.fallbackProviderId?'selected':''}>\${esc(p.name)}</option>\`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Fallback Model Chain</label>
            <input data-field="fallbackModel" value="\${esc(r.fallbackModel||'')}" placeholder="e.g. gemini-3.7-flash"/>
            \${fbModels.length ? \`
              <div class="row" style="margin-top:3px">
                <span style="font-size:10px;color:var(--muted)">Pick:</span>
                \${fbModels.slice(0,3).map(fm=>\`
                  <button type="button" class="chip" style="padding:1px 6px;font-size:10px" data-append-fb-model="\${esc(fm.id)}">+\${esc(fm.label)}</button>
                \`).join('')}
              </div>
            \` : ''}
          </div>
          <div style="padding-top:19px">
            <button class="btn primary" data-save-route="\${esc(t.id)}">Save</button>
          </div>
        </div>
      \`;
    }).join('')}
  \`).join('');
}

function renderVoice(){
  $('#thinking').value=runtime.voice.thinkingLevel||'minimal';
  $('#speakerAccess').value=runtime.voice.speakerAccess||'everyone';
  $('#liveVoice').value=runtime.voice.liveVoice||'';
  $('#ttsVoice').value=runtime.voice.ttsVoice||'';
  $('#silence').value=runtime.voice.silenceMs||300;
}

function renderDisplay(){
  const d=runtime.display;
  $('#dispHeading').value=d.headingSize||'medium';
  $('#dispDensity').value=d.density||'comfortable';
  $('#dispDivider').value=d.divider||'none';
  $('#dispChars').value=d.originalPreviewChars||420;
  $('#dispEmojis').checked=d.showEmojis!==false;
  $('#dispDetected').checked=d.showDetectedLanguage!==false;
  $('#dispProvider').checked=d.showProvider===true;
  $('#dispOriginal').checked=d.showOriginal!==false;
  $('#dispQuoteArabic').checked=d.quoteArabic!==false;
  $('#dispSmartArabicFirst').checked=d.smartAnswerArabicFirst!==false;
  previewDisplay();
}

function previewDisplay(){
  const size=$('#dispHeading').value, density=$('#dispDensity').value, em=$('#dispEmojis').checked;
  const h=size==='large'?'28px':size==='small'?'17px':'22px';
  const gap=density==='compact'?'8px':density==='relaxed'?'24px':'15px';
  $('#dispPreview').innerHTML=\`
    <div style="font-weight:900;font-size:\${h};margin-bottom:\${gap}">\${em?'🌐 ':''}English • detected: Egyptian Arabic</div>
    <div style="line-height:1.7">Hello! This is how TD AI delivers your messages and actions.</div>
    <div style="margin-top:\${gap};border-left:2px solid var(--line2);padding-left:10px;font-size:12px;color:var(--muted)">Original: أهلاً بيك في تي دي اي</div>
  \`;
}
['dispHeading','dispDensity','dispDivider','dispChars','dispEmojis','dispDetected','dispProvider','dispOriginal','dispQuoteArabic','dispSmartArabicFirst'].forEach(id=>{
  $('#'+id)?.addEventListener('input',previewDisplay);
});

function renderUsersAndPlans(){
  $('#usersBody').innerHTML=users.map(row=>{
    const a=row.account;
    return \`<tr data-user="\${esc(a.discordUserId)}">
      <td><code>\${esc(a.discordUserId)}</code></td>
      <td><select data-role><option value="user" \${a.role==='user'?'selected':''}>user</option><option value="admin" \${a.role==='admin'?'selected':''}>admin</option></select></td>
      <td><select data-plan>\${plans.map(p=>\`<option value="\${p.id}" \${a.planId===p.id?'selected':''}>\${p.name}</option>\`).join('')}</select></td>
      <td><select data-status><option value="active" \${a.subscriptionStatus==='active'?'selected':''}>active</option><option value="paused" \${a.subscriptionStatus==='paused'?'selected':''}>paused</option><option value="expired" \${a.subscriptionStatus==='expired'?'selected':''}>expired</option></select></td>
      <td><input data-used type="number" value="\${a.creditsUsed}"/></td>
      <td><input data-bonus type="number" value="\${a.bonusCredits}"/></td>
      <td><input data-disabled type="checkbox" \${a.disabled?'checked':''}/></td>
      <td><div class="row"><button class="btn small secondary" data-save-user>Save</button><button class="btn small danger" data-reset-user>Reset</button></div></td>
    </tr>\`;
  }).join('');

  $('#adminPlans').innerHTML=plans.map(p=>\`
    <div class="card" data-plan-row="\${p.id}" style="margin-top:12px;box-shadow:none">
      <div class="row" style="justify-content:space-between">
        <div><strong style="font-size:18px">\${p.name}</strong><div class="sub" style="margin:3px 0 0">\${p.id}</div></div>
        <span class="badge \${p.id==='pro'?'pro':p.id==='plus'?'plus':''}">\${fmt(p.monthlyCredits)} credits</span>
      </div>
      <div class="settingsGrid" style="margin-top:14px">
        <div class="field"><label>Monthly credits</label><input data-credits type="number" value="\${p.monthlyCredits}"/></div>
        <div class="field"><label>Max thinking</label><select data-thinking><option value="minimal" \${p.maxThinking==='minimal'?'selected':''}>minimal</option><option value="low" \${p.maxThinking==='low'?'selected':''}>low</option><option value="medium" \${p.maxThinking==='medium'?'selected':''}>medium</option><option value="high" \${p.maxThinking==='high'?'selected':''}>high</option></select></div>
        <div class="field"><label>Image generations / month</label><input data-img type="number" value="\${p.maxImageJobsPerMonth}"/></div>
        <div class="field"><label>Image edits / month</label><input data-edit type="number" value="\${p.maxImageEditJobsPerMonth}"/></div>
        <div class="field"><label>Videos / month</label><input data-video type="number" value="\${p.maxVideoJobsPerMonth}"/></div>
        <div></div>
        <label class="toggle"><input data-img-on type="checkbox" \${p.imageGenerate?'checked':''}/> Image Generate</label>
        <label class="toggle"><input data-edit-on type="checkbox" \${p.imageEdit?'checked':''}/> Image Edit</label>
        <label class="toggle"><input data-video-on type="checkbox" \${p.videoGenerate?'checked':''}/> Video Generate</label>
      </div>
      <button class="btn primary" data-save-plan style="margin-top:13px">Save \${p.name}</button>
    </div>
  \`).join('');
}

function renderHealth(){
  $('#healthList').innerHTML=health.map(h=>\`
    <div class="providerRow">
      <div><strong>\${esc(h.provider)}</strong><div class="sub" style="margin:2px 0 0">\${esc(h.model)}</div></div>
      <div class="health"><span class="dot \${h.status==='healthy'?'':h.status==='busy'?'warnDot':'bad'}"></span>\${esc(h.status)}</div>
      <div class="sub" style="margin:0">\${esc(h.lastMessage||'Healthy')}</div>
      <div>\${esc(h.lastStatusCode||'200')}</div>
      <div class="sub" style="margin:0">\${new Date(h.lastUpdatedAt).toLocaleTimeString()}</div>
    </div>
  \`).join('') || '<div class="sub">No provider events logged yet.</div>';
}

function render(){
  plans=me.plans;
  renderOverview();
  renderProviders();
  renderModels();
  renderRoutes();
  renderVoice();
  renderDisplay();
  renderUsersAndPlans();
  renderHealth();
}

async function refresh(){
  [me, runtime, users, health] = await Promise.all([
    api('/admin/api/me'),
    api('/admin/api/config'),
    api('/admin/api/users'),
    api('/admin/api/provider-health')
  ]);
  render();
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

$('#provKind').onchange=e=>{
  const k=e.target.value;
  $('#provUrlField').style.display = k==='openai-compatible' ? 'grid' : 'none';
  if(k==='openai-native') $('#provUrl').value='https://api.openai.com/v1';
  else if(k==='anthropic-native') $('#provUrl').value='https://api.anthropic.com/v1';
  else if(k==='openrouter') $('#provUrl').value='https://openrouter.ai/api/v1';
  else if(k==='gemini-native') $('#provUrl').value='';
};
$('#provKind').dispatchEvent(new Event('change'));

$('#modelProvSelect').onchange=()=>{
  updateModelFormSuggestions();
};

$('#providerForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const payload = Object.fromEntries(new FormData(e.target).entries());
    await api('/admin/api/providers', { method:'POST', body:JSON.stringify(payload) });
    e.target.reset();
    $('#provId').value='';
    $('#providerFormTitle').textContent='Register Provider';
    toast('Provider saved');
    await refresh();
  }catch(x){toast(x.message,true)}
};

$('#btnCancelProvider').onclick=()=>{
  $('#providerForm').reset();
  $('#provId').value='';
  $('#providerFormTitle').textContent='Register Provider';
};

$('#btnShowAddProvider').onclick=()=>{
  $('#providerForm').reset();
  $('#provId').value='';
  $('#providerFormTitle').textContent='Register Provider';
  $('#provName').focus();
};

$('#modelForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const fd = new FormData(e.target);
    const capabilities = fd.getAll('capabilities');
    const payload = {
      providerId: fd.get('providerId'),
      id: fd.get('id'),
      label: fd.get('label'),
      capabilities,
      priority: Number(fd.get('priority')||50),
      notes: fd.get('notes')
    };
    await api('/admin/api/models', { method:'POST', body:JSON.stringify(payload) });
    e.target.reset();
    toast('Model saved');
    await refresh();
  }catch(x){toast(x.message,true)}
};

$('#btnCancelModel').onclick=()=>{
  $('#modelForm').reset();
  $('#modelFormTitle').textContent='Register / Configure Model';
};

$('#btnShowAddModel').onclick=()=>{
  $('#modelForm').reset();
  $('#modelFormTitle').textContent='Register / Configure Model';
  $('#modelIdInput').focus();
};

document.querySelectorAll('#modelFilterBar [data-mod-filter]').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('#modelFilterBar [data-mod-filter]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    activeModelFilter = b.dataset.modFilter;
    renderModels();
  };
});

document.addEventListener('click', async e=>{
  const fm=e.target.closest('[data-fill-model]');
  if(fm){
    $('#modelIdInput').value = fm.dataset.fillModel;
    $('#modelLabelInput').value = fm.dataset.label;
    const caps = (fm.dataset.caps || '').split(',');
    document.querySelectorAll('#capabilitiesCheckboxes input').forEach(cb=>{
      cb.checked = caps.includes(cb.value);
    });
    return;
  }

  const am=e.target.closest('[data-append-model]');
  if(am){
    const row=am.closest('.routeRow');
    const input=row.querySelector('[data-field="model"]');
    const cur=input.value.trim();
    input.value = cur ? cur + ' | ' + am.dataset.appendModel : am.dataset.appendModel;
    return;
  }

  const afm=e.target.closest('[data-append-fb-model]');
  if(afm){
    const row=afm.closest('.routeRow');
    const input=row.querySelector('[data-field="fallbackModel"]');
    const cur=input.value.trim();
    input.value = cur ? cur + ' | ' + afm.dataset.appendFbModel : afm.dataset.appendFbModel;
    return;
  }

  const tp=e.target.closest('[data-toggle-provider]');
  if(tp){
    try{
      await api('/admin/api/providers/'+encodeURIComponent(tp.dataset.toggleProvider)+'/toggle',{method:'PUT'});
      toast('Provider status updated');
      await refresh();
    }catch(x){toast(x.message,true)}
    return;
  }

  const tm=e.target.closest('[data-toggle-model]');
  if(tm){
    const [pId, mId]=tm.dataset.toggleModel.split(':::');
    try{
      await api('/admin/api/models/'+encodeURIComponent(pId)+'/'+encodeURIComponent(mId)+'/toggle',{method:'PUT'});
      toast('Model status updated');
      await refresh();
    }catch(x){toast(x.message,true)}
    return;
  }

  const testBtn=e.target.closest('[data-test-provider]');
  if(testBtn){
    const id = testBtn.dataset.testProvider;
    testBtn.textContent = 'Testing…';
    testBtn.disabled = true;
    try{
      const res = await api('/admin/api/providers/'+encodeURIComponent(id)+'/test', { method:'POST' });
      toast('✅ ' + (res.message || 'Connected successfully'));
    }catch(x){
      toast('❌ ' + x.message, true);
    }finally{
      testBtn.textContent = 'Test';
      testBtn.disabled = false;
    }
    return;
  }

  const sr=e.target.closest('[data-save-route]');
  if(sr){
    const t=sr.dataset.saveRoute;
    const row=sr.closest('.routeRow');
    try{
      await api('/admin/api/routes/'+encodeURIComponent(t),{
        method:'PUT',
        body:JSON.stringify({
          providerId: row.querySelector('[data-field="providerId"]').value,
          model: row.querySelector('[data-field="model"]').value,
          fallbackProviderId: row.querySelector('[data-field="fallbackProviderId"]').value,
          fallbackModel: row.querySelector('[data-field="fallbackModel"]').value
        })
      });
      toast('Route saved for '+t);
      await refresh();
    }catch(x){toast(x.message,true)}
    return;
  }

  const rp=e.target.closest('[data-remove-provider]');
  if(rp){
    if(!confirm('Delete this provider? Associated models and routes will be cleaned up.')) return;
    try{
      await api('/admin/api/providers/'+encodeURIComponent(rp.dataset.removeProvider),{method:'DELETE'});
      toast('Provider deleted');
      await refresh();
    }catch(x){toast(x.message,true)}
    return;
  }

  const ep=e.target.closest('[data-edit-provider]');
  if(ep){
    const id=ep.dataset.editProvider;
    const p=runtime.providers.find(x=>x.id===id);
    if(p){
      $('#provId').value=p.id;
      $('#provName').value=p.name;
      $('#provKind').value=p.kind;
      $('#provUrl').value=p.apiUrl||'';
      $('#provNotes').value=p.notes||'';
      $('#provKind').dispatchEvent(new Event('change'));
      $('#providerFormTitle').textContent='Edit Provider: '+p.name;
      $('#provName').focus();
    }
    return;
  }

  const rm=e.target.closest('[data-remove-model]');
  if(rm){
    if(!confirm('Delete this model from registry?')) return;
    const [pId, mId]=rm.dataset.removeModel.split(':::');
    try{
      await api('/admin/api/models/'+encodeURIComponent(pId)+'/'+encodeURIComponent(mId),{method:'DELETE'});
      toast('Model removed');
      await refresh();
    }catch(x){toast(x.message,true)}
    return;
  }

  const em=e.target.closest('[data-edit-model]');
  if(em){
    const [pId, mId]=em.dataset.editModel.split(':::');
    const m=runtime.models.find(x=>x.providerId===pId&&x.id===mId);
    if(m){
      $('#modelProvSelect').value=m.providerId;
      $('#modelIdInput').value=m.id;
      $('#modelLabelInput').value=m.label;
      $('#modelPriorityInput').value=m.priority||50;
      $('#modelNotesInput').value=m.notes||'';
      document.querySelectorAll('#capabilitiesCheckboxes input').forEach(cb=>{
        cb.checked=m.capabilities.includes(cb.value);
      });
      $('#modelFormTitle').textContent='Edit Model: '+m.label;
      $('#modelLabelInput').focus();
    }
    return;
  }

  const su=e.target.closest('[data-save-user]');
  if(su){
    const tr=su.closest('tr'), id=tr.dataset.user;
    try{
      await api('/admin/api/users/'+encodeURIComponent(id),{
        method:'PUT',
        body:JSON.stringify({
          role:tr.querySelector('[data-role]').value,
          planId:tr.querySelector('[data-plan]').value,
          subscriptionStatus:tr.querySelector('[data-status]').value,
          creditsUsed:Number(tr.querySelector('[data-used]').value),
          bonusCredits:Number(tr.querySelector('[data-bonus]').value),
          disabled:tr.querySelector('[data-disabled]').checked
        })
      });
      toast('User saved');
      await refresh();
    }catch(x){toast(x.message,true)}
    return;
  }

  const ru=e.target.closest('[data-reset-user]');
  if(ru){
    const id=ru.closest('tr').dataset.user;
    try{
      await api('/admin/api/users/'+encodeURIComponent(id)+'/reset',{method:'POST',body:'{}'});
      toast('Usage reset');
      await refresh();
    }catch(x){toast(x.message,true)}
    return;
  }

  const sp=e.target.closest('[data-save-plan]');
  if(sp){
    const r=sp.closest('[data-plan-row]'), id=r.dataset.planRow;
    try{
      await api('/admin/api/plans/'+id,{
        method:'PUT',
        body:JSON.stringify({
          monthlyCredits:Number(r.querySelector('[data-credits]').value),
          maxThinking:r.querySelector('[data-thinking]').value,
          maxImageJobsPerMonth:Number(r.querySelector('[data-img]').value),
          maxImageEditJobsPerMonth:Number(r.querySelector('[data-edit]').value),
          maxVideoJobsPerMonth:Number(r.querySelector('[data-video]').value),
          imageGenerate:r.querySelector('[data-img-on]').checked,
          imageEdit:r.querySelector('[data-edit-on]').checked,
          videoGenerate:r.querySelector('[data-video-on]').checked
        })
      });
      toast('Plan saved');
      await refresh();
    }catch(x){toast(x.message,true)}
  }
});

$('#saveVoice').onclick=async()=>{
  try{
    await api('/admin/api/voice',{
      method:'PUT',
      body:JSON.stringify({
        thinkingLevel:$('#thinking').value,
        speakerAccess:$('#speakerAccess').value,
        liveVoice:$('#liveVoice').value,
        ttsVoice:$('#ttsVoice').value,
        silenceMs:Number($('#silence').value)
      })
    });
    toast('Voice engine saved');
    await refresh();
  }catch(x){toast(x.message,true)}
};

$('#saveDisplay').onclick=async()=>{
  try{
    await api('/admin/api/display',{
      method:'PUT',
      body:JSON.stringify({
        headingSize:$('#dispHeading').value,
        density:$('#dispDensity').value,
        divider:$('#dispDivider').value,
        originalPreviewChars:Number($('#dispChars').value),
        showEmojis:$('#dispEmojis').checked,
        showDetectedLanguage:$('#dispDetected').checked,
        showProvider:$('#dispProvider').checked,
        showOriginal:$('#dispOriginal').checked,
        quoteArabic:$('#dispQuoteArabic').checked,
        smartAnswerArabicFirst:$('#dispSmartArabicFirst').checked
      })
    });
    toast('Display settings saved');
    await refresh();
  }catch(x){toast(x.message,true)}
};

$('#btnPresetGemini').onclick=async()=>{
  for(const t of runtime.tasks){
    try{
      await api('/admin/api/routes/'+encodeURIComponent(t.id),{
        method:'PUT',
        body:JSON.stringify({
          providerId:'env-gemini',
          model:runtime.managedModelChains[t.id]||''
        })
      });
    }catch(e){}
  }
  toast('Gemini Preset Applied');
  await refresh();
};

$('#btnPresetHybrid').onclick=async()=>{
  toast('Configuring hybrid routes...');
  const mappings={
    translation:{ providerId:'env-gemini', model:'gemini-3.7-flash | gemini-3.5-flash' },
    chat:{ providerId:'env-gemini', model:'gemini-3.7-flash | gemini-3.6-flash' },
    code:{ providerId:'env-gemini', model:'gemini-3.7-flash | gemini-3.5-flash' },
    ai_tools:{ providerId:'env-gemini', model:'gemini-3.7-flash | gemini-3.5-flash' },
    smart_reply:{ providerId:'env-gemini', model:'gemini-3.6-flash | gemini-3.5-flash' },
    image_generate:{ providerId:'env-gemini', model:'gemini-3.1-flash-image | gemini-3.1-flash-lite-image' },
    image_edit:{ providerId:'env-gemini', model:'gemini-3.1-flash-image | gemini-2.5-flash-image' },
    video_generate:{ providerId:'env-gemini', model:'veo-3.1-lite-generate-preview | veo-3.1-fast-generate-preview' },
    voice_live:{ providerId:'env-gemini', model:'gemini-3.1-flash-live-preview' },
    voice_translate:{ providerId:'env-gemini', model:'gemini-3.5-live-translate-preview' },
    stt:{ providerId:'env-gemini', model:'gemini-3.1-flash-lite' },
    tts:{ providerId:'env-gemini', model:'gemini-3.1-flash-tts-preview' }
  };
  for(const [taskId, route] of Object.entries(mappings)){
    try{
      await api('/admin/api/routes/'+encodeURIComponent(taskId),{ method:'PUT', body:JSON.stringify(route) });
    }catch(e){}
  }
  toast('Hybrid Preset Applied');
  await refresh();
};

$('#btnRefreshHealth').onclick=async()=>{
  health=await api('/admin/api/provider-health');
  renderHealth();
  toast('Health telemetry refreshed');
};

$('#openUser').onclick=async()=>{
  const id=$('#newUserId').value.trim();
  if(!id)return toast('Enter a Discord User ID',true);
  try{
    await api('/admin/api/users/'+encodeURIComponent(id),{method:'PUT',body:'{}'});
    toast('User opened');
    await refresh();
  }catch(x){toast(x.message,true)}
};

refresh().catch(e=>toast(e.message,true));
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
      res.status(503).send('TD AI dashboard is not configured.');
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
      if (!dashboardEnabled()) {
        throw new Error('TD AI dashboard is disabled.');
      }

      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const expectedState = parseCookies(req)[STATE_COOKIE];

      if (!code || !state || !expectedState || state !== expectedState) {
        throw new Error('Invalid OAuth state.');
      }

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

      if (!tokenResponse.ok) {
        throw new Error(`Discord OAuth failed (${tokenResponse.status}).`);
      }

      const token = (await tokenResponse.json()) as { access_token?: string };
      if (!token.access_token) {
        throw new Error('Discord did not return an access token.');
      }

      const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(15_000)
      });

      if (!userResponse.ok) {
        throw new Error('Could not read Discord identity.');
      }

      const user = (await userResponse.json()) as { id?: string };
      if (!user.id) {
        throw new Error('Discord identity does not contain a user ID.');
      }

      await userUsageSummary(user.id);

      res.setHeader('Set-Cookie', [
        secureCookie(SESSION_COOKIE, encodeSession(user.id), Math.floor(SESSION_TTL_MS / 1000)),
        clearCookie(STATE_COOKIE)
      ]);

      res.redirect('/admin');
    } catch (error) {
      res.status(400).send(`TD AI login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  router.get('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE));
    res.redirect('/admin/login');
  });

  router.get('/', async (req, res) => {
    if (!dashboardEnabled()) {
      res.status(503).send('TD AI dashboard is not configured.');
      return;
    }

    const session = decodeSession(parseCookies(req)[SESSION_COOKIE]);
    if (!session) {
      res.redirect('/admin/login');
      return;
    }

    const admin = await isAdminUser(session.userId).catch(() => false);
    const wantsAdmin = req.query.view === 'admin';

    if (wantsAdmin && !admin) {
      res.status(403).send('Admin access is required.');
      return;
    }

    res.type('html').send(wantsAdmin ? adminPage() : userPage(admin));
  });

  router.use('/api', express.json({ limit: '64kb' }), requireAuth, requireSameOrigin);

  router.get('/api/me', async (_req, res) => {
    try {
      const userId = String(res.locals.dashboardUserId);
      res.json({
        userId,
        admin: await isAdminUser(userId),
        usage: await userUsageSummary(userId),
        plans: await listPlans(),
        voices: [...ALLOWED_VOICES]
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load account.' });
    }
  });

  router.get('/api/personalization', async (_req, res) => {
    const userId = String(res.locals.dashboardUserId);
    res.json(await getUserPersonalization(userId));
  });

  router.put('/api/personalization', async (req, res) => {
    try {
      const userId = String(res.locals.dashboardUserId);
      res.json(
        await setUserPersonalization(userId, {
          myLanguage: typeof req.body.myLanguage === 'string' ? req.body.myLanguage : undefined,
          outgoingLanguage: typeof req.body.outgoingLanguage === 'string' ? req.body.outgoingLanguage : undefined,
          translationStyle: req.body.translationStyle,
          translationProvider: req.body.translationProvider,
          autoTranslateToMyLanguage: req.body.autoTranslateToMyLanguage !== undefined ? Boolean(req.body.autoTranslateToMyLanguage) : undefined,
          wakeName: typeof req.body.wakeName === 'string' ? req.body.wakeName : undefined,
          followupWindowMs: req.body.followupWindowMs === undefined ? undefined : Number(req.body.followupWindowMs),
          voiceName: typeof req.body.voiceName === 'string' ? req.body.voiceName : undefined,
          responseDelayMs: req.body.responseDelayMs === undefined ? undefined : Number(req.body.responseDelayMs),
          resultDestination: req.body.resultDestination,
          defaultReplyLanguage: typeof req.body.defaultReplyLanguage === 'string' ? req.body.defaultReplyLanguage : undefined,
          defaultImageAspect: typeof req.body.defaultImageAspect === 'string' ? req.body.defaultImageAspect : undefined,
          imageQuality: req.body.imageQuality,
          defaultVideoAspect: typeof req.body.defaultVideoAspect === 'string' ? req.body.defaultVideoAspect : undefined,
          videoQuality: req.body.videoQuality,
          headingSize: req.body.headingSize as UserHeadingSize,
          density: req.body.density as UserDensity,
          showEmojis: req.body.showEmojis !== false,
          showOriginal: req.body.showOriginal !== false
        })
      );
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save personalization.' });
    }
  });

  router.get('/api/config', requireAdmin, async (_req, res) => {
    try {
      res.json(await getAdminRuntimeSnapshot());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load configuration.' });
    }
  });

  router.get('/api/model-catalog', requireAdmin, (_req, res) => {
    res.json(publicModelCatalog());
  });

  router.get('/api/voice-control', requireAdmin, async (_req, res) => {
    res.json(await getVoiceControlSettings());
  });

  router.put('/api/voice-control', requireAdmin, async (req, res) => {
    try {
      res.json(
        await setVoiceControlSettings({
          activationMode: req.body.activationMode as VoiceActivationMode,
          wakeWords: Array.isArray(req.body.wakeWords) ? req.body.wakeWords.map(String) : undefined,
          wakeWindowMs: req.body.wakeWindowMs === undefined ? undefined : Number(req.body.wakeWindowMs),
          followupWindowMs: req.body.followupWindowMs === undefined ? undefined : Number(req.body.followupWindowMs),
          followupSpeaker: req.body.followupSpeaker as FollowupSpeaker
        })
      );
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save voice control.' });
    }
  });

  router.get('/api/users', requireAdmin, async (_req, res) => {
    res.json(await listUsers());
  });

  router.put('/api/users/:id', requireAdmin, async (req, res) => {
    try {
      res.json(
        await adminUpdateUser(String(req.params.id ?? ''), {
          role: req.body.role as AccountRole | undefined,
          planId: req.body.planId as PlanId | undefined,
          subscriptionStatus: req.body.subscriptionStatus as SubscriptionStatus | undefined,
          bonusCredits: req.body.bonusCredits === undefined ? undefined : Number(req.body.bonusCredits),
          creditsUsed: req.body.creditsUsed === undefined ? undefined : Number(req.body.creditsUsed),
          disabled: req.body.disabled === true
        })
      );
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update user.' });
    }
  });

  router.post('/api/users/:id/reset', requireAdmin, async (req, res) => {
    try {
      await resetUserUsage(String(req.params.id ?? ''));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not reset usage.' });
    }
  });

  router.put('/api/plans/:id', requireAdmin, async (req, res) => {
    try {
      res.json(
        await updatePlan(String(req.params.id ?? '') as PlanId, {
          monthlyCredits: req.body.monthlyCredits === undefined ? undefined : Number(req.body.monthlyCredits),
          maxThinking: req.body.maxThinking,
          liveTranslation: req.body.liveTranslation === undefined ? undefined : req.body.liveTranslation === true,
          imageGenerate: req.body.imageGenerate === undefined ? undefined : req.body.imageGenerate === true,
          imageEdit: req.body.imageEdit === undefined ? undefined : req.body.imageEdit === true,
          videoGenerate: req.body.videoGenerate === undefined ? undefined : req.body.videoGenerate === true,
          maxImageJobsPerMonth: req.body.maxImageJobsPerMonth === undefined ? undefined : Number(req.body.maxImageJobsPerMonth),
          maxImageEditJobsPerMonth: req.body.maxImageEditJobsPerMonth === undefined ? undefined : Number(req.body.maxImageEditJobsPerMonth),
          maxVideoJobsPerMonth: req.body.maxVideoJobsPerMonth === undefined ? undefined : Number(req.body.maxVideoJobsPerMonth)
        })
      );
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update plan.' });
    }
  });

  router.get('/api/provider-health', requireAdmin, async (_req, res) => {
    res.json(await listProviderHealth());
  });

  router.post('/api/providers', requireAdmin, async (req, res) => {
    try {
      const id = await upsertRuntimeProvider({
        id: typeof req.body.id === 'string' && req.body.id.trim() ? req.body.id.trim() : undefined,
        name: String(req.body.name ?? ''),
        kind: req.body.kind as ProviderKind,
        apiUrl: typeof req.body.apiUrl === 'string' ? req.body.apiUrl : undefined,
        apiKey: typeof req.body.apiKey === 'string' ? req.body.apiKey : undefined,
        enabled: req.body.enabled !== false,
        notes: typeof req.body.notes === 'string' ? req.body.notes : undefined
      });
      res.json({ ok: true, id });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save provider.' });
    }
  });

  router.post('/api/providers/:id/test', requireAdmin, async (req, res) => {
    try {
      const result = await testRuntimeProvider(String(req.params.id ?? ''));
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Provider connectivity test failed.' });
    }
  });

  router.put('/api/providers/:id/toggle', requireAdmin, async (req, res) => {
    try {
      const enabled = await toggleRuntimeProvider(
        String(req.params.id ?? ''),
        typeof req.body.enabled === 'boolean' ? req.body.enabled : undefined
      );
      res.json({ ok: true, enabled });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not toggle provider.' });
    }
  });

  router.delete('/api/providers/:id', requireAdmin, async (req, res) => {
    try {
      await deleteRuntimeProvider(String(req.params.id ?? ''));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not delete provider.' });
    }
  });

  router.post('/api/models', requireAdmin, async (req, res) => {
    try {
      const id = await upsertRuntimeModel({
        id: String(req.body.id ?? ''),
        providerId: String(req.body.providerId ?? ''),
        label: String(req.body.label ?? ''),
        capabilities: Array.isArray(req.body.capabilities) ? req.body.capabilities : [],
        enabled: req.body.enabled !== false,
        priority: req.body.priority === undefined ? undefined : Number(req.body.priority),
        notes: typeof req.body.notes === 'string' ? req.body.notes : undefined
      });
      res.json({ ok: true, id });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save model.' });
    }
  });

  router.put('/api/models/:providerId/:modelId/toggle', requireAdmin, async (req, res) => {
    try {
      const enabled = await toggleRuntimeModel(
        String(req.params.providerId ?? ''),
        String(req.params.modelId ?? ''),
        typeof req.body.enabled === 'boolean' ? req.body.enabled : undefined
      );
      res.json({ ok: true, enabled });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not toggle model.' });
    }
  });

  router.delete('/api/models/:providerId/:modelId', requireAdmin, async (req, res) => {
    try {
      await deleteRuntimeModel(String(req.params.providerId ?? ''), String(req.params.modelId ?? ''));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not delete model.' });
    }
  });

  router.put('/api/routes/:task', requireAdmin, async (req, res) => {
    try {
      await setRuntimeRoute(String(req.params.task ?? '') as RuntimeTask, {
        providerId: String(req.body.providerId ?? ''),
        model: String(req.body.model ?? ''),
        fallbackProviderId: typeof req.body.fallbackProviderId === 'string' ? req.body.fallbackProviderId : undefined,
        fallbackModel: typeof req.body.fallbackModel === 'string' ? req.body.fallbackModel : undefined
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update route.' });
    }
  });

  router.put('/api/voice', requireAdmin, async (req, res) => {
    try {
      await setVoiceRuntimeSettings({
        thinkingLevel: req.body.thinkingLevel as ThinkingLevelName,
        silenceMs: Number(req.body.silenceMs),
        liveVoice: String(req.body.liveVoice ?? ''),
        ttsVoice: String(req.body.ttsVoice ?? ''),
        speakerAccess: req.body.speakerAccess as VoiceSpeakerAccess
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update voice settings.' });
    }
  });

  router.put('/api/display', requireAdmin, async (req, res) => {
    try {
      await setDisplayRuntimeSettings({
        headingSize: req.body.headingSize as DisplayHeadingSize,
        density: req.body.density as DisplayDensity,
        divider: req.body.divider as DisplayDivider,
        originalPreviewChars: req.body.originalPreviewChars === undefined ? undefined : Number(req.body.originalPreviewChars),
        showEmojis: req.body.showEmojis !== false,
        showDetectedLanguage: req.body.showDetectedLanguage !== false,
        showProvider: req.body.showProvider === true,
        showOriginal: req.body.showOriginal !== false,
        quoteArabic: req.body.quoteArabic !== false,
        smartAnswerArabicFirst: req.body.smartAnswerArabicFirst !== false
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update display settings.' });
    }
  });

  app.use('/admin', router);
}
