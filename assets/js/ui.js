// Мелкие помощники интерфейса: экранирование, иконки, логотип, форматирование.

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const P = {
  phone: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8z"/>',
  hangup: '<path d="M3.3 14.7c-.4-.4-.4-1 0-1.4C5.9 10.8 8.9 9.5 12 9.5s6.1 1.3 8.7 3.8c.4.4.4 1 0 1.4l-2 2a1 1 0 0 1-1.3.1 9.6 9.6 0 0 0-2.2-1.3 1 1 0 0 1-.6-.9v-2.3a12.7 12.7 0 0 0-5.2 0v2.3c0 .4-.2.8-.6.9-.8.3-1.5.8-2.2 1.3a1 1 0 0 1-1.3-.1l-2-2z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
  micOff: '<path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M19 11a7 7 0 0 1-1.1 3.8M5 11a7 7 0 0 0 10.9 5.8M12 18v3M8 21h8M3 3l18 18"/>',
  captions: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 11h4M13 11h4M7 15h10"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="2"/><rect x="17" y="14" width="4" height="6" rx="2"/><path d="M19 20c0 1-1 1.5-3 1.5h-3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/>',
  quote: '<path d="M10 7H6a2 2 0 0 0-2 2v4h5v5H4M20 7h-4a2 2 0 0 0-2 2v4h5v5h-5"/>',
  shuffle: '<path d="M3 7h3c4 0 6 10 10 10h5M3 17h3c1.6 0 2.8-1.5 3.9-3.4M14.1 9.4C15.2 7.5 16.4 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  ear: '<path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0"/><path d="M10 9a2 2 0 0 1 4 0"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
};

export function icon(name, size = 24, cls = '') {
  const filled = name === 'phone' || name === 'hangup';
  const attrs = filled
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" ${attrs} aria-hidden="true">${P[name] || ''}</svg>`;
}

let toastTimer = 0;
export function toast(message, kind = 'info', ms = 5000) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = `toast toast-${kind} show`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Простое модальное окно с одним полем ввода. Возвращает строку или null.
export function promptModal({ title, text, label, value = '', placeholder = '', submit = 'Сохранить', type = 'text', cancel = true }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">${esc(title)}</h2>
        ${text ? `<p class="muted">${esc(text)}</p>` : ''}
        <label class="field"><span>${esc(label)}</span>
          <input name="v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" required>
        </label>
        <div class="modal-actions">
          ${cancel ? '<button type="button" class="btn btn-ghost" data-cancel>Отмена</button>' : ''}
          <button type="submit" class="btn btn-primary">${esc(submit)}</button>
        </div>
      </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const input = form.querySelector('input');
    setTimeout(() => input.focus(), 30);
    const done = (v) => { wrap.remove(); resolve(v); };
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); if (v) done(v); });
    wrap.querySelector('[data-cancel]')?.addEventListener('click', () => done(null));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cancel) done(null); });
  });
}
