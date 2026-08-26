// ══════════════════════════════════════════════════════════════════
// Performance Dashboard Worker — لوحة الأداء (v3.0.2).
// المرجع: docs/performance-dashboard-data-contract-v2.1.0.md (v2.1.0 — معتمد)
//         + ecommoda-order-lifecycle / references/piece-level-valuation.md (v1.1.0)
//         + ecommoda-order-lifecycle / references/classification-rules.md (عدّ الأوردرات)
//
// النموذج: مستويين مستقلين تمامًا فوق نفس بيانات stage1/stage2:
//   1. مستوى القطعة (Q/C/P) → computeBoxes()      — لتقييم الفلوس (الصفحة الرئيسية)
//   2. مستوى الأوردر بالكامل → computeOrderBoxes() — لعدّ الأوردرات (صفحة الأوردرات، v2.0.0)
// الاتنين بيستخدموا نفس stage1Orders/stage2Map المجابين من شوبيفاي — صفر تكلفة
// GraphQL إضافية لصفحة الأوردرات .
//
// v1.0.1: أضاف rows[] جنب boxes (drill-down).
// v1.1.0: ⚠️ تغيير سلوكي حقيقي في الأرقام — مش تسمية بس (تفاصيل في التاريخ أعلاه
//         بالنسخ السابقة). CACHE_VERSION → v3.
// v1.1.1: إصلاح تحذير كاذب على مربعي المرتجع. CACHE_VERSION → v4.
// v2.0.0 (03-08-2026): ⚠️ إضافة — مش تعديل على أي حساب فلوس موجود:
//   1. صفحة جديدة "الأوردرات" (عدّ أوردرات مش جنيه) — دالة تجميع منفصلة تمامًا
//      computeOrderBoxes()، بتصنّف كل أوردر لـ bucket واحد بالظبط من نفس
//      البيانات المجابة أصلاً (cancelledAt/displayFulfillmentStatus/s1/s2/
//      currentQuantity/returns.status/returns.exchangeLineItems). صفر حقول
//      GraphQL جديدة، صفر نداءات إضافية.
//   2. الإلغاء/RTO في التصنيف الجديد ده بيستخدم isCancelledOrRTO() الموجودة
//      بالظبط (cancelledAt + displayFulfillmentStatus) — مش manual_status —
//      نفس قرار §4.1 القديم، عشان نتجنب باج #49472 القديم (Flow كان بيكتب
//      "Cancelled" في manual_status على أوردر RTO حقيقي).
//   3. get_data بقى يرجّع orderBoxes + orderRows + orderWarnings جنب
//      boxes/rows/warnings الأصليين — من نفس الـ fetch، نفس الكاش، نفس المفتاح.
//   4. CACHE_VERSION → v5 (shape جديد — أي فترة متكاشة بنسخة أقدم هتتحسب تلقائي).
//   كل كود v1.x.x (fetchStage1, fetchStage2, computeBoxes, cache, endpoints
//   الأصلية) **زي ما هو حرفيًا** — صفر تغيير سلوكي على الصفحة الرئيسية.
// v2.1.0 (04-08-2026): ⚠️ إصلاح جذري — تصحيحين حقيقيين في تصنيف mismatched pieces:
//   1. normalBucket(): WhatsApp-Confirmed / WhatsApp-CANCELLED / Pending Edit
//      كانوا بيقعوا غلط جوه IP_CONFIRMED_PREP بسبب catch-all fallback مكنش بيميّزهم
//      عن Confirmed/Ready — دلوقتي بيتصنّفوا صح IP_PENDING_CONFIRM، بنفس منطق
//      classifyOrderForCounts() في صفحة الأوردرات (سبب باج #49660).
//   2. stageFromS2(): 'Returned' مكنش معرّف كمرحلة SHIPPED — يعني أي قطعة في
//      دورة إرجاع لسه مفتوحة (return.status ≠ CLOSED) بس وصلت فيزيائيًا لآخر
//      مرحلة (S2 = Returned) كانت بتقع في IP_UNCLASSIFIED / UNCLASSIFIED بدل
//      IP_RETURN_SHIPPED / SHIPPED_RETURN. دلوقتي 'Returned' مضافة لـ S2_SHIPPED
//      (سبب باج الأوردر #46975).
//   CACHE_VERSION → v6 (تغيير سلوكي حقيقي تاني في التصنيف).
// v3.0.0 (23-08-2026): مراجعة شاملة + تسجيل دخول (نفس رقم نسخة الـ HTML — الملفين
//         بيتحرّكوا مع بعض من النسخة دي):
//   1. تسجيل دخول D1 القياسي (employee + PIN) — endpoints: check_employee /
//      register_pin / verify_employee / log_logout / get_employees. يحتاج
//      D1 binding اسمه DB (ecommoda-dev-logs) — مُضاف يدويًا في Cloudflare
//      Dashboard (الأداة لسه مش على git). صفر تغيير على get_data/get_meta/clear_cache.
//      ⚠️ TOOL_NAME = 'performance_dashboard' لازم يكون مسجّل في ecommoda-constants §7
//      قبل أول تسجيل دخول فعلي (أول writeLog).
//   2. shopifyGQL(): أضاف حارس resp.ok + JSON-parse + empty-data (كان قبل كده
//      bare resp.json() ممكن يرجّع "نجاح صامت" ببيانات فاضية لو فشل الطلب).
//   3. fetchStage2(): أضاف حارس truncation على returns/returnLineItems/
//      exchangeLineItems (كان بس على lineItems في fetchStage1) — بدونه دورة
//      إرجاع/استبدال زايدة عن الحد كانت بتتقص بصمت.
//   4. writeCache(): أضاف حد MAX_CACHE_BYTES (25MB — حد KV نفسه) بدل فشل صامت
//      لو فترة كبيرة جدًا.
//   ⚠️ صفر تغيير في computeBoxes/computeOrderBoxes/classifyOrderForCounts —
//      CACHE_VERSION فضلت v6 لأن مفيش تغيير سلوكي في التصنيف نفسه في النسخة دي.
//      انظر ملاحظات التسليم لبقين معروفين (لسه محتاجين قرار قبل التنفيذ):
//      - classifyOrderForCounts(): hasExchange/hasSettledClosed بيتحسبوا Any
//        عبر كل دورات الأوردر مجمّعة، مش لكل دورة لوحدها — أوردر بأكتر من دورة
//        R/E ممكن يتصنّف غلط. يحتاج Data Contract جديد لتتبّع كل دورة لوحدها.
// v3.0.1 (25-08-2026): RETURNS_PAGE (5→10) و EXCHANGE_LINES_PAGE (10→20) —
//   الحد القديم كان بيوقف الطلب كله (حارس truncation فوق) على أوردرات حقيقية
//   وصلت لأكتر من ٥ دورات إرجاع/استبدال، أو دورة فيها أكتر من ١٠ سطر بديل
//   (مؤكَّد من أحمد 25-08-2026 — Data Contract v2.1.0 §6). التعديل نفسه اتعمل
//   يدويًا ونُشر قبل الالتزام ده (commit ec9af6c) — هنا استكمال التوثيق +
//   رفع CACHE_VERSION اللي بيروح جنب أي تغيير في شكل استعلام GraphQL
//   (caching-model.md §3). صفر تغيير في منطق التصنيف (أقسام 1–5 في العقد).
//   CACHE_VERSION → v7.
// v3.0.2 (25-08-2026): تصحيح توثيق فقط — صفر تغيير سلوكي، صفر CACHE_VERSION bump:
//   الملاحظة اللي فوق (v3.0.1) عن classifyOrderForCounts() و S1=In-Return كانت
//   بتقول إن السلوك مخالف لـ Rule 12 في ecommoda-order-lifecycle. بعد قراءة
//   كاملة اتضح العكس: الكود كان مطبّق صح من الأصل، والـ Rule 12 هي اللي
//   اتوسّعت (قرار أحمد 25-08-2026) لتغطي S2 وعدّ الأوردرات كمان — مش S1 وفلوس
//   بس. مفيش مربع "قيد الإرجاع"، مفيش IN_TRANSIT_BACK، ومفيش تعديل في
//   classifyOrderForCounts() ولا stageFromS2(). التعليق على normalBucket()
//   تحت (كان بيقول "S1 فقط، مش S2") اتحدّث ليعكس نفس القرار.
//
// skills: worker-builder v1.0.0 · constants v1.0.0 · dashboard-builder v1.0.0 — 26-08-2026
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════
const TOOL_NAME  = 'performance_dashboard';
const CACHE_VERSION = 'v7'; // v2(rows) → v3(buckets) → v4(fix assertion) → v5(+orderBoxes/orderRows) → v6(fix normalBucket + stageFromS2) → v7(RETURNS_PAGE 5→10, EXCHANGE_LINES_PAGE 10→20 — كانت بتوقف طلبات لأوردرات حقيقية)

