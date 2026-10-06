import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, EMAIL_DOMAIN, SUPPLIERS, CATEGORIES } from './config.js';
import { initI18n, langToggleHtml, setLang, getLang } from './i18n.js';

initI18n();

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const state = { session: null, profile: null };

/* ===================== helpers ===================== */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lotCode = (n) => String(n).padStart(5, '0');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');
const num = (v) => Number(v ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const isOffice = () => ['admin', 'office'].includes(state.profile?.role);
const isAdmin = () => state.profile?.role === 'admin';
// ปุ่มลบ (เห็นเฉพาะแอดมิน) — จัดการคลิกรวมที่ adminDelete()
const delBtn = (fn, id, msg, go = '', label = 'ลบ') => isAdmin()
  ? `<button type="button" class="btn ghost sm del" data-adel="${fn}" data-id="${id}" data-msg="${esc(msg)}" data-go="${esc(go)}">${label}</button>` : '';
const ROLE_TH = { admin: 'แอดมิน', office: 'ออฟฟิศ', warehouse: 'คลัง' };
const baseUrl = () => location.href.split('#')[0];

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9H3z"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function head(title, sub = '', back = '#/', dark = false) {
  return `<header class="head${dark ? ' dark' : ''}">
    ${back ? `<a class="back" href="${back}" aria-label="กลับ">${ICON.back}</a>` : ''}
    <div style="flex:1;min-width:0"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
  </header>`;
}
function setTabs(active) {
  if (!state.profile) { tabbar.hidden = true; return; }
  const tabs = [
    ['home', '#/', 'หน้าแรก', ICON.home],
    ['po', '#/po', 'รับของ', ICON.box],
    ['search', '#/search', 'ค้นหา', ICON.search],
    ['me', '#/me', 'บัญชี', ICON.user],
  ];
  tabbar.innerHTML = tabs.map(([k, h, l, i]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${i}${l}</a>`).join('');
  tabbar.hidden = false;
}
function fail(err) {
  console.error(err);
  toast('เกิดข้อผิดพลาด: ' + (err?.message || err), 5000);
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// ย่อรูปก่อนอัปโหลด (ด้านยาวสุด 1600px, JPEG 75%) ประหยัดพื้นที่ Supabase
async function compressImage(file, max = 1600, quality = 0.75) {
  if (!file.type.startsWith('image/')) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

async function uploadLotFile(lotNo, kind, file) {
  const f = kind === 'photo' ? await compressImage(file) : (file.type.startsWith('image/') ? await compressImage(file, 2400, 0.85) : file);
  const ext = (f.name.split('.').pop() || 'bin').toLowerCase();
  const path = `lots/${lotCode(lotNo)}/${kind}-${Date.now()}.${ext}`;
  await q(sb.storage.from('lot-files').upload(path, f, { contentType: f.type, upsert: false }));
  await q(sb.from('lot_files').insert({ lot_no: lotNo, kind, storage_path: path, file_name: file.name }));
}
async function signedUrl(path, seconds = 3600) {
  const { data } = await sb.storage.from('lot-files').createSignedUrl(path, seconds);
  return data?.signedUrl;
}

/* ===================== สแกน QR ด้วยกล้อง ===================== */
// ใช้ BarcodeDetector ของเบราว์เซอร์ถ้ามี (Chrome Android) ไม่งั้นใช้ jsQR (iPhone / เบราว์เซอร์อื่น)
function lotFromQr(text) {
  const t = String(text || '').trim();
  const m = t.match(/#\/lot\/(\d{1,5})/) || t.match(/^(\d{1,5})$/);
  return m ? lotCode(m[1]) : null;
}
// อ่าน QR จากรูปถ่าย (ใช้ได้แม้กล้องสดเปิดไม่ได้)
async function readQrFromImage(file) {
  const bmp = await createImageBitmap(file);
  if ('BarcodeDetector' in window) {
    try { const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bmp); if (r[0]) return r[0].rawValue; } catch { /* ใช้ jsQR ต่อ */ }
  }
  const { default: jsQR } = await import('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm');
  for (const max of [1000, 1600, 700]) {
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    if (hit) return hit.data;
  }
  return null;
}
async function openScanner() {
  const ov = document.createElement('div');
  ov.className = 'scanner';
  ov.innerHTML = `<video playsinline muted></video><div class="frame" aria-hidden="true"></div>
    <p class="hint">เล็งกล้องไปที่ QR บนสติกเกอร์ Lot</p>
    <button class="btn ghost close" type="button">ปิด</button>`;
  document.body.appendChild(ov);
  const video = ov.querySelector('video');
  const hint = ov.querySelector('.hint');
  let stream = null; let stopped = false;
  const stop = () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); ov.remove(); };
  ov.querySelector('.close').onclick = stop;
  const photoBtn = document.createElement('label');
  photoBtn.className = 'btn primary';
  photoBtn.style.cssText = 'position:absolute;bottom:calc(90px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);min-width:220px';
  photoBtn.innerHTML = 'ถ่ายรูป QR แทน<input type="file" accept="image/*" capture="environment" hidden>';
  ov.appendChild(photoBtn);
  photoBtn.querySelector('input').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    hint.textContent = 'กำลังอ่าน QR จากรูป…';
    try {
      const text = await readQrFromImage(f);
      const code = lotFromQr(text);
      if (code) { stop(); location.hash = '#/lot/' + code; return; }
      hint.textContent = text ? 'QR นี้ไม่ใช่สติกเกอร์ Lot ของระบบ' : 'อ่าน QR ในรูปไม่ได้ ลองถ่ายใกล้ขึ้นและให้ชัด';
    } catch { hint.textContent = 'อ่าน QR ในรูปไม่ได้ ลองถ่ายใหม่'; }
  };
  const inApp = /Line\/|FBAN|FBAV|Instagram|wv\)/i.test(navigator.userAgent);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('nomedia'), { name: 'NoMedia' });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e1) {
      if (e1.name === 'NotAllowedError') throw e1;
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  } catch (e) {
    const why = {
      NotAllowedError: inApp ? 'เปิดผ่านแอป LINE/Facebook ใช้กล้องสดไม่ได้ — กด ⋮ แล้วเลือก "เปิดใน Chrome" หรือใช้ปุ่มถ่ายรูปด้านล่าง'
        : 'ถูกปิดสิทธิ์กล้อง — เช็คทั้ง 2 ที่: (1) Chrome: แตะไอคอนหน้าลิงก์ → สิทธิ์ → กล้อง → อนุญาต (2) ตั้งค่ามือถือ → แอป → Chrome → สิทธิ์ → กล้อง → อนุญาต',
      NotReadableError: 'กล้องถูกแอปอื่นใช้อยู่ (เช่น LINE วิดีโอคอล / แอปกล้อง) — ปิดแอปนั้นแล้วลองใหม่',
      NotFoundError: 'ไม่พบกล้องในเครื่องนี้',
      NoMedia: inApp ? 'เปิดผ่านแอป LINE/Facebook ใช้กล้องสดไม่ได้ — กด ⋮ แล้วเลือก "เปิดใน Chrome" หรือใช้ปุ่มถ่ายรูปด้านล่าง' : 'เบราว์เซอร์นี้ไม่รองรับกล้องสด — ใช้ปุ่มถ่ายรูปด้านล่าง',
    }[e.name] || `เปิดกล้องไม่ได้ (${e.name || e.message}) — ใช้ปุ่มถ่ายรูปด้านล่างแทนได้`;
    hint.textContent = why;
    return;
  }
  if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
  video.srcObject = stream;
  await video.play().catch(() => {});
  let detect;
  if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats?.() || []).includes('qr_code')) {
    const bd = new BarcodeDetector({ formats: ['qr_code'] });
    detect = async () => (await bd.detect(video))[0]?.rawValue;
  } else {
    const { default: jsQR } = await import('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    detect = async () => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w) return null;
      const s = Math.min(1, 720 / Math.max(w, h));
      canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data;
    };
  }
  const loop = async () => {
    if (stopped) return;
    try {
      const text = await detect();
      if (text) {
        const code = lotFromQr(text);
        if (code) { navigator.vibrate?.(80); stop(); location.hash = '#/lot/' + code; return; }
        hint.textContent = 'QR นี้ไม่ใช่สติกเกอร์ Lot ของระบบ';
      }
    } catch { /* เฟรมนี้อ่านไม่ได้ ลองเฟรมถัดไป */ }
    setTimeout(loop, 180);
  };
  loop();
}

/* ===================== สินค้า (รายการจาก FlowAccount) ===================== */
// Supabase ส่งได้ครั้งละ 1,000 แถว จึงดึงเป็นหน้าๆ จนครบ
let productCache = null;
async function loadProducts() {
  if (productCache) return productCache;
  const all = [];
  for (let from = 0; ; from += 1000) {
    const page = await q(sb.from('products').select('id, code, name, category, unit').eq('active', true).order('name').range(from, from + 999));
    all.push(...page);
    if (page.length < 1000) break;
  }
  all.forEach((p) => { p._s = normText(`${p.name} ${p.code || ''}`); });
  return (productCache = all);
}
// ทำให้ค้นง่าย: ตัวเล็ก ตัด ' " และช่องว่างซ้ำ ("4'x8'" -> "4x8")
const normText = (s) => String(s).toLowerCase().replace(/['"`]/g, '').replace(/\s+/g, ' ').trim();
// ทุกคำที่พิมพ์ต้องอยู่ในชื่อหรือรหัส (สลับลำดับได้) เช่น "2b 1.0 4x8"
function searchProducts(list, text, limit = 15) {
  const tokens = normText(text).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const hits = [];
  for (const p of list) {
    if (tokens.every((t) => p._s.includes(t))) { hits.push(p); if (hits.length >= limit) break; }
  }
  return hits;
}

/* ===================== auth ===================== */
async function loadProfile() {
  state.profile = null;
  if (!state.session) return;
  const { data } = await sb.from('profiles').select('full_name, role').eq('id', state.session.user.id).maybeSingle();
  state.profile = data;
}

function viewLogin(msg = '') {
  setTabs(null);
  app.innerHTML = `
  <form class="login" id="loginForm">
    <div class="row" style="align-items:flex-start"><div><div class="brand">STK Metal · สาขาเล็ก</div><h1>Lot &amp; ใบเซอร์</h1></div>${langToggleHtml()}</div>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <label class="f">ชื่อผู้ใช้<input name="u" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="เช่น win"></label>
    <label class="f">รหัสผ่าน<input name="p" type="password" autocomplete="current-password" required></label>
    <button class="btn primary block" type="submit">เข้าสู่ระบบ</button>
  </form>`;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let u = String(fd.get('u')).trim().toLowerCase();
    if (!u.includes('@')) u = `${u}@${EMAIL_DOMAIN}`;
    e.target.querySelector('button').disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: u, password: String(fd.get('p')) });
    if (error) return viewLogin('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    location.hash = '#/';
  };
}

