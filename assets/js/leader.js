// Разделы руководителя: «Руководитель» (бюджет и расходы) и «Аналитика» (команды и сотрудники).
import { CRITERIA } from './catalog.js';
import { api } from './api.js';
import { store } from './store.js';
import { esc, $, $$, icon, fmtTime, fmtDate, plural, toast, promptModal } from './ui.js';

const LEVEL = { easy: 'Лёгкий', medium: 'Средний', hard: 'Трудный' };
let teamFilter = 'all';

const app = () => $('#app');
const rub = (v, d = 2) => `${(Number(v) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d })} ₽`;
const num = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: d }));

export async function leaderPage(kind) {
  app().innerHTML = `<div class="loader"><h1 class="ext" style="font-size:30px">${kind === 'admin' ? 'Руководитель' : 'Аналитика'}</h1><div class="dots"><i></i><i></i><i></i></div></div>`;
  window.scrollTo(0, 0);
  let data;
  try {
    data = await api.admin();
  } catch (e) {
    if (e.status === 401) {
      const code = await promptModal({ title: 'Код руководителя', text: 'Раздел для руководителя направления и РГ.', label: 'Код', type: 'password', value: '', submit: 'Войти' });
      if (code) { store.setAdminCode(code); return leaderPage(kind); }
      app().innerHTML = `<div class="empty"><h2>Нужен код руководителя</h2><p class="muted">Его задают в настройках Cloudflare (ADMIN_CODE).</p></div>`;
      return;
    }
    app().innerHTML = `<div class="empty"><h2>Не удалось загрузить данные</h2><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  if (!location.hash.startsWith('#/' + kind)) return; // пользователь ушёл со страницы
  app().innerHTML = (data.open ? openNote() : '') + (data.db ? '' : dbNote()) + (kind === 'admin' ? adminView(data) : analyticsView(data));
  bind(kind, data);
}

function openNote() {
  return `<div class="note" style="border-color:var(--red);margin-bottom:24px">${icon('info')}<p>Раздел сейчас открыт всем, у кого есть ссылка. Чтобы закрыть его кодом, добавьте в Cloudflare секрет <b>ADMIN_CODE</b>.</p></div>`;
}
function dbNote() {
  return `<div class="note" style="margin-bottom:24px">${icon('info')}<p>База учёта не подключена: звонки работают, но расход и аналитика не сохраняются. Нужна привязка D1 с именем <b>DB</b> в настройках проекта.</p></div>`;
}

// ---------- Руководитель: бюджет и расходы ----------
function adminView(d) {
  const t = d.tariffs;
  const used = d.budget > 0 ? Math.min(100, Math.round((100 * d.spent) / d.budget)) : 0;
  const low = d.budget > 0 && d.remaining < d.budget * 0.15;
  const maxDay = Math.max(1, ...d.days.map((x) => x.cost));
  return `
  <div class="section-head" style="margin-bottom:24px">
    <div><h1 style="font-size:40px">Баланс и расходы</h1><p class="muted">Расход считает сайт по секундам звука и токенам с тарифами Yandex AI Studio. Точный остаток — в Yandex Cloud Billing.</p></div>
    <a class="btn btn-outline" href="https://console.yandex.cloud/billing" target="_blank" rel="noopener">Открыть Yandex Billing</a>
  </div>
  <div class="stats">
    <div class="kpi"><b class="ext">${rub(d.budget, 0)}</b><span>бюджет · <button class="linkbtn" id="editBudget">изменить</button></span></div>
    <div class="kpi"><b class="ext">${rub(d.spent)}</b><span>израсходовано</span></div>
    <div class="kpi ${low ? 'kpi-neg' : ''}"><b class="ext">${rub(d.remaining)}</b><span>осталось${low ? ' — пора пополнить или остановить' : ''}</span></div>
  </div>
  <div class="budget-bar" aria-label="Израсходовано ${used}%"><i style="width:${used}%"></i></div>
  <p class="hint" style="margin-top:8px">Израсходовано ${used}% бюджета.</p>

  <section class="section">
    <div class="metrics">
      <div class="metric"><b class="ext">${rub(d.perMinute)}</b><span>минута голосового звонка</span></div>
      <div class="metric"><b class="ext">${rub(d.perCall)}</b><span>средняя тренировка с разбором</span></div>
      <div class="metric"><b class="ext">${d.calls}</b><span>${plural(d.calls, 'тренировка', 'тренировки', 'тренировок')} всего</span></div>
      <div class="metric"><b class="ext">${d.perCall > 0 ? Math.max(0, Math.floor(d.remaining / d.perCall)) : '—'}</b><span>тренировок хватит на остаток</span></div>
    </div>
  </section>

  <section class="section two">
    <div class="box">
      <h2>Тарифы</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Что</th><th>Цена</th><th>За минуту</th></tr></thead>
        <tbody>
          <tr><td>Голос менеджера (входящее аудио)</td><td>${rub(t.audioInSec, 4)} / сек</td><td>${rub(t.audioInSec * 60)}</td></tr>
          <tr><td>Голос клиента (исходящее аудио)</td><td>${rub(t.audioOutSec, 4)} / сек</td><td>${rub(t.audioOutSec * 60)}</td></tr>
          <tr><td>Модель голоса: входящие токены</td><td>${rub(t.rtIn1k, 3)} / 1000</td><td>—</td></tr>
          <tr><td>Модель голоса: повторные (кеш)</td><td>${rub(t.rtCached1k, 3)} / 1000</td><td>—</td></tr>
          <tr><td>Модель голоса: исходящие токены</td><td>${rub(t.rtOut1k, 3)} / 1000</td><td>—</td></tr>
          <tr><td>Разбор и текстовый режим (YandexGPT)</td><td>${rub(t.llmIn1k, 3)} / 1000</td><td>—</td></tr>
        </tbody>
      </table></div>
      <p class="hint" style="margin-top:10px">Цены с НДС, по странице тарифов Yandex AI Studio. Микрофон менеджера тарифицируется всё время звонка.</p>
    </div>
    <div class="box">
      <h2>Расход по дням</h2>
      ${d.days.length ? `<div class="bars">${d.days.slice(-14).map((x) => `
        <div class="bar-row day-row"><span>${esc(x.day.slice(8, 10) + '.' + x.day.slice(5, 7))} · ${x.calls} ${plural(x.calls, 'звонок', 'звонка', 'звонков')}</span><div class="bar-track" aria-hidden="true"><i style="width:${Math.max(2, Math.round((100 * x.cost) / maxDay))}%"></i></div><b>${rub(x.cost, 0)}</b></div>`).join('')}</div>`
        : '<p class="muted">Звонков пока не было.</p>'}
    </div>
  </section>

  <section class="section">
    <h2 style="font-size:24px;margin-bottom:14px">Последние тренировки</h2>
    ${d.sessions.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Дата</th><th>Сотрудник</th><th>Тренажёр</th><th>Режим</th><th>Длительность</th><th>Стоимость</th><th>Балл</th></tr></thead>
      <tbody>${d.sessions.map((r) => `<tr>
        <td>${esc(fmtDate(r.at))}</td>
        <td>${esc(r.manager || '—')}<span class="t">${esc(teamName(d, r.team))}</span></td>
        <td>${esc(r.trainer)}${r.real ? `<span class="t">${esc(r.real)}</span>` : ''}</td>
        <td>${r.mode === 'text' ? 'Текст' : 'Голос'}</td>
        <td>${fmtTime(r.duration)}</td>
        <td>${rub(r.cost)}</td>
        <td>${r.score === null || r.score === undefined ? '—' : `<b>${r.score}</b> / 4`}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Пока пусто.</p>'}
  </section>`;
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
    <div><h1 style="font-size:40px">Аналитика тренировок</h1><p class="muted">Только звонки с разбором. Сотрудник выбирает себя при входе на сайт.</p></div>
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
        <td>${esc(p.name)}${p.inRoster ? '' : '<span class="t">нет в составе команды</span>'}</td>
        <td>${esc(p.team)}</td>
        <td>${p.count || '<span class="neg">0</span>'}</td>
        <td>${p.avg === null ? '—' : `<b>${num(p.avg)}</b> / 4`}</td>
        <td>${esc(p.weakest || '—')}</td>
        <td>${esc(cap(p.topError) || '—')}</td>
        <td>${p.last ? esc(fmtDate(p.last)) : '—'}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function bind(kind, data) {
  $$('[data-team]').forEach((b) => b.addEventListener('click', () => {
    teamFilter = b.dataset.team;
    app().innerHTML = (data.open ? openNote() : '') + (data.db ? '' : dbNote()) + analyticsView(data);
    bind(kind, data);
  }));
  $('#editBudget')?.addEventListener('click', async () => {
    const v = await promptModal({ title: 'Бюджет на тренировки', text: 'Например, стартовый грант Yandex Cloud — 4 000 ₽.', label: 'Сумма, ₽', value: String(data.budget), submit: 'Сохранить' });
    if (!v) return;
    try {
      await api.setBudget(Number(String(v).replace(/[^\d.,]/g, '').replace(',', '.')));
      toast('Бюджет сохранён');
      leaderPage(kind);
    } catch (e) { toast(e.message, 'error'); }
  });
}

function teamName(d, id) { return d.roster.find((t) => t.id === id)?.name || ''; }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function merge(lists) {
  const m = {};
  for (const l of lists) for (const x of l) m[x.name] = (m[x.name] || 0) + x.count;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}
