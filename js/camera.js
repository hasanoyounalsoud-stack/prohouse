// ==================== وحدة كاميرا الجوال والمعاينة البصرية والتخزين (Mobile Camera & Inspection Module) ====================

const JAMEEL_INSPECTION_CHECKPOINTS = [
  { id: "bar_fridge_1", name: "بار التقديم الثلاجة 1", icon: "❄️", required: true },
  { id: "bar_fridge_2", name: "بار التقديم الثلاجة 2", icon: "🧊", required: true },
  { id: "sweets_zone", name: "منطقة الحلا", icon: "🍰", required: true },
  { id: "snacks_zone", name: "منطقة السناكات", icon: "🥨", required: true },
  { id: "pos_zone", name: "منطقة الكاشير", icon: "💻", required: true },
  { id: "coffee_zone", name: "منطقة القهوة", icon: "☕", required: true },
  { id: "coffee_machine", name: "ماكينة القهوة", icon: "⚙️", required: true },
  { id: "oven_prep", name: "الفرن ومكان تجهيز الساندويتشات", icon: "🥪", required: true }
];

const DEFAULT_INSPECTION_CHECKPOINTS = [
  { id: "entrance", name: "مدخل الفرع واللوحة", icon: "🚪", required: true },
  { id: "counter", name: "منطقة الكاشير والـ POS", icon: "💻", required: true },
  { id: "kitchen", name: "المطبخ الرئيسي", icon: "🍳", required: true },
  { id: "prep", name: "منطقة التحضير والتصفيح", icon: "🥗", required: true },
  { id: "fridges", name: "ثلاجات التبريد", icon: "❄️", required: true },
  { id: "freezers", name: "فريزرات التجميد", icon: "🧊", required: true },
  { id: "storage", name: "المخزن الجاف والعبوات", icon: "📦", required: true },
  { id: "delivery", name: "منطقة التسليم واستلام الطلبات", icon: "🛵", required: true }
];

function getCheckpointsForBranch(branchName) {
  if (branchName && branchName.includes("عبداللطيف جميل")) {
    return JAMEEL_INSPECTION_CHECKPOINTS;
  }
  return DEFAULT_INSPECTION_CHECKPOINTS;
}

let dbInstance = null;
let currentCameraStream = null;
let currentActiveCheckpoint = null;
let currentActiveCallback = null;

// تهيئة قاعدة بيانات IndexedDB لتخزين الصور أوفلاين
function openMediaDatabase() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    if (!window.indexedDB) {
      console.warn("IndexedDB not supported in this browser. Falling back to local storage.");
      return resolve(null);
    }
    const req = indexedDB.open("prohouse_media_db", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("photos")) {
        const store = db.createObjectStore("photos", { keyPath: "id" });
        store.createIndex("branch", "branch", { unique: false });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("session", "sessionId", { unique: false });
      }
    };
    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };
    req.onerror = (e) => resolve(null);
  });
}

async function savePhotoRecord(photoData) {
  const db = await openMediaDatabase();
  photoData.id = photoData.id || "IMG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  photoData.timestamp = photoData.timestamp || new Date().toISOString();
  photoData.uploaded = photoData.uploaded || false;

  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction("photos", "readwrite");
      const store = tx.objectStore("photos");
      store.put(photoData);
      tx.oncomplete = () => resolve(photoData);
      tx.onerror = () => resolve(savePhotoToLocalStorageFallback(photoData));
    });
  } else {
    return savePhotoToLocalStorageFallback(photoData);
  }
}

function savePhotoToLocalStorageFallback(photoData) {
  try {
    const list = JSON.parse(localStorage.getItem("ph_local_photos") || "[]");
    list.push(photoData);
    localStorage.setItem("ph_local_photos", JSON.stringify(list.slice(-50))); // حفظ آخر 50 صورة فقط
  } catch (e) {
    console.error("LocalStorage photo limit fallback", e);
  }
  return photoData;
}

async function getPhotosForSession(sessionId) {
  const db = await openMediaDatabase();
  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction("photos", "readonly");
      const store = tx.objectStore("photos");
      const index = store.index("session");
      const req = index.getAll(sessionId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve(getPhotosFromLocalStorageFallback(sessionId));
    });
  }
  return getPhotosFromLocalStorageFallback(sessionId);
}

