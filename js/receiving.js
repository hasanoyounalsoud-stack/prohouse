// ==================== وحدة تقرير الاستلام (Receiving Report Module) ====================

let currentReceivingDate = todayStr();
let currentReceivingBranch = "";
let currentReceivingData = {}; // itemId -> { received, notes, status, cookName }
let currentReceivingOrdered = {}; // itemId -> orderedQty from yesterday's production order
let isReceivingSaving = false;

function initReceivingModule() {
  currentReceivingBranch = Branch.get() || allowedBranchList()[0] || "";
  currentReceivingDate = todayStr();
}

async function loadReceivingData(date, branch) {
  currentReceivingDate = date || currentReceivingDate;
  currentReceivingBranch = branch || Branch.get() || allowedBranchList()[0] || "";
  
  const view = document.getElementById("receivingView");
  if (view) view.innerHTML = '<div class="loader">جاري تحميل بيانات تقرير الاستلام…</div>';

  await Items.load();

  // 1) جلب كمية الطلب المعتمدة ليوم date من طلبية أمس (T-1)
  const orderedMap = await loadRequestedQty(currentReceivingDate, currentReceivingBranch);
  currentReceivingOrdered = orderedMap || {};

  // 2) جلب السجل المحفوظ لهذا اليوم والفرع
  const dayData = await Sync.get("getDay", { date: currentReceivingDate, branch: currentReceivingBranch }, "day:" + currentReceivingDate + ":" + currentReceivingBranch);
  currentReceivingData = {};
  
  if (dayData && dayData.items) {
    dayData.items.forEach(it => {
      currentReceivingData[it.itemId] = {
        received: it.received !== undefined && it.received !== null ? String(it.received) : "",
        notes: it.notes || "",
        cookName: it.cookName || "",
        status: it.status || computeReceivingItemStatus(it.received, currentReceivingOrdered[it.itemId])
      };
    });
  }

  renderReceivingView();
}

function computeReceivingItemStatus(receivedVal, orderedVal) {
  const rec = Number(receivedVal);
  const ord = Number(orderedVal);
  
  if (receivedVal === "" || receivedVal === null || receivedVal === undefined) return " لم يصل";
  if (isNaN(rec) || rec === 0) return "لم يصل";
  if (isNaN(ord) || ord === 0) return rec > 0 ? "زائد" : "مكتمل";
  
  const diff = rec - ord;
  if (Math.abs(diff) < 0.01) return "مكتمل";
  if (diff < 0) return "ناقص";
  return "زائد";
}

