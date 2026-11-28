import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CATALOG } from '../assets/js/catalog.js';
import { store } from '../assets/js/store.js';
import { db, resetOldTrainingData } from '../functions/_lib/training-data.js';
import { buildClientPrompt, resolveScenario, scenarioExists } from '../functions/_lib/prompt.js';
import { staffCode, staffProfile, currentStaff, STAFF_COOKIE } from '../functions/_lib/staff-auth.js';
import { onRequestPost as profile } from '../functions/api/profile.js';
import { onRequestPost as answer } from '../functions/api/dictation.js';
import { onRequestPost as evaluate } from '../functions/api/evaluate.js';
import { onRequestGet as analytics } from '../functions/api/analytics.js';
import { onRequestGet as publicTeam } from '../functions/api/team.js';

function testDb() {
  const sql = new DatabaseSync(':memory:');
  const DB = {
    prepare(query) {
      const statement = sql.prepare(query.replace(/\?(\d+)/g, ':p$1'));
      let params = {};
      return {
        bind(...args) { params = Object.fromEntries(args.map((value, index) => ['p' + (index + 1), value])); return this; },
        async run() { return { meta: { changes: statement.run(params).changes } }; },
        async all() { return { results: statement.all(params) }; },
        async first() { return statement.get(params) || null; },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        for (const statement of statements) await statement.run();
        sql.exec('COMMIT');
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sql, env: { DB, PROVIDER: 'gemini' } };
}

function request(path, body, headers) {
  return new Request('https://coach.example' + path, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const sample = { sid: 'rc1-test-training', scenario: 'hh', step: 0, key: 'pickup', answer: 'Здравствуйте, хочу узнать ваши планы по подбору.' };

test('the approved reset deletes old training rows and budget once, keeping new training rows', async () => {
  const { sql, env } = testDb();
  await db(env);
  sql.exec("INSERT INTO sessions (id, created_at) VALUES ('old-training', '2026-11-01'), ('rc1-live-training', '2026-11-28')");
  sql.exec("INSERT INTO answers (sid, created_at, step) VALUES ('old-training', '2026-11-01', 0), ('rc1-live-training', '2026-11-28', 0)");
  sql.exec("INSERT INTO settings (key, value) VALUES ('budget', '4000')");
  assert.equal(await resetOldTrainingData(env), true);
  assert.equal(sql.prepare('SELECT id FROM sessions').get().id, 'rc1-live-training');
  assert.equal(sql.prepare('SELECT sid FROM answers').get().sid, 'rc1-live-training');
  assert.equal(sql.prepare("SELECT value FROM settings WHERE key = 'budget'").get(), undefined);
  await resetOldTrainingData(env);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});

test('profile changes isolate history and clear the stored analytics code', () => {
  const memory = new Map([['coach.history.v2', '[{"id":"old-result"}]']]);
  globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  try {
    store.resetLegacyHistory();
    assert.equal(memory.has('coach.history.v2'), false);
    store.setProfile('Анна', 'smb1');
    const first = { id: 'first', owner: store.profileKey() };
    store.save(first);
    store.setAdminCode('saved-code');
    store.setProfile('Мария', 'smb2');
    store.save({ ...first, eval: true });
    assert.deepEqual(store.history(), []);
    assert.equal(store.adminCode(), '');
    store.setProfile('Анна', 'smb1');
    assert.equal(store.get('first').eval, true);
  } finally { delete globalThis.localStorage; }
});

test('dictation confirms storage and a repeated submission updates one answer', async () => {
  const { sql, env } = testDb();
  const post = (body, active = env) => answer({ request: request('/api/dictation', body), env: active });
  assert.equal((await post(sample, {})).status, 503);
  assert.equal((await (await post(sample)).json()).saved, true);
  assert.equal((await post({ ...sample, manager: 'Другой сотрудник' })).status, 409);
  assert.equal((await (await post({ ...sample, answer: 'Повторно отправленный ответ' })).json()).saved, true);
  const rows = sql.prepare('SELECT answer FROM answers').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].answer, 'Повторно отправленный ответ');
});

test('only a verified employee owns the recorded answer and analytics requires a leader', async () => {
  const { sql, env } = testDb();
  env.STAFF_CONFIG = JSON.stringify({ signingKey: 'a'.repeat(64),
    teams: [{ id: 'smb1', name: 'Учебная команда', lead: 'Тестовый Руководитель', members: ['Тестовый Сотрудник'] }],
    leaders: [{ name: 'Тестовый Руководитель', teams: [] }],
  });
  const publicProfile = staffProfile(env, 'Тестовый Сотрудник', 'smb1', 'manager');
  const tryLogin = (code) => profile({ request: request('/api/profile', { code }), env });
  assert.equal((await tryLogin('wrong')).status, 401);
  assert.equal((await publicTeam({ request: request('/api/team'), env })).status, 401);
  const loggedIn = await tryLogin(await staffCode(env, publicProfile));
  assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const auth = { Cookie: cookie.split(';')[0] };
  const loginRequest = (path, body) => request(path, body, auth);
  assert.equal((await currentStaff(loginRequest('/api/config'), env)).name, publicProfile.name);
  assert.equal(await currentStaff(request('/api/config', null, { Cookie: STAFF_COOKIE + '=e30.' + '-'.repeat(43) }), env), null);
  assert.equal((await answer({ request: request('/api/dictation', sample), env })).status, 401);
  assert.equal((await answer({ request: loginRequest('/api/dictation', { ...sample, manager: 'Подставное имя', team: 'warm' }), env })).status, 200);
  const recorded = sql.prepare('SELECT manager, team FROM answers').get();
  assert.equal(recorded.manager, publicProfile.name);
  assert.equal(recorded.team, publicProfile.team);
  assert.equal((await analytics({ request: loginRequest('/api/analytics'), env })).status, 403);
  const leader = staffProfile(env, 'Тестовый Руководитель', '', 'leader');
  const leaderLogin = await profile({ request: request('/api/profile', { code: await staffCode(env, leader) }), env });
  const access = await analytics({ request: request('/api/analytics', null, { Cookie: leaderLogin.headers.get('set-cookie').split(';')[0] }), env });
  assert.equal(access.status, 200);
  assert.equal((await access.json()).calls, 0);
});

test('all recruiter scenarios have a discovery gate in both dialogue and Gemini prompts', () => {
  const recruiters = CATALOG.filter(({ id, type }) => id !== 'random' && type !== 'routing');
  assert.equal(recruiters.length, 14);
  for (const { id } of CATALOG) assert.equal(scenarioExists(id), true);
  for (const { id } of recruiters) for (const level of ['easy', 'medium', 'hard']) for (const mode of ['voice', 'text']) {
    const prompt = buildClientPrompt({ id, level, mode, gender: 'female' });
    assert.match(prompt, /Пока потребность не выяснена, не обсуждай тариф/);
    assert.match(prompt, /Для перехода к презентации менеджер должен выяснить: .+/);
    assert.ok(!prompt.includes('undefined'), id);
    assert.doesNotMatch(prompt, /superjob/i);
  }
  assert.match(buildClientPrompt({ id: 'find-recruiter', mode: 'voice' }), /Покупку, презентацию и обсуждение бюджета отклоняй/);
  for (let i = 0; i < 1000; i++) assert.notEqual(resolveScenario('random', 'medium', () => i / 1000).id, 'find-recruiter');
});

test('a sales evaluation cannot grant closing points when the discovery criterion failed', async () => {
  const { env, sql } = testDb();
  env.AI = { run: async () => ({ response: JSON.stringify({
    criteria: { accept: { score: 1 }, handle: { score: 0 }, alternative: { score: 1 }, nextStep: { score: 1 } },
    mainError: 'нет',
  }) }) };
  const body = { ...sample, mode: 'voice', manager: 'Учебный тест', transcript: [
    { role: 'manager', text: 'Добрый день, звоню по поводу размещений. Купите сразу пакет на месяц, я отправлю предложение сегодня вечером и завтра наберу.' },
  ] };
  const result = await evaluate({ request: request('/api/evaluate', body), env });
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.score, 1);
  assert.equal(data.mainError, 'не выявил потребность');
  assert.equal(sql.prepare('SELECT score FROM sessions').get().score, 1);
});