function viewNoRole() {
  setTabs(null);
  app.innerHTML = `<div class="login">
    <h1>ยังไม่ได้รับสิทธิ์</h1>
    <p class="muted">บัญชีนี้ล็อกอินได้ แต่แอดมินยังไม่ได้กำหนดบทบาทให้ กรุณาแจ้งแอดมิน</p>
    <button class="btn ghost" id="lo">ออกจากระบบ</button></div>`;
  document.getElementById('lo').onclick = () => sb.auth.signOut();
}

/* ===================== ติดตั้งเป็นแอป (PWA) ===================== */
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (location.hash.startsWith('#/me')) route(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('ติดตั้งแอปแล้ว'); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
function installCardHtml() {
  if (isStandalone()) return '';
  if (installPrompt) return `<button class="btn primary block installBtn">ติดตั้งแอปลงมือถือ</button>`;
  const how = isIOS()
    ? 'เปิดใน Safari → กดปุ่มแชร์ (สี่เหลี่ยมลูกศรขึ้น) → "เพิ่มไปยังหน้าจอโฮม"'
    : 'เปิดใน Chrome → กดเมนู ⋮ มุมขวาบน → "ติดตั้งแอป" หรือ "เพิ่มลงในหน้าจอหลัก"';
  return `<div class="card"><h2>ติดตั้งเป็นแอป</h2><div class="muted">${how}</div></div>`;
}

/* ===================== หน้าแรก ===================== */
async function viewHome() {
  setTabs('home');
  app.innerHTML = `
  <header class="head dark" style="flex-direction:column;align-items:stretch;gap:14px;padding:22px 16px 18px">
    <div class="row"><div><div class="sub">STK Metal · ${esc(state.profile.full_name)} (${ROLE_TH[state.profile.role]})</div><h1 style="font-size:22px">Lot &amp; ใบเซอร์</h1></div>${langToggleHtml()}</div>
    <form id="qs" class="row" style="gap:8px"><input name="q" placeholder="เลข Lot / INV / ชื่อสินค้า" aria-label="ค้นหา" style="border:0"><button class="btn primary" aria-label="ค้นหา">${ICON.search}</button><button type="button" class="btn ghost scanBtn" aria-label="สแกน QR" style="border:0">${ICON.scan}</button></form>
  </header>
  <div class="wrap">
    <div class="tiles">
      <a class="tile" href="#/po">${ICON.box}รับของ / PO</a>
      <a class="tile" href="#/search">${ICON.doc}ใบเซอร์</a>
      <button type="button" class="tile scanBtn" style="border:0;font:inherit;cursor:pointer">${ICON.scan}สแกน QR / ตัดสต๊อค</button>
      <a class="tile" href="#/process"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>On Process</a>
    </div>
    <div class="card"><h2>งานค้าง</h2><div class="list" id="todo"><p class="empty">กำลังโหลด…</p></div></div>
    <div class="card"><h2>Lot ล่าสุด</h2><div class="list" id="recent"><p class="empty">กำลังโหลด…</p></div></div>
  </div>`;
  document.getElementById('qs').onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('q'); location.hash = '#/search?q=' + encodeURIComponent(v); };

  try {
    const [pos, noLabel, noBill, noCert, noPhoto, overdue, recent] = await Promise.all([
      q(sb.from('purchase_orders').select(PO_SELECT).limit(500)),
      q(sb.from('lots').select('lot_no').is('label_printed_at', null)),
      q(sb.from('stock_moves').select('id').eq('kind', 'sale').is('doc_no', null)),
      q(sb.from('lot_balance').select('lot_no', { count: 'exact', head: false }).eq('has_cert', false).gt('qty_on_hand', 0)),
      q(sb.from('lot_balance').select('lot_no').eq('has_photo', false).gt('qty_on_hand', 0)),
      q(sb.from('process_jobs').select('id, due_date').eq('status', 'sent')),
      q(sb.from('lot_balance').select('*').order('lot_no', { ascending: false }).limit(8)),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const late = overdue.filter((j) => j.due_date && j.due_date < today).length;
    const todo = [
      ['PO รอของเข้า', 'คลังกดรับของวันที่ของมาส่ง', pos.filter((p) => poStatus(p).key === 'wait').length, 'info', '#/po?f=wait'],
      ['PO ยังไม่แตก Lot', 'ออฟฟิศแตก Lot ให้ครบทุกรายการ', pos.filter((p) => poStatus(p).key === 'split').length, 'warn', '#/po?f=split'],
      ['ตัดสต๊อครอเลขบิล', 'เติมเลขบิล / ชื่อลูกค้า', noBill.length, 'bad', '#/pending'],
      ['Lot รอพิมพ์สติกเกอร์', 'ออฟฟิศพิมพ์แล้วส่งให้คลังติด', noLabel.length, 'warn', '#/labels'],
      ['Lot รอใบเซอร์', 'ออฟฟิศต้องอัปโหลด', noCert.length, 'warn', '#/lots?f=nocert'],
      ['Lot รอรูปวัดขนาด', 'คลังต้องถ่ายรูป', noPhoto.length, 'warn', '#/lots?f=nophoto'],
      ['ส่งตัด/ขัด ยังไม่รับคืน', late ? `เลยกำหนด ${late} งาน` : 'ติดตามจนกว่าจะรับคืน', overdue.length, late ? 'bad' : 'warn', '#/process'],
    ];
    document.getElementById('todo').innerHTML = todo.map(([t, s, n, c, href]) => {
      const inner = `<div><div>${t}</div><div class="muted">${s}</div></div><span class="chip ${n ? c : 'ok'}">${n}</span>`;
      return href && n ? `<a class="row" href="${href}" style="text-decoration:none;color:inherit">${inner}</a>` : `<div class="row">${inner}</div>`;
    }).join('');
    document.getElementById('recent').innerHTML = recent.length ? recent.map(lotItem).join('') : '<p class="empty">ยังไม่มี Lot · เริ่มจากสร้าง PO ที่เมนู "รับของ"</p>';
  } catch (e) { fail(e); }
}

function lotItem(l) {
  return `<a class="item" href="#/lot/${l.lot_code}">
    <div class="row"><span class="lotcode">Lot ${l.lot_code}</span>${l.received === false ? '<span class="chip info">รอของเข้า</span>' : `<span class="muted">คงเหลือ ${num(l.qty_on_hand)}</span>`}</div>
    <div>${esc(l.product_name)}</div>
    <div class="row" style="justify-content:flex-start;gap:6px">${l.bundle_label ? `<span class="muted">${esc(l.bundle_label)}</span>` : ''}
      <span class="chip ${l.has_cert ? 'ok' : 'warn'}">${l.has_cert ? 'มีเซอร์' : 'รอเซอร์'}</span>
      <span class="chip ${l.has_photo ? 'ok' : 'warn'}">${l.has_photo ? 'มีรูปวัด' : 'รอรูปวัด'}</span></div>
  </a>`;
}

/* ===================== PO ===================== */
// สถานะ PO: ออฟฟิศเปิด PO + แตก Lot → รอของเข้า (คลังกดรับ) → รับครบ
function poStatus(p) {
  if (p.po_lines.some((l) => !l.lots.length)) return { key: 'split', label: 'ยังไม่แตก Lot', chip: 'warn' };
  const lots = p.po_lines.flatMap((l) => l.lots);
  const got = lots.filter((x) => x.receipt_id).length;
  if (got < lots.length) return { key: 'wait', label: got ? `รอของเข้า (มาแล้ว ${got}/${lots.length} Lot)` : 'รอของเข้า', chip: 'info' };
  return { key: 'done', label: 'รับครบ', chip: 'ok' };
}
const PO_SELECT = 'id, po_no, supplier, ordered_at, po_lines(id, qty_ordered, lots(lot_no, receipt_id))';

async function viewPOList(params = new URLSearchParams()) {
  setTabs('po');
  const f = params.get('f') || '';
  const tabs = [['', 'ทั้งหมด'], ['wait', 'รอของเข้า'], ['split', 'ยังไม่แตก Lot'], ['done', 'รับครบ']];
  app.innerHTML = head('รับของ / PO', 'ออฟฟิศเปิด PO · คลังกดรับของวันที่ของมาส่ง', '#/') + `
  <div class="wrap">
    ${isOffice() ? '<a class="btn primary block" href="#/po/new">+ สร้าง PO + แตก Lot</a>' : ''}
    <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">${tabs.map(([k, l]) =>
      `<a class="btn sm ${k === f ? 'dark' : 'ghost'}" href="#/po${k ? '?f=' + k : ''}">${l}</a>`).join('')}</div>
    <div class="card"><div class="list" id="pos"><p class="empty">กำลังโหลด…</p></div></div>
  </div>`;
  try {
    const pos = (await q(sb.from('purchase_orders').select(PO_SELECT).order('id', { ascending: false }).limit(200)))
      .map((p) => ({ ...p, st: poStatus(p) })).filter((p) => !f || p.st.key === f);
    document.getElementById('pos').innerHTML = pos.length ? pos.map((p) => {
      const lots = p.po_lines.reduce((s, l) => s + l.lots.length, 0);
      return `<a class="item" href="#/po/${p.id}">
        <div class="row"><span class="mono" style="font-weight:600">${esc(p.po_no)}</span><span class="chip ${p.st.chip}">${p.st.label}</span></div>
        <div class="muted">${esc(p.supplier)} · สั่ง ${fmtDate(p.ordered_at)} · ${p.po_lines.length} รายการ · ${lots} Lot</div></a>`;
    }).join('') : '<p class="empty">ไม่มีรายการ</p>';
  } catch (e) { fail(e); }
}

async function viewPONew() {
  setTabs('po');
  if (!isOffice()) { app.innerHTML = head('สร้าง PO', '', '#/po') + '<div class="wrap"><p class="err">เฉพาะแอดมินและออฟฟิศ</p></div>'; return; }
  app.innerHTML = head('สร้าง PO + แตก Lot', 'ลงไว้ก่อนของมาถึง · คลังกดรับวันที่ของมาส่ง', '#/po') + `
  <form class="wrap" id="poForm">
    <div class="card">
      <label class="f">เลข PO<input name="po_no" required placeholder="PO2026100001" class="mono"></label>
      <div class="grid2">
        <label class="f">ผู้ขาย<select name="supplier">${SUPPLIERS.map((s) => `<option>${s}</option>`).join('')}</select></label>
        <label class="f">วันที่สั่ง<input name="ordered_at" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      </div>
      <label class="f">หมายเหตุ<input name="note"></label>
    </div>
    <div class="card"><h2>รายการสินค้า</h2><div id="lines" class="list"></div>
      <button type="button" class="btn dash" id="addLine">+ เพิ่มรายการ</button></div>
    <button class="btn primary block" type="submit">บันทึก PO</button>
  </form>`;

  const products = await loadProducts().catch((e) => (fail(e), []));
  const byName = new Map(products.map((p) => [p.name, p]));

  const lines = document.getElementById('lines');
  const addLine = () => {
    const div = document.createElement('div');
    div.className = 'line';
    div.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">
      <label class="f">สินค้า<input name="product" required autocomplete="off" placeholder="พิมพ์ค้นหา เช่น 2b 1.0 4x8 หรือรหัสสินค้า"></label>
      <div class="suggest" role="listbox" hidden></div>
      <div class="newprod" hidden>
        <p class="muted" style="margin:0">สินค้าใหม่ (ยังไม่มีในระบบ) — ระบุประเภท</p>
        <div class="grid2"><label class="f">ประเภท<select name="category">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
        <label class="f">รหัส FlowAccount<input name="code" placeholder="ถ้ามี"></label></div>
      </div>
      <div class="lotrows" style="display:flex;flex-direction:column;gap:8px"></div>
      <div class="row"><span class="muted total"></span><button type="button" class="btn ghost sm rm">ลบรายการ</button></div>
      <button type="button" class="btn dash sm addLot">+ แบ่งเพิ่มอีก Lot (คนละใบเซอร์ / ลัง / มัด)</button></div>`;
    const inp = div.querySelector('[name=product]');
    const box = div.querySelector('.suggest');
    const newprod = div.querySelector('.newprod');
    const refreshNew = () => { newprod.hidden = byName.has(inp.value.trim()) || !inp.value.trim(); };
    inp.addEventListener('input', () => {
      const hits = searchProducts(products, inp.value);
      box.innerHTML = hits.map((p) => `<button type="button" role="option" data-name="${esc(p.name)}">
        <span>${esc(p.name)}</span><span class="muted mono">${esc(p.code || '')}</span></button>`).join('')
        + (inp.value.trim() && !hits.length ? '<p class="muted" style="margin:6px 4px">ไม่พบในรายการสินค้า FlowAccount — จะสร้างเป็นสินค้าใหม่</p>' : '');
      box.hidden = !inp.value.trim();
      refreshNew();
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-name]');
      if (!b) return;
      inp.value = b.dataset.name; box.hidden = true; refreshNew();
      div.querySelector('[name=qty]').focus();
    });
    inp.addEventListener('blur', () => setTimeout(() => { box.hidden = true; refreshNew(); }, 200));
    div.querySelector('.rm').onclick = () => div.remove();
    const lotrows = div.querySelector('.lotrows');
    const total = div.querySelector('.total');
    const recalc = () => {
      const rows = [...lotrows.children];
      rows.forEach((r, i) => { r.querySelector('.lotn').textContent = 'Lot ที่ ' + (i + 1); r.querySelector('.rmLot').hidden = rows.length < 2; });
      const sum = rows.reduce((a, r) => a + (Number(r.querySelector('[name=qty]').value) || 0), 0);
      total.textContent = rows.length > 1 ? `รวม ${num(sum)} · ${rows.length} Lot` : '';
    };
    const addLot = () => {
      const r = document.createElement('div');
      r.className = 'sub-lot'; r.style.flexDirection = 'column'; r.style.alignItems = 'stretch';
      r.innerHTML = `<div class="row"><b class="lotn muted"></b><button type="button" class="btn ghost sm rmLot">ลบ Lot</button></div>
        <div class="grid3"><label class="f">จำนวน<input name="qty" type="number" min="0.01" step="any" required inputmode="decimal"></label>
        <label class="f">ลัง/มัด<input name="bundle" placeholder="ลัง 1"></label>
        <label class="f">Heat No.<input name="heat" placeholder="ถ้ารู้"></label></div>`;
      r.querySelector('.rmLot').onclick = () => { r.remove(); recalc(); };
      r.querySelector('[name=qty]').addEventListener('input', recalc);
      lotrows.appendChild(r); recalc();
    };
    div.querySelector('.addLot').onclick = addLot;
    addLot();
    lines.appendChild(div);
  };
  document.getElementById('addLine').onclick = addLine;
  addLine();

  document.getElementById('poForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const fd = new FormData(e.target);
      const rows = [...lines.querySelectorAll('.line')].map((d) => ({
        name: d.querySelector('[name=product]').value.trim(),
        category: d.querySelector('[name=category]').value,
        code: d.querySelector('[name=code]').value.trim() || null,
        lots: [...d.querySelectorAll('.lotrows > div')].map((r) => ({
          qty: Number(r.querySelector('[name=qty]').value),
          bundle: r.querySelector('[name=bundle]').value.trim() || null,
          heat: r.querySelector('[name=heat]').value.trim() || null,
        })).filter((x) => x.qty > 0),
      })).filter((r) => r.name && r.lots.length);
      if (!rows.length) throw new Error('ใส่สินค้าอย่างน้อย 1 รายการ');
      const po = await q(sb.from('purchase_orders').insert({
        po_no: String(fd.get('po_no')).trim(), supplier: fd.get('supplier'), ordered_at: fd.get('ordered_at'), note: fd.get('note') || null,
      }).select('id').single());
      for (const r of rows) {
        let p = byName.get(r.name);
        if (!p) {
          p = await q(sb.from('products').insert({ name: r.name, category: r.category, code: r.code, unit: CATEGORIES[r.category].unit }).select('id').single());
          byName.set(r.name, p);
        }
        const line = await q(sb.from('po_lines').insert({ po_id: po.id, product_id: p.id, qty_ordered: r.lots.reduce((a, x) => a + x.qty, 0) }).select('id').single());
        await q(sb.from('lots').insert(r.lots.map((x) => ({ product_id: p.id, po_line_id: line.id, qty_received: x.qty, bundle_label: x.bundle, heat_no: x.heat }))));
      }
      productCache = null;
      toast('บันทึก PO และแตก Lot แล้ว');
      location.hash = '#/po/' + po.id;
    } catch (err) { fail(err); btn.disabled = false; }
  };
}

async function viewPO(id) {
  setTabs('po');
  app.innerHTML = head('PO', '', '#/po') + '<p class="loading">กำลังโหลด…</p>';
  try {
    const po = await q(sb.from('purchase_orders').select('*, receipts(*), po_lines(id, qty_ordered, product_id, products(name, unit, category), lots(lot_no, lot_code, qty_received, bundle_label, heat_no, receipt_id))').eq('id', id).single());
    const lotNos = po.po_lines.flatMap((l) => l.lots.map((x) => x.lot_no));
    const certs = lotNos.length ? await q(sb.from('lot_files').select('lot_no').eq('kind', 'cert').in('lot_no', lotNos)) : [];
    const hasCert = new Set(certs.map((c) => c.lot_no));
    const rcById = new Map(po.receipts.map((r) => [r.id, r]));
    const waiting = po.po_lines.flatMap((l) => l.lots.filter((x) => !x.receipt_id).map((x) => ({ ...x, name: l.products.name, unit: l.products.unit }))).sort((a, b) => a.lot_no - b.lot_no);
    const canReceive = ['warehouse', 'admin'].includes(state.profile.role);

    app.innerHTML = head(`<span class="mono">${esc(po.po_no)}</span>`, `${esc(po.supplier)} · สั่ง ${fmtDate(po.ordered_at)}${po.receipts.length ? ' · ' + po.receipts.map((r) => `บิล ${esc(r.supplier_doc_no)} รับ ${fmtDate(r.received_at)}`).join(', ') : ''}`, '#/po') + `
    <div class="wrap">
      ${waiting.length ? (canReceive ? `<form class="card" id="rcForm"><h2>ของมาถึงแล้ว? กดรับของ</h2>
        <p class="muted" style="margin:0">ติ๊ก Lot ที่มาถึงวันนี้ · ถ้าจำนวนจริงไม่ตรง แก้ตัวเลขได้</p>
        <div class="list">${waiting.map((x) => `<label class="row" style="gap:10px;cursor:pointer">
          <input type="checkbox" name="lot" value="${x.lot_no}" checked style="width:22px;min-height:22px;flex:none">
          <span style="flex:1;min-width:0"><span class="lotcode">Lot ${x.lot_code}</span>${x.bundle_label ? ' · ' + esc(x.bundle_label) : ''}<br><span class="muted">${esc(x.name)}</span></span>
          <input name="q${x.lot_no}" type="number" step="any" min="0.01" inputmode="decimal" value="${Number(x.qty_received)}" style="width:90px;flex:none" aria-label="จำนวนที่มาจริง"></label>`).join('')}</div>
        <div class="grid2"><label class="f">เลขบิลผู้ขาย (IV / ST)<input name="doc" required class="mono" placeholder="IV6907623"></label>
        <label class="f">วันที่รับ<input name="d" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
        <button class="btn dark">บันทึกการรับของ</button></form>`
        : `<div class="card"><div class="row"><span>สถานะ</span><span class="chip info">รอของเข้า ${waiting.length} Lot · รอคลังกดรับ</span></div></div>`) : ''}
      ${po.po_lines.map((l) => {
        const planned = l.lots.reduce((s, x) => s + Number(x.qty_received), 0);
        return `<div class="card">
          <div class="row"><h2>${esc(l.products.name)}</h2><span class="muted">${num(planned)}/${num(l.qty_ordered)} ${esc(l.products.unit)}</span></div>
          ${!l.lots.length ? '<p class="err" style="margin:0">ยังไม่แตก Lot</p>' : ''}
          ${l.lots.sort((a, b) => a.lot_no - b.lot_no).map((x) => {
            const rc = rcById.get(x.receipt_id);
            return `<div class="sub-lot">
            <a href="#/lot/${x.lot_code}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:2px;min-width:0">
              <span class="lotcode">Lot ${x.lot_code}${x.bundle_label ? ' · ' + esc(x.bundle_label) : ''} · ${num(x.qty_received)}</span>
              <span>${rc ? `<span class="chip ok">รับแล้ว ${fmtDate(rc.received_at)}</span>` : '<span class="chip info">รอของเข้า</span>'}</span>
              <span class="muted" style="color:${hasCert.has(x.lot_no) ? 'var(--ok)' : 'var(--warn)'}">${hasCert.has(x.lot_no) ? `ใบเซอร์ ✓${x.heat_no ? ' · Heat ' + esc(x.heat_no) : ''}` : 'ยังไม่มีใบเซอร์'}</span></a>
            <div style="display:flex;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end">
              ${isOffice() && !hasCert.has(x.lot_no) ? `<label class="btn primary sm">อัปโหลดเซอร์<input type="file" accept="application/pdf,image/*" hidden data-cert="${x.lot_no}"></label>` : ''}
              ${isOffice() ? `<a class="btn ghost sm" href="#/label/${x.lot_code}">สติกเกอร์</a>` : ''}
              ${isAdmin() ? delBtn('admin_delete_lot', x.lot_no, `ลบ Lot ${x.lot_code} ทั้งหมด? (กู้คืนไม่ได้)`) : isOffice() && !rc ? `<button type="button" class="btn ghost sm" data-del="${x.lot_no}" data-code="${x.lot_code}">ลบ</button>` : ''}
            </div></div>`;
          }).join('')}
          ${isOffice() ? `<details><summary class="btn dash block" style="list-style:none">+ แตกเพิ่มอีก Lot (ใบเซอร์ / ลัง / มัด)</summary>
            <form class="lotForm" data-line="${l.id}" data-product="${l.product_id}" style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
              <div class="grid3"><label class="f">จำนวน<input name="qty" type="number" step="any" min="0.01" required inputmode="decimal" value="${Math.max(0, Number(l.qty_ordered) - planned) || ''}"></label>
              <label class="f">ลัง/มัด<input name="bundle" placeholder="ลัง 1"></label>
              <label class="f">Heat No.<input name="heat" placeholder="จากเซอร์"></label></div>
              <button class="btn dark">สร้าง Lot</button></form></details>` : ''}
        </div>`;
      }).join('')}
      ${delBtn('admin_delete_po', po.id, `ลบ PO ${po.po_no} ทั้งใบ?\n(ทุก Lot ใน PO นี้ รวมประวัติ ใบเซอร์ รูป จะหายทั้งหมด กู้คืนไม่ได้)`, '#/po', 'ลบ PO นี้ทั้งใบ')}
    </div>`;

    const rcf = document.getElementById('rcForm');
    if (rcf) rcf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(rcf);
      const items = fd.getAll('lot').map((n) => ({ lot_no: Number(n), qty: Number(fd.get('q' + n)) }));
      if (!items.length) return toast('ติ๊ก Lot ที่ของมาถึงอย่างน้อย 1 Lot');
      if (items.some((x) => !(x.qty > 0))) return toast('จำนวนต้องมากกว่า 0');
      const btn = rcf.querySelector('button'); btn.disabled = true;
      try {
        await q(sb.rpc('receive_lots', { p_po_id: po.id, p_doc: String(fd.get('doc')).trim(), p_date: fd.get('d'), p_lots: items }));
        toast(`รับของแล้ว ${items.length} Lot · เข้าสต๊อคแล้ว`); viewPO(id);
      } catch (err) { fail(err); btn.disabled = false; }
    };
    app.querySelectorAll('.lotForm').forEach((f) => f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      f.querySelector('button').disabled = true;
      try {
        const lot = await q(sb.from('lots').insert({
          product_id: Number(f.dataset.product), po_line_id: Number(f.dataset.line),
          qty_received: Number(fd.get('qty')), bundle_label: fd.get('bundle') || null, heat_no: fd.get('heat') || null,
        }).select('lot_code').single());
        toast(`สร้าง Lot ${lot.lot_code} แล้ว`);
        viewPO(id);
      } catch (err) { fail(err); f.querySelector('button').disabled = false; }
    });
    app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm(`ลบ Lot ${b.dataset.code} ? (ลบได้เฉพาะ Lot ที่ยังไม่รับของ)`)) return;
      try {
        const gone = await q(sb.from('lots').delete().eq('lot_no', Number(b.dataset.del)).select('lot_no'));
        if (!gone.length) throw new Error('ลบไม่ได้ (รับของแล้ว หรือไม่มีสิทธิ์)');
        toast(`ลบ Lot ${b.dataset.code} แล้ว`); viewPO(id);
      } catch (err) { fail(err); }
    });
    app.querySelectorAll('[data-cert]').forEach((inp) => inp.onchange = async () => {
      if (!inp.files[0]) return;
      toast('กำลังอัปโหลด…', 10000);
      try { await uploadLotFile(Number(inp.dataset.cert), 'cert', inp.files[0]); toast('อัปโหลดใบเซอร์แล้ว'); viewPO(id); } catch (err) { fail(err); }
    });
  } catch (e) { fail(e); }
}

/* ===================== Lot ===================== */
async function viewLot(code) {
  setTabs(null);
  app.innerHTML = head(`Lot ${esc(code)}`, '', '#/', true) + '<p class="loading">กำลังโหลด…</p>';
  try {
    const lot = await q(sb.from('lots').select('*, products(name, category, unit), receipts(supplier_doc_no, received_at, purchase_orders(po_no))').eq('lot_code', code).maybeSingle());
    if (!lot) { app.innerHTML = head(`Lot ${esc(code)}`, '', '#/', true) + '<div class="wrap"><p class="err">ไม่พบ Lot นี้</p></div>'; return; }
    const [bal, files, meas, moves] = await Promise.all([
      q(sb.from('lot_balance').select('*').eq('lot_no', lot.lot_no).single()),
      q(sb.from('lot_files').select('*').eq('lot_no', lot.lot_no).order('id')),
      q(sb.from('lot_measurements').select('*').eq('lot_no', lot.lot_no).order('id')),
      q(sb.from('stock_moves').select('*').eq('lot_no', lot.lot_no).order('id', { ascending: false })),
    ]);
    const sold = -moves.filter((m) => m.kind === 'sale').reduce((s, m) => s + Number(m.qty), 0);
    const cat = CATEGORIES[lot.products.category] || CATEGORIES.other;
    const certs = files.filter((f) => f.kind === 'cert');
    const photos = files.filter((f) => f.kind === 'photo');
    const photoUrls = await Promise.all(photos.map((p) => signedUrl(p.storage_path)));
    const rc = lot.receipts;
    const KIND_TH = { receive: 'รับเข้า', sale: 'ขายออก', return: 'รับคืน', adjust: 'ปรับยอด', process_out: 'ส่ง process', process_in: 'รับคืน process' };

    app.innerHTML = `
    <header class="head dark" style="flex-direction:column;align-items:stretch;gap:10px">
      <div class="row" style="justify-content:flex-start"><a class="back" href="#/" aria-label="กลับ">${ICON.back}</a>
        <div><div class="mono" style="font-size:24px;font-weight:600">Lot ${esc(lot.lot_code)}</div>
        <div class="sub">${esc(lot.products.name)}${lot.bundle_label ? ' · ' + esc(lot.bundle_label) : ''}</div></div></div>
      <div class="stats"><div class="stat"><small>${lot.receipt_id ? 'รับเข้า' : 'สั่ง (รอของเข้า)'}</small><b>${num(lot.qty_received)}</b></div>
        <div class="stat"><small>ขายออก</small><b>${num(sold)}</b></div>
        <div class="stat"><small>คงเหลือ</small><b style="color:#FDBA74">${num(bal.qty_on_hand)}</b></div></div>
    </header>
    <div class="wrap">
      <div class="muted">${rc?.purchase_orders?.po_no ? esc(rc.purchase_orders.po_no) + ' · ' : ''}${rc ? 'บิล ' + esc(rc.supplier_doc_no) + ' · รับ ' + fmtDate(rc.received_at) : ''}${lot.heat_no ? ' · Heat ' + esc(lot.heat_no) : ''}${Number(bal.qty_on_process) ? ` · <b>On Process ${num(bal.qty_on_process)}</b>` : ''}</div>

      <div class="card"><div class="row"><h2>ใบเซอร์</h2>${isOffice() ? `<label class="btn ghost sm">+ อัปโหลด<input type="file" accept="application/pdf,image/*" hidden id="certIn"></label>` : ''}</div>
        ${certs.length ? certs.map((c) => `<div class="row"><span>${esc(c.file_name || 'ใบเซอร์')}</span><span style="display:flex;gap:6px"><button class="btn ghost sm" data-open="${esc(c.storage_path)}">เปิด / ดาวน์โหลด</button>${delBtn('admin_delete_file', c.id, 'ลบไฟล์ใบเซอร์ ' + (c.file_name || '') + ' ?')}</span></div>`).join('') : '<p class="empty" style="padding:4px 0">ยังไม่มีใบเซอร์</p>'}
      </div>

      <div class="card"><div class="row"><h2>รูปวัดขนาด</h2><span class="muted">${photos.length} รูป</span></div>
        <div class="photos">${photoUrls.map((u, i) => `<div class="ph"><a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="รูปวัด Lot ${esc(lot.lot_code)}" loading="lazy"></a>${delBtn('admin_delete_file', photos[i].id, 'ลบรูปนี้?', '', '×')}</div>`).join('')}
          <label class="add" aria-label="ถ่ายรูปเพิ่ม">+<input type="file" accept="image/*" capture="environment" hidden id="photoIn" multiple></label></div>
        <form id="measForm" style="display:flex;flex-direction:column;gap:8px">
          <div class="grid3">${cat.measures.map((m) => `<label class="f">${m} (มม.)<input name="${esc(m)}" inputmode="decimal" type="number" step="any" class="mono"></label>`).join('')}</div>
          <button class="btn dark sm">บันทึกค่าวัด</button></form>
        ${meas.length ? `<div class="list">${meas.map((m) => `<div class="row"><span>${esc(m.measure)}</span><span class="mono">${num(m.value)} ${esc(m.unit)} <span class="muted">${fmtDate(m.created_at)}</span> ${delBtn('admin_delete_measurement', m.id, 'ลบค่าวัด ' + m.measure + ' ?', '', '×')}</span></div>`).join('')}</div>` : ''}
      </div>

      ${!lot.receipt_id ? '<div class="card"><div class="row"><span>สถานะ</span><span class="chip info">รอของเข้า · ยังตัดสต๊อคไม่ได้</span></div><p class="muted" style="margin:0">คลังกดรับของที่หน้า PO เมื่อของมาถึง</p></div>' : ''}
      <div class="card" ${lot.receipt_id ? '' : 'hidden'}><h2>ตัดสต๊อคจาก Lot นี้</h2>
        <form id="cutForm" style="display:flex;flex-direction:column;gap:8px">
          <label class="f">จำนวน<input name="qty" type="number" min="0.01" step="any" required inputmode="decimal" class="big"></label>
          <div class="grid2"><label class="f">เลขบิล (INV / NO)<input name="doc" class="mono" placeholder="ไม่รู้ เว้นว่างได้"></label>
          <label class="f">ลูกค้า<input name="cust" placeholder="ไม่รู้ เว้นว่างได้"></label></div>
          <label class="f">หมายเหตุ (ใครสั่ง / รายละเอียด)<input name="note" placeholder="เช่น เซลล์ม่อนสั่ง ลูกค้าหน้าร้าน"></label>
          <p class="muted" style="margin:0">ยังไม่รู้เลขบิลหรือลูกค้า ตัดไปก่อนได้ ระบบจะขึ้นใน "งานค้าง" ให้ออฟฟิศเติมทีหลัง</p>
          <button class="btn primary">ยืนยันตัดสต๊อค</button></form></div>

      <div class="card"><h2>ประวัติ</h2><div class="list">${moves.map((m) => `<div class="row"><div><div>${KIND_TH[m.kind] || m.kind} ${m.doc_no ? `<span class="mono" style="color:var(--link)">${esc(m.doc_no)}</span>` : (m.kind === 'sale' ? '<span class="chip bad">รอเลขบิล</span>' : '')}</div><div class="muted">${esc(m.customer || '')} ${esc(m.note || '')} ${fmtDate(m.created_at)}</div></div><span style="display:flex;gap:8px;align-items:center"><b class="mono">${Number(m.qty) > 0 ? '+' : ''}${num(m.qty)}</b>${['sale', 'return', 'adjust'].includes(m.kind) ? delBtn('admin_delete_move', m.id, `ลบรายการ${KIND_TH[m.kind]} ${num(m.qty)} ${m.doc_no || ''} ?`, '', '×') : ''}</span></div>`).join('')}</div></div>

      ${isOffice() ? `<div class="grid2"><a class="btn ghost" href="#/label/${esc(lot.lot_code)}">พิมพ์สติกเกอร์</a><a class="btn ghost" href="#/process/new?lot=${esc(lot.lot_code)}">ส่งตัด / ขัด</a></div>` : ''}
      ${delBtn('admin_delete_lot', lot.lot_no, `ลบ Lot ${lot.lot_code} ทั้งหมด?\n(ประวัติตัดสต๊อค ใบเซอร์ รูป ค่าวัด และงาน process ของ Lot นี้จะหายทั้งหมด กู้คืนไม่ได้)`, '#/', 'ลบ Lot นี้ทั้งหมด')}
    </div>`;

    app.querySelectorAll('[data-open]').forEach((b) => b.onclick = async () => { const u = await signedUrl(b.dataset.open, 600); if (u) window.open(u, '_blank', 'noopener'); });
    const certIn = document.getElementById('certIn');
    if (certIn) certIn.onchange = async () => { if (!certIn.files[0]) return; toast('กำลังอัปโหลด…', 10000); try { await uploadLotFile(lot.lot_no, 'cert', certIn.files[0]); toast('อัปโหลดแล้ว'); viewLot(code); } catch (e) { fail(e); } };
    const photoIn = document.getElementById('photoIn');
    photoIn.onchange = async () => {
      if (!photoIn.files.length) return;
      toast('กำลังย่อและอัปโหลดรูป…', 20000);
      try { for (const f of photoIn.files) await uploadLotFile(lot.lot_no, 'photo', f); toast('อัปโหลดรูปแล้ว'); viewLot(code); } catch (e) { fail(e); }
    };
    document.getElementById('measForm').onsubmit = async (e) => {
      e.preventDefault();
      const rows = [...new FormData(e.target).entries()].filter(([, v]) => v !== '').map(([measure, value]) => ({ lot_no: lot.lot_no, measure, value: Number(value) }));
      if (!rows.length) return toast('ยังไม่ได้กรอกค่าวัด');
      try { await q(sb.from('lot_measurements').insert(rows)); toast('บันทึกค่าวัดแล้ว'); viewLot(code); } catch (err) { fail(err); }
    };
    document.getElementById('cutForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const qty = Number(fd.get('qty'));
      if (qty > Number(bal.qty_on_hand)) return toast(`Lot นี้เหลือ ${num(bal.qty_on_hand)} ตัด ${num(qty)} ไม่ได้ กรุณานับใหม่`, 5000);
      const doc = String(fd.get('doc') || '').trim().toUpperCase() || null;
      if (!confirm(`ตัด ${num(qty)} ${lot.products.unit} จาก Lot ${lot.lot_code}\n${doc ? 'บิล ' + doc : '(ยังไม่มีเลขบิล — จะขึ้นในงานค้าง)'}`)) return;
      try {
        await q(sb.from('stock_moves').insert({ lot_no: lot.lot_no, kind: 'sale', qty: -qty, doc_no: doc, customer: String(fd.get('cust') || '').trim() || null, note: String(fd.get('note') || '').trim() || null }));
        toast(doc ? 'ตัดสต๊อคแล้ว' : 'ตัดสต๊อคแล้ว · รอเติมเลขบิล'); viewLot(code);
      } catch (err) { fail(err); }
    };
  } catch (e) { fail(e); }
}

/* ===================== สติกเกอร์ ===================== */
// รองรับหลาย Lot ในครั้งเดียว: #/label/00001,00002
async function viewLabel(codeParam) {
  setTabs(null);
  const codes = codeParam.split(',').map((c) => lotCode(c.trim())).filter(Boolean);
  try {
    const lots = await q(sb.from('lots').select('lot_no, lot_code, qty_received, bundle_label, label_printed_at, products(name, unit), receipts(received_at)').in('lot_code', codes).order('lot_no'));
    if (!lots.length) { app.innerHTML = head('สติกเกอร์', '', '#/') + '<div class="wrap"><p class="err">ไม่พบ Lot</p></div>'; return; }
    const qrs = await Promise.all(lots.map((l) => QRCode.toDataURL(`${baseUrl()}#/lot/${l.lot_code}`, { margin: 0, width: 300, errorCorrectionLevel: 'M' })));
    const back = lots.length === 1 ? '#/lot/' + lots[0].lot_code : '#/labels';
    app.innerHTML = `<div class="noprint">${head(lots.length === 1 ? 'สติกเกอร์ Lot ' + esc(lots[0].lot_code) : `สติกเกอร์ ${lots.length} Lot`, 'ขนาด 75×50 มม.', back)}</div>
    <div class="label-sheet">
      ${lots.map((lot, i) => `<div class="noprint row" style="width:100%;max-width:420px">
          <span class="lotcode">Lot ${esc(lot.lot_code)}</span>
          ${lot.label_printed_at ? `<span class="chip ok">พิมพ์แล้ว ${fmtDate(lot.label_printed_at)}</span>` : '<span class="chip warn">ยังไม่พิมพ์</span>'}
          <label class="f" style="width:96px">จำนวนดวง<input type="number" min="1" max="50" value="1" data-copies="${i}"></label></div>
        <div class="label" data-label="${i}">
          <div class="top"><span>STK METAL</span><span>LOT</span></div>
          <div class="mid"><div style="flex:1;min-width:0"><div class="code">${esc(lot.lot_code)}</div><div class="name">${esc(lot.products.name)}</div></div>
            <img class="qr" src="${qrs[i]}" alt="QR Lot ${esc(lot.lot_code)}"></div>
          <div class="bot"><span>${lot.receipts ? 'รับ ' + fmtDate(lot.receipts.received_at) : ''}</span><span>${esc(lot.bundle_label || '')}</span><span>${num(lot.qty_received)} ${esc(lot.products.unit)}</span></div>
        </div>`).join('')}
      <button class="btn primary block noprint" style="max-width:420px" id="printBtn">พิมพ์${lots.length > 1 ? 'ทั้งหมด' : ''}</button>
      <p class="muted noprint" style="max-width:420px">ตั้งค่าเครื่องพิมพ์เป็นกระดาษ 75×50 มม. ขอบ 0 · พิมพ์เสร็จแล้วระบบจะถามเพื่อเอาออกจากงานค้าง</p>
    </div>`;
    document.getElementById('printBtn').onclick = async () => {
      const sheet = app.querySelector('.label-sheet');
      sheet.querySelectorAll('.label.copy').forEach((c) => c.remove());
      lots.forEach((_, i) => {
        const n = Math.min(50, Math.max(1, Number(sheet.querySelector(`[data-copies="${i}"]`).value) || 1));
        const one = sheet.querySelector(`[data-label="${i}"]`);
        for (let k = 1; k < n; k++) { const c = one.cloneNode(true); c.classList.add('copy'); c.removeAttribute('data-label'); one.after(c); }
      });
      window.print();
      const pending = lots.filter((l) => !l.label_printed_at);
      if (pending.length && confirm('พิมพ์สติกเกอร์ออกมาเรียบร้อยแล้ว?\nกด OK เพื่อเอาออกจากงานค้าง "รอพิมพ์สติกเกอร์"')) {
        try {
          await q(sb.from('lots').update({ label_printed_at: new Date().toISOString(), label_printed_by: state.session.user.id }).in('lot_no', pending.map((l) => l.lot_no)));
          toast('บันทึกว่าพิมพ์แล้ว');
          location.hash = lots.length === 1 ? '#/lot/' + lots[0].lot_code : '#/labels';
        } catch (e) { fail(e); }
      }
    };
  } catch (e) { fail(e); }
}

/* ===================== งานค้าง: รอพิมพ์สติกเกอร์ ===================== */
async function viewLabels() {
  setTabs('home');
  app.innerHTML = head('รอพิมพ์สติกเกอร์', 'ออฟฟิศพิมพ์แล้วส่งให้คลังติด', '#/') + '<p class="loading">กำลังโหลด…</p>';
  try {
    const lots = await q(sb.from('lots').select('lot_code, qty_received, bundle_label, created_at, products(name, unit)').is('label_printed_at', null).order('lot_no'));
    app.innerHTML = head('รอพิมพ์สติกเกอร์', `${lots.length} Lot · ออฟฟิศพิมพ์แล้วส่งให้คลังติด`, '#/') + `
    <form class="wrap" id="lf">
      ${lots.length ? `<div class="card"><label class="row" style="justify-content:flex-start;gap:10px"><input type="checkbox" id="all" checked style="width:22px;min-height:22px"> <b>เลือกทั้งหมด</b></label>
        <div class="list">${lots.map((l) => `<label class="row" style="justify-content:flex-start;gap:12px">
          <input type="checkbox" name="c" value="${l.lot_code}" checked style="width:22px;min-height:22px;flex:none">
          <span style="display:flex;flex-direction:column;min-width:0"><span class="lotcode">Lot ${l.lot_code}${l.bundle_label ? ' · ' + esc(l.bundle_label) : ''}</span>
          <span>${esc(l.products.name)} · ${num(l.qty_received)} ${esc(l.products.unit)}</span><span class="muted">สร้าง ${fmtDate(l.created_at)}</span></span></label>`).join('')}</div></div>
        ${isOffice() ? '<button class="btn primary block">พิมพ์ที่เลือก</button>' : '<p class="muted">การพิมพ์สติกเกอร์เป็นหน้าที่ออฟฟิศ</p>'}`
      : '<div class="card"><p class="empty">พิมพ์ครบทุก Lot แล้ว 🎉</p></div>'}
    </form>`;
    const all = document.getElementById('all');
    if (all) all.onchange = () => app.querySelectorAll('[name=c]').forEach((c) => { c.checked = all.checked; });
    document.getElementById('lf').onsubmit = (e) => {
      e.preventDefault();
      const codes = [...app.querySelectorAll('[name=c]:checked')].map((c) => c.value);
      if (!codes.length) return toast('ยังไม่ได้เลือก Lot');
      location.hash = '#/label/' + codes.join(',');
    };
  } catch (e) { fail(e); }
}

/* ===================== ค้นหา ===================== */
async function viewSearch(params) {
  setTabs('search');
  const qv = params.get('q') || '';
  app.innerHTML = head('ค้นหา', 'เลข Lot · เลขบิล INV/NO · ชื่อสินค้า', '#/') + `
  <div class="wrap">
    <form id="sf" class="row" style="gap:8px"><input name="q" value="${esc(qv)}" placeholder="เช่น 00003 หรือ INV2026080173" autofocus><button class="btn dark" aria-label="ค้นหา">${ICON.search}</button></form>
    <button type="button" class="btn primary block scanBtn">${ICON.scan} สแกน QR บนสติกเกอร์</button>
    <div id="res"></div>
  </div>`;
  document.getElementById('sf').onsubmit = (e) => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent(new FormData(e.target).get('q')); };
  if (!qv.trim()) return;
  const res = document.getElementById('res');
  const s = qv.trim();
  try {
    if (/^\d{1,5}$/.test(s)) { location.hash = '#/lot/' + lotCode(s); return; }
    const [byDoc, byName] = await Promise.all([
      q(sb.from('stock_moves').select('doc_no, customer, qty, created_at, lot_no, lots(lot_code, products(name))').ilike('doc_no', `%${s}%`).neq('kind', 'receive').order('id', { ascending: false }).limit(50)),
      q(sb.from('lot_balance').select('*').ilike('product_name', `%${s}%`).gt('qty_on_hand', 0).order('lot_no').limit(50)),
    ]);
    const lotNos = [...new Set(byDoc.map((m) => m.lot_no))];
    const certs = lotNos.length ? await q(sb.from('lot_files').select('lot_no, storage_path, file_name').eq('kind', 'cert').in('lot_no', lotNos)) : [];
    res.innerHTML = `
      ${byDoc.length ? `<div class="card"><h2>บิลที่ตรงกัน</h2><div class="list">${byDoc.map((m) => {
        const c = certs.filter((x) => x.lot_no === m.lot_no);
        return `<div style="display:flex;flex-direction:column;gap:6px">
          <div class="row"><span class="mono" style="color:var(--link)">${esc(m.doc_no)}</span><span class="muted">${fmtDate(m.created_at)}</span></div>
          <div>${esc(m.lots.products.name)} × ${num(-m.qty)}</div>
          <div class="row"><a class="lotcode" href="#/lot/${m.lots.lot_code}">Lot ${m.lots.lot_code}</a>
          ${c.length ? c.map((x) => `<button class="btn primary sm" data-open="${esc(x.storage_path)}">ใบเซอร์</button>`).join('') : '<span class="chip warn">ยังไม่มีเซอร์</span>'}</div></div>`;
      }).join('')}</div></div>` : ''}
      ${byName.length ? `<div class="card"><h2>Lot ที่มีของ</h2><div class="list">${byName.map(lotItem).join('')}</div></div>` : ''}
      ${!byDoc.length && !byName.length ? '<p class="empty">ไม่พบผลลัพธ์</p>' : ''}`;
    res.querySelectorAll('[data-open]').forEach((b) => b.onclick = async () => { const u = await signedUrl(b.dataset.open, 600); if (u) window.open(u, '_blank', 'noopener'); });
  } catch (e) { fail(e); }
}

/* ===================== งานค้าง: ตัดสต๊อครอเลขบิล ===================== */
async function viewPending() {
  setTabs('home');
  app.innerHTML = head('ตัดสต๊อครอเลขบิล', 'คลังตัดไปก่อน · ออฟฟิศเติมเลขบิลและชื่อลูกค้า', '#/') + '<p class="loading">กำลังโหลด…</p>';
  try {
    const rows = await q(sb.from('stock_moves')
      .select('id, qty, customer, note, created_at, created_by, lots(lot_code, products(name, unit))')
      .eq('kind', 'sale').is('doc_no', null).order('id'));
    const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
    const people = ids.length ? await q(sb.from('profiles').select('id, full_name').in('id', ids)) : [];
    const who = new Map(people.map((p) => [p.id, p.full_name]));
    app.innerHTML = head('ตัดสต๊อครอเลขบิล', `${rows.length} รายการ · ออฟฟิศเติมเลขบิลและชื่อลูกค้า`, '#/') + `
    <div class="wrap">
      ${rows.length ? rows.map((r) => `<form class="card fillForm" data-id="${r.id}">
        <div class="row"><a class="lotcode" href="#/lot/${r.lots.lot_code}">Lot ${r.lots.lot_code}</a><span class="muted">${fmtDate(r.created_at)}</span></div>
        <div><b>${esc(r.lots.products.name)}</b> × ${num(-r.qty)} ${esc(r.lots.products.unit)}</div>
        <div class="muted">ตัดโดย ${esc(who.get(r.created_by) || '-')}${r.note ? ' · ' + esc(r.note) : ''}</div>
        ${isOffice() ? `<div class="grid2"><label class="f">เลขบิล (INV / NO)<input name="doc" required class="mono" placeholder="INV2026100001"></label>
          <label class="f">ลูกค้า<input name="cust" value="${esc(r.customer || '')}"></label></div>
          <button class="btn dark">บันทึก</button>` : '<span class="chip warn">รอออฟฟิศเติมเลขบิล</span>'}
      </form>`).join('') : '<div class="card"><p class="empty">ไม่มีรายการค้าง 🎉</p></div>'}
    </div>`;
    app.querySelectorAll('.fillForm').forEach((f) => f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      f.querySelector('button').disabled = true;
      try {
        await q(sb.from('stock_moves').update({
          doc_no: String(fd.get('doc')).trim().toUpperCase(),
          customer: String(fd.get('cust') || '').trim() || null,
        }).eq('id', Number(f.dataset.id)));
        toast('บันทึกแล้ว');
        viewPending();
      } catch (err) { fail(err); f.querySelector('button').disabled = false; }
    });
  } catch (e) { fail(e); }
}

