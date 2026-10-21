# Zazo Brain Backend

باك إند مستقل عن React في مستودع منفصل، مبني بـ **TypeScript + Hono + Cloudflare Workers**. يخزن البيانات التشغيلية في Neon PostgreSQL عبر **Cloudflare Hyperdrive**، والسياق النشط وأرشيفات JSONL الصغيرة في Cloudflare KV فقط؛ لا يستخدم R2.

## الحالة والبنية

- مستودع الباك إند: `zazotona301-oss/zazo-brain-backend`، فرع `main`.
- مخطط Neon نُشر على فرع `production` في قاعدة `neondb`، واختُبر قبل تطبيقه على الإنتاج.
- جداول PostgreSQL: `worlds`, `rooms`, `memories`, `conversations`, `messages`.
- `memories` تخزن `instruction`, `context`, `response` و`embedding vector(1536)` اختيارياً.
- تم تجهيز دور قاعدة محدود للـ Worker، ويصل إلى PostgreSQL عبر Hyperdrive؛ كلمة مرور قاعدة البيانات مخزنة داخل Hyperdrive وليست في Git.
- `wrangler.toml` يضم معرفات موارد Cloudflare غير السرية (حساب، KV، Hyperdrive) لتكون إعادة النشر قابلة للتكرار. لا تضع كلمات مرور أو API tokens أو `.dev.vars` في Git.

## الأمان

- `GET /health` عام.
- كل مسارات `/api/*` محمية بتحقق Cloudflare Access JWT، ويُتحقق من issuer وaudience والتوقيع عبر JWKS.
- يجب ضبط `CF_ACCESS_TEAM_DOMAIN` و`CF_ACCESS_AUD` كـ Worker Secrets بعد إنشاء تطبيق Access. إذا لم تضبطهما الخدمة ترفض طلبات API بـ `503 service_not_configured` (fail-closed).
- الترويسة المطلوبة بعد إتمام Access هي `Authorization: Bearer <Cloudflare Access JWT>`.

## API

| المسار | الوظيفة |
| --- | --- |
| `GET /health` | فحص الخدمة |
| `/api/worlds` | قائمة/إنشاء/قراءة/حذف العوالم |
| `/api/rooms` و`/api/worlds/:worldId/rooms` | قائمة/إنشاء/قراءة/حذف الغرف |
| `/api/memories` | CRUD للذاكرات بصيغة Instruction/Context/Response مع embedding اختياري |
| `/api/conversations` | CRUD للمحادثات |
| `/api/messages` و`/api/conversations/:conversationId/messages` | CRUD للرسائل |
| `GET /api/search?q=...` | بحث full-text في الذاكرات والرسائل |
| `GET/PUT /api/context/active` | قراءة/حفظ السياق النشط في KV |
| `POST /api/dataset/export` | تصدير الذاكرات إلى JSONL في KV |

## العوالم والغرف

تحتوي قاعدة البيانات على العوالم السبعة التي طلبتها، ولكل عالم غرفة `general`:

| slug | الاسم |
| --- | --- |
| `World_Technology_Software` | التقنية والبرمجيات |
| `World_Politics_Geopolitics` | السياسة والجغرافيا السياسية |
| `World_Economy_Finance` | الاقتصاد والمال |
| `World_Religion_Philosophy` | الدين والفلسفة |
| `World_Science_Nature` | العلم والطبيعة |
| `World_History_Culture` | التاريخ والثقافة |
| `World_Personal_Life` | الحياة الشخصية |

## الذاكرة والتصدير

كل سجل ذاكرة يصلح لعائلة بيانات التدريب ويصدر بهذا الشكل:

```json
{"instruction":"...","context":"...","response":"...","metadata":{}}
```

التصدير يتعامل مع `memories` فقط، ويقسم JSONL عند حدود السجلات إلى chunks بحد أقصى `1 MiB` محسوباً ببايتات UTF-8. يُنشأ manifest ويحفظ مع كل chunk في `ARCHIVE_STORE` لمدة 31 يوماً. التصدير المجدول يعمل يومياً عند `02:00 UTC`؛ ويمكن تشغيله يدوياً عبر API. هذا أرشيف JSONL في KV وليس نسخة PostgreSQL كاملة ولا PITR.

## النشر التلقائي على Cloudflare

النشر مطلوب عبر **Cloudflare Workers Builds** المرتبط بمستودع GitHub، وليس عبر منصة نشر خارجية:

- المستودع: `zazotona301-oss/zazo-brain-backend`، الفرع الإنتاجي `main`.
- Build command: `npm run check`.
- Deploy command: `npm run deploy` (`wrangler deploy`).
- عند دفع commit إلى `main` يشغل Cloudflare الفحوص ثم ينشر Worker من `wrangler.toml`.
- GitHub Actions في هذا المستودع يشغّل الفحوص والتحقق من bundle فقط؛ Cloudflare Workers Builds يتولى النشر المباشر من GitHub.
- ملفات إعداد النشر لا تحتاج أسرار GitHub؛ مفاتيح التشغيل تبقى في Cloudflare، أما كلمة مرور PostgreSQL فتبقى داخل Hyperdrive.

## إعداد Access وبيئة التطوير

بعد إنشاء تطبيق Cloudflare Access يحمي نطاق Worker، اضبط الأسرار داخل إعدادات Worker:

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

للتطوير المحلي:

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

املأ `.dev.vars` بقيم Access الخاصة بك عند توفرها. يبقى الملف مستبعداً من Git. لفحص المشروع شغّل:

```bash
npm run check
npx wrangler deploy --dry-run
```

## تغييرات قاعدة البيانات مستقبلاً

المخطط الموجود في `migrations/0001_init.sql` أُطبق بالفعل على قاعدة الإنتاج. أي migration جديدة يجب مراجعتها واختبارها على فرع مؤقت أولاً، ولا يشغّل Worker أو GitHub Actions SQL تلقائياً.
