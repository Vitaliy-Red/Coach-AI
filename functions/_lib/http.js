import { CF_MODELS, cfNeurons } from './provider.js';
// Общие помощники для функций.

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export function fail(status, code, message) {
  return json({ error: { code, message } }, status);
}

// Код команды: если в окружении задан ACCESS_CODE, все запросы к API должны его передать.
export function checkAccess(request, env) {
  const need = String(env.ACCESS_CODE || '').trim();
  if (!need) return true;
  const url = new URL(request.url);
  const got = request.headers.get('x-access-code') || url.searchParams.get('code') || '';
  return safeEqual(got.trim(), need);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function readJson(request, limit = 200_000) {
  const text = await request.text();
  if (text.length > limit) throw new Error('payload too large');
  return JSON.parse(text || '{}');
}

// Запрос к OpenAI-совместимому chat/completions (OpenAI или Yandex AI Studio).
// Открытые модели Cloudflare Workers AI через привязку AI (без ключей; бесплатно 10 000 нейронов в сутки).
async function workersAi(textCfg, { model, messages, temperature, maxTokens }) {
  const name = model || textCfg.model;
  const meta = CF_MODELS[name] || {};
  let msgs = messages;
  if (meta.noThink) msgs = messages.map((m, i) => (i === messages.length - 1 && m.role === 'user' ? { ...m, content: m.content + ' /no_think' } : m));
  // Модели с рассуждением тратят токены на «мысли» до ответа: даём запас и просим рассуждать коротко.
  const input = { messages: msgs, temperature, max_tokens: meta.reasoning ? maxTokens + 1200 : maxTokens + 700 };
  if (meta.reasoning) input.reasoning = { effort: 'low' };
  let r;
  try {
    r = await textCfg.ai.run(name, input);
  } catch (e) {
    const msg = String(e?.message || e);
    const err = /neuron|allocation|4006|quota|daily/i.test(msg)
      ? new Error('Бесплатный лимит ИИ на сегодня исчерпан (10 000 нейронов Cloudflare). Он обновится в 03:00 по Москве.')
      : new Error('Модель Cloudflare не ответила: ' + msg.slice(0, 200));
    err.status = /neuron|allocation|4006|quota|daily/i.test(msg) ? 429 : 502;
    throw err;
  }
  let text = r?.response ?? r?.choices?.[0]?.message?.content ?? '';
  if (typeof text !== 'string') text = text && typeof text === 'object' ? JSON.stringify(text) : String(text || '');
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const u = r?.usage || {};
  const inTok = Number(u.prompt_tokens || u.input_tokens || 0);
  const outTok = Number(u.completion_tokens || u.output_tokens || 0);
  return { text, usage: { in: inTok, out: outTok, cf: true, neurons: cfNeurons(name, inTok, outTok) } };
}

export async function chatCompletion(textCfg, { model, messages, temperature = 0.7, maxTokens = 600, json: wantJson = false }) {
  if (textCfg.ai) return workersAi(textCfg, { model, messages, temperature, maxTokens });
  const body = { model: model || textCfg.model, messages, temperature, max_tokens: maxTokens };
  if (wantJson && textCfg.jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetch(textCfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...textCfg.headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    const known = {
      401: 'ИИ не подключён: ключ Yandex Cloud не подходит (код 401).',
      403: 'ИИ не подключён: в Yandex Cloud не привязан платёжный аккаунт или у ключа нет прав (код 403).',
      429: 'ИИ перегружен или исчерпан лимит запросов (код 429). Попробуйте через минуту.',
    };
    const err = new Error(known[res.status] || `LLM ${res.status}: ${raw.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = JSON.parse(raw);
  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c.text || '').join('') : '';
  const u = data?.usage || {};
  return { text, usage: { in: Number(u.prompt_tokens || u.input_tokens || 0), out: Number(u.completion_tokens || u.output_tokens || 0) } };
}

export function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}
