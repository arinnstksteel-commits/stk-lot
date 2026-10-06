-- 006: ติดตามว่า Lot ไหนพิมพ์สติกเกอร์แล้ว (งานค้าง "รอพิมพ์สติกเกอร์" ของออฟฟิศ)
alter table public.lots add column if not exists label_printed_at timestamptz;
alter table public.lots add column if not exists label_printed_by uuid references auth.users(id);
