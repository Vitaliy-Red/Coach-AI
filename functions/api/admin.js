import { json, fail, readJson } from '../_lib/http.js';
import { db, tariffs, costOf, getSetting, setSetting } from '../_lib/usage.js';
import { TEAMS } from '../_lib/team.js';
import { CATALOG, CRITERIA } from '../../assets/js/catalog.js';

// GET /api/admin — баланс, расходы и аналитика команд (для руководителя).
// POST /api/admin { budget } — изменить бюджет.
// Защита: переменная ADMIN_CODE, код передаётся заголовком x-admin-code. Без ADMIN_CODE раздел открыт всем.

function adminOk(request, env) {
  const need = String(env.ADMIN_CODE || '').trim();
  if (!need) return { ok: true, open: true };
  const got = (request.headers.get('x-admin-code') || '').trim();
  return { ok: got === need, open: false };
}

export async function onRequestPost({ request, env }) {
  const a = adminOk(request, env);
  if (!a.ok) return fail(401, 'admin', 'Неверный код руководителя');
  let body;
  try { body = await readJson(request); } catch { return fail(400, 'bad_request', 'Некорректный запрос'); }
  const budget = Number(body.budget);
  if (!Number.isFinite(budget) || budget < 0 || budget > 10_000_000) return fail(400, 'budget', 'Укажите бюджет в рублях');
  const ok = await setSetting(env, 'budget', Math.round(budget));
  if (!ok) return fail(503, 'db', 'База не подключена');
  return json({ ok: true, budget: Math.round(budget) });
}

export async function onRequestGet({ request, env }) {
  const a = adminOk(request, env);
  if (!a.ok) return fail(401, 'admin', 'Неверный код руководителя');
  const t = tariffs(env);
  const d = await db(env).catch(() => null);
  const roster = TEAMS.map((x) => ({ id: x.id, name: x.name, lead: x.lead, members: x.members }));
  if (!d) {
    return json({ open: a.open, db: false, tariffs: t, budget: t.budget, roster, spent: 0, sessions: [], days: [], teams: [] });
  }

  const savedBudget = Number(await getSetting(env, 'budget'));
  const budget = Number.isFinite(savedBudget) && savedBudget > 0 ? savedBudget : t.budget;
  const { results = [] } = await d.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5000').all();
  const title = (id) => CATALOG.find((s) => s.id === id)?.title || id || '';

  let spent = 0;
  let voiceSec = 0;
  let voiceCost = 0;
  const days = new Map();
  const rows = results.map((r) => {
    const cost = costOf(r, t);
    spent += cost;
    if (r.mode === 'voice') { voiceSec += r.duration_sec || 0; voiceCost += cost; }
    const day = String(r.created_at).slice(0, 10);
    const dd = days.get(day) || { day, cost: 0, calls: 0 };
    dd.cost += cost;
    dd.calls += 1;
    days.set(day, dd);
    let criteria = null;
    try { criteria = r.criteria ? JSON.parse(r.criteria) : null; } catch {}
    return {
      id: r.id, at: r.created_at, manager: r.manager || '', team: r.team || '', trainer: title(r.scenario),
      real: r.real_scenario && r.real_scenario !== r.scenario ? title(r.real_scenario) : '',
      level: r.level, mode: r.mode, duration: Math.round(r.duration_sec || 0), cost: round(cost),
      score: r.score, criteria, mainError: r.main_error || '', outcome: r.outcome || '',
    };
  });

  // Аналитика по командам и сотрудникам — только разобранные звонки.
  const scored = rows.filter((r) => r.score !== null && r.score !== undefined);
  const teams = [...roster, { id: '', name: 'Без команды', lead: '', members: [] }].map((tm) => {
    const list = scored.filter((r) => (r.team || '') === tm.id);
    const names = [...new Set([...tm.members, ...list.map((r) => r.manager).filter(Boolean)])];
    const people = names.map((name) => {
      const mine = list.filter((r) => r.manager === name);
      const rates = critRates(mine);
      const weakest = mine.length ? CRITERIA.reduce((w, c) => (rates[c.key] < rates[w.key] ? c : w), CRITERIA[0]).name : '';
      return {
        name,
        inRoster: tm.members.includes(name),
        count: mine.length,
        avg: mine.length ? round(mine.reduce((s, r) => s + r.score, 0) / mine.length, 1) : null,
        weakest,
        last: mine[0]?.at || null,
        topError: top(mine.map((r) => r.mainError).filter((e) => e && e !== 'нет')),
      };
    });
    return {
      id: tm.id, name: tm.name, lead: tm.lead,
      count: list.length,
      avg: list.length ? round(list.reduce((s, r) => s + r.score, 0) / list.length, 1) : null,
      trained: people.filter((p) => p.count > 0).length,
      size: tm.members.length,
      rates: critRates(list),
      errors: countBy(list.map((r) => r.mainError).filter((e) => e && e !== 'нет')),
      trainers: countBy(list.map((r) => r.trainer)),
      people: people.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, 'ru')),
    };
  }).filter((tm) => tm.id || tm.count);

  const calls = rows.length;
  return json({
    open: a.open,
    db: true,
    tariffs: t,
    budget,
    spent: round(spent),
    remaining: round(budget - spent),
    calls,
    perCall: calls ? round(spent / calls) : 0,
    perMinute: voiceSec > 0 ? round(voiceCost / (voiceSec / 60)) : 0,
    days: [...days.values()].sort((x, y) => x.day.localeCompare(y.day)).slice(-30).map((x) => ({ ...x, cost: round(x.cost) })),
    sessions: rows.slice(0, 50),
    teams,
    roster,
  });
}

function critRates(list) {
  const out = {};
  for (const c of CRITERIA) {
    const withC = list.filter((r) => r.criteria && c.key in r.criteria);
    out[c.key] = withC.length ? Math.round((100 * withC.filter((r) => r.criteria[c.key]).length) / withC.length) : 0;
  }
  return out;
}

function countBy(arr) {
  const m = {};
  for (const x of arr) m[x] = (m[x] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function top(arr) {
  return countBy(arr)[0]?.name || '';
}

function round(v, digits = 2) {
  const k = 10 ** digits;
  return Math.round((Number(v) || 0) * k) / k;
}
