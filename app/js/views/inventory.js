// หน้า "คลังยา" — #/inventory?f=refill&type=&sort=action&q=
import { html, icon, $, $$, emptyState, skelLines, toast, busy, openLayer, confirmDialog } from '../core/ui.js';
import { session } from '../core/session.js';
import { setParams } from '../core/router.js';
import { dateShort, time, ymd, toDate } from '../core/format.js';
import { medStatus } from '../core/clinical.js';
import { systemColors, systemPill } from '../core/codes.js';
import { EXPIRY_WARN_DAYS } from '../config.js';
import * as api from '../data/api.js';

const FILTERS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'refill', label: 'ต้องเติม' },
  { id: 'expiring', label: 'ใกล้หมดอายุ' },
  { id: 'expired', label: 'หมดอายุ' },
];
const SORTS = [
  { id: 'action', label: 'เรียง: ต้องดำเนินการก่อน' },
  { id: 'name', label: 'ชื่อ A–Z' },
  { id: 'stock', label: 'คงเหลือน้อย → มาก' },
  { id: 'expiry', label: 'หมดอายุใกล้สุด' },
];
const DISPENSE_TYPES = ['Expire', 'Distribute to Other site', 'Internal Supplies Requisition'];
const HIST_LIMIT = 15;

let root, st;

export default {
  async mount(el, params) {
    root = el;
    st = {
      meds: null, err: false, loadedAt: null, open: null, hist: {},
      f: FILTERS.some((x) => x.id === params.f) ? params.f : 'all',
      type: params.type || '', sort: SORTS.some((x) => x.id === params.sort) ? params.sort : 'action', q: params.q || '',
    };
    root.innerHTML = String(html`
      <div class="page">
        <div class="page-head">
          <div><h1>คลังยา</h1><p data-sub>กำลังโหลด...</p></div>
          <div class="tools">
            <button type="button" class="btn" data-tx="dispense">${icon('upload')}จ่ายออก</button>
            <button type="button" class="btn primary" data-tx="receive">${icon('download')}รับยาเข้า</button>
          </div>
        </div>
        <div data-stats></div>
        <div class="inv-tools">
          <label class="search">${icon('search')}<input type="text" placeholder="ค้นหาชื่อยา" aria-label="ค้นหาชื่อยา" data-page-search></label>
          <select class="input" style="width:260px" aria-label="ประเภทยา" data-type></select>
          <select class="input" style="width:230px" aria-label="เรียงตาม" data-sort>${SORTS.map((s) => html`<option value="${s.id}">${s.label}</option>`)}</select>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:-8px" data-chips></div>
        <div data-table></div>
      </div>`);
    const q = $('[data-page-search]', root);
    q.value = st.q;
    q.addEventListener('input', () => { st.q = q.value.trim(); sync(); renderTable(); });
    $('[data-sort]', root).value = st.sort;
    $('[data-sort]', root).onchange = (e) => { st.sort = e.target.value; sync(); renderTable(); };
    $('[data-type]', root).onchange = (e) => { st.type = e.target.value; sync(); renderChips(); renderTable(); };
    $('[data-chips]', root).addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { st.f = b.dataset.f; sync(); renderChips(); renderTable(); } });
    $$('[data-tx]', root).forEach((b) => (b.onclick = () => openTx({ type: b.dataset.tx })));
    bindTable();
    await load();
  },
};

/* ---------------- data ---------------- */
async function load() {
  st.err = false;
  renderAll();
  try {
    st.meds = await api.listMedicines({ refresh: true });
    st.loadedAt = new Date();
  } catch (e) { console.error(e); st.err = true; }
  renderAll();
}
function sync() { setParams({ f: st.f === 'all' ? '' : st.f, type: st.type, sort: st.sort === 'action' ? '' : st.sort, q: st.q }); }

