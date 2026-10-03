// หน้าต่าง "เพิ่มคิว" — ค้นหา CN, อาการเบื้องต้น, ESI, เวลามาถึง
import { html, icon, $, $$, openLayer, toast, busy } from '../core/ui.js';
import { session } from '../core/session.js';
import { href } from '../core/router.js';
import { ageYears, phone } from '../core/format.js';
import { ESI, safetyState } from '../core/codes.js';
import { queueState } from '../core/queue-store.js';
import * as api from '../data/api.js';
import { openPatientForm } from './patient-form.js';

const CC_CHIPS = ['ปวดศีรษะ', 'ไข้ / หวัด', 'ปวดท้อง', 'บาดแผล', 'เวียนศีรษะ', 'ปวดกล้ามเนื้อ'];
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** openQueueRegister({ employeeId?, onAdded({ id, no, start, employeeDocId }) }) */
export function openQueueRegister({ employeeId = '', onAdded } = {}) {
  const items = queueState().items || [];
  const openQ = new Map(items.filter((q) => api.OPEN_STATUSES.includes(q.status)).map((q) => [q.employeeDocId, q]));
  const nextNo = items.reduce((m, q) => Math.max(m, q.no || 0), 0) + 1;
  const f = { emp: null, q: '', all: false, cc: '', esi: 0, time: hhmm(new Date()), timeTouched: false };
  let employees = null, list = [], act = 0;

  openLayer({
    content: html`
      <div class="modal-h">
        <div style="display:flex;align-items:center;gap:12px"><h2>เพิ่มคิว</h2><span class="small muted">คิวถัดไป <b class="num" style="color:var(--ink)">#${nextNo}</b> · ${session.staff.location}</span></div>
        <div style="display:flex;align-items:center;gap:8px"><span class="kbd dark">Esc</span><button type="button" class="btn icon ghost" aria-label="ปิด" data-close>${icon('x')}</button></div>
      </div>
      <div class="reg">
        <div class="reg-left" style="flex-basis:340px">
          <label class="field"><span class="label">1 · ค้นหาด้วย CN</span>
            <span class="search big" style="background:#fff">${icon('search')}<input type="text" inputmode="numeric" autocomplete="off" class="num" data-q aria-label="CN" placeholder="พิมพ์ CN หรือ Enter ดูทั้งหมด" autofocus><span class="small muted" data-count></span></span>
          </label>
          <div style="display:flex;flex-direction:column;gap:2px;max-height:340px;overflow:auto" data-results></div>
          <div class="divider"></div>
          <button type="button" class="btn ghost" data-new style="justify-content:flex-start;color:var(--turq-ink)">${icon('userPlus')}ไม่พบ? เพิ่มพนักงานใหม่</button>
          <p class="small muted" style="margin-top:auto;display:flex;gap:12px;flex-wrap:wrap"><span><span class="kbd dark">↑</span><span class="kbd dark">↓</span> เลือก</span><span><span class="kbd dark">Enter</span> ยืนยัน</span></p>
        </div>
        <div class="reg-right" style="gap:20px" data-right></div>
      </div>
      <div class="modal-f">
        <span class="hint err" data-err hidden style="margin-right:auto"></span>
        <button type="button" class="btn ghost" data-close>ยกเลิก</button>
        <button type="button" class="btn" data-start>${icon('stethoscope')}เพิ่มและเริ่มตรวจทันที</button>
        <button type="button" class="btn primary" data-add>${icon('plus')}เพิ่มเข้าคิว<span class="kbd">Ctrl ↵</span></button>
      </div>`,
    async onMount(box, close) {
      const q = (s) => $(s, box);
      const input = q('[data-q]');

      /* ---------- ซ้าย: ค้นหา ---------- */
      const renderResults = () => {
        const res = q('[data-results]');
        if (!employees) { res.innerHTML = '<p class="small muted" style="padding:8px 12px">กำลังโหลดรายชื่อ...</p>'; return; }
        const text = f.q.toLowerCase();
        list = text || f.all ? employees.filter((e) => !text || (e.cn || '').toLowerCase().includes(text)).sort((a, b) => (a.cn || '').localeCompare(b.cn || '')) : [];
        act = Math.min(act, Math.max(0, list.length - 1));
        q('[data-count]').textContent = text || f.all ? `${list.length} รายการ` : '';
        if (!text && !f.all) { res.innerHTML = '<p class="small muted" style="padding:8px 12px">พิมพ์ CN เพื่อค้นหา หรือกด Enter เพื่อแสดงทั้งหมด</p>'; return; }
        if (!list.length) { res.innerHTML = String(html`<p class="small muted" style="padding:8px 12px">ไม่พบ CN ${f.q}</p>`); return; }
        const i = text ? (s) => { const k = s.toLowerCase().indexOf(text); return k < 0 ? html`${s}` : html`${s.slice(0, k)}<mark>${s.slice(k, k + text.length)}</mark>${s.slice(k + text.length)}`; } : (s) => s;
        res.innerHTML = String(html`${list.map((e, k) => {
          const inQ = openQ.get(e.id);
          const al = safetyState(e.allergies);
          const age = ageYears(e.birthdate);
          return html`<button type="button" class="res${f.emp?.id === e.id ? ' on' : ''}${k === act ? ' act' : ''}" data-id="${e.id}" ${inQ ? 'disabled' : ''} style="${k === act && !f.emp ? 'background:var(--sunken)' : ''}">
            <span style="flex:1;min-width:0"><span class="cn" style="display:block">${i(e.cn)}</span><span class="dept">${[e.department, age !== null ? `${age} ปี` : ''].filter(Boolean).join(' · ')}</span></span>
            ${inQ ? html`<span class="pill violet">อยู่ในคิว #${inQ.no}</span>` : al.state === 'has' ? html`<span class="pill danger">${icon('alert')}แพ้ยา</span>` : ''}
          </button>`;
        })}`);
      };
      input.addEventListener('input', () => { f.q = input.value.trim(); if (!f.q) f.all = false; act = 0; renderResults(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.length) { act = (act + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; renderResults(); } }
        if (e.key === 'Enter' && !e.ctrlKey && !f.q && !f.all) { e.preventDefault(); f.all = true; act = 0; renderResults(); return; }
        if (e.key === 'Enter' && !e.ctrlKey && list[act] && !openQ.has(list[act].id)) { e.preventDefault(); pick(list[act]); }
      });
      q('[data-results]').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b && !b.disabled) pick(employees.find((x) => x.id === b.dataset.id)); });
      q('[data-new]').onclick = () => {
        close();
        openPatientForm({ cn: /^\d+$/.test(f.q) ? f.q : '', employees: employees || [], onSaved: (id) => openQueueRegister({ employeeId: id, onAdded }) });
      };

      /* ---------- ขวา: รายละเอียด ---------- */
      const position = () => {
        const waiting = items.filter((x) => x.status === 'waiting');
        const ahead = waiting.filter((x) => x.esi < f.esi || (x.esi === f.esi)).length;
        const urgent = waiting.filter((x) => x.esi < f.esi).length;
        return f.esi ? `จะอยู่ลำดับที่ ${ahead + 1} ตาม ESI${urgent ? ` · มี ${urgent} คนที่เร่งด่วนกว่า` : ''}` : `ตอนนี้มีรอตรวจ ${waiting.length} คน`;
      };
      const renderRight = () => {
        const right = q('[data-right]');
        const p = f.emp;
        if (!p) {
          right.innerHTML = String(html`<div class="empty" style="padding:48px 16px"><div class="ill">${icon('user', 'xl')}</div><h3>เลือกพนักงาน</h3><p>ค้นหาด้วย CN ทางซ้าย แล้วกด Enter หรือคลิกเลือก</p></div>`);
          return;
        }
        const al = safetyState(p.allergies), dz = safetyState(p.congenitalDisease);
        const age = ageYears(p.birthdate);
        right.innerHTML = String(html`
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span class="cn" style="font-size:20px">${p.cn}</span><span class="muted">${[p.department, age !== null ? `${age} ปี` : '', p.phone ? phone(p.phone) : ''].filter(Boolean).join(' · ')}</span></div>
              <a href="${href('patients', { q: p.cn, id: p.id })}" class="small" data-close data-hist>ดูประวัติ</a>
            </div>
            <div class="safety${al.state === 'has' ? '' : ' calm'}" role="${al.state === 'has' ? 'alert' : 'note'}">
              ${al.state === 'has' ? html`<span class="it">${icon('alert')}แพ้ยา/อาหาร <span>${al.items.join(', ')}</span></span>` : html`<span class="it" style="color:${al.state === 'none' ? 'var(--ok)' : 'var(--caution)'}">${icon(al.state === 'none' ? 'check' : 'alertCircle')}แพ้ยา/อาหาร <span>${al.state === 'none' ? 'ไม่มี' : 'ยังไม่ระบุ'}</span></span>`}
              ${dz.state === 'has' ? html`<span class="it" style="color:var(--violet)">${icon('heart')}โรคประจำตัว <span>${dz.items.join(', ')}</span></span>` : html`<span class="it" style="color:var(--ink-3)">${icon(dz.state === 'none' ? 'check' : 'alertCircle')}โรคประจำตัว <span>${dz.state === 'none' ? 'ไม่มี' : 'ยังไม่ระบุ'}</span></span>`}
            </div>
          </div>
          <label class="field"><span class="label">2 · อาการสำคัญเบื้องต้น <span class="req">*</span></span><input class="input" data-cc autocomplete="off" value="${f.cc}"></label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:-10px" data-chips>${CC_CHIPS.map((c) => html`<button type="button" class="cchip" data-c="${c}">${c}</button>`)}</div>
          <fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">
            <legend class="label" style="padding:0;margin-bottom:8px">3 · ESI triage <span class="req">*</span> <span class="muted" style="font-weight:400">· กด 1–5</span></legend>
            <div class="esi-pick" data-esi>${ESI.map((e) => html`<button type="button" class="esi-opt" data-n="${e.n}" title="ESI ${e.n} ${e.name}" aria-label="ESI ${e.n} ${e.name}" style="align-items:center;justify-content:center;min-height:72px"><span class="esi esi-${e.n} lg"><b>${e.n}</b></span><small>${e.short}</small></button>`)}</div>
          </fieldset>
          <div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">
            <label class="field" style="width:180px"><span class="label">4 · เวลามาถึง</span><span class="unit-input" style="height:40px"><input type="time" data-time value="${f.time}" style="font-size:15px"><span data-now>${f.timeTouched ? '' : 'ตอนนี้'}</span></span></label>
            <p class="hint" style="padding-bottom:10px" data-pos>${icon('info')}${position()}</p>
          </div>`);
        const cc = q('[data-cc]');
        cc.addEventListener('input', () => { f.cc = cc.value; hideErr(); });
        q('[data-chips]').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; cc.value = cc.value.trim() ? `${cc.value.trim()}, ${b.dataset.c}` : b.dataset.c; f.cc = cc.value; cc.focus(); hideErr(); });
        q('[data-esi]').addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) setEsi(+b.dataset.n); });
        q('[data-time]').addEventListener('input', (e) => { f.time = e.target.value; f.timeTouched = true; q('[data-now]').textContent = ''; });
        paintEsi();
        api.listOpdCards(p.id, session.staff).then((v) => { const a = q('[data-hist]'); if (a) a.textContent = `ดูประวัติ ${v.length} ครั้ง`; }).catch(() => {});
      };
      const paintEsi = () => {
        $$('[data-esi] [data-n]', box).forEach((b) => { const on = +b.dataset.n === f.esi; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        const pos = q('[data-pos]'); if (pos) pos.innerHTML = String(html`${icon('info')}${position()}`);
      };
      const setEsi = (n) => { f.esi = n; paintEsi(); hideErr(); };
      function pick(emp) {
        if (!emp || openQ.has(emp.id)) return;
        f.emp = emp; renderResults(); renderRight();
        q('[data-cc]').focus();
      }

      /* ---------- บันทึก ---------- */
      const err = q('[data-err]');
      function hideErr() { err.hidden = true; }
      const save = async (start) => {
        const show = (m) => { err.innerHTML = String(html`${icon('alertCircle')}${m}`); err.hidden = false; };
        if (!f.emp) { show('กรุณาเลือกพนักงาน'); input.focus(); return; }
        if (!f.cc.trim()) { show('กรุณากรอกอาการสำคัญเบื้องต้น'); q('[data-cc]')?.focus(); return; }
        if (!f.esi) return show('กรุณาเลือก ESI');
        const [h, m] = (f.time || hhmm(new Date())).split(':').map(Number);
        const arrivedAt = f.timeTouched ? new Date(new Date().setHours(h, m, 0, 0)) : new Date();
        if (arrivedAt > new Date(Date.now() + 60000)) return show('เวลามาถึงต้องไม่เกินเวลาปัจจุบัน');
        const btn = q(start ? '[data-start]' : '[data-add]');
        busy(btn, true, 'กำลังบันทึก...');
        try {
          const r = await api.addToQueue({ employeeDocId: f.emp.id, chiefComplaint: f.cc.trim(), esi: f.esi, arrivedAt, start }, session.staff);
          close();
          onAdded && onAdded({ ...r, start, employeeDocId: f.emp.id });
        } catch (e) {
          console.error(e);
          busy(btn, false);
          toast('เพิ่มคิวไม่สำเร็จ', api.errorText(e), 'err');
        }
      };
      q('[data-add]').onclick = () => save(false);
      q('[data-start]').onclick = () => save(true);
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(false); return; }
        if (/^[1-5]$/.test(e.key) && f.emp && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) { e.preventDefault(); setEsi(+e.key); }
      });

      renderResults(); renderRight();
      employees = await api.getEmployees().catch(() => []);
      if (employeeId) {
        let emp = employees.find((e) => e.id === employeeId);
        if (!emp) { emp = await api.getEmployee(employeeId).catch(() => null); if (emp) employees.push(emp); }
        if (emp) { f.q = emp.cn; input.value = emp.cn; pick(emp); return; }
      }
      renderResults();
    },
  });
}

