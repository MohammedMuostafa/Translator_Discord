# TD AI v3.9 — Private Control Center + Multi-Model Routing + Edit Answer

النسخة دي لا تضيف دفع أو اشتراكات. الهدف هو التحكم الكامل في البوت أثناء الاختبار.

## الجديد

### 1) Private Admin Dashboard

بعد الإعداد افتح:

`https://YOUR-SERVICE.up.railway.app/admin`

الدخول يتم بحساب Discord، ولا يدخل إلا IDs الموجودة في:

```env
ADMIN_DISCORD_IDS=YOUR_DISCORD_USER_ID
```

من الداشبورد تقدر تغير الإعدادات بدون Deploy جديد.

### 2) Multiple APIs + Model Routing

تقدر تضيف أكثر من API Provider ثم تحدد موديل مستقل لكل وظيفة:

- Translation
- AI Chat
- Summarize / Explain / Rewrite
- Smart Answer
- Live Voice
- Speech Recognition (STT)
- Listen / TTS

Text providers تستخدم OpenAI-compatible Chat Completions URL.
Live/STT/TTS تستخدم Gemini Native provider.

كل API Key جديد يتم تشفيره AES-256-GCM قبل حفظه في DATA_DIR، والداشبورد لا يرجع الـKey للمتصفح بعد الحفظ.

### 3) Voice tuning من الداشبورد

تقدر تغير:

- Thinking level: minimal / low / medium / high
- End-of-speech delay
- Live voice name
- TTS voice name
- Live model من صفحة Routing

تغيير Live model / thinking يطبق على جلسة Voice جديدة، لذلك بعد التغيير:

```text
/voicechat leave
/voicechat join
```

### 4) Edit Answer

Smart Answer أصبح فيه:

```text
🔄 Change
✂️ Shorter
🧠 More Detail
✏️ Edit Answer
✅ Use Reply
🔊 Listen
```

`Edit Answer` يفتح Discord Modal والنص الحالي موجود داخله. عدّل أي جزء واضغط Submit، والـAI يحدث معنى الرد بالعربي تلقائياً.

### 5) Clearer Discord layout

Discord نفسه لا يسمح للبوت بتغيير Font أو Font Size للعميل.
لذلك v3.9 يحسن القراءة باستخدام:

- Headings أوضح
- مسافات بين الأقسام
- Quote blocks للترجمة العربية
- RTL/LTR isolation للكلمات الإنجليزية
- أقسام منفصلة للسؤال والترجمة والرد ومعنى الرد

## إعداد Discord OAuth للداشبورد

Discord Developer Portal → تطبيق TD AI → OAuth2.

أضف Redirect URL:

`https://YOUR-SERVICE.up.railway.app/admin/callback`

ثم انسخ Client Secret إلى Railway:

```env
DISCORD_CLIENT_SECRET=...
```

## Railway Variables الجديدة

```env
ADMIN_DISCORD_IDS=YOUR_DISCORD_USER_ID
DASHBOARD_PUBLIC_URL=https://YOUR-SERVICE.up.railway.app
DASHBOARD_SESSION_SECRET=LONG_RANDOM_SECRET_1
DASHBOARD_ENCRYPTION_KEY=LONG_RANDOM_SECRET_2
DATA_DIR=/data
```

استخدم Secret مختلف للـSession والـEncryption.

## مهم: Railway Volume

Runtime settings محفوظة في:

`/data/runtime-config.json`

اعمل Railway Volume واربطه على:

`/data`

بدون Volume الإعدادات قد تضيع عند Redeploy/Restart.

## بعد Deploy

افتح:

`/health`

المفروض يظهر:

```json
{
  "version": "3.9.0",
  "adminDashboard": "/admin",
  "smartReplyEdit": true,
  "modelRouting": true
}
```

ثم افتح `/admin` وسجل دخول Discord.

## Commit

`Add private AI control center and edit answer v3.9`
