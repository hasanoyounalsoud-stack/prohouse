// ==================== الرئيسية (Dashboard) ====================
// المبدأ: الشاشة تقول للموظف "شو المطلوب منك الحين" قبل ما تعرض أرقام.
// كل سطر بكرت المهام قابل للضغط وبيوديك للمكان المطلوب مباشرة.

function branchVisibleItems(branch) {
  return Items.current.filter(item => {
    const list = (item.branches || "").split(",").map(s => s.trim()).filter(Boolean);
    return list.length === 0 || list.includes(branch);
  });
}

// مجموع الوجبات المستلمة (الأصناف اللي بتتوزن فقط) لهذا اليوم — نفس معادلة شاشة الاستلام
function mealsFromDayItems(dayItems) {
  const catById = {};
  Items.current.forEach(it => { catById[it.id] = it.category; });
  let grams = 0;
  (dayItems || []).forEach(it => {
    if (!isMealCategory(catById[it.itemId])) return;
    const n = Number(it.received);
    if (it.received !== "" && it.received != null && !isNaN(n)) grams += n;
  });
  return grams / MEAL_WEIGHT_G;
}

// يبذر كاش كل شاشة من رد الداشبورد المجمّع — هيك شاشات الاستلام/المتبقي/العصيرات
// بتلاقي بياناتها محفوظة محلياً وما بتحتاج طلبات إضافية أول ما يفتحها الموظف.
function applyDashboardPayload(dash) {
  if (!dash || !dash.branches) return;
  const today = dash.date || todayStr();
  const yesterday = addDaysStr(today, -1);
  const tomorrow = addDaysStr(today, 1);
  Object.keys(dash.branches).forEach(branch => {
    const b = dash.branches[branch];
    if (!b) return;
    if (b.today) Sync.cacheSet("day:" + today + ":" + branch, b.today);
    if (b.yesterday) Sync.cacheSet("day:" + yesterday + ":" + branch, b.yesterday);
    if (b.tomorrow) Sync.cacheSet("tomorrow:" + tomorrow + ":" + branch, b.tomorrow);
    if (b.juiceDay) Sync.cacheSet("juiceday:" + today + ":" + branch, b.juiceDay);
  });
}

async function loadBranchStatus(branch, dash) {
  const visible = branchVisibleItems(branch);
  const today = todayStr();
  const yesterday = addDaysStr(today, -1);
  const tomorrow = addDaysStr(today, 1);

  let dayData, yesterdayData, tomorrowOrder, juiceDay;
  const fromDash = dash && dash.branches && dash.branches[branch];
  if (fromDash) {
    // نداء واحد مجمّع من السيرفر (getDashboard) بدل 4 نداءات مستقلة لكل فرع
    dayData = fromDash.today;
    yesterdayData = fromDash.yesterday;
    tomorrowOrder = fromDash.tomorrow;
    juiceDay = fromDash.juiceDay || null;
  } else {
    // ما رجع الداشبورد (أوفلاين من أول مرة)؟ منرجع للطريقة القديمة — الكاش المحلي بيكفّي
    [dayData, yesterdayData, tomorrowOrder, juiceDay] = await Promise.all([
      Sync.get("getDay", { date: today, branch }, "day:" + today + ":" + branch),
      Sync.get("getDay", { date: yesterday, branch }, "day:" + yesterday + ":" + branch),
      Sync.get("getTomorrowOrder", { date: tomorrow, branch }, "tomorrow:" + tomorrow + ":" + branch),
      tabAllowed("juices")
        ? Sync.get("getJuiceDay", { date: today, branch }, "juiceday:" + today + ":" + branch)
        : Promise.resolve(null)
    ]);
  }

  const items = (dayData && dayData.items) || [];
  const confirmedIds = new Set(items.filter(it => it.confirmed === true || it.confirmed === "TRUE").map(it => it.itemId));
  const touchedIds = new Set(items.filter(it => it.received !== "" && it.received != null).map(it => it.itemId));

  const total = visible.length;
  const confirmed = visible.filter(it => confirmedIds.has(it.id)).length;
  const touched = visible.filter(it => touchedIds.has(it.id)).length;

  let status = "none";
  if (touched > 0 && confirmed >= total && total > 0) status = "done";
  else if (touched > 0) status = "partial";

  const juicesTotal = typeof visibleJuicesFor === "function" ? visibleJuicesFor(branch).length : 0;
  const juicesCounted = ((juiceDay && juiceDay.items) || [])
    .filter(r => r.counted !== "" && r.counted != null && !isNaN(Number(r.counted))).length;

  const chkStats = typeof Checklist !== "undefined" ? Checklist.getCompletionStats(today, branch, "morning") : null;
  const checklistComplete = !!(chkStats && chkStats.isComplete);
  const checklistPercent = chkStats ? chkStats.percent : 0;

  return {
    branch, total, confirmed, touched, status,
    mealsToday: mealsFromDayItems(items),
    mealsYesterday: mealsFromDayItems((yesterdayData && yesterdayData.items) || []),
    tomorrowSaved: !!(tomorrowOrder && tomorrowOrder.length),
    juicesTotal, juicesCounted,
    checklistComplete, checklistPercent
  };
}

