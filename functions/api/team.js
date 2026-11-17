import { json, fail, checkAccess } from '../_lib/http.js';
import { TEAMS } from '../_lib/team.js';

// GET /api/team — состав команд для выбора сотрудника.
export async function onRequestGet({ request, env }) {
  if (!checkAccess(request, env)) return fail(401, 'access', 'Неверный код команды');
  return json({ teams: TEAMS.map((t) => ({ id: t.id, name: t.name, lead: t.lead, members: t.members })) });
}
