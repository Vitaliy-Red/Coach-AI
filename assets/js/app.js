// Coach AI — интерфейс: каталог → бриф → звонок → разбор → мои результаты.
import { CATALOG, LEVELS, TYPES, CRITERIA, ERROR_HINTS, findScenario } from './catalog.js';
import { api } from './api.js';
import { store } from './store.js';
import { VoiceCall } from './voice.js';
import { TextCall } from './textcall.js';
import { esc, $, $$, icon, LOGO, fmtTime, fmtDate, plural, toast, promptModal } from './ui.js';
import { leaderPage } from './leader.js';

const app = $('#app');
const state = {
  cfg: { ready: false, offline: true, accessCode: false, codeOk: true },
  filter: 'all',
  session: null,
  meta: null,
  subs: false,
  evaluating: new Set(),
  mic: null,
  teams: null,
  adminData: null,
  team: 'all',
};

const LEVEL_NAME = { easy: 'Лёгкий', medium: 'Средний', hard: 'Трудный', auto: 'Случайная сложность' };
const MODE_NAME = { voice: 'Голос', text: 'Текст' };

// ---------- запуск ----------
init();

async function init() {
  $('#logo').innerHTML = LOGO;
  $('#who').addEventListener('click', () => pickProfile(false));
  window.addEventListener('hashchange', route);
  renderWho();
  route();
  state.cfg = await api.config();
  route();
  if (state.cfg.accessCode && !state.cfg.codeOk) await askCode();
  if (!store.name()) await pickProfile(true);
}

async function loadTeams() {
  if (state.teams) return state.teams;
  try { state.teams = (await api.team()).teams || []; } catch { state.teams = []; }
  return state.teams;
}

// Выбор сотрудника: команда → имя. Можно ввести имя вручную.
async function pickProfile(first) {
  const teams = await loadTeams();
  if (!teams.length) { await changeName(first); return; }
  const cur = store.profile();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    let team = cur.team && teams.some((t) => t.id === cur.team) ? cur.team : teams[0].id;
    const draw = () => {
      const t = teams.find((x) => x.id === team);
      wrap.innerHTML = `
        <div class="modal pick" role="dialog" aria-modal="true" aria-labelledby="pick-title">
          <h2 id="pick-title">${first ? 'Кто тренируется?' : 'Сменить сотрудника'}</h2>
          <p class="muted">Выберите команду и себя. Результаты попадут в аналитику руководителя.</p>
          <div class="chips">${teams.map((x) => `<button type="button" class="chip ${x.id === team ? 'on' : ''}" data-team="${x.id}">${esc(x.name)}</button>`).join('')}</div>
          <div class="people">${t.members.map((m) => `<button type="button" class="person ${m === cur.name ? 'on' : ''}" data-name="${esc(m)}">${esc(m)}</button>`).join('')}</div>
          <form class="other"><input type="text" name="v" placeholder="Нет в списке? Впишите имя и фамилию" autocomplete="off"><button class="btn btn-outline btn-sm" type="submit">Это я</button></form>
          ${first ? '' : '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-cancel>Отмена</button></div>'}
        </div>`;
      wrap.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => { team = b.dataset.team; draw(); }));
      wrap.querySelectorAll('[data-name]').forEach((b) => b.addEventListener('click', () => done(b.dataset.name, team)));
      wrap.querySelector('.other').addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.v.value.trim(); if (v) done(v, team); });
      wrap.querySelector('[data-cancel]')?.addEventListener('click', () => { wrap.remove(); resolve(false); });
    };
    const done = (name, teamId) => { store.setProfile(name, teamId); renderWho(); wrap.remove(); resolve(true); };
    draw();
    document.body.appendChild(wrap);
  });
}

function renderWho() {
  const name = store.name();
  const initials = name ? name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() : '?';
  $('#who').innerHTML = `<span class="ava">${esc(initials)}</span><span>${esc(name || 'Кто вы?')}</span>`;
}

async function changeName(first = false) {
  const v = await promptModal({
    title: first ? 'Как вас зовут?' : 'Сменить имя',
    text: 'Имя видно только в истории тренировок на этом компьютере.',
    label: 'Имя и фамилия',
    value: store.name(),
    placeholder: 'Например, Анна Петрова',
    submit: 'Готово',
    cancel: !first,
  });
  if (v) { store.setProfile(v, store.profile().team); renderWho(); }
}

