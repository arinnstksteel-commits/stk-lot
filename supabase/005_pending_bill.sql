-- 005: ตัดสต๊อคก่อนได้ แล้วค่อยใส่เลขบิล / ชื่อลูกค้าทีหลัง
-- คลังตัดไปก่อนโดยไม่ใส่เลขบิล → ขึ้นในงานค้าง → ออฟฟิศเติมเลขบิล/ชื่อลูกค้า
-- แก้ได้เฉพาะช่อง doc_no, customer, note ของรายการขาย (จำนวนและ Lot แก้ไม่ได้)

revoke update on public.stock_moves from authenticated;
grant update (doc_no, customer, note) on public.stock_moves to authenticated;

drop policy if exists fill_bill on public.stock_moves;
create policy fill_bill on public.stock_moves for update to authenticated
  using (public.my_role() in ('admin','office') and kind = 'sale')
  with check (public.my_role() in ('admin','office') and kind = 'sale');
