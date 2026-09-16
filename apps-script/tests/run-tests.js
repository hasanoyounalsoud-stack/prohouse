// =====================================================================
// run-tests.js — يشغّل سيناريوهات واقعية على Code.gs داخل المحاكي
// الاستخدام:  node run-tests.js [مسار-الملف] [--assert]
//   بدون مسار: apps-script/Code.gs  (النسخة الحالية)
//   --assert: يفشل (exit 1) لو في فحص راسب
// يطبع METRICS كـ JSON + CHECKS + ERRORS حتى نقارن النسخ قبل/بعد.
// =====================================================================
'use strict';
const path = require('path');
const { makeEnvironment } = require('./gas-mock');

const CODE = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'Code.gs');
const ASSERT = process.argv.includes('--assert');

const M = {};
const CHECKS = [];
const ERRORS = [];
function check(name, ok, detail) {
  CHECKS.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}
function metric(k, v) { M[k] = v; }
function safe(label, fn) {
  try { return fn(); } catch (e) { ERRORS.push(label + ': ' + e.message); return null; }
}

const D1 = '2026-09-15';
const BR = 'الروضة';

// ================= البيئة الأساسية =================
const env = makeEnvironment(CODE);
const s = env.sandbox;

safe('setupEverything', () => s.setupEverything());
metric('setup_ops', env.opsTotal());

// headers الفعلية بعد الإعداد
const dailySheet = env.ss.getSheetByName('DailyEntries');
const dailyHeaders = dailySheet.getRange(1, 1, 1, dailySheet.getLastColumn()).getValues()[0];
metric('daily_headers', dailyHeaders.join(','));
check('headers فيها remaining', dailyHeaders.indexOf('remaining') !== -1, dailyHeaders.join(','));
check('headers فيها remainingWeight', dailyHeaders.indexOf('remainingWeight') !== -1);
check('headers فيها remainingSauce', dailyHeaders.indexOf('remainingSauce') !== -1);
metric('items_seeded', env.sheetRows('Items'));

// ضبط أرقام سرية معروفة
function setPin(name, pin) {
  const sh = env.ss.getSheetByName('Employees');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const pinCol = headers.indexOf('pin') + 1;
  const last = sh.getLastRow();
  for (let r = 2; r <= last; r++) {
    if (String(sh.getRange(r, 1, 1, 1).getValues()[0][0]).trim() === name) {
      sh.getRange(r, pinCol).setValue(s.hashPin_(pin));
      return true;
    }
  }
  return false;
}
check('موظف أ.يزيد موجود', setPin('أ.يزيد', '1234'));
check('موظف أبو يونس موجود', setPin('أبو يونس', '9999'));

// ================= تسجيل الدخول =================
env.resetOps();
const loginRes = safe('login', () => env.callPost({ action: 'login', payload: { pin: '1234' } }));
metric('login_ok', loginRes && loginRes.ok);
metric('login_ops', env.opsTotal());
const TOKEN = loginRes && loginRes.ok ? loginRes.data.token : null;
check('login نجح', !!TOKEN);
check('الدور owner', !!loginRes && loginRes.data.employee.role === 'owner');

const items = s.getItems(true);
metric('items_count', items.length);

// ================= حفظ تقرير الاستلام (أول مرة) =================
function buildReceivingPayload(date, branch, overrides) {
  overrides = overrides || {};
  return {
    date, branch, employeeName: 'فهد',
    items: items.map((it, i) => ({
      itemId: it.id, itemName: it.name, unit: it.unit || 'جرام', confirmed: true,
      received: String(1000 + i), returned: String(10 + i), cookName: 'شيف', notes: ''
    }))
  };
}
env.resetOps();
safe('saveDay#1', () => s.saveDay(buildReceivingPayload(D1, BR)));
metric('saveDay_ops', env.opsTotal());
metric('saveDay_rows', env.sheetRows('DailyEntries'));
check('حفظ أول: 30 صف', env.sheetRows('DailyEntries') === 30, env.sheetRows('DailyEntries'));

