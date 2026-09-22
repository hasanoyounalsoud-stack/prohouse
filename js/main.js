// ==================== التنقل بين التابات + الإقلاع + تسجيل الدخول ====================

const TAB_ROLE_ACCESS = {
  dashboard: ["owner", "manager", "chef", "branch_staff", "employee"],
  branches: ["owner", "manager", "chef"],
  opening: ["owner", "manager", "chef", "branch_staff", "employee"],
  closing: ["owner", "manager", "chef", "branch_staff", "employee"],
  inspection: ["owner", "manager", "chef", "branch_staff", "employee"],
  receiving: ["owner", "manager", "chef", "branch_staff", "employee"],
  remaining: ["owner", "manager", "chef", "branch_staff", "employee"],
  tomorrow: ["owner", "manager", "chef"],
  juices: ["owner", "manager", "branch_staff", "employee"],
  checklist: ["owner", "manager", "chef", "branch_staff", "employee"],
  waste: ["owner", "manager", "chef"],
  report: ["owner"],
  items: ["owner"],
  users: ["owner"],
  audit: ["owner"],
  settings: ["owner"]
};

function tabAllowed(tab) {
  const role = Auth.role();
  return !!(role && TAB_ROLE_ACCESS[tab] && TAB_ROLE_ACCESS[tab].includes(role));
}

function openMobileSidebar() {
  const sidebar = document.getElementById("appSidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (sidebar) sidebar.classList.add("mobile-open");
  if (backdrop) backdrop.classList.add("active");
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("appSidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (sidebar) sidebar.classList.remove("mobile-open");
  if (backdrop) backdrop.classList.remove("active");
}

function setActiveSubTab(subTab) {
  setActiveTab(subTab);
}

function setActiveTab(tab) {
  if (!tabAllowed(tab)) tab = "dashboard";
  closeMobileSidebar();

  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));

  const views = ["dashboardView", "branchesView", "openingView", "closingView", "inspectionView", "receivingView", "remainingView", "tomorrowView", "juicesView", "checklistView", "wasteView", "reportContainer", "itemsView", "usersView", "auditView", "settingsView"];
  views.forEach(vId => {
    const el = document.getElementById(vId);
    if (el) el.classList.add("hidden");
  });

  const activeViewId = tab === "report" ? "reportContainer" : (tab + "View");
  const activeEl = document.getElementById(activeViewId);
  if (activeEl) activeEl.classList.remove("hidden");

  const recDateBar = document.getElementById("receivingDateBar");
  const remDateBar = document.getElementById("remainingDateBar");
  if (recDateBar) recDateBar.classList.toggle("hidden", tab !== "receiving");
  if (remDateBar) remDateBar.classList.toggle("hidden", tab !== "remaining");

  document.getElementById("tomorrowDateBar").classList.toggle("hidden", tab !== "tomorrow");
  document.getElementById("juiceDateBar").classList.toggle("hidden", tab !== "juices");
  document.getElementById("checklistDateBar").classList.toggle("hidden", tab !== "checklist");

  const saveBarReceiving = document.getElementById("saveBarReceiving");
  const saveBarRemaining = document.getElementById("saveBarRemaining");
  if (saveBarReceiving) saveBarReceiving.classList.toggle("hidden", tab !== "receiving" || Auth.isViewOnlyEntry());
  if (saveBarRemaining) saveBarRemaining.classList.toggle("hidden", tab !== "remaining" || Auth.isViewOnlyEntry());

  document.getElementById("saveBarTomorrow").classList.toggle("hidden", tab !== "tomorrow" || Auth.isViewOnlyTomorrow());
  document.getElementById("saveBarJuices").classList.toggle("hidden", tab !== "juices" || Auth.isViewOnlyEntry());
  document.getElementById("saveBarChecklist").classList.toggle("hidden", tab !== "checklist" || Auth.isViewOnlyEntry());

  if (tab === "dashboard") { renderDashboard(); }
  if (tab === "branches") { renderBranchesHubView(); }
  if (tab === "opening") { renderOpeningView(); }
  if (tab === "closing") { renderClosingView(); }
  if (tab === "inspection") { renderInspectionGalleryView(); }
  if (tab === "receiving") { 
    if (currentRemainingDate && currentReceivingDate !== currentRemainingDate) {
      currentReceivingDate = currentRemainingDate;
      const recDateInp = document.getElementById("receivingDateInput");
      if (recDateInp) recDateInp.value = currentReceivingDate;
    }
    loadReceivingData(currentReceivingDate, currentReceivingBranch); 
  }
  if (tab === "remaining") { 
    if (typeof flushReceivingSave === "function") flushReceivingSave();
    if (currentReceivingDate && currentRemainingDate !== currentReceivingDate) {
      currentRemainingDate = currentReceivingDate;
      const remDateInp = document.getElementById("remainingDateInput");
      if (remDateInp) remDateInp.value = currentRemainingDate;
    }
    loadRemainingData(currentRemainingDate, currentRemainingBranch); 
  }
  if (tab === "waste") { loadWasteData(currentWasteDate, currentWasteBranch); }
  if (tab === "users") { renderUsersView(); }
  if (tab === "audit") { renderAuditView(); }
  if (tab === "checklist") { renderChecklistView(); }
  if (tab === "report") {
    loadReportLibs().then(() => {
      if (!document.getElementById("reportContainer").classList.contains("hidden")) redrawTrendChartIfReady();
    });
  }
  if (tab === "juices" && currentJuiceBranch !== Branch.get()) { loadJuiceDay(currentJuiceDate); }
  if (tab === "items") { Items.load().then(renderItemsAdminView); }
  if (tab === "settings") { Promise.all([loadSettings(), Items.load()]).then(renderSettingsView); }
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("mobileToggleBtn")?.addEventListener("click", openMobileSidebar);
  document.getElementById("sidebarCloseBtn")?.addEventListener("click", closeMobileSidebar);
  document.getElementById("sidebarBackdrop")?.addEventListener("click", closeMobileSidebar);
});

