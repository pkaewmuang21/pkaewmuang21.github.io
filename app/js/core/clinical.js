// กฎทางคลินิก: เกณฑ์ vital signs, ตรวจยาที่อาจแพ้, สถานะสต็อก/วันหมดอายุ
import { LOW_STOCK, EXPIRY_WARN_DAYS } from '../config.js';
import { toDate } from './format.js';

/* ---------------- vital signs ---------------- */
const n = (v) => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(x) ? null : x; };

export const VITALS = [
  { key: 'temperature', label: 'Temp', ic: 'thermometer', unit: '°C', normal: 'ปกติ 36.0–37.4', mode: 'decimal',
    check: (v) => { const x = n(v); if (x === null) return null; if (x >= 37.5) return { dir: 'up', msg: x >= 38 ? 'มีไข้' : 'ไข้ต่ำๆ' }; if (x < 36) return { dir: 'down', msg: 'ต่ำกว่าปกติ' }; return null; } },
  { key: 'pulse', label: 'Pulse', ic: 'pulse', unit: 'bpm', normal: 'ปกติ 60–100', mode: 'numeric',
    check: (v) => { const x = n(v); if (x === null) return null; if (x > 100) return { dir: 'up', msg: 'เร็วกว่าปกติ' }; if (x < 60) return { dir: 'down', msg: 'ช้ากว่าปกติ' }; return null; } },
  { key: 'respiration', label: 'RR', ic: 'wind', unit: '/min', normal: 'ปกติ 12–20', mode: 'numeric',
    check: (v) => { const x = n(v); if (x === null) return null; if (x > 20) return { dir: 'up', msg: 'หายใจเร็ว' }; if (x < 12) return { dir: 'down', msg: 'หายใจช้า' }; return null; } },
  { key: 'bloodPressure', label: 'BP', ic: 'activity', unit: 'mmHg', normal: 'ปกติ < 140/90', mode: 'text', placeholder: '120/80',
    check: (v) => {
      const m = String(v ?? '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
      if (!m) return String(v ?? '').trim() ? { dir: '', msg: 'รูปแบบ เช่น 120/80' } : null;
      const [s, d] = [+m[1], +m[2]];
      if (s >= 140 || d >= 90) return { dir: 'up', msg: 'สูงกว่าปกติ (≥ 140/90) · วัดซ้ำใน 15 นาที' };
      if (s < 90 || d < 60) return { dir: 'down', msg: 'ต่ำกว่าปกติ (< 90/60)' };
      return null;
    } },
  { key: 'oxygenSaturation', label: 'SpO2', ic: 'droplet', unit: '%', normal: 'ปกติ ≥ 95', mode: 'numeric',
    check: (v) => { const x = n(v); if (x === null) return null; if (x < 95) return { dir: 'down', msg: 'ต่ำกว่า 95' }; return null; } },
];

export const PAIN_TEXT = ['ไม่ปวด', 'ปวดเล็กน้อย', 'ปวดเล็กน้อย', 'ปวดเล็กน้อย', 'ปวดปานกลาง', 'ปวดปานกลาง', 'ปวดปานกลาง', 'ปวดมาก', 'ปวดมาก', 'ปวดมากที่สุด', 'ปวดมากที่สุด'];

/* ---------------- ยาที่อาจแพ้ ---------------- */
// กลุ่มยาที่แพ้ข้ามกันได้บ่อย (ใช้เตือนเท่านั้น ไม่ใช่การวินิจฉัย)
const GROUPS = [
  { name: 'NSAIDs', words: ['nsaid', 'ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'aspirin', 'piroxicam', 'celecoxib', 'etoricoxib', 'indomethacin', 'ketoprofen'] },
  { name: 'Penicillins', words: ['penicillin', 'amoxicillin', 'ampicillin', 'cloxacillin', 'dicloxacillin', 'augmentin', 'เพนนิซิลิน'] },
  { name: 'Sulfonamides', words: ['sulfa', 'ซัลฟา', 'sulfamethoxazole', 'co-trimoxazole', 'bactrim'] },
];
const norm = (s) => String(s || '').toLowerCase().replace(/^(ยา|แพ้ยา|แพ้)\s*/, '').trim();
const firstWord = (s) => norm(s).split(/[\s(]+/)[0];

/**
 * ตรวจยาเทียบกับรายการแพ้ของพนักงาน
 * คืน null หรือ { allergy, kind: 'direct'|'group', group }
 */
export function allergyHit(medName, allergyItems) {
  const med = norm(medName);
  const medFirst = firstWord(medName);
  for (const a of allergyItems) {
    const al = norm(a);
    if (!al) continue;
    if (med.includes(al) || (medFirst.length >= 4 && al.includes(medFirst))) return { allergy: a, kind: 'direct' };
  }
  for (const g of GROUPS) {
    const medIn = g.words.some((w) => med.includes(w));
    if (!medIn) continue;
    const al = allergyItems.find((a) => g.words.some((w) => norm(a).includes(w)));
    if (al) return { allergy: al, kind: 'group', group: g.name };
  }
  return null;
}

/* ---------------- สต็อก / วันหมดอายุ ---------------- */
export function daysTo(date) {
  const d = toDate(date); if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.floor((d - t) / 86400000);
}

/** สถานะยา: { expired, expiring, days, out, low } */
export function medStatus(m, after = m.qty) {
  const days = m.expiry ? daysTo(m.expiry) : null;
  return {
    days,
    expired: days !== null && days <= 0,
    expiring: days !== null && days > 0 && days <= EXPIRY_WARN_DAYS,
    out: after <= 0,
    low: after > 0 && after < LOW_STOCK,
  };
}
