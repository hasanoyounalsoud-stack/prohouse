// ==================== شاشة طلبية الغد (مع دعم الذكاء الاصطناعي والتوقع التلقائي) ====================
// ملاحظة: هاي الشاشة تعرض كل الأصناف دايماً بغض النظر عن فلترة الفروع (الفلترة تخص شاشة الاستلام بس)

let currentTomorrowDate = addDaysStr(todayStr(), 1);
let currentTomorrowOrder = {}; // itemId -> {qty, notes}
let currentTomorrowBranch = "";
let tomorrowCategoryCollapsed = {};
let currentTomorrowGroups = [];
let currentTomorrowRecommendations = {}; // itemId -> {qty, avg, reason}

function isTomorrowItemFilled(id) {
  const e = currentTomorrowOrder[id];
  return !!(e && e.qty !== "" && e.qty !== null && e.qty !== undefined);
}

function renderTomorrowView() {
  const view = document.getElementById("tomorrowView");
  if (!view) return;
  view.innerHTML = "";

  const myBranches = allowedBranchList();
  const branchLocked = myBranches.length <= 1;
  const ro = Auth.isViewOnlyTomorrow() ? "disabled" : "";

  const metaCard = document.createElement("div");
  metaCard.className = "item-card";
  metaCard.innerHTML = `
    <div class="inputs-row">
      <div class="field">
        <label>الموظف</label>
        <div class="readonly-field">${Auth.getEmployee() ? Auth.getEmployee().name : ""}</div>
      </div>
      <div class="field">
        <label>الفرع</label>
        ${branchLocked
          ? `<div class="readonly-field">${myBranches[0] || "لا يوجد فرع مرتبط بحسابك"}</div>`
          : `<select id="tomorrowBranchSelect">${branchOptionsHtml(currentTomorrowBranch)}</select>`}
      </div>
    </div>
    ${Auth.isViewOnlyTomorrow() ? '<div class="badges"><span class="badge neutral">👁 عرض فقط — الشيف ما بيعدّل هون</span></div>' : ""}
  `;
  view.appendChild(metaCard);
  if (!branchLocked) {
    document.getElementById("tomorrowBranchSelect").addEventListener("change", (e) => {
      currentTomorrowBranch = e.target.value;
      Branch.set(currentTomorrowBranch);
      loadTomorrowOrder(currentTomorrowDate);
    });
  }

  if (!Items.current.length) {
    view.insertAdjacentHTML("beforeend", '<div class="empty-state">لا يوجد أصناف بعد. ضيف أصناف من تاب "إدارة الأصناف"، أو تأكد إن الباك اند مربوط (js/config.js).</div>');
    return;
  }

  // بطاقة الذكاء الاصطناعي والتوقع التلقائي
  const recCount = Object.keys(currentTomorrowRecommendations).length;
  const aiCard = document.createElement("div");
  aiCard.className = "ai-forecast-card";
  aiCard.innerHTML = `
    <div class="top-line">
      <div class="ai-forecast-title">🤖 اقتراحات الذكاء الاصطناعي ${recCount > 0 ? `(${recCount} صنف)` : ""}</div>
      ${!Auth.isViewOnlyTomorrow() && recCount > 0 ? `<button class="btn gold" id="applyAllAiBtn" style="padding:6px 12px;font-size:12px;">✨ ملء كل المقترحات</button>` : ""}
    </div>
    <div style="font-size:11.5px;color:var(--gray);font-weight:600;">
      ${recCount > 0 ? "يتم احتساب الكميات المقترحة بناءً على متوسط استهلاك نفس اليوم بالأسابيع السابقة + 10% أمان." : "جاري تحليل السجل التاريخي أو لا تتوفر مبيعات سابقة كافية بهذا الفرع."}
    </div>
  `;
  view.appendChild(aiCard);

  if (document.getElementById("applyAllAiBtn")) {
    document.getElementById("applyAllAiBtn").addEventListener("click", applyAllAiRecommendations);
  }

  const progressWrap = document.createElement("div");
  progressWrap.className = "progress-bar-wrap";
  progressWrap.id = "tomorrowProgressWrap";
  view.appendChild(progressWrap);

  const sortedItems = Items.current.slice().sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const groups = [];
  sortedItems.forEach(item => {
    const last = groups[groups.length - 1];
    if (last && last.category === item.category) last.items.push(item);
    else groups.push({ category: item.category, items: [item] });
  });

  groups.forEach(group => {
    const section = document.createElement("div");
    section.className = "category-section";
    section.dataset.cat = group.category;
    if (tomorrowCategoryCollapsed[group.category]) section.classList.add("collapsed");

    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `
      <span class="cat-label">${categoryIconSticker(group.category)} ${group.category}</span>
      <span style="display:flex;align-items:center;">
        <span class="cat-count" id="tomcatcount-${cssId(group.category)}"></span>
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
      const recPillHtml = rec
        ? `<div class="ai-recommendation-pill" data-id="${item.id}" data-qty="${rec.qty}" title="${rec.reason}">
            🤖 المقترح: <strong>${rec.qty}</strong> <span class="ai-hint">(${rec.reason})</span>
           </div>`
        : "";

      const card = document.createElement("div");
      card.className = "item-card";
      card.id = "tomcard-" + item.id;
      card.innerHTML = `
        <div class="item-name">${item.name} <span class="item-unit">(${item.unit})</span></div>
        ${recPillHtml}
        <div class="inputs-row">
          <div class="field">
            <label>الكمية المطلوبة</label>
            <input type="number" inputmode="decimal" min="0" step="any" data-id="${item.id}" data-field="qty" value="${entry.qty}" ${ro}>
          </div>
        </div>
        <div class="notes-row">
          <input type="text" placeholder="ملاحظة (اختياري)" data-id="${item.id}" data-field="notes" value="${entry.notes || ""}" ${ro}>
        </div>
      `;
      inner.appendChild(card);
    });

    view.appendChild(section);
  });

  if (!Auth.isViewOnlyTomorrow()) {
    view.querySelectorAll("input[data-field]").forEach(inp => {
      inp.addEventListener("input", onTomorrowFieldChange);
    });

    view.querySelectorAll(".ai-recommendation-pill").forEach(pill => {
      pill.addEventListener("click", (e) => {
        const targetPill = e.currentTarget;
        const itemId = targetPill.dataset.id;
        const qty = targetPill.dataset.qty;
        const inp = view.querySelector(`input[data-id="${itemId}"][data-field="qty"]`);
        if (inp) {
          inp.value = qty;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          showToast(`تم تعبئة الكمية المقترحة (${qty})`);
        }
      });
    });
  }

  currentTomorrowGroups = groups;
  updateTomorrowCategoryCounts(groups);
  updateTomorrowProgressBar();
}

function applyAllAiRecommendations() {
  if (Auth.isViewOnlyTomorrow()) return;
  let appliedCount = 0;
  Items.current.forEach(item => {
    const rec = currentTomorrowRecommendations[item.id];
    if (rec && rec.qty) {
      if (!currentTomorrowOrder[item.id]) currentTomorrowOrder[item.id] = { qty: "", notes: "" };
      currentTomorrowOrder[item.id].qty = String(rec.qty);
      const inp = document.querySelector(`input[data-id="${item.id}"][data-field="qty"]`);
      if (inp) inp.value = String(rec.qty);
      appliedCount++;
    }
  });
  updateTomorrowProgressBar();
  if (currentTomorrowGroups.length) updateTomorrowCategoryCounts(currentTomorrowGroups);
  scheduleTomorrowAutoSave();
  showToast(`✨ تم تطبيق المقترحات الذكية لـ ${appliedCount} صنف!`);
}

function updateTomorrowCategoryCounts(groups) {
  groups.forEach(group => {
    const el = document.getElementById("tomcatcount-" + cssId(group.category));
    if (!el) return;
    const filled = group.items.filter(it => isTomorrowItemFilled(it.id)).length;
    el.textContent = `${filled}/${group.items.length}`;
  });
}

function updateTomorrowProgressBar() {
  const wrap = document.getElementById("tomorrowProgressWrap");
  if (!wrap) return;
  const total = Items.current.length;
  const filled = Items.current.filter(it => isTomorrowItemFilled(it.id)).length;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  wrap.innerHTML = `
    <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    <div class="progress-bar-label">${filled} صنف طُلب من أصل ${total}</div>
  `;
}

function onTomorrowFieldChange(e) {
  const id = e.target.dataset.id;
  const field = e.target.dataset.field;
  if (!currentTomorrowOrder[id]) currentTomorrowOrder[id] = { qty: "", notes: "" };

  // كمية سالبة ما إلها معنى بطلبية، وكانت بتنحفظ وتوصل لشاشة الاستلام كـ"مطلوب: ‎-37‎".
  // min="0" بالحقل ما بيكفي لأن المتصفح بيسمح بالكتابة المباشرة رغمه.
  if (field === "qty" && e.target.value !== "" && Number(e.target.value) < 0) {
    e.target.value = "";
    showToast("الكمية ما بتكون بالسالب");
  }

  currentTomorrowOrder[id][field] = e.target.value;

  const group = currentTomorrowGroups.find(g => g.items.some(it => it.id === id));
  if (group) updateTomorrowCategoryCounts([group]);
  updateTomorrowProgressBar();

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
    document.getElementById("tomorrowStatus").textContent = "اختر الفرع أولاً";
    return;
  }

  document.getElementById("tomorrowView").innerHTML = '<div class="loader">جاري التحميل وتحليل الذكاء الاصطناعي…</div>';
  currentTomorrowOrder = {};

  await Items.load();

  const cacheKey = "tomorrow:" + dateStr + ":" + currentTomorrowBranch;
  const data = await Sync.get("getTomorrowOrder", { date: dateStr, branch: currentTomorrowBranch }, cacheKey, applyTomorrowData);
  applyTomorrowData(data);

  // جلب توصيات التوقع الذكي
  try {
    currentTomorrowRecommendations = await ForecastEngine.getRecommendations(dateStr, currentTomorrowBranch);
  } catch (err) {
    console.warn("تعذر جلب التوصيات الذكية:", err);
    currentTomorrowRecommendations = {};
  }

  renderTomorrowView();
  const hasData = Object.keys(currentTomorrowOrder).length > 0;
  document.getElementById("tomorrowStatus").textContent = hasData
    ? "تم تحميل طلبية محفوظة لهذا اليوم لهذا الفرع"
    : "لسا ما فيه طلبية محفوظة لهذا اليوم لهذا الفرع";
}

function applyTomorrowData(list) {
  if (!list || !list.length) return;
  const map = {};
  list.forEach(it => { map[it.itemId] = { qty: it.qty, notes: it.notes }; });
  currentTomorrowOrder = map;
}

// حفظ فوري بدون انتظار ضغطة زر — نفس فلسفة شاشة طلبية اليوم
function saveTomorrowNow(showStatus) {
  if (Auth.isViewOnlyTomorrow()) return; // الشيف عرض بس، ما بيحفظ

  const employeeName = (Auth.getEmployee() || {}).name || "";
  const branch = currentTomorrowBranch || "";

  const items = Items.current
    .filter(it => currentTomorrowOrder[it.id] && currentTomorrowOrder[it.id].qty !== "")
    .map(it => ({ itemId: it.id, itemName: it.name, unit: it.unit, qty: currentTomorrowOrder[it.id].qty, notes: currentTomorrowOrder[it.id].notes || "" }));

  // notify بس عند الضغط اليدوي على "حفظ الطلبية" — الحفظ التلقائي ما بيرسل إشعار للشيف،
  // وإلا بيوصله إشعار كل ما حدا يعدّل رقم. والباك اند كمان بيرسل مرة وحدة لكل يوم+فرع.
  const payload = { date: currentTomorrowDate, branch, employeeName, items, notify: !!showStatus };
  Sync.enqueue("saveTomorrowOrder:" + currentTomorrowDate + ":" + branch, "saveTomorrowOrder", payload);
  Sync.cacheSet("tomorrow:" + currentTomorrowDate + ":" + branch, items);

  const missing = [];
  if (!branch) missing.push("الفرع");
  const savedAtText = new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("tomorrowStatus").textContent = missing.length
    ? `✅ محفوظ (بدون ${missing.join(" و")} — كمّلهم أول ما تقدر) — ${savedAtText}`
    : "✅ محفوظ — بتتزامن " + savedAtText;
  if (showStatus) showToast("تم حفظ طلبية الغد");
}

let tomorrowAutoSaveTimer = null;
function scheduleTomorrowAutoSave() {
  document.getElementById("tomorrowStatus").textContent = "جاري الحفظ...";
  clearTimeout(tomorrowAutoSaveTimer);
  tomorrowAutoSaveTimer = setTimeout(() => saveTomorrowNow(false), 900);
}

function initTomorrowTab() {
  const dateInput = document.getElementById("tomorrowDateInput");
  dateInput.value = currentTomorrowDate;
  dateInput.addEventListener("change", (e) => {
    currentTomorrowDate = e.target.value;
    loadTomorrowOrder(currentTomorrowDate);
  });

  document.getElementById("tomorrowSaveBtn").addEventListener("click", () => saveTomorrowNow(true));

  loadTomorrowOrder(currentTomorrowDate);
}
