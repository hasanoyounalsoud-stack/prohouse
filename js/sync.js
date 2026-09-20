// ==================== وحدة المزامنة (طابور حفظ محلي + كاش قراءة) ====================
// كل الحفظ يمر من هون: يُكتب فوراً بالكاش المحلي (تجربة استخدام فورية)،
// ينضاف لطابور الانتظار، ويحاول يتزامن مع Apps Script فوراً ثم عند رجوع النت.

const Sync = (() => {
  const QUEUE_KEY = "ph_pending_queue";
  const listeners = [];
  let lastReadError = null;

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

  // ---- طلبات القراءة (GET) — فائقة السرعة مع SupaEngine ----
  async function get(action, params, cacheKey, onFresh) {
    const ck = cacheKey || action;
    const cached = cacheGet(ck);
    // إذا كانت البيانات مخزنة محلياً بالكاش، اعرضها فوراً وبشكل فوري (0ms) للواجهة
    // وحدّث الكاش في الخلفية بدون ما ينتظر المستخدم ثانية واحدة
    if (cached && cached.value !== null && cached.value !== undefined) {
      if (typeof SupaEngine !== "undefined" && typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) {
        setTimeout(async () => {
          try {
            let result = null;
            const p = params || {};
            switch (action) {
              case "getItems": result = await SupaEngine.getItems(p.all === "1"); break;
              case "getDay": result = await SupaEngine.getDay(p.date, p.branch); break;
              case "getTomorrowOrder": result = await SupaEngine.getTomorrowOrder(p.date, p.branch); break;
              case "getWasteReport": result = await SupaEngine.getWasteReport(p.date, p.branch); break;
              case "getJuices": result = await SupaEngine.getJuices(p.all === "1"); break;
              case "getJuiceDay": result = await SupaEngine.getJuiceDay(p.date, p.branch); break;
              case "getSettings": result = await SupaEngine.getSettings(); break;
              case "getEmployees": result = await SupaEngine.getEmployees(); break;
              case "getSalesByCategory": result = await SupaEngine.getSalesByCategory(p.start, p.end, p.branch); break;
              case "getReport": result = await SupaEngine.getReport(p.start, p.end, p.branch); break;
              case "getDashboard": result = await SupaEngine.getDashboard(p.date); break;
              case "getFlaggedItems": result = await SupaEngine.getFlaggedItems(p.start, p.end, (typeof Auth !== "undefined" && Auth.role && Auth.role() === "manager") ? Auth.branches() : null); break;
              case "getRemainingReport": result = await SupaEngine.getDay(p.date, p.branch); break;
              case "getInspectionPhotos": result = await SupaEngine.getInspectionPhotos(p.date, p.branch); break;
              case "getChecklist": result = await SupaEngine.getChecklist(p.date, p.branch); break;
            }
            if (result !== null) {
              // إذا كان الطلب هو getDay والبيانات المحلية تحتوي على قيم عبأها المستخدم ولم تُحفظ بعد بالسيرفر، لا نلغيها
              if (action === "getDay" && cached && cached.value && cached.value.items) {
                const localFilled = cached.value.items.filter(i => i.received !== "" && i.received != null);
                if (localFilled.length > 0 && (!result.items || result.items.length === 0)) {
                  return; // الحفاظ على بيانات المستخدم
                }
              }
              cacheSet(ck, result);
              if (onFresh) onFresh(result);
            }
          } catch (e) { /* background update ignore */ }
        }, 0);
      }
      return cached.value;
    }

    // إذا كان متاحاً محرك Supabase، نستخدمه مباشرةً وتكون الاستجابة في بضع ملي ثوانٍ!
    if (typeof SupaEngine !== "undefined" && typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) {
      let handled = true;
      try {
        let result = null;
        const p = params || {};
        switch (action) {
          case "getItems": result = await SupaEngine.getItems(p.all === "1"); break;
          case "getDay": result = await SupaEngine.getDay(p.date, p.branch); break;
          case "getTomorrowOrder": result = await SupaEngine.getTomorrowOrder(p.date, p.branch); break;
          case "getWasteReport": result = await SupaEngine.getWasteReport(p.date, p.branch); break;
          case "getJuices": result = await SupaEngine.getJuices(p.all === "1"); break;
          case "getJuiceDay": result = await SupaEngine.getJuiceDay(p.date, p.branch); break;
          case "getSettings": result = await SupaEngine.getSettings(); break;
          case "getEmployees": result = await SupaEngine.getEmployees(); break;
          case "getSalesByCategory": result = await SupaEngine.getSalesByCategory(p.start, p.end, p.branch); break;
          case "getReport": result = await SupaEngine.getReport(p.start, p.end, p.branch); break;
          case "getDashboard": result = await SupaEngine.getDashboard(p.date); break;
          case "getFlaggedItems": result = await SupaEngine.getFlaggedItems(p.start, p.end, (typeof Auth !== "undefined" && Auth.role && Auth.role() === "manager") ? Auth.branches() : null); break;
          case "getRemainingReport": result = await SupaEngine.getDay(p.date, p.branch); break;
          case "getInspectionPhotos": result = await SupaEngine.getInspectionPhotos(p.date, p.branch); break;
          case "getChecklist": result = await SupaEngine.getChecklist(p.date, p.branch); break;
          default:
            handled = false;
            console.warn("Action not handled directly in SupaEngine:", action);
        }

        if (handled) {
          cacheSet(ck, result);
          if (onFresh) onFresh(result);
          return result;
        }
      } catch (err) {
        console.warn("SupaEngine get fallback:", action, err);
        if (handled) {
          if (cached && cached.value !== null && cached.value !== undefined) {
            return cached.value;
          }
          return null;
        }
      }
    }

    // نطلق طلب التحديث بالخلفية بدون تعطيل واجهة المستخدم (مع Apps Script)
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
        const offline = e.name === "AbortError" || e.name === "TypeError" || !navigator.onLine;
        if (!offline) {
          const msg = String(e.message || e).replace(/^(Error:\s*)+/, "");
          console.error("فشل قراءة " + action + ": " + msg);
          lastReadError = { action, msg, at: Date.now() };
          if (typeof showToast === "function") showToast("⚠ " + action + ": " + msg);
        } else {
          console.debug("Sync.get offline note:", action, e.message || e);
        }
        return null;
      }
    })();

    if (cached && cached.value !== null && cached.value !== undefined) {
      return cached.value;
    }

    const fresh = await fetchPromise;
    return fresh !== null ? fresh : (cached ? cached.value : null);
  }

  // ---- طلبات الكتابة (POST) — فائقة السرعة مع SupaEngine ----
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
    // توجيه الحفظ مباشرة إلى Supabase
    if (typeof SupaEngine !== "undefined" && typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) {
      let handled = true;
      try {
        let res = null;
        switch (action) {
          case "saveItem": res = await SupaEngine.saveItem(payload); break;
          case "deleteItem": res = await SupaEngine.deleteItem(payload); break;
          case "saveJuice": res = await SupaEngine.saveJuice(payload); break;
          case "deleteJuice": res = await SupaEngine.deleteJuice(payload); break;
          case "saveDay": res = await SupaEngine.saveDay(payload); break;
          case "saveRemainingReport": res = await SupaEngine.saveRemainingReport(payload); break;
          case "saveTomorrowOrder": res = await SupaEngine.saveTomorrowOrder(payload); break;
          case "saveWasteReport": res = await SupaEngine.saveWasteReport(payload); break;
          case "saveJuiceDay": res = await SupaEngine.saveJuiceDay(payload); break;
          case "saveSettings": res = await SupaEngine.saveSettings(payload); break;
          case "saveInspectionPhoto": res = await SupaEngine.saveInspectionPhoto(payload); break;
          case "saveChecklist": res = await SupaEngine.saveChecklist(payload); break;
          default:
            handled = false;
            console.warn("Action not handled in SupaEngine postOnce:", action);
        }
        if (res !== null) return res;
      } catch (err) {
        // لو الفعل من مسؤولية سوبابيس وفشل: ما منرجع نكتب على النظام القديم بالخفاء —
        // هيك كانت التعديلات تنقسم بين النظامين وما تبيّن بالمكان الصحيح. منخلي الخطأ
        // يطلع وطابور المزامنة يعيد المحاولة لحاله.
        if (handled) throw err;
        console.warn("SupaEngine postOnce fallback:", err);
      }
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
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

          // فشل دائم (فعل غير معروف، صلاحية) بيتكرر بنفس السبب للأبد. الوقوف عنده كان
          // بيجمّد الطابور كله فما بيوصل ولا حفظ بعده للسيرفر — حصل فعلاً مع saveWasteReport
          // وحجب حفظ الاستلام معه. هلأ منعزله ومنكمّل، ومنبلّغ المستخدم مرة وحدة.
          const msg = String(e.message || e);
          const permanent = /unknown action|غير مصرح|لازم تحدد/.test(msg);

          if (permanent && item.attempts >= 2) {
            q = q.filter(x => x.id !== item.id);
            setQueue(q);
            console.error("انحذف من الطابور لفشل دائم:", item.action, msg);
            if (typeof showToast === "function") showToast("⚠ تعذّر حفظ " + item.action + " — " + msg.replace(/^(Error:\s*)+/, ""));
            continue; // نكمّل باقي الطابور بدل ما نجمّده
          }

          setQueue(q);
          break; // فشل مؤقت (نت/سيرفر) — نوقف ونعيد المحاولة لاحقاً بنفس الترتيب
        }
      }
    } finally {
      flushing = false;
    }
  }

  window.addEventListener("online", flushQueue);
  setInterval(flushQueue, 45000);

  return { get, call, enqueue, flushQueue, getQueue, cacheGet, cacheSet, clearReadCache, onStatusChange, emitStatus, getLastReadError: () => lastReadError };
})();
