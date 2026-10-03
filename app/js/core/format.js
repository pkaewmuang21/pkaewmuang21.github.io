// การแปลงวันที่/ข้อความ แสดงผลแบบไทย (พ.ศ.)

/** แปลงค่าวันที่จาก Firestore / IndexedDB / string ให้เป็น Date */
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  if (typeof v._ms === 'number') return new Date(v._ms);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

const fmt = (opts) => new Intl.DateTimeFormat('th-TH', opts);
const F = {
  short: fmt({ day: 'numeric', month: 'short', year: '2-digit' }),
  medium: fmt({ day: 'numeric', month: 'short', year: 'numeric' }),
  long: fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  chip: fmt({ weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' }),
  time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }),
};

const out = (f, v) => { const d = toDate(v); return d ? f.format(d) : '-'; };
export const dateShort = (v) => out(F.short, v);        // 21 พ.ค. 69
export const dateMedium = (v) => out(F.medium, v);      // 21 พ.ค. 2569
export const dateLong = (v) => out(F.long, v);          // วันเสาร์ที่ 3 ตุลาคม 2569
export const dateChip = (v) => out(F.chip, v);          // ส. 3 ต.ค. 69
export const time = (v) => out(F.time, v);              // 15:48

export function ageYears(birth) {
  const b = toDate(birth); if (!b) return null;
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ymdhm = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 0891234567 → 089-123-4567 */
export function phone(p) {
  const s = String(p || '').replace(/\D/g, '');
  if (s.length === 10) return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}`;
  if (s.length === 9) return `${s.slice(0, 2)}-${s.slice(2, 5)}-${s.slice(5)}`;
  return p || '-';
}

/** อักษรย่อจากชื่อ เช่น "พยาบาล วิภา" → "วภ" */
export function initials(name) {
  const last = String(name || '').trim().split(/\s+/).pop() || '';
  const letters = [...last].filter((c) => /[ก-ฮA-Za-z]/.test(c));
  return (letters.slice(0, 2).join('') || '?').toUpperCase();
}

export const num = (n) => Number(n || 0).toLocaleString('th-TH');
