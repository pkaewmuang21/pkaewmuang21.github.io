// หน้า "คิวรอตรวจ" — #/queue?tab=waiting&sort=esi
import { html, icon, $, $$, emptyState, toast, openLayer, busy, confirmDialog } from '../core/ui.js';
import { session } from '../core/session.js';
import { go, setParams } from '../core/router.js';
import { dateLong, dateShort, time, toDate } from '../core/format.js';
import { ESI, esiOf, safetyState } from '../core/codes.js';
import { onQueue, queueState, retryQueue, refreshStale, summary } from '../core/queue-store.js';
import * as api from '../data/api.js';
import { openQueueRegister } from './queue-register.js';

const TABS = [
  { id: 'waiting', label: 'รอตรวจ' },
  { id: 'in_progress', label: 'กำลังตรวจ' },
  { id: 'observe', label: 'ห้องสังเกตอาการ' },
  { id: 'done', label: 'เสร็จสิ้น' },
  { id: 'referred', label: 'ส่งต่อ' },
  { id: 'cancelled', label: 'ยกเลิก' },
];
const CANCEL_REASONS = ['กลับไปทำงานก่อน', 'ลงทะเบียนผิด', 'ไปโรงพยาบาลเอง', 'ไม่มาตามเรียก'];

let root, st, cleanup = [];

export default {
  mount(el, params) {
    root = el;
    cleanup.forEach((fn) => fn()); cleanup = [];
    st = {
      tab: TABS.some((t) => t.id === params.tab) ? params.tab : 'waiting',
      sort: params.sort === 'time' ? 'time' : 'esi',
      view: params.view === 'kanban' || params.view === 'list' ? params.view : (() => { try { return localStorage.getItem('pgfa-queue-view') || 'list'; } catch { return 'list'; } })(),
      emp: new Map(), menu: null, sel: 0, levels: '',
    };
    root.innerHTML = String(html`
      <div class="page">
        <div class="page-head">
          <div><h1>คิวรอตรวจ</h1><p data-sub></p></div>
          <div class="tools">
            <div class="seg" role="group" aria-label="มุมมอง" data-view>
              <button type="button" data-v="list">${icon('list', 'sm')}รายการ</button><button type="button" data-v="kanban">${icon('columns', 'sm')}Kanban</button>
            </div>
            <div class="seg" role="group" aria-label="เรียงลำดับ" data-sort>
              <button type="button" data-s="esi">${icon('sortArrows', 'sm')}ความเร่งด่วน</button><button type="button" data-s="time">เวลามาถึง</button>
            </div>
            <button type="button" class="btn primary" data-add>${icon('plus')}เพิ่มคิว<span class="kbd">N</span></button>
          </div>
        </div>
        <div data-stats></div>
        <div data-stale></div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="tabs" role="tablist" data-tabs></div>
          <div data-alert></div>
          <div class="qlist" data-list></div>
          <div class="kanban" data-kanban hidden></div>
          <p class="small muted qhint"><span><span class="kbd dark">↑</span> <span class="kbd dark">↓</span> เลือกแถว</span><span><span class="kbd dark">Enter</span> เริ่มตรวจ</span><span><span class="kbd dark">T</span> เปลี่ยน ESI</span><span><span class="kbd dark">N</span> เพิ่มคิว</span></p>
        </div>
      </div>`);

    $('[data-add]', root).onclick = () => register();
    $('[data-sort]', root).addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { st.sort = b.dataset.s; st.sel = 0; sync(); render(); } });
    $('[data-tabs]', root).addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { st.tab = b.dataset.tab; st.sel = 0; st.menu = null; sync(); render(); } });
    $('[data-list]', root).addEventListener('click', onListClick);
    $('[data-kanban]', root).addEventListener('click', onKanbanClick);
    $('[data-view]', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b || b.dataset.v === st.view) return;
      st.view = b.dataset.v; st.menu = null;
      try { localStorage.setItem('pgfa-queue-view', st.view); } catch { /* ignore */ }
      sync(); render();
    });

    const offOutside = (e) => { if (st.menu && !e.target.closest('.menu') && !e.target.closest('[data-more]')) { st.menu = null; renderList(); } };
    document.addEventListener('mousedown', offOutside);
    document.addEventListener('keydown', onKey);
    const offQueue = onQueue(() => { loadPatients(); render(); });
    refreshStale();
    cleanup.push(() => { document.removeEventListener('mousedown', offOutside); document.removeEventListener('keydown', onKey); offQueue(); });
  },
  update(params) { this.mount(root, params); },
  unmount() { cleanup.forEach((fn) => fn()); cleanup = []; },
};

