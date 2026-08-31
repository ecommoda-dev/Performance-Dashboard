// ══════════════════════════════════════════════════════════════════
// Performance Dashboard Worker — لوحة الأداء (v3.3.0).
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
//        ✅ اتقفلت في v3.1.0 تحت (G-13 خطوة أ + ب) — من غير Data Contract جديد:
//        returns[].createdAt/closedAt سكالر على نود بيتجاب أصلاً. الباقي المؤجّل
//        هو خطوة (ج) بس: orderCycleRows[] (classification-rules.md §9-ب).
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
// v3.1.0 (26-08-2026): دورات R/E المتعددة — gap G-13 خطوة (أ) + (ب).
//   القديم كان بيقرا تاريخ دورات الأوردر كأنه دورة واحدة، من بابين:
//   ① hasExchange = .some() على كل الدورات → دورة استبدال قديمة مقفولة بتخلي
//     إرجاع جديد يتقرا "استبدال"، وده بيقلب إشارة التوقّع (رجل مرتجع "بينجح"
//     = خسارة مش تسليم — dashboard-builder Rule 11-ب).
//   ② شرط التسوية s2 ∈ {In-Return, Returned} كان بيتطبّق على كل الدورات، و s2
//     قيمة واحدة على مستوى الأوردر بتوصف أحدث دورة بس → فتح دورة جديدة كان
//     بيلغي تسوية كل الدورات اللي قبلها **بأثر رجعي**.
//   التصحيح (order-lifecycle Rule 15 ② + Rule 7 · classification-rules §2-C):
//   - orderCycles() — مصدر واحد لفلترة وترتيب الدورات، بتستخدمه المكنتان.
//   - الفرع الانتقالي ("إيه اللي ماشي دلوقتي؟") → أحدث دورة بس.
//   - الفرع النهائي ("الأوردر ده شاف استبدال أصلاً؟") → .some() وده الصح.
//     ⚠️ التمييز ده مقصود: تطبيق "أحدث دورة" على الفرعين بيحرّك ٩ أوردرات بدل
//     واحد، تمنية منهم لمربع مش أصح من اللي هم فيه.
//   - computeBoxes(): التسوية بقت لكل دورة بفهرسها — أحدث دورة محتاجة الشرطين،
//     والدورة الأقدم CLOSED لوحده يكفيها.
//   - وسمان تشخيصيان (cycleNote): CYCLE_OVERLAP و MULTI_CYCLE — منفصلان،
//     وبيتعدّوا في warnings و orderWarnings. ⛔ الوسم مبيحركش ولا رقم (Rule 13).
//   الأثر المقيس على الـ ١١ أوردر متعدد الدورات في الريبو: أوردر واحد بس
//   اتحرّك (#50091: SHIPPED_EXCHANGE → SHIPPED_RETURN)، والباقي وسم بس.
//   CACHE_VERSION → v8 (شكل الصفوف + التصنيف الاتنين اتغيّروا).
//
// v3.2.0 (30-08-2026): مراجعة على أحدث نسخ المهارات — إصلاح كاسر واحد + إضافتين:
//   1. 🔴 كاسر — cacheTtlFor() كانت بترجع كاش دائم (null TTL) لأي فترة مقفولة،
//      وده صح للأحداث بس غلط للحالة (dashboard-builder v2.0.0 Step 3-أ/ج —
//      الأداة دي مذكورة بالاسم في الـ CHANGELOG كمرشّح مباشر). boxes/orderBoxes
//      هنا بتوصف حالة الأوردر الحالية (manual_status/status_2_r_e/bucket) —
//      أوردر اتعمل في شهر مقفول ممكن يتحرك Shipped→Delivered→Returned بعد ما
//      الشهر يتكاش، وكاش دائم كان بيخلّي الرقم يفضل واقف على الصورة القديمة
//      للأبد من غير أي خطأ ظاهر. اتبدلت بـ ttlFor() متدرّجة (900/21600/86400)،
//      عمرها ما ترجع null. CACHE_VERSION → v9 (عشان الفترات المقفولة المتكاشة
//      دائمًا قبل كده تتحرر وتتحسب بالـ TTL الجديد).
//   2. إضافة ?action=diag و ?action=get_config (worker-builder Step 5A ⑨ —
//      كانوا ناقصين). diag بيفحص المتغيّرات/الـ bindings/صلاحيات شوبيفاي/D1/KV
//      بدون أي كتابة وبدون عرض قيمة أي سر. get_config بيرجّع WORKER_VERSION
//      عشان الواجهة تقارنها وتحذّر لو مختلفة.
//   3. trailing-slash fix على SHOP_DOMAIN قبل كل نداء (worker-builder checklist).
//
// v3.3.0 (30-08-2026): دفعة إصلاحات من مراجعة docs/DATA-PULL-AND-CACHE.md قبل حذفه
//   (الملف كان بيوثّق سلوك قديم اتصلّح جزئيًا في v3.2.0 — البنود الباقية هنا):
//   1. 🔴 clear_cache (بدون dateFrom/dateTo) بقى بيلفّ على cursor بتاع
//      DASH_KV.list() بدل نداء واحد سقفه 1000 مفتاح — قبل كده كان بيمسح جزء
//      ويرجّع "cleared: all" (نجاح كاذب) لو عدد المفاتيح تعدّى الألف.
//   2. 🟠 MAX_CACHE_BYTES نزلت من 25MB (نفس حد KV بالظبط) لـ 24MB — هامش أمان.
//   3. 🟠 get_data/get_meta بقى فيهم فحص صيغة YYYY-MM-DD + dateFrom<=dateTo
//      (validateDateRange) — قبل كده '2026-8-1' كانت بتولّد مفتاح كاش مستقل
//      عن '2026-08-01' لنفس اليوم فعليًا.
//   4. 🟡 readCache() بقى فيه try/catch حوالين JSON.parse — قيمة KV تالفة
//      كانت بترمي 500 على كل نداء بدل ما ترجع null وتعيد السحب.
//   5. 🟡 getAccessToken() بقى بيكاش التوكن في نطاق الـ isolate (module-scope)
//      بدل نداء OAuth جديد في كل get_data/diag.
//   6. 🔴 ROWS_MAX_DAYS=45 — فترة أوسع من كده بترجع rows/orderRows فاضية +
//      rowsIncluded:false + rowsOmittedReason بدل ما تستنى دورة سحب كاملة
//      وتاخد خطأ 24MB في الآخر بصفر أرقام. boxes/orderBoxes فضلوا كاملين
//      دايمًا. CACHE_VERSION → v10 (شكل الـ payload اتغيّر).
//   ⚠️ الفترة السابقة (state.prevRows في الواجهة) اتسابت زي ما هي عمدًا —
//      مُستخدمة فعليًا في مقارنة وضع "عدد قطع" (activePrevBoxes)، مش بيانات
//      بتترمى زي ما كان متوقّع. التعديل الوحيد المرتبط بيها كان في الواجهة:
//      الجلب بقى تسلسلي مش متوازي (تجنّب تنافس throttle على cache miss بارد).
//
// v3.5.0 (30-08-2026): مراجعة كاملة على dashboard-builder v2.1.0 / html-builder
//   v2.1.0 / worker-builder v1.1.0 / constants v1.2.0 — التقسيم الشهري في
//   الواجهة والبنود اللي بتخصّ الـ Worker منه:
//   1. 🔴 **مسح كل `sleep` ثابت بين دفعات الجلب** — `sleep(1000)` بين صفحات
//      المرحلة 1 و`sleep(500)` بين دفعات المرحلة 2. القاعدة:
//      `ecommoda-dashboard-builder` v2.1.0 Step 5 («⛔ الاستثناء الوحيد
//      للجدول ده: sleep ثابت بين الدفعات») — النوم الثابت بيخلي مدة الطلب
//      **دالة في عدد الصفوف** مش في سرعة شوبيفاي: ٣ آلاف أوردر في الشهر =
//      ١٢ صفحة (١٢ ثانية نوم) + ~٣٠٠ مرشّح في ٣٠ دفعة (١٥ ثانية نوم) ≈ **٢٧
//      ثانية نوم مقصود لكل شهر**. الانتظار الوحيد المسموح هو backoff الـ
//      `THROTTLED` في `shopifyWithRetry` — وهو **بيستنى لما شوبيفاي تقول
//      استنى، وبس**. العلاج الهيكلي (التقسيم الشهري) اتنفّذ في الواجهة في
//      نفس التسليم، فعدد الصفوف في النداء الواحد بقى محدود بشهر.
//      ⚠️ سطر «ثانية بين الصفحات» في Data Contract v2.1.0 §6 اتعلّم عليه
//      كمنسوخ هناك — الثوابت المقفولة (LINE_ITEMS_PAGE/RETURNS_PAGE/...) ما
//      اتلمستش، ودي مش واحدة منهم.
//   2. `orderRows[]` بقى فيها `hasRE` (الأوردر ده كان مرشّح للمرحلة 2؟) —
//      من غيرها الواجهة مش قادرة تحسب سطر «كام أوردر فيه نشاط إرجاع/استبدال»
//      لأي **جزء** من الفترة المتكاشة. مع التقسيم الشهري الصفوف بتتفلتر على
//      أطراف الفترة في الواجهة، فأي رقم مجمّع جاي من الـ Worker (زي
//      `candidatesFetched`) بيوصف الشهر كله مش المعروض = رقم غلط شكله سليم.
//      → CACHE_VERSION v10 → **v11** (شكل الصف اتغيّر).
//   3. `get_meta` بقى بيرجّع `count` جنب `ordersScanned` — الاسم القياسي اللي
//      نمط الـ probe في `monthly-chunk-loading.md` بيقراه.
//   ⚠️ صفر تغيير في أي منطق تصنيف — `computeBoxes`/`computeOrderBoxes`/
//      `classifyOrderForCounts` ما اتلمسوش.
//
// skills: worker-builder v1.1.0 · constants v1.2.0 · dashboard-builder v2.1.0 ·
//         order-lifecycle v1.1.0 — 30-08-2026
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════
const TOOL_NAME     = 'performance_dashboard';
const WORKER_VERSION = 'v3.5.0'; // get_config بيرجّعها — الواجهة بتقارنها بـ TOOL_VERSION
const CACHE_VERSION = 'v11'; // v2(rows) → v3(buckets) → v4(fix assertion) → v5(+orderBoxes/orderRows) → v6(fix normalBucket + stageFromS2) → v7(RETURNS_PAGE 5→10, EXCHANGE_LINES_PAGE 10→20 — كانت بتوقف طلبات لأوردرات حقيقية) → v8(دورات R/E متعددة: قراءة أحدث دورة + حقل cycleNote في الصفوف) → v9(ttlFor متدرّج بدل كاش دائم على الفترات المقفولة — dashboard-builder v2.0.0) → v10(ROWS_MAX_DAYS: rows/orderRows بيتقصّوا فوق 45 يوم + rowsIncluded/rowsOmittedReason — boxes/orderBoxes فضلوا كاملين دايمًا) → v11(hasRE على كل صف أوردر — عشان الواجهة تحسب «كام أوردر فيه نشاط إرجاع/استبدال» لأي جزء من الفترة بعد التقسيم الشهري)