const statusOf = (m) => medStatus(m);
// สีประจำประเภทยา (ใช้ชุดสีเดียวกับ Disease system ในรายงาน) — สร้างใหม่เมื่อรายการยาเปลี่ยน
let typeColorCache = { meds: null, fn: null };
const typeColor = () => {
  if (typeColorCache.meds !== st.meds) typeColorCache = { meds: st.meds, fn: systemColors(st.meds.map((m) => m.type)) };
  return typeColorCache.fn;
};
const inFilter = (m, f) => {
  const s = statusOf(m);
  if (f === 'refill') return s.out || s.low;
  if (f === 'expiring') return s.expiring;
  if (f === 'expired') return s.expired;
  return true;
};
const rank = (m) => { const s = statusOf(m); return s.expired ? 0 : s.out ? 1 : s.low ? 2 : s.expiring ? 3 : 4; };

function visible() {
  const q = st.q.toLowerCase();
  const list = st.meds.filter((m) => (!st.type || m.type === st.type) && (!q || (m.name || '').toLowerCase().includes(q)) && inFilter(m, st.f));
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'th');
  const exp = (m) => (m.expiry ? toDate(m.expiry).getTime() : Infinity);
  if (st.sort === 'name') return list.sort(byName);
  if (st.sort === 'stock') return list.sort((a, b) => a.qty - b.qty || byName(a, b));
  if (st.sort === 'expiry') return list.sort((a, b) => exp(a) - exp(b) || byName(a, b));
  return list.sort((a, b) => rank(a) - rank(b) || exp(a) - exp(b) || byName(a, b));
}

/* ---------------- render ---------------- */
function renderAll() {
  $('[data-sub]', root).textContent = st.loadedAt ? `คลังยารวมทุก location · อัปเดตล่าสุด ${time(st.loadedAt)}` : st.err ? 'โหลดข้อมูลไม่สำเร็จ' : 'กำลังโหลด...';
  renderStats(); renderTypes(); renderChips(); renderTable();
}

function renderStats() {
  const box = $('[data-stats]', root);
  if (!st.meds) { box.innerHTML = String(html`<div class="stats">${[1, 2, 3, 4].map(() => html`<div class="stat">${skelLines(2, 18)}</div>`)}</div>`); return; }
  const all = st.meds;
  const types = new Set(all.map((m) => m.type).filter(Boolean)).size;
  const low = all.filter((m) => statusOf(m).low).length, out = all.filter((m) => statusOf(m).out).length;
  const expiring = all.filter((m) => statusOf(m).expiring).length, expired = all.filter((m) => statusOf(m).expired).length, toRemove = all.filter((m) => statusOf(m).expired && m.qty > 0).length;
  box.innerHTML = String(html`<div class="stats">
    <div class="stat"><span class="k">รายการทั้งหมด</span><span class="v">${all.length}<small>รายการ · ${types} ประเภท</small></span></div>
    <div class="stat${low + out ? ' warn' : ''}"><span class="k">${icon('bars', 'sm')}ต้องเติม</span><span class="v">${low + out}<small>ใกล้หมด ${low} · หมด ${out}</small></span></div>
    <div class="stat"><span class="k" style="${expiring ? 'color:var(--caution)' : ''}">${icon('calendar', 'sm')}ใกล้หมดอายุ ≤ ${EXPIRY_WARN_DAYS} วัน</span><span class="v" style="${expiring ? 'color:var(--caution)' : ''}">${expiring}<small>รายการ</small></span></div>
    <div class="stat${toRemove ? ' alert' : ''}"><span class="k">${icon('xCircle', 'sm')}หมดอายุ</span><span class="v">${expired}<small>${toRemove ? `ต้องตัดออก ${toRemove}` : 'รายการ'}</small></span></div>
  </div>`);
}