// الحدود دي منسوخة حرفياً من Data Contract v2 §6 — ممنوع تتغير من غير Data Contract جديد
const LINE_ITEMS_PAGE     = 25;   // lineItems(first: 25) — absolute max
const RETURNS_PAGE        = 10;    // returns(first: 10)
const RETURN_LINES_PAGE   = 25;   // returnLineItems(first: 25)
const EXCHANGE_LINES_PAGE = 20;   // exchangeLineItems(first: 20)
const STAGE1_PAGE_SIZE    = 250;  // orders(first: 250) — مرحلة 1
const STAGE2_BATCH_SIZE   = 10;   // نداءات nodes(ids:) — مرحلة 2، دفعات 10

// §CONSTANTS::S1 — قيم manual_status حرفياً (ecommoda-order-lifecycle §2 — casing load-bearing)
// v2.0.0: أضاف القيم الوسيطة (Confirmed, Confirmed + Edit, Pending Edit,
// WhatsApp-Confirmed, WhatsApp-CANCELLED) — مش مستخدمة في normalBucket() القديمة
// (بتعتمد على default fallback)، لكن لازمة لتصنيف "تحت التأكيد" الدقيق في
// classifyOrderForCounts(). إضافة بحتة — صفر تغيير على normalBucket().
// v2.1.0: normalBucket() بقت فعلياً بتستخدم القيم دي (انظر تعديل normalBucket تحت).
const S1 = {
  NEW_ORDER:            'New Order',
  PENDING_EDIT:         'Pending Edit',
  WHATSAPP_CONFIRMED:   'WhatsApp-Confirmed',
  WHATSAPP_CANCELLED:   'WhatsApp-CANCELLED',
  CONFIRMED:            'Confirmed',
  CONFIRMED_EDIT:       'Confirmed + Edit',
  READY:                'Ready',
  SHIPPED:              'Shipped',
  IN_RETURN:            'In-Return',
  DELIVERED:            'Delivered',
  RETURNED:             'Returned',
  CANCELLED:            'Cancelled',
};

// §CONSTANTS::S2 — قيم status_2_r_e حرفياً (مسافات حوالين الـ + مقصودة، الكابيتال مقصود)
const S2_PREP    = ['Confirmed + RETURN', 'Confirmed + EXCHANGE', 'Ready'];
// v2.1.0 — 'Returned' اتضافت هنا: القطعة وصلت فيزيائيًا آخر مرحلة (رجعت المخزن)
// لكن الدورة (return.status) لسه ممكن تكون مش CLOSED رسميًا — أقرب حالة موجودة
// ليها هي SHIPPED (نفس معاملة 'In-Return' بالظبط)، مش UNCLASSIFIED.
const S2_SHIPPED = ['Shipped', 'In-Return', 'Returned'];

// §CONSTANTS::RETURN_STATUS — الدورات المتجاهلة تماماً (piece-level-valuation §4)
const RETURN_IGNORED = ['CANCELED', 'DECLINED'];
// ⚠️ "مفتوحة/تحت التنفيذ" معرّفة عكسياً: أي حاجة مش CLOSED. الأدمن بيعرض badge
// اسمه "Return in progress" لكن ده نص واجهة مش قيمة enum — التعريف العكسي بيشتغل
// صح مهما كانت القيمة الحقيقية (OPEN / REQUESTED / …).
const isOpenReturn = status => status !== 'CLOSED';

// §CONSTANTS::BUCKETS — قاموس موحّد لحالة القطعة (مستوى القطعة/الفلوس) — مصدر
// واحد للحقيقة يستخدمه الـ Worker هنا والـ HTML (BUCKET_LABELS). أي إضافة هنا
// لازم تتضاف هناك.
const BUCKET = {
  // الفاقد
  RTO:                     'RTO',
  CANCELLED:               'CANCELLED',
  REMOVED:                 'REMOVED',
  FINAL_RETURN:            'FINAL_RETURN',
  EXCHANGE_RETURN:         'EXCHANGE_RETURN',
  // صافي المبيعات
  NET_SALES_NORMAL:        'NET_SALES_NORMAL',
  NET_SALES_REPLACEMENT:   'NET_SALES_REPLACEMENT',
  // قيد التنفيذ — 7 مربعات (v1.1.0)
  IP_PENDING_CONFIRM:      'IP_PENDING_CONFIRM',      // 1 · تحت التأكيد
  IP_CONFIRMED_PREP:       'IP_CONFIRMED_PREP',       // 2 · مؤكد / تحت التجهيز
  IP_EXCHANGE_PREP:        'IP_EXCHANGE_PREP',        // 3 · استبدال / تحت التجهيز
  IP_RETURN_PREP:          'IP_RETURN_PREP',          // 4 · مرتجع / تحت التجهيز
  IP_CONFIRMED_SHIPPED:    'IP_CONFIRMED_SHIPPED',    // 5 · مؤكد / خرج للشحن
  IP_EXCHANGE_SHIPPED:     'IP_EXCHANGE_SHIPPED',     // 6 · استبدال / خرج للشحن
  IP_RETURN_SHIPPED:       'IP_RETURN_SHIPPED',       // 7 · مرتجع / خرج للشحن
  IP_UNCLASSIFIED:         'IP_UNCLASSIFIED',         // 8 · خارج التصنيف — يحتاج مراجعة
};

// §CONSTANTS::ORDER_BUCKET — تصنيف على مستوى الأوردر بالكامل (عدّ أوردرات، مش
// فلوس) — v2.0.0. مصدر واحد للحقيقة يستخدمه الـ Worker هنا والـ HTML
// (ORDER_BUCKET_LABELS). مستقل تمامًا عن BUCKET فوق — لا تخلط بينهم.
const ORDER_BUCKET = {
  PENDING_CONFIRM:          'PENDING_CONFIRM',           // تحت التأكيد
  PREP_CONFIRMED:           'PREP_CONFIRMED',            // مؤكد / تحت التجهيز
  PREP_EXCHANGE:            'PREP_EXCHANGE',              // استبدال / تحت التجهيز
  PREP_RETURN:              'PREP_RETURN',                // مرتجع / تحت التجهيز
  SHIPPED_CONFIRMED:        'SHIPPED_CONFIRMED',          // مؤكد / خرج للشحن
  SHIPPED_EXCHANGE:         'SHIPPED_EXCHANGE',           // استبدال / خرج للشحن
  SHIPPED_RETURN:           'SHIPPED_RETURN',             // مرتجع / خرج للشحن
  LOST_CANCELLED:           'LOST_CANCELLED',             // إلغاء قبل الشحن
  LOST_RTO:                 'LOST_RTO',                   // مرتجع رفض الاستلام
  LOST_FULL_RETURN:         'LOST_FULL_RETURN',           // مرتجع كامل بعد الاستلام
  DELIVERY_BASIC:           'DELIVERY_BASIC',             // تسليم أساسي
  DELIVERY_EXCHANGE:        'DELIVERY_EXCHANGE',          // تسليم + استبدال
  DELIVERY_PARTIAL_RETURN:  'DELIVERY_PARTIAL_RETURN',    // تسليم + استرجاع جزئي
  UNCLASSIFIED:             'UNCLASSIFIED',               // خارج التصنيف
};

