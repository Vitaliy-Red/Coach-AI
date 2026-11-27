// Текстовый звонок: тот же клиент, но реплики набираются с клавиатуры (если нет микрофона).
import { api } from './api.js';

export class TextCall {
  constructor({ scenario, level, sid, on = {}, previous = null }) {
    this.scenario = scenario;
    this.level = level;
    this.sid = sid;
    this.on = on; // onState, onLine, onEnd, onWarn, onTick
    this.lines = previous?.transcript.map((l, i) => ({ ...l, key: l.role[0] + i, final: true })) || [];
    this.ended = false;
    this.busy = false;
    this.resolved = previous ? { id: previous.realScenario, level, gender: previous.gender } : null;
    this.elapsed = previous?.durationSec || 0;
  }

  now() { return (performance.now() - this.t0) / 1000; }

  async start() {
    this.t0 = performance.now() - this.elapsed * 1000;
    this.timer = setInterval(() => this.on.onTick?.(this.now()), 500);
    if (this.lines.at(-1)?.role === 'client') { this.on.onState?.('listening', 'Ваша реплика'); return; }
    await this.ask();
  }

  async send(text) {
    text = String(text || '').trim();
    if (!text || this.busy || this.ended) return;
    this.push('manager', text);
    await this.ask();
  }

  push(role, text) {
    const line = { key: role[0] + this.lines.length, role, text, t: Math.round(this.now() * 10) / 10, final: true };
    this.lines.push(line);
    this.on.onLine?.(line, this.transcript());
  }

  async ask() {
    this.busy = true;
    this.on.onState?.('thinking', 'Клиент печатает…');
    try {
      const r = await api.chat({
        scenario: this.resolved?.id || this.scenario,
        level: this.resolved?.level || this.level,
        gender: this.resolved?.gender,
        sid: this.sid,
        durationSec: Math.round(this.now()),
        messages: this.lines.map((l) => ({ role: l.role, text: l.text })),
      });
      if (!this.resolved && r.resolved) this.resolved = r.resolved;
      if (this.ended) return;
      this.push('client', r.reply);
      this.on.onState?.('listening', 'Ваша реплика');
      if (r.ended) setTimeout(() => this.finish('client'), 900);
    } catch (e) {
      this.on.onWarn?.(e.message, 'error');
      this.on.onState?.('error', e.message);
      if (!this.lines.length) this.finish('failed', e.message);
    } finally {
      this.busy = false;
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
