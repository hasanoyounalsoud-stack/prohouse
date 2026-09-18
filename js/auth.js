// ==================== تسجيل الدخول والجلسة (رقم سري لكل موظف) ====================
// الجلسة محفوظة محلياً 30 يوم، وبتشتغل حتى بدون نت (offline-first) — التحقق الحقيقي
// من الصلاحيات دايماً عالسيرفر (Code.gs)، هون بس عشان نتحكم بشكل الواجهة.

const Auth = (() => {
  const TOKEN_KEY = "ph_token";
  const EMPLOYEE_KEY = "ph_employee_v2";

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function getEmployee() {
    try { return JSON.parse(localStorage.getItem(EMPLOYEE_KEY)) || null; }
    catch (e) { return null; }
  }
  function isLoggedIn() { return !!(getToken() && getEmployee()); }

  function setSession(token, employee) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EMPLOYEE_KEY, JSON.stringify(employee));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMPLOYEE_KEY);
  }
  let reloadingForAuth = false;
  function clearSessionAndReload() {
    if (reloadingForAuth) return;
    reloadingForAuth = true;
    clearSession();
    location.reload();
  }

  async function login(pin) {
    if (typeof SupaEngine !== "undefined" && typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) {
      try {
        const res = await SupaEngine.login(pin);
        setSession(res.token, res.employee);
        return res.employee;
      } catch (err) {
        console.warn("Supabase login fallback check:", err);
        throw err;
      }
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "login", payload: { pin } })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "فشل تسجيل الدخول");
    setSession(json.data.token, json.data.employee);
    return json.data.employee;
  }

  async function changePin(currentPin, newPin) {
    if (typeof SupaEngine !== "undefined" && typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) {
      const emp = getEmployee();
      if (!emp) throw new Error("لا يوجد جلسة نشطة");
      await SupaEngine.changePin(emp, { currentPin, newPin });
      clearSession();
      return true;
    }

    if (!API_URL) throw new Error("الباك اند مو مربوط");
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "changePin", token: getToken(), payload: { currentPin, newPin } })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "فشل تغيير الرقم");
    clearSession();
    return true;
  }

  async function logout() {
    const token = getToken();
    clearSession();
    if (!API_URL || !token) return;
    try {
      await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "logout", token })
      });
    } catch (e) { /* أوفلاين — بلا فرق، الجلسة انمسحت محلياً أصلاً */ }
  }

  // بتتحقق من الجلسة عالسيرفر (مرة وحدة وقت الإقلاع) وبتحدّث بيانات الموظف محلياً
  async function verify() {
    const token = getToken();
    if (!token) return false;

    if (typeof SupaEngine !== "undefined" && typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) {
      try {
        // التحقق صار عبر دالة verify_session بالداتابيس — جدول الجلسات نفسه
        // ما عاد قابل للقراءة المباشرة من المتصفح
        const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/verify_session", {
          method: "POST",
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ p_token: token })
        });
        const emp = res.ok ? await res.json() : null;

        if (emp && emp.id) {
          const ROSTER_NAMES = {
            emp_1: "أ.يزيد",
            emp_2: "حسن",
            emp_3: "الشيف عصام",
            emp_4: "أبو يونس",
            emp_5: "العامودي",
            emp_6: "محمد البلول",
            emp_7: "غالب"
          };
          const finalName = ROSTER_NAMES[emp.id] || (emp.name && !emp.name.includes("?") ? emp.name : "موظف");
          // موظفو فرع عبداللطيف جميل (محمد البلول وغالب) صلاحيتهم محصورة بالتشغيل وتسجيل البيانات فقط
          const isBranchUser = emp.id === "emp_6" || emp.id === "emp_7" || emp.role === "employee" || emp.role === "branch_staff";
          const finalRole = isBranchUser ? "branch_staff" : emp.role;
          const formatted = {
            id: emp.id,
            name: finalName,
            role: finalRole,
            branches: (emp.branches || "").split(",").map(s => s.trim()).filter(Boolean)
          };
          setSession(token, formatted);
          return true;
        }
        if (res.ok) {
          clearSession();
          return false;
        }
      } catch (err) {
        console.warn("Supabase verify fallback to local:", err);
      }
      return isLoggedIn();
    }

    if (!API_URL || !getToken()) return isLoggedIn();
    try {
      const qs = new URLSearchParams({ action: "me", token: getToken() }).toString();
      const res = await fetch(API_URL + "?" + qs);
      const json = await res.json();
      if (!json.ok) { clearSession(); return false; }
      setSession(getToken(), json.data);
      return true;
    } catch (e) {
      return isLoggedIn();
    }
  }

  function role() { const e = getEmployee(); return e ? e.role : null; }
  function branches() { const e = getEmployee(); return e ? (e.branches || []) : []; }
  function isOwner() { return role() === "owner"; }
  function isBranchStaff() { return role() === "branch_staff" || role() === "employee"; }
  function canSeeAllBranches() { return role() === "owner" || role() === "chef"; }
  function canEditBranch(branch) { return canSeeAllBranches() || branches().includes(branch); }
  function isViewOnlyEntry() { return role() === "chef"; }
  function isViewOnlyTomorrow() { return role() === "chef"; }
  function canSeeReports() { return role() === "owner" || role() === "chef"; }
  function canSeeFinancials() { return role() === "owner"; }
  function canManageItems() { return role() === "owner"; }
  function canManageSettings() { return role() === "owner"; }

  return {
    getToken, getEmployee, isLoggedIn, login, logout, changePin, verify, clearSessionAndReload,
    role, branches, isOwner, isBranchStaff, canSeeAllBranches, canEditBranch,
    isViewOnlyEntry, isViewOnlyTomorrow, canSeeReports, canSeeFinancials, canManageItems, canManageSettings
  };
})();
