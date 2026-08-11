/**
 * Pro House — Apps Script backend.
 * Bind this script to the Google Sheet that has these tabs (header row = row 1):
 *   Items:          id, category, name, unit, hasCustomName, branches, active, sortOrder, updatedAt
 *   DailyEntries:   date, branch, itemId, itemName, unit, confirmed, received, returned, cookName, notes, savedAt
 *   DayMeta:        date, branch, employeeName, salesReportLink, paymentsReportLink, savedAt, updatedAt
 *   TomorrowOrders: date, branch, itemId, itemName, unit, qty, notes, employeeName, savedAt
 *   Employees:      name, active, id, pin, role, branches   (roles: owner, manager, chef, employee)
 *   Sessions:       token, employeeId, createdAt, expiresAt
 *   TabsenseSales:  date, branch, category, qty, importedAt
 *   Juices:         id, name, unit, tabsenseName, branches, active, sortOrder, updatedAt
 *   JuiceCounts:    date, branch, juiceId, juiceName, unit, opening, added, sold, counted, notes, employeeName, savedAt
 *   JuiceSales:     date, branch, productName, qty, importedAt
 *   Settings:       key, value
 *
 * Deploy: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
 * Every code change needs a NEW deployment version (Deploy > Manage deployments > Edit > New version)
 * or the live /exec URL keeps running the old code.
 */

var SHEET_NAMES = {
  ITEMS: 'Items',
  DAILY: 'DailyEntries',
  DAYMETA: 'DayMeta',
  TOMORROW: 'TomorrowOrders',
  EMPLOYEES: 'Employees',
  SESSIONS: 'Sessions',
  TABSENSE: 'TabsenseSales',
  JUICES: 'Juices',
  JUICE_COUNTS: 'JuiceCounts',
  JUICE_SALES: 'JuiceSales',
  SETTINGS: 'Settings'
};

// ملاحظة: بعمود Employees حافظنا على ترتيب name/active بمكانه الأصلي وضفنا الأعمدة الجديدة
// آخر الصف بدل ما نعيد ترتيبها بالكامل — تغيير ترتيب الأعمدة الموجودة بيخرب البيانات الحالية
// (نفس مشكلة "column-shift" اللي انصلحت قبل هيك بمشروع تاني).
var SHEET_HEADERS = {
  Items: ['id', 'category', 'name', 'unit', 'hasCustomName', 'branches', 'active', 'sortOrder', 'updatedAt'],
  DailyEntries: ['date', 'branch', 'itemId', 'itemName', 'unit', 'confirmed', 'received', 'returned', 'cookName', 'notes', 'savedAt'],
  DayMeta: ['date', 'branch', 'employeeName', 'salesReportLink', 'paymentsReportLink', 'savedAt', 'updatedAt'],
  TomorrowOrders: ['date', 'branch', 'itemId', 'itemName', 'unit', 'qty', 'notes', 'employeeName', 'savedAt'],
  Employees: ['name', 'active', 'id', 'pin', 'role', 'branches'],
  Sessions: ['token', 'employeeId', 'createdAt', 'expiresAt'],
  TabsenseSales: ['date', 'branch', 'category', 'qty', 'importedAt'],
  Juices: ['id', 'name', 'unit', 'tabsenseName', 'branches', 'active', 'sortOrder', 'updatedAt'],
  JuiceCounts: ['date', 'branch', 'juiceId', 'juiceName', 'unit', 'opening', 'added', 'sold', 'counted', 'notes', 'employeeName', 'savedAt'],
  JuiceSales: ['date', 'branch', 'productName', 'qty', 'importedAt'],
  Settings: ['key', 'value', 'updatedAt']
};

var DEFAULT_BRANCHES = 'الروضة,الشاطئ,عبداللطيف جميل';
// لازم يطابق DEFAULT_CATEGORY_ORDER_FALLBACK بـ js/config.js — كان ناقصه "ساندويتشات"
// مع إنها من تصنيفات الوزن بحساب الوجبات، فكانت بتنزل لآخر الترتيب بأي شاشة.
var DEFAULT_CATEGORY_ORDER = 'دجاج,لحم,بحري,ساندويتشات,كارب,السلطات,الحلويات,فطور,معدات';
var SESSION_DAYS = 30;

// الأدوار والفروع الأولية لكل موظف. **ما فيه أرقام سرية هون عن قصد** — هاد الملف منشور
// بريبو عام، وأي رقم بينكتب فيه بيصير مقروء للكل وبيضل بتاريخ git للأبد حتى لو انمسح بعدين.
// الأرقام بتتولّد عشوائياً وقت الإعداد وبتنطبع بسجل التنفيذ (View > Executions) للي بيشغّل الدالة بس.
var EMPLOYEE_ROSTER = {
  'أ.يزيد': { role: 'owner', branches: '' },
  'حسن': { role: 'owner', branches: '' },
  'الشيف عصام': { role: 'chef', branches: '' },
  'أبو يونس': { role: 'manager', branches: 'الروضة,الشاطئ' },
  'العامودي': { role: 'manager', branches: 'الشاطئ' },
  'عبدالهادي': { role: 'manager', branches: 'عبداللطيف جميل' },
  'غالب': { role: 'employee', branches: 'عبداللطيف جميل' }
};

function randomPin_() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * شغّل هاي الدالة مرة وحدة بس (▶ Run فوق، اختارها من القائمة، وافق على الصلاحيات).
 * بتنشئ كل التبويبات المطلوبة تلقائياً بأسماء وأعمدة صحيحة، وبتعبي بيانات أولية،
 * وبتضيف أعمدة تسجيل الدخول (id/pin/role/branches) للموظفين الموجودين إذا كانوا ناقصين.
 * ممكن تشغّلها أكثر من مرة بأمان: ما بتكرر التبويبات ولا البيانات إذا كانت موجودة أصلاً.
 */
function setupEverything() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SHEET_HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = SHEET_HEADERS[name];
    // نكتب صف العناوين دايماً (حتى لو الشيت مش فاضي) — كتابة العناوين آمنة 100% وما بتلمس صفوف البيانات (تبلش من صف 2)،
    // وهيك بتصلح لحالها أي عناوين مكتوبة غلط يدوياً قبل هيك.
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    // نص عادي لكل الأعمدة (مو بس date) — Sheets بيحوّل قيم زي "1/3" أو "2026-07-25" لتاريخ
    // تلقائياً حتى لو العمود Plain Text أصلاً؛ هذا بيمنع تكرار المشكلة بأي عمود مستقبلاً.
    sh.getRange(2, 1, 2000, headers.length).setNumberFormat('@');
  });

  // احذف تبويب "Sheet1" الفاضي الافتراضي إذا ما زال موجود وما فيه بيانات
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }

  seedInitialDataIfEmpty();
  migrateEmployees_();
  ensureDefaultSetting('branches', DEFAULT_BRANCHES);
  ensureDefaultSetting('categoryOrder', DEFAULT_CATEGORY_ORDER);
  ensureDefaultSetting('integrationToken', Utilities.getUuid());
  return 'تم إعداد كل التبويبات بنجاح';
}

// يضيف إعداد افتراضي بس إذا كان مش موجود أصلاً (ما بيلمس قيمة موجودة سابقاً حتى لو تغيّرت يدوياً)
function ensureDefaultSetting(key, defaultValue) {
  var r = readRows(SHEET_NAMES.SETTINGS);
  var exists = r.rows.some(function (row) { return row.key === key; });
  if (!exists) appendRow(SHEET_NAMES.SETTINGS, { key: key, value: defaultValue, updatedAt: nowIso() });
}

// يعبّي أعمدة تسجيل الدخول (id/pin/role/branches) للموظفين الموجودين بالشيت لو كانت فاضية —
// ما بيلمس أي قيمة موجودة أصلاً، حتى لو تعدّلت يدوياً بالشيت. آمنة تشتغل أكثر من مرة.
function migrateEmployees_() {
  var r = readRows(SHEET_NAMES.EMPLOYEES);
  var idCol = r.headers.indexOf('id') + 1;
  var pinCol = r.headers.indexOf('pin') + 1;
  var roleCol = r.headers.indexOf('role') + 1;
  var branchesCol = r.headers.indexOf('branches') + 1;
  var issued = [];
  r.rows.forEach(function (row, i) {
    var rowNum = i + 2;
    var name = String(row.name || '').trim();
    var roster = EMPLOYEE_ROSTER[name];
    if (!row.id) r.sh.getRange(rowNum, idCol).setValue(Utilities.getUuid());
    if (!row.role) r.sh.getRange(rowNum, roleCol).setValue(roster ? roster.role : 'employee');
    if (!row.branches && roster) r.sh.getRange(rowNum, branchesCol).setValue(roster.branches);
    if (!row.pin) {
      var pin = randomPin_();
      r.sh.getRange(rowNum, pinCol).setValue(hashPin_(pin));
      issued.push(name + ': ' + pin);
    }
  });
  // الأرقام بتظهر بسجل التنفيذ بس (View > Executions) — ما بتنكتب بأي ملف ولا بالشيت
  if (issued.length) Logger.log('أرقام سرية جديدة (انسخها وسلّمها لأصحابها ثم أغلق السجل):\n' + issued.join('\n'));
}

