import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as DS from '../src/shared/dualsense.mjs';
import * as Edge from '../src/shared/edge.mjs';

const blankChunks = readId => [0, 1, 2].map(k => { const a = new Array(64).fill(0); a[0] = readId + k; return a; });
const asRead = (slot, bufs) => bufs.map((b, k) => { const a = Array.from(b); a[0] = slot.readId + k; return a; });
const SLOT = Edge.SLOTS[0];
const sample = () => ({
  label: 'Ranked FPS',
  map: Edge.identityMap(),
  sticks: [{ preset: 2, step: 7 }, { preset: 1, step: 3 }],
  triggers: [[20, 230], [0, 200]],
});

test('crc32 matches the standard check value', () => {
  assert.equal(DS.crc32([...Buffer.from('123456789')]), 0xcbf43926);
  assert.equal(DS.crc32([0x31, 0x32], [0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]), 0xcbf43926);
});

test('wire IDs match the onboard profile format', () => {
  assert.equal(DS.WIRE.UP, 0x00);
  assert.equal(DS.WIRE.TRIANGLE, 0x07);
  assert.equal(DS.WIRE.L3, 0x0d);
  assert.equal(DS.WIRE.PADR, 0x0f);
  assert.equal(DS.WIRE.OPTIONS, 0x10);
  assert.equal(DS.WIRE.TOUCH, 0x11);
});

test('default curve is the identity line', () => {
  assert.deepEqual(Edge.curveValues(0, 0), [128, 128, 196, 196, 225, 225]);
  for (let p = 0; p < Edge.CURVES.length; p++) for (let n = 0; n <= 10; n++) {
    const v = Edge.curveValues(p, n);
    assert.equal(v.length, 6);
    assert.ok(v.every(x => x >= 0 && x <= 255));
    assert.equal(Edge.curveStep(p, v) !== null, true);
  }
});

test('buildWrite -> decode round trip', () => {
  const slot = { ...SLOT, chunks: blankChunks(SLOT.readId) };
  const p = sample();
  p.map[DS.WIRE.CROSS] = DS.WIRE.TRIANGLE;
  p.map[DS.WIRE.TRIANGLE] = DS.WIRE.CROSS;
  p.map[DS.WIRE.PADL] = DS.WIRE.SQUARE;
  const bufs = Edge.buildWrite(slot, p);
  assert.equal(bufs.length, 3);
  for (const b of bufs) { assert.equal(b.length, 64); assert.equal(b[0], SLOT.selector); }
  const d = Edge.decode(asRead(slot, bufs));
  assert.equal(d.label, 'Ranked FPS');
  assert.equal(d.map[DS.WIRE.CROSS], DS.WIRE.TRIANGLE);
  assert.equal(d.map[DS.WIRE.PADL], DS.WIRE.SQUARE);
  assert.deepEqual(d.sticks.map(s => [s.preset, s.step]), [[2, 7], [1, 3]]);
  assert.deepEqual(d.triggers, [[20, 230], [0, 200]]);
  assert.equal(d.crcOk, true);
});

test('per-chunk CRC is crc32(0xA3 + chunk with the CRC bytes zeroed)', () => {
  const bufs = Edge.buildWrite({ ...SLOT, chunks: blankChunks(SLOT.readId) }, sample());
  for (const b of bufs) {
    const copy = Uint8Array.from(b); copy.fill(0, 60, 64);
    assert.equal(DS.u32(b, 60), DS.crc32([0xa3], copy));
  }
});

test('read-modify-write keeps unknown bytes', () => {
  const chunks = blankChunks(SLOT.readId);
  chunks[2][28] = 0xc0; chunks[2][34] = 0x1c; chunks[0][3] = 0x42;
  const bufs = Edge.buildWrite({ ...SLOT, chunks }, sample());
  assert.equal(bufs[2][28], 0xc0);
  assert.equal(bufs[2][34], 0x1c);
  assert.equal(bufs[0][3], 0x42);
});

test('names are UTF-16LE, up to 40 units, across two chunks', () => {
  const slot = { ...SLOT, chunks: blankChunks(SLOT.readId) };
  const long = 'Café ☆ ' + 'x'.repeat(60);
  const bufs = Edge.buildWrite(slot, { ...sample(), label: long });
  const d = Edge.decode(asRead(slot, bufs));
  assert.equal(d.label.length, 40);
  assert.ok(d.label.startsWith('Café ☆ '));
  assert.equal(bufs[0][6], 'C'.charCodeAt(0));
  assert.equal(bufs[0][7], 0);
  const star = 'Café ☆'.indexOf('☆');
  assert.equal(bufs[0][6 + 2 * star] | (bufs[0][7 + 2 * star] << 8), 0x2606);
});

test('sanitizeLabel strips control characters and never splits surrogate pairs', () => {
  assert.equal(Edge.sanitizeLabel('  a\u0007b\n '), 'ab');
  const s = 'x'.repeat(39) + '😀';
  assert.equal(Edge.sanitizeLabel(s), 'x'.repeat(39));
});

