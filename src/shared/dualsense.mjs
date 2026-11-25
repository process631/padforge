// DualSense / DualSense Edge HID report codecs.
// Byte layouts follow the public Linux hid-playstation driver (used as a reference only; no code copied).

export const SONY_VID = 0x054c;
export const PID = Object.freeze({ DUALSENSE: 0x0ce6, DUALSENSE_EDGE: 0x0df2 });

// Button IDs used by Edge onboard profiles. The array index is the wire ID.
export const KEYS = Object.freeze(['UP', 'LEFT', 'DOWN', 'RIGHT', 'CIRCLE', 'CROSS', 'SQUARE', 'TRIANGLE',
  'R1', 'R2', 'R3', 'L1', 'L2', 'L3', 'PADL', 'PADR', 'OPTIONS', 'TOUCH']);
export const WIRE = Object.freeze(Object.fromEntries(KEYS.map((k, i) => [k, i])));

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Standard reflected CRC-32 over one or more byte sequences. */
export function crc32(...parts) {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const le32 = v => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
export const u32 = (a, i) => (a[i] | (a[i + 1] << 8) | (a[i + 2] << 16) | (a[i + 3] << 24)) >>> 0;

export function decodeButtons(b0, b1, b2) {
  const s = new Set();
  const hat = b0 & 0x0f;
  if (hat === 7 || hat === 0 || hat === 1) s.add('UP');
  if (hat >= 1 && hat <= 3) s.add('RIGHT');
  if (hat >= 3 && hat <= 5) s.add('DOWN');
  if (hat >= 5 && hat <= 7) s.add('LEFT');
  if (b0 & 0x10) s.add('SQUARE');
  if (b0 & 0x20) s.add('CROSS');
  if (b0 & 0x40) s.add('CIRCLE');
  if (b0 & 0x80) s.add('TRIANGLE');
  if (b1 & 0x01) s.add('L1');
  if (b1 & 0x02) s.add('R1');
  if (b1 & 0x04) s.add('L2');
  if (b1 & 0x08) s.add('R2');
  if (b1 & 0x10) s.add('CREATE');
  if (b1 & 0x20) s.add('OPTIONS');
  if (b1 & 0x40) s.add('L3');
  if (b1 & 0x80) s.add('R3');
  if (b2 & 0x01) s.add('PS');
  if (b2 & 0x02) s.add('TOUCH');
  if (b2 & 0x04) s.add('MUTE');
  if (b2 & 0x10) s.add('FNL');
  if (b2 & 0x20) s.add('FNR');
  if (b2 & 0x40) s.add('PADL');
  if (b2 & 0x80) s.add('PADR');
  return s;
}

/** Status byte: low nibble = level 0-10, high nibble = charge state. */
export function decodeBattery(status) {
  const level = status & 0x0f, st = status >> 4;
  const pct = Math.min(level * 10 + 5, 100);
  if (st === 0x0) return { percent: pct, charging: false, full: false, error: false };
  if (st === 0x1) return { percent: pct, charging: true, full: false, error: false };
  if (st === 0x2) return { percent: 100, charging: false, full: true, error: false };
  return { percent: null, charging: false, full: false, error: true };
}

/**
 * Parse an input report (WebHID data, report ID stripped).
 * USB: report 0x01, 63 bytes. Bluetooth: report 0x31 (one extra leading byte), or the short
 * "simple" report 0x01 that Bluetooth uses until enhanced reports are enabled.
 */
export function parseInput(reportId, dv) {
  const n = dv.byteLength, g = i => dv.getUint8(i);
  if (reportId === 0x01 && n >= 9 && n < 20) {
    return { transport: 'bt', simple: true, lx: g(0), ly: g(1), rx: g(2), ry: g(3), l2: g(7), r2: g(8),
      buttons: decodeButtons(g(4), g(5), g(6)), seq: null, sensorTs: null, battery: null };
  }
  let o;
  if (reportId === 0x01 && n >= 63) o = 0;
  else if (reportId === 0x31 && n >= 64) o = 1;
  else return null;
  return {
    transport: o ? 'bt' : 'usb', simple: false,
    lx: g(o), ly: g(o + 1), rx: g(o + 2), ry: g(o + 3), l2: g(o + 4), r2: g(o + 5), seq: g(o + 6),
    buttons: decodeButtons(g(o + 7), g(o + 8), g(o + 9)),
    sensorTs: dv.getUint32(o + 27, true),          // units of 1/3 microsecond
    battery: decodeBattery(g(o + 52)),
  };
}

/** Return a feature report as a byte array with the report ID at index 0 (platforms differ). */
export function normalizeFeature(id, dv, size = 64) {
  const a = Array.from(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
  if (a.length >= size && a[0] === id) return a.slice(0, size);
  if (a.length === size - 1) return [id, ...a];
  throw new Error(`Feature report 0x${id.toString(16)} returned ${a.length} bytes (expected ${size})`);
}

/** Feature report 0x20: build date/time, hardware and firmware versions. */
export function parseFirmwareInfo(a) {
  const text = (s, e) => {
    const t = String.fromCharCode(...a.slice(s, e)).replace(/\0+$/, '').trim();
    return t && /^[\x20-\x7e]+$/.test(t) ? t : null;
  };
  return { buildDate: text(1, 12), buildTime: text(12, 20), hardware: u32(a, 24), firmware: u32(a, 28), updateVersion: a[44] | (a[45] << 8) };
}
export const formatHex32 = v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
export const formatUpdateVersion = v => `${v >> 8}.${String(v & 0xff).padStart(2, '0')}`;

/**
 * Output report that sets the rumble motors. USB: report 0x02 (47 bytes).
 * Bluetooth: report 0x31 (77 bytes) with a sequence nibble and CRC-32 seeded with 0xA2.
 */
export function buildOutput(transport, seq, { left = 0, right = 0, useV2 = true } = {}) {
  const c = new Uint8Array(47);
  c[0] = 0x02 | (useV2 ? 0 : 0x01);   // HAPTICS_SELECT, plus COMPATIBLE_VIBRATION on older firmware
  c[2] = right & 0xff;
  c[3] = left & 0xff;
  if (useV2) c[38] = 0x04;            // valid_flag2: COMPATIBLE_VIBRATION2
  if (transport === 'usb') return { reportId: 0x02, data: c };
  const d = new Uint8Array(77);
  d[0] = (seq & 0x0f) << 4;
  d[1] = 0x10;
  d.set(c, 2);
  d.set(le32(crc32([0xa2, 0x31], d.subarray(0, 73))), 73);
  return { reportId: 0x31, data: d };
}