/* ===================== รายการ Lot ตามเงื่อนไข (รอเซอร์ / รอรูปวัด) ===================== */
async function viewLots(params) {
  setTabs('home');
  const f = params.get('f');
  const title = f === 'nocert' ? 'Lot รอใบเซอร์' : f === 'nophoto' ? 'Lot รอรูปวัดขนาด' : 'Lot ทั้งหมด';
  const sub = f === 'nocert' ? 'ออฟฟิศอัปโหลดใบเซอร์' : f === 'nophoto' ? 'คลังถ่ายรูปวัด + กรอกค่าวัด' : 'Lot ที่ยังมีของ';
  app.innerHTML = head(title, sub, '#/') + '<p class="loading">กำลังโหลด…</p>';
  try {
    let qb = sb.from('lot_balance').select('*').gt('qty_on_hand', 0).order('lot_no');
    if (f === 'nocert') qb = qb.eq('has_cert', false);
    if (f === 'nophoto') qb = qb.eq('has_photo', false);
    const lots = await q(qb.limit(500));
    app.innerHTML = head(title, `${lots.length} Lot · ${sub}`, '#/') + `<div class="wrap"><div class="card"><div class="list">
      ${lots.length ? lots.map(lotItem).join('') : '<p class="empty">ไม่มีรายการค้าง 🎉</p>'}</div></div></div>`;
  } catch (e) { fail(e); }
}

