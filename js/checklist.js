// ==================== إدارة قائمة الفحص والافتتاح اليومي (Daily Shift Checklist) ====================

const Checklist = (() => {
  const DEFAULT_ITEMS = [
    {
      category: "الاستلام والافتتاح",
      icon: "🧊",
      items: [
        { id: "chk_temp", text: "التأكد من درجة حرارة الفريزر والبرودة (-18°C إلى 4°C)" },
        { id: "chk_pkg", text: "فحص سلامة تغليف وتأريخ صلاحية المنتجات المستلمة من المطبخ" },
        { id: "chk_clean", text: "نظافة وتعقيم منطقة التخزين والاستلام وإغلاق الثلاجات بإحكام" }
      ]
    },
    {
      category: "الجرد ومطابقة النظام",
      icon: "📊",
      items: [
        { id: "chk_juices", text: "مطابقة جرد العصيرات الفعلي مع الكميات المسجلة بالنظام" },
        { id: "chk_umm_ali", text: "مطابقة كميات مبيعات أم علي والساندويتشات مع تقرير تابسنس" },
        { id: "chk_today_order", text: "مراجعة واعتماد كميات استلام طلبية اليوم للفرع" }
      ]
    },
    {
      category: "السلامة والتشغيل",
      icon: "🛡️",
      items: [
        { id: "chk_labels", text: "التأكد من وجود ملصقات الصلاحية والتواريخ على الأصناف المحضرة" },
        { id: "chk_waste", text: "توثيق وفصل المنتجات التالفة أو المرتجعة وتسجيل أسبابها" }
      ]
    }
  ];

  function getKey(dateStr, branch, shift) {
    const d = dateStr || new Date().toISOString().split("T")[0];
    const b = branch || (typeof Branch !== "undefined" ? Branch.get() : "default");
    const s = shift || "morning";
    return `prohouse_checklist_${b}_${d}_${s}`;
  }

  function loadData(dateStr, branch, shift) {
    const key = getKey(dateStr, branch, shift);
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("فشل قراءة قائمة الفحص من LocalStorage", e);
    }
    return { checked: {}, notes: "", updatedAt: null, updatedBy: "" };
  }

  function saveData(dateStr, branch, shift, data) {
    const key = getKey(dateStr, branch, shift);
    const emp = typeof Auth !== "undefined" ? Auth.getEmployee() : null;
    data.updatedAt = new Date().toISOString();
    data.updatedBy = emp ? emp.name : "موظف";
    localStorage.setItem(key, JSON.stringify(data));

    // مزامنة أونلاين سحابياً مع سوبابيس لتظهر لكافة الأجهزة
    if (typeof SupaEngine !== "undefined" && SupaEngine.saveChecklist) {
      SupaEngine.saveChecklist({
        date: dateStr,
        branch: branch,
        shift: shift,
        data: data
      }).catch(err => {
        console.warn("Direct checklist save failed, queuing via Sync:", err);
        if (typeof Sync !== "undefined" && Sync.enqueue) {
          Sync.enqueue("chk:" + branch + ":" + dateStr + ":" + shift, "saveChecklist", { date: dateStr, branch, shift, data });
        }
      });
    } else if (typeof Sync !== "undefined" && Sync.enqueue) {
      Sync.enqueue("chk:" + branch + ":" + dateStr + ":" + shift, "saveChecklist", { date: dateStr, branch, shift, data });
    }
    return data;
  }

  function getCompletionStats(dateStr, branch, shift) {
    const data = loadData(dateStr, branch, shift);
    let total = 0;
    let checkedCount = 0;

    DEFAULT_ITEMS.forEach(cat => {
      cat.items.forEach(item => {
        total++;
        if (data.checked[item.id]) checkedCount++;
      });
    });

    const percent = total > 0 ? Math.round((checkedCount / total) * 100) : 0;
    return { total, checkedCount, percent, isComplete: checkedCount === total, data };
  }

  return {
    DEFAULT_ITEMS,
    getKey,
    loadData,
    saveData,
    getCompletionStats
  };
})();

// variables للواجهة
let currentChecklistDate = new Date().toISOString().split("T")[0];
let currentChecklistShift = "morning";