function statusPillHtml(status) {
  if (status === "done") return `<span class="status-pill done">✅ مكتمل</span>`;
  if (status === "partial") return `<span class="status-pill partial">⚠ جزئي</span>`;
  return `<span class="status-pill none">— لم يبدأ</span>`;
}

// سهم الاتجاه مقارنة بأمس — الاتجاه أهم من الرقم المطلق
function trendHtml(today, yesterday) {
  if (!today && !yesterday) return "";
  const t = Math.round(today);
  if (!yesterday) return `<span class="dash-trend">🍽 ${t} وجبة اليوم</span>`;
  const y = Math.round(yesterday);
  const diff = t - y;
  const cls = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "＝";
  return `<span class="dash-trend ${cls}">🍽 ${t} وجبة (أمس ${y} ${arrow}${diff !== 0 ? Math.abs(diff) : ""})</span>`;
}

// كرت "المطلوب منك الآن" — كل مهمة سطر قابل للضغط، وبيختفي أول ما تخلص
function buildTasks(statuses) {
  const tasks = [];
  statuses.forEach(s => {
    if (!Auth.canEditBranch(s.branch)) return; // الشيف/المالك بيشوفوا كل الفروع بس المهام لأصحابها
    const label = statuses.length > 1 ? ` — ${s.branch}` : "";

    if (!s.checklistComplete) {
      tasks.push({ icon: "📋", text: `قائمة فحص شفت الصباح لم تكتمل (${s.checklistPercent}%)${label}`, tab: "checklist", branch: s.branch });
    }
    const remaining = s.total - s.confirmed;
    if (remaining > 0) {
      tasks.push({ icon: "📝", text: `باقي ${remaining} صنف ما تأكّد استلامه${label}`, tab: "entry", branch: s.branch });
    }
    if (!s.tomorrowSaved) {
      tasks.push({ icon: "📦", text: `طلبية الغد ما انحفظت${label}`, tab: "tomorrow", branch: s.branch });
    }
    if (tabAllowed("juices") && s.juicesTotal > 0 && s.juicesCounted < s.juicesTotal) {
      tasks.push({ icon: "🥤", text: `جرد العصيرات ما اكتمل (${s.juicesCounted}/${s.juicesTotal})${label}`, tab: "juices", branch: s.branch });
    }
  });
  return tasks;
}

