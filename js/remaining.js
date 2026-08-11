// ==================== وحدة تقرير المتبقي والجرد والانحراف (Remaining Stock & Variance Module) ====================

let currentRemainingDate = todayStr();
let currentRemainingBranch = "";
let currentRemainingData = {}; // itemId -> { remaining, remainingWeight, remainingSauce, notes }
let currentRemainingMeta = { isClosed: false, closedBy: "", closedAt: "" };
let isRemainingSaving = false;

function initRemainingModule() {
  currentRemainingBranch = Branch.get() || allowedBranchList()[0] || "";
  currentRemainingDate = todayStr();
}

async function loadRemainingData(date, branch) {
  currentRemainingDate = date || currentRemainingDate;
  currentRemainingBranch = branch || Branch.get() || allowedBranchList()[0] || "";

  const view = document.getElementById("remainingView");
  if (view) view.innerHTML = '<div class="loader">جاري تجميع تقرير المتبقي والجرد والانحراف…</div>';

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
  return { label: "🔴 انحراف عالي / هدر", class: "danger", level: "critical" };
}

const MEAL_MATCHING_CATEGORIES = ["دجاج", "لحم", "بحري", "أسماك", "فطور", "ساندويتشات"];
function isMealMatchingCategory(cat) {
  if (!cat) return false;
  return MEAL_MATCHING_CATEGORIES.some(m => cat.includes(m) || m.includes(cat));
}

