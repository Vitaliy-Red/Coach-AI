// Локальное хранилище: имя менеджера, код команды, история тренировок (только в этом браузере).

const K = { profile: 'coach.profile', code: 'coach.code', admin: 'coach.admin', history: 'red-coach.history.v1', prefs: 'coach.prefs.v2' };

function profileKey(profile) {
  if (!profile.name) return '';
  return JSON.stringify([profile.role || 'manager', profile.team || '', profile.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru')]);
}

function read(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}

export const store = {
  name() { return read(K.profile, {}).name || ''; },
  profile() { return read(K.profile, {}); },
  profileKey() { return profileKey(this.profile()); },
  resetLegacyHistory() {
    try {
      if (localStorage.getItem('coach.history.v2') !== null) {
        localStorage.removeItem('coach.history.v2');
        localStorage.removeItem(K.admin);
      }
    } catch {}
  },
  setProfile(name, team, extra = {}) {
    const next = { name, team: team || '', ...extra };
    if (this.profileKey() !== profileKey(next)) this.setAdminCode('');
    write(K.profile, next);
  },
  isLeader() { return read(K.profile, {}).role === 'leader'; },
  adminCode() { return read(K.admin, ''); },
  setAdminCode(code) { write(K.admin, code); },
  code() { return read(K.code, ''); },
  setCode(code) { write(K.code, code); },
  prefs() { return { level: 'medium', mode: 'text', subs: false, count: '6', ...read(K.prefs, {}) }; },
  setPrefs(p) { write(K.prefs, { ...this.prefs(), ...p }); },
  history(owner = this.profileKey()) { return owner ? read(K.history + ':' + owner, []) : []; },
  get(id) { return this.history().find((x) => x.id === id) || null; },
  save(entry) {
    if (!entry.owner) return;
    const all = this.history(entry.owner).filter((x) => x.id !== entry.id);
    all.unshift(entry);
    // Расшифровки занимают место: храним последние 60 тренировок.
    write(K.history + ':' + entry.owner, all.slice(0, 60));
  },
  clear() {
    const owner = this.profileKey();
    if (owner) write(K.history + ':' + owner, []);
  },
};
