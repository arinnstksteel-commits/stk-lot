-- 016: ออฟฟิศทำได้ทุกอย่าง ยกเว้นลบข้อมูล
-- 1) ออฟฟิศกดรับของได้ (เดิมเฉพาะคลัง/แอดมิน)
-- 2) การลบ Lot ที่ยังไม่รับของ เหลือเฉพาะแอดมิน (แอดมินลบผ่านฟังก์ชัน admin_delete_* อยู่แล้ว)
create or replace function public.receive_lots(p_po_id bigint, p_doc text, p_date date, p_lots jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare rid bigint; x jsonb;
begin
  if coalesce(public.my_role(), '') not in ('admin', 'office', 'warehouse') then
    raise exception 'ไม่มีสิทธิ์กดรับของ';
  end if;
  if coalesce(trim(p_doc), '') = '' then raise exception 'ใส่เลขบิลผู้ขาย'; end if;
  if jsonb_array_length(coalesce(p_lots, '[]')) = 0 then raise exception 'เลือก Lot ที่ของมาถึงอย่างน้อย 1 Lot'; end if;
  insert into public.receipts(po_id, supplier_doc_no, received_at)
    values (p_po_id, upper(trim(p_doc)), coalesce(p_date, current_date)) returning id into rid;
  for x in select * from jsonb_array_elements(p_lots) loop
    if (x->>'qty')::numeric <= 0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
    update public.lots l set qty_received = (x->>'qty')::numeric, receipt_id = rid
      from public.po_lines pl
     where l.lot_no = (x->>'lot_no')::bigint and l.receipt_id is null
       and pl.id = l.po_line_id and pl.po_id = p_po_id;
    if not found then raise exception 'Lot % รับไปแล้วหรือไม่ได้อยู่ใน PO นี้', lpad(x->>'lot_no', 5, '0'); end if;
  end loop;
  return rid;
end $$;

drop policy if exists delete_lots on public.lots;
create policy delete_lots on public.lots for delete to authenticated
  using (public.my_role() = 'admin' and receipt_id is null
         and not exists (select 1 from public.stock_moves m where m.lot_no = lots.lot_no));

-- ตารางที่ออฟฟิศเคยลบได้ตรงๆ: แผนส่งของ และราคา → ลบได้เฉพาะแอดมิน (ออฟฟิศยังเพิ่ม/แก้ได้)
drop policy if exists office_write on public.delivery_trips;
drop policy if exists office_write on public.delivery_stops;
create policy office_ins on public.delivery_trips for insert to authenticated with check (public.my_role() in ('admin', 'office'));
create policy office_upd on public.delivery_trips for update to authenticated using (public.my_role() in ('admin', 'office'));
create policy admin_del  on public.delivery_trips for delete to authenticated using (public.my_role() = 'admin');
create policy office_ins on public.delivery_stops for insert to authenticated with check (public.my_role() in ('admin', 'office'));
create policy office_upd on public.delivery_stops for update to authenticated using (public.my_role() in ('admin', 'office'));
create policy office_del on public.delivery_stops for delete to authenticated using (public.my_role() in ('admin', 'office'));
