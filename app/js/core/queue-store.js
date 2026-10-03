// สถานะคิววันนี้ของ location ปัจจุบัน (ฟังแบบ real-time) — ใช้ร่วมกันระหว่างแถบด้านบนและหน้าคิว
import * as api from '../data/api.js';
import { session, onSessionChange } from './session.js';
import { ymd, toDate } from './format.js';
import { esiOf } from './codes.js';

const state = { items: null, err: null, date: '', location: '', stale: [] };
const listeners = new Set();
let unsub = null;

const emit = () => listeners.forEach((fn) => fn(state));

function subscribe() {
  unsub && unsub();
  state.date = ymd(new Date());
  state.location = session.staff.location || '';
  state.items = null; state.err = null;
  emit();
  refreshStale();
  unsub = api.watchQueue(state.location, state.date,
    (items) => { state.items = items; state.err = null; emit(); },
    (e) => { state.err = e; emit(); });
}

let started = false;
export function startQueueStore() {
  if (started) return;
  started = true;
  subscribe();
  onSessionChange((s) => { if (s.staff.location !== state.location) subscribe(); });
  setInterval(() => { if (ymd(new Date()) !== state.date) subscribe(); }, 60000); // ข้ามวัน
}
export const retryQueue = subscribe;

/** คิวที่ยังไม่ปิดจากวันก่อน ๆ (ไม่ real-time — โหลดใหม่เมื่อเปลี่ยน location/วัน หรือหลังจัดการ) */
export async function refreshStale() {
  const loc = state.location, date = state.date;
  try {
    const open = await api.listOpenQueues(loc);
    if (loc !== state.location) return;
    state.stale = open.filter((q) => q.date < date).sort((a, b) => (a.date + String(a.no).padStart(4, '0')).localeCompare(b.date + String(b.no).padStart(4, '0')));
  } catch (e) { console.error('refreshStale', e); state.stale = []; }
  emit();
}

/** ฟังการเปลี่ยนแปลง — เรียก fn ทันทีหนึ่งครั้ง คืนฟังก์ชันยกเลิก */
export function onQueue(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
export const queueState = () => state;

/* ---------------- คำนวณเวลารอ ---------------- */
const pad = (n) => String(n).padStart(2, '0');
export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * ข้อมูลเวลาของคิว ณ ตอนนี้
 * level: 'ok' | 'near' | 'over' (เฉพาะรอตรวจ) — sec: วินาทีที่นับ, sub: ข้อความใต้ตัวเลข
 */
export function waitInfo(q, now = Date.now()) {
  const e = esiOf(q.esi);
  if (q.status === 'waiting') {
    const sec = (now - toDate(q.arrivedAt)) / 1000, min = sec / 60;
    if (!e) return { sec, level: 'ok', sub: '' };
    if (min > e.hi) return { sec, level: 'over', sub: `เกินเป้า ${Math.floor(min - e.hi)} นาที` };
    if (min >= e.lo) return { sec, level: 'near', sub: `ใกล้ครบเป้า ${e.hi >= 60 ? e.hi / 60 + ' ชม.' : e.hi + ' นาที'}` };
    return { sec, level: 'ok', sub: `เป้า ${e.short}` };
  }
  if (q.status === 'in_progress') return { sec: (now - toDate(q.startedAt)) / 1000, level: 'ok', sub: `กำลังตรวจ · ${q.assignedTo || '-'}` };
  if (q.status === 'observe') return { sec: (now - toDate(q.observeAt || q.startedAt)) / 1000, level: 'ok', sub: `ห้องสังเกต · ${q.assignedTo || '-'}` };
  return { sec: 0, level: 'ok', sub: '' };
}

export const isOverdue = (q, now) => q.status === 'waiting' && waitInfo(q, now).level === 'over';

/** สรุปตัวเลขของวัน */
export function summary(items, now = Date.now()) {
  const by = (s) => items.filter((q) => q.status === s);
  const started = items.filter((q) => q.startedAt && q.arrivedAt);
  const avg = started.length ? started.reduce((s, q) => s + (toDate(q.startedAt) - toDate(q.arrivedAt)), 0) / started.length / 60000 : null;
  return {
    waiting: by('waiting').length, progress: by('in_progress').length, observe: by('observe').length,
    overdue: items.filter((q) => isOverdue(q, now)).length,
    avgWaitMin: avg === null ? null : Math.max(0, Math.round(avg)),
  };
}