function sync() { setParams({ tab: st.tab === 'waiting' ? '' : st.tab, sort: st.sort === 'esi' ? '' : st.sort, view: st.view === 'kanban' ? 'kanban' : '' }); }

/* ---------------- ข้อมูลพนักงาน ---------------- */
let loadingPatients = false;
async function loadPatients() {
  const items = queueState().items || [];
  const missing = [...new Set(items.map((q) => q.employeeDocId))].filter((id) => id && !st.emp.has(id));
  if (!missing.length || loadingPatients) return;
  loadingPatients = true;
  try {
    const all = await api.getEmployees();
    all.forEach((e) => st.emp.set(e.id, e));
    for (const id of missing) if (!st.emp.has(id)) { const e = await api.getEmployee(id).catch(() => null); st.emp.set(id, e || { id, cn: '?', department: '' }); }
  } finally { loadingPatients = false; }
  if (root.isConnected) render();
}

/* ---------------- รายการที่แสดง ---------------- */
function rows() {
  const items = (queueState().items || []).filter((q) => q.status === st.tab);
  const arr = (q) => toDate(q.arrivedAt)?.getTime() || 0;
  if (['done', 'referred', 'cancelled'].includes(st.tab)) return items.sort((a, b) => (toDate(b.closedAt) || 0) - (toDate(a.closedAt) || 0));
  if (st.sort === 'time' || st.tab !== 'waiting') return items.sort((a, b) => arr(a) - arr(b));
  return items.sort((a, b) => (a.esi - b.esi) || arr(a) - arr(b));
}

/* ---------------- render ---------------- */
function render() {
  if (!root.isConnected) return;
  const qs = queueState();
  $('[data-sub]', root).textContent = `${dateLong(new Date())} · ${qs.location || '-'}`;
  $$('[data-sort] [data-s]', root).forEach((b) => b.classList.toggle('on', b.dataset.s === st.sort));
  const kan = st.view === 'kanban';
  $$('[data-view] [data-v]', root).forEach((b) => b.classList.toggle('on', b.dataset.v === st.view));
  $('[data-sort]', root).hidden = kan || st.tab !== 'waiting';
  $('[data-tabs]', root).hidden = kan;
  $('[data-list]', root).hidden = kan;
  $('[data-kanban]', root).hidden = !kan;
  root.querySelector('.qhint').hidden = kan;
  renderStats(); renderStale();
  if (kan) renderKanban(); else { renderTabs(); renderList(); }
}

function renderStats() {
  const items = queueState().items;
  const s = items ? summary(items) : null;
  const v = (x) => (s ? x : '–');
  $('[data-stats]', root).innerHTML = String(html`<div class="stats">
    <div class="stat"><span class="k">${icon('hourglass', 'sm')}รอตรวจ</span><span class="v">${v(s?.waiting)}<small>คน</small></span></div>
    <div class="stat"><span class="k">${icon('stethoscope', 'sm')}กำลังตรวจ</span><span class="v">${v(s?.progress)}<small>คน</small></span></div>
    <div class="stat"><span class="k">${icon('bed', 'sm')}ห้องสังเกตอาการ</span><span class="v">${v(s?.observe)}<small>คน</small></span></div>
  </div>`);
}

function renderTabs() {
  const items = queueState().items || [];
  $('[data-tabs]', root).innerHTML = String(html`${TABS.map((t) => html`<button type="button" role="tab" class="tab${st.tab === t.id ? ' on' : ''}" aria-selected="${st.tab === t.id}" data-tab="${t.id}">${t.label}<span class="n">${items.filter((q) => q.status === t.id).length}</span></button>`)}`);
}