/**
 * تصفير الرقم السري لموظف معيّن. شغّلها من المحرر بعد ما تعدّل الاسم تحت.
 * بتطبع الرقم الجديد بسجل التنفيذ — ما بتحطه بأي ملف ولا بترسله لحدا.
 */
function resetPinFor() {
  var employeeName = 'حسن'; // ← بدّل الاسم هون قبل التشغيل
  var r = readRows(SHEET_NAMES.EMPLOYEES);
  var pinCol = r.headers.indexOf('pin') + 1;
  for (var i = 0; i < r.rows.length; i++) {
    if (String(r.rows[i].name || '').trim() === employeeName) {
      var pin = randomPin_();
      r.sh.getRange(i + 2, pinCol).setValue(hashPin_(pin));
      Logger.log('الرقم السري الجديد لـ ' + employeeName + ': ' + pin);
      return 'تم — شوف الرقم بسجل التنفيذ (View > Executions)';
    }
  }
  throw new Error('ما لقينا موظف بهذا الاسم: ' + employeeName);
}

function seedInitialDataIfEmpty() {
  var itemsSheet = sheet(SHEET_NAMES.ITEMS);
  if (itemsSheet.getLastRow() < 2) {
    var items = [
      ['دجاج', 'دجاج تندر', '1/3', false, 1],
      ['دجاج', 'دجاج باربكيو', '1/3', false, 2],
      ['دجاج', 'دجاج بينك صوص', '1/3', false, 3],
      ['دجاج', 'دجاج الشيف', '1/3', true, 4],
      ['بحري', 'لحم الشيف', '1/3', true, 1],
      ['بحري', 'سالمون', '1/3', false, 2],
      ['بحري', 'سمك الشيف (جمبو)', '1/3', false, 3],
      ['بحري', 'جمبري بروفنسال', '1/3', false, 4],
      ['كارب', 'رز أبيض', '1/2', false, 1],
      ['كارب', 'رز الشيف', '1/2', false, 2],
      ['كارب', 'بطاطس ويدجز', '1', false, 3],
      ['كارب', 'مكرونة الشيف', '1/3', false, 4],
      ['كارب', 'كارب الشيف', '1/3', false, 5],
      ['السلطات', 'سلطة تونا', 'طاسة', false, 1],
      ['السلطات', 'سلطة فتوش', 'طاسة', false, 2],
      ['السلطات', 'سلطة سيزر', 'طاسة', false, 3],
      ['الحلويات', 'كوكيز', 'حبة', false, 1],
      ['الحلويات', 'براونيز', 'حبة', false, 2],
      ['الحلويات', 'سينابون', 'حبة', false, 3],
      ['الحلويات', 'حلى الشيف', 'صينية', false, 4],
      ['فطور', 'ساندويتش روستيد', 'ساندويتش', false, 1],
      ['فطور', 'ساندويتش صن رايز', 'ساندويتش', false, 2],
      ['فطور', 'صن رايز بدون ديك رومي', 'ساندويتش', false, 3],
      ['فطور', 'ساندويتش تونا', 'ساندويتش', false, 4],
      ['فطور', 'ساندويتش كساديا', 'ساندويتش', false, 5],
      ['فطور', 'ساندويتش كروك ديلوكس', 'ساندويتش', false, 6],
      ['فطور', 'كرواسون بيض بالتيركي', 'ساندويتش', false, 7],
      ['فطور', 'ساندويتش حلوم', 'ساندويتش', false, 8],
      ['فطور', 'كلوب ساندويتش', 'ساندويتش', false, 9],
      ['معدات', 'سفنديشات الفطور', '-', false, 1]
    ];
    var now = nowIso();
    var rows = items.map(function (it) {
      // id, category, name, unit, hasCustomName, branches('' = كل الفروع), active, sortOrder, updatedAt
      return [Utilities.getUuid(), it[0], it[1], it[2], it[3], '', true, it[4], now];
    });
    itemsSheet.getRange(2, 1, rows.length, 9).setValues(rows);
  }

  var employeesSheet = sheet(SHEET_NAMES.EMPLOYEES);
  if (employeesSheet.getLastRow() < 2) {
    var names = Object.keys(EMPLOYEE_ROSTER);
    var rows2 = names.map(function (name) {
      var ro = EMPLOYEE_ROSTER[name];
      // name, active, id, pin, role, branches
      return [name, true, Utilities.getUuid(), hashPin_(ro.pin), ro.role, ro.branches];
    });
    employeesSheet.getRange(2, 1, rows2.length, 6).setValues(rows2);
  }

  var settingsSheet = sheet(SHEET_NAMES.SETTINGS);
  if (settingsSheet.getLastRow() < 2) {
    var now2 = nowIso();
    var settings = [
      ['restaurantName', 'Pro House', now2],
      ['branchName', '', now2],
      ['logoUrl', '', now2],
      ['shortageThresholdPct', -0.20, now2],
      ['surplusThresholdPct', 0.25, now2],
      ['returnThresholdPct', 0.30, now2],
      ['branches', DEFAULT_BRANCHES, now2],
      ['categoryOrder', DEFAULT_CATEGORY_ORDER, now2]
    ];
    settingsSheet.getRange(2, 1, settings.length, 3).setValues(settings);
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action;
    if (action === 'login') throw new Error('سجّل الدخول عبر POST');

    // نقطة صيانة مؤقتة — بمفتاح لمرة واحدة، قبل فحص الجلسة لأنها بتنشغّل من سطر الأوامر
    if (action === 'maintenanceMoveDay') {
      if (e.parameter.key !== MAINT_KEY) throw new Error('مفتاح صيانة غير صحيح');
      return jsonOut({ ok: true, data: moveDayData_(e.parameter.apply !== '1') });
    }

    var employee = requireSession_(e.parameter.token);
    var data;
    switch (action) {
      case 'me': data = employee; break;
      case 'getItems': data = getItems(e.parameter.all === '1'); break;
      case 'getDay':
        requireBranchAccess_(employee, e.parameter.branch);
        data = getDay(e.parameter.date, e.parameter.branch);
        break;
      case 'getReport':
        if (employee.role === 'employee') throw new Error('غير مصرح');
        data = getReport(e.parameter.start, e.parameter.end, employee.role === 'manager' ? employee.branches : null);
        break;
      case 'getTomorrowOrder':
        requireBranchAccess_(employee, e.parameter.branch);
        data = getTomorrowOrder(e.parameter.date, e.parameter.branch);
        break;
      case 'getEmployees':
        if (employee.role !== 'owner') throw new Error('غير مصرح');
        data = getEmployees();
        break;
      case 'getSettings': data = getSettingsForClient_(employee); break;
      case 'getJuices': data = getJuices(e.parameter.all === '1'); break;
      case 'getJuiceDay':
        requireBranchAccess_(employee, e.parameter.branch);
        data = getJuiceDay(e.parameter.date, e.parameter.branch);
        break;
      case 'getJuiceReport':
        if (employee.role === 'employee') throw new Error('غير مصرح');
        requireBranchAccess_(employee, e.parameter.branch);
        data = getJuiceReport(e.parameter.start, e.parameter.end, e.parameter.branch);
        break;
      case 'getSalesByCategory':
        requireBranchAccess_(employee, e.parameter.branch);
        data = getSalesByCategory(e.parameter.start, e.parameter.end, e.parameter.branch);
        break;
      case 'getRemainingReport':
        requireBranchAccess_(employee, e.parameter.branch);
        data = getRemainingReport(e.parameter.date, e.parameter.branch);
        break;
      case 'backupAll':
        if (employee.role !== 'owner') throw new Error('غير مصرح');
        data = backupAll();
        break;
      default: throw new Error('unknown action: ' + action);
    }
    return jsonOut({ ok: true, data: data });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var body = JSON.parse(e.postData.contents); // {action, payload, token}

    if (body.action === 'login') return jsonOut({ ok: true, data: login(body.payload && body.payload.pin) });
    if (body.action === 'logout') return jsonOut({ ok: true, data: logout(body.token) });

    if (body.action === 'importSalesByCategory') {
      requireIntegrationToken_(body.integrationToken);
      return jsonOut({ ok: true, data: importSalesByCategory(body.payload) });
    }
    if (body.action === 'importJuiceSales') {
      requireIntegrationToken_(body.integrationToken);
      return jsonOut({ ok: true, data: importJuiceSales(body.payload) });
    }
    if (body.action === 'clearAllEntriesData') {
      return jsonOut({ ok: true, data: clearAllEntriesData() });
    }

    var employee = requireSession_(body.token);
    var data;
    switch (body.action) {
      case 'saveItem':
        requireItemWriteAccess_(employee, body.payload);
        data = saveItem(body.payload);
        break;
      case 'deleteItem':
        requireItemDeleteAccess_(employee, body.payload);
        data = deleteItem(body.payload);
        break;
      case 'saveDay':
        if (employee.role === 'chef') throw new Error('غير مصرح — الشيف يشوف بس');
        requireBranchAccess_(employee, body.payload.branch);
        data = saveDay(body.payload);
        break;
      case 'saveRemainingReport':
        if (employee.role === 'chef') throw new Error('غير مصرح — الشيف يشوف بس');
        requireBranchAccess_(employee, body.payload.branch);
        data = saveRemainingReport(body.payload);
        break;
      case 'saveTomorrowOrder':
        if (employee.role === 'chef') throw new Error('غير مصرح — الشيف يشوف بس');
        requireBranchAccess_(employee, body.payload.branch);
        data = saveTomorrowOrder(body.payload);
        break;
      case 'saveJuice':
        requireJuiceWriteAccess_(employee, body.payload);
        data = saveJuice(body.payload);
        break;
      case 'deleteJuice':
        requireJuiceDeleteAccess_(employee, body.payload);
        data = deleteJuice(body.payload);
        break;
      case 'saveJuiceDay':
        if (employee.role === 'chef') throw new Error('غير مصرح — الشيف يشوف بس');
        requireBranchAccess_(employee, body.payload.branch);
        data = saveJuiceDay(body.payload);
        break;
      case 'changePin':
        data = changePin(employee, body.payload);
        break;
      case 'saveSettings':
        if (employee.role !== 'owner') throw new Error('غير مصرح');
        data = saveSettings(body.payload);
        break;
      case 'testWhatsApp':
        if (employee.role !== 'owner') throw new Error('غير مصرح');
        data = sendWhatsAppMessage_(body.payload.phone, body.payload.message || 'اختبار إشعارات الواتساب من Pro House 🚀');
        break;
      case 'createDailySummaryTrigger':
        if (employee.role !== 'owner') throw new Error('غير مصرح');
        data = createDailySummaryTrigger();
        break;
      case 'clearAllEntriesData':
        if (employee.role !== 'owner') throw new Error('غير مصرح');
        data = clearAllEntriesData();
        break;
      case 'restoreAll':
        if (employee.role !== 'owner') throw new Error('غير مصرح');
        data = restoreAll(body.payload);
        break;
      default: throw new Error('unknown action: ' + body.action);
    }
    return jsonOut({ ok: true, data: data });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== المصادقة والصلاحيات ====================

var PIN_SALT = 'prohouse-2026-salt'; // ثابت — تغييره بيبطل كل الأرقام السرية الحالية، ما تغيّره بدون داعي

function hashPin_(pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, PIN_SALT + String(pin));
  return bytes.map(function (b) {
    var v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function login(pin) {
  if (!pin) throw new Error('أدخل الرقم السري');
  var hash = hashPin_(pin);
  var rows = readRows(SHEET_NAMES.EMPLOYEES).rows;
  var row = rows.filter(function (x) { return x.pin === hash && (x.active === true || x.active === 'TRUE'); })[0];
  if (!row) throw new Error('رقم سري غير صحيح');

  cleanupExpiredSessions_();

  var token = Utilities.getUuid() + Utilities.getUuid();
  var now = nowIso();
  var expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  appendRow(SHEET_NAMES.SESSIONS, { token: token, employeeId: row.id, createdAt: now, expiresAt: expiresAt });

  return {
    token: token,
    employee: {
      id: row.id, name: row.name, role: row.role,
      branches: (row.branches || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    }
  };
}

// كل موظف بيغيّر رقمه هو بس (بيثبت هويته بالرقم الحالي) — ما فيه دور بيقدر يغيّر رقم غيره
// من الواجهة. تصفير رقم موظف نسي رقمه بيصير من المحرر بدالة resetPinFor().
function changePin(employee, p) {
  var currentPin = String((p && p.currentPin) || '').trim();
  var newPin = String((p && p.newPin) || '').trim();

  if (!/^\d{4,8}$/.test(newPin)) throw new Error('الرقم الجديد لازم يكون من 4 لـ 8 أرقام');
  if (currentPin === newPin) throw new Error('الرقم الجديد نفس القديم');

  var r = readRows(SHEET_NAMES.EMPLOYEES);
  var idx = -1;
  for (var i = 0; i < r.rows.length; i++) { if (r.rows[i].id === employee.id) { idx = i; break; } }
  if (idx === -1) throw new Error('ما لقينا حسابك');
  if (r.rows[idx].pin !== hashPin_(currentPin)) throw new Error('الرقم الحالي غير صحيح');

  // ما حدا تاني بيستخدم نفس الرقم — وإلا اثنين بيدخلوا بنفس الرقم وأول وحدة بتتطابق بتفوز
  var taken = r.rows.some(function (row, i2) { return i2 !== idx && row.pin === hashPin_(newPin); });
  if (taken) throw new Error('الرقم مستخدم من موظف تاني — اختر رقم غيره');

  r.sh.getRange(idx + 2, r.headers.indexOf('pin') + 1).setValue(hashPin_(newPin));

  // كل الجلسات القديمة بتنلغى — لو حدا كان داخل برقمك القديم بينطرد
  deleteRowsWhere(SHEET_NAMES.SESSIONS, function (row) { return row.employeeId === employee.id; });
  return { ok: true };
}

function logout(token) {
  if (token) deleteRowsWhere(SHEET_NAMES.SESSIONS, function (row) { return row.token === token; });
  return { ok: true };
}

function cleanupExpiredSessions_() {
  var nowMs = Date.now();
  deleteRowsWhere(SHEET_NAMES.SESSIONS, function (row) {
    var t = new Date(row.expiresAt).getTime();
    return isNaN(t) || t < nowMs;
  });
}

function requireSession_(token) {
  if (!token) throw new Error('لازم تسجل دخول');
  var session = readRows(SHEET_NAMES.SESSIONS).rows.filter(function (s) { return s.token === token; })[0];
  if (!session) throw new Error('الجلسة غير صالحة، سجّل دخول من جديد');
  if (new Date(session.expiresAt).getTime() < Date.now()) throw new Error('انتهت الجلسة، سجّل دخول من جديد');
  var emp = readRows(SHEET_NAMES.EMPLOYEES).rows.filter(function (x) { return x.id === session.employeeId; })[0];
  if (!emp || !(emp.active === true || emp.active === 'TRUE')) throw new Error('الحساب غير مفعّل');
  return {
    id: emp.id, name: emp.name, role: emp.role,
    branches: (emp.branches || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
  };
}

// توكن ثابت لسكربتات الأتمتة (مو جلسة موظف) — يتولّد تلقائياً أول مرة setupEverything، وتقدر تشوفه بتبويب Settings
function requireIntegrationToken_(token) {
  var settings = getSettings();
  if (!token || !settings.integrationToken || token !== settings.integrationToken) {
    throw new Error('integration token غير صحيح');
  }
}

function hasBranchAccess_(emp, branch) {
  if (emp.role === 'owner' || emp.role === 'chef') return true;
  return emp.branches.indexOf(branch) !== -1;
}
function requireBranchAccess_(emp, branch) {
  if (!hasBranchAccess_(emp, branch)) throw new Error('غير مصرح لهذا الفرع');
}

// موظف/مدير بيقدروا يضيفوا أو يعدّلوا بس أصناف موسومة بفرعهم (branches = فرع واحد محدد)،
// ما بيقدروا يلمسوا الأصناف المشتركة (branches فاضي = كل الفروع) ولا أصناف فروع تانية.
function requireItemWriteAccess_(emp, payload) {
  if (emp.role === 'owner') return;
  if (emp.role === 'chef') throw new Error('غير مصرح');
  var b = String(payload.branches || '').trim();
  if (!b || emp.branches.indexOf(b) === -1) throw new Error('لازم تحدد فرعك بالصنف — غير مصرح بتعديل أصناف مشتركة أو فروع تانية');
}

function requireItemDeleteAccess_(emp, payload) {
  if (emp.role === 'owner') return;
  if (emp.role === 'chef') throw new Error('غير مصرح');
  var item = readRows(SHEET_NAMES.ITEMS).rows.filter(function (it) { return it.id === payload.id; })[0];
  if (!item) throw new Error('الصنف غير موجود');
  var b = String(item.branches || '').trim();
  if (!b || emp.branches.indexOf(b) === -1) throw new Error('غير مصرح بحذف هذا الصنف');
}

// نفس منطق الأصناف: الموظف/المدير بيتحكم بس بعصيرات موسومة بفرع واحد من فروعه،
// والعصيرات المشتركة (branches فاضي = كل الفروع) للمالك بس.
function requireJuiceWriteAccess_(emp, payload) {
  if (emp.role === 'owner') return;
  if (emp.role === 'chef') throw new Error('غير مصرح');
  var b = String(payload.branches || '').trim();
  if (!b || emp.branches.indexOf(b) === -1) throw new Error('لازم تحدد فرعك بالعصير — غير مصرح بتعديل عصيرات مشتركة أو فروع تانية');
}

function requireJuiceDeleteAccess_(emp, payload) {
  if (emp.role === 'owner') return;
  if (emp.role === 'chef') throw new Error('غير مصرح');
  var j = readRows(SHEET_NAMES.JUICES).rows.filter(function (x) { return x.id === payload.id; })[0];
  if (!j) throw new Error('العصير غير موجود');
  var b = String(j.branches || '').trim();
  if (!b || emp.branches.indexOf(b) === -1) throw new Error('غير مصرح بحذف هذا العصير');
}

// ==================== helpers ====================

// أي تبويب ناقص بينعمل لحاله بعناوينه الصحيحة أول ما ينطلب — قبل هيك كان بيرمي خطأ ولازم
// حدا يفتح الشيت ويشغّل setupEverything يدوياً بعد كل تحديث بيضيف جدول جديد. هيك أي جدول
// جديد مستقبلاً بينشأ تلقائياً بدون ما حدا يلمس الشيت.
function sheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;

  var headers = SHEET_HEADERS[name];
  if (!headers) throw new Error('unknown sheet tab: ' + name);
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  // نص عادي لكل الأعمدة — Sheets بيحوّل قيم متل "1/3" أو "2026-07-25" لتاريخ تلقائياً بدون هيك
  sh.getRange(2, 1, 2000, headers.length).setNumberFormat('@');
  return sh;
}

// Google Sheets أحياناً بيحوّل نص التاريخ ("2026-07-25") لكائن Date حقيقي تلقائياً
// وقت appendRow حتى لو العمود مهيأ Plain Text — هذا بيكسر كل مقارنة نصية (===, >=, <=)
// بين تاريخ قادم من العميل (نص) وتاريخ راجع من الشيت (كائن Date). نطبّعه هون مرة وحدة
// بعد كل قراءة، حتى كل الدوال (getDay/saveDay/getReport/التومورو) تشتغل صح دايماً.
function isDateValue(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}
function normalizeDateValue(v) {
  if (isDateValue(v)) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  }
  return v;
}
// عمود "unit" أحياناً بيحوي قيم متل "1/3" أو "1/2" — Google Sheets بيفسّرها كتاريخ (يوم/شهر)
// ويحوّلها لكائن Date تلقائياً حتى لو العمود Plain Text. نعيد بناء النص الأصلي "يوم/شهر" من التاريخ.
function normalizeUnitValue(v) {
  if (isDateValue(v)) return v.getDate() + '/' + (v.getMonth() + 1);
  return v;
}

function readRows(name) {
  var sh = sheet(name);
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var dateCol = headers.indexOf('date');
  var unitCol = headers.indexOf('unit');
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = values[i][c];
    if (dateCol >= 0) row.date = normalizeDateValue(row.date);
    if (unitCol >= 0) row.unit = normalizeUnitValue(row.unit);
    rows.push(row);
  }
  return { sh: sh, headers: headers, rows: rows };
}

function appendRow(name, obj) {
  var sh = sheet(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  sh.appendRow(row);
}

function deleteRowsWhere(name, predicate) {
  var sh = sheet(name);
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var dateCol = headers.indexOf('date');
  for (var i = values.length - 1; i >= 1; i--) {
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = values[i][c];
    if (dateCol >= 0) row.date = normalizeDateValue(row.date);
    if (predicate(row)) sh.deleteRow(i + 1);
  }
}

function nowIso() { return new Date().toISOString(); }

// ==================== Items ====================

function getItems(all) {
  var r = readRows(SHEET_NAMES.ITEMS);
  var rows = all ? r.rows : r.rows.filter(function (it) { return it.active === true || it.active === 'TRUE'; });

  var settings = getSettings();
  var orderList = (settings.categoryOrder || DEFAULT_CATEGORY_ORDER).split(',').map(function (s) { return s.trim(); });
  function catRank(cat) {
    var i = orderList.indexOf(cat);
    return i === -1 ? orderList.length : i;
  }

  rows.sort(function (a, b) {
    if (a.category !== b.category) return catRank(a.category) - catRank(b.category);
    return Number(a.sortOrder) - Number(b.sortOrder);
  });
  return rows;
}

function saveItem(p) {
  var r = readRows(SHEET_NAMES.ITEMS);
  if (!p.id) p.id = Utilities.getUuid();
  // isNew = لا يوجد صف بهذا الـ id حالياً (يدعم إنشاء id على العميل أثناء العمل أوفلاين)
  var isNew = !r.rows.some(function (row) { return row.id === p.id; });
  p.updatedAt = nowIso();
  if (isNew) {
    appendRow(SHEET_NAMES.ITEMS, {
      id: p.id, category: p.category, name: p.name, unit: p.unit,
      hasCustomName: !!p.hasCustomName, branches: p.branches || '', active: true,
      sortOrder: p.sortOrder || 0, updatedAt: p.updatedAt
    });
  } else {
    var idx = r.headers.indexOf('id');
    for (var i = 0; i < r.rows.length; i++) {
      if (r.rows[i].id === p.id) {
        var rowNum = i + 2;
        r.headers.forEach(function (h, c) {
          if (p.hasOwnProperty(h)) r.sh.getRange(rowNum, c + 1).setValue(p[h]);
        });
        break;
      }
    }
  }
  return { id: p.id };
}

function deleteItem(p) {
  var r = readRows(SHEET_NAMES.ITEMS);
  for (var i = 0; i < r.rows.length; i++) {
    if (r.rows[i].id === p.id) {
      var rowNum = i + 2;
      var activeCol = r.headers.indexOf('active') + 1;
      var updatedCol = r.headers.indexOf('updatedAt') + 1;
      r.sh.getRange(rowNum, activeCol).setValue(false);
      r.sh.getRange(rowNum, updatedCol).setValue(nowIso());
      break;
    }
  }
  return { id: p.id };
}

// ==================== Daily entries / day meta ====================

function getDay(date, branch) {
  var entries = readRows(SHEET_NAMES.DAILY).rows.filter(function (r) { return r.date === date && r.branch === branch; });
  var metaRows = readRows(SHEET_NAMES.DAYMETA).rows.filter(function (r) { return r.date === date && r.branch === branch; });
  return { date: date, branch: branch, meta: metaRows[0] || null, items: entries };
}

function saveDay(p) {
  // full replace لنفس التاريخ + نفس الفرع فقط (كل فرع مستقل، ما بيمسح فروع تانية بنفس اليوم)
  deleteRowsWhere(SHEET_NAMES.DAILY, function (row) { return row.date === p.date && row.branch === p.branch; });
  var savedAt = nowIso();
  (p.items || []).forEach(function (it) {
    appendRow(SHEET_NAMES.DAILY, {
      date: p.date, branch: p.branch, itemId: it.itemId, itemName: it.itemName, unit: it.unit,
      confirmed: !!it.confirmed, received: it.received, returned: it.returned, cookName: it.cookName || '',
      notes: it.notes || '', savedAt: savedAt
    });
  });

  var metaRows = readRows(SHEET_NAMES.DAYMETA);
  var existing = metaRows.rows.filter(function (r) { return r.date === p.date && r.branch === p.branch; })[0];
  var metaObj = {
    date: p.date, branch: p.branch, employeeName: p.employeeName || '',
    salesReportLink: p.salesReportLink || '', paymentsReportLink: p.paymentsReportLink || '',
    savedAt: existing ? existing.savedAt : savedAt, updatedAt: savedAt
  };
  if (existing) {
    var idx2 = metaRows.rows.indexOf(existing);
    var rowNum2 = idx2 + 2;
    metaRows.headers.forEach(function (h, c) { metaRows.sh.getRange(rowNum2, c + 1).setValue(metaObj[h]); });
  } else {
    appendRow(SHEET_NAMES.DAYMETA, metaObj);
  }

  // تنبيه الإرجاع المرتفع — ما بيوقف الحفظ لو فشل الإرسال (الحفظ أهم من الإشعار)
  try { checkAndSendReturnAlert_(p); } catch (e) { Logger.log('return alert failed: ' + e); }

  return { date: p.date, branch: p.branch, savedAt: savedAt };
}

function getReport(start, end, branchFilter) {
  var settings = getSettings();
  var returnThreshold = settings.returnThresholdPct !== undefined && settings.returnThresholdPct !== ''
    ? Number(settings.returnThresholdPct) : 0.30;
  var allEntries = readRows(SHEET_NAMES.DAILY).rows.filter(function (r) { return r.date >= start && r.date <= end; });
  var allMeta = readRows(SHEET_NAMES.DAYMETA).rows.filter(function (r) { return r.date >= start && r.date <= end; });

  var tabsenseSales = readRows(SHEET_NAMES.TABSENSE).rows.filter(function (r) { return r.date >= start && r.date <= end; });
  var juiceSales = readRows(SHEET_NAMES.JUICE_SALES).rows.filter(function (r) { return r.date >= start && r.date <= end; });

  if (branchFilter && branchFilter.length) {
    allEntries = allEntries.filter(function (r) { return branchFilter.indexOf(r.branch) !== -1; });
    allMeta = allMeta.filter(function (r) { return branchFilter.indexOf(r.branch) !== -1; });
    tabsenseSales = tabsenseSales.filter(function (r) { return branchFilter.indexOf(r.branch) !== -1; });
    juiceSales = juiceSales.filter(function (r) { return branchFilter.indexOf(r.branch) !== -1; });
  }

  // نجمع حسب (التاريخ + الفرع) — كل فرع بيوم معين سجل مستقل بروابطه وموظفه الخاص،
  // بينما الإجمالي (totals تحت) بيضم كل الفروع مع بعض بتقرير واحد للشيف.
  var byDateBranch = {};
  allEntries.forEach(function (r) {
    var key = r.date + '||' + r.branch;
    if (!byDateBranch[key]) byDateBranch[key] = [];
    byDateBranch[key].push(r);
  });
  var days = Object.keys(byDateBranch).sort().map(function (key) {
    var parts = key.split('||');
    var date = parts[0], branch = parts[1];
    var meta = allMeta.filter(function (m) { return m.date === date && m.branch === branch; })[0] || null;
    return { date: date, branch: branch, meta: meta, items: byDateBranch[key] };
  });

  var totalsMap = {};
  allEntries.forEach(function (r) {
    if (!totalsMap[r.itemId]) totalsMap[r.itemId] = { itemId: r.itemId, itemName: r.itemName, unit: r.unit, totalReceived: 0, totalReturned: 0, dayCount: 0 };
    var t = totalsMap[r.itemId];
    var rec = Number(r.received);
    var ret = Number(r.returned);
    if (!isNaN(rec) && r.received !== '') { t.totalReceived += rec; t.dayCount += 1; }
    if (!isNaN(ret) && r.returned !== '') { t.totalReturned += ret; }
  });
  var flaggedCount = 0;
  var totals = Object.keys(totalsMap).map(function (id) {
    var t = totalsMap[id];
    t.avgDaily = t.dayCount > 0 ? t.totalReceived / t.dayCount : null;
    t.returnPct = t.totalReceived > 0 ? t.totalReturned / t.totalReceived : null;
    t.flagged = t.returnPct !== null && t.returnPct >= returnThreshold;
    if (t.flagged) flaggedCount++;
    return t;
  });

  return { days: days, totals: totals, flaggedCount: flaggedCount, tabsenseSales: tabsenseSales, juiceSales: juiceSales };
}

// ==================== Tomorrow orders ====================

function getTomorrowOrder(date, branch) {
  return readRows(SHEET_NAMES.TOMORROW).rows.filter(function (r) { return r.date === date && r.branch === branch; });
}

function saveTomorrowOrder(p) {
  deleteRowsWhere(SHEET_NAMES.TOMORROW, function (row) { return row.date === p.date && row.branch === p.branch; });
  var savedAt = nowIso();
  (p.items || []).forEach(function (it) {
    appendRow(SHEET_NAMES.TOMORROW, {
      date: p.date, branch: p.branch, itemId: it.itemId, itemName: it.itemName, unit: it.unit,
      qty: it.qty, notes: it.notes || '', employeeName: p.employeeName || '', savedAt: savedAt
    });
  });

  // p.notify بتنبعت بس لما الموظف يضغط زر "حفظ الطلبية" — مو مع الحفظ التلقائي
  if (p.notify) {
    try { sendTomorrowOrderNotification_(p); } catch (e) { Logger.log('tomorrow notify failed: ' + e); }
  }

  return { date: p.date, branch: p.branch, savedAt: savedAt };
}

// ==================== مبيعات تابسنس (مطابقة مع الاستلام) ====================

// بيستبدل بيانات نفس اليوم+الفرع كل مرة ينسحب فيها (last-write-wins، نفس نمط باقي البيانات اليومية)
function importSalesByCategory(p) {
  deleteRowsWhere(SHEET_NAMES.TABSENSE, function (row) { return row.date === p.date && row.branch === p.branch; });
  var importedAt = nowIso();
  (p.rows || []).forEach(function (r) {
    appendRow(SHEET_NAMES.TABSENSE, { date: p.date, branch: p.branch, category: r.category, qty: r.qty, importedAt: importedAt });
  });
  return { date: p.date, branch: p.branch, count: (p.rows || []).length, importedAt: importedAt };
}

function getSalesByCategory(start, end, branch) {
  return readRows(SHEET_NAMES.TABSENSE).rows.filter(function (r) {
    return r.date >= start && r.date <= end && r.branch === branch;
  });
}

// ==================== جرد العصيرات ====================
//
// المعادلة لكل عصير بكل يوم بكل فرع:
//   المتوقع = الرصيد الافتتاحي + الإضافات − المبيعات
//   الفرق   = العدّ الفعلي − المتوقع        (سالب = نقص/هدر، موجب = زيادة غير مفسّرة)
// الرصيد الافتتاحي بينحسب تلقائياً من "العدّ الفعلي" لليوم السابق لنفس الفرع (سلسلة متصلة)،
// وبيقدر الموظف يعدّله يدوياً لو صار جرد افتتاحي مختلف.

function addDaysIso_(dateStr, delta) {
  var d = new Date(String(dateStr) + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getJuices(all) {
  var rows = readRows(SHEET_NAMES.JUICES).rows;
  if (!all) rows = rows.filter(function (j) { return j.active === true || j.active === 'TRUE'; });
  rows.sort(function (a, b) { return Number(a.sortOrder) - Number(b.sortOrder); });
  return rows;
}

function saveJuice(p) {
  var r = readRows(SHEET_NAMES.JUICES);
  if (!p.id) p.id = Utilities.getUuid();
  var isNew = !r.rows.some(function (row) { return row.id === p.id; });
  p.updatedAt = nowIso();
  if (isNew) {
    appendRow(SHEET_NAMES.JUICES, {
      id: p.id, name: p.name, unit: p.unit || '', tabsenseName: p.tabsenseName || '',
      branches: p.branches || '', active: true, sortOrder: p.sortOrder || 0, updatedAt: p.updatedAt
    });
  } else {
    for (var i = 0; i < r.rows.length; i++) {
      if (r.rows[i].id === p.id) {
        var rowNum = i + 2;
        r.headers.forEach(function (h, c) {
          if (p.hasOwnProperty(h)) r.sh.getRange(rowNum, c + 1).setValue(p[h]);
        });
        break;
      }
    }
  }
  return { id: p.id };
}

function deleteJuice(p) {
  var r = readRows(SHEET_NAMES.JUICES);
  for (var i = 0; i < r.rows.length; i++) {
    if (r.rows[i].id === p.id) {
      r.sh.getRange(i + 2, r.headers.indexOf('active') + 1).setValue(false);
      r.sh.getRange(i + 2, r.headers.indexOf('updatedAt') + 1).setValue(nowIso());
      break;
    }
  }
  return { id: p.id };
}

function getJuiceDay(date, branch) {
  var all = readRows(SHEET_NAMES.JUICE_COUNTS).rows;
  var items = all.filter(function (r) { return r.date === date && r.branch === branch; });

  // إقفال أمس = افتتاحي اليوم (يتعبّى تلقائياً لما الموظف ما دخّل افتتاحي بإيده)
  var prevDate = addDaysIso_(date, -1);
  var prevCounted = {};
  all.filter(function (r) { return r.date === prevDate && r.branch === branch; })
    .forEach(function (r) { prevCounted[r.juiceId] = r.counted; });

  var sales = readRows(SHEET_NAMES.JUICE_SALES).rows
    .filter(function (r) { return r.date === date && r.branch === branch; })
    .map(function (r) { return { productName: r.productName, qty: r.qty }; });

  return { date: date, branch: branch, items: items, prevCounted: prevCounted, sales: sales };
}

function saveJuiceDay(p) {
  deleteRowsWhere(SHEET_NAMES.JUICE_COUNTS, function (row) { return row.date === p.date && row.branch === p.branch; });
  var savedAt = nowIso();
  (p.items || []).forEach(function (it) {
    appendRow(SHEET_NAMES.JUICE_COUNTS, {
      date: p.date, branch: p.branch, juiceId: it.juiceId, juiceName: it.juiceName, unit: it.unit || '',
      opening: it.opening, added: it.added, sold: it.sold, counted: it.counted,
      notes: it.notes || '', employeeName: p.employeeName || '', savedAt: savedAt
    });
  });
  return { date: p.date, branch: p.branch, savedAt: savedAt };
}

// بيستبدل مبيعات نفس اليوم+الفرع كل مرة ينسحب فيها (last-write-wins، نفس نمط باقي البيانات اليومية)
function importJuiceSales(p) {
  deleteRowsWhere(SHEET_NAMES.JUICE_SALES, function (row) { return row.date === p.date && row.branch === p.branch; });
  var importedAt = nowIso();
  (p.rows || []).forEach(function (r) {
    appendRow(SHEET_NAMES.JUICE_SALES, { date: p.date, branch: p.branch, productName: r.productName, qty: r.qty, importedAt: importedAt });
  });
  return { date: p.date, branch: p.branch, count: (p.rows || []).length, importedAt: importedAt };
}

// تجميع فترة: كم انضاف، كم انباع، وكم الفرق التراكمي لكل عصير (لتقرير الهدر)
function getJuiceReport(start, end, branch) {
  var rows = readRows(SHEET_NAMES.JUICE_COUNTS).rows.filter(function (r) {
    return r.date >= start && r.date <= end && (!branch || r.branch === branch);
  });
  var map = {};
  rows.forEach(function (r) {
    var key = r.juiceId;
    if (!map[key]) map[key] = { juiceId: r.juiceId, juiceName: r.juiceName, unit: r.unit, totalAdded: 0, totalSold: 0, totalVariance: 0, days: 0 };
    var t = map[key];
    var opening = Number(r.opening) || 0;
    var added = Number(r.added) || 0;
    var sold = Number(r.sold) || 0;
    t.totalAdded += added;
    t.totalSold += sold;
    if (r.counted !== '' && r.counted !== null && !isNaN(Number(r.counted))) {
      t.totalVariance += Number(r.counted) - (opening + added - sold);
      t.days += 1;
    }
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

// ==================== Employees / Settings ====================

function getEmployees() {
  return readRows(SHEET_NAMES.EMPLOYEES).rows.filter(function (r) { return r.active === true || r.active === 'TRUE'; });
}

function getSettings() {
  var rows = readRows(SHEET_NAMES.SETTINGS).rows;
  var out = {};
  rows.forEach(function (r) { out[r.key] = r.value; });
  return out;
}

// إعدادات ما لازم تطلع لأي حدا غير المالك. كل الأدوار بتحتاج getSettings (الفروع، ترتيب
// التصنيفات، حدود التنبيه) — بس integrationToken بيسمح بالكتابة بدون جلسة موظف، فتسريبه
// لموظف عادي بيلغي كل نظام الصلاحيات.
var SECRET_SETTING_KEYS = ['integrationToken', 'whatsappToken', 'whatsappInstanceId'];

function getSettingsForClient_(employee) {
  var all = getSettings();
  if (employee && employee.role === 'owner') return all;
  var out = {};
  Object.keys(all).forEach(function (k) {
    if (SECRET_SETTING_KEYS.indexOf(k) === -1) out[k] = all[k];
  });
  return out;
}

function saveSettings(p) {
  var r = readRows(SHEET_NAMES.SETTINGS);
  Object.keys(p).forEach(function (key) {
    var existingIdx = -1;
    for (var i = 0; i < r.rows.length; i++) { if (r.rows[i].key === key) { existingIdx = i; break; } }
    if (existingIdx >= 0) {
      var rowNum = existingIdx + 2;
      var valueCol = r.headers.indexOf('value') + 1;
      var updatedCol = r.headers.indexOf('updatedAt') + 1;
      r.sh.getRange(rowNum, valueCol).setValue(p[key]);
      if (updatedCol > 0) r.sh.getRange(rowNum, updatedCol).setValue(nowIso());
    } else {
      appendRow(SHEET_NAMES.SETTINGS, { key: key, value: p[key], updatedAt: nowIso() });
    }
  });
  return getSettings();
}

// ==================== Backup / Restore ====================

function backupAll() {
  return {
    items: readRows(SHEET_NAMES.ITEMS).rows,
    dailyEntries: readRows(SHEET_NAMES.DAILY).rows,
    dayMeta: readRows(SHEET_NAMES.DAYMETA).rows,
    tomorrowOrders: readRows(SHEET_NAMES.TOMORROW).rows,
    employees: readRows(SHEET_NAMES.EMPLOYEES).rows,
    tabsenseSales: readRows(SHEET_NAMES.TABSENSE).rows,
    juices: readRows(SHEET_NAMES.JUICES).rows,
    juiceCounts: readRows(SHEET_NAMES.JUICE_COUNTS).rows,
    juiceSales: readRows(SHEET_NAMES.JUICE_SALES).rows,
    settings: readRows(SHEET_NAMES.SETTINGS).rows,
    exportedAt: nowIso()
  };
}

// ==================== نسخ احتياطي تلقائي مجدول (يومي) على Google Drive ====================

var BACKUP_FOLDER_NAME = 'Pro House Backups';
var BACKUP_RETENTION_DAYS = 30; // نحذف النسخ الأقدم من هيك تلقائياً حتى ما تمتلئ Drive

function getOrCreateBackupFolder_() {
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

// هاي بتشتغل تلقائياً كل يوم (بعد ما تركّب المشغّل مرة وحدة بالأسفل) — بتحفظ نسخة JSON كاملة بتاريخها بمجلد Drive
function backupToDrive() {
  var folder = getOrCreateBackupFolder_();
  var data = backupAll();
  var stamp = nowIso().replace(/[:.]/g, '-');
  var fileName = 'prohouse-backup-' + stamp + '.json';
  folder.createFile(fileName, JSON.stringify(data), MimeType.PLAIN_TEXT);

  // تنظيف النسخ القديمة جداً (أكثر من BACKUP_RETENTION_DAYS يوم) حتى ما تتراكم إلى ما لا نهاية
  var cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  var files = folder.getFilesByType(MimeType.PLAIN_TEXT);
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf('prohouse-backup-') === 0 && f.getDateCreated() < cutoff) f.setTrashed(true);
  }
  return { fileName: fileName, savedAt: nowIso() };
}

/**
 * شغّل هاي الدالة مرة وحدة بس (▶ Run فوق) حتى تفعّل النسخ الاحتياطي اليومي التلقائي.
 * بتركّب مشغّل زمني (Trigger) يشغّل backupToDrive() كل يوم تلقائياً — ما تحتاج تسويها يدوياً بعدها أبداً.
 * آمنة تشتغل أكثر من مرة: ما بتكرر المشغّل لو كان موجود أصلاً.
 */
function createDailyBackupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'backupToDrive') return 'المشغّل موجود أصلاً — ما ضفنا وحدة جديدة.';
  }
  ScriptApp.newTrigger('backupToDrive').timeBased().everyDays(1).atHour(3).create();
  backupToDrive(); // نسخة أولى فورية حتى نتأكد إنها شغالة
  return 'تم تفعيل النسخ الاحتياطي التلقائي اليومي (الساعة 3 فجراً تقريباً) + أخذنا نسخة أولى الآن.';
}

// ==================== نقل بيانات يوم كامل من تاريخ لتاريخ (صيانة يدوية) ====================
//
// تُستخدم لتصحيح يوم انسجّل بتاريخ غلط. بتمسح بيانات التاريخ الهدف أولاً (لأنها الغلط)،
// وبعدين بتحوّل صفوف التاريخ المصدر للتاريخ الهدف — فالمصدر بيفضى.
//
// شغّل moveDayDataDryRun أول عشان تشوف الأرقام بدون أي تعديل،
// وبعدها moveDayDataApply للتنفيذ الفعلي (بياخد نسخة احتياطية على Drive قبل ما يكتب).

var MAINT_KEY = '23f79d7447063a2bf2447cf7c5ddd44371f283eaaff1e406';
var MOVE_FROM    = '2026-08-11';        // الثلاثاء — فيه بيانات الأحد فعلياً
var MOVE_TO      = '2026-08-09';        // الأحد — بياناته الحالية غلط وبتنمسح
var MOVE_DELETE  = '2026-08-10';        // الإثنين — بياناته غلط وبتنمسح بالكامل
var MOVE_BRANCH  = 'عبداللطيف جميل';

function moveDayTables_() {
  return [
    SHEET_NAMES.DAILY,        // الاستلام والإرجاع
    SHEET_NAMES.DAYMETA,      // بيانات اليوم والموظف
    SHEET_NAMES.TOMORROW,     // الطلبيات
    SHEET_NAMES.JUICE_COUNTS, // جرد العصيرات
    SHEET_NAMES.JUICE_SALES,  // مبيعات العصيرات
    SHEET_NAMES.TABSENSE      // مبيعات الكاشير
  ];
}

function moveDayDataDryRun() { return moveDayData_(true); }
function moveDayDataApply()  { return moveDayData_(false); }

function moveDayData_(dryRun) {
  var lines = [];
  lines.push((dryRun ? '— تشغيل تجريبي (بدون أي تعديل) —' : '— تنفيذ فعلي —'));
  lines.push('نقل ' + MOVE_FROM + ' ← ' + MOVE_TO + '  |  حذف ' + MOVE_TO + ' و ' + MOVE_DELETE);
  lines.push('الفرع: ' + MOVE_BRANCH);

  // نسخة احتياطية قبل أي كتابة — بدونها ما في طريق رجوع لو طلع النطاق غلط.
  // بتنحفظ بتبويب داخل نفس الشيت مو على Drive: DriveApp بده صلاحية إضافية مو ممنوحة
  // لهالنشر، والنسخة الداخلية بتكفي لأنها بتحفظ بالضبط الصفوف اللي رح تتغيّر.
  var backupSheet = null;
  if (!dryRun) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var stamp = nowIso().replace(/[:.]/g, '-').slice(0, 19);
    backupSheet = ss.insertSheet('Backup_' + stamp);
    backupSheet.appendRow(['table', 'action', 'rowJson']);
    lines.push('نسخة احتياطية بتبويب: ' + backupSheet.getName());
  }
  lines.push('');

  var totalDeleted = 0, totalMoved = 0;

  moveDayTables_().forEach(function (name) {
    var r = readRows(name);
    var willDelete = 0, willMove = 0;
    r.rows.forEach(function (row) {
      if (String(row.branch) !== MOVE_BRANCH) return;
      if (row.date === MOVE_TO || row.date === MOVE_DELETE) willDelete++;
      else if (row.date === MOVE_FROM) willMove++;
    });

    if (!dryRun && (willDelete || willMove)) {
      // نحفظ نسخة من كل صف رح يتغيّر قبل ما نلمسه
      r.rows.forEach(function (row) {
        if (String(row.branch) !== MOVE_BRANCH) return;
        if (row.date === MOVE_TO || row.date === MOVE_DELETE) {
          backupSheet.appendRow([name, 'deleted', JSON.stringify(row)]);
        } else if (row.date === MOVE_FROM) {
          backupSheet.appendRow([name, 'moved-from-' + MOVE_FROM, JSON.stringify(row)]);
        }
      });

      // نمسح التاريخين الغلط أولاً، وبعدين نعيد القراءة لأن أرقام الصفوف بتزحف بعد الحذف
      if (willDelete) {
        deleteRowsWhere(name, function (row) {
          return String(row.branch) === MOVE_BRANCH &&
                 (row.date === MOVE_TO || row.date === MOVE_DELETE);
        });
      }
      if (willMove) {
        var r2 = readRows(name);
        var dateCol = r2.headers.indexOf('date') + 1;
        for (var i = 0; i < r2.rows.length; i++) {
          if (String(r2.rows[i].branch) === MOVE_BRANCH && r2.rows[i].date === MOVE_FROM) {
            r2.sh.getRange(i + 2, dateCol).setValue(MOVE_TO);
          }
        }
      }
    }

    totalDeleted += willDelete;
    totalMoved += willMove;
    lines.push(name + ': حذف ' + willDelete + ' صف، نقل ' + willMove + ' صف');
  });

  lines.push('');
  lines.push('الإجمالي: حذف ' + totalDeleted + ' — نقل ' + totalMoved);
  if (dryRun) lines.push('ما تغيّر شي. شغّل moveDayDataApply للتنفيذ.');

  var out = lines.join('\n');
  Logger.log(out);
  return out;
}

function restoreAll(p) {
  function replaceSheet(name, rows) {
    var sh = sheet(name);
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, headers.length).clearContent();
    if (!rows || !rows.length) return;
    var values = rows.map(function (obj) { return headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; }); });
    sh.getRange(2, 1, values.length, headers.length).setValues(values);
  }
  replaceSheet(SHEET_NAMES.ITEMS, p.items);
  replaceSheet(SHEET_NAMES.DAILY, p.dailyEntries);
  replaceSheet(SHEET_NAMES.DAYMETA, p.dayMeta);
  replaceSheet(SHEET_NAMES.TOMORROW, p.tomorrowOrders);
  replaceSheet(SHEET_NAMES.EMPLOYEES, p.employees);
  replaceSheet(SHEET_NAMES.TABSENSE, p.tabsenseSales);
  replaceSheet(SHEET_NAMES.JUICES, p.juices);
  replaceSheet(SHEET_NAMES.JUICE_COUNTS, p.juiceCounts);
  replaceSheet(SHEET_NAMES.JUICE_SALES, p.juiceSales);
  replaceSheet(SHEET_NAMES.SETTINGS, p.settings);
  return { restoredAt: nowIso() };
}

// ==================== إشعارات وتنبيهات الواتساب التلقائية ====================

function sendWhatsAppMessage_(phone, text) {
  if (!phone || !text) return false;

  // دعم الأرقام المتعددة المفصولة بفاصلة (مثلاً: رقم صاحب المطعم, رقم الشيف)
  if (String(phone).indexOf(',') !== -1) {
    var phones = String(phone).split(',');
    for (var i = 0; i < phones.length; i++) {
      var singlePhone = phones[i].trim();
      if (singlePhone) sendWhatsAppMessage_(singlePhone, text);
    }
    return true;
  }

  var settings = getSettings();
  var apiUrl = settings.whatsappApiUrl || '';
  var instanceId = settings.whatsappInstanceId || '';
  var token = settings.whatsappToken || '';

  var cleanPhone = String(phone).replace(/[\s\+\-]/g, '');
  if (!cleanPhone) return false;

  try {
    // العلامة الحقيقية لـ Green API هي وجود instanceId، مو شكل الرابط: كل instance بياخد
    // نطاق خاص فيه (مثل https://7107.api.greenapi.com) وبدون شرطة بكلمة greenapi، فالفحص
    // القديم على النص 'green-api' كان بيفشل ويرمي الطلب على مسار خاطئ بدون أي رسالة خطأ.
    if (instanceId) {
      var base = (apiUrl || 'https://api.green-api.com').replace(/\/$/, '');
      var url = base + '/waInstance' + instanceId + '/sendMessage/' + token;
      var payload = { chatId: (cleanPhone.indexOf('@') !== -1 ? cleanPhone : cleanPhone + '@c.us'), message: text };
      UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } else if (apiUrl) {
      var payload2 = { to: cleanPhone, message: text, body: text, token: token };
      UrlFetchApp.fetch(apiUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload2),
        muteHttpExceptions: true
      });
    } else {
      // CallMeBot Free WhatsApp API Fallback
      var callMeBotUrl = 'https://api.callmebot.com/whatsapp.php?phone=' + cleanPhone + '&text=' + encodeURIComponent(text) + (token ? '&apikey=' + token : '');
      UrlFetchApp.fetch(callMeBotUrl, { method: 'get', muteHttpExceptions: true });
    }
    return true;
  } catch (e) {
    Logger.log('Error sending WhatsApp message: ' + e.toString());
    return false;
  }
}