async function askCode() {
  const v = await promptModal({
    title: 'Код команды',
    text: 'Тренажёр доступен по коду. Его выдаёт руководитель.',
    label: 'Код',
    value: store.code(),
    submit: 'Войти',
  });
  if (!v) return false;
  store.setCode(v);
  state.cfg = await api.config();
  if (!state.cfg.codeOk) { toast('Неверный код команды', 'error'); return false; }
  toast('Код принят');
  return true;
}

// ---------- маршруты ----------
function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  if (state.session && !state.session.ended && parts[0] !== 'call') state.session.hangup();
  stopMicTest();
  const navKey = ['history', 'analytics', 'admin'].includes(parts[0]) ? parts[0] : parts.length ? '' : 'home';
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === navKey));
  if (parts[0] === 'analytics') return leaderPage('analytics');
  if (parts[0] === 'admin') return leaderPage('admin');
  if (parts[0] === 's' && parts[1]) return view(briefView(parts[1]), bindBrief);
  if (parts[0] === 'call') return state.session ? view(callView(), bindCall) : (location.hash = '#/');
  if (parts[0] === 'r' && parts[1]) return view(resultView(parts[1]), bindResult);
  if (parts[0] === 'history') return view(historyView(), bindHistory);
  return view(homeView(), bindHome);
}

function view(html, bind) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
  bind?.();
}

function configNote() {
  if (state.cfg.ready) return '';
  const text = state.cfg.offline
    ? 'Сайт открыт без серверной части: звонки недоступны. Откройте опубликованную версию.'
    : `Голос ещё не подключён. Администратору: добавьте ключи в Cloudflare Pages → Settings → Variables and Secrets (нет: ${esc((state.cfg.missing || []).join(', '))}). Инструкция — в README.`;
  return `<div class="note">${icon('info')}<p>${text}</p></div>`;
}

