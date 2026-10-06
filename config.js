// ค่าเชื่อมต่อ Supabase
// Publishable key ออกแบบมาให้อยู่ในหน้าเว็บได้ (ข้อมูลถูกป้องกันด้วย RLS + การล็อกอิน)
// ห้ามใส่ secret key / service_role key ในไฟล์นี้เด็ดขาด
export const SUPABASE_URL = 'https://jaowtuxiffqvjysxjfgw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ikHN6UEIyK_kVsRToibUsQ_WF6Pf743';

// ล็อกอินด้วยชื่อผู้ใช้สั้นๆ ระบบเติมโดเมนนี้ให้เบื้องหลัง
export const EMAIL_DOMAIN = 'stk.local';

export const SUPPLIERS = ['เอสทีเคสตีล', 'เอสทีเคสแตนเลส', 'อื่นๆ'];

export const CATEGORIES = {
  sheet:   { label: 'แผ่น',      unit: 'แผ่น', measures: ['หนา จุด 1', 'หนา จุด 2', 'หนา จุด 3'] },
  pipe:    { label: 'ท่อ',       unit: 'เส้น', measures: ['OD', 'หนาผนัง', 'ความยาว'] },
  flat:    { label: 'เส้นแบน',   unit: 'เส้น', measures: ['กว้าง', 'หนา', 'ความยาว'] },
  angle:   { label: 'ฉาก',       unit: 'เส้น', measures: ['ขาฉาก', 'หนา', 'ความยาว'] },
  shaft:   { label: 'เพลา',      unit: 'เส้น', measures: ['เส้นผ่านศูนย์กลาง', 'ความยาว'] },
  channel: { label: 'ราง',       unit: 'เส้น', measures: ['กว้าง', 'สูง', 'หนา', 'ความยาว'] },
  other:   { label: 'อื่นๆ',     unit: 'ชิ้น', measures: ['ค่าวัด 1', 'ค่าวัด 2'] },
};
