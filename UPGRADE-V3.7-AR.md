# TD AI v3.7 — Smart Answer + Live Voice AI

## الجديد

- Right-click أي رسالة → Apps → **TD AI** ثم:
  - 🌐 Translate
  - ❓ Answer: يترجم الرسالة/السؤال للعربي ويقترح رد عربي
  - 📝 Summarize
  - 🧠 Explain
  - 💡 Simplify
  - ✍️ Rewrite
  - 💬 Draft Reply
- داخل Smart Answer:
  - 🔄 Change Answer
  - ✂️ Shorter
  - 🧠 More Detail
  - ✅ Use This Reply
  - 🔊 Listen
- إصلاح Gemini TTS/Listen باستخدام Streaming و`response_format: { type: "audio" }` بدون فرض mime_type.
- تحسين العربي المختلط بالإنجليزي وتقليل الأقواس المكررة.
- `/voicechat join` — البوت يدخل الروم ويتكلم معك بالـAI.
- `/voicechat leave`
- `/voicechat status`
- Voice privacy: البوت يشترك في صوت الشخص الذي بدأ الجلسة فقط. الصوت يعالج مؤقتاً في RAM ولا يتم حفظه عمداً.

## مهم: Send as yourself

Discord لا يسمح للبوت أو التطبيق بإرسال Message عادية باسم حساب المستخدم الشخصي.
زر **Use This Reply** يعرض الرد في code block لنسخه ثم لصقه والضغط Enter من حسابك.
لا تستخدم User Token أو Self-bot لأن ذلك يخالف Discord.

## رفع الملفات

ارفع كل الملفات الموجودة في هذه الحزمة بنفس المسارات واستبدل الملفات القديمة.

Commit مقترح:

`Add smart replies and live voice AI v3.7`

## تفعيل Voice AI في Discord Developer Portal

قبل جعل `/voicechat` فعالاً:

1. افتح **Developer Portal → Installation**.
2. فعّل **Guild Install** مع بقاء User Install مفعلاً.
3. في **Guild Install / Default Install Settings** أضف Scopes:
   - `applications.commands`
   - `bot`
4. Bot Permissions المطلوبة:
   - View Channels
   - Connect
   - Speak
5. ثبّت التطبيق داخل Server تجريبي باستخدام Guild Install.
6. في Railway أضف:

```env
ENABLE_GUILD_VOICE_AI=true
```

7. اعمل Redeploy. الأوامر ستتسجل تلقائياً إذا `REGISTER_COMMANDS_ON_START=true`.

> الحزمة تترك `ENABLE_GUILD_VOICE_AI=false` افتراضياً حتى لا يفشل تسجيل الأوامر قبل تجهيز Guild Install.

## Variables الجديدة الاختيارية

```env
VOICE_AI_SILENCE_MS=1100
VOICE_AI_MAX_UTTERANCE_SECONDS=35
VOICE_AI_MAX_HISTORY=12
TTS_REQUEST_TIMEOUT_MS=120000
```

Voice AI يحتاج أيضاً الإعدادات الموجودة بالفعل:

```env
DISCORD_BOT_TOKEN=...
AI_API_URL=...
AI_API_KEY=...
AI_MODEL=...
STT_URL=...
STT_API_KEY=...
GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
GEMINI_TTS_VOICE=Kore
```

## اختبار

1. افتح `/health` وتأكد من:

```json
{
  "version": "3.7.0",
  "smartReply": true
}
```

2. جرّب رسالة سؤال:
   - Right click → Apps → TD AI → Answer
   - جرّب Change Answer / Shorter / More Detail.
3. جرّب Listen.
4. بعد تفعيل Guild Install:
   - ادخل Voice Channel
   - `/voicechat join`
   - تكلم بجملة قصيرة وانتظر الرد الصوتي
   - `/voicechat leave`
