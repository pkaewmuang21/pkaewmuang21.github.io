// ค่าคงที่และการแปลงรหัสที่เก็บใน Firestore (คงรูปแบบข้อมูลเดิม)
import { html, icon } from './ui.js';

/* ESI triage — ข้อมูลเดิมเก็บเป็นข้อความเต็ม เช่น "3 Urgent - รักษาภายใน 15-30 นาที" */
export const ESI = [
  { n: 1, name: 'Resuscitation', target: 'รักษาทันที', lo: 0, hi: 0, short: 'ทันที', value: '1 Life threatening - รักษาทันที' },
  { n: 2, name: 'Emergent', target: 'ภายใน 10-15 นาที', lo: 10, hi: 15, short: '10–15 นาที', value: '2 Emergent - รักษาภายใน 10-15 นาที ' },
  { n: 3, name: 'Urgent', target: 'ภายใน 15-30 นาที', lo: 15, hi: 30, short: '15–30 นาที', value: '3 Urgent - รักษาภายใน 15-30 นาที' },
  { n: 4, name: 'Less urgent', target: 'ภายใน 30-60 นาที', lo: 30, hi: 60, short: '30–60 นาที', value: '4 SemiUrgent - รักษาภายใน 30-60 นาที' },
  { n: 5, name: 'Non-urgent', target: 'ภายใน 1-2 ชั่วโมง', lo: 60, hi: 120, short: '1–2 ชม.', value: '5 Non Urgent - รักษาภายใน 1-2 ชั่วโมง' },
];
export function esiOf(v) {
  const n = parseInt(String(v ?? '').trim(), 10);
  return ESI.find((e) => e.n === n) || null;
}
export function esiBadge(v, lg = false) {
  const e = esiOf(v);
  if (!e) return html`<span class="muted">-</span>`;
  return html`<span class="esi esi-${e.n}${lg ? ' lg' : ''}"><b>${e.n}</b>${e.name}</span>`;
}

/* ประเภทบริการ — ข้อมูลเดิมมีทั้งข้อความไทยและ key อังกฤษ */
export const SERVICES = [
  { value: 'ปรึกษาพยาบาล', key: 'consulted', ic: 'chat' },
  { value: 'สั่งจ่ายยาด้วยตนเอง', key: 'selfMedication', ic: 'pill' },
  { value: 'ใช้ห้องสังเกตอาการ', key: 'observeRoom', ic: 'bed' },
  { value: 'อุบัติเหตุ/ฉุกเฉิน', key: 'emergency', ic: 'siren', em: true },
  { value: 'ส่งต่อ/แนะนำ', key: 'refer', ic: 'external' },
];
export function serviceOf(v) {
  return SERVICES.find((s) => s.value === v || s.key === v) || null;
}
export function serviceTag(v) {
  const s = serviceOf(v);
  if (!s) return v ? html`<span class="svc">${v}</span>` : '';
  return html`<span class="svc${s.em ? ' em' : ''}">${icon(s.ic)}${s.value}</span>`;
}

/* แพ้ยา / โรคประจำตัว — เก็บเป็นข้อความเดียว; ค่าว่าง = ยังไม่ระบุ */
const NONE = ['ไม่มี', '-', 'none', 'no', 'n/a', 'ปฏิเสธ'];
export function safetyState(text) {
  const t = String(text ?? '').trim();
  if (!t) return { state: 'unknown', items: [] };
  if (NONE.includes(t.toLowerCase())) return { state: 'none', items: [] };
  return { state: 'has', items: t.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean) };
}

/* สีประจำ Disease system — กำหนดตามลำดับชื่อระบบใน ICD10 ให้สีคงที่ทุกหน้า */
const SYSTEM_PALETTE = [
  ['#E8ECF6', '#0A2463'], ['#E2F5F7', '#00788A'], ['#F0ECFB', '#5B3DB5'], ['#E8F5EC', '#136C34'],
  ['#FEF1E7', '#B54708'], ['#EAF2FC', '#1D5FB8'], ['#FCF4D6', '#7A5A00'], ['#FDEDEB', '#C0291D'],
  ['#FCE7F3', '#9D174D'], ['#F3EEE8', '#6B4423'], ['#EEF2E2', '#4D6114'],
];
const UNKNOWN_COLOR = ['#EEF0F2', '#465263'];
/** systems = รายชื่อ disease_system ทั้งหมด → คืนฟังก์ชัน (system) => [bg, fg] */
export function systemColors(systems) {
  const order = [...new Set(systems.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const map = new Map(order.map((s, i) => [s, SYSTEM_PALETTE[i % SYSTEM_PALETTE.length]]));
  return (s) => map.get(s) || UNKNOWN_COLOR;
}
/** ป้ายข้อความล้อมสีตาม Disease system */
export function systemPill(text, colors) {
  const [bg, fg] = colors;
  return html`<span class="pill" style="background:${bg};color:${fg};white-space:normal">${text}</span>`;
}

export const DEFAULT_DEPARTMENTS = ['P', 'N', 'Office', 'QA', 'Warehouse', 'Maintenance'];
export const ALLERGY_SUGGEST = ['Penicillin', 'Ibuprofen', 'ยาซัลฟา', 'Aspirin', 'NSAIDs', 'อาหารทะเล'];
export const DISEASE_SUGGEST = ['ความดันโลหิตสูง', 'เบาหวาน', 'หอบหืด', 'ไมเกรน', 'ไขมันในเลือดสูง'];