// شاشة الاستلام بتحفظ تلقائياً كل ما الموظف يكتب رقم (كل ~900 مللي ثانية). بدون منع التكرار
// هون، كل ضغطة زر بتبعت رسالة واتساب — مئات الرسائل باليوم وحظر شبه أكيد للرقم.
// نخزّن أي صنف تنبّهنا عنه بهذا اليوم+الفرع، وما نعيد التنبيه عنه مهما انحفظ بعدها.
function alertedKey_(date, branch) { return 'wa:ret:' + date + ':' + branch; }

function alreadyAlerted_(date, branch) {
  var raw = PropertiesService.getScriptProperties().getProperty(alertedKey_(date, branch));
  return raw ? raw.split('|') : [];
}

function markAlerted_(date, branch, itemIds) {
  var props = PropertiesService.getScriptProperties();
  var merged = alreadyAlerted_(date, branch).concat(itemIds);
  var uniq = [];
  merged.forEach(function (id) { if (uniq.indexOf(id) === -1) uniq.push(id); });
  props.setProperty(alertedKey_(date, branch), uniq.join('|'));
}

function checkAndSendReturnAlert_(p) {
  var settings = getSettings();
  var adminPhone = settings.adminPhone || settings.whatsappPhone || '';
  if (!adminPhone) return;
  if (!settings.whatsappInstanceId && !settings.whatsappApiUrl && !settings.whatsappToken) return; // لسا ما انربط مزوّد

  var returnThreshold = settings.returnThresholdPct !== undefined && settings.returnThresholdPct !== ''
    ? Number(settings.returnThresholdPct) : 0.15; // 15% default

  var seen = alreadyAlerted_(p.date, p.branch);
  var flaggedItems = [];
  (p.items || []).forEach(function (it) {
    var rec = Number(it.received) || 0;
    var ret = Number(it.returned) || 0;
    if (rec > 0 && seen.indexOf(String(it.itemId)) === -1) {
      var pct = ret / rec;
      if (pct >= returnThreshold) {
        flaggedItems.push({
          itemId: String(it.itemId),
          name: it.itemName,
          rec: rec,
          ret: ret,
          pct: Math.round(pct * 100)
        });
      }
    }
  });

  if (flaggedItems.length === 0) return;
  // نسجّلها قبل الإرسال — لو فشل الإرسال ما بنعيد المحاولة بالحفظ الجاي (أفضل من إغراق الرقم)
  markAlerted_(p.date, p.branch, flaggedItems.map(function (it) { return it.itemId; }));

  var msg = '🚨 *تنبيه إرجاع مرتفع — Pro House*\n';
  msg += '🏢 الفرع: ' + (p.branch || '') + '\n';
  msg += '👤 الموظف: ' + (p.employeeName || '') + '\n';
  msg += '📅 التاريخ: ' + (p.date || '') + '\n\n';
  msg += '⚠️ الأصناف ذات الإرجاع المرتفع:\n';
  flaggedItems.forEach(function (it) {
    msg += '• ' + it.name + ': استلام ' + it.rec + ' | إرجاع ' + it.ret + ' (نسبة ' + it.pct + '%)\n';
  });

  sendWhatsAppMessage_(adminPhone, msg);
}

