import { json, fail, checkAccess } from '../_lib/http.js';
import { staffAuthEnabled, currentStaff, staffDenied } from '../_lib/staff-auth.js';

// GET /api/team — состав команд для выбора сотрудника.
export async function onRequestGet({ request, env }) {
  if (!checkAccess(request, env)) return fail(401, 'access', 'Неверный код команды');
  if (staffAuthEnabled(env) && !await currentStaff(request, env)) return staffDenied();
  return json({ teams: [], leaders: [] });
}
