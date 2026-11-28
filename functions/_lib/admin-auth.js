// Код руководителя (переменная ADMIN_CODE, заголовок x-admin-code) с защитой от перебора:
// после 10 неверных попыток с одного адреса за 15 минут вход закрывается на 15 минут.
import { fail } from './http.js';
import { db } from './training-data.js';
import { currentStaff, staffAuthEnabled } from './staff-auth.js';

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;

export async function adminCheck(request, env) {
  if (staffAuthEnabled(env)) {
    const staff = await currentStaff(request, env);
    if (staff?.role !== 'leader') return { ok: false, staff: true };
  }
  const need = String(env.ADMIN_CODE || '').trim();
  if (!need) {
    if (!staffAuthEnabled(env)) return { ok: false, unconfigured: true };
    return { ok: true };
  }
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
  if (a.unconfigured) return fail(503, 'staff', 'Для просмотра аналитики нужно настроить доступ руководителя.');
  if (a.staff) return fail(403, 'staff', 'Войдите под профилем руководителя.');
  return a.locked
    ? fail(429, 'locked', 'Слишком много неверных попыток. Подождите 15 минут.')
    : fail(401, 'admin', 'Неверный код руководителя');
}
