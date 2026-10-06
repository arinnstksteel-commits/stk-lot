-- 008: สิทธิ์ลบข้อมูล เฉพาะแอดมิน
-- ทุกฟังก์ชันเช็ค my_role() = 'admin' ก่อน · คืนค่า storage_path ของไฟล์ที่ต้องลบออกจาก Storage ด้วย

create or replace function public._assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'ลบข้อมูลได้เฉพาะแอดมิน'; end if;
end $$;

-- ลบ Lot ทั้งก้อน (ประวัติ ไฟล์ ค่าวัด งาน process)
create or replace function public.admin_delete_lot(p_lot bigint) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[];
begin
  perform public._assert_admin();
  select coalesce(array_agg(storage_path), '{}') into paths from lot_files where lot_no = p_lot;
  delete from process_jobs where lot_no = p_lot;
  delete from stock_moves where lot_no = p_lot;
  delete from lot_measurements where lot_no = p_lot;
  delete from lot_files where lot_no = p_lot;
  delete from lots where lot_no = p_lot;
  if not found then raise exception 'ไม่พบ Lot นี้'; end if;
  return paths;
end $$;

-- ลบ PO ทั้งใบ (รวมทุก Lot ใน PO)
create or replace function public.admin_delete_po(p_po bigint) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[] := '{}'; ln bigint;
begin
  perform public._assert_admin();
  for ln in select l.lot_no from lots l join po_lines pl on pl.id = l.po_line_id where pl.po_id = p_po loop
    paths := paths || public.admin_delete_lot(ln);
  end loop;
  delete from lots where receipt_id in (select id from receipts where po_id = p_po); -- กันหลุด
  delete from receipts where po_id = p_po;
  delete from po_lines where po_id = p_po;
  delete from purchase_orders where id = p_po;
  if not found then raise exception 'ไม่พบ PO นี้'; end if;
  return paths;
end $$;

-- ลบรายการตัดสต๊อค / รับคืน / ปรับยอด 1 รายการ
create or replace function public.admin_delete_move(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m stock_moves; bal numeric;
begin
  perform public._assert_admin();
  select * into m from stock_moves where id = p_id;
  if not found then raise exception 'ไม่พบรายการนี้'; end if;
  if m.kind = 'receive' then raise exception 'รายการรับเข้าลบไม่ได้ — ถ้าผิดให้ลบทั้ง Lot'; end if;
  if m.kind in ('process_out', 'process_in') then raise exception 'รายการ process ให้ลบที่หน้า On Process'; end if;
  delete from stock_moves where id = p_id;
  select coalesce(sum(qty), 0) into bal from stock_moves where lot_no = m.lot_no;
  if bal < 0 then raise exception 'ลบแล้วยอดคงเหลือติดลบ (%) ลบไม่ได้', bal; end if;
end $$;

-- ลบงาน process พร้อมรายการส่ง/รับคืนที่คู่กัน
create or replace function public.admin_delete_process_job(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare j process_jobs; bal numeric;
begin
  perform public._assert_admin();
  select * into j from process_jobs where id = p_id;
  if not found then raise exception 'ไม่พบงานนี้'; end if;
  delete from stock_moves where id = (select id from stock_moves where lot_no = j.lot_no and kind = 'process_out' and qty = -j.qty
                                      order by abs(extract(epoch from created_at - j.sent_at)) limit 1);
  if j.returned_at is not null then
    delete from stock_moves where id = (select id from stock_moves where lot_no = j.lot_no and kind = 'process_in' and qty = j.qty
                                        order by abs(extract(epoch from created_at - j.returned_at)) limit 1);
  end if;
  delete from process_jobs where id = p_id;
  select coalesce(sum(qty), 0) into bal from stock_moves where lot_no = j.lot_no;
  if bal < 0 then raise exception 'ลบแล้วยอดคงเหลือติดลบ (%) ลบไม่ได้', bal; end if;
end $$;

-- ลบไฟล์ใบเซอร์ / รูปวัด 1 ไฟล์
create or replace function public.admin_delete_file(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  perform public._assert_admin();
  delete from lot_files where id = p_id returning storage_path into p;
  if p is null then raise exception 'ไม่พบไฟล์นี้'; end if;
  return p;
end $$;

-- ลบค่าวัด 1 ค่า
create or replace function public.admin_delete_measurement(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._assert_admin();
  delete from lot_measurements where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['_assert_admin()', 'admin_delete_lot(bigint)', 'admin_delete_po(bigint)', 'admin_delete_move(bigint)',
                           'admin_delete_process_job(bigint)', 'admin_delete_file(bigint)', 'admin_delete_measurement(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- แอดมินลบไฟล์ใน Storage ได้
drop policy if exists lot_files_admin_delete on storage.objects;
create policy lot_files_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lot-files' and public.my_role() = 'admin');
