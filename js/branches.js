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

// ---- مسار افتتاح الفرع (Opening Session Workflow) ----
async function renderOpeningView() {
  const view = document.getElementById("openingView");
  if (!view) return;

  const branch = Branch.get() || allowedBranchList()[0] || "";
  const date = todayStr();
  const sessionId = "OPN-" + branch.replace(/\s+/g, "_") + "-" + date.replace(/-/g, "") + "-001";

  const photos = await getPhotosForSession(sessionId);
  const photosCount = photos.length;

  let html = `
    <div class="opening-panel">
      <div class="opening-header">
        <div>
          <h2>🌅 افتتاح الفرع والجاهزية الصباحية</h2>
          <div class="sub-text">رقم جلسة الافتتاح: <strong>${sessionId}</strong></div>
        </div>
        <div class="branch-selector-wrap">
          <select onchange="onOpeningBranchChange(this.value)">
            ${branchOptionsHtml(branch)}
          </select>
        </div>
      </div>

      <div class="opening-checkpoints-card">
        <h3>📷 الفحص البصري لإعدادات مدخل ومطبخ الفرع</h3>
        <div class="checkpoints-grid">
          ${DEFAULT_INSPECTION_CHECKPOINTS.map(cp => {
            const hasPhoto = photos.some(p => p.checkpointId === cp.id);
            return `
              <div class="checkpoint-item-box ${hasPhoto ? 'done' : ''}">
                <div class="cp-icon">${cp.icon}</div>
                <div class="cp-info">
                  <strong>${cp.name}</strong>
                  <span class="cp-status">${hasPhoto ? '✓ تم التوثيق بنجاح' : 'مطلوب التوثيق 📷'}</span>
                </div>
                <button class="btn primary snap-cp-btn" onclick="snapCheckpointPhoto('${sessionId}', '${cp.id}', '${cp.name}')">
                  ${hasPhoto ? 'إعادة التصوير' : '📷 تصوير'}
                </button>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <div style="text-align:center;margin-top:20px;">
        <button class="btn gold" style="font-size:16px;padding:14px 32px;" onclick="completeBranchOpening('${sessionId}')">
          ✓ اعتماد وتأكيد جاهزية الفرع للافتتاح
        </button>
      </div>
    </div>
  `;

  view.innerHTML = html;
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

function completeBranchOpening(sessionId) {
  showToast("✅ تم اعتماد افتتاح وجاهزية الفرع بنجاح!");
  setActiveTab("dashboard");
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
