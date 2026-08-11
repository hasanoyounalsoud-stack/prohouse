// ==================== إدارة الأصناف (قاعدة بيانات الأصناف + شاشة الإدارة) ====================

const Items = (() => {
  let current = [];
  let loadingPromise = null;

  function isActive(it) { return it.active !== false && it.active !== "FALSE"; }

  async function load() {
    if (loadingPromise) return loadingPromise; // يتفادى نداءات متزامنة مكررة (تنادى من إدخال اليوم/طلبية الغد/إدارة الأصناف بنفس الوقت)
    loadingPromise = (async () => {
      const data = await Sync.get("getItems", { all: "1" }, "items_v2", (val) => {
        current = (val || []).filter(isActive);
        renderIfActive();
      });
      if (data) current = data.filter(isActive);
      renderIfActive();
      return current;
    })();
    try { return await loadingPromise; }
    finally { loadingPromise = null; }
  }

  function byId(id) { return current.find(it => it.id === id); }

  function newId() {
    return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2));
  }

  function save(item) {
    if (!item.id) item.id = newId();
    item.hasCustomName = !!item.hasCustomName;
    item.active = true;
    const idx = current.findIndex(it => it.id === item.id);
    if (idx >= 0) current[idx] = { ...current[idx], ...item };
    else current.push(item);
    Sync.cacheSet("items_v2", current);
    Sync.enqueue("saveItem:" + item.id, "saveItem", item);
    return item;
  }

  function remove(id) {
    current = current.filter(it => it.id !== id);
    Sync.cacheSet("items_v2", current);
    Sync.enqueue("deleteItem:" + id, "deleteItem", { id });
  }

  let renderIfActive = () => {};
  function setRenderer(fn) { renderIfActive = fn; }

  return { load, byId, save, remove, newId, get current() { return current; }, setRenderer };
})();

// يعتمد على branchList() المعرّفة بـ js/shared.js (بينحمّل قبل هالملف)
function itemBranches(item) {
  return (item.branches || "").split(",").map(s => s.trim()).filter(Boolean);
}
function branchCheckboxesHtml(selectedBranches) {
  return branchList().map(b => `
    <label class="badge neutral" style="cursor:pointer;">
      <input type="checkbox" value="${b}" ${selectedBranches.includes(b) ? "checked" : ""} style="width:auto;margin-left:4px;">
      ${b}
    </label>
  `).join("");
}
function checkedBranches(container) {
  return [...container.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value).join(",");
}

// غير المالك بيقدر يتحكم بس بأصناف موسومة بفرع واحد من فروعه — بديل عن الـ checkboxes متعددة الاختيار
function branchLockedFieldHtml(inputId, current) {
  const mine = allowedBranchList();
  if (mine.length <= 1) {
    return `<div class="readonly-field">${mine[0] || "لا يوجد فرع مرتبط بحسابك"}</div><input type="hidden" id="${inputId}" value="${mine[0] || ""}">`;
  }
  return `<select id="${inputId}">${mine.map(b => `<option value="${b}" ${b === current ? "selected" : ""}>${b}</option>`).join("")}</select>`;
}

// قائمة تصنيف منسدلة من التصنيفات الموجودة فعلاً (بدون تكرار) + خيار "تصنيف جديد" لو احتجنا
function categorySelectHtml(cats, selected) {
  return `
    <select data-cat-select>
      <option value="">اختر تصنيف</option>
      ${cats.map(c => `<option value="${c}" ${c === selected ? "selected" : ""}>${c}</option>`).join("")}
      <option value="__new__" ${selected && !cats.includes(selected) ? "selected" : ""}>+ تصنيف جديد</option>
    </select>
    <input type="text" data-cat-new class="${selected && !cats.includes(selected) ? "" : "hidden"}" placeholder="اسم التصنيف الجديد" value="${selected && !cats.includes(selected) ? selected : ""}" style="margin-top:6px;">
  `;
}
function wireCategoryGroup(container) {
  const sel = container.querySelector("[data-cat-select]");
  const newInput = container.querySelector("[data-cat-new]");
  sel.addEventListener("change", () => {
    newInput.classList.toggle("hidden", sel.value !== "__new__");
    if (sel.value === "__new__") newInput.focus();
  });
}
function categoryValue(container) {
  const sel = container.querySelector("[data-cat-select]");
  if (sel.value === "__new__") return container.querySelector("[data-cat-new]").value.trim();
  return sel.value;
}

