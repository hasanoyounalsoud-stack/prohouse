-- ===================================================
-- PRO HOUSE OPERATIONS SYSTEM - SUPABASE DATABASE SCHEMA (مقوّى)
-- نسخة مشدّدة: تتضمن دوال المصادقة الآمنة وقفل الصلاحيات وأعمدة المتبقي.
-- للقواعد الشغالة أصلاً استعمل ملف supabase_hardening.sql بدل هاد.
-- ===================================================

-- 0) أدوات التشفير (لا تلمسها)
create extension if not exists pgcrypto;

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
    remaining NUMERIC,
    remaining_weight NUMERIC,
    remaining_sauce NUMERIC,
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

-- ==========================================================================
-- الصلاحيات: مقفلة — بدون جلسة صالحة ما في قراءة ولا كتابة (تفاصيل تحت)
-- ==========================================================================

-- 4) دوال المصادقة — المصادقة والتحقق صاروا داخل الداتابيس
-- ==========================================================================

-- 4.1 التحقق من الجلسة (تُستعمل داخل سياسات الحماية نفسها)
create or replace function public.is_valid_session()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from sessions s
    join employees e on e.id = s.employee_id
    where s.token = coalesce((current_setting('request.headers', true))::json ->> 'x-session-token', '')
      and s.expires_at > timezone('utc'::text, now())
      and e.active = true
  );
$$;
grant execute on function public.is_valid_session() to anon;

-- 4.1.1 جلسة مالك؟ (مفاتيح الواتساب والتكامل للمالك بس — نفس النظام القديم)
create or replace function public.is_owner_session()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from sessions s
    join employees e on e.id = s.employee_id
    where s.token = coalesce((current_setting('request.headers', true))::json ->> 'x-session-token', '')
      and s.expires_at > timezone('utc'::text, now())
      and e.active = true
      and e.role = 'owner'
  );
$$;
grant execute on function public.is_owner_session() to anon;

