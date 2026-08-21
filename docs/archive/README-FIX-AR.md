# TD AI v3.9.1 — Dashboard Click Fix

المشكلة كانت JavaScript syntax error في الصفحة الناتجة من `adminDashboard.ts`.
أزرار Save/Delete كانت تتولد باستخدام inline `onclick` باقتباسات مكسورة بعد معالجة TypeScript template literal، لذلك المتصفح كان يوقف السكربت بالكامل؛ وهذا عطّل حتى أزرار التنقل في الـsidebar.

الإصلاح:
- إزالة inline onclick الديناميكي.
- استخدام `data-*` attributes + event delegation.
- Escape لقيم provider/model المعروضة داخل HTML.
- استخدام `encodeURIComponent` في API routes.

ارفع واستبدل:

`src/adminDashboard.ts`

Commit:

`Fix dashboard interactions v3.9.1`
