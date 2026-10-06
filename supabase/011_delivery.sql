-- 011: แผนส่งของรายวัน (กรอกเอง)
-- รถคันที่ 1, 2, 3 … ต่อวัน · แต่ละคันมีเจ้าที่ 1, 2, 3 …
create table if not exists public.delivery_trips (
  id            bigint generated always as identity primary key,
  run_date      date not null default current_date,
  seq           int not null default 1,               -- รถคันที่
  plate         text,                                 -- ทะเบียน
  vehicle_type  text,                                 -- ประเภทรถ
  note          text,
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists delivery_trips_date_idx on public.delivery_trips(run_date);

create table if not exists public.delivery_stops (
  id          bigint generated always as identity primary key,
  trip_id     bigint not null references public.delivery_trips(id) on delete cascade,
  seq         int not null default 1,                 -- เจ้าที่
  customer    text not null,
  phone       text,
  location    text,                                   -- ที่อยู่ / ลิงก์ Google Maps / พิกัด
  items       jsonb not null default '[]',            -- [{"name": "...", "qty": 5, "unit": "แผ่น"}]
  note        text,
  loaded_at   timestamptz,                            -- คลังติ๊ก "ขึ้นรถแล้ว"
  loaded_by   uuid references auth.users(id)
);
create index if not exists delivery_stops_trip_idx on public.delivery_stops(trip_id);

alter table public.delivery_trips enable row level security;
alter table public.delivery_stops enable row level security;

drop policy if exists staff_read on public.delivery_trips;
drop policy if exists staff_read on public.delivery_stops;
drop policy if exists office_write on public.delivery_trips;
drop policy if exists office_write on public.delivery_stops;
create policy staff_read on public.delivery_trips for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.delivery_stops for select to authenticated using (public.my_role() is not null);
create policy office_write on public.delivery_trips for all to authenticated
  using (public.my_role() in ('admin', 'office')) with check (public.my_role() in ('admin', 'office'));
create policy office_write on public.delivery_stops for all to authenticated
  using (public.my_role() in ('admin', 'office')) with check (public.my_role() in ('admin', 'office'));
grant select, insert, update, delete on public.delivery_trips, public.delivery_stops to authenticated;

-- ทุกบทบาทติ๊ก / ยกเลิก "ขึ้นรถแล้ว" ได้
create or replace function public.toggle_stop_loaded(p_id bigint) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  if public.my_role() is null then raise exception 'ไม่มีสิทธิ์'; end if;
  update delivery_stops
     set loaded_at = case when loaded_at is null then now() end,
         loaded_by = case when loaded_at is null then auth.uid() end
   where id = p_id returning loaded_at into t;
  return t;
end $$;
revoke all on function public.toggle_stop_loaded(bigint) from public, anon;
grant execute on function public.toggle_stop_loaded(bigint) to authenticated;

-- ล้างข้อมูลทดสอบ: รวมแผนส่งของด้วย
create or replace function public.admin_reset_test_data(p_confirm text) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[];
begin
  perform public._assert_admin();
  if p_confirm is distinct from 'ล้างข้อมูล' then raise exception 'คำยืนยันไม่ถูกต้อง'; end if;
  select coalesce(array_agg(storage_path), '{}') into paths from lot_files;
  truncate cert_links, process_jobs, stock_moves, lot_measurements, lot_files, lots, receipts, po_lines, purchase_orders,
           delivery_stops, delivery_trips restart identity;
  delete from products where fa_id is null;
  return paths;
end $$;