// إعادة حفظ بعد تعديل رقم
env.resetOps();
const p2 = buildReceivingPayload(D1, BR);
p2.items[0].received = '2000';
safe('saveDay#2', () => s.saveDay(p2));
metric('saveDay_resave_ops', env.opsTotal());
metric('saveDay_resave_rows', env.sheetRows('DailyEntries'));
check('إعادة حفظ: ما تضاعفت الصفوف', env.sheetRows('DailyEntries') === 30, env.sheetRows('DailyEntries'));

// صف واحد فقط لنفس itemId
let dupCount = 0;
{
  const sh = dailySheet;
  const last = sh.getLastRow();
  for (let r = 2; r <= last; r++) {
    const v = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
    if (v[2] === items[0].id) dupCount++;
  }
}
metric('rows_for_item0', dupCount);
check('صف واحد للصنف (بدون تكرار)', dupCount === 1, dupCount);

// قراءة getDay ونتأكد من القيمة المعدّلة
const dayRes = safe('getDay', () => env.callGet({ action: 'getDay', token: TOKEN, date: D1, branch: BR }));
metric('getDay_items', dayRes && dayRes.ok ? dayRes.data.items.length : 'ERR');
check('getDay يرجع القيمة المعدلة', !!dayRes && dayRes.ok && dayRes.data.items.some((x) => x.itemId === items[0].id && String(x.received) === '2000'));

// ================= حفظ تقرير المتبقي =================
env.resetOps();
const remPayload = {
  date: D1, branch: BR, employeeName: 'فهد',
  items: items.map((it) => ({
    itemId: it.id, itemName: it.name, unit: it.unit || 'جرام',
    remaining: '800', remainingWeight: '800', remainingSauce: '100', notes: ''
  }))
};
safe('saveRemainingReport', () => s.saveRemainingReport(remPayload));
metric('remaining_ops', env.opsTotal());
metric('remaining_then_rows', env.sheetRows('DailyEntries'));
check('المتبقي: ما زادت الصفوف (ما في تكرار)', env.sheetRows('DailyEntries') === 30, env.sheetRows('DailyEntries'));

// نحاكي منطق الواجهة: آخر صف لكل itemId هو الفائز
{
  const sh = dailySheet;
  const last = sh.getLastRow();
  const lastByItem = {};
  for (let r = 2; r <= last; r++) {
    const v = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
    const o = {};
    dailyHeaders.forEach((h, ci) => { o[h] = v[ci]; });
    lastByItem[String(o.itemId)] = o;
  }
  const first = lastByItem[String(items[0].id)];
  metric('receiving_preserved_after_remaining', first && String(first.received));
  metric('remaining_stored', first && String(first.remainingWeight));
  check('قيمة الاستلام ما انمسحت بعد حفظ المتبقي', first && String(first.received) === '2000', first && first.received);
  check('قيمة المتبقي انحفظت فعلاً', first && String(first.remainingWeight) === '800', first && first.remainingWeight);
}

// ================= طلبية الغد =================
env.resetOps();
safe('saveTomorrowOrder#1', () => s.saveTomorrowOrder({
  date: '2026-09-16', branch: BR, employeeName: 'فهد', notify: false,
  items: items.map((it) => ({ itemId: it.id, itemName: it.name, unit: it.unit || 'جرام', qty: '50', notes: '' }))
}));
metric('tomorrow_save_ops', env.opsTotal());
metric('tomorrow_rows', env.sheetRows('TomorrowOrders'));
env.resetOps();
safe('saveTomorrowOrder#2', () => s.saveTomorrowOrder({
  date: '2026-09-16', branch: BR, employeeName: 'فهد', notify: false,
  items: items.slice(0, 10).map((it) => ({ itemId: it.id, itemName: it.name, unit: it.unit || 'جرام', qty: '30', notes: '' }))
}));
metric('tomorrow_resave_ops', env.opsTotal());
metric('tomorrow_rows_after_resave', env.sheetRows('TomorrowOrders'));
check('إعادة حفظ الطلبية: استبدال كامل (10)', env.sheetRows('TomorrowOrders') === 10, env.sheetRows('TomorrowOrders'));

