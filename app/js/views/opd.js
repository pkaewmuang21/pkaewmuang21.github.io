// หน้า "บันทึกการรักษา" (OPD card) — #/opd?emp=<employeeDocId>
import { html, raw, icon, $, $$, emptyState, skelLines, toast, busy, confirmDialog } from '../core/ui.js';
import { session } from '../core/session.js';
import { go, href } from '../core/router.js';
import { dateShort, time, ageYears, phone, ymdhm, toDate } from '../core/format.js';
import { ESI, SERVICES, esiOf, esiBadge, serviceOf, safetyState } from '../core/codes.js';
import { queueState } from '../core/queue-store.js';
import { VITALS, PAIN_TEXT, allergyHit, medStatus } from '../core/clinical.js';
import { MODE } from '../config.js';
import * as api from '../data/api.js';

const ADVICE_CHIPS = ['หากอาการไม่ดีขึ้นใน 3 วันให้พบแพทย์', 'พักผ่อนให้เพียงพอ', 'ดื่มน้ำมากๆ', 'รับประทานยาตามฉลาก'];
const DRAFT_MAX_AGE = 12 * 3600 * 1000;
const FACES = [
  '<path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  '<path d="M8.5 14.5s1.3 1 3.5 1 3.5-1 3.5-1M9 9h.01M15 9h.01"/>',
  '<path d="M8 15h8M9 9h.01M15 9h.01"/>',
  '<path d="M16 16s-1.5-1.5-4-1.5S8 16 8 16M9 9h.01M15 9h.01"/>',
  '<path d="M16 17s-1.5-2.5-4-2.5S8 17 8 17M8 9l2 1M16 9l-2 1"/>',
];
const face = (i) => raw(`<svg class="face" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/>${FACES[i]}</svg>`);

let root, st, cleanup = [];

export default {
  async mount(el, params) {
    root = el;
    cleanup.forEach((fn) => fn()); cleanup = [];
    if (!params.emp) return mountPicker(params);
    await mountForm(params.emp, params.queue);
  },
  update(params) { this.mount(root, params); },
  unmount() { cleanup.forEach((fn) => fn()); cleanup = []; },
};

/* ======================================================================
 * ยังไม่ได้เลือกพนักงาน → ค้นหา CN
 * ==================================================================== */
async function mountPicker() {
  root.innerHTML = String(html`
    <div class="page">
      <div class="page-head"><div><h1>บันทึกการรักษา</h1><p>เลือกพนักงานก่อนเริ่มบันทึก</p></div>
        <div class="tools"><a class="btn" href="${href('patients')}">${icon('userPlus')}เพิ่มพนักงานใหม่ที่หน้าค้นหาพนักงาน</a></div></div>
      <div class="card" style="padding:20px;display:flex;flex-direction:column;gap:12px;max-width:560px">
        <label class="search big">${icon('search')}<input type="text" inputmode="numeric" autocomplete="off" data-page-search placeholder="พิมพ์ CN หรือ Enter ดูทั้งหมด" aria-label="ค้นหา CN" class="num" autofocus></label>
        <span class="small muted" data-count></span>
        <div class="results" data-results style="display:flex;flex-direction:column;gap:2px"></div>
      </div>
    </div>`);
  const input = $('[data-page-search]', root);
  const box = $('[data-results]', root);
  const count = $('[data-count]', root);
  input.focus();
  let employees = null, all = false;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!employees) { box.innerHTML = String(skelLines(3, 40)); return; }
    if (!q && !all) { count.textContent = ''; box.innerHTML = '<p class="small muted" style="padding:8px 12px">พิมพ์ CN เพื่อค้นหา หรือกด Enter เพื่อแสดงทั้งหมด</p>'; return; }
    const list = employees.filter((e) => !q || (e.cn || '').toLowerCase().includes(q)).sort((a, b) => (a.cn || '').localeCompare(b.cn || ''));
    count.textContent = list.length ? `${q ? 'พบ' : 'พนักงานทั้งหมด'} ${list.length} รายการ` : '';
    box.innerHTML = String(list.length ? html`${list.map((e) => {
      const al = safetyState(e.allergies);
      return html`<button type="button" class="res" data-id="${e.id}"><span style="flex:1"><span class="cn" style="display:block">${e.cn}</span><span class="dept">${e.department || '-'}</span></span>${al.state === 'has' ? html`<span class="warn-ic">${icon('alert')}</span>` : ''}${icon('chevronRight', 'sm')}</button>`;
    })}` : html`<p class="muted small" style="padding:8px 12px">ไม่พบ CN ${input.value.trim()} — <a href="${href('patients', { q: input.value.trim() })}">เพิ่มพนักงานใหม่</a></p>`);
  };
  input.addEventListener('input', () => { if (!input.value.trim()) all = false; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!input.value.trim() && !all) { all = true; render(); return; }
    box.querySelector('.res')?.click();
  });
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) go('opd', { emp: b.dataset.id }); });
  render();
  try { employees = await api.getEmployees(); render(); }
  catch { box.innerHTML = String(emptyState({ ic: 'wifiOff', err: true, title: 'โหลดรายชื่อไม่สำเร็จ' })); }
}

/* ======================================================================
 * ฟอร์มบันทึกการรักษา
 * ==================================================================== */
const blankForm = () => ({
  visitDate: ymdhm(new Date()), esi: 0, service: '',
  temperature: '', pulse: '', respiration: '', bloodPressure: '', oxygenSaturation: '', painScore: '',
  chiefComplaint: '', physicalExamination: '', dx: null, advice: '',
});