/* ===================== On Process (ส่งตัด / เจาะ / ขัด) ===================== */
const TASKS = ['ตัด', 'เจาะรู', 'ขัด HL', 'ขัด NO.8', 'พับ', 'อื่นๆ'];
async function viewProcess(params) {
  setTabs('home');
  const f = params.get('f') || 'open';
  const today = new Date().toISOString().slice(0, 10);
  const tabs = [['open', 'กำลังทำ'], ['overdue', 'เลยกำหนด'], ['returned', 'รับคืนแล้ว']];
  app.innerHTML = head('On Process', 'งานส่งตัด / เจาะ / ขัด', '#/') + `
  <div class="wrap">
    ${isOffice() ? '<a class="btn primary block" href="#/process/new">+ ส่งงานใหม่</a>' : ''}
    <div class="row" style="gap:6px;justify-content:flex-start">${tabs.map(([k, l]) => `<a class="btn sm ${k === f ? 'dark' : 'ghost'}" href="#/process?f=${k}">${l}</a>`).join('')}</div>
    <div id="jobs"><p class="loading">กำลังโหลด…</p></div>
  </div>`;
  try {
    let qb = sb.from('process_jobs').select('*, lots(lot_code, products(name, unit))').order('due_date', { ascending: true, nullsFirst: false });
    if (f === 'returned') qb = qb.eq('status', 'returned').order('returned_at', { ascending: false });
    else qb = qb.eq('status', 'sent');
    if (f === 'overdue') qb = qb.lt('due_date', today);
    const jobs = await q(qb.limit(200));
    const box = document.getElementById('jobs');
    box.innerHTML = jobs.length ? jobs.map((j) => {
      const late = j.status === 'sent' && j.due_date && j.due_date < today;
      const days = late ? Math.round((new Date(today) - new Date(j.due_date)) / 86400000) : 0;
      const chip = j.status === 'returned' ? `<span class="chip ok">รับคืน ${fmtDate(j.returned_at)}</span>`
        : late ? `<span class="chip bad">เลยกำหนด ${days} วัน</span>` : `<span class="chip info">กำลังทำ</span>`;
      return `<div class="card" style="${late ? 'outline:2px solid #FCA5A5' : ''}">
        <div class="row">${chip}<span class="muted">ส่ง ${fmtDate(j.sent_at)}</span></div>
        <div><b>${esc(j.tasks.join(' + '))}</b> · ${esc(j.lots.products.name)} × ${num(j.qty)} ${esc(j.lots.products.unit)}</div>
        <div class="muted">ส่งไป ${esc(j.vendor || '-')} · กำหนดรับ ${j.due_date ? fmtDate(j.due_date) : '-'}</div>
        <div class="muted">${j.ref_doc ? 'ของลูกค้า ' + esc(j.ref_doc) : 'เติมสต๊อค'} · <a class="lotcode" href="#/lot/${j.lots.lot_code}">Lot ${j.lots.lot_code}</a>${j.detail ? ' · ' + esc(j.detail) : ''}</div>
        ${j.status === 'sent' && isOffice() ? `<div class="grid2">
          <button class="btn ghost sm" data-due="${j.id}">เลื่อนวันกำหนด</button>
          <button class="btn dark sm" data-ret="${j.id}">รับคืนแล้ว</button></div>` : ''}
        ${isAdmin() ? `<div style="display:flex;justify-content:flex-end">${delBtn('admin_delete_process_job', j.id, 'ลบงาน ' + j.tasks.join(' + ') + ' Lot ' + j.lots.lot_code + ' ? (ยอด On Process จะถูกยกเลิกด้วย)')}</div>` : ''}
      </div>`;
    }).join('') : '<div class="card"><p class="empty">ไม่มีรายการ</p></div>';
    box.querySelectorAll('[data-ret]').forEach((b) => b.onclick = async () => {
      const j = jobs.find((x) => x.id === Number(b.dataset.ret));
      if (!confirm(`รับคืน ${j.tasks.join(' + ')} Lot ${j.lots.lot_code} × ${num(j.qty)} ?`)) return;
      b.disabled = true;
      try {
        await q(sb.from('stock_moves').insert({ lot_no: j.lot_no, kind: 'process_in', qty: Number(j.qty), doc_no: j.ref_doc, note: 'รับคืนจาก ' + (j.vendor || 'process') }));
        await q(sb.from('process_jobs').update({ status: 'returned', returned_at: new Date().toISOString() }).eq('id', j.id));
        toast('บันทึกรับคืนแล้ว'); viewProcess(params);
      } catch (e) { fail(e); b.disabled = false; }
    });
    box.querySelectorAll('[data-due]').forEach((b) => b.onclick = async () => {
      const d = prompt('กำหนดรับคืนใหม่ (ปี-เดือน-วัน เช่น 2026-10-20)', today);
      if (!d) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return toast('รูปแบบวันที่ไม่ถูกต้อง');
      try { await q(sb.from('process_jobs').update({ due_date: d }).eq('id', Number(b.dataset.due))); toast('เลื่อนวันแล้ว'); viewProcess(params); } catch (e) { fail(e); }
    });
  } catch (e) { fail(e); }
}

