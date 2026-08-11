// ==================== سحب تلقائي لتقرير "المبيعات حسب التصنيف" من تابسنس ====================
// سكربت أتمتة غير رسمي لسحب التقرير اليومي وإرساله لـ Pro House.

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");
if (!fs.existsSync(CONFIG_PATH)) {
  console.error("ما في ملف config.json — انسخ config.example.json وعبّي بياناتك فيه.");
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

const LOGIN_URL = "https://app.tabsense.ai/prohouse/dashboard/login";
const CATEGORY_REPORT_URL = "https://app.tabsense.ai/prohouse/dashboard/reports/sales-by-category";
const PRODUCT_REPORT_URL = "https://app.tabsense.ai/prohouse/dashboard/reports/sales-by-product";
const DOWNLOAD_DIR = path.join(__dirname, "downloads");

// تصنيفات تابسنس المتطابقة مع الأصناف عندنا
const CATEGORY_MAP = {
  "أطباق الدجاج": "دجاج",
  "أطباق اللحم": "لحم",
  "أطباق المأكولات البحرية": "بحري",
  "الدجاج": "دجاج",
  "اللحم": "لحم",
  "المأكولات البحرية": "بحري",
  "Chicken": "دجاج",
  "Chicken Dishes": "دجاج",
  "Meat": "لحم",
  "Meat Dishes": "لحم",
  "Seafood": "بحري",
  "Seafood Dishes": "بحري",
  "ساندويتشات": "ساندويتشات",
  "الساندويتشات": "ساندويتشات",
  "ساندوتشات": "ساندويتشات",
  "الساندوتشات": "ساندويتشات",
  "Sandwiches": "ساندويتشات",
  "فطور": "ساندويتشات",
  "الفطور": "ساندويتشات",
  "Breakfast": "ساندويتشات"
};

const UMM_ALI_PRODUCT_NAME = "ام علي";
const UMM_ALI_TARGET_CATEGORY = "ساندويتشات";

// تصنيفات تابسنس اللي منتجاتها بتعتبر عصيرات — بتتبعت لصفحة "جرد العصيرات" بالاسم.
// تقدر تغيّرها من config.json (juiceCategories) بدون ما تلمس الكود.
const DEFAULT_JUICE_CATEGORIES = ["العصائر", "عصائر", "المشروبات", "مشروبات", "Juices", "Juice", "Beverages", "Drinks"];
// احتياط لو تقرير المنتجات ما فيه عمود تصنيف أصلاً — بنعتمد على الاسم
const JUICE_NAME_HINTS = ["عصير", "juice"];

function formatDateObj(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return { display: `${mm}/${dd}/${yyyy}`, iso: `${yyyy}-${mm}-${dd}` };
}

function getTargetDates() {
  const customDate = process.argv[2]; // مثال: node pull-tabsense.js 07/30/2026
  if (customDate && /\d{2}\/\d{2}\/\d{4}/.test(customDate)) {
    const parts = customDate.split("/");
    return [{ display: customDate, iso: `${parts[2]}-${parts[0]}-${parts[1]}` }];
  }

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  return [formatDateObj(yesterday), formatDateObj(today)];
}

function normalizeArabic(s) {
  return String(s || "").replace(/[أإآ]/g, "ا").trim();
}

async function prepareReportPageAndSetDate(page, reportUrl, dateDisplay) {
  await page.goto(reportUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const arLangBtn = page.locator('a:has-text("ع"), button:has-text("ع")').first();
  if (await arLangBtn.isVisible().catch(() => false)) {
    await arLangBtn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  await page.evaluate((d) => {
    const el = $('input[name="datefilter"]');
    if (el.length && el.data('daterangepicker')) {
      const picker = el.data('daterangepicker');
      picker.setStartDate(d);
      picker.setEndDate(d);
      el.val(d + ' - ' + d);
    } else {
      const input = document.querySelector('input[name="datefilter"]');
      if (input) {
        input.value = d + ' - ' + d;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const btn = document.querySelector('#applyChartFilter') || document.querySelector('#applyChartFilterBlur') || document.querySelector('.applyBtn');
    if (btn) btn.click();
  }, dateDisplay);

  await page.waitForTimeout(3500);
}

async function extractCategoryTable(page) {
  return await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead th, thead td')).map(th => th.innerText.trim());
    const catIdx = headers.findIndex(h => h.includes('التصنيف') || h.toLowerCase().includes('category'));
    const qtyIdx = headers.findIndex(h => h === 'الكمية' || h.toLowerCase() === 'qty' || h.toLowerCase() === 'quantity');
    
    const rows = [];
    const trs = Array.from(table.querySelectorAll('tbody tr'));
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      const catText = tds[catIdx] || '';
      if (catText && !catText.includes('لا يوجد بيانات') && !catText.includes('No data available')) {
        const qtyStr = tds[qtyIdx >= 0 ? qtyIdx : 4] ? tds[qtyIdx >= 0 ? qtyIdx : 4].replace(/,/g, '') : '0';
        rows.push({
          category: catText,
          qty: parseFloat(qtyStr) || 0
        });
      }
    }
    return rows;
  });
}

// بنسحب جدول المنتجات مرة وحدة بس ونشتق منه كل شي (أم علي + العصيرات) —
// أرخص من فتح نفس الصفحة مرتين، وبيضمن إن الرقمين من نفس اللقطة الزمنية.
async function extractProductTable(page) {
  // تمديد الجدول لإظهار 100 عنصر لمنع حجب منتجات بالصفحات التالية
  await page.evaluate(() => {
    const sel = document.querySelector('select[name*="length"]');
    if (sel) {
      sel.value = "100";
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead th, thead td')).map(th => th.innerText.trim());
    const nameIdx = headers.findIndex(h => h === 'المنتج' || h.toLowerCase() === 'product' || h.toLowerCase() === 'item');
    const qtyIdx = headers.findIndex(h => h === 'الكمية' || h.toLowerCase() === 'qty' || h.toLowerCase() === 'quantity');
    const catIdx = headers.findIndex(h => h.includes('التصنيف') || h.toLowerCase().includes('category'));

    const targetQtyCol = qtyIdx >= 0 ? qtyIdx : 7;
    const targetNameCol = nameIdx >= 0 ? nameIdx : 0;

    const rows = [];
    const trs = Array.from(table.querySelectorAll('tbody tr'));
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      if (tds[targetNameCol]) {
        const qtyStr = tds[targetQtyCol] ? tds[targetQtyCol].replace(/,/g, '') : '0';
        rows.push({
          name: tds[targetNameCol],
          category: catIdx >= 0 ? (tds[catIdx] || '') : '',
          qty: parseFloat(qtyStr) || 0
        });
      }
    }
    return rows;
  });
}

function findProductQty(products, productName) {
  const target = normalizeArabic(productName);
  const found = products.find(p => normalizeArabic(p.name) === target || normalizeArabic(p.name).includes("ام علي"));
  return found ? found.qty : 0;
}

function pickJuiceRows(products, juiceCategories) {
  const cats = juiceCategories.map(c => normalizeArabic(c).toLowerCase());
  const byCategory = products.filter(p => p.category && cats.includes(normalizeArabic(p.category).toLowerCase()));
  if (byCategory.length) return byCategory.map(p => ({ productName: p.name, qty: p.qty }));

  // ما في عمود تصنيف (أو ما طابق شي) — نرجع للاسم كاحتياط
  return products
    .filter(p => JUICE_NAME_HINTS.some(h => normalizeArabic(p.name).toLowerCase().includes(h)))
    .map(p => ({ productName: p.name, qty: p.qty }));
}

async function run() {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  try {
    const targetDates = getTargetDates();
    console.log(`🔑 جاري تسجيل الدخول بتابسنس...`);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle" });
    await page.fill('input[type="email"], input[name="email"]', config.email);
    await page.fill('input[type="password"], input[name="password"]', config.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {}),
      page.click('button[type="submit"], button:has-text("تسجيل الدخول"), button:has-text("Login")')
    ]);

    for (const targetDate of targetDates) {
      const { display, iso } = targetDate;
      console.log(`\n--------------------------------------------------`);
      console.log(`📅 معالجة تاريخ: ${display} (${iso})...`);

      // ---- 1) تقرير "المبيعات حسب التصنيف" ----
      console.log(`📊 جاري سحب تقرير المبيعات حسب التصنيف ليوم ${display}...`);
      await prepareReportPageAndSetDate(page, CATEGORY_REPORT_URL, display);
      const categoryRows = await extractCategoryTable(page);
      console.log("جدول التصنيفات المستخرج:", categoryRows);

      const mappedRows = [];
      categoryRows.forEach(r => {
        const targetCat = CATEGORY_MAP[r.category];
        if (targetCat) {
          const existing = mappedRows.find(m => m.category === targetCat);
          if (existing) {
            existing.qty += r.qty;
          } else {
            mappedRows.push({ category: targetCat, qty: r.qty });
          }
        }
      });

      // ---- 2) تقرير "المبيعات حسب المنتج" (منه: أم علي + مبيعات العصيرات) ----
      console.log("🍩 جاري سحب تقرير المبيعات حسب المنتج...");
      await prepareReportPageAndSetDate(page, PRODUCT_REPORT_URL, display);
      const products = await extractProductTable(page);
      const ummAliQty = findProductQty(products, UMM_ALI_PRODUCT_NAME);
      console.log(`كمية منتج أم علي المباعة ليوم ${display}: ${ummAliQty}`);
      
      const sandwichesFromUmmAli = ummAliQty / 2;
      if (sandwichesFromUmmAli > 0) {
        console.log(`تم إضافة ${sandwichesFromUmmAli} ساندويتش من مبيعات أم علي (${ummAliQty} حبة).`);
        const existing = mappedRows.find(r => r.category === UMM_ALI_TARGET_CATEGORY);
        if (existing) existing.qty += sandwichesFromUmmAli;
        else mappedRows.push({ category: UMM_ALI_TARGET_CATEGORY, qty: sandwichesFromUmmAli });
      }

      // احتياط: إذا كان جدول التصنيفات فارغاً أو ناقصاً، نستخرج مبيعات التصنيفات من جدول المنتجات التفصيلي مباشرة
      if (products && products.length) {
        console.log(`ℹ️ جاري مطابقة مبيعات ${products.length} منتج مع التصنيفات الرئيسية...`);
        products.forEach(p => {
          const pCat = p.category || "";
          const pName = p.name || "";
          const pCatNorm = normalizeArabic(pCat).toLowerCase();
          const pNameNorm = normalizeArabic(pName).toLowerCase();
          
          let targetCat = CATEGORY_MAP[pCat];
          if (!targetCat) {
            if (pCatNorm.includes("دجاج") || pNameNorm.includes("دجاج") || pNameNorm.includes("chicken")) targetCat = "دجاج";
            else if (pCatNorm.includes("لحم") || pNameNorm.includes("لحم") || pNameNorm.includes("meat")) targetCat = "لحم";
            else if (pCatNorm.includes("بحري") || pCatNorm.includes("سمك") || pNameNorm.includes("بحري") || pNameNorm.includes("سمك") || pNameNorm.includes("fish")) targetCat = "بحري";
            else if (pCatNorm.includes("فطور") || pCatNorm.includes("ساندويتش") || pNameNorm.includes("ساندويتش") || pNameNorm.includes("فطور")) targetCat = "ساندويتشات";
          }
          if (targetCat && p.qty > 0) {
            const hasFromCategoryTable = categoryRows.some(r => CATEGORY_MAP[r.category] === targetCat);
            if (!hasFromCategoryTable) {
              const existing = mappedRows.find(m => m.category === targetCat);
              if (existing) existing.qty += p.qty;
              else mappedRows.push({ category: targetCat, qty: p.qty });
            }
          }
        });
      }

      if (!mappedRows.length) {
        console.warn(`⚠️ تحذير: جدول مبيعات تابسنس المستخرج فارغ أو يحتوي على رسالة عدم وجود بيانات لفرع ${config.branch} في تاريخ ${iso}`);
        throw new Error("لم يتم العثور على مبيعات في تابسنس لهذا اليوم — تأكد من التاريخ وتوفر المبيعات بالجدول");
      }

      // ---- 3) إرسال النتيجة لموقع برو هاوس ----
      console.log(`🚀 جاري إرسال البيانات لموقع Pro House (فرع ${config.branch} - تاريخ ${iso})...`);
      const res = await fetch(config.prohouseApiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "importSalesByCategory",
          integrationToken: config.integrationToken,
          payload: { date: iso, branch: config.branch, rows: mappedRows }
        })
      });
      const json = await res.json();
      if (!json.ok) throw new Error("رفض السيرفر البيانات: " + json.error);

      // ---- 4) مبيعات العصيرات (لصفحة جرد العصيرات) ----
      const juiceRows = pickJuiceRows(products, config.juiceCategories || DEFAULT_JUICE_CATEGORIES);
      if (juiceRows.length) {
        console.log(`🥤 جاري إرسال مبيعات ${juiceRows.length} عصير...`);
        const juiceRes = await fetch(config.prohouseApiUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            action: "importJuiceSales",
            integrationToken: config.integrationToken,
            payload: { date: iso, branch: config.branch, rows: juiceRows }
          })
        });
        const juiceJson = await juiceRes.json();
        if (!juiceJson.ok) console.warn("⚠ فشل إرسال مبيعات العصيرات:", juiceJson.error);
        else console.log("🥤 تم إرسال مبيعات العصيرات:", juiceRows);
      } else {
        console.log("🥤 ما لقينا منتجات عصيرات بتقرير المنتجات — تأكد من juiceCategories بـ config.json");
      }

      console.log(`🎉 تم سحب وإرسال بيانات ${iso} لفرع ${config.branch} بنجاح!`, mappedRows);

      // ---- 5) إشعارات الواتساب السحابية من GitHub Actions ----
      if ((config.whatsappPhone || config.adminPhone) && (config.whatsappApiKey || config.whatsappToken)) {
        const targetPhone = config.whatsappPhone || config.adminPhone;
        const key = config.whatsappApiKey || config.whatsappToken;
        const waText = encodeURIComponent(`📊 *تحديث سحابي أوتوماتيكي — Pro House*\n🏢 الفرع: ${config.branch}\n📅 التاريخ: ${iso}\n\n🎉 تم سحب وإرسال أحدث بيانات تابسنس بنجاح لفرع ${config.branch}.`);
        try {
          await fetch(`https://api.callmebot.com/whatsapp.php?phone=${targetPhone}&text=${waText}&apikey=${key}`);
          console.log("📲 تم إرسال إشعار الواتساب السحابي بنجاح!");
        } catch (waErr) {
          console.warn("⚠ تعذر إرسال إشعار الواتساب السحابي:", waErr.message);
        }
      }
    }

  } catch (err) {
    console.error("❌ فشل السحب:", err.message);
    await page.screenshot({ path: path.join(DOWNLOAD_DIR, "error-screenshot.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