async function mountForm(empId, queueId = '') {
  st = { empId, queue: null, prefilled: false, f: blankForm(), items: [], patient: null, visits: [], meds: [], icd: [], icdMap: {}, allergies: [], showErr: false, draftAt: null, saving: false, typeFilter: '' };
  root.innerHTML = String(html`<div class="page"><div class="card" style="padding:24px;display:flex;flex-direction:column;gap:14px">${skelLines(5, 28)}</div></div>`);
  try {
    const [patient, visits, meds, icd, icdMap] = await Promise.all([
      api.getEmployee(empId), api.listOpdCards(empId, session.staff), api.listMedicines({ refresh: true }), api.getIcd10(), api.getIcdCategoryMap(),
    ]);
    if (!patient) { root.innerHTML = String(html`<div class="page"><div class="card">${emptyState({ ic: 'user', title: 'ไม่พบข้อมูลพนักงาน', action: html`<a class="btn" href="${href('opd')}">เลือกพนักงานใหม่</a>` })}</div></div>`); return; }
    Object.assign(st, { patient, visits, meds, icd, icdMap, allergies: safetyState(patient.allergies).items });
  } catch (e) {
    console.error(e);
    root.innerHTML = String(html`<div class="page"><div class="card">${emptyState({ ic: 'wifiOff', err: true, title: 'โหลดข้อมูลไม่สำเร็จ', text: 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง', action: html`<button class="btn" data-retry>${icon('refresh')}ลองอีกครั้ง</button>` })}</div></div>`);
    $('[data-retry]', root).onclick = () => mountForm(empId, queueId);
    return;
  }
  // คิวที่ผูกกับการรักษานี้: จาก ?queue= หรือคิวที่ยังเปิดอยู่ของพนักงานคนนี้วันนี้
  try {
    let q = queueId ? await api.getQueue(queueId) : null;
    if (q && q.employeeDocId !== empId) q = null;
    if (!q) q = (queueState().items || []).find((x) => x.employeeDocId === empId && api.OPEN_STATUSES.includes(x.status)) || null;
    if (q && api.OPEN_STATUSES.includes(q.status)) st.queue = q;
  } catch (e) { console.error('load queue', e); }
  const restored = loadDraft();
  if (!restored && st.queue) {
    const q = st.queue;
    st.f.chiefComplaint = q.chiefComplaint || '';
    st.f.esi = Number(q.esi) || 0;
    const arr = toDate(q.arrivedAt);
    if (arr) st.f.visitDate = ymdhm(arr);
    st.prefilled = true;
  }
  renderForm();
  if (restored) toast('กู้คืนร่างที่ยังไม่บันทึก', `บันทึกร่างล่าสุด ${time(st.draftAt)}`, 'info', 5000);
}

/* ---------------- draft (localStorage) ---------------- */
const draftKey = () => `pgfa-opd-draft:${MODE}:${st.empId}`;
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey()) || 'null');
    if (!d || Date.now() - d.at > DRAFT_MAX_AGE) { localStorage.removeItem(draftKey()); return false; }
    st.f = { ...blankForm(), ...d.f };
    st.items = d.items || [];
    st.draftAt = new Date(d.at);
    return true;
  } catch { return false; }
}
let draftTimer, draftPending = null;
/** เขียนร่างที่ค้างอยู่ทันที (ก่อนปิด/รีเฟรช/ออกจากหน้า) */
function flushDraft() { if (draftPending) { clearTimeout(draftTimer); draftPending(); } }
function saveDraft() {
  clearTimeout(draftTimer);
  draftPending = () => {
    draftPending = null;
    const f = st.f;
    const empty = !f.esi && !f.service && !f.chiefComplaint && !f.physicalExamination && !f.dx && !f.advice && !st.items.length && !VITALS.some((v) => f[v.key]) && f.painScore === '';
    try {
      if (empty) { localStorage.removeItem(draftKey()); st.draftAt = null; }
      else { st.draftAt = new Date(); localStorage.setItem(draftKey(), JSON.stringify({ at: Date.now(), f, items: st.items })); }
    } catch { /* storage เต็ม/ปิด */ }
    renderDraftInfo();
  };
  draftTimer = setTimeout(draftPending, 600);
}
function clearDraft() { clearTimeout(draftTimer); draftPending = null; try { localStorage.removeItem(draftKey()); } catch { /* ignore */ } st.draftAt = null; }

