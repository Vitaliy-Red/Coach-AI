// Захват микрофона: перевод в 16-битный PCM нужной частоты, порции по 100 мс.
// Работает в AudioWorklet (отдельный аудиопоток браузера).

class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.alive = true;
    this.configure((options.processorOptions || {}).targetRate || 16000);
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'rate') this.configure(m.rate);
      if (m.type === 'stop') this.alive = false;
    };
  }

  configure(rate) {
    this.target = rate;
    this.step = sampleRate / rate; // сколько входных отсчётов на один выходной
    this.t = 0; // позиция следующего выходного отсчёта относительно начала блока
    this.prev = 0;
    // Сглаживание перед прореживанием: скользящее среднее (ширина ~ step), чтобы не было звона.
    this.win = Math.max(1, Math.round(this.step));
    this.ring = new Float32Array(this.win);
    this.ri = 0;
    this.sum = 0;
    this.out = new Int16Array(Math.round(rate / 10));
    this.n = 0;
  }

  smooth(x) {
    this.sum += x - this.ring[this.ri];
    this.ring[this.ri] = x;
    this.ri = (this.ri + 1) % this.win;
    return this.sum / this.win;
  }

  push(v) {
    const s = Math.max(-1, Math.min(1, v));
    this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    if (this.n === this.out.length) {
      this.port.postMessage(this.out.buffer, [this.out.buffer]);
      this.out = new Int16Array(Math.round(this.target / 10));
      this.n = 0;
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !ch.length) return this.alive;
    const len = ch.length;
    const y = new Float32Array(len);
    for (let i = 0; i < len; i++) y[i] = this.smooth(ch[i]);
    // Линейная интерполяция между отсчётами; индекс -1 — последний отсчёт прошлого блока.
    let t = this.t;
    while (t < len - 1) {
      const i = Math.floor(t);
      const f = t - i;
      const a = i < 0 ? this.prev : y[i];
      const b = y[i + 1];
      this.push(a + (b - a) * f);
      t += this.step;
    }
    this.t = t - len;
    this.prev = y[len - 1];
    return this.alive;
  }
}

registerProcessor('pcm-capture', PcmCapture);
