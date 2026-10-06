-- 007: แตก Lot ตั้งแต่ตอนเปิด PO (ก่อนของมา)
-- Lot ที่ยังไม่มี receipt_id = "รอของเข้า" ยังไม่เข้าสต๊อค
-- เมื่อคลังกดรับของ → Lot ได้ receipt_id และระบบลงยอดรับเข้าให้อัตโนมัติ

-- ลงยอดรับเข้าเฉพาะ Lot ที่มีบิลรับของแล้ว
create or replace function public.lots_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.receipt_id is not null then
    insert into public.stock_moves(lot_no, kind, qty, doc_no, created_by)
    select new.lot_no, 'receive', new.qty_received, r.supplier_doc_no, new.created_by
    from public.receipts r where r.id = new.receipt_id;
  end if;
  return new;
end $$;

-- ตอนรับของ (receipt_id จากว่าง → มีค่า) ลงยอดรับเข้า
create or replace function public.lots_after_receive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.receipt_id is null and new.receipt_id is not null then
    insert into public.stock_moves(lot_no, kind, qty, doc_no, created_by)
    select new.lot_no, 'receive', new.qty_received, r.supplier_doc_no, auth.uid()
    from public.receipts r where r.id = new.receipt_id;
  end if;
  return new;
end $$;
drop trigger if exists lots_after_receive on public.lots;
create trigger lots_after_receive after update of receipt_id on public.lots
  for each row execute function public.lots_after_receive();

-- คลังกดรับของ: สร้างบิลรับของ + ผูก Lot ที่มาถึง (แก้จำนวนจริงได้)
-- p_lots = [{"lot_no": 12, "qty": 17}, ...]
create or replace function public.receive_lots(p_po_id bigint, p_doc text, p_date date, p_lots jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare rid bigint; x jsonb;
begin
  if public.my_role() not in ('admin', 'warehouse') then
    raise exception 'การกดรับของเป็นหน้าที่คลัง';
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
revoke all on function public.receive_lots(bigint, text, date, jsonb) from public, anon;
grant execute on function public.receive_lots(bigint, text, date, jsonb) to authenticated;

-- ลบ Lot ที่แตกผิด ได้เฉพาะตอนยังไม่รับของ (ออฟฟิศ/แอดมิน)
drop policy if exists delete_lots on public.lots;
create policy delete_lots on public.lots for delete to authenticated
  using (public.my_role() in ('admin', 'office') and receipt_id is null
         and not exists (select 1 from public.stock_moves m where m.lot_no = lots.lot_no));
grant delete on public.lots to authenticated;

-- เพิ่มคอลัมน์ received ใน lot_balance (ต่อท้าย)
create or replace view public.lot_balance with (security_invoker = true) as
select l.lot_no, l.lot_code, l.product_id, p.name as product_name, l.bundle_label,
       l.qty_received,
       coalesce(sum(m.qty), 0) as qty_on_hand,
       coalesce(-sum(m.qty) filter (where m.kind = 'process_out'), 0)
         - coalesce(sum(m.qty) filter (where m.kind = 'process_in'), 0) as qty_on_process,
       exists (select 1 from public.lot_files f where f.lot_no = l.lot_no and f.kind = 'cert')  as has_cert,
       exists (select 1 from public.lot_files f where f.lot_no = l.lot_no and f.kind = 'photo') as has_photo,
       (l.receipt_id is not null) as received
from public.lots l
join public.products p on p.id = l.product_id
left join public.stock_moves m on m.lot_no = l.lot_no
group by l.lot_no, p.name;