/* ---------------- layout ---------------- */
function renderForm() {
  const p = st.patient;
  const age = ageYears(p.birthdate);
  const last = st.visits[0];
  const al = safetyState(p.allergies), dz = safetyState(p.congenitalDisease);
  root.innerHTML = String(html`
    <div class="ptbar">
      <div class="row">
        <a class="btn icon ghost" href="${href('patients', { q: p.cn, id: p.id })}" aria-label="กลับไปโปรไฟล์พนักงาน">${icon('arrowLeft')}</a>
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span class="cn" style="font-size:22px">${p.cn}</span><span class="muted">${[p.department, age !== null ? `${age} ปี` : '', p.phone ? phone(p.phone) : ''].filter(Boolean).join(' · ')}</span></div>
        ${st.queue ? html`<span class="pill navy num">คิว #${st.queue.no} · มาถึง ${time(st.queue.arrivedAt)}</span>${esiBadge(st.queue.esi)}` : ''}
        <span class="spacer"></span>
        <a href="${href('patients', { q: p.cn, id: p.id })}" class="small">${st.visits.length ? `ประวัติการรักษา ${st.visits.length} ครั้ง · ล่าสุด ${dateShort(last.visitDate)}` : 'ยังไม่มีประวัติการรักษา'}</a>
      </div>
      <div class="safety${al.state === 'has' ? '' : ' calm'}" role="${al.state === 'has' ? 'alert' : 'note'}">
        ${al.state === 'has' ? html`<span class="it">${icon('alert')}แพ้ยา/อาหาร <span>${al.items.join(', ')}</span></span>`
          : html`<span class="it" style="color:${al.state === 'none' ? 'var(--ok)' : 'var(--caution)'}">${icon(al.state === 'none' ? 'check' : 'alertCircle')}แพ้ยา/อาหาร <span>${al.state === 'none' ? 'ไม่มี' : 'ยังไม่ระบุ'}</span></span>`}
        ${dz.state === 'has' ? html`<span class="it" style="color:var(--violet)">${icon('heart')}โรคประจำตัว <span>${dz.items.join(', ')}</span></span>`
          : html`<span class="it" style="color:var(--ink-3)">${icon(dz.state === 'none' ? 'check' : 'alertCircle')}โรคประจำตัว <span>${dz.state === 'none' ? 'ไม่มี' : 'ยังไม่ระบุ'}</span></span>`}
      </div>
    </div>
    <div class="page" style="padding-top:24px">
      <div class="opd">
        <nav class="toc" aria-label="ส่วนของฟอร์ม">
          ${[['s1', '1 · การเข้ารับบริการ'], ['s2', '2 · Vital signs'], ['s3', '3 · อาการ / วินิจฉัย'], ['s4', '4 · รายการยา']].map(([id, t]) => html`<a href="#${id}" data-toc="${id}">${t}<span class="st"></span></a>`)}
          <p class="small muted" style="padding:12px 10px;line-height:1.5" data-draft></p>
        </nav>
        <form class="form" novalidate data-form>
          ${sec1()}${sec2()}${sec3()}${sec4()}
          <div class="savebar">
            <span class="hint" data-save-hint style="font-size:13.5px"></span>
            <span class="spacer"></span>
            <button type="button" class="btn ghost" data-reset>ล้างฟอร์ม</button>
            ${st.queue ? html`<a class="btn ghost" href="${href('queue')}">กลับไปคิว</a>${st.queue.status !== 'observe' ? html`<button type="button" class="btn" data-observe>${icon('bed')}ย้ายไปห้องสังเกตอาการ</button>` : ''}` : ''}
            <button type="button" class="btn primary" data-save>${icon('check')}${st.queue ? 'บันทึกและปิดคิว' : 'บันทึกการรักษา'}<span class="kbd">Ctrl S</span></button>
          </div>
        </form>
      </div>
    </div>`);
  bind();
  renderEsi(); renderSvc(); renderVitals(); renderPain(); renderDx(); renderMeds(); renderStatus(); renderDraftInfo();
}

function sec1() {
  return html`
    <section class="sec" id="s1">
      <div class="sec-h"><span class="no">1</span><h2>การเข้ารับบริการ</h2>${st.prefilled ? html`<span class="pill turq" style="margin-left:auto">${icon('queue')}กรอกจากคิวแล้ว</span>` : ''}</div>
      <div class="g3">
        <label class="field"><span class="label">วันที่/เวลาเข้ารับบริการ <span class="req">*</span></span><input class="input num" type="datetime-local" name="visitDate" max="${ymdhm(new Date(Date.now() + 3600000))}"></label>
        <label class="field"><span class="label">Location</span><input class="input" value="${session.staff.location || '-'}" readonly style="background:var(--bg)"></label>
        <label class="field"><span class="label">ผู้บันทึก</span><input class="input" value="${session.staff.name}" readonly style="background:var(--bg)"></label>
      </div>
      <div class="field"><span class="label">ESI triage <span class="req">*</span></span>
        <div class="esi-row" role="radiogroup" aria-label="ESI triage" data-esi>
          ${ESI.map((e) => html`<button type="button" class="esi-btn" data-n="${e.n}" title="${e.target}"><span class="esi esi-${e.n}"><b>${e.n}</b>${e.name}</span></button>`)}
        </div>
        <span class="hint err" data-err="esi" hidden></span>
      </div>
      <div class="field"><span class="label">ประเภทบริการ <span class="req">*</span></span>
        <div class="svc-pick" role="radiogroup" aria-label="ประเภทบริการ" data-svc>
          ${SERVICES.map((s) => html`<button type="button" class="svc-opt${s.em ? ' em' : ''}" data-v="${s.value}">${icon(s.ic)}${s.value}</button>`)}
        </div>
        <span class="hint err" data-err="service" hidden></span>
      </div>
    </section>`;
}

function sec2() {
  return html`
    <section class="sec" id="s2">
      <div class="sec-h"><span class="no">2</span><h2>Vital signs</h2><span style="margin-left:auto" data-abn></span></div>
      <div class="g3">
        ${VITALS.map((v) => html`
          <label class="field" data-vital="${v.key}"><span class="label" style="display:flex;align-items:center;gap:6px">${icon(v.ic, 'sm')}${v.label}</span>
            <span class="unit-input"><input type="text" name="${v.key}" inputmode="${v.mode === 'text' ? 'text' : v.mode}" autocomplete="off" placeholder="${v.placeholder || ''}"><span>${v.unit}</span></span>
            <span class="hint">${v.normal}</span></label>`)}
      </div>
      <div class="field">
        <span class="label">Pain score <span class="muted" style="font-weight:400" data-pain-text></span></span>
        <div class="pain" role="radiogroup" aria-label="Pain score" data-pain>${Array.from({ length: 11 }, (_, i) => html`<button type="button" data-p="${i}">${i}</button>`)}</div>
        <div class="pain-lbl"><span>${face(0)}ไม่ปวด</span><span>${face(1)}เล็กน้อย</span><span>${face(2)}ปานกลาง</span><span>${face(3)}มาก</span><span>${face(4)}มากที่สุด</span></div>
      </div>
    </section>`;
}

function sec3() {
  return html`
    <section class="sec" id="s3">
      <div class="sec-h"><span class="no">3</span><h2>อาการและการวินิจฉัย</h2></div>
      <label class="field"><span class="label">Chief complaint <span class="req">*</span></span><input class="input" name="chiefComplaint" autocomplete="off"><span class="hint err" data-err="chiefComplaint" hidden></span></label>
      <label class="field"><span class="label">PI &amp; PE</span><textarea class="input" rows="3" name="physicalExamination"></textarea></label>
      <div class="field">
        <span class="label">Diagnosis (ICD-10) <span class="req">*</span></span>
        <div class="icd-box" data-icd-box></div>
        <span class="hint err" data-err="dx" hidden></span>
      </div>
      <div class="field">
        <span class="label">Advice</span>
        <textarea class="input" rows="2" name="advice"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${ADVICE_CHIPS.map((c) => html`<button type="button" class="tchip" data-advice="${c}">+ ${c}</button>`)}</div>
      </div>
    </section>`;
}

function sec4() {
  const types = [...new Set(st.meds.map((m) => m.type).filter(Boolean))].sort();
  return html`
    <section class="sec" id="s4">
      <div class="sec-h"><span class="no">4</span><h2>รายการยา</h2><span class="muted small" style="margin-left:auto" data-med-count></span></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div data-sugg style="display:flex;flex-direction:column;gap:10px"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="med-search">
            <label class="search big" style="width:100%">${icon('search')}<input type="text" autocomplete="off" placeholder="ค้นหาชื่อยาเพื่อเพิ่ม" aria-label="ค้นหายา" data-med-q></label>
            <div class="dd" data-med-dd hidden></div>
          </div>
          <select class="input" style="width:260px" aria-label="กรองประเภทยา" data-type><option value="">ทุกประเภท</option>${types.map((t) => html`<option>${t}</option>`)}</select>
        </div>
      </div>
      <div data-med-table></div>
    </section>`;
}

/* ---------------- events ---------------- */
function bind() {
  const form = $('[data-form]', root);
  const f = st.f;
  // ค่าเริ่มต้นของ input ข้อความ
  ['visitDate', 'chiefComplaint', 'physicalExamination', 'advice', ...VITALS.map((v) => v.key)].forEach((k) => { form[k].value = f[k] || ''; });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const k = e.target.name;
    if (!k || !(k in f)) return;
    f[k] = e.target.value;
    if (VITALS.some((v) => v.key === k)) renderVitals();
    if (k === 'chiefComplaint' && f[k].trim()) hideErr('chiefComplaint');
    renderStatus(); saveDraft();
  });

  $('[data-esi]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    f.esi = +b.dataset.n; hideErr('esi'); renderEsi(); renderStatus(); saveDraft();
  });
  $('[data-svc]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    f.service = b.dataset.v; hideErr('service'); renderSvc(); renderStatus(); saveDraft();
  });
  $('[data-pain]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    f.painScore = f.painScore === b.dataset.p ? '' : b.dataset.p; renderPain(); saveDraft();
  });
  form.addEventListener('click', (e) => {
    const a = e.target.closest('[data-advice]');
    if (a) { const t = form.advice; t.value = (t.value.trim() ? t.value.trim() + '\n' : '') + a.dataset.advice; f.advice = t.value; saveDraft(); }
  });

  bindIcd(); bindMeds();

  $('[data-reset]', root).addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'ล้างฟอร์ม?', message: 'ข้อมูลที่กรอกและร่างที่บันทึกไว้จะถูกลบ', okText: 'ล้างฟอร์ม', danger: true }))) return;
    clearDraft(); st.f = blankForm(); st.items = []; st.showErr = false; renderForm();
  });
  $('[data-save]', root).addEventListener('click', save);
  $('[data-observe]', root)?.addEventListener('click', async (e) => {
    flushDraft();
    busy(e.currentTarget, true);
    try {
      await api.observeQueue(st.queue.id, session.staff, st.queue.startedAt);
      toast(`ย้ายคิว #${st.queue.no} ไปห้องสังเกตอาการแล้ว`, 'ข้อมูลที่กรอกถูกบันทึกเป็นร่างไว้ กลับมาประเมินซ้ำได้จากหน้าคิว');
      go('queue');
    } catch (err) { console.error(err); busy(e.currentTarget, false); toast('ย้ายไม่สำเร็จ', '', 'err'); }
  });

  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!document.querySelector('.layer')) save(); }
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const secs = $$('.sec', root);
      const cur = secs.findIndex((s) => s.contains(document.activeElement));
      const next = secs[Math.max(0, Math.min(secs.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))];
      next.scrollIntoView({ behavior: 'smooth' });
      next.querySelector('input:not([readonly]),textarea,button')?.focus({ preventScroll: true });
    }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', flushDraft);
  cleanup.push(() => { document.removeEventListener('keydown', onKey); window.removeEventListener('pagehide', flushDraft); flushDraft(); });

  // TOC: ไฮไลต์ส่วนที่กำลังดู
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) $$('[data-toc]', root).forEach((a) => a.classList.toggle('on', a.dataset.toc === en.target.id)); });
  }, { rootMargin: '-40% 0px -55% 0px' });
  $$('.sec', root).forEach((s) => io.observe(s));
  cleanup.push(() => io.disconnect());
  $$('[data-toc]', root).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); $('#' + a.dataset.toc, root).scrollIntoView({ behavior: 'smooth' }); }));
}

