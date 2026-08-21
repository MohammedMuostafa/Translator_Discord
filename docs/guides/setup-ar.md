# Discord User Translator v2 — ابدأ من هنا

هذه النسخة معمولة كـ **User-Installed Discord App**، يعني تثبتها على حسابك وتظهر لك في السيرفرات والـDMs والـGDMs التي تستخدمها، بدون إضافة Bot لكل سيرفر.

## الوظائف

- Right Click على رسالة → Apps → **Translate** → ترجمة خاصة لك.
- `/translate` → ترجمة نص خاصة.
- `/say` → تكتب بالعربي (أو أي لغة) ويرسل النص المترجم للغة الخارجة الافتراضية.
- `/settings` → incoming = العربية افتراضيًا، outgoing = الإنجليزية افتراضيًا.
- `/status` → تشخيص سريع للخدمات.
- `/voice` → تحويل ملف/Voice Message إلى نص ثم ترجمته، بعد إضافة خدمة STT.
- Voice Message موجودة أصلًا في رسالة: Right Click → Apps → Translate سيحاول نسخ الصوت وترجمته.

---

# المرحلة 1 — Discord Developer Portal

## 1) إنشاء Application جديدة

1. افتح https://discord.com/developers/applications
2. اضغط **New Application**.
3. سمّها مثلًا `MOHMOS Translator`.
4. افتح **General Information**.
5. انسخ واحفظ محليًا:
   - `Application ID`
   - `Public Key`

لا تضع `Interactions Endpoint URL` الآن. سنضعه بعد Railway.

## 2) إنشاء/تجديد Bot Token

1. افتح **Bot** من القائمة الجانبية.
2. اضغط **Reset Token** (أو Reset/Regenerate حسب الواجهة).
3. انسخ الـToken واحفظه في Password Manager أو ملف `.env` محلي فقط.

**مهم:** لا تضع الـBot Token في GitHub، ولا ترسله في Screenshot.

## 3) تفعيل User Install فقط

1. افتح **Installation**.
2. تحت **Installation Contexts**:
   - فعّل **User Install**.
   - يمكنك تعطيل **Guild Install** لأن التطبيق هنا شخصي ويتبع حسابك.
3. تحت **Install Link** اختر **Discord Provided Link**.
4. تحت **Default Install Settings → User Install** أضف Scope:
   - `applications.commands`
5. احفظ التغييرات.

لا تحتاج `bot` scope في User Install.

---

# المرحلة 2 — GitHub

ارفع محتويات هذا المجلد نفسها إلى Root الـRepository:

```text
repo/
├── src/
├── python-stt/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── ...
```

**لا ترفع `.env`.**

---

# المرحلة 3 — Railway: خدمة translator

## 1) Service من GitHub

1. Railway → New Project.
2. Deploy from GitHub Repo.
3. اختر الـRepository.
4. اسم الـService: `translator`.
5. المشروع يستخدم `Dockerfile` تلقائيًا.

## 2) Variables

أضف القيم التالية فقط في البداية:

```env
DISCORD_APP_ID=YOUR_APPLICATION_ID
DISCORD_PUBLIC_KEY=YOUR_PUBLIC_KEY
DISCORD_BOT_TOKEN=YOUR_NEW_BOT_TOKEN
REGISTER_COMMANDS_ON_START=true

HOST=0.0.0.0
DEFAULT_INCOMING_LANGUAGE=ar
DEFAULT_OUTGOING_LANGUAGE=en

TRANSLATION_PROVIDER=libretranslate
```

سيبدأ التطبيق حتى لو لم تضف خدمة الترجمة والصوت بعد.

## 3) Public Domain

1. Settings → Networking → Public Networking.
2. Generate Domain.
3. Railway عادة يكتشف Target Port تلقائيًا. لو طلب منك Port أو ظهر 502، استخدم الرقم الظاهر في Deploy Logs بعد `listening on`؛ النسخة دي افتراضيًا تستخدم `8080`.
4. افتح:

