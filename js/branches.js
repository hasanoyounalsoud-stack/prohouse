// ==================== مركز عمليات الفروع ومسارات الافتتاح والإغلاق (Branch Operations Hub) ====================

let currentBranchHubSelected = "";

function initBranchesModule() {
  currentBranchHubSelected = Branch.get() || allowedBranchList()[0] || "";
}

async function renderBranchesHubView() {
  const view = document.getElementById("branchesView");
  if (!view) return;

  view.innerHTML = '<div class="loader">جاري تحميل حالة مركز الفروع والتحكم الميداني…</div>';
  const branches = allowedBranchList();
  const date = todayStr();

  // نفس نداء الداشبورد المجمّع — بدل 4 نداءات مستقلة لكل فرع
  const dash = await Sync.get("getDashboard", { date }, "dashboard:" + date, (fresh) => applyDashboardPayload(fresh));
  applyDashboardPayload(dash);
  const branchStatuses = await Promise.all(branches.map(b => loadBranchStatus(b, dash)));

  let html = `
    <div class="branches-hub-header">
      <div class="hub-title-row">
        <div>
          <h2>🏪 مركز التحكم والعمليات الميدانية للفروع</h2>
          <div class="sub-text">مراقبة الجاهزية التشغيلية والافتتاح والإغلاق عن بُعد</div>
        </div>
        <div class="hub-actions">
          <button class="btn primary" onclick="setActiveSubTab('opening')">🌅 افتتاح فرع</button>
          <button class="btn danger" onclick="setActiveSubTab('closing')">🔒 إغلاق فرع</button>
          <button class="btn gold" onclick="setActiveSubTab('inspection')">📷 المراقبة الميدانية</button>
        </div>
      </div>

      <div class="branch-cards-grid">
        ${branchStatuses.map(s => {
          let statusBadge = { label: "🟢 OPEN", class: "ok" };
          if (s.status === "partial") statusBadge = { label: "🟡 OPEN — NEEDS ATTENTION", class: "warn" };
          if (s.status === "none") statusBadge = { label: "🔴 NEEDS ATTENTION", class: "danger" };

          return `
            <div class="branch-ops-card" onclick="selectBranchControlCenter('${s.branch}')">
              <div class="card-top">
                <h3>${s.branch}</h3>
                <span class="badge ${statusBadge.class}">${statusBadge.label}</span>
              </div>

              <div class="ops-metrics-list">
                <div class="metric-row">
                  <span>افتتاح الفرع:</span>
                  <strong>${s.checklistComplete ? "✓ مكتمل (8/8)" : "غير مكتمل"}</strong>
                </div>
                <div class="metric-row">
                  <span>استلام الطلبية:</span>
                  <strong>${s.confirmed}/${s.total} صنف</strong>
                </div>
                <div class="metric-row">
                  <span>جرد العصيرات:</span>
                  <strong>${s.juicesCounted}/${s.juicesTotal} صنف</strong>
                </div>
                <div class="metric-row">
                  <span>إغلاق الفرع:</span>
                  <strong>${s.tomorrowSaved ? "جاهز ومغلق" : "قيد التشغيل"}</strong>
                </div>
              </div>

              <div class="card-footer-btn">
                <span>فتح شاشة التحكم بالفرع ›</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  view.innerHTML = html;
}

function selectBranchControlCenter(branch) {
  Branch.set(branch);
  currentBranchHubSelected = branch;
  setActiveTab("receiving");
}

