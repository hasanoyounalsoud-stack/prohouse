// ==================== وحدة تقرير الاستلام السريع للجوال (Fast Mobile Receiving Module) ====================

let currentReceivingDate = todayStr();
let currentReceivingBranch = "";
let currentReceivingData = {}; // itemId -> { received, notes, status, cookName }
let currentReceivingOrdered = {}; // itemId -> orderedQty from yesterday's production order
let isReceivingSaving = false;
let receivingActiveFilter = "all"; // 'all', 'unreceived', 'mismatch'
let receivingCollapsed = {};
let receivingNotesExpanded = {}; // itemId -> boolean

function initReceivingModule() {
  currentReceivingBranch = Branch.get() || allowedBranchList()[0] || "";
  currentReceivingDate = todayStr();
}

async function loadReceivingData(date, branch) {
  currentReceivingDate = date || currentReceivingDate;
  currentReceivingBranch = branch || Branch.get() || allowedBranchList()[0] || "";
  
  const view = document.getElementById("receivingView");
  if (view) view.innerHTML = '<div class="loader"><div class="spinner"></div> جاري تحميل بيانات تقرير الاستلام…</div>';

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
  
  if (receivedVal === "" || receivedVal === null || receivedVal === undefined) return "لم يصل";
  if (isNaN(rec) || rec === 0) return "لم يصل";
  if (isNaN(ord) || ord === 0) return rec > 0 ? "زائد" : "مكتمل";
  
  const diff = rec - ord;
  if (Math.abs(diff) < 0.01) return "مكتمل";
  if (diff < 0) return "ناقص";
  return "زائد";
}

function setReceivingFilter(filterName) {
  receivingActiveFilter = filterName;
  document.querySelectorAll(".rec-filter-chip").forEach(el => {
    el.classList.toggle("active", el.dataset.filter === filterName);
  });
  filterReceivingCardsUI();
}

function filterReceivingCardsUI() {
  document.querySelectorAll(".receiving-item-card").forEach(card => {
    const status = card.dataset.status;
    let visible = true;
    if (receivingActiveFilter === "unreceived") {
      visible = (status === "لم يصل");
    } else if (receivingActiveFilter === "mismatch") {
      visible = (status === "ناقص" || status === "زائد");
    }
    card.style.display = visible ? "" : "none";
  });

  // إخفاء التصنيفات الفارغة تلقائياً بحسب الفلتر
  document.querySelectorAll(".category-section").forEach(sec => {
    const visibleCards = sec.querySelectorAll('.receiving-item-card:not([style*="display: none"])');
    sec.style.display = visibleCards.length > 0 ? "" : "none";
  });
}