/* ---------------- section renders ---------------- */
function renderEsi() {
  $$('[data-esi] [data-n]', root).forEach((b) => { const on = +b.dataset.n === st.f.esi; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}
function renderSvc() {
  $$('[data-svc] [data-v]', root).forEach((b) => { const on = b.dataset.v === st.f.service; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}
function vitalIssues() {
  return VITALS.map((v) => ({ v, r: v.check(st.f[v.key]) })).filter((x) => x.r);
}
function renderVitals() {
  VITALS.forEach((v) => {
    const wrap = $(`[data-vital="${v.key}"]`, root);
    const r = v.check(st.f[v.key]);
    wrap.querySelector('.unit-input').classList.toggle('abn', !!r);
    const hint = wrap.querySelector('.hint');
    hint.classList.toggle('err', !!r);
    hint.innerHTML = String(r ? html`${r.dir ? icon(r.dir === 'up' ? 'arrowUp' : 'arrowDown') : icon('alertCircle')}${r.msg}` : html`${v.normal}`);
  });
  const n = vitalIssues().length;
  $('[data-abn]', root).innerHTML = String(n ? html`<span class="pill danger">${icon('alert')}ผิดปกติ ${n} ค่า</span>` : '');
}
function renderPain() {
  const p = st.f.painScore;
  $$('[data-pain] [data-p]', root).forEach((b) => { const on = b.dataset.p === p; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('[data-pain-text]', root).textContent = p === '' ? '· ยังไม่ระบุ' : `· ${p} / 10 ${PAIN_TEXT[+p]}`;
}

/* ---------------- ICD-10 picker ---------------- */
function bindIcd() {
  const box = $('[data-icd-box]', root);
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-dx-rm]')) { st.f.dx = null; renderDx(); renderMeds(); renderStatus(); saveDraft(); box.querySelector('input')?.focus(); return; }
    const opt = e.target.closest('[data-icd]');
    if (opt) pickIcd(st.icd[+opt.dataset.icd]);
  });
}
function pickIcd(x) {
  st.f.dx = { code: x.code || '', short_description: x.short_description, disease_system: x.disease_system || '' };
  hideErr('dx'); renderDx(); renderMeds(); renderStatus(); saveDraft();
}
function renderDx() {
  const box = $('[data-icd-box]', root);
  const dx = st.f.dx;
  if (dx) {
    box.innerHTML = String(html`<span class="icd">${dx.code ? html`<b>${dx.code}</b>` : ''}${dx.short_description}${dx.disease_system ? html`<small>${dx.disease_system}</small>` : ''}<button type="button" aria-label="ลบการวินิจฉัย" data-dx-rm>${icon('x', 'sm')}</button></span>`);
    box.onclick = null; box.onmousedown = null;
    return;
  }
  box.innerHTML = String(html`<input type="text" placeholder="พิมพ์รหัสหรือชื่อโรค เช่น R51, headache · กด Enter เพื่อดูทั้งหมด" aria-label="ค้นหา ICD-10" autocomplete="off" data-icd-q><div class="dd" data-icd-dd hidden></div>`);
  const input = $('[data-icd-q]', box);
  const dd = $('[data-icd-dd]', box);
  let act = 0, list = [], showAll = false;
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    if (!q && !showAll) { dd.hidden = true; return; }
    // ช่องว่าง + Enter = แสดงทั้งหมด (เรียงตามชื่อ), มีคำค้น = แสดงทุกรายการที่ตรง เรียงตามความใกล้เคียง
    list = q
      ? st.icd.map((x, i) => ({ x, i, s: score(x, q) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s)
      : st.icd.map((x, i) => ({ x, i }));
    act = Math.min(act, Math.max(0, list.length - 1));
    dd.hidden = false;
    dd.innerHTML = String(list.length ? html`${list.map((r, k) => html`<button type="button" class="${k === act ? 'act' : ''}" data-icd="${r.i}"><span class="code">${r.x.code || ''}</span><span>${r.x.short_description}</span><span class="sub">${r.x.disease_system || ''}</span></button>`)}`
      : html`<div class="empty-dd">ไม่พบ ICD-10 ที่ตรงกับ “${input.value.trim()}”</div>`);
    dd.querySelector('.act')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { act = 0; if (!input.value.trim()) showAll = false; draw(); });
  input.addEventListener('focus', draw);
  // กดตรงไหนในกล่องก็ได้ (รวมช่องพิมพ์) → เปิดรายการ ICD-10 ทั้งหมด (หรือผลค้นหาถ้าพิมพ์ไว้)
  box.onclick = (e) => {
    if (e.target.closest('[data-icd]')) return;
    if (!input.value.trim()) showAll = true;
    if (document.activeElement !== input) input.focus();
    draw();
  };
  // กดในกล่อง (ขอบ/รายการ) ไม่ให้ช่องพิมพ์เสีย focus — กันรายการถูกซ่อนจาก blur ระหว่างกด
  box.onmousedown = (e) => { if (e.target !== input) e.preventDefault(); };
  let blurTimer;
  input.addEventListener('focus', () => clearTimeout(blurTimer));
  input.addEventListener('blur', () => { blurTimer = setTimeout(() => { dd.hidden = true; showAll = false; }, 150); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !input.value.trim() && dd.hidden) { e.preventDefault(); showAll = true; act = 0; draw(); return; }
    if (dd.hidden || !list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); act = (act + 1) % list.length; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); act = (act - 1 + list.length) % list.length; draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); pickIcd(list[act].x); }
    else if (e.key === 'Escape') { e.stopPropagation(); dd.hidden = true; }
  });
}
function score(x, q) {
  const code = (x.code || '').toLowerCase(), name = (x.short_description || '').toLowerCase();
  if (code === q) return 100;
  if (code.startsWith(q)) return 80;
  if (name.startsWith(q)) return 60;
  if (name.split(/[\s,()]+/).some((w) => w.startsWith(q))) return 50;
  if (name.includes(q) || code.includes(q)) return 30;
  return 0;
}

