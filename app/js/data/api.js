// ชั้นข้อมูล: ทุกการอ่าน/เขียน Firestore อยู่ที่นี่ (โครงสร้าง collection/field เหมือนระบบเดิม)
import { fb } from '../core/firebase.js';
import { getCrypto, setCrypto, loadEmployeesCache, saveEmployeesCache } from './cache.js';

const db = () => fb().db;
const FieldValue = () => fb().firebase.firestore.FieldValue;
const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/* ================= CN encryption (Cloud Functions) ================= */
export async function encryptCN(text) {
  const key = `enc_${text}`;
  const cached = await getCrypto(key);
  if (cached) return cached;
  const r = await fb().functions.httpsCallable('encryptText')({ text });
  await setCrypto(key, r.data.encrypted);
  return r.data.encrypted;
}
export async function decryptCN(encrypted) {
  if (!encrypted) return '';
  const key = `dec_${encrypted}`;
  const cached = await getCrypto(key);
  if (cached) return cached;
  const r = await fb().functions.httpsCallable('decryptText')({ encrypted });
  await setCrypto(key, r.data.decrypted);
  return r.data.decrypted;
}

/* ================= staff / location ================= */
export async function getStaffByEmail(email) {
  const snap = await db().collection('staff').where('email', '==', email).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}
export async function listLocations() {
  const snap = await db().collection('location').get();
  return docs(snap).map((l) => l.name).filter(Boolean);
}
export function updateStaffLocation(staffId, location) {
  return db().collection('staff').doc(staffId).update({ location });
}

/* ================= employees (พนักงาน) ================= */
let employeesMem = null; // [{ id, cn, department, ... }]

function shapeEmployee(raw, cn) {
  return {
    id: raw.id,
    cn,
    employeeId: raw.employeeId,
    department: raw.department || '',
    birthdate: raw.birthdate || '',
    phone: raw.phone || '',
    congenitalDisease: raw.congenitalDisease ?? '',
    allergies: raw.allergies ?? '',
    createdDate: raw.createdDate || null,
    updateDate: raw.updateDate || null,
  };
}

/** รายชื่อพนักงานทั้งหมดพร้อม CN ที่ถอดรหัสแล้ว (cache ใน IndexedDB 1 วันเหมือนระบบเดิม) */
export async function getEmployees({ refresh = false } = {}) {
  if (employeesMem && !refresh) return employeesMem;
  let raw = refresh ? null : await loadEmployeesCache();
  if (!raw) {
    const snap = await db().collection('employees').get();
    raw = snap.docs.map((d) => ({ id: d.id, ...d.data(), timestamp: Date.now() }));
    await saveEmployeesCache(raw);
  }
  const cns = await Promise.all(raw.map((e) => decryptCN(e.employeeId).catch(() => '')));
  employeesMem = raw.map((e, i) => shapeEmployee(e, cns[i]));
  return employeesMem;
}

export async function getEmployee(id) {
  const d = await db().collection('employees').doc(id).get();
  if (!d.exists) return null;
  const data = { id: d.id, ...d.data() };
  return shapeEmployee(data, await decryptCN(data.employeeId));
}

async function rememberEmployee(id, fields) {
  const enc = fields.employeeId;
  const rec = { id, ...fields, timestamp: Date.now() };
  await saveEmployeesCache([rec]);
  if (employeesMem) {
    const shaped = shapeEmployee(rec, await decryptCN(enc));
    const i = employeesMem.findIndex((e) => e.id === id);
    if (i >= 0) employeesMem[i] = { ...employeesMem[i], ...shaped }; else employeesMem.push(shaped);
  }
}

/** เพิ่มพนักงานใหม่ — field เหมือนระบบเดิม */
export async function addEmployee({ cn, department, birthdate, phone, congenitalDisease, allergies }, staffName) {
  const employeeId = await encryptCN(cn);
  const fields = { employeeId, department, birthdate, phone, congenitalDisease, allergies };
  const ref = await db().collection('employees').add({
    ...fields, createdDate: FieldValue().serverTimestamp(), createdBy: staffName,
  });
  await rememberEmployee(ref.id, { ...fields, createdDate: new Date() });
  return ref.id;
}

