-- 004: ผูกสินค้ากับ FlowAccount
-- fa_id = รหัสภายในของสินค้าใน FlowAccount ใช้ซิงค์รายการสินค้า (นำเข้าซ้ำได้โดยไม่เกิดรายการซ้ำ)
alter table public.products add column if not exists fa_id text unique;
alter table public.products add column if not exists active boolean not null default true;
-- หมายเหตุ: ตัวข้อมูลสินค้าไม่เก็บใน repo นี้ (repo เป็นสาธารณะ) นำเข้าผ่าน SQL Editor โดยตรง
