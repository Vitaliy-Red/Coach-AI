import { json } from '../_lib/http.js';
import { db } from '../_lib/training-data.js';
import { staffConfig } from '../_lib/team.js';
import { adminCheck, adminDenied } from '../_lib/admin-auth.js';
import { CATALOG, CRITERIA } from '../../assets/js/catalog.js';

// GET /api/analytics — результаты тренировок для руководителя.
export async function onRequestGet({ request, env }) {
  const a = await adminCheck(request, env);
  if (!a.ok) return adminDenied(a);
  const d = await db(env);
  const { teams: roster, leaders } = staffConfig(env);
  if (!d) return json({ open: a.open, db: false, roster, calls: 0, teams: [] });

  const { results = [] } = await d.prepare(
    "SELECT id, created_at, manager, team, scenario, score, criteria, main_error FROM sessions WHERE score IS NOT NULL AND id GLOB 'rc1-*' ORDER BY created_at DESC LIMIT 5000"
  ).all();
  const title = (id) => CATALOG.find((s) => s.id === id)?.title || id || '';

  const scored = results.map((r) => {
    let criteria = null;
    try { criteria = r.criteria ? JSON.parse(r.criteria) : null; } catch {}
    return {
      at: r.created_at, manager: r.manager || '', team: r.team || '', trainer: title(r.scenario),
      score: r.score, criteria, mainError: r.main_error || '',
    };
  });

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
        lead: leaders.some((l) => l.name === name),
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

  return json({ open: a.open, db: true, calls: scored.length, teams, roster });
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
