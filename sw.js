// Service Worker: Pro House Operations Center v4.3.5
// يخزّن هيكل التطبيق (HTML/CSS/JS) محلياً لدعم العمل أوفلاين التام للموظفين والفروع.

const CACHE_NAME = "prohouse-shell-v4.8.3";

// التخزين المسبق ضروري: بدونه أول فتحة بدون نت بتفشل كلياً لأنه ما في شي مخزّن أصلاً.
// أي ملف جديد ينضاف لـ index.html لازم ينضاف هون كمان، وإلا التطبيق بينكسر أوفلاين بس.
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/config.js",
  "./js/supabase-engine.js",
  "./js/shared.js",
  "./js/auth.js",
  "./js/sync.js",
  "./js/items.js",
  "./js/camera.js",
  "./js/branches.js",
  "./js/receiving.js",
  "./js/remaining.js",
  "./js/waste.js",
  "./js/users.js",
  "./js/audit.js",
  "./js/entry.js",
  "./js/forecast.js",
  "./js/tomorrow.js",
  "./js/juices.js",
  "./js/checklist.js",
  "./js/report.js",
  "./js/settings.js",
  "./js/dashboard.js",
  "./js/main.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const fromCache = () => caches.match(req, { ignoreSearch: true });

  // استراتيجية Stale-While-Revalidate فائقة السرعة للتطبيق:
  // تقديم الملفات فوراً وبشكل لحظي (0ms) من الكاش المحلي بالجهاز،
  // وتحديث الكاش بالخلفية بدون إبطاء المستخدم أو انتظار شبكة الجوال
  event.respondWith(
    fromCache().then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => null);

      return cached || fetchPromise;
    })
  );
});
