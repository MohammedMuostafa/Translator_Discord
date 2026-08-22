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
  upsertRuntimeProvider,
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

const SESSION_COOKIE =
  'td_dashboard_session';

const STATE_COOKIE =
  'td_dashboard_state';

const SESSION_TTL_MS =
  8 * 60 * 60_000;

function dashboardBaseUrl():
string | undefined {
  return (
    env.DASHBOARD_PUBLIC_URL ??
    env.PUBLIC_BASE_URL
  );
}

function dashboardEnabled():
boolean {
  return Boolean(
    env.DISCORD_CLIENT_SECRET &&
    env.DASHBOARD_SESSION_SECRET &&
    dashboardBaseUrl()
  );
}

function parseCookies(
  req: Request
): Record<string, string> {
  const header =
    req.headers.cookie ??
    '';

  const result:
    Record<string, string> =
      {};

  for (
    const part of
    header.split(';')
  ) {
    const [
      key,
      ...valueParts
    ] =
      part.trim().split('=');

    if (!key) continue;

    result[key] =
      decodeURIComponent(
        valueParts.join('=')
      );
  }

  return result;
}

function sign(
  value: string
): string {
  return createHmac(
    'sha256',
    env.DASHBOARD_SESSION_SECRET ??
      'disabled'
  )
    .update(value)
    .digest('base64url');
}

function encodeSession(
  userId: string
): string {
  const payload =
    Buffer.from(
      JSON.stringify({
        userId,
        exp:
          Date.now() +
          SESSION_TTL_MS
      })
    ).toString(
      'base64url'
    );

  return (
    `${payload}.${sign(payload)}`
  );
}

function decodeSession(
  raw: string | undefined
): {
  userId: string;
} | undefined {
  if (!raw) return undefined;

  const [
    payload,
    signature
  ] =
    raw.split('.');

  if (
    !payload ||
    !signature
  ) {
    return undefined;
  }

  const expected =
    sign(payload);

  const actualBuffer =
    Buffer.from(signature);

  const expectedBuffer =
    Buffer.from(expected);

  if (
    actualBuffer.length !==
      expectedBuffer.length ||
    !timingSafeEqual(
      actualBuffer,
      expectedBuffer
    )
  ) {
    return undefined;
  }

  try {
    const parsed =
      JSON.parse(
        Buffer.from(
          payload,
          'base64url'
        ).toString('utf8')
      ) as {
        userId?: string;
        exp?: number;
      };

    if (
      !parsed.userId ||
      !parsed.exp ||
      parsed.exp <
        Date.now()
    ) {
      return undefined;
    }

    return {
      userId:
        parsed.userId
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
  return (
    `${name}=` +
    `${encodeURIComponent(value)}; ` +
    'Path=/admin; HttpOnly; ' +
    'SameSite=Lax; Secure; ' +
    `Max-Age=${maxAgeSeconds}`
  );
}

function clearCookie(
  name: string
): string {
  return (
    `${name}=; ` +
    'Path=/admin; HttpOnly; ' +
    'SameSite=Lax; Secure; ' +
    'Max-Age=0'
  );
}

function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (
    !dashboardEnabled()
  ) {
    res.status(503).json({
      error:
        'TD AI dashboard is not configured yet.'
    });
    return;
  }

  const session =
    decodeSession(
      parseCookies(req)[
        SESSION_COOKIE
      ]
    );

  if (!session) {
    res.status(401).json({
      error:
        'Not authenticated.'
    });
    return;
  }

  res.locals.dashboardUserId =
    session.userId;

  next();
}

function requireAdmin(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId =
    String(
      res.locals.dashboardUserId ??
      ''
    );

  void isAdminUser(userId)
    .then(
      (admin) => {
        if (!admin) {
          res.status(403).json({
            error:
              'Admin access is required.'
          });
          return;
        }

        next();
      }
    )
    .catch(
      (error) => {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not verify admin access.'
        });
      }
    );
}

function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const base =
    dashboardBaseUrl();

  const origin =
    req.headers.origin;

  if (
    !base ||
    !origin
  ) {
    next();
    return;
  }

  try {
    if (
      new URL(origin)
        .origin !==
      new URL(base)
        .origin
    ) {
      res.status(403).json({
        error:
          'Invalid origin.'
      });
      return;
    }
  } catch {
    res.status(403).json({
      error:
        'Invalid origin.'
    });
    return;
  }

  next();
}

