// ==================== وحدة تقرير المتبقي والجرد السريع للجوال (Fast Mobile Closing & Remaining Module) ====================

let currentRemainingDate = todayStr();
let currentRemainingBranch = "";
let currentRemainingData = {}; // itemId -> { remaining, remainingWeight, remainingSauce, notes }
let currentRemainingMeta = { isClosed: false, closedBy: "", closedAt: "" };
let isRemainingSaving = false;
let remainingActiveFilter = "all"; // 'all', 'uncounted', 'protein', 'sauce', 'variance'
let remainingCollapsed = {};

function initRemainingModule() {
  currentRemainingBranch = Branch.get() || allowedBranchList()[0] || "";
  currentRemainingDate = todayStr();
}

async function loadRemainingData(date, branch) {
  currentRemainingDate = date || currentRemainingDate;
  currentRemainingBranch = branch || Branch.get() || allowedBranchList()[0] || "";

  const view = document.getElementById("remainingView");
  if (view) view.innerHTML = '<div class="loader"><div class="spinner"></div> جاري تجميع تقرير المتبقي والجرد والانحراف…</div>';

  try {
    await Items.load();

    const [receivingData, salesData, remainingData] = await Promise.all([
      Sync.get("getDay", { date: currentRemainingDate, branch: currentRemainingBranch }, "day:" + currentRemainingDate + ":" + currentRemainingBranch).catch(() => null),
      Sync.get("getSalesByCategory", { start: currentRemainingDate, end: currentRemainingDate, branch: currentRemainingBranch }, "tabsense:" + currentRemainingDate + ":" + currentRemainingBranch).catch(() => null),
      Sync.get("getRemainingReport", { date: currentRemainingDate, branch: currentRemainingBranch }, "remaining:" + currentRemainingDate + ":" + currentRemainingBranch).catch(() => null)
    ]);

    currentRemainingData = {};
    currentRemainingMeta = { isClosed: false, closedBy: "", closedAt: "" };

    if (remainingData) {
      if (remainingData.meta) currentRemainingMeta = remainingData.meta;
      (remainingData.items || []).forEach(it => {
        currentRemainingData[it.itemId] = {
          remaining: it.remaining !== undefined && it.remaining !== null ? String(it.remaining) : "",
          remainingWeight: it.remainingWeight !== undefined && it.remainingWeight !== null ? String(it.remainingWeight) : "",
          remainingSauce: it.remainingSauce !== undefined && it.remainingSauce !== null ? String(it.remainingSauce) : "",
          notes: it.notes || ""
        };
      });
    }

    renderRemainingView(receivingData, salesData);
  } catch (err) {
    console.error("loadRemainingData error:", err);
    renderRemainingView(null, null);
  }
}

function calculateCategorySales(salesRows, categoryName) {
  if (!salesRows || !Array.isArray(salesRows)) return 0;
  let totalQty = 0;
  salesRows.forEach(r => {
    if (r.category === categoryName) {
      totalQty += Number(r.qty || 0);
    }
  });
  return totalQty;
}

function calculateItemVariance(receivedGrams, soldMeals, actualRemainingGrams) {
  const rec = Number(receivedGrams || 0);
  const sold = Number(soldMeals || 0);
  const consumedGrams = sold * MEAL_WEIGHT_G; // 150 جرام لكل وجبة مباعة
  const expectedRemainingGrams = Math.max(0, rec - consumedGrams);
  const actualRemaining = Number(actualRemainingGrams || 0);
  const varianceGrams = actualRemaining - expectedRemainingGrams;
  const variancePct = rec > 0 ? (varianceGrams / rec) * 100 : 0;

  return {
    consumedGrams,
    consumedMeals: sold,
    expectedRemainingGrams,
    actualRemaining,
    varianceGrams,
    variancePct
  };
}

function getVarianceBadge(variancePct) {
  const absPct = Math.abs(variancePct);
  if (absPct <= 5) return { label: "🟢 طبيعي", class: "ok", level: "normal" };
  if (absPct <= 15) return { label: "🟡 تنبيه", class: "warn", level: "attention" };
  return { label: "🔴 انحراف / عجز", class: "danger", level: "critical" };
}