// ================= استيراد مبيعات تابسنس =================
let integToken = null;
{
  const sh = env.ss.getSheetByName('Settings');
  const last = sh.getLastRow();
  for (let r = 2; r <= last; r++) {
    const v = sh.getRange(r, 1, 1, 3).getValues()[0];
    if (v[0] === 'integrationToken') integToken = v[1];
  }
}
env.resetOps();
const importRes = safe('importSalesByCategory', () => env.callPost({
  action: 'importSalesByCategory', integrationToken: integToken,
  payload: { date: D1, branch: BR, rows: [{ category: 'دجاج', qty: 40 }, { category: 'لحم', qty: 20 }, { category: 'بحري', qty: 15 }] }
}));
metric('import_ok', importRes && importRes.ok);
metric('import_rows', env.sheetRows('TabsenseSales'));
const importRes2 = safe('importSalesByCategory#2', () => env.callPost({
  action: 'importSalesByCategory', integrationToken: integToken,
  payload: { date: D1, branch: BR, rows: [{ category: 'دجاج', qty: 55 }] }
}));
metric('import_rows_after_reimport', env.sheetRows('TabsenseSales'));
check('إعادة الاستيراد: استبدال (صف واحد)', env.sheetRows('TabsenseSales') === 1, env.sheetRows('TabsenseSales'));

// ================= الداشبورد =================
env.resetOps();
const dash = safe('getDashboard', () => env.callGet({ action: 'getDashboard', token: TOKEN, date: D1 }));
metric('getDashboard_ops', env.opsTotal());
if (dash && dash.ok) {
  const brs = Object.keys(dash.data.branches);
  metric('getDashboard_branches', brs.join('|'));
  metric('getDashboard_today_items', dash.data.branches[BR].today.items.length);
  metric('getDashboard_yesterday_items', dash.data.branches[BR].yesterday.items.length);
  metric('getDashboard_tomorrow_items', dash.data.branches[BR].tomorrow.length);
  metric('getDashboard_has_juceDay', dash.data.branches[BR].juiceDay !== undefined && dash.data.branches[BR].juiceDay !== null);
  check('getDashboard: 3 فروع للمالك', brs.length === 3, brs.join('|'));
  check('getDashboard: بيانات اليوم 30 صنف', dash.data.branches[BR].today.items.length === 30);
  check('getDashboard: طلبية الغد 10', dash.data.branches[BR].tomorrow.length === 10);
} else {
  metric('getDashboard_branches', 'ERR');
  metric('getDashboard_err', dash ? dash.error : 'no response');
}

// محاكاة الطريقة القديمة للداشبورد (17 نداء) — نقيس عمليات نفس البيانات
env.resetOps();
safe('old-dashboard-sim', () => {
  env.callGet({ action: 'me', token: TOKEN });
  env.callGet({ action: 'getSettings', token: TOKEN });
  env.callGet({ action: 'getItems', token: TOKEN, all: '1' });
  env.callGet({ action: 'getJuices', token: TOKEN, all: '1' });
  ['الروضة', 'الشاطئ', 'عبداللطيف جميل'].forEach((b) => {
    env.callGet({ action: 'getDay', token: TOKEN, date: D1, branch: b });
    env.callGet({ action: 'getDay', token: TOKEN, date: '2026-09-14', branch: b });
    env.callGet({ action: 'getTomorrowOrder', token: TOKEN, date: '2026-09-16', branch: b });
    env.callGet({ action: 'getJuiceDay', token: TOKEN, date: D1, branch: b });
  });
  env.callGet({ action: 'getReport', token: TOKEN, start: '2026-09-01', end: '2026-09-30' });
});
metric('dashboard_old_sim_ops', env.opsTotal());

// مدير: يشوف فرعين بس
const mgrLogin = safe('login-manager', () => env.callPost({ action: 'login', payload: { pin: '9999' } }));
if (mgrLogin && mgrLogin.ok) {
  const dashM = safe('getDashboard-manager', () => env.callGet({ action: 'getDashboard', token: mgrLogin.data.token, date: D1 }));
  metric('getDashboard_manager_branches', dashM && dashM.ok ? Object.keys(dashM.data.branches).sort().join('|') : 'ERR');
  check('المدير يشوف فرعين بس', !!dashM && dashM.ok && Object.keys(dashM.data.branches).length === 2);
}

