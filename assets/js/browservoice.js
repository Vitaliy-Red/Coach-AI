// Бесплатный голосовой звонок: клиент — открытая модель (как в «Диалоге»), говорит вслух голосом браузера;
// речь менеджера распознаёт браузер, реплика уходит после паузы. Перебивать клиента нельзя (полудуплекс).
import { api } from './api.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = window.speechSynthesis;
export const canBrowserVoice = Boolean(SR && TTS && window.SpeechSynthesisUtterance);

const PAUSE_MS = 2200; // тишина после речи менеджера, после которой реплика уходит клиенту
const FEMALE = /svetlana|dariya|daria|milena|irina|ekaterina|anna|alena|google/i;
const MALE = /dmitr|yuri|pavel|maxim|artem|boris/i;

function voicesReady() {
  if (!TTS) return Promise.resolve([]);
  const have = TTS.getVoices();
  if (have.length) return Promise.resolve(have);
  return new Promise((resolve) => {
    const done = () => resolve(TTS.getVoices());
    TTS.addEventListener?.('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export async function russianVoices() {
  return (await voicesReady()).filter((v) => /^ru/i.test(v.lang));
}

function pickVoice(list, gender) {
  const score = (v) => (/(natural|online)/i.test(v.name) ? 10 : 0) + (/google|microsoft/i.test(v.name) ? 3 : 0)
    + ((gender === 'male' ? MALE : FEMALE).test(v.name) ? 6 : 0) - ((gender === 'male' ? FEMALE : MALE).test(v.name) ? 6 : 0);
  return [...list].sort((a, b) => score(b) - score(a))[0] || null;
}

// Для голоса: без ремарок в скобках и служебных пометок.
function speakable(text) {
  return String(text || '').replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

export class BrowserVoiceCall {
  constructor({ scenario, level, sid, on = {} }) {
    this.scenario = scenario;
    this.level = level;
    this.sid = sid;
    this.on = on; // onState, onLine, onLevels, onTick, onWarn, onEnd, onHeard
    this.lines = [];
    this.ended = false;
    this.busy = false;
    this.muted = false;
    this.resolved = null;
    this.mode = 'idle'; // idle | thinking | speaking | listening
    this.heard = '';
    this.voice = null;
  }

  now() { return (performance.now() - this.t0) / 1000; }

  async start() {
    if (!canBrowserVoice) throw new Error('Голосовой режим работает в Chrome и Edge. Откройте сайт в одном из них.');
    this.t0 = performance.now();
    // Микрофон для индикатора громкости (и чтобы браузер спросил разрешение сразу).
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.an = this.ctx.createAnalyser();
      this.an.fftSize = 512;
      this.ctx.createMediaStreamSource(this.stream).connect(this.an);
      this.buf = new Float32Array(512);
    } catch {
      throw new Error('Нет доступа к микрофону. Разрешите его в адресной строке браузера.');
    }
    this.ru = await russianVoices();
    if (!this.ru.length) this.on.onWarn?.('В браузере нет русского голоса: реплики клиента будут только на экране. Лучше всего звучит Edge.', 'error');
    this.timer = setInterval(() => this.tick(), 80);
    await this.ask();
  }

  tick() {
    if (this.ended) return;
    const t = this.now();
    let you = 0;
    if (this.mode === 'listening' && !this.muted && this.an) {
      this.an.getFloatTimeDomainData(this.buf);
      let s = 0;
      for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
      you = Math.min(1, Math.sqrt(s / this.buf.length) * 4);
    }
    const client = this.mode === 'speaking' ? 0.25 + 0.35 * Math.abs(Math.sin(t * 7)) : 0;
    this.on.onLevels?.(client, you, t);
  }

  state(mode, text, kind) {
    this.mode = mode;
    this.on.onState?.(kind || mode, text);
  }

  push(role, text) {
    const line = { key: role[0] + this.lines.length, role, text, t: Math.round(this.now() * 10) / 10, final: true };
    this.lines.push(line);
    this.on.onLine?.(line, this.transcript());
  }

  async ask() {
    if (this.ended) return;
    this.busy = true;
    this.state('thinking', 'Клиент думает…');
    let r;
    try {
      r = await api.chat({
        scenario: this.resolved?.id || this.scenario,
        level: this.resolved?.level || this.level,
        gender: this.resolved?.gender,
        sid: this.sid,
        mode: 'voice',
        durationSec: Math.round(this.now()),
        messages: this.lines.map((l) => ({ role: l.role, text: l.text })),
      });
    } catch (e) {
      this.busy = false;
      this.on.onWarn?.(e.message, 'error');
      this.state('error', e.message, 'error');
      if (!this.lines.length) this.finish('failed', e.message);
      else this.listen(); // дадим сказать ещё раз
      return;
    }
    this.busy = false;
    if (this.ended) return;
    if (!this.resolved && r.resolved) this.resolved = r.resolved;
    if (!this.voice && this.ru?.length) this.voice = pickVoice(this.ru, this.resolved?.gender);
    this.push('client', r.reply);
    await this.speak(r.reply);
    if (this.ended) return;
    if (r.ended) { setTimeout(() => this.finish('client'), 500); return; }
    this.listen();
  }

  speak(text) {
    const say = speakable(text);
    this.state('speaking', 'Клиент говорит…');
    if (!say || !this.voice) return new Promise((res) => setTimeout(res, Math.min(6000, 400 + say.length * 45)));
    // Длинный текст Chrome обрывает — говорим по предложениям.
    const parts = say.split(/(?<=[.!?…])\s+/).filter(Boolean);
    return new Promise((resolve) => {
      let i = 0;
      const next = () => {
        if (this.ended || i >= parts.length) { resolve(); return; }
        const u = new SpeechSynthesisUtterance(parts[i++]);
        u.voice = this.voice;
        u.lang = this.voice.lang || 'ru-RU';
        u.rate = 1.05;
        let done = false;
        const go = () => { if (!done) { done = true; clearTimeout(guard); next(); } };
        u.onend = go;
        u.onerror = go;
        // Страховка: если браузер не сообщил о конце фразы.
        const guard = setTimeout(go, 2500 + u.text.length * 90);
        TTS.speak(u);
      };
      TTS.cancel();
      next();
    });
  }

  listen() {
    if (this.ended) return;
    this.heard = '';
    this.on.onHeard?.('');
    if (this.muted) { this.state('muted', 'Микрофон выключен — включите, чтобы ответить'); return; }
    this.state('listening', 'Говорите — клиент слушает');
    this.openRec();
  }

  openRec() {
    let rec;
    try { rec = new SR(); } catch { this.on.onWarn?.('Распознавание речи недоступно в этом браузере.', 'error'); return; }
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    const before = this.heard;
    let fin = '';
    rec.onresult = (e) => {
      if (this.rec !== rec) return;
      fin = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0]?.transcript || '';
        if (e.results[i].isFinal) fin += ' ' + t; else interim += ' ' + t;
      }
      this.heard = (before + ' ' + fin + ' ' + interim).replace(/\s+/g, ' ').trim();
      this.on.onHeard?.(this.heard);
      clearTimeout(this.pause);
      if (this.heard) this.pause = setTimeout(() => this.flush(), PAUSE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.on.onWarn?.('Браузер не дал доступ к распознаванию речи.', 'error'); this.rec = null; }
      if (e.error === 'network') { this.on.onWarn?.('Распознавание речи сейчас недоступно. Проверьте интернет.', 'error'); }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.heard = (before + ' ' + fin).replace(/\s+/g, ' ').trim();
      // Браузер сам закрывает распознавание после паузы — продолжаем слушать, пока ждём ответа менеджера.
      if (this.mode === 'listening' && !this.muted && !this.ended) this.openRec();
      else this.rec = null;
    };
    this.rec = rec;
    try { rec.start(); } catch {}
  }

  closeRec() {
    clearTimeout(this.pause);
    const rec = this.rec;
    this.rec = null;
    if (rec) { try { rec.stop(); } catch {} }
  }

  // Реплика менеджера готова: после паузы или по кнопке «Ответил».
  flush() {
    if (this.ended || this.mode !== 'listening') return;
    const text = this.heard.trim();
    if (!text) return;
    this.closeRec();
    this.heard = '';
    this.on.onHeard?.('');
    this.push('manager', text[0].toUpperCase() + text.slice(1));
    this.ask();
  }

  send(text) { // совместимость с текстовым вводом
    if (this.mode === 'listening' && String(text || '').trim()) { this.heard = String(text).trim(); this.flush(); }
  }

  setMuted(m) {
    this.muted = m;
    if (m) {
      this.closeRec();
      if (this.mode === 'listening') this.state('muted', 'Микрофон выключен — включите, чтобы ответить');
    } else if (this.mode === 'muted') {
      this.listen();
    }
  }

  transcript() {
    return this.lines.map((l) => ({ role: l.role, text: l.text, t: l.t }));
  }

  hangup() { this.finish('manager'); }

  finish(reason, message) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    this.closeRec();
    try { TTS.cancel(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.on.onEnd?.({
      reason,
      message,
      transcript: this.transcript(),
      durationSec: Math.round(this.now()),
      outcome: null,
      resolved: this.resolved,
      connected: this.lines.length > 0,
    });
  }
}