const MEAL_MATCHING_CATEGORIES = ["دجاج", "لحم", "بحري", "أسماك", "فطور", "ساندويتشات"];
function isMealMatchingCategory(cat) {
  if (!cat) return false;
  return MEAL_MATCHING_CATEGORIES.some(m => cat.includes(m) || m.includes(cat));
}

function getMatchedCategorySales(salesMap, cat) {
  if (!salesMap || !cat) return 0;
  let total = Number(salesMap[cat] || 0);

  const normCat = String(cat).trim();
  Object.keys(salesMap).forEach(key => {
    if (key === cat) return;
    const k = String(key).trim();
    if ((normCat.includes("دجاج") && k.includes("دجاج")) ||
        (normCat.includes("لحم") && k.includes("لحم")) ||
        ((normCat.includes("بحري") || normCat.includes("سمك")) && (k.includes("بحري") || k.includes("سمك"))) ||
        ((normCat.includes("فطور") || normCat.includes("ساندويتش")) && (k.includes("فطور") || k.includes("ساندويتش")))) {
      total += Number(salesMap[key] || 0);
    }
  });
  return total;
}

function setRemainingFilter(filterName) {
  remainingActiveFilter = filterName;
  document.querySelectorAll(".rem-filter-chip").forEach(el => {
    el.classList.toggle("active", el.dataset.filter === filterName);
  });
  filterRemainingCardsUI();
}

function filterRemainingCardsUI() {
  document.querySelectorAll(".remaining-card-mobile").forEach(card => {
    const isCounted = card.dataset.counted === "true";
    const isProtein = card.dataset.isprotein === "true";
    const hasSauce = card.dataset.hassauce === "true";
    const hasVariance = card.dataset.hasvariance === "true";

    let visible = true;
    if (remainingActiveFilter === "uncounted") {
      visible = !isCounted;
    } else if (remainingActiveFilter === "protein") {
      visible = isProtein;
    } else if (remainingActiveFilter === "sauce") {
      visible = hasSauce;
    } else if (remainingActiveFilter === "variance") {
      visible = hasVariance;
    }
    card.style.display = visible ? "" : "none";
  });

  document.querySelectorAll(".category-section-rem").forEach(sec => {
    const visibleCards = sec.querySelectorAll('.remaining-card-mobile:not([style*="display: none"])');
    sec.style.display = visibleCards.length > 0 ? "" : "none";
  });
}

