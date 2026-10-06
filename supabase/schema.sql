-- =========================================================
-- STK Lot & Mill Cert — ฐานข้อมูล (Supabase / PostgreSQL)
-- รันทั้งไฟล์ครั้งเดียวใน Supabase > SQL Editor
-- =========================================================

-- ---------- ผู้ใช้และสิทธิ์ ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        text not null default 'warehouse'
              check (role in ('admin','purchasing','warehouse','sales')),
  created_at  timestamptz not null default now()
);

-- คืนบทบาทของผู้ใช้ที่ล็อกอินอยู่
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------- สินค้า (รหัสตรงกับ FlowAccount) ----------
create table public.products (
  id          bigint generated always as identity primary key,
  code        text unique,                       -- รหัสสินค้า FlowAccount
  name        text not null,                     -- เช่น แผ่น 304 2B 1.0 mm. 4'x8'
  category    text not null default 'sheet'
              check (category in ('sheet','pipe','flat','angle','shaft','channel','other')),
  unit        text not null default 'แผ่น',
  created_at  timestamptz not null default now()
);

-- ---------- ใบสั่งซื้อ / รายการรอเข้า ----------
create table public.purchase_orders (
  id          bigint generated always as identity primary key,
  po_no       text not null unique,              -- PO2026080054
  supplier    text not null,                     -- เอสทีเคสตีล / เอสทีเคสแตนเลส / อื่นๆ
  ordered_at  date not null default current_date,
  note        text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create table public.po_lines (
  id          bigint generated always as identity primary key,
  po_id       bigint not null references public.purchase_orders(id) on delete cascade,
  product_id  bigint not null references public.products(id),
  qty_ordered numeric not null check (qty_ordered > 0)
);

-- ---------- การรับของ (บิลผู้ขาย IV / ST) ----------
create table public.receipts (
  id              bigint generated always as identity primary key,
  po_id           bigint references public.purchase_orders(id),
  supplier_doc_no text not null,                 -- IV6907623
  received_at     date not null default current_date,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now()
);

-- ---------- Lot ----------
-- lot_no เป็นเลขรันเริ่ม 1 แสดงผลเป็น 5 หลัก (00001) ด้วย lot_code
create table public.lots (
  lot_no        bigint generated always as identity primary key,
  lot_code      text generated always as (lpad(lot_no::text, 5, '0')) stored,
  product_id    bigint not null references public.products(id),
  po_line_id    bigint references public.po_lines(id),
  receipt_id    bigint references public.receipts(id),
  qty_received  numeric not null check (qty_received > 0),
  bundle_label  text,                            -- ลัง 1 / มัด 2
  heat_no       text,                            -- จากใบเซอร์
  note          text,
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create unique index lots_lot_code_idx on public.lots(lot_code);

-- ไฟล์ของ Lot: ใบเซอร์ และรูปวัดขนาด (ตัวไฟล์อยู่ใน Storage)
create table public.lot_files (
  id            bigint generated always as identity primary key,
  lot_no        bigint not null references public.lots(lot_no) on delete cascade,
  kind          text not null check (kind in ('cert','photo')),
  storage_path  text not null,
  file_name     text,
  uploaded_by   uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

-- ค่าวัดจริง
create table public.lot_measurements (
  id            bigint generated always as identity primary key,
  lot_no        bigint not null references public.lots(lot_no) on delete cascade,
  measure       text not null,                   -- หนา จุด1 / OD / หนาผนัง / กว้าง / ยาว
  value         numeric not null,
  unit          text not null default 'mm',
  measured_by   uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

-- ---------- ความเคลื่อนไหวสต๊อค (ทุกอย่างเป็นแถวในตารางนี้) ----------
-- qty เป็นบวก = เข้า, ลบ = ออก
create table public.stock_moves (
  id          bigint generated always as identity primary key,
  lot_no      bigint not null references public.lots(lot_no),
  kind        text not null check (kind in
              ('receive','sale','return','adjust','process_out','process_in')),
  qty         numeric not null check (qty <> 0),
  doc_no      text,                              -- INV / NO / เลขบิลรับคืน
  customer    text,
  note        text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index stock_moves_lot_idx on public.stock_moves(lot_no);
create index stock_moves_doc_idx on public.stock_moves(doc_no);

-- สร้าง Lot แล้วลงรายการรับเข้าให้อัตโนมัติ
create or replace function public.lots_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.stock_moves(lot_no, kind, qty, doc_no, created_by)
  select new.lot_no, 'receive', new.qty_received, r.supplier_doc_no, new.created_by
  from (select 1) x left join public.receipts r on r.id = new.receipt_id;
  return new;
end $$;
create trigger lots_after_insert after insert on public.lots
  for each row execute function public.lots_after_insert();

-- คงเหลือต่อ Lot (On Process แยกออกมาให้เห็น)
create or replace view public.lot_balance with (security_invoker = true) as
select l.lot_no, l.lot_code, l.product_id, p.name as product_name, l.bundle_label,
       l.qty_received,
       coalesce(sum(m.qty), 0) as qty_on_hand,
       coalesce(-sum(m.qty) filter (where m.kind = 'process_out'), 0)
         - coalesce(sum(m.qty) filter (where m.kind = 'process_in'), 0) as qty_on_process,
       exists (select 1 from public.lot_files f where f.lot_no = l.lot_no and f.kind = 'cert')  as has_cert,
       exists (select 1 from public.lot_files f where f.lot_no = l.lot_no and f.kind = 'photo') as has_photo
from public.lots l
join public.products p on p.id = l.product_id
left join public.stock_moves m on m.lot_no = l.lot_no
group by l.lot_no, p.name;

-- กันตัดเกินจำนวนที่เหลือใน Lot
create or replace function public.stock_moves_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare bal numeric;
begin
  if new.qty < 0 then
    select coalesce(sum(qty), 0) into bal from public.stock_moves where lot_no = new.lot_no;
    if bal + new.qty < 0 then
      raise exception 'Lot % เหลือ % ตัด % ไม่ได้ กรุณานับใหม่', lpad(new.lot_no::text,5,'0'), bal, -new.qty;
    end if;
  end if;
  return new;
end $$;
create trigger stock_moves_check before insert on public.stock_moves
  for each row execute function public.stock_moves_check();

-- ---------- On Process (ส่งตัด / เจาะ / ขัด) ----------
create table public.process_jobs (
  id           bigint generated always as identity primary key,
  lot_no       bigint not null references public.lots(lot_no),
  qty          numeric not null check (qty > 0),
  tasks        text[] not null,                  -- {ตัด, เจาะรู, ขัด HL, ขัด NO.8, พับ}
  detail       text,
  vendor       text,
  due_date     date,
  ref_doc      text,                             -- บิล/QT ลูกค้า (ว่าง = เติมสต๊อค)
  status       text not null default 'sent' check (status in ('sent','returned','cancelled')),
  sent_at      timestamptz not null default now(),
  returned_at  timestamptz,
  created_by   uuid references auth.users(id) default auth.uid()
);

-- ---------- ลิงก์ใบเซอร์สำหรับลูกค้า ----------
create table public.cert_links (
  token       uuid primary key default gen_random_uuid(),
  lot_nos     bigint[] not null,
  doc_no      text,
  expires_at  timestamptz not null default now() + interval '90 days',
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- =========================================================
-- Row Level Security: ต้องล็อกอินและมีโปรไฟล์ถึงจะเห็นข้อมูล
-- =========================================================
alter table public.profiles         enable row level security;
alter table public.products         enable row level security;
alter table public.purchase_orders  enable row level security;
alter table public.po_lines         enable row level security;
alter table public.receipts         enable row level security;
alter table public.lots             enable row level security;
alter table public.lot_files        enable row level security;
alter table public.lot_measurements enable row level security;
alter table public.stock_moves      enable row level security;
alter table public.process_jobs     enable row level security;
alter table public.cert_links       enable row level security;

-- อ่าน: พนักงานทุกคนที่มีโปรไฟล์
create policy staff_read on public.profiles         for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.products         for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.purchase_orders  for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.po_lines         for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.receipts         for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.lots             for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.lot_files        for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.lot_measurements for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.stock_moves      for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.process_jobs     for select to authenticated using (public.my_role() is not null);
create policy staff_read on public.cert_links       for select to authenticated using (public.my_role() is not null);

-- เขียน: แยกตามหน้าที่
create policy admin_all on public.profiles for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy write_products on public.products for insert to authenticated
  with check (public.my_role() in ('admin','purchasing'));
create policy update_products on public.products for update to authenticated
  using (public.my_role() in ('admin','purchasing'));

create policy write_po on public.purchase_orders for insert to authenticated
  with check (public.my_role() in ('admin','purchasing'));
create policy update_po on public.purchase_orders for update to authenticated
  using (public.my_role() in ('admin','purchasing'));
create policy write_po_lines on public.po_lines for insert to authenticated
  with check (public.my_role() in ('admin','purchasing'));
create policy update_po_lines on public.po_lines for update to authenticated
  using (public.my_role() in ('admin','purchasing'));

create policy write_receipts on public.receipts for insert to authenticated
  with check (public.my_role() in ('admin','purchasing','warehouse'));
create policy write_lots on public.lots for insert to authenticated
  with check (public.my_role() in ('admin','purchasing','warehouse'));
create policy update_lots on public.lots for update to authenticated
  using (public.my_role() in ('admin','purchasing','warehouse'));

create policy write_files on public.lot_files for insert to authenticated
  with check (public.my_role() in ('admin','purchasing','warehouse'));
create policy write_measure on public.lot_measurements for insert to authenticated
  with check (public.my_role() in ('admin','purchasing','warehouse'));

create policy write_moves on public.stock_moves for insert to authenticated
  with check (public.my_role() in ('admin','warehouse'));

create policy write_jobs on public.process_jobs for insert to authenticated
  with check (public.my_role() in ('admin','warehouse','purchasing'));
create policy update_jobs on public.process_jobs for update to authenticated
  using (public.my_role() in ('admin','warehouse','purchasing'));

create policy write_links on public.cert_links for insert to authenticated
  with check (public.my_role() is not null);

-- ไม่มี policy ลบ: ลบข้อมูลได้เฉพาะแอดมินผ่านหน้า Supabase เท่านั้น
-- (แก้ยอดผิดให้ลงรายการ 'adjust' แทนการลบ)

-- สิทธิ์ Data API (เพราะปิด "Automatically expose new tables" ไว้)
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.lot_balance to authenticated;
grant execute on function public.my_role() to authenticated;

-- =========================================================
-- Storage: ที่เก็บไฟล์ใบเซอร์และรูป (ส่วนตัว ต้องล็อกอิน)
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('lot-files', 'lot-files', false, 10485760)   -- จำกัดไฟล์ละ 10 MB
on conflict (id) do nothing;

create policy lot_files_read on storage.objects for select to authenticated
  using (bucket_id = 'lot-files' and public.my_role() is not null);
create policy lot_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'lot-files' and public.my_role() in ('admin','purchasing','warehouse'));