// §CONSTANTS::ROW_NOTES — ملاحظات تشخيصية على الصف (مش بتغيّر الـ bucket أبداً)
const NOTE = {
  REDELIVERY:  'REDELIVERY',   // S1=Ready + Fulfilled → محاولة تسليم مكررة (lifecycle Rule 5)
  FULFIL_MISM: 'FULFIL_MISM',  // حالة الشحن الفعلية للسطر ما طابقتش توقع المربع
};

// ══════════════════════════════════════════════════════
// §CORS — wildcard — أداة read-only (get_data/get_meta/clear_cache) + auth endpoints
// (تسجيل دخول D1 قياسي أُضيف v2.2.0 — الحماية على مستوى الـ Worker لسه WORKER_SECRET بس)
// ══════════════════════════════════════════════════════
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function corsPreflight() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

// ══════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// خطأ بيسمي الخطوة اللي فشلت فيها — إلزامي (dashboard-builder Step 6)
function fail(step, arMessage, technical) {
  const err = new Error(arMessage);
  err.step = step;
  err.technical = technical;
  return err;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════
// §SHARED
// ══════════════════════════════════════════════════════

// §SHARED::unitPrice — P في النموذج (discountedUnitPriceSet.shopMoney.amount)
function unitPrice(li) {
  return parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount || 0);
}

// §SHARED::numericIdFromGid — "gid://shopify/Order/123" → "123" (للهايبرلينك)
function numericIdFromGid(gid) {
  return (gid || '').split('/').pop();
}

// §SHARED::isLineFulfilled — على مستوى السطر، مش الأوردر.
// unfulfilledQuantity = 0 يعني كل كمية السطر اتشحنت. بيتستخدم كـ **تأكيد إضافي**
// (assertion) بس — أبداً مش بيحدد الـ bucket، عشان مايختفيش أي جنيه من التصنيف
// لو البيانات اتعارضت. التعارض بيتسجّل كـ note على الصف بدل ما يتبلع.
function isLineFulfilled(li) {
  return (li.unfulfilledQuantity || 0) === 0;
}

// ══════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════
async function getAccessToken(env) {
  const resp = await fetch(
    `https://${env.SHOP_DOMAIN}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
        grant_type:    'client_credentials',
      }),
    }
  );
  if (!resp.ok) throw fail('oauth', 'فشل تسجيل الدخول لـ Shopify', `OAuth failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.access_token) throw fail('oauth', 'فشل تسجيل الدخول لـ Shopify', 'No access_token in OAuth response');
  return data.access_token;
}