// ---------- главная ----------
function homeView() {
  const types = [['all', 'Все'], ['objection', 'Возражения'], ['soft', 'Без претензии'], ['service', 'Сервис']];
  const list = CATALOG.filter((s) => s.id !== 'random' && (state.filter === 'all' || s.type === state.filter));
  const random = findScenario('random');
  return `
  <section class="hero">
    <div>
      <p class="eyebrow">Голосовой тренажёр звонков</p>
      <h1 class="ext">Позвоните клиенту, который возражает как настоящий</h1>
      <p class="lead">Клиента играет ИИ: голосом и фразами из реальных расшифровок звонков SuperJob. После звонка — разбор по четырём критериям и что тренировать.</p>
      <div class="actions">
        <button class="btn btn-white btn-lg" data-scroll="catalog">Выбрать тренажёр</button>
        <a class="btn btn-line-white btn-lg" href="#/s/random">${icon('shuffle')} Случайный клиент</a>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><b class="ext">224</b><span>звонка в анализе возражений</span></div>
      <div class="kpi"><b class="ext">222</b><span>расшифровки — источник реплик клиента</span></div>
      <div class="kpi"><b class="ext">${CATALOG.length}</b><span>тренажёров по частым ситуациям</span></div>
    </div>
  </section>
  ${state.cfg.ready ? '' : `<div class="section">${configNote()}</div>`}
  <section class="section">
    <div class="steps">
      ${step(1, 'Выберите ситуацию', 'Тренажёры собраны по самым частым возражениям из 224 звонков.')}
      ${step(2, 'Позвоните голосом', 'Клиент снимает трубку и отвечает фразами из настоящих звонков. Перебивать можно.')}
      ${step(3, 'Получите разбор', 'Оценка 0–4 по методике отдела, главная ошибка и как надо было сказать.')}
    </div>
  </section>
  <section class="section" id="catalog">
    <div class="section-head">
      <div><h2>Тренажёры</h2><p class="muted">Сначала — самые частые возражения клиентов.</p></div>
      <div class="chips" role="group" aria-label="Фильтр">${types.map(([k, n]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${n}</button>`).join('')}</div>
    </div>
    <div class="grid">
      ${list.map(card).join('')}
      ${state.filter === 'all' ? card(random) : ''}
    </div>
  </section>`;
}

function step(n, title, text) {
  return `<div class="step"><span class="num">${n}</span><div><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p></div></div>`;
}

function card(s) {
  return `
  <a class="card ${s.id === 'random' ? 'random' : ''}" href="#/s/${s.id}">
    <div class="row"><span class="tag">${esc(s.group)}</span><span class="share">${esc(s.shareLabel)}</span></div>
    <h3>${esc(s.title)}</h3>
    <p class="q">${icon('quote', 18)}<span>${esc(s.quote)}</span></p>
    <div class="meta"><span>${esc(s.who)}</span><span class="go">Позвонить ${icon('arrow', 18)}</span></div>
  </a>`;
}

function bindHome() {
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    const y = window.scrollY;
    view(homeView(), bindHome);
    window.scrollTo(0, y);
  }));
  $('[data-scroll]')?.addEventListener('click', () => $('#catalog').scrollIntoView({ behavior: 'smooth' }));
}

// ---------- бриф ----------
function briefView(id) {
  const s = findScenario(id);
  if (!s) return `<div class="empty"><h2>Тренажёр не найден</h2><a class="btn btn-primary" href="#/">К тренажёрам</a></div>`;
  const prefs = store.prefs();
  const isRandom = s.id === 'random';
  const levels = isRandom ? [{ id: 'auto', name: 'Случайно' }, ...LEVELS] : LEVELS;
  const level = levels.some((l) => l.id === prefs.level) ? prefs.level : isRandom ? 'auto' : 'medium';
  const hint = LEVELS.find((l) => l.id === level)?.hint || 'Сложность выпадет по частотам из реальных звонков.';
  return `
  <a class="back" href="#/">${icon('back', 20)} Все тренажёры</a>
  <div class="brief">
    <div>
      <div class="chips"><span class="tag">${esc(s.group)}</span><span class="tag tag-mint">${esc(s.shareLabel)}${s.shareNote ? ' · ' + esc(s.shareNote) : ''}</span><span class="tag">${esc(TYPES[s.type])}</span></div>
      <h1>${esc(s.title)}</h1>
      <p class="sub muted">На линии: ${esc(s.who)}</p>
      <div class="block"><h3>Что вы знаете до звонка</h3><p>${esc(s.context)}</p></div>
      <div class="block"><h3>Ваша цель</h3><p>${esc(s.goal)}</p></div>
      <div class="block"><h3>Как оценим</h3>
        <ul class="lineup">${CRITERIA.map((c) => `<li><b>${esc(c.name)}</b><span>${esc(c.desc)}</span></li>`).join('')}</ul>
        ${s.type === 'soft' ? '<p class="hint" style="margin-top:10px">Жалобы у клиента нет, поэтому первые три пункта засчитываются автоматически — всё решает шаг со сроком.</p>' : ''}
      </div>
      <div class="block quote-card">
        ${icon('quote', 28)}
        <p>«${esc(s.quote)}»</p>
        <small>${isRandom ? 'Клиент выбирается по реальным частотам возражений.' : `Реальная фраза клиента. Сценарий собран по ${s.sources} ${plural(s.sources, 'расшифровке', 'расшифровкам', 'расшифровкам')} звонков.`}</small>
      </div>
    </div>
    <aside class="panel" aria-label="Настройка звонка">
      <h2>Настройка звонка</h2>
      <div class="field"><span>Сложность</span>
        <div class="seg" data-seg="level">${levels.map((l) => `<button type="button" data-v="${l.id}" class="${l.id === level ? 'on' : ''}">${esc(l.name)}</button>`).join('')}</div>
        <p class="hint" id="levelHint">${esc(hint)}</p>
      </div>
      <div class="field"><span>Режим</span>
        <div class="seg" data-seg="mode">
          <button type="button" data-v="voice" class="${prefs.mode !== 'text' ? 'on' : ''}">Голос</button>
          <button type="button" data-v="text" class="${prefs.mode === 'text' ? 'on' : ''}">Текст</button>
        </div>
        <p class="hint">${prefs.mode === 'text' ? 'Пишете реплики, клиент отвечает текстом. Для тех, у кого нет микрофона.' : 'Разговор голосом, как по телефону.'}</p>
      </div>
      <div class="field" ${prefs.mode === 'text' ? 'hidden' : ''}><span>Микрофон</span>
        <div class="miccheck"><button type="button" class="btn btn-outline btn-sm" id="micTest">${icon('mic', 18)} Проверить</button><div class="meter" aria-hidden="true"><i id="micLevel"></i></div></div>
      </div>
      <div class="tips">
        <div>${icon('headset', 20)}<span>Наденьте гарнитуру: так клиент не услышит сам себя из динамиков.</span></div>
        <div>${icon('ear', 20)}<span>Говорите как в настоящем звонке. Клиента можно перебивать.</span></div>
        <div>${icon('clock', 20)}<span>Обычно звонок длится 3–8 минут.</span></div>
      </div>
      <button type="button" class="btn btn-primary btn-lg" id="startCall" ${state.cfg.ready ? '' : 'disabled'}>${icon('phone', 22)} Позвонить клиенту</button>
      ${configNote()}
    </aside>
  </div>`;
}

function bindBrief() {
  const id = location.hash.split('/')[2];
  $$('[data-seg]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      stopMicTest();
      store.setPrefs({ [seg.dataset.seg]: b.dataset.v });
      view(briefView(id), bindBrief);
    });
  });
  $('#micTest')?.addEventListener('click', micTest);
  $('#startCall')?.addEventListener('click', () => startCall(id));
}

async function micTest() {
  if (state.mic) { stopMicTest(); return; }
  const btn = $('#micTest');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(512);
    state.mic = { stream, ctx, raf: 0, stopAt: Date.now() + 15000 };
    btn.innerHTML = `${icon('x', 18)} Стоп`;
    const tick = () => {
      if (!state.mic) return;
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const el = $('#micLevel');
      if (el) el.style.width = Math.min(100, Math.sqrt(s / buf.length) * 400) + '%';
      if (Date.now() > state.mic.stopAt) { stopMicTest(); return; }
      state.mic.raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    toast('Нет доступа к микрофону. Разрешите его в адресной строке браузера.', 'error');
  }
}

function stopMicTest() {
  if (!state.mic) return;
  cancelAnimationFrame(state.mic.raf);
  state.mic.stream.getTracks().forEach((t) => t.stop());
  state.mic.ctx.close().catch(() => {});
  state.mic = null;
  const btn = $('#micTest');
  if (btn) btn.innerHTML = `${icon('mic', 18)} Проверить`;
  const el = $('#micLevel');
  if (el) el.style.width = '0';
}

async function startCall(id) {
  if (!state.cfg.ready) { toast('Голос ещё не подключён', 'error'); return; }
  if (state.cfg.accessCode && !state.cfg.codeOk && !(await askCode())) return;
  stopMicTest();
  const prefs = store.prefs();
  const s = findScenario(id);
  let level = prefs.level;
  if (id === 'random') level = ['auto', 'easy', 'medium', 'hard'].includes(level) ? level : 'auto';
  else if (!['easy', 'medium', 'hard'].includes(level)) level = 'medium';
  const mode = prefs.mode === 'text' ? 'text' : 'voice';
  const sid = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  state.meta = { scenario: id, level, mode, sid, startedAt: new Date().toISOString(), title: s.title };
  state.subs = mode === 'text' ? true : Boolean(prefs.subs);
  const handlers = {
    onState: (kind, text) => { const el = $('#status'); if (el) { el.textContent = text; el.classList.toggle('err', kind === 'error'); } },
    onLine: (line, transcript) => renderSubs(transcript),
    onLevels: (client, you, t) => animate(client, you, t),
    onTick: (t) => { const el = $('#timer'); if (el) el.textContent = fmtTime(t); },
    onWarn: (msg, kind) => toast(msg, kind === 'error' ? 'error' : 'info'),
    onEnd: (result) => endCall(result),
  };
  const session = mode === 'text' ? new TextCall({ scenario: id, level, sid, on: handlers }) : new VoiceCall({ scenario: id, level, sid, on: handlers });
  state.session = session;
  const start = session.start(); // звук включаем сразу в обработчике клика
  location.hash = '#/call';
  try {
    await start;
  } catch (e) {
    state.session = null;
    toast(e.message, 'error');
    location.hash = '#/s/' + id;
  }
}

// ---------- звонок ----------
function callView() {
  const m = state.meta;
  const s = findScenario(m.scenario);
  const text = m.mode === 'text';
  return `
  <div class="call ${text ? 'is-text' : ''}">
    <div class="call-top">
      <div><span class="tag">${esc(s.group)}</span><h1 style="margin-top:8px">${esc(s.title)}</h1><p class="muted small">${esc(LEVEL_NAME[m.level])} · ${esc(MODE_NAME[m.mode])}</p></div>
      <div class="timer ext" id="timer" aria-label="Длительность звонка">00:00</div>
    </div>
    <div class="stage">
      <div class="ring" id="ring1"></div><div class="ring r2" id="ring2"></div>
      <div class="avatar">${icon('user', text ? 32 : 44)}<b>${esc(s.short || 'Клиент')}</b></div>
    </div>
    <p class="status" id="status" aria-live="polite">${text ? 'Соединяем…' : 'Подключаем микрофон…'}</p>
    ${text ? '' : `<div class="you"><span>Вы</span><div class="meter" aria-hidden="true"><i id="youLevel"></i></div></div>`}
    <div class="controls">
      ${text ? '' : `<div class="ctl"><button class="round" id="muteBtn" aria-pressed="false" title="Выключить микрофон">${icon('mic', 28)}</button><span class="round-label">Микрофон</span></div>`}
      <div class="ctl"><button class="round hang" id="hangBtn" title="Завершить звонок">${icon('hangup', 38)}</button><span class="round-label">Завершить</span></div>
      ${text ? '' : `<div class="ctl"><button class="round ${state.subs ? 'on' : ''}" id="subsBtn" aria-pressed="${state.subs}" title="Показать текст разговора">${icon('captions', 28)}</button><span class="round-label">Текст</span></div>`}
    </div>
    <div class="subs" id="subs" ${state.subs ? '' : 'hidden'} aria-live="polite"></div>
    ${text ? `<form class="composer" id="composer"><textarea id="reply" placeholder="Ваша реплика… Enter — отправить" aria-label="Реплика менеджера"></textarea><button class="btn btn-primary" type="submit">${icon('send', 20)}</button></form>` : ''}
    <p class="tipline">${text ? 'Пишите так, как сказали бы вслух.' : 'Клиента можно перебивать.'} Завершите звонок, когда договоритесь о шаге или получите отказ.</p>
  </div>`;
}

function bindCall() {
  const s = state.session;
  if (!s) return;
  renderSubs(s.transcript());
  $('#hangBtn').addEventListener('click', () => s.hangup());
  $('#muteBtn')?.addEventListener('click', (e) => {
    const b = e.currentTarget;
    const m = b.getAttribute('aria-pressed') !== 'true';
    s.setMuted(m);
    b.setAttribute('aria-pressed', String(m));
    b.classList.toggle('on', m);
    b.innerHTML = icon(m ? 'micOff' : 'mic', 28);
  });
  $('#subsBtn')?.addEventListener('click', (e) => {
    state.subs = !state.subs;
    store.setPrefs({ subs: state.subs });
    e.currentTarget.classList.toggle('on', state.subs);
    e.currentTarget.setAttribute('aria-pressed', String(state.subs));
    $('#subs').hidden = !state.subs;
  });
  const form = $('#composer');
  if (form) {
    const ta = $('#reply');
    const send = () => { const v = ta.value; ta.value = ''; s.send(v); };
    form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    setTimeout(() => ta.focus(), 50);
  }
}

function renderSubs(transcript) {
  const box = $('#subs');
  if (!box) return;
  box.innerHTML = transcript.map(lineHtml).join('');
  box.scrollTop = box.scrollHeight;
}

function lineHtml(l) {
  return `<div class="line ${l.role === 'manager' ? 'mgr' : ''}"><span class="who-l">${l.role === 'manager' ? 'Вы' : 'Клиент'}<span class="t">${fmtTime(l.t)}</span></span><p>${esc(l.text)}</p></div>`;
}

function animate(client, you, t) {
  const r1 = $('#ring1');
  if (!r1) return;
  const r2 = $('#ring2');
  r1.style.opacity = client > 0.03 ? '1' : '0';
  r1.style.transform = `scale(${1 + client * 0.35})`;
  r2.style.opacity = client > 0.03 ? '.7' : '0';
  r2.style.transform = `scale(${1 + client * 0.7})`;
  const y = $('#youLevel');
  if (y) y.style.width = Math.round(you * 100) + '%';
  const tm = $('#timer');
  if (tm) tm.textContent = fmtTime(t);
}

// ---------- окончание звонка и разбор ----------
function endCall(result) {
  const meta = state.meta;
  state.session = null;
  if (!result.connected || !result.transcript.length) {
    toast(result.message || 'Звонок не состоялся. Попробуйте ещё раз.', 'error');
    if (location.hash === '#/call') location.hash = '#/s/' + meta.scenario;
    return;
  }
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    sid: meta.sid,
    scenario: meta.scenario,
    realScenario: result.resolved?.id || meta.scenario,
    level: result.resolved?.level || meta.level,
    mode: meta.mode,
    date: meta.startedAt,
    durationSec: result.durationSec,
    transcript: result.transcript,
    outcome: result.outcome,
    endReason: result.reason,
    name: store.name(),
    metrics: metrics(result.transcript, result.durationSec),
    eval: null,
  };
  store.save(entry);
  location.hash = '#/r/' + entry.id;
  evaluate(entry.id);
}

async function evaluate(id) {
  const e = store.get(id);
  if (!e) return;
  state.evaluating.add(id);
  rerenderResult(id);
  try {
    e.eval = await api.evaluate({ sid: e.sid, scenario: e.realScenario, trainer: e.scenario, mode: e.mode, level: e.level, durationSec: e.durationSec, transcript: e.transcript });
    e.evalError = null;
  } catch (err) {
    e.evalError = err.message;
  }
  state.evaluating.delete(id);
  store.save(e);
  rerenderResult(id);
}

function rerenderResult(id) {
  if (location.hash === '#/r/' + id) view(resultView(id), bindResult);
}

function words(s) { return String(s || '').split(/\s+/).filter(Boolean).length; }

function metrics(tr, duration) {
  const mgr = tr.filter((l) => l.role === 'manager');
  const cl = tr.filter((l) => l.role === 'client');
  const mw = mgr.reduce((s, l) => s + words(l.text), 0);
  const cw = cl.reduce((s, l) => s + words(l.text), 0);
  return {
    duration,
    share: mw + cw ? Math.round((100 * mw) / (mw + cw)) : 0,
    questions: mgr.reduce((s, l) => s + (l.text.match(/\?/g) || []).length, 0),
    longest: mgr.reduce((m, l) => Math.max(m, words(l.text)), 0),
  };
}

function verdict(score) {
  if (score >= 4) return 'Сильный звонок';
  if (score === 3) return 'Хороший звонок, есть что подтянуть';
  if (score === 2) return 'Половина пути';
  return 'Звонок нужно перестроить';
}

function resultView(id) {
  const e = store.get(id);
  if (!e) return `<div class="empty"><h2>Разбор не найден</h2><p class="muted">История хранится только в этом браузере.</p><br><a class="btn btn-primary" href="#/">К тренажёрам</a></div>`;
  const s = findScenario(e.scenario);
  const real = findScenario(e.realScenario);
  const ev = e.eval;
  const busy = state.evaluating.has(id);
  const m = e.metrics || metrics(e.transcript, e.durationSec);
  const head = `<a class="back" href="#/">${icon('back', 20)} Все тренажёры</a>`;
  const tags = `<span class="tag">${esc(s.title)}</span>${e.scenario === 'random' && real ? `<span class="tag tag-mint">Это был: ${esc(real.title)}</span>` : ''}<span class="tag">${esc(LEVEL_NAME[e.level] || '')}</span><span class="tag">${icon('clock', 16)} ${fmtTime(e.durationSec)}</span>`;
  const metricsHtml = `
    <section class="section"><div class="metrics">
      <div class="metric"><b class="ext">${fmtTime(m.duration)}</b><span>длительность</span></div>
      <div class="metric ${m.share > 65 ? 'warn' : ''}"><b class="ext">${m.share}%</b><span>ваша доля речи${m.share > 65 ? ' — много' : ''}</span></div>
      <div class="metric"><b class="ext">${m.questions}</b><span>${plural(m.questions, 'вопрос', 'вопроса', 'вопросов')} клиенту</span></div>
      <div class="metric ${m.longest > 50 ? 'warn' : ''}"><b class="ext">${m.longest}</b><span>слов в самом длинном монологе</span></div>
    </div></section>`;
  const transcriptHtml = `
    <section class="section box"><details class="tr" ${ev ? '' : 'open'}><summary>Расшифровка звонка</summary><div class="subs">${e.transcript.map(lineHtml).join('')}</div></details></section>`;
  const actions = `
    <div class="section actions-row">
      <button class="btn btn-primary btn-lg" data-again>${icon('refresh', 20)} Позвонить ещё раз</button>
      <a class="btn btn-outline btn-lg" href="#/">Другой тренажёр</a>
    </div>`;

  if (busy) {
    return `${head}
      <div class="loader"><h1 class="ext" style="font-size:34px">Тренер разбирает звонок</h1><p class="muted" style="margin-top:8px">Обычно это 10–20 секунд.</p><div class="dots"><i></i><i></i><i></i></div></div>
      ${metricsHtml}${transcriptHtml}`;
  }
  if (!ev) {
    return `${head}
      <div class="note" style="border-color:var(--red)">${icon('info')}<div><p><b>Разбор не получился.</b> ${esc(e.evalError || 'Страницу закрыли до окончания разбора.')}</p><br><button class="btn btn-primary btn-sm" data-retry>${icon('refresh', 18)} Повторить разбор</button></div></div>
      ${metricsHtml}${transcriptHtml}${actions}`;
  }

  const crit = CRITERIA.map((c) => {
    const r = ev.criteria?.[c.key] || { score: 0 };
    const ok = r.score >= 1;
    return `<div class="crit-card ${ok ? 'ok' : ''}">
      <div class="hd"><span class="mark ${ok ? 'ok' : 'no'}">${icon(ok ? 'check' : 'x', 20)}</span><h3>${esc(c.name)}</h3></div>
      <p>${esc(r.comment || c.desc)}</p>
      ${r.quote ? `<p class="cq">«${esc(r.quote)}»</p>` : ''}
    </div>`;
  }).join('');
  const outcome = ev.clientOutcome && ev.clientOutcome !== 'без итога' ? `<span class="tag ${ev.clientOutcome === 'отказ' ? 'tag-red' : 'tag-fill'}">Итог: ${esc(ev.clientOutcome)}</span>` : '';
  const li = (arr) => arr.map((x) => `<li><span style="color:var(--text);font-size:16px">${esc(x)}</span></li>`).join('');

  return `${head}
    <div class="result-head">
      <div class="score"><div class="big ext">${ev.score}<small> / 4</small></div><div class="lbl">${plural(ev.score, 'критерий выполнен', 'критерия выполнено', 'критериев выполнено')}</div></div>
      <div class="summary-card">
        <div class="tags">${tags}${outcome}</div>
        <h1>${esc(verdict(ev.score))}</h1>
        <p>${esc(ev.summary || '')}</p>
      </div>
    </div>
    <section class="section crit">${crit}</section>
    <section class="section two">
      ${ev.mainError && ev.mainError !== 'нет'
        ? `<div class="err-card"><h3>Главная ошибка</h3><p>${esc(cap(ev.mainError))}</p>${ERROR_HINTS[ev.mainError] ? `<p class="muted" style="font-size:16px;font-weight:400;margin-top:8px">${esc(ERROR_HINTS[ev.mainError])}</p>` : ''}</div>`
        : `<div class="howto"><h3>Главная ошибка</h3><p>Нет — все четыре шага на месте.</p></div>`}
      ${ev.howTo ? `<div class="howto"><h3>Как надо сказать</h3><p>«${esc(ev.howTo)}»</p></div>` : '<div></div>'}
    </section>
    <section class="section two">
      <div class="box"><h2>Над чем работать</h2>${ev.workOn?.length ? `<ul class="lineup">${li(ev.workOn)}</ul>` : '<p class="muted">Замечаний нет.</p>'}</div>
      <div class="box"><h2>Что получилось</h2>${ev.strengths?.length ? `<ul class="lineup">${li(ev.strengths)}</ul>` : '<p class="muted">Пока нечего отметить — следующий звонок покажет.</p>'}</div>
    </section>
    ${metricsHtml}${transcriptHtml}${actions}`;
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function bindResult() {
  const id = location.hash.split('/')[2];
  const e = store.get(id);
  $('[data-retry]')?.addEventListener('click', () => evaluate(id));
  $('[data-again]')?.addEventListener('click', () => { if (e) location.hash = '#/s/' + e.scenario; });
}

// ---------- мои результаты ----------
function historyView() {
  const all = store.history().filter((x) => x.eval);
  if (!all.length) {
    return `<div class="empty"><h2>Пока нет разобранных звонков</h2><p class="muted">Позвоните в любом тренажёре — разбор появится здесь.</p><br><a class="btn btn-primary btn-lg" href="#/">${icon('phone', 20)} К тренажёрам</a></div>`;
  }
  const avg = all.reduce((s, x) => s + x.eval.score, 0) / all.length;
  const best = Math.max(...all.map((x) => x.eval.score));
  const rates = CRITERIA.map((c) => ({ c, v: Math.round((100 * all.filter((x) => x.eval.criteria?.[c.key]?.score >= 1).length) / all.length) }));
  return `
    <div class="section-head" style="margin-bottom:24px">
      <div><h1 style="font-size:40px">Мои результаты</h1><p class="muted">${esc(store.name() || '')} · хранится в этом браузере</p></div>
      <button class="btn btn-outline" id="csv">${icon('download', 20)} Выгрузить CSV</button>
    </div>
    <div class="stats">
      <div class="kpi"><b class="ext">${all.length}</b><span>${plural(all.length, 'звонок', 'звонка', 'звонков')} разобрано</span></div>
      <div class="kpi"><b class="ext">${avg.toFixed(1).replace('.', ',')}</b><span>средний балл из 4</span></div>
      <div class="kpi"><b class="ext">${best}</b><span>лучший результат</span></div>
    </div>
    <section class="section box">
      <h2>Где вы теряете баллы</h2>
      <div class="bars" role="list">
        ${rates.map(({ c, v }) => `<div class="bar-row" role="listitem"><span>${esc(c.name)}</span><div class="bar-track" aria-hidden="true"><i style="width:${v}%"></i></div><b>${v}%</b></div>`).join('')}
      </div>
      <p class="hint" style="margin-top:14px">Доля звонков, где критерий выполнен.</p>
    </section>
    <section class="section">
      <div class="table-wrap"><table>
        <thead><tr><th>Дата</th><th>Тренажёр</th><th>Сложность</th><th>Балл</th><th>Главная ошибка</th></tr></thead>
        <tbody>${all.map((x) => `<tr class="click" data-open="${x.id}"><td>${esc(fmtDate(x.date))}</td><td>${esc(findScenario(x.scenario)?.title || x.scenario)}</td><td>${esc(LEVEL_NAME[x.level] || '')}</td><td><b class="ext" style="color:var(--text)">${x.eval.score}</b> / 4</td><td>${esc(cap(x.eval.mainError === 'нет' ? '—' : x.eval.mainError))}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;
}

function bindHistory() {
  $$('[data-open]').forEach((tr) => tr.addEventListener('click', () => { location.hash = '#/r/' + tr.dataset.open; }));
  $('#csv')?.addEventListener('click', exportCsv);
}

function exportCsv() {
  const rows = [['Дата', 'Менеджер', 'Тренажёр', 'Сложность', 'Режим', 'Длительность, с', 'Балл', ...CRITERIA.map((c) => c.name), 'Главная ошибка', 'Итог клиента']];
  for (const x of store.history().filter((h) => h.eval)) {
    rows.push([x.date, x.name || '', findScenario(x.scenario)?.title || x.scenario, LEVEL_NAME[x.level] || '', MODE_NAME[x.mode] || '', x.durationSec, x.eval.score,
      ...CRITERIA.map((c) => x.eval.criteria?.[c.key]?.score ?? ''), x.eval.mainError, x.eval.clientOutcome]);
  }
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'coach-ai-results.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