function renderRemainingView(receivingData, salesData) {
  const view = document.getElementById("remainingView");
  if (!view) return;

  const items = Items.current;
  const isClosed = !!currentRemainingMeta.isClosed;

  // خريطة الاستلام
  const receivingMap = {};
  if (receivingData && receivingData.items) {
    receivingData.items.forEach(it => { receivingMap[it.itemId] = it; });
  }

  // تجميع الإحصائيات الشاملة للكروت القيادية
  let grandTotalReceivedWeight = 0;
  let grandTotalSoldMeals = 0;
  let grandTotalConsumedMeals = 0;
  let grandTotalActualRemainingWeight = 0;
  let grandTotalWasteGrams = 0;
  let highVarianceCount = 0;

  // تجميع حسب التصنيف
  const byCat = {};
  items.forEach(it => {
    const branches = itemBranches(it);
    if (branches.length && !branches.includes(currentRemainingBranch)) return;
    const cat = it.category || "عام";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(it);
  });

  // نفس قاعدة باقي الشاشات: ترتيب التصنيفات من الإعدادات مو أبجدي، والأصناف بترتيب الكتالوج
  const categories = Object.keys(byCat).sort((a, b) => categoryRank(a) - categoryRank(b));
  categories.forEach(cat => byCat[cat].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)));

  // حساب المبيعات حسب التصنيف من تابسنس
  const salesMap = {};
  if (salesData && Array.isArray(salesData)) {
    salesData.forEach(r => {
      salesMap[r.category] = (salesMap[r.category] || 0) + Number(r.qty || 0);
    });
  }

  let html = `
    <div class="remaining-header-panel">
      <div class="remaining-title-row">
        <div>
          <h2>📊 تقرير المتبقي والجرد والانحراف التشغيلي</h2>
          <div class="sub-text">المطابقة مع المبيعات على مستوى إجمالي التصنيفات الرئيسية (دجاج، لحم، بحري، فطور) والجرد الفعلي</div>
        </div>
        <div class="branch-closing-wrap">
          <select id="remainingBranchSelect" onchange="onRemainingBranchChange(this.value)">
            ${branchOptionsHtml(currentRemainingBranch)}
          </select>
          ${isClosed ? `
            <span class="badge danger" style="font-size:13px;padding:8px 14px;">🔒 اليوم مغلق ومقتنع</span>
          ` : `
            <button class="btn gold close-day-btn" onclick="closeOperationalDay()">🔒 إغلاق اليوم التشغيلي</button>
          `}
        </div>
      </div>
    `;

  // بناء كروت التصنيفات الملخصة
  let catHtml = "";

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

  categories.forEach(cat => {
    const catItems = byCat[cat];
    const isMealCat = isMealMatchingCategory(cat);
    const categorySoldMeals = isMealCat ? getMatchedCategorySales(salesMap, cat) : 0;
    const categoryConsumedGrams = categorySoldMeals * MEAL_WEIGHT_G; // 150g لكل وجبة
    
    let catReceivedSum = 0;
    let catActualRemainingSum = 0;

    const itemsCardsHtml = catItems.map(it => {
      const recEntry = receivingMap[it.id] || {};
      const recQty = Number(recEntry.received || 0);
      catReceivedSum += recQty;
      grandTotalReceivedWeight += recQty;

      const remData = currentRemainingData[it.id] || { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
      const actualWeight = Number(remData.remainingWeight || remData.remaining || 0);
      catActualRemainingSum += actualWeight;
      grandTotalActualRemainingWeight += actualWeight;

      return `
        <div class="item-card remaining-item-card" data-item-id="${it.id}">
          <div class="item-header-row">
            <div>
              <span class="item-name">${it.name}</span>
              <span class="item-unit">(${it.unit || "جرام"})</span>
            </div>
          </div>

          <div class="inputs-row">
            <div class="field">
              <label>المستلم (جم)</label>
              <input type="text" value="${recQty ? Math.round(recQty) : '—'}" readonly class="readonly-input">
            </div>

            <div class="field">
              <label>الوزن المتبقي الفعلي *</label>
              <input type="number" step="any" min="0" 
                     value="${remData.remainingWeight || remData.remaining || ''}" 
                     placeholder="0" 
                     ${isClosed ? 'disabled' : ''}
                     oninput="onRemainingWeightChange('${it.id}', this.value)"
                     class="remaining-input">
            </div>

            <div class="field">
              <label>الصوص المتبقي *</label>
              <input type="number" step="any" min="0" 
                     value="${remData.remainingSauce || ''}" 
                     placeholder="0" 
                     ${isClosed ? 'disabled' : ''}
                     oninput="onRemainingSauceChange('${it.id}', this.value)"
                     class="remaining-input sauce-input">
            </div>
          </div>

          <div class="notes-row">
            <input type="text" value="${remData.notes || ''}" 
                   placeholder="ملاحظات الجرد والمتبقي..." 
                   ${isClosed ? 'disabled' : ''}
                   oninput="onRemainingNotesChange('${it.id}', this.value)">
          </div>
        </div>
      `;
    }).join("");

    const filledCount = catItems.filter(it => {
      const remData = currentRemainingData[it.id] || {};
      const val = remData.remainingWeight || remData.remaining;
      return val !== "" && val !== null && val !== undefined;
    }).length;

    if (isMealCat) {
      grandTotalSoldMeals += categorySoldMeals;
      grandTotalConsumedMeals += categorySoldMeals;
    }

    // حساب الانحراف على إجمالي التصنيف بالكامل
    const expectedRemainingGrams = isMealCat ? Math.max(0, catReceivedSum - categoryConsumedGrams) : catReceivedSum;
    const catVarianceGrams = catActualRemainingSum - expectedRemainingGrams;
    const catVariancePct = catReceivedSum > 0 ? (catVarianceGrams / catReceivedSum) * 100 : 0;
    const catBadge = getVarianceBadge(catVariancePct);

    if (catVarianceGrams < 0) {
      grandTotalWasteGrams += Math.abs(catVarianceGrams);
    }
    if (catBadge.level === "critical") highVarianceCount++;

    catHtml += `
      <div class="category-summary-card">
        <div class="cat-card-header" onclick="toggleCategoryGroup('${cat}')">
          <div class="cat-title-block">
            <h3>${categoryIconSticker(cat)} ${cat}</h3>
            ${isMealCat ? `<span class="badge ${catBadge.class}">${catBadge.label} (${catVariancePct > 0 ? '+' : ''}${catVariancePct.toFixed(1)}%)</span>` : ''}
            <span class="badge neutral" style="margin-right:6px;">${filledCount}/${catItems.length} مكتمل</span>
          </div>
          <div class="cat-stats-summary">
            <span>المستلم: <strong>${Math.round(catReceivedSum)} جم ${isMealCat && catReceivedSum > 0 ? `(${mealsCount(catReceivedSum)} وجبة)` : ''}</strong></span>
            ${isMealCat ? `
              <span>المباع: <strong>${Math.round(categorySoldMeals)} وجبة</strong></span>
              <span>المستهلك: <strong>${Math.round(categoryConsumedGrams)} جم</strong></span>
            ` : ''}
            <span>المتبقي الفعلي: <strong>${Math.round(catActualRemainingSum)} جم ${isMealCat && catActualRemainingSum > 0 ? `(${mealsCount(catActualRemainingSum)} وجبة)` : ''}</strong></span>
            <span class="toggle-icon" id="catToggle_${cat}">▼</span>
          </div>
        </div>

        <div class="cat-card-body" id="catBody_${cat}">
          <div class="category-body-cards" style="padding:12px 0;">
            ${itemsCardsHtml}
          </div>
        </div>
      </div>
    `;
  });

  // إضافة كروت KPI الهيدر القيادية
  html += `
      <div class="remaining-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-v">${Math.round(grandTotalSoldMeals)}</div>
          <div class="kpi-l">الوجبات المباعة (تابسنس)</div>
        </div>
        <div class="kpi-card ok">
          <div class="kpi-v">${Math.round(grandTotalReceivedWeight)} جم</div>
          <div class="kpi-l">إجمالي المستلم</div>
        </div>
        <div class="kpi-card neutral">
          <div class="kpi-v">${Math.round(grandTotalActualRemainingWeight)} جم</div>
          <div class="kpi-l">المتبقي الفعلي والجرد</div>
        </div>
        <div class="kpi-card warn">
          <div class="kpi-v">${Math.round(grandTotalWasteGrams)} جم</div>
          <div class="kpi-l">إجمالي الهدر والفاقد</div>
        </div>
        <div class="kpi-card danger">
          <div class="kpi-v">${highVarianceCount}</div>
          <div class="kpi-l">أصناف بانحراف مرتفع</div>
        </div>
      </div>
    </div>

    <div class="remaining-categories-container">
      ${catHtml}
    </div>
  `;

  view.innerHTML = html;
}