function patientCells(q) {
  const e = st.emp.get(q.employeeDocId);
  const al = safetyState(e?.allergies), dz = safetyState(e?.congenitalDisease);
  return {
    cn: e?.cn || '…', dept: e?.department || '',
    safe: html`${al.state === 'has' ? html`<span class="pill danger" title="${al.items.join(', ')}">${icon('alert')}แพ้${al.items.map((x) => x.replace(/^แพ้/, '')).join(', ')}</span>` : al.state === 'none' ? html`<span class="pill bare">${icon('check')}ไม่มีประวัติแพ้ยา</span>` : html`<span class="pill caution">${icon('alertCircle')}ยังไม่ระบุการแพ้</span>`}
      ${dz.state === 'has' ? html`<span class="pill violet">${icon('heart')}${dz.items.join(', ')}</span>` : ''}`,
  };
}

function statusCell(q) {
  const closed = { done: ['ok', 'checkCircle', 'เสร็จสิ้น'], referred: ['info', 'external', 'ส่งต่อ'], cancelled: ['bare', 'ban', 'ยกเลิก'] }[q.status];
  if (closed) {
    const sub = q.status === 'cancelled' ? `${q.cancelReason || ''} · ${time(q.closedAt)}` : `ปิด ${time(q.closedAt)} · ${q.closedBy || '-'}`;
    return html`<span class="pill ${closed[0]}">${icon(closed[1])}${q.status === 'cancelled' ? html`<span class="strike">${closed[2]}</span>` : closed[2]}</span><div class="wait-sub num">${sub}</div>`;
  }
  if (q.status === 'in_progress') return html`<span class="pill navy">${icon('stethoscope')}กำลังตรวจ</span><div class="wait-sub num">${q.assignedTo || '-'} · เริ่ม ${time(q.startedAt)}</div>`;
  if (q.status === 'observe') return html`<span class="pill violet">${icon('bed')}ห้องสังเกต</span><div class="wait-sub num">${q.assignedTo || '-'} · ตั้งแต่ ${time(q.observeAt || q.startedAt)}</div>`;
  return '';
}

function actionCell(q) {
  const open = ['waiting', 'in_progress', 'observe'].includes(q.status);
  const main = q.status === 'waiting' ? html`<button type="button" class="btn primary" data-act="start">${icon('stethoscope')}เริ่มตรวจ</button>`
    : q.status === 'in_progress' ? html`<button type="button" class="btn" data-act="continue">บันทึกต่อ</button>`
      : q.status === 'observe' ? html`<button type="button" class="btn" data-act="continue">ประเมินซ้ำ</button>`
        : html`<button type="button" class="btn ghost" data-act="profile">ดูบันทึก</button>`;
  return html`${main}${open ? html`<button type="button" class="btn icon ghost" aria-label="การกระทำเพิ่มเติม" aria-expanded="${st.menu === q.id}" data-more>${icon('more')}</button>` : ''}
    ${st.menu === q.id ? html`<div class="menu" role="menu">
      <button type="button" role="menuitem" data-act="retriage">${icon('retriage')}เปลี่ยน ESI (re-triage)</button>
      ${q.status !== 'observe' ? html`<button type="button" role="menuitem" data-act="observe">${icon('bed')}ย้ายไปห้องสังเกตอาการ</button>` : ''}
      <button type="button" role="menuitem" data-act="profile">${icon('user')}ดูโปรไฟล์พนักงาน</button>
      <div class="sep"></div>
      <button type="button" role="menuitem" class="danger" data-act="cancel">${icon('ban')}ยกเลิกคิว…</button>
    </div>` : ''}`;
}