async function viewProcessNew(params) {
  setTabs('home');
  if (!isOffice()) { app.innerHTML = head('ส่งงาน', '', '#/process') + '<div class="wrap"><p class="err">การส่งงาน process เป็นหน้าที่ออฟฟิศ</p></div>'; return; }
  app.innerHTML = head('ส่งงานตัด / เจาะ / ขัด', 'ของจะย้ายไป On Process ไม่หายจากสต๊อค', '#/process') + `
  <form class="wrap" id="pf">
    <div class="card">
      <div class="grid2"><label class="f">เลข Lot<input name="lot" required class="big" inputmode="numeric" value="${esc(params.get('lot') || '')}"></label>
      <label class="f">จำนวน<input name="qty" required type="number" min="0.01" step="any" class="big" inputmode="decimal"></label></div>
      <p class="muted" id="lotInfo" style="margin:0"></p>
      <div class="f" style="font-size:13px;color:var(--muted)">งานที่ส่ง (เลือกได้หลายอย่าง)</div>
      <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px">${TASKS.map((t) =>
        `<label class="btn ghost sm" style="gap:6px"><input type="checkbox" name="t" value="${t}" style="width:18px;min-height:18px"> ${t}</label>`).join('')}</div>
      <label class="f">รายละเอียดงาน<textarea name="detail" rows="2" placeholder="เช่น ตัด 600 มม. × 4 ชิ้น / เจาะรู 3 มม."></textarea></label>
    </div>
    <div class="card">
      <label class="f">ส่งไปที่<input name="vendor" required placeholder="ชื่อร้าน / สาขาใหญ่"></label>
      <div class="grid2"><label class="f">กำหนดรับคืน<input name="due" type="date" required></label>
      <label class="f">ของลูกค้า (บิล/QT)<input name="ref" class="mono" placeholder="ว่าง = เติมสต๊อค"></label></div>
    </div>
    <button class="btn primary block">บันทึกส่งงาน</button>
  </form>`;
  const form = document.getElementById('pf');
  const info = document.getElementById('lotInfo');
  let lot = null;
  const lookup = async () => {
    const v = form.lot.value.trim(); lot = null; info.textContent = '';
    if (!/^\d{1,5}$/.test(v)) return;
    const r = await q(sb.from('lot_balance').select('*').eq('lot_code', lotCode(v)).maybeSingle()).catch(() => null);
    if (!r) { info.textContent = 'ไม่พบ Lot นี้'; return; }
    lot = r; info.textContent = `${r.product_name} · คงเหลือ ${num(r.qty_on_hand)}`;
  };
  form.lot.addEventListener('change', lookup);
  lookup();
  form.onsubmit = async (e) => {
    e.preventDefault();
    await lookup();
    if (!lot) return toast('กรุณาใส่เลข Lot ให้ถูกต้อง');
    const fd = new FormData(form);
    const tasks = fd.getAll('t');
    const qty = Number(fd.get('qty'));
    if (!tasks.length) return toast('เลือกงานอย่างน้อย 1 อย่าง');
    if (qty > Number(lot.qty_on_hand)) return toast(`Lot นี้เหลือ ${num(lot.qty_on_hand)}`);
    form.querySelector('button.primary').disabled = true;
    try {
      const ref = String(fd.get('ref') || '').trim().toUpperCase() || null;
      await q(sb.from('stock_moves').insert({ lot_no: lot.lot_no, kind: 'process_out', qty: -qty, doc_no: ref, note: tasks.join(' + ') + ' → ' + fd.get('vendor') }));
      await q(sb.from('process_jobs').insert({ lot_no: lot.lot_no, qty, tasks, detail: fd.get('detail') || null, vendor: fd.get('vendor'), due_date: fd.get('due'), ref_doc: ref }));
      toast('บันทึกส่งงานแล้ว'); location.hash = '#/process';
    } catch (err) { fail(err); form.querySelector('button.primary').disabled = false; }
  };
}

