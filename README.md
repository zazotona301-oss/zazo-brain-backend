# Zazo Brain Backend (مستقل)

باك إند مستقل مبني بـ **TypeScript + Hono + Cloudflare Workers**. لا يغيّر `/home/ubuntu/zazo`، ولا ينشئ موارد Cloudflare، ولا يشغّل SQL تلقائياً. اتصال PostgreSQL مصمم عبر **Cloudflare Hyperdrive** باستخدام `pg`، ويستخدم **Cloudflare KV فقط** للسياق النشط ولأرشيفات JSONL الصغيرة.

## الوضع الأمني

- `GET /health` عام ولا يحتاج تسجيل دخول.
- كل مسارات `/api/*` محمية بــ Cloudflare Access JWT middleware.
- يجب ضبط `CF_ACCESS_TEAM_DOMAIN` و`CF_ACCESS_AUD` كـ Worker Secrets. عند غيابهما يرفض الباك إند طلبات API بـ `503 service_not_configured`.
- التوكن المتوقع هو `Authorization: Bearer <Cloudflare Access JWT>`، ويُتحقق من issuer وaudience والتوقيع عبر JWKS (`/cdn-cgi/access/certs`).
- لا توجد أسرار أو IDs موارد حقيقية في المستودع. `wrangler.toml.example` يستخدم placeholders صريحة فقط، و`wrangler.generated.toml` يُنشأ مؤقتاً داخل CI ويُتجاهل في Git.

## المسارات

| المسار | الوظيفة |
| --- | --- |
| `GET /health` | صحة عامة |
| `/api/worlds` | قائمة/إنشاء/قراءة/حذف العوالم |
| `/api/rooms` و`/api/worlds/:worldId/rooms` | قائمة/إنشاء/قراءة/حذف الغرف |
| `/api/memories` | قائمة/إنشاء/قراءة/حذف الذكريات بصيغة Instruction/Context/Response، مع embedding اختياري بطول 1536 |
| `/api/conversations` | قائمة/إنشاء/قراءة/حذف المحادثات |
| `/api/messages` و`/api/conversations/:conversationId/messages` | قائمة/إنشاء/قراءة/حذف الرسائل |
| `GET /api/search?q=...` | بحث full-text في الذاكرات والرسائل |
| `GET/PUT /api/context/active` | قراءة/حفظ السياق النشط في binding `ACTIVE_CONTEXT` |
| `POST /api/dataset/export` | تصدير memory entries إلى JSONL مجزأ في binding `ARCHIVE_STORE` |
| Worker `scheduled` | نفس التصدير آلياً عبر cron (يُضبط في config الخاص بالنشر) |

## العوالم والغرف

لا توجد أقاليم مستقلة ولا API للأقاليم. تزرع migration العوالم السبعة التالية، ولكل عالم غرفة عامة `general`:

| slug | الاسم العربي | الوصف المختصر |
| --- | --- | --- |
| `World_Technology_Software` | التقنية والبرمجيات | التقنية والبرمجيات والمنتجات الرقمية |
| `World_Politics_Geopolitics` | السياسة والجغرافيا السياسية | الأحداث السياسية والعلاقات الدولية |
| `World_Economy_Finance` | الاقتصاد والمال | الاقتصاد والأسواق والتمويل |
| `World_Religion_Philosophy` | الدين والفلسفة | الأديان والفلسفة والقيم |
| `World_Science_Nature` | العلم والطبيعة | العلوم والبيئة والطبيعة |
| `World_History_Culture` | التاريخ والثقافة | التاريخ والفنون والثقافة |
| `World_Personal_Life` | الحياة الشخصية | الحياة اليومية والعادات والنمو الشخصي |

## PostgreSQL وHyperdrive

1. أنشئ قاعدة PostgreSQL وفعّل إضافة `vector` فيها.
2. شغّل **يدوياً** `migrations/0001_init.sql` بعد مراجعة سياساتك. المشروع لا يشغله ولا يتصل بقاعدة حقيقية أثناء الإعداد.
3. تنشئ migration جداول `worlds`, `rooms`, `memories`, `conversations`, `messages` دون إنشاء جدول أقاليم منفصل. لا تحذف migration أي جدول قديم؛ إن وُجد جدول `regions` من تجربة سابقة فسيبقى دون استخدام. جدول `memories` يحوي `instruction`, `context`, `response`، و`embedding vector(1536)` اختياري.
4. أنشئ Hyperdrive Config يشير إلى PostgreSQL، ثم سجّل Config ID في إعدادات النشر الخاصة فقط.

