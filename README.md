# Zazo Brain Backend

باك إند مستقل عن React في مستودع منفصل، مبني بـ **TypeScript + Hono + Cloudflare Workers**. يخزن البيانات التشغيلية في Neon PostgreSQL عبر **Cloudflare Hyperdrive**، والسياق النشط وأرشيفات JSONL الصغيرة في Cloudflare KV فقط؛ لا يستخدم R2.

## الحالة الحالية

- مستودع الباك إند: `zazotona301-oss/zazo-brain-backend`، فرع `main`.
- رابط Worker: <https://zazo-brain-backend.zazotona301.workers.dev>.
- أول بناء Cloudflare Workers Builds اكتمل بنجاح، و`GET /health` يعيد HTTP 200.
- النشر التلقائي مرتبط بـGitHub؛ كل push إلى `main` يشغّل الفحوص ثم ينشر إلى Cloudflare.
- معظم مسارات `/api/*` عامة ومهيأة لـ CORS كي تتصل بها واجهة React مباشرة؛ endpoint رفع LoRA فقط يتطلب رمزًا إداريًا ولا يستخدم رمز Cloudflare في المتصفح.
- مخطط Neon نُشر على فرع `production` في قاعدة `neondb`، واختُبر قبل تطبيقه على الإنتاج.

## البنية وقاعدة البيانات

- الجداول: `worlds`, `rooms`, `memories`, `conversations`, `messages`.
- `memories` تخزن `instruction`, `context`, `response` و`embedding vector(1536)` اختيارياً.
- توجد العوالم السبعة المطلوبة، ولكل عالم غرفة `general`.
- تم تجهيز دور قاعدة محدود للـWorker؛ كلمة مرور PostgreSQL محفوظة داخل Hyperdrive وليست في Git.
- `wrangler.toml` يحتوي معرّفات موارد Cloudflare غير السرية ليكون النشر قابلاً للتكرار. لا تضع كلمات مرور أو API tokens أو `.dev.vars` في Git.

## الوصول العام والتخزين

`GET /health` و`GET /api/health` عامان. أغلب مسارات `/api/*` عامة مع CORS؛ أما رفع LoRA فيمر عبر Pages Function محمي بـCloudflare Access على مسارات `/api/admin/*` فقط. السياسة تسمح للبريد `zazotona301@gmail.com`، والواجهة لا تحتوي رمز إدارة. يمرّر Pages Function رمز JWT الموقّع إلى Worker، الذي يتحقق من التوقيع والجهة المصدرة والجمهور والبريد عبر `jose` قبل بدء الرفع. إعدادات `CF_ACCESS_TEAM_DOMAIN` و`CF_ACCESS_AUD` و`CF_ACCESS_ADMIN_EMAIL` قيم عامة في `wrangler.toml`، بينما `CLOUDFLARE_API_TOKEN` يبقى سرًا على Worker. Neon عبر `HYPERDRIVE` هو مصدر البيانات الدائم، وKV عبر `ACTIVE_CONTEXT` و`ARCHIVE_STORE` مخصص للسياق النشط وأرشيفات JSONL. لا تضع أسرار Neon أو Cloudflare في الواجهة. حد القائمة يصل إلى 10,000 سجل لدعم مستودع النسخ الاحتياطي.

مسار `POST /api/transcribe` اختياري ويحوّل ملفاً صوتياً حتى 25MB إلى نص عبر OpenAI Whisper عند ضبط secret باسم `OPENAI_API_KEY` في Worker، ثم يمرر النص إلى Raqa لتنظيف الحشو والتكرار وأخطاء التفريغ. بدون `OPENAI_API_KEY` يعيد المسار `503` ولا يتم رفع الصوت؛ رابط Raqa الحالي يقبل chat JSON ولا يقبل multipart audio مباشرة.

مسار `POST /api/intellectual-extract` يرسل النص إلى مساعد Raqa (`https://raqa-1zhm.vercel.app/api/chatController`) مع برمبت استخراج الأفكار الفكرية، ثم يتحقق من رجوع JSON يحتوي `source_metadata` و`extracted_nodes`. يمكن تغيير العنوان عبر `RAQA_API_URL` أو إضافة `RAQA_API_KEY` إذا أصبح المساعد محمياً.

مسار `POST /api/chat` ينفذ استدلال Zazo: يسترجع حتى 6 ذكريات مطابقة من Neon، وما يصل إلى 4 أزواج سؤال/إجابة سابقة مطابقة من الرسائل المحفوظة، ويضمّن قيمة `active-context` من KV وسجل الحوار الحالي. افتراضيًا يرسل سياق Zazo إلى Raqa عبر `RAQA_API_URL` (الافتراضي `https://raqa-1zhm.vercel.app/api/chatController`) لاستخدام Groq عبر واجهة Raqa. كما يمكن اختيار `CHAT_PROVIDER=openai` مع `OPENAI_API_KEY`، أو `CHAT_PROVIDER=groq` مع `GROQ_API_KEY` للاتصال المباشر. بعد رفع محول LoRA متوافق، يمكن اختيار `CHAT_PROVIDER=cloudflare` مع `CLOUDFLARE_LORA_ID`؛ يستدعي Worker نموذج `@cf/google/gemma-2b-it-lora` عبر AI binding ويمرر إليه سياق RAG نفسه. يظل Raqa مستخدمًا أيضًا لتنظيف النصوص واستخراج المعرفة من المحتوى المرفوع.

لرفع المحول، افتح صفحة رفع LoRA واضغط «تسجيل الدخول إلى Cloudflare Access» ثم سجّل الدخول بحساب Cloudflare المرتبط بالبريد المصرح به؛ صلاحية الجلسة 24 ساعة. لا يلزم إدخال رمز إدارة في الواجهة أو حفظ `ZAZO_ADMIN_UPLOAD_TOKEN`. يحتفظ Worker بسر `CLOUDFLARE_API_TOKEN` بصلاحية Workers AI Write. endpoint يستقبل `adapter_config.json` و`adapter_model.safetensors`، ويتحقق من `model_type=gemma` ورتبة LoRA والحجم قبل إنشاء fine-tune ورفع الملفات. بعد نجاحه، اضبط `CHAT_PROVIDER=cloudflare` و`CLOUDFLARE_LORA_ID=<finetune-id>` كمتغيرات Worker. يُشترط أن يكون المحول مدرّبًا على قاعدة Gemma غير مكمّمة ومتوافقًا مع Cloudflare. تُحفظ رسائل المستخدم وردود Zazo عبر مسار الرسائل الحالي فتدخل المحادثات الجديدة في الاسترجاع اللاحق؛ هذه طريقة RAG/تعلم من المعرفة المحفوظة وليست ضبطًا دقيقًا مستمرًا لأوزان النموذج.

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
| `POST /api/chat` | استدلال Zazo باستخدام سجل الحوار ومعرفة Neon والسياق النشط في KV |
| `POST /api/admin/lora-upload` | إنشاء fine-tune ورفع ملفات Gemma LoRA عبر رمز إداري، بعد ضبط أسرار Worker |
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
