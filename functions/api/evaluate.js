import { providerConfig } from '../_lib/provider.js';
import { json, fail, checkAccess, readJson, chatCompletion, extractJson } from '../_lib/http.js';
import { buildEvalPrompt, scenarioExists, MAIN_ERRORS, CATALOG } from '../_lib/prompt.js';

const KEYS = ['accept', 'handle', 'alternative', 'nextStep'];
const OUTCOMES = ['оплата', 'тест', 'перезвон с датой', 'КП на почту', 'отказ', 'вопрос решён', 'без итога'];

// POST /api/evaluate — разбор звонка по 4 критериям.
// body: { scenario, level, durationSec, transcript: [{ role: 'manager'|'client', text, t }] }
export async function onRequestPost({ request, env }) {
  if (!checkAccess(request, env)) return fail(401, 'access', 'Неверный код команды');
  const cfg = providerConfig(env);
  if (!cfg.ok) return fail(503, 'config', 'Разбор не подключён: ' + cfg.missing.join(', '));

  let body;
  try { body = await readJson(request, 400_000); } catch { return fail(400, 'bad_request', 'Некорректный запрос'); }
  const id = String(body.scenario || '');
  if (!scenarioExists(id) || id === 'random') return fail(400, 'scenario', 'Неизвестный тренажёр');
  const level = ['easy', 'medium', 'hard'].includes(body.level) ? body.level : 'medium';
  const transcript = (Array.isArray(body.transcript) ? body.transcript : [])
    .filter((t) => t && (t.role === 'manager' || t.role === 'client') && String(t.text || '').trim())
    .slice(0, 400)
    .map((t) => ({ role: t.role, text: String(t.text).slice(0, 3000), t: Number(t.t) || 0 }));

  const managerWords = transcript.filter((t) => t.role === 'manager').reduce((s, t) => s + t.text.split(/\s+/).length, 0);
  if (managerWords < 12) {
    return json(shortCall());
  }

  const prompt = buildEvalPrompt({ id, level, transcript, durationSec: body.durationSec });
  const messages = [
    { role: 'system', content: 'Ты строгий и доброжелательный тренер продаж. Отвечаешь только валидным JSON.' },
    { role: 'user', content: prompt },
  ];

  let parsed = null;
  let lastErr = '';
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const text = await chatCompletion(cfg.text, { model: cfg.text.evalModel, messages, temperature: 0.2, maxTokens: 1500, json: true });
      parsed = extractJson(text);
      if (!parsed) lastErr = 'ответ не в формате JSON';
    } catch (e) {
      lastErr = e.message;
      if (e.status && e.status < 500 && e.status !== 429) break;
    }
  }
  if (!parsed) return fail(502, 'llm', 'Не удалось получить разбор: ' + lastErr);

  const type = CATALOG.find((s) => s.id === id)?.type;
  return json(normalize(parsed, type));
}

function normalize(p, type) {
  const criteria = {};
  for (const k of KEYS) {
    const c = (p.criteria && p.criteria[k]) || {};
    criteria[k] = {
      score: Number(c.score) >= 1 ? 1 : 0,
      comment: clean(c.comment, 400),
      quote: clean(c.quote, 400),
    };
  }
  if (type === 'soft') {
    for (const k of ['accept', 'handle', 'alternative']) {
      criteria[k] = { score: 1, comment: 'Засчитано: у клиента не было жалобы.', quote: criteria[k].quote };
    }
  }
  const score = KEYS.reduce((s, k) => s + criteria[k].score, 0);
  let mainError = MAIN_ERRORS.includes(p.mainError) ? p.mainError : guessError(criteria);
  if (score === 4) mainError = 'нет';
  if (score < 4 && mainError === 'нет') mainError = guessError(criteria);
  return {
    score,
    max: 4,
    criteria,
    mainError,
    howTo: clean(p.howTo, 600),
    summary: clean(p.summary, 600),
    strengths: list(p.strengths, 2),
    workOn: list(p.workOn, 3),
    clientOutcome: OUTCOMES.includes(p.clientOutcome) ? p.clientOutcome : 'без итога',
    objectionsHeard: list(p.objectionsHeard, 4),
  };
}

function guessError(c) {
  if (!c.handle.score) return 'ушёл от возражения';
  if (!c.nextStep.score) return 'нет следующего шага';
  if (!c.alternative.score) return 'нет доказательств';
  if (!c.accept.score) return 'давил или спорил';
  return 'нет';
}

function shortCall() {
  const criteria = {};
  for (const k of KEYS) criteria[k] = { score: 0, comment: 'Звонок слишком короткий для оценки.', quote: '' };
  return {
    score: 0,
    max: 4,
    criteria,
    mainError: 'нет следующего шага',
    howTo: 'Представьтесь, назовите повод звонка и задайте открытый вопрос: «Подскажите, какие вакансии у вас сейчас в работе?»',
    summary: 'Разговор закончился, почти не начавшись: в расшифровке слишком мало реплик менеджера.',
    strengths: [],
    workOn: ['Проведите звонок до конца: выясните причину, ответьте по существу, договоритесь о шаге со сроком.'],
    clientOutcome: 'без итога',
    objectionsHeard: [],
    short: true,
  };
}

function clean(v, max) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(v, max) {
  return (Array.isArray(v) ? v : []).map((x) => clean(x, 400)).filter(Boolean).slice(0, max);
}