/* ===================== บัญชี ===================== */
function viewMe() {
  setTabs('me');
  app.innerHTML = head('บัญชีของฉัน', '', '#/') + `
  <div class="wrap"><div class="card">
    <div class="row"><span>ชื่อ</span><b>${esc(state.profile.full_name)}</b></div>
    <div class="row"><span>บทบาท</span><b>${ROLE_TH[state.profile.role]}</b></div>
    <div class="row"><span>ภาษา</span>${langToggleHtml()}</div>
    <div class="row"><span>ชื่อผู้ใช้</span><span class="mono">${esc(state.session.user.email.replace('@' + EMAIL_DOMAIN, ''))}</span></div>
  </div>${installCardHtml()}<button class="btn ghost block" id="lo">ออกจากระบบ</button></div>`;
  document.getElementById('lo').onclick = () => sb.auth.signOut();
}

/* ===================== ลบข้อมูล (แอดมินเท่านั้น) ===================== */
const DEL_ARG = { admin_delete_lot: 'p_lot', admin_delete_po: 'p_po' };
async function adminDelete(b) {
  if (!isAdmin() || !confirm(b.dataset.msg)) return;
  b.disabled = true;
  try {
    const fn = b.dataset.adel;
    const r = await q(sb.rpc(fn, { [DEL_ARG[fn] || 'p_id']: Number(b.dataset.id) }));
    const paths = (Array.isArray(r) ? r : [r]).filter((x) => typeof x === 'string' && x);
    if (paths.length) await sb.storage.from('lot-files').remove(paths).catch(() => {});
    toast('ลบแล้ว');
    const go = b.dataset.go;
    if (go && location.hash !== go) location.hash = go; else route();
  } catch (err) { fail(err); b.disabled = false; }
}

