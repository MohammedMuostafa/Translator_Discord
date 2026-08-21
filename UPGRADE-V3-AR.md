# Upgrade v3 — Arabic Dialects, Persian, Source/Target and AI

## الجديد

- Arabic — Modern Standard / العربية الفصحى (`ar-msa`)
- Arabic — Egyptian / العامية المصرية (`ar-eg`)
- Persian / Farsi (`fa`)
- `/translate` فيه Source + Target + Provider + Style
- `/say` أصبح Private copy mode: يترجم لك ثم تنسخ النص وتبعته أنت من حسابك
- AI provider اختياري، ومفيد خصوصًا للمصري/الفصحى والأسلوب natural/casual/formal/literal
- Right-click `Translate` ما زال يستخدم اللغة الافتراضية من `/settings`
- `/settings` يحفظ incoming/outgoing/provider/style

## مهم: لماذا /say لا يرسل باسم حسابك تلقائيًا؟

Discord لا يسمح لتطبيق أو Bot أن يرسل رسالة كأنها صادرة من حساب مستخدم عادي. تشغيل user token أو self-bot مخالف لسياسة Discord وقد يؤدي لإغلاق الحساب. لذلك v3 يرجع الترجمة لك بشكل Ephemeral لتنسخها وتضعها في الـcomposer، وبذلك الرسالة النهائية تكون فعلًا من حسابك أنت.

## رفع التحديث على GitHub

استبدل/ارفع الملفات التالية من v3 إلى نفس Repository:

- `src/` بالكامل
- `.env.example`
- `package.json`
- `UPGRADE-V3-AR.md`

لا ترفع `.env` ولا أي API key.

Railway سيعمل Auto Deploy بعد الـcommit.

## Railway Variables للإصدار v3

الموجودة حاليًا تستمر كما هي. أضف فقط لو تريد AI:

```env
AI_API_URL=https://YOUR-AI-PROVIDER/.../chat/completions
AI_API_KEY=YOUR_SECRET_KEY
AI_MODEL=YOUR_MODEL_NAME
```

ولو تريد AI هو الافتراضي:

```env
TRANSLATION_PROVIDER=ai
```

أو اترك:

```env
TRANSLATION_PROVIDER=libretranslate
```

واختر `AI` داخل أمر Discord فقط عند الحاجة.

## LibreTranslate

احتفظ بهذا في `Translator_Discord`:

```env
LIBRETRANSLATE_URL=http://libretranslate.railway.internal:5000
```

Persian يستخدم الكود `fa`. المصري والفصحى كلاهما يرجعان إلى `ar` في محركات MT التقليدية؛ لذلك لو تريد فرق لهجة حقيقي استخدم AI provider.

## بعد الـDeploy

نفّذ:

```text
/status
```

ثم جرّب:

```text
/translate text:... source:English target:Arabic — Egyptian provider:AI style:Casual
```

وللكتابة التي تريد إرسالها أنت:

```text
/say text:انا جاي بعد خمس دقايق source:Arabic — Egyptian target:English
```

سيظهر النص لك فقط. انسخه إلى خانة الرسالة واضغط Send، وستكون الرسالة باسم حسابك أنت.
