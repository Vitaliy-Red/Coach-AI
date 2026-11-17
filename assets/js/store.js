// Локальное хранилище: имя менеджера, код команды, история тренировок (только в этом браузере).

const K = { profile: 'coach.profile', code: 'coach.code', history: 'coach.history.v2', prefs: 'coach.prefs' };

function read(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}

export const store = {
  name() { return read(K.profile, {}).name || ''; },
  setName(name) { write(K.profile, { name }); },
  code() { return read(K.code, ''); },
  setCode(code) { write(K.code, code); },
  prefs() { return read(K.prefs, { level: 'medium', mode: 'voice', subs: false }); },
  setPrefs(p) { write(K.prefs, { ...this.prefs(), ...p }); },
  history() { return read(K.history, []); },
  get(id) { return this.history().find((x) => x.id === id) || null; },
  save(entry) {
    const all = this.history().filter((x) => x.id !== entry.id);
    all.unshift(entry);
    // Расшифровки занимают место: храним последние 60 тренировок.
    write(K.history, all.slice(0, 60));
  },
  clear() { write(K.history, []); },
};