/** แก้ไขข้อมูลพนักงาน — ระบบเดิมเขียน createdBy ทับด้วยผู้แก้ไข จึงคงไว้แบบเดิม */
export async function updateEmployee(id, { cn, department, birthdate, phone, congenitalDisease, allergies }, staffName) {
  const employeeId = await encryptCN(cn);
  const fields = { employeeId, department, birthdate, phone, congenitalDisease, allergies };
  await db().collection('employees').doc(id).update({
    ...fields, updateDate: FieldValue().serverTimestamp(), createdBy: staffName,
  });
  await rememberEmployee(id, fields);
}

/* ================= opdCard (ประวัติการรักษา) ================= */
/** ประวัติการรักษาของพนักงาน ใหม่สุดก่อน — ถ้าไม่ใช่ admin เห็นเฉพาะ location ของตัวเอง (เหมือนเดิม) */
export async function listOpdCards(employeeDocId, staff) {
  let q = db().collection('employees').doc(employeeDocId).collection('opdCard');
  if (!staff.isAdmin) q = q.where('location', '==', staff.location);
  const snap = await q.orderBy('visitDate', 'desc').get();
  return docs(snap);
}

/**
 * การรักษาทั้งหมดในช่วงวันที่ (ใช้ query collectionGroup เดียวกับรายงานระบบเดิม)
 * start/end เป็น 'YYYY-MM-DD' — ไม่ใช่ admin เห็นเฉพาะ location ของตัวเอง, admin เลือก location ได้ ('' = ทั้งหมด)
 * คืน [{ id, empId, ...opdCard }]
 */
export async function listOpdCardsInRange(start, end, location, staff) {
  let q = db().collectionGroup('opdCard').where('visitDate', '>=', start).where('visitDate', '<=', end + 'T23:59:59');
  if (!staff.isAdmin) q = q.where('location', '==', staff.location);
  else if (location) q = q.where('location', '==', location);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, empId: d.ref.parent.parent.id, ...d.data() }));
}

/**
 * บันทึกการรักษา (field เหมือนระบบเดิม) แล้วตัดสต็อกยาตามชื่อยา
 * คืน { id, stockErrors: [ชื่อยาที่ตัดสต็อกไม่สำเร็จ] }
 */
export async function addOpdCard(employeeDocId, card, staff) {
  const ref = await db().collection('employees').doc(employeeDocId).collection('opdCard').add({
    ...card,
    location: staff.location,
    createdDate: FieldValue().serverTimestamp(),
    createdBy: staff.name,
  });
  const stockErrors = [];
  for (const m of card.medicines || []) {
    try { await deductStock(m.name, Number(m.quantity) || 0); }
    catch (e) { console.error('deductStock', m.name, e); stockErrors.push(m.name); }
  }
  medicinesMem = null; // ให้โหลดสต็อกใหม่ครั้งถัดไป
  allOpdMem = null;
  return { id: ref.id, stockErrors };
}

/** ตัดสต็อกแบบระบบเดิม: หา medicine จากชื่อ แล้วตั้ง qty = qty - จำนวน */
async function deductStock(name, quantity) {
  if (!quantity) return;
  const snap = await db().collection('medicine').where('name', '==', name).get();
  if (snap.empty) return;
  const d = snap.docs[0];
  const qty = (Number(d.data().qty) || 0) - quantity;
  await db().collection('medicine').doc(d.id).update({ qty, updateDate: FieldValue().serverTimestamp() });
}