function getPhotosFromLocalStorageFallback(sessionId) {
  const list = JSON.parse(localStorage.getItem("ph_local_photos") || "[]");
  return list.filter(p => p.sessionId === sessionId);
}

async function getAllPhotos(branchFilter, dateFilter) {
  const db = await openMediaDatabase();
  let photos = [];
  if (db) {
    photos = await new Promise((resolve) => {
      const tx = db.transaction("photos", "readonly");
      const store = tx.objectStore("photos");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } else {
    photos = JSON.parse(localStorage.getItem("ph_local_photos") || "[]");
  }

  if (branchFilter) photos = photos.filter(p => p.branch === branchFilter);
  if (dateFilter) photos = photos.filter(p => p.date === dateFilter);
  return photos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// ---- تجربة التصوير الميداني بالكاميرا الحية ----
function openCameraModal(checkpointObj, callback) {
  currentActiveCheckpoint = checkpointObj;
  currentActiveCallback = callback;

  let modal = document.getElementById("cameraModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "cameraModal";
    modal.className = "camera-modal-backdrop";
    modal.innerHTML = `
      <div class="camera-modal-box">
        <div class="camera-header">
          <div class="camera-active-badge"><span class="pulse-dot">●</span> 🔴 CAMERA ACTIVE</div>
          <span class="checkpoint-title" id="cameraModalTitle">تصوير نقطة الفحص</span>
          <button class="camera-close-btn" onclick="closeCameraModal()">✕</button>
        </div>
        
        <div class="camera-viewfinder">
          <video id="cameraVideo" autoplay playsinline muted></video>
          <canvas id="cameraCanvas" style="display:none;"></canvas>
          <img id="cameraPreviewImg" style="display:none;" />
        </div>

        <div class="camera-controls">
          <button class="btn gold capture-btn" id="btnSnapPhoto" onclick="takePhotoSnap()">📷 التقاط الصورة</button>
          <button class="btn primary hidden" id="btnConfirmPhoto" onclick="confirmPhotoSnap()">✓ اعتماد الصورة</button>
          <button class="btn secondary hidden" id="btnRetakePhoto" onclick="retakePhotoSnap()">🔄 إعادة التصوير</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  document.getElementById("cameraModalTitle").textContent = checkpointObj ? checkpointObj.name : "تصوير الفحص البصري";
  document.getElementById("btnSnapPhoto").classList.remove("hidden");
  document.getElementById("btnConfirmPhoto").classList.add("hidden");
  document.getElementById("btnRetakePhoto").classList.add("hidden");
  document.getElementById("cameraVideo").style.display = "block";
  document.getElementById("cameraPreviewImg").style.display = "none";
  modal.classList.add("active");

  startCameraStream();
}

async function startCameraStream() {
  const video = document.getElementById("cameraVideo");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    currentCameraStream = stream;
    if (video) video.srcObject = stream;
  } catch (err) {
    console.warn("Camera access failed or denied:", err);
    showToast("⚠️ تعذر فتح الكاميرا المباشرة — يرجى السماح بصلاحية الكاميرا بالمتصفح");
  }
}

function stopCameraStream() {
  if (currentCameraStream) {
    currentCameraStream.getTracks().forEach(t => t.stop());
    currentCameraStream = null;
  }
}

function closeCameraModal() {
  stopCameraStream();
  const modal = document.getElementById("cameraModal");
  if (modal) modal.classList.remove("active");
}

let capturedDataUrl = null;

function takePhotoSnap() {
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("cameraCanvas");
  const img = document.getElementById("cameraPreviewImg");
  if (!video || !canvas) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  capturedDataUrl = canvas.toDataURL("image/jpeg", 0.7); // ضغط الصورة 70% للسرعة والأوفلاين
  img.src = capturedDataUrl;
  img.style.display = "block";
  video.style.display = "none";

  document.getElementById("btnSnapPhoto").classList.add("hidden");
  document.getElementById("btnConfirmPhoto").classList.remove("hidden");
  document.getElementById("btnRetakePhoto").classList.remove("hidden");
}

function retakePhotoSnap() {
  const video = document.getElementById("cameraVideo");
  const img = document.getElementById("cameraPreviewImg");
  if (video) video.style.display = "block";
  if (img) img.style.display = "none";

  document.getElementById("btnSnapPhoto").classList.remove("hidden");
  document.getElementById("btnConfirmPhoto").classList.add("hidden");
  document.getElementById("btnRetakePhoto").classList.add("hidden");
}

async function confirmPhotoSnap() {
  if (!capturedDataUrl) return;
  const emp = Auth.getEmployee();
  const branch = Branch.get() || allowedBranchList()[0] || "";

  const photoObj = {
    id: "IMG-" + Date.now(),
    dataUrl: capturedDataUrl,
    checkpointId: currentActiveCheckpoint ? currentActiveCheckpoint.id : "gen",
    checkpointName: currentActiveCheckpoint ? currentActiveCheckpoint.name : "فحص بصري",
    branch: branch,
    employeeName: emp ? emp.name : "موظف الفرع",
    date: todayStr(),
    timestamp: new Date().toISOString(),
    uploaded: true
  };

  await savePhotoRecord(photoObj);
  showToast("✓ تم التقاط الصورة وتوثيق الفحص بنجاح!");
  closeCameraModal();

  if (typeof currentActiveCallback === "function") {
    currentActiveCallback(photoObj);
  }
}

// ---- شاشة معرض المراقبة الميدانية والـ Timeline ----
async function renderInspectionGalleryView() {
  const view = document.getElementById("inspectionView");
  if (!view) return;

  view.innerHTML = '<div class="loader">جاري تحميل صور المراقبة الميدانية وسجل الساعات…</div>';
  const branch = Branch.get() || allowedBranchList()[0] || "";
  const date = todayStr();

  const photos = await getAllPhotos(branch, date);

  let html = `
    <div class="inspection-gallery-panel">
      <div class="inspection-header">
        <div>
          <h2>📷 المعاينة الميدانية وسجل الصور التشغيلية</h2>
          <div class="sub-text">التوثيق البصري المباشر لافتتاح وإغلاق فرع ${branch}</div>
        </div>
        <div class="branch-selector-wrap">
          <select onchange="onInspectionBranchChange(this.value)">
            ${branchOptionsHtml(branch)}
          </select>
        </div>
      </div>

      <div class="inspection-timeline-wrap">
        <h3>⏱️ التسلسل الزمني للفحص البصري (Timeline)</h3>
        ${photos.length === 0 ? `
          <div class="empty-state">لا توجد صور معاينة ملتقطة لليوم لهذا الفرع بعد.</div>
        ` : `
          <div class="timeline-grid">
            ${photos.map(p => `
              <div class="timeline-card">
                <div class="timeline-img-wrap" onclick="viewPhotoFullscreen('${p.id}')">
                  <img src="${p.dataUrl}" alt="${p.checkpointName}" />
                  <span class="timeline-time">${new Date(p.timestamp).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div class="timeline-info">
                  <strong>${p.checkpointName}</strong>
                  <div class="timeline-emp">👤 ${p.employeeName}</div>
                </div>
              </div>
            `).join("")}
          </div>
        `}
      </div>
    </div>
  `;

  view.innerHTML = html;
}

function onInspectionBranchChange(branch) {
  Branch.set(branch);
  renderInspectionGalleryView();
}

function viewPhotoFullscreen(photoId) {
  // تكبير الصورة
  getAllPhotos().then(list => {
    const p = list.find(x => x.id === photoId);
    if (!p) return;
    let overlay = document.getElementById("photoFullscreenOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "photoFullscreenOverlay";
      overlay.className = "fullscreen-photo-overlay";
      overlay.onclick = () => overlay.classList.remove("active");
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="fullscreen-box" onclick="event.stopPropagation()">
        <img src="${p.dataUrl}" alt="${p.checkpointName}" />
        <div class="fullscreen-caption">
          <h3>${p.checkpointName}</h3>
          <div>الفرع: ${p.branch} | الموظف: ${p.employeeName} | الوقت: ${new Date(p.timestamp).toLocaleString("ar-SA")}</div>
        </div>
        <button class="fullscreen-close" onclick="document.getElementById('photoFullscreenOverlay').classList.remove('active')">✕</button>
      </div>
    `;
    overlay.classList.add("active");
  });
}
