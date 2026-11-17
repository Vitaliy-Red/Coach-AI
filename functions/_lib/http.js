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
export async function chatCompletion(textCfg, { model, messages, temperature = 0.7, maxTokens = 600, json: wantJson = false }) {
  const body = { model: model || textCfg.model, messages, temperature, max_tokens: maxTokens };
  if (wantJson && textCfg.jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetch(textCfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...textCfg.headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(`LLM ${res.status}: ${raw.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = JSON.parse(raw);
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c.text || '').join('') : '';
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