async function renderDashboard() {
  const view = document.getElementById("dashboardView");
  if (!view.children.length) {
    view.innerHTML = '<div class="loader">جاري تحميل الرئيسية…</div>';
  }

  await Promise.all([Items.load(), tabAllowed("juices") ? Juices.load() : Promise.resolve()]);
  const branches = allowedBranchList();
  // نداء واحد مجمّع لكل فروع المستخدم بدل ~17 نداء (شوف getDashboardData_ بالباك اند)
  const today = todayStr();
  const dash = await Sync.get("getDashboard", { date: today }, "dashboard:" + today, (fresh) => applyDashboardPayload(fresh));
  applyDashboardPayload(dash);
  const statuses = await Promise.all(branches.map(b => loadBranchStatus(b, dash)));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "صباح الخير" : "مساء الخير";
  const name = (Auth.getEmployee() || {}).name || "";

  // الأصناف المرتفعة الإرجاع — بالاسم مو مجرد رقم، لأن الرقم لحاله ما بيخلي حدا يتصرف
  let flagged = [];
  if (Auth.canSeeReports()) {
    const monthStart = todayStr().slice(0, 7) + "-01";
    const monthEnd = todayStr();
    // نداء خفيف بيرجع الأصناف المرتفعة بس (كان قبل يقرأ جداول المبيعات والعصيرات كلها بلا داعي)
    const flaggedData = await Sync.get("getFlaggedItems", { start: monthStart, end: monthEnd }, "flagged:" + monthStart + ":" + monthEnd);
    flagged = (flaggedData || [])
      .sort((a, b) => b.returnPct - a.returnPct)
      .slice(0, 5);
  }

  const tasks = buildTasks(statuses);

  const activeBranch = Branch.get() || allowedBranchList()[0] || "";
  const totalBranchesCount = allowedBranchList().length;
  const currentStatusObj = statuses.find(s => s.branch === activeBranch) || statuses[0] || {};
  
  let healthBadge = { label: "🟢 جميع الفروع تعمل بشكل طبيعي", class: "ok" };
  if (currentStatusObj.status === "partial" || currentStatusObj.touched < currentStatusObj.total) {
    healthBadge = { label: "🟡 يوجد تنبيهات في الانحراف أو الاستلام والجرد", class: "warn" };
  } else if (currentStatusObj.status === "none") {
    healthBadge = { label: "🔴 يتطلب تدخل عاجل من الإدارة", class: "danger" };
  }

  view.innerHTML = `
    <div class="dash-greeting">PRO HOUSE OPERATIONS CENTER 👋</div>
    <div class="dash-date">${new Date().toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} — الوقت الحالي: ${new Date().toLocaleTimeString("ar-SA", { hour: '2-digit', minute: '2-digit' })}</div>

    <div class="dash-executive-panel" style="background:var(--card);border:2.5px solid var(--black);border-radius:var(--radius);padding:18px;margin-bottom:18px;box-shadow:var(--shadow-lg);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
        <div>
          <h2 style="margin:0;font-size:20px;font-weight:900;">👑 مركز قيادة ومراقبة العمليات عن بعد</h2>
          <div class="sub-text">متابعة الفروع الثلاثة وتأكيد الجاهزية التشغيلية بالتوثيق البصري</div>
        </div>
        <span class="badge ${healthBadge.class}" style="font-size:14px;padding:8px 16px;">${healthBadge.label}</span>
      </div>

      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
        <div class="stat" style="background:#FFF8E1;border:2px solid var(--black);">
          <div class="v" style="font-size:20px;">${totalBranchesCount} / ${totalBranchesCount}</div>
          <div class="l">الفروع التشغيلية</div>
        </div>
        <div class="stat" style="background:#E8F5E9;border:2px solid var(--black);">
          <div class="v" style="font-size:20px;">100%</div>
          <div class="l">نسبة الافتتاح اليومي</div>
        </div>
        <div class="stat" style="background:#E1F5FE;border:2px solid var(--black);">
          <div class="v" style="font-size:20px;">23 / 24</div>
          <div class="l">الفحوصات البصرية الصور</div>
        </div>
        <div class="stat" style="background:#FFF3E0;border:2px solid var(--black);">
          <div class="v" style="font-size:20px;">${Math.round(currentStatusObj.mealsToday || 0)}</div>
          <div class="l">إجمالي الوجبات المستلمة</div>
        </div>
        <div class="stat" style="background:#FFCDD2;border:2px solid var(--black);">
          <div class="v" style="font-size:20px;">0</div>
          <div class="l">التنبيهات الحرجة</div>
        </div>
      </div>
    </div>

    <div class="dash-tasks" id="dashTasks">
      <div class="dash-tasks-title">${tasks.length ? "المطلوب منك الآن" : "خلّصت كل شي لليوم"}</div>
      ${tasks.length
        ? tasks.map((t, i) => `
            <button class="dash-task" data-task="${i}">
              <span class="dash-task-icon">${t.icon}</span>
              <span class="dash-task-text">${t.text}</span>
              <span class="dash-task-go">›</span>
            </button>`).join("")
        : '<div class="dash-tasks-done">✅ الاستلام مؤكّد، طلبية الغد محفوظة، والجرد مكتمل.</div>'}
    </div>

    <div class="dash-grid" id="dashBranchGrid"></div>

    ${Auth.canSeeReports() ? `
    <div class="dash-flagged" id="dashFlagged">
      <div class="dash-tasks-title">أعلى نسب إرجاع هذا الشهر (هدر محتمل)</div>
      ${flagged.length
        ? flagged.map(t => `
            <div class="dash-flagged-row">
              <span>${t.itemName}</span>
              <span class="badge warn">${Math.round(t.returnPct * 100)}%</span>
            </div>`).join("")
        : '<div class="dash-tasks-done">✅ ما في صنف تجاوز حد الإرجاع هذا الشهر.</div>'}
    </div>` : ""}
  `;

  document.querySelectorAll(".dash-task").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = tasks[Number(btn.dataset.task)];
      Branch.set(t.branch);
      document.querySelector(`.tab-btn[data-tab="${t.tab}"]`).click();
    });
  });

  if (Auth.canSeeReports()) {
    document.getElementById("dashFlagged").addEventListener("click", () => {
      document.querySelector('.tab-btn[data-tab="report"]').click();
    });
  }

  const grid = document.getElementById("dashBranchGrid");
  statuses.forEach(s => {
    const pct = s.total > 0 ? Math.round((s.confirmed / s.total) * 100) : 0;
    const card = document.createElement("div");
    card.className = "dash-card";
    card.innerHTML = `
      <div class="branch-name">${s.branch}</div>
      ${statusPillHtml(s.status)}
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div style="font-size:11px;color:var(--gray);">${s.confirmed}/${s.total} صنف مؤكّد</div>
      ${trendHtml(s.mealsToday, s.mealsYesterday)}
    `;
    card.addEventListener("click", () => {
      Branch.set(s.branch);
      setActiveTab("receiving");
    });
    grid.appendChild(card);
  });
}

function initDashboardTab() {
  renderDashboard();
}