function renderReceivingView() {
  const view = document.getElementById("receivingView");
  if (!view) return;

  const items = Items.current;
  const branchList = allowedBranchList();
  
  if (!currentReceivingBranch && branchList.length > 0) {
    currentReceivingBranch = branchList[0];
  }

  // تجميع الإحصائيات
  let totalItemsCount = 0;
  let totalOrderedSum = 0;
  let totalReceivedSum = 0;
  let totalShortageCount = 0;
  let totalSurplusCount = 0;
  let unreceivedCount = 0;
  let matchedCount = 0;

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
    if (recData.received === "" || recData.received === null || isNaN(rec)) {
      unreceivedCount++;
    } else if (rec === 0 && ord > 0) {
      unreceivedCount++;
    } else if (Math.abs(diff) < 0.01) {
      matchedCount++;
    } else if (diff < 0) {
      totalShortageCount++;
    } else if (diff > 0) {
      totalSurplusCount++;
    }
  });

  let html = `
    <div class="receiving-mobile-header">
      <!-- شريط العنوان والفرع -->
      <div class="rec-top-row">
        <div>
          <h2 class="rec-main-title">📦 استلام الطلبية الصباحية</h2>
          <span class="rec-date-subtitle">📅 تاريخ: ${currentReceivingDate}</span>
        </div>
        <div class="branch-selector-wrap">
          ${Auth.isBranchStaff() || allowedBranchList().length <= 1 ? `
            <span class="badge neutral" style="font-size:13px;padding:6px 12px;font-weight:900;">🏪 ${currentReceivingBranch}</span>
          ` : `
            <select id="receivingBranchSelect" onchange="onReceivingBranchChange(this.value)">
              ${branchOptionsHtml(currentReceivingBranch)}
            </select>
          `}
        </div>
      </div>

      <!-- تنبيه مصدر الطلبية -->
      ${(() => {
        const orderedCount = Object.keys(currentReceivingOrdered || {}).length;
        return orderedCount > 0
          ? `<div class="rec-source-badge">📋 «المطلوب من المطبخ» مأخوذ من طلبية الأمس (${orderedCount} صنف).</div>`
          : `<div class="rec-source-badge warn">⚠️ لم تُسجل طلبية سابقة لهذا اليوم. يمكنك تسجيل المستلم يدوياً.</div>`;
      })()}

      <!-- بطاقات الإحصائيات السريعة -->
      <div class="rec-stats-row">
        <div class="rec-stat-pill">
          <span class="rec-stat-num">${totalItemsCount}</span>
          <span class="rec-stat-lbl">إجمالي الأصناف</span>
        </div>
        <div class="rec-stat-pill ok">
          <span class="rec-stat-num">${matchedCount}</span>
          <span class="rec-stat-lbl">مطابق</span>
        </div>
        <div class="rec-stat-pill warn">
          <span class="rec-stat-num">${totalShortageCount}</span>
          <span class="rec-stat-lbl">فيه نقص</span>
        </div>
        <div class="rec-stat-pill unrec">
          <span class="rec-stat-num">${unreceivedCount}</span>
          <span class="rec-stat-lbl">لم يستلم بعد</span>
        </div>
      </div>

      <!-- أزرار الإجراء السريع -->
      <div class="rec-quick-actions-bar">
        <button type="button" class="btn rec-match-all-btn" onclick="onMatchAllReceiving()">
          ⚡ استلام الكل مطابق للمطلوب
        </button>
        ${renderCompactToggleBtnHtml()}
      </div>

      <!-- فلاتر التركيز السريعة للجوال -->
      <div class="rec-filters-scroll">
        <button type="button" class="rec-filter-chip ${receivingActiveFilter === 'all' ? 'active' : ''}" data-filter="all" onclick="setReceivingFilter('all')">
          الكل (${totalItemsCount})
        </button>
        <button type="button" class="rec-filter-chip ${receivingActiveFilter === 'unreceived' ? 'active' : ''}" data-filter="unreceived" onclick="setReceivingFilter('unreceived')">
          ⏳ باقي لم يستلم (${unreceivedCount})
        </button>
        <button type="button" class="rec-filter-chip ${receivingActiveFilter === 'mismatch' ? 'active' : ''}" data-filter="mismatch" onclick="setReceivingFilter('mismatch')">
          ⚠️ فيه فرق / نقص (${totalShortageCount + totalSurplusCount})
        </button>
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

  const categories = Object.keys(byCat).sort((a, b) => categoryRank(a) - categoryRank(b));
  categories.forEach(cat => byCat[cat].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)));

  if (!categories.length) {
    html += `<div class="empty-state">لا توجد أصناف مسجلة لهذا الفرع.</div>`;
    view.innerHTML = html;
    return;
  }

  categories.forEach(cat => {
    const done = byCat[cat].filter(it => {
      const r = (currentReceivingData[it.id] || {}).received;
      return r !== "" && r !== null && r !== undefined;
    }).length;

    html += `
      <div class="category-section${receivingCollapsed[cat] ? " collapsed" : ""}" data-cat="${cat}">
        <div class="category-header" onclick="toggleReceivingCategory('${String(cat).replace(/'/g, "\\'")}')">
          <span class="cat-label">${categoryIconSticker(cat)} ${cat}</span>
          <span class="cat-count-badge">
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
      const hasValue = (rec !== "" && rec !== null && rec !== undefined);
      const diff = hasValue ? (recNum - ordNum) : null;
      const status = computeReceivingItemStatus(rec, ord);

      let badgeClass = "neutral";
      if (status === "مكتمل") badgeClass = "ok";
      if (status === "ناقص") badgeClass = "warn";
      if (status === "زائد") badgeClass = "surplus";
      if (status === "لم يصل") badgeClass = "neutral";

      const isWeight = isMealCategory(it.category) || (it.unit && (it.unit.includes("جرام") || it.unit.includes("جم") || it.unit.includes("كجم") || it.unit.includes("1/3") || it.unit.includes("1/2")));
      const notesExpanded = receivingNotesExpanded[it.id] || !!recData.notes;

      html += `
        <div class="item-card receiving-item-card" data-item-id="${it.id}" data-status="${status}">
          <!-- رأس الصنف -->
          <div class="rec-card-header">
            <div class="rec-item-title-wrap">
              <span class="rec-item-name">${it.name}</span>
              <span class="rec-item-unit">(${it.unit || "جرام"})</span>
            </div>
            <span class="badge ${badgeClass}">${status}</span>
          </div>

          <!-- شريط المطلوب من المطبخ -->
          <div class="rec-ordered-info-bar">
            <span>📋 المطلوب من المطبخ: <strong>${ord !== "" ? ord : "—"}</strong></span>
            ${isMealCategory(it.category) && ord ? `<span class="rec-ordered-meals">≈ ${mealsCount(ord)} وجبة</span>` : ""}
          </div>

          <!-- سطر الإدخال المخصص للجوال (Touch Input Row) -->
          <div class="rec-input-action-row">
            <div class="rec-input-wrapper">
              <input type="number" step="any" min="0" 
                     inputmode="decimal"
                     value="${rec}" 
                     placeholder="0"
                     id="recinput-${it.id}"
                     oninput="onReceivingInputChange('${it.id}', this.value)"
                     class="rec-main-input ${diff < 0 ? 'border-red' : (diff > 0 ? 'border-orange' : (hasValue ? 'border-green' : ''))}">
              <span class="rec-input-unit-label">${it.unit || "جم"}</span>
            </div>

            <!-- أزرار الإجراء السريع بلمسة واحدة -->
            <div class="rec-inline-btns">
              ${ord !== "" && ord > 0 ? `
                <button type="button" class="rec-btn-quick match" onclick="onQuickSetOrdered('${it.id}', ${ord})" title="مطابق للمطلوب">
                  = المطلوب
                </button>
              ` : ""}
              <button type="button" class="rec-btn-quick zero" onclick="onQuickSetZero('${it.id}')" title="لم يصل">
                لم يصل (0)
              </button>
            </div>
          </div>

          <!-- أزرار الزيادة السريعة المريحة للأوزان والأعداد (Stepper Chips) -->
          <div class="rec-stepper-chips-row">
            ${isWeight ? `
              <button type="button" class="rec-step-chip" onclick="onQuickIncrement('${it.id}', 100)">+100</button>
              <button type="button" class="rec-step-chip" onclick="onQuickIncrement('${it.id}', 500)">+500</button>
              <button type="button" class="rec-step-chip" onclick="onQuickIncrement('${it.id}', 1000)">+1 كجم</button>
              <button type="button" class="rec-step-chip" onclick="onQuickIncrement('${it.id}', 2000)">+2 كجم</button>
              <button type="button" class="rec-step-chip clear" onclick="onQuickClear('${it.id}')">✕ مسح</button>
            ` : `
              <button type="button" class="rec-step-chip" onclick="onQuickIncrement('${it.id}', 1)">+1</button>
              <button type="button" class="rec-step-chip" onclick="onQuickIncrement('${it.id}', 5)">+5</button>
              <button type="button" class="rec-step-chip" onclick="onQuickIncrement('${it.id}', 10)">+10</button>
              <button type="button" class="rec-step-chip minus" onclick="onQuickIncrement('${it.id}', -1)">-1</button>
              <button type="button" class="rec-step-chip clear" onclick="onQuickClear('${it.id}')">✕ مسح</button>
            `}
          </div>

          <!-- شريط الفروقات الحية وعدد الوجبات -->
          <div class="rec-live-diff-bar">
            ${diff !== null ? `
              <div class="rec-diff-text ${diff < 0 ? 'text-red' : (diff > 0 ? 'text-orange' : 'text-green')}">
                ${diff === 0 ? '✅ مطابق تماماً للمطلوب' : (diff < 0 ? `🔻 نقص: ${diff} ${it.unit || 'جم'}` : `🔺 زيادة: +${diff} ${it.unit || 'جم'}`)}
              </div>
            ` : '<div class="rec-diff-text text-muted">— لم يتم تسجيل الوزن بعد</div>'}

            ${isMealCategory(it.category) ? `
              <span class="rec-meal-calc" id="recmeals-${it.id}">🍽 الوجبات: ${mealsCount(rec) || "0"}</span>
            ` : ""}
          </div>

          <!-- زر وحقل الملاحظات الذكية -->
          <div class="rec-notes-toggle-wrap">
            <button type="button" class="rec-notes-btn ${recData.notes ? 'has-notes' : ''}" onclick="toggleReceivingNote('${it.id}')">
              📝 ${recData.notes ? 'تعديل الملاحظة' : 'إضافة ملاحظة'}
            </button>
          </div>

          <div class="rec-notes-container ${notesExpanded ? 'expanded' : 'hidden'}" id="recnotes-wrap-${it.id}">
            <input type="text" value="${recData.notes || ''}"
                   placeholder="اكتب ملاحظات الاستلام (نقص من المطبخ، تالف، تأخير...)"
                   id="recnote-input-${it.id}"
                   oninput="onReceivingNotesChange('${it.id}', this.value)"
                   class="rec-note-input">
          </div>
        </div>
      `;
    });

    html += `</div></div></div>`;
  });

  view.innerHTML = html;
  filterReceivingCardsUI();
}

