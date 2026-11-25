// Self-test only: a simulated DualSense Edge on USB that behaves like the real one over WebHID.
// Profiles: feature reports 0x70-0x7B (read) and 0x60-0x63 (write, CRC-checked). Firmware: 0x20.
// Input: report 0x01 at ~250 Hz with sequence numbers, sensor timestamps and battery status.
import { SLOTS, buildWrite, identityMap, curveValues } from '../shared/edge.mjs';
import { crc32, le32 } from '../shared/dualsense.mjs';

export function createMockHID() {
  const reports = {};
  const outputs = [];
  const listeners = { connect: [], disconnect: [] };

  const profile = label => ({ label, map: identityMap(), sticks: [{ preset: 0, step: 0, values: curveValues(0, 0) }, { preset: 0, step: 0, values: curveValues(0, 0) }], triggers: [[0, 255], [0, 255]] });
  const initial = { 0x73: profile('Mock'), 0x70: profile('<i>FPS</i>'), 0x76: null, 0x79: null };
  for (const s of SLOTS) {
    const blank = [0, 1, 2].map(k => { const a = new Array(64).fill(0); a[0] = s.readId + k; return a; });
    if (!initial[s.readId]) { blank[0][1] = 16; blank.forEach(a => { reports[a[0]] = a; }); continue; }
    blank[2][28] = 0xc0;   // an unknown byte the real controller may hold; must survive writes
    buildWrite({ selector: s.selector, chunks: blank }, initial[s.readId]).forEach((b, k) => {
      const a = Array.from(b); a[0] = s.readId + k; reports[a[0]] = a;
    });
  }
  const fw = new Array(64).fill(0);
  fw[0] = 0x20;
  [...'Jun 15 2024'].forEach((c, i) => { fw[1 + i] = c.charCodeAt(0); });
  [...'10:15:30'].forEach((c, i) => { fw[12 + i] = c.charCodeAt(0); });
  le32(0x00000616).forEach((v, i) => { fw[24 + i] = v; });
  le32(0x0110002a).forEach((v, i) => { fw[28 + i] = v; });
  fw[44] = 0x19; fw[45] = 0x02;
  reports[0x20] = fw;

  let timer = null, seq = 0, sensor = 0, n = 0, perTick = 1;
  const dev = {
    vendorId: 0x054c, productId: 0x0df2, productName: 'DualSense Edge Wireless Controller',
    opened: false, oninputreport: null, featureWrites: 0,
    async open() {
      this.opened = true;
      clearInterval(timer);
      const emit = timeStamp => {
        n++;
        const d = new Uint8Array(63);
        d[0] = 128 + Math.round(70 * Math.sin(n / 40)); d[1] = 128 + Math.round(70 * Math.cos(n / 40));
        d[2] = 128 + Math.round(50 * Math.cos(n / 55)); d[3] = 128;
        d[4] = (n * 2) & 0xff; d[5] = 0; d[6] = seq = (seq + 1) & 0xff;
        d[7] = 0x08 | ((n % 300) < 30 ? 0x20 : 0);           // hat released; Cross pressed now and then
        d[9] = (n % 500) < 25 ? 0x40 : 0;                     // left back button now and then
        sensor = (sensor + 12000 / perTick) >>> 0;            // report interval in 1/3 microsecond units
        new DataView(d.buffer).setUint32(27, sensor, true);
        d[52] = 0x15;                                         // charging, level 5 (55 %)
        this.oninputreport?.({ reportId: 0x01, data: new DataView(d.buffer), timeStamp });
      };
      // Timers tick every 4 ms at best, so faster rates emit several evenly spaced reports per tick.
      timer = setInterval(() => {
        const now = performance.now();
        for (let j = perTick - 1; j >= 0; j--) emit(now - j * (4 / perTick));
      }, 4);
    },
    async close() { this.opened = false; clearInterval(timer); },
    async receiveFeatureReport(id) {
      if (id === 0x05) return new DataView(new Uint8Array(41).buffer);
      if (!reports[id]) throw new DOMException('Failed to receive the feature report.', 'NotAllowedError');
      return new DataView(Uint8Array.from(reports[id]).buffer);
    },
    async sendFeatureReport(sel, payload) {
      const slot = SLOTS.find(s => s.selector === sel);
      if (!slot || payload.length !== 63) throw new DOMException('Failed to write the feature report.', 'NotAllowedError');
      const full = [sel, ...payload];
      const want = crc32([0xa3], [...full.slice(0, 60), 0, 0, 0, 0]);
      const got = (full[60] | (full[61] << 8) | (full[62] << 16) | (full[63] << 24)) >>> 0;
      if (got !== want) throw new DOMException('Device rejected the report (bad CRC).', 'NetworkError');
      const k = full[1];                                       // chunk index: 0, 1, 2
      full[0] = slot.readId + k;
      reports[full[0]] = full;
      this.featureWrites++;
    },
    async sendReport(id, data) { outputs.push({ id, data: Array.from(data) }); },
  };

  const hid = {
    async getDevices() { return dev.opened !== null ? [dev] : []; },
    async requestDevice() { return [dev]; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };

  return {
    hid, device: dev, reports, outputs,
    corruptCrc(readId) { reports[readId + 2][56] ^= 0xff; },
    setRate(hz) { perTick = Math.max(1, Math.round(hz / 250)); },
    disconnect() { dev.close(); dev.opened = null; listeners.disconnect.forEach(f => f({ device: dev })); },
  };
}