function renderReceivingView() {
  const view = document.getElementById("receivingView");
  if (!view) return;

  const items = Items.current;
  const branchList = allowedBranchList();
  
  if (!currentReceivingBranch && branchList.length > 0) {
    currentReceivingBranch = branchList[0];
  }

  // تجميع الحسابات الإجمالية للتقارير والأزرار القيادية
  let totalItemsCount = 0;
  let totalOrderedSum = 0;
  let totalReceivedSum = 0;
  let totalShortageSum = 0;
  let totalSurplusSum = 0;
  let unreceivedCount = 0;

  items.forEach(it => {
    const branches = itemBranches(it);
    if (branches.length && !branches.includes(currentReceivingBranch)) return;

    totalItemsCount++;
    const ord = Number(currentReceivingOrdered[it.id] || 0);
    const recData = currentReceivingData[it.id] || {};
    const rec = Number(recData.received || 0);

    totalOrderedSum += ord;
    totalReceivedSum += rec;

    const diff = rec - ord;
    if (recData.received === "" || recData.received === null || rec === 0) {
      unreceivedCount++;
    } else if (diff < 0) {
      totalShortageSum += Math.abs(diff);
    } else if (diff > 0) {
      totalSurplusSum += diff;
    }
  });

  // كروت مؤشرات الأداء بأعلى الشاشة (KPI Summary Header)
  let html = `
    <div class="receiving-header-panel">
      <div class="receiving-title-row">
        <h2>📦 تقرير استلام الطلبية اليومية</h2>
        <div class="branch-selector-wrap">
          <label>الفرع:</label>
          <select id="receivingBranchSelect" onchange="onReceivingBranchChange(this.value)">
            ${branchOptionsHtml(currentReceivingBranch)}
          </select>
        </div>
      </div>

      ${(() => {
        // بدون هالسطر ما في شي بالشاشة بيقول من وين جاي "المطلوب من المطبخ".
        // الموظف بيعمل طلبية اليوم (محفوظة بتاريخ بكرا)، بيفتح الاستلام على اليوم،
        // بيشوف أرقام طلبية أمس، وبيفتكر إن طلبيته ضاعت.
        const orderedCount = Object.keys(currentReceivingOrdered || {}).length;
        return orderedCount
          ? `<div class="pin-note" style="margin:0 0 10px;">📋 «المطلوب من المطبخ» مأخوذ من طلبية <b>${currentReceivingDate}</b> — ${orderedCount} صنف.</div>`
          : `<div class="offline-banner" style="margin:0 0 10px;">ما في طلبية محفوظة لتاريخ <b>${currentReceivingDate}</b> بهذا الفرع. الطلبية اللي بتعملها اليوم بتنحفظ لتاريخ الغد وبتظهر هون بكرا.</div>`;
      })()}

      <div class="receiving-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-v">${totalItemsCount}</div>
          <div class="kpi-l">إجمالي الأصناف</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-v">${Math.round(totalOrderedSum)}</div>
          <div class="kpi-l">إجمالي المطلوب</div>
        </div>
        <div class="kpi-card ok">
          <div class="kpi-v">${Math.round(totalReceivedSum)}</div>
          <div class="kpi-l">إجمالي المستلم</div>
        </div>
        <div class="kpi-card warn">
          <div class="kpi-v">${Math.round(totalShortageSum)}</div>
          <div class="kpi-l">إجمالي النقص</div>
        </div>
        <div class="kpi-card surplus">
          <div class="kpi-v">${Math.round(totalSurplusSum)}</div>
          <div class="kpi-l">إجمالي الزيادة</div>
        </div>
        <div class="kpi-card neutral">
          <div class="kpi-v">${unreceivedCount}</div>
          <div class="kpi-l">أصناف لم تصل</div>
        </div>
      </div>
    </div>
  `;

  // تجميع الأصناف حسب التصنيف
  const byCat = {};
  items.forEach(it => {
    const branches = itemBranches(it);
    if (branches.length && !branches.includes(currentReceivingBranch)) return;
    const cat = it.category || "عام";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(it);
  });

  // الترتيب من شاشة الإعدادات (دجاج، لحم، بحري…) مو أبجدي — الأبجدي كان بيرفع "الحلويات"
  // لفوق ويخالف ترتيب المطبخ اللي الموظف متعوّد عليه بباقي الشاشات.
  const categories = Object.keys(byCat).sort((a, b) => categoryRank(a) - categoryRank(b));
  // وداخل كل تصنيف: ترتيب الأصناف المحفوظ بالكتالوج، مو ترتيب وصولها من الشيت
  categories.forEach(cat => byCat[cat].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)));

  if (!categories.length) {
    html += `<div class="empty-state">لا توجد أصناف مسجلة لهذا الفرع.</div>`;
    view.innerHTML = html;
    return;
  }

  categories.forEach(cat => {
    // تصنيف قابل للطي: بشاشة فيها 37 صنف، الموظف بده يفتح تصنيف واحد ويشتغل عليه
    // بدل ما يلف الشاشة كلها. نفس سلوك شاشة الاستلام القديمة اللي الموظفين متعوّدين عليه.
    const done = byCat[cat].filter(it => {
      const r = (currentReceivingData[it.id] || {}).received;
      return r !== "" && r !== null && r !== undefined;
    }).length;

    html += `
      <div class="category-section${receivingCollapsed[cat] ? " collapsed" : ""}" data-cat="${cat}">
        <div class="category-header" onclick="toggleReceivingCategory('${String(cat).replace(/'/g, "\\'")}')">
          <span class="cat-label">${categoryIconSticker(cat)} ${cat}</span>
          <span style="display:flex;align-items:center;">
            <span class="cat-count">${done}/${byCat[cat].length}</span>
            <span class="chevron">▾</span>
          </span>
        </div>
        <div class="category-body"><div>`;

    byCat[cat].forEach(it => {
      const ord = currentReceivingOrdered[it.id] !== undefined ? currentReceivingOrdered[it.id] : "";
      const recData = currentReceivingData[it.id] || { received: "", notes: "", cookName: "" };
      const rec = recData.received;
      
      const ordNum = Number(ord || 0);
      const recNum = Number(rec || 0);
      const diff = (rec !== "" && rec !== null) ? (recNum - ordNum) : null;
      const status = computeReceivingItemStatus(rec, ord);

      let badgeClass = "neutral";
      if (status === "مكتمل") badgeClass = "ok";
      if (status === "ناقص") badgeClass = "warn";
      if (status === "زائد") badgeClass = "surplus";
      if (status === "لم يصل") badgeClass = "neutral";

      html += `
        <div class="item-card receiving-item-card" data-item-id="${it.id}">
          <div class="item-header-row">
            <div>
              <span class="item-name">${it.name}</span>
              <span class="item-unit">(${it.unit || "جرام"})</span>
            </div>
            <span class="badge ${badgeClass}">${status}</span>
          </div>

          <div class="inputs-row">
            <div class="field">
              <label>المطلوب من المطبخ</label>
              <input type="text" value="${ord !== "" ? ord : "—"}" readonly class="readonly-input">
            </div>

            <div class="field">
              <label>المستلم الفعلي *</label>
              <input type="number" step="any" min="0" value="${rec}" 
                     placeholder="0"
                     oninput="onReceivingInputChange('${it.id}', this.value)"
                     class="receiving-input">
            </div>

            <div class="field">
              <label>الفرق الصافي</label>
              <input type="text" value="${diff !== null ? (diff > 0 ? '+' + diff : diff) : '—'}" 
                     readonly class="readonly-input ${diff < 0 ? 'text-red' : (diff > 0 ? 'text-orange' : 'text-green')}">
            </div>
          </div>

          ${isMealCategory(it.category) ? `
          <div class="badges" style="margin-top:0;">
            <span class="badge neutral" id="recmeals-${it.id}">🍽 عدد الوجبات: ${mealsCount(rec) || "—"}</span>
          </div>` : ""}

          <div class="notes-row">
            <input type="text" value="${recData.notes || ''}"
                   placeholder="ملاحظات الاستلام (مثال: نقص من المطبخ، صنف متأخر...)"
                   oninput="onReceivingNotesChange('${it.id}', this.value)">
          </div>
        </div>
      `;
    });

    html += `</div></div></div>`; // إغلاق category-body ← الغلاف الداخلي ← category-section
  });

  view.innerHTML = html;
}