function renderTypes() {
  const sel = $('[data-type]', root);
  const types = st.meds ? [...new Set(st.meds.map((m) => m.type).filter(Boolean))].sort() : [];
  if (st.type && !types.includes(st.type)) types.push(st.type);
  sel.innerHTML = String(html`<option value="">ทุกประเภท</option>${types.map((t) => html`<option value="${t}">${t}</option>`)}`);
  sel.value = st.type;
}

function renderChips() {
  const base = st.meds ? st.meds.filter((m) => !st.type || m.type === st.type) : [];
  $('[data-chips]', root).innerHTML = String(html`${FILTERS.map((f) => html`<button type="button" class="fchip${st.f === f.id ? ' on' : ''}" data-f="${f.id}" aria-pressed="${st.f === f.id}">${f.label} <b>${st.meds ? base.filter((m) => inFilter(m, f.id)).length : '–'}</b></button>`)}`);
}

function statusPills(m) {
  const s = statusOf(m);
  const out = [];
  if (s.expired) out.push(html`<span class="pill expired">${icon('xCircle')}<span class="strike">หมดอายุ</span></span>`);
  if (s.out) out.push(html`<span class="pill danger">${icon('ban')}หมด</span>`);
  else if (s.low) out.push(html`<span class="pill warn">${icon('bars')}ใกล้หมด</span>`);
  if (s.expiring) out.push(html`<span class="pill caution">${icon('calendar')}ใกล้หมดอายุ</span>`);
  if (!out.length) out.push(html`<span class="pill ok">${icon('checkCircle')}ปกติ</span>`);
  return html`<span style="display:inline-flex;gap:6px">${out}</span>`;
}

function renderTable() {
  const box = $('[data-table]', root);
  if (st.err) {
    box.innerHTML = String(html`<div class="card">${emptyState({ ic: 'wifiOff', err: true, title: 'โหลดคลังยาไม่สำเร็จ', action: html`<button class="btn" data-retry>${icon('refresh')}ลองอีกครั้ง</button>` })}</div>`);
    $('[data-retry]', box).onclick = load;
    return;
  }
  if (!st.meds) { box.innerHTML = String(html`<div class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px">${skelLines(6, 32)}</div>`); return; }
  const list = visible();
  if (!list.length) {
    box.innerHTML = String(html`<div class="card">${emptyState({ ic: 'pill', title: st.meds.length ? 'ไม่พบยาที่ตรงกับเงื่อนไข' : 'ยังไม่มีรายการยา', text: st.meds.length ? 'ลองเปลี่ยนคำค้นหา ประเภท หรือตัวกรอง' : '' })}</div>`);
    return;
  }
  box.innerHTML = String(html`
    <div class="card scroll-x">
      <table class="table inv">
        <thead><tr><th>ชื่อยา</th><th>ประเภท</th><th class="r">คงเหลือ</th><th>วันหมดอายุ</th><th>สถานะ</th><th class="r">การกระทำ</th></tr></thead>
        <tbody>${list.map(row)}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-top:1px solid var(--line)" class="small muted"><span>แสดง ${list.length} จาก ${st.meds.length} รายการ</span><span>คลิกแถวเพื่อดูประวัติเคลื่อนไหว</span></div>
    </div>`);
}

