// ค่าตั้งของแอป
export const firebaseConfig = {
  apiKey: 'AIzaSyC5WWSxG9iLQMZqO057qZ-Q4EA19d3Q1eE',
  authDomain: 'pg-firstaid.firebaseapp.com',
  projectId: 'pg-firstaid',
};

/**
 * โหมดข้อมูล
 *  - 'firebase' : ใช้ Firestore + Google login จริง (ค่าเริ่มต้น)
 *  - 'mock'     : ใช้ข้อมูลจำลองในเบราว์เซอร์ ไม่ต้อง login (สำหรับพัฒนา/รีวิวดีไซน์)
 * เปิดโหมด mock ด้วย URL ?mode=mock ได้เฉพาะตอนรันบนเครื่อง (localhost)
 * เพื่อกันผู้ใช้จริงบันทึกข้อมูลลงโหมดจำลองโดยไม่ตั้งใจ
 */
export const DEFAULT_MODE = 'firebase';
const LOCAL = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);

export const MODE = (() => {
  const q = new URLSearchParams(location.search).get('mode');
  if (q === 'mock' && LOCAL) return 'mock';
  if (q === 'firebase') return 'firebase';
  return DEFAULT_MODE;
})();

export const SESSION_MAX_HOURS = 9;   // บังคับ login ใหม่เมื่อ login นานเกินนี้ (เหมือนระบบเดิม)
export const IDLE_LOGOUT_MINUTES = 60; // ออกจากระบบเมื่อไม่มีการใช้งาน (เหมือนระบบเดิม)
export const LOW_STOCK = 25;          // คงเหลือต่ำกว่านี้ = ใกล้หมด
export const EXPIRY_WARN_DAYS = 90;   // หมดอายุภายในกี่วัน = ใกล้หมดอายุ
