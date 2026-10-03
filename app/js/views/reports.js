// หน้า "รายงาน" — #/reports?tab=diagnosis&p=month&from=YYYY-MM-DD&to=YYYY-MM-DD&loc=
import { html, icon, $, $$, emptyState, skelLines, toast, busy } from '../core/ui.js';
import { session } from '../core/session.js';
import { setParams } from '../core/router.js';
import { dateMedium, dateShort, ymd } from '../core/format.js';
import { serviceOf, systemColors, systemPill } from '../core/codes.js';
import * as api from '../data/api.js';

const TABS = [
  { id: 'serviceType', label: 'ประเภทบริการ', ic: 'stethoscope' },
  { id: 'department', label: 'แผนก', ic: 'grid' },
  { id: 'diagnosis', label: 'การวินิจฉัย + Disease system', ic: 'clipboard' },
  { id: 'medicine', label: 'การใช้ยา', ic: 'pill' },
  { id: 'patient', label: 'รายผู้ใช้บริการ', ic: 'list' },
];
const PRESETS = [
  { id: 'today', label: 'วันนี้' },
  { id: 'week', label: 'สัปดาห์นี้' },
  { id: 'month', label: 'เดือนนี้' },
  { id: 'lastMonth', label: 'เดือนที่แล้ว' },
  { id: 'custom', label: 'กำหนดเอง' },
];
const TOP_BARS = 10;

function presetRange(id) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (id === 'today') return [ymd(t), ymd(t)];
  if (id === 'week') { const s = new Date(t); s.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return [ymd(s), ymd(t)]; }
  if (id === 'lastMonth') return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))];
  return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)]; // month
}
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
function rangeText(a, b) {
  const d1 = parseDay(a), d2 = parseDay(b);
  if (a === b) return dateMedium(d1);
  if (d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth()) return `${d1.getDate()} – ${dateMedium(d2)}`;
  return `${dateMedium(d1)} – ${dateMedium(d2)}`;
}
const pct = (v, t) => (t ? (v / t) * 100 : 0);
const fmtPct = (v, t) => `${pct(v, t).toFixed(1)}%`;

let root, st;

export default {
  async mount(el, params) {
    root = el;
    const p = PRESETS.some((x) => x.id === params.p) ? params.p : (params.from ? 'custom' : 'month');
    const [from, to] = p === 'custom' && params.from && params.to ? [params.from, params.to] : presetRange(p);
    st = {
      tab: TABS.some((t) => t.id === params.tab) ? params.tab : 'serviceType',
      preset: p, from, to,
      loc: session.staff.isAdmin ? (params.loc || '') : session.staff.location,
      locations: [], data: null, err: false, token: 0,
    };
    renderShell();
    if (session.staff.isAdmin) {
      api.listLocations().then((l) => { st.locations = l; renderFilters(); }).catch(() => {});
    }
    load();
  },
};

/* ---------------- data ---------------- */
async function load() {
  const token = ++st.token;
  st.data = null; st.err = false;
  syncParams();
  renderBody();
  try {
    const [cards, employees, icdLookup, icdList] = await Promise.all([
      api.listOpdCardsInRange(st.from, st.to, st.loc, session.staff),
      api.getEmployees(),
      api.icdLookup(),
      api.getIcd10(),
    ]);
    if (token !== st.token) return;
    const emp = new Map(employees.map((e) => [e.id, e]));
    st.data = { cards, emp, icd: icdLookup, sysColor: systemColors(icdList.map((x) => x.disease_system)) };
  } catch (e) {
    console.error(e);
    if (token !== st.token) return;
    st.err = true;
  }
  renderBody();
}

function syncParams() {
  setParams({ tab: st.tab, p: st.preset, from: st.preset === 'custom' ? st.from : '', to: st.preset === 'custom' ? st.to : '', loc: session.staff.isAdmin ? st.loc : '' });
}