function row(m) {
  const s = statusOf(m);
  const open = st.open === m.id;
  const qtyStyle = s.out ? 'color:var(--danger);font-weight:600' : s.low ? 'color:var(--warn);font-weight:600' : '';
  const expStyle = s.expired ? 'color:var(--expired);font-weight:500' : s.expiring ? 'color:var(--caution);font-weight:500' : '';
  return html`
    <tr class="row${s.expired ? ' exp' : ''}${open ? ' open' : ''}" data-id="${m.id}" aria-expanded="${open}">
      <td><span style="display:inline-flex;align-items:center;gap:6px;font-weight:500"><span class="chev muted">${icon('chevronDown', 'sm')}</span><span class="name">${m.name}</span></span></td>
      <td>${m.type ? systemPill(m.type, typeColor()(m.type)) : html`<span class="muted">-</span>`}</td>
      <td class="r num" style="${qtyStyle}">${m.qty.toLocaleString('th-TH')} <span class="muted" style="font-weight:400">${m.unit || ''}</span></td>
      <td class="num" style="${expStyle}">${m.expiry ? dateShort(m.expiry) : '-'}${s.expiring ? ` · ${s.days} วัน` : ''}</td>
      <td>${statusPills(m)}</td>
      <td class="r">${s.expired && m.qty > 0
        ? html`<button type="button" class="btn danger-out sm" data-act="expire">ตัดออก (Expire)</button>`
        : html`<span class="acts"><button type="button" class="btn icon ghost" title="รับยาเข้า" aria-label="รับยาเข้า ${m.name}" data-act="receive">${icon('download')}</button><button type="button" class="btn icon ghost" title="จ่ายออก" aria-label="จ่ายออก ${m.name}" data-act="dispense" ${m.qty > 0 ? '' : 'disabled'}>${icon('upload')}</button></span>`}</td>
    </tr>
    ${open ? html`<tr class="open"><td colspan="6" style="padding-top:0">
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;padding:8px 0 8px 22px">
        <div style="flex:1 1 520px;min-width:0"><div class="sec-title" style="margin-bottom:6px">ประวัติเคลื่อนไหว</div><div data-hist="${m.id}">${histHtml(m)}</div></div>
        <div style="display:flex;gap:8px"><button type="button" class="btn" data-act="edit">${icon('edit')}แก้ไข</button><button type="button" class="btn danger-out" data-act="delete">${icon('trash')}ลบ</button></div>
      </div></td></tr>` : ''}`;
}

/* ---------------- history ---------------- */
function histHtml(m) {
  const h = st.hist[m.id];
  if (!h) return skelLines(3, 16);
  if (h.err) return html`<span class="hint err">${icon('alertCircle')}โหลดประวัติไม่สำเร็จ</span>`;
  if (!h.rows.length) return html`<p class="small muted">ยังไม่มีประวัติรับ/จ่าย</p>`;
  const rows = h.all ? h.rows : h.rows.slice(0, HIST_LIMIT);
  return html`<div class="hist num">${rows.map((r) => html`
    <span class="muted">${r.date ? `${dateShort(r.date)} ${time(r.date)}` : '-'}</span>
    <span class="${r.in ? 'in' : 'out'}">${r.in ? '+' : '−'}${r.qty}</span>
    <span>${r.text}</span>
    <span class="muted">${r.by || ''}</span>`)}</div>
    ${h.rows.length > HIST_LIMIT && !h.all ? html`<button type="button" class="btn ghost sm" data-hist-all style="margin-top:4px">แสดงทั้งหมด ${h.rows.length} รายการ</button>` : ''}`;
}

async function loadHist(m) {
  if (st.hist[m.id] && !st.hist[m.id].err) return;
  delete st.hist[m.id];
  try {
    const [tx, cards, emps] = await Promise.all([api.listMedicineTransactions(m.id), api.listAllOpdCards(), api.getEmployees()]);
    const cn = new Map(emps.map((e) => [e.id, e.cn]));
    const rows = [
      ...tx.map((t) => ({ date: toDate(t.createDate), qty: Number(t.qty) || 0, in: t.type === 'receive', text: t.type === 'receive' ? `${t.subType || 'Receive'} · รับเข้าคลัง` : (t.subType || 'จ่ายออก'), by: t.createdBy })),
      ...cards.flatMap((c) => (c.medicines || []).filter((x) => x.name === m.name).map((x) => ({
        date: toDate(c.createdDate) || toDate(c.visitDate), qty: Number(x.quantity) || 0, in: false, text: `จ่ายให้ CN ${cn.get(c.empId) || '-'}${c.location ? ` · ${c.location}` : ''}`, by: c.createdBy,
      }))),
    ].sort((a, b) => (b.date || 0) - (a.date || 0));
    st.hist[m.id] = { rows };
  } catch (e) { console.error(e); st.hist[m.id] = { err: true, rows: [] }; }
  const box = $(`[data-hist="${m.id}"]`, root);
  if (box) box.innerHTML = String(histHtml(m));
}