function applyRoleUiGating() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("hidden", !tabAllowed(btn.dataset.tab));
  });

  // إخفاء عناوين الأقسام الفارغة بالقائمة الجانبية تلقائياً
  document.querySelectorAll(".nav-group-title").forEach(title => {
    let next = title.nextElementSibling;
    let hasVisibleChild = false;
    while (next && !next.classList.contains("nav-group-title") && !next.classList.contains("sidebar-user")) {
      if (next.classList.contains("tab-btn") && !next.classList.contains("hidden")) {
        hasVisibleChild = true;
        break;
      }
      next = next.nextElementSibling;
    }
    title.style.display = hasVisibleChild ? "" : "none";
  });

  const emp = Auth.getEmployee();
  const ROSTER_NAMES = {
    emp_1: "أ.يزيد",
    emp_2: "حسن",
    emp_3: "الشيف عصام",
    emp_4: "أبو يونس",
    emp_5: "العامودي",
    emp_6: "محمد البلول",
    emp_7: "غالب"
  };
  const displayName = emp ? (ROSTER_NAMES[emp.id] || (emp.name && !emp.name.includes("?") ? emp.name : "موظف")) : "";
  document.getElementById("userBarName").textContent = displayName;
  const roleEl = document.getElementById("userBarRole");
  if (roleEl) roleEl.textContent = "";
  document.getElementById("userBar").classList.remove("hidden");
}

// ---- شارة حالة المزامنة ----
function updateSyncBadge({ pending }) {
  const el = document.getElementById("syncBadge");
  if (!API_URL) {
    el.textContent = "⚙ لسا ما انربط الباك اند";
    el.classList.remove("ok");
    return;
  }
  if (pending > 0) {
    el.textContent = `🔄 ${pending} بانتظار المزامنة`;
    el.classList.remove("ok");
    el.classList.add("pending");
  } else {
    el.textContent = "✅ كل شي متزامن";
    el.classList.add("ok");
    el.classList.remove("pending");
  }
}
Sync.onStatusChange(updateSyncBadge);
// ضغطة عادية: تدفع الحفظ المعلّق. ضغطة مطوّلة: تمسح الكاش وتعيد التحميل من السيرفر —
// لازمة لما تتغيّر البيانات على الشيت من برا التطبيق، لأن القراءة cache-first فبيضل
// الجهاز عارض نسخته القديمة بلا أي مؤشر إنها بطلت صحيحة.
(function wireSyncBadge() {
  const badge = document.getElementById("syncBadge");
  let held = false, timer = null;

  const startHold = () => {
    held = false;
    timer = setTimeout(() => {
      held = true;
      if (!confirm("تحديث كامل من السيرفر؟\nبينمسح المحفوظ محلياً وبتنجلب البيانات من جديد.")) return;
      const n = Sync.clearReadCache();
      showToast("انمسح " + n + " عنصر من الكاش — جاري التحديث…");
      setTimeout(() => location.reload(), 600);
    }, 900);
  };
  const endHold = () => { clearTimeout(timer); };

  badge.addEventListener("mousedown", startHold);
  badge.addEventListener("touchstart", startHold, { passive: true });
  ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach(ev => badge.addEventListener(ev, endHold));

  badge.addEventListener("click", () => { if (!held) Sync.flushQueue(); });
})();

// ---- بانر أوفلاين ----
function updateOfflineBanner() {
  document.getElementById("offlineBanner").classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOfflineBanner);
window.addEventListener("offline", updateOfflineBanner);

// ---- تسجيل Service Worker و Manifest (فقط عند النشر على سيرفر HTTP/HTTPS لتجنب أخطاء CORS عند الفتح المباشر) ----
if (location.protocol !== "file:") {
  const manifestLink = document.createElement("link");
  manifestLink.rel = "manifest";
  manifestLink.href = "manifest.json";
  document.head.appendChild(manifestLink);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW register failed:", e));
  }
}

