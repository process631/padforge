// Small DOM helpers, icons, toasts and accessible modal dialogs.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const PATHS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8"/><path d="M7 21v-7h10v7"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  usb: '<path d="M12 2v15"/><path d="m9 5 3-3 3 3"/><path d="M12 13 7 10V8"/><path d="M12 11l5-3V6"/><circle cx="12" cy="19.5" r="2"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  gamepad: '<path d="M6.5 8h11A4.5 4.5 0 0 1 22 12.5v.5a3 3 0 0 1-5.4 1.8L15 13H9l-1.6 1.8A3 3 0 0 1 2 13v-.5A4.5 4.5 0 0 1 6.5 8z"/><path d="M7 10.5v3M5.5 12h3"/><path d="M16 11v.01M18 13v.01"/>',
  vibrate: '<rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4 8v8M20 8v8"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-5"/>',
};

export function icon(name, size = 16) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

export function batteryIcon(b, size = 18) {
  const pct = b?.percent ?? 0;
  const w = Math.max(1, Math.round(13 * pct / 100));
  const color = pct <= 15 && !b?.charging ? 'var(--bad)' : 'currentColor';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <rect x="2" y="7" width="18" height="10" rx="2.5"/><path d="M22.5 10.5v3" stroke-linecap="round"/>
    <rect x="4" y="9" width="${w}" height="6" rx="1" fill="${color}" stroke="none"/>
    ${b?.charging ? '<path d="M11.5 8.5 9 12.5h3l-1 3 3-4.2h-3z" fill="var(--bg)" stroke="var(--bg)" stroke-width=".6" stroke-linejoin="round"/>' : ''}</svg>`;
}

/* ---------------- toasts ---------------- */
export function toast(text, kind = 'info', ms = 3400) {
  const root = $('#toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info', 16)}<span>${esc(text)}</span>`;
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

/* ---------------- modal dialogs ---------------- */
export const modalOpen = () => !!document.querySelector('.modal-backdrop');

/**
 * Open a modal. actions: [{ text, value, role: 'confirm'|'cancel'|..., kind: 'primary'|'danger'|'' }].
 * Esc / clicking the backdrop resolve with the 'cancel' action's value.
 */
export function openModal({ title, body, actions = [], className = '', initialFocus, onClose = () => {} }) {
  const prev = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  const id = 'dlg-' + Math.random().toString(36).slice(2, 8);
  back.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="modal-head"><h2 id="${id}">${esc(title)}</h2></div>
    <div class="modal-body"></div>
    ${actions.length ? `<div class="modal-actions">${actions.map((a, i) =>
      `<button class="btn ${a.kind || ''}" data-i="${i}" data-dialog="${a.role || ''}">${esc(a.text)}</button>`).join('')}</div>` : ''}
  </div>`;
  const bodyEl = back.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);

  const cancelValue = actions.find(a => a.role === 'cancel')?.value ?? null;
  let closed = false;
  const focusables = () => [...back.querySelectorAll('button:not([disabled]), select, input, [tabindex="0"]')];
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelValue); }
    else if (e.key === 'Tab') {
      const f = focusables(); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  function close(value) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    back.classList.remove('show');
    setTimeout(() => back.remove(), 180);
    prev?.focus?.();
    onClose(value);
  }
  back.addEventListener('mousedown', e => { if (e.target === back) close(cancelValue); });
  back.querySelectorAll('.modal-actions button').forEach(b => { b.onclick = () => close(actions[+b.dataset.i].value); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('show'));
  setTimeout(() => (back.querySelector(initialFocus || '[data-dialog=confirm]') || focusables()[0])?.focus(), 30);
  return { el: back, body: bodyEl, close };
}

export function confirmDialog({ title, message, detail, confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
  return new Promise(resolve => openModal({
    title,
    body: `<p>${esc(message)}</p>${detail ? `<p class="muted">${esc(detail)}</p>` : ''}`,
    className: 'narrow',
    initialFocus: danger ? '[data-dialog=cancel]' : '[data-dialog=confirm]',
    actions: [
      { text: cancelText, value: false, role: 'cancel' },
      { text: confirmText, value: true, role: 'confirm', kind: danger ? 'danger' : 'primary' },
    ],
    onClose: resolve,
  }));
}

export function alertDialog({ title, message, detail, okText = 'OK' }) {
  return new Promise(resolve => openModal({
    title, className: 'narrow',
    body: `<p>${esc(message)}</p>${detail ? `<p class="muted">${esc(detail)}</p>` : ''}`,
    actions: [{ text: okText, value: true, role: 'confirm', kind: 'primary' }],
    onClose: resolve,
  }));
}