/* ---------------- events ---------------- */
function bindTable() {
  $('[data-table]', root).addEventListener('click', (e) => {
    if (e.target.closest('[data-hist-all]')) {
      const id = e.target.closest('[data-hist]').dataset.hist;
      st.hist[id].all = true;
      $(`[data-hist="${id}"]`, root).innerHTML = String(histHtml(st.meds.find((m) => m.id === id)));
      return;
    }
    const tr = e.target.closest('tr');
    const id = tr?.dataset.id || tr?.previousElementSibling?.dataset.id;
    const m = st.meds?.find((x) => x.id === id);
    if (!m) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'receive' || act === 'dispense') return openTx({ type: act, med: m });
    if (act === 'expire') return openTx({ type: 'dispense', med: m, subType: 'Expire', qty: m.qty });
    if (act === 'edit') return openEdit(m);
    if (act === 'delete') return removeMed(m);
    if (tr.classList.contains('row')) {
      st.open = st.open === m.id ? null : m.id;
      renderTable();
      if (st.open) loadHist(m);
    }
  });
}

async function afterChange(id) {
  delete st.hist[id];
  try { st.meds = await api.listMedicines({ refresh: true }); st.loadedAt = new Date(); } catch { /* แสดงข้อมูลเดิมไว้ */ }
  if (st.open && !st.meds.some((m) => m.id === st.open)) st.open = null;
  renderAll();
  const m = st.meds.find((x) => x.id === st.open);
  if (m) loadHist(m);
}

