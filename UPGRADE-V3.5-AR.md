# TD AI v3.5 — Interactive Private DM Chat

الإصدار ده يضيف شات AI تفاعلي داخل Discord بدل ما تحتاج تكتب `/chat` مع كل رسالة.

## الاستخدام

1. شغّل:

```text
/chat open
```

واختار اللغة لو حبيت، أو سيبها Auto.

2. TD AI هيفتح لك DM خاص.
3. من اللحظة دي اكتب رسائلك عادي جدًا في الـDM، والـAI يرد عليك ويحافظ على سياق المحادثة.
4. لمسح السياق مع بقاء الشات مفتوح:

```text
/chat reset
```

5. لمعرفة حالة الشات:

```text
/chat status
```

6. لإغلاق الشات ومسح الذاكرة المؤقتة:

```text
/chat close
```

## الخصوصية

- محتوى الشات لا يتم حفظه في ملفات أو قاعدة بيانات في هذا الإصدار.
- الذاكرة موجودة في RAM فقط.
- الذاكرة تحذف عند `/chat close`.
- الذاكرة تنتهي تلقائيًا بعد فترة عدم نشاط (`CHAT_SESSION_TTL_MINUTES`).
- Restart / Redeploy للسيرفر يمسح كل جلسات الشات الحالية.
- التطبيق لا يسجل محتوى رسائل المستخدم في الـlogs.

## Railway Variables الجديدة

اختيارية لأن لها Defaults:

```env
CHAT_SESSION_TTL_MINUTES=120
CHAT_MAX_HISTORY=20
CHAT_MAX_INPUT_CHARS=6000
```

لازم تكون متغيرات الـAI الحالية مضبوطة:

```env
AI_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
AI_API_KEY=YOUR_GEMINI_API_KEY
AI_MODEL=YOUR_GEMINI_MODEL
```

وكمان `DISCORD_BOT_TOKEN` لازم يكون موجود لأن الشات العادي في DM يستخدم Discord Gateway.

## Discord Developer Portal

الميزة تستخدم Direct Messages فقط في v3.5.

لا تحتاج تفعيل `MESSAGE CONTENT INTENT` عشان قراءة DMs المرسلة مباشرة للتطبيق؛ Discord يسمح بمحتوى DMs مع التطبيق كاستثناء من قيود Message Content.

خلي User Install كما هو.

## الملفات

استبدل/ارفع الملفات الموجودة داخل هذا ZIP بنفس المسارات في الـrepository، ثم اعمل Commit. Railway هيعمل Auto Deploy.

بعد الـDeploy، المفروض `/health` يعرض:

```json
"version": "3.5.0",
"interactiveDmChat": true
```

وفي الـlogs:

```text
TD AI Gateway connected as ...
```
