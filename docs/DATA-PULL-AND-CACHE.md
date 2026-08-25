<div dir="rtl" style="text-align: right;">

# سحب البيانات والكاش — مرجع لوحة الأداء

![doc](https://img.shields.io/badge/doc-reference-blue) ![status](https://img.shields.io/badge/الأداة_الباقية-Performance--Dashboard-brightgreen)

**الغرض:** المرجع الوحيد لكل ما يخص سحب البيانات من شوبيفاي والكاش في
`performance-dashboard-worker` — الوضع الحالي، العيوب المرصودة، وخارطة التطوير.

**سياق حاكم:** اتقرر تطوير **لوحة الأداء** وحذف **مركز القيادة**. الأداتين كانوا
بيشاركوا نفس محرك السحب، ومركز القيادة كان فيه إصلاحات واختبارات **مش موجودة**
في لوحة الأداء. الملف ده بيوثّق اللي لازم **يتحصد قبل الحذف**، وبعدها يبقى
مرجع لوحة الأداء وحدها.

> ⚠️ **البند رقم ١ في الملف ده مؤقّت.** لو مركز القيادة اتحذف قبل الحصاد،
> الكود والاختبارات اللي فيه بيضيعوا وإعادة كتابتهم أغلى بمراحل من نسخهم.

---

## فهرس

1. [محرك السحب — الوضع الحالي](#١-محرك-السحب--الوضع-الحالي)
2. [الكاش — الوضع الحالي](#٢-الكاش--الوضع-الحالي)
3. [إمتى بتتسحب بيانات جديدة](#٣-إمتى-بتتسحب-بيانات-جديدة)
4. [تكلفة النداء الواحد — المعادلة](#٤-تكلفة-النداء-الواحد--المعادلة)
5. [العيوب المرصودة في لوحة الأداء](#٥-العيوب-المرصودة-في-لوحة-الأداء)
6. [الحصاد الإلزامي من مركز القيادة قبل حذفه](#٦-الحصاد-الإلزامي-من-مركز-القيادة-قبل-حذفه)
7. [خارطة الطريق — ٤ مراحل](#٧-خارطة-الطريق--٤-مراحل)
8. [قواعد ملزمة لأي توسّع مستقبلي](#٨-قواعد-ملزمة-لأي-توسّع-مستقبلي)
9. [قائمة تحقّق قبل إضافة أي حقل](#٩-قائمة-تحقّق-قبل-إضافة-أي-حقل)

---

## ١. محرك السحب — الوضع الحالي

### ١-أ. سلسلة النداء

```
get_data
  └─ getAccessToken(env)                    ← OAuth client_credentials، نداء جديد كل مرة
  └─ fetchStage1(env, token, from, to)      ← كل الأوردرات، صفحات 250
  └─ isCandidateForStage2()                 ← فلترة client-side، صفر نداء
  └─ fetchStage2(env, token, candidateIds)  ← المرشحين فقط، دفعات 10
  └─ computeBoxes()      → boxes/rows/warnings
  └─ computeOrderBoxes() → orderBoxes/orderRows/orderWarnings
  └─ writeCache() ×2     → data key + meta key
```

**نقطة مهمة:** `computeOrderBoxes()` بتشتغل على **نفس** بيانات
`computeBoxes()` — صفر نداء إضافي لتاب الأوردرات. النمط ده هو القاعدة اللي
لازم تتبعها أي إضافة جاية: **اشتقّ من الموجود قبل ما تسأل شوبيفاي**.

### ١-ب. الثوابت المقفولة

من Data Contract v2.1.0 §6 — **ممنوع تتغيّر من غير Data Contract جديد**:

| الثابت | القيمة | الدور |
|---|---|---|
| `LINE_ITEMS_PAGE` | 25 | السقف المطلق لأسطر الأوردر |
| `RETURNS_PAGE` | 10 | دورات الإرجاع/الاستبدال للأوردر |
| `RETURN_LINES_PAGE` | 25 | أسطر المرتجع في الدورة |
| `EXCHANGE_LINES_PAGE` | 20 | أسطر البديل في الدورة |
| `STAGE1_PAGE_SIZE` | 250 | حجم صفحة الأوردرات |
| `STAGE2_BATCH_SIZE` | 10 | حجم دفعة `nodes(ids:)` |
| `CACHE_VERSION` | `v7` | نسخة شكل البيانات |
| `MAX_CACHE_BYTES` | 25MB | حد حجم القيمة في KV |

**API version:** `2026-01` · **النوم:** ١٠٠٠ms بين صفحات المرحلة ١ · ٥٠٠ms بين دفعات المرحلة ٢.

### ١-ج. الحراس القائمة (متلمسهمش — دول اللي بيمنعوا الأرقام الناقصة)

| الحارس | المكان | بيمنع إيه |
|---|---|---|
| `resp.ok` + JSON-parse + empty-data | `shopifyGQL` | فشل شبكة بيتحوّل لـ«نجاح ببيانات فاضية» |
| retry على `THROTTLED` **فقط** | `shopifyWithRetry` | تحويل خطأ فوري مقروء لفشل بطيء |
| `endCursor === cursor` | `fetchStage1` | حلقة لا نهائية |
| `lineItems.hasNextPage` | `fetchStage1` | أوردر بأكتر من ٢٥ سطر يرجع ناقص بصمت |
| `returns/returnLineItems/exchangeLineItems.hasNextPage` | `fetchStage2` | دورة إرجاع مقصوصة بصمت |
| `bodyBytes > MAX_CACHE_BYTES` | `writeCache` | فشل KV صامت |
| **مفيش `MAX_PAGES`** | `fetchStage1` | سقف رقمي بيقص نطاق مشروع بصمت |

### ١-د. حقول المرحلة ١ اليوم

```
id · name · createdAt · cancelledAt · displayFulfillmentStatus
metafield custom.manual_status   (s1)
metafield custom.status_2_r_e    (s2)
lineItems(25): id · sku · quantity · currentQuantity · unfulfilledQuantity
               discountedUnitPriceSet.shopMoney.amount
```

### ١-هـ. مقارنة مرجعية مع مركز القيادة (للحصاد)

المحرك **نفسه بالحرف** — نفس المرحلتين، نفس معيار الترشيح، نفس الحراس.
الاختلافات كلها في الجدول ده:

| | لوحة الأداء | مركز القيادة | الحكم |
|---|---|---|---|
| حقول المرحلة ١ | ٦ + ميتافيلدين | ١٠ + **١١ ميتافيلد** + العميل + العنوان | مرجع لأسماء الحقول عند التوسّع |
| استعلام الكتالوج | ❌ | ✅ `products(100)` + variants + collections | **يتحصد** |
| النوم بين الصفحات | 1000ms / 500ms | 700ms / 400ms | فرق تجميلي، مش أولوية |
| `RETURNS_PAGE` | **10** ✅ | 5 (قديم) | لوحة الأداء أحدث |
| `EXCHANGE_LINES_PAGE` | **20** ✅ | 10 (قديم) | لوحة الأداء أحدث |
| خيارات الطلب | `dateFrom` `dateTo` `forceRefresh` | + `withPrev` `refreshPrev` `refreshCatalog` `includeRows` `leadTimeDays` `marginFloorPct` | **يتحصد** |
| الفترة السابقة | من **المتصفح**، نداء كامل | جوّه الـ Worker، كاش مصغّر | **يتحصد** |
| سقف الصفوف | ❌ مفيش | `ROWS_MAX_DAYS = 45` + إعلان صريح | **يتحصد** |
| سقف السلسلة | ❌ مفيش | 400 نقطة + `seriesTruncated` | **يتحصد** |
| اختبارات آلية | **صفر** | ١٥١ (٧٦ + ٧٥) | **يتحصد — الأهم** |

---

## ٢. الكاش — الوضع الحالي

### ٢-أ. البنية

```
Binding : DASH_KV → d38bb41fa5a74f7b9ce116b23f5446e7   (من wrangler.toml)

المفاتيح:
  dash:performance_dashboard:v7:data:<from>:<to>     ← الحمولة الكاملة
  dash:performance_dashboard:v7:meta:<from>:<to>     ← ordersScanned + lastUpdated
```

مفتاحين بس. كل حاجة (الأرقام + الصفوف + بيانات تاب الأوردرات) في مفتاح واحد.

### ٢-ب. قاعدة الـ TTL

```js
function cacheTtlFor(dateTo) {
  const today = new Date().toISOString().slice(0, 10);   // ⚠️ UTC
  return dateTo < today ? null : 900;
}
```

- **نطاق مغلق** (`dateTo` قبل النهاردة) → `null` = **كاش دائم**، مفيش انتهاء صلاحية.
- **نطاق مفتوح** (`dateTo` = النهاردة أو بعده) → **900 ثانية** (١٥ دقيقة).

### ٢-ج. قواعد ملزمة مطبّقة (متكسرهاش)

| القاعدة | ليه |
|---|---|
| الكتابة **بعد** آخر صفحة تنجح بس | كتابة جزئية = رقم ناقص محفوظ للأبد |
| **أبداً** إعادة قراءة من KV بعد الكتابة | نافذة اتساق KV = ٦٠ ثانية، القراءة الفورية بترجّع القديم |
| الرد بيرجّع من الـ `payload` مباشرة | نفس السبب |
| `CACHE_VERSION` يزيد مع أي تغيير في الحقول | بيانات قديمة بشكل جديد = انهيار صامت |
| الكاش في **KV** أبداً D1 | قاعدة `ecommoda-dashboard-builder` رقم ٢ |

---

## ٣. إمتى بتتسحب بيانات جديدة

السحب من شوبيفاي بيحصل في **٤ حالات بس**:

| الحالة | التفاصيل |
|---|---|
| **١. Cache miss** | أول مرة يتسأل على النطاق ده بالـ `CACHE_VERSION` الحالي |
| **٢. انتهاء TTL** | نطاق مفتوح بعد ١٥ دقيقة — المفتاح اتشال من KV |
| **٣. `forceRefresh: true`** | زرار «تحديث» — بيتخطى `readCache` تمامًا |
| **٤. `CACHE_VERSION` bump** | كل المفاتيح القديمة بقت يتيمة، كل نطاق بيتحسب من الأول |

**مفيش Cron ومفيش تحديث خلفي.** قاعدة رقم ١ في `ecommoda-dashboard-builder`:
كل نداء لشوبيفاي = فعل بشري صريح. `wrangler.toml` **مفيهوش** `[triggers]` —
وده مقصود، متضيفوش.

**الأحداث اللي بتنادي `loadAll()` في الواجهة:**
- تسجيل الدخول
- تغيير الفترة (بـ debounce 400ms)
- ضغط «تحديث» (`forceRefresh: true`)
- تبديل التابات → **صفر نداء** ✅

---

## ٤. تكلفة النداء الواحد — المعادلة

```
نداءات المرحلة ١ = ceil(عدد الأوردرات / 250)
نداءات المرحلة ٢ = ceil(عدد المرشحين / 10)
+ نداء OAuth واحد

الزمن الأدنى (نوم فقط) = (S1 − 1) × 1s + (S2 − 1) × 0.5s
```

**مرشّح للمرحلة ٢** = `Σ(quantity) ≠ Σ(currentQuantity)` **أو** `s2 ≠ null`،
والأوردر **مش ملغي**.

**مثال ٣٠ يوم / ~٣٠٠٠ أوردر / ~٢٠٪ مرشحين:**

```
S1 = 12 نداء  →  11 ثانية نوم
S2 = 60 نداء  →  29.5 ثانية نوم
الإجمالي ≈ 73 نداء · ≥ 40 ثانية نوم + زمن الشبكة
```

⚠️ **والواجهة بتعمل ده مرتين بالتوازي** (الفترة الحالية + السابقة) — انظر عيب ٥-٤.

---

## ٥. العيوب المرصودة في لوحة الأداء

### 🔴 ٥-١. `clear_cache` الكامل بيمسح جزء ويرجّع «تم مسح الكل»

```js
// index.js — §HANDLER::clear_cache
const list = await env.DASH_KV.list({ prefix: `dash:${TOOL_NAME}:` });
for (const k of list.keys) await env.DASH_KV.delete(k.name);
return json({ cleared: 'all', count: list.keys.length });
```

`KV.list()` سقفه **١٠٠٠ مفتاح** وبيرجّع `cursor` للباقي. المفاتيح اللي بره
الألف الأولى بتفضل — وبالذات مفاتيح **النطاقات المقفولة** (كاش دائم، وهي
بالظبط سبب المسح).

**الأثر:** «نجاح كاذب» — رقم غلط بيفضل معروض بعد مسح المفروض صلّحه.

**الإصلاح** (منقول من مركز القيادة `index.js` §CACHE):

```js
let cursor = null, count = 0;
for (;;) {
  const list = await env.DASH_KV.list({
    prefix: `dash:${TOOL_NAME}:`,
    cursor: cursor || undefined,
  });
  for (const k of list.keys) { await env.DASH_KV.delete(k.name); count++; }
  if (list.list_complete || !list.cursor) break;
  cursor = list.cursor;
}
return json({ cleared: 'all', count });
```

---

### 🔴 ٥-٢. فترة طويلة = انتظار كامل ثم رسالة خطأ

`writeCache` بيرمي لو الحمولة > 25MB. يعني المستخدم بيستنى دورة السحب كاملة
(دقيقة+) وفي الآخر بياخد `حجم بيانات الفترة أكبر من حد الكاش` وصفر أرقام.

**الأثر مع التوسّع:** كل حقل جديد بيكبّر `rows` — الفترة اللي بتعدي النهاردة
هتبقى هي اللي بترمي بعد إضافة الحقول. **العيب ده بيتفاقم تلقائيًا مع كل تطوير.**

**الإصلاح** (نمط مركز القيادة):

```js
const ROWS_MAX_DAYS = 45;
const rangeDays   = daysBetweenStr(dateFrom, dateTo);
const includeRows = body.includeRows === true || rangeDays <= ROWS_MAX_DAYS;

const payload = {
  boxes, orderBoxes,                                  // ← الملخّصات دايمًا كاملة
  rows:      includeRows ? rows      : [],
  orderRows: includeRows ? orderRows : [],
  rowsIncluded: includeRows,
  rowsOmittedReason: includeRows ? null
    : `الفترة ${rangeDays} يوم — جدول التفاصيل بيتحمّل حتى ${ROWS_MAX_DAYS} يوم. كل الملخّصات كاملة.`,
  ...
};
```

**المبدأ:** القص بيتبلّغ **صراحةً**. سقف صامت في التجميع = نفس خطيئة `MAX_PAGES`.

**كمان:** `MAX_CACHE_BYTES` دلوقتي = **25MB بالظبط** = حد KV نفسه. الحارس بيمرّر
حمولة على الحد تمامًا وبعدين KV بيرفضها. نزّله لـ `24 * 1024 * 1024` (زي مركز
القيادة) عشان يبقى فيه هامش.

---

### 🟠 ٥-٣. مفيش تحقّق من صيغة التاريخ

```js
if (!dateFrom || !dateTo) return json({ error: 'محتاج dateFrom و dateTo' }, 400);
// ← وبس
```

`'2026-8-1'` بتعدّي، بتروح لشوبيفاي، وبتولّد **مفتاح كاش مستقل** لنفس اليوم.
النتيجة: نسختين محفوظتين لنفس الفترة، كل واحدة اتسحبت لوحدها، ومسح واحدة
مابيمسحش التانية.

**الإصلاح:**

```js
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
if (!ISO_DAY.test(dateFrom) || !ISO_DAY.test(dateTo)) {
  return json({ error: 'صيغة التاريخ لازم تكون YYYY-MM-DD', step: 'validation' }, 400);
}
if (dateFrom > dateTo) {
  return json({ error: 'تاريخ البداية بعد تاريخ النهاية', step: 'validation' }, 400);
}
```

---

### 🟠 ٥-٤. الفترة السابقة بتتجاب من المتصفح

```js
// index.html — loadAll()
const [curRes, prevRes] = await Promise.all([
  apiPost('get_data', { dateFrom: cur.from,  dateTo: cur.to,  forceRefresh }),
  apiPost('get_data', { dateFrom: prev.from, dateTo: prev.to, forceRefresh: false }),
]);
```

**ثلاث مشاكل:**

1. على cache miss بارد → **خطّين كاملين بالتوازي** على نفس المتجر. `restoreRate`
   مشترك، فكل واحد بيبطّئ التاني.
2. بيرجّع `rows` و`orderRows` كاملين للفترة السابقة — المستخدَم منها **المقارنة بس**.
3. **الأهم للمستقبل:** المكان غلط. طالما الجلب في المتصفح، الفترة السابقة
   **مستحيل** تشارك الكتالوج أو أي مورد مشترك مع الفترة الحالية.

> ⚠️ لو الكتالوج اتضاف والجلب لسه في المتصفح → **الكتالوج هيتجاب مرتين في نفس الثانية**.

**الإصلاح:** انقل الجلب جوّه `get_data` بمفتاح كاش مستقل ونسخة **مصغّرة**:

```js
const prevKey = (f, t) => `dash:${TOOL_NAME}:${CACHE_VERSION}:prev:${f}:${t}`;

const withPrev = body.withPrev !== false;
let prev = null;
if (withPrev) {
  const pr = previousRange(dateFrom, dateTo);
  const pk = prevKey(pr.from, pr.to);
  const cached = body.refreshPrev === true ? null : await readCache(env, pk);
  if (cached) prev = cached;
  else {
    const raw = await runRange(pr.from, pr.to);
    const pa  = computeAll(raw);
    prev = { boxes: pa.boxes, orderBoxes: pa.orderBoxes };   // ← بدون صفوف
    await writeCache(env, pk, cacheTtlFor(pr.to), prev);
  }
}
```

**ملحوظة تُحسم عند التنفيذ:** الوضع الحالي بيخزّن الفترة السابقة في نفس
`data:` namespace — ميزة إن اختيار الفترة دي صراحةً بعدين بيلاقيها جاهزة.
النقل لـ `prev:` مصغّر بيضيّع الميزة دي. **الحل:** اكتب الاتنين — `prev:`
المصغّر للمقارنة، و`data:` الكامل لو الحمولة تحت السقف.

---

### 🟡 ٥-٥. `readCache` بيفجّر على قيمة تالفة

```js
async function readCache(env, key) {
  const raw = await env.DASH_KV.get(key);
  return raw ? JSON.parse(raw) : null;    // ← أي بايت تالف = 500 على كل نداء
}
```

**الإصلاح:**

```js
async function readCache(env, key) {
  const raw = await env.DASH_KV.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }   // ← يعيد السحب
}
```

---

### 🟡 ٥-٦. `cacheTtlFor` بيقارن بتاريخ UTC مش القاهرة

```js
const today = new Date().toISOString().slice(0, 10);   // UTC
```

الواجهة بتحسب الفترات بتوقيت **القاهرة** (`cairoNow()` / `cairoDateStr()`).
بين ١٢ و٣ الفجر بتوقيت القاهرة، «إمبارح» بيتقارن بتاريخ UTC اللي لسه هو نفسه —
فبياخد TTL ١٥ دقيقة بدل الكاش الدائم.

**الأثر:** مش رقم غلط — إعادة حساب مجانية مش محتاجينها في نافذة ٣ ساعات يوميًا.

**الإصلاح:** ضيف `cairoTodayStr()` (منقول من مركز القيادة) واستخدمها:

```js
function cairoTodayStr() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function cacheTtlFor(dateTo) {
  return dateTo < cairoTodayStr() ? null : 900;
}
```

---

### 🟡 ٥-٧. توكن OAuth جديد في كل نداء

`getAccessToken()` بيتنادى في بداية كل `get_data` من غير أي كاش. subrequest
واحد زيادة — مش مشكلة أداء اليوم، بس مفتاح KV بـ TTL أقصر من عمر التوكن
بيلغيه بالكامل. **أولوية منخفضة**، يتعمل مع أي تعديل تاني في نفس المنطقة.

---

## ٦. الحصاد الإلزامي من مركز القيادة قبل حذفه

> 🚨 **ده أهم قسم في الملف، وهو الوحيد اللي له تاريخ انتهاء.**
> مركز القيادة هيتحذف. الحاجات دي موجودة فيه ومش موجودة في لوحة الأداء.
> لو الحذف حصل قبل الحصاد، إعادة كتابتها أغلى بمراحل من نسخها.

| # | الحاجة | المصدر في مركز القيادة | الأولوية |
|---|---|---|---|
| **١** | **مجموعة الاختبارات** — `harness.mjs` (٧٦ اختبار) · `browser-test.mjs` (٧٥ فحص) · `make-payload.mjs` | `test/` | 🔴 **الأعلى** |
| **٢** | **الهوية المحاسبية** — `القيمة الإجمالية = قيد التنفيذ + الفاقد + صافي المبيعات` | `test/harness.mjs` | 🔴 |
| **٣** | حلقة `cursor` في `clear_cache` | §CACHE | 🔴 |
| **٤** | `ROWS_MAX_DAYS` + `rowsOmittedReason` | §DATA | 🔴 |
| **٥** | `ISO_DAY` + فحص `dateFrom > dateTo` | §DATA | 🟠 |
| **٦** | `cairoTodayStr()` / `cairoDay()` / `previousRange()` | §HELPERS | 🟠 |
| **٧** | `try/catch` في `readCache` | §CACHE | 🟠 |
| **٨** | استعلام الكتالوج + `buildCatalogIndex()` + `getCatalog()` | §SHOPIFY / §CACHE | 🟠 (لو الكتالوج في الخطة) |
| **٩** | نمط الفترة السابقة server-side بكاش مصغّر | §DATA | 🟠 |
| **١٠** | `diag` endpoint (فحص ذاتي بدون كشف أسرار) | §HANDLER | 🟡 |
| **١١** | أسماء الـ ١١ ميتافيلد في المرحلة ١ | `STAGE1_QUERY` | 🟡 (مرجع عند التوسّع) |
| **١٢** | سقف `series` عند ٤٠٠ + `seriesTruncated` | `buildAnalytics()` | 🟡 |
| **١٣** | `docs/DATA-CONTRACT.md` · `docs/IMPROVEMENTS.md` | `docs/` | 🟡 |

**بند ١ و٢ مش قابلين للتفاوض.** لوحة الأداء دلوقتي **صفر اختبار آلي** — أي
تعديل بينشر على إيمان إن اللي عدّله كان مركّز. والأدوات دي مشكلتها الحقيقية مش
العطل الظاهر، دي **رقم غلط شكله صح** بيوصل للإدارة من غير ما حد ياخد باله.

> **طريقة الحذف:** **أرشفة مش حذف.** خلّي ريبو مركز القيادة archived على GitHub
> (read-only) بدل ما يتمسح — تاريخ git بيفضل متاح لو احتجت حاجة فاتتك.
> وحوّل الرابط القديم لصفحة `meta refresh` بدل ٤٠٤.

---

## ٧. خارطة الطريق — ٤ مراحل

### المرحلة ٠ — الحصاد (قبل أي حاجة تانية)

```
□ انسخ test/ بالكامل من مركز القيادة واظبطها على شكل بيانات لوحة الأداء
□ شغّل الاختبارات على النسخة الحالية وسجّل النتيجة كخط أساس
□ انسخ docs/DATA-CONTRACT.md و docs/IMPROVEMENTS.md
□ أرشف ريبو مركز القيادة (مش حذف)
```

**ليه الأول:** الاختبارات هي شبكة الأمان لكل اللي جاي. من غيرها كل مرحلة بعد كده
بتتنشر بلا إثبات.

---

### المرحلة ١ — إصلاحات الأساس (قبل أي حقل جديد)

```
□ ٥-١  حلقة cursor في clear_cache
□ ٥-٢  ROWS_MAX_DAYS + rowsOmittedReason + MAX_CACHE_BYTES → 24MB
□ ٥-٣  ISO_DAY + dateFrom > dateTo
□ ٥-٥  try/catch في readCache
□ ٥-٦  cairoTodayStr() في cacheTtlFor
```

**صفر `CACHE_VERSION` bump** — كل ده سلوك، مفيش تغيير في شكل الحقول.

> ⚠️ **٥-٢ لازم تسبق أي إضافة حقول.** دلوقتي هي تحسين تجربة. بعد التوسّع هي
> إصلاح عطل — والفرق إن دلوقتي عندك وقت تختبرها.

---

### المرحلة ٢ — تجهيز البنية للتوسّع

```
□ ٥-٤  نقل الفترة السابقة جوّه get_data + مفتاح prev: مصغّر
□      تقسيم الكاش: data: · prev: · meta: · (catalog:)
□      خيارات الطلب: withPrev · refreshPrev · includeRows
□      تحميل كسول — أي مورد تقيل مايتجابش إلا لما يُطلب فعلاً
□      diag endpoint
```

**مبدأ التقسيم:** كل مورد له **دورة حياة مختلفة** ياخد **مفتاح مستقل**.
الكتالوج بيتغيّر كل ساعات، بيانات الأوردرات بتتجمّد بعد اليوم — حطّهم في
مفتاح واحد ومسح واحد بيجرّ التاني بلا داعي.

**الشكل المستهدف:**

```
dash:performance_dashboard:v8:data:<from>:<to>     ← TTL حسب النطاق
dash:performance_dashboard:v8:prev:<from>:<to>     ← TTL حسب النطاق، مصغّر
dash:performance_dashboard:v8:meta:<from>:<to>     ← TTL حسب النطاق
dash:performance_dashboard:v8:catalog              ← TTL ثابت 6 ساعات
```

> **ملحوظة:** بعد حذف مركز القيادة، مفيش داعي لمخزن KV مشترك — لوحة الأداء
> بقت الوحيدة اللي بتقرا، فمفتاح الكتالوج في `DASH_KV` بتاعها كفاية. (ده تبسيط
> حقيقي كسبناه من قرار الحذف.)

---

### المرحلة ٣ — الحقول الجديدة

```
□ اجمع الحقول في دفعتين/تلاتة بحد أقصى — مش حقل ورا حقل
□ كل دفعة: CACHE_VERSION bump واحد
□ كل دفعة: شغّل الاختبارات قبل النشر
□ الكتالوج ياخد استعلامه ومفتاحه المستقلين
□ سجّل كل حقل جديد في Data Contract قبل ما يتكتب في الكود
```

**ليه الدفعات:** كل bump = كل فترة متكاشة بتتحسب من الأول. لو ضفت الحقول على
٨ دفعات، بتدفع التكلفة دي ٨ مرات.

---

## ٨. قواعد ملزمة لأي توسّع مستقبلي

| # | القاعدة | السبب |
|---|---|---|
| ١ | **مفيش Cron** في `wrangler.toml` | كل نداء = فعل بشري. الجدولة = استهلاك حصة + طابور فشل صامت |
| ٢ | **الكاش KV** أبداً D1 | `ecommoda-dashboard-builder` Rule 2 |
| ٣ | **مفيش كتابة كاش جزئية** | أي صفحة تفشل = الطلب كله يفشل |
| ٤ | **مفيش إعادة قراءة من KV بعد الكتابة** | نافذة اتساق ٦٠ ثانية |
| ٥ | **`CACHE_VERSION` يزيد مع أي تغيير في الحقول** | بيانات قديمة بشكل جديد = انهيار صامت |
| ٦ | **مفيش `MAX_PAGES`** ولا أي سقف رقمي صامت | بيقص نطاق مشروع من غير ما حد يعرف |
| ٧ | **أي قص لازم يتبلّغ** في الرد (`rowsIncluded` / `seriesTruncated` / `warnings`) | القص الصامت = رقم غلط شكله صح |
| ٨ | **`productVariants(query:)` ممنوعة** | الفلتر بيتجاهل بصمت ويرجّع كل الفاريانتس |
| ٩ | **اشتقّ قبل ما تسأل** | `computeOrderBoxes` بتاخد تاب كامل بصفر نداء — اتبع النمط |
| ١٠ | **حارس `hasNextPage` على كل connection جديدة** | أي connection من غير حارس = مصدر رقم ناقص |
| ١١ | **الأداة read-only** | ممنوع أي mutation. السجل `login`/`logout` بس |
| ١٢ | **`index.html` بحروف صغيرة** | GitHub Pages بيدي ٤٠٤ على `Index.html` |
| ١٣ | **الأسرار متتكتبش في الريبو** | `CLIENT_ID` · `CLIENT_SECRET` · `WORKER_SECRET` في الداشبورد — وبعد أي سر جديد **Promote** |
| ١٤ | **`DASH_KV` يفضل في `wrangler.toml`** | `wrangler deploy` تعريفي — binding مش مكتوب = بيتشال عند أول نشر |

---

## ٩. قائمة تحقّق قبل إضافة أي حقل

```
□ الحقل ده ينفع يتشتق من بيانات موجودة أصلاً في الرد؟
    → لو آه: اعمله في الواجهة أو في computeXxx(). قف هنا. صفر نداء، صفر bump.

□ الحقل جاي من connection جديدة (returns / variants / collections)؟
    → لازم حارس hasNextPage عليها + ثابت PAGE مسجّل في Data Contract.

□ الحقل بيكبّر rows؟
    → قدّر الحجم على أطول نطاق مدعوم. لو قرّب من 24MB، ROWS_MAX_DAYS لازم ينزل.

□ الحقل له دورة حياة مختلفة عن بيانات الأوردرات (زي الكتالوج)؟
    → مفتاح كاش مستقل + TTL خاص بيه.

□ اتسجّل في docs/performance-dashboard-data-contract؟
    → الكود بيتبع العقد، مش العكس.

□ CACHE_VERSION اتزاد؟
    → أي تغيير في قائمة الحقول = bump إلزامي.

□ الاختبارات شغّالة والهوية المحاسبية سليمة؟
    → القيمة الإجمالية = قيد التنفيذ + الفاقد + صافي المبيعات
    → لو كسرت: قف. ده مش اختبار تجميلي.
```

---

## ملحق: خلاصة الأولويات في جدول واحد

| الأولوية | البند | القسم | يمس `CACHE_VERSION`؟ |
|---|---|---|---|
| 🔴 عاجل | حصاد الاختبارات من مركز القيادة | ٦-١ | لأ |
| 🔴 عاجل | حصاد باقي الكود قبل الأرشفة | ٦ | لأ |
| 🔴 | حلقة `cursor` في `clear_cache` | ٥-١ | لأ |
| 🔴 | `ROWS_MAX_DAYS` + `MAX_CACHE_BYTES` → 24MB | ٥-٢ | لأ |
| 🟠 | فحص صيغة التاريخ | ٥-٣ | لأ |
| 🟠 | الفترة السابقة جوّه الـ Worker | ٥-٤ | آه (مفتاح جديد) |
| 🟠 | `try/catch` في `readCache` | ٥-٥ | لأ |
| 🟠 | `cairoTodayStr()` في `cacheTtlFor` | ٥-٦ | لأ |
| 🟡 | كاش توكن OAuth | ٥-٧ | لأ |
| 🟡 | تقسيم مفاتيح الكاش | ٧-م٢ | آه |
| 🟡 | الحقول الجديدة + الكتالوج | ٧-م٣ | آه |

---

آخر تحديث: 25-08-2026

</div>