-- 4.2 تسجيل الدخول: يتحقق من الرقم داخل الداتابيس وينشئ جلسة جديدة
create or replace function public.login(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp employees;
  v_token text;
  v_hash text;
begin
  if p_pin is null or btrim(p_pin) = '' then
    raise exception 'أدخل الرقم السري';
  end if;

  v_hash := encode(digest('prohouse-2026-salt' || btrim(p_pin), 'sha256'), 'hex');

  select * into v_emp
  from employees e
  where e.pin = v_hash and e.active = true
  limit 1;
  if not found then
    raise exception 'رقم سري غير صحيح';
  end if;

  -- تنظيف الجلسات المنتهية
  delete from sessions where expires_at < timezone('utc'::text, now());

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into sessions (token, employee_id, created_at, expires_at)
  values (v_token, v_emp.id, timezone('utc'::text, now()), timezone('utc'::text, now()) + interval '30 days');

  return jsonb_build_object(
    'token', v_token,
    'employee', jsonb_build_object(
      'id', v_emp.id,
      'name', v_emp.name,
      'role', v_emp.role,
      'branches', coalesce(v_emp.branches, '')
    )
  );
end;
$$;
grant execute on function public.login(text) to anon;

-- 4.3 التحقق من جلسة محفوظة (يرجع بيانات الموظف أو null)
create or replace function public.verify_session(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'role', e.role,
    'branches', coalesce(e.branches, '')
  )
  from sessions s
  join employees e on e.id = s.employee_id
  where s.token = coalesce(p_token, '')
    and s.expires_at > timezone('utc'::text, now())
    and e.active = true
  limit 1;
$$;
grant execute on function public.verify_session(text) to anon;

-- 4.4 تغيير الرقم السري (يتحقق من الجلسة والرقم الحالي داخل الداتابيس)
create or replace function public.change_pin(p_current text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_emp employees;
  v_new_hash text;
begin
  v_token := coalesce((current_setting('request.headers', true))::json ->> 'x-session-token', '');
  select e.* into v_emp
  from sessions s
  join employees e on e.id = s.employee_id
  where s.token = v_token and s.expires_at > timezone('utc'::text, now())
  limit 1;
  if not found then
    raise exception 'الجلسة غير صالحة — سجّل دخول من جديد';
  end if;

  p_current := btrim(coalesce(p_current, ''));
  p_new := btrim(coalesce(p_new, ''));

  if p_new !~ '^[0-9]{4,8}$' then
    raise exception 'الرقم الجديد لازم يكون من 4 لـ 8 أرقام';
  end if;
  if p_current = p_new then
    raise exception 'الرقم الجديد نفس القديم';
  end if;
  if v_emp.pin <> encode(digest('prohouse-2026-salt' || p_current, 'sha256'), 'hex') then
    raise exception 'الرقم الحالي غير صحيح';
  end if;

  v_new_hash := encode(digest('prohouse-2026-salt' || p_new, 'sha256'), 'hex');
  if exists (select 1 from employees e2 where e2.pin = v_new_hash and e2.id <> v_emp.id) then
    raise exception 'الرقم مستخدم من موظف آخر — اختر رقم غيره';
  end if;

  update employees set pin = v_new_hash where id = v_emp.id;
  -- كل الجلسات القديمة لصاحب الرقم بتنلغى
  delete from sessions where employee_id = v_emp.id;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.change_pin(text, text) to anon;

-- ==========================================================================
-- 5) دوال استيراد مبيعات تابسنس (تستعملها سكربت السحب الليلي)
-- ==========================================================================

-- 5.1 مبيعات التصنيفات
create or replace function public.import_sales(p_token text, p_date text, p_branch text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stored text;
begin
  select value into v_stored from settings where key = 'integrationToken';
  if v_stored is null or v_stored = '' or coalesce(p_token, '') <> v_stored then
    raise exception 'integration token غير صحيح';
  end if;

  delete from tabsense_sales where date = p_date and branch = p_branch;
  insert into tabsense_sales (date, branch, category, qty)
  select p_date, p_branch, r ->> 'category', coalesce((r ->> 'qty')::numeric, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  return jsonb_build_object('count', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)));
end;
$$;
grant execute on function public.import_sales(text, text, text, jsonb) to anon;

-- 5.2 مبيعات العصيرات
create or replace function public.import_juice_sales(p_token text, p_date text, p_branch text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stored text;
begin
  select value into v_stored from settings where key = 'integrationToken';
  if v_stored is null or v_stored = '' or coalesce(p_token, '') <> v_stored then
    raise exception 'integration token غير صحيح';
  end if;

  delete from juice_sales where date = p_date and branch = p_branch;
  insert into juice_sales (date, branch, product_name, qty)
  select p_date, p_branch, r ->> 'productName', coalesce((r ->> 'qty')::numeric, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  return jsonb_build_object('count', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)));
end;
$$;
grant execute on function public.import_juice_sales(text, text, text, jsonb) to anon;

-- ==========================================================================
-- 6) قفل الصلاحيات: بدون جلسة صالحة = لا قراءة ولا كتابة ولا حذف
--    (قبل هيك: أي حد عنده المفتاح المنشور كان يقدر يقرأ ويعدل ويمسح كل شي)
-- ==========================================================================

-- 6.1 شيل "السماح للجميع" القديمة
drop policy if exists "Allow all for items" on items;
drop policy if exists "Allow all for employees" on employees;
drop policy if exists "Allow all for sessions" on sessions;
drop policy if exists "Allow all for daily_entries" on daily_entries;
drop policy if exists "Allow all for day_meta" on day_meta;
drop policy if exists "Allow all for tomorrow_orders" on tomorrow_orders;
drop policy if exists "Allow all for tabsense_sales" on tabsense_sales;
drop policy if exists "Allow all for waste_log" on waste_log;
drop policy if exists "Allow all for juices" on juices;
drop policy if exists "Allow all for juice_counts" on juice_counts;
drop policy if exists "Allow all for juice_sales" on juice_sales;
drop policy if exists "Allow all for settings" on settings;

-- 6.2 إعادة ضبط الصلاحيات الأساسية
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant usage on schema public to anon;
grant usage on all sequences in schema public to anon;

