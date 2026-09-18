// Service Worker: Pro House Operations Center v4.3.5
// يخزّن هيكل التطبيق (HTML/CSS/JS) محلياً لدعم العمل أوفلاين التام للموظفين والفروع.

const CACHE_NAME = "prohouse-shell-v4.7.1";

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

  const isAppCode = url.pathname.endsWith(".html") || url.pathname.endsWith(".js") ||
                    url.pathname.endsWith(".css") || url.pathname.endsWith(".json") ||
                    url.pathname.endsWith("/");

  const fromCache = () => caches.match(req, { ignoreSearch: true });

  if (isAppCode) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(fromCache)
    );
    return;
  }

  event.respondWith(
    fromCache().then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      return res;
    }))
  );
});
