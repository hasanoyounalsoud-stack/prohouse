// ==================== وحدة تقرير الاستلام السريع للجوال (Fast Mobile Receiving Module) ====================

let currentReceivingDate = todayStr();
let currentReceivingBranch = "";
let currentReceivingData = {}; // itemId -> { received, notes, status, cookName }
let currentReceivingOrdered = {}; // itemId -> orderedQty from yesterday's production order
let currentReceivingExtraItems = []; // [{ id, name, unit, category, isCustom: true }]
let currentReceivingRemovedIds = new Set(); // set of removed item ids
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
  currentReceivingExtraItems = [];
  currentReceivingRemovedIds = new Set();
  
  if (dayData && dayData.items) {
    dayData.items.forEach(it => {
      currentReceivingData[it.itemId] = {
        received: it.received !== undefined && it.received !== null ? String(it.received) : "",
        notes: it.notes || "",
        cookName: it.cookName || "",
        status: it.status || computeReceivingItemStatus(it.received, currentReceivingOrdered[it.itemId])
      };

      const existingInCatalog = Items.current.some(catalogIt => catalogIt.id === it.itemId);
      if (!existingInCatalog && (it.isCustom || String(it.itemId).startsWith("custom_rec_") || it.itemName)) {
        currentReceivingExtraItems.push({
          id: it.itemId,
          name: it.itemName,
          unit: it.unit || "جرام",
          category: it.category || "عام",
          isCustom: true
        });
      }
    });

    if (Array.isArray(dayData.removedItemIds)) {
      dayData.removedItemIds.forEach(id => currentReceivingRemovedIds.add(id));
    }
  }

  renderReceivingView();
}