// الحدود دي منسوخة حرفياً من Data Contract v2 §6 — ممنوع تتغير من غير Data Contract جديد
const LINE_ITEMS_PAGE     = 25;   // lineItems(first: 25) — absolute max
const RETURNS_PAGE        = 10;    // returns(first: 10)
const RETURN_LINES_PAGE   = 25;   // returnLineItems(first: 25)
const EXCHANGE_LINES_PAGE = 20;   // exchangeLineItems(first: 20)
const STAGE1_PAGE_SIZE    = 250;  // orders(first: 250) — مرحلة 1
const STAGE2_BATCH_SIZE   = 10;   // نداءات nodes(ids:) — مرحلة 2، دفعات 10

// §CONSTANTS::ROWS_MAX_DAYS — سقف الصفوف التفصيلية (dashboard-builder anti-pattern:
// فترة طويلة قوي كانت بتستنى دورة سحب كاملة (دقيقة+) وفي الآخر تاخد خطأ 24MB
// وصفر أرقام. boxes/orderBoxes (الملخّصات) فضلوا كاملين دايمًا مهما كان طول
// الفترة — القص هنا على rows/orderRows (جدول التفاصيل) بس، ومُعلَن صراحةً عبر
// rowsIncluded/rowsOmittedReason بدل قص صامت.
const ROWS_MAX_DAYS = 45;
function daysBetweenStr(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}

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
  // §CYCLE — وسمان على مستوى الأوردر (مش السطر) — state-machines.md §2.4.
  // ⚠️ ممنوع دمجهم: بيروحوا لناس مختلفة. CYCLE_OVERLAP مخالفة تشغيلية بتتصلح
  // في شوبيفاي (خدمة العملاء)، و MULTI_CYCLE حد في الكود (مربع واحد مش كفاية
  // لدورتين — الحل النهائي orderCycleRows[] في classification-rules.md §9-ب).
  // تحذير مدموج بـ overlap بس بيمسك ١١% بس من الصفوف المحتاجة مراجعة.
  CYCLE_OVERLAP: 'CYCLE_OVERLAP', // دورة اتفتحت وسابقتها لسه مفتوحة (Rule 15 ①)
  MULTI_CYCLE:   'MULTI_CYCLE',   // دورتين متتاليتين شرعيتين — المربع ناقص مش غلط
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

