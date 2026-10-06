-- =========================================================
-- 002: ปรับบทบาทให้ตรงกับงานจริงของ STK Metal
--   admin     = หัวหน้า / ผู้ดูแลระบบ (ทำได้ทุกอย่าง + จัดการผู้ใช้)
--   office    = เซลล์ + บัญชี (เช็คสต๊อค สั่งของเข้า ตัดสต๊อค หาใบเซอร์)
--   warehouse = พนักงานคลัง (รับของ ติดสติกเกอร์ ถ่ายรูปวัด ตัดสต๊อค ส่ง process)
-- =========================================================

alter table public.profiles drop constraint profiles_role_check;
update public.profiles set role = 'office' where role in ('purchasing','sales');
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','office','warehouse'));
alter table public.profiles alter column role set default 'warehouse';

-- ลบ policy เขียนเดิม แล้วสร้างใหม่ตามบทบาทใหม่
drop policy if exists write_products  on public.products;
drop policy if exists update_products on public.products;
drop policy if exists write_po        on public.purchase_orders;
drop policy if exists update_po       on public.purchase_orders;
drop policy if exists write_po_lines  on public.po_lines;
drop policy if exists update_po_lines on public.po_lines;
drop policy if exists write_receipts  on public.receipts;
drop policy if exists write_lots      on public.lots;
drop policy if exists update_lots     on public.lots;
drop policy if exists write_files     on public.lot_files;
drop policy if exists write_measure   on public.lot_measurements;
drop policy if exists write_moves     on public.stock_moves;
drop policy if exists write_jobs      on public.process_jobs;
drop policy if exists update_jobs     on public.process_jobs;
drop policy if exists lot_files_write on storage.objects;

-- สินค้า / PO: admin + office
create policy write_products  on public.products        for insert to authenticated with check (public.my_role() in ('admin','office'));
create policy update_products on public.products        for update to authenticated using      (public.my_role() in ('admin','office'));
create policy write_po        on public.purchase_orders for insert to authenticated with check (public.my_role() in ('admin','office'));
create policy update_po       on public.purchase_orders for update to authenticated using      (public.my_role() in ('admin','office'));
create policy write_po_lines  on public.po_lines        for insert to authenticated with check (public.my_role() in ('admin','office'));
create policy update_po_lines on public.po_lines        for update to authenticated using      (public.my_role() in ('admin','office'));

-- รับของ / Lot / ไฟล์ / ค่าวัด / ตัดสต๊อค / process: ทุกบทบาท
create policy write_receipts  on public.receipts         for insert to authenticated with check (public.my_role() is not null);
create policy write_lots      on public.lots             for insert to authenticated with check (public.my_role() is not null);
create policy update_lots     on public.lots             for update to authenticated using      (public.my_role() is not null);
create policy write_files     on public.lot_files        for insert to authenticated with check (public.my_role() is not null);
create policy write_measure   on public.lot_measurements for insert to authenticated with check (public.my_role() is not null);
create policy write_moves     on public.stock_moves      for insert to authenticated with check (public.my_role() is not null);
create policy write_jobs      on public.process_jobs     for insert to authenticated with check (public.my_role() is not null);
create policy update_jobs     on public.process_jobs     for update to authenticated using      (public.my_role() is not null);
create policy lot_files_write on storage.objects         for insert to authenticated
  with check (bucket_id = 'lot-files' and public.my_role() is not null);

-- หมายเหตุความปลอดภัย: ไม่สร้างโปรไฟล์อัตโนมัติ
-- ผู้ใช้ที่ไม่มีแถวใน profiles จะล็อกอินได้แต่ไม่เห็นข้อมูลใดๆ (my_role() = null)
-- แอดมินเป็นคนเพิ่มโปรไฟล์และกำหนดบทบาทเองเท่านั้น