function getAllReceivingActiveItems() {
  const baseItems = Items.current.filter(it => {
    if (currentReceivingRemovedIds.has(it.id)) return false;
    const branches = itemBranches(it);
    return !branches.length || branches.includes(currentReceivingBranch);
  });

  const extraItems = currentReceivingExtraItems.filter(it => !currentReceivingRemovedIds.has(it.id));
  return [...baseItems, ...extraItems];
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

  const branchList = allowedBranchList();
  if (!currentReceivingBranch && branchList.length > 0) {
    currentReceivingBranch = branchList[0];
  }

  const items = getAllReceivingActiveItems();

  // تجميع الإحصائيات
  let totalItemsCount = 0;
  let totalOrderedSum = 0;
  let totalReceivedSum = 0;
  let totalShortageCount = 0;
  let totalSurplusCount = 0;
  let unreceivedCount = 0;
  let matchedCount = 0;

  items.forEach(it => {
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

      const isMeal = isMealCategory(it.category);
      const notesExpanded = receivingNotesExpanded[it.id] || !!recData.notes;

      html += `
        <div class="item-card receiving-item-card" data-item-id="${it.id}" data-status="${status}">
          <!-- سطر معلومات الصنف الموحد (اسم، مطلوب، فرق، وجبات، حالة وحذف) -->
          <div class="rec-card-header">
            <div class="rec-item-header-main">
              <span class="rec-item-name">${it.name}</span>
              <span class="rec-item-unit">(${it.unit || "جم"})</span>
              ${it.isCustom ? '<span class="badge ok rec-custom-badge">إضافي</span>' : ''}
              <span class="rec-meta-chip rec-req-chip" title="المطلوب من المطبخ">📋 طلب: <strong>${ord !== "" ? ord : "—"}</strong></span>
              <span class="rec-meta-chip rec-diff-chip ${diff < 0 ? 'diff-red' : (diff > 0 ? 'diff-orange' : (diff === 0 ? 'diff-green' : 'diff-gray'))}" id="recdiff-${it.id}">
                ${diff === null ? '—' : (diff === 0 ? '✅ مطابق' : (diff < 0 ? `🔻 ${diff}` : `🔺 +${diff}`))}
              </span>
              ${isMeal ? `<span class="rec-meta-chip rec-meal-chip" id="recmeals-${it.id}">🍽 ${mealsCount(rec) || "0"} وجبة</span>` : ""}
            </div>
            <div class="rec-item-header-actions">
              <span class="badge ${badgeClass}">${status}</span>
              <button type="button" class="rec-btn-remove" onclick="onRemoveReceivingItem('${it.id}', '${String(it.name).replace(/'/g, "\\'")}')" title="حذف الصنف من استلام اليوم">✕</button>
            </div>
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

    // زر إضافة صنف تحت كل قسم
    html += `
        <button type="button" class="rec-add-item-btn" onclick="openAddReceivingItemModal('${String(cat).replace(/'/g, "\\'")}')">
          ➕ إضافة صنف في قسم (${cat})
        </button>
      </div></div></div>`;
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
  const items = getAllReceivingActiveItems();
  let count = 0;
  items.forEach(it => {
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
  const allItems = getAllReceivingActiveItems();
  const item = allItems.find(it => it.id === itemId);
  if (!item) return;
  const cat = item.category || "عام";
  const section = document.querySelector(`.category-section[data-cat="${cat}"]`);
  const counter = section && section.querySelector(".cat-count");
  if (!counter) return;

  const inCat = allItems.filter(it => (it.category || "عام") === cat);
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
  if (mealsEl) mealsEl.textContent = "🍽 " + (mealsCount(recVal) || "0") + " وجبة";
  updateReceivingCategoryCount(itemId);

  // تحديث الباج
  const badge = card.querySelector(".rec-item-header-actions .badge:not(.ok), .rec-card-header .badge:not(.ok)");
  if (badge) {
    badge.textContent = status;
    badge.className = "badge " + (status === "مكتمل" ? "ok" : (status === "ناقص" ? "warn" : (status === "زائد" ? "surplus" : "neutral")));
  }

  // تحديث حدود الحقل
  const input = document.getElementById("recinput-" + itemId);
  if (input) {
    input.className = "rec-main-input " + (diff < 0 ? 'border-red' : (diff > 0 ? 'border-orange' : (hasValue ? 'border-green' : '')));
  }

  // تحديث شريحة الفرق
  const diffEl = document.getElementById("recdiff-" + itemId);
  if (diffEl) {
    if (diff !== null) {
      diffEl.className = "rec-meta-chip rec-diff-chip " + (diff < 0 ? 'diff-red' : (diff > 0 ? 'diff-orange' : 'diff-green'));
      diffEl.innerHTML = diff === 0 ? '✅ مطابق' : (diff < 0 ? `🔻 ${diff}` : `🔺 +${diff}`);
    } else {
      diffEl.className = "rec-meta-chip rec-diff-chip diff-gray";
      diffEl.textContent = "—";
    }
  }
}

// ---- وظائف إزالة وإضافة الأصناف في الاستلام ----

function onRemoveReceivingItem(itemId, itemName) {
  const confirmed = confirm(`هل أنت متأكد من إزالة الصنف "${itemName || ''}" من استلام اليوم؟`);
  if (!confirmed) return;

  currentReceivingRemovedIds.add(itemId);
  currentReceivingExtraItems = currentReceivingExtraItems.filter(it => it.id !== itemId);
  delete currentReceivingData[itemId];

  showToast(`🗑️ تم استبعاد الصنف من استلام اليوم`);
  renderReceivingView();
  saveLocalDebounced();
  updateSaveBarReceivingStatus();
}

function openAddReceivingItemModal(category) {
  const existingModal = document.getElementById("customReceivingModal");
  if (existingModal) existingModal.remove();

  const modalHtml = `
    <div class="custom-rec-modal-backdrop" id="customReceivingModal" onclick="if(event.target===this) closeAddReceivingItemModal()">
      <div class="custom-rec-modal-box">
        <div class="custom-rec-modal-header">
          <h3>➕ إضافة صنف جديد لقسم (${category})</h3>
          <button type="button" class="custom-rec-modal-close" onclick="closeAddReceivingItemModal()">✕</button>
        </div>
        <div class="custom-rec-modal-body">
          <div class="custom-rec-field-group">
            <label>اسم الصنف الذي أرسله الشيف *</label>
            <input type="text" id="customRecItemName" placeholder="مثال: دجاج كرسبي إضافي، صوص رانش خاص..." autofocus>
          </div>
          <div class="custom-rec-field-group">
            <label>وحدة القياس</label>
            <select id="customRecItemUnit">
              <option value="جرام" selected>جرام (جم)</option>
              <option value="كجم">كيلو جرام (كجم)</option>
              <option value="حبة">حبة</option>
              <option value="علبة">علبة</option>
              <option value="لتر">لتر</option>
            </select>
          </div>
          <div class="custom-rec-field-group">
            <label>الكمية المستلمة الفعلية الصباحية</label>
            <input type="number" step="any" min="0" inputmode="decimal" id="customRecItemQty" placeholder="0">
          </div>
          <div class="custom-rec-modal-actions">
            <button type="button" class="btn-save" onclick="confirmAddReceivingItem('${String(category).replace(/'/g, "\\'")}')">✅ إضافة للاستلام</button>
            <button type="button" class="btn-cancel" onclick="closeAddReceivingItemModal()">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);
  setTimeout(() => {
    const input = document.getElementById("customRecItemName");
    if (input) input.focus();
  }, 100);
}