// §HELPERS::validateDateRange — 'YYYY-MM-DD' فقط + from <= to. من غيره
// '2026-8-1' كانت بتعدّي، تروح لشوبيفاي، وتولّد مفتاح كاش مستقل عن '2026-08-01'
// لنفس اليوم فعليًا — نسختين محفوظتين، ومسح واحدة مابيمسحش التانية.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function validateDateRange(dateFrom, dateTo) {
  if (!ISO_DAY.test(dateFrom) || !ISO_DAY.test(dateTo)) {
    return 'صيغة التاريخ لازم تكون YYYY-MM-DD';
  }
  if (dateFrom > dateTo) {
    return 'تاريخ البداية بعد تاريخ النهاية';
  }
  return null;
}

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
// module-scope — بيعيش طول عمر الـ isolate (بيتصفّر على cold start، ده طبيعي
// ومقبول). التوكن مش مربوط بأي طلب معيّن، فمشاركته بين نداءات get_data/diag
// المتتالية على نفس الـ isolate آمنة. أولوية منخفضة أصلاً (subrequest واحد
// بس)، الهدف هنا تقليله مش ضمان صفر نداء OAuth.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const shopDomain = String(env.SHOP_DOMAIN || '').replace(/\/$/, '');
  const resp = await fetch(
    `https://${shopDomain}/admin/oauth/access_token`,
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

  // هامش أمان 5 دقايق قبل انتهاء الصلاحية الفعلية. لو Shopify ما رجّعتش
  // expires_in، هامش محافظ (10 دقايق) بدل ما نفترض توكن دائم.
  const ttlSeconds = Number(data.expires_in) > 0 ? Number(data.expires_in) : 600;
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max(ttlSeconds - 300, 60) * 1000;
  return cachedToken;
}