-- قراءة/كتابة الجداول التشغيلية (القرار الفعلي بصير بسياسات RLS تحت)
grant select, insert, update, delete on items, daily_entries, day_meta, tomorrow_orders,
  tabsense_sales, waste_log, juices, juice_counts, juice_sales, settings to anon;

-- الموظفين: قراءة أعمدة محددة فقط — عمود الرقم السري (pin) بيضل مخفي نهائياً
grant select (id, name, role, branches, active) on employees to anon;

-- جدول الجلسات: ممنوع الوصول المباشر كلياً (بس عبر الدوال)
-- (ما في grant — يعني مرفوض)

-- 6.3 سياسات RLS: كل سطر بيشترط جلسة صالحة
--     items
create policy "ph_items_select" on items for select to anon using (public.is_valid_session());
create policy "ph_items_insert" on items for insert to anon with check (public.is_valid_session());
create policy "ph_items_update" on items for update to anon using (public.is_valid_session()) with check (public.is_valid_session());
create policy "ph_items_delete" on items for delete to anon using (public.is_valid_session());

--     daily_entries
create policy "ph_daily_select" on daily_entries for select to anon using (public.is_valid_session());
create policy "ph_daily_insert" on daily_entries for insert to anon with check (public.is_valid_session());
create policy "ph_daily_update" on daily_entries for update to anon using (public.is_valid_session()) with check (public.is_valid_session());
create policy "ph_daily_delete" on daily_entries for delete to anon using (public.is_valid_session());

--     day_meta
create policy "ph_meta_select" on day_meta for select to anon using (public.is_valid_session());
create policy "ph_meta_insert" on day_meta for insert to anon with check (public.is_valid_session());
create policy "ph_meta_update" on day_meta for update to anon using (public.is_valid_session()) with check (public.is_valid_session());
create policy "ph_meta_delete" on day_meta for delete to anon using (public.is_valid_session());

--     tomorrow_orders
create policy "ph_tomorrow_select" on tomorrow_orders for select to anon using (public.is_valid_session());
create policy "ph_tomorrow_insert" on tomorrow_orders for insert to anon with check (public.is_valid_session());
create policy "ph_tomorrow_update" on tomorrow_orders for update to anon using (public.is_valid_session()) with check (public.is_valid_session());
create policy "ph_tomorrow_delete" on tomorrow_orders for delete to anon using (public.is_valid_session());

--     tabsense_sales
create policy "ph_tabsense_select" on tabsense_sales for select to anon using (public.is_valid_session());
create policy "ph_tabsense_insert" on tabsense_sales for insert to anon with check (public.is_valid_session());
create policy "ph_tabsense_update" on tabsense_sales for update to anon using (public.is_valid_session()) with check (public.is_valid_session());
create policy "ph_tabsense_delete" on tabsense_sales for delete to anon using (public.is_valid_session());

--     waste_log
create policy "ph_waste_select" on waste_log for select to anon using (public.is_valid_session());
create policy "ph_waste_insert" on waste_log for insert to anon with check (public.is_valid_session());
create policy "ph_waste_update" on waste_log for update to anon using (public.is_valid_session()) with check (public.is_valid_session());
create policy "ph_waste_delete" on waste_log for delete to anon using (public.is_valid_session());

--     juices
create policy "ph_juices_select" on juices for select to anon using (public.is_valid_session());
create policy "ph_juices_insert" on juices for insert to anon with check (public.is_valid_session());
create policy "ph_juices_update" on juices for update to anon using (public.is_valid_session()) with check (public.is_valid_session());
create policy "ph_juices_delete" on juices for delete to anon using (public.is_valid_session());

--     juice_counts
create policy "ph_jcounts_select" on juice_counts for select to anon using (public.is_valid_session());
create policy "ph_jcounts_insert" on juice_counts for insert to anon with check (public.is_valid_session());
create policy "ph_jcounts_update" on juice_counts for update to anon using (public.is_valid_session()) with check (public.is_valid_session());
create policy "ph_jcounts_delete" on juice_counts for delete to anon using (public.is_valid_session());

