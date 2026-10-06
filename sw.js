// Service worker: ทำให้ติดตั้งเป็นแอปได้ และเปิดหน้าแอปได้แม้เน็ตหลุดชั่วคราว
// ใช้ network-first สำหรับไฟล์ของแอป → อัปเดตใหม่เห็นทันทีเมื่อมีเน็ต
// ไม่แตะคำขอไปที่ Supabase (ข้อมูลจริงต้องมาจากเซิร์ฟเวอร์เสมอ)
const CACHE = 'stk-lot-v4';
const SHELL = ['./', './index.html', './app.css', './app.js', './i18n.js', './config.js', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!sameOrigin && !cdn) return; // Supabase ฯลฯ ไม่แคช
  e.respondWith(
    // ไฟล์ของแอป: ขอใหม่จากเซิร์ฟเวอร์ทุกครั้ง (ใช้ URL แทน request เดิม เพราะ request แบบเปิดหน้าใส่ตัวเลือกเพิ่มไม่ได้)
    (sameOrigin ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req)).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
