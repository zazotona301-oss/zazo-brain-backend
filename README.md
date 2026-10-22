# Zazo Brain Backend

باك إند مستقل عن React في مستودع منفصل، مبني بـ **TypeScript + Hono + Cloudflare Workers**. يخزن البيانات التشغيلية في Neon PostgreSQL عبر **Cloudflare Hyperdrive**، والسياق النشط وأرشيفات JSONL الصغيرة في Cloudflare KV فقط؛ لا يستخدم R2.

## الحالة الحالية

- مستودع الباك إند: `zazotona301-oss/zazo-brain-backend`، فرع `main`.
- رابط Worker: <https://zazo-brain-backend.zazotona301.workers.dev>.
- أول بناء Cloudflare Workers Builds اكتمل بنجاح، و`GET /health` يعيد HTTP 200.
- النشر التلقائي مرتبط بـGitHub؛ كل push إلى `main` يشغّل الفحوص ثم ينشر إلى Cloudflare.
- مسارات `/api/*` عامة ومهيأة لـ CORS كي تتصل بها واجهة React مباشرة؛ لا تستخدم Supabase ولا Cloudflare Access.
- مخطط Neon نُشر على فرع `production` في قاعدة `neondb`، واختُبر قبل تطبيقه على الإنتاج.

## البنية وقاعدة البيانات

- الجداول: `worlds`, `rooms`, `memories`, `conversations`, `messages`.
- `memories` تخزن `instruction`, `context`, `response` و`embedding vector(1536)` اختيارياً.
- توجد العوالم السبعة المطلوبة، ولكل عالم غرفة `general`.
- تم تجهيز دور قاعدة محدود للـWorker؛ كلمة مرور PostgreSQL محفوظة داخل Hyperdrive وليست في Git.
- `wrangler.toml` يحتوي معرّفات موارد Cloudflare غير السرية ليكون النشر قابلاً للتكرار. لا تضع كلمات مرور أو API tokens أو `.dev.vars` في Git.

## الوصول العام والتخزين

`GET /health` و`GET /api/health` عامان. جميع مسارات `/api/*` عامة مع CORS لأن الواجهة المنشورة لا تحمل جلسة Cloudflare Access. Neon عبر `HYPERDRIVE` هو مصدر البيانات الدائم، وKV عبر `ACTIVE_CONTEXT` و`ARCHIVE_STORE` مخصص للسياق النشط وأرشيفات JSONL. لا تضع أسرار Neon أو Cloudflare في الواجهة؛ حماية الإنتاج يجب أن تعتمد لاحقاً على rate limiting أو مفتاح تطبيق أو مصادقة مستخدم إذا أصبحت البيانات غير عامة.

## API

| المسار | الوظيفة |
| --- | --- |
| `GET /health` | فحص الخدمة |
| `GET /api/health` | فحص توفر Neon وKV |
| `/api/worlds` | قائمة/إنشاء/قراءة/حذف العوالم |
| `/api/rooms` و`/api/worlds/:worldId/rooms` | قائمة/إنشاء/قراءة/حذف الغرف |
| `/api/memories` | CRUD للذاكرات بصيغة Instruction/Context/Response مع embedding اختياري |
| `/api/conversations` | CRUD للمحادثات |
| `/api/messages` و`/api/conversations/:conversationId/messages` | CRUD للرسائل |
| `GET /api/search?q=...` | بحث full-text في الذاكرات والرسائل |
| `GET/PUT /api/context/active` | قراءة/حفظ السياق النشط في KV |
| `POST /api/dataset/export` | تصدير الذاكرات إلى JSONL في KV |
| `PUT /api/conversations/:id` | تحديث عنوان المحادثة |

## العوالم والغرف

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

تم ربط Cloudflare Workers Builds بمستودع GitHub على الفرع `main`، ونجح أول build/deploy. إعدادات trigger:

- Build command: `npm ci && npm run check`.
- Deploy command: `npm run deploy` (`wrangler deploy`).
- Root directory: `/`.
- Preview URLs معطّلة في Wrangler؛ رابط Worker الإنتاجي هو الرابط أعلاه.

GitHub Actions يشغّل الفحوص والتحقق من bundle فقط؛ Cloudflare Workers Builds يتولى النشر المباشر من GitHub. لا يحتاج النشر إلى أسرار GitHub، وتبقى بيانات قاعدة البيانات داخل Hyperdrive.

## التطوير وفحوص الجودة

```bash
npm ci
npm run check
npx wrangler deploy --dry-run
```

للتطوير المحلي، انسخ `.dev.vars.example` إلى `.dev.vars` وأدخل قيم Access الخاصة بك عند توفرها، ثم شغّل `npm run dev`. يبقى `.dev.vars` مستبعداً من Git.

## تغييرات قاعدة البيانات مستقبلاً

المخطط الموجود في `migrations/0001_init.sql` أُطبق بالفعل على قاعدة الإنتاج. أي migration جديدة يجب مراجعتها واختبارها على فرع مؤقت أولاً؛ لا يشغّل Worker أو GitHub Actions SQL تلقائياً.
