// หน้า "ค้นหาพนักงาน" — ค้นหา CN, โปรไฟล์, ประวัติการรักษา (timeline) และรายละเอียดการรักษา (side panel)
import { html, icon, $, emptyState, skelLines, openLayer, toast } from '../core/ui.js';
import { session } from '../core/session.js';
import { setParams, href } from '../core/router.js';
import { dateShort, dateMedium, time, ageYears, phone, toDate } from '../core/format.js';
import { esiBadge, serviceTag, safetyState } from '../core/codes.js';
import * as api from '../data/api.js';
import { openPatientForm } from './patient-form.js';
import { openQueueRegister } from './queue-register.js';
import { onQueue, queueState } from '../core/queue-store.js';
import { go } from '../core/router.js';

let st;        // state ของหน้า
let root;

export default {
  async mount(el, params) {
    root = el;
    st = { q: params.q || '', id: params.id || '', employees: null, loadErr: false, patient: null, visits: null, lookup: null, range: 'all', token: 0, showAll: params.all === '1' };
    root.innerHTML = String(html`
      <div class="page">
        <div class="page-head">
          <div><h1>ค้นหาพนักงาน</h1><p>พิมพ์ CN ผลลัพธ์แสดงทันที · กด Enter ที่ช่องว่างเพื่อแสดงทั้งหมด</p></div>
          <div class="tools"><button type="button" class="btn" data-new>${icon('userPlus')}เพิ่มพนักงานใหม่</button></div>
        </div>
        <div class="pt-wrap">
          <div class="card pt-list">
            <label class="search big">${icon('search')}<input type="text" inputmode="numeric" autocomplete="off" data-page-search placeholder="พิมพ์ CN หรือ Enter ดูทั้งหมด" aria-label="ค้นหา CN" class="num"></label>
            <span class="small muted" data-count></span>
            <div class="results" data-results></div>
          </div>
          <div class="pt-main" data-profile></div>
        </div>
      </div>`);

    const input = $('[data-page-search]', root);
    input.value = st.q;
    input.addEventListener('input', () => { st.q = input.value.trim(); if (!st.q) st.showAll = false; syncParams(); renderResults(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (!st.q && !st.showAll) { st.showAll = true; renderResults(); return; }
        const first = $('[data-results] .res', root); first && first.click();
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); $('[data-results] .res', root)?.focus(); }
    });
    $('[data-results]', root).addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const items = [...root.querySelectorAll('[data-results] .res')];
      const i = items.indexOf(document.activeElement);
      (items[i + (e.key === 'ArrowDown' ? 1 : -1)] || (e.key === 'ArrowUp' ? input : null))?.focus();
    });
    $('[data-new]', root).addEventListener('click', () => newPatient(/^\d+$/.test(st.q) ? st.q : ''));
    $('[data-profile]', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-visit]'); if (!b) return;
      root.querySelectorAll('.tl-item').forEach((x) => x.classList.toggle('on', x === b));
      openVisit(visitsInRange()[+b.dataset.visit], () => b.classList.remove('on'));
    });
    $('[data-results]', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]'); if (b) select(b.dataset.id);
    });

    renderResults();
    renderProfile();
    // สถานะคิวเปลี่ยน (เพิ่ม/ปิดคิว) → อัปเดตป้าย "ในคิว" และปุ่มในโปรไฟล์
    let lastSig = '';
    st.offQueue = onQueue((qs) => {
      const sig = (qs.items || []).filter((q) => api.OPEN_STATUSES.includes(q.status)).map((q) => q.id + q.status).join();
      if (sig === lastSig) return;
      lastSig = sig;
      if (st.employees) renderResults();
      if (st.patient && !st.patient.error) renderProfile();
    });
    if (!st.id) input.focus();
    await loadEmployees();
    if (st.id) select(st.id, false);
  },

  unmount() { st?.offQueue?.(); },

  update(params) {
    // มาจากช่องค้นหาด้านบน หรือ link ภายในหน้า
    const input = $('[data-page-search]', root);
    if (params.all === '1' && !params.q) { st.showAll = true; st.q = ''; input.value = ''; renderResults(); }
    if ((params.q || '') !== st.q) { st.q = params.q || ''; input.value = st.q; renderResults(); }
    if (params.id && params.id !== st.id) select(params.id, false);
    if (!params.id) input.focus();
  },
};

