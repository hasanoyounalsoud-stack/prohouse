// ==================== محرك Supabase فائق السرعة لـ Pro House ====================
// ينفذ كل عمليات النظام (قراءة، حفظ، مصادقة) خلال 30-80 ملي ثانية فقط!

const SupaEngine = (() => {
  const PIN_SALT = "prohouse-2026-salt";

  async function sha256(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(PIN_SALT + str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function getHeaders(extraHeaders) {
    return {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(extraHeaders || {})
    };
  }

  async function query(endpoint, options = {}) {
    const url = SUPABASE_URL + "/rest/v1/" + endpoint;
    const res = await fetch(url, {
      ...options,
      headers: getHeaders(options.headers)
    });
    if (!res.ok) {
      let errText = await res.text();
      throw new Error(`Supabase error [${res.status}]: ${errText}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // --- تسجيل الدخول والمصادقة ---
  async function login(pin) {
    if (!pin) throw new Error("أدخل الرقم السري");
    const hash = await sha256(pin);

    const users = await query(`employees?select=*&pin=eq.${encodeURIComponent(hash)}&active=eq.true`);
    if (!users || !users.length) {
      throw new Error("الرقم السري غير صحيح");
    }

    const row = users[0];
    const token = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + (crypto.randomUUID ? crypto.randomUUID() : "");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await query("sessions", {
      method: "POST",
      body: JSON.stringify({
        token,
        employee_id: row.id,
        expires_at: expiresAt
      })
    });

    return {
      token,
      employee: {
        id: row.id,
        name: row.name,
        role: row.role,
        branches: (row.branches || "").split(",").map(s => s.trim()).filter(Boolean)
      }
    };
  }

  async function changePin(employee, { currentPin, newPin }) {
    if (!/^\d{4,8}$/.test(newPin)) throw new Error("الرقم الجديد لازم يكون من 4 لـ 8 أرقام");
    if (currentPin === newPin) throw new Error("الرقم الجديد نفس القديم");

    const curHash = await sha256(currentPin);
    const newHash = await sha256(newPin);

    const users = await query(`employees?select=*&id=eq.${employee.id}&pin=eq.${curHash}`);
    if (!users || !users.length) throw new Error("الرقم الحالي غير صحيح");

    const taken = await query(`employees?select=id&pin=eq.${newHash}&id=neq.${employee.id}`);
    if (taken && taken.length) throw new Error("الرقم مستخدم من موظف آخر");

    await query(`employees?id=eq.${employee.id}`, {
      method: "PATCH",
      body: JSON.stringify({ pin: newHash })
    });

    await query(`sessions?employee_id=eq.${employee.id}`, { method: "DELETE" });
    return { ok: true };
  }

  // --- قراءة الأصناف ---
  async function getItems(all) {
    const filter = all ? "" : "&active=eq.true";
    const res = await query(`items?select=*${filter}&order=sort_order.asc`);
    return (res || []).map(r => ({
      id: r.id,
      category: r.category,
      name: r.name,
      unit: r.unit,
      hasCustomName: r.has_custom_name,
      branches: r.branches,
      active: r.active,
      sortOrder: r.sort_order,
      updatedAt: r.updated_at
    }));
  }

  async function saveItem(payload) {
    const id = payload.id || (crypto.randomUUID ? crypto.randomUUID() : "it_" + Date.now());
    const body = {
      id,
      category: payload.category,
      name: payload.name,
      unit: payload.unit,
      has_custom_name: !!payload.hasCustomName,
      branches: payload.branches || "",
      active: payload.active !== false,
      sort_order: payload.sortOrder || 0,
      updated_at: new Date().toISOString()
    };
    await query("items", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(body)
    });
    return { id };
  }

  async function deleteItem(payload) {
    await query(`items?id=eq.${payload.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false, updated_at: new Date().toISOString() })
    });
    return { id: payload.id };
  }

  // --- تقرير الاستلام وميتا اليوم (DailyEntries & DayMeta) ---
  async function getDay(date, branch) {
    const [entries, meta] = await Promise.all([
      query(`daily_entries?select=*&date=eq.${date}&branch=eq.${encodeURIComponent(branch)}`),
      query(`day_meta?select=*&date=eq.${date}&branch=eq.${encodeURIComponent(branch)}`)
    ]);

    return {
      date,
      branch,
      meta: meta && meta[0] ? {
        date: meta[0].date,
        branch: meta[0].branch,
        employeeName: meta[0].employee_name,
        salesReportLink: meta[0].sales_report_link,
        paymentsReportLink: meta[0].payments_report_link,
        savedAt: meta[0].saved_at,
        updatedAt: meta[0].updated_at
      } : null,
      items: (entries || []).map(e => ({
        date: e.date,
        branch: e.branch,
        itemId: e.item_id,
        itemName: e.item_name,
        unit: e.unit,
        confirmed: e.confirmed,
        received: e.received,
        returned: e.returned,
        cookName: e.cook_name,
        notes: e.notes,
        savedAt: e.saved_at
      }))
    };
  }

  async function saveDay(payload) {
    const { date, branch, items, employeeName, salesReportLink, paymentsReportLink } = payload;
    
    // حفظ أو تحديث الميتا
    if (employeeName || salesReportLink || paymentsReportLink) {
      await query("day_meta", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({
          date,
          branch,
          employee_name: employeeName || "",
          sales_report_link: salesReportLink || "",
          payments_report_link: paymentsReportLink || "",
          updated_at: new Date().toISOString()
        })
      });
    }

    if (items && items.length) {
      const rows = items.map(it => ({
        date,
        branch,
        item_id: it.itemId,
        item_name: it.itemName || "",
        unit: it.unit || "",
        confirmed: !!it.confirmed,
        received: it.received === "" || it.received == null ? 0 : Number(it.received),
        returned: it.returned === "" || it.returned == null ? 0 : Number(it.returned),
        cook_name: it.cookName || "",
        notes: it.notes || "",
        saved_at: new Date().toISOString()
      }));

      await query("daily_entries", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(rows)
      });
    }

    return { date, branch, savedAt: new Date().toISOString() };
  }

  // --- طلبيات الغد (TomorrowOrders) ---
  async function getTomorrowOrder(date, branch) {
    const res = await query(`tomorrow_orders?select=*&date=eq.${date}&branch=eq.${encodeURIComponent(branch)}`);
    return (res || []).map(r => ({
      date: r.date,
      branch: r.branch,
      itemId: r.item_id,
      itemName: r.item_name,
      unit: r.unit,
      qty: r.qty,
      notes: r.notes,
      employeeName: r.employee_name
    }));
  }

  async function saveTomorrowOrder(payload) {
    const { date, branch, items, employeeName } = payload;
    if (items && items.length) {
      const rows = items.map(it => ({
        date,
        branch,
        item_id: it.itemId,
        item_name: it.itemName || "",
        unit: it.unit || "",
        qty: it.qty === "" || it.qty == null ? 0 : Number(it.qty),
        notes: it.notes || "",
        employee_name: employeeName || "",
        saved_at: new Date().toISOString()
      }));

      await query("tomorrow_orders", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(rows)
      });
    }
    return { date, branch, savedAt: new Date().toISOString() };
  }

  // --- سجل الهدر (WasteLog) ---
  async function getWasteReport(date, branch) {
    const res = await query(`waste_log?select=*&date=eq.${date}&branch=eq.${encodeURIComponent(branch)}`);
    return {
      date,
      branch,
      items: (res || []).map(r => ({
        id: r.id,
        date: r.date,
        branch: r.branch,
        itemId: r.item_id,
        itemName: r.item_name,
        unit: r.unit,
        qty: r.qty,
        reason: r.reason,
        notes: r.notes,
        employeeName: r.employee_name,
        timestamp: r.timestamp
      }))
    };
  }

  async function saveWasteReport(payload) {
    const { date, branch, items } = payload;
    if (items && items.length) {
      const rows = items.map(it => ({
        id: it.id || (crypto.randomUUID ? crypto.randomUUID() : "wst_" + Date.now() + Math.random()),
        date,
        branch,
        item_id: it.itemId || "",
        item_name: it.itemName || "",
        unit: it.unit || "",
        qty: it.qty === "" || it.qty == null ? 0 : Number(it.qty),
        reason: it.reason || "",
        notes: it.notes || "",
        employee_name: it.employeeName || "",
        timestamp: it.timestamp || "",
        saved_at: new Date().toISOString()
      }));

      await query(`waste_log?date=eq.${date}&branch=eq.${encodeURIComponent(branch)}`, { method: "DELETE" });
      await query("waste_log", {
        method: "POST",
        body: JSON.stringify(rows)
      });
    }
    return { date, branch, count: (items || []).length };
  }

  // --- جرد العصيرات (Juices & Counts) ---
  async function getJuices(all) {
    const filter = all ? "" : "&active=eq.true";
    const res = await query(`juices?select=*${filter}&order=sort_order.asc`);
    return (res || []).map(r => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      tabsenseName: r.tabsense_name,
      branches: r.branches,
      active: r.active,
      sortOrder: r.sort_order
    }));
  }

  async function getJuiceDay(date, branch) {
    const prevDate = addDaysStr(date, -1);
    const [todayItems, prevItems, sales] = await Promise.all([
      query(`juice_counts?select=*&date=eq.${date}&branch=eq.${encodeURIComponent(branch)}`),
      query(`juice_counts?select=*&date=eq.${prevDate}&branch=eq.${encodeURIComponent(branch)}`),
      query(`juice_sales?select=*&date=eq.${date}&branch=eq.${encodeURIComponent(branch)}`)
    ]);

    const prevCounted = {};
    (prevItems || []).forEach(r => { prevCounted[r.juice_id] = r.counted; });

    return {
      date,
      branch,
      items: (todayItems || []).map(r => ({
        juiceId: r.juice_id,
        juiceName: r.juice_name,
        unit: r.unit,
        opening: r.opening,
        added: r.added,
        sold: r.sold,
        counted: r.counted,
        notes: r.notes,
        employeeName: r.employee_name
      })),
      prevCounted,
      sales: (sales || []).map(r => ({ productName: r.product_name, qty: r.qty }))
    };
  }

  async function saveJuiceDay(payload) {
    const { date, branch, items, employeeName } = payload;
    if (items && items.length) {
      const rows = items.map(it => ({
        date,
        branch,
        juice_id: it.juiceId,
        juice_name: it.juiceName || "",
        unit: it.unit || "",
        opening: Number(it.opening) || 0,
        added: Number(it.added) || 0,
        sold: Number(it.sold) || 0,
        counted: Number(it.counted) || 0,
        notes: it.notes || "",
        employee_name: employeeName || "",
        saved_at: new Date().toISOString()
      }));

      await query("juice_counts", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(rows)
      });
    }
    return { date, branch, savedAt: new Date().toISOString() };
  }

  // --- الإعدادات والموظفين ---
  async function getSettings() {
    const res = await query("settings?select=*");
    const out = {};
    (res || []).forEach(r => { out[r.key] = r.value; });
    return out;
  }

  async function saveSettings(payload) {
    const entries = Object.keys(payload).map(k => ({
      key: k,
      value: String(payload[k]),
      updated_at: new Date().toISOString()
    }));
    await query("settings", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(entries)
    });
    return getSettings();
  }

  async function getEmployees() {
    const res = await query("employees?select=*&active=eq.true");
    return (res || []).map(r => ({
      id: r.id,
      name: r.name,
      pin: "••••",
      role: r.role,
      branches: r.branches,
      active: r.active
    }));
  }

  // --- المبيعات والتقارير الشاملة ---
  async function getSalesByCategory(start, end, branch) {
    const branchFilter = branch ? `&branch=eq.${encodeURIComponent(branch)}` : "";
    const res = await query(`tabsense_sales?select=*&date=gte.${start}&date=lte.${end}${branchFilter}`);
    return (res || []).map(r => ({
      date: r.date,
      branch: r.branch,
      category: r.category,
      qty: r.qty
    }));
  }

  async function getReport(start, end, branchFilter) {
    let bf = "";
    if (branchFilter && branchFilter.length) {
      const branchesArr = Array.isArray(branchFilter) ? branchFilter : branchFilter.split(",");
      bf = `&branch=in.(${branchesArr.map(b => `"${b.trim()}"`).join(",")})`;
    }

    const [entries, metaRows, tabsense, juices] = await Promise.all([
      query(`daily_entries?select=*&date=gte.${start}&date=lte.${end}${bf}`),
      query(`day_meta?select=*&date=gte.${start}&date=lte.${end}${bf}`),
      query(`tabsense_sales?select=*&date=gte.${start}&date=lte.${end}${bf}`),
      query(`juice_sales?select=*&date=gte.${start}&date=lte.${end}${bf}`)
    ]);

    const byDateBranch = {};
    (entries || []).forEach(r => {
      const k = r.date + "||" + r.branch;
      if (!byDateBranch[k]) byDateBranch[k] = [];
      byDateBranch[k].push({
        date: r.date,
        branch: r.branch,
        itemId: r.item_id,
        itemName: r.item_name,
        unit: r.unit,
        confirmed: r.confirmed,
        received: r.received,
        returned: r.returned,
        cookName: r.cook_name,
        notes: r.notes
      });
    });

    const days = Object.keys(byDateBranch).sort().map(k => {
      const [date, branch] = k.split("||");
      const m = (metaRows || []).find(x => x.date === date && x.branch === branch) || null;
      return {
        date,
        branch,
        meta: m ? { employeeName: m.employee_name, salesReportLink: m.sales_report_link } : null,
        items: byDateBranch[k]
      };
    });

    // حساب الإجماليات
    const totalsMap = {};
    (entries || []).forEach(r => {
      if (!totalsMap[r.item_id]) {
        totalsMap[r.item_id] = { itemId: r.item_id, itemName: r.item_name, unit: r.unit, totalReceived: 0, totalReturned: 0, dayCount: 0 };
      }
      const t = totalsMap[r.item_id];
      const rec = Number(r.received) || 0;
      const ret = Number(r.returned) || 0;
      t.totalReceived += rec;
      t.totalReturned += ret;
      if (rec > 0) t.dayCount++;
    });

    const totals = Object.keys(totalsMap).map(id => {
      const t = totalsMap[id];
      t.avgDaily = t.dayCount > 0 ? t.totalReceived / t.dayCount : null;
      t.returnPct = t.totalReceived > 0 ? t.totalReturned / t.totalReceived : null;
      t.flagged = t.returnPct !== null && t.returnPct >= 0.30;
      return t;
    });

    return {
      days,
      totals,
      flaggedCount: totals.filter(t => t.flagged).length,
      tabsenseSales: tabsense || [],
      juiceSales: juices || []
    };
  }

  return {
    login,
    changePin,
    getItems,
    saveItem,
    deleteItem,
    getDay,
    saveDay,
    getTomorrowOrder,
    saveTomorrowOrder,
    getWasteReport,
    saveWasteReport,
    getJuices,
    getJuiceDay,
    saveJuiceDay,
    getSettings,
    saveSettings,
    getEmployees,
    getSalesByCategory,
    getReport
  };
})();