/* ---------------- รับเข้า / จ่ายออก ---------------- */
function openTx({ type, med = null, subType = '', qty = '' }) {
  if (!st.meds) return;
  const state = { type, id: med?.id || '', subType: subType || (type === 'receive' ? 'Receive' : DISPENSE_TYPES[2]), qty: String(qty || ''), date: ymd(new Date()) };
  openLayer({
    size: 'sm',
    content: html`
      <div class="modal-h"><h2 data-title></h2><button type="button" class="btn icon ghost" aria-label="ปิด" data-close>${icon('x')}</button></div>
      <div class="modal-b" style="display:flex;flex-direction:column;gap:14px">
        <div class="seg" role="group" aria-label="ประเภทรายการ" data-types style="align-self:flex-start">
          <button type="button" data-t="receive">${icon('download', 'sm')}รับเข้า</button><button type="button" data-t="dispense">${icon('upload', 'sm')}จ่ายออก</button>
        </div>
        <label class="field"><span class="label">ยา <span class="req">*</span></span>
          <select class="input" data-med ${med ? 'disabled' : ''}><option value="">-- เลือกยา --</option>${st.meds.map((m) => html`<option value="${m.id}">${m.name} · คงเหลือ ${m.qty} ${m.unit || ''}</option>`)}</select>
        </label>
        <div class="g2">
          <label class="field"><span class="label">จำนวน <span class="req">*</span></span><span class="unit-input" style="height:40px"><input type="text" inputmode="numeric" data-qty style="font-size:15px" ${med ? 'autofocus' : ''}><span data-unit></span></span></label>
          <label class="field"><span class="label">วันที่ <span class="req">*</span></span><input class="input num" type="date" data-date max="${ymd(new Date())}"></label>
        </div>
        <label class="field" data-sub-wrap><span class="label">ประเภทการจ่าย</span><select class="input" data-subtype>${DISPENSE_TYPES.map((d) => html`<option>${d}</option>`)}</select></label>
        <div class="tx-preview" data-preview></div>
        <span class="hint err" data-err hidden></span>
      </div>
      <div class="modal-f"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button type="button" class="btn primary" data-save>${icon('check')}บันทึก</button></div>`,
    onMount(box, close) {
      const q = (s) => $(s, box);
      q('[data-med]').value = state.id;
      q('[data-qty]').value = state.qty;
      q('[data-date]').value = state.date;
      q('[data-subtype]').value = state.subType === 'Receive' ? DISPENSE_TYPES[2] : state.subType;
      const cur = () => st.meds.find((m) => m.id === state.id);
      const render = () => {
        const m = cur();
        const rec = state.type === 'receive';
        q('[data-title]').textContent = (rec ? 'รับยาเข้าคลัง' : 'จ่ายยาออก') + (m ? `: ${m.name}` : '');
        box.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === state.type));
        q('[data-sub-wrap]').hidden = rec;
        q('[data-unit]').textContent = m?.unit || '';
        const n = parseInt(state.qty, 10) || 0;
        const after = m ? (rec ? m.qty + n : m.qty - n) : null;
        q('[data-preview]').innerHTML = String(m
          ? html`<span class="muted">คงเหลือ</span><b>${m.qty}</b>${icon('chevronRight', 'sm')}<b style="color:${after < 0 ? 'var(--danger)' : rec ? 'var(--ok)' : 'var(--warn)'}">${after}</b><span class="muted">${m.unit || ''}</span>`
          : html`<span class="muted">เลือกยาเพื่อดูจำนวนคงเหลือ</span>`);
        const save = q('[data-save]');
        save.className = `btn ${rec ? 'primary' : 'danger'}`;
      };
      const err = (msg) => { const e = q('[data-err]'); e.innerHTML = String(html`${icon('alertCircle')}${msg}`); e.hidden = !msg; };
      q('[data-types]').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { state.type = b.dataset.t; err(''); render(); } });
      q('[data-med]').onchange = (e) => { state.id = e.target.value; err(''); render(); };
      q('[data-qty]').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); state.qty = e.target.value; err(''); render(); });
      q('[data-date]').onchange = (e) => { state.date = e.target.value; };
      q('[data-subtype]').onchange = (e) => { state.subType = e.target.value; };
      q('[data-save]').onclick = async () => {
        const m = cur();
        const n = parseInt(state.qty, 10) || 0;
        if (!m) return err('กรุณาเลือกยา');
        if (n <= 0) return err('กรุณาระบุจำนวนมากกว่า 0');
        if (!state.date) return err('กรุณาระบุวันที่');
        if (state.type === 'dispense' && n > m.qty) return err(`จ่ายได้ไม่เกินคงเหลือ (${m.qty} ${m.unit || ''})`);
        const btn = q('[data-save]');
        busy(btn, true, 'กำลังบันทึก...');
        try {
          const subType = state.type === 'receive' ? 'Receive' : q('[data-subtype]').value;
          const newQty = await api.addMedicineTransaction(m.id, { type: state.type, subType, qty: n, date: state.date === ymd(new Date()) ? new Date() : new Date(...state.date.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) }, session.staff);
          close();
          toast(state.type === 'receive' ? 'รับยาเข้าคลังแล้ว' : 'จ่ายยาออกแล้ว', `${m.name} ${state.type === 'receive' ? '+' : '−'}${n} ${m.unit || ''} · คงเหลือ ${newQty}`);
          afterChange(m.id);
        } catch (e) { console.error(e); busy(btn, false); err('บันทึกไม่สำเร็จ ลองอีกครั้ง'); }
      };
      render();
      (med ? q('[data-qty]') : q('[data-med]')).focus();
    },
  });
}

