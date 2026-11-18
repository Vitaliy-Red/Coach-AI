// Диктовка в поле ввода: браузер переводит речь в текст (Chrome, Edge). Без ИИ и без оплаты.
import { toast } from './ui.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canDictate = Boolean(SR);

const join = (a, b) => [a, b].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export class SpeechInput {
  // field() — текущее поле ввода (страница может перерисоваться); onState(recording) — обновить кнопку.
  constructor({ field, onState }) {
    this.field = field;
    this.onState = onState || (() => {});
    this.rec = null;
    this.recording = false;
    this.base = '';
    this.used = false;
  }

  toggle() { return this.recording ? this.stop(false) : this.start(); }

  start() {
    if (!SR) {
      toast('Распознавание речи есть в Chrome и Edge. Или включите диктовку Windows: Win + H', 'error');
      this.field()?.focus();
      return;
    }
    this.base = this.field()?.value || '';
    this.recording = true;
    this.used = true;
    this.onState(true);
    this.listen();
  }

  listen() {
    let rec;
    try { rec = new SR(); } catch { this.recording = false; this.onState(false); return; }
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
      const f = this.field();
      if (f) { f.value = capFirst(join(this.base, join(fin, interim))); f.scrollTop = f.scrollHeight; f.dispatchEvent(new CustomEvent('dictation')); }
    };
    rec.onerror = (e) => {
      const msg = {
        'not-allowed': 'Нет доступа к микрофону. Разрешите его в адресной строке браузера.',
        'service-not-allowed': 'Браузер не разрешил распознавание речи. Напечатайте ответ или нажмите Win + H.',
        network: 'Распознавание речи сейчас недоступно. Напечатайте ответ или включите диктовку Windows: Win + H',
        'audio-capture': 'Микрофон не найден.',
      }[e.error];
      if (msg) { toast(msg, 'error'); this.recording = false; this.onState(false); }
    };
    rec.onend = () => {
      if (this.rec !== rec) return; // запись остановили правкой текста или отправкой
      this.base = capFirst(join(this.base, fin));
      const f = this.field();
      if (f) f.value = this.base;
      if (this.recording) this.listen(); // браузер сам закрывает распознавание после паузы — продолжаем
      else this.rec = null;
    };
    this.rec = rec;
    try { rec.start(); } catch { this.recording = false; this.onState(false); }
  }

  // detach — текст в поле уже окончательный, итог распознавания не дописывать.
  stop(detach = false) {
    this.recording = false;
    const rec = this.rec;
    if (detach) this.rec = null;
    if (rec) { try { rec.stop(); } catch {} }
    this.onState(false);
  }

  // Поле очистили (ответ отправлен) — начинаем с пустого.
  reset() { this.base = ''; this.used = false; }
}
