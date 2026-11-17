import { providerConfig } from '../_lib/provider.js';
import { json, fail, checkAccess, readJson, chatCompletion } from '../_lib/http.js';
import { buildClientPrompt, resolveScenario, resolveGender, scenarioExists } from '../_lib/prompt.js';
import { PRIVATE } from '../_lib/private.js';
import { addUsage } from '../_lib/usage.js';

const END_MARK = /\[\s*конец\s+звонка\s*\]/i;

// POST /api/chat — текстовый режим: следующая реплика клиента.
// body: { scenario, level, gender?, messages: [{ role: 'manager'|'client', text }] }
export async function onRequestPost({ request, env, waitUntil }) {
  if (!checkAccess(request, env)) return fail(401, 'access', 'Неверный код команды');
  const cfg = providerConfig(env);
  if (!cfg.ok) return fail(503, 'config', 'Тренажёр не подключён: ' + cfg.missing.join(', '));

  let body;
  try { body = await readJson(request); } catch { return fail(400, 'bad_request', 'Некорректный запрос'); }
  const reqId = String(body.scenario || '');
  if (!scenarioExists(reqId)) return fail(400, 'scenario', 'Неизвестный тренажёр');
  const history = Array.isArray(body.messages) ? body.messages.slice(-60) : [];

  // «Случайный клиент» выбирается один раз, на первой реплике; дальше клиент присылает resolved.
  let resolved;
  if (reqId === 'random' && history.length === 0) {
    const r = resolveScenario('random', body.level);
    resolved = { id: r.id, level: r.level, gender: resolveGender(PRIVATE[r.id]) };
  } else {
    const level = ['easy', 'medium', 'hard'].includes(body.level) ? body.level : 'medium';
    const gender = body.gender === 'male' || body.gender === 'female' ? body.gender : resolveGender(PRIVATE[reqId]);
    resolved = { id: reqId === 'random' ? 'hh' : reqId, level, gender };
  }

  const system = buildClientPrompt({ id: resolved.id, level: resolved.level, mode: 'text', gender: resolved.gender });
  const messages = [{ role: 'system', content: system }, { role: 'user', content: '[Телефон звонит. Ты снимаешь трубку.]' }];
  for (const m of history) {
    const text = String(m.text || '').slice(0, 2000);
    if (!text) continue;
    messages.push({ role: m.role === 'client' ? 'assistant' : 'user', content: text });
  }

  try {
    const out = await chatCompletion(cfg.text, { messages, temperature: 0.8, maxTokens: 300 });
    let reply = out.text;
    const usageWrite = addUsage(env, body.sid,
      { manager: body.manager, team: body.team, scenario: reqId, realScenario: resolved.id, level: resolved.level, mode: 'text' },
      { llmIn: out.usage.in, llmOut: out.usage.out, durationSec: body.durationSec });
    if (waitUntil) waitUntil(usageWrite);
    const ended = END_MARK.test(reply);
    reply = reply.replace(END_MARK, '').replace(/^["«]|["»]$/g, '').trim();
    return json({ reply: reply || 'Алло?', ended, resolved });
  } catch (e) {
    return fail(502, 'llm', 'Модель не ответила: ' + e.message);
  }
}
