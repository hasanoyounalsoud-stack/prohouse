// ==================== أدوات مشتركة بين كل الشاشات ====================
// هالملف بينحمّل بعد config.js مباشرة وقبل أي وحدة شاشة، لأن الوحدات بتنادي هالدوال
// وقت التحميل. كانت هالأدوات ساكنة جوا js/entry.js (شاشة الاستلام القديمة)، وهاد خلّى
// ١٢ ملف يعتمدوا على ملف شاشة — ولما تغيّر ترتيب التحميل انهار نص التطبيق.
// أي أداة بيحتاجها أكثر من شاشة مكانها هون، مو جوا ملف شاشة.

// ---- أعتاب التنبيهات ----
const SHORTAGE_THRESHOLD_DEFAULT = -0.20;
const SURPLUS_THRESHOLD_DEFAULT  = 0.25;
const RETURN_THRESHOLD_DEFAULT   = 0.30;

// تُقرأ من شاشة الإعدادات (currentSettings مُعرّفة بـ js/settings.js) إن كانت محفوظة، وإلا القيم الافتراضية فوق.
function thresholdFrom(key, fallback) {
  const v = (typeof currentSettings !== "undefined" && currentSettings[key] !== undefined && currentSettings[key] !== "")
    ? Number(currentSettings[key]) : NaN;
  return isNaN(v) ? fallback : v;
}

// ---- الوجبات ----
// الوجبة عند برو هاوس ~150 جرام — نحسب عدد الوجبات للأصناف اللي بتتوزن (دجاج/لحم/بحري) فقط
const MEAL_WEIGHT_G = 150;
const MEAL_CATEGORIES = ["دجاج", "لحم", "بحري", "ساندويتشات"];
// ---- ملصق وأيقونة التصنيف ----
function categoryIconSticker(catName) {
  if (!catName) return "📂";
  const c = String(catName).trim();
  if (c.includes("دجاج")) return "🍗";
  if (c.includes("لحم")) return "🥩";
  if (c.includes("بحري") || c.includes("سمك") || c.includes("أسماك")) return "🐟";
  if (c.includes("فطور") || c.includes("ساندويتش")) return "🥪";
  if (c.includes("عصير")) return "🥤";
  if (c.includes("سلط")) return "🥗";
  if (c.includes("حلو") || c.includes("حلويات")) return "🍰";
  if (c.includes("صوص")) return "🧄";
  if (c.includes("كارب") || c.includes("أرز") || c.includes("ارز")) return "🍚";
  if (c.includes("معدات") || c.includes("أدوات")) return "🛠️";
  return "📂";
}

function isMealCategory(cat) { return MEAL_CATEGORIES.includes(cat); }
function mealsCount(grams) {
  const n = Number(grams);
  if (grams === "" || grams === null || grams === undefined || isNaN(n)) return "";
  return (n / MEAL_WEIGHT_G).toFixed(1);
}

// ---- الفرع الحالي ----
const Branch = {
  get() { return localStorage.getItem("ph_branch") || ""; },
  set(name) { localStorage.setItem("ph_branch", name); }
};

function branchList() {
  const raw = (typeof currentSettings !== "undefined" && currentSettings.branches) || DEFAULT_BRANCHES_FALLBACK;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

// الفروع المسموحة للمستخدم المسجّل دخول (مالك/شيف بيشوفوا الكل، الباقي بس فروعهم)
function allowedBranchList() {
  const all = branchList();
  if (Auth.canSeeAllBranches()) return all;
  const mine = Auth.branches();
  return all.filter(b => mine.includes(b));
}

function branchOptionsHtml(selected) {
  const current = selected || Branch.get();
  return `<option value="">اختر الفرع</option>` + allowedBranchList().map(b =>
    `<option value="${b}" ${b === current ? "selected" : ""}>${b}</option>`
  ).join("");
}

// ---- واجهة ----
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

// يحوّل اسم تصنيف عربي لمعرّف صالح كـ id بالـ DOM
function cssId(str) { return str.replace(/[^a-zA-Z0-9_؀-ۿ]/g, "_"); }

// ---- الكمية المطلوبة من طلبية الغد ----
// (من طلبية الغد يلي انحطت أمس مستهدفة هالتاريخ + هالفرع بالظبط)
async function loadRequestedQty(date, branch) {
  const data = await Sync.get("getTomorrowOrder", { date, branch }, "tomorrow:" + date + ":" + branch);
  const map = {};
  (data || []).forEach(it => { map[it.itemId] = it.qty; });
  return map;
}

// ---- وضع العرض المدمج بسطر واحد لتقليل السكرول للجوال (Compact View Mode) ----
function isCompactMode() {
  return localStorage.getItem("prohouse_compact_mode") === "true";
}

function toggleCompactMode() {
  const next = !isCompactMode();
  localStorage.setItem("prohouse_compact_mode", String(next));
  applyCompactModeUI();
  showToast(next ? "⚡ تم تفعيل العرض المدمج (سطر واحد)" : "📖 تم العودة للعرض الموسع");
}

function applyCompactModeUI() {
  const active = isCompactMode();
  document.body.classList.toggle("compact-mode", active);
  document.querySelectorAll(".compact-toggle-btn").forEach(btn => {
    btn.innerHTML = active 
      ? "📖 التبديل للعرض الموسع" 
      : "🗜️ عرض مدمج (تقليل السكرول)";
    btn.classList.toggle("active", active);
  });
}

function renderCompactToggleBtnHtml() {
  const active = isCompactMode();
  return `
    <button type="button" class="btn compact-toggle-btn ${active ? 'active' : ''}" onclick="toggleCompactMode()" title="تبديل كثافة العرض لتقليل السكرول بالجوال">
      ${active ? '📖 التبديل للعرض الموسع' : '🗜️ عرض مدمج (تقليل السكرول)'}
    </button>
  `;
}

// تطبيق الوضع المحفوظ فوراً عند تحميل الصفحة
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyCompactModeUI);
  } else {
    applyCompactModeUI();
  }
}