function renderList() {
  const box = $('[data-list]', root);
  const qs = queueState();
  $('[data-alert]', root).innerHTML = '';
  if (qs.err) {
    box.innerHTML = String(emptyState({ ic: 'wifiOff', err: true, title: 'โหลดรายการคิวไม่สำเร็จ', text: qs.err?.code === 'permission-denied' ? api.errorText(qs.err) : 'ตรวจสอบการเชื่อมต่อเครือข่าย ข้อมูลที่บันทึกไว้แล้วจะไม่หาย', action: html`<button type="button" class="btn" data-retry>${icon('refresh')}ลองอีกครั้ง</button>` }));
    $('[data-retry]', box).onclick = retryQueue;
    return;
  }
  if (!qs.items) {
    box.innerHTML = String(html`${[1, 2, 3].map(() => html`<div class="sk-row"><div class="skel" style="height:14px"></div><div class="skel" style="height:24px;border-radius:999px"></div><div class="skel" style="height:14px"></div><div class="skel" style="height:14px"></div><div class="skel" style="height:22px;border-radius:999px"></div><div class="skel" style="height:18px"></div></div>`)}`);
    return;
  }
  const list = rows();
  box.classList.toggle('nowait', st.tab === 'waiting');
  if (!list.length) {
    box.innerHTML = String(st.tab === 'waiting'
      ? emptyState({ ic: 'hourglass', title: 'ยังไม่มีพนักงานรอตรวจ', text: 'เมื่อมีพนักงานมาที่ห้องพยาบาล กด “เพิ่มคิว” หรือกด N แล้วพิมพ์ CN ได้ทันที',
        action: html`<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button type="button" class="btn primary" data-empty-add>${icon('plus')}เพิ่มคิว</button><button type="button" class="btn" data-empty-opd>บันทึกการรักษาโดยไม่ผ่านคิว</button></div>` })
      : html`<p class="muted" style="padding:28px 20px;text-align:center">ไม่มีคิวในสถานะ “${TABS.find((t) => t.id === st.tab).label}” วันนี้</p>`);
    $('[data-empty-add]', box)?.addEventListener('click', () => register());
    $('[data-empty-opd]', box)?.addEventListener('click', () => go('opd'));
    return;
  }
  st.sel = Math.min(st.sel, list.length - 1);
  box.innerHTML = String(html`
    <div class="qhead"><span>#</span><span>ESI</span><span>พนักงาน</span><span>อาการเบื้องต้น</span><span>ความปลอดภัย</span><span>สถานะ</span><span></span></div>
    ${list.map((q, i) => {
      const e = esiOf(q.esi);
      const p = patientCells(q);
      const last = (q.esiHistory || []).slice(-1)[0];
      return html`<div class="qrow${i === st.sel ? ' sel' : ''}" data-id="${q.id}" data-i="${i}">
        <div class="c-no num">#${q.no}</div>
        <div class="c-esi">${e ? html`<span class="esi esi-${e.n}"><b>${e.n}</b>${e.name}</span>` : '-'}${last ? html`<span class="retri">${icon('retriage')}${last.from} → ${last.to} · ${time(last.at)}</span>` : ''}</div>
        <div class="c-pt"><div class="cn">${p.cn}</div><div class="dept">${p.dept}</div></div>
        <div class="c-cc"><div class="cc" title="${q.chiefComplaint || ''}">${q.chiefComplaint || '-'}</div><div class="dept num">มาถึง ${time(q.arrivedAt)}</div></div>
        <div class="c-safe">${p.safe}</div>
        <div class="c-wait">${statusCell(q)}</div>
        <div class="c-act">${actionCell(q)}</div>
      </div>`;
    })}`);
}

/* ---------------- คิวค้างข้ามวัน ---------------- */
const STATUS_TH = { waiting: 'รอตรวจ', in_progress: 'กำลังตรวจ', observe: 'ห้องสังเกตอาการ' };
const STALE_REASON = 'ค้างข้ามวัน — ปิดภายหลัง';

