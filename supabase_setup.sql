-- ===================================================
-- PRO HOUSE OPERATIONS SYSTEM - SUPABASE DATABASE SCHEMA
-- ===================================================

-- 1. جدول الأصناف (Items)
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    has_custom_name BOOLEAN DEFAULT false,
    branches TEXT DEFAULT '',
    active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 2. جدول الموظفين (Employees)
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pin TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    branches TEXT DEFAULT '',
    active BOOLEAN DEFAULT true
);

-- 3. جدول الجلسات (Sessions)
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    expires_at TIMESTAMPTZ NOT NULL
);

-- 4. جدول الإدخالات اليومية (DailyEntries - الاستلام والإرجاع)
CREATE TABLE IF NOT EXISTS daily_entries (
    id BIGSERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    branch TEXT NOT NULL,
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    item_name TEXT,
    unit TEXT,
    confirmed BOOLEAN DEFAULT false,
    received NUMERIC DEFAULT 0,
    returned NUMERIC DEFAULT 0,
    cook_name TEXT,
    notes TEXT,
    saved_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unq_daily_item UNIQUE (date, branch, item_id)
);

-- 5. جدول بيانات اليوم العامة والتقارير (DayMeta)
CREATE TABLE IF NOT EXISTS day_meta (
    date TEXT NOT NULL,
    branch TEXT NOT NULL,
    employee_name TEXT,
    sales_report_link TEXT,
    payments_report_link TEXT,
    saved_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (date, branch)
);

-- 6. جدول طلبيات الغد (TomorrowOrders)
CREATE TABLE IF NOT EXISTS tomorrow_orders (
    id BIGSERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    branch TEXT NOT NULL,
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    item_name TEXT,
    unit TEXT,
    qty NUMERIC DEFAULT 0,
    notes TEXT,
    employee_name TEXT,
    saved_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unq_tomorrow_item UNIQUE (date, branch, item_id)
);

-- 7. جدول مبيعات تابسنس (TabsenseSales)
CREATE TABLE IF NOT EXISTS tabsense_sales (
    id BIGSERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    branch TEXT NOT NULL,
    category TEXT NOT NULL,
    qty NUMERIC DEFAULT 0,
    imported_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unq_tabsense UNIQUE (date, branch, category)
);