--     juice_sales
create policy "ph_jsales_select" on juice_sales for select to anon using (public.is_valid_session());
create policy "ph_jsales_insert" on juice_sales for insert to anon with check (public.is_valid_session());
create policy "ph_jsales_update" on juice_sales for update to anon using (public.is_valid_session()) with check (public.is_valid_session());
create policy "ph_jsales_delete" on juice_sales for delete to anon using (public.is_valid_session());

--     settings
create policy "ph_settings_select" on settings for select to anon using (public.is_valid_session() and (key not in ('integrationToken', 'whatsappToken', 'whatsappInstanceId') or public.is_owner_session()));
create policy "ph_settings_insert" on settings for insert to anon with check (public.is_valid_session() and (key not in ('integrationToken', 'whatsappToken', 'whatsappInstanceId') or public.is_owner_session()));
create policy "ph_settings_update" on settings for update to anon using (public.is_valid_session() and (key not in ('integrationToken', 'whatsappToken', 'whatsappInstanceId') or public.is_owner_session())) with check (public.is_valid_session() and (key not in ('integrationToken', 'whatsappToken', 'whatsappInstanceId') or public.is_owner_session()));
create policy "ph_settings_delete" on settings for delete to anon using (public.is_valid_session());

--     employees: قراءة فقط (وقد صار عمود الرقم السري غير قابل للقراءة أصلاً فوق)
create policy "ph_employees_select" on employees for select to anon using (public.is_valid_session());

-- ==========================================================================
-- خلص ✅  هلق ما في أي وصول بدون تسجيل دخول — ولا حتى قراءة.
-- اختبار سريع للتأكد (لصق بقسم الاستعلام، المتوقع [] = مقفول صح):
--   select * from settings;   -- بدون جلسة عبر الـ API بترجع فاضية
-- ==========================================================================


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
('it_meat_1', 'لحم', 'لحم الشيف 1', '1/3', true, 1),
('it_meat_2', 'لحم', 'لحم الشيف 2', '1/3', true, 2),
('it_meat_3', 'لحم', 'لحم الشيف 3', '1/3', true, 3),
('it_sea_1', 'بحري', 'سالمون', '1/3', false, 1),
('it_sea_2', 'بحري', 'سمك الشيف (جمبو)', '1/3', false, 2),
('it_sea_3', 'بحري', 'جمبري بروفنسال', '1/3', false, 3),
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
('emp_1', 'أ.يزيد', '6dd04001d95a40181d4d08a9b7ebbcafd83adf03c73bacc2c16e6cf1d4363472', 'owner', '', true),
('emp_2', 'حسن', '6dd04001d95a40181d4d08a9b7ebbcafd83adf03c73bacc2c16e6cf1d4363472', 'owner', '', true),
('emp_3', 'الشيف عصام', '6dd04001d95a40181d4d08a9b7ebbcafd83adf03c73bacc2c16e6cf1d4363472', 'chef', '', true),
('emp_4', 'أبو يونس', '6dd04001d95a40181d4d08a9b7ebbcafd83adf03c73bacc2c16e6cf1d4363472', 'manager', 'الروضة,الشاطئ', true),
('emp_5', 'العامودي', '6dd04001d95a40181d4d08a9b7ebbcafd83adf03c73bacc2c16e6cf1d4363472', 'manager', 'الشاطئ', true),
('emp_6', 'محمد البلول', '6dd04001d95a40181d4d08a9b7ebbcafd83adf03c73bacc2c16e6cf1d4363472', 'manager', 'عبداللطيف جميل', true),
('emp_7', 'غالب', '6dd04001d95a40181d4d08a9b7ebbcafd83adf03c73bacc2c16e6cf1d4363472', 'employee', 'عبداللطيف جميل', true)
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name, 
    role = EXCLUDED.role, 
    branches = EXCLUDED.branches;
-- ==========================================================================
-- توكن سكربت الأتمتة (سحب مبيعات تابسنس) — شوفه بالأمر:
--   select value from settings where key = 'integrationToken';
-- ==========================================================================
insert into settings (key, value, updated_at)
values ('integrationToken', encode(gen_random_bytes(24), 'hex'), timezone('utc'::text, now()))
on conflict (key) do nothing;