function renderRemainingView(receivingData, salesData) {
  const view = document.getElementById("remainingView");
  if (!view) return;

  const items = Items.current;
  const isClosed = !!currentRemainingMeta.isClosed;

  const receivingMap = {};
  if (receivingData && receivingData.items) {
    receivingData.items.forEach(it => { receivingMap[it.itemId] = it; });
  }

  const salesMap = {};
  if (salesData && Array.isArray(salesData)) {
    salesData.forEach(r => {
      salesMap[r.category] = (salesMap[r.category] || 0) + Number(r.qty || 0);
    });
  }

  let totalItemsCount = 0;
  let countedItemsCount = 0;
  let grandTotalReceivedWeight = 0;
  let grandTotalSoldMeals = 0;
  let grandTotalActualRemainingWeight = 0;
  let grandTotalWasteGrams = 0;
  let highVarianceCount = 0;

  const byCat = {};
  items.forEach(it => {
    const branches = itemBranches(it);
    if (branches.length && !branches.includes(currentRemainingBranch)) return;
    const cat = it.category || "عام";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(it);
  });

  const categories = Object.keys(byCat).sort((a, b) => categoryRank(a) - categoryRank(b));
  categories.forEach(cat => byCat[cat].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)));

  categories.forEach(cat => {
    const isMealCat = isMealMatchingCategory(cat);
    const categorySoldMeals = isMealCat ? getMatchedCategorySales(salesMap, cat) : 0;
    if (isMealCat) grandTotalSoldMeals += categorySoldMeals;

    byCat[cat].forEach(it => {
      totalItemsCount++;
      const recEntry = receivingMap[it.id] || {};
      const recQty = Number(recEntry.received || 0);
      grandTotalReceivedWeight += recQty;

      const remData = currentRemainingData[it.id] || { remainingWeight: "", remainingSauce: "" };
      const actualWeight = Number(remData.remainingWeight || remData.remaining || 0);
      grandTotalActualRemainingWeight += actualWeight;

      const isCounted = (remData.remainingWeight !== "" && remData.remainingWeight !== null && remData.remainingWeight !== undefined) ||
                        (remData.remainingSauce !== "" && remData.remainingSauce !== null && remData.remainingSauce !== undefined);
      if (isCounted) countedItemsCount++;
    });
  });

  let html = `
    <div class="remaining-mobile-header">
      <div class="rem-top-row">
        <div>
          <h2 class="rem-main-title">🌙 جرد الإغلاق والمتبقي</h2>
          <span class="rem-date-subtitle">📅 تاريخ: ${currentRemainingDate} | فرز دقيق بين الدجاج/اللحم والصوصات</span>
        </div>
        <div class="branch-closing-wrap" style="display:flex;gap:8px;align-items:center;">
          ${Auth.isBranchStaff() || allowedBranchList().length <= 1 ? `
            <span class="badge neutral" style="font-size:13px;padding:6px 12px;font-weight:900;">🏪 ${currentRemainingBranch}</span>
          ` : `
            <select id="remainingBranchSelect" onchange="onRemainingBranchChange(this.value)">
              ${branchOptionsHtml(currentRemainingBranch)}
            </select>
          `}
          ${isClosed ? `
            <span class="badge danger" style="font-size:13px;padding:8px 14px;">🔒 اليوم مغلق ومقتنع</span>
          ` : `
            <button class="btn gold rem-close-btn" onclick="closeOperationalDay()" style="min-height:38px;padding:6px 14px;">🔒 إغلاق اليوم</button>
          `}
        </div>
      </div>

      <div class="rem-stats-row">
        <div class="rem-stat-pill">
          <span class="rem-stat-num">${countedItemsCount}/${totalItemsCount}</span>
          <span class="rem-stat-lbl">أصناف تم جردها</span>
        </div>
        <div class="rem-stat-pill ok">
          <span class="rem-stat-num">${Math.round(grandTotalReceivedWeight)}g</span>
          <span class="rem-stat-lbl">المستلم صباحاً</span>
        </div>
        ${!Auth.isBranchStaff() ? `
        <div class="rem-stat-pill">
          <span class="rem-stat-num">${Math.round(grandTotalSoldMeals)}</span>
          <span class="rem-stat-lbl">وجبات مباعة (تابسنس)</span>
        </div>
        <div class="rem-stat-pill ${grandTotalWasteGrams > 0 ? 'warn' : 'ok'}">
          <span class="rem-stat-num">${Math.round(grandTotalWasteGrams)}g</span>
          <span class="rem-stat-lbl">إجمالي الفاقد/الهدر</span>
        </div>
        ` : `
        <div class="rem-stat-pill">
          <span class="rem-stat-num">${Math.round(grandTotalActualRemainingWeight)}g</span>
          <span class="rem-stat-lbl">إجمالي المتبقي الفعلي</span>
        </div>
        `}
      </div>

      <div class="rem-quick-actions-bar">
        ${renderCompactToggleBtnHtml()}
      </div>

      <div class="rem-filters-scroll">
        <button type="button" class="rem-filter-chip ${remainingActiveFilter === 'all' ? 'active' : ''}" data-filter="all" onclick="setRemainingFilter('all')">
          الكل (${totalItemsCount})
        </button>
        <button type="button" class="rem-filter-chip ${remainingActiveFilter === 'uncounted' ? 'active' : ''}" data-filter="uncounted" onclick="setRemainingFilter('uncounted')">
          ⏳ باقي لم يُجرد (${totalItemsCount - countedItemsCount})
        </button>
        <button type="button" class="rem-filter-chip ${remainingActiveFilter === 'protein' ? 'active' : ''}" data-filter="protein" onclick="setRemainingFilter('protein')">
          🍗 الدجاج والبروتين
        </button>
        <button type="button" class="rem-filter-chip ${remainingActiveFilter === 'sauce' ? 'active' : ''}" data-filter="sauce" onclick="setRemainingFilter('sauce')">
          🥣 الصوصات
        </button>
        <button type="button" class="rem-filter-chip ${remainingActiveFilter === 'variance' ? 'active' : ''}" data-filter="variance" onclick="setRemainingFilter('variance')">
          ⚠️ تدقيق الانحراف
        </button>
      </div>
    </div>
  `;

  if (!categories.length) {
    html += `<div class="empty-state">لا توجد أصناف مسجلة لهذا الفرع.</div>`;
    view.innerHTML = html;
    return;
  }

  categories.forEach(cat => {
    const catItems = byCat[cat];
    const isMealCat = isMealMatchingCategory(cat);
    const categorySoldMeals = isMealCat ? getMatchedCategorySales(salesMap, cat) : 0;
    const categoryConsumedGrams = categorySoldMeals * MEAL_WEIGHT_G;

    let catReceivedSum = 0;
    let catActualRemainingSum = 0;

    const cardsHtml = catItems.map(it => {
      const recEntry = receivingMap[it.id] || {};
      const recQty = Number(recEntry.received || 0);
      catReceivedSum += recQty;

      const remData = currentRemainingData[it.id] || { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
      const actualWeight = Number(remData.remainingWeight || remData.remaining || 0);
      const actualSauce = Number(remData.remainingSauce || 0);
      catActualRemainingSum += actualWeight;

      const isCounted = (remData.remainingWeight !== "" && remData.remainingWeight !== null && remData.remainingWeight !== undefined) ||
                        (remData.remainingSauce !== "" && remData.remainingSauce !== null && remData.remainingSauce !== undefined);

      const isProtein = isMealCat || (it.unit && (it.unit.includes("جرام") || it.unit.includes("جم") || it.unit.includes("كجم")));
      const isSauce = (it.name && it.name.includes("صوص")) || (cat && cat.includes("صوص"));

      let itemVarianceText = "";
      let hasVariance = false;
      if (recQty > 0) {
        const itemExpected = Math.max(0, recQty - categoryConsumedGrams);
        const diff = actualWeight - itemExpected;
        if (Math.abs(diff) > 50) {
          hasVariance = true;
          itemVarianceText = diff < 0 ? `🔻 عجز تقريبي: ${Math.round(diff)} جم` : `🔺 زيادة: +${Math.round(diff)} جم`;
        }
      }

      return `
        <div class="remaining-card-mobile" 
             data-item-id="${it.id}" 
             data-counted="${isCounted}"
             data-isprotein="${isProtein}"
             data-hassauce="${isSauce || isProtein}"
             data-hasvariance="${hasVariance}">
          
          <div class="rem-card-header">
            <div class="rem-item-title-wrap">
              <span class="rem-item-name">${it.name}</span>
              <span class="rem-item-unit">(${it.unit || "جرام"})</span>
            </div>
            ${recQty > 0 ? `
              <span class="badge neutral" style="font-size:11px;">📦 استلام الصباح: ${Math.round(recQty)} جم</span>
            ` : '<span class="badge neutral" style="font-size:11px;">— لم يُستلم اليوم</span>'}
          </div>

          <div class="rem-dual-inputs-grid">
            
            <!-- 🍗 حقل الدجاج والبروتين المتبقي -->
            <div class="rem-sub-box protein">
              <div class="rem-sub-header protein">
                <span>🍗 وزن الدجاج / البروتين المتبقي (جم)</span>
                <span id="remmeals-${it.id}" class="rec-meal-calc" style="font-size:11px;">
                  🍽 ${actualWeight > 0 ? mealsCount(actualWeight) + ' وجبة' : '0 وجبة'}
                </span>
              </div>
              
              <div class="rec-input-action-row">
                <div class="rec-input-wrapper">
                  <input type="number" step="any" min="0" inputmode="decimal"
                         id="remweight-${it.id}"
                         value="${remData.remainingWeight || remData.remaining || ''}"
                         placeholder="0"
                         ${isClosed ? 'disabled' : ''}
                         oninput="onRemainingWeightChange('${it.id}', this.value)"
                         class="rec-main-input ${actualWeight > 0 ? 'border-green' : ''}">
                  <span class="rec-input-unit-label">جم</span>
                </div>
                <div class="rec-inline-btns">
                  <button type="button" class="rec-btn-quick zero" ${isClosed ? 'disabled' : ''} onclick="onQuickRemWeightZero('${it.id}')">
                    نفد (0)
                  </button>
                </div>
              </div>

              <div class="rem-stepper-chips-row">
                <button type="button" class="rem-step-chip" ${isClosed ? 'disabled' : ''} onclick="onQuickRemWeightIncrement('${it.id}', 100)">+100</button>
                <button type="button" class="rem-step-chip" ${isClosed ? 'disabled' : ''} onclick="onQuickRemWeightIncrement('${it.id}', 500)">+500</button>
                <button type="button" class="rem-step-chip" ${isClosed ? 'disabled' : ''} onclick="onQuickRemWeightIncrement('${it.id}', 1000)">+1 كجم</button>
                <button type="button" class="rem-step-chip" ${isClosed ? 'disabled' : ''} onclick="onQuickRemWeightIncrement('${it.id}', 2000)">+2 كجم</button>
                <button type="button" class="rem-step-chip clear" ${isClosed ? 'disabled' : ''} onclick="onQuickRemWeightClear('${it.id}')">✕ مسح</button>
              </div>
            </div>

            <!-- 🥣 حقل الصوص المتبقي -->
            <div class="rem-sub-box sauce">
              <div class="rem-sub-header sauce">
                <span>🥣 الصوص المتبقي (عبوات أو جرام)</span>
                <span class="badge neutral" style="font-size:10px;">صوص ${it.name}</span>
              </div>

              <div class="rec-input-action-row">
                <div class="rec-input-wrapper">
                  <input type="number" step="any" min="0" inputmode="decimal"
                         id="remsauce-${it.id}"
                         value="${remData.remainingSauce || ''}"
                         placeholder="0"
                         ${isClosed ? 'disabled' : ''}
                         oninput="onRemainingSauceChange('${it.id}', this.value)"
                         class="rec-main-input ${actualSauce > 0 ? 'border-green' : ''}">
                  <span class="rec-input-unit-label">كمية</span>
                </div>
                <div class="rec-inline-btns">
                  <button type="button" class="rec-btn-quick zero" ${isClosed ? 'disabled' : ''} onclick="onQuickRemSauceZero('${it.id}')">
                    نفد (0)
                  </button>
                </div>
              </div>

              <div class="rem-stepper-chips-row">
                <button type="button" class="rem-step-chip" ${isClosed ? 'disabled' : ''} onclick="onQuickRemSauceIncrement('${it.id}', 1)">+1</button>
                <button type="button" class="rem-step-chip" ${isClosed ? 'disabled' : ''} onclick="onQuickRemSauceIncrement('${it.id}', 5)">+5</button>
                <button type="button" class="rem-step-chip" ${isClosed ? 'disabled' : ''} onclick="onQuickRemSauceIncrement('${it.id}', 10)">+10</button>
                <button type="button" class="rem-step-chip minus" ${isClosed ? 'disabled' : ''} onclick="onQuickRemSauceIncrement('${it.id}', -1)">-1</button>
                <button type="button" class="rem-step-chip clear" ${isClosed ? 'disabled' : ''} onclick="onQuickRemSauceClear('${it.id}')">✕ مسح</button>
              </div>
            </div>

          </div>

          ${itemVarianceText && !Auth.isBranchStaff() ? `
            <div class="rem-variance-badge-bar">
              <span class="text-red font-bold">${itemVarianceText}</span>
              <span style="font-size:11px;color:var(--gray);">يرجى التأكد من الميزان أو إدراج ملاحظة</span>
            </div>
          ` : ''}

          <div class="rec-notes-container expanded">
            <input type="text" value="${remData.notes || ''}" 
                   placeholder="ملاحظات جرد هذا الصنف (تالف، هدر في التحضير، عينات...)"
                   id="remnote-${it.id}"
                   ${isClosed ? 'disabled' : ''}
                   oninput="onRemainingNotesChange('${it.id}', this.value)"
                   class="rec-note-input">
          </div>
        </div>
      `;
    }).join("");

    const filledCount = catItems.filter(it => {
      const rem = currentRemainingData[it.id] || {};
      const val = rem.remainingWeight || rem.remaining;
      return val !== "" && val !== null && val !== undefined;
    }).length;

    const expectedRemainingGrams = isMealCat ? Math.max(0, catReceivedSum - categoryConsumedGrams) : catReceivedSum;
    const catVarianceGrams = catActualRemainingSum - expectedRemainingGrams;
    const catVariancePct = catReceivedSum > 0 ? (catVarianceGrams / catReceivedSum) * 100 : 0;
    const catBadge = getVarianceBadge(catVariancePct);

    if (catVarianceGrams < 0) {
      grandTotalWasteGrams += Math.abs(catVarianceGrams);
    }
    if (catBadge.level === "critical") highVarianceCount++;

    html += `
      <div class="category-section category-section-rem${remainingCollapsed[cat] ? " collapsed" : ""}" data-cat="${cat}">
        <div class="category-header" onclick="toggleRemainingCategory('${String(cat).replace(/'/g, "\\'")}')">
          <div class="cat-label">
            <span>${categoryIconSticker(cat)} ${cat}</span>
            ${isMealCat && !Auth.isBranchStaff() ? `<span class="badge ${catBadge.class}" style="font-size:11px;margin-right:6px;">${catBadge.label}</span>` : ''}
          </div>
          <span class="cat-count-badge">
            <span class="cat-count">${filledCount}/${catItems.length}</span>
            <span class="chevron">▾</span>
          </span>
        </div>
        <div class="category-body">
          <div>
            ${cardsHtml}
          </div>
        </div>
      </div>
    `;
  });

  view.innerHTML = html;
  filterRemainingCardsUI();
}

