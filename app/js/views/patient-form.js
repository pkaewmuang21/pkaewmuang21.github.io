// Modal เพิ่ม/แก้ไขข้อมูลพนักงาน (ข้อมูลพนักงาน + ข้อมูลความปลอดภัย)
import { html, icon, openLayer, toast, busy, $ } from '../core/ui.js';
import { session } from '../core/session.js';
import { ageYears } from '../core/format.js';
import { safetyState, DEFAULT_DEPARTMENTS, ALLERGY_SUGGEST, DISEASE_SUGGEST } from '../core/codes.js';
import * as api from '../data/api.js';

/**
 * openPatientForm({ patient?, cn?, employees, onSaved(id) })
 * - patient: มีค่า = แก้ไข, ไม่มี = เพิ่มใหม่
 */
export function openPatientForm({ patient = null, cn = '', employees = [], onSaved, queueOption = false }) {
  const editing = !!patient;
  const toYN = (text) => { const s = safetyState(text); return { yn: s.state === 'unknown' ? '' : s.state === 'has' ? 'yes' : 'no', tags: s.items }; };
  const f = {
    cn: patient?.cn || cn,
    phone: patient?.phone || '',
    department: patient?.department || '',
    birthdate: patient?.birthdate || '',
    allergy: toYN(patient?.allergies),
    disease: toYN(patient?.congenitalDisease),
  };

  // แผนกที่ใช้บ่อยจากข้อมูลจริง + ค่าเริ่มต้น
  const freq = {};
  employees.forEach((e) => { if (e.department) freq[e.department] = (freq[e.department] || 0) + 1; });
  const depts = [...new Set([...DEFAULT_DEPARTMENTS, ...Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 10)])];
  let deptOther = !!f.department && !depts.includes(f.department);

  openLayer({
    content: html`
      <div class="modal-h">
        <h2>${editing ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงานใหม่'}</h2>
        <div style="display:flex;align-items:center;gap:8px"><span class="kbd dark">Esc</span><button type="button" class="btn icon ghost" aria-label="ปิด" data-close>${icon('x')}</button></div>
      </div>
      <form class="reg" novalidate data-form>
        <div class="reg-left">
          <span class="sec-title">ตัวอย่างที่จะแสดง</span>
          <div class="card" style="padding:12px;display:flex;flex-direction:column;gap:8px" data-preview></div>
          <div data-cn-status></div>
        </div>
        <div class="reg-right">
          <div class="blk">
            <div class="blk-h"><span class="no">1</span><h3>ข้อมูลพนักงาน</h3></div>
            <div class="g2">
              <label class="field"><span class="label">CN <span class="req">*</span></span>
                <input class="input num" name="cn" autocomplete="off" inputmode="numeric" value="${f.cn}" ${editing ? '' : 'autofocus'} style="font-size:15px;font-weight:500">
                <span class="hint err" data-err="cn" hidden></span>
              </label>
              <label class="field"><span class="label">เบอร์โทร</span><input class="input num" name="phone" inputmode="tel" value="${f.phone}"></label>
            </div>
            <div class="field"><span class="label">แผนก <span class="req">*</span></span>
              <div class="opt" role="radiogroup" aria-label="แผนก" data-depts></div>
              <input class="input" name="deptOther" placeholder="ระบุแผนก" style="max-width:320px" value="${deptOther ? f.department : ''}" ${deptOther ? '' : 'hidden'}>
              <span class="hint err" data-err="department" hidden></span>
            </div>
            <label class="field" style="max-width:320px"><span class="label">วันเกิด</span>
              <span class="unit-input" style="height:40px"><input type="date" name="birthdate" value="${f.birthdate}" style="font-size:15px"><span data-age></span></span>
            </label>
          </div>
          <div class="divider"></div>
          <div class="blk">
            <div class="blk-h"><span class="no">2</span><h3>ข้อมูลความปลอดภัย</h3><span class="small muted">ต้องเลือกทุกข้อ · ช่องว่างไม่ถือว่า “ไม่มี”</span></div>
            ${safetyField('allergy', 'แพ้ยา / อาหาร', 'พิมพ์ชื่อยาหรืออาหาร แล้วกด Enter', ALLERGY_SUGGEST)}
            ${safetyField('disease', 'โรคประจำตัว', 'พิมพ์ชื่อโรค แล้วกด Enter', DISEASE_SUGGEST)}
          </div>
          ${queueOption && !editing ? html`<label class="check" style="display:flex;align-items:center;gap:10px;min-height:40px;cursor:pointer"><input type="checkbox" data-to-queue checked style="width:20px;height:20px;accent-color:var(--navy)">เพิ่มเข้าคิวต่อทันทีหลังบันทึก <span class="muted small">(กรอกอาการและ ESI ในขั้นถัดไป)</span></label>` : ''}
        </div>
      </form>
      <div class="modal-f">
        <span class="hint" style="margin-right:auto">${icon('info')}${editing ? 'การแก้ไขจะบันทึกชื่อผู้แก้ไขไว้' : 'แก้ไขข้อมูลได้ภายหลังที่หน้าโปรไฟล์'}</span>
        <button type="button" class="btn ghost" data-close>ยกเลิก</button>
        <button type="button" class="btn primary" data-save>${icon('check')}บันทึก<span class="kbd">Ctrl ↵</span></button>
      </div>`,
    onMount(box, close) {
      const form = $('[data-form]', box);
      const q = (s) => $(s, box);

      /* ---- แผนก ---- */
      const renderDepts = () => {
        q('[data-depts]').innerHTML = String(html`${depts.map((d) => html`<button type="button" data-d="${d}" class="${!deptOther && f.department === d ? 'on' : ''}" aria-checked="${!deptOther && f.department === d}">${d}</button>`)}<button type="button" data-d="__other" class="${deptOther ? 'on' : ''}">อื่นๆ</button>`);
      };
      q('[data-depts]').addEventListener('click', (e) => {
        const b = e.target.closest('[data-d]'); if (!b) return;
        deptOther = b.dataset.d === '__other';
        f.department = deptOther ? form.deptOther.value.trim() : b.dataset.d;
        form.deptOther.hidden = !deptOther;
        if (deptOther) form.deptOther.focus();
        if (f.department) hideErr('department');
        renderDepts(); preview();
      });
      form.deptOther.addEventListener('input', () => { f.department = form.deptOther.value.trim(); if (f.department) hideErr('department'); preview(); });

      /* ---- safety (yes/no + tags) ---- */
      const renderSafety = (key) => {
        const s = f[key];
        const wrap = q(`[data-safety="${key}"]`);
        wrap.querySelectorAll('.yn button').forEach((b) => {
          const on = b.dataset.yn === s.yn;
          b.classList.toggle('on', on);
          b.classList.toggle('red', on && b.dataset.yn === 'yes' && key === 'allergy');
          b.setAttribute('aria-checked', on);
        });
        const tb = wrap.querySelector('.tagbox');
        tb.hidden = s.yn !== 'yes';
        wrap.querySelector('.qchips').hidden = s.yn !== 'yes';
        tb.classList.toggle('red', key === 'allergy');
        tb.querySelectorAll('.tag').forEach((t) => t.remove());
        const input = tb.querySelector('input');
        s.tags.forEach((t, i) => input.insertAdjacentHTML('beforebegin', String(html`<span class="tag">${t}<button type="button" data-rm="${i}" aria-label="ลบ ${t}">${icon('x', 'sm')}</button></span>`)));
        preview();
      };
      const addTag = (key, text) => {
        const t = text.trim().replace(/,/g, ' ');
        if (!t) return;
        if (!f[key].tags.some((x) => x.toLowerCase() === t.toLowerCase())) f[key].tags.push(t);
        renderSafety(key);
      };
      ['allergy', 'disease'].forEach((key) => {
        const wrap = q(`[data-safety="${key}"]`);
        const input = wrap.querySelector('.tagbox input');
        wrap.addEventListener('click', (e) => {
          const yn = e.target.closest('[data-yn]');
          if (yn) { f[key].yn = yn.dataset.yn; renderSafety(key); if (yn.dataset.yn === 'yes') input.focus(); hideErr(key); return; }
          const rm = e.target.closest('[data-rm]');
          if (rm) { f[key].tags.splice(+rm.dataset.rm, 1); renderSafety(key); input.focus(); return; }
          const sg = e.target.closest('[data-sg]');
          if (sg) { addTag(key, sg.dataset.sg); input.focus(); }
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); addTag(key, input.value); input.value = ''; }
          if (e.key === 'Backspace' && !input.value && f[key].tags.length) { f[key].tags.pop(); renderSafety(key); }
        });
        input.addEventListener('blur', () => { if (input.value.trim()) { addTag(key, input.value); input.value = ''; } });
        renderSafety(key);
      });

      /* ---- CN / วันเกิด ---- */
      const dup = () => {
        const v = form.cn.value.trim();
        return v ? employees.find((e) => e.cn === v && e.id !== patient?.id) : null;
      };
      const cnStatus = () => {
        const v = form.cn.value.trim();
        const d = dup();
        q('[data-cn-status]').innerHTML = !v ? '' : String(d
          ? html`<div class="alertbar" style="flex-direction:column;align-items:flex-start;gap:6px">${html`<b>${icon('alert', 'sm')} CN ${v} มีในระบบแล้ว</b>`}<span class="small" style="color:var(--ink-2)">แผนก ${d.department || '-'} — เปิดโปรไฟล์เดิมแทนการเพิ่มใหม่</span><a class="btn sm" href="#/patients?q=${encodeURIComponent(v)}&id=${d.id}" data-close>${icon('user', 'sm')}เปิดโปรไฟล์</a></div>`
          : html`<span class="pill ok">${icon('checkCircle', 'sm')}${editing && v === patient.cn ? 'CN เดิม' : 'ยังไม่มีในระบบ'}</span>`);
      };
      form.cn.addEventListener('input', () => { f.cn = form.cn.value.trim(); hideErr('cn'); cnStatus(); preview(); });
      form.phone.addEventListener('input', () => { f.phone = form.phone.value.trim(); });
      form.birthdate.addEventListener('input', () => { f.birthdate = form.birthdate.value; preview(); });

      /* ---- preview ---- */
      function preview() {
        const age = ageYears(f.birthdate);
        q('[data-age]').textContent = age !== null ? `อายุ ${age} ปี` : '';
        const al = f.allergy, dz = f.disease;
        q('[data-preview]').innerHTML = String(html`
          <div><span class="cn">${f.cn || 'CN'}</span> <span class="dept">· ${f.department || 'แผนก'}${age !== null ? ` · ${age} ปี` : ''}</span></div>
          ${al.yn === 'yes' && al.tags.length ? html`<span class="pill danger" style="align-self:flex-start;white-space:normal">${icon('alert')}แพ้ ${al.tags.join(', ')}</span>`
            : al.yn === 'no' ? html`<span class="pill bare" style="align-self:flex-start">${icon('check')}ไม่แพ้ยา/อาหาร</span>`
              : html`<span class="pill caution" style="align-self:flex-start">${icon('alertCircle')}ยังไม่ระบุการแพ้</span>`}
          ${dz.yn === 'yes' && dz.tags.length ? html`<span class="pill violet" style="align-self:flex-start;white-space:normal">${icon('heart')}${dz.tags.join(', ')}</span>`
            : dz.yn === 'no' ? html`<span class="pill bare" style="align-self:flex-start">${icon('check')}ไม่มีโรคประจำตัว</span>`
              : html`<span class="pill caution" style="align-self:flex-start">${icon('alertCircle')}ยังไม่ระบุโรคประจำตัว</span>`}`);
      }

      /* ---- validate + save ---- */
      const showErr = (k, msg) => { const e = q(`[data-err="${k}"]`); if (e) { e.innerHTML = String(html`${icon('alertCircle')}${msg}`); e.hidden = false; } };
      function hideErr(k) { const e = q(`[data-err="${k}"]`); if (e) e.hidden = true; }
      const save = async () => {
        let ok = true;
        if (!f.cn) { showErr('cn', 'กรุณากรอก CN'); ok = false; } else if (dup()) { showErr('cn', 'CN นี้มีในระบบแล้ว'); ok = false; }
        if (!f.department) { showErr('department', 'กรุณาเลือกแผนก'); ok = false; } else hideErr('department');
        for (const k of ['allergy', 'disease']) {
          const s = f[k];
          if (!s.yn) { showErr(k, 'กรุณาเลือก “ไม่มี” หรือ “มี”'); ok = false; }
          else if (s.yn === 'yes' && !s.tags.length) { showErr(k, 'กรุณาระบุอย่างน้อย 1 รายการ'); ok = false; }
          else hideErr(k);
        }
        if (!ok) { box.querySelector('.hint.err:not([hidden])')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
        const data = {
          cn: f.cn, phone: f.phone, department: f.department, birthdate: f.birthdate,
          allergies: f.allergy.yn === 'yes' ? f.allergy.tags.join(', ') : 'ไม่มี',
          congenitalDisease: f.disease.yn === 'yes' ? f.disease.tags.join(', ') : 'ไม่มี',
        };
        const btn = q('[data-save]');
        busy(btn, true, 'กำลังบันทึก...');
        try {
          let id = patient?.id;
          if (editing) await api.updateEmployee(id, data, session.staff.name);
          else id = await api.addEmployee(data, session.staff.name);
          toast('บันทึกข้อมูลแล้ว', `CN ${data.cn}`);
          const addToQueue = !!q('[data-to-queue]')?.checked;
          close();
          onSaved && onSaved(id, { addToQueue });
        } catch (e) {
          console.error(e);
          busy(btn, false);
          toast('บันทึกไม่สำเร็จ', 'กรุณาลองอีกครั้ง', 'err');
        }
      };
      q('[data-save]').addEventListener('click', save);
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
      form.addEventListener('submit', (e) => e.preventDefault());

      renderDepts(); cnStatus(); preview();
    },
  });
}

function safetyField(key, label, placeholder, suggest) {
  return html`
    <div class="field" data-safety="${key}">
      <span class="label">${label} <span class="req">*</span></span>
      <div class="yn" role="radiogroup" aria-label="${label}">
        <button type="button" data-yn="no">${icon('check', 'sm')}ไม่มี</button><button type="button" data-yn="yes">${key === 'allergy' ? icon('alert', 'sm') : ''}มี</button>
      </div>
      <div class="tagbox" hidden><input type="text" placeholder="${placeholder}" aria-label="เพิ่ม${label}"></div>
      <div class="qchips" hidden>${suggest.map((s) => html`<button type="button" class="qchip" data-sg="${s}">+ ${s}</button>`)}</div>
      <span class="hint err" data-err="${key}" hidden></span>
    </div>`;
}
