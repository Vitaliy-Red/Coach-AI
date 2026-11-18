// Режим «Фразы»: на экране реальная фраза клиента, менеджер отвечает голосом (распознаёт браузер) или печатает.
// Фразы не зависят от ответов — это разминка и сбор ответов. ИИ не нужен; разбор — если подключена модель.
import { api } from './api.js';
import { findScenario } from './catalog.js';
import { esc, $, icon, fmtTime, toast } from './ui.js';
import { SpeechInput, canDictate } from './speech.js';

export { canDictate };

export class Dictation {
  constructor({ sid, trainer, data, onDone }) {
    this.sid = sid;
    this.trainer = trainer; // что выбрал менеджер (может быть random)
    this.scenario = data.scenario; // реальный тренажёр
    this.questions = data.questions;
    this.onDone = onDone;
    this.i = 0;
    this.answers = [];
    this.t0 = performance.now();
    this.qStart = this.t0;
    this.typed = false;
    this.done = false;
    this.speech = new SpeechInput({ field: () => $('#ans'), onState: () => this.setMicUi() });
  }

  now() { return (performance.now() - this.t0) / 1000; }

  mount(app) {
    this.app = app;
    this.render();
    clearInterval(this.timer);
    this.timer = setInterval(() => { const el = $('#timer'); if (el) el.textContent = fmtTime(this.now()); }, 500);
  }

  render() {
    const s = findScenario(this.trainer);
    const real = findScenario(this.scenario);
    const q = this.questions[this.i];
    const last = this.i === this.questions.length - 1;
    const pct = Math.round((100 * this.i) / this.questions.length);
    this.app.innerHTML = `
    <div class="dict">
      <div class="call-top">
        <div><span class="tag">${esc(real?.group || s?.group || '')}</span><h1 style="margin-top:8px">${esc(real?.title || s?.title || '')}</h1>
          <p class="muted small">Фразы · ${this.i + 1} из ${this.questions.length}</p></div>
        <div class="timer ext" id="timer">${fmtTime(this.now())}</div>
      </div>
      <div class="dict-progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <div class="dict-q">
        <span class="dict-who">${icon('user', 22)} ${this.i === 0 ? 'Клиент снял трубку' : 'Клиент'}</span>
        <p class="dict-quote">«${esc(q.text)}»</p>
        <span class="hint">${this.i === 0 ? 'Начните разговор так, как начинаете звонок.' : 'Реальная фраза клиента из расшифровки звонка.'}</span>
      </div>
      <div class="dict-a">
        <label for="ans">Ваш ответ</label>
        <textarea id="ans" placeholder="${canDictate ? 'Нажмите на микрофон и говорите. Или напечатайте ответ.' : 'Напечатайте ответ или включите диктовку системы.'}"></textarea>
        <div class="dict-ctl">
          <button type="button" class="round mic" id="micBtn" aria-pressed="false" title="Диктовать">${icon('mic', 28)}</button>
          <span class="dict-state" id="micState" aria-live="polite">${this.micLabel()}</span>
          <span class="grow"></span>
          <button type="button" class="btn btn-ghost" id="skipBtn">Пропустить</button>
          <button type="button" class="btn btn-primary btn-lg" id="nextBtn">${last ? 'Завершить' : 'Ответить'} ${icon('arrow', 20)}</button>
        </div>
        ${canDictate ? '' : `<div class="note" style="margin-top:14px">${icon('info')}<p>В этом браузере нет распознавания речи. Откройте сайт в Chrome или Edge либо включите диктовку системы: Windows — <b>Win + H</b>, Mac — дважды <b>Fn</b>.</p></div>`}
      </div>
      <p class="tipline">Отвечайте так, как сказали бы клиенту по телефону. Текст можно поправить перед отправкой.<span class="kbd-hint"> Ctrl + Enter — ответить.</span></p>
      ${this.answers.length ? `<details class="box dict-prev"><summary>Ваши ответы (${this.answers.filter((a) => a.source !== 'skip').length})</summary>
        ${this.answers.map((a) => `<div class="line"><span class="who-l">Клиент</span><p>${esc(a.question)}</p></div>
          <div class="line mgr"><span class="who-l">Вы</span><p>${a.source === 'skip' ? '<span class="muted">пропущено</span>' : esc(a.answer)}</p></div>`).join('')}
      </details>` : ''}
    </div>`;
    this.bind();
  }

  micLabel() {
    if (!canDictate) return 'Распознавание недоступно';
    return this.speech?.recording ? 'Идёт запись — говорите. Нажмите, чтобы остановить' : 'Нажмите и говорите';
  }

  bind() {
    const ta = $('#ans');
    ta.addEventListener('input', () => {
      if (this.speech.recording) this.speech.stop(true); // начали править руками — останавливаем запись
      this.speech.base = ta.value;
      this.typed = true;
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.next(false); } });
    $('#micBtn').addEventListener('click', () => this.speech.toggle());
    $('#nextBtn').addEventListener('click', () => this.next(false));
    $('#skipBtn').addEventListener('click', () => this.next(true));
    if (!canDictate) setTimeout(() => ta.focus(), 50);
  }

  setMicUi() {
    const b = $('#micBtn');
    if (b) { b.classList.toggle('rec', this.speech.recording); b.setAttribute('aria-pressed', String(this.speech.recording)); }
    const st = $('#micState');
    if (st) st.textContent = this.micLabel();
  }

  next(skip) {
    if (this.done) return;
    this.speech.stop(true);
    const answer = skip ? '' : String($('#ans')?.value || '').trim();
    if (!skip && !answer) { toast('Скажите или напишите ответ. Или нажмите «Пропустить».', 'error'); return; }
    const q = this.questions[this.i];
    const seconds = Math.round((performance.now() - this.qStart) / 1000);
    const voice = this.speech.used;
    const source = skip ? 'skip' : voice && this.typed ? 'mixed' : voice ? 'voice' : 'typed';
    const item = { step: this.i, key: q.key, question: q.text, answer, seconds, source, t: Math.round(this.now() * 10) / 10 };
    this.answers.push(item);
    // Запись в базу — в фоне: при ошибке ответ всё равно останется в разборе на этом компьютере.
    api.saveAnswer({ sid: this.sid, scenario: this.scenario, trainer: this.trainer, step: item.step, key: item.key, answer, seconds, source, totalSec: Math.round(this.now()) })
      .catch((e) => toast('Ответ не сохранился на сервере: ' + e.message, 'error'));
    this.i += 1;
    this.speech.reset();
    this.typed = false;
    this.qStart = performance.now();
    if (this.i >= this.questions.length) return this.finish();
    this.render();
    window.scrollTo(0, 0);
  }

  // Ушли со страницы — останавливаем микрофон. Ответы уже на сервере.
  abort() {
    this.done = true;
    this.speech.stop(true);
    clearInterval(this.timer);
  }

  finish() {
    this.abort();
    const transcript = [];
    for (const a of this.answers) {
      if (a.source === 'skip') continue;
      transcript.push({ role: 'client', text: a.question, t: Math.max(0, a.t - a.seconds) });
      transcript.push({ role: 'manager', text: a.answer, t: a.t });
    }
    this.onDone({
      reason: 'manager',
      connected: transcript.length > 0,
      message: 'Нет ни одного ответа.',
      transcript,
      durationSec: Math.round(this.now()),
      outcome: null,
      resolved: { id: this.scenario, level: 'medium' },
      answers: this.answers.map(({ question, answer, seconds, source }) => ({ question, answer, seconds, source })),
    });
  }
}