/* ---------------- รายการยา ---------------- */
const medOf = (name) => st.meds.find((m) => m.name === name);
const usedQty = (name) => st.items.filter((i) => i.name === name).reduce((s, i) => s + (Number(i.quantity) || 0), 0);

function stockPills(m, after) {
  if (!m) return html`<span class="pill">ไม่มีในคลัง</span>`;
  const s = medStatus(m, after);
  const out = [];
  if (after < 0) out.push(html`<span class="pill danger">${icon('ban')}<span class="num">${m.qty} → ${after}</span> สต็อกไม่พอ</span>`);
  else if (s.out) out.push(html`<span class="pill danger">${icon('ban')}<span class="num">${m.qty} → ${after}</span> หมด</span>`);
  else if (s.low) out.push(html`<span class="pill warn">${icon('bars')}<span class="num">${m.qty} → ${after}</span> ใกล้หมด</span>`);
  else out.push(html`<span class="pill ok">${icon('checkCircle')}<span class="num">${m.qty} → ${after}</span></span>`);
  if (s.expired) out.push(html`<span class="pill expired">${icon('xCircle')}หมดอายุแล้ว</span>`);
  else if (s.expiring) out.push(html`<span class="pill caution">${icon('calendar')}หมดอายุใน ${s.days} วัน</span>`);
  return html`${out}`;
}