// ---- وظائف التفاعل السريع للأوزان والأزرار ----

function onQuickSetOrdered(itemId, val) {
  if (!currentReceivingData[itemId]) currentReceivingData[itemId] = { received: "", notes: "", cookName: "" };
  currentReceivingData[itemId].received = String(val);
  const input = document.getElementById("recinput-" + itemId);
  if (input) input.value = val;
  updateReceivingItemCardUI(itemId);
  saveLocalDebounced();
}

function onQuickSetZero(itemId) {
  if (!currentReceivingData[itemId]) currentReceivingData[itemId] = { received: "", notes: "", cookName: "" };
  currentReceivingData[itemId].received = "0";
  const input = document.getElementById("recinput-" + itemId);
  if (input) input.value = "0";
  updateReceivingItemCardUI(itemId);
  saveLocalDebounced();
}

function onQuickClear(itemId) {
  if (!currentReceivingData[itemId]) currentReceivingData[itemId] = { received: "", notes: "", cookName: "" };
  currentReceivingData[itemId].received = "";
  const input = document.getElementById("recinput-" + itemId);
  if (input) input.value = "";
  updateReceivingItemCardUI(itemId);
  saveLocalDebounced();
}

function onQuickIncrement(itemId, amount) {
  if (!currentReceivingData[itemId]) currentReceivingData[itemId] = { received: "", notes: "", cookName: "" };
  const current = Number(currentReceivingData[itemId].received || 0);
  const nextVal = Math.max(0, current + amount);
  currentReceivingData[itemId].received = String(nextVal);
  const input = document.getElementById("recinput-" + itemId);
  if (input) input.value = nextVal;
  updateReceivingItemCardUI(itemId);
  saveLocalDebounced();
}