// ================= العناصر المرتفعة الإرجاع =================
// نرفع الإرجاع لصنف واحد لحد التنبيه
const p3 = buildReceivingPayload(D1, BR);
p3.items[0].returned = '500'; // 500/1000 = 50% > 30%
safe('saveDay#3', () => s.saveDay(p3));
const flagged = safe('getFlaggedItems', () => env.callGet({ action: 'getFlaggedItems', token: TOKEN, start: '2026-09-01', end: '2026-09-30' }));
if (flagged && flagged.ok) {
  metric('flagged_count', flagged.data.length);
  check('getFlaggedItems يلقط الصنف (50%)', flagged.data.some((x) => x.itemId === items[0].id));
} else {
  metric('flagged_count', 'ERR');
  metric('flagged_err', flagged ? flagged.error : 'no response');
}

// ================= كاش القراءة =================
env.resetOps();
safe('getItems#1', () => s.getItems(true));
const readOps1 = env.opsTotal();
env.resetOps();
safe('getItems#2', () => s.getItems(true));
const readOps2 = env.opsTotal();
metric('read_first_ops', readOps1);
metric('read_cached_ops', readOps2);
check('القراءة الثانية من الكاش (0 عمليات شيت)', readOps2 === 0, readOps2);

const item0 = items[0];
safe('saveItem', () => s.saveItem({ id: item0.id, category: item0.category, name: item0.name + ' ✏️', unit: item0.unit, hasCustomName: false, branches: '', sortOrder: 1 }));
env.resetOps();
safe('getItems#3', () => s.getItems(true));
metric('read_after_write_ops', env.opsTotal());
check('الكتابة تبطل الكاش (قراءة جديدة)', env.opsTotal() > 0);

// ================= حذف مجمّع =================
env.resetOps();
safe('deleteRowsWhere', () => s.deleteRowsWhere('DailyEntries', (row) => row.branch === BR && row.date === D1));
metric('deleteWhere_ops', env.opsTotal());
metric('daily_after_delete', env.sheetRows('DailyEntries'));
check('الحذف المجمّع صحّ: كل صفوف اليوم انحذفت', env.sheetRows('DailyEntries') === 0, env.sheetRows('DailyEntries'));

// ================= الأمان: clearAllEntriesData بدون جلسة =================
const env2 = makeEnvironment(CODE);
const s2 = env2.sandbox;
safe('setup#2', () => s2.setupEverything());
safe('saveDay#2env', () => s2.saveDay(buildReceivingPayload(D1, BR)));
const rowsBefore = env2.sheetRows('DailyEntries');
const clearNoAuth = safe('clear-noauth', () => env2.callPost({ action: 'clearAllEntriesData' }));
metric('clear_noauth_ok', clearNoAuth && clearNoAuth.ok);
metric('clear_noauth_rows_before', rowsBefore);
metric('clear_noauth_rows_after', env2.sheetRows('DailyEntries'));
check('المسح بدون جلسة مرفوض', !!clearNoAuth && clearNoAuth.ok === false, clearNoAuth && JSON.stringify(clearNoAuth));
check('البيانات ما انمسحت بدون جلسة', env2.sheetRows('DailyEntries') === rowsBefore);

// مع جلسة مالك لازم ينجح
{
  const shE = env2.ss.getSheetByName('Employees');
  const hE = shE.getRange(1, 1, 1, shE.getLastColumn()).getValues()[0];
  const pinColE = hE.indexOf('pin') + 1;
  const lastE = shE.getLastRow();
  for (let r = 2; r <= lastE; r++) {
    if (String(shE.getRange(r, 1, 1, 1).getValues()[0][0]).trim() === 'أ.يزيد') {
      shE.getRange(r, pinColE).setValue(s2.hashPin_('1234'));
    }
  }
  const login2 = safe('login#2env', () => env2.callPost({ action: 'login', payload: { pin: '1234' } }));
  const clearOwner = safe('clear-owner', () => env2.callPost({ action: 'clearAllEntriesData', token: login2 && login2.ok ? login2.data.token : null }));
  metric('clear_owner_ok', clearOwner && clearOwner.ok);
  metric('clear_owner_rows_after', env2.sheetRows('DailyEntries'));
  check('المسح بجلسة مالك ينجح', !!clearOwner && clearOwner.ok === true);
}

