// Текстовый звонок: тот же клиент, но реплики набираются с клавиатуры (если нет микрофона).
import { api } from './api.js';

export class TextCall {
  constructor({ scenario, level, on = {} }) {
    this.scenario = scenario;
    this.level = level;
    this.on = on; // onState, onLine, onEnd, onWarn, onTick
    this.lines = [];
    this.ended = false;
    this.busy = false;
    this.resolved = null;
  }

  now() { return (performance.now() - this.t0) / 1000; }

  async start() {
    this.t0 = performance.now();
    this.timer = setInterval(() => this.on.onTick?.(this.now()), 500);
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
