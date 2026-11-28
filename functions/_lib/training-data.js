const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    manager TEXT, team TEXT, scenario TEXT, real_scenario TEXT, level TEXT, mode TEXT,
    duration_sec REAL DEFAULT 0,
    score INTEGER, criteria TEXT, main_error TEXT, outcome TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS sessions_created ON sessions(created_at)',
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
  `CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sid TEXT NOT NULL, created_at TEXT NOT NULL,
    manager TEXT, team TEXT, trainer TEXT, scenario TEXT,
    step INTEGER, qkey TEXT, question TEXT, answer TEXT,
    seconds REAL DEFAULT 0, words INTEGER DEFAULT 0, source TEXT
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS answers_sid_step ON answers(sid, step)',
  'CREATE INDEX IF NOT EXISTS answers_created ON answers(created_at)',
  'CREATE TABLE IF NOT EXISTS auth_fails (ip TEXT, ts INTEGER)',
];

const databases = new WeakMap();

export async function db(env) {
  const binding = env?.DB;
  if (!binding) return null;
  if (!databases.has(binding)) {
    const ready = (async () => {
      for (const sql of SCHEMA) await binding.prepare(sql).run();
    })().catch((error) => {
      databases.delete(binding);
      throw error;
    });
    databases.set(binding, ready);
  }
  await databases.get(binding);
  return binding;
}

export async function resetOldTrainingData(env) {
  const d = await db(env);
  if (!d) return false;
  const key = 'red-coach-training-reset-v1';
  if (await d.prepare('SELECT key FROM settings WHERE key = ?1').bind(key).first()) return true;
  await d.batch([
    d.prepare("DELETE FROM answers WHERE sid NOT GLOB 'rc1-*'"),
    d.prepare("DELETE FROM sessions WHERE id NOT GLOB 'rc1-*'"),
    d.prepare("DELETE FROM settings WHERE key = 'budget'"),
    d.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)').bind(key, new Date().toISOString()),
  ]);
  return true;
}

export function isTrainingId(id) {
  return /^rc1-[\w-]{8,60}$/.test(String(id || ''));
}

const clean = (value, max) => String(value ?? '').slice(0, max);

export async function saveResult(env, sid, meta, result, durationSec) {
  if (!isTrainingId(sid)) return;
  try {
    const d = await db(env);
    if (!d) return;
    const crit = Object.fromEntries(Object.entries(result.criteria || {}).map(([key, value]) => [key, value?.score ? 1 : 0]));
    await d.prepare(
      `INSERT INTO sessions (id, created_at, manager, team, scenario, real_scenario, level, mode, duration_sec,
          score, criteria, main_error, outcome)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT(id) DO UPDATE SET duration_sec = excluded.duration_sec, score = excluded.score,
         criteria = excluded.criteria, main_error = excluded.main_error, outcome = excluded.outcome
       WHERE sessions.manager = excluded.manager AND sessions.team = excluded.team`
    ).bind(sid, new Date().toISOString(), clean(meta.manager, 120), clean(meta.team, 20), clean(meta.scenario, 40),
      clean(meta.realScenario, 40), clean(meta.level, 10), clean(meta.mode, 10), Math.max(0, Math.min(36000, Number(durationSec) || 0)),
      result.score, JSON.stringify(crit), clean(result.mainError, 60), clean(result.clientOutcome, 40)).run();
  } catch (e) {
    console.log('result write failed', e?.message);
  }
}
