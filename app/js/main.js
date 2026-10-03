// จุดเริ่มของแอป
import { initFirebase } from './core/firebase.js';
import { watchAuth, loginWithGoogle } from './core/session.js';
import { defineRoute, onRoute, startRouter } from './core/router.js';
import { html, icon, busy, toast } from './core/ui.js';
import { renderShell, setActiveNav } from './views/shell.js';
import queue from './views/queue.js';
import patients from './views/patients.js';
import opd from './views/opd.js';
import reports from './views/reports.js';
import inventory from './views/inventory.js';

const root = document.getElementById('root');

defineRoute('queue', queue);
defineRoute('patients', patients);
defineRoute('opd', opd);
defineRoute('reports', reports);
defineRoute('inventory', inventory);

function renderLogin(message = '') {
  root.innerHTML = String(html`
    <div class="login">
      <div class="card">
        <span class="logo">${icon('medBag')}</span>
        <div><h1>First Aid</h1><p class="muted">ระบบบันทึกการรักษา ห้องพยาบาล</p></div>
        ${message ? html`<div class="alertbar" style="width:100%">${icon('alert')}${message}</div>` : ''}
        <button type="button" class="btn primary lg" style="width:100%" data-login>${icon('google')}เข้าสู่ระบบด้วย Google</button>
        <p class="small muted">ใช้บัญชีที่ได้รับสิทธิ์จากผู้ดูแลระบบเท่านั้น</p>
      </div>
    </div>`);
  const btn = root.querySelector('[data-login]');
  btn.onclick = async () => {
    busy(btn, true, 'กำลังเข้าสู่ระบบ...');
    try { await loginWithGoogle(); }
    catch (e) { console.error(e); busy(btn, false); toast('เข้าสู่ระบบไม่สำเร็จ', 'คุณไม่ได้รับสิทธิ์การเข้าถึง', 'err'); }
  };
}

let started = false;
async function boot() {
  try {
    await initFirebase();
  } catch (e) {
    console.error(e);
    root.innerHTML = String(html`<div class="boot"><div class="empty err"><div class="ill">${icon('wifiOff', 'xl')}</div><h3>เชื่อมต่อระบบไม่สำเร็จ</h3><p>ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง</p><button class="btn" onclick="location.reload()">${icon('refresh')}ลองอีกครั้ง</button></div></div>`);
    return;
  }
  watchAuth((state) => {
    if (state === 'in') {
      if (started) return;
      started = true;
      const view = renderShell(root);
      onRoute(setActiveNav);
      startRouter('queue', view);
    } else if (state === 'denied') {
      started = false;
      renderLogin('บัญชีนี้ไม่ได้รับสิทธิ์ใช้งานระบบ');
    } else if (state === 'error') {
      renderLogin('โหลดข้อมูลผู้ใช้ไม่สำเร็จ กรุณาลองใหม่');
    } else {
      if (started) { location.reload(); return; } // logout ระหว่างใช้งาน → เริ่มใหม่
      renderLogin();
    }
  });
}

boot();
