// Hash router อย่างง่าย: #/patients?q=6402&id=xxx
const routes = new Map();
let current = null;   // { name, view }
let onChange = () => {};

export function defineRoute(name, view) { routes.set(name, view); }
export function onRoute(fn) { onChange = fn; }

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { name: path || '', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function href(name, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return `#/${name}${qs ? '?' + qs : ''}`;
}

export function go(name, params) { location.hash = href(name, params); }

/** อัปเดต query ของหน้าปัจจุบันโดยไม่ render ใหม่ */
export function setParams(params) {
  const { name } = parseHash();
  history.replaceState(null, '', href(name, params));
}

export function startRouter(defaultName, mount) {
  const render = async () => {
    const { name, params } = parseHash();
    if (!routes.has(name)) { history.replaceState(null, '', href(defaultName)); return render(); }
    const view = routes.get(name);
    if (current && current.name === name && view.update) { view.update(params); return; }
    current?.view.unmount?.();
    current = { name, view };
    onChange(name);
    mount.innerHTML = '';
    mount.scrollTop = 0;
    window.scrollTo(0, 0);
    await view.mount(mount, params);
  };
  window.addEventListener('hashchange', render);
  render();
}
