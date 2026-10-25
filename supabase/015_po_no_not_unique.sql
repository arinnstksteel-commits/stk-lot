-- 015: เลข PO ซ้ำได้ (เช่น PO เดียวกันส่งของหลายรอบ หรือคนละผู้ขาย)
alter table public.purchase_orders drop constraint if exists purchase_orders_po_no_key;
create index if not exists purchase_orders_po_no_idx on public.purchase_orders(po_no);
