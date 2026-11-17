// Код руководителя (переменная ADMIN_CODE, заголовок x-admin-code) с защитой от перебора:
// после 10 неверных попыток с одного адреса за 15 минут вход закрывается на 15 минут.
import { fail } from './http.js';
import { db } from './usage.js';

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;

export async function adminCheck(request, env) {
  const need = String(env.ADMIN_CODE || '').trim();
  if (!need) return { ok: true, open: true };
  const got = (request.headers.get('x-admin-code') || '').trim();
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const d = await db(env).catch(() => null);
  const since = Date.now() - WINDOW_MS;
  if (d) {
    const r = await d.prepare('SELECT COUNT(*) AS n FROM auth_fails WHERE ip = ?1 AND ts > ?2').bind(ip, since).first().catch(() => null);
    if (r && r.n >= LIMIT) return { ok: false, locked: true };
  }
  if (got && got === need) return { ok: true, open: false };
  if (d && got) {
    await d.prepare('INSERT INTO auth_fails (ip, ts) VALUES (?1, ?2)').bind(ip, Date.now()).run().catch(() => {});
    await d.prepare('DELETE FROM auth_fails WHERE ts < ?1').bind(since).run().catch(() => {});
  }
  return { ok: false, open: false };
}

export function adminDenied(a) {
  return a.locked
    ? fail(429, 'locked', 'Слишком много неверных попыток. Подождите 15 минут.')
    : fail(401, 'admin', 'Неверный код руководителя');
}