function bindMeds() {
  const q = $('[data-med-q]', root);
  const dd = $('[data-med-dd]', root);
  const typeSel = $('[data-type]', root);
  let act = 0, list = [];
  const draw = (force) => {
    const text = q.value.trim().toLowerCase();
    if (!text && !force) { dd.hidden = true; return; }
    list = st.meds.filter((m) => (!st.typeFilter || m.type === st.typeFilter) && (!text || (m.name || '').toLowerCase().includes(text))).slice(0, 30);
    act = Math.min(act, Math.max(0, list.length - 1));
    dd.hidden = false;
    dd.innerHTML = String(list.length ? html`${list.map((m, k) => {
      const s = medStatus(m);
      const hit = allergyHit(m.name, st.allergies);
      return html`<button type="button" class="${k === act ? 'act' : ''}" data-add="${m.name}">
        ${hit ? html`<span style="color:var(--danger)" title="อาจแพ้">${icon('alert', 'sm')}</span>` : icon('plus', 'sm')}
        <span>${m.name}<br><span class="small muted">${m.type || ''}</span></span>
        <span class="sub num" style="${s.out ? 'color:var(--danger)' : s.low ? 'color:var(--warn)' : ''}">${s.expired ? 'หมดอายุ · ' : ''}${m.qty} ${m.unit || ''}</span></button>`;
    })}` : html`<div class="empty-dd">ไม่พบยา “${q.value.trim()}”</div>`);
  };
  q.addEventListener('input', () => { act = 0; draw(); });
  q.addEventListener('focus', () => draw(!!st.typeFilter));
  q.addEventListener('blur', () => setTimeout(() => { dd.hidden = true; }, 150));
  q.addEventListener('keydown', (e) => {
    if (dd.hidden || !list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); act = (act + 1) % list.length; draw(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); act = (act - 1 + list.length) % list.length; draw(true); }
    else if (e.key === 'Enter') { e.preventDefault(); addMed(list[act].name); q.value = ''; dd.hidden = true; }
    else if (e.key === 'Escape') { e.stopPropagation(); dd.hidden = true; }
  });
  typeSel.addEventListener('change', () => { st.typeFilter = typeSel.value; q.focus(); draw(true); });
  $('[data-form]', root).addEventListener('mousedown', (e) => { const b = e.target.closest('[data-add]'); if (b) { e.preventDefault(); addMed(b.dataset.add); q.value = ''; dd.hidden = true; } });

  const table = $('[data-med-table]', root);
  table.addEventListener('input', (e) => {
    const row = e.target.closest('[data-row]'); if (!row) return;
    const it = st.items[+row.dataset.row];
    if (e.target.name === 'qty') { it.quantity = e.target.value.replace(/[^\d]/g, ''); if (e.target.value !== it.quantity) e.target.value = it.quantity; refreshStock(); }
    if (e.target.name === 'noteText') it.note = e.target.value;
    renderStatus(); saveDraft();
  });
  table.addEventListener('change', (e) => {
    if (e.target.name !== 'usage') return;
    const row = e.target.closest('[data-row]');
    const it = st.items[+row.dataset.row];
    if (e.target.value === '__custom') { it.custom = true; it.note = ''; } else { it.custom = false; it.note = e.target.value; }
    renderMeds(); saveDraft();
    if (it.custom) $(`[data-row="${row.dataset.row}"] [name="noteText"]`, root)?.focus();
  });
  table.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { st.items.splice(+rm.dataset.rm, 1); renderMeds(); renderStatus(); saveDraft(); return; }
    const ack = e.target.closest('[data-ack]');
    if (ack) { st.items[+ack.dataset.ack].ack = true; renderMeds(); renderStatus(); saveDraft(); }
  });
}

function addMed(name) {
  const m = medOf(name); if (!m) return;
  const exist = st.items.findIndex((i) => i.name === name);
  if (exist >= 0) { $(`[data-row="${exist}"] [name="qty"]`, root)?.focus(); toast('มียานี้ในรายการแล้ว', 'ปรับจำนวนได้ที่ช่องจำนวน', 'info', 2500); return; }
  st.items.push({ name: m.name, type: m.type || '', unit: m.unit || '', quantity: '1', note: m.usage[0] || '', custom: !m.usage.length, ack: false });
  renderMeds(); renderStatus(); saveDraft();
  const i = st.items.length - 1;
  const qi = $(`[data-row="${i}"] [name="qty"]`, root);
  qi?.focus(); qi?.select();
}

function refreshStock() {
  st.items.forEach((it, i) => {
    const cell = $(`[data-row="${i}"] [data-stock]`, root);
    const m = medOf(it.name);
    if (cell) cell.innerHTML = String(stockPills(m, m ? m.qty - usedQty(it.name) : 0));
  });
}

