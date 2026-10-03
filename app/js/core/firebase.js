// โหลด Firebase (compat SDK) หรือ mock ตามโหมด แล้วคืน { auth, db, functions, firebase }
import { firebaseConfig, MODE } from '../config.js';

const SDK = '9.23.0';
const SDK_FILES = ['app', 'auth', 'firestore', 'functions'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('โหลดสคริปต์ไม่สำเร็จ: ' + src));
    document.head.append(s);
  });
}

let ctx = null;
export async function initFirebase() {
  if (ctx) return ctx;
  if (MODE === 'mock') {
    await loadScript(new URL('../mock/mock-firebase.js', import.meta.url).href);
  } else {
    for (const f of SDK_FILES) await loadScript(`https://www.gstatic.com/firebasejs/${SDK}/firebase-${f}-compat.js`);
  }
  const fb = window.firebase;
  fb.initializeApp(firebaseConfig);
  ctx = { firebase: fb, auth: fb.auth(), db: fb.firestore(), functions: fb.functions() };
  return ctx;
}

export const fb = () => {
  if (!ctx) throw new Error('Firebase ยังไม่ถูก init');
  return ctx;
};
