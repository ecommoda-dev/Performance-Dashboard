# لوحة الأداء (`Performance-Dashboard`)

**بتعمل إيه:** داشبورد قراءة فقط بيجمّع بيانات أوردرات شوبيفاي على مستويين مستقلين —
تقييم بالقطعة (فلوس) وعدّ الأوردرات — لفترة زمنية محددة، مع كاش على KV.
**مين بيستخدمها:** إدارة · حسابات
**الإصدار:** Worker `v3.0.0` · الواجهة `v3.0` ← الاتنين مستقلين، طبيعي يختلفوا

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Performance-Dashboard/
الـ Worker : https://performance-dashboard-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: performance-dashboard-worker   ← لازم يطابق name في wrangler.toml
```

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
Bindings : DB       → ecommoda-dev-logs        (من wrangler.toml)
           DASH_KV  → KV namespace (الكاش)     ⚠️ اقرا "فخاخ الأداة دي" تحت
Secrets  : WORKER_SECRET · CLIENT_ID · CLIENT_SECRET     ← في الداشبورد، مش في الريبو
Vars     : SHOP_DOMAIN · LOCATION_ID                     ← من [vars] في wrangler.toml
Build watch paths : * (الافتراضي) — لسه متضيّقتش
```

> `LOCATION_ID` **مش مستخدم في كود الـ Worker** (مفيش `env.LOCATION_ID` ولا مرة).
> متسيب كـ var قياسي، بس مش شرط لتشغيل الأداة.

## CORS

`wildcard *` — الأداة قراءة فقط (`get_data`/`get_meta`/`clear_cache`) + auth endpoints،
وكلها ورا `WORKER_SECRET`. الهيدرز في `CORS_HEADERS` والـ preflight أول حاجة في `fetch`.

## الثوابت المقفولة (من Data Contract v2 §6 — ممنوع تتغير من غير Data Contract جديد)

```
LINE_ITEMS_PAGE 25 · RETURNS_PAGE 5 · RETURN_LINES_PAGE 25
EXCHANGE_LINES_PAGE 10 · STAGE1_PAGE_SIZE 250 · STAGE2_BATCH_SIZE 10
CACHE_VERSION v6 · MAX_CACHE_BYTES 25MB
كاش: نطاق مغلق (dateTo قبل النهاردة) = دائم · نطاق مفتوح = 900 ثانية
مفاتيح KV: dash:performance_dashboard:v6:data|meta:<from>:<to>
```

## خط الأساس بعد النقل

> ⚠️ **لسه متسجّلش.** أول ما الأداة تتأكد إنها شغالة بعد أول نشر من git، سجّل هنا
> أرقام فترة معروفة (`get_data` لفترة مقفولة) — من غيرها مفيش إثبات إن النقل نضيف.

```
(فاضي)
```

## فخاخ الأداة دي

- **`DASH_KV` هو أخطر حاجة في النقل ده.** `wrangler deploy` تعريفي: أي binding مش
  مكتوب في `wrangler.toml` **بيتشال** عند أول نشر من git، حتى لو كان متضاف يدويًا
  في الداشبورد. لو `DASH_KV` اتشال → `env.DASH_KV` = `undefined` → `get_data`
  بيرمي على كل نداء. الـ binding معرّف في `wrangler.toml`، بس **الـ id لسه
  `REPLACE_WITH_DASH_KV_NAMESPACE_ID`** — لازم يتملا بالقيمة الحقيقية من
  Cloudflare → Storage & Databases → KV **قبل** ربط الريبو بالـ Worker.
  (الـ id مش موجود في `ecommoda-constants` — ضيفه هناك لما تجيبه.)
- **`clear_cache` من غير `dateFrom`/`dateTo` بيمسح كاش الأداة كله** (`list` بـ prefix
  `dash:performance_dashboard:` ثم `delete` على كل مفتاح). مش destructive — بيعاد
  حسابه — بس بيكلّف نداءات GraphQL كاملة لكل فترة بعدها.
- **الأسرار متتكتبش في الريبو أبدًا.** `CLIENT_ID` · `CLIENT_SECRET` · `WORKER_SECRET`
  موجودين في الداشبورد وهيفضلوا. وبعد أي سر جديد → **Promote**.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
النسخ المرقّمة القديمة (2.0 · 2.1.0 · 2.1.1 · 2.1.2 · 2.1.3 · Index.html) محفوظة
في commit: 30ce4b2
git show 30ce4b2:2.1.3.html
```

## مسائل مفتوحة

- **تسجيل `performance_dashboard` في `ecommoda-constants` §7.** الأداة مش في جدول
  D1 دلوقتي. القيم المطلوب تسجيلها: `tool` = `performance_dashboard`،
  `type` = `login` · `logout`. **ده بيتم من عند أحمد، مش من هنا.**
- **`classifyOrderForCounts()`: `S1=In-Return` بيتحسب "مؤكد" في تاب الأوردرات** —
  مخالف صراحةً لـ Rule 12 في `ecommoda-order-lifecycle`
  (*"s1=In-Return folded into Shipped for money KPIs only — never for order counts"*).
  التصحيح محتاج مربع UI جديد ("قيد الإرجاع"). **قرار تصميم مفتوح، مش جزء من النقل —
  ما تلمسهوش.**
- **حد معروف:** تصنيف أوردر بأكتر من دورة R/E واحدة مش دقيق — `hasExchange` /
  `hasSettledClosed` في نفس الدالة فوق بيتحسبوا Any عبر كل الدورات مجمّعة مش لكل
  دورة لوحدها. يحتاج Data Contract جديد لتتبّع كل دورة لوحدها.
- **Build watch paths لسه `*`** — أي تعديل HTML بينشر الـ Worker تاني بلا داعي.
  التضييق لـ `index.js` + `wrangler.toml` مؤجَّل لمرحلة الواجهة (PR #2).
- **الواجهة لسه متنقلتش** (§4-ح في `ecommoda-tool-migration-playbook`) — ملفات
  `2.0.html` … `2.1.3.html` و `Index.html` لسه في الريبو زي ما هي، متلمستش في PR ده.
