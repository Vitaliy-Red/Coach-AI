// GET /api/answers — ответы из диктовки для руководителя (код ADMIN_CODE).
import { json } from '../_lib/http.js';
import { db } from '../_lib/training-data.js';
import { adminCheck, adminDenied } from '../_lib/admin-auth.js';
import { CATALOG } from '../_lib/prompt.js';

export async function onRequestGet({ request, env }) {
  const a = await adminCheck(request, env);
  if (!a.ok) return adminDenied(a);
  const d = await db(env).catch(() => null);
  if (!d) return json({ db: false, answers: [] });
  const { results = [] } = await d.prepare(
    `SELECT a.*, s.score AS score FROM answers a LEFT JOIN sessions s ON s.id = a.sid WHERE a.sid GLOB 'rc1-*'
     ORDER BY a.created_at DESC LIMIT 3000`
  ).all();
  const title = (id) => CATALOG.find((s) => s.id === id)?.title || id || '';
  return json({
    db: true,
    answers: results.map((r) => ({
      sid: r.sid, at: r.created_at, manager: r.manager || '', team: r.team || '',
      trainer: r.trainer, scenario: r.scenario, title: title(r.scenario),
      step: r.step, qkey: r.qkey, question: r.question, answer: r.answer || '',
      seconds: r.seconds || 0, words: r.words || 0, source: r.source || '', score: r.score,
    })),
  });
}