```text
https://YOUR-DOMAIN/health
```

يجب أن تحصل على JSON فيه `"ok": true`.

5. أضف/حدّث Railway Variable:

```env
PUBLIC_BASE_URL=https://YOUR-DOMAIN
```

---

# المرحلة 4 — ربط Discord Endpoint

ارجع Discord Developer Portal → General Information.

في **Interactions Endpoint URL** اكتب بالضبط:

```text
https://YOUR-DOMAIN/interactions
```

ثم **Save Changes**.

Discord يتحقق من توقيع الطلب تلقائيًا. من الطبيعي أن ترى في Network Logs طلبًا مرفوضًا `401` وطلب PING صحيحًا `200` أثناء التحقق.

---

# المرحلة 5 — تثبيت التطبيق على حسابك

1. Discord Developer Portal → Installation.
2. انسخ **Install Link**.
3. افتحه في المتصفح.
4. اختر **Add to my apps**.
5. أكمل التفويض.

بعدها جرّب في Discord:

```text
/status
```

ويجب أن ترى Discord endpoint = online.

الأوامر تُسجل تلقائيًا عند Start/Deploy طالما:

```env
REGISTER_COMMANDS_ON_START=true
DISCORD_BOT_TOKEN=...
```

---

# المرحلة 6 — إضافة ترجمة مجانية Self-Hosted

الـtranslator نفسه لا يحتوي موديل ترجمة داخله. نضيف LibreTranslate كـService ثانية.

## LibreTranslate Service

1. Railway Project → New Service → Docker Image.
2. Image:

```text
libretranslate/libretranslate:latest
```

3. اسم الـService بالضبط:

```text
libretranslate
```

4. Variable اختياري لتقليل الموديلات:

```env
LT_LOAD_ONLY=ar,en,fr,de,es,it,pt,ru,tr,nl,pl,zh,ja,ko,hi,id,vi
```

5. لا تحتاج Public Domain للخدمة.

في `translator` Variables أضف:

```env
LIBRETRANSLATE_URL=http://libretranslate.railway.internal:5000
LIBRETRANSLATE_API_KEY=
TRANSLATION_PROVIDER=libretranslate
```

Redeploy ثم جرّب:

```text
/translate text:hello target:Arabic
```

أو Right Click على رسالة → Apps → Translate.

---

# المرحلة 7 — الصوت (اختياري)

لترجمة الصوت نضيف Service ثالثة من نفس Repository.

1. Railway → New Service → نفس GitHub Repository.
2. اسمها `stt`.
3. Root Directory = `/python-stt`.
4. Variables:

```env
STT_API_KEY=PUT_A_LONG_RANDOM_SECRET_HERE
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
MAX_AUDIO_BYTES=15728640
```

5. لا تحتاج Public Domain.

في Service `translator` أضف نفس السر:

```env
STT_URL=http://stt.railway.internal:8000
STT_API_KEY=PUT_THE_SAME_SECRET_HERE
```

Redeploy ثم جرّب `/voice`.

> Whisper قد يستهلك RAM/CPU أعلى من خدمة النص. ابدأ بـ `small`، ولو Railway resource limits منخفضة استخدم `base`.

---

# ملاحظات مهمة

- User-installed apps تعمل بالأوامر/interactions؛ لا يمكنها اعتراض النص العادي في Composer وتحويله قبل Send. `/say` هو المسار الرسمي الآمن لهذا السيناريو.
- لو Server عطّل **Use External Apps**، Discord قد يجعل رد التطبيق الخارجي private/ephemeral بدل نشره للجميع.
- `Bot Token` سر حساس جدًا. لو ظهر في Screenshot أو Git commit، Reset فورًا.
- بيانات `/settings` محفوظة في ملف `data/preferences.json`. على Railway أضف Volume إلى `/app/data` إذا أردت بقاء الإعدادات بعد redeploys.