/* ===================== router ===================== */
async function route() {
  if (!state.session) return viewLogin();
  if (!state.profile) return viewNoRole();
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  window.scrollTo(0, 0);
  if (!parts.length) return viewHome();
  if (parts[0] === 'po' && !parts[1]) return viewPOList(params);
  if (parts[0] === 'po' && parts[1] === 'new') return viewPONew();
  if (parts[0] === 'po') return viewPO(Number(parts[1]));
  if (parts[0] === 'lot' && parts[1]) return viewLot(lotCode(parts[1]));
  if (parts[0] === 'label' && parts[1]) return viewLabel(parts[1]);
  if (parts[0] === 'labels') return viewLabels();
  if (parts[0] === 'search') return viewSearch(params);
  if (parts[0] === 'me') return viewMe();
  if (parts[0] === 'pending') return viewPending();
  if (parts[0] === 'lots') return viewLots(params);
  if (parts[0] === 'process' && parts[1] === 'new') return viewProcessNew(params);
  if (parts[0] === 'process') return viewProcess(params);
  return viewHome();
}

window.addEventListener('hashchange', route);
document.addEventListener('click', (e) => {
  if (e.target.closest('.scanBtn')) openScanner();
  if (e.target.closest('.langBtn')) setLang(getLang() === 'my' ? 'th' : 'my');
  const ad = e.target.closest('[data-adel]');
  if (ad) { e.preventDefault(); adminDelete(ad); }
  if (e.target.closest('.installBtn') && installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; route(); }); }
});
// เรียก Supabase ต่อจาก callback ด้วย setTimeout เพื่อไม่ให้ค้าง (ข้อแนะนำของ supabase-js)
sb.auth.onAuthStateChange((_evt, session) => {
  const changed = (session?.user?.id || null) !== (state.session?.user?.id || null);
  state.session = session;
  if (changed) setTimeout(async () => { await loadProfile(); route(); }, 0);
});
const { data: { session } } = await sb.auth.getSession();
if (!state.session) {
  state.session = session;
  await loadProfile();
  route();
}