function themeCss(): string {
  return `
:root{
  --bg:#05070d;
  --bg2:#080c15;
  --glass:rgba(15,22,36,.72);
  --glass2:rgba(19,29,48,.84);
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
  --shadow:0 35px 90px rgba(0,0,0,.34);
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
.shell{display:grid;grid-template-columns:250px 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;padding:22px 15px;border-right:1px solid var(--line);background:rgba(5,8,14,.74);backdrop-filter:blur(22px);z-index:5}
.brand{display:flex;align-items:center;gap:12px;padding:5px 8px 26px}
.logo{position:relative;width:48px;height:48px;border-radius:15px;display:grid;place-items:center;font-weight:950;letter-spacing:-.04em;color:#041018;background:linear-gradient(135deg,var(--cyan),var(--blue) 52%,var(--violet));box-shadow:0 12px 35px rgba(86,224,255,.18)}
.logo:after{content:"";position:absolute;inset:-1px;border-radius:16px;border:1px solid rgba(255,255,255,.35);pointer-events:none}
.brand h1{margin:0;font-size:19px;letter-spacing:-.02em}
.brand p{margin:3px 0 0;color:var(--muted);font-size:11px}
.planPill{display:inline-flex;margin-top:5px;padding:3px 7px;border:1px solid var(--line);border-radius:999px;color:#c8d6ea;font-size:10px;background:rgba(255,255,255,.025)}
.nav{display:grid;gap:7px}
.nav button,.nav a{display:flex;align-items:center;gap:10px;width:100%;border:0;text-decoration:none;background:transparent;color:var(--muted);padding:11px 12px;border-radius:12px;text-align:left;cursor:pointer;transition:.18s ease}
.nav button:hover,.nav a:hover,.nav button.active{color:var(--text);transform:translateX(2px);background:linear-gradient(90deg,rgba(86,224,255,.11),rgba(162,121,255,.08));box-shadow:inset 0 0 0 1px rgba(103,199,255,.1)}
.navIcon{width:22px;text-align:center;filter:saturate(.8)}
.adminLink{margin-top:15px!important;color:#e3dcff!important;background:linear-gradient(135deg,rgba(162,121,255,.13),rgba(240,122,255,.07))!important;border:1px solid rgba(162,121,255,.22)!important}
.sideBottom{position:absolute;left:15px;right:15px;bottom:20px}
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
.hero{min-height:270px;padding:28px;background:
radial-gradient(circle at 85% 15%,rgba(162,121,255,.2),transparent 34%),
radial-gradient(circle at 65% 95%,rgba(86,224,255,.14),transparent 34%),
linear-gradient(135deg,rgba(18,28,47,.95),rgba(10,15,27,.92))}
.heroTag{display:inline-flex;gap:7px;align-items:center;padding:6px 9px;border-radius:999px;background:rgba(86,224,255,.08);border:1px solid rgba(86,224,255,.18);font-size:11px;color:#c7f8ff}
.hero h1{max-width:800px;margin:18px 0 10px;font-size:clamp(34px,5vw,62px);line-height:.98;letter-spacing:-.065em}
.gradientText{background:linear-gradient(100deg,#fff 10%,var(--cyan) 45%,#cdbdff 75%,var(--pink));-webkit-background-clip:text;color:transparent}
.hero p{max-width:670px;color:#a9b9d2;line-height:1.7}
.heroActions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:11px;padding:10px 14px;font-weight:800;cursor:pointer;text-decoration:none;transition:.18s ease}
.btn:hover{transform:translateY(-1px)}
.primary{color:#041018;background:linear-gradient(135deg,var(--cyan),#8ba3ff);box-shadow:0 12px 32px rgba(86,224,255,.13)}
.secondary{color:var(--text);background:#121c2f;border:1px solid var(--line)}
.danger{color:#ff9daa;background:rgba(255,113,132,.09);border:1px solid rgba(255,113,132,.25)}
.stat{font-size:31px;font-weight:900;letter-spacing:-.04em}
.statLabel{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:9px}
.progress{height:10px;border-radius:999px;background:#050a12;border:1px solid var(--line);overflow:hidden}
.progress span{height:100%;display:block;width:0;background:linear-gradient(90deg,var(--cyan),var(--blue),var(--violet));box-shadow:0 0 20px rgba(86,224,255,.35)}
.meterRow{display:grid;grid-template-columns:140px 1fr auto;gap:12px;align-items:center;margin-top:12px}
.featureGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.featureCard{position:relative;min-height:160px;padding:17px;border-radius:16px;border:1px solid var(--line);background:linear-gradient(145deg,rgba(15,24,41,.9),rgba(7,12,21,.9));transition:.2s}
.featureCard:hover{transform:translateY(-3px);border-color:rgba(86,224,255,.25)}
.featureIcon{font-size:27px;margin-bottom:15px}.featureCard h4{margin:0 0 6px;font-size:15px}.featureCard p{margin:0;color:var(--muted);font-size:12px;line-height:1.6}
.quota{margin-top:12px;font-size:11px;color:#d7e2f1}
.planCard{position:relative;min-height:385px;padding:22px;border-radius:20px;border:1px solid var(--line);background:
radial-gradient(circle at 100% 0%,rgba(111,134,255,.12),transparent 35%),
linear-gradient(180deg,rgba(17,27,45,.96),rgba(8,13,23,.95));transition:.2s}
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
textarea{min-height:115px;resize:vertical}
input:focus,select:focus,textarea:focus{border-color:rgba(86,224,255,.48);box-shadow:0 0 0 3px rgba(86,224,255,.07)}
.toggle{display:flex;align-items:center;gap:9px;min-height:43px;padding:10px 11px;border:1px solid var(--line);background:rgba(4,9,17,.62);border-radius:11px}.toggle input{width:auto}
.preview{min-height:220px;padding:20px;border-radius:16px;border:1px solid var(--line);background:
radial-gradient(circle at 90% 10%,rgba(162,121,255,.1),transparent 35%),
#060b13}
.quickCommand{padding:12px;border-radius:12px;border:1px solid var(--line);background:#050b14;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#cfeaff;word-break:break-word}
.tableWrap{overflow:auto}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:11px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}.table th{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.09em}
.route,.provider{display:grid;gap:10px;align-items:end;padding:12px 0;border-top:1px solid var(--line)}.route{grid-template-columns:1fr 1fr 1.4fr auto}.provider{grid-template-columns:1.2fr 1fr 1.6fr .8fr auto}.route:first-child,.provider:first-child{border-top:0}
.row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.badge{display:inline-flex;padding:4px 7px;border-radius:999px;border:1px solid var(--line);font-size:10px;color:#cbd7e9;background:rgba(255,255,255,.025)}
.badge.pro{color:#ecdfff;border-color:rgba(162,121,255,.28);background:rgba(162,121,255,.08)}.badge.plus{color:#c9f7ff;border-color:rgba(86,224,255,.24);background:rgba(86,224,255,.06)}
.health{display:flex;gap:8px;align-items:center}.dot{width:8px;height:8px;border-radius:50%;background:var(--green)}.dot.bad{background:var(--red)}.dot.warnDot{background:var(--yellow)}
.toast{position:fixed;right:22px;bottom:22px;z-index:20;max-width:420px;padding:13px 15px;border:1px solid var(--line);border-radius:13px;background:#10192a;box-shadow:var(--shadow);opacity:0;transform:translateY(80px);transition:.22s}.toast.show{opacity:1;transform:none}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#050b14;border:1px solid var(--line);padding:2px 6px;border-radius:6px}
.spark{position:absolute;border-radius:50%;filter:blur(1px);animation:float 6s ease-in-out infinite}.spark.a{width:8px;height:8px;right:13%;top:20%;background:var(--cyan)}.spark.b{width:5px;height:5px;right:23%;top:42%;background:var(--violet);animation-delay:-2s}.spark.c{width:4px;height:4px;right:8%;top:65%;background:var(--pink);animation-delay:-4s}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes float{0%,100%{transform:translateY(0) scale(1);opacity:.7}50%{transform:translateY(-18px) scale(1.2);opacity:1}}
@media(max-width:1050px){.shell{grid-template-columns:1fr}.side{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}.nav{grid-template-columns:repeat(3,1fr)}.sideBottom{position:static;margin-top:15px}.main{padding:22px}.third,.half,.twoThird{grid-column:span 12}.featureGrid{grid-template-columns:1fr 1fr}.route,.provider{grid-template-columns:1fr}}
@media(max-width:650px){.nav{grid-template-columns:1fr 1fr}.featureGrid,.settingsGrid,.formGrid{grid-template-columns:1fr}.hero{padding:20px}.hero h1{font-size:38px}.main{padding:16px}.top{align-items:flex-start}.topActions{flex-direction:column}.meterRow{grid-template-columns:1fr}}
`;
}

