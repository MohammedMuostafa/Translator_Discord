# TD AI v3.5.2 — Listen Fix

استبدل الملف:

`src/services/geminiTts.ts`

ثم اعمل Commit:

`Fix Gemini TTS Listen button`

المشكلة كانت أن Gemini Interactions API الحالي لا يقبل
`mime_type: audio/mp3` مع موديل TTS المستخدم.

الإصلاح يطلب:

`response_format: { type: "audio" }`

ويتعامل مع نوع الصوت الذي يرجعه Gemini تلقائياً، بما في ذلك تحويل raw PCM/L16 إلى WAV قابل للتشغيل داخل Discord.
