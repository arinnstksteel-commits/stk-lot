-- 014: ราคาทุน (ตอนรับเข้า) และราคาขาย (ตอนขายออก) · ราคาต่อหน่วย ก่อน VAT
-- เก็บแยกตาราง เพื่อให้บัญชีคลังมองไม่เห็นราคาเลย (RLS เฉพาะแอดมิน/ออฟฟิศ)

create table if not exists public.lot_costs (
  lot_no      bigint primary key references public.lots(lot_no) on delete cascade,
  unit_cost   numeric not null check (unit_cost >= 0),
  updated_by  uuid references auth.users(id) default auth.uid(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.move_prices (
  move_id     bigint primary key references public.stock_moves(id) on delete cascade,
  unit_price  numeric not null check (unit_price >= 0),
  updated_by  uuid references auth.users(id) default auth.uid(),
  updated_at  timestamptz not null default now()
);

alter table public.lot_costs enable row level security;
alter table public.move_prices enable row level security;
drop policy if exists office_all on public.lot_costs;
drop policy if exists office_all on public.move_prices;
create policy office_all on public.lot_costs for all to authenticated
  using (public.my_role() in ('admin', 'office')) with check (public.my_role() in ('admin', 'office'));
create policy office_all on public.move_prices for all to authenticated
  using (public.my_role() in ('admin', 'office')) with check (public.my_role() in ('admin', 'office'));
grant select, insert, update, delete on public.lot_costs, public.move_prices to authenticated;

-- ประทับเวลา/คนแก้ทุกครั้งที่แก้ราคา
create or replace function public.price_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists lot_costs_stamp on public.lot_costs;
drop trigger if exists move_prices_stamp on public.move_prices;
create trigger lot_costs_stamp before insert or update on public.lot_costs for each row execute function public.price_stamp();
create trigger move_prices_stamp before insert or update on public.move_prices for each row execute function public.price_stamp();

-- ล้างข้อมูลทดสอบ: รวมตารางราคา
create or replace function public.admin_reset_test_data(p_confirm text) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[];
begin
  perform public._assert_admin();
  if p_confirm is distinct from 'ล้างข้อมูล' then raise exception 'คำยืนยันไม่ถูกต้อง'; end if;
  select coalesce(array_agg(storage_path), '{}') into paths from lot_files;
  truncate cert_links, process_jobs, move_prices, stock_moves, lot_costs, lot_measurements, lot_files, lots,
           receipts, po_lines, purchase_orders, delivery_stops, delivery_trips restart identity;
  delete from products where fa_id is null;
  return paths;
end $$;

-- รายการขายที่ยังไม่ใส่ราคา (ใช้ในงานค้างของออฟฟิศ)
create or replace view public.sales_without_price with (security_invoker = true) as
select m.id, m.lot_no, m.qty, m.doc_no, m.customer, m.note, m.created_at, m.created_by
from public.stock_moves m
where m.kind = 'sale' and not exists (select 1 from public.move_prices p where p.move_id = m.id);
grant select on public.sales_without_price to authenticated;