-- 8. جدول الهدر (WasteLog)
CREATE TABLE IF NOT EXISTS waste_log (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    branch TEXT NOT NULL,
    item_id TEXT,
    item_name TEXT,
    unit TEXT,
    qty NUMERIC DEFAULT 0,
    reason TEXT,
    notes TEXT,
    employee_name TEXT,
    timestamp TEXT,
    saved_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 9. جدول العصيرات (Juices)
CREATE TABLE IF NOT EXISTS juices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    tabsense_name TEXT,
    branches TEXT DEFAULT '',
    active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 10. جدول جرد العصيرات (JuiceCounts)
CREATE TABLE IF NOT EXISTS juice_counts (
    id BIGSERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    branch TEXT NOT NULL,
    juice_id TEXT REFERENCES juices(id) ON DELETE CASCADE,
    juice_name TEXT,
    unit TEXT,
    opening NUMERIC DEFAULT 0,
    added NUMERIC DEFAULT 0,
    sold NUMERIC DEFAULT 0,
    counted NUMERIC DEFAULT 0,
    notes TEXT,
    employee_name TEXT,
    saved_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unq_juice_day UNIQUE (date, branch, juice_id)
);

-- 11. جدول مبيعات العصيرات (JuiceSales)
CREATE TABLE IF NOT EXISTS juice_sales (
    id BIGSERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    branch TEXT NOT NULL,
    product_name TEXT NOT NULL,
    qty NUMERIC DEFAULT 0,
    imported_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unq_juice_sales UNIQUE (date, branch, product_name)
);

-- 12. جدول الإعدادات (Settings)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- ===================================================
-- الصلاحيات للجميع (Row Level Security Policies)
-- ===================================================
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE tomorrow_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabsense_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE juices ENABLE ROW LEVEL SECURITY;
ALTER TABLE juice_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE juice_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Allow all for items" ON items;
    DROP POLICY IF EXISTS "Allow all for employees" ON employees;
    DROP POLICY IF EXISTS "Allow all for sessions" ON sessions;
    DROP POLICY IF EXISTS "Allow all for daily_entries" ON daily_entries;
    DROP POLICY IF EXISTS "Allow all for day_meta" ON day_meta;
    DROP POLICY IF EXISTS "Allow all for tomorrow_orders" ON tomorrow_orders;
    DROP POLICY IF EXISTS "Allow all for tabsense_sales" ON tabsense_sales;
    DROP POLICY IF EXISTS "Allow all for waste_log" ON waste_log;
    DROP POLICY IF EXISTS "Allow all for juices" ON juices;
    DROP POLICY IF EXISTS "Allow all for juice_counts" ON juice_counts;
    DROP POLICY IF EXISTS "Allow all for juice_sales" ON juice_sales;
    DROP POLICY IF EXISTS "Allow all for settings" ON settings;
END $$;

CREATE POLICY "Allow all for items" ON items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for employees" ON employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for daily_entries" ON daily_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for day_meta" ON day_meta FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for tomorrow_orders" ON tomorrow_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for tabsense_sales" ON tabsense_sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for waste_log" ON waste_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for juices" ON juices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for juice_counts" ON juice_counts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for juice_sales" ON juice_sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for settings" ON settings FOR ALL USING (true) WITH CHECK (true);

-- ===================================================
-- إضافة البيانات والإعدادات الأساسية
-- ===================================================
INSERT INTO settings (key, value) VALUES
('restaurantName', 'Pro House'),
('branches', 'الروضة,الشاطئ,عبداللطيف جميل'),
('categoryOrder', 'دجاج,لحم,بحري,ساندويتشات,كارب,السلطات,الحلويات,فطور,معدات'),
('shortageThresholdPct', '-0.20'),
('surplusThresholdPct', '0.25'),
('returnThresholdPct', '0.30')
ON CONFLICT (key) DO NOTHING;

-- إضافة أصناف المطعم الأساسية
INSERT INTO items (id, category, name, unit, has_custom_name, sort_order) VALUES
('it_chk_1', 'دجاج', 'دجاج تندر', '1/3', false, 1),
('it_chk_2', 'دجاج', 'دجاج باربكيو', '1/3', false, 2),
('it_chk_3', 'دجاج', 'دجاج بينك صوص', '1/3', false, 3),
('it_chk_4', 'دجاج', 'دجاج الشيف', '1/3', true, 4),
('it_sea_1', 'بحري', 'لحم الشيف', '1/3', true, 1),
('it_sea_2', 'بحري', 'سالمون', '1/3', false, 2),
('it_sea_3', 'بحري', 'سمك الشيف (جمبو)', '1/3', false, 3),
('it_sea_4', 'بحري', 'جمبري بروفنسال', '1/3', false, 4),
('it_crb_1', 'كارب', 'رز أبيض', '1/2', false, 1),
('it_crb_2', 'كارب', 'رز الشيف', '1/2', false, 2),
('it_crb_3', 'كارب', 'بطاطس ويدجز', '1', false, 3),
('it_crb_4', 'كارب', 'مكرونة الشيف', '1/3', false, 4),
('it_crb_5', 'كارب', 'كارب الشيف', '1/3', false, 5),
('it_sld_1', 'السلطات', 'سلطة تونا', 'طاسة', false, 1),
('it_sld_2', 'السلطات', 'سلطة فتوش', 'طاسة', false, 2),
('it_sld_3', 'السلطات', 'سلطة سيزر', 'طاسة', false, 3),
('it_sw_1', 'الحلويات', 'كوكيز', 'حبة', false, 1),
('it_sw_2', 'الحلويات', 'براونيز', 'حبة', false, 2),
('it_sw_3', 'الحلويات', 'سينابون', 'حبة', false, 3),
('it_sw_4', 'الحلويات', 'حلى الشيف', 'صينية', false, 4),
('it_bk_1', 'فطور', 'ساندويتش روستيد', 'ساندويتش', false, 1),
('it_bk_2', 'فطور', 'ساندويتش صن رايز', 'ساندويتش', false, 2),
('it_bk_3', 'فطور', 'صن رايز بدون ديك رومي', 'ساندويتش', false, 3),
('it_bk_4', 'فطور', 'ساندويتش تونا', 'ساندويتش', false, 4),
('it_bk_5', 'فطور', 'ساندويتش كساديا', 'ساندويتش', false, 5),
('it_bk_6', 'فطور', 'ساندويتش كروك ديلوكس', 'ساندويتش', false, 6),
('it_bk_7', 'فطور', 'كرواسون بيض بالتيركي', 'ساندويتش', false, 7),
('it_bk_8', 'فطور', 'ساندويتش حلوم', 'ساندويتش', false, 8),
('it_bk_9', 'فطور', 'كلوب ساندويتش', 'ساندويتش', false, 9),
('it_eq_1', 'معدات', 'سفنديشات الفطور', '-', false, 1)
ON CONFLICT (id) DO NOTHING;

-- حسابات الموظفين (مع محمد البلول بدلاً من عبدالهادي) - الرمز المبدئي 1234
INSERT INTO employees (id, name, pin, role, branches, active) VALUES
('emp_1', 'أ.يزيد', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'owner', '', true),
('emp_2', 'حسن', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'owner', '', true),
('emp_3', 'الشيف عصام', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'chef', '', true),
('emp_4', 'أبو يونس', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'manager', 'الروضة,الشاطئ', true),
('emp_5', 'العامودي', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'manager', 'الشاطئ', true),
('emp_6', 'محمد البلول', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'manager', 'عبداللطيف جميل', true),
('emp_7', 'غالب', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'employee', 'عبداللطيف جميل', true)
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name, 
    role = EXCLUDED.role, 
    branches = EXCLUDED.branches;