test('custom stick curves from the controller are preserved when untouched', () => {
  const chunks = blankChunks(SLOT.readId);
  chunks[2][30] = 2; chunks[1][44] = 4;
  [11, 22, 33, 44, 55, 66].forEach((v, i) => { chunks[1][47 + i] = v; });
  const d0 = Edge.decode(chunks);
  assert.equal(d0.sticks[0].step, null);
  const bufs = Edge.buildWrite({ ...SLOT, chunks }, { ...sample(), sticks: [d0.sticks[0], { preset: 0, step: 0 }] });
  assert.deepEqual(Array.from(bufs[1].slice(47, 53)), [11, 22, 33, 44, 55, 66]);
});

test('validation rejects bad input', () => {
  const slot = { ...SLOT, chunks: blankChunks(SLOT.readId) };
  assert.throws(() => Edge.buildWrite(slot, { ...sample(), label: '   ' }), /name/);
  assert.throws(() => Edge.buildWrite(slot, { ...sample(), map: [1, 2, 3] }), /button map/);
  assert.throws(() => Edge.buildWrite(slot, { ...sample(), map: Array(16).fill(0x12) }), /button map/);
  assert.throws(() => Edge.buildWrite(slot, { ...sample(), triggers: [[200, 100], [0, 255]] }), /trigger/);
  assert.throws(() => Edge.buildWrite(slot, { ...sample(), sticks: [{ preset: 9, step: 1 }, { preset: 0, step: 0 }] }), /sensitivity/);
});

test('whole-profile CRC detects corrupted data', () => {
  const slot = { ...SLOT, chunks: blankChunks(SLOT.readId) };
  const chunks = asRead(slot, Edge.buildWrite(slot, sample()));
  assert.equal(Edge.decode(chunks).crcOk, true);
  chunks[2][12] ^= 1;
  assert.equal(Edge.decode(chunks).crcOk, false);
});

test('parseInput: USB report', () => {
  const d = new Uint8Array(63);
  d[0] = 10; d[1] = 20; d[4] = 99; d[6] = 7;
  d[7] = 0x08 | 0x20;           // hat released, Cross
  d[8] = 0x01 | 0x20;           // L1, Options
  d[9] = 0x40 | 0x10;           // left back button, left Fn
  new DataView(d.buffer).setUint32(27, 123456, true);
  d[52] = 0x18;                 // charging, level 8
  const p = DS.parseInput(0x01, new DataView(d.buffer));
  assert.equal(p.transport, 'usb');
  assert.deepEqual([...p.buttons].sort(), ['CROSS', 'FNL', 'L1', 'OPTIONS', 'PADL']);
  assert.equal(p.lx, 10); assert.equal(p.l2, 99); assert.equal(p.seq, 7);
  assert.equal(p.sensorTs, 123456);
  assert.deepEqual(p.battery, { percent: 85, charging: true, full: false, error: false });
});

test('parseInput: Bluetooth enhanced and simple reports', () => {
  const d = new Uint8Array(77);
  d[1 + 7] = 0x00;              // hat up
  d[1 + 52] = 0x23;
  const p = DS.parseInput(0x31, new DataView(d.buffer));
  assert.equal(p.transport, 'bt');
  assert.ok(p.buttons.has('UP'));
  assert.equal(p.battery.full, true);
  const s = DS.parseInput(0x01, new DataView(new Uint8Array([1, 2, 3, 4, 0x48, 0, 0, 5, 6]).buffer));
  assert.equal(s.simple, true);
  assert.ok(s.buttons.has('CIRCLE'));
  assert.equal(s.r2, 6);
});

test('buildOutput: USB rumble and Bluetooth CRC', () => {
  const u = DS.buildOutput('usb', 0, { left: 100, right: 200 });
  assert.equal(u.reportId, 0x02);
  assert.equal(u.data.length, 47);
  assert.equal(u.data[2], 200); assert.equal(u.data[3], 100);
  const b = DS.buildOutput('bt', 3, { left: 1, right: 2 });
  assert.equal(b.reportId, 0x31);
  assert.equal(b.data.length, 77);
  assert.equal(b.data[0], 0x30);
  assert.equal(DS.u32(b.data, 73), DS.crc32([0xa2, 0x31], b.data.subarray(0, 73)));
});

test('normalizeFeature handles reports with and without the ID byte', () => {
  const withId = new Uint8Array(64); withId[0] = 0x20; withId[5] = 9;
  assert.equal(DS.normalizeFeature(0x20, new DataView(withId.buffer))[5], 9);
  const noId = new Uint8Array(63); noId[4] = 9;
  const a = DS.normalizeFeature(0x20, new DataView(noId.buffer));
  assert.equal(a[0], 0x20); assert.equal(a[5], 9);
  assert.throws(() => DS.normalizeFeature(0x20, new DataView(new Uint8Array(10).buffer)));
});

test('parseFirmwareInfo reads versions and build date', () => {
  const a = new Array(64).fill(0);
  a[0] = 0x20;
  [...'Jun 15 2024'].forEach((c, i) => { a[1 + i] = c.charCodeAt(0); });
  DS.le32(0x0110002a).forEach((v, i) => { a[28 + i] = v; });
  a[44] = 0x19; a[45] = 0x02;
  const f = DS.parseFirmwareInfo(a);
  assert.equal(f.buildDate, 'Jun 15 2024');
  assert.equal(DS.formatHex32(f.firmware), '0x0110002A');
  assert.equal(DS.formatUpdateVersion(f.updateVersion), '2.25');
});
