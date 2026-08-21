# TD AI v3.8 — Gemini Live Voice

الهدف من النسخة دي هو تقليل تأخير الـ Voice Chat.

## الفرق

قديم:

`Discord -> STT -> Text AI -> TTS -> Discord`

جديد:

`Discord audio <-> Gemini Live audio-to-audio <-> Discord`

الصوت يتبعت للموديل أثناء كلامك في chunks صغيرة، ولما تسكت حوالي 300ms بنبعت نهاية الدور.

## Railway Variables

أضف/عدّل:

```env
VOICE_AI_MODE=live
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_LIVE_VOICE=Kore
GEMINI_LIVE_THINKING_LEVEL=minimal
VOICE_AI_SILENCE_MS=300
```

`GEMINI_LIVE_API_KEY` اختياري. لو فاضي، الكود يستخدم `AI_API_KEY`.

## تجربة

1. Deploy.
2. `/voicechat leave`
3. `/voicechat join`
4. اتكلم جملة قصيرة واسكت.
5. `/voicechat status` سيعرض Engine: Gemini Live.

## ضبط السرعة

- 250ms: أسرع لكن ممكن يقاطعك لو بتاخد pauses أثناء الكلام.
- 300ms: Recommended.
- 450ms: أهدى في المحادثات الطويلة.

## Commit

`Add Gemini Live low-latency voice v3.8`
