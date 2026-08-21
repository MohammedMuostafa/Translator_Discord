# Upgrade v3.2 — Auto Language + Egyptian Arabic + Target Picker

## الجديد

- لا يوجد اختيار Source في `/translate` أو `/say`: الذكاء الاصطناعي يكتشف اللغة تلقائياً.
- Gemini/AI يميّز قدر الإمكان بين:
  - Arabic — Egyptian (`ar-eg`)
  - Arabic — Modern Standard (`ar-msa`)
- أنت تكتب النص أولاً ثم تختار **Target** فقط.
- Target يدعم `My language` لاستخدام اللغة المحفوظة في `/settings`.
- Right Click → Apps → Translate يعرض Select Menu لاختيار اللغة في كل مرة، بدل إجبارك على Target ثابت.
- قائمة Targets تشمل المصري والفصحى والفارسي والإنجليزي وباقي اللغات المدعومة.
- Auto provider أصبح AI-first عند توفر Gemini.
- Retry تلقائي عند أخطاء AI المؤقتة مثل 429/503.
- في Auto provider: إذا استمر فشل AI وكان LibreTranslate متاحاً، يتم استخدامه كـfallback.

## Railway

احتفظ بالقيم الحالية، خصوصاً:

```env
AI_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
AI_API_KEY=YOUR_GEMINI_KEY
AI_MODEL=YOUR_GEMINI_MODEL
TRANSLATION_PROVIDER=ai
LIBRETRANSLATE_URL=http://libretranslate.railway.internal:5000
```

لا تضع API Key في GitHub.

## الاستخدام

### ترجمة نص

`/translate`

1. اكتب `text`.
2. اختر `target` فقط.
3. اترك Provider على Auto لاستخدام AI تلقائياً.

مثال:

- Text: `انا داخل الجيم دلوقتي استنوني`
- Target: `English`
- AI يكتشف أن المصدر Egyptian Arabic ويترجم للإنجليزية.

### ترجمة رسالة شخص

Right Click على الرسالة → Apps → Translate → اختر:

- My language
- Arabic — Egyptian
- Arabic — Modern Standard
- English
- Persian
- أو أي Target آخر.

### لغتي

`/settings my_language: Arabic — Egyptian`

بعدها اختيار `My language` يترجم للمصري.

أو:

`/settings my_language: Arabic — Modern Standard`

ليكون اختيار `My language` = الفصحى.