function renderStale() {
  const box = $('[data-stale]', root);
  const stale = queueState().stale || [];
  if (!stale.length) { box.innerHTML = ''; return; }
  const days = [...new Set(stale.map((q) => q.date))];
  box.innerHTML = String(html`<div class="alertbar" role="status" style="background:var(--caution-50);color:var(--caution);border-color:#F1DE9B">
    ${icon('alertCircle')}<span><b>มีคิวค้างจากวันก่อน ${stale.length} คิว</b> ที่ยังไม่ได้ปิด (${days.map((d) => dateShort(d)).join(', ')})</span>
    <button type="button" class="btn sm" data-stale-open style="margin-left:auto">จัดการคิวค้าง</button>
  </div>`);
  $('[data-stale-open]', box).onclick = openStale;
}

function openStale() {
  openLayer({
    content: html`
      <div class="modal-h"><div><h2>คิวค้างจากวันก่อน</h2><p class="small muted">บันทึกการรักษาให้ครบ หรือยกเลิกคิวที่ไม่ได้ตรวจจริง</p></div><button type="button" class="btn icon ghost" aria-label="ปิด" data-close>${icon('x')}</button></div>
      <div class="modal-b" style="padding:0" data-stale-list></div>
      <div class="modal-f">
        <span class="hint" style="margin-right:auto">${icon('info')}ยกเลิกทั้งหมดจะบันทึกเหตุผล “${STALE_REASON}”</span>
        <button type="button" class="btn ghost" data-close>ปิด</button>
        <button type="button" class="btn danger" data-cancel-all>ยกเลิกทั้งหมด</button>
      </div>`,
    onMount(box, close) {
      const paint = () => {
        const stale = queueState().stale || [];
        const list = $('[data-stale-list]', box);
        if (!stale.length) { list.innerHTML = String(emptyState({ ic: 'checkCircle', title: 'ไม่มีคิวค้างแล้ว' })); $('[data-cancel-all]', box).disabled = true; return; }
        list.innerHTML = String(html`<table class="table">
          <thead><tr><th>วันที่</th><th>#</th><th>พนักงาน</th><th>อาการ</th><th>สถานะ</th><th class="r"></th></tr></thead>
          <tbody>${stale.map((q) => {
            const e = st.emp.get(q.employeeDocId);
            return html`<tr data-id="${q.id}">
              <td class="num">${dateShort(q.date)} ${time(q.arrivedAt)}</td><td class="num">#${q.no}</td>
              <td><b class="cn" style="font-size:14px">${e?.cn || '…'}</b><div class="dept">${e?.department || ''}</div></td>
              <td style="white-space:normal">${q.chiefComplaint || '-'}</td>
              <td><span class="pill">${STATUS_TH[q.status] || q.status}</span></td>
              <td class="r" style="white-space:nowrap"><button type="button" class="btn sm" data-s-act="opd">${icon('clipboard', 'sm')}บันทึกการรักษา</button> <button type="button" class="btn ghost sm" data-s-act="cancel" style="color:var(--danger)">ยกเลิก</button></td>
            </tr>`;
          })}</tbody></table>`);
      };
      $('[data-stale-list]', box).addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-s-act]'); if (!b) return;
        const q = (queueState().stale || []).find((x) => x.id === b.closest('tr').dataset.id); if (!q) return;
        if (b.dataset.sAct === 'opd') { close(); go('opd', { emp: q.employeeDocId, queue: q.id }); return; }
        busy(b, true);
        try { await api.cancelQueue(q.id, STALE_REASON, session.staff); await refreshStale(); paint(); }
        catch (e) { console.error(e); busy(b, false); toast('ยกเลิกไม่สำเร็จ', api.errorText(e), 'err'); }
      });
      $('[data-cancel-all]', box).onclick = async (ev) => {
        const stale = queueState().stale || [];
        if (!(await confirmDialog({ title: `ยกเลิกคิวค้างทั้งหมด ${stale.length} คิว?`, message: `ทุกคิวจะถูกปิดด้วยเหตุผล “${STALE_REASON}”`, okText: 'ยกเลิกทั้งหมด', danger: true }))) return;
        busy(ev.target, true);
        try {
          await Promise.all(stale.map((q) => api.cancelQueue(q.id, STALE_REASON, session.staff)));
          await refreshStale();
          toast('ปิดคิวค้างแล้ว', `${stale.length} คิว`);
          close();
        } catch (e) { console.error(e); busy(ev.target, false); toast('ปิดคิวค้างไม่สำเร็จ', api.errorText(e), 'err'); await refreshStale(); paint(); }
      };
      paint();
    },
  });
}

