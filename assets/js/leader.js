// Аналитика по командам и сотрудникам.
import { CRITERIA } from './catalog.js';
import { api } from './api.js';
import { store } from './store.js';
import { esc, $, $$, icon, fmtTime, fmtDate, plural, toast, promptModal } from './ui.js';

let teamFilter = null;
let answersData = null;
let trainerFilter = 'all';
let activeProfile;

const app = () => $('#app');
const num = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: d }));

export async function leaderPage() {
  const requestProfile = store.profileKey();
  if (activeProfile !== requestProfile) {
    activeProfile = requestProfile;
    teamFilter = null;
    trainerFilter = 'all';
  }
  app().innerHTML = `<div class="loader"><h1 class="ext" style="font-size:30px">Аналитика</h1><div class="dots"><i></i><i></i><i></i></div></div>`;
  window.scrollTo(0, 0);
  let data;
  try {
    data = await api.analytics();
    const answers = await api.answers();
    if (requestProfile === store.profileKey()) answersData = answers;
  } catch (e) {
    if (location.hash !== '#/analytics' || requestProfile !== store.profileKey()) return;
    if (e.status === 401) {
      if (store.adminCode()) toast('Неверный код руководителя', 'error');
      const code = await promptModal({ title: 'Код руководителя', text: 'Раздел для руководителя направления и руководителей групп. При смене профиля код потребуется снова.', label: 'Код', type: 'password', value: '', submit: 'Войти' });
      if (location.hash !== '#/analytics' || requestProfile !== store.profileKey()) return;
      if (code) { store.setAdminCode(code); return leaderPage(); }
      store.setAdminCode('');
      app().innerHTML = `<div class="empty"><h2>Нужен код руководителя</h2><p class="muted">Код выдаёт руководитель направления.</p><br><button class="btn btn-primary" id="retryCode">Ввести код</button></div>`;
      $('#retryCode')?.addEventListener('click', () => leaderPage());
      return;
    }
    if (e.status === 429) {
      app().innerHTML = `<div class="empty"><h2>Вход временно закрыт</h2><p class="muted">${esc(e.message)}</p></div>`;
      return;
    }
    app().innerHTML = `<div class="empty"><h2>Не удалось загрузить данные</h2><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  if (location.hash !== '#/analytics' || requestProfile !== store.profileKey()) return;
  if (teamFilter === null) {
    const mine = store.profile().teams || [];
    teamFilter = mine.length ? mine[0] : 'all';
  }
  app().innerHTML = (data.open ? openNote() : '') + (data.db ? '' : dbNote()) + analyticsView(data);
  bind(data);
}

function openNote() {
  return `<div class="note" style="border-color:var(--red);margin-bottom:24px">${icon('info')}<p>Раздел сейчас открыт всем, у кого есть ссылка. Чтобы закрыть его кодом, добавьте в Cloudflare секрет <b>ADMIN_CODE</b>.</p></div>`;
}
function dbNote() {
  return `<div class="note" style="margin-bottom:24px">${icon('info')}<p>База учёта не подключена: тренировки работают, но аналитика не сохраняется. Нужна привязка D1 с именем <b>DB</b> в настройках проекта.</p></div>`;
}

// ---------- Аналитика: команды и сотрудники ----------
function analyticsView(d) {
  const teams = d.teams.filter((t) => t.id);
  const chips = [['all', 'Все команды'], ...teams.map((t) => [t.id, t.name])];
  const sel = teamFilter === 'all' ? null : d.teams.find((t) => t.id === teamFilter);
  const list = sel ? [sel] : d.teams;
  const count = list.reduce((s, t) => s + t.count, 0);
  const avg = count ? list.reduce((s, t) => s + (t.avg || 0) * t.count, 0) / count : null;
  const size = list.reduce((s, t) => s + t.size, 0);
  const trained = list.reduce((s, t) => s + t.trained, 0);
  const rates = {};
  for (const c of CRITERIA) rates[c.key] = count ? Math.round(list.reduce((s, t) => s + (t.rates[c.key] || 0) * t.count, 0) / count) : 0;
  const people = list.flatMap((t) => t.people.map((p) => ({ ...p, team: t.name })));
  people.sort((a, b) => b.count - a.count || (b.avg || 0) - (a.avg || 0));
  const errors = merge(list.map((t) => t.errors));
  const trainers = merge(list.map((t) => t.trainers));

  return `
  <div class="section-head" style="margin-bottom:20px">
    <div><h1 style="font-size:40px">Аналитика тренировок</h1><p class="muted">Баллы — по тренировкам с разбором. Ответы на фразы клиентов — ниже.</p></div>
  </div>
  <div class="chips" role="group" aria-label="Команда" style="margin-bottom:24px">${chips.map(([id, name]) => `<button class="chip ${teamFilter === id ? 'on' : ''}" data-team="${id}">${esc(name)}</button>`).join('')}</div>
  <div class="stats">
    <div class="kpi"><b class="ext">${count}</b><span>${plural(count, 'тренировка', 'тренировки', 'тренировок')} с разбором</span></div>
    <div class="kpi"><b class="ext">${avg === null ? '—' : num(avg)}</b><span>средний балл из 4</span></div>
    <div class="kpi"><b class="ext">${trained} из ${size}</b><span>сотрудников уже тренировались</span></div>
  </div>
  <section class="section two">
    <div class="box">
      <h2>Где теряют баллы</h2>
      <div class="bars">${CRITERIA.map((c) => `<div class="bar-row"><span>${esc(c.name)}</span><div class="bar-track" aria-hidden="true"><i style="width:${rates[c.key]}%"></i></div><b>${rates[c.key]}%</b></div>`).join('')}</div>
      <p class="hint" style="margin-top:12px">Доля звонков, где пункт выполнен.</p>
    </div>
    <div class="box">
      <h2>Частые ошибки</h2>
      ${errors.length ? `<ul class="lineup">${errors.slice(0, 5).map((e) => `<li><b>${esc(cap(e.name))}</b><span>${e.count} ${plural(e.count, 'звонок', 'звонка', 'звонков')}</span></li>`).join('')}</ul>` : '<p class="muted">Пока нет данных.</p>'}
      <h2 style="margin-top:22px">Чаще тренируют</h2>
      ${trainers.length ? `<ul class="lineup">${trainers.slice(0, 4).map((e) => `<li><b>${esc(e.name)}</b><span>${e.count} ${plural(e.count, 'раз', 'раза', 'раз')}</span></li>`).join('')}</ul>` : '<p class="muted">Пока нет данных.</p>'}
    </div>
  </section>
  <section class="section">
    <div class="table-wrap"><table>
      <thead><tr><th>Сотрудник</th><th>Команда</th><th>Тренировок</th><th>Средний балл</th><th>Слабое место</th><th>Частая ошибка</th><th>Последняя</th></tr></thead>
      <tbody>${people.map((p) => `<tr>
        <td>${esc(p.name)}${p.lead ? '<span class="t">руководитель</span>' : p.inRoster ? '' : '<span class="t">нет в составе команды</span>'}</td>
        <td>${esc(p.team)}</td>
        <td>${p.count || '<span class="neg">0</span>'}</td>
        <td>${p.avg === null ? '—' : `<b>${num(p.avg)}</b> / 4`}</td>
        <td>${esc(p.weakest || '—')}</td>
        <td>${esc(cap(p.topError) || '—')}</td>
        <td>${p.last ? esc(fmtDate(p.last)) : '—'}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>
  ${answersView(d)}`;
}

// ---------- Режим «Фразы»: фраза клиента → что ответили менеджеры ----------
function answersInScope(d) {
  const all = (answersData?.answers || []).filter((a) => a.source !== 'skip');
  if (teamFilter === 'all') return all;
  return all.filter((a) => (a.team || '') === teamFilter);
}

function answersView(d) {
  const list = answersInScope(d);
  const trainers = [...new Map(list.map((a) => [a.scenario, a.title])).entries()].sort((x, y) => x[1].localeCompare(y[1], 'ru'));
  if (trainerFilter !== 'all' && !trainers.some(([id]) => id === trainerFilter)) trainerFilter = 'all';
  const shown = trainerFilter === 'all' ? list : list.filter((a) => a.scenario === trainerFilter);
  const groups = new Map();
  for (const a of shown) {
    const k = a.scenario + '|' + a.qkey;
    if (!groups.has(k)) groups.set(k, { title: a.title, question: a.question, step: a.qkey === 'pickup' ? -1 : parseInt(String(a.qkey).slice(1), 10) || 0, scenario: a.scenario, items: [] });
    groups.get(k).items.push(a);
  }
  const ordered = [...groups.values()].sort((x, y) => x.title.localeCompare(y.title, 'ru') || x.step - y.step);
  const people = new Set(list.map((a) => a.manager).filter(Boolean)).size;
  return `
  <section class="section" id="answers">
    <div class="section-head" style="margin-bottom:16px">
      <div><h2 style="font-size:28px">Ответы на фразы клиентов</h2><p class="muted">${list.length} ${plural(list.length, 'ответ', 'ответа', 'ответов')} · ${people} ${plural(people, 'сотрудник', 'сотрудника', 'сотрудников')}. Фраза клиента — и что на неё ответили.</p></div>
      ${list.length ? `<button class="btn btn-outline" id="answersCsv">${icon('download', 20)} Выгрузить ответы CSV</button>` : ''}
    </div>
    ${trainers.length > 1 ? `<div class="chips" style="margin-bottom:18px">${[['all', 'Все тренажёры'], ...trainers].map(([id, name]) => `<button class="chip ${trainerFilter === id ? 'on' : ''}" data-trainer="${esc(id)}">${esc(name)}</button>`).join('')}</div>` : ''}
    ${ordered.length ? ordered.map((g) => `
      <details class="box ans-group">
        <summary><span class="tag">${esc(g.title)}</span><b>«${esc(g.question)}»</b><span class="muted small">${g.items.length} ${plural(g.items.length, 'ответ', 'ответа', 'ответов')}</span></summary>
        <div class="ans-list">${g.items.map((a) => `
          <div class="ans"><div class="ans-who"><b>${esc(a.manager || 'Без имени')}</b><span>${esc(teamName(d, a.team))} · ${esc(fmtDate(a.at))} · ${a.words} ${plural(a.words, 'слово', 'слова', 'слов')} · ${fmtTime(a.seconds)}${a.source === 'typed' ? ' · печатал' : ''}</span></div><p>${esc(a.answer)}</p></div>`).join('')}
        </div>
      </details>`).join('') : '<p class="muted">Пока никто не проходил режим «Фразы».</p>'}
  </section>`;
}

function answersCsv(d) {
  const rows = [['Дата', 'Сотрудник', 'Группа', 'Тренажёр', 'Фраза клиента', 'Ответ', 'Слов', 'Секунд', 'Как отвечал', 'Балл тренировки', 'Тренировка']];
  const how = { voice: 'голосом', typed: 'печатал', mixed: 'голос + правка' };
  for (const a of answersInScope(d)) {
    rows.push([a.at, a.manager, teamName(d, a.team), a.title, a.question, a.answer, a.words, a.seconds, how[a.source] || a.source, a.score ?? '', a.sid]);
  }
  const csv = '\ufeff' + rows.map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
  const el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  el.download = 'red-coach-answers.csv';
  el.click();
  setTimeout(() => URL.revokeObjectURL(el.href), 1000);
}

function bind(data) {
  const redraw = () => {
    const y = window.scrollY;
    app().innerHTML = (data.open ? openNote() : '') + (data.db ? '' : dbNote()) + analyticsView(data);
    bind(data);
    window.scrollTo(0, y);
  };
  $$('[data-team]').forEach((b) => b.addEventListener('click', () => { teamFilter = b.dataset.team; redraw(); }));
  $$('[data-trainer]').forEach((b) => b.addEventListener('click', () => { trainerFilter = b.dataset.trainer; redraw(); }));
  $('#answersCsv')?.addEventListener('click', () => answersCsv(data));
}

function teamName(d, id) { return d.roster.find((t) => t.id === id)?.name || ''; }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function merge(lists) {
  const m = {};
  for (const l of lists) for (const x of l) m[x.name] = (m[x.name] || 0) + x.count;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}
