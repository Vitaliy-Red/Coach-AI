// Голосовой звонок: микрофон → WebSocket (/api/realtime) → голос клиента.
// Протокол событий — OpenAI Realtime (поддерживают OpenAI и Yandex AI Studio).
// Учитываем оба варианта названий событий: GA (response.output_audio.*) и beta (response.audio.*).
import { api } from './api.js';

const AUDIO_DELTA = new Set(['response.output_audio.delta', 'response.audio.delta']);
const TR_DELTA = new Set(['response.output_audio_transcript.delta', 'response.audio_transcript.delta', 'response.output_text.delta', 'response.text.delta']);
const TR_DONE = new Set(['response.output_audio_transcript.done', 'response.audio_transcript.done', 'response.output_text.done', 'response.text.done']);

export class VoiceCall {
  constructor({ scenario, level, on = {} }) {
    this.scenario = scenario;
    this.level = level;
    this.on = on; // onState, onLine, onLevels, onEnd, onWarn
    this.lines = new Map(); // key → line
    this.order = [];
    this.muted = false;
    this.ended = false;
    this.endRequested = null;
    this.items = new Map(); // item_id → { start, dur }
    this.sources = new Set();
    this.playHead = 0;
    this.lastItem = null;
    this.rate = 16000;
    this.outRate = 16000;
    this.resolved = null;
    this.t0 = 0;
    this.connected = false;
    this.sttLines = [];
    this.rec = null;
  }

