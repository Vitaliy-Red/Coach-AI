// Учёт расхода в базе D1 (привязка DB в Cloudflare Pages). Без привязки всё работает, просто не пишется.
// Тарифы Yandex AI Studio, ₽ с НДС (aistudio.yandex.ru/ru/docs/ai-studio/pricing, ноябрь 2026).

export function tariffs(env = {}) {
  const n = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  return {
    audioInSec: n(env.PRICE_AUDIO_IN_SEC, 0.0264),
    audioOutSec: n(env.PRICE_AUDIO_OUT_SEC, 0.0203),
    rtIn1k: n(env.PRICE_RT_IN_1K, 0.3),
    rtCached1k: n(env.PRICE_RT_CACHED_1K, 0.075),
    rtOut1k: n(env.PRICE_RT_OUT_1K, 0.5),
    llmIn1k: n(env.PRICE_LLM_IN_1K, 1.2),
    llmOut1k: n(env.PRICE_LLM_OUT_1K, 1.2),
    budget: n(env.BUDGET_RUB, 4000),
  };
}

export function costOf(row, t) {
  return (
    (row.audio_in_sec || 0) * t.audioInSec +
    (row.audio_out_sec || 0) * t.audioOutSec +
    ((row.rt_in_tokens || 0) * t.rtIn1k + (row.rt_cached_tokens || 0) * t.rtCached1k + (row.rt_out_tokens || 0) * t.rtOut1k) / 1000 +
    ((row.llm_in_tokens || 0) * t.llmIn1k + (row.llm_out_tokens || 0) * t.llmOut1k) / 1000
  );
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    manager TEXT, team TEXT, scenario TEXT, real_scenario TEXT, level TEXT, mode TEXT,
    duration_sec REAL DEFAULT 0,
    audio_in_sec REAL DEFAULT 0, audio_out_sec REAL DEFAULT 0,
    rt_in_tokens INTEGER DEFAULT 0, rt_cached_tokens INTEGER DEFAULT 0, rt_out_tokens INTEGER DEFAULT 0,
    llm_in_tokens INTEGER DEFAULT 0, llm_out_tokens INTEGER DEFAULT 0,
    score INTEGER, criteria TEXT, main_error TEXT, outcome TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS sessions_created ON sessions(created_at)',
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
];

let ready = null;
export async function db(env) {
  if (!env || !env.DB) return null;
  if (!ready) {
    ready = (async () => {
      for (const sql of SCHEMA) await env.DB.prepare(sql).run();
    })().catch((e) => { ready = null; throw e; });
  }
  await ready;
  return env.DB;
}

const clean = (v, max = 120) => String(v ?? '').slice(0, max);

// Создаёт запись сеанса (если нет) и добавляет расход. Ошибки базы не ломают звонок.
export async function addUsage(env, sid, meta = {}, add = {}) {
  try {
    const d = await db(env);
    if (!d || !/^[\w-]{8,64}$/.test(String(sid || ''))) return;
    await d.prepare(
      `INSERT INTO sessions (id, created_at, manager, team, scenario, real_scenario, level, mode)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET
         manager = COALESCE(NULLIF(excluded.manager, ''), sessions.manager),
         team = COALESCE(NULLIF(excluded.team, ''), sessions.team),
         real_scenario = COALESCE(NULLIF(excluded.real_scenario, ''), sessions.real_scenario),
         level = COALESCE(NULLIF(excluded.level, ''), sessions.level)`
    ).bind(sid, new Date().toISOString(), clean(meta.manager), clean(meta.team, 20), clean(meta.scenario, 40),
      clean(meta.realScenario, 40), clean(meta.level, 10), clean(meta.mode, 10)).run();
    const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0);
    await d.prepare(
      `UPDATE sessions SET
        duration_sec = MAX(duration_sec, ?2),
        audio_in_sec = audio_in_sec + ?3, audio_out_sec = audio_out_sec + ?4,
        rt_in_tokens = rt_in_tokens + ?5, rt_cached_tokens = rt_cached_tokens + ?6, rt_out_tokens = rt_out_tokens + ?7,
        llm_in_tokens = llm_in_tokens + ?8, llm_out_tokens = llm_out_tokens + ?9
       WHERE id = ?1`
    ).bind(sid, num(add.durationSec), num(add.audioIn), num(add.audioOut), Math.round(num(add.rtIn)), Math.round(num(add.rtCached)),
      Math.round(num(add.rtOut)), Math.round(num(add.llmIn)), Math.round(num(add.llmOut))).run();
  } catch (e) {
    console.log('usage write failed', e && e.message);
  }
}

export async function saveResult(env, sid, result) {
  try {
    const d = await db(env);
    if (!d || !/^[\w-]{8,64}$/.test(String(sid || ''))) return;
    const crit = {};
    for (const [k, v] of Object.entries(result.criteria || {})) crit[k] = v && v.score ? 1 : 0;
    await d.prepare('UPDATE sessions SET score = ?2, criteria = ?3, main_error = ?4, outcome = ?5 WHERE id = ?1')
      .bind(sid, result.score, JSON.stringify(crit), clean(result.mainError, 60), clean(result.clientOutcome, 40)).run();
  } catch (e) {
    console.log('result write failed', e && e.message);
  }
}

export async function getSetting(env, key) {
  const d = await db(env);
  if (!d) return null;
  const r = await d.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first();
  return r ? r.value : null;
}

export async function setSetting(env, key, value) {
  const d = await db(env);
  if (!d) return false;
  await d.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value)).run();
  return true;
}
