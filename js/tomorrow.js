// ==================== شاشة طلبية الغد الذكية للمالك والتشغيل (Smart Tomorrow Order & Kitchen Hub) ====================

let currentTomorrowDate = addDaysStr(todayStr(), 1);
let currentTomorrowOrder = {}; // itemId -> {qty, notes}
let currentTomorrowBranch = "";
let tomorrowCategoryCollapsed = {};
let currentTomorrowGroups = [];
let currentTomorrowRecommendations = {}; // itemId -> {qty, avg, reason}
let currentTomorrowTodayReceived = {}; // itemId -> receivedQty
let currentTomorrowTodayRemaining = {}; // itemId -> remainingQty
let currentTomorrowTodaySales = {}; // category -> soldQty
let tomorrowActiveFilter = "all"; // 'all', 'unfilled', 'protein', 'sauce'
let currentTomorrowExtraItems = [];
let currentTomorrowRemovedIds = new Set();

function getAllTomorrowActiveItems() {
  const branch = currentTomorrowBranch || Branch.get();
  const itemsMap = new Map();

  // 1. الأصناف الأساسية من Items.current
  (Items.current || []).forEach(it => {
    const branches = itemBranches(it);
    if (branches.length && branch && !branches.includes(branch)) return;
    itemsMap.set(it.id, { ...it });
  });

  // 2. الأصناف المستلمة اليوم من الاستلام (تشمل أي صنف إضافي أضافه الشيف أو الفرع)
  Object.keys(currentTomorrowTodayReceived).forEach(id => {
    if (!itemsMap.has(id)) {
      const itemDef = Items.byId(id);
      itemsMap.set(id, {
        id: id,
        name: itemDef ? itemDef.name : id,
        unit: itemDef ? itemDef.unit : "جرام",
        category: itemDef ? itemDef.category : "عام",
        isCustom: true,
        branches: branch
      });
    }
  });

  // 3. الأصناف المتبقية الليلة
  Object.keys(currentTomorrowTodayRemaining).forEach(id => {
    if (!itemsMap.has(id)) {
      const itemDef = Items.byId(id);
      itemsMap.set(id, {
        id: id,
        name: itemDef ? itemDef.name : id,
        unit: itemDef ? itemDef.unit : "جرام",
        category: itemDef ? itemDef.category : "عام",
        isCustom: true,
        branches: branch
      });
    }
  });

  // 4. الأصناف الإضافية الخاصة بطلبية الغد
  currentTomorrowExtraItems.forEach(it => {
    if (!itemsMap.has(it.id)) itemsMap.set(it.id, { ...it });
  });

  // 5. استبعاد الأصناف المحذوفة
  const result = [];
  itemsMap.forEach((item, id) => {
    if (currentTomorrowRemovedIds.has(id)) return;
    result.push(item);
  });

  return result;
}

function isTomorrowItemFilled(id) {
  const e = currentTomorrowOrder[id];
  return !!(e && e.qty !== "" && e.qty !== null && e.qty !== undefined && Number(e.qty) >= 0);
}

function setTomorrowFilter(filterName) {
  tomorrowActiveFilter = filterName;
  document.querySelectorAll(".tom-filter-chip").forEach(el => {
    el.classList.toggle("active", el.dataset.filter === filterName);
  });
  filterTomorrowCardsUI();
}

function filterTomorrowCardsUI() {
  document.querySelectorAll(".tomorrow-item-card").forEach(card => {
    const isFilled = card.dataset.filled === "true";
    const isProtein = card.dataset.isprotein === "true";
    const isSauce = card.dataset.issauce === "true";

    let visible = true;
    if (tomorrowActiveFilter === "unfilled") {
      visible = !isFilled;
    } else if (tomorrowActiveFilter === "protein") {
      visible = isProtein;
    } else if (tomorrowActiveFilter === "sauce") {
      visible = isSauce;
    }
    card.style.display = visible ? "" : "none";
  });

  document.querySelectorAll(".category-section-tom").forEach(sec => {
    const visibleCards = sec.querySelectorAll('.tomorrow-item-card:not([style*="display: none"])');
    sec.style.display = visibleCards.length > 0 ? "" : "none";
  });
}