async function showBranchControlCenterModal(branch) {
  const date = todayStr();
  const [dayData, receivingData, remainingData] = await Promise.all([
    Sync.get("getDay", { date, branch }, "day:" + date + ":" + branch),
    Sync.get("getTomorrowOrder", { date, branch }, "tomorrow:" + date + ":" + branch),
    Sync.get("getRemainingReport", { date, branch }, "remaining:" + date + ":" + branch)
  ]);

  let modal = document.getElementById("branchControlModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "branchControlModal";
    modal.className = "camera-modal-backdrop";
    document.body.appendChild(modal);
  }

  const isClosed = remainingData && remainingData.meta && remainingData.meta.isClosed;

  modal.innerHTML = `
    <div class="camera-modal-box" style="max-width:650px;">
      <div class="camera-header">
        <span class="checkpoint-title">🏪 مركز قيادة فرع ${branch}</span>
        <button class="camera-close-btn" onclick="document.getElementById('branchControlModal').classList.remove('active')">✕</button>
      </div>

      <div style="padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;background:var(--surface2);padding:12px;border-radius:12px;border:1.5px solid var(--black);">
          <div>
            <strong style="font-size:16px;">حالة اليوم التشغيلي:</strong>
            <span class="sub-text">${date}</span>
          </div>
          <span class="badge ${isClosed ? 'danger' : 'ok'}" style="font-size:14px;padding:6px 14px;">${isClosed ? '🔒 اليوم مغلق ومقتنع' : '🟢 الفرع مفتوح وفي الخدمة'}</span>
        </div>

        <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;">
          <button class="btn primary" onclick="document.getElementById('branchControlModal').classList.remove('active');setActiveTab('receiving');">📦 تقرير الاستلام</button>
          <button class="btn gold" onclick="document.getElementById('branchControlModal').classList.remove('active');setActiveTab('remaining');">📊 تقرير المتبقي والجرد</button>
          <button class="btn secondary" onclick="document.getElementById('branchControlModal').classList.remove('active');setActiveTab('tomorrow');">📦 طلبية الغد</button>
          <button class="btn secondary" onclick="document.getElementById('branchControlModal').classList.remove('active');setActiveSubTab('inspection');">📷 المعاينة الميدانية</button>
        </div>
      </div>
    </div>
  `;

  modal.classList.add("active");
}

// ---- مراحل التوثيق الميداني الثلاث لبرو هاوس ----
const INSPECTION_STAGES = [
  { id: "morning", name: "الجولة 1: الافتتاح الصباحي", time: "08:00 ص", icon: "🌅", targetHour: 8, targetMin: 0 },
  { id: "lunch", name: "الجولة 2: ذروة الغداء والجاهزية", time: "12:00 م", icon: "☀️", targetHour: 12, targetMin: 0 },
  { id: "closing", name: "الجولة 3: الإغلاق واقتناع الفرع", time: "04:30 م", icon: "🔒", targetHour: 16, targetMin: 30 }
];

let currentInspectionStage = "morning";

// اختيار المرحلة التلقائي الذكي بناء على الوقت الحالي
function getAutoInspectionStage() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < 11 * 60) return "morning";        // قبل 11:00 صباحاً -> الافتتاح
  if (mins < 15 * 60 + 30) return "lunch";     // بين 11:00 و 3:30 عصراً -> الغداء
  return "closing";                            // بعد 3:30 عصراً -> الإغلاق
}

