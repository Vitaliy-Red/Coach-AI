// Обращения к функциям сайта (/api/*). Код команды передаётся заголовком.
import { store } from './store.js';

async function call(path, { method = 'GET', body, admin = false } = {}) {
  const headers = { 'x-access-code': store.code() };
  if (admin) headers['x-admin-code'] = store.adminCode();
  if (body) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    const e = new Error('Нет связи с сервером. Проверьте интернет.');
    e.code = 'network';
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const e = new Error(data?.error?.message || `Ошибка сервера (${res.status})`);
    e.code = data?.error?.code || String(res.status);
    e.status = res.status;
    throw e;
  }
  return data;
}

function who() {
  const p = store.profile();
  return { manager: p.name || '', team: p.team || '' };
}

export const api = {
  async config() {
    try {
      return await call('/api/config');
    } catch (e) {
      // Сайт открыт без функций (например, локальный файл) — работаем в режиме просмотра.
      return { ready: false, offline: true, accessCode: false, codeOk: true, provider: null, missing: [] };
    }
  },
  chat(body) { return call('/api/chat', { method: 'POST', body: { ...who(), ...body } }); },
  evaluate(body) { return call('/api/evaluate', { method: 'POST', body: { ...who(), ...body } }); },
  team() { return call('/api/team'); },
  admin() { return call('/api/admin', { admin: true }); },
  answers() { return call('/api/answers', { admin: true }); },
  dictation(scenario, count) { return call(`/api/dictation?${new URLSearchParams({ scenario, count })}`); },
  saveAnswer(body) { return call('/api/dictation', { method: 'POST', body: { ...who(), ...body } }); },
  setBudget(budget) { return call('/api/admin', { method: 'POST', body: { budget }, admin: true }); },
  realtimeUrl({ scenario, level, sid }) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = new URLSearchParams({ scenario, level, sid: sid || '', code: store.code(), ...who() });
    return `${proto}//${location.host}/api/realtime?${q}`;
  },
};