/* ---------------- data ---------------- */
async function loadEmployees(refresh = false) {
  st.loadErr = false;
  try { st.employees = await api.getEmployees({ refresh }); }
  catch (e) { console.error(e); st.loadErr = true; }
  renderResults();
}

function syncParams() { setParams({ q: st.q, id: st.id }); }

function matches() {
  if (!st.employees) return [];
  const words = st.q.toLowerCase().split(/\s+/);
  return st.employees
    .filter((e) => words.every((w) => (e.cn || '').toLowerCase().includes(w)))
    .sort((a, b) => (a.cn || '').localeCompare(b.cn || ''));
}

/* ---------------- results ---------------- */
function highlight(cn) {
  const q = st.q.toLowerCase();
  const i = (cn || '').toLowerCase().indexOf(q);
  if (!q || i < 0) return html`${cn}`;
  return html`${cn.slice(0, i)}<mark>${cn.slice(i, i + q.length)}</mark>${cn.slice(i + q.length)}`;
}

function renderResults() {
  const box = $('[data-results]', root);
  const count = $('[data-count]', root);
  if (!box) return;
  if (st.loadErr) {
    count.textContent = '';
    box.innerHTML = String(emptyState({ ic: 'wifiOff', err: true, title: 'โหลดรายชื่อไม่สำเร็จ', action: html`<button class="btn sm" data-retry>${icon('refresh', 'sm')}ลองอีกครั้ง</button>` }));
    box.querySelector('[data-retry]').onclick = () => loadEmployees(true);
    return;
  }
  if (!st.employees) { count.textContent = 'กำลังโหลดรายชื่อ...'; box.innerHTML = String(skelLines(4, 40)); return; }
  if (!st.q && !st.showAll) {
    count.textContent = '';
    box.innerHTML = String(html`<p class="small muted" style="padding:8px 12px">พิมพ์ CN เพื่อค้นหา หรือกด Enter เพื่อแสดงทั้งหมด</p>`);
    return;
  }
  const list = matches();
  count.textContent = list.length ? `${st.q ? 'พบ' : 'พนักงานทั้งหมด'} ${list.length.toLocaleString('th-TH')} รายการ` : '';
  if (!list.length) {
    box.innerHTML = String(html`
      <div class="empty" style="padding:20px 8px;gap:8px">
        <div class="ill" style="width:52px;height:52px">${icon('userPlus')}</div>
        ${st.q ? html`<b style="font-weight:500">ไม่พบ CN <span class="num">${st.q}</span></b>
        <p class="small">ตรวจสอบเลขอีกครั้ง หรือเพิ่มเป็นพนักงานใหม่</p>` : html`<b style="font-weight:500">ยังไม่มีพนักงานในระบบ</b>`}
        <button type="button" class="btn sm" data-new-q>${icon('plus', 'sm')}เพิ่มพนักงานใหม่</button>
      </div>`);
    box.querySelector('[data-new-q]').onclick = () => newPatient(/^\d+$/.test(st.q) ? st.q : '');
    return;
  }
  box.innerHTML = String(html`${list.map((e) => {
    const al = safetyState(e.allergies);
    return html`<button type="button" class="res${e.id === st.id ? ' on' : ''}" data-id="${e.id}">
      <span style="flex:1;min-width:0"><span class="cn" style="display:block">${highlight(e.cn)}</span><span class="dept">${e.department || '-'}</span></span>
      ${openQueueOf(e.id) ? html`<span class="pill violet">ในคิว #${openQueueOf(e.id).no}</span>` : ''}
      ${al.state === 'has' ? html`<span class="warn-ic" title="แพ้ยา/อาหาร: ${al.items.join(', ')}">${icon('alert')}</span>` : ''}
    </button>`;
  })}`);
}

