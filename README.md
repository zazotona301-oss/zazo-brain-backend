# Zazo Brain Backend

باك إند مستقل عن React في مستودع منفصل، مبني بـ **TypeScript + Hono + Cloudflare Workers**. يخزن البيانات التشغيلية في Neon PostgreSQL عبر **Cloudflare Hyperdrive**، والسياق النشط وأرشيفات JSONL الصغيرة في Cloudflare KV فقط؛ لا يستخدم R2.

## الحالة الحالية

- مستودع الباك إند: `zazotona301-oss/zazo-brain-backend`، فرع `main`.
- رابط Worker: <https://zazo-brain-backend.zazotona301.workers.dev>.
- أول بناء Cloudflare Workers Builds اكتمل بنجاح، و`GET /health` يعيد HTTP 200.
- النشر التلقائي مرتبط بـGitHub؛ كل push إلى `main` يشغّل الفحوص ثم ينشر إلى Cloudflare.
- مسارات `/api/*` ترفض الطلب حالياً بـ`503 service_not_configured` لأن Cloudflare Access غير مفعّل في الحساب بعد. هذا سلوك fail-closed مقصود؛ بيانات الذاكرة ليست مكشوفة للعامة.
- مخطط Neon نُشر على فرع `production` في قاعدة `neondb`، واختُبر قبل تطبيقه على الإنتاج.

## البنية وقاعدة البيانات

- الجداول: `worlds`, `rooms`, `memories`, `conversations`, `messages`.
- `memories` تخزن `instruction`, `context`, `response` و`embedding vector(1536)` اختيارياً.
- توجد العوالم السبعة المطلوبة، ولكل عالم غرفة `general`.
- تم تجهيز دور قاعدة محدود للـWorker؛ كلمة مرور PostgreSQL محفوظة داخل Hyperdrive وليست في Git.
- `wrangler.toml` يحتوي معرّفات موارد Cloudflare غير السرية ليكون النشر قابلاً للتكرار. لا تضع كلمات مرور أو API tokens أو `.dev.vars` في Git.

## الأمان وإكمال Cloudflare Access

`GET /health` عام. جميع مسارات `/api/*` تتطلب Cloudflare Access JWT؛ يتحقق الباك إند من issuer وaudience والتوقيع عبر JWKS. لكي تصبح API متاحة لمستخدم مخوّل:

1. في Cloudflare Dashboard، فعّل Zero Trust / Access للحساب إذا لم يكن مفعّلاً بعد.
2. من **Workers & Pages → zazo-brain-backend → Settings → Domains & Routes** فعّل Cloudflare Access على Worker الإنتاجي، واختر سياسة سماح مقيّدة بهويتك فقط؛ لا تستخدم allow-all.
3. خذ Team domain وAudience من إعداد Access، ثم اضبطهما كـWorker Secrets باسم `CF_ACCESS_TEAM_DOMAIN` و`CF_ACCESS_AUD` (من لوحة Worker أو عبر `npx wrangler secret put`).
4. بعد الإعداد اختبر طلباً مصادقاً إلى `/api/worlds`. لا تضع JWT أو بيانات سرية في الواجهة أو المستودع.

توثيق Cloudflare: [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) و[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).

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