/* ---------------- Kanban ---------------- */
const CLOSED = ['done', 'referred', 'cancelled'];
function kanbanColumns() {
  const items = queueState().items || [];
  const arr = (q) => toDate(q.arrivedAt)?.getTime() || 0;
  const by = (s) => items.filter((q) => q.status === s).sort((a, b) => arr(a) - arr(b));
  return [
    { title: 'รอตรวจ', ic: 'hourglass', cards: items.filter((q) => q.status === 'waiting').sort((a, b) => (a.esi - b.esi) || arr(a) - arr(b)) },
    { title: 'กำลังตรวจ', ic: 'stethoscope', cards: by('in_progress') },
    { title: 'ห้องสังเกตอาการ', ic: 'bed', cards: by('observe') },
    { title: 'ปิดคิววันนี้', ic: 'checkCircle', cards: items.filter((q) => CLOSED.includes(q.status)).sort((a, b) => (toDate(b.closedAt) || 0) - (toDate(a.closedAt) || 0)) },
  ];
}

function renderKanban() {
  const box = $('[data-kanban]', root);
  const qs = queueState();
  $('[data-alert]', root).innerHTML = '';
  if (qs.err) {
    box.innerHTML = String(html`<div class="qlist" style="grid-column:1/-1">${emptyState({ ic: 'wifiOff', err: true, title: 'โหลดรายการคิวไม่สำเร็จ', action: html`<button type="button" class="btn" data-retry>${icon('refresh')}ลองอีกครั้ง</button>` })}</div>`);
    $('[data-retry]', box).onclick = retryQueue;
    return;
  }
  if (!qs.items) { box.innerHTML = String(html`${[1, 2, 3, 4].map(() => html`<section class="kcol"><div class="skel" style="height:22px;width:60%"></div><div class="skel" style="height:120px"></div></section>`)}`); return; }
  const cols = kanbanColumns();
  box.innerHTML = String(html`${cols.map((c) => html`
    <section class="kcol" aria-label="${c.title}">
      <div class="kcol-h">${icon(c.ic, 'sm')}${c.title}<span class="n">${c.cards.length}</span></div>
      ${c.cards.length ? c.cards.map((q) => kcard(q)) : html`<p class="small muted" style="padding:8px 4px">ไม่มีคิว</p>`}
    </section>`)}`);
}

function kcard(q) {
  const e = esiOf(q.esi);
  const p = st.emp.get(q.employeeDocId);
  const al = safetyState(p?.allergies);
  const closed = CLOSED.includes(q.status);
  const statusPill = {
    done: html`<span class="pill ok">${icon('checkCircle')}เสร็จสิ้น</span>`,
    referred: html`<span class="pill info">${icon('external')}ส่งต่อ</span>`,
    cancelled: html`<span class="pill bare">${icon('ban')}<span class="strike">ยกเลิก</span></span>`,
  }[q.status];
  const btn = q.status === 'waiting' ? html`<button type="button" class="btn primary" data-act="start" style="width:100%">${icon('stethoscope')}เริ่มตรวจ</button>`
    : q.status === 'in_progress' ? html`<button type="button" class="btn" data-act="continue" style="width:100%">บันทึกต่อ</button>`
      : q.status === 'observe' ? html`<button type="button" class="btn" data-act="continue" style="width:100%">ประเมินซ้ำ</button>`
        : html`<button type="button" class="btn ghost sm" data-act="profile" style="align-self:flex-start">ดูบันทึก</button>`;
  return html`<article class="kcard" data-id="${q.id}">
    <div class="krow">${e ? html`<span class="esi esi-${e.n}"><b>${e.n}</b>${e.name}</span>` : ''}<span class="muted num small">#${q.no}</span></div>
    <div><div class="cn">${p?.cn || '…'} <span class="dept" style="font-weight:400">· ${p?.department || ''}</span></div><div style="font-size:13.5px;color:var(--ink-2)">${q.chiefComplaint || '-'}</div></div>
    <div class="krow">
      ${al.state === 'has' ? html`<span class="pill danger">${icon('alert')}แพ้${al.items.map((x) => x.replace(/^แพ้/, '')).join(', ')}</span>` : al.state === 'none' ? html`<span class="pill bare">${icon('check')}ไม่แพ้ยา</span>` : html`<span class="pill caution">${icon('alertCircle')}ยังไม่ระบุ</span>`}
      ${closed ? statusPill : ''}
    </div>
    <div class="wait-sub num">${closed ? `${q.status === 'cancelled' ? (q.cancelReason || '') + ' · ' : ''}${time(q.closedAt)}`
      : q.status === 'waiting' ? `มาถึง ${time(q.arrivedAt)}`
        : `${q.assignedTo || '-'} · ${q.status === 'observe' ? 'ตั้งแต่' : 'เริ่ม'} ${time(q.status === 'observe' ? (q.observeAt || q.startedAt) : q.startedAt)}`}</div>
    ${btn}
  </article>`;
}

