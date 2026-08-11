// ==================== وحدة المزامنة (طابور حفظ محلي + كاش قراءة) ====================
// كل الحفظ يمر من هون: يُكتب فوراً بالكاش المحلي (تجربة استخدام فورية)،
// ينضاف لطابور الانتظار، ويحاول يتزامن مع Apps Script فوراً ثم عند رجوع النت.

const Sync = (() => {
  const QUEUE_KEY = "ph_pending_queue";
  const listeners = [];

  function onStatusChange(fn) { listeners.push(fn); }
  function emitStatus() {
    const q = getQueue();
    listeners.forEach(fn => fn({ pending: q.length }));
  }

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
    catch (e) { return []; }
  }
  function setQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    emitStatus();
  }

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem("ph_cache:" + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function cacheSet(key, value) {
    localStorage.setItem("ph_cache:" + key, JSON.stringify({ value, fetchedAt: Date.now() }));
  }

  // ---- طلبات القراءة (GET) — cache-first-unblocked ----
  async function get(action, params, cacheKey, onFresh) {
    const ck = cacheKey || action;
    const cached = cacheGet(ck);

    // نطلق طلب التحديث بالخلفية بدون تعطيل واجهة المستخدم
    const fetchPromise = (async () => {
      if (!API_URL) return null;
      try {
        const qs = new URLSearchParams({ action, token: Auth.getToken(), ...(params || {}) }).toString();
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(API_URL + "?" + qs, { signal: controller.signal });
        clearTimeout(t);
        const json = await res.json();
        if (!json.ok) {
          if (isAuthError(json.error)) forceReLogin();
          throw new Error(json.error || "server error");
        }
        cacheSet(ck, json.data);
        if (onFresh) onFresh(json.data);
        return json.data;
      } catch (e) {
        if (e.name !== "AbortError") {
          console.debug("Sync.get background fetch note:", action, e.message || e);
        }
        return null;
      }
    })();

    // إذا كان البيانات موجودة بالكاش المحلّي، بنرجّعها فوراً للواجهة (0 ملي ثانية) والـ Network بيمشي بالخلفية
    if (cached && cached.value !== null && cached.value !== undefined) {
      return cached.value;
    }

    // إذا ما كانت بالكاش أبداً، ننتظر طلب الشبكة الأوّل
    const fresh = await fetchPromise;
    return fresh !== null ? fresh : (cached ? cached.value : null);
  }

  // ---- طلبات الكتابة (POST) — عبر الطابور ----
  function enqueue(dedupeKey, action, payload) {
    const q = getQueue();
    const existingIdx = q.findIndex(item => item.key === dedupeKey);
    const entry = {
      id: existingIdx >= 0 ? q[existingIdx].id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
      key: dedupeKey, action, payload,
      createdAt: Date.now(), attempts: 0, lastError: null, lastAttemptAt: null
    };
    if (existingIdx >= 0) q[existingIdx] = entry; else q.push(entry);
    setQueue(q);
    flushQueue();
    return entry.id;
  }

  async function postOnce(action, payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // يتفادى CORS preflight مع Apps Script
      body: JSON.stringify({ action, payload, token: Auth.getToken() })
    });
    const json = await res.json();
    if (!json.ok) {
      if (isAuthError(json.error)) forceReLogin();
      throw new Error(json.error || "server error");
    }
    return json.data;
  }

  // يمسح كاش القراءة كله (مو طابور الحفظ ولا الجلسة). ضروري لما تتغيّر البيانات على
  // الشيت من برا التطبيق — تصحيح يدوي، أو سكربت، أو صيانة — لأن القراءة cache-first
  // فبيضل الجهاز عارض نسخته القديمة وما في شي بيخبره إنها بطلت صحيحة.
  function clearReadCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("ph_cache:")) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    return keys.length;
  }

  // نداء مباشر بانتظار النتيجة — للأفعال اللي بدنا نعرف نتيجتها فوراً (متل اختبار الواتساب)
  // وإعادة المحاولة التلقائية إلها ما إلها معنى. مو للحفظ — الحفظ بيمر من enqueue.
  async function call(action, payload) {
    if (!API_URL) throw new Error("الباك اند مو مربوط");
    return await postOnce(action, payload);
  }

  // أخطاء الجلسة/الصلاحيات ما لازم تدخل بطابور إعادة المحاولة (رح تفشل كل مرة بنفس السبب) —
  // بدل هيك، نوقف المزامنة ونطلب تسجيل دخول جديد.
  function isAuthError(msg) {
    const m = String(msg || "");
    return m.includes("تسجل دخول") || m.includes("الجلسة") || m.includes("الحساب غير مفعّل");
  }
  function forceReLogin() {
    if (typeof Auth !== "undefined") Auth.clearSessionAndReload && Auth.clearSessionAndReload();
  }

  let flushing = false;
  async function flushQueue() {
    if (flushing) return;
    if (!API_URL) return; // ما نُشر الباك اند بعد
    flushing = true;
    try {
      let q = getQueue();
      for (let i = 0; i < q.length; i++) {
        const item = q[i];
        const backoff = Math.min(Math.pow(2, item.attempts) * 5000, 5 * 60000);
        if (item.lastAttemptAt && Date.now() - item.lastAttemptAt < backoff) continue;
        try {
          item.lastAttemptAt = Date.now();
          await postOnce(item.action, item.payload);
          q = q.filter(x => x.id !== item.id);
          setQueue(q);
        } catch (e) {
          item.attempts += 1;
          item.lastError = String(e);
          setQueue(q);
          break; // نوقف باقي الطابور — غالباً السبب انقطاع نت/سيرفر
        }
      }
    } finally {
      flushing = false;
    }
  }

  window.addEventListener("online", flushQueue);
  setInterval(flushQueue, 45000);

  return { get, call, enqueue, flushQueue, getQueue, cacheGet, cacheSet, clearReadCache, onStatusChange, emitStatus };
})();
