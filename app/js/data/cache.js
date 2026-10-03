// IndexedDB cache (เหมือนระบบเดิม): ผลเข้า/ถอดรหัส CN 7 วัน และรายชื่อพนักงาน 1 วัน
import { MODE } from '../config.js';

const PREFIX = MODE === 'mock' ? 'mock_' : '';
const DAY = 24 * 60 * 60 * 1000;

function openDb(name, store, keyPath) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PREFIX + name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

/* ----- crypto cache (DB เดิมชื่อ myCacheDB / store cache) ----- */
const cryptoDb = () => openDb('myCacheDB', 'cache', 'key');

export async function getCrypto(key, maxAge = 7 * DAY) {
  try {
    const db = await cryptoDb();
    const item = await tx(db, 'cache', 'readonly', (s) => s.get(key));
    if (!item || Date.now() - item.timestamp > maxAge) return null;
    return item.value;
  } catch { return null; }
}
export async function setCrypto(key, value) {
  try {
    const db = await cryptoDb();
    await tx(db, 'cache', 'readwrite', (s) => s.put({ key, value, timestamp: Date.now() }));
  } catch { /* cache ไม่สำคัญ */ }
}

/* ----- employees cache (DB เดิมชื่อ MyAppDB / store employees) ----- */
const empDb = () => openDb('MyAppDB', 'employees', 'id');

export async function loadEmployeesCache(maxAge = DAY) {
  try {
    const db = await empDb();
    const all = (await tx(db, 'employees', 'readonly', (s) => s.getAll())) || [];
    const fresh = all.filter((e) => Date.now() - (e.timestamp || 0) <= maxAge);
    return fresh.length && fresh.length === all.length ? fresh : null; // มีรายการหมดอายุ → โหลดใหม่ทั้งหมด
  } catch { return null; }
}
export async function saveEmployeesCache(list) {
  try {
    const db = await empDb();
    await tx(db, 'employees', 'readwrite', (s) => list.forEach((e) => s.put({ ...e, timestamp: e.timestamp || Date.now() })));
  } catch { /* ignore */ }
}
export async function clearEmployeesCache() {
  try {
    const db = await empDb();
    await tx(db, 'employees', 'readwrite', (s) => s.clear());
  } catch { /* ignore */ }
}
