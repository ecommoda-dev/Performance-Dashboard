<div dir="rtl" style="text-align: right;">

# لوحة الأداء (`Performance-Dashboard`)

![version](https://img.shields.io/badge/version-v1.3.0-blue)

**بتعمل إيه:** داشبورد قراءة فقط بيجمّع بيانات أوردرات شوبيفاي على مستويين مستقلين —
تقييم بالقطعة (فلوس) وعدّ الأوردرات — لفترة زمنية محددة، مع كاش على KV.
**مين بيستخدمها:** إدارة · حسابات
**الإصدار:** Worker `v3.2.0` · الواجهة `v3.3.0` ← الاتنين مستقلين، طبيعي يختلفوا

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v1.0.0 |
| ecommoda-html-builder | v1.1.0 |
| ecommoda-constants | v1.0.0 |
| ecommoda-dashboard-builder | v2.0.0 |
| ecommoda-order-lifecycle | v1.1.0 |

آخر مطابقة: 30-08-2026 · `index.js` v3.2.0 · `index.html` v3.3.0
🔴 معلّقة: **خطوة (ج) من G-13** — `orderCycleRows[]` (مصفوفة صف لكل دورة جنب
المربع، `classification-rules.md` §9-ب). مؤجّلة بقرار. من غيرها المربع الواحد
بيفضل بيوصف **أحدث دورة بس**، والدورة الأقدم المكتملة مش ظاهرة في أي KPI —
وده اللي وسم `MULTI_CYCLE` بيعلن عنه صراحةً بدل ما يفضل صامت.

> `v1.0.0` = **قبل النظام**، مش شهادة مطابقة. → `ecommoda-skill-versioning`

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Performance-Dashboard/
الـ Worker : https://performance-dashboard-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: performance-dashboard-worker   ← لازم يطابق name في wrangler.toml
```

> عنوان الـ Worker **مش hardcoded في الواجهة** — الموظف بيدخله من الإعدادات
> وبيتحفظ في `localStorage` (`perfdash_worker_url`)، هو و `WORKER_SECRET`.

## الـ Endpoints

> **كل** الطلبات (بما فيها الـ auth) ورا بوابة `Authorization: Bearer ${WORKER_SECRET}`.
> مفيش راوت واحد بره البوابة.

| `?action=` | Method | بيعمل إيه |
|---|---|---|
| `check_employee` | GET | بيشوف الموظف مسجّل PIN ولا لأ |
| `register_pin` | POST | تسجيل PIN أول مرة |
| `verify_employee` | POST | تسجيل الدخول (+ `writeLog` type `login`) |
| `log_logout` | GET | تسجيل الخروج (+ `writeLog` type `logout`) |
| `get_employees` | GET | قائمة الموظفين النشطين للـ dropdown |
| `get_data` | GET/POST | البيانات المجمّعة — `boxes`/`rows`/`warnings` + `orderBoxes`/`orderRows`/`orderWarnings`. محتاج `dateFrom` و `dateTo` |
| `get_meta` | GET | ميتاداتا الكاش لفترة. محتاج `dateFrom` و `dateTo` |
| `clear_cache` | GET | يمسح كاش فترة واحدة، أو الكاش كله لو الفترة مش متبعتة |
| `diag` | GET | فحص ذاتي بدون كتابة — متغيّرات/bindings/صلاحيات شوبيفاي/D1/KV (30-08-2026) |
| `get_config` | GET | يرجّع `WORKER_VERSION` — للمقارنة مع نسخة الواجهة (30-08-2026) |

> **مفيش `get_logs` في الأداة دي** — بتكتب في D1 بس، مبتقراش السجل.

## D1

```
tool  : performance_dashboard
type  : login · logout          ← دول بس، مفيش أي type تاني في الكود
```

الجداول: `logs` (كتابة) · `employees` (قراءة + تحديث `last_login`/`pin`) — الجدولين
المشتركين، **مفيش أي جدول خاص بالأداة دي**.

## المضبوط فعليًا في الداشبورد

```
Bindings : DB       → ecommoda-dev-logs                       (من wrangler.toml)
           DASH_KV  → d38bb41fa5a74f7b9ce116b23f5446e7        (من wrangler.toml)
Secrets  : WORKER_SECRET · CLIENT_ID · CLIENT_SECRET     ← في الداشبورد، مش في الريبو
Vars     : SHOP_DOMAIN · LOCATION_ID                     ← من [vars] في wrangler.toml
Build watch paths : * (الافتراضي) — لسه متضيّقتش
```

> `LOCATION_ID` **مش مستخدم في كود الـ Worker** (مفيش `env.LOCATION_ID` ولا مرة).
> متسيب كـ var قياسي، بس مش شرط لتشغيل الأداة.

## CORS

`wildcard *` — الأداة قراءة فقط (`get_data`/`get_meta`/`clear_cache`) + auth endpoints،
وكلها ورا `WORKER_SECRET`. الهيدرز في `CORS_HEADERS` والـ preflight أول حاجة في `fetch`.

## الثوابت المقفولة (من Data Contract v2.1.0 §6 — ممنوع تتغير من غير Data Contract جديد)

```
LINE_ITEMS_PAGE 25 · RETURNS_PAGE 10 · RETURN_LINES_PAGE 25
EXCHANGE_LINES_PAGE 20 · STAGE1_PAGE_SIZE 250 · STAGE2_BATCH_SIZE 10
CACHE_VERSION v9 · MAX_CACHE_BYTES 25MB
كاش: TTL متدرّج (ttlFor) — نطاق فيه النهارده = 900 ثانية · قفل من ٤٥ يوم أو أقل
     = 21600 ثانية (6 ساعات) · أقدم من ٤٥ يوم = 86400 ثانية (24 ساعة). عمره ما
     يبقى دائم (كان كذلك قبل 30-08-2026 — شوف قرارات معتمدة تحت).
مفاتيح KV: dash:performance_dashboard:v9:data|meta:<from>:<to>
```

> **تحديث 25-08-2026:** RETURNS_PAGE و EXCHANGE_LINES_PAGE اتضاعفوا (5→10،
> 10→20) — كان فيه أوردرات حقيقية بتوقف الطلب كله بسبب الحد القديم. القرار
> من أحمد. CACHE_VERSION اترفع لـ v7 بالتبعية (قاعدة ecommoda-dashboard-builder).
> التفاصيل والدليل → `docs/performance-dashboard-data-contract-v2.1.0.md` §6.

## قرارات معتمدة

- **`In-Return` ≡ `Shipped` في S1 و S2 — قرار أحمد 25-08-2026.** الكود كان
  مطبّقها صح من الأصل؛ Rule 12 في `ecommoda-order-lifecycle` هي اللي اتوسّعت
  لتغطي S2 وعدّ الأوردرات كمان (كانت قبل كده S1 وفلوس بس). **مفيش مربع
  "قيد الإرجاع" ومفيش `IN_TRANSIT_BACK`** — أي اقتراح بإضافة واحد مرفوض بقرار.
- **صف "توقّع اكتمال الفترة" (تاب الأوردرات) — Rule 11 في
  `ecommoda-dashboard-builder`، 25-08-2026.** توقّع HTML-only مشتق بالكامل من
  `orderBoxes` الموجود أصلاً في `get_data` — صفر تعديل في الـ Worker، صفر
  `CACHE_VERSION` bump. المعدلات (`pShip`/`pDeliver`) بتتحسب من نفس الفترة
  المعروضة (قرار أحمد — حد معروف مقبول، مش باج). مفيش حد أدنى للعيّنة حاليًا
  (مؤجل بقرار أحمد).

- **دورات R/E المتعددة (G-13) — خطوة (أ) + (ب)، 26-08-2026.** نوع الدورة
  ومرحلتها وتسويتها بتتقرا من **أحدث دورة غير مُهمَلة** (مرتّبة بـ
  `returns[].createdAt`) في المكنتين، مش `.some()` على كل الدورات.
  ⚠️ **الفرع النهائي استثناء مقصود:** «الأوردر ده شاف استبدال أصلاً؟» بيفضل
  `.some()` وده الصح — تطبيق «أحدث دورة» على الفرعين بيحرّك ٩ أوردرات بدل
  واحد، تمنية منهم لمربع مش أصح. وشرط التسوية `s2 ∈ {In-Return, Returned}`
  بقى على أحدث دورة بس؛ الدورة الأقدم `CLOSED` لوحده يكفيها.
  الأثر المقيس: **أوردر واحد** اتحرّك (`#50091`: `SHIPPED_EXCHANGE` →
  `SHIPPED_RETURN`)، و`CACHE_VERSION` اترفع لـ v8.
  → `ecommoda-order-lifecycle` Rule 15 · Rule 7 · `classification-rules.md` §2-C