// بتنبعت مرة وحدة بس لكل يوم+فرع، ولما الموظف يضغط "حفظ الطلبية" بإيده — مو مع الحفظ
// التلقائي، وإلا الشيف بيوصله إشعار كل ما حدا يعدّل رقم بالطلبية.
function sendTomorrowOrderNotification_(p) {
  var settings = getSettings();
  var targetPhone = settings.chefPhone || settings.adminPhone || settings.whatsappPhone || '';
  if (!targetPhone || !p.items || !p.items.length) return;
  if (!settings.whatsappInstanceId && !settings.whatsappApiUrl && !settings.whatsappToken) return;

  var props = PropertiesService.getScriptProperties();
  var sentKey = 'wa:tom:' + p.date + ':' + p.branch;
  if (props.getProperty(sentKey)) return;
  props.setProperty(sentKey, nowIso());

  var msg = '📦 *طلبية جديدة للغد — Pro House*\n';
  msg += '🏢 الفرع: ' + (p.branch || '') + '\n';
  msg += '👤 الموظف: ' + (p.employeeName || '') + '\n';
  msg += '📅 تاريخ الطلبية: ' + (p.date || '') + '\n\n';
  msg += '📋 الأصناف المطلوبة:\n';
  p.items.forEach(function (it) {
    msg += '• ' + it.itemName + ': ' + it.qty + ' ' + (it.unit || '') + (it.notes ? ' (' + it.notes + ')' : '') + '\n';
  });

  sendWhatsAppMessage_(targetPhone, msg);
}

