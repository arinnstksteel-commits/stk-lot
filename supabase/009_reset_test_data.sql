-- 009: ล้างข้อมูลช่วงทดสอบ (แอดมินเท่านั้น ต้องพิมพ์คำยืนยัน)
-- ลบ: PO, บิลรับของ, Lot, ประวัติสต๊อค, ไฟล์, ค่าวัด, งาน process, ลิงก์เซอร์
-- เก็บไว้: รายการสินค้าจาก FlowAccount และบัญชีผู้ใช้/บทบาท
-- เลข Lot / PO จะเริ่มนับใหม่ที่ 00001
create or replace function public.admin_reset_test_data(p_confirm text) returns text[]
language plpgsql security definer set search_path = public as $$
declare paths text[];
begin
  perform public._assert_admin();
  if p_confirm is distinct from 'ล้างข้อมูล' then raise exception 'คำยืนยันไม่ถูกต้อง'; end if;
  select coalesce(array_agg(storage_path), '{}') into paths from lot_files;
  truncate cert_links, process_jobs, stock_moves, lot_measurements, lot_files, lots, receipts, po_lines, purchase_orders restart identity;
  -- สินค้าที่สร้างเองตอนทดสอบ (ไม่ได้มาจาก FlowAccount)
  delete from products where fa_id is null;
  return paths;
end $$;
revoke all on function public.admin_reset_test_data(text) from public, anon;
grant execute on function public.admin_reset_test_data(text) to authenticated;