function renderTomorrowView() {
  const view = document.getElementById("tomorrowView");
  if (!view) return;
  view.innerHTML = "";

  const myBranches = allowedBranchList();
  const branchLocked = myBranches.length <= 1;
  const ro = Auth.isViewOnlyTomorrow() ? "disabled" : "";

  // تجميع الإحصائيات
  const allActiveItems = getAllTomorrowActiveItems();
  const totalItems = allActiveItems.length;
  const filledItems = allActiveItems.filter(it => isTomorrowItemFilled(it.id)).length;
  let totalRequestedWeight = 0;
  let totalEstimatedMeals = 0;

  allActiveItems.forEach(it => {
    const ord = currentTomorrowOrder[it.id];
    if (ord && ord.qty) {
      const q = Number(ord.qty);
      if (!isNaN(q) && q > 0) {
        if (isMealCategory(it.category) || (it.unit && (it.unit.includes("جرام") || it.unit.includes("جم")))) {
          totalRequestedWeight += q;
          totalEstimatedMeals += mealsCount(q);
        }
      }
    }
  });

  const headerCard = document.createElement("div");
  headerCard.className = "tomorrow-mobile-header";
  headerCard.innerHTML = `
    <div class="tom-top-row">
      <div>
        <h2 class="tom-main-title">📋 إعداد طلبية المطبخ المركزي</h2>
        <span class="tom-date-subtitle">📅 ليوم: ${currentTomorrowDate} | بناءً على مبيعات وجرد متبقي الليلة</span>
      </div>
      <div class="branch-selector-wrap">
        ${branchLocked
          ? `<div class="readonly-field">${myBranches[0] || "لا يوجد فرع"}</div>`
          : `<select id="tomorrowBranchSelect" onchange="onTomorrowBranchChanged(this.value)">${branchOptionsHtml(currentTomorrowBranch)}</select>`}
      </div>
    </div>

    <!-- كروت إحصائيات الطلبية السريعة -->
    <div class="rem-stats-row">
      <div class="rem-stat-pill">
        <span class="rem-stat-num">${filledItems}/${totalItems}</span>
        <span class="rem-stat-lbl">أصناف محددة</span>
      </div>
      <div class="rem-stat-pill ok">
        <span class="rem-stat-num">${Math.round(totalRequestedWeight / 1000)} كجم</span>
        <span class="rem-stat-lbl">إجمالي وزن البروتين</span>
      </div>
      <div class="rem-stat-pill">
        <span class="rem-stat-num">${totalEstimatedMeals}</span>
        <span class="rem-stat-lbl">إجمالي الوجبات التقديرية</span>
      </div>
    </div>

    <!-- أزرار الإجراءات الفائقة السرعة للمالك -->
    <div class="tom-quick-actions-bar">
      ${!Auth.isViewOnlyTomorrow() ? `
        <button type="button" class="tom-ai-btn" onclick="applyAllAiRecommendations()">
          ⚡ تطبيق كل المقترحات الذكية
        </button>
      ` : ''}
      <button type="button" class="tom-whatsapp-btn" onclick="exportTomorrowOrderWhatsApp()">
        📱 إرسال الطلبية للمطبخ (واتساب)
      </button>
      ${renderCompactToggleBtnHtml()}
    </div>

    <!-- فلاتر سريعة للتركيز -->
    <div class="rec-filters-scroll">
      <button type="button" class="rec-filter-chip tom-filter-chip ${tomorrowActiveFilter === 'all' ? 'active' : ''}" data-filter="all" onclick="setTomorrowFilter('all')">
        الكل (${totalItems})
      </button>
      <button type="button" class="rec-filter-chip tom-filter-chip ${tomorrowActiveFilter === 'unfilled' ? 'active' : ''}" data-filter="unfilled" onclick="setTomorrowFilter('unfilled')">
        ⏳ لم يُطلب بعد (${totalItems - filledItems})
      </button>
      <button type="button" class="rec-filter-chip tom-filter-chip ${tomorrowActiveFilter === 'protein' ? 'active' : ''}" data-filter="protein" onclick="setTomorrowFilter('protein')">
        🍗 دجاج ولحوم
      </button>
      <button type="button" class="rec-filter-chip tom-filter-chip ${tomorrowActiveFilter === 'sauce' ? 'active' : ''}" data-filter="sauce" onclick="setTomorrowFilter('sauce')">
        🥣 صوصات
      </button>
    </div>
  `;
  view.appendChild(headerCard);

  if (!allActiveItems.length) {
    view.insertAdjacentHTML("beforeend", '<div class="empty-state">لا توجد أصناف مسجلة.</div>');
    return;
  }

  const sortedItems = allActiveItems.slice().sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const groups = [];
  sortedItems.forEach(item => {
    const last = groups[groups.length - 1];
    if (last && last.category === item.category) last.items.push(item);
    else groups.push({ category: item.category, items: [item] });
  });

  groups.forEach(group => {
    const section = document.createElement("div");
    section.className = "category-section category-section-tom";
    section.dataset.cat = group.category;
    if (tomorrowCategoryCollapsed[group.category]) section.classList.add("collapsed");

    const filledInCat = group.items.filter(it => isTomorrowItemFilled(it.id)).length;

    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `
      <span class="cat-label">${categoryIconSticker(group.category)} ${group.category}</span>
      <span class="cat-count-badge">
        <span class="cat-count">${filledInCat}/${group.items.length}</span>
        <span class="chevron">▾</span>
      </span>
    `;
    header.addEventListener("click", () => {
      tomorrowCategoryCollapsed[group.category] = !tomorrowCategoryCollapsed[group.category];
      section.classList.toggle("collapsed", !!tomorrowCategoryCollapsed[group.category]);
    });
    section.appendChild(header);

    const body = document.createElement("div");
    body.className = "category-body";
    const inner = document.createElement("div");
    body.appendChild(inner);
    section.appendChild(body);

    group.items.forEach(item => {
      const entry = currentTomorrowOrder[item.id] || { qty: "", notes: "" };
      const rec = currentTomorrowRecommendations[item.id];
      const todayRec = currentTomorrowTodayReceived[item.id];
      const todayRem = currentTomorrowTodayRemaining[item.id];
      const isProtein = isMealCategory(item.category) || (item.unit && (item.unit.includes("جرام") || item.unit.includes("جم") || item.unit.includes("كجم")));
      const isSauce = (item.name && item.name.includes("صوص")) || (item.category && item.category.includes("صوص"));
      const isFilled = isTomorrowItemFilled(item.id);

      // حساب الاقتراح الذكي إن لم يتوفر من التوقع
      let smartSuggestedQty = rec ? rec.qty : "";
      let suggestReason = rec ? rec.reason : "";
      if (!smartSuggestedQty && isProtein && todayRem !== undefined) {
        // اقتراح تلقائي: تعويض استهلاك اليوم مع حد أمان 15%
        const todayUsedGrams = (todayRec ? Number(todayRec) : 0) - (todayRem ? Number(todayRem) : 0);
        if (todayUsedGrams > 0) {
          smartSuggestedQty = Math.round(todayUsedGrams * 1.15);
          suggestReason = "تعويض استهلاك اليوم + 15% أمان";
        }
      }

      const card = document.createElement("div");
      card.className = "item-card tomorrow-item-card";
      card.id = "tomcard-" + item.id;
      card.dataset.itemId = item.id;
      card.dataset.filled = String(isFilled);
      card.dataset.isprotein = String(isProtein);
      card.dataset.issauce = String(isSauce);

      card.innerHTML = `
        <!-- رأس الصنف -->
        <div class="rec-card-header">
          <div class="rec-item-title-wrap">
            <span class="rec-item-name">${item.name}</span>
            <span class="rec-item-unit">(${item.unit || "جرام"})</span>
            ${item.isCustom ? '<span class="badge ok rec-custom-badge">إضافي</span>' : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${isFilled ? '<span class="badge ok" style="font-size:11px;">✅ تم التحديد</span>' : '<span class="badge neutral" style="font-size:11px;">لم يحدد</span>'}
            <button type="button" class="rec-btn-remove" ${ro} onclick="onRemoveTomorrowItem('${item.id}', '${String(item.name).replace(/'/g, "\\'")}')" title="استبعاد الصنف من طلبية الغد">✕</button>
          </div>
        </div>

        <!-- مصفوفة الوضع التشغيلي اليومي -->
        <div class="tom-matrix-row">
          <div class="tom-matrix-cell">
            <span class="tom-matrix-val">${todayRec !== undefined && todayRec !== null ? Math.round(Number(todayRec)) : '—'}</span>
            <span class="tom-matrix-lbl">المستلم اليوم</span>
          </div>
          <div class="tom-matrix-cell">
            <span class="tom-matrix-val">${todayRem !== undefined && todayRem !== null ? Math.round(Number(todayRem)) : '—'}</span>
            <span class="tom-matrix-lbl">المتبقي الليلة</span>
          </div>
          <div class="tom-matrix-cell" style="grid-column: span 2; background:#FFFDE7; border-radius:6px; padding:2px 4px;">
            <span class="tom-matrix-val text-orange">🤖 المقترح: ${smartSuggestedQty || '—'}</span>
            <span class="tom-matrix-lbl">${suggestReason || 'بناءً على الاستهلاك والمتبقي'}</span>
          </div>
        </div>

        <!-- سطر إدخال الكمية المطلوبة للجوال -->
        <div class="rec-input-action-row">
          <div class="rec-input-wrapper">
            <input type="number" inputmode="decimal" min="0" step="any"
                   id="tominput-${item.id}"
                   data-id="${item.id}" data-field="qty"
                   value="${entry.qty}" 
                   placeholder="0"
                   ${ro}
                   class="rec-main-input ${isFilled ? 'border-green' : ''}">
            <span class="rec-input-unit-label">${item.unit || "جم"}</span>
          </div>

          <div class="rec-inline-btns">
            ${smartSuggestedQty ? `
              <button type="button" class="rec-btn-quick match" ${ro} onclick="onQuickSetTomorrowSuggested('${item.id}', ${smartSuggestedQty})">
                = المقترح
              </button>
            ` : ''}
            <button type="button" class="rec-btn-quick zero" ${ro} onclick="onQuickSetTomorrowZero('${item.id}')">
              0 (لا يلزم)
            </button>
          </div>
        </div>

        <!-- أزرار الزيادة السريعة المريحة للأوزان والأعداد -->
        <div class="rec-stepper-chips-row">
          ${isProtein ? `
            <button type="button" class="rec-step-chip" ${ro} onclick="onQuickTomorrowIncrement('${item.id}', 1000)">+1 كجم</button>
            <button type="button" class="rec-step-chip" ${ro} onclick="onQuickTomorrowIncrement('${item.id}', 5000)">+5 كجم</button>
            <button type="button" class="rec-step-chip" ${ro} onclick="onQuickTomorrowIncrement('${item.id}', 10000)">+10 كجم</button>
            <button type="button" class="rec-step-chip" ${ro} onclick="onQuickTomorrowIncrement('${item.id}', 20000)">+20 كجم</button>
            <button type="button" class="rec-step-chip clear" ${ro} onclick="onQuickTomorrowClear('${item.id}')">✕ مسح</button>
          ` : `
            <button type="button" class="rec-step-chip" ${ro} onclick="onQuickTomorrowIncrement('${item.id}', 5)">+5</button>
            <button type="button" class="rec-step-chip" ${ro} onclick="onQuickTomorrowIncrement('${item.id}', 10)">+10</button>
            <button type="button" class="rec-step-chip" ${ro} onclick="onQuickTomorrowIncrement('${item.id}', 20)">+20</button>
            <button type="button" class="rec-step-chip" ${ro} onclick="onQuickTomorrowIncrement('${item.id}', 50)">+50</button>
            <button type="button" class="rec-step-chip clear" ${ro} onclick="onQuickTomorrowClear('${item.id}')">✕ مسح</button>
          `}
        </div>

        <div class="notes-row" style="margin-top:6px;">
          <input type="text" placeholder="ملاحظة للمطبخ المركزي (تقطيع خاص، توصيل مبكر...)" 
                 data-id="${item.id}" data-field="notes" 
                 value="${entry.notes || ""}" ${ro}
                 class="rec-note-input">
        </div>
      `;

      inner.appendChild(card);
    });

    if (!Auth.isViewOnlyTomorrow()) {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "rec-add-item-btn";
      addBtn.textContent = `➕ إضافة صنف في قسم (${group.category})`;
      addBtn.onclick = () => openAddTomorrowItemModal(group.category);
      inner.appendChild(addBtn);
    }

    view.appendChild(section);
  });

  if (!Auth.isViewOnlyTomorrow()) {
    view.querySelectorAll("input[data-field]").forEach(inp => {
      inp.addEventListener("input", onTomorrowFieldChange);
    });
  }

  currentTomorrowGroups = groups;
  filterTomorrowCardsUI();
}

