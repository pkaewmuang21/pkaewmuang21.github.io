// UI helpers: html template (escape อัตโนมัติ), icon, toast, layer (modal/panel), confirm, popover
import { iconSvg } from './icons.js';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function toHtml(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

/** html`...${value}...` — ค่าที่แทรกจะถูก escape ยกเว้นห่อด้วย raw() หรือเป็นผลจาก html`` */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += toHtml(v) + strings[i + 1]; });
  return new Raw(out);
}

export const icon = (name, cls) => raw(iconSvg(name, cls));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

/* ---------- toast ---------- */
let toastBox;
export function toast(title, message = '', type = 'ok', ms = 3500) {
  if (!toastBox) { toastBox = el('<div class="toasts" aria-live="polite"></div>'); document.body.append(toastBox); }
  const ic = { ok: 'check', err: 'x', warn: 'alert', info: 'info' }[type] || 'check';
  const t = el(html`<div class="toast ${type}" role="status"><span class="t-ic">${icon(ic, 'sm')}</span><div><b style="font-weight:500">${title}</b>${message ? html`<small>${message}</small>` : ''}</div><button type="button" class="t-x" aria-label="ปิด">${icon('x', 'sm')}</button></div>`);
  const close = () => t.remove();
  t.querySelector('.t-x').onclick = close;
  toastBox.append(t);
  if (ms) setTimeout(close, ms);
}

/* ---------- layer: modal / side panel ---------- */
/**
 * openLayer({ kind: 'modal'|'panel', size, light, content(html), onMount(root, close), onClose })
 * คืนค่า close()
 */
export function openLayer({ kind = 'modal', size = '', light = false, content, onMount, onClose, dismissable = true }) {
  const layer = el(`<div class="layer"><div class="overlay${light ? ' light' : ''}"></div><div class="${kind}${size ? ' ' + size : ''}" role="dialog" aria-modal="true"></div></div>`);
  const box = layer.lastElementChild;
  box.innerHTML = String(content);
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey, true);
    layer.remove();
    onClose && onClose();
    prevFocus && prevFocus.focus && prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  if (dismissable) layer.firstElementChild.addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.body.append(layer);
  onMount && onMount(box, close);
  const f = box.querySelector('[autofocus]') || box.querySelector('input,select,textarea,button');
  f && f.focus();
  return close;
}

/** confirmDialog({ title, message, okText, danger }) → Promise<boolean> */
export function confirmDialog({ title, message = '', okText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openLayer({
      size: 'sm',
      content: html`
        <div class="modal-b" style="display:flex;flex-direction:column;gap:8px;padding-top:24px">
          <h2>${title}</h2>${message ? html`<p class="muted">${message}</p>` : ''}
        </div>
        <div class="modal-f" style="background:#fff;border-top:0">
          <button type="button" class="btn ghost" data-close>${cancelText}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${okText}</button>
        </div>`,
      onMount: (box, close) => { const ok = box.querySelector('[data-ok]'); ok.onclick = () => { result = true; close(); }; ok.focus(); },
      onClose: () => resolve(result),
    });
  });
}

/* ---------- popover menu ---------- */
let openPop = null;
export function popover(anchor, content, onMount) {
  closePopover();
  const pop = el(`<div class="pop" role="menu">${content}</div>`);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8);
  pop.style.left = Math.max(8, left + window.scrollX) + 'px';
  pop.style.top = (r.bottom + 6 + window.scrollY) + 'px';
  const off = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePopover(); };
  const key = (e) => { if (e.key === 'Escape') closePopover(); };
  setTimeout(() => document.addEventListener('mousedown', off));
  document.addEventListener('keydown', key);
  openPop = { pop, off, key };
  onMount && onMount(pop, closePopover);
  return pop;
}
export function closePopover() {
  if (!openPop) return;
  document.removeEventListener('mousedown', openPop.off);
  document.removeEventListener('keydown', openPop.key);
  openPop.pop.remove();
  openPop = null;
}

/* ---------- misc ---------- */
export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin" style="width:16px;height:16px;border-top-color:currentColor"></span>${label ? esc(label) : ''}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

export function emptyState({ ic = 'search', title, text = '', action = '', err = false, cls = '' }) {
  return html`<div class="empty${err ? ' err' : ''}${cls ? ' ' + cls : ''}"><div class="ill">${icon(ic, 'xl')}</div><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}

export const skelLines = (n = 3, h = 16) =>
  raw(Array.from({ length: n }, (_, i) => `<div class="skel" style="height:${h}px;width:${90 - i * 12}%"></div>`).join(''));