- **وسمَا الدورات `CYCLE_OVERLAP` و `MULTI_CYCLE` — منفصلان إجباريًا.**
  الأول مخالفة تشغيلية بتتصلح في شوبيفاي (خدمة العملاء)، والتاني حد معروف في
  الكود. دمجهم في تحذير واحد بيمسك **١١%** بس من الصفوف المحتاجة مراجعة.
  ⛔ الوسم **مبيحركش ولا رقم** — الصف بيفضل في مربعه (Rule 13).
  → `state-machines.md` §2.4

- **كاش الفترات المقفولة بقى TTL متدرّج بدل دائم — 30-08-2026.**
  `ecommoda-dashboard-builder` v2.0.0 (بند كاسر) وضّحت إن قاعدة "الفترة المقفولة
  = كاش دائم" صح بس للأحداث، وغلط لصفوف بتوصف **حالة حالية** — وسمّت الأداة دي
  بالاسم كمرشّح مباشر. `boxes`/`orderBoxes` هنا حالة أوردر حالية
  (`manual_status`/`status_2_r_e`/bucket)، فأوردر اتعمل في شهر مقفول ممكن يتحرك
  `Shipped → Delivered → Returned` بعد ما الشهر يتكاش — وكاش دائم كان بيخلّي
  الرقم يفضل واقف على الصورة القديمة للأبد من غير أي خطأ ظاهر. `cacheTtlFor()`
  اتبدلت بـ `ttlFor()` متدرّجة (900 / 21600 / 86400)، عمرها ما ترجع `null`.
  `CACHE_VERSION` اترفع لـ v9 عشان كل فترة متكاشة قديمة بكاش دائم تتحرر وتتحسب
  بالـ TTL الجديد. أُضيف كمان `?action=diag` و `?action=get_config` (كانوا
  ناقصين — `ecommoda-worker-builder` Step 5A ⑨) + trailing-slash fix على
  `SHOP_DOMAIN`. → `ecommoda-dashboard-builder` Step 3-أ/ج

