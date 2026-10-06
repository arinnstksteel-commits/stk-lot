# STK Lot & ใบเซอร์

ระบบติดตามสินค้าระดับ Lot และใบเซอร์ (Mill Certificate) ของ STK Metal สาขาเล็ก

- หน้าเว็บ: GitHub Pages (ไฟล์ `index.html`, `app.js`, `app.css`, `config.js`)
- ฐานข้อมูล / ไฟล์ / ล็อกอิน: Supabase (ไฟล์ SQL ในโฟลเดอร์ `supabase/`)

## ใช้งาน
- ล็อกอินด้วยชื่อผู้ใช้สั้นๆ (เช่น `win`) ระบบเติม `@stk.local` ให้
- บทบาท: แอดมิน / ออฟฟิศ / คลัง — แอดมินเป็นคนกำหนดบทบาทในตาราง `profiles`
- สแกน QR บนสติกเกอร์ด้วยกล้องมือถือ จะเปิดหน้า Lot ทันที

## ความปลอดภัย
- `config.js` มีเฉพาะ Publishable key ซึ่งออกแบบให้อยู่ในหน้าเว็บได้
- ข้อมูลทุกตารางป้องกันด้วย Row Level Security ต้องล็อกอินและมีบทบาทถึงจะเห็น
- **ห้าม** ใส่ secret key หรือ service_role key ใน repo นี้

## ไฟล์ฐานข้อมูล (รันตามลำดับใน Supabase > SQL Editor)
1. `supabase/schema.sql`
2. `supabase/002_roles.sql`
3. `supabase/003_process_office.sql`
4. `supabase/004_flowaccount_products.sql`
5. `supabase/005_pending_bill.sql`
6. `supabase/006_label_printed.sql`
7. `supabase/007_lots_at_po.sql`
8. `supabase/008_admin_delete.sql`
9. `supabase/009_reset_test_data.sql`