function onKanbanClick(e) {
  const card = e.target.closest('.kcard'); if (!card) return;
  const q = (queueState().items || []).find((x) => x.id === card.dataset.id); if (!q) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) doAction(act, q);
}

/* ---------------- actions ---------------- */
function onListClick(e) {
  const row = e.target.closest('.qrow'); if (!row) return;
  const q = (queueState().items || []).find((x) => x.id === row.dataset.id); if (!q) return;
  st.sel = +row.dataset.i;
  if (e.target.closest('[data-more]')) { st.menu = st.menu === q.id ? null : q.id; renderList(); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) { $$('.qrow', root).forEach((r) => r.classList.toggle('sel', r === row)); return; }
  st.menu = null;
  doAction(act, q);
}

async function doAction(act, q) {
  const emp = st.emp.get(q.employeeDocId);
  try {
    if (act === 'start') { await api.startQueue(q.id, session.staff); go('opd', { emp: q.employeeDocId, queue: q.id }); }
    else if (act === 'continue') go('opd', { emp: q.employeeDocId, queue: q.id });
    else if (act === 'profile') go('patients', { q: emp?.cn || '', id: q.employeeDocId });
    else if (act === 'observe') { await api.observeQueue(q.id, session.staff, q.startedAt); toast(`ย้ายคิว #${q.no} ไปห้องสังเกตอาการแล้ว`, `CN ${emp?.cn || ''}`); }
    else if (act === 'retriage') retriage(q);
    else if (act === 'cancel') cancel(q);
  } catch (e) { console.error(e); toast('ดำเนินการไม่สำเร็จ', api.errorText(e), 'err'); renderList(); }
}

function retriage(q) {
  let esi = q.esi;
  openLayer({
    size: 'sm',
    content: html`
      <div class="modal-h"><h2>เปลี่ยน ESI · คิว #${q.no}</h2><button type="button" class="btn icon ghost" aria-label="ปิด" data-close>${icon('x')}</button></div>
      <div class="modal-b" style="display:flex;flex-direction:column;gap:12px">
        <p class="small muted">ปัจจุบัน ESI ${q.esi} · กด 1–5 เพื่อเลือก</p>
        <div style="display:flex;flex-direction:column;gap:6px" data-pick>${ESI.map((e) => html`<button type="button" class="esi-btn" data-n="${e.n}" style="justify-content:space-between"><span class="esi esi-${e.n}"><b>${e.n}</b>${e.name}</span><small class="muted">${e.short}</small></button>`)}</div>
      </div>
      <div class="modal-f"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button type="button" class="btn primary" data-save>${icon('check')}บันทึก</button></div>`,
    onMount(box, close) {
      const paint = () => $$('[data-n]', box).forEach((b) => b.classList.toggle('on', +b.dataset.n === esi));
      $('[data-pick]', box).addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) { esi = +b.dataset.n; paint(); } });
      box.addEventListener('keydown', (e) => { if (/^[1-5]$/.test(e.key)) { esi = +e.key; paint(); } if (e.key === 'Enter') { e.preventDefault(); $('[data-save]', box).click(); } });
      $('[data-save]', box).onclick = async () => {
        if (esi === q.esi) { close(); return; }
        busy($('[data-save]', box), true);
        try { await api.retriageQueue(q, esi, session.staff); close(); toast(`เปลี่ยน ESI คิว #${q.no} แล้ว`, `${q.esi} → ${esi}`); }
        catch (e) { console.error(e); busy($('[data-save]', box), false); toast('บันทึกไม่สำเร็จ', api.errorText(e), 'err'); }
      };
      paint();
      $('[data-save]', box).focus();
    },
  });
}

