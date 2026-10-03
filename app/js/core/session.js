// สถานะผู้ใช้ที่ login (staff) + การ login/logout + timeout แบบระบบเดิม
import { fb } from './firebase.js';
import { MODE, SESSION_MAX_HOURS, IDLE_LOGOUT_MINUTES } from '../config.js';
import * as api from '../data/api.js';

export const session = {
  user: null,     // firebase user
  staff: null,    // { id, name, email, location, isAdmin }
  listeners: new Set(),
};

export const onSessionChange = (fn) => { session.listeners.add(fn); return () => session.listeners.delete(fn); };
const emit = () => session.listeners.forEach((fn) => fn(session));

/** เริ่มฟังสถานะ login: callback(state) โดย state = 'in' | 'out' | 'denied' */
export function watchAuth(cb) {
  fb().auth.onAuthStateChanged(async (user) => {
    if (!user) { session.user = session.staff = null; cb('out'); return; }
    try {
      if (MODE !== 'mock') {
        const t = await user.getIdTokenResult();
        if ((Date.now() - new Date(t.authTime).getTime()) / 3.6e6 > SESSION_MAX_HOURS) { await logout(); return; }
      }
      const staff = await api.getStaffByEmail(user.email);
      if (!staff) { await fb().auth.signOut(); session.user = session.staff = null; cb('denied'); return; }
      session.user = user;
      session.staff = staff;
      startIdleTimer();
      cb('in');
    } catch (e) {
      console.error(e);
      cb('error', e);
    }
  });
}

export function loginWithGoogle() {
  const { firebase, auth } = fb();
  return auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
}

export async function logout() {
  await fb().auth.signOut();
  if (MODE === 'mock') location.reload();
}

export async function setLocation(location) {
  await api.updateStaffLocation(session.staff.id, location);
  session.staff = { ...session.staff, location };
  emit();
}

let idleTimer;
function startIdleTimer() {
  if (MODE === 'mock' || startIdleTimer.on) return;
  startIdleTimer.on = true;
  const reset = () => { clearTimeout(idleTimer); idleTimer = setTimeout(logout, IDLE_LOGOUT_MINUTES * 60000); };
  ['mousemove', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
  reset();
}