function toggleReceivingNote(itemId) {
  receivingNotesExpanded[itemId] = !receivingNotesExpanded[itemId];
  const el = document.getElementById("recnotes-wrap-" + itemId);
  if (el) {
    el.classList.toggle("hidden", !receivingNotesExpanded[itemId]);
    el.classList.toggle("expanded", !!receivingNotesExpanded[itemId]);
    if (receivingNotesExpanded[itemId]) {
      const inp = document.getElementById("recnote-input-" + itemId);
      if (inp) inp.focus();
    }
  }
}

function onMatchAllReceiving() {
  const items = Items.current;
  let count = 0;
  items.forEach(it => {
    const branches = itemBranches(it);
    if (branches.length && !branches.includes(currentReceivingBranch)) return;
    const ord = currentReceivingOrdered[it.id];
    if (ord !== undefined && ord !== null && ord !== "") {
      if (!currentReceivingData[it.id]) currentReceivingData[it.id] = { received: "", notes: "", cookName: "" };
      currentReceivingData[it.id].received = String(ord);
      count++;
    }
  });

  showToast(`⚡ تم نسخ الكميات المطلوبة لـ ${count} صنف بنجاح!`);
  renderReceivingView();
  saveLocalDebounced();
  updateSaveBarReceivingStatus();
}

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
  saveLocalDebounced();
  updateSaveBarReceivingStatus();
}

