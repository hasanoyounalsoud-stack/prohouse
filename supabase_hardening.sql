-- ==========================================================================
-- PRO HOUSE — ملف التقوية والإصلاح لـ Supabase
-- يُنفَّذ مرة واحدة: Supabase → SQL Editor → New query → الصق الكل → Run
--
-- شو بيعمل:
--   1. يضيف أعمدة حفظ "المتبقي" الناقصة (remaining / remaining_weight / remaining_sauce)
--   2. يصلّح الأرقام السرية المزروعة (كانت محسوبة بطريقة ما بتطابق تسجيل الدخول)
--   3. يبني دوال تسجيل دخول آمنة (الشيك يصير داخل الداتابيس، مو من المتصفح)
--   4. يقفل الجداول: بدون جلسة صالحة = ممنوع القراءة/الكتابة/الحذف لأي حد
--   5. يخفي عمود الأرقام السرية حتى عن القراءة المباشرة
--   6. يولّد توكن لسكربت سحب مبيعات تابسنس
-- آمن: ما بيحذف أي بيانات موجودة.
-- ==========================================================================

-- 0) أدوات التشفير (موجودة افتراضياً في Supabase — هاد تأمين إضافي)
create extension if not exists pgcrypto;

-- ==========================================================================
-- 1) أعمدة المتبقي الناقصة (كانت بتضيع القيم بسبب غيابها)
-- ==========================================================================
alter table daily_entries add column if not exists remaining numeric;
alter table daily_entries add column if not exists remaining_weight numeric;
alter table daily_entries add column if not exists remaining_sauce numeric;

-- ==========================================================================
-- 2) إصلاح الأرقام السرية المزروعة
--    (كانت محسوبة sha256("1234") بدون الملح، والكود يحسب sha256(salt+pin)
--     فما كان في تطابق = تسجيل دخول مكسور على أي تثبيت جديد)
-- ==========================================================================
update employees
set pin = encode(digest('prohouse-2026-salt' || '1234', 'sha256'), 'hex')
where pin = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

-- ==========================================================================
-- 3) توكن سكربت الأتمتة (سحب مبيعات تابسنس)
--    إذا ما كان موجود بيتولّد — شوفه بعد التنفيذ بالأمر:
--    select value from settings where key = 'integrationToken';
-- ==========================================================================
insert into settings (key, value, updated_at)
values ('integrationToken', encode(gen_random_bytes(24), 'hex'), timezone('utc'::text, now()))
on conflict (key) do nothing;

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
    set search_path = public, extensions, pg_temp
    as $$
    declare
      v_emp employees;
      v_token text;
      v_hash text;
    begin
      if p_pin is null or btrim(p_pin) = '' then
        raise exception 'أدخل الرقم السري';
      end if;

      v_hash := encode(extensions.digest(('prohouse-2026-salt' || btrim(p_pin))::bytea, 'sha256'), 'hex');

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
set search_path = public, extensions, pg_temp
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
  if v_emp.pin <> encode(extensions.digest(('prohouse-2026-salt' || p_current)::bytea, 'sha256'), 'hex') then
    raise exception 'الرقم الحالي غير صحيح';
  end if;

  v_new_hash := encode(extensions.digest(('prohouse-2026-salt' || p_new)::bytea, 'sha256'), 'hex');
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