/* ---------------- layout ---------------- */
function renderShell() {
  root.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><h1>รายงาน</h1><p>สรุปการให้บริการห้องพยาบาลตามช่วงเวลา</p></div>
        <div class="tools"><button type="button" class="btn" data-export disabled>${icon('download')}Export Excel</button></div>
      </div>
      <div class="filters" data-filters></div>
      <div class="rtabs" role="tablist" aria-label="ประเภทรายงาน" data-tabs>
        ${TABS.map((t) => html`<button type="button" role="tab" class="rtab" data-tab="${t.id}">${icon(t.ic)}<span>${t.label}</span></button>`)}
      </div>
      <div data-body style="display:flex;flex-direction:column;gap:16px"></div>
    </div>`);
  renderFilters();
  renderTabs();
  $('[data-tabs]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b || b.dataset.tab === st.tab) return;
    st.tab = b.dataset.tab; renderTabs(); syncParams(); renderBody();
  });
  $('[data-export]', root).addEventListener('click', doExport);
}

function renderTabs() {
  $$('[data-tab]', root).forEach((b) => { const on = b.dataset.tab === st.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
}

function renderFilters() {
  const box = $('[data-filters]', root);
  const admin = session.staff.isAdmin;
  box.innerHTML = String(html`
    <div class="field"><span class="label">ช่วงเวลา</span>
      <div class="seg" role="group" aria-label="ช่วงเวลา">${PRESETS.map((p) => html`<button type="button" data-p="${p.id}" class="${st.preset === p.id ? 'on' : ''}">${p.label}</button>`)}</div>
    </div>
    ${st.preset === 'custom'
      ? html`<div class="field"><span class="label">วันที่</span><div class="dates"><input class="input num" type="date" data-from value="${st.from}" max="${st.to}"><span class="muted">ถึง</span><input class="input num" type="date" data-to value="${st.to}" min="${st.from}"></div></div>`
      : html`<div class="field" style="min-width:220px"><span class="label">วันที่</span><span class="unit-input" style="height:40px;background:var(--bg)"><input type="text" readonly value="${rangeText(st.from, st.to)}" style="font-size:14px;font-weight:400"><span>${icon('calendar', 'sm')}</span></span></div>`}
    <label class="field" style="width:220px"><span class="label">Location ${admin ? html`<span class="pill navy" style="min-height:18px;padding:0 6px;font-size:11px">Admin</span>` : ''}</span>
      ${admin
        ? html`<select class="input" data-rloc><option value="">ทุก location</option>${st.locations.map((l) => html`<option value="${l}" ${l === st.loc ? 'selected' : ''}>${l}</option>`)}</select>`
        : html`<input class="input" readonly value="${st.loc}" style="background:var(--bg)">`}
    </label>`);
  box.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => {
    st.preset = b.dataset.p;
    if (st.preset !== 'custom') [st.from, st.to] = presetRange(st.preset);
    renderFilters(); load();
  }));
  const from = $('[data-from]', box), to = $('[data-to]', box);
  if (from) {
    const apply = () => {
      if (!from.value || !to.value) return;
      if (from.value > to.value) { toast('ช่วงวันที่ไม่ถูกต้อง', 'วันเริ่มต้องไม่หลังวันสิ้นสุด', 'warn'); return; }
      st.from = from.value; st.to = to.value; from.max = st.to; to.min = st.from; load();
    };
    from.onchange = apply; to.onchange = apply;
  }
  const loc = $('[data-rloc]', box);
  if (loc) loc.onchange = () => { st.loc = loc.value; load(); };
}

/* ---------------- calculations ---------------- */
function groupCount(cards, keyFn, valFn = () => 1) {
  const m = new Map();
  cards.forEach((c) => { const k = keyFn(c); m.set(k, (m.get(k) || 0) + valFn(c)); });
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)));
}
function topBars(list) {
  if (list.length <= TOP_BARS) return list;
  const top = list.slice(0, TOP_BARS - 1);
  const rest = list.slice(TOP_BARS - 1);
  return [...top, { label: `อื่นๆ (${rest.length} รายการ)`, value: rest.reduce((s, x) => s + x.value, 0), other: true }];
}
const deptOf = (c) => st.data.emp.get(c.empId)?.department || 'ไม่ระบุ';
const svcOf = (c) => serviceOf(c.serviceType)?.value || c.serviceType || 'ไม่ระบุ';

function workdays(from, to) {
  let n = 0;
  const end = Math.min(parseDay(to).getTime(), new Date().setHours(0, 0, 0, 0));
  for (let d = parseDay(from); d.getTime() <= end; d.setDate(d.getDate() + 1)) if (d.getDay() % 6 !== 0) n++;
  return Math.max(1, n);
}

function kpis(cards) {
  const people = new Set(cards.map((c) => c.empId)).size;
  const dx = groupCount(cards.filter((c) => c.diagnosis), (c) => c.diagnosis);
  const top = dx[0];
  const topCode = top ? st.data.icd(top.label)?.code : '';
  const em = cards.filter((c) => serviceOf(c.serviceType)?.key === 'emergency');
  const ref = cards.filter((c) => serviceOf(c.serviceType)?.key === 'refer');
  const refCodes = [...new Set(ref.map((c) => st.data.icd(c.diagnosis)?.code || c.diagnosis).filter(Boolean))];
  return html`<div class="stats">
    <div class="stat"><span class="k">การเข้ารับบริการ</span><span class="v">${cards.length}<small>ครั้ง</small></span><span class="small muted">${people} คน · เฉลี่ย ${(cards.length / workdays(st.from, st.to)).toFixed(1)} ครั้ง/วันทำงาน</span></div>
    <div class="stat"><span class="k">การวินิจฉัยต่างกัน</span><span class="v">${dx.length}<small>รายการ</small></span><span class="small muted">${top ? `พบบ่อยสุด ${topCode ? topCode + ' ' : ''}${top.label}` : '-'}</span></div>
    <div class="stat${em.length ? ' alert' : ''}"><span class="k">${icon('siren', 'sm')}อุบัติเหตุ/ฉุกเฉิน</span><span class="v">${em.length}<small>ครั้ง</small></span><span class="small muted">${fmtPct(em.length, cards.length)} ของทั้งหมด</span></div>
    <div class="stat"><span class="k">${icon('external', 'sm')}ส่งต่อ</span><span class="v">${ref.length}<small>ครั้ง</small></span><span class="small muted">${refCodes.slice(0, 3).join(', ') || '-'}${refCodes.length > 3 ? ' …' : ''}</span></div>
  </div>`;
}

/** สร้างข้อมูลของแต่ละแท็บ: { barsTitle, bars, unit, header[], rows[{cells(html), plain[]}], total{cells, plain}|null, tableTitle, chart } */
function compute(tab, cards) {
  if (tab === 'serviceType' || tab === 'department') {
    const list = groupCount(cards, tab === 'serviceType' ? svcOf : deptOf);
    const total = cards.length;
    const name = tab === 'serviceType' ? 'ประเภทบริการ' : 'แผนก';
    return {
      barsTitle: `จำนวนครั้งตาม${name}`, unit: 'ครั้ง', bars: topBars(list), tableTitle: `สรุปตาม${name}`,
      header: [name, 'จำนวน', 'ร้อยละ'], align: ['', 'r', 'r'],
      rows: list.map((x) => [x.label, x.value, fmtPct(x.value, total)]),
      total: ['รวม', total, '100%'],
      chart: { title: `สัดส่วนตาม${name}`, labels: list.map((x) => x.label), values: list.map((x) => x.value) },
    };
  }
  if (tab === 'diagnosis') {
    const list = groupCount(cards, (c) => c.diagnosis || 'ไม่ระบุ');
    const sysOf = (label) => st.data.icd(label)?.disease_system || 'ไม่ระบุ';
    const systems = groupCount(cards, (c) => sysOf(c.diagnosis || 'ไม่ระบุ'));
    const total = cards.length;
    return {
      barsTitle: 'จำนวนครั้งตาม Disease system', unit: 'ครั้ง', bars: topBars(systems).map((b) => (b.other ? b : { ...b, color: st.data.sysColor(b.label)[1] })), tableTitle: 'การวินิจฉัย',
      header: ['ICD-10', 'การวินิจฉัย', 'Disease system', 'จำนวน', 'ร้อยละ'],
      align: ['num', '', 'sys', 'r', 'r'],
      rows: list.map((x) => [st.data.icd(x.label)?.code || '-', x.label, sysOf(x.label), x.value, fmtPct(x.value, total)]),
      total: ['รวม', '', '', total, '100%'],
      chart: { title: 'สัดส่วนตาม Disease System', labels: systems.map((x) => x.label), values: systems.map((x) => x.value) },
    };
  }
  if (tab === 'medicine') {
    const meds = cards.flatMap((c) => c.medicines || []);
    const list = groupCount(meds, (m) => `${m.name || 'ไม่ระบุ'} (${m.unit || ''})`, (m) => Number(m.quantity) || 0);
    const total = list.reduce((s, x) => s + x.value, 0);
    const visits = cards.filter((c) => (c.medicines || []).length).length;
    return {
      barsTitle: 'ยาที่ใช้มากที่สุด (จำนวนหน่วย)', unit: 'หน่วย', bars: topBars(list), tableTitle: `การใช้ยา · จ่ายยา ${visits} ครั้ง`,
      header: ['ยา (หน่วย)', 'จำนวน', 'ร้อยละ'], align: ['', 'r', 'r'],
      rows: list.map((x) => [x.label, x.value, fmtPct(x.value, total)]),
      total: ['รวม', total, '100%'],
      chart: { title: 'สัดส่วนการใช้ยา', labels: list.map((x) => x.label), values: list.map((x) => x.value) },
    };
  }
  // patient
  const rows = [...cards].sort((a, b) => String(b.visitDate).localeCompare(String(a.visitDate))).map((c) => {
    const meds = (c.medicines || []).map((m) => `${m.name || ''} ${m.quantity || ''} ${m.unit || ''}`.trim());
    return [`${dateShort(c.visitDate)} ${String(c.visitDate || '').slice(11, 16)}`, st.data.emp.get(c.empId)?.cn || '-', c.diagnosis || '-', meds.join('\n') || '-'];
  });
  return {
    barsTitle: null, tableTitle: `ผู้ใช้บริการ ${new Set(cards.map((c) => c.empId)).size} คน`,
    header: ['วันที่', 'CN', 'การวินิจฉัย', 'ยาที่ได้รับ'], align: ['num', 'num', 'dx', 'pre'],
    rows, total: null, chart: null,
  };
}

/* ---------------- render ---------------- */
function barsCard(r) {
  const max = Math.max(1, ...r.bars.map((b) => b.value));
  const total = r.bars.reduce((s, b) => s + b.value, 0);
  return html`<section class="card rcard">
    <div><h2>${r.barsTitle}</h2><p class="small muted">${rangeText(st.from, st.to)} · ${st.loc || 'ทุก location'}</p></div>
    <div class="bars" role="list">${r.bars.map((b) => html`
      <div class="bar" role="listitem" title="${b.label}: ${b.value} ${r.unit} (${fmtPct(b.value, total)})">
        <span>${b.label}</span><span class="track"><span class="fill${b.other ? ' other' : ''}" style="width:${(b.value / max) * 100}%${b.color ? `;background:${b.color}` : ''}"></span></span>
        <span class="v">${b.value.toLocaleString('th-TH')}<small>${Math.round(pct(b.value, total))}%</small></span>
      </div>`)}</div>
  </section>`;
}

function dailyCard(cards) {
  const a = parseDay(st.from), b = parseDay(st.to);
  const days = Math.round((b - a) / 86400000) + 1;
  const monthly = days > 62;
  const buckets = [];
  if (monthly) {
    for (let d = new Date(a.getFullYear(), a.getMonth(), 1); d <= b; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const key = ymd(d).slice(0, 7);
      buckets.push({ key, label: new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit' }).format(d), we: false, n: 0 });
    }
  } else {
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) buckets.push({ key: ymd(d), label: dateShort(d), we: d.getDay() % 6 === 0, n: 0 });
  }
  const idx = new Map(buckets.map((x, i) => [x.key, i]));
  cards.forEach((c) => { const k = String(c.visitDate || '').slice(0, monthly ? 7 : 10); if (idx.has(k)) buckets[idx.get(k)].n++; });
  const max = Math.max(1, ...buckets.map((x) => x.n));
  const peak = buckets.reduce((m, x) => (x.n > m.n ? x : m), buckets[0]);
  const mid = buckets[Math.floor((buckets.length - 1) / 2)];
  return html`<section class="card rcard">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><h2>การเข้ารับบริการ${monthly ? 'รายเดือน' : 'รายวัน'}</h2><p class="small muted">${monthly ? 'ช่วงเวลาเกิน 2 เดือน แสดงเป็นรายเดือน' : 'วันเสาร์–อาทิตย์แสดงเป็นสีเทา'}</p></div>
      ${peak?.n ? html`<span class="small muted num">สูงสุด ${peak.n} ครั้ง · ${peak.label}</span>` : ''}
    </div>
    <div class="daycol" role="img" aria-label="จำนวนการเข้ารับบริการ">${buckets.map((x) => html`<span class="${x.we ? 'we' : ''}" style="height:${x.n ? Math.max(4, (x.n / max) * 100) : 2}%" title="${x.label}: ${x.n} ครั้ง"></span>`)}</div>
    <div class="daylbl small muted num">${buckets.map((x, i) => html`<span>${i === 0 || i === buckets.length - 1 || (x === mid && buckets.length > 4) ? html`<b>${x.label}</b>` : ''}</span>`)}</div>
  </section>`;
}

function tableCard(r) {
  const cls = (i) => r.align[i] || '';
  const td = (v, i) => {
    const c = cls(i);
    if (c === 'sys') return html`<td>${systemPill(v, st.data.sysColor(v))}</td>`;
    if (c === 'dx') return html`<td>${v === '-' ? v : systemPill(v, st.data.sysColor(st.data.icd(v)?.disease_system))}</td>`;
    if (c === 'pre') return html`<td style="white-space:pre-line">${v}</td>`;
    if (c === 'r' || c === 'c') return html`<td class="${c} num">${typeof v === 'number' ? v.toLocaleString('th-TH') : v}</td>`;
    return html`<td class="${c}">${v}</td>`;
  };
  return html`<section class="card rtable">
    <div class="rtable-h"><h2>${r.tableTitle}</h2><span class="small muted">${r.rows.length.toLocaleString('th-TH')} แถว</span></div>
    <div class="scroll-x">
      <table class="table">
        <thead><tr>${r.header.map((h, i) => html`<th class="${cls(i) === 'r' ? 'r' : cls(i) === 'c' ? 'c' : ''}">${h}</th>`)}</tr></thead>
        <tbody>${r.rows.map((row) => html`<tr>${row.map(td)}</tr>`)}</tbody>
        ${r.total ? html`<tfoot><tr>${r.total.map(td)}</tr></tfoot>` : ''}
      </table>
    </div>
  </section>`;
}

function renderBody() {
  const body = $('[data-body]', root);
  const exp = $('[data-export]', root);
  if (st.err) {
    exp.disabled = true;
    body.innerHTML = String(html`<div class="card">${emptyState({ ic: 'wifiOff', err: true, title: 'โหลดข้อมูลรายงานไม่สำเร็จ', text: 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง', action: html`<button class="btn" data-retry>${icon('refresh')}ลองอีกครั้ง</button>` })}</div>`);
    $('[data-retry]', body).onclick = load;
    return;
  }
  if (!st.data) {
    exp.disabled = true;
    body.innerHTML = String(html`
      <div class="stats">${[1, 2, 3, 4].map(() => html`<div class="stat">${skelLines(2, 18)}</div>`)}</div>
      <div class="rgrid"><div class="card rcard">${skelLines(6, 22)}</div><div class="card rcard">${skelLines(6, 22)}</div></div>`);
    return;
  }
  const cards = st.data.cards;
  if (!cards.length) {
    exp.disabled = true;
    body.innerHTML = String(html`<div class="card">${emptyState({ ic: 'chart', title: 'ไม่มีการเข้ารับบริการในช่วงนี้', text: `${rangeText(st.from, st.to)} · ${st.loc || 'ทุก location'} — ลองเลือกช่วงเวลาอื่น` })}</div>`);
    return;
  }
  const r = compute(st.tab, cards);
  st.current = r;
  exp.disabled = false;
  body.innerHTML = String(html`
    ${kpis(cards)}
    <div class="rgrid">${r.barsTitle ? barsCard(r) : ''}${dailyCard(cards)}</div>
    ${tableCard(r)}`);
}

/* ---------------- export ---------------- */
async function doExport() {
  const r = st.current; if (!r) return;
  const tab = TABS.find((t) => t.id === st.tab);
  const btn = $('[data-export]', root);
  busy(btn, true, 'กำลังสร้างไฟล์...');
  try {
    const { exportReport } = await import('../core/excel.js');
    await exportReport({
      title: `รายงานตาม${tab.label}`,
      subtitle: `ช่วงวันที่: ${rangeText(st.from, st.to)} · ${st.loc || 'ทุก location'}`,
      filename: `รายงาน_${tab.label.replace(/[^\wก-๙]+/g, '_')}_${st.from}_${st.to}.xlsx`,
      header: r.header, rows: r.rows, total: r.total, chart: r.chart,
    });
    toast('Export Excel แล้ว', 'ไฟล์ถูกดาวน์โหลดไปที่เครื่อง');
  } catch (e) {
    console.error(e);
    toast('Export ไม่สำเร็จ', e.message || '', 'err');
  } finally { busy(btn, false); }
}
