# TD AI v3.8.1 — TypeScript Build Fix

المشكلة:
`@google/genai` يتوقع `ThinkingLevel` enum وليس string مباشرة.

الإصلاح:
- استيراد `ThinkingLevel`
- تحويل `minimal | low | medium | high` إلى:
  - `ThinkingLevel.MINIMAL`
  - `ThinkingLevel.LOW`
  - `ThinkingLevel.MEDIUM`
  - `ThinkingLevel.HIGH`

ارفع الملف:
`src/services/voiceAi.ts`

Commit:
`Fix Gemini Live ThinkingLevel build v3.8.1`