## خط الأساس بعد النقل

> ⚠️ **لسه متسجّلش.** أول ما الأداة تتأكد إنها شغالة بعد أول نشر من git، سجّل هنا
> أرقام فترة معروفة (`get_data` لفترة مقفولة) — من غيرها مفيش إثبات إن النقل نضيف.

```
(فاضي)
```

## إثبات إن النقل نضيف

> ⚠️ الأرقام دي بصمة **وقت النقل**. `index.js` اتغيّر بعدها مرتين (تطبيع
> CRLF→LF في `f69884f`، وبعدين v3.1.0)، و`index.html` اتغيّر في v3.2.0 —
> فالبصمتين مش المفروض يطابقوا دلوقتي. مرجع المطابقة الحالي هو git نفسه.

```
index.js    md5 b9cb0839cff7387091fa252e1a14decf   ← مطابق لنسخة كلاودفلير بايت ببايت
index.html  blob SHA 15e3af845754036eb42875c594c1c6f127eff405
            ← نفس الـ blob SHA بتاع Index.html القديم قبل الرينيم = صفر تعديل
```

## فخاخ الأداة دي

- **`DASH_KV` هو أخطر حاجة في النقل ده.** `wrangler deploy` تعريفي: أي binding مش
  مكتوب في `wrangler.toml` **بيتشال** عند أول نشر من git، حتى لو كان متضاف يدويًا
  في الداشبورد. لو `DASH_KV` اتشال → `env.DASH_KV` = `undefined` → `get_data`
  بيرمي على كل نداء. الـ binding والـ id الحقيقي متكتبين في `wrangler.toml` —
  **ما تشيلهمش ولا تعدّلهم**.
