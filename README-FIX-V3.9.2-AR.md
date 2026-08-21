# TD AI v3.9.2 — Routing + Translation + Smart Answer Fix

## المشاكل التي يصلحها

1. Dashboard كانت تعرض `gemini-3.7-flash` كـ default بصري حتى لو البوت فعليًا ما زال يستخدم `AI_MODEL` قديم من Railway أو `/data/runtime-config.json`.
2. IDs مختصرة مثل `gemini-3.6` كانت تسبب 404. يتم الآن تحويلها تلقائيًا إلى `gemini-3.6-flash`.
3. Gemini text requests لم تعد تعتمد على مسار OpenAI compatibility لو `AI_API_URL` تابع Google. يتم استخدام Gemini native `v1beta/models/...:generateContent` مباشرة.
4. Translation و Smart Answer يستخدمان JSON mode مع Gemini Native لمنع تلف التنسيق/الـ parsing.
5. Dashboard `routes` الآن تعرض الـ effective model الحقيقي من السيرفر؛ Save يكتب route صريح ويطبّق مباشرة على الطلبات النصية الجديدة.
6. أخطاء 400/401/403/404 لا تعمل retries بلا داعي؛ أخطاء 429/5xx فقط يعاد تجربتها.

## Recommended AI Routing

Text:
- Translation: `gemini-3.7-flash`
- AI Chat: `gemini-3.7-flash`
- Summarize / Explain / Rewrite: `gemini-3.7-flash`
- Smart Answer: `gemini-3.7-flash`

Voice:
- Live Voice: اترك الموديل الذي يعمل عندك الآن.
- STT/TTS: اترك إعداداتك الحالية لو شغالة.

## مهم

بعد Deploy افتح `/admin` واعمل Hard Refresh:
`Ctrl + Shift + R`

ثم اضغط Save مرة واحدة لكل Text route حتى يصبح route صريحًا في `/data/runtime-config.json`.

لو كان Railway `AI_MODEL=gemini-3.6`، الكود سيحوّله تلقائيًا إلى `gemini-3.6-flash`. الأفضل أيضًا تغييره في Railway إلى `gemini-3.7-flash`.

## Commit

`Fix runtime AI routing translation and smart answer v3.9.2`
