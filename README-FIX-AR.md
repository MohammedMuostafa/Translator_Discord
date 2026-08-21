# TD AI v3.8.2 — Gemini Developer Live VAD Fix

## المشكلة

`explicitVadSignal` ليس مدعومًا في Gemini Developer API، لذلك `/voicechat join`
كان يفشل قبل إنشاء جلسة Live.

## الإصلاح

تم حذف `explicitVadSignal` بالكامل واستخدام **Hybrid VAD** المدعوم في Gemini
Developer API:

1. Gemini automatic VAD يكتشف بداية الكلام.
2. Discord يحدد إن المستخدم سكت.
3. البوت يرسل `audioStreamEnd: true` فورًا.
4. Gemini يبدأ الرد بدون انتظار silence detection إضافي.

ده أسرع وأثبت من manual `activityStart/activityEnd` في حالتنا.

## Railway

```env
VOICE_AI_MODE=live
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_LIVE_THINKING_LEVEL=minimal
VOICE_AI_SILENCE_MS=250
```

ابدأ بـ 250ms. لو البوت بيقطع الكلام عند الوقفات الطبيعية، استخدم 300 أو 350.

## Commit

`Fix Gemini Developer Live hybrid VAD v3.8.2`
