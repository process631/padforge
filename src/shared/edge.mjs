// DualSense Edge onboard-profile protocol over WebHID.
// Protocol reverse-engineered by steffalon/dualsense-edge-profile-web-application (MIT, see THIRD_PARTY_NOTICES.txt).
// Unofficial. Strategy: read-modify-write. Every byte the controller returns is kept except the fields
// PadForge edits (name, button map, stick curves, trigger ranges); both CRC layers are then recomputed.
import { crc32, le32, u32, normalizeFeature } from './dualsense.mjs';

export const EDGE_PID = 0x0df2;

/** readId: first of three feature reports used to read the slot; selector: report ID used to write it. */
export const SLOTS = Object.freeze([
  { readId: 0x73, selector: 0x60, key: 'SQUARE', name: 'Fn + Square' },
  { readId: 0x76, selector: 0x61, key: 'CROSS', name: 'Fn + Cross' },
  { readId: 0x79, selector: 0x62, key: 'CIRCLE', name: 'Fn + Circle' },
  { readId: 0x70, selector: 0x63, key: 'TRIANGLE', name: 'Fn + Triangle' },
]);

/** Stick response presets: [name, modifier byte, 6 x [initial, step]]. The 6 values are three (x, y) curve points. */
export const CURVES = Object.freeze([
  ['Default', 0x03, [[128], [128], [196], [196], [225], [225]]],
  ['Quick', 0x03, [[38], [38], [122, -3], [139, [6, 5]], [255], [255]]],
  ['Precise', 0x04, [[70, 3], [57, [-3, -4]], [134, 3], [115, [-6, -7]], [196, 2], [177, [-7, -8]]]],
  ['Steady', 0x04, [[62, -1], [62, -1], [120, -4], [129, [0, -1]], [197, [3, 2]], [179, [-5, -6]]]],
  ['Digital', 0x03, [[38], [38], [38], [75, 18], [255], [255]]],
  ['Dynamic', 0x03, [[69, [3, 2]], [57, [-3, -4]], [183, [-4, -5]], [198, 3], [255], [255]]],
]);

export const LABEL_MAX = 40;
export const OUTPUT_MAX = 0x11;
// Name = 40 UTF-16LE code units: 27 in chunk 0 (bytes 6..59), 13 in chunk 1 (bytes 2..27).
const LABEL_UNITS = [
  ...Array.from({ length: 27 }, (_, i) => [0, 6 + 2 * i]),
  ...Array.from({ length: 13 }, (_, i) => [1, 2 + 2 * i]),
];

export const identityMap = () => Array.from({ length: 16 }, (_, i) => i);
export const defaultProfile = (label = '') => ({
  label, map: identityMap(),
  sticks: [{ preset: 0, step: 0, values: curveValues(0, 0) }, { preset: 0, step: 0, values: curveValues(0, 0) }],
  triggers: [[0, 255], [0, 255]],
});

function curveAt([init, step], n) {
  let v = init;
  if (Array.isArray(step)) for (let i = 0; i < n; i++) v += step[i % step.length];
  else if (typeof step === 'number') v += n * step;
  return Math.max(0, Math.min(255, v));
}
export const curveValues = (preset, n) => CURVES[preset][2].map(c => curveAt(c, n));

/** Which slider step (0-10) produced these curve bytes, or null if they don't match a preset step. */
export function curveStep(preset, vals) {
  if (!CURVES[preset]) return null;
  for (let n = 0; n <= 10; n++) if (curveValues(preset, n).every((v, i) => v === vals[i])) return n;
  return null;
}

export const profileCrc = ([b0, b1, b2]) => crc32(b0.slice(2, 60), b1.slice(2, 60), b2.slice(2, 56));
export const storedProfileCrc = chunks => u32(chunks[2], 56);

export function decodeLabel(chunks) {
  let s = '';
  for (const [c, i] of LABEL_UNITS) {
    const unit = chunks[c][i] | (chunks[c][i + 1] << 8);
    if (!unit) break;
    s += String.fromCharCode(unit);
  }
  return s;
}

/** Strip control characters and cut to 40 UTF-16 units without splitting a surrogate pair. */
export function sanitizeLabel(s) {
  let out = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (out.length > LABEL_MAX) {
    out = out.slice(0, LABEL_MAX);
    if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);
  }
  return out;
}

/** Decode the editable fields of a slot from its three 64-byte chunks. */
export function decode(chunks) {
  const [, b1, b2] = chunks;
  const lv = Array.from(b1.slice(47, 53)), rv = [...Array.from(b1.slice(56, 60)), b2[2], b2[3]];
  return {
    label: decodeLabel(chunks),
    map: Array.from(b2.slice(10, 26)),
    sticks: [
      { preset: b2[30], step: curveStep(b2[30], lv), values: lv },
      { preset: b2[32], step: curveStep(b2[32], rv), values: rv },
    ],
    triggers: [[b2[4], b2[5]], [b2[6], b2[7]]],
    crcOk: profileCrc(chunks) === storedProfileCrc(chunks),
  };
}