function onReceivingNotesChange(itemId, val) {
  if (!currentReceivingData[itemId]) currentReceivingData[itemId] = { received: "", notes: "", cookName: "" };
  currentReceivingData[itemId].notes = val;
  saveLocalDebounced();
  updateSaveBarReceivingStatus();
}

function updateReceivingItemCardUI(itemId) {
  const card = document.querySelector(`.receiving-item-card[data-item-id="${itemId}"]`);
  if (!card) return;

  const recVal = currentReceivingData[itemId]?.received;
  const ordVal = currentReceivingOrdered[itemId];
  const ordNum = Number(ordVal || 0);
  const recNum = Number(recVal || 0);
  const hasValue = (recVal !== "" && recVal !== null && recVal !== undefined);
  const diff = hasValue ? (recNum - ordNum) : null;
  const status = computeReceivingItemStatus(recVal, ordVal);

  card.dataset.status = status;

  // تحديث عدد الوجبات
  const mealsEl = document.getElementById("recmeals-" + itemId);
  if (mealsEl) mealsEl.textContent = "🍽 الوجبات: " + (mealsCount(recVal) || "0");
  updateReceivingCategoryCount(itemId);

  // تحديث الباج
  const badge = card.querySelector(".rec-card-header .badge");
  if (badge) {
    badge.textContent = status;
    badge.className = "badge " + (status === "مكتمل" ? "ok" : (status === "ناقص" ? "warn" : (status === "زائد" ? "surplus" : "neutral")));
  }

  // تحديث حدود الحقل
  const input = document.getElementById("recinput-" + itemId);
  if (input) {
    input.className = "rec-main-input " + (diff < 0 ? 'border-red' : (diff > 0 ? 'border-orange' : (hasValue ? 'border-green' : '')));
  }

  // تحديث سطر الفرق الملون
  const diffEl = card.querySelector(".rec-live-diff-bar .rec-diff-text");
  if (diffEl) {
    if (diff !== null) {
      diffEl.className = "rec-diff-text " + (diff < 0 ? 'text-red' : (diff > 0 ? 'text-orange' : 'text-green'));
      diffEl.innerHTML = diff === 0 ? '✅ مطابق تماماً للمطلوب' : (diff < 0 ? `🔻 نقص: ${diff}` : `🔺 زيادة: +${diff}`);
    } else {
      diffEl.className = "rec-diff-text text-muted";
      diffEl.textContent = "— لم يتم تسجيل الوزن بعد";
    }
  }
}

// حفظ محلي لحظي ذكي (Auto-Save Debounce) لضمان عدم ضياع أي حرف في الجوال
let saveLocalTimer = null;
function saveLocalDebounced() {
  clearTimeout(saveLocalTimer);
  saveLocalTimer = setTimeout(() => {
    const itemsPayload = [];
    Items.current.forEach(it => {
      const branches = itemBranches(it);
      if (branches.length && !branches.includes(currentReceivingBranch)) return;
      const data = currentReceivingData[it.id] || { received: "", notes: "" };
      const ord = currentReceivingOrdered[it.id] || 0;
      const rec = data.received;
      itemsPayload.push({
        itemId: it.id,
        itemName: it.name,
        unit: it.unit || "جرام",
        ordered: ord,
        received: rec,
        status: computeReceivingItemStatus(rec, ord),
        notes: data.notes || "",
        cookName: data.cookName || ""
      });
    });

    Sync.cacheSet("day:" + currentReceivingDate + ":" + currentReceivingBranch, { 
      date: currentReceivingDate, 
      branch: currentReceivingBranch, 
      items: itemsPayload 
    });
  }, 400);
}

function updateSaveBarReceivingStatus() {
  const statusEl = document.getElementById("receivingSaveStatus");
  if (statusEl) {
    statusEl.textContent = "لديك تعديلات بتقرير الاستلام جاهزة للحفظ السحابي";
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
