// Диктовка: на экране реальная фраза клиента, менеджер отвечает голосом (распознаёт браузер) или печатает.
// ИИ для этого не нужен: ответы сохраняются в базу, разбор — если подключена модель.
import { api } from './api.js';
import { findScenario } from './catalog.js';
import { esc, $, icon, fmtTime, toast } from './ui.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canDictate = Boolean(SR);

const join = (a, b) => [a, b].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export class Dictation {
  constructor({ sid, trainer, data, onDone }) {
    this.sid = sid;
    this.trainer = trainer; // что выбрал менеджер (может быть random)
    this.scenario = data.scenario; // реальный тренажёр
    this.questions = data.questions;
    this.total = data.total;
    this.onDone = onDone;
    this.i = 0;
    this.answers = [];
    this.t0 = performance.now();
    this.qStart = this.t0;
    this.rec = null;
    this.recording = false;
    this.base = '';
    this.used = { voice: false, typed: false };
    this.draft = '';
    this.done = false;
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
          <p class="muted small">Диктовка · фраза ${this.i + 1} из ${this.questions.length}</p></div>
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
        <textarea id="ans" placeholder="${canDictate ? 'Нажмите на микрофон и говорите. Или напечатайте ответ.' : 'Напечатайте ответ или включите диктовку системы.'}">${esc(this.draft)}</textarea>
        <div class="dict-ctl">
          <button type="button" class="round mic ${this.recording ? 'rec' : ''}" id="micBtn" aria-pressed="${this.recording}" title="Диктовать">${icon('mic', 28)}</button>
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
    return this.recording ? 'Идёт запись — говорите. Нажмите, чтобы остановить' : 'Нажмите и говорите';
  }

  bind() {
    const ta = $('#ans');
    ta.addEventListener('input', () => {
      this.draft = ta.value;
      if (this.recording) this.stopMic(true); // начали править руками — останавливаем запись
      this.base = ta.value;
      this.used.typed = true;
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.next(false); } });
    $('#micBtn').addEventListener('click', () => (this.recording ? this.stopMic(false) : this.startMic()));
    $('#nextBtn').addEventListener('click', () => this.next(false));
    $('#skipBtn').addEventListener('click', () => this.next(true));
    if (!canDictate) setTimeout(() => ta.focus(), 50);
  }

  setMicUi() {
    const b = $('#micBtn');
    if (b) { b.classList.toggle('rec', this.recording); b.setAttribute('aria-pressed', String(this.recording)); }
    const st = $('#micState');
    if (st) st.textContent = this.micLabel();
  }

  startMic() {
    if (!SR) {
      toast('Распознавание речи есть в Chrome и Edge. Или включите диктовку Windows: Win + H', 'error');
      $('#ans')?.focus();
      return;
    }
    this.base = $('#ans')?.value || '';
    this.recording = true;
    this.used.voice = true;
    this.setMicUi();
    this.listen();
  }

  listen() {
    let rec;
    try {
      rec = new SR();
    } catch {
      this.recording = false;
      this.setMicUi();
      return;
    }
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    let fin = '';
    rec.onresult = (e) => {
      if (this.rec !== rec) return;
      fin = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0]?.transcript || '';
        if (e.results[i].isFinal) fin = join(fin, t); else interim = join(interim, t);
      }
      const ta = $('#ans');
      const text = capFirst(join(this.base, join(fin, interim)));
      if (ta) { ta.value = text; ta.scrollTop = ta.scrollHeight; }
      this.draft = text;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast('Нет доступа к микрофону. Разрешите его в адресной строке браузера.', 'error');
        this.recording = false;
      } else if (e.error === 'network') {
        toast('Распознавание речи сейчас недоступно. Напечатайте ответ или включите диктовку Windows: Win + H', 'error');
        this.recording = false;
      } else if (e.error === 'audio-capture') {
        toast('Микрофон не найден.', 'error');
        this.recording = false;
      }
      this.setMicUi();
    };
    rec.onend = () => {
      if (this.rec !== rec) return; // запись остановили правкой текста или переходом к следующей фразе
      this.base = capFirst(join(this.base, fin));
      this.draft = this.base;
      const ta = $('#ans');
      if (ta) ta.value = this.base;
      if (this.recording && !this.done) this.listen(); // браузер сам останавливает распознавание после паузы — продолжаем
      else this.rec = null;
    };
    this.rec = rec;
    try { rec.start(); } catch { this.recording = false; this.setMicUi(); }
  }

  // detach — текст из поля уже окончательный, итог распознавания не дописывать.
  stopMic(detach = false) {
    this.recording = false;
    const rec = this.rec;
    if (detach) this.rec = null;
    if (rec) { try { rec.stop(); } catch {} }
    this.setMicUi();
  }

  async next(skip) {
    if (this.done) return;
    const ta = $('#ans');
    this.stopMic(true);
    const answer = skip ? '' : String(ta?.value || '').trim();
    if (!skip && !answer) { toast('Скажите или напишите ответ. Или нажмите «Пропустить».', 'error'); return; }
    const q = this.questions[this.i];
    const seconds = Math.round((performance.now() - this.qStart) / 1000);
    const source = skip ? 'skip' : this.used.voice && this.used.typed ? 'mixed' : this.used.voice ? 'voice' : 'typed';
    const item = { step: this.i, key: q.key, question: q.text, answer, seconds, source, t: Math.round(this.now() * 10) / 10 };
    this.answers.push(item);
    // Запись в базу — в фоне: при ошибке ответ всё равно останется в разборе на этом компьютере.
    api.saveAnswer({ sid: this.sid, scenario: this.scenario, trainer: this.trainer, step: item.step, key: item.key, answer, seconds, source, totalSec: Math.round(this.now()) })
      .catch((e) => toast('Ответ не сохранился на сервере: ' + e.message, 'error'));
    this.i += 1;
    this.draft = '';
    this.base = '';
    this.used = { voice: false, typed: false };
    this.qStart = performance.now();
    if (this.i >= this.questions.length) return this.finish();
    this.render();
    window.scrollTo(0, 0);
  }

  // Ушли со страницы — останавливаем микрофон. Ответы уже на сервере.
  abort() {
    this.done = true;
    this.stopMic(true);
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