function cancel(q) {
  let reason = '';
  openLayer({
    size: 'sm',
    content: html`
      <div class="modal-h"><h2>ยกเลิกคิว #${q.no}?</h2><button type="button" class="btn icon ghost" aria-label="ปิด" data-close>${icon('x')}</button></div>
      <div class="modal-b" style="display:flex;flex-direction:column;gap:12px">
        <span class="label">เหตุผล <span class="req">*</span></span>
        <div style="display:flex;gap:8px;flex-wrap:wrap" data-reasons>${CANCEL_REASONS.map((r) => html`<button type="button" class="cchip" data-r="${r}">${r}</button>`)}</div>
        <input class="input" data-other placeholder="หรือพิมพ์เหตุผลอื่น">
        <span class="hint err" data-err hidden></span>
      </div>
      <div class="modal-f"><button type="button" class="btn ghost" data-close>ไม่ยกเลิก</button><button type="button" class="btn danger" data-save>ยกเลิกคิว</button></div>`,
    onMount(box, close) {
      const other = $('[data-other]', box);
      const paint = () => $$('[data-r]', box).forEach((b) => { const on = b.dataset.r === reason; b.style.background = on ? 'var(--navy)' : ''; b.style.color = on ? '#fff' : ''; b.style.borderColor = on ? 'var(--navy)' : ''; });
      $('[data-reasons]', box).addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { reason = b.dataset.r; other.value = ''; paint(); } });
      other.addEventListener('input', () => { reason = other.value.trim(); paint(); });
      $('[data-save]', box).onclick = async () => {
        if (!reason) { const er = $('[data-err]', box); er.innerHTML = String(html`${icon('alertCircle')}กรุณาเลือกหรือพิมพ์เหตุผล`); er.hidden = false; return; }
        busy($('[data-save]', box), true);
        try { await api.cancelQueue(q.id, reason, session.staff); close(); toast(`ยกเลิกคิว #${q.no} แล้ว`, reason); }
        catch (e) { console.error(e); busy($('[data-save]', box), false); toast('ยกเลิกไม่สำเร็จ', api.errorText(e), 'err'); }
      };
    },
  });
}

function register(employeeId) {
  openQueueRegister({
    employeeId,
    onAdded: ({ no, start, employeeDocId, id }) => {
      if (start) go('opd', { emp: employeeDocId, queue: id });
      else { st.tab = 'waiting'; sync(); render(); toast(`เพิ่มคิว #${no} แล้ว`); }
    },
  });
}

/* ---------------- keyboard ---------------- */
function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('.layer')) return;
  const list = queueState().items ? rows() : [];
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); register(); return; }
  if (!list.length || st.view === 'kanban') return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    st.sel = Math.max(0, Math.min(list.length - 1, st.sel + (e.key === 'ArrowDown' ? 1 : -1)));
    $$('.qrow', root).forEach((r) => r.classList.toggle('sel', +r.dataset.i === st.sel));
    root.querySelector('.qrow.sel')?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    const q = list[st.sel];
    e.preventDefault();
    doAction(q.status === 'waiting' ? 'start' : ['in_progress', 'observe'].includes(q.status) ? 'continue' : 'profile', q);
  } else if (e.key === 't' || e.key === 'T') {
    const q = list[st.sel];
    if (['waiting', 'in_progress', 'observe'].includes(q.status)) { e.preventDefault(); retriage(q); }
  }
}