/* ---------------- แก้ไข / ลบ ---------------- */
function openEdit(m) {
  const types = [...new Set(st.meds.map((x) => x.type).filter(Boolean))].sort();
  openLayer({
    size: 'sm',
    content: html`
      <div class="modal-h"><h2>แก้ไขรายการยา</h2><button type="button" class="btn icon ghost" aria-label="ปิด" data-close>${icon('x')}</button></div>
      <form class="modal-b" style="display:flex;flex-direction:column;gap:14px" data-form novalidate>
        <label class="field"><span class="label">ชื่อยา <span class="req">*</span></span><input class="input" name="name" value="${m.name}" autofocus><span class="hint" data-name-hint hidden>${icon('info')}ประวัติการจ่ายยาเดิมในบันทึกการรักษาอ้างอิงชื่อยาเดิม (${m.name})</span></label>
        <label class="field"><span class="label">ประเภทยา <span class="req">*</span></span><input class="input" name="type" value="${m.type || ''}" list="inv-types"><datalist id="inv-types">${types.map((t) => html`<option value="${t}">`)}</datalist></label>
        <div class="g2">
          <label class="field"><span class="label">วันหมดอายุ <span class="req">*</span></span><input class="input num" type="date" name="expiry" value="${m.expiry || ''}"></label>
          <label class="field"><span class="label">จำนวนคงเหลือ <span class="req">*</span></span><span class="unit-input" style="height:40px"><input type="text" inputmode="numeric" name="qty" value="${m.qty}" style="font-size:15px"><span>${m.unit || ''}</span></span></label>
        </div>
        <span class="hint">${icon('info')}ปรับจำนวนตรงนี้จะไม่บันทึกประวัติเคลื่อนไหว — ถ้ารับ/จ่ายจริงให้ใช้ปุ่มรับเข้า/จ่ายออก</span>
        <span class="hint err" data-err hidden></span>
      </form>
      <div class="modal-f"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button type="button" class="btn primary" data-save>${icon('check')}บันทึก</button></div>`,
    onMount(box, close) {
      const form = $('[data-form]', box);
      const el = form.elements;
      form.addEventListener('submit', (e) => e.preventDefault());
      el.name.addEventListener('input', () => { $('[data-name-hint]', box).hidden = el.name.value.trim() === m.name; });
      el.qty.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });
      $('[data-save]', box).onclick = async () => {
        const data = { name: el.name.value.trim(), type: el.type.value.trim(), expiry: el.expiry.value, qty: el.qty.value };
        const errEl = $('[data-err]', box);
        const bad = !data.name ? 'กรุณากรอกชื่อยา' : !data.type ? 'กรุณาระบุประเภทยา' : !data.expiry ? 'กรุณาระบุวันหมดอายุ' : data.qty === '' ? 'กรุณาระบุจำนวนคงเหลือ'
          : st.meds.some((x) => x.id !== m.id && x.name === data.name) ? 'มีชื่อยานี้ในคลังแล้ว' : '';
        if (bad) { errEl.innerHTML = String(html`${icon('alertCircle')}${bad}`); errEl.hidden = false; return; }
        const btn = $('[data-save]', box);
        busy(btn, true, 'กำลังบันทึก...');
        try {
          await api.updateMedicine(m.id, data, session.staff);
          close();
          toast('บันทึกข้อมูลยาแล้ว', data.name);
          afterChange(m.id);
        } catch (e) { console.error(e); busy(btn, false); toast('บันทึกไม่สำเร็จ', '', 'err'); }
      };
    },
  });
}

async function removeMed(m) {
  const ok = await confirmDialog({
    title: `ลบ ${m.name}?`,
    message: `รายการยาและประวัติรับ/จ่ายของยานี้จะถูกลบถาวร (คงเหลือ ${m.qty} ${m.unit || ''}) — บันทึกการรักษาที่เคยจ่ายยานี้ยังอยู่ครบ`,
    okText: 'ลบถาวร', danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteMedicine(m.id);
    toast('ลบรายการยาแล้ว', m.name);
    st.open = null;
    afterChange(m.id);
  } catch (e) { console.error(e); toast('ลบไม่สำเร็จ', '', 'err'); }
}