function renderMeds() {
  // ยาแนะนำตามการวินิจฉัย
  const sugg = $('[data-sugg]', root);
  const dx = st.f.dx;
  const cat = dx?.code ? st.icdMap[dx.code] : '';
  if (cat) {
    const list = st.meds
      .filter((m) => m.type === cat && !st.items.some((i) => i.name === m.name) && !allergyHit(m.name, st.allergies))
      .map((m) => ({ m, s: medStatus(m) }))
      .sort((a, b) => (a.s.expired - b.s.expired) || (a.s.out - b.s.out) || b.m.qty - a.m.qty)
      .slice(0, 5);
    const hidden = st.meds.some((m) => m.type === cat && allergyHit(m.name, st.allergies));
    sugg.innerHTML = String(html`
      <span class="hint">${icon('bulb')}แนะนำจาก ${dx.code} → <b style="color:var(--ink-2);font-weight:500">${cat}</b>${hidden ? ' · ซ่อนยาที่ตรงกับประวัติแพ้แล้ว' : ''}</span>
      ${list.length ? html`<div style="display:flex;gap:8px;flex-wrap:wrap">${list.map(({ m, s }) => html`<button type="button" class="sugg" data-add="${m.name}">${icon('plus', 'sm')}${m.name}${s.expired ? html`<small style="color:var(--danger)">· หมดอายุ</small>` : s.out ? html`<small style="color:var(--danger)">· หมด</small>` : s.low ? html`<small class="num" style="color:var(--warn)">· ${m.qty} ใกล้หมด</small>` : s.expiring ? html`<small style="color:var(--caution)">· หมดอายุใน ${s.days} วัน</small>` : html`<small class="num">· ${m.qty} ${m.unit || ''}</small>`}</button>`)}</div>` : ''}`);
  } else sugg.innerHTML = '';

  $('[data-med-count]', root).textContent = st.items.length ? `${st.items.length} รายการ` : '';
  const table = $('[data-med-table]', root);
  if (!st.items.length) {
    table.innerHTML = String(html`<div class="empty" style="padding:28px 16px;gap:8px;border:1px dashed var(--line-2);border-radius:var(--r-md)"><div class="ill" style="width:52px;height:52px">${icon('pill')}</div><b style="font-weight:500">ยังไม่มีรายการยา</b><p class="small">ค้นหาชื่อยาด้านบนเพื่อเพิ่ม · ไม่จ่ายยาก็บันทึกได้</p></div>`);
    return;
  }
  table.innerHTML = String(html`
    <div class="scroll-x" style="border:1px solid var(--line);border-radius:var(--r-md)">
      <table class="table med-t">
        <thead><tr><th style="width:22%">ยา</th><th style="width:116px">จำนวน</th><th>วิธีใช้</th><th style="width:196px">คลัง</th><th style="width:56px"></th></tr></thead>
        <tbody>${st.items.map((it, i) => {
          const m = medOf(it.name);
          const hit = allergyHit(it.name, st.allergies);
          const bad = hit && !it.ack;
          const usages = m?.usage || [];
          const custom = it.custom || (it.note && !usages.includes(it.note));
          return html`
            <tr data-row="${i}" class="${bad ? 'bad' : hit ? 'ack' : ''}">
              <td><div style="font-weight:500">${it.name}</div><div class="dept">${it.type}</div></td>
              <td><span class="unit-input" style="height:40px"><input type="text" inputmode="numeric" name="qty" value="${it.quantity}" style="font-size:15px" aria-label="จำนวน ${it.name}"><span>${it.unit}</span></span></td>
              <td>
                ${usages.length ? html`<select class="input" name="usage" aria-label="วิธีใช้">${usages.map((u) => html`<option value="${u}" ${!custom && it.note === u ? 'selected' : ''}>${u}</option>`)}<option value="__custom" ${custom ? 'selected' : ''}>พิมพ์วิธีใช้เอง…</option></select>` : ''}
                ${custom || !usages.length ? html`<input class="input" name="noteText" value="${it.note}" placeholder="วิธีใช้ / หมายเหตุ" style="margin-top:${usages.length ? '6px' : '0'}">` : ''}
              </td>
              <td><div class="stock" data-stock>${stockPills(m, m ? m.qty - usedQty(it.name) : 0)}</div></td>
              <td><button type="button" class="btn icon ghost" aria-label="ลบ ${it.name}" data-rm="${i}">${icon('trash')}</button></td>
            </tr>
            ${bad ? html`<tr class="bad"><td colspan="5" style="padding-top:0">
              <div class="med-alert" role="alert">${icon('alert', 'lg')}
                <div style="flex:1;min-width:220px"><b style="font-weight:600">พนักงานแพ้${hit.kind === 'group' ? `ยากลุ่ม ${hit.group}` : 'ยานี้'} (${hit.allergy})</b>
                  <div style="color:var(--ink-2);font-size:13.5px">${hit.kind === 'group' ? `${it.name} อยู่ในกลุ่ม ${hit.group} เดียวกับยาที่แพ้ · อาจแพ้ข้ามกลุ่มได้` : `${it.name} ตรงกับประวัติแพ้ยาของ CN ${st.patient.cn}`}</div></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn danger" data-rm="${i}">ลบยานี้</button><button type="button" class="btn" data-ack="${i}">ยืนยันให้ยา</button></div>
              </div></td></tr>` : ''}
            ${hit && it.ack ? html`<tr class="ack"><td colspan="5" style="padding-top:0"><span class="small" style="color:var(--danger);display:inline-flex;gap:6px;align-items:center">${icon('alert', 'sm')}ยืนยันให้ยาแม้มีประวัติแพ้ ${hit.allergy}</span></td></tr>` : ''}`;
        })}</tbody>
      </table>
    </div>`);
}

/* ---------------- status / validation ---------------- */
function problems() {
  const f = st.f;
  const p = {};
  if (!f.visitDate) p.visitDate = 'กรุณาระบุวันที่/เวลา';
  if (!f.esi) p.esi = 'กรุณาเลือก ESI';
  if (!f.service) p.service = 'กรุณาเลือกประเภทบริการ';
  if (!f.chiefComplaint.trim()) p.chiefComplaint = 'กรุณากรอก Chief complaint';
  if (!f.dx) p.dx = 'กรุณาเลือกการวินิจฉัย';
  return p;
}
const allergyPending = () => st.items.filter((it) => allergyHit(it.name, st.allergies) && !it.ack).length;
const badQty = () => st.items.filter((it) => !(Number(it.quantity) > 0)).length;