// ---- تسجيل الدخول ----
function showLoginView() {
  document.getElementById("loginView").classList.remove("hidden");
  document.querySelector("header").classList.add("hidden");
  document.querySelector("main").classList.add("hidden");
}
function hideLoginView() {
  document.getElementById("loginView").classList.add("hidden");
  document.querySelector("header").classList.remove("hidden");
  document.querySelector("main").classList.remove("hidden");
}

function initChecklistTab() {
  const el = document.getElementById("checklistDateInput");
  if (el) {
    el.value = currentChecklistDate;
    el.addEventListener("change", (e) => {
      currentChecklistDate = e.target.value;
      renderChecklistView();
    });
  }
}

function initReceivingTab() {
  initReceivingModule();
  const dateEl = document.getElementById("receivingDateInput");
  if (dateEl) {
    dateEl.value = currentReceivingDate;
    dateEl.addEventListener("change", () => {
      currentReceivingDate = dateEl.value;
      currentRemainingDate = dateEl.value;
      const remDateEl = document.getElementById("remainingDateInput");
      if (remDateEl) remDateEl.value = dateEl.value;
      loadReceivingData(currentReceivingDate, currentReceivingBranch);
    });
  }
}

function initRemainingTab() {
  initRemainingModule();
  const dateEl = document.getElementById("remainingDateInput");
  if (dateEl) {
    dateEl.value = currentRemainingDate;
    dateEl.addEventListener("change", () => {
      currentRemainingDate = dateEl.value;
      currentReceivingDate = dateEl.value;
      const recDateEl = document.getElementById("receivingDateInput");
      if (recDateEl) recDateEl.value = dateEl.value;
      loadRemainingData(currentRemainingDate, currentRemainingBranch);
    });
  }
}

async function startApp() {
  hideLoginView();
  applyRoleUiGating();
  updateOfflineBanner();
  updateSyncBadge({ pending: Sync.getQueue().length });
  loadSettings();
  await Items.load();
  initReceivingTab();
  initRemainingTab();
  initDashboardTab();
  initTomorrowTab();
  if (tabAllowed("juices")) initJuicesTab();
  initChecklistTab();
  initReportTab();
  setActiveTab("dashboard");
}

async function doLoginSubmit() {
  const pin = document.getElementById("loginPinInput").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.classList.add("hidden");
  if (!pin) return;
  const btn = document.getElementById("loginSubmitBtn");
  btn.disabled = true;
  try {
    await Auth.login(pin);
    startApp();
  } catch (e) {
    errEl.textContent = String(e).replace(/^(Error:\s*)+/, "");
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}
document.getElementById("loginSubmitBtn").addEventListener("click", doLoginSubmit);
document.getElementById("loginPinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doLoginSubmit(); });

// ---- تغيير الرقم السري ----
function togglePinDialog(show) {
  document.getElementById("pinDialog").classList.toggle("hidden", !show);
  document.getElementById("pinError").classList.add("hidden");
  if (show) {
    ["pinCurrent", "pinNew", "pinConfirm"].forEach(id => { document.getElementById(id).value = ""; });
    document.getElementById("pinCurrent").focus();
  }
}
document.getElementById("changePinBtn").addEventListener("click", () => togglePinDialog(true));
document.getElementById("pinCancelBtn").addEventListener("click", () => togglePinDialog(false));

document.getElementById("pinSaveBtn").addEventListener("click", async () => {
  const currentPin = document.getElementById("pinCurrent").value.trim();
  const newPin = document.getElementById("pinNew").value.trim();
  const confirmPin = document.getElementById("pinConfirm").value.trim();
  const errEl = document.getElementById("pinError");
  const showErr = (msg) => { errEl.textContent = msg; errEl.classList.remove("hidden"); };

  if (!currentPin || !newPin) return showErr("عبّي كل الخانات");
  if (newPin !== confirmPin) return showErr("الرقم الجديد ما تطابق بالخانتين");
  if (!/^\d{4,8}$/.test(newPin)) return showErr("الرقم الجديد لازم يكون من ٤ لـ ٨ أرقام");

  const btn = document.getElementById("pinSaveBtn");
  btn.disabled = true;
  try {
    await Auth.changePin(currentPin, newPin);
    alert("تم تغيير رقمك. سجّل دخول بالرقم الجديد.");
    location.reload(); // الجلسات القديمة انلغت عالسيرفر — لازم دخول جديد
  } catch (e) {
    showErr(String(e).replace(/^(Error:\s*)+/, ""));
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (!confirm("تسجيل الخروج؟")) return;
  await Auth.logout();
  location.reload();
});

// ---- الإقلاع ----
(async function boot() {
  if (!Auth.isLoggedIn()) { showLoginView(); return; }
  await Auth.verify(); // يحدّث الدور/الفروع لو تغيّرت، وبيرجع لتسجيل الدخول لو الجلسة انتهت
  if (!Auth.isLoggedIn()) { showLoginView(); return; }
  startApp();
})();
