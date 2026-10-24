# Zazo Brain Backend

باك إند مستقل عن React في مستودع منفصل، مبني بـ **TypeScript + Hono + Cloudflare Workers**. يخزن البيانات التشغيلية في Neon PostgreSQL عبر **Cloudflare Hyperdrive**، والسياق النشط وأرشيفات JSONL الصغيرة في Cloudflare KV فقط؛ لا يستخدم R2.

## الحالة الحالية

- مستودع الباك إند: `zazotona301-oss/zazo-brain-backend`، فرع `main`.
- رابط Worker: <https://zazo-brain-backend.zazotona301.workers.dev>.
- أول بناء Cloudflare Workers Builds اكتمل بنجاح، و`GET /health` يعيد HTTP 200.
- النشر التلقائي مرتبط بـGitHub؛ كل push إلى `main` يشغّل الفحوص ثم ينشر إلى Cloudflare.
- معظم مسارات `/api/*` عامة ومهيأة لـ CORS كي تتصل بها واجهة React مباشرة؛ endpoint رفع LoRA فقط محمي بـCloudflare Access على مسارات `/api/admin/*`.
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

مسار `POST /api/chat` يستدعي Cloudflare Workers AI فقط؛ لا يستخدم OpenAI أو Raqa/Groq لتوليد ردود الشات. يسترجع حتى 6 ذكريات مطابقة من Neon، وما يصل إلى 4 أزواج سؤال/إجابة سابقة من الرسائل، ويضمّن `active-context` من KV وسجل الحوار الحالي، ثم يمرر سياق RAG إلى نموذج `@cf/google/gemma-2b-it-lora` عبر AI binding باستخدام `CLOUDFLARE_LORA_ID`. تبقى OpenAI Whisper وRaqa مستخدمتين فقط في مسارات معالجة المحتوى: تفريغ الصوت، وتنقية النصوص واستخراج الأفكار من المواد؛ وليستا مزودي ردود لشات Zazo.

لرفع المحول، افتح صفحة رفع LoRA واضغط «تسجيل الدخول إلى Cloudflare Access» ثم سجّل الدخول بحساب Cloudflare المرتبط بالبريد المصرح به؛ صلاحية الجلسة 24 ساعة. لا يلزم إدخال رمز إدارة في الواجهة أو حفظ `ZAZO_ADMIN_UPLOAD_TOKEN`. يحتفظ Worker بسر `CLOUDFLARE_API_TOKEN` بصلاحية Workers AI Write. endpoint يستقبل `adapter_config.json` و`adapter_model.safetensors`، ويتحقق من `model_type=gemma` ورتبة LoRA والحجم قبل إنشاء fine-tune ورفع الملفات. تُرسل الأوزان إلى Cloudflare عبر multipart stream لخفض نسخ البيانات الكبيرة في ذاكرة Worker. يتحدد المحول عبر `CLOUDFLARE_LORA_ID` في إعداد Worker؛ الشات يستخدم Cloudflare Workers AI فقط. تُحفظ رسائل المستخدم وردود Zazo عبر مسار الرسائل الحالي فتدخل المحادثات الجديدة في الاسترجاع اللاحق؛ هذه طريقة RAG/تعلم من المعرفة المحفوظة وليست ضبطًا دقيقًا مستمرًا لأوزان النموذج.

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
| `POST /api/dataset/export` | تجهيز بيانات RAG في KV؛ محمي بهوية GitHub Actions OIDC المحددة |
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

تعمل GitHub Action `rag-dataset-prep.yml` يوميًا عند `03:17 UTC`، ويمكن تشغيلها يدويًا من تبويب **Actions** عبر **Run workflow**. تستخدم Runner قياسيًا ولا تحتاج GPU أو أسرار GitHub: تحصل على OIDC قصير العمر، ثم تطلب من Worker تجهيز البيانات داخل Cloudflare. لا تُرسل نصوص Neon إلى سجلات GitHub ولا تُرفع كـArtifacts، والـAction لا تدرّب النموذج ولا تغيّر أوزانه.

