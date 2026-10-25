-- 013: แยกหมวดรูปร่างเพิ่ม ท่อเหลี่ยม / เพลาเหลี่ยม / เพลาหกเหลี่ยม
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check check (category in
  ('sheet', 'pipe', 'square_tube', 'flat', 'angle', 'shaft', 'square_bar', 'hex_bar', 'channel', 'other'));

-- จัดหมวดสินค้าเดิมตามชื่อ (ชื่อจาก FlowAccount)
update public.products set category = 'square_tube', unit = coalesce(unit, 'เส้น')
  where name ~ '^(ท่อเหลี่ยม|ท่อสี่เหลี่ยม|เหล็กกล่อง)';
update public.products set category = 'square_bar', unit = coalesce(unit, 'เส้น')
  where name ~ '^(เพลาเหลี่ยม|เพลาสี่เหลี่ยม)';
update public.products set category = 'hex_bar', unit = coalesce(unit, 'เส้น')
  where name ~ '^เพลาหกเหลี่ยม';
update public.products set category = 'shaft'
  where name ~ '^เพลากลม' and category <> 'shaft';