## الذاكرات وJSONL

- إنشاء الذاكرة يحتاج `worldId` أو `roomId`، و`instruction` و`response` غير فارغين؛ `context` اختياري ويصبح سلسلة فارغة افتراضياً.
- `embedding` اختياري، لكنه إن أُرسل يجب أن يكون مصفوفة أرقام finite بطول 1536.
- سطر dataset ليس dump لصف PostgreSQL. كل سطر هو فقط:

```json
{"instruction":"...","context":"...","response":"...","metadata":{}}
```

- التصدير يقرأ memory entries فقط، ويقسّم السطور على حدود سجلات JSONL وبقياس **UTF-8 bytes**؛ الحد الأقصى لكل chunk هو `1 MiB` (ويُرفض السجل المفرد الأكبر بدلاً من كسره).
- يُحفظ manifest في `ARCHIVE_STORE` مع `keys`, `chunkKeys`, `rowCount`, `rows`, `createdAt` ومدة انتهاء لا تقل عن 31 يوماً. التصدير الفارغ ينشئ manifest بعدد صفوف صفر و`chunkKeys` فارغة ولا ينشئ chunk وهمياً.
- هذا الأرشيف المؤقت في KV **ليس PITR** وليس نسخة PostgreSQL كاملة. يجب استخدام استراتيجية نسخ احتياطي مستقلة لقاعدة البيانات عند الحاجة.

## إعداد Wrangler والنشر اليدوي

`wrangler.toml.example` ملف مثال فقط؛ لا تضع فيه IDs حقيقية أو أسراراً. يجب تجهيز bindingين منفصلين من KV:

```toml
[[kv_namespaces]]
binding = "ACTIVE_CONTEXT"
id = "<ACTIVE_CONTEXT_KV_NAMESPACE_ID>"

[[kv_namespaces]]
binding = "ARCHIVE_STORE"
id = "<ARCHIVE_STORE_KV_NAMESPACE_ID>"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<HYPERDRIVE_CONFIG_ID>"
```

بعد إنشاء الموارد، أنشئ إعداد نشر خاصاً غير متعقب في Git، ثم خزّن الأسرار:

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN --config wrangler.private.toml
npx wrangler secret put CF_ACCESS_AUD --config wrangler.private.toml
npx wrangler deploy --config wrangler.private.toml
```

## GitHub Actions

`.github/workflows/deploy.yml` يفحص `typecheck + lint + unit tests`، ثم يولّد config خاصاً مؤقتاً وينشر Worker. أضف القيم في **Settings → Secrets and variables → Actions**:

**Secrets**

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`

**Variables**

- `ACTIVE_CONTEXT_NAMESPACE_ID`
- `ARCHIVE_STORE_NAMESPACE_ID`
- `HYPERDRIVE_CONFIG_ID`

لا يضمّن workflow خطوة migration؛ شغّل SQL المراجع يدوياً بعد المراجعة. لا ينشئ workflow موارد Cloudflare، بل يفشل إذا كانت القيم غير مهيأة.

## التطوير والفحص

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run check
```

للتطوير المحلي، انسخ `.dev.vars.example` إلى `.dev.vars` واستبدل placeholders. يلزم توفير bindings محلية/عن بُعد لـ `ACTIVE_CONTEXT` و`ARCHIVE_STORE` و`HYPERDRIVE`؛ من دونها يظل `/health` متاحاً بينما تفشل API بأخطاء إعداد آمنة.

## نقاط الإعداد المعلقة

- إنشاء PostgreSQL/pgvector وتشغيل migration يدوياً بعد المراجعة.
- إنشاء Hyperdrive Config وKV namespaces وربط IDs الحقيقية في إعداد نشر خاص غير متعقب.
- إنشاء تطبيق Cloudflare Access وإضافة domain/audience كـ Secrets.
- إضافة فهرس HNSW اختياري بعد توفر حجم embedding مناسب (السطر المعلّق في migration).