// عدّاد "٣/٨" على رأس التصنيف — يتحدّث بدون إعادة رسم الشاشة كلها
function updateReceivingCategoryCount(itemId) {
  const item = Items.current.find(it => it.id === itemId);
  if (!item) return;
  const cat = item.category || "عام";
  const section = document.querySelector(`.category-section[data-cat="${cat}"]`);
  const counter = section && section.querySelector(".cat-count");
  if (!counter) return;

  const inCat = Items.current.filter(it => {
    if ((it.category || "عام") !== cat) return false;
    const b = itemBranches(it);
    return !b.length || b.includes(currentReceivingBranch);
  });
  const done = inCat.filter(it => {
    const r = (currentReceivingData[it.id] || {}).received;
    return r !== "" && r !== null && r !== undefined;
  }).length;
  counter.textContent = `${done}/${inCat.length}`;
}

// الحالة محفوظة برا دالة الرسم حتى التصنيفات المطوية تضل مطوية بعد كل إعادة رسم
let receivingCollapsed = {};
function toggleReceivingCategory(cat) {
  receivingCollapsed[cat] = !receivingCollapsed[cat];
  const section = document.querySelector(`.category-section[data-cat="${cat}"]`);
  if (section) section.classList.toggle("collapsed", !!receivingCollapsed[cat]);
}

function onReceivingBranchChange(branch) {
  Branch.set(branch);
  currentReceivingBranch = branch;
  loadReceivingData(currentReceivingDate, currentReceivingBranch);
}

function onReceivingInputChange(itemId, val) {
  if (!currentReceivingData[itemId]) currentReceivingData[itemId] = { received: "", notes: "", cookName: "" };
  currentReceivingData[itemId].received = val;
  updateReceivingItemCardUI(itemId);
  updateSaveBarReceivingStatus();
}