  // Вызывать прямо из обработчика клика: браузер разрешает звук только после действия пользователя.
  async start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !window.WebSocket || !navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('Браузер не поддерживает голосовой режим. Откройте сайт в Chrome, Edge или Яндекс Браузере.'), { code: 'browser' });
    }
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.ctx.resume?.();
    this.state('mic', 'Разрешите доступ к микрофону…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      this.cleanup();
      throw Object.assign(new Error('Нет доступа к микрофону. Разрешите его в адресной строке браузера и попробуйте снова.'), { code: 'mic' });
    }
    await this.ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url).href);

    // Выход: клиент → анализатор (для анимации) → динамики
    this.outGain = this.ctx.createGain();
    this.outAnalyser = this.ctx.createAnalyser();
    this.outAnalyser.fftSize = 512;
    this.outGain.connect(this.outAnalyser).connect(this.ctx.destination);
    // Вход: микрофон → анализатор и захват
    this.micSrc = this.ctx.createMediaStreamSource(this.stream);
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 512;
    this.micSrc.connect(this.micAnalyser);

    this.state('connecting', 'Соединяем…');
    this.ws = new WebSocket(api.realtimeUrl({ scenario: this.scenario, level: this.level }));
    this.ws.onmessage = (e) => { try { this.handle(JSON.parse(e.data)); } catch (err) { console.warn(err); } };
    this.ws.onclose = () => { if (!this.ended) this.finish(this.connected ? 'dropped' : 'failed'); };
    this.ws.onerror = () => {};
    this.loop();
  }

  state(kind, text) { this.on.onState?.(kind, text); }
  now() { return this.t0 ? (performance.now() - this.t0) / 1000 : 0; }

  setupCapture(rate) {
    this.rate = rate;
    this.worklet = new AudioWorkletNode(this.ctx, 'pcm-capture', { processorOptions: { targetRate: rate } });
    this.worklet.port.onmessage = (e) => {
      if (this.muted || !this.ws || this.ws.readyState !== 1) return;
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: toBase64(e.data) }));
    };
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.micSrc.connect(this.worklet).connect(sink).connect(this.ctx.destination);
  }

  handle(ev) {
    const t = ev.type;
    if (t === 'coach.ready') {
      this.resolved = ev.resolved || null;
      this.outRate = ev.rate || 16000;
      this.maxCall = ev.maxCall || 900;
      this.setupCapture(ev.rate || 16000);
      this.state('ringing', 'Гудки…');
      return;
    }
    if (t === 'coach.error') { this.fatal(ev.error?.message || 'Ошибка соединения'); return; }
    if (t === 'coach.timeout') { this.on.onWarn?.('Время звонка вышло.'); this.finish('timeout'); return; }
    if (t === 'coach.upstream_closed') { if (!this.ended) this.finish(this.connected ? 'dropped' : 'failed'); return; }

    if (t === 'session.created' || t === 'session.updated') {
      const outR = ev.session?.audio?.output?.format?.rate;
      const inR = ev.session?.audio?.input?.format?.rate;
      if (outR) this.outRate = outR;
      if (inR && this.worklet && inR !== this.rate) { this.rate = inR; this.worklet.port.postMessage({ type: 'rate', rate: inR }); }
      return;
    }
    if (AUDIO_DELTA.has(t)) { this.play(ev.delta, ev.item_id); return; }
    if (TR_DELTA.has(t)) { this.clientText(ev.item_id || ev.response_id, ev.delta, false); return; }
    if (TR_DONE.has(t)) { this.clientText(ev.item_id || ev.response_id, ev.transcript ?? ev.text, true); return; }

    if (t === 'input_audio_buffer.speech_started') {
      this.bargeIn();
      this.managerLine(ev.item_id, null, false);
      this.state('listening', 'Говорите — клиент слушает');
      return;
    }
    if (t === 'input_audio_buffer.speech_stopped') { this.state('thinking', 'Клиент думает…'); return; }
    if (t === 'input_audio_buffer.committed') { this.managerLine(ev.item_id, null, false); return; }
    if (t === 'conversation.item.input_audio_transcription.delta') { this.managerLine(ev.item_id, ev.delta, false, true); return; }
    if (t === 'conversation.item.input_audio_transcription.completed') { this.managerLine(ev.item_id, ev.transcript, true); return; }
    if (t === 'conversation.item.input_audio_transcription.failed') { this.managerLine(ev.item_id, '(не распознано)', true); return; }

    if (t === 'response.function_call_arguments.done') { this.toolCall(ev.name, ev.arguments, ev.call_id); return; }
    if (t === 'response.output_item.done' && ev.item?.type === 'function_call') {
      this.toolCall(ev.item.name, ev.item.arguments, ev.item.call_id);
      return;
    }
    if (t === 'response.done') {
      for (const it of ev.response?.output || []) {
        if (it.type === 'function_call') this.toolCall(it.name, it.arguments, it.call_id);
      }
      if (this.endRequested) this.finishAfterPlayback();
      return;
    }
    if (t === 'error') {
      const msg = ev.error?.message || 'Ошибка голосового сервиса';
      // Ошибки отмены и обрезки ответа при перебивании — штатные, их не показываем.
      if (/cancel|truncat|no active response/i.test(msg)) return;
      this.on.onWarn?.(msg);
    }
  }

  toolCall(name, args, callId) {
    if (name !== 'end_call' || this.endRequested) return;
    let outcome = 'без итога';
    try { outcome = JSON.parse(args || '{}').outcome || outcome; } catch {}
    this.endRequested = outcome;
    this.endCallId = callId;
  }

  // ---------- воспроизведение ----------
  play(b64, itemId) {
    if (!b64 || this.ended) return;
    if (!this.connected) {
      this.connected = true;
      this.t0 = performance.now();
      this.startBrowserStt();
      this.on.onConnected?.();
    }
    const pcm = fromBase64(b64);
    const n = pcm.length >> 1;
    if (!n) return;
    const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
    const f32 = new Float32Array(n);
    for (let i = 0; i < n; i++) f32[i] = view.getInt16(i * 2, true) / 32768;
    const buf = this.ctx.createBuffer(1, n, this.outRate);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outGain);
    const now = this.ctx.currentTime;
    if (this.playHead < now + 0.05) this.playHead = now + 0.05;
    const id = itemId || 'resp';
    if (!this.items.has(id)) this.items.set(id, { start: this.playHead, dur: 0 });
    this.items.get(id).dur += buf.duration;
    this.lastItem = id;
    src.start(this.playHead);
    this.playHead += buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
    this.state('speaking', 'Клиент говорит');
  }

  isPlaying() { return this.ctx && this.playHead > this.ctx.currentTime + 0.02; }

  bargeIn() {
    if (!this.isPlaying()) return;
    const it = this.items.get(this.lastItem);
    for (const s of this.sources) { try { s.stop(); } catch {} }
    this.sources.clear();
    if (it && this.lastItem !== 'resp' && this.ws?.readyState === 1) {
      const played = Math.max(0, Math.min(it.dur, this.ctx.currentTime - it.start));
      this.ws.send(JSON.stringify({ type: 'conversation.item.truncate', item_id: this.lastItem, content_index: 0, audio_end_ms: Math.floor(played * 1000) }));
    }
    this.playHead = this.ctx.currentTime;
  }

  finishAfterPlayback() {
    if (this.waitingEnd) return;
    this.waitingEnd = true;
    const wait = () => {
      if (this.ended) return;
      if (this.isPlaying()) { setTimeout(wait, 150); return; }
      setTimeout(() => this.finish('client'), 400);
    };
    wait();
  }

  // ---------- расшифровка ----------
  managerLine(itemId, text, final, isDelta = false) {
    const key = 'm:' + (itemId || 'x' + this.order.length);
    let line = this.lines.get(key);
    if (!line) {
      line = { key, role: 'manager', text: '', t: this.now(), final: false };
      this.lines.set(key, line);
      this.order.push(key);
    }
    if (text != null) line.text = isDelta ? line.text + text : String(text);
    if (final) line.final = true;
    this.on.onLine?.(line, this.transcript());
  }

  clientText(itemId, text, final) {
    const key = 'c:' + (itemId || 'x' + this.order.length);
    let line = this.lines.get(key);
    if (!line) {
      line = { key, role: 'client', text: '', t: this.now(), final: false };
      this.lines.set(key, line);
      this.order.push(key);
    }
    if (text != null) line.text = final ? String(text) : line.text + text;
    if (final) line.final = true;
    this.on.onLine?.(line, this.transcript());
  }

  transcript() {
    const all = this.order.map((k) => this.lines.get(k)).filter(Boolean);
    const lines = all
      .filter((l) => String(l.text || '').trim())
      .map((l) => ({ role: l.role, text: String(l.text).trim(), t: Math.round(l.t * 10) / 10 }));
    // Если сервис не расшифровал менеджера, подставляем расшифровку браузера.
    const turns = all.filter((l) => l.role === 'manager').length;
    const heard = lines.filter((l) => l.role === 'manager').length;
    if (this.sttLines.length && turns > 0 && heard < turns / 2) {
      return [...lines.filter((l) => l.role === 'client'), ...this.sttLines].sort((a, b) => a.t - b.t);
    }
    return lines;
  }

  // ---------- управление ----------
  setMuted(m) {
    this.muted = m; // пока выключено, звук микрофона просто не отправляем
    if (this.rec) { try { m ? this.rec.stop() : this.rec.start(); } catch {} }
  }

  // Запасная расшифровка речи менеджера силами браузера (Chrome, Edge, Яндекс Браузер).
  // Нужна, если голосовой сервис не прислал расшифровку реплик менеджера.
  startBrowserStt() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.lang = 'ru-RU';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal && r[0]?.transcript?.trim()) this.sttLines.push({ role: 'manager', text: r[0].transcript.trim(), t: Math.round(this.now() * 10) / 10 });
        }
      };
      rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.rec = null; };
      rec.onend = () => { if (this.rec && !this.ended && !this.muted) { try { rec.start(); } catch {} } };
      rec.start();
      this.rec = rec;
    } catch { this.rec = null; }
  }

  hangup() { this.finish('manager'); }

  fatal(message) {
    if (this.ended) return;
    this.state('error', message);
    this.on.onWarn?.(message, 'error');
    this.finish('failed', message);
  }

  finish(reason, message) {
    if (this.ended) return;
    this.ended = true;
    const result = {
      reason,
      message,
      transcript: this.transcript(),
      durationSec: Math.round(this.now()),
      outcome: this.endRequested,
      resolved: this.resolved,
      connected: this.connected,
    };
    this.cleanup();
    this.on.onEnd?.(result);
  }

  cleanup() {
    cancelAnimationFrame(this.raf);
    const rec = this.rec;
    this.rec = null;
    try { rec?.stop(); } catch {}
    try { this.worklet?.port.postMessage({ type: 'stop' }); } catch {}
    try { this.ws && this.ws.readyState <= 1 && this.ws.close(1000, 'bye'); } catch {}
    this.stream?.getTracks().forEach((tr) => tr.stop());
    for (const s of this.sources) { try { s.stop(); } catch {} }
    this.sources.clear();
    try { this.ctx && this.ctx.state !== 'closed' && this.ctx.close(); } catch {}
  }

  // Уровни громкости для анимации колец.
  loop() {
    const a = new Float32Array(512);
    const level = (an) => {
      if (!an) return 0;
      an.getFloatTimeDomainData(a);
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * a[i];
      return Math.min(1, Math.sqrt(s / a.length) * 4);
    };
    const tick = () => {
      if (this.ended) return;
      this.on.onLevels?.(level(this.outAnalyser), this.muted ? 0 : level(this.micAnalyser), this.now());
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