// ⚠️ حارس إلزامي (dashboard-builder — نمط resp.ok + JSON-parse + empty-data) —
// بدون الحارس ده أي فشل شبكة/انتهاء صلاحية توكن كان بيتحوّل لـ "نجاح صامت" ببيانات
// فاضية (undefined.data يمرّ من هنا لحد fetchStage1/fetchStage2 اللي بترمي برسالة
// مضلّلة "Shopify لم يرجع بيانات" بدل السبب الحقيقي).
async function shopifyGQL(env, token, query, variables = {}) {
  const shopDomain = String(env.SHOP_DOMAIN || '').replace(/\/$/, '');
  const resp = await fetch(
    `https://${shopDomain}/admin/api/2026-01/graphql.json`,
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
    // ⛔ ممنوع أي sleep ثابت هنا (dashboard-builder v2.1.0 Step 5). النوم الثابت
    // بيخلي مدة الطلب دالة في **عدد الصفحات** مش في سرعة شوبيفاي، والانتظار
    // الوحيد المشروع هو backoff الـ THROTTLED جوه shopifyWithRetry — بيستنى
    // لما شوبيفاي تقول استنى وبس. (كان `await sleep(1000)` لحد v3.4.0.)
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
              name
              status
              createdAt
              closedAt
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

    // ⛔ نفس قاعدة fetchStage1 — مفيش sleep ثابت بين الدفعات. دي بالظبط الحالة
    // اللي dashboard-builder v2.1.0 Step 5 بتسمّيها بالاسم (دفعات ١٠ + ٥٠٠ms).
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

// §AGGREGATE::orderCycles — دورات الـ R/E الفعّالة للأوردر، مرتّبة زمنيًا
// المصدر الوحيد لترتيب الدورات — المكنتان (الفلوس والعدّ) لازم تستخدما نفس
// الترتيب، وإلا "أحدث دورة" بتبقى دورتين مختلفتين في نفس الطلب.
// ⚠️ الفلترة قبل الترتيب إجباري: دورة CANCELED/DECLINED بـ closedAt = null
//    بتفبرك تداخل كاذب لو فضلت في المصفوفة (state-machines.md §2.4).
// ⚠️ ممنوع الاعتماد على ترتيب المصفوفة الراجعة من شوبيفاي — createdAt هو الترتيب.
function orderCycles(stage2Order) {
  return (stage2Order?.returns?.nodes || [])
    .filter(r => !RETURN_IGNORED.includes(r.status))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

// §AGGREGATE::cycleNote — وسم تشخيصي على مستوى الأوردر (مش بيغيّر أي مربع أبدًا)
// بيرجع CYCLE_OVERLAP (مخالفة قاعدة "دورة مفتوحة واحدة" — Rule 15 ①) أو
// MULTI_CYCLE (دورات متتالية شرعية، بس المربع الواحد مش بيوصف غير أحدثها) أو null.
// closedAt فاضية ⇒ ∞: دورة لسه مفتوحة وبعدها دورة تانية = تداخل من غير أي مقارنة.
function cycleNote(cycles) {
  if (cycles.length < 2) return null;
  const overlap = cycles.some((c, i) =>
    i > 0 && (!cycles[i - 1].closedAt || c.createdAt < cycles[i - 1].closedAt));
  return overlap ? NOTE.CYCLE_OVERLAP : NOTE.MULTI_CYCLE;
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
    // §CYCLE — حقل منفصل عن note عن قصد: note تشخيص السطر (FULFIL_MISM/REDELIVERY)
    // و cycleNote تشخيص الأوردر. الفصل بيمنع الوسم الجديد من إخفاء القديم،
    // وبيخلي العرض يقدر يفصل الوسمين زي ما القاعدة بتطلب.
    cycleNote:        ctx.cycleNote,
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
  // ⚠️ cycleOverlap/multiCycle بيتعدّوا مرة واحدة لكل **أوردر** (مش لكل صف) —
  // خاصية على مستوى الأوردر، وبالتالي الرقم هنا لازم يطابق نظيره في orderWarnings.
  const warnings = { fulfilmentMismatch: 0, redelivery: 0, unclassified: 0, cycleOverlap: 0, multiCycle: 0 };

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

    // §CYCLE — نفس الهيلبر المشترك المستخدم في مكنة العدّ (ترتيب واحد للمكنتين)
    const cycles   = orderCycles(stage2Map.get(order.id));
    const cycNote  = cycleNote(cycles);
    if (cycNote === NOTE.CYCLE_OVERLAP) warnings.cycleOverlap++;
    else if (cycNote === NOTE.MULTI_CYCLE) warnings.multiCycle++;

    const ctx = {
      orderId:          numericIdFromGid(order.id),
      orderName:        order.name || null,
      orderTotalPieces: lineItems.reduce((s, li) => s + (li.quantity || 0), 0),
      createdAt:        order.createdAt || null,
      s1: s1Val,
      s2: s2Val,
      cycleNote:        cycNote,
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

    // §4.2 + §4.3 — تسوية الدورات وربط الأسطر تراكمياً بالكمية (مش one-to-one)
    const settledByLineId     = new Map(); // lineId -> { finalQty, exchangeQty }
    const unsettledByLineId   = new Map(); // lineId -> qty (دورة مفتوحة على السطر الأصلي)
    const replacementByLineId = new Map(); // lineId -> 'settled' | 'unsettled' (سطر البديل)

    // ⚠️ اللفّة على cycles (مفلترة + مرتّبة) مش على المصفوفة الخام — الترتيب
    //    load-bearing هنا لأن نطاق شرط الـ s2 بيعتمد على الفهرس.
    const lastIdx = cycles.length - 1;

    cycles.forEach((ret, i) => {
      // §4.2 — نطاق شرط الـ s2 = أحدث دورة بس (lifecycle Rule 7):
      //   أحدث دورة  → CLOSED **و** s2 وصل فيزيائيًا (In-Return/Returned)
      //   دورة أقدم  → CLOSED لوحده يكفي
      // s2 قيمة واحدة على مستوى الأوردر بتوصف أحدث دورة بس؛ تطبيقها على دورة
      // أقدم بيلغي تسويتها **بأثر رجعي** أول ما دورة جديدة تتفتح — وده بالظبط
      // اللي كان بيرمي ٣٬٥٠٠ من ٤٬٧٥٠ في الكارت الغلط على #50091.
      const isSettled = ret.status === 'CLOSED'
                     && (i < lastIdx || s2Val === 'In-Return' || s2Val === 'Returned');
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
    });

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

  // §CYCLE — نفس الهيلبر المشترك المستخدم في computeBoxes (ترتيب واحد للمكنتين)
  const cycles  = orderCycles(stage2Order);
  const current = cycles[cycles.length - 1] || null;

  // "هل الأوردر نهائي؟" — أحدث دورة لوحدها بتجاوب. دورة قديمة مسوّاة مينفعش
  // تخلي الأوردر نهائي وفيه دورة أحدث لسه مفتوحة (lifecycle Rule 7).
  const currentSettled = current
    ? current.status === 'CLOSED' && (s2 === 'In-Return' || s2 === 'Returned')
    : false;

  // 🔴 السؤالان مختلفان — والخلط بينهم هو الفخ كله (Rule 15 ② · §2-C):
  //   الفرع الانتقالي "إيه اللي ماشي دلوقتي؟"  → أحدث دورة بس
  //   الفرع النهائي   "الأوردر ده شاف استبدال؟" → .some() على كل الدورات، وده الصح
  // تطبيق "أحدث دورة" على الفرعين بيحرّك ٩ أوردرات بدل واحد — تمنية منهم
  // لمربع مش أصح من اللي هم فيه (مقيس 26-08-2026).
  const currentIsExchange = (current?.exchangeLineItems?.nodes || []).length > 0;
  const everExchange      = cycles.some(c => (c.exchangeLineItems?.nodes || []).length > 0);

  // ─── S1 = Delivered (terminal) — كل نشاط R/E بعد كده يتقرأ من S2 ───
  if (s1 === S1.DELIVERED) {
    if (!s2) return ORDER_BUCKET.DELIVERY_BASIC; // تسليم أساسي — مفيش أي نشاط R/E

    const stage = stageFromS2(s2); // 'PREP' | 'SHIPPED' | null

    // ─── الفرع الانتقالي: دورة لسه ماشية → نوعها ومرحلتها من أحدث دورة بس ───
    if (stage && !currentSettled) {
      if (stage === 'PREP') return currentIsExchange ? ORDER_BUCKET.PREP_EXCHANGE : ORDER_BUCKET.PREP_RETURN;
      return                       currentIsExchange ? ORDER_BUCKET.SHIPPED_EXCHANGE : ORDER_BUCKET.SHIPPED_RETURN;
    }

    // ─── الفرع النهائي: المربع ملخّص لتاريخ الأوردر → .some() هو الصح هنا ───
    if (s2 === 'Returned' && currentSettled) {
      if (!everExchange && sumC === 0) return ORDER_BUCKET.LOST_FULL_RETURN;        // مرتجع كامل بعد الاستلام
      if ( everExchange && sumC > 0)   return ORDER_BUCKET.DELIVERY_EXCHANGE;       // تسليم + استبدال
      if (!everExchange && sumC > 0)   return ORDER_BUCKET.DELIVERY_PARTIAL_RETURN; // تسليم + استرجاع جزئي
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
function pushOrderRow(rows, order, bucket, cycNote = null, hasRE = false) {
  const lineItems = order.lineItems?.nodes || [];
  rows.push({
    orderId:          numericIdFromGid(order.id),
    orderName:        order.name || null,
    orderTotalPieces: lineItems.reduce((s, li) => s + (li.quantity || 0), 0),
    createdAt:        order.createdAt || null,
    s1:               order.s1?.value || null,
    s2:               order.s2?.value || null,
    bucket,
    // §CYCLE — تشخيص، مش تصنيف: الصف بيفضل في مربعه (Rule 13)
    cycleNote:        cycNote,
    // v3.5.0 — الأوردر ده كان مرشّح للمرحلة 2 (فيه نشاط إرجاع/استبدال)؟
    // ⚠️ على الصف عن قصد، مش رقم مجمّع في الـ payload: بعد التقسيم الشهري
    // الواجهة بتفلتر أطراف الفترة بـ createdAt، فأي رقم مجمّع بيوصف الشهر
    // كامل مش المعروض — رقم غلط شكله سليم. من الصف بيتحسب لأي جزء صح.
    hasRE:            !!hasRE,
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
  // ⚠️ cycleOverlap/multiCycle خاصية على مستوى الأوردر — الرقم هنا لازم يطابق
  //    نظيره في warnings بتاعة computeBoxes (نفس الأوردرات، نفس الهيلبر).
  const warnings = { unclassified: 0, cycleOverlap: 0, multiCycle: 0 };

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

    // §CYCLE — الوسم بيتحسب لكل أوردر مهما كان مربعه (حتى الملغي/RTO) عشان
    // الرقم يطابق نظيره في computeBoxes، واللي بيوسم كل أوردر كذلك.
    const cycNote = cycleNote(orderCycles(stage2Order));
    if (cycNote === NOTE.CYCLE_OVERLAP) warnings.cycleOverlap++;
    else if (cycNote === NOTE.MULTI_CYCLE) warnings.multiCycle++;

    ob.totalOrders++;
    ob[FIELD[bucket]]++;
    if (bucket === ORDER_BUCKET.UNCLASSIFIED) warnings.unclassified++;

    pushOrderRow(rows, order, bucket, cycNote, isCandidateForStage2(order));
  }

  return { orderBoxes: ob, orderRows: rows, orderWarnings: warnings };
}

// ══════════════════════════════════════════════════════
// §CACHE — KV فقط، أبداً D1 (dashboard-builder Rule 2)
// ══════════════════════════════════════════════════════
const dataKey = (f, t) => `dash:${TOOL_NAME}:${CACHE_VERSION}:data:${f}:${t}`;
const metaKey = (f, t) => `dash:${TOOL_NAME}:${CACHE_VERSION}:meta:${f}:${t}`;

// §CACHE::ttlFor — الصفوف هنا state payload مش event payload: boxes/orderBoxes
// بتوصف حالة الأوردر الحالية (manual_status/status_2_r_e/bucket)، وأوردر اتعمل
// في فترة مقفولة ممكن يتحرك Shipped→Delivered→Returned بعد ما الفترة تتكاش.
// عمرها ما ترجع null (dashboard-builder v2.0.0 Step 3-ج) — كاش دائم هنا معناه
// رقم قديم يفضل يرندر سليم للأبد من غير أي خطأ ظاهر.
const TTL_OPEN    = 900;    // الفترة فيها النهارده — ١٥ دقيقة
const TTL_RECENT  = 21600;  // قفلت من ٤٥ يوم أو أقل — ٦ ساعات (لسه فيها حركة)
const TTL_SETTLED = 86400;  // أقدم من ٤٥ يوم — ٢٤ ساعة (الحركة نادرة، مش مستحيلة)
const RECENT_DAYS = 45;

function ttlFor(dateTo) {
  const today = new Date().toISOString().slice(0, 10);
  if (dateTo >= today) return TTL_OPEN;
  const ageDays = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dateTo}T00:00:00Z`)) / 86400000
  );
  return ageDays <= RECENT_DAYS ? TTL_RECENT : TTL_SETTLED;
}

// حد Cloudflare KV لحجم القيمة الواحدة — 25 ميجابايت بالظبط. لو الحارس بيسمح
// بحمولة على الحد ده تمامًا، KV نفسها بترفضها بعد كده — فالحد هنا 24MB عشان
// يفشل هو الأول برسالة واضحة، مش KV برسالة مش واضحة على حافة الحد.
const MAX_CACHE_BYTES = 24 * 1024 * 1024;

async function readCache(env, key) {
  const raw = await env.DASH_KV.get(key);
  if (!raw) return null;
  // ⚠️ قيمة KV تالفة (نادر، بس ممكن) كانت بتفجّر JSON.parse → 500 على كل نداء
  // لحد ما حد يمسح المفتاح يدويًا. هنا بترجع null بدل كده → إعادة سحب طبيعية.
  try { return JSON.parse(raw); } catch { return null; }
}

async function writeCache(env, key, dateTo, payload) {
  const ttl  = ttlFor(dateTo);
  const opts = { expirationTtl: ttl };
  const lastUpdated = new Date().toISOString();
  const body = JSON.stringify({ ...payload, lastUpdated });

  const bodyBytes = new TextEncoder().encode(body).length;
  if (bodyBytes > MAX_CACHE_BYTES) {
    throw fail(
      'cache_write',
      'حجم بيانات الفترة أكبر من حد الكاش (24MB) — قصّر الفترة وحاول تاني',
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
        const dateErr = validateDateRange(dateFrom, dateTo);
        if (dateErr) return json({ error: dateErr, step: 'validation' }, 400);

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

        // §DATA::ROWS_MAX_DAYS — الملخّصات (boxes/orderBoxes) كاملة دايمًا؛ جدول
        // التفاصيل (rows/orderRows) بيتقصّ فوق 45 يوم، ومُعلَن صراحةً بدل قص صامت.
        const rangeDays   = daysBetweenStr(dateFrom, dateTo);
        const includeRows = body.includeRows === true || rangeDays <= ROWS_MAX_DAYS;

        const payload = {
          boxes, orderBoxes, warnings, orderWarnings,
          rows:      includeRows ? rows      : [],
          orderRows: includeRows ? orderRows : [],
          rowsIncluded: includeRows,
          rowsOmittedReason: includeRows ? null
            : `الفترة ${rangeDays} يوم — جدول التفاصيل بيتحمّل حتى ${ROWS_MAX_DAYS} يوم. كل الملخّصات (boxes/orderBoxes) كاملة.`,
          dateFrom, dateTo,
          ordersScanned:     stage1Orders.length,
          candidatesFetched: candidateIds.length,
        };
        const lastUpdated = await writeCache(env, key, dateTo, payload);
        // `count` هو الاسم القياسي اللي probe الـ get_meta بيقراه
        // (html-builder monthly-chunk-loading.md §4) — `ordersScanned` باقي
        // معاه للتوافق مع أي قارئ قديم.
        await writeCache(env, metaKey(dateFrom, dateTo), dateTo, {
          ordersScanned: stage1Orders.length,
          count:         stage1Orders.length,
        });

        // ✅ رجّع اللي جاي من fetch مباشرة — أبداً re-read من KV بعد الكتابة (eventual consistency)
        return json({ ...payload, lastUpdated, source: 'shopify' });
      }

      if (action === 'get_meta') {
        const dateFrom = url.searchParams.get('dateFrom');
        const dateTo   = url.searchParams.get('dateTo');
        if (!dateFrom || !dateTo) {
          return json({ error: 'محتاج dateFrom و dateTo', step: 'validation' }, 400);
        }
        const metaDateErr = validateDateRange(dateFrom, dateTo);
        if (metaDateErr) return json({ error: metaDateErr, step: 'validation' }, 400);
        const cached = await readCache(env, metaKey(dateFrom, dateTo));
        return json(cached || { ordersScanned: null, count: null, lastUpdated: null });
      }

      if (action === 'clear_cache') {
        const dateFrom = url.searchParams.get('dateFrom');
        const dateTo   = url.searchParams.get('dateTo');
        if (dateFrom && dateTo) {
          await env.DASH_KV.delete(dataKey(dateFrom, dateTo));
          await env.DASH_KV.delete(metaKey(dateFrom, dateTo));
          return json({ cleared: `${dateFrom}:${dateTo}` });
        }
        // ⚠️ list() سقفها 1000 مفتاح لكل نداء وبترجّع cursor للباقي — من غير
        // الحلقة دي، مفاتيح النطاقات المقفولة (اللي بره الألف الأولى) كانت
        // بتفضل، والرد "cleared: all" بيبقى نجاح كاذب.
        let cursor, count = 0;
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
      }

      // ─── §HANDLER::DIAG ────────────────────────────────────
      // worker-builder Step 5A ⑨ — إلزامي: diag + get_config
      if (action === 'get_config') {
        return json({ ok: true, workerVersion: WORKER_VERSION, cacheVersion: CACHE_VERSION }, 200);
      }

      if (action === 'diag') {
        // ⚠️ ممنوع عرض قيمة أي سر — أسماء وأطوال بس
        const secretKeys = ['WORKER_SECRET', 'CLIENT_ID', 'CLIENT_SECRET'];
        const varKeys    = ['SHOP_DOMAIN', 'LOCATION_ID'];
        const checks = [];

        for (const k of secretKeys) {
          const v = env[k];
          checks.push({ check: `env.${k}`, ok: !!v, detail: v ? `موجود (${String(v).length} حرف)` : 'ناقص' });
        }
        for (const k of varKeys) {
          const v = env[k];
          checks.push({ check: `env.${k}`, ok: !!v, detail: v ? String(v) : 'ناقص' });
        }
        checks.push({ check: 'DASH_KV binding', ok: !!env.DASH_KV, detail: env.DASH_KV ? 'موجود' : 'ناقص — get_data هيرمي على كل نداء' });
        checks.push({ check: 'DB binding (D1)',  ok: !!env.DB,      detail: env.DB      ? 'موجود' : 'ناقص — تسجيل الدخول هيفشل' });

        try {
          const token = await getAccessToken(env);
          const scopeData = await shopifyGQL(env, token, `{ currentAppInstallation { accessScopes { handle } } }`);
          const scopes = (scopeData.data?.currentAppInstallation?.accessScopes || []).map(s => s.handle);
          checks.push({ check: 'Shopify OAuth + صلاحيات التطبيق', ok: true, detail: scopes.join(', ') || 'مفيش scopes' });
        } catch (e) {
          checks.push({ check: 'Shopify OAuth + صلاحيات التطبيق', ok: false, detail: e.message });
        }

        try {
          await env.DB.prepare('SELECT 1').first();
          checks.push({ check: 'D1 query', ok: true, detail: 'تم' });
        } catch (e) {
          checks.push({ check: 'D1 query', ok: false, detail: e.message });
        }

        try {
          await env.DASH_KV.get('diag:ping');
          checks.push({ check: 'KV read', ok: true, detail: 'تم' });
        } catch (e) {
          checks.push({ check: 'KV read', ok: false, detail: e.message });
        }

        checks.push({ check: 'Origin', ok: true, detail: request.headers.get('Origin') || '(بدون)' });

        return json({ ok: checks.every(c => c.ok), workerVersion: WORKER_VERSION, checks }, 200);
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