function onReceivingNotesChange(itemId, val) {
  if (!currentReceivingData[itemId]) currentReceivingData[itemId] = { received: "", notes: "", cookName: "" };
  currentReceivingData[itemId].notes = val;
  updateSaveBarReceivingStatus();
}

function updateReceivingItemCardUI(itemId) {
  const card = document.querySelector(`.receiving-item-card[data-item-id="${itemId}"]`);
  if (!card) return;

  const recVal = currentReceivingData[itemId]?.received;
  const ordVal = currentReceivingOrdered[itemId];
  const ordNum = Number(ordVal || 0);
  const recNum = Number(recVal || 0);
  const diff = (recVal !== "" && recVal !== null) ? (recNum - ordNum) : null;
  const status = computeReceivingItemStatus(recVal, ordVal);

  // عدد الوجبات وعدّاد التصنيف بيتحدثوا مع الكتابة — بدون هيك بيضلوا على القيمة الأولى
  // لحد ما تنعاد الشاشة كلها.
  const mealsEl = document.getElementById("recmeals-" + itemId);
  if (mealsEl) mealsEl.textContent = "🍽 عدد الوجبات: " + (mealsCount(recVal) || "—");
  updateReceivingCategoryCount(itemId);

  const badge = card.querySelector(".item-header-row .badge");
  if (badge) {
    badge.textContent = status;
    badge.className = "badge " + (status === "مكتمل" ? "ok" : (status === "ناقص" ? "warn" : (status === "زائد" ? "surplus" : "neutral")));
  }

  const diffInput = card.querySelectorAll(".readonly-input")[1];
  if (diffInput) {
    diffInput.value = diff !== null ? (diff > 0 ? '+' + diff : diff) : '—';
    diffInput.className = "readonly-input " + (diff < 0 ? 'text-red' : (diff > 0 ? 'text-orange' : 'text-green'));
  }
}

function updateSaveBarReceivingStatus() {
  const statusEl = document.getElementById("receivingSaveStatus");
  if (statusEl) {
    statusEl.textContent = "لديك تعديلات غير محفوظة بتقرير الاستلام";
    statusEl.classList.add("dirty");
  }
}

async function saveReceivingReportData() {
  if (isReceivingSaving) return;
  isReceivingSaving = true;

  const saveBtn = document.getElementById("receivingSaveBtn");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "جاري حفظ التقرير…"; }

  const itemsPayload = [];
  Items.current.forEach(it => {
    const branches = itemBranches(it);
    if (branches.length && !branches.includes(currentReceivingBranch)) return;

    const data = currentReceivingData[it.id] || { received: "", notes: "" };
    const ord = currentReceivingOrdered[it.id] || 0;
    const rec = data.received;
    const status = computeReceivingItemStatus(rec, ord);

    itemsPayload.push({
      itemId: it.id,
      itemName: it.name,
      unit: it.unit || "جرام",
      ordered: ord,
      received: rec,
      status: status,
      notes: data.notes || "",
      cookName: data.cookName || ""
    });
  });

  const emp = Auth.getEmployee();
  const payload = {
    date: currentReceivingDate,
    branch: currentReceivingBranch,
    employeeName: emp ? emp.name : "",
    items: itemsPayload,
    savedAt: new Date().toISOString()
  };

  // حفظ محلي فورياً الكاش والـ Sync queue
  Sync.cacheSet("day:" + currentReceivingDate + ":" + currentReceivingBranch, { date: currentReceivingDate, branch: currentReceivingBranch, items: itemsPayload });
  Sync.enqueue("saveDay:" + currentReceivingDate + ":" + currentReceivingBranch, "saveDay", payload);

  showToast("✅ تم حفظ تقرير الاستلام بنجاح!");

  const statusEl = document.getElementById("receivingSaveStatus");
  if (statusEl) {
    statusEl.textContent = "تم حفظ تقرير الاستلام بنجاح (" + new Date().toLocaleTimeString("ar-SA") + ")";
    statusEl.classList.remove("dirty");
  }

  setTimeout(() => {
    isReceivingSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 حفظ تقرير الاستلام"; }
  }, 1000);
}