async function renderChecklistView() {
  const container = document.getElementById("checklistView");
  if (!container) return;

  const branch = Branch.get();
  const dateInput = document.getElementById("checklistDateInput");
  if (dateInput) {
    dateInput.value = currentChecklistDate;
  }

  // مزامنة سحابية إذا متوفرة لضمان عرض بيانات الجوال على اللابتوب والعكس
  if (typeof Sync !== "undefined" && Sync.get) {
    try {
      const remote = await Sync.get("getChecklist", { date: currentChecklistDate, branch }, "checklist:" + currentChecklistDate + ":" + branch);
      if (remote && remote[currentChecklistShift]) {
        const key = Checklist.getKey(currentChecklistDate, branch, currentChecklistShift);
        const local = Checklist.loadData(currentChecklistDate, branch, currentChecklistShift);
        if (!local.updatedAt || (remote[currentChecklistShift].updatedAt && new Date(remote[currentChecklistShift].updatedAt) >= new Date(local.updatedAt))) {
          localStorage.setItem(key, JSON.stringify(remote[currentChecklistShift]));
        }
      }
    } catch (e) {
      console.warn("Could not sync remote checklist:", e);
    }
  }

  const data = Checklist.loadData(currentChecklistDate, branch, currentChecklistShift);
  const stats = Checklist.getCompletionStats(currentChecklistDate, branch, currentChecklistShift);

  let html = `
    <div class="checklist-header-card">
      <div class="checklist-header-main">
        <div>
          <h2 class="checklist-title">📋 قائمة الفحص والافتتاح اليومي</h2>
          <div class="checklist-subtitle">فرع: <span class="badge gold">${branch}</span> | التاريخ: <strong>${currentChecklistDate}</strong></div>
        </div>
        <div class="shift-selector">
          <button class="shift-btn ${currentChecklistShift === 'morning' ? 'active' : ''}" onclick="switchChecklistShift('morning')">☀️ شفت الصباح</button>
          <button class="shift-btn ${currentChecklistShift === 'evening' ? 'active' : ''}" onclick="switchChecklistShift('evening')">🌙 شفت المساء</button>
        </div>
      </div>

      <div class="checklist-progress-block">
        <div class="progress-info">
          <span>نسبة إنجاز الفحص: <strong>${stats.percent}%</strong> (${stats.checkedCount} من ${stats.total} مكتملة)</span>
          <span class="badge ${stats.isComplete ? 'green' : (stats.percent > 0 ? 'gold' : 'neutral')}">
            ${stats.isComplete ? '✅ مكتملة بالكامل' : (stats.percent > 0 ? '⏳ قيد التشييك' : '⚪ لم تبدأ بعد')}
          </span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill ${stats.isComplete ? 'complete' : ''}" style="width: ${stats.percent}%"></div>
        </div>
      </div>
    </div>
  `;

  Checklist.DEFAULT_ITEMS.forEach((cat, catIdx) => {
    html += `
      <div class="checklist-category-card">
        <div class="category-header">
          <span class="cat-icon">${cat.icon}</span>
          <h3 class="cat-title">${cat.category}</h3>
        </div>
        <div class="checklist-items-list">
    `;

    cat.items.forEach(item => {
      const isChecked = !!data.checked[item.id];
      html += `
        <label class="checklist-item-row ${isChecked ? 'is-checked' : ''}" for="chk_${item.id}">
          <input type="checkbox" id="chk_${item.id}" data-id="${item.id}" ${isChecked ? 'checked' : ''} onchange="onChecklistItemToggle(this)">
          <div class="custom-checkbox-ui"></div>
          <span class="item-text">${item.text}</span>
        </label>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `
    <div class="checklist-notes-card">
      <h3>📝 ملاحظات الشفت والاستلام</h3>
      <textarea id="checklistNotes" class="checklist-textarea" placeholder="أدخل أي ملاحظات خاصة بالاستلام، الفريزر، أو الأعطال إن وجدت...">${data.notes || ''}</textarea>
      ${data.updatedAt ? `<div class="last-saved-meta">آخر حفظ بواسطة: <strong>${data.updatedBy}</strong> في ${new Date(data.updatedAt).toLocaleTimeString('ar-SA')}</div>` : ''}
    </div>
  `;

  container.innerHTML = html;
  updateChecklistSaveBar(stats);
}

function switchChecklistShift(shift) {
  currentChecklistShift = shift;
  renderChecklistView();
}

function onChecklistItemToggle(inputEl) {
  const row = inputEl.closest(".checklist-item-row");
  if (row) {
    row.classList.toggle("is-checked", inputEl.checked);
  }
  updateChecklistProgressFromDOM();
}

function updateChecklistProgressFromDOM() {
  const branch = Branch.get();
  const checkboxes = document.querySelectorAll("#checklistView input[type='checkbox']");
  let total = checkboxes.length;
  let checkedCount = 0;

  checkboxes.forEach(cb => {
    if (cb.checked) checkedCount++;
  });

  const percent = total > 0 ? Math.round((checkedCount / total) * 100) : 0;
  const isComplete = total > 0 && checkedCount === total;

  const progressFill = document.querySelector("#checklistView .progress-bar-fill");
  const progressInfo = document.querySelector("#checklistView .progress-info strong");
  const statusBadge = document.querySelector("#checklistView .progress-info .badge");

  if (progressFill) {
    progressFill.style.width = `${percent}%`;
    progressFill.classList.toggle("complete", isComplete);
  }
  if (progressInfo) {
    progressInfo.textContent = `${percent}%`;
  }
  if (statusBadge) {
    statusBadge.className = `badge ${isComplete ? 'green' : (percent > 0 ? 'gold' : 'neutral')}`;
    statusBadge.textContent = isComplete ? '✅ مكتملة بالكامل' : (percent > 0 ? '⏳ قيد التشييك' : '⚪ لم تبدأ بعد');
  }

  const saveStatusEl = document.getElementById("checklistStatus");
  if (saveStatusEl) {
    saveStatusEl.textContent = `نسبة الإنجاز الحالي: ${percent}% (${checkedCount} من ${total})`;
  }
}

function saveChecklistData() {
  const branch = Branch.get();
  const checkboxes = document.querySelectorAll("#checklistView input[type='checkbox']");
  const checkedMap = {};

  checkboxes.forEach(cb => {
    checkedMap[cb.dataset.id] = cb.checked;
  });

  const notesEl = document.getElementById("checklistNotes");
  const notes = notesEl ? notesEl.value : "";

  const saved = Checklist.saveData(currentChecklistDate, branch, currentChecklistShift, {
    checked: checkedMap,
    notes: notes
  });

  if (typeof Toast !== "undefined" && Toast.show) {
    Toast.show("🎉 تم حفظ وتوثيق قائمة الفحص بنجاح!");
  } else {
    alert("تم حفظ قائمة الفحص بنجاح!");
  }

  renderChecklistView();
  if (typeof renderDashboard === "function") renderDashboard();
}

function updateChecklistSaveBar(stats) {
  const saveStatusEl = document.getElementById("checklistStatus");
  if (saveStatusEl) {
    saveStatusEl.textContent = `حالة الفحص: ${stats.percent}% مكتملة (${stats.checkedCount} من ${stats.total})`;
  }
}