// ================= حفظ الهدر =================
env.resetOps();
safe('saveWasteReport', () => s.saveWasteReport({
  date: D1, branch: BR, employeeName: 'فهد',
  items: [{ id: 'w1', itemId: items[0].id, itemName: items[0].name, unit: 'جرام', qty: '5', reason: 'انتهاء صلاحية', notes: '', employeeName: 'فهد', timestamp: '' }]
}));
metric('waste_ops', env.opsTotal());
metric('waste_rows', env.sheetRows('WasteLog'));
check('الهدر انحفظ', env.sheetRows('WasteLog') === 1, env.sheetRows('WasteLog'));

// ================= جرد العصيرات =================
env.resetOps();
safe('saveJuiceDay', () => s.saveJuiceDay({
  date: D1, branch: BR, employeeName: 'فهد',
  items: [{ juiceId: 'j1', juiceName: 'برتقال', unit: 'كوب', opening: '10', added: '5', sold: '3', counted: '12', notes: '' }]
}));
metric('juiceDay_ops', env.opsTotal());
metric('juiceDay_rows', env.sheetRows('JuiceCounts'));
check('جرد العصيرات انحفظ', env.sheetRows('JuiceCounts') === 1, env.sheetRows('JuiceCounts'));

// ================= استيراد مبيعات العصيرات =================
env.resetOps();
const jImport = safe('importJuiceSales', () => env.callPost({
  action: 'importJuiceSales', integrationToken: integToken,
  payload: { date: D1, branch: BR, rows: [{ productName: 'برتقال', qty: 12 }, { productName: 'ليمون', qty: 7 }] }
}));
metric('juiceImport_ok', jImport && jImport.ok);
metric('juiceImport_rows', env.sheetRows('JuiceSales'));
check('استيراد مبيعات العصيرات انحفظ (2)', env.sheetRows('JuiceSales') === 2, env.sheetRows('JuiceSales'));

// ================= حذف مجمّع بصفوف متباعدة (صحة منطق دمج المجاميع) =================
{
  const shT = env.ss.getSheetByName('TomorrowOrders');
  const hdrs = shT.getRange(1, 1, 1, shT.getLastColumn()).getValues()[0];
  s.deleteRowsWhere('TomorrowOrders', () => true); // تنظيف
  const rowsToAdd = [];
  for (let k = 0; k < 20; k++) {
    const o = {};
    o[hdrs[0]] = 'X' + k;
    o['branch'] = BR;
    o['itemId'] = 'it' + k;
    rowsToAdd.push(o);
  }
  if (typeof s.appendRows_ === 'function') s.appendRows_('TomorrowOrders', rowsToAdd);
  else rowsToAdd.forEach((o) => s.appendRow('TomorrowOrders', o));
  const before = env.sheetRows('TomorrowOrders');
  env.resetOps();
  safe('scattered-delete', () => s.deleteRowsWhere('TomorrowOrders', (row) => row.itemId && /^it\d+$/.test(String(row.itemId)) && Number(String(row.itemId).replace('it', '')) % 2 === 0));
  metric('scattered_delete_ops', env.opsTotal());
  metric('scattered_rows_before', before);
  metric('scattered_rows_after', env.sheetRows('TomorrowOrders'));
  const left = [];
  const last = shT.getLastRow();
  for (let r = 2; r <= last; r++) {
    const v = shT.getRange(r, 1, 1, hdrs.length).getValues()[0];
    left.push(String(v[hdrs.indexOf('itemId')]));
  }
  check('الحذف المتباعد: بقت الصفوف الفردية بس (10)', left.length === 10 && left.every(x => /^it\d+$/.test(x) && Number(x.replace('it', '')) % 2 === 1), left.join(','));
}

// ================= الإخراج =================
const fails = CHECKS.filter((c) => !c.ok);
console.log('===CHECKS===');
CHECKS.forEach((c) => console.log((c.ok ? 'PASS' : 'FAIL') + ' | ' + c.name + (c.detail ? ' | ' + c.detail : '')));
if (ERRORS.length) {
  console.log('===ERRORS===');
  ERRORS.forEach((e) => console.log('ERR | ' + e));
}
console.log('===METRICS===');
console.log(JSON.stringify(M, null, 1));
console.log('===SUMMARY===');
console.log('code: ' + CODE);
console.log('passed: ' + (CHECKS.length - fails.length) + '/' + CHECKS.length + ' | errors: ' + ERRORS.length);
if (ASSERT && (fails.length || ERRORS.length)) process.exit(1);
