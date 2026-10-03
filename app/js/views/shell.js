// โครงหน้า: แถบเมนูซ้าย + แถบบน (ค้นหา CN, วันเวลา, location, ผู้ใช้)
import { html, icon, el, $, popover, toast } from '../core/ui.js';
import { session, onSessionChange, setLocation, logout } from '../core/session.js';
import { dateChip, time } from '../core/format.js';
import { go, href } from '../core/router.js';
import { MODE } from '../config.js';
import * as api from '../data/api.js';
import { startQueueStore, onQueue, queueState, summary } from '../core/queue-store.js';

export const NAV = [
  { name: 'queue', label: 'คิวรอตรวจ', ic: 'queue' },
  { name: 'patients', label: 'ค้นหาพนักงาน', ic: 'search' },
  { name: 'opd', label: 'บันทึกการรักษา', ic: 'clipboard' },
  { name: 'reports', label: 'รายงาน', ic: 'chart' },
  { name: 'inventory', label: 'คลังยา', ic: 'pill' },
];

export function renderShell(root) {
  const s = session.staff;
  root.innerHTML = String(html`
    <div class="app">
      <nav class="side" aria-label="เมนูหลัก">
        <div class="brand"><span class="logo">${icon('medBag')}</span><span class="txt"><b>First Aid</b><small>ห้องพยาบาล</small></span></div>
        ${NAV.map((n) => html`<a class="nav" data-nav="${n.name}" href="${href(n.name)}">${icon(n.ic)}<span>${n.label}</span>${n.name === 'queue' ? html`<span class="count" data-qcount></span>` : ''}</a>`)}
        <div class="side-foot">
          <div><span>ค้นหา CN</span><span class="kbd">/</span></div>
        </div>
      </nav>
      <div class="main">
        <header class="top">
          <form class="search" role="search" data-gsearch><span>${icon('search')}</span><input type="text" inputmode="numeric" placeholder="ค้นหา CN" title="พิมพ์ CN หรือกด Enter เพื่อดูพนักงานทั้งหมด" aria-label="ค้นหา CN"><span class="kbd dark">/</span></form>
          <span class="spacer"></span>
          <a class="qbadge" href="${href('queue')}" data-qbadge hidden></a>
          ${MODE === 'mock' ? html`<span class="mock-badge" title="ใช้ข้อมูลจำลอง ไม่เชื่อมต่อฐานข้อมูลจริง">${icon('info', 'sm')}จำลอง</span>` : ''}
          <span class="chip num" data-clock>${icon('calendar')}<span></span></span>
          <button class="chip loc" type="button" data-loc>${icon('pin')}<span data-loc-name>${s.location || '-'}</span>${s.isAdmin ? icon('chevronDown', 'sm') : ''}</button>
          <button class="user" type="button" data-user style="border-top:0;border-right:0;border-bottom:0;background:transparent;cursor:pointer">
            <span class="avatar" aria-hidden="true">${icon('nurse')}</span><span class="who" style="text-align:left"><b style="font-weight:500;font-size:14px">${s.name}</b><small>${s.isAdmin ? 'Admin' : 'เจ้าหน้าที่'}</small></span>
          </button>
        </header>
        <main id="view" tabindex="-1"></main>
      </div>
    </div>`);

  // คิว: ตัวเลขบนเมนูและป้ายบนแถบด้านบน (อัปเดตสดทุก 15 วินาทีสำหรับคิวที่เกินเวลา)
  startQueueStore();
  const qbadge = $('[data-qbadge]', root), qcount = $('[data-qcount]', root);
  const paintQueue = (st) => {
    if (!st.items) { qbadge.hidden = true; qcount.textContent = ''; return; }
    const s = summary(st.items);
    qcount.textContent = s.waiting || '';
    qbadge.hidden = false;
    qbadge.classList.add('ok');
    qbadge.innerHTML = String(html`<b>${s.waiting}</b>รอตรวจ`);
  };
  onQueue(paintQueue);

  // นาฬิกา
  const clock = $('[data-clock] span', root);
  const tick = () => { const n = new Date(); clock.textContent = `${dateChip(n)} · ${time(n)}`; };
  tick(); setInterval(tick, 15000);

  // ค้นหา CN ด้านบน
  const gs = $('[data-gsearch]', root);
  gs.addEventListener('submit', (e) => { e.preventDefault(); const q = gs.querySelector('input').value.trim(); go('patients', q ? { q } : { all: 1 }); gs.querySelector('input').value = ''; });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('.layer')) return;
    e.preventDefault();
    (document.querySelector('[data-page-search]') || gs.querySelector('input')).focus();
  });

  // เปลี่ยน location (เฉพาะ admin เหมือนระบบเดิม)
  const locBtn = $('[data-loc]', root);
  locBtn.addEventListener('click', async () => {
    if (!session.staff.isAdmin) return;
    let locs = [];
    try { locs = await api.listLocations(); } catch { toast('โหลด location ไม่สำเร็จ', '', 'err'); return; }
    popover(locBtn, String(html`<span class="cap">เปลี่ยน location ของฉัน</span>${locs.map((l) => html`<button type="button" data-l="${l}" class="${l === session.staff.location ? 'on' : ''}">${icon(l === session.staff.location ? 'check' : 'pin', 'sm')}${l}</button>`)}`),
      (pop, close) => pop.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-l]'); if (!b) return;
        close();
        try { await setLocation(b.dataset.l); toast('เปลี่ยน location แล้ว', b.dataset.l); }
        catch { toast('เปลี่ยน location ไม่สำเร็จ', '', 'err'); }
      }));
  });
  onSessionChange((s2) => { $('[data-loc-name]', root).textContent = s2.staff.location || '-'; });

  // เมนูผู้ใช้
  const userBtn = $('[data-user]', root);
  userBtn.addEventListener('click', () => {
    popover(userBtn, String(html`<span class="cap">${session.user?.email || ''}</span>${MODE === 'mock'
      ? html`<button type="button" disabled style="opacity:.6">${icon('info', 'sm')}โหมดข้อมูลจำลอง (ไม่ต้อง login)</button>`
      : html`<button type="button" class="danger" data-logout>${icon('logout', 'sm')}ออกจากระบบ</button>`}`),
      (pop) => pop.querySelector('[data-logout]')?.addEventListener('click', logout));
  });

  return $('#view', root);
}

export function setActiveNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === name;
    a.classList.toggle('on', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  const n = NAV.find((x) => x.name === name);
  document.title = `${n ? n.label + ' · ' : ''}First Aid`;
}

export const pageEl = (markup) => el(`<div class="page">${markup}</div>`);