// ⚠️ حارس إلزامي (dashboard-builder — نمط resp.ok + JSON-parse + empty-data) —
// بدون الحارس ده أي فشل شبكة/انتهاء صلاحية توكن كان بيتحوّل لـ "نجاح صامت" ببيانات
// فاضية (undefined.data يمرّ من هنا لحد fetchStage1/fetchStage2 اللي بترمي برسالة
// مضلّلة "Shopify لم يرجع بيانات" بدل السبب الحقيقي).
async function shopifyGQL(env, token, query, variables = {}) {
  const resp = await fetch(
    `https://${env.SHOP_DOMAIN}/admin/api/2026-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Shopify GraphQL HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    throw new Error('Shopify GraphQL رجّع رد مش JSON صالح: ' + e.message);
  }

  if (!data || (data.data === undefined && data.errors === undefined)) {
    throw new Error('Shopify GraphQL رجّع رد فاضي (لا data ولا errors)');
  }

  return data;
}

// §SHOPIFY::shopifyWithRetry — throttle retry، نسخة حرفية من dashboard-builder Step 6
async function shopifyWithRetry(env, token, query, variables = {}, maxRetries = 3) {
  for (let i = 0; i <= maxRetries; i++) {
    const data = await shopifyGQL(env, token, query, variables);

    const throttled = data.errors?.some(e => e.extensions?.code === 'THROTTLED');

    if (data.errors && !throttled) {
      throw new Error('Shopify GraphQL error: ' + JSON.stringify(data.errors));
    }
    if (!throttled) return data;
    if (i === maxRetries) throw new Error('Shopify throttled — استُنفدت المحاولات');

    const restore = data.extensions?.cost?.throttleStatus?.restoreRate;
    const wait = restore
      ? Math.ceil(data.extensions.cost.throttleStatus.maximumAvailable / restore) * 1000
      : 2000 * (i + 1);
    await sleep(wait);
  }
}

// ─── §SHOPIFY::fetchStage1 ───
// Data Contract v2 §6 مرحلة 1 — كل الأوردرات، first: 250، حارس truncation إلزامي
// v1.1.0: أضاف unfulfilledQuantity على السطر (تأكيد حالة الشحن على مستوى القطعة)
// v2.0.0: بدون أي تغيير — نفس الحقول بالظبط تكفي صفحة الأوردرات الجديدة كمان
async function fetchStage1(env, token, dateFrom, dateTo) {
  const query = `
    query GetOrdersStage1($cursor: String, $q: String) {
      orders(first: ${STAGE1_PAGE_SIZE}, after: $cursor, query: $q) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          name
          createdAt
          cancelledAt
          displayFulfillmentStatus
          s1: metafield(namespace: "custom", key: "manual_status") { value }
          s2: metafield(namespace: "custom", key: "status_2_r_e")  { value }
          lineItems(first: ${LINE_ITEMS_PAGE}) {
            pageInfo { hasNextPage }
            nodes {
              id
              sku
              quantity
              currentQuantity
              unfulfilledQuantity
              discountedUnitPriceSet { shopMoney { amount } }
            }
          }
        }
      }
    }
  `;

  // ⚠️ حرفياً زي Data Contract §6 — مسافة بين الشرطين (implicit AND)، مش "AND" صريحة
  const searchQuery = `created_at:>=${dateFrom} created_at:<=${dateTo}`;

  let cursor  = null;
  let hasNext = true;
  let page    = 0;
  const orders = [];

  while (hasNext) {
    page++;
    let result;
    try {
      result = await shopifyWithRetry(env, token, query, { cursor, q: searchQuery });
    } catch (e) {
      throw fail(`stage1_page_${page}`, `فشل جلب صفحة الأوردرات رقم ${page}`, e.message);
    }

    const conn = result?.data?.orders;
    if (!conn) throw fail(`stage1_page_${page}`, 'Shopify لم يرجع بيانات أوردرات', JSON.stringify(result));

    // cursor-stuck guard — الحماية الوحيدة من infinite loop (لا MAX_PAGES — dashboard-builder Rule 6)
    if (conn.pageInfo.endCursor === cursor && conn.pageInfo.hasNextPage) {
      throw fail(`stage1_page_${page}`, 'توقفت صفحات الأوردرات عن التقدم (cursor عالق)', 'endCursor did not advance');
    }

    for (const node of conn.nodes) {
      // ⚠️ حارس إلزامي — Data Contract §6: أي أوردر فيه أكتر من LINE_ITEMS_PAGE سطر
      // لازم الطلب يفشل برسالة واضحة (رقم الأوردر) بدل ما يرجع رقم ناقص بصمت.
      if (node.lineItems?.pageInfo?.hasNextPage) {
        throw fail(
          `stage1_page_${page}`,
          `الأوردر ${node.name || node.id} فيه أكتر من ${LINE_ITEMS_PAGE} سطر — الطلب اتوقف بدل ما يرجّع رقم ناقص`,
          `lineItems.pageInfo.hasNextPage = true on order ${node.id}`
        );
      }
      orders.push(node);
    }

    hasNext = conn.pageInfo.hasNextPage;
    cursor  = conn.pageInfo.endCursor;
    if (hasNext) await sleep(1000); // ثانية بين الصفحات — Data Contract §6
  }

  return orders;
}

// ─── §SHOPIFY::fetchStage2 ───
// Data Contract v2 §6 مرحلة 2 — المرشّحون فقط (فلترة تمت client-side في §AGGREGATE)، دفعات 10
// v2.0.0: بدون أي تغيير — returns.status/exchangeLineItems كافيين لصفحة الأوردرات كمان
async function fetchStage2(env, token, candidateIds) {
  const query = `
    query GetReturnsStage2($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          returns(first: ${RETURNS_PAGE}) {
            pageInfo { hasNextPage }
            nodes {
              status
              returnLineItems(first: ${RETURN_LINES_PAGE}) {
                pageInfo { hasNextPage }
                nodes {
                  quantity
                  ... on ReturnLineItem { fulfillmentLineItem { lineItem { id } } }
                }
              }
              exchangeLineItems(first: ${EXCHANGE_LINES_PAGE}) {
                pageInfo { hasNextPage }
                nodes { lineItem { id } }
              }
            }
          }
        }
      }
    }
  `;

  const stage2Map = new Map();

  for (let i = 0; i < candidateIds.length; i += STAGE2_BATCH_SIZE) {
    const batch = candidateIds.slice(i, i + STAGE2_BATCH_SIZE);
    const batchNum = Math.floor(i / STAGE2_BATCH_SIZE) + 1;

    let result;
    try {
      result = await shopifyWithRetry(env, token, query, { ids: batch });
    } catch (e) {
      throw fail(`stage2_batch_${batchNum}`, `فشل جلب بيانات المرتجعات — دفعة ${batchNum}`, e.message);
    }

    const nodes = result?.data?.nodes;
    if (!nodes) throw fail(`stage2_batch_${batchNum}`, 'Shopify لم يرجع بيانات مرتجعات', JSON.stringify(result));

    for (const node of nodes) {
      if (!node) continue;

      // ⚠️ حارس truncation إلزامي على كل connection متداخلة (نفس مبدأ fetchStage1
      // على lineItems) — بدون الحارس ده دورة إرجاع/استبدال زايدة عن الحد بتتقص
      // بصمت فيرجع رقم فلوس/عدد أوردرات ناقص من غير أي تحذير.
      const returnsConn = node.returns;
      if (returnsConn?.pageInfo?.hasNextPage) {
        throw fail(
          `stage2_batch_${batchNum}`,
          `الأوردر ${node.id} فيه أكتر من ${RETURNS_PAGE} دورة إرجاع/استبدال — الطلب اتوقف بدل ما يرجّع رقم ناقص`,
          `returns.pageInfo.hasNextPage = true on order ${node.id}`
        );
      }
      for (const ret of returnsConn?.nodes || []) {
        if (ret.returnLineItems?.pageInfo?.hasNextPage) {
          throw fail(
            `stage2_batch_${batchNum}`,
            `الأوردر ${node.id} فيه دورة إرجاع بأكتر من ${RETURN_LINES_PAGE} سطر مرتجع — الطلب اتوقف بدل ما يرجّع رقم ناقص`,
            `returnLineItems.pageInfo.hasNextPage = true on order ${node.id}`
          );
        }
        if (ret.exchangeLineItems?.pageInfo?.hasNextPage) {
          throw fail(
            `stage2_batch_${batchNum}`,
            `الأوردر ${node.id} فيه دورة استبدال بأكتر من ${EXCHANGE_LINES_PAGE} سطر بديل — الطلب اتوقف بدل ما يرجّع رقم ناقص`,
            `exchangeLineItems.pageInfo.hasNextPage = true on order ${node.id}`
          );
        }
      }

      stage2Map.set(node.id, node);
    }

    if (i + STAGE2_BATCH_SIZE < candidateIds.length) await sleep(500);
  }

  return stage2Map;
}

// ══════════════════════════════════════════════════════
// §AGGREGATE — تطبيق حرفي لـ Data Contract v2 §2/§4/§5
//              + piece-level-valuation.md §3.3/§3.4 (v1.1.0)
//              + classification-rules.md (عدّ الأوردرات — v2.0.0)
// ══════════════════════════════════════════════════════

// §AGGREGATE::isCancelledOrRTO — §4.1، يسبق أي فحص تاني. manual_status مش مستخدم هنا أبداً
// ⚠️ v2.0.0: نفس الدالة دي بالظبط بتُستخدم في computeOrderBoxes() تحت — مصدر
// واحد للحقيقة لقرار ملغي/RTO، سواء بمستوى القطعة أو مستوى الأوردر.
function isCancelledOrRTO(order) {
  if (!order.cancelledAt) return null;
  return order.displayFulfillmentStatus === 'FULFILLED' ? 'RTO' : 'CANCELLED';
}

// §AGGREGATE::isCandidateForStage2 — §6: Σ(Q) ≠ Σ(C) أو s2 ≠ null
function isCandidateForStage2(order) {
  if (order.cancelledAt) return false;
  const lineItems = order.lineItems?.nodes || [];
  const sumQ = lineItems.reduce((s, li) => s + (li.quantity || 0), 0);
  const sumC = lineItems.reduce((s, li) => s + (li.currentQuantity || 0), 0);
  const s2 = order.s2?.value || null;
  return sumQ !== sumC || s2 !== null;
}

// §AGGREGATE::stageFromS2 — المرحلة الفيزيائية لدورة R/E من قيمة S2
// بترجع 'PREP' | 'SHIPPED' | null (null = قيمة S2 غير متوقعة → مربع خارج التصنيف)
// v2.1.0: 'Returned' بقت جوه S2_SHIPPED (انظر تعليق تعريف S2_SHIPPED فوق) —
// كانت قبل كده بترجع null فتقع في IP_UNCLASSIFIED رغم إنها دورة معروفة ومفهومة.
function stageFromS2(s2) {
  if (S2_PREP.includes(s2))    return 'PREP';
  if (S2_SHIPPED.includes(s2)) return 'SHIPPED';
  return null;
}

// §AGGREGATE::normalBucket — تصنيف القطع الحيّة اللي مش مرتبطة بأي استبدال ولا إرجاع
// ⚠️ 'In-Return' تُعامل معاملة 'Shipped' في S1 و S2 معًا، للعدّ وللفلوس
//    (قرار Ahmed 03-08-2026، اتوسّع 25-08-2026 — ecommoda-order-lifecycle Rule 12).
//    موثّق في piece-level-valuation.md §3.4.
// ⚠️ S1 = 'Returned' / 'Cancelled' من غير cancelledAt في شوبيفاي → خارج التصنيف
//    (مش فاقد، لأن §3.1 بيقول الفاقد بييجي من حدث شوبيفاي مش من الميتافيلد).
//    ⚠️ ده تحذير مقصود، مش باج: لو شايف صفوف كتير هنا بـ S1=Returned، ده معناه
//    أوردرات RTO اتحدّث الـ manual_status بتاعها لـ "Returned" لكن الأوردر الفعلي
//    في شوبيفاي ما اتلغاش (cancelledAt فاضي) — فجوة عملية محتاجة مراجعة يدوية،
//    مش حاجة الكود يقدر يصلّحها لوحده.
// v2.1.0: ⚠️ إصلاح جذري — New Order / Pending Edit / WhatsApp-Confirmed /
//    WhatsApp-CANCELLED كانوا بيقعوا في الـ fallback الأخير (IP_CONFIRMED_PREP)
//    غلط، بدل IP_PENDING_CONFIRM. دلوقتي بيتفصلوا صراحة بنفس مجموعة الشرط
//    المستخدمة في classifyOrderForCounts() (مصدر واحد للحقيقة لتصنيف "تحت
//    التأكيد" — سواء على مستوى القطعة هنا أو الأوردر هناك).
function normalBucket(s1) {
  if (
    s1 === S1.NEW_ORDER || s1 === S1.PENDING_EDIT ||
    s1 === S1.WHATSAPP_CONFIRMED || s1 === S1.WHATSAPP_CANCELLED
  ) {
    return BUCKET.IP_PENDING_CONFIRM;
  }
  if (s1 === S1.SHIPPED || s1 === S1.IN_RETURN) return BUCKET.IP_CONFIRMED_SHIPPED;
  if (s1 === S1.RETURNED || s1 === S1.CANCELLED) return BUCKET.IP_UNCLASSIFIED;
  // Confirmed · Confirmed + Edit · Ready · null → تحت التجهيز
  return BUCKET.IP_CONFIRMED_PREP;
}

// §AGGREGATE::EXPECT_FULFILLED — التوقع المرتبط بكل مربع (assertion بس)
// ⚠️ مربعات المرتجع (4 و 7) **مقصود** إنها مش هنا. القطعة المرتجعة بطبيعتها
// اتشحنت ووصلت العميل قبل ما ترجع، يعني Fulfilled دايماً مهما كانت مرحلة S2 —
// فأي توقع لحالة شحن عليها بيولّد تحذير كاذب على كل صف. اتأكد على #49572:
// Green/43 في مرحلة "Confirmed + RETURN" وهي unfulfilledQuantity = 0.
const EXPECT_FULFILLED = {
  [BUCKET.IP_PENDING_CONFIRM]:   false,
  [BUCKET.IP_CONFIRMED_PREP]:    false,
  [BUCKET.IP_EXCHANGE_PREP]:     false,
  [BUCKET.IP_CONFIRMED_SHIPPED]: true,
  [BUCKET.IP_EXCHANGE_SHIPPED]:  true,
};

// §AGGREGATE::pushRow — صف drill-down واحد لكل جزء كمية له bucket مختلف (مستوى القطعة)
function pushRow(rows, ctx, li, qty, value, bucket, note = null) {
  if (!qty) return;
  rows.push({
    orderId:          ctx.orderId,
    orderName:        ctx.orderName,
    orderTotalPieces: ctx.orderTotalPieces,
    createdAt:        ctx.createdAt,
    sku:              li.sku || null,
    qty,
    value,
    bucket,
    s1:               ctx.s1,
    s2:               ctx.s2,
    note,
  });
}

// §AGGREGATE::computeBoxes — القلب: بيرجع { boxes, rows, warnings }  (مستوى القطعة/الفلوس)
// v2.1.0: صفر تغيير في الدالة دي نفسها — التصحيح كله جوه normalBucket()/stageFromS2()
// اللي هي بتستدعيهم، فالتأثير بيوصلها تلقائي من غير أي تعديل هنا.
function computeBoxes(stage1Orders, stage2Map) {
  const b = {
    totalValue: 0,

    inProgress: 0,
    ipPendingConfirm: 0, ipConfirmedPrep: 0, ipExchangePrep: 0, ipReturnPrep: 0,
    ipConfirmedShipped: 0, ipExchangeShipped: 0, ipReturnShipped: 0, ipUnclassified: 0,

    lost: 0, lostCancelled: 0, lostRTO: 0, lostRemoved: 0, lostFinalReturn: 0, lostExchangeReturn: 0,

    netSales: 0, netSalesReplacement: 0,
  };
  const rows = [];
  const warnings = { fulfilmentMismatch: 0, redelivery: 0, unclassified: 0 };

  // مفتاح تجميع الـ bucket → الحقل المقابل في b
  const IP_FIELD = {
    [BUCKET.IP_PENDING_CONFIRM]:   'ipPendingConfirm',
    [BUCKET.IP_CONFIRMED_PREP]:    'ipConfirmedPrep',
    [BUCKET.IP_EXCHANGE_PREP]:     'ipExchangePrep',
    [BUCKET.IP_RETURN_PREP]:       'ipReturnPrep',
    [BUCKET.IP_CONFIRMED_SHIPPED]: 'ipConfirmedShipped',
    [BUCKET.IP_EXCHANGE_SHIPPED]:  'ipExchangeShipped',
    [BUCKET.IP_RETURN_SHIPPED]:    'ipReturnShipped',
    [BUCKET.IP_UNCLASSIFIED]:      'ipUnclassified',
  };

  for (const order of stage1Orders) {
    const lineItems = order.lineItems?.nodes || [];
    const s1Val = order.s1?.value || null;
    const s2Val = order.s2?.value || null;

    const ctx = {
      orderId:          numericIdFromGid(order.id),
      orderName:        order.name || null,
      orderTotalPieces: lineItems.reduce((s, li) => s + (li.quantity || 0), 0),
      createdAt:        order.createdAt || null,
      s1: s1Val,
      s2: s2Val,
    };

    // §4.1 — ملغي/RTO: كل قيمة السطر (Q×P) بتروح للفاقد، مش بس الفرق (Q−C)
    const shortCircuit = isCancelledOrRTO(order);
    if (shortCircuit) {
      for (const li of lineItems) {
        const P = unitPrice(li);
        const Q = li.quantity || 0;
        const lineTotal = Q * P;
        b.totalValue += lineTotal;
        b.lost       += lineTotal;
        if (shortCircuit === 'RTO') { b.lostRTO += lineTotal;       pushRow(rows, ctx, li, Q, lineTotal, BUCKET.RTO); }
        else                        { b.lostCancelled += lineTotal; pushRow(rows, ctx, li, Q, lineTotal, BUCKET.CANCELLED); }
      }
      continue;
    }

    const stage2Order = stage2Map.get(order.id);
    const returns = stage2Order?.returns?.nodes || [];

    // §4.2 + §4.3 — تسوية الدورات وربط الأسطر تراكمياً بالكمية (مش one-to-one)
    const settledByLineId     = new Map(); // lineId -> { finalQty, exchangeQty }
    const unsettledByLineId   = new Map(); // lineId -> qty (دورة مفتوحة على السطر الأصلي)
    const replacementByLineId = new Map(); // lineId -> 'settled' | 'unsettled' (سطر البديل)

    for (const ret of returns) {
      if (RETURN_IGNORED.includes(ret.status)) continue; // §4.2 — تُتجاهل بالكامل

      // §4.2 — الشرطان مع بعض: status بيقول أنهي دورة قفلت، s2 بيقول وضع الدورة
      // المفتوحة حالياً فيزيائياً. الاتنين لازم.
      const isSettled = ret.status === 'CLOSED' && (s2Val === 'In-Return' || s2Val === 'Returned');
      const exchangeLines = ret.exchangeLineItems?.nodes || [];
      const isExchange = exchangeLines.length > 0;

      for (const el of exchangeLines) {
        const lid = el.lineItem?.id;
        if (!lid) continue;
        const prev = replacementByLineId.get(lid);
        if (!prev || (isSettled && prev !== 'settled')) {
          replacementByLineId.set(lid, isSettled ? 'settled' : 'unsettled');
        }
      }

      const retLines = ret.returnLineItems?.nodes || [];
      for (const rl of retLines) {
        const lid = rl.fulfillmentLineItem?.lineItem?.id;
        const qty = rl.quantity || 0;
        if (!lid || !qty) continue;

        if (isSettled) {
          const entry = settledByLineId.get(lid) || { finalQty: 0, exchangeQty: 0 };
          if (isExchange) entry.exchangeQty += qty; else entry.finalQty += qty;
          settledByLineId.set(lid, entry);
        } else if (isOpenReturn(ret.status)) {
          // دورة لسه مفتوحة (مش CLOSED) → القطعة "في الطريق"، لا فاقد ولا مبيعات
          unsettledByLineId.set(lid, (unsettledByLineId.get(lid) || 0) + qty);
        } else {
          // CLOSED لكن S2 لسه ما وصلش In-Return/Returned — تعارض بيانات نادر.
          // بنعاملها معاملة الدورة المفتوحة (الأكثر تحفّظاً) بدل ما نطيّرها.
          unsettledByLineId.set(lid, (unsettledByLineId.get(lid) || 0) + qty);
        }
      }
    }

    // ── تسجيل كل قطعة في مربع واحد بالظبط ──
    const addIP = (bucket, value) => {
      b.inProgress += value;
      b[IP_FIELD[bucket]] += value;
      if (bucket === BUCKET.IP_UNCLASSIFIED) warnings.unclassified++;
    };

    for (const li of lineItems) {
      const P = unitPrice(li);
      const Q = li.quantity || 0;
      const C = li.currentQuantity || 0;
      const lineTotal = Q * P;
      b.totalValue += lineTotal;

      const goneTotal    = Math.max(Q - C, 0);
      const settled      = settledByLineId.get(li.id) || { finalQty: 0, exchangeQty: 0 };
      const unsettledQty = unsettledByLineId.get(li.id) || 0;
      const settledQty   = settled.finalQty + settled.exchangeQty;
      // §4.3 — الباقي بعد المُسوّى وغير المُسوّى = محذوف قبل الشحن
      const removedQty   = Math.max(goneTotal - settledQty - unsettledQty, 0);

      // ─── الفاقد (بدون تغيير عن v1.0.1) ───
      b.lost               += (removedQty + settledQty) * P;
      b.lostRemoved        += removedQty * P;
      b.lostFinalReturn    += settled.finalQty * P;
      b.lostExchangeReturn += settled.exchangeQty * P;

      pushRow(rows, ctx, li, removedQty,         removedQty * P,        BUCKET.REMOVED);
      pushRow(rows, ctx, li, settled.finalQty,    settled.finalQty * P,    BUCKET.FINAL_RETURN);
      pushRow(rows, ctx, li, settled.exchangeQty, settled.exchangeQty * P, BUCKET.EXCHANGE_RETURN);

      const stage    = stageFromS2(s2Val);
      const fulfilled = isLineFulfilled(li);

      // ─── الجزء (أ): القطع اللي في دورة إرجاع مفتوحة (مربع 4 / 7) ───
      // ⚠️ v1.1.0 — ده الجزء اللي كان بيروح "صافي المبيعات" غلط في v1.0.x.
      // بيتطبق سواء كانت الدورة استبدال أو إرجاع عادي (قرار Ahmed).
      if (unsettledQty > 0) {
        let bucket;
        if (stage === 'PREP')         bucket = BUCKET.IP_RETURN_PREP;
        else if (stage === 'SHIPPED') bucket = BUCKET.IP_RETURN_SHIPPED;
        else                          bucket = BUCKET.IP_UNCLASSIFIED;

        const value = unsettledQty * P;
        addIP(bucket, value);

        let note = null;
        if (bucket in EXPECT_FULFILLED && EXPECT_FULFILLED[bucket] !== fulfilled) {
          note = NOTE.FULFIL_MISM; warnings.fulfilmentMismatch++;
        }
        pushRow(rows, ctx, li, unsettledQty, value, bucket, note);
      }

      // ─── الجزء (ب): القطع الباقية فعلياً في الأوردر (C) ───
      if (C > 0) {
        const value = C * P;
        const replState = replacementByLineId.get(li.id);

        if (replState === 'settled') {
          // بديل من دورة مُسوّاة → مبيعات حقيقية بسعره (§3.3)
          b.netSales += value; b.netSalesReplacement += value;
          pushRow(rows, ctx, li, C, value, BUCKET.NET_SALES_REPLACEMENT);

        } else if (replState === 'unsettled') {
          // سطر بديل من دورة لسه مفتوحة → مربع 3 / 6
          let bucket;
          if (stage === 'PREP')         bucket = BUCKET.IP_EXCHANGE_PREP;
          else if (stage === 'SHIPPED') bucket = BUCKET.IP_EXCHANGE_SHIPPED;
          else                          bucket = BUCKET.IP_UNCLASSIFIED;

          addIP(bucket, value);
          let note = null;
          if (bucket in EXPECT_FULFILLED && EXPECT_FULFILLED[bucket] !== fulfilled) {
            note = NOTE.FULFIL_MISM; warnings.fulfilmentMismatch++;
          }
          pushRow(rows, ctx, li, C, value, bucket, note);

        } else if (s1Val === S1.DELIVERED) {
          // مُسلَّم فعلاً ومفيش أي دورة مفتوحة على السطر ده → صافي مبيعات
          b.netSales += value;
          pushRow(rows, ctx, li, C, value, BUCKET.NET_SALES_NORMAL);

        } else {
          // مربع 1 / 2 / 5 / 8
          const bucket = normalBucket(s1Val);
          addIP(bucket, value);

          let note = null;
          if (bucket === BUCKET.IP_CONFIRMED_PREP && s1Val === S1.READY && fulfilled) {
            // lifecycle Rule 5 — Ready + Fulfilled = محاولة تسليم مكررة، مش خطأ.
            // قرار Ahmed 03-08-2026: تفضل هنا مؤقتاً لحد ما يتقرر مربع مستقل.
            note = NOTE.REDELIVERY; warnings.redelivery++;
          } else if (bucket in EXPECT_FULFILLED && EXPECT_FULFILLED[bucket] !== fulfilled) {
            note = NOTE.FULFIL_MISM; warnings.fulfilmentMismatch++;
          }
          pushRow(rows, ctx, li, C, value, bucket, note);
        }
      }
    }
  }

  return { boxes: b, rows, warnings };
}

// ══════════════════════════════════════════════════════
// §AGGREGATE-ORDERS — v2.0.0 — مستوى الأوردر بالكامل (عدّ، مش فلوس)
// صفحة "الأوردرات" الجديدة. مستقلة تمامًا عن computeBoxes فوق، لكن بتستهلك
// نفس stage1Orders/stage2Map — صفر نداء GraphQL إضافي.
// ══════════════════════════════════════════════════════

// §AGGREGATE-ORDERS::classifyOrderForCounts — يعيد bucket واحد بالظبط لكل أوردر
// Data Contract "صفحة الأوردرات" v1 — معتمد 03-08-2026.
// ⚠️ الإلغاء/RTO من isCancelledOrRTO() الموجودة (cancelledAt) — مش manual_status
//    — نفس قرار §4.1، عشان نتجنب باج #49472 القديم (تفصيل في هيدر الملف).
// v2.1.0: بدون أي تغيير في الدالة دي نفسها — بتستفيد تلقائيًا من إصلاح
//    stageFromS2() فوق (S2='Returned' بقت SHIPPED بدل null).
function classifyOrderForCounts(order, stage2Order) {
  const shortCircuit = isCancelledOrRTO(order);
  if (shortCircuit === 'RTO')       return ORDER_BUCKET.LOST_RTO;
  if (shortCircuit === 'CANCELLED') return ORDER_BUCKET.LOST_CANCELLED;

  const s1 = order.s1?.value || null;
  const s2 = order.s2?.value || null;
  const lineItems = order.lineItems?.nodes || [];
  const sumC = lineItems.reduce((s, li) => s + (li.currentQuantity || 0), 0);

  // نفس منطق تجاهل الدورات الملغية (RETURN_IGNORED) وتعريف "مفتوحة" (isOpenReturn)
  // المستخدمين في computeBoxes — مصدر واحد للحقيقة.
  const returns = (stage2Order?.returns?.nodes || []).filter(r => !RETURN_IGNORED.includes(r.status));
  const hasExchange      = returns.some(r => (r.exchangeLineItems?.nodes || []).length > 0);
  // "مُسوّاة" = نفس شرط §4.2 بالظبط: status=CLOSED **و** S2 وصل فيزيائيًا In-Return/Returned
  const hasSettledClosed = returns.some(r => r.status === 'CLOSED' && (s2 === 'In-Return' || s2 === 'Returned'));

  // ─── S1 = Delivered (terminal) — كل نشاط R/E بعد كده يتقرأ من S2 ───
  if (s1 === S1.DELIVERED) {
    if (!s2) return ORDER_BUCKET.DELIVERY_BASIC; // تسليم أساسي — مفيش أي نشاط R/E

    const stage = stageFromS2(s2); // 'PREP' | 'SHIPPED' | null

    // دورة لسه مفتوحة فيزيائيًا (مش مُسوّاة) → تصنيف حسب مرحلتها ونوعها
    if (stage && !hasSettledClosed) {
      if (stage === 'PREP') return hasExchange ? ORDER_BUCKET.PREP_EXCHANGE : ORDER_BUCKET.PREP_RETURN;
      return                       hasExchange ? ORDER_BUCKET.SHIPPED_EXCHANGE : ORDER_BUCKET.SHIPPED_RETURN;
    }

    // دورة مُسوّاة (S2 = Returned + status CLOSED) — النتيجة النهائية
    if (s2 === 'Returned' && hasSettledClosed) {
      if (!hasExchange && sumC === 0) return ORDER_BUCKET.LOST_FULL_RETURN;        // مرتجع كامل بعد الاستلام
      if (hasExchange  && sumC > 0)   return ORDER_BUCKET.DELIVERY_EXCHANGE;       // تسليم + استبدال
      if (!hasExchange && sumC > 0)   return ORDER_BUCKET.DELIVERY_PARTIAL_RETURN; // تسليم + استرجاع جزئي
    }

    // s2 موجود بقيمة غير متوقعة، أو تعارض بين status و S2 — خارج التصنيف (نادر، للمراجعة)
    return ORDER_BUCKET.UNCLASSIFIED;
  }

  // ─── لسه قبل التسليم (مش ملغي/RTO) ───
  if (
    s1 === S1.NEW_ORDER || s1 === S1.PENDING_EDIT ||
    s1 === S1.WHATSAPP_CANCELLED || s1 === S1.WHATSAPP_CONFIRMED
  ) {
    return ORDER_BUCKET.PENDING_CONFIRM;
  }
  if (s1 === S1.SHIPPED || s1 === S1.IN_RETURN) return ORDER_BUCKET.SHIPPED_CONFIRMED;

  // S1 = Returned/Cancelled من غير حدث إلغاء فعلي في شوبيفاي → نفس منطق IP_UNCLASSIFIED
  if (s1 === S1.RETURNED || s1 === S1.CANCELLED) return ORDER_BUCKET.UNCLASSIFIED;

  // Confirmed · Confirmed + Edit · Ready · null → مؤكد (تحت التجهيز)
  return ORDER_BUCKET.PREP_CONFIRMED;
}

// §AGGREGATE-ORDERS::pushOrderRow — صف drill-down واحد لكل أوردر (مش لكل سطر/SKU)
function pushOrderRow(rows, order, bucket) {
  const lineItems = order.lineItems?.nodes || [];
  rows.push({
    orderId:          numericIdFromGid(order.id),
    orderName:        order.name || null,
    orderTotalPieces: lineItems.reduce((s, li) => s + (li.quantity || 0), 0),
    createdAt:        order.createdAt || null,
    s1:               order.s1?.value || null,
    s2:               order.s2?.value || null,
    bucket,
  });
}

// §AGGREGATE-ORDERS::computeOrderBoxes — القلب: بيرجع { orderBoxes, orderRows, orderWarnings }
function computeOrderBoxes(stage1Orders, stage2Map) {
  const ob = {
    totalOrders: 0,
    pendingConfirm: 0,
    prepConfirmed: 0, prepExchange: 0, prepReturn: 0,
    shippedConfirmed: 0, shippedExchange: 0, shippedReturn: 0,
    lostCancelled: 0, lostRTO: 0, lostFullReturn: 0,
    deliveryBasic: 0, deliveryExchange: 0, deliveryPartialReturn: 0,
    unclassified: 0,
  };
  const rows = [];
  const warnings = { unclassified: 0 };

  const FIELD = {
    [ORDER_BUCKET.PENDING_CONFIRM]:         'pendingConfirm',
    [ORDER_BUCKET.PREP_CONFIRMED]:          'prepConfirmed',
    [ORDER_BUCKET.PREP_EXCHANGE]:           'prepExchange',
    [ORDER_BUCKET.PREP_RETURN]:             'prepReturn',
    [ORDER_BUCKET.SHIPPED_CONFIRMED]:       'shippedConfirmed',
    [ORDER_BUCKET.SHIPPED_EXCHANGE]:        'shippedExchange',
    [ORDER_BUCKET.SHIPPED_RETURN]:          'shippedReturn',
    [ORDER_BUCKET.LOST_CANCELLED]:          'lostCancelled',
    [ORDER_BUCKET.LOST_RTO]:                'lostRTO',
    [ORDER_BUCKET.LOST_FULL_RETURN]:        'lostFullReturn',
    [ORDER_BUCKET.DELIVERY_BASIC]:          'deliveryBasic',
    [ORDER_BUCKET.DELIVERY_EXCHANGE]:       'deliveryExchange',
    [ORDER_BUCKET.DELIVERY_PARTIAL_RETURN]: 'deliveryPartialReturn',
    [ORDER_BUCKET.UNCLASSIFIED]:            'unclassified',
  };

  for (const order of stage1Orders) {
    const stage2Order = stage2Map.get(order.id);
    const bucket = classifyOrderForCounts(order, stage2Order);

    ob.totalOrders++;
    ob[FIELD[bucket]]++;
    if (bucket === ORDER_BUCKET.UNCLASSIFIED) warnings.unclassified++;

    pushOrderRow(rows, order, bucket);
  }

  return { orderBoxes: ob, orderRows: rows, orderWarnings: warnings };
}

// ══════════════════════════════════════════════════════
// §CACHE — KV فقط، أبداً D1 (dashboard-builder Rule 2)
// ══════════════════════════════════════════════════════
const dataKey = (f, t) => `dash:${TOOL_NAME}:${CACHE_VERSION}:data:${f}:${t}`;
const metaKey = (f, t) => `dash:${TOOL_NAME}:${CACHE_VERSION}:meta:${f}:${t}`;

// نطاق مغلق (dateTo قبل النهاردة) = دائم · نطاق مفتوح = 15 دقيقة (dashboard-builder Rule)
function cacheTtlFor(dateTo) {
  const today = new Date().toISOString().slice(0, 10);
  return dateTo < today ? null : 900;
}

// حد Cloudflare KV لحجم القيمة الواحدة — 25 ميجابايت. لو تعدّاه الـ put بيفشل
// بصمت (أو برسالة KV مش واضحة) والداشبورد بيفضل يحاول يجيب من كاش مش موجود
// أصلاً. الحارس ده بيحوّل الفشل لرسالة واضحة بدل ما يتقفّى وراه لاحقًا.
const MAX_CACHE_BYTES = 25 * 1024 * 1024;

async function readCache(env, key) {
  const raw = await env.DASH_KV.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function writeCache(env, key, dateTo, payload) {
  const ttl  = cacheTtlFor(dateTo);
  const opts = ttl ? { expirationTtl: ttl } : {};
  const lastUpdated = new Date().toISOString();
  const body = JSON.stringify({ ...payload, lastUpdated });

  const bodyBytes = new TextEncoder().encode(body).length;
  if (bodyBytes > MAX_CACHE_BYTES) {
    throw fail(
      'cache_write',
      'حجم بيانات الفترة أكبر من حد الكاش (25MB) — قصّر الفترة وحاول تاني',
      `writeCache payload ${bodyBytes} bytes > MAX_CACHE_BYTES ${MAX_CACHE_BYTES} for key ${key}`
    );
  }

  await env.DASH_KV.put(key, body, opts);
  return lastUpdated;
}

// ══════════════════════════════════════════════════════════════════
// SHARED: Auth & Logging Functions — EcomModa D1 Pattern v1.3.0
// نسخة حرفية من ecommoda-worker-builder/references/shared-functions.md — ممنوع تتعدّل
// ══════════════════════════════════════════════════════════════════

async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;

  if (!row.is_active) {
    throw new Error('الحساب موقوف — تواصل مع المسؤول');
  }

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return {
    exists:   true,
    hasPin:   !!row.pin,
    isActive: !!row.is_active,
  };
}

async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

  return true;
}

async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

// ══════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    // OPTIONS preflight — دايماً أول حاجة
    if (request.method === 'OPTIONS') return corsPreflight();

    // §HANDLER::AUTH — WORKER_SECRET على كل الطلبات (بما فيها auth endpoints) —
    // تسجيل دخول الموظف (D1) طبقة إضافية فوق كده، مش بديل عنه
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader !== `Bearer ${env.WORKER_SECRET}`) {
      return json({ error: 'غير مصرح — WORKER_SECRET غلط أو ناقص' }, 401);
    }

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
      // ═══════════════════════════════════════════════════════════════
      // AUTH ENDPOINTS — نسخة حرفية من ecommoda-worker-builder/references/auth-endpoints.md
      // ═══════════════════════════════════════════════════════════════

      // ── check_employee — GET (no sensitive data — GET is ok) ──────
      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200);
      }

      // ── register_pin — POST (PIN in body — GET is FORBIDDEN) ──────
      if (action === 'register_pin') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200);
      }

      // ── verify_employee — POST (PIN in body — GET is FORBIDDEN) ───
      if (action === 'verify_employee') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400);

        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401);

        await writeLog(env.DB, {
          tool:     TOOL_NAME,
          type:     'login',
          employee: username,
          notes:    `دخول: ${displayName}`,
        });
        return json({ ok: true, displayName }, 200);
      }

      // ── log_logout — GET ok (no sensitive data) ───────────────────
      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        if (username) {
          await writeLog(env.DB, {
            tool:     TOOL_NAME,
            type:     'logout',
            employee: username,
            notes:    `خروج: ${username.replace(/_/g, ' ')}`,
          });
        }
        return json({ ok: true }, 200);
      }

      // ── get_employees — GET (for HTML dropdown) ───────────────────
      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200);
      }

      // ═══════════════════════════════════════════════════════════════
      // END AUTH ENDPOINTS BLOCK
      // ═══════════════════════════════════════════════════════════════

      // ─── §HANDLER::DATA ────────────────────────────────────
      if (action === 'get_data') {
        let body = {};
        if (request.method === 'POST') {
          try { body = await request.json(); } catch { body = {}; }
        }
        const dateFrom     = body.dateFrom || url.searchParams.get('dateFrom');
        const dateTo       = body.dateTo   || url.searchParams.get('dateTo');
        const forceRefresh = body.forceRefresh === true;

        if (!dateFrom || !dateTo) {
          return json({ error: 'محتاج dateFrom و dateTo', step: 'validation' }, 400);
        }

        const key = dataKey(dateFrom, dateTo);

        if (!forceRefresh) {
          const cached = await readCache(env, key);
          if (cached) return json({ ...cached, source: 'kv' });
        }

        const token = await getAccessToken(env);
        const stage1Orders = await fetchStage1(env, token, dateFrom, dateTo);
        const candidateIds = stage1Orders.filter(isCandidateForStage2).map(o => o.id);
        const stage2Map = candidateIds.length ? await fetchStage2(env, token, candidateIds) : new Map();

        // مستوى القطعة/الفلوس (صفحة "الرئيسية") — بدون أي تغيير
        const { boxes, rows, warnings } = computeBoxes(stage1Orders, stage2Map);
        // مستوى الأوردر/العدّ (صفحة "الأوردرات" — v2.0.0) — نفس البيانات، صفر نداء إضافي
        const { orderBoxes, orderRows, orderWarnings } = computeOrderBoxes(stage1Orders, stage2Map);

        const payload = {
          boxes, rows, warnings,
          orderBoxes, orderRows, orderWarnings,
          dateFrom, dateTo,
          ordersScanned:     stage1Orders.length,
          candidatesFetched: candidateIds.length,
        };
        const lastUpdated = await writeCache(env, key, dateTo, payload);
        await writeCache(env, metaKey(dateFrom, dateTo), dateTo, { ordersScanned: stage1Orders.length });

        // ✅ رجّع اللي جاي من fetch مباشرة — أبداً re-read من KV بعد الكتابة (eventual consistency)
        return json({ ...payload, lastUpdated, source: 'shopify' });
      }

      if (action === 'get_meta') {
        const dateFrom = url.searchParams.get('dateFrom');
        const dateTo   = url.searchParams.get('dateTo');
        if (!dateFrom || !dateTo) {
          return json({ error: 'محتاج dateFrom و dateTo', step: 'validation' }, 400);
        }
        const cached = await readCache(env, metaKey(dateFrom, dateTo));
        return json(cached || { ordersScanned: null, lastUpdated: null });
      }

      if (action === 'clear_cache') {
        const dateFrom = url.searchParams.get('dateFrom');
        const dateTo   = url.searchParams.get('dateTo');
        if (dateFrom && dateTo) {
          await env.DASH_KV.delete(dataKey(dateFrom, dateTo));
          await env.DASH_KV.delete(metaKey(dateFrom, dateTo));
          return json({ cleared: `${dateFrom}:${dateTo}` });
        }
        const list = await env.DASH_KV.list({ prefix: `dash:${TOOL_NAME}:` });
        for (const k of list.keys) await env.DASH_KV.delete(k.name);
        return json({ cleared: 'all', count: list.keys.length });
      }

      return json({ error: `Unknown action: ${action}` }, 400);
    } catch (e) {
      return json({
        error: e.message,
        step: e.step || 'unknown',
        technical: e.technical || null,
      }, 500);
    }
  },
};