function toggleCategoryGroup(catName) {
  const body = document.getElementById("catBody_" + catName);
  const toggle = document.getElementById("catToggle_" + catName);
  if (body) {
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    if (toggle) toggle.textContent = isHidden ? "▼" : "▲";
  }
}

function onRemainingBranchChange(branch) {
  Branch.set(branch);
  currentRemainingBranch = branch;
  loadRemainingData(currentRemainingDate, currentRemainingBranch);
}

function onRemainingWeightChange(itemId, val) {
  if (!currentRemainingData[itemId]) currentRemainingData[itemId] = { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
  currentRemainingData[itemId].remainingWeight = val;
  currentRemainingData[itemId].remaining = val;
  updateSaveBarRemainingStatus();
}

function onRemainingSauceChange(itemId, val) {
  if (!currentRemainingData[itemId]) currentRemainingData[itemId] = { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
  currentRemainingData[itemId].remainingSauce = val;
  updateSaveBarRemainingStatus();
}

function onRemainingNotesChange(itemId, val) {
  if (!currentRemainingData[itemId]) currentRemainingData[itemId] = { remaining: "", remainingWeight: "", remainingSauce: "", notes: "" };
  currentRemainingData[itemId].notes = val;
  updateSaveBarRemainingStatus();
}

function updateSaveBarRemainingStatus() {
  const statusEl = document.getElementById("remainingSaveStatus");
  if (statusEl) {
    statusEl.textContent = "لديك تعديلات غير محفوظة بتقرير المتبقي والجرد";
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
  if (!confirm("هل أنت تأكد من إغلاق اليوم التشغيلي واعتماد كافة الكميات والجرد؟ بعد الإغلاق لن يمكن التعديل إلا بإذن المدير.")) {
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