/* ================= medicine ================= */
let medicinesMem = null;
/** รายการยาทั้งหมด [{ id, name, type, unit, qty(number), expiry, usage[] }] */
export async function listMedicines({ refresh = false } = {}) {
  if (medicinesMem && !refresh) return medicinesMem;
  const snap = await db().collection('medicine').get();
  medicinesMem = docs(snap).map((m) => ({
    ...m,
    qty: Number(m.qty) || 0,
    usage: Array.isArray(m.usage) ? m.usage : m.usage ? [m.usage] : [],
  })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
  return medicinesMem;
}

/** แก้ไขยา (field เหมือนระบบเดิม; ระบบเดิมเขียน createdBy ทับด้วยผู้แก้ไข) */
export async function updateMedicine(id, { name, type, expiry, qty }, staff) {
  await db().collection('medicine').doc(id).update({
    name, type, expiry, qty: Number(qty) || 0,
    updateDate: FieldValue().serverTimestamp(), createdBy: staff.name,
  });
  medicinesMem = null;
}

/** ลบยา พร้อมประวัติรับ/จ่าย (subcollection transactions) */
export async function deleteMedicine(id) {
  const ref = db().collection('medicine').doc(id);
  const tx = await ref.collection('transactions').get();
  await Promise.all(tx.docs.map((d) => d.ref.delete()));
  await ref.delete();
  medicinesMem = null;
}

/**
 * รับยาเข้า / จ่ายยาออก (เหมือนระบบเดิม): เพิ่ม transactions แล้วปรับ qty
 * type: 'receive' | 'dispense', subType: 'Receive' | 'Expire' | 'Distribute to Other site' | 'Internal Supplies Requisition'
 */
export async function addMedicineTransaction(id, { type, subType, qty, date }, staff) {
  const ref = db().collection('medicine').doc(id);
  const snap = await ref.get();
  const current = Number(snap.data()?.qty) || 0;
  const newQty = type === 'receive' ? current + qty : current - qty;
  await ref.collection('transactions').add({
    createdBy: staff.name,
    createDate: fb().firebase.firestore.Timestamp.fromDate(new Date(date)),
    qty, type, subType,
  });
  await ref.update({ qty: newQty, updateDate: FieldValue().serverTimestamp() });
  medicinesMem = null;
  return newQty;
}

/** ประวัติรับ/จ่ายของยา (subcollection transactions) */
export async function listMedicineTransactions(id) {
  const snap = await db().collection('medicine').doc(id).collection('transactions').get();
  return docs(snap);
}

/** การรักษาทั้งหมด (ใช้หาประวัติจ่ายยาให้พนักงานในหน้าคลังยา) — cache ไว้ระหว่างใช้งานหน้า */
let allOpdMem = null;
export async function listAllOpdCards({ refresh = false } = {}) {
  if (allOpdMem && !refresh) return allOpdMem;
  const snap = await db().collectionGroup('opdCard').get();
  allOpdMem = snap.docs.map((d) => ({ id: d.id, empId: d.ref.parent.parent.id, ...d.data() }));
  return allOpdMem;
}

/** medical_icd10_mapping → { [icdCode]: ประเภทยาที่แนะนำ } */
let icdMapMem = null;
export async function getIcdCategoryMap() {
  if (icdMapMem) return icdMapMem;
  const snap = await db().collection('medical_icd10_mapping').get();
  icdMapMem = {};
  snap.forEach((d) => { const x = d.data(); (x.icd_10 || []).forEach((code) => { icdMapMem[code] = x.category; }); });
  return icdMapMem;
}

/* ================= queue (คิวรอตรวจ) — collection ใหม่ ระบบเดิมไม่อ่าน ================= */
const ts = (d) => fb().firebase.firestore.Timestamp.fromDate(d);
const counterId = (location, date) => `${String(location).replace(/\//g, '_')}_${date}`;
export const OPEN_STATUSES = ['waiting', 'in_progress', 'observe'];

/**
 * ฟังคิวของ location ในวันที่กำหนดแบบ real-time
 * คืนฟังก์ชันยกเลิกการฟัง
 */
export function watchQueue(location, date, onData, onError) {
  return db().collection('queue').where('location', '==', location).where('date', '==', date)
    .onSnapshot((snap) => onData(docs(snap)), (e) => { console.error('watchQueue', e); onError && onError(e); });
}

/**
 * คิวที่ยังไม่ปิดของ location (ทุกวัน) — ใช้หาคิวค้างข้ามวัน
 * ใช้เฉพาะเงื่อนไขเท่ากับ/in จึงไม่ต้องสร้าง composite index
 */
export async function listOpenQueues(location) {
  const snap = await db().collection('queue').where('location', '==', location).where('status', 'in', OPEN_STATUSES).get();
  return docs(snap);
}

/** ข้อความ error ที่อ่านเข้าใจได้ (เช่น ติด Firestore rules) */
export function errorText(e) {
  if (e?.code === 'permission-denied') return 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลนี้ — ผู้ดูแลระบบต้องตรวจ Firestore Security Rules';
  if (e?.code === 'unavailable') return 'เชื่อมต่อฐานข้อมูลไม่ได้ ตรวจสอบอินเทอร์เน็ต';
  if (e?.code === 'failed-precondition') return 'ฐานข้อมูลต้องสร้าง index เพิ่ม (ดูลิงก์ใน console ของเบราว์เซอร์)';
  return 'ลองอีกครั้ง';
}

/** เพิ่มคิว — เลขคิวรันต่อเนื่องรายวันแยก location (transaction กันเลขซ้ำเมื่อหลายเครื่องกดพร้อมกัน) */
export async function addToQueue({ employeeDocId, chiefComplaint, esi, arrivedAt, start = false }, staff) {
  const date = ymdLocal(arrivedAt);
  const counterRef = db().collection('queueCounter').doc(counterId(staff.location, date));
  const ref = db().collection('queue').doc();
  const now = new Date();
  const no = await db().runTransaction(async (tx) => {
    const c = await tx.get(counterRef);
    const next = (c.exists ? Number(c.data().last) || 0 : 0) + 1;
    tx.set(counterRef, { location: staff.location, date, last: next });
    tx.set(ref, {
      date, location: staff.location, no: next, employeeDocId, chiefComplaint, esi: Number(esi),
      status: start ? 'in_progress' : 'waiting', esiHistory: [],
      arrivedAt: ts(arrivedAt), createdAt: ts(now), updatedAt: ts(now), createdBy: staff.name,
      ...(start ? { startedAt: ts(now), assignedTo: staff.name } : {}),
    });
    return next;
  });
  return { id: ref.id, no };
}

function queueUpdate(id, patch) {
  return db().collection('queue').doc(id).update({ ...patch, updatedAt: FieldValue().serverTimestamp() });
}
export const startQueue = (id, staff) => queueUpdate(id, { status: 'in_progress', startedAt: ts(new Date()), assignedTo: staff.name });
export const observeQueue = (id, staff, startedAt) => queueUpdate(id, {
  status: 'observe', observeAt: ts(new Date()), ...(startedAt ? {} : { startedAt: ts(new Date()), assignedTo: staff.name }),
});
/** ปิดคิวหลังบันทึกการรักษา: status 'done' หรือ 'referred' พร้อมผูก opdCardId */
export const closeQueue = (id, status, opdCardId, staff) => queueUpdate(id, { status, opdCardId, closedAt: ts(new Date()), closedBy: staff.name });
export async function getQueue(id) {
  const d = await db().collection('queue').doc(id).get();
  return d.exists ? { id: d.id, ...d.data() } : null;
}
export const cancelQueue = (id, reason, staff) => queueUpdate(id, { status: 'cancelled', cancelReason: reason, closedAt: ts(new Date()), closedBy: staff.name });
/** เปลี่ยน ESI พร้อมเก็บประวัติ */
export function retriageQueue(q, esi, staff) {
  const hist = [...(q.esiHistory || []), { from: q.esi, to: Number(esi), at: ts(new Date()), by: staff.name }];
  return queueUpdate(q.id, { esi: Number(esi), esiHistory: hist });
}

function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ================= ICD10 ================= */
let icdMem = null;
/** รายการ ICD10 ทั้งหมด [{ id, code, short_description, disease_system }] เรียงตามชื่อ */
export async function getIcd10() {
  if (icdMem) return icdMem;
  const snap = await db().collection('ICD10').orderBy('short_description').get();
  icdMem = docs(snap);
  return icdMem;
}
/** หา ICD10 จากค่า diagnosis ที่เก็บใน opdCard (เก็บเป็น short_description) */
export async function icdLookup() {
  const list = await getIcd10();
  const m = new Map();
  list.forEach((x) => { m.set(x.short_description, x); if (x.code) m.set(x.code, x); });
  return (diag) => m.get(diag) || null;
}
