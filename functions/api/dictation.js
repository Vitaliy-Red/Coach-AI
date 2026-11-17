// Диктовка: менеджер читает реальную фразу клиента и диктует (или печатает) ответ. ИИ не нужен.
// GET  /api/dictation?scenario=hh&count=5 — вопросы: «Алло» клиента + реальные фразы из расшифровок.
// POST /api/dictation { sid, scenario, trainer, step, key, answer, seconds, source } — сохранить ответ.
import { json, fail, checkAccess, readJson } from '../_lib/http.js';
import { PRIVATE } from '../_lib/private.js';
import { CATALOG } from '../_lib/prompt.js';
import { db, addUsage } from '../_lib/usage.js';
import { teamOf } from '../_lib/team.js';

const REAL = Object.keys(PRIVATE).filter((id) => id !== 'random' && PRIVATE[id].phrases?.length);

function questionsOf(id) {
  const p = PRIVATE[id];
  return [{ key: 'pickup', text: p.pickup }, ...p.phrases.map((text, i) => ({ key: 'p' + i, text }))];
}

function questionText(id, key) {
  return questionsOf(id).find((q) => q.key === key)?.text || '';
}

export async function onRequestGet({ request, env }) {
  if (!checkAccess(request, env)) return fail(401, 'access', 'Неверный код команды');
  const url = new URL(request.url);
  let id = url.searchParams.get('scenario') || '';
  if (id === 'random') id = REAL[Math.floor(Math.random() * REAL.length)];
  if (!REAL.includes(id)) return fail(400, 'scenario', 'Неизвестный тренажёр');
  const all = questionsOf(id);
  const want = url.searchParams.get('count') === 'all' ? all.length : Math.max(2, Math.min(all.length, parseInt(url.searchParams.get('count'), 10) || 6));
  // «Алло» всегда первым, остальные фразы — случайная выборка в исходном порядке.
  const rest = all.slice(1).map((q, i) => ({ q, i, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, want - 1).sort((a, b) => a.i - b.i).map((x) => x.q);
  const pub = CATALOG.find((s) => s.id === id);
  return json({ scenario: id, title: pub?.title || id, total: all.length, questions: [all[0], ...rest] });
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!checkAccess(request, env)) return fail(401, 'access', 'Неверный код команды');
  let body;
  try { body = await readJson(request, 50_000); } catch { return fail(400, 'bad_request', 'Некорректный запрос'); }
  const sid = String(body.sid || '');
  const id = String(body.scenario || '');
  if (!/^[\w-]{8,64}$/.test(sid)) return fail(400, 'sid', 'Нет идентификатора тренировки');
  if (!REAL.includes(id)) return fail(400, 'scenario', 'Неизвестный тренажёр');
  const key = String(body.key || '');
  const question = questionText(id, key);
  if (!question) return fail(400, 'question', 'Неизвестный вопрос');
  const answer = String(body.answer || '').trim().slice(0, 4000);
  const step = Math.max(0, Math.min(200, parseInt(body.step, 10) || 0));
  const seconds = Math.max(0, Math.min(3600, Number(body.seconds) || 0));
  const source = ['voice', 'typed', 'mixed', 'skip'].includes(body.source) ? body.source : 'typed';
  const manager = String(body.manager || '').slice(0, 120);
  const team = String(body.team || '').slice(0, 20) || teamOf(manager);
  const trainer = String(body.trainer || id).slice(0, 40);

  const d = await db(env).catch(() => null);
  if (!d) return json({ ok: true, saved: false });
  await d.prepare(
    `INSERT INTO answers (sid, created_at, manager, team, trainer, scenario, step, qkey, question, answer, seconds, words, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     ON CONFLICT(sid, step) DO UPDATE SET answer = excluded.answer, seconds = excluded.seconds, words = excluded.words, source = excluded.source`
  ).bind(sid, new Date().toISOString(), manager, team, trainer, id, step, key, question, answer, Math.round(seconds),
    answer ? answer.split(/\s+/).length : 0, source).run();
  const total = Math.max(0, Math.min(36000, Number(body.totalSec) || 0));
  const p = addUsage(env, sid, { manager, team, scenario: trainer, realScenario: id, level: 'medium', mode: 'dictation' }, { durationSec: total });
  if (waitUntil) waitUntil(p); else await p;
  return json({ ok: true, saved: true });
}
