# TD AI v3.6 — AI Tools + Stability

هذا التحديث يركز على تثبيت النسخة الحالية وإضافة أدوات AI مفيدة بدون إدخال الدفع أو الاشتراكات الآن.

## ما تم إصلاحه

- إصلاح `Listen / استمع` باستخدام Gemini TTS Streaming بدل انتظار الرد كاملًا.
- تقسيم النص الطويل إلى أجزاء صغيرة لتقليل أخطاء timeout.
- Retry تلقائي لو صيغة الصوت الصريحة غير مدعومة من الموديل.
- تحسين Prompt الترجمة للعربي المصري والفصحى.
- تقليل الأقواس المكررة حول الكلمات الإنجليزية.
- تثبيت اتجاه العبارات الإنجليزية داخل النص العربي/الفارسي قدر الإمكان.
- Retry أفضل لأخطاء AI المؤقتة مثل 429 و503.

## المميزات الجديدة

### Right Click → Apps → TD AI

على أي رسالة نصية ستجد لوحة فيها:

- Translate
- Summarize
- Explain
- Simplify
- Rewrite
- Draft Reply

النتائج ترجع Private / Ephemeral للمستخدم.

### `/ai`

استخدمه مع:

- summarize
- explain
- simplify
- rewrite
- reply
- ask

ويمكن اختيار لغة الرد.

### `/help`

يعرض أهم أوامر TD AI بسرعة.

### `/chat open`

ما زال الشات الخاص التفاعلي يعمل في DM، وبعد فتحه تكتب طبيعي بدون `/chat` لكل رسالة.

## الملفات التي ترفعها

ارفع محتويات هذا الـZIP إلى root المشروع بنفس المسارات واستبدل الملفات الموجودة عند الطلب.

الملفات الجديدة:

- `src/aiActionHandlers.ts`
- `src/services/aiActions.ts`
- `src/services/aiActionSessions.ts`

الملفات المعدلة:

- `src/index.ts`
- `src/commands.ts`
- `src/config.ts`
- `src/providers/translatorAI.ts`
- `src/services/aiChat.ts`
- `src/services/geminiTts.ts`
- `.env.example`
- `package.json`

## Railway Variables الاختيارية الجديدة

```env
AI_ACTION_MAX_CHARS=8000
AI_ACTION_TIMEOUT_MS=60000
TTS_CHUNK_CHARS=900
TTS_REQUEST_TIMEOUT_MS=120000
```

لو لم تضفها، توجد قيم Default داخل الكود.

## Commit message

```text
Add TD AI tools and stability fixes v3.6
```

## بعد الـDeploy

افتح:

```text
/health
```

ويفترض أن ترى:

```json
{
  "version": "3.6.0",
  "aiActions": true,
  "mixedRtlFormatting": true
}
```

ثم اختبر بالترتيب:

1. ترجمة نفس رسالة Wilder World الطويلة.
2. اضغط Listen.
3. Right Click على الرسالة الأصلية → Apps → TD AI → Summarize.
4. جرّب Explain وSimplify.
5. جرّب `/ai`.
6. جرّب `/chat open` ثم كمل الكلام في DM.

## ملاحظة عن المميزات الكبيرة

هذا التحديث لا يضيف الدفع أو الاشتراكات كما طلبت.

Music داخل Voice، AI Voice live داخل الروم، وAI Server Builder تحتاج تفعيل Guild Install وصلاحيات/Voice stack إضافية. الأفضل إضافتها كمرحلة Guild مستقلة بعد ثبات v3.6 حتى لا نكسر النسخة الحالية التي تعمل كـ User Install.
