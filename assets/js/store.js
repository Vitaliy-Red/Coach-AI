// Локальное хранилище: имя менеджера, код команды, история тренировок (только в этом браузере).

const K = { profile: 'coach.profile', code: 'coach.code', admin: 'coach.admin', history: 'coach.history.v2', prefs: 'coach.prefs.v2' };

function read(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}

export const store = {
  name() { return read(K.profile, {}).name || ''; },
  profile() { return read(K.profile, {}); },
  setProfile(name, team, extra = {}) { write(K.profile, { name, team: team || '', ...extra }); },
  isLeader() { return read(K.profile, {}).role === 'leader'; },
  adminCode() { return read(K.admin, ''); },
  setAdminCode(code) { write(K.admin, code); },
  code() { return read(K.code, ''); },
  setCode(code) { write(K.code, code); },
  prefs() { return { level: 'medium', mode: 'text', subs: false, count: '6', ...read(K.prefs, {}) }; },
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
