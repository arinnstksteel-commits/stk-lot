import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, EMAIL_DOMAIN, SUPPLIERS, CATEGORIES } from './config.js';

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
const ROLE_TH = { admin: 'แอดมิน', office: 'ออฟฟิศ', warehouse: 'คลัง' };
const baseUrl = () => location.href.split('#')[0];

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9H3z"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
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
    <div><div class="brand">STK Metal · สาขาเล็ก</div><h1>Lot &amp; ใบเซอร์</h1></div>
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

/* ===================== หน้าแรก ===================== */
async function viewHome() {
  setTabs('home');
  app.innerHTML = `
  <header class="head dark" style="flex-direction:column;align-items:stretch;gap:14px;padding:22px 16px 18px">
    <div class="row"><div><div class="sub">STK Metal · ${esc(state.profile.full_name)} (${ROLE_TH[state.profile.role]})</div><h1 style="font-size:22px">Lot &amp; ใบเซอร์</h1></div></div>
    <form id="qs" class="row" style="gap:8px"><input name="q" placeholder="เลข Lot / INV / ชื่อสินค้า" aria-label="ค้นหา" style="border:0"><button class="btn primary" aria-label="ค้นหา">${ICON.search}</button></form>
  </header>
  <div class="wrap">
    <div class="tiles">
      <a class="tile" href="#/po">${ICON.box}รับของ / PO</a>
      <a class="tile" href="#/search">${ICON.doc}ใบเซอร์</a>
      <a class="tile" href="#/search?pick=1">${ICON.search}ตัดสต๊อค</a>
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
      q(sb.from('process_jobs').select('id').eq('status', 'sent').lt('due_date', new Date().toISOString().slice(0, 10))),
      q(sb.from('lot_balance').select('*').order('lot_no', { ascending: false }).limit(8)),
    ]);
    const todo = [
      ['PO รอของเข้า', 'คลังกดรับของวันที่ของมาส่ง', pos.filter((p) => poStatus(p).key === 'wait').length, 'info', '#/po?f=wait'],
      ['รับของแล้ว รอแตก Lot', 'ออฟฟิศแตก Lot + อัปโหลดเซอร์', pos.filter((p) => poStatus(p).key === 'split').length, 'warn', '#/po?f=split'],
      ['ตัดสต๊อครอเลขบิล', 'เติมเลขบิล / ชื่อลูกค้า', noBill.length, 'bad', '#/pending'],
      ['Lot รอพิมพ์สติกเกอร์', 'ออฟฟิศพิมพ์แล้วส่งให้คลังติด', noLabel.length, 'warn', '#/labels'],
      ['Lot รอใบเซอร์', 'ออฟฟิศต้องอัปโหลด', noCert.length, 'warn', ''],
      ['Lot รอรูปวัดขนาด', 'คลังต้องถ่ายรูป', noPhoto.length, 'warn', ''],
      ['ส่งตัด/ขัด เลยกำหนด', 'งานที่ยังไม่รับคืน', overdue.length, 'bad', ''],
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
    <div class="row"><span class="lotcode">Lot ${l.lot_code}</span><span class="muted">คงเหลือ ${num(l.qty_on_hand)}</span></div>
    <div>${esc(l.product_name)}</div>
    <div class="row" style="justify-content:flex-start;gap:6px">${l.bundle_label ? `<span class="muted">${esc(l.bundle_label)}</span>` : ''}
      <span class="chip ${l.has_cert ? 'ok' : 'warn'}">${l.has_cert ? 'มีเซอร์' : 'รอเซอร์'}</span>
      <span class="chip ${l.has_photo ? 'ok' : 'warn'}">${l.has_photo ? 'มีรูปวัด' : 'รอรูปวัด'}</span></div>
  </a>`;
}

/* ===================== PO ===================== */
// สถานะ PO: รอของเข้า (คลังกดรับ) → รอแตก Lot (ออฟฟิศ) → ครบ
function poStatus(p) {
  if (!p.receipts.length) return { key: 'wait', label: 'รอของเข้า', chip: 'info' };
  if (p.po_lines.some((l) => !l.lots.length)) return { key: 'split', label: 'รอแตก Lot', chip: 'warn' };
  return { key: 'done', label: 'ครบ', chip: 'ok' };
}
const PO_SELECT = 'id, po_no, supplier, ordered_at, receipts(id), po_lines(id, qty_ordered, lots(lot_no))';