function onTomorrowBranchChanged(val) {
  currentTomorrowBranch = val;
  Branch.set(val);
  loadTomorrowOrder(currentTomorrowDate);
}

// ---- تفاعلات سريعة للطلبية ----

function onQuickSetTomorrowSuggested(itemId, val) {
  const inp = document.getElementById("tominput-" + itemId);
  if (inp) {
    inp.value = val;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function onQuickSetTomorrowZero(itemId) {
  const inp = document.getElementById("tominput-" + itemId);
  if (inp) {
    inp.value = "0";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function onQuickTomorrowClear(itemId) {
  const inp = document.getElementById("tominput-" + itemId);
  if (inp) {
    inp.value = "";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function onQuickTomorrowIncrement(itemId, delta) {
  const inp = document.getElementById("tominput-" + itemId);
  if (inp) {
    const cur = Number(inp.value || 0);
    const n = Math.max(0, cur + delta);
    inp.value = n;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function applyAllAiRecommendations() {
  if (Auth.isViewOnlyTomorrow()) return;
  let appliedCount = 0;
  const allActiveItems = getAllTomorrowActiveItems();
  allActiveItems.forEach(item => {
    let targetVal = null;
    const rec = currentTomorrowRecommendations[item.id];
    if (rec && rec.qty) {
      targetVal = rec.qty;
    } else {
      const todayRec = currentTomorrowTodayReceived[item.id];
      const todayRem = currentTomorrowTodayRemaining[item.id];
      const isProtein = isMealCategory(item.category) || (item.unit && (item.unit.includes("جرام") || item.unit.includes("جم")));
      if (isProtein && todayRem !== undefined) {
        const todayUsedGrams = (todayRec ? Number(todayRec) : 0) - (todayRem ? Number(todayRem) : 0);
        if (todayUsedGrams > 0) targetVal = Math.round(todayUsedGrams * 1.15);
      }
    }

    if (targetVal !== null) {
      if (!currentTomorrowOrder[item.id]) currentTomorrowOrder[item.id] = { qty: "", notes: "" };
      currentTomorrowOrder[item.id].qty = String(targetVal);
      const inp = document.getElementById("tominput-" + item.id);
      if (inp) inp.value = String(targetVal);
      appliedCount++;
    }
  });

  saveTomorrowNow(false);
  renderTomorrowView();
  showToast(`✨ تم تطبيق المقترحات على ${appliedCount} صنف بنجاح!`);
}

// ---- تصدير مباشر للمطبخ المركزي عبر واتساب ----
function exportTomorrowOrderWhatsApp() {
  const branchName = currentTomorrowBranch || Branch.get() || "الفرع الرئيسي";
  const empName = (Auth.getEmployee() || {}).name || "المدير";

  const allActiveItems = getAllTomorrowActiveItems();
  const orderedItems = allActiveItems
    .filter(it => currentTomorrowOrder[it.id] && currentTomorrowOrder[it.id].qty !== "" && Number(currentTomorrowOrder[it.id].qty) > 0)
    .map(it => ({
      name: it.name,
      category: it.category || "عام",
      unit: it.unit || "جرام",
      qty: currentTomorrowOrder[it.id].qty,
      notes: currentTomorrowOrder[it.id].notes || ""
    }));

  if (!orderedItems.length) {
    showToast("⚠️ لم تقم بتحديد أي كميات بعد في الطلبية!");
    return;
  }

  // تجميع حسب التصنيف
  const byCat = {};
  let totalProteinGrams = 0;
  orderedItems.forEach(it => {
    if (!byCat[it.category]) byCat[it.category] = [];
    byCat[it.category].push(it);
    if (isMealCategory(it.category) || it.unit.includes("جرام") || it.unit.includes("جم")) {
      totalProteinGrams += Number(it.qty || 0);
    }
  });

  let msg = `*📋 طلبية المطبخ المركزي - ${branchName}*\n`;
  msg += `📅 *تاريخ الاستلام:* ${currentTomorrowDate}\n`;
  msg += `👤 *المسؤول:* ${empName}\n`;
  if (totalProteinGrams > 0) {
    msg += `⚖️ *إجمالي البروتين:* ${Math.round(totalProteinGrams / 1000)} كجم (≈ ${mealsCount(totalProteinGrams)} وجبة)\n`;
  }
  msg += `--------------------------------\n`;

  Object.keys(byCat).forEach(cat => {
    msg += `*[${cat}]*\n`;
    byCat[cat].forEach(it => {
      msg += `• ${it.name}: *${it.qty}* ${it.unit}`;
      if (it.notes) msg += ` _(${it.notes})_`;
      msg += `\n`;
    });
    msg += `\n`;
  });

  msg += `--------------------------------\n`;
  msg += `✅ معتمدة آلياً عبر نظام Pro House التشغيلي`;

  const encoded = encodeURI(msg);
  const waUrl = `https://api.whatsapp.com/send?text=${encoded}`;
  window.open(waUrl, "_blank");
}

function onTomorrowFieldChange(e) {
  const id = e.target.dataset.id;
  const field = e.target.dataset.field;
  if (!currentTomorrowOrder[id]) currentTomorrowOrder[id] = { qty: "", notes: "" };

  if (field === "qty" && e.target.value !== "" && Number(e.target.value) < 0) {
    e.target.value = "";
    showToast("الكمية ما بتكون بالسالب");
  }

  currentTomorrowOrder[id][field] = e.target.value;

  const card = document.getElementById("tomcard-" + id);
  if (card) {
    card.dataset.filled = String(isTomorrowItemFilled(id));
    const badge = card.querySelector(".rec-card-header .badge");
    if (badge) {
      const f = isTomorrowItemFilled(id);
      badge.className = "badge " + (f ? "ok" : "neutral");
      badge.textContent = f ? "✅ تم التحديد" : "لم يحدد";
    }
  }

  scheduleTomorrowAutoSave();
}

async function loadTomorrowOrder(dateStr) {
  currentTomorrowBranch = Branch.get();
  const myBranches = allowedBranchList();
  if (myBranches.length === 1 && currentTomorrowBranch !== myBranches[0]) currentTomorrowBranch = myBranches[0];
  if (currentTomorrowBranch && !Auth.canSeeAllBranches() && !myBranches.includes(currentTomorrowBranch)) currentTomorrowBranch = myBranches[0] || "";
  Branch.set(currentTomorrowBranch);
  await Items.load();

  if (!currentTomorrowBranch) {
    currentTomorrowOrder = {};
    renderTomorrowView();
    const st = document.getElementById("tomorrowStatus");
    if (st) st.textContent = "اختر الفرع أولاً";
    return;
  }

  const view = document.getElementById("tomorrowView");
  if (view) view.innerHTML = '<div class="loader"><div class="spinner"></div> جاري تحميل بيانات اليوم واقتراحات المطبخ…</div>';
  currentTomorrowOrder = {};

  // جلب طلبية الغد المحفوظة
  const cacheKey = "tomorrow:" + dateStr + ":" + currentTomorrowBranch;
  const data = await Sync.get("getTomorrowOrder", { date: dateStr, branch: currentTomorrowBranch }, cacheKey, applyTomorrowData);
  applyTomorrowData(data);

  // جلب بيانات اليوم (استلام ومتبقي) لحساب المقترحات التشغيلية الدقيقة
  const today = todayStr();
  try {
    const [todayRec, todayRem, aiRec] = await Promise.all([
      Sync.get("getDay", { date: today, branch: currentTomorrowBranch }, "day:" + today + ":" + currentTomorrowBranch).catch(() => null),
      Sync.get("getRemainingReport", { date: today, branch: currentTomorrowBranch }, "remaining:" + today + ":" + currentTomorrowBranch).catch(() => null),
      ForecastEngine.getRecommendations(dateStr, currentTomorrowBranch).catch(() => ({}))
    ]);

    currentTomorrowTodayReceived = {};
    if (todayRec && todayRec.items) {
      todayRec.items.forEach(it => { currentTomorrowTodayReceived[it.itemId] = it.received; });
    }

    currentTomorrowTodayRemaining = {};
    if (todayRem && todayRem.items) {
      todayRem.items.forEach(it => { currentTomorrowTodayRemaining[it.itemId] = it.remainingWeight || it.remaining; });
    }

    currentTomorrowRecommendations = aiRec || {};
  } catch (e) {
    console.warn("تعذر جلب بيانات اليوم المقارنة:", e);
  }

  renderTomorrowView();
  const hasData = Object.keys(currentTomorrowOrder).length > 0;
  const st = document.getElementById("tomorrowStatus");
  if (st) {
    st.textContent = hasData ? "تم تحميل طلبية محفوظة لهذا اليوم لهذا الفرع" : "لسا ما فيه طلبية محفوظة لهذا اليوم لهذا الفرع";
  }
}

function applyTomorrowData(list) {
  if (!list || !list.length) return;
  const map = {};
  list.forEach(it => { 
    map[it.itemId] = { qty: it.qty, notes: it.notes }; 
    if (!Items.byId(it.itemId) && !currentTomorrowExtraItems.some(x => x.id === it.itemId)) {
      currentTomorrowExtraItems.push({
        id: it.itemId,
        name: it.itemName || it.name || it.itemId,
        unit: it.unit || "جرام",
        category: it.category || "عام",
        isCustom: true
      });
    }
  });
  currentTomorrowOrder = map;
}

function saveTomorrowNow(showStatus) {
  if (Auth.isViewOnlyTomorrow()) return;

  const employeeName = (Auth.getEmployee() || {}).name || "";
  const branch = currentTomorrowBranch || "";

  const allActiveItems = getAllTomorrowActiveItems();
  const items = allActiveItems
    .filter(it => currentTomorrowOrder[it.id] && currentTomorrowOrder[it.id].qty !== "")
    .map(it => ({ 
      itemId: it.id, 
      itemName: it.name, 
      unit: it.unit || "جرام", 
      category: it.category || "عام",
      isCustom: !!it.isCustom,
      qty: currentTomorrowOrder[it.id].qty, 
      notes: currentTomorrowOrder[it.id].notes || "" 
    }));

  const payload = { 
    date: currentTomorrowDate, 
    branch, 
    employeeName, 
    items, 
    removedItemIds: Array.from(currentTomorrowRemovedIds),
    notify: !!showStatus 
  };
  Sync.enqueue("saveTomorrowOrder:" + currentTomorrowDate + ":" + branch, "saveTomorrowOrder", payload);
  Sync.cacheSet("tomorrow:" + currentTomorrowDate + ":" + branch, items);

  const missing = [];
  if (!branch) missing.push("الفرع");
  const savedAtText = new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
  const st = document.getElementById("tomorrowStatus");
  if (st) {
    st.textContent = missing.length
      ? `✅ محفوظ (بدون ${missing.join(" و")} — كمّلهم أول ما تقدر) — ${savedAtText}`
      : "✅ محفوظ — بتتزامن " + savedAtText;
  }
  if (showStatus) showToast("تم حفظ طلبية الغد بنجاح!");
}

let tomorrowAutoSaveTimer = null;
function scheduleTomorrowAutoSave() {
  const st = document.getElementById("tomorrowStatus");
  if (st) st.textContent = "جاري الحفظ...";
  clearTimeout(tomorrowAutoSaveTimer);
  tomorrowAutoSaveTimer = setTimeout(() => saveTomorrowNow(false), 800);
}

function initTomorrowTab() {
  const dateInput = document.getElementById("tomorrowDateInput");
  if (dateInput) {
    dateInput.value = currentTomorrowDate;
    dateInput.addEventListener("change", (e) => {
      currentTomorrowDate = e.target.value;
      loadTomorrowOrder(currentTomorrowDate);
    });
  }

  const saveBtn = document.getElementById("tomorrowSaveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => saveTomorrowNow(true));
  }

  loadTomorrowOrder(currentTomorrowDate);
}


// ---- وظائف إزالة وإضافة الأصناف في طلبية الغد ----

function onRemoveTomorrowItem(itemId, itemName) {
  if (Auth.isViewOnlyTomorrow()) return;
  const confirmed = confirm(`هل أنت متأكد من استبعاد الصنف "${itemName || ''}" من طلبية الغد؟`);
  if (!confirmed) return;

  currentTomorrowRemovedIds.add(itemId);
  currentTomorrowExtraItems = currentTomorrowExtraItems.filter(it => it.id !== itemId);
  delete currentTomorrowOrder[itemId];

  showToast(`🗑️ تم استبعاد الصنف من طلبية الغد`);
  renderTomorrowView();
  saveTomorrowNow(false);
}

function openAddTomorrowItemModal(category) {
  if (Auth.isViewOnlyTomorrow()) return;
  const existingModal = document.getElementById("customTomorrowModal");
  if (existingModal) existingModal.remove();

  const modalHtml = `
    <div class="custom-rec-modal-backdrop" id="customTomorrowModal" onclick="if(event.target===this) closeAddTomorrowItemModal()">
      <div class="custom-rec-modal-box">
        <div class="custom-rec-modal-header">
          <h3>➕ إضافة صنف لطلبية قسم (${category})</h3>
          <button type="button" class="custom-rec-modal-close" onclick="closeAddTomorrowItemModal()">✕</button>
        </div>
        <div class="custom-rec-modal-body">
          <div class="custom-rec-field-group">
            <label>اسم الصنف المطلوب من المطبخ *</label>
            <input type="text" id="customTomItemName" placeholder="مثال: صوص باربكيو مدخن، خبز بريوش إضافي..." autofocus>
          </div>
          <div class="custom-rec-field-group">
            <label>وحدة القياس</label>
            <select id="customTomItemUnit">
              <option value="جرام" selected>جرام (جم)</option>
              <option value="كجم">كيلو جرام (كجم)</option>
              <option value="حبة">حبة</option>
              <option value="علبة">علبة</option>
              <option value="لتر">لتر</option>
            </select>
          </div>
          <div class="custom-rec-field-group">
            <label>الكمية المطلوبة للغد *</label>
            <input type="number" step="any" min="0" inputmode="decimal" id="customTomItemQty" placeholder="0">
          </div>
          <div class="custom-rec-field-group">
            <label>ملاحظة للمطبخ المركزي (اختياري)</label>
            <input type="text" id="customTomItemNotes" placeholder="مثال: توصيل مع الدفعة الأولى...">
          </div>
          <div class="custom-rec-modal-actions">
            <button type="button" class="btn-save" onclick="confirmAddTomorrowItem('${String(category).replace(/'/g, "\\'")}')">✅ إضافة للطلبية</button>
            <button type="button" class="btn-cancel" onclick="closeAddTomorrowItemModal()">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);
  setTimeout(() => {
    const input = document.getElementById("customTomItemName");
    if (input) input.focus();
  }, 100);
}

function closeAddTomorrowItemModal() {
  const modal = document.getElementById("customTomorrowModal");
  if (modal) modal.remove();
}

function confirmAddTomorrowItem(category) {
  const nameInput = document.getElementById("customTomItemName");
  const unitInput = document.getElementById("customTomItemUnit");
  const qtyInput = document.getElementById("customTomItemQty");
  const notesInput = document.getElementById("customTomItemNotes");

  const name = (nameInput?.value || "").trim();
  const unit = unitInput?.value || "جرام";
  const qty = (qtyInput?.value || "").trim();
  const notes = (notesInput?.value || "").trim();

  if (!name) {
    alert("يرجى كتابة اسم الصنف أولاً!");
    if (nameInput) nameInput.focus();
    return;
  }

  const newCustomId = "custom_tom_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  const newItem = {
    id: newCustomId,
    name: name,
    unit: unit,
    category: category,
    branches: currentTomorrowBranch || Branch.get(),
    isCustom: true
  };

  currentTomorrowExtraItems.push(newItem);
  currentTomorrowOrder[newCustomId] = {
    qty: qty !== "" ? String(qty) : "",
    notes: notes || "صنف إضافي لطلبية الغد"
  };

  try {
    Items.save({
      id: newCustomId,
      name: name,
      unit: unit,
      category: category,
      branches: currentTomorrowBranch || Branch.get(),
      isCustom: true
    });
  } catch (err) {
    console.warn("تعذر حفظ الصنف المشترك:", err);
  }

  closeAddTomorrowItemModal();
  showToast(`✅ تم إضافة صنف "${name}" إلى طلبية قسم ${category}`);
  renderTomorrowView();
  saveTomorrowNow(false);
}