يقرأ Worker صفحات من سجلات `memories` في Neon، ويزيل التكرار النصي. لا يصدّر بيانات العوالم والغرف لأنها بيانات تنظيمية وليست أمثلة RAG. المحادثات تبقى مرشحات مراجعة ولا تدخل التدريب تلقائيًا.

لا تدخل ملف Colab الجاهز إلا أمثلة `memories` المكتملة التي اعتمدها المستخدم، وتحمل `metadata.training_language="ar"`، ويغلب النص العربي على السؤال والإجابة وعلى السياق إن وُجد. المواد القديمة بلا هذا الوسم، والبيانات غير العربية أو الموسومة `needs_review=true` أو الناقصة تُحفظ منفصلة بحقول `candidate_*` للمراجعة، ولا تُدرّب تلقائيًا. تُقسّم ملفات JSONL إلى chunks لا تتجاوز `1 MiB`، وتحفظ مع manifest ورابط ثابت لأحدث manifest (`exports/zazo-rag-prepared/latest.json`) في `ARCHIVE_STORE` لمدة 31 يومًا.

في الواجهة توجد صفحة **تجهيز التدريب العربي**: يقرأ المتصفح الملف، وعند الضغط على التحليل يرسل النص المستخرج إلى Raqa لاستخراج مقترحات سؤال/إجابة عربية. المقترحات لا تُحفظ حتى يراجعها المستخدم ويعتمدها؛ عند الاعتماد تُسجل في Neon وتُؤرشف في KV مع وسم اللغة. تستخدم الصفحة Raqa لمعالجة مادة التدريب فقط وليس لتوليد ردود الشات. الملفات المنظمة JSON/JSONL/CSV/TSV يمكن استيرادها مباشرة، كما تُقرأ أزواج ShareGPT ذات `messages`.

دفتر Colab المحلي `colab/zazo_kv_unsloth_qlora_colab.ipynb` يقرأ أحدث `readyChunkKeys` فقط عند وجود هذا التصدير، فلا يخلط المحادثات غير المراجعة أو نسخ الأرشيف الأقدم. بعد تجهيز البيانات، يبقى تشغيل التدريب يدويًا من Colab؛ GitHub Action لا ينشئ محول LoRA ولا يرفعه إلى Cloudflare.

مسار `POST /api/dataset/export` يرفض الطلبات العامة. يقبل فقط JWT صادرًا من GitHub OIDC لهذا المستودع وWorkflow المحدد على فرع `main`؛ لا يوجد Cloudflare API token محفوظ في GitHub لهذا الغرض.

## النشر التلقائي على Cloudflare

تم ربط Cloudflare Workers Builds بمستودع GitHub على الفرع `main`، ونجح أول build/deploy. إعدادات trigger:

- Build command: `npm ci && npm run check`.
- Deploy command: `npm run deploy` (`wrangler deploy`).
- Root directory: `/`.
- Preview URLs معطّلة في Wrangler؛ رابط Worker الإنتاجي هو الرابط أعلاه.

Workflow النشر في GitHub Actions يشغّل الفحوص والتحقق من bundle؛ Cloudflare Workers Builds يتولى نشر Worker من GitHub. Workflow تجهيز بيانات RAG اليومي مستقل ومشروح في قسم الذاكرة والتصدير. لا يحتاج النشر أو التصدير إلى أسرار قاعدة بيانات محفوظة في GitHub، وتبقى بيانات Neon داخل Hyperdrive.

## التطوير وفحوص الجودة

```bash
npm ci
npm run check
npx wrangler deploy --dry-run
```

للتطوير المحلي، انسخ `.dev.vars.example` إلى `.dev.vars` وأدخل قيم Access الخاصة بك عند توفرها، ثم شغّل `npm run dev`. يبقى `.dev.vars` مستبعداً من Git.

## تغييرات قاعدة البيانات مستقبلاً

المخطط الموجود في `migrations/0001_init.sql` أُطبق بالفعل على قاعدة الإنتاج. أي migration جديدة يجب مراجعتها واختبارها على فرع مؤقت أولاً؛ لا يشغّل Worker أو GitHub Actions SQL تلقائياً.