/* ---------------- profile ---------------- */
async function select(id, push = true) {
  st.id = id;
  st.patient = null; st.visits = null;
  if (push) syncParams();
  root.querySelectorAll('[data-results] .res').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  renderProfile();
  const token = ++st.token;
  try {
    const [patient, visits, lookup] = await Promise.all([api.getEmployee(id), api.listOpdCards(id, session.staff), st.lookup || api.icdLookup()]);
    if (token !== st.token) return;
    st.lookup = lookup;
    if (!patient) { st.id = ''; syncParams(); toast('ไม่พบข้อมูลพนักงาน', '', 'warn'); renderProfile(); return; }
    st.patient = patient; st.visits = visits;
  } catch (e) {
    console.error(e);
    if (token !== st.token) return;
    st.patient = { error: true };
  }
  renderProfile();
}

function safetyStrip(p) {
  const al = safetyState(p.allergies);
  const dz = safetyState(p.congenitalDisease);
  const alItem = al.state === 'has'
    ? html`<span class="it">${icon('alert')}แพ้ยา/อาหาร <span>${al.items.join(', ')}</span></span>`
    : al.state === 'none'
      ? html`<span class="it" style="color:var(--ok)">${icon('check')}แพ้ยา/อาหาร <span>ไม่มี</span></span>`
      : html`<span class="it" style="color:var(--caution)">${icon('alertCircle')}แพ้ยา/อาหาร <span>ยังไม่ระบุ</span></span>`;
  const dzItem = dz.state === 'has'
    ? html`<span class="it" style="color:var(--violet)">${icon('heart')}โรคประจำตัว <span>${dz.items.join(', ')}</span></span>`
    : html`<span class="it" style="color:var(--ink-3)">${icon(dz.state === 'none' ? 'check' : 'alertCircle')}โรคประจำตัว <span>${dz.state === 'none' ? 'ไม่มี' : 'ยังไม่ระบุ'}</span></span>`;
  return html`<div class="safety${al.state === 'has' ? '' : ' calm'}">${alItem}${dzItem}
    <button type="button" class="btn ghost" data-edit style="margin-left:auto;height:32px;${al.state === 'has' ? 'color:var(--danger)' : ''}">${icon('edit', 'sm')}แก้ไขข้อมูลความปลอดภัย</button></div>`;
}

function visitsInRange() {
  const list = st.visits || [];
  if (st.range === 'year') { const y = new Date().getFullYear(); return list.filter((v) => toDate(v.visitDate)?.getFullYear() === y); }
  return list;
}

function timeline() {
  if (!st.visits) return html`<div style="padding:12px;display:flex;flex-direction:column;gap:12px">${skelLines(4, 36)}</div>`;
  const list = visitsInRange();
  if (!list.length) return emptyState({ ic: 'clipboard', title: 'ยังไม่มีประวัติการรักษา', text: session.staff.isAdmin ? '' : `แสดงเฉพาะการรักษาที่ ${session.staff.location}` });
  return html`<div class="tl">${list.map((v, i) => {
    const icd = st.lookup?.(v.diagnosis);
    return html`<button type="button" class="tl-item" data-visit="${i}">
      <span class="tl-date num muted small">${dateShort(v.visitDate)}<br>${time(v.visitDate)}</span>
      <span class="tl-dot"><i></i></span>
      <span style="min-width:0"><b style="font-weight:500">${v.diagnosis || 'ไม่ระบุการวินิจฉัย'}</b> ${icd?.code ? html`<span class="muted num small">${icd.code}</span>` : ''}<br><span class="muted small">${v.chiefComplaint || '-'}</span></span>
      ${serviceTag(v.serviceType) || html`<span></span>`}
    </button>`;
  })}</div>`;
}