/** Validate and normalise a profile (from the editor, a preset file, or a backup). Throws on bad input. */
export function validateProfile(p) {
  const fail = m => { throw new Error(m); };
  if (!p || typeof p !== 'object') fail('Not a profile');
  const label = sanitizeLabel(p.label);
  const map = Array.from(p.map ?? []);
  if (map.length !== 16 || map.some(v => !Number.isInteger(v) || v < 0 || v > OUTPUT_MAX)) fail('Invalid button map');
  if (!Array.isArray(p.sticks) || p.sticks.length !== 2) fail('Invalid stick settings');
  const sticks = p.sticks.map(s => {
    const preset = s?.preset, step = s?.step ?? null;
    if (!Number.isInteger(preset) || preset < 0 || preset > 255) fail('Invalid stick curve');
    if (step !== null) {
      if (!CURVES[preset] || !Number.isInteger(step) || step < 0 || step > 10) fail('Invalid stick sensitivity');
      const n = preset === 0 ? 0 : step;
      return { preset, step: n, values: curveValues(preset, n) };
    }
    const values = Array.from(s.values ?? []);
    if (values.length !== 6 || values.some(v => !Number.isInteger(v) || v < 0 || v > 255)) fail('Invalid custom stick curve');
    return { preset, step: null, values };
  });
  if (!Array.isArray(p.triggers) || p.triggers.length !== 2) fail('Invalid trigger settings');
  const triggers = p.triggers.map(t => {
    const [a, z] = Array.isArray(t) ? t : [];
    if (!Number.isInteger(a) || !Number.isInteger(z) || a < 0 || z > 255 || a >= z) fail('Invalid trigger range');
    return [a, z];
  });
  return { label, map, sticks, triggers };
}

/** Set chunk headers and recompute both CRC layers. */
function finalize(selector, b0, b1, b2) {
  for (const b of [b0, b1, b2]) b[0] = selector;
  b0[1] = 0; b0[2] = 1; b1[1] = 1; b2[1] = 2;
  // Whole-profile CRC: b0[2..59] + b1[2..59] + b2[2..55] -> b2[56..59]
  b2.set(le32(profileCrc([b0, b1, b2])), 56);
  // Per-chunk CRC: crc32(0xA3 + 64-byte chunk with bytes 60..63 zeroed) -> bytes 60..63
  for (const b of [b0, b1, b2]) {
    b.fill(0, 60, 64);
    b.set(le32(crc32([0xa3], b)), 60);
  }
  return [b0, b1, b2];
}

/** Build the three write buffers for a slot from its read chunks plus the edited profile. */
export function buildWrite(slot, edit) {
  const p = validateProfile(edit);
  if (!p.label) throw new Error('Give the profile a name first');
  const [b0, b1, b2] = slot.chunks.map(c => Uint8Array.from(c));
  for (const [c, i] of LABEL_UNITS) { const b = c ? b1 : b0; b[i] = 0; b[i + 1] = 0; }
  for (let k = 0; k < p.label.length; k++) {
    const unit = p.label.charCodeAt(k), [c, i] = LABEL_UNITS[k], b = c ? b1 : b0;
    b[i] = unit & 0xff;
    b[i + 1] = unit >> 8;
  }
  b2.set(p.map, 10);
  p.sticks.forEach((s, i) => {
    if (s.step === null) return;              // custom curve from the controller: keep its bytes
    b2[i ? 32 : 30] = s.preset;
    b1[i ? 53 : 44] = CURVES[s.preset][1];
    if (i === 0) b1.set(s.values, 47);
    else { b1.set(s.values.slice(0, 4), 56); b2[2] = s.values[4]; b2[3] = s.values[5]; }
  });
  [b2[4], b2[5]] = p.triggers[0];
  [b2[6], b2[7]] = p.triggers[1];
  return finalize(slot.selector, b0, b1, b2);
}

export async function readReport(dev, id) {
  return normalizeFeature(id, await dev.receiveFeatureReport(id), 64);
}

/** Read all four slots. */
export async function readProfiles(dev) {
  const out = [];
  for (const s of SLOTS) {
    const chunks = [];
    for (let k = 0; k < 3; k++) chunks.push(await readReport(dev, s.readId + k));
    const assigned = chunks[0][1] !== 16;
    out.push({ ...s, chunks, assigned, ...(assigned ? decode(chunks) : { label: '', crcOk: null }) });
  }
  return out;
}

async function sendChunks(dev, selector, bufs) {
  for (const b of bufs) await dev.sendFeatureReport(selector, b.subarray(1));   // sequential, 63-byte payloads
}

function differences(want, got) {
  const out = [];
  if (want.label !== got.label) out.push(`name reads back as "${got.label}"`);
  if (want.map.join() !== got.map.join()) out.push('button map differs');
  want.sticks.forEach((s, i) => {
    if (s.preset !== got.sticks[i].preset || s.values.join() !== got.sticks[i].values.join()) out.push(`${i ? 'right' : 'left'} stick curve differs`);
  });
  if (want.triggers.flat().join() !== got.triggers.flat().join()) out.push('trigger range differs');
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Write a profile to an assigned slot, then read it back (with retries) until it matches. */
export async function writeProfile(dev, slot, edit, { attempts = 6, delayMs = 250 } = {}) {
  if (!slot.assigned) throw new Error(`${slot.name} is empty. Create a profile there in PlayStation Accessories first`);
  const bufs = buildWrite(slot, edit);
  await sendChunks(dev, slot.selector, bufs);
  const want = decode(bufs);
  let problems = ['no reply'];
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    const now = (await readProfiles(dev)).find(s => s.selector === slot.selector);
    problems = now.assigned ? differences(want, now) : ['slot reads back as empty'];
    if (!problems.length) return now;
  }
  throw new Error(`The controller did not confirm the new profile (${problems.join('; ')})`);
}

/** Restore a slot's raw chunks from a backup. Headers and CRCs are recomputed; everything else is written as saved. */
export async function restoreSlot(dev, saved) {
  if (saved.chunks[0][1] === 16) throw new Error('Backup slot is empty');
  const slot = SLOTS.find(s => s.selector === saved.selector);
  if (!slot) throw new Error('Unknown slot in backup');
  await sendChunks(dev, slot.selector, finalize(slot.selector, ...saved.chunks.map(c => Uint8Array.from(c))));
}