function toggleRemainingCategory(cat) {
  remainingCollapsed[cat] = !remainingCollapsed[cat];
  document.querySelectorAll(".category-section-rem").forEach(sec => {
    if (sec.dataset.cat === cat) {
      sec.classList.toggle("collapsed", !!remainingCollapsed[cat]);
    }
  });
}

function onRemainingBranchChange(branch) {
  Branch.set(branch);
  currentRemainingBranch = branch;
  loadRemainingData(currentRemainingDate, currentRemainingBranch);
}

function onQuickRemWeightZero(itemId) {
  onRemainingWeightChange(itemId, "0");
  const input = document.getElementById("remweight-" + itemId);
  if (input) input.value = "0";
}

function onQuickRemWeightClear(itemId) {
  onRemainingWeightChange(itemId, "");
  const input = document.getElementById("remweight-" + itemId);
  if (input) input.value = "";
}

function onQuickRemWeightIncrement(itemId, delta) {
  const currentVal = Number((currentRemainingData[itemId] || {}).remainingWeight || 0);
  const newVal = Math.max(0, currentVal + delta);
  onRemainingWeightChange(itemId, String(newVal));
  const input = document.getElementById("remweight-" + itemId);
  if (input) input.value = newVal;
}

function onRemainingWeightChange(itemId, val) {
  if (!currentRemainingData[itemId]) currentRemainingData[itemId] = { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
  currentRemainingData[itemId].remainingWeight = val;
  currentRemainingData[itemId].remaining = val;

  const card = document.querySelector(`.remaining-card-mobile[data-item-id="${itemId}"]`);
  if (card) {
    const isCounted = (val !== "" && val !== null) || ((currentRemainingData[itemId].remainingSauce || "") !== "");
    card.dataset.counted = String(isCounted);
  }

  const mealEl = document.getElementById("remmeals-" + itemId);
  if (mealEl) {
    const num = Number(val || 0);
    mealEl.textContent = num > 0 ? `🍽 ${mealsCount(num)} وجبة` : '0 وجبة';
  }

  saveRemainingLocalDebounced();
  updateSaveBarRemainingStatus();
}

function onQuickRemSauceZero(itemId) {
  onRemainingSauceChange(itemId, "0");
  const input = document.getElementById("remsauce-" + itemId);
  if (input) input.value = "0";
}

function onQuickRemSauceClear(itemId) {
  onRemainingSauceChange(itemId, "");
  const input = document.getElementById("remsauce-" + itemId);
  if (input) input.value = "";
}

function onQuickRemSauceIncrement(itemId, delta) {
  const currentVal = Number((currentRemainingData[itemId] || {}).remainingSauce || 0);
  const newVal = Math.max(0, currentVal + delta);
  onRemainingSauceChange(itemId, String(newVal));
  const input = document.getElementById("remsauce-" + itemId);
  if (input) input.value = newVal;
}

function onRemainingSauceChange(itemId, val) {
  if (!currentRemainingData[itemId]) currentRemainingData[itemId] = { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
  currentRemainingData[itemId].remainingSauce = val;

  const card = document.querySelector(`.remaining-card-mobile[data-item-id="${itemId}"]`);
  if (card) {
    const isCounted = ((currentRemainingData[itemId].remainingWeight || "") !== "") || (val !== "" && val !== null);
    card.dataset.counted = String(isCounted);
  }

  saveRemainingLocalDebounced();
  updateSaveBarRemainingStatus();
}

function onRemainingNotesChange(itemId, val) {
  if (!currentRemainingData[itemId]) currentRemainingData[itemId] = { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
  currentRemainingData[itemId].notes = val;
  saveRemainingLocalDebounced();
  updateSaveBarRemainingStatus();
}

let saveRemLocalTimer = null;
function saveRemainingLocalDebounced() {
  clearTimeout(saveRemLocalTimer);
  saveRemLocalTimer = setTimeout(() => {
    const itemsPayload = [];
    Items.current.forEach(it => {
      const branches = itemBranches(it);
      if (branches.length && !branches.includes(currentRemainingBranch)) return;

      const data = currentRemainingData[it.id] || { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
      itemsPayload.push({
        itemId: it.id,
        itemName: it.name,
        unit: it.unit || "جرام",
        remaining: data.remainingWeight || data.remaining || "",
        remainingWeight: data.remainingWeight || "",
        remainingSauce: data.remainingSauce || "",
        notes: data.notes || ""
      });
    });

    Sync.cacheSet("remaining:" + currentRemainingDate + ":" + currentRemainingBranch, {
      date: currentRemainingDate,
      branch: currentRemainingBranch,
      meta: currentRemainingMeta,
      items: itemsPayload
    });
  }, 400);
}

function updateSaveBarRemainingStatus() {
  const statusEl = document.getElementById("remainingSaveStatus");
  if (statusEl) {
    statusEl.textContent = "لديك تعديلات بتقرير المتبقي جاهزة للحفظ السحابي";
    statusEl.classList.add("dirty");
  }
}

async function saveRemainingReportData() {
  if (isRemainingSaving) return;
  isRemainingSaving = true;

  const saveBtn = document.getElementById("remainingSaveBtn");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "جاري حفظ التقرير…"; }

  const itemsPayload = [];
  Items.current.forEach(it => {
    const branches = itemBranches(it);
    if (branches.length && !branches.includes(currentRemainingBranch)) return;

    const data = currentRemainingData[it.id] || { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
    itemsPayload.push({
      itemId: it.id,
      itemName: it.name,
      unit: it.unit || "جرام",
      remaining: data.remainingWeight || data.remaining || "",
      remainingWeight: data.remainingWeight || "",
      remainingSauce: data.remainingSauce || "",
      notes: data.notes || ""
    });
  });

  const emp = Auth.getEmployee();
  const payload = {
    date: currentRemainingDate,
    branch: currentRemainingBranch,
    employeeName: emp ? emp.name : "",
    meta: currentRemainingMeta,
    items: itemsPayload,
    savedAt: new Date().toISOString()
  };

  Sync.cacheSet("remaining:" + currentRemainingDate + ":" + currentRemainingBranch, payload);
  Sync.enqueue("saveRemainingReport:" + currentRemainingDate + ":" + currentRemainingBranch, "saveRemainingReport", payload);

  showToast("✅ تم حفظ تقرير المتبقي والجرد بنجاح!");

  const statusEl = document.getElementById("remainingSaveStatus");
  if (statusEl) {
    statusEl.textContent = "تم حفظ تقرير المتبقي بنجاح (" + new Date().toLocaleTimeString("ar-SA") + ")";
    statusEl.classList.remove("dirty");
  }

  setTimeout(() => {
    isRemainingSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 حفظ تقرير المتبقي"; }
  }, 1000);
}

async function closeOperationalDay() {
  if (!confirm("هل أنت متأكد من إغلاق اليوم التشغيلي واعتماد كافة الكميات والجرد؟ بعد الإغلاق لن يمكن التعديل إلا بإذن المدير.")) {
    return;
  }

  const emp = Auth.getEmployee();
  currentRemainingMeta = {
    isClosed: true,
    closedBy: emp ? emp.name : "مدير الفرع",
    closedAt: new Date().toISOString()
  };

  await saveRemainingReportData();
  showToast("🔒 تم إغلاق اليوم التشغيلي بنجاح!");
  loadRemainingData(currentRemainingDate, currentRemainingBranch);
}