async function renderOpeningView() {
  const view = document.getElementById("openingView");
  if (!view) return;

  const branch = Branch.get() || allowedBranchList()[0] || "";
  const date = todayStr();
  const activeStage = INSPECTION_STAGES.find(s => s.id === currentInspectionStage) || INSPECTION_STAGES[0];
  const sessionId = "INSP-" + branch.replace(/\s+/g, "_") + "-" + date.replace(/-/g, "") + "-" + activeStage.id.toUpperCase();

  const photos = await getPhotosForSession(sessionId);
  const checkpoints = typeof getCheckpointsForBranch === "function" ? getCheckpointsForBranch(branch) : DEFAULT_INSPECTION_CHECKPOINTS;
  const completedCount = checkpoints.filter(cp => photos.some(p => p.checkpointId === cp.id)).length;
  const isFullyCompleted = completedCount >= checkpoints.length && checkpoints.length > 0;

  // جلب إحصائيات كل جولة لمعرفة المكتمل منها
  const morningPhotos = await getPhotosForSession("INSP-" + branch.replace(/\s+/g, "_") + "-" + date.replace(/-/g, "") + "-MORNING");
  const lunchPhotos = await getPhotosForSession("INSP-" + branch.replace(/\s+/g, "_") + "-" + date.replace(/-/g, "") + "-LUNCH");
  const closingPhotos = await getPhotosForSession("INSP-" + branch.replace(/\s+/g, "_") + "-" + date.replace(/-/g, "") + "-CLOSING");

  const stageStats = {
    morning: checkpoints.filter(cp => morningPhotos.some(p => p.checkpointId === cp.id)).length,
    lunch: checkpoints.filter(cp => lunchPhotos.some(p => p.checkpointId === cp.id)).length,
    closing: checkpoints.filter(cp => closingPhotos.some(p => p.checkpointId === cp.id)).length
  };

  let html = `
    <div class="opening-panel">
      <div class="opening-header">
        <div>
          <h2>📷 التوثيق البصري والمراقبة الميدانية (3 مراحل يومياً)</h2>
          <div class="sub-text">فرع: <strong>${branch}</strong> | التاريخ: <strong>${date}</strong></div>
        </div>
        <div class="branch-selector-wrap">
          <select onchange="onOpeningBranchChange(this.value)">
            ${branchOptionsHtml(branch)}
          </select>
        </div>
      </div>

      <!-- تبويبات المراحل الثلاث للتوثيق -->
      <div class="stage-nav-tabs">
        ${INSPECTION_STAGES.map(stg => {
          const isAct = stg.id === currentInspectionStage;
          const count = stageStats[stg.id] || 0;
          const isDone = count >= checkpoints.length && checkpoints.length > 0;
          return `
            <button class="stage-tab-btn ${isAct ? 'active' : ''} ${isDone ? 'completed' : ''}" onclick="switchInspectionStage('${stg.id}')">
              <span class="stage-tab-icon">${stg.icon}</span>
              <div class="stage-tab-text">
                <strong>${stg.name}</strong>
                <span class="stage-tab-time">⏰ الموعد: ${stg.time} (${count}/${checkpoints.length})</span>
              </div>
              ${isDone ? '<span class="stage-badge-ok">✓ مكتمل</span>' : ''}
            </button>
          `;
        }).join("")}
      </div>

      <div class="opening-checkpoints-card">
        <div class="stage-header-banner">
          <div>
            <h3>${activeStage.icon} نقاط الفحص المطلوبة: ${activeStage.name}</h3>
            <span class="sub-text">توثيق جاهزية الفرع بالكاميرا — المتبقي: ${checkpoints.length - completedCount} منطقة</span>
          </div>
          <div class="stage-progress-pill ${isFullyCompleted ? 'ok' : ''}">
            ${completedCount} / ${checkpoints.length} مناطق موثقة
          </div>
        </div>

        <div class="checkpoints-grid">
          ${checkpoints.map(cp => {
            const photo = photos.find(p => p.checkpointId === cp.id);
            const hasPhoto = !!photo;
            return `
              <div class="checkpoint-item-box ${hasPhoto ? 'done' : ''}">
                <div class="cp-main-content" style="display:flex;align-items:center;gap:12px;width:100%;">
                  ${hasPhoto ? `
                    <div class="cp-thumb-preview" onclick="viewPhotoFullscreen('${photo.id}')" title="اضغط لتكبير ومعاينة الصورة" style="cursor:pointer;position:relative;flex-shrink:0;">
                      <img src="${photo.dataUrl}" alt="${cp.name}" style="width:62px;height:62px;object-fit:cover;border-radius:10px;border:2px solid var(--accent);box-shadow:0 2px 6px rgba(0,0,0,0.15);" />
                      <span style="position:absolute;bottom:-4px;right:-4px;background:var(--accent);color:#000;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;">🔍</span>
                    </div>
                  ` : `
                    <div class="cp-icon">${cp.icon}</div>
                  `}
                  <div class="cp-info" style="flex:1;">
                    <strong style="font-size:15px;">${cp.name}</strong>
                    <span class="cp-status" style="display:block;margin-top:2px;">${hasPhoto ? '✓ تم التوثيق' : 'مطلوب التوثيق 📷'}</span>
                    ${photo ? `<div class="cp-time" style="font-size:12px;color:var(--text-muted);margin-top:2px;">🕒 ${new Date(photo.timestamp).toLocaleTimeString("ar-SA", { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
                  </div>
                </div>

                <div class="cp-actions-bar" style="display:flex;gap:8px;margin-top:12px;width:100%;">
                  <button class="btn ${hasPhoto ? 'secondary' : 'primary'} snap-cp-btn" style="flex:1;" onclick="snapCheckpointPhoto('${sessionId}', '${cp.id}', '${cp.name}')">
                    ${hasPhoto ? '🔄 تغيير / إعادة تصوير' : '📷 تصوير'}
                  </button>
                  ${hasPhoto ? `
                    <button class="btn danger" style="padding:0 14px;border-radius:8px;" onclick="deletePhotoRecord('${photo.id}')" title="حذف هذه الصورة إذا تم تصويرها بالخطأ">
                      🗑️ حذف
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <div style="text-align:center;margin-top:24px;">
        <button class="btn ${isFullyCompleted ? 'gold' : 'secondary'}" style="font-size:16px;padding:15px 36px;" onclick="completeInspectionStage('${sessionId}', '${activeStage.name}')">
          ✓ اعتماد وتأكيد ${activeStage.name}
        </button>
      </div>
    </div>
  `;

  view.innerHTML = html;
}

function switchInspectionStage(stageId) {
  currentInspectionStage = stageId;
  renderOpeningView();
}

function onOpeningBranchChange(branch) {
  Branch.set(branch);
  renderOpeningView();
}

function snapCheckpointPhoto(sessionId, cpId, cpName) {
  openCameraModal({ id: cpId, name: cpName }, async (photoObj) => {
    photoObj.sessionId = sessionId;
    await savePhotoRecord(photoObj);
    renderOpeningView();
  });
}

function completeInspectionStage(sessionId, stageName) {
  showToast(`✅ تم اعتماد وتوثيق ${stageName} بنجاح!`);
  // إذا كانت مرحلة الإغلاق، نقترح الانتقال للمتبقي
  if (currentInspectionStage === "closing") {
    setTimeout(() => setActiveTab("remaining"), 800);
  }
}

// ---- مسار إغلاق الفرع (Closing Session Workflow) ----
async function renderClosingView() {
  const view = document.getElementById("closingView");
  if (!view) return;

  const branch = Branch.get() || allowedBranchList()[0] || "";
  const date = todayStr();
  const sessionId = "CLS-" + branch.replace(/\s+/g, "_") + "-" + date.replace(/-/g, "") + "-001";

  let html = `
    <div class="closing-panel">
      <div class="closing-header">
        <div>
          <h2>🔒 إغلاق الفرع واقتناع الشفت المسائي</h2>
          <div class="sub-text">رقم جلسة الإغلاق: <strong>${sessionId}</strong></div>
        </div>
        <div class="branch-selector-wrap">
          <select onchange="onClosingBranchChange(this.value)">
            ${branchOptionsHtml(branch)}
          </select>
        </div>
      </div>

      <div class="closing-verification-list">
        <h3>📋 التحقق من متطلبات الإغلاق والتقارير</h3>
        <div class="verify-step-row done">
          <span class="step-icon">✓</span>
          <span class="step-text">استلام طلبيات اليوم والتحقق من الفروقات</span>
        </div>
        <div class="verify-step-row done">
          <span class="step-icon">✓</span>
          <span class="step-text">إدخال الجرد الفعلي للمتبقي والصوصات</span>
        </div>
        <div class="verify-step-row done">
          <span class="step-icon">✓</span>
          <span class="step-text">تسجيل طلبية الغد للشيف</span>
        </div>
      </div>

      <div style="text-align:center;margin-top:24px;">
        <button class="btn danger" style="font-size:16px;padding:16px 36px;" onclick="closeOperationalDay()">
          🔒 اعتماد اليوم وإغلاق الفرع نهائياً
        </button>
      </div>
    </div>
  `;

  view.innerHTML = html;
}

function onClosingBranchChange(branch) {
  Branch.set(branch);
  renderClosingView();
}