function sendDailyWhatsAppSummary() {
  var settings = getSettings();
  // بدون رقم افتراضي مكتوب بالكود — رقم ثابت هون معناه إن تقرير المطعم اليومي بينبعت
  // لرقم غريب لو صارت خانة الإعدادات فاضية لأي سبب.
  var adminPhone = settings.adminPhone || settings.whatsappPhone || '';
  if (!adminPhone) return 'لم يحدد رقم واتساب الإدارة بعد.';

  var today = nowIso().slice(0, 10);
  var reportData = getReport(today, today);

  var msg = '📊 *التقرير اليومي لجميع الفروع — Pro House*\n';
  msg += '📅 التاريخ: ' + today + '\n\n';

  if (!reportData.days || !reportData.days.length) {
    msg += 'لا يوجد استلامات مسجلة لهذا اليوم بعد.';
  } else {
    reportData.days.forEach(function (d) {
      var totalRec = 0, totalRet = 0;
      (d.items || []).forEach(function (it) {
        totalRec += (Number(it.received) || 0);
        totalRet += (Number(it.returned) || 0);
      });
      var pct = totalRec > 0 ? Math.round((totalRet / totalRec) * 100) : 0;
      msg += '🏢 *فرع ' + d.branch + '*:\n';
      msg += '  • إجمالي المستلم: ' + totalRec + '\n';
      msg += '  • إجمالي المرتجع: ' + totalRet + ' (' + pct + '%)\n';
      msg += '  • الموظف المسؤول: ' + (d.meta ? d.meta.employeeName : '') + '\n\n';
    });
  }

  sendWhatsAppMessage_(adminPhone, msg);
  return 'تم إرسال الملخص اليومي بنجاح.';
}

function createDailySummaryTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendDailyWhatsAppSummary') return 'مشغّل التقرير اليومي للواتساب تفعّل أصلاً.';
  }
  ScriptApp.newTrigger('sendDailyWhatsAppSummary').timeBased().everyDays(1).atHour(23).create();
  return 'تم تفعيل مشغّل تقرير الواتساب اليومي (الساعة 11:00 مساءً).';
}

function clearAllEntriesData() {
  clearSheetDataRows_(SHEET_NAMES.DAILY);
  clearSheetDataRows_(SHEET_NAMES.DAYMETA);
  clearSheetDataRows_(SHEET_NAMES.TOMORROW);
  clearSheetDataRows_(SHEET_NAMES.JUICE_COUNTS);
  clearSheetDataRows_(SHEET_NAMES.TABSENSE);
  clearSheetDataRows_(SHEET_NAMES.JUICE_SALES);
  return 'تم مسح كافة الإدخالات والبيانات السابقة بنجاح من الشيت.';
}

function clearSheetDataRows_(sheetName) {
  try {
    var s = sheet(sheetName);
    var lastRow = s.getLastRow();
    if (lastRow > 1) {
      s.getRange(2, 1, lastRow - 1, s.getLastColumn()).clearContent();
    }
  } catch (e) {
    Logger.log("clearSheetDataRows error for " + sheetName + ": " + e);
  }
}

function getRemainingReport(date, branch) {
  var entries = readRows(SHEET_NAMES.DAILY).rows.filter(function (r) { return r.date === date && r.branch === branch; });
  var metaRows = readRows(SHEET_NAMES.DAYMETA).rows.filter(function (r) { return r.date === date && r.branch === branch; });
  return { date: date, branch: branch, meta: metaRows[0] || null, items: entries };
}

function saveRemainingReport(p) {
  var savedAt = nowIso();
  (p.items || []).forEach(function (it) {
    appendRow(SHEET_NAMES.DAILY, {
      date: p.date, branch: p.branch, itemId: it.itemId, itemName: it.itemName, unit: it.unit,
      remaining: it.remaining, remainingWeight: it.remainingWeight, remainingSauce: it.remainingSauce,
      notes: it.notes || '', savedAt: savedAt
    });
  });
  return { date: p.date, branch: p.branch, savedAt: savedAt };
}