function renderItemsAdminView() {
  const view = document.getElementById("itemsView");
  if (!view || view.classList.contains("hidden")) return;

  const isOwner = Auth.isOwner();
  const mine = allowedBranchList();
  // غير المالك بيشوف بس أصناف موسومة بفرع واحد من فروعه (اللي هو أضافها) — مو الكتالوج المشترك كامل
  const visibleItems = isOwner ? Items.current : Items.current.filter(it => {
    const b = itemBranches(it);
    return b.length === 1 && mine.includes(b[0]);
  });

  // التصنيفات المضبوطة بالإعدادات + المستخدمة فعلاً بالأصناف.
  // الاعتماد على المستخدمة وحدها كان بيعمل حلقة مقفلة: تصنيف مضبوط بالإعدادات (متل "لحم")
  // ما بيظهر بالقائمة لأنه ما في صنف فيه بعد، والطريقة الوحيدة لإنشائه تكون بكتابته يدوياً
  // بـ"+ تصنيف جديد" — وأي خطأ إملائي بيولّد تصنيف شبيه بيكسر حساب الوجبات وترتيب الشاشات.
  const cats = [...new Set([...categoryOrderList(), ...Items.current.map(it => it.category)].filter(Boolean))]
    .sort((a, b) => categoryRank(a) - categoryRank(b));

  view.innerHTML = `
    ${!isOwner ? '<div class="offline-banner">هون بس الأصناف اللي ضفتها إلك لفرعك — الكتالوج المشترك بيديره المالك</div>' : ""}
    <div class="toolbar">
      <button class="btn primary" id="addItemBtn">+ إضافة صنف جديد</button>
    </div>
    <div id="itemAddForm" class="settings-card hidden">
      <h3>صنف جديد</h3>
      <div class="field" id="newCatGroup"><label>التصنيف</label>${categorySelectHtml(cats, "")}</div>
      <div class="field"><label>اسم الصنف</label><input type="text" id="newName"></div>
      <div class="field"><label>الوحدة</label><input type="text" id="newUnit"></div>
      ${isOwner ? `
      <div class="field" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="newCustomName" style="width:auto;">
        <label style="margin:0;" for="newCustomName">اسم الطبخة يُكتب يدوياً كل مرة (مثل دجاج الشيف/لحم الشيف)</label>
      </div>
      <div class="field">
        <label>يظهر بشاشة الاستلام لهاي الفروع بس (اترك الكل بدون تحديد = يظهر عند الكل)</label>
        <div class="badges" id="newBranchChecks">${branchCheckboxesHtml([])}</div>
      </div>` : `
      <div class="field"><label>الفرع</label>${branchLockedFieldHtml("newBranchLocked", mine[0] || "")}</div>`}
      <button class="btn gold" id="saveNewItemBtn">حفظ الصنف</button>
    </div>
    <div id="itemsList"></div>
  `;

  wireCategoryGroup(document.getElementById("newCatGroup"));

  document.getElementById("addItemBtn").addEventListener("click", () => {
    document.getElementById("itemAddForm").classList.toggle("hidden");
  });
  document.getElementById("saveNewItemBtn").addEventListener("click", () => {
    const category = categoryValue(document.getElementById("newCatGroup"));
    const name = document.getElementById("newName").value.trim();
    const unit = document.getElementById("newUnit").value.trim();
    const hasCustomName = isOwner ? document.getElementById("newCustomName").checked : false;
    const branches = isOwner ? checkedBranches(document.getElementById("newBranchChecks")) : document.getElementById("newBranchLocked").value;
    if (!category || !name) { showToast("لازم تعبي التصنيف واسم الصنف"); return; }
    if (!isOwner && !branches) { showToast("ما في فرع مرتبط بحسابك"); return; }
    Items.save({ category, name, unit, hasCustomName, branches, sortOrder: Items.current.length + 1 });
    document.getElementById("itemAddForm").classList.add("hidden");
    renderItemsAdminView();
    showToast("انضاف الصنف");
  });

  const list = document.getElementById("itemsList");
  let lastCat = null;
  visibleItems.slice().sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || Number(a.sortOrder) - Number(b.sortOrder)).forEach(item => {
    if (item.category !== lastCat) {
      list.insertAdjacentHTML("beforeend", `<div class="cat-title">${item.category}</div>`);
      lastCat = item.category;
    }
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <div class="inputs-row">
        <div class="field"><label>الاسم</label><input type="text" data-f="name" value="${item.name}"></div>
        <div class="field"><label>الوحدة</label><input type="text" data-f="unit" value="${item.unit}"></div>
      </div>
      <div class="inputs-row" style="margin-top:8px;">
        <div class="field" data-cat-group><label>التصنيف</label>${categorySelectHtml(cats, item.category)}</div>
      </div>
      ${isOwner ? `
      <div class="badges">
        <label class="badge neutral" style="cursor:pointer;">
          <input type="checkbox" data-f="hasCustomName" ${item.hasCustomName ? "checked" : ""} style="width:auto;margin-left:4px;">
          اسم يدوي كل مرة
        </label>
      </div>
      <div class="field" style="margin-top:8px;">
        <label>يظهر بشاشة الاستلام لهاي الفروع بس (بدون تحديد = يظهر عند الكل)</label>
        <div class="badges" data-branch-checks>${branchCheckboxesHtml(itemBranches(item))}</div>
      </div>` : `
      <div class="field" style="margin-top:8px;"><label>الفرع</label>${branchLockedFieldHtml("editBranchLocked-" + item.id, itemBranches(item)[0] || mine[0] || "")}</div>`}
      <div class="toolbar" style="margin-top:10px;margin-bottom:0;">
        <button class="btn gold" data-act="save">حفظ التعديل</button>
        <button class="btn danger" data-act="del">حذف الصنف</button>
      </div>
    `;
    wireCategoryGroup(card.querySelector("[data-cat-group]"));
    card.querySelector('[data-act="save"]').addEventListener("click", () => {
      const updated = {
        id: item.id,
        name: card.querySelector('[data-f="name"]').value.trim(),
        unit: card.querySelector('[data-f="unit"]').value.trim(),
        category: categoryValue(card.querySelector("[data-cat-group]")),
        hasCustomName: isOwner ? card.querySelector('[data-f="hasCustomName"]').checked : !!item.hasCustomName,
        branches: isOwner ? checkedBranches(card.querySelector('[data-branch-checks]')) : document.getElementById("editBranchLocked-" + item.id).value,
        sortOrder: item.sortOrder
      };
      if (!updated.category || !updated.name) { showToast("لازم تعبي التصنيف واسم الصنف"); return; }
      Items.save(updated);
      showToast("تم حفظ التعديل");
      renderItemsAdminView();
    });
    card.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (!confirm(`متأكد من حذف "${item.name}"؟`)) return;
      Items.remove(item.id);
      renderItemsAdminView();
      showToast("تم حذف الصنف");
    });
    list.appendChild(card);
  });

  if (!visibleItems.length) {
    list.innerHTML = '<div class="empty-state">لا يوجد أصناف بعد.</div>';
  }
}

Items.setRenderer(renderItemsAdminView);