function renderProfile() {
  const box = $('[data-profile]', root);
  if (!box) return;
  if (!st.id) {
    box.innerHTML = String(html`<div class="card">${emptyState({ ic: 'user', title: 'เลือกพนักงาน', text: 'ค้นหาด้วย CN แล้วเลือกจากรายการทางซ้ายเพื่อดูโปรไฟล์และประวัติการรักษา' })}</div>`);
    return;
  }
  const p = st.patient;
  if (!p) {
    box.innerHTML = String(html`<div class="card" style="padding:24px;display:flex;flex-direction:column;gap:16px">${skelLines(3, 22)}</div><div class="card" style="padding:24px;display:flex;flex-direction:column;gap:14px">${skelLines(5, 36)}</div>`);
    return;
  }
  if (p.error) {
    box.innerHTML = String(html`<div class="card">${emptyState({ ic: 'wifiOff', err: true, title: 'โหลดข้อมูลพนักงานไม่สำเร็จ', text: 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง', action: html`<button class="btn" data-retry>${icon('refresh')}ลองอีกครั้ง</button>` })}</div>`);
    box.querySelector('[data-retry]').onclick = () => select(st.id, false);
    return;
  }
  const age = ageYears(p.birthdate);
  const yearCount = (st.visits || []).filter((v) => toDate(v.visitDate)?.getFullYear() === new Date().getFullYear()).length;
  box.innerHTML = String(html`
    <div class="card" style="padding:24px;display:flex;flex-direction:column;gap:20px">
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <span class="avatar num" style="width:52px;height:52px;font-size:16px">${(p.cn || '?').slice(0, 3)}</span>
        <div><div class="cn" style="font-size:24px">${p.cn}</div><div class="muted">${p.department || 'ไม่ระบุแผนก'}${p.createdDate ? ` · ลงทะเบียน ${dateShort(p.createdDate)}` : ''}</div></div>
        <span class="spacer"></span>
        <button type="button" class="btn" data-edit>${icon('edit')}แก้ไข</button>
        ${openQueueOf(p.id) ? html`<a class="btn" href="${href('queue', { tab: openQueueOf(p.id).status === 'waiting' ? '' : openQueueOf(p.id).status })}">${icon('queue')}อยู่ในคิว #${openQueueOf(p.id).no}</a>` : html`<button type="button" class="btn" data-to-queue>${icon('queue')}เพิ่มเข้าคิว</button>`}
        <a class="btn primary" href="${href('opd', openQueueOf(p.id) ? { emp: p.id, queue: openQueueOf(p.id).id } : { emp: p.id })}">${icon('clipboard')}บันทึกการรักษา</a>
      </div>
      ${safetyStrip(p)}
      <dl class="kv">
        <div><dt>วันเกิด</dt><dd class="num">${p.birthdate ? dateMedium(p.birthdate) : '-'}${age !== null ? ` · ${age} ปี` : ''}</dd></div>
        <div><dt>เบอร์โทร</dt><dd class="num">${phone(p.phone)}</dd></div>
        <div><dt>แผนก</dt><dd>${p.department || '-'}</dd></div>
        <div><dt>มารับบริการ</dt><dd class="num">${st.visits ? `${st.visits.length} ครั้ง · ปีนี้ ${yearCount}` : '…'}</dd></div>
      </dl>
    </div>
    <div class="card" style="padding:20px 16px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 12px 8px;flex-wrap:wrap">
        <div><h2>ประวัติการรักษา</h2>${session.staff.isAdmin ? '' : html`<span class="small muted">เฉพาะ ${session.staff.location}</span>`}</div>
        <select class="input" style="width:160px" data-range aria-label="ช่วงเวลา"><option value="all">ทั้งหมด</option><option value="year">ปีนี้</option></select>
      </div>
      <div data-tl>${timeline()}</div>
    </div>`);
  const range = $('[data-range]', box);
  range.value = st.range;
  range.onchange = () => { st.range = range.value; $('[data-tl]', box).innerHTML = String(timeline()); };
  box.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = editPatient));
  $('[data-to-queue]', box)?.addEventListener('click', () => addToQueue(st.patient.id));
}

/* ---------------- visit detail panel ---------------- */
function openVisit(v, onClose) {
  const icd = st.lookup?.(v.diagnosis);
  const meds = v.medicines || [];
  const unit = (u) => html`<span class="small muted">${u}</span>`;
  openLayer({
    kind: 'panel', light: true, onClose,
    content: html`
      <div style="display:flex;align-items:flex-start;gap:12px;padding:20px 24px;border-bottom:1px solid var(--line)">
        <div style="flex:1;min-width:0">
          <div class="small muted num">${dateMedium(v.visitDate)} · ${time(v.visitDate)}${v.location ? ` · ${v.location}` : ''}</div>
          <h2>${v.diagnosis || 'ไม่ระบุการวินิจฉัย'} ${icd?.code ? html`<span class="muted num" style="font-weight:400;font-size:14px">${icd.code}</span>` : ''}</h2>
          <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;align-items:center">${esiBadge(v.esiTriage)}${serviceTag(v.serviceType)}</div>
        </div>
        <button type="button" class="btn icon ghost" aria-label="ปิด" data-close>${icon('x')}</button>
      </div>
      <div style="flex:1;overflow:auto;padding:20px 24px;display:flex;flex-direction:column;gap:20px">
        <div class="vit">
          <div><small>Temp</small><b>${v.temperature || '-'} ${unit('°C')}</b></div>
          <div><small>Pulse</small><b>${v.pulse || '-'} ${unit('bpm')}</b></div>
          <div><small>RR</small><b>${v.respiration || '-'} ${unit('/min')}</b></div>
          <div><small>BP</small><b>${v.bloodPressure || '-'}</b></div>
          <div><small>SpO2</small><b>${v.oxygenSaturation || '-'} ${unit('%')}</b></div>
          <div><small>Pain</small><b>${v.painScore || '-'} ${unit('/10')}</b></div>
        </div>
        <dl class="dl">
          <dt>Chief complaint</dt><dd>${v.chiefComplaint || '-'}</dd>
          <dt>PI &amp; PE</dt><dd>${v.physicalExamination || '-'}</dd>
          <dt>Advice</dt><dd>${v.advice || '-'}</dd>
        </dl>
        <div style="display:flex;flex-direction:column;gap:4px">
          <span class="sec-title">ยาที่ได้รับ</span>
          ${meds.length ? meds.map((m) => html`<div class="med-line"><span>${m.name}${m.note ? html`<br><span class="small muted note">${m.note}</span>` : ''}</span><span class="num" style="white-space:nowrap">${m.quantity} ${m.unit || ''}</span></div>`)
            : html`<p class="muted" style="padding:8px 0">ไม่มีการจ่ายยา</p>`}
        </div>
        <p class="small muted">บันทึกโดย ${v.createdBy || '-'}${v.createdDate ? ` · ${dateShort(v.createdDate)} ${time(v.createdDate)}` : ''}</p>
      </div>`,
  });
}

/* ---------------- คิว ---------------- */
function openQueueOf(empId) {
  return (queueState().items || []).find((q) => q.employeeDocId === empId && api.OPEN_STATUSES.includes(q.status)) || null;
}
function addToQueue(empId) {
  openQueueRegister({
    employeeId: empId,
    onAdded: ({ no, start, id }) => { if (start) go('opd', { emp: empId, queue: id }); else { toast(`เพิ่มคิว #${no} แล้ว`); renderResults(); renderProfile(); } },
  });
}

/* ---------------- add / edit ---------------- */
function newPatient(cn) {
  openPatientForm({
    cn, employees: st.employees || [], queueOption: true,
    onSaved: async (id, opt = {}) => { st.q = (await api.getEmployee(id))?.cn || st.q; $('[data-page-search]', root).value = st.q; renderResults(); select(id); if (opt.addToQueue) addToQueue(id); },
  });
}

function editPatient() {
  if (!st.patient || st.patient.error) return;
  openPatientForm({
    patient: st.patient, employees: st.employees || [],
    onSaved: () => { renderResults(); select(st.id, false); },
  });
}
