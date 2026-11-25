// Polling-rate measurement. Two clocks: when the PC received each report, and the controller's own
// sensor timestamp (1/3 microsecond units), which shows how often the controller actually produced fresh data.

export class PollMeter {
  constructor(capacity = 8192) {
    this.cap = capacity;
    this.t = new Float64Array(capacity);
    this.ctrl = new Float64Array(capacity);   // controller interval in microseconds; 0 = repeated data; NaN = unknown
    this.gap = new Uint16Array(capacity);     // reports missing before this one (sequence number gap)
    this.count = 0;
    this.prevSensor = null;
    this.prevSeq = null;
    this.recorder = null;
  }

  reset() { this.count = 0; this.prevSensor = null; this.prevSeq = null; }

  push(t, seq, sensorTs) {
    let ctrl = NaN, gap = 0;
    if (sensorTs != null) {
      if (this.prevSensor != null) ctrl = ((sensorTs - this.prevSensor) >>> 0) / 3;
      this.prevSensor = sensorTs;
    }
    if (seq != null) {
      if (this.prevSeq != null) { const d = (seq - this.prevSeq) & 0xff; gap = d === 0 ? 0 : d - 1; }
      this.prevSeq = seq;
    }
    const i = this.count % this.cap;
    this.t[i] = t; this.ctrl[i] = ctrl; this.gap[i] = gap;
    this.count++;
    if (this.recorder) { this.recorder.t.push(t); this.recorder.ctrl.push(ctrl); this.recorder.gap.push(gap); }
  }

  /** Samples from the last windowMs milliseconds, oldest first. */
  window(windowMs) {
    const n = Math.min(this.count, this.cap), end = this.count;
    const latest = n ? this.t[(end - 1) % this.cap] : 0;
    const out = { t: [], ctrl: [], gap: [] };
    for (let k = n; k >= 1; k--) {
      const i = (end - k) % this.cap;
      if (latest - this.t[i] <= windowMs) { out.t.push(this.t[i]); out.ctrl.push(this.ctrl[i]); out.gap.push(this.gap[i]); }
    }
    return out;
  }

  stats(windowMs = 2000) {
    const w = this.window(windowMs);
    if (w.t.length && performance.now() - w.t[w.t.length - 1] > 1000) return null;   // stale: no reports lately
    return analyze(w);
  }

  record(ms) {
    this.recorder = { t: [], ctrl: [], gap: [] };
    return new Promise(resolve => setTimeout(() => {
      const r = this.recorder; this.recorder = null;
      const a = analyze(r);
      resolve(a && { ...a, durationMs: ms, histogram: histogram(r.t) });
    }, ms));
  }

  recentIntervals(n = 400) {
    const w = this.window(4000);
    const iv = [];
    for (let i = Math.max(1, w.t.length - n); i < w.t.length; i++) iv.push(w.t[i] - w.t[i - 1]);
    return iv;
  }
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;

export function analyze({ t, ctrl, gap }) {
  const n = t.length;
  if (n < 20) return null;
  const span = t[n - 1] - t[0];
  if (span <= 0) return null;
  const iv = [];
  for (let i = 1; i < n; i++) iv.push(t[i] - t[i - 1]);
  const mean = span / (n - 1);
  const sd = Math.sqrt(iv.reduce((a, v) => a + (v - mean) ** 2, 0) / iv.length);
  const sorted = [...iv].sort((a, b) => a - b);
  let fresh = 0, stale = 0, known = 0, ctrlSum = 0, drops = 0;
  for (let i = 1; i < n; i++) {
    const c = ctrl[i];
    if (!Number.isNaN(c)) { known++; if (c === 0) stale++; else { fresh++; ctrlSum += c; } }
    drops += gap[i];
  }
  return {
    count: n, hz: (n - 1) * 1000 / span, mean, sd,
    min: sorted[0], max: sorted[sorted.length - 1],
    p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), p99: pct(sorted, 0.99),
    ctrlHz: fresh && ctrlSum ? fresh / (ctrlSum / 1e6) : null,
    stalePct: known ? (stale / known) * 100 : null,
    drops,
  };
}

/** Histogram of PC receive intervals: 0.25 ms bins up to 6 ms, plus one overflow bin. */
export function histogram(t) {
  const bins = new Array(25).fill(0);
  for (let i = 1; i < t.length; i++) bins[Math.min(24, Math.floor((t[i] - t[i - 1]) / 0.25))]++;
  return bins;
}

export function histogramSvg(bins, { w = 1000, h = 150 } = {}) {
  const max = Math.max(1, ...bins), bw = (w - 20) / bins.length;
  const bars = bins.map((v, i) => {
    const bh = (v / max) * (h - 30);
    return `<rect class="hbar" x="${(10 + i * bw + 1).toFixed(1)}" y="${(h - 20 - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"><title>${i === 24 ? '6 ms or more' : `${(i * 0.25).toFixed(2)}–${((i + 1) * 0.25).toFixed(2)} ms`}: ${v}</title></rect>`;
  }).join('');
  const ticks = [0, 1, 2, 3, 4, 5, 6].map(ms => `<text class="htick" x="${(10 + ms * 4 * bw).toFixed(1)}" y="${h - 5}" text-anchor="${ms === 0 ? 'start' : 'middle'}">${ms}${ms === 6 ? '+' : ''} ms</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="hist" role="img" aria-label="Interval histogram">${bars}${ticks}</svg>`;
}

export function drawIntervals(canvas, iv, targetMs) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (iv.length < 2) return;
  const max = Math.min(16, Math.max(5, targetMs * 1.5, ...iv));
  const y = v => H - 12 - (Math.min(v, max) / max) * (H - 24);
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(52, 211, 153, .55)';
  ctx.beginPath(); ctx.moveTo(0, y(targetMs)); ctx.lineTo(W, y(targetMs)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(52, 211, 153, .8)';
  ctx.font = '22px Segoe UI, sans-serif';
  ctx.fillText(`target ${targetMs.toFixed(targetMs < 1 ? 3 : targetMs < 1.5 ? 1 : 0).replace(/0+$/, '').replace(/\.$/, '')} ms`, 12, y(targetMs) - 10);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#6aa1ff'); grad.addColorStop(1, '#2f6ff0');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  iv.forEach((v, i) => { const x = (i / (iv.length - 1)) * W; if (i) ctx.lineTo(x, y(v)); else ctx.moveTo(x, y(v)); });
  ctx.stroke();
}