function userPage(
  showAdminButton: boolean
): string {
  const adminButton =
    showAdminButton
      ? `<a class="adminLink" href="/admin?view=admin"><span class="navIcon">⚡</span> Admin Console</a>`
      : '';

  const inviteUrl =
    `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(env.DISCORD_APP_ID)}`;

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
    <button data-tab="create"><span class="navIcon">✦</span> Create</button>
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
        <span class="heroTag">✦ TD AI • Voice • Translation • Create</span>
        <h1>One AI.<br/><span class="gradientText">Inside your Discord.</span></h1>
        <p>Chat, translate, talk naturally in voice, generate images, edit visuals and create videos — with limits and quality automatically matched to your plan.</p>
        <div class="heroActions">
          <button class="btn primary" data-go="create">Create something ✦</button>
          <button class="btn secondary" data-go="personalize">Personalize TD</button>
        </div>
      </div>

      <div class="card third"><div class="statLabel">Current plan</div><div class="stat" id="homePlan">—</div><div class="sub" style="margin-top:6px">Your active TD AI tier</div></div>
      <div class="card third"><div class="statLabel">Credits remaining</div><div class="stat" id="homeCredits">—</div><div class="sub" style="margin-top:6px" id="homeReset">—</div></div>
      <div class="card third"><div class="statLabel">Monthly usage</div><div class="stat" id="homePercent">—</div><div class="progress" style="margin-top:12px"><span id="homeBar"></span></div></div>

      <div class="card twoThird">
        <h3>What you can do</h3>
        <p class="sub">TD chooses the right internal model automatically. You choose only the experience and quality.</p>
        <div class="featureGrid">
          <div class="featureCard"><div class="featureIcon">💬</div><h4>AI Chat</h4><p>Ask, summarize, explain, rewrite and draft replies.</p></div>
          <div class="featureCard"><div class="featureIcon">🎙️</div><h4>Voice AI</h4><p>Say TD first, talk naturally and use follow-up mode.</p></div>
          <div class="featureCard"><div class="featureIcon">🌐</div><h4>Live Translate</h4><p>Two-way spoken translation between people in voice.</p><div class="quota" id="liveAccess">—</div></div>
          <div class="featureCard"><div class="featureIcon">🖼️</div><h4>Image Studio</h4><p>Generate and edit images from natural-language prompts.</p><div class="quota" id="imageQuota">—</div></div>
          <div class="featureCard"><div class="featureIcon">🎬</div><h4>Video Studio</h4><p>Create short AI videos with plan-based quality.</p><div class="quota" id="videoQuota">—</div></div>
          <div class="featureCard"><div class="featureIcon">✨</div><h4>Smart Answer</h4><p>Understand messages and generate reply-ready answers.</p></div>
        </div>
      </div>

      <div class="card third">
        <h3>Usage mix</h3>
        <p class="sub">Your current monthly TD credit usage.</p>
        <div id="usageMix"></div>
      </div>
    </div>
  </section>

  <section id="create" class="section">
    <div class="grid">
      <div class="card hero">
        <span class="heroTag">Creative Studio</span>
        <h1 style="font-size:48px">Turn prompts into<br/><span class="gradientText">images & video.</span></h1>
        <p>You never need to select a Gemini model. Pick a simple quality preset and TD routes the request to the best model your plan allows.</p>
      </div>

      <div class="card half">
        <h3>🖼️ Image Studio</h3>
        <p class="sub">Generate a new image or edit an existing one in Discord.</p>
        <div class="settingsGrid">
          <div class="field"><label>Action</label><select id="imgAction"><option value="generate">Generate</option><option value="edit">Edit existing image</option></select></div>
          <div class="field"><label>Quality</label><select id="imgQuality"><option value="draft">Draft</option><option value="standard">Standard</option><option value="premium">Premium</option></select></div>
          <div class="field"><label>Aspect</label><select id="imgAspect"><option>1:1</option><option>16:9</option><option>9:16</option><option>3:2</option><option>2:3</option><option>4:3</option><option>3:4</option></select></div>
          <div class="field"><label>Images left this month</label><input id="imgLeft" readonly/></div>
          <div class="field wide"><label>Prompt</label><textarea id="imgPrompt" placeholder="A cinematic futuristic Cairo street at night, rain, neon reflections…"></textarea></div>
        </div>
        <div class="quickCommand" id="imgCommand" style="margin-top:13px">/image generate …</div>
        <button class="btn primary" id="copyImage" style="margin-top:12px">Copy Discord command</button>
      </div>

      <div class="card half">
        <h3>🎬 Video Studio</h3>
        <p class="sub">Veo generation is available according to your plan.</p>
        <div class="settingsGrid">
          <div class="field"><label>Quality</label><select id="vidQuality"><option value="lite">Lite</option><option value="fast">Fast</option><option value="cinematic">Cinematic</option></select></div>
          <div class="field"><label>Aspect</label><select id="vidAspect"><option>16:9</option><option>9:16</option></select></div>
          <div class="field wide"><label>Videos left this month</label><input id="vidLeft" readonly/></div>
          <div class="field wide"><label>Prompt</label><textarea id="vidPrompt" placeholder="Drone shot through a futuristic city at sunrise, slow cinematic camera movement, atmospheric audio…"></textarea></div>
        </div>
        <div class="quickCommand" id="vidCommand" style="margin-top:13px">/video generate …</div>
        <button class="btn primary" id="copyVideo" style="margin-top:12px">Copy Discord command</button>
      </div>

      <div class="card">
        <div class="notice">Media generation runs inside Discord using <code>/image</code> and <code>/video</code>. TD automatically blocks qualities your plan does not include and tracks both credits and monthly job limits.</div>
      </div>
    </div>
  </section>

  <section id="plans" class="section">
    <div class="grid" id="planGrid"></div>
  </section>

  <section id="personalize" class="section">
    <div class="grid">
      <div class="card half">
        <h3>Message style</h3>
        <p class="sub">Discord controls its font family, but TD can change Markdown hierarchy, spacing and visual density.</p>
        <div class="settingsGrid">
          <div class="field"><label>Heading size</label><select id="headingSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div>
          <div class="field"><label>Spacing</label><select id="density"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="relaxed">Relaxed</option></select></div>
          <label class="toggle"><input id="showEmojis" type="checkbox"/> Show section emojis</label>
          <label class="toggle"><input id="showOriginal" type="checkbox"/> Show original-message preview</label>
        </div>
        <button class="btn primary" id="saveText" style="margin-top:14px">Save message style</button>
      </div>

      <div class="card half">
        <h3>Voice personality</h3>
        <p class="sub">Choose how TD sounds in your new voice sessions.</p>
        <div class="settingsGrid">
          <div class="field wide"><label>Voice</label><select id="voiceName"></select></div>
          <div class="field wide"><label>Response delay</label><select id="delay"><option value="0">Instant</option><option value="250">0.25 sec</option><option value="500">0.5 sec</option><option value="1000">1 sec</option><option value="1500">1.5 sec</option><option value="2000">2 sec</option><option value="3000">3 sec</option></select></div>
        </div>
        <button class="btn primary" id="saveVoice" style="margin-top:14px">Save voice</button>
      </div>

      <div class="card">
        <h3>Discord preview</h3>
        <p class="sub">Approximate preview of your personal output style.</p>
        <div class="preview" id="preview"></div>
      </div>
    </div>
  </section>
</main>
</div>
<div class="toast" id="toast"></div>
<script>
const $=s=>document.querySelector(s);let me,prefs,plans=[];
function fmt(n){return Number(n||0).toLocaleString()}
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function toast(m,b=false){const t=$('#toast');t.textContent=m;t.style.borderColor=b?'var(--red)':'var(--line)';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2300)}
async function api(u,o={}){const r=await fetch(u,{headers:{'content-type':'application/json',...(o.headers||{})},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}
function tab(id){document.querySelectorAll('.nav button,.section').forEach(x=>x.classList.remove('active'));document.querySelector('[data-tab="'+id+'"]')?.classList.add('active');$('#'+id)?.classList.add('active');$('#pageTitle').textContent=document.querySelector('[data-tab="'+id+'"]')?.textContent.trim()||id}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));document.addEventListener('click',e=>{const g=e.target.closest('[data-go]');if(g)tab(g.dataset.go)});
function renderHome(){const u=me.usage;$('#sidePlan').textContent=u.plan.name+' plan';$('#homePlan').textContent=u.plan.name;$('#homeCredits').textContent=fmt(u.remaining);$('#homePercent').textContent=u.percent+'%';$('#homeBar').style.width=Math.min(100,u.percent)+'%';$('#homeReset').textContent='Resets '+new Date(u.account.periodEnd).toLocaleDateString();$('#liveAccess').textContent=u.plan.liveTranslation?'Included':'Upgrade to Plus';$('#imageQuota').textContent=u.media.imageGenerate.enabled?fmt(u.media.imageGenerate.remaining)+' generates left':'Not included';$('#videoQuota').textContent=u.media.videoGenerate.enabled?fmt(u.media.videoGenerate.remaining)+' videos left':'Plus / Pro only';const entries=Object.entries(u.byFeature||{}).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,6);const max=Math.max(1,...entries.map(x=>Number(x[1])));$('#usageMix').innerHTML=entries.length?entries.map(([k,v])=>'<div class="meterRow"><span class="tiny">'+esc(k.replaceAll('_',' '))+'</span><div class="progress"><span style="width:'+Math.max(3,Number(v)/max*100)+'%"></span></div><strong class="tiny">'+fmt(v)+'</strong></div>').join(''):'<div class="tiny">No metered usage yet.</div>';$('#imgLeft').value=u.media.imageGenerate.enabled?u.media.imageGenerate.remaining+' generate • '+u.media.imageEdit.remaining+' edits':'Not available';$('#vidLeft').value=u.media.videoGenerate.enabled?u.media.videoGenerate.remaining:'Not available';applyPlanToStudio()}
function renderPlans(){$('#planGrid').innerHTML=plans.map(p=>'<div class="card third" style="padding:0;background:transparent;border:0;box-shadow:none"><div class="planCard '+(p.id==='plus'?'featured':'')+'"><div class="planName">'+esc(p.name)+'</div><div class="planCredits">'+fmt(p.monthlyCredits)+' <small>credits / month</small></div><div class="planFeatures"><div class="planFeature"><span class="yes">✓</span> Voice AI</div><div class="planFeature"><span class="'+(p.liveTranslation?'yes':'no')+'">'+(p.liveTranslation?'✓':'—')+'</span> Live Translation</div><div class="planFeature"><span class="'+(p.imageGenerate?'yes':'no')+'">'+(p.imageGenerate?'✓':'—')+'</span> '+fmt(p.maxImageJobsPerMonth)+' image generations</div><div class="planFeature"><span class="'+(p.imageEdit?'yes':'no')+'">'+(p.imageEdit?'✓':'—')+'</span> '+fmt(p.maxImageEditJobsPerMonth)+' image edits</div><div class="planFeature"><span class="'+(p.videoGenerate?'yes':'no')+'">'+(p.videoGenerate?'✓':'—')+'</span> '+fmt(p.maxVideoJobsPerMonth)+' videos</div><div class="planFeature"><span class="yes">✓</span> '+(p.id==='pro'?'Premium':'Plan-matched')+' AI quality</div></div><button class="btn '+(me.usage.account.planId===p.id?'secondary':'primary')+'" style="width:100%;margin-top:8px" disabled>'+(me.usage.account.planId===p.id?'Current plan':'Upgrade coming soon')+'</button></div></div>').join('')}
function renderPrefs(){const voices=me.voices||[];$('#voiceName').innerHTML=voices.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');$('#headingSize').value=prefs.headingSize;$('#density').value=prefs.density;$('#showEmojis').checked=prefs.showEmojis;$('#showOriginal').checked=prefs.showOriginal;$('#voiceName').value=prefs.voiceName;$('#delay').value=String(prefs.responseDelayMs);preview()}
function preview(){const size=$('#headingSize').value,density=$('#density').value,em=$('#showEmojis').checked,orig=$('#showOriginal').checked;const h=size==='large'?'30px':size==='small'?'18px':'23px',gap=density==='compact'?'8px':density==='relaxed'?'24px':'15px';$('#preview').innerHTML='<div style="font-weight:900;font-size:'+h+';margin-bottom:'+gap+'">'+(em?'🌐 ':'')+'Translation</div><div style="line-height:1.7">This is how a clean TD AI response can feel inside Discord.</div>'+(orig?'<div class="tiny" style="margin-top:'+gap+';border-left:2px solid var(--line2);padding-left:10px">Original message preview</div>':'')}
['headingSize','density','showEmojis','showOriginal'].forEach(id=>$('#'+id).addEventListener('input',preview));
async function savePrefs(){prefs=await api('/admin/api/personalization',{method:'PUT',body:JSON.stringify({headingSize:$('#headingSize').value,density:$('#density').value,showEmojis:$('#showEmojis').checked,showOriginal:$('#showOriginal').checked,voiceName:$('#voiceName').value,responseDelayMs:Number($('#delay').value)})});renderPrefs();toast('Preferences saved')}
$('#saveText').onclick=()=>savePrefs().catch(e=>toast(e.message,true));$('#saveVoice').onclick=()=>savePrefs().catch(e=>toast(e.message,true));
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
<title>TD AI Admin</title>
<style>${themeCss()}</style>
</head>
<body>
<div class="shell">
<aside class="side">
  <div class="brand"><div class="logo">TD</div><div><h1>TD AI</h1><p>Private admin console</p><span class="planPill">SYSTEM ACCESS</span></div></div>
  <div class="nav">
    <a class="adminLink" href="/admin"><span class="navIcon">←</span> User View</a>
    <button class="active" data-tab="overview"><span class="navIcon">⌂</span> Overview</button>
    <button data-tab="users"><span class="navIcon">♙</span> Users & Plans</button>
    <button data-tab="models"><span class="navIcon">◫</span> Model Catalog</button>
    <button data-tab="routing"><span class="navIcon">⇄</span> AI Routing</button>
    <button data-tab="providers"><span class="navIcon">⌁</span> Providers & APIs</button>
    <button data-tab="voice"><span class="navIcon">◉</span> Voice System</button>
    <button data-tab="health"><span class="navIcon">♥</span> Provider Health</button>
  </div>
  <div class="sideBottom"><a class="ghost" style="width:100%;justify-content:center" href="/admin/logout">Log out</a></div>
</aside>

<main class="main">
<div class="top"><div><h2 id="pageTitle">Overview</h2><p>Models, plans, provider keys and system behavior. Admin only.</p></div><div class="topActions"><a class="ghost" href="/admin">Back to User View</a></div></div>

<section id="overview" class="section active">
<div class="grid">
  <div class="card hero">
    <span class="heroTag">⚡ TD AI Control Plane</span>
    <h1>Run the product.<br/><span class="gradientText">Users never see this layer.</span></h1>
    <p>Control plan entitlements, model routing, providers, voice behavior and media quotas while users only interact with clean presets.</p>
  </div>
  <div class="card third"><div class="statLabel">Users</div><div class="stat" id="userCount">—</div></div>
  <div class="card third"><div class="statLabel">Routes</div><div class="stat" id="routeCount">—</div></div>
  <div class="card third"><div class="statLabel">Models in catalog</div><div class="stat" id="modelCount">—</div></div>
  <div class="card half"><h3>Plan isolation</h3><p class="sub">Configured text chains are filtered at runtime by the user's plan. A Free user cannot accidentally receive a Pro-only text model.</p><div class="notice">Example: <code>3.7 → 3.6 → 3.5 Lite</code> becomes only allowed models for each user's tier.</div></div>
  <div class="card half"><h3>Media entitlements</h3><p class="sub">Images, edits and videos have separate monthly job limits in addition to shared credits.</p><div class="notice">Nano Banana and Veo choices are selected server-side from the plan + quality preset.</div></div>
</div>
</section>

<section id="users" class="section">
<div class="grid">
  <div class="card">
    <h3>Users</h3><p class="sub">Manage roles, subscriptions, plans and credits by Discord ID.</p>
    <div class="row" style="margin-bottom:13px"><input id="newUserId" placeholder="Discord User ID" style="max-width:320px"/><button class="btn secondary" id="openUser">Open / Create User</button></div>
    <div class="tableWrap"><table class="table"><thead><tr><th>Discord ID</th><th>Role</th><th>Plan</th><th>Status</th><th>Used</th><th>Bonus</th><th>Suspended</th><th>Actions</th></tr></thead><tbody id="usersBody"></tbody></table></div>
  </div>
  <div class="card">
    <h3>Plan configuration</h3><p class="sub">Change credits and feature/job limits without exposing model IDs to users.</p>
    <div id="adminPlans"></div>
  </div>
</div>
</section>

<section id="models" class="section">
<div class="grid">
  <div class="card">
    <h3>Model Catalog</h3>
    <p class="sub">Internal product catalog. Users see Fast / Balanced / Best and Draft / Standard / Premium — never these IDs.</p>
    <div class="tableWrap"><table class="table"><thead><tr><th>Model</th><th>Kind</th><th>Strength</th><th>Plans</th><th>Relative cost</th><th>API ID</th></tr></thead><tbody id="modelBody"></tbody></table></div>
  </div>
  <div class="card half"><h3>Text tiers</h3><div class="notice"><strong>Free:</strong> Lite / value models<br/><strong>Plus:</strong> up to Gemini 3.6 class<br/><strong>Pro:</strong> Gemini 3.7 / Pro class</div></div>
  <div class="card half"><h3>Media tiers</h3><div class="notice"><strong>Free:</strong> Nano Banana 2 Lite<br/><strong>Plus:</strong> Nano Banana 2 + Veo Lite<br/><strong>Pro:</strong> Nano Banana Pro + full Veo</div></div>
</div>
</section>

<section id="routing" class="section"><div class="card"><h3>AI Routing</h3><p class="sub">Admin-configured chain. TD filters this chain again by plan before a user request is sent.</p><div id="routes"></div></div></section>

<section id="providers" class="section">
<div class="grid">
  <div class="card"><h3>Providers</h3><p class="sub">Encrypted custom provider credentials and environment providers.</p><div id="providerList"></div></div>
  <div class="card"><h3>Add provider</h3><form id="providerForm" class="formGrid"><div class="field"><label>Name</label><input name="name" required placeholder="Gemini Secondary"/></div><div class="field"><label>Type</label><select name="kind"><option value="openai-compatible">OpenAI-compatible</option><option value="gemini-native">Gemini Native</option></select></div><div class="field wide" id="urlField"><label>API URL</label><input name="apiUrl" placeholder="https://.../chat/completions"/></div><div class="field wide"><label>API Key</label><input type="password" name="apiKey" required autocomplete="new-password"/></div><button class="btn primary wide">Save Provider</button></form></div>
</div>
</section>

<section id="voice" class="section">
<div class="grid">
  <div class="card half"><h3>Voice engine</h3><p class="sub">System defaults. Users can only choose their allowed voice and response delay.</p><div class="settingsGrid"><div class="field"><label>Thinking level</label><select id="thinking"><option>minimal</option><option>low</option><option>medium</option><option>high</option></select></div><div class="field"><label>Who can talk</label><select id="speakerAccess"><option value="everyone">Everyone</option><option value="owner-only">Owner only</option></select></div><div class="field"><label>Global Live voice fallback</label><input id="liveVoice"/></div><div class="field"><label>Global TTS fallback</label><input id="ttsVoice"/></div><div class="field wide"><label>End-of-speech silence ms</label><input id="silence" type="number"/></div></div><button class="btn primary" id="saveVoice" style="margin-top:14px">Save Voice Engine</button></div>
  <div class="card half"><h3>Wake defaults</h3><p class="sub">TD stays quiet until called when Wake Word mode is active.</p><div class="settingsGrid"><div class="field"><label>Activation</label><select id="activationMode"><option value="wake-word">Wake word required</option><option value="always">Always listening</option></select></div><div class="field"><label>Follow-up speaker</label><select id="followupSpeaker"><option value="same">Same speaker</option><option value="anyone">Anyone</option></select></div><div class="field wide"><label>Wake words</label><input id="wakeWords"/></div><div class="field"><label>Wake window ms</label><input id="wakeWindowMs" type="number"/></div><div class="field"><label>Follow-up window ms</label><input id="followupWindowMs" type="number"/></div></div><button class="btn primary" id="saveWake" style="margin-top:14px">Save Wake Defaults</button></div>
</div>
</section>

<section id="health" class="section"><div class="card"><h3>Provider Health</h3><p class="sub">Observed model failures, rate limits and recoveries.</p><div id="healthList"></div></div></section>
</main>
</div>
<div class="toast" id="toast"></div>
<script>
const $=s=>document.querySelector(s);let me,runtime,users,health,voice,models,plans=[];
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}function fmt(n){return Number(n||0).toLocaleString()}function toast(m,b=false){const t=$('#toast');t.textContent=m;t.style.borderColor=b?'var(--red)':'var(--line)';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2300)}async function api(u,o={}){const r=await fetch(u,{headers:{'content-type':'application/json',...(o.headers||{})},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}function tab(id){document.querySelectorAll('.nav button,.section').forEach(x=>x.classList.remove('active'));document.querySelector('[data-tab="'+id+'"]')?.classList.add('active');$('#'+id)?.classList.add('active');$('#pageTitle').textContent=document.querySelector('[data-tab="'+id+'"]')?.textContent.trim()||id}document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
function providersFor(k){return runtime.providers.filter(p=>p.kind===k&&p.enabled)}
function render(){plans=me.plans;$('#userCount').textContent=users.length;$('#routeCount').textContent=runtime.tasks.length;$('#modelCount').textContent=models.length;
$('#modelBody').innerHTML=models.map(m=>'<tr><td><strong>'+esc(m.label)+'</strong></td><td>'+esc(m.kind)+'</td><td><span class="badge '+(m.strength==='premium'?'pro':m.strength==='standard'?'plus':'')+'">'+esc(m.strength)+'</span></td><td>'+m.plans.map(p=>'<span class="badge '+(p==='pro'?'pro':p==='plus'?'plus':'')+'">'+p+'</span>').join(' ')+'</td><td>'+m.relativeCost+'x</td><td><code>'+esc(m.id)+'</code></td></tr>').join('');
$('#routes').innerHTML=runtime.tasks.map(t=>{const r=runtime.routes[t.id]||{};return '<div class="route"><div><strong>'+esc(t.label)+'</strong><div class="sub" style="margin:3px 0 0">'+esc(t.id)+'</div></div><div class="field"><label>Provider</label><select data-provider="'+esc(t.id)+'">'+providersFor(t.kind).map(p=>'<option value="'+esc(p.id)+'" '+(r.providerId===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></div><div class="field"><label>Model chain</label><input data-model="'+esc(t.id)+'" value="'+esc(r.model||'')+'"/></div><button class="btn secondary" data-save-route="'+esc(t.id)+'">Save</button></div>'}).join('');
$('#providerList').innerHTML=runtime.providers.map(p=>'<div class="provider"><div><strong>'+esc(p.name)+'</strong><div class="sub" style="margin:3px 0 0">'+esc(p.id)+'</div></div><div>'+esc(p.kind)+'</div><div class="sub" style="margin:0">'+esc(p.apiUrl||'Gemini native')+'</div><div>'+esc(p.apiKeyHint)+'</div><div>'+(p.builtIn?'Built-in':'<button class="btn danger" data-remove-provider="'+esc(p.id)+'">Delete</button>')+'</div></div>').join('');
$('#usersBody').innerHTML=users.map(row=>{const a=row.account;return '<tr data-user="'+esc(a.discordUserId)+'"><td><code>'+esc(a.discordUserId)+'</code></td><td><select data-role><option value="user" '+(a.role==='user'?'selected':'')+'>user</option><option value="admin" '+(a.role==='admin'?'selected':'')+'>admin</option></select></td><td><select data-plan>'+plans.map(p=>'<option value="'+p.id+'" '+(a.planId===p.id?'selected':'')+'>'+p.name+'</option>').join('')+'</select></td><td><select data-status><option value="active" '+(a.subscriptionStatus==='active'?'selected':'')+'>active</option><option value="paused" '+(a.subscriptionStatus==='paused'?'selected':'')+'>paused</option><option value="expired" '+(a.subscriptionStatus==='expired'?'selected':'')+'>expired</option></select></td><td><input data-used type="number" value="'+a.creditsUsed+'"/></td><td><input data-bonus type="number" value="'+a.bonusCredits+'"/></td><td><input data-disabled type="checkbox" '+(a.disabled?'checked':'')+'/></td><td><div class="row"><button class="btn secondary" data-save-user>Save</button><button class="btn danger" data-reset-user>Reset</button></div></td></tr>'}).join('');
$('#adminPlans').innerHTML=plans.map(p=>'<div class="card" data-plan-row="'+p.id+'" style="margin-top:12px;box-shadow:none"><div class="row" style="justify-content:space-between"><div><strong style="font-size:18px">'+p.name+'</strong><div class="sub" style="margin:3px 0 0">'+p.id+'</div></div><span class="badge '+(p.id==='pro'?'pro':p.id==='plus'?'plus':'')+'">'+fmt(p.monthlyCredits)+' credits</span></div><div class="settingsGrid" style="margin-top:14px"><div class="field"><label>Monthly credits</label><input data-credits type="number" value="'+p.monthlyCredits+'"/></div><div class="field"><label>Max thinking</label><select data-thinking><option value="minimal" '+(p.maxThinking==='minimal'?'selected':'')+'>minimal</option><option value="low" '+(p.maxThinking==='low'?'selected':'')+'>low</option><option value="medium" '+(p.maxThinking==='medium'?'selected':'')+'>medium</option><option value="high" '+(p.maxThinking==='high'?'selected':'')+'>high</option></select></div><div class="field"><label>Image generations / month</label><input data-img type="number" value="'+p.maxImageJobsPerMonth+'"/></div><div class="field"><label>Image edits / month</label><input data-edit type="number" value="'+p.maxImageEditJobsPerMonth+'"/></div><div class="field"><label>Videos / month</label><input data-video type="number" value="'+p.maxVideoJobsPerMonth+'"/></div><div></div><label class="toggle"><input data-live type="checkbox" '+(p.liveTranslation?'checked':'')+'/> Live Translation</label><label class="toggle"><input data-img-on type="checkbox" '+(p.imageGenerate?'checked':'')+'/> Image Generate</label><label class="toggle"><input data-edit-on type="checkbox" '+(p.imageEdit?'checked':'')+'/> Image Edit</label><label class="toggle"><input data-video-on type="checkbox" '+(p.videoGenerate?'checked':'')+'/> Video Generate</label></div><button class="btn primary" data-save-plan style="margin-top:13px">Save '+p.name+'</button></div>').join('');
$('#thinking').value=runtime.voice.thinkingLevel;$('#speakerAccess').value=runtime.voice.speakerAccess;$('#liveVoice').value=runtime.voice.liveVoice;$('#ttsVoice').value=runtime.voice.ttsVoice;$('#silence').value=runtime.voice.silenceMs;$('#activationMode').value=voice.activationMode;$('#followupSpeaker').value=voice.followupSpeaker;$('#wakeWords').value=voice.wakeWords.join(', ');$('#wakeWindowMs').value=voice.wakeWindowMs;$('#followupWindowMs').value=voice.followupWindowMs;
$('#healthList').innerHTML=health.map(h=>'<div class="provider"><div><strong>'+esc(h.provider)+'</strong><div class="sub" style="margin:3px 0 0">'+esc(h.model)+'</div></div><div class="health"><span class="dot '+(h.status==='healthy'?'':h.status==='busy'?'warnDot':'bad')+'"></span>'+esc(h.status)+'</div><div class="sub" style="margin:0">'+esc(h.lastMessage||'OK')+'</div><div>'+esc(h.lastStatusCode||'—')+'</div><div class="sub" style="margin:0">'+new Date(h.lastUpdatedAt).toLocaleString()+'</div></div>').join('')||'<div class="sub">No provider events yet.</div>'}
async function refresh(){[me,runtime,users,health,voice,models]=await Promise.all([api('/admin/api/me'),api('/admin/api/config'),api('/admin/api/users'),api('/admin/api/provider-health'),api('/admin/api/voice-control'),api('/admin/api/model-catalog')]);render()}
document.addEventListener('click',async e=>{const sr=e.target.closest('[data-save-route]');if(sr){const t=sr.dataset.saveRoute;try{await api('/admin/api/routes/'+encodeURIComponent(t),{method:'PUT',body:JSON.stringify({providerId:document.querySelector('[data-provider="'+CSS.escape(t)+'"]').value,model:document.querySelector('[data-model="'+CSS.escape(t)+'"]').value})});toast('Route saved');await refresh()}catch(x){toast(x.message,true)}return}const rp=e.target.closest('[data-remove-provider]');if(rp){if(!confirm('Delete provider?'))return;try{await api('/admin/api/providers/'+encodeURIComponent(rp.dataset.removeProvider),{method:'DELETE'});toast('Provider deleted');await refresh()}catch(x){toast(x.message,true)}return}const su=e.target.closest('[data-save-user]');if(su){const tr=su.closest('tr'),id=tr.dataset.user;try{await api('/admin/api/users/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({role:tr.querySelector('[data-role]').value,planId:tr.querySelector('[data-plan]').value,subscriptionStatus:tr.querySelector('[data-status]').value,creditsUsed:Number(tr.querySelector('[data-used]').value),bonusCredits:Number(tr.querySelector('[data-bonus]').value),disabled:tr.querySelector('[data-disabled]').checked})});toast('User saved');await refresh()}catch(x){toast(x.message,true)}return}const ru=e.target.closest('[data-reset-user]');if(ru){const id=ru.closest('tr').dataset.user;try{await api('/admin/api/users/'+encodeURIComponent(id)+'/reset',{method:'POST',body:'{}'});toast('Usage reset');await refresh()}catch(x){toast(x.message,true)}return}const sp=e.target.closest('[data-save-plan]');if(sp){const r=sp.closest('[data-plan-row]'),id=r.dataset.planRow;try{await api('/admin/api/plans/'+id,{method:'PUT',body:JSON.stringify({monthlyCredits:Number(r.querySelector('[data-credits]').value),maxThinking:r.querySelector('[data-thinking]').value,maxImageJobsPerMonth:Number(r.querySelector('[data-img]').value),maxImageEditJobsPerMonth:Number(r.querySelector('[data-edit]').value),maxVideoJobsPerMonth:Number(r.querySelector('[data-video]').value),liveTranslation:r.querySelector('[data-live]').checked,imageGenerate:r.querySelector('[data-img-on]').checked,imageEdit:r.querySelector('[data-edit-on]').checked,videoGenerate:r.querySelector('[data-video-on]').checked})});toast('Plan saved');await refresh()}catch(x){toast(x.message,true)}}});
$('#providerForm').onsubmit=async e=>{e.preventDefault();try{await api('/admin/api/providers',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});e.target.reset();toast('Provider saved');await refresh()}catch(x){toast(x.message,true)}};$('#providerForm select[name="kind"]').onchange=e=>$('#urlField').style.display=e.target.value==='gemini-native'?'none':'grid';
$('#saveVoice').onclick=async()=>{try{await api('/admin/api/voice',{method:'PUT',body:JSON.stringify({thinkingLevel:$('#thinking').value,speakerAccess:$('#speakerAccess').value,liveVoice:$('#liveVoice').value,ttsVoice:$('#ttsVoice').value,silenceMs:Number($('#silence').value)})});toast('Voice engine saved');await refresh()}catch(x){toast(x.message,true)}};
$('#saveWake').onclick=async()=>{try{await api('/admin/api/voice-control',{method:'PUT',body:JSON.stringify({activationMode:$('#activationMode').value,followupSpeaker:$('#followupSpeaker').value,wakeWords:$('#wakeWords').value.split(',').map(x=>x.trim()).filter(Boolean),wakeWindowMs:Number($('#wakeWindowMs').value),followupWindowMs:Number($('#followupWindowMs').value)})});toast('Wake defaults saved');await refresh()}catch(x){toast(x.message,true)}};
$('#openUser').onclick=async()=>{const id=$('#newUserId').value.trim();if(!id)return toast('Enter a Discord User ID',true);try{await api('/admin/api/users/'+encodeURIComponent(id),{method:'PUT',body:'{}'});toast('User opened');await refresh()}catch(x){toast(x.message,true)}};
refresh().catch(e=>toast(e.message,true));
</script>
</body>
</html>`;
}

export function registerAdminDashboard(
  app: Express
): void {
  const router =
    express.Router();

  router.use(
    (_req, res, next) => {
      res.setHeader(
        'Cache-Control',
        'no-store'
      );
      res.setHeader(
        'X-Frame-Options',
        'DENY'
      );
      res.setHeader(
        'X-Content-Type-Options',
        'nosniff'
      );
      res.setHeader(
        'Referrer-Policy',
        'no-referrer'
      );
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
      );
      next();
    }
  );

  router.get(
    '/login',
    (_req, res) => {
      if (
        !dashboardEnabled()
      ) {
        res
          .status(503)
          .send(
            'TD AI dashboard is not configured.'
          );
        return;
      }

      const state =
        randomBytes(24)
          .toString(
            'base64url'
          );

      res.setHeader(
        'Set-Cookie',
        secureCookie(
          STATE_COOKIE,
          state,
          600
        )
      );

      const redirectUri =
        `${dashboardBaseUrl()!
          .replace(/\/$/, '')}/admin/callback`;

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

      res.redirect(
        url.toString()
      );
    }
  );

  router.get(
    '/callback',
    async (req, res) => {
      try {
        if (
          !dashboardEnabled()
        ) {
          throw new Error(
            'TD AI dashboard is disabled.'
          );
        }

        const code =
          typeof req.query.code ===
          'string'
            ? req.query.code
            : '';

        const state =
          typeof req.query.state ===
          'string'
            ? req.query.state
            : '';

        const expectedState =
          parseCookies(req)[
            STATE_COOKIE
          ];

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
          `${dashboardBaseUrl()!
            .replace(/\/$/, '')}/admin/callback`;

        const tokenResponse =
          await fetch(
            'https://discord.com/api/v10/oauth2/token',
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/x-www-form-urlencoded'
              },
              body:
                new URLSearchParams({
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
                AbortSignal.timeout(
                  15_000
                )
            }
          );

        if (
          !tokenResponse.ok
        ) {
          throw new Error(
            `Discord OAuth failed (${tokenResponse.status}).`
          );
        }

        const token =
          await tokenResponse
            .json() as {
              access_token?: string;
            };

        if (
          !token.access_token
        ) {
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
                AbortSignal.timeout(
                  15_000
                )
            }
          );

        if (
          !userResponse.ok
        ) {
          throw new Error(
            'Could not read Discord identity.'
          );
        }

        const user =
          await userResponse
            .json() as {
              id?: string;
            };

        if (!user.id) {
          throw new Error(
            'Discord identity does not contain a user ID.'
          );
        }

        await userUsageSummary(
          user.id
        );

        res.setHeader(
          'Set-Cookie',
          [
            secureCookie(
              SESSION_COOKIE,
              encodeSession(
                user.id
              ),
              Math.floor(
                SESSION_TTL_MS /
                1000
              )
            ),
            clearCookie(
              STATE_COOKIE
            )
          ]
        );

        res.redirect(
          '/admin'
        );
      } catch (error) {
        res
          .status(400)
          .send(
            `TD AI login failed: ${
              error instanceof Error
                ? error.message
                : 'Unknown error'
            }`
          );
      }
    }
  );

  router.get(
    '/logout',
    (_req, res) => {
      res.setHeader(
        'Set-Cookie',
        clearCookie(
          SESSION_COOKIE
        )
      );
      res.redirect(
        '/admin/login'
      );
    }
  );

  router.get(
    '/',
    async (req, res) => {
      if (
        !dashboardEnabled()
      ) {
        res
          .status(503)
          .send(
            'TD AI dashboard is not configured.'
          );
        return;
      }

      const session =
        decodeSession(
          parseCookies(req)[
            SESSION_COOKIE
          ]
        );

      if (!session) {
        res.redirect(
          '/admin/login'
        );
        return;
      }

      const admin =
        await isAdminUser(
          session.userId
        ).catch(
          () => false
        );

      const wantsAdmin =
        req.query.view ===
        'admin';

      if (
        wantsAdmin &&
        !admin
      ) {
        res.status(403).send(
          'Admin access is required.'
        );
        return;
      }

      res
        .type('html')
        .send(
          wantsAdmin
            ? adminPage()
            : userPage(
                admin
              )
        );
    }
  );

  router.use(
    '/api',
    express.json({
      limit: '64kb'
    }),
    requireAuth,
    requireSameOrigin
  );

  router.get(
    '/api/me',
    async (_req, res) => {
      try {
        const userId =
          String(
            res.locals
              .dashboardUserId
          );

        res.json({
          userId,
          admin:
            await isAdminUser(
              userId
            ),
          usage:
            await userUsageSummary(
              userId
            ),
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
    }
  );

  router.get(
    '/api/personalization',
    async (_req, res) => {
      const userId =
        String(
          res.locals
            .dashboardUserId
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
            res.locals
              .dashboardUserId
          );

        res.json(
          await setUserPersonalization(
            userId,
            {
              headingSize:
                req.body
                  .headingSize as
                  UserHeadingSize,
              density:
                req.body
                  .density as
                  UserDensity,
              showEmojis:
                req.body
                  .showEmojis !== false,
              showOriginal:
                req.body
                  .showOriginal !== false,
              voiceName:
                typeof req.body
                  .voiceName ===
                'string'
                  ? req.body
                      .voiceName
                  : undefined,
              responseDelayMs:
                req.body
                  .responseDelayMs ===
                undefined
                  ? undefined
                  : Number(
                      req.body
                        .responseDelayMs
                    )
            }
          )
        );
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
    '/api/model-catalog',
    requireAdmin,
    (_req, res) => {
      res.json(
        publicModelCatalog()
      );
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
              req.body
                .activationMode as
                VoiceActivationMode,
            wakeWords:
              Array.isArray(
                req.body.wakeWords
              )
                ? req.body
                    .wakeWords
                    .map(String)
                : undefined,
            wakeWindowMs:
              req.body
                .wakeWindowMs ===
              undefined
                ? undefined
                : Number(
                    req.body
                      .wakeWindowMs
                  ),
            followupWindowMs:
              req.body
                .followupWindowMs ===
              undefined
                ? undefined
                : Number(
                    req.body
                      .followupWindowMs
                  ),
            followupSpeaker:
              req.body
                .followupSpeaker as
                FollowupSpeaker
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
              req.params.id ??
              ''
            ),
            {
              role:
                req.body
                  .role as
                  AccountRole |
                  undefined,
              planId:
                req.body
                  .planId as
                  PlanId |
                  undefined,
              subscriptionStatus:
                req.body
                  .subscriptionStatus as
                  SubscriptionStatus |
                  undefined,
              bonusCredits:
                req.body
                  .bonusCredits ===
                undefined
                  ? undefined
                  : Number(
                      req.body
                        .bonusCredits
                    ),
              creditsUsed:
                req.body
                  .creditsUsed ===
                undefined
                  ? undefined
                  : Number(
                      req.body
                        .creditsUsed
                    ),
              disabled:
                req.body
                  .disabled ===
                true
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
            req.params.id ??
            ''
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
              req.params.id ??
              ''
            ) as PlanId,
            {
              monthlyCredits:
                req.body
                  .monthlyCredits ===
                undefined
                  ? undefined
                  : Number(
                      req.body
                        .monthlyCredits
                    ),
              maxThinking:
                req.body
                  .maxThinking,
              liveTranslation:
                req.body
                  .liveTranslation ===
                undefined
                  ? undefined
                  : req.body
                      .liveTranslation ===
                    true,
              imageGenerate:
                req.body
                  .imageGenerate ===
                undefined
                  ? undefined
                  : req.body
                      .imageGenerate ===
                    true,
              imageEdit:
                req.body
                  .imageEdit ===
                undefined
                  ? undefined
                  : req.body
                      .imageEdit ===
                    true,
              videoGenerate:
                req.body
                  .videoGenerate ===
                undefined
                  ? undefined
                  : req.body
                      .videoGenerate ===
                    true,
              maxImageJobsPerMonth:
                req.body
                  .maxImageJobsPerMonth ===
                undefined
                  ? undefined
                  : Number(
                      req.body
                        .maxImageJobsPerMonth
                    ),
              maxImageEditJobsPerMonth:
                req.body
                  .maxImageEditJobsPerMonth ===
                undefined
                  ? undefined
                  : Number(
                      req.body
                        .maxImageEditJobsPerMonth
                    ),
              maxVideoJobsPerMonth:
                req.body
                  .maxVideoJobsPerMonth ===
                undefined
                  ? undefined
                  : Number(
                      req.body
                        .maxVideoJobsPerMonth
                    )
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
              typeof req.body.id ===
              'string'
                ? req.body.id
                : undefined,
            name:
              String(
                req.body.name ??
                ''
              ),
            kind:
              req.body.kind as
                ProviderKind,
            apiUrl:
              typeof req.body
                .apiUrl ===
              'string'
                ? req.body
                    .apiUrl
                : undefined,
            apiKey:
              typeof req.body
                .apiKey ===
              'string'
                ? req.body
                    .apiKey
                : undefined,
            enabled:
              req.body.enabled !==
              false
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
            req.params.id ??
            ''
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
            req.params.task ??
            ''
          ) as RuntimeTask,
          {
            providerId:
              String(
                req.body
                  .providerId ??
                ''
              ),
            model:
              String(
                req.body
                  .model ??
                ''
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
            req.body
              .thinkingLevel as
              ThinkingLevelName,
          silenceMs:
            Number(
              req.body
                .silenceMs
            ),
          liveVoice:
            String(
              req.body
                .liveVoice ??
              ''
            ),
          ttsVoice:
            String(
              req.body
                .ttsVoice ??
              ''
            ),
          speakerAccess:
            req.body
              .speakerAccess as
              VoiceSpeakerAccess
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

  app.use(
    '/admin',
    router
  );
}
