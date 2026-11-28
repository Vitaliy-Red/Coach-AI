import { json, fail, checkAccess, readJson } from '../_lib/http.js';
import { STAFF_COOKIE, STAFF_SESSION_SECONDS, staffAuthEnabled, staffProfiles, staffCode, validStaffCode, createStaffSession } from '../_lib/staff-auth.js';

export async function onRequestPost({ request, env }) {
  if (!checkAccess(request, env)) return fail(401, 'access', 'Неверный код команды');
  if (!staffAuthEnabled(env)) return fail(503, 'staff', 'Вход по личному коду не настроен');
  let body;
  try { body = await readJson(request, 4096); } catch { return fail(400, 'bad_request', 'Некорректный запрос'); }
  const code = String(body.code || '').trim().toLowerCase().replace(/[\s-]/g, '');
  if (!/^[0-9a-f]{24}$/.test(code)) return fail(401, 'staff_code', 'Личный код не подходит.');
  let profiles;
  try {
    profiles = await Promise.all(staffProfiles(env).map(async (profile) => ({ profile, code: await staffCode(env, profile) })));
  } catch {
    return fail(503, 'staff', 'Вход временно недоступен. Обратитесь к руководителю.');
  }
  const profile = profiles.find((entry) => validStaffCode(code, entry.code))?.profile;
  if (!profile) return fail(401, 'staff_code', 'Личный код не подходит.');
  const response = json({ profile });
  response.headers.set('Set-Cookie', `${STAFF_COOKIE}=${await createStaffSession(env, profile)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${STAFF_SESSION_SECONDS}`);
  return response;
}