- **`clear_cache` من غير `dateFrom`/`dateTo` بيمسح كاش الأداة كله** (`list` بـ prefix
  `dash:performance_dashboard:` ثم `delete` على كل مفتاح). مش destructive — بيعاد
  حسابه — بس بيكلّف نداءات GraphQL كاملة لكل فترة بعدها.
- **`index.html` بحروف صغيرة إجباري.** GitHub Pages بيدوّر على `index.html` كملف
  افتراضي للمجلد — `Index.html` بحرف كبير بيدي **404** على الرابط المختصر.
  الـ `Index.html` الموجود دلوقتي **صفحة تحويل بس** (`meta refresh`، صفر منطق) —
  متحطش فيه أي كود.
- **الأسرار متتكتبش في الريبو أبدًا.** `CLIENT_ID` · `CLIENT_SECRET` · `WORKER_SECRET`
  موجودين في الداشبورد وهيفضلوا. وبعد أي سر جديد → **Promote**.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
النسخ المرقّمة (2.0 · 2.1.0 · 2.1.1 · 2.1.2 · 2.1.3) و Index.html الأصلي محفوظين
في commit: 30ce4b2
git show 30ce4b2:2.1.3.html
git show 30ce4b2:Index.html
```

الملفات المرقّمة **اتمسحت من `main`** — كانت صفحات لايف مفتوحة للعالم على
`.../Performance-Dashboard/2.1.3.html` بمنطق قديم بيضرب نفس الـ Worker الحالي.

## مسائل مفتوحة

- **تسجيل `performance_dashboard` في `ecommoda-constants` §7.** الأداة مش في جدول
  D1 دلوقتي. القيم المطلوب تسجيلها: `tool` = `performance_dashboard`،
  `type` = `login` · `logout`. **ده بيتم من عند أحمد، مش من هنا.**
- ~~**حد معروف:** تصنيف أوردر بأكتر من دورة R/E واحدة مش دقيق~~ — **اتقفل
  26-08-2026** (G-13 خطوة أ + ب، فوق في «قرارات معتمدة»). ما احتاجش Data
  Contract جديد: `returns[].createdAt`/`closedAt` سكالر على نود بيتجاب أصلاً،
  فالتكلفة صفر. **الباقي:** خطوة (ج) `orderCycleRows[]` — مؤجّلة بقرار، وهي
  اللي هتخلي الدورة الأقدم المكتملة ظاهرة في الـ KPIs بدل ما المربع الواحد
  يوصف أحدث دورة بس.
- **Build watch paths لسه `*`** — أي تعديل HTML بينشر الـ Worker تاني بلا داعي.
  التضييق لـ `index.js` + `wrangler.toml` (§13-ب في `ecommoda-tool-migration-playbook`)
  مستني تأكيد إن الأداة شغالة بعد النقل. **لو اتضيّقت، أي ملف جديد يعتمد عليه الـ
  Worker لازم يتضاف للـ paths** وإلا هيفضل على نسخة قديمة من غير أي رسالة.
- **تعليق في `wrangler.toml`** فيه نقطتين `..` بدل نقطة — تجميلي بحت، متلمسش الملف
  عشانه لوحده.

آخر تحديث: 30-08-2026

</div>