async function viewPOList(params = new URLSearchParams()) {
  setTabs('po');
  const f = params.get('f') || '';
  const tabs = [['', 'ทั้งหมด'], ['wait', 'รอของเข้า'], ['split', 'รอแตก Lot'], ['done', 'ครบ']];
  app.innerHTML = head('รับของ / PO', 'ออฟฟิศเปิด PO · คลังกดรับของวันที่ของมาส่ง', '#/') + `
  <div class="wrap">
    ${isOffice() ? '<a class="btn primary block" href="#/po/new">+ สร้างรายการรอเข้า (PO)</a>' : ''}
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
  app.innerHTML = head('สร้างรายการรอเข้า', 'ลงไว้ก่อนของมาถึง', '#/po') + `
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
      <div class="grid2"><label class="f">จำนวนสั่ง<input name="qty" type="number" min="0.01" step="any" required inputmode="decimal"></label>
      <div style="display:flex;align-items:flex-end"><button type="button" class="btn ghost sm block rm">ลบรายการ</button></div></div></div>`;
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
        qty: Number(d.querySelector('[name=qty]').value),
      })).filter((r) => r.name && r.qty > 0);
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
        await q(sb.from('po_lines').insert({ po_id: po.id, product_id: p.id, qty_ordered: r.qty }));
      }
      productCache = null;
      toast('บันทึก PO แล้ว');
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
    const receipt = po.receipts.sort((a, b) => b.id - a.id)[0];

    app.innerHTML = head(`<span class="mono">${esc(po.po_no)}</span>`, `${esc(po.supplier)} · สั่ง ${fmtDate(po.ordered_at)}${receipt ? ` · บิล ${esc(receipt.supplier_doc_no)} รับ ${fmtDate(receipt.received_at)}` : ''}`, '#/po') + `
    <div class="wrap">
      ${!receipt ? (['warehouse', 'admin'].includes(state.profile.role) ? `<form class="card" id="rcForm"><h2>ของมาถึงแล้ว? บันทึกบิลรับของ</h2>
        <p class="muted" style="margin:0">คลังกดรับวันที่ของมาส่ง · ดูเลขบิลจากใบส่งของที่มากับสินค้า</p>
        <div class="grid2"><label class="f">เลขบิลผู้ขาย (IV / ST)<input name="doc" required class="mono" placeholder="IV6907623"></label>
        <label class="f">วันที่รับ<input name="d" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
        <button class="btn dark">บันทึกการรับของ</button></form>` : '<div class="card"><div class="row"><span>สถานะ</span><span class="chip info">รอของเข้า · รอคลังกดรับของ</span></div></div>') : ''}
      ${po.po_lines.map((l) => {
        const got = l.lots.reduce((s, x) => s + Number(x.qty_received), 0);
        return `<div class="card">
          <div class="row"><h2>${esc(l.products.name)}</h2><span class="muted">${num(got)}/${num(l.qty_ordered)} ${esc(l.products.unit)}</span></div>
          ${l.lots.sort((a, b) => a.lot_no - b.lot_no).map((x) => `<div class="sub-lot">
            <a href="#/lot/${x.lot_code}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:2px;min-width:0">
              <span class="lotcode">Lot ${x.lot_code}${x.bundle_label ? ' · ' + esc(x.bundle_label) : ''} · ${num(x.qty_received)}</span>
              <span class="muted" style="color:${hasCert.has(x.lot_no) ? 'var(--ok)' : 'var(--warn)'}">${hasCert.has(x.lot_no) ? `ใบเซอร์ ✓${x.heat_no ? ' · Heat ' + esc(x.heat_no) : ''}` : 'ยังไม่มีใบเซอร์'}</span></a>
            <div style="display:flex;gap:6px;flex:none">
              ${isOffice() && !hasCert.has(x.lot_no) ? `<label class="btn primary sm">อัปโหลดเซอร์<input type="file" accept="application/pdf,image/*" hidden data-cert="${x.lot_no}"></label>` : ''}
              ${isOffice() ? `<a class="btn ghost sm" href="#/label/${x.lot_code}">สติกเกอร์</a>` : ''}
            </div></div>`).join('')}
          ${receipt && isOffice() ? `<details><summary class="btn dash block" style="list-style:none">+ แตก Lot (ใบเซอร์ / ลัง / มัด)</summary>
            <form class="lotForm" data-line="${l.id}" data-product="${l.product_id}" style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
              <div class="grid3"><label class="f">จำนวน<input name="qty" type="number" step="any" min="0.01" required inputmode="decimal" value="${Math.max(0, Number(l.qty_ordered) - got) || ''}"></label>
              <label class="f">ลัง/มัด<input name="bundle" placeholder="ลัง 1"></label>
              <label class="f">Heat No.<input name="heat" placeholder="จากเซอร์"></label></div>
              <button class="btn dark">สร้าง Lot</button></form></details>` : ''}
        </div>`;
      }).join('')}
    </div>`;

    const rc = document.getElementById('rcForm');
    if (rc) rc.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(rc);
      try { await q(sb.from('receipts').insert({ po_id: po.id, supplier_doc_no: String(fd.get('doc')).trim(), received_at: fd.get('d') })); toast(isOffice() ? 'บันทึกรับของแล้ว · แตก Lot ต่อได้เลย' : 'บันทึกรับของแล้ว · ออฟฟิศจะแตก Lot ต่อ'); viewPO(id); } catch (err) { fail(err); }
    };
    app.querySelectorAll('.lotForm').forEach((f) => f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      f.querySelector('button').disabled = true;
      try {
        const lot = await q(sb.from('lots').insert({
          product_id: Number(f.dataset.product), po_line_id: Number(f.dataset.line), receipt_id: receipt.id,
          qty_received: Number(fd.get('qty')), bundle_label: fd.get('bundle') || null, heat_no: fd.get('heat') || null,
        }).select('lot_code').single());
        toast(`สร้าง Lot ${lot.lot_code} แล้ว`);
        viewPO(id);
      } catch (err) { fail(err); f.querySelector('button').disabled = false; }
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
      <div class="stats"><div class="stat"><small>รับเข้า</small><b>${num(lot.qty_received)}</b></div>
        <div class="stat"><small>ขายออก</small><b>${num(sold)}</b></div>
        <div class="stat"><small>คงเหลือ</small><b style="color:#FDBA74">${num(bal.qty_on_hand)}</b></div></div>
    </header>
    <div class="wrap">
      <div class="muted">${rc?.purchase_orders?.po_no ? esc(rc.purchase_orders.po_no) + ' · ' : ''}${rc ? 'บิล ' + esc(rc.supplier_doc_no) + ' · รับ ' + fmtDate(rc.received_at) : ''}${lot.heat_no ? ' · Heat ' + esc(lot.heat_no) : ''}${Number(bal.qty_on_process) ? ` · <b>On Process ${num(bal.qty_on_process)}</b>` : ''}</div>

      <div class="card"><div class="row"><h2>ใบเซอร์</h2>${isOffice() ? `<label class="btn ghost sm">+ อัปโหลด<input type="file" accept="application/pdf,image/*" hidden id="certIn"></label>` : ''}</div>
        ${certs.length ? certs.map((c) => `<div class="row"><span>${esc(c.file_name || 'ใบเซอร์')}</span><button class="btn ghost sm" data-open="${esc(c.storage_path)}">เปิด / ดาวน์โหลด</button></div>`).join('') : '<p class="empty" style="padding:4px 0">ยังไม่มีใบเซอร์</p>'}
      </div>

      <div class="card"><div class="row"><h2>รูปวัดขนาด</h2><span class="muted">${photos.length} รูป</span></div>
        <div class="photos">${photoUrls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="รูปวัด Lot ${esc(lot.lot_code)}" loading="lazy"></a>`).join('')}
          <label class="add" aria-label="ถ่ายรูปเพิ่ม">+<input type="file" accept="image/*" capture="environment" hidden id="photoIn" multiple></label></div>
        <form id="measForm" style="display:flex;flex-direction:column;gap:8px">
          <div class="grid3">${cat.measures.map((m) => `<label class="f">${m} (มม.)<input name="${esc(m)}" inputmode="decimal" type="number" step="any" class="mono"></label>`).join('')}</div>
          <button class="btn dark sm">บันทึกค่าวัด</button></form>
        ${meas.length ? `<div class="list">${meas.map((m) => `<div class="row"><span>${esc(m.measure)}</span><span class="mono">${num(m.value)} ${esc(m.unit)} <span class="muted">${fmtDate(m.created_at)}</span></span></div>`).join('')}</div>` : ''}
      </div>

      <div class="card"><h2>ตัดสต๊อคจาก Lot นี้</h2>
        <form id="cutForm" style="display:flex;flex-direction:column;gap:8px">
          <label class="f">จำนวน<input name="qty" type="number" min="0.01" step="any" required inputmode="decimal" class="big"></label>
          <div class="grid2"><label class="f">เลขบิล (INV / NO)<input name="doc" class="mono" placeholder="ไม่รู้ เว้นว่างได้"></label>
          <label class="f">ลูกค้า<input name="cust" placeholder="ไม่รู้ เว้นว่างได้"></label></div>
          <label class="f">หมายเหตุ (ใครสั่ง / รายละเอียด)<input name="note" placeholder="เช่น เซลล์ม่อนสั่ง ลูกค้าหน้าร้าน"></label>
          <p class="muted" style="margin:0">ยังไม่รู้เลขบิลหรือลูกค้า ตัดไปก่อนได้ ระบบจะขึ้นใน "งานค้าง" ให้ออฟฟิศเติมทีหลัง</p>
          <button class="btn primary">ยืนยันตัดสต๊อค</button></form></div>

      <div class="card"><h2>ประวัติ</h2><div class="list">${moves.map((m) => `<div class="row"><div><div>${KIND_TH[m.kind] || m.kind} ${m.doc_no ? `<span class="mono" style="color:var(--link)">${esc(m.doc_no)}</span>` : (m.kind === 'sale' ? '<span class="chip bad">รอเลขบิล</span>' : '')}</div><div class="muted">${esc(m.customer || '')} ${esc(m.note || '')} ${fmtDate(m.created_at)}</div></div><b class="mono">${Number(m.qty) > 0 ? '+' : ''}${num(m.qty)}</b></div>`).join('')}</div></div>

      ${isOffice() ? `<a class="btn ghost block" href="#/label/${esc(lot.lot_code)}">พิมพ์สติกเกอร์</a>` : ''}
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
          <div class="bot"><span>รับ ${fmtDate(lot.receipts?.received_at)}</span><span>${esc(lot.bundle_label || '')}</span><span>${num(lot.qty_received)} ${esc(lot.products.unit)}</span></div>
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
    <form id="sf" class="row" style="gap:8px"><input name="q" value="${esc(qv)}" placeholder="เช่น 00003 หรือ INV2026080173" autofocus><button class="btn dark">${ICON.search}</button></form>
    ${params.get('pick') ? '<p class="muted" style="margin:0">ตัดสต๊อค: สแกน QR บนสติกเกอร์ด้วยกล้องมือถือ หรือพิมพ์เลข Lot แล้วตัดในหน้า Lot</p>' : ''}
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

/* ===================== บัญชี ===================== */
function viewMe() {
  setTabs('me');
  app.innerHTML = head('บัญชีของฉัน', '', '#/') + `
  <div class="wrap"><div class="card">
    <div class="row"><span>ชื่อ</span><b>${esc(state.profile.full_name)}</b></div>
    <div class="row"><span>บทบาท</span><b>${ROLE_TH[state.profile.role]}</b></div>
    <div class="row"><span>ชื่อผู้ใช้</span><span class="mono">${esc(state.session.user.email.replace('@' + EMAIL_DOMAIN, ''))}</span></div>
  </div><button class="btn ghost block" id="lo">ออกจากระบบ</button></div>`;
  document.getElementById('lo').onclick = () => sb.auth.signOut();
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
  return viewHome();
}

window.addEventListener('hashchange', route);
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