function renderStatus() {
  const p = problems();
  const sectionState = {
    s1: p.esi || p.service || p.visitDate ? '' : 'ok',
    s2: vitalIssues().length ? 'warn' : VITALS.some((v) => st.f[v.key]) ? 'ok' : '',
    s3: p.chiefComplaint || p.dx ? '' : 'ok',
    s4: allergyPending() || badQty() ? 'warn' : st.items.length ? 'ok' : '',
  };
  $$('[data-toc]', root).forEach((a) => {
    const s = sectionState[a.dataset.toc];
    a.querySelector('.st').innerHTML = String(s === 'ok' ? html`<span style="color:var(--ok);display:inline-flex">${icon('check', 'sm')}</span>` : s === 'warn' ? html`<span style="color:var(--danger);display:inline-flex">${icon('alert', 'sm')}</span>` : '');
  });
  const pend = allergyPending();
  const hint = $('[data-save-hint]', root);
  const btn = $('[data-save]', root);
  btn.disabled = pend > 0 || st.saving;
  hint.classList.toggle('err', pend > 0 || (st.showErr && Object.keys(p).length > 0));
  hint.innerHTML = String(pend ? html`${icon('alert')}มี ${pend} คำเตือนแพ้ยาที่ต้องจัดการก่อนบันทึก`
    : st.showErr && Object.keys(p).length ? html`${icon('alertCircle')}กรอกข้อมูลที่จำเป็นอีก ${Object.keys(p).length} ช่อง`
      : badQty() ? html`${icon('alertCircle')}ระบุจำนวนยาให้ครบ`
        : html`${icon('info')}${st.items.length ? `จ่ายยา ${st.items.length} รายการ · ตัดสต็อกเมื่อบันทึก` : 'ไม่มีการจ่ายยา'}`);
}

function renderDraftInfo() {
  const el = $('[data-draft]', root); if (!el) return;
  el.innerHTML = String(st.draftAt ? html`บันทึกร่างอัตโนมัติ<br><span class="num">${time(st.draftAt)}:${String(st.draftAt.getSeconds()).padStart(2, '0')}</span>` : html`ร่างจะถูกบันทึกอัตโนมัติ<br>ในเบราว์เซอร์นี้`);
}

function showErr(k, msg) { const e = $(`[data-err="${k}"]`, root); if (e) { e.innerHTML = String(html`${icon('alertCircle')}${msg}`); e.hidden = false; } if (k === 'dx') $('[data-icd-box]', root).classList.add('err'); }
function hideErr(k) { const e = $(`[data-err="${k}"]`, root); if (e) e.hidden = true; if (k === 'dx') $('[data-icd-box]', root)?.classList.remove('err'); }

/* ---------------- save ---------------- */
async function save() {
  if (st.saving) return;
  st.showErr = true;
  const p = problems();
  Object.entries(p).forEach(([k, m]) => showErr(k, m));
  renderStatus();
  if (Object.keys(p).length) {
    const firstKey = ['visitDate', 'esi', 'service', 'chiefComplaint', 'dx'].find((k) => p[k]);
    const target = firstKey === 'visitDate' ? $('[name="visitDate"]', root) : $(`[data-err="${firstKey}"]`, root);
    target?.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (allergyPending()) return;
  if (badQty()) { toast('จำนวนยาไม่ถูกต้อง', 'ระบุจำนวนมากกว่า 0 หรือลบยาออก', 'err'); return; }

  const f = st.f;
  const card = {
    visitDate: f.visitDate,
    esiTriage: esiOf(f.esi)?.value || String(f.esi),
    temperature: f.temperature.trim(),
    pulse: f.pulse.trim(),
    respiration: f.respiration.trim(),
    bloodPressure: f.bloodPressure.replace(/\s+/g, ''),
    oxygenSaturation: f.oxygenSaturation.trim(),
    painScore: f.painScore,
    chiefComplaint: f.chiefComplaint.trim(),
    physicalExamination: f.physicalExamination.trim(),
    diagnosis: f.dx.short_description,
    advice: f.advice.trim(),
    serviceType: serviceOf(f.service)?.value || f.service,
    medicines: st.items.map((it) => ({ name: it.name, type: it.type, quantity: Number(it.quantity), unit: it.unit, note: (it.note || '').trim() })),
    ...(st.queue ? { queueId: st.queue.id } : {}),
  };
  st.saving = true;
  const btn = $('[data-save]', root);
  busy(btn, true, 'กำลังบันทึก...');
  try {
    const { id: opdId, stockErrors } = await api.addOpdCard(st.empId, card, session.staff);
    clearDraft();
    let queueMsg = '';
    if (st.queue) {
      const status = serviceOf(card.serviceType)?.key === 'refer' ? 'referred' : 'done';
      try { await api.closeQueue(st.queue.id, status, opdId, session.staff); queueMsg = ` · ปิดคิว #${st.queue.no}${status === 'referred' ? ' (ส่งต่อ)' : ''}`; }
      catch (e) { console.error('closeQueue', e); toast('บันทึกการรักษาแล้ว แต่ปิดคิวไม่สำเร็จ', `ปิดคิวเองได้ที่หน้าคิว · ${api.errorText(e)}`, 'warn', 8000); }
    }
    toast('บันทึกการรักษาแล้ว', `CN ${st.patient.cn} · ${card.diagnosis}${queueMsg}`);
    if (stockErrors.length) toast('ตัดสต็อกไม่สำเร็จบางรายการ', stockErrors.join(', ') + ' — ตรวจสอบที่หน้าคลังยา', 'warn', 8000);
    st.saving = false;
    if (st.queue) go('queue'); else go('patients', { q: st.patient.cn, id: st.empId });
  } catch (e) {
    console.error(e);
    st.saving = false;
    busy(btn, false);
    renderStatus();
    toast('บันทึกไม่สำเร็จ', 'ข้อมูลยังอยู่ในฟอร์ม (บันทึกร่างไว้แล้ว) ลองอีกครั้ง', 'err', 6000);
  }
}
