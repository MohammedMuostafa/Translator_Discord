# تحديث v3.4 — تنسيق الرسائل + الاستماع

## ما الذي تغيّر؟

### 1. الحفاظ على تنسيق الرسالة الأصلية

الترجمة بالـAI أصبحت تحافظ على بنية رسالة Discord قدر الإمكان:

- العناوين تبقى عناوين.
- القوائم النقطية تبقى قوائم.
- الخطوات المرقمة تبقى مرقمة.
- الروابط لا تتغير.
- الـmentions والـcustom emojis والكود لا يتم العبث بها.
- المسافات بين الأقسام تبقى موجودة حتى تكون الإعلانات الطويلة أسهل في القراءة.

تم إلغاء الأسلوب القديم الذي كان يحوّل كل سطر إلى Heading، لأنه كان يجعل الرسائل الطويلة غير متناسقة.

### 2. RTL أفضل للعربي والفارسي

يتم تثبيت اتجاه النص العربي/الفارسي بعد رموز Markdown، مع عزل الكلمات والعبارات الإنجليزية داخل السطر حتى لا تتحرك إلى مكان خاطئ قدر الإمكان.

### 3. زر Listen / استمع

بعد الترجمة سيظهر زر:

`🔊 Listen / استمع`

عند الضغط عليه يتم استخدام Gemini TTS لإنشاء ملف WAV قابل للتشغيل مباشرة داخل Discord.

إذا كان `AI_API_KEY` هو Gemini API Key بالفعل، يمكن استخدام نفس المفتاح تلقائياً. وللفصل بين المفاتيح يمكن إضافة:

```env
GEMINI_TTS_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
GEMINI_TTS_VOICE=Kore
TTS_MAX_CHARS=4000
```

## ملفات التحديث

ارفع/استبدل الملفات التالية:

```text
src/config.ts
src/discord.ts
src/handlers.ts
src/index.ts
src/providers/translatorAI.ts
src/services/geminiTts.ts
src/services/speechSessions.ts
.env.example
package.json
README.md
UPGRADE-V3.4-AR.md
```

بعد الـCommit سيعمل Railway Auto Deploy تلقائياً إذا كان GitHub repo مربوطاً بالخدمة.