function closeAddReceivingItemModal() {
  const modal = document.getElementById("customReceivingModal");
  if (modal) modal.remove();
}

function confirmAddReceivingItem(category) {
  const nameInput = document.getElementById("customRecItemName");
  const unitInput = document.getElementById("customRecItemUnit");
  const qtyInput = document.getElementById("customRecItemQty");

  const name = (nameInput?.value || "").trim();
  const unit = unitInput?.value || "جرام";
  const qty = (qtyInput?.value || "").trim();

  if (!name) {
    alert("يرجى كتابة اسم الصنف أولاً!");
    if (nameInput) nameInput.focus();
    return;
  }

  const newCustomId = "custom_rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  const newItem = {
    id: newCustomId,
    name: name,
    unit: unit,
    category: category,
    branches: currentReceivingBranch,
    isCustom: true
  };

  currentReceivingExtraItems.push(newItem);
  currentReceivingData[newCustomId] = {
    received: qty !== "" ? String(qty) : "",
    notes: "صنف إضافي من المطبخ",
    cookName: "",
    status: computeReceivingItemStatus(qty, 0)
  };
  currentReceivingOrdered[newCustomId] = 0;

  // تسجيل الصنف فوراً في قاعدة الأصناف المشتركة لتتعرف عليه شاشات المتبقي وطلبية الغد
  try {
    Items.save({
      id: newCustomId,
      name: name,
      unit: unit,
      category: category,
      branches: currentReceivingBranch,
      isCustom: true
    });
  } catch (err) {
    console.warn("تعذر حفظ الصنف المشترك في Items:", err);
  }

  closeAddReceivingItemModal();
  showToast(`✅ تم إضافة صنف "${name}" إلى قسم ${category}`);
  renderReceivingView();
  saveLocalDebounced();
  updateSaveBarReceivingStatus();
}

// حفظ محلي لحظي ذكي (Auto-Save Debounce) لضمان عدم ضياع أي حرف في الجوال
let saveLocalTimer = null;
function saveLocalDebounced() {
  clearTimeout(saveLocalTimer);
  saveLocalTimer = setTimeout(() => {
    const allItems = getAllReceivingActiveItems();
    const itemsPayload = [];
    allItems.forEach(it => {
      const data = currentReceivingData[it.id] || { received: "", notes: "" };
      const ord = currentReceivingOrdered[it.id] || 0;
      const rec = data.received;
      itemsPayload.push({
        itemId: it.id,
        itemName: it.name,
        unit: it.unit || "جرام",
        category: it.category || "عام",
        isCustom: !!it.isCustom,
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
      items: itemsPayload,
      removedItemIds: Array.from(currentReceivingRemovedIds)
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

  const allItems = getAllReceivingActiveItems();
  const itemsPayload = [];
  allItems.forEach(it => {
    const data = currentReceivingData[it.id] || { received: "", notes: "" };
    const ord = currentReceivingOrdered[it.id] || 0;
    const rec = data.received;
    const status = computeReceivingItemStatus(rec, ord);

    itemsPayload.push({
      itemId: it.id,
      itemName: it.name,
      unit: it.unit || "جرام",
      category: it.category || "عام",
      isCustom: !!it.isCustom,
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
    removedItemIds: Array.from(currentReceivingRemovedIds),
    savedAt: new Date().toISOString()
  };

  Sync.cacheSet("day:" + currentReceivingDate + ":" + currentReceivingBranch, { 
    date: currentReceivingDate, 
    branch: currentReceivingBranch, 
    items: itemsPayload,
    removedItemIds: Array.from(currentReceivingRemovedIds)
  });
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
