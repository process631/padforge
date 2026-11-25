import { $, $$, esc, icon, batteryIcon, toast, openModal, confirmDialog, alertDialog, modalOpen } from './ui.js';
import { NAME, SHORT, glyphIcon } from './glyphs.js';
import { createDiagram, LOCKED, TARGETS } from './diagram.js';
import { curveSvg } from './curve.js';
import { PollMeter, drawIntervals, histogramSvg } from './meter.js';
import { Controller } from './device.js';
import { History } from './history.js';
import { KEYS, WIRE, formatHex32, formatUpdateVersion } from '../shared/dualsense.mjs';
import * as Edge from '../shared/edge.mjs';
import { createMockHID } from './mock.js';
import { runSelfTest } from './selftest.js';

const api = window.api;
const SELFTEST = !!api.selftest;
const mock = SELFTEST ? createMockHID() : null;
const BENCH_MS = SELFTEST ? 2000 : 10000;

const log = (level, msg) => { try { api.log(level, msg); } catch { /* logging is best-effort */ } };
window.addEventListener('error', e => log('error', `renderer: ${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener('unhandledrejection', e => log('error', `renderer: ${e.reason?.stack || e.reason}`));

const store = {
  get(k, d) { try { const v = localStorage.getItem('pf:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pf:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('pf:' + k); } catch { /* storage unavailable */ } },
};

const ctl = new Controller(mock ? mock.hid : navigator.hid, log);
const meter = new PollMeter();
const history = new History();
const S = {
  work: Edge.defaultProfile(), baseline: null, slots: null, selector: null, presets: [],
  busy: false, busyLabel: null, view: 'customize', lastDirty: null,
  bench: null, benchBase: null, benchRunning: false,
};

const snap = () => JSON.stringify(S.work);
const clone = o => JSON.parse(JSON.stringify(o));
const isDirty = () => S.baseline !== null && snap() !== S.baseline;
const canOnboard = () => ctl.connected && ctl.isEdge && ctl.transport === 'usb';
const curSlot = () => S.slots?.find(s => s.selector === S.selector) || null;

function msg(text, kind = '') {
  const el = $('#edgeMsg');
  el.className = 'msg ' + kind;
  el.innerHTML = text ? `${kind === 'good' ? icon('check', 15) : kind === 'bad' ? icon('alert', 15) : ''}<span>${esc(text)}</span>` : '';
}

/* ======================= editor ======================= */
const diagram = createDiagram($('#pad'), { onPick: openPicker });

const CURVE_HELP = [
  'Linear: the game gets exactly how far you push. A good all-round choice.',
  'Reacts strongly to small movements. Fast turns and snappy aim.',
  'Slower near the center for small, careful adjustments. Good for aiming.',
  'Smooths out small movements to reduce shaky aim and accidental drift.',
  'Almost on/off: a small push counts as a big one. Like a D-pad.',
  'Slow near the center, fast near the edge: precise aim plus quick turns.',
];

function renderEditor() {
  const w = S.work;
  const name = $('#pname');
  if (document.activeElement !== name && name.value !== w.label) name.value = w.label;
  $('#nameCount').textContent = `${w.label.length}/${Edge.LABEL_MAX}`;
  w.sticks.forEach((s, i) => {
    const p = i ? 'r' : 'l', known = !!Edge.CURVES[s.preset];
    const sel = $(`#${p}Preset`);
    sel.value = known ? String(s.preset) : 'custom';
    const step = $(`#${p}Step`);
    step.disabled = !known || s.preset === 0;
    step.value = String(s.step ?? 5);
    $(`#${p}StepV`).textContent = s.preset === 0 ? 'Linear' : s.step == null ? 'Custom' : `${s.step} of 10`;
    $(`#${p}Curve`).innerHTML = curveSvg(s.values);
    $(`#${p}Desc`).textContent = known ? CURVE_HELP[s.preset] : 'A custom curve set by another app. PadForge keeps it unless you pick a preset.';
  });
  [['l2', 0], ['r2', 1]].forEach(([p, i]) => {
    const [a, z] = w.triggers[i];
    $(`#${p}Min`).value = String(a);
    $(`#${p}Max`).value = String(z);
    $(`#${p}V`).textContent = a === 0 && z === 255 ? 'Full range (default)' : `Starts at ${Math.round(a / 2.55)}% · full at ${Math.round(z / 2.55)}%`;
    Object.assign($(`#${p}Fill`).style, { left: `${a / 2.55}%`, width: `${(z - a) / 2.55}%` });
  });
  diagram.render(w.map);
  renderActions();
}

function commit() { history.push(snap()); renderEditor(); }
function applySnapshot(s) { if (s) { S.work = JSON.parse(s); renderEditor(); } }
const undo = () => applySnapshot(history.undo());
const redo = () => applySnapshot(history.redo());

function openPicker(k) {
  if (LOCKED.has(k)) { toast(`${NAME[k]} can't be remapped. The controller keeps it fixed.`); return; }
  const cur = KEYS[S.work.map[WIRE[k]]];
  const paddle = k === 'PADL' || k === 'PADR';
  const body = document.createElement('div');
  body.innerHTML = `${paddle ? `<div class="note warn">${icon('alert', 15)}<span>Back-button remapping is experimental. If the button does nothing after you write, assign it once in PlayStation Accessories, then edit it here.</span></div>` : ''}
    <div class="opts">${TARGETS.map(t => `<button class="opt${cur === t ? ' sel' : ''}" data-t="${t}">${glyphIcon(t, 24)}<span>${esc(SHORT[t])}</span></button>`).join('')}</div>`;
  const m = openModal({
    title: `${NAME[k]} acts as…`, body, className: 'picker', initialFocus: '.opt.sel, .opt',
    actions: [{ text: paddle ? 'Back button (default)' : 'Use default', value: k, role: 'default' }, { text: 'Cancel', value: null, role: 'cancel' }],
    onClose: v => { if (v) { S.work.map[WIRE[k]] = WIRE[v]; commit(); } },
  });
  body.querySelectorAll('.opt').forEach(b => { b.onclick = () => m.close(b.dataset.t); });
}

/* ======================= slots ======================= */
function setNote(kind, text) {
  const el = $('#slotNote');
  el.className = 'slot-note ' + kind;
  el.innerHTML = text ? `${icon(kind === 'ok' ? 'shield' : kind === 'warn' ? 'alert' : 'info', 15)}<span>${esc(text)}</span>` : '';
}

function renderSlots() {
  const sel = $('#slot');
  if (!S.slots) {
    const why = !ctl.connected ? 'No controller connected' : !ctl.isEdge ? 'Onboard profiles need a DualSense Edge'
      : ctl.transport !== 'usb' ? 'Connect with a USB cable to edit profiles' : 'Reading profiles…';
    sel.innerHTML = `<option>${esc(why)}</option>`;
    setNote('', '');
  } else {
    sel.innerHTML = S.slots.map(s => `<option value="${s.selector}">${esc(s.name)}  ·  ${s.assigned ? esc(s.label || 'Untitled') : 'Empty'}</option>`).join('');
    sel.value = String(S.selector);
    const s = curSlot();
    if (!s.assigned) setNote('info', 'This slot is empty. Create a profile in it once with PlayStation Accessories, then click Reload.');
    else if (s.crcOk) setNote('ok', 'Profile data verified. Safe to edit.');
    else setNote('warn', 'This profile failed PadForge’s checksum check, so its format may differ from what PadForge expects. Writing it isn’t recommended.');
  }
  renderActions();
  if (S.view === 'device') renderDevice();
}

function renderActions() {
  const s = curSlot(), dirty = isDirty();
  const w = $('#writeEdge');
  w.disabled = S.busy || !canOnboard() || !s?.assigned;
  w.innerHTML = S.busy && S.busyLabel ? `<span class="spin"></span><span>${esc(S.busyLabel)}</span>` : `${icon('upload', 17)}<span>Write to controller</span><kbd>Ctrl+S</kbd>`;
  $('#readEdge').disabled = S.busy || !canOnboard();
  $('#restoreEdge').disabled = S.busy || !canOnboard();
  $('#slot').disabled = S.busy || !S.slots;
  $('#undo').disabled = !history.canUndo;
  $('#redo').disabled = !history.canRedo;
  $('#dirty').classList.toggle('show', dirty);
  if (dirty !== S.lastDirty) { S.lastDirty = dirty; api.setDirty(dirty); }
}

function setBusy(on, label = null) { S.busy = on; S.busyLabel = on ? label : null; renderSlots(); }

const slotProfile = s => (s?.assigned
  ? { label: s.label, map: [...s.map], sticks: s.sticks.map(x => ({ preset: x.preset, step: x.step, values: [...x.values] })), triggers: s.triggers.map(t => [...t]) }
  : Edge.defaultProfile());

function loadSlot(s, { preserve = false } = {}) {
  const fresh = JSON.stringify(slotProfile(s));
  if (!preserve) { S.work = JSON.parse(fresh); history.reset(fresh); }
  S.baseline = fresh;
  renderSlots();
  renderEditor();
}

async function readEdge({ silent = false } = {}) {
  if (!canOnboard() || S.busy) return;
  const preserve = isDirty();
  setBusy(true);
  try {
    const slots = await Edge.readProfiles(ctl.dev);
    S.slots = slots;
    if (!slots.some(s => s.selector === S.selector)) S.selector = (slots.find(s => s.assigned) || slots[0]).selector;
    S.busy = false;
    loadSlot(curSlot(), { preserve });
    if (!silent) msg(preserve ? 'Profiles reloaded. Your unsaved edits were kept.' : 'Profiles loaded from the controller.');
    log('info', `Read profiles: ${slots.map(s => `${s.name}=${s.assigned ? (s.crcOk ? 'ok' : 'checksum-mismatch') : 'empty'}`).join(', ')}`);
  } catch (e) {
    S.slots = null;
    msg(`Couldn't read profiles: ${e.message}`, 'bad');
    log('error', `Read profiles failed: ${e.message}`);
  } finally { setBusy(false); }
}

$('#slot').addEventListener('change', async e => {
  const next = Number(e.target.value);
  if (next === S.selector) return;
  if (isDirty() && !(await confirmDialog({
    title: 'Discard unsaved changes?', message: `Your edits to ${curSlot()?.name ?? 'this profile'} haven't been written to the controller.`,
    confirmText: 'Discard changes', danger: true,
  }))) { e.target.value = String(S.selector); return; }
  S.selector = next;
  loadSlot(curSlot());
  msg('');
});

async function writeToController() {
  const s = curSlot();
  if (!s?.assigned || !canOnboard() || S.busy) return;
  let profile;
  try {
    profile = Edge.validateProfile(S.work);
    if (!profile.label) throw new Error('Give the profile a name first.');
  } catch (e) { msg(e.message, 'bad'); $('#pname').focus(); return; }
  if (s.crcOk === false && !(await confirmDialog({
    title: 'Unrecognized profile data', danger: true, confirmText: 'Write anyway',
    message: `The data in ${s.name} didn't pass PadForge's checksum check, so its layout may differ from what PadForge expects.`,
    detail: 'A backup is saved first either way. Only continue if you know this slot is fine.',
  }))) return;
  if (!(await confirmDialog({
    title: `Write to ${s.name}?`, confirmText: 'Write profile',
    message: `"${profile.label}" will replace the profile stored in this slot.`,
    detail: 'A backup of all four slots is saved first, so you can put the old profile back with Restore backup.',
  }))) return;
  setBusy(true, 'Writing…');
  try {
    const file = await api.saveBackup({ format: 'padforge-backup', when: Date.now(), firmware: ctl.firmware, slots: S.slots.map(({ selector, name, chunks }) => ({ selector, name, chunks })) });
    log('info', `Backup saved: ${file}`);
    await Edge.writeProfile(ctl.dev, s, profile);
    log('info', `Wrote "${profile.label}" to ${s.name}`);
    S.busy = false;
    await readEdge({ silent: true });
    msg(`Written and verified. Press Fn + ${NAME[s.key]} on the controller to use it.`, 'good');
    toast('Profile written to the controller', 'success');
  } catch (e) {
    msg(`Write failed: ${e.message}. Restore backup can put the previous profile back.`, 'bad');
    log('error', `Write failed: ${e.message}`);
    toast('Write failed', 'error');
  } finally { setBusy(false); }
}

async function restoreBackup() {
  const b = await api.openBackup();
  if (!b) return;
  const usable = (Array.isArray(b.slots) ? b.slots : []).filter(s => Edge.SLOTS.some(x => x.selector === s.selector)
    && Array.isArray(s.chunks) && s.chunks.length === 3 && s.chunks.every(c => Array.isArray(c) && c.length === 64) && s.chunks[0][1] !== 16);
  if (!usable.length) { await alertDialog({ title: 'Nothing to restore', message: 'That file doesn’t contain any PadForge profile backups.' }); return; }
  if (!(await confirmDialog({
    title: 'Restore backup?', danger: true, confirmText: 'Restore',
    message: `This rewrites ${usable.length} profile slot${usable.length > 1 ? 's' : ''} on the controller with the backup from ${new Date(b.when).toLocaleString()}.`,
    detail: 'The current profiles are backed up first.',
  }))) return;
  setBusy(true, 'Restoring…');
  try {
    if (S.slots) await api.saveBackup({ format: 'padforge-backup', when: Date.now(), firmware: ctl.firmware, slots: S.slots.map(({ selector, name, chunks }) => ({ selector, name, chunks })) });
    for (const s of usable) await Edge.restoreSlot(ctl.dev, s);
    log('info', `Restored ${usable.length} slot(s) from backup ${b.when}`);
    S.busy = false;
    await readEdge({ silent: true });
    msg('Backup restored.', 'good');
    toast('Backup restored', 'success');
  } catch (e) {
    msg(`Restore failed: ${e.message}`, 'bad');
    log('error', `Restore failed: ${e.message}`);
  } finally { setBusy(false); }
}

/* ======================= presets ======================= */
function renderPresets() {
  $('#preset').innerHTML = S.presets.length
    ? S.presets.map((p, i) => `<option value="${i}">${esc(p.label || 'Untitled')}</option>`).join('')
    : '<option value="">No saved presets yet</option>';
  ['#loadPreset', '#exportPreset', '#delPreset'].forEach(id => { $(id).disabled = !S.presets.length; });
}
async function loadPresets() {
  const list = await api.loadPresets();
  S.presets = (Array.isArray(list) ? list : []).map(p => { try { return Edge.validateProfile(p); } catch { return null; } }).filter(Boolean);
  renderPresets();
}
const selectedPreset = () => S.presets[Number($('#preset').value)];
async function savePreset() {
  let p;
  try { p = Edge.validateProfile(S.work); } catch (e) { toast(e.message, 'error'); return; }
  if (!p.label) p.label = `Preset ${S.presets.length + 1}`;
  const i = S.presets.findIndex(x => x.label === p.label);
  if (i >= 0 && !(await confirmDialog({ title: 'Replace preset?', message: `A preset named "${p.label}" already exists.`, confirmText: 'Replace' }))) return;
  if (i >= 0) S.presets[i] = p; else S.presets.push(p);
  await api.savePresets(S.presets);
  renderPresets();
  $('#preset').value = String(i >= 0 ? i : S.presets.length - 1);
  toast(`Saved preset "${p.label}"`, 'success');
}
function loadPreset() {
  const p = selectedPreset();
  if (!p) return;
  S.work = clone(p);
  commit();
  toast(`Loaded "${p.label}". Write it to the controller to use it.`);
}
async function deletePreset() {
  const p = selectedPreset();
  if (!p || !(await confirmDialog({ title: 'Delete preset?', message: `"${p.label}" will be removed from this PC.`, confirmText: 'Delete', danger: true }))) return;
  S.presets.splice(S.presets.indexOf(p), 1);
  await api.savePresets(S.presets);
  renderPresets();
}
async function exportPreset() {
  const p = selectedPreset();
  if (!p) return;
  const f = await api.exportPreset(p);
  if (f) toast('Preset exported', 'success');
}
async function importPreset() {
  const r = await api.importPreset();
  if (!r) return;
  if (r.error) { await alertDialog({ title: 'Import failed', message: r.error }); return; }
  let p;
  try { p = Edge.validateProfile(r.data?.format === 'padforge-preset' ? r.data.profile : r.data); }
  catch (e) { await alertDialog({ title: 'Not a PadForge preset', message: `This file can't be imported (${e.message}).` }); return; }
  const base = p.label || 'Imported preset';
  let name = base, n = 2;
  while (S.presets.some(x => x.label === name)) name = Edge.sanitizeLabel(`${base.slice(0, 34)} (${n++})`);
  p.label = name;
  S.presets.push(p);
  await api.savePresets(S.presets);
  renderPresets();
  $('#preset').value = String(S.presets.length - 1);
  toast(`Imported "${p.label}"`, 'success');
}

/* ======================= header, banner, device ======================= */
function renderStatus() {
  const el = $('#status');
  if (!ctl.connected) {
    el.className = 'status';
    el.innerHTML = '<i class="dot"></i><span>No controller</span>';
  } else {
    const t = ctl.transport, b = ctl.battery;
    el.className = 'status ' + (canOnboard() || (!ctl.isEdge && t) ? 'ok' : 'warn');
    el.innerHTML = `<i class="dot"></i><span>${esc(ctl.model)}</span><span class="sep"></span>`
      + (t ? `${icon(t === 'usb' ? 'usb' : 'bluetooth', 14)}<span>${t === 'usb' ? 'USB' : 'Bluetooth'}</span>` : '<span>Connecting…</span>')
      + (b?.percent != null ? `<span class="sep"></span>${batteryIcon(b)}<span>${b.percent}%</span>` : '');
  }
  $('#connect').textContent = ctl.connected ? 'Reconnect' : 'Connect';
}

function renderBanner() {
  const el = $('#banner');
  let t = null, kind = 'info';
  if (!ctl.connected) t = ['No controller connected.', 'Plug in your DualSense Edge with a USB cable. PadForge connects automatically.'];
  else if (!ctl.isEdge) t = [`${ctl.model} connected.`, 'Onboard profiles need a DualSense Edge. You can still design profiles and save them as presets.'];
  else if (ctl.transport === 'bt') { t = ['Connected over Bluetooth.', 'Plug in a USB cable to read and write onboard profiles.']; kind = 'warn'; }
  el.hidden = !t;
  if (t) {
    el.className = 'banner ' + kind;
    el.innerHTML = `${icon(kind === 'warn' ? 'bluetooth' : 'gamepad', 19)}<span><b>${esc(t[0])}</b> ${esc(t[1])}</span>${!ctl.connected ? '<button class="btn sm" data-action="connect">Connect</button>' : ''}`;
  }
}

function renderDevice() {
  const info = $('#devInfo');
  if (!ctl.connected) {
    info.innerHTML = `<div class="empty">${icon('gamepad', 30)}<p>No controller connected</p><p class="muted">Plug it in with a USB cable, or pair it over Bluetooth, then click Connect.</p></div>`;
  } else {
    const f = ctl.firmware, b = ctl.battery, t = ctl.transport;
    const rows = [
      ['Model', esc(ctl.model)],
      ['Connection', t ? `${icon(t === 'usb' ? 'usb' : 'bluetooth', 15)}${t === 'usb' ? 'USB' : 'Bluetooth'}` : 'Detecting…'],
      ['Battery', b?.percent != null ? `<span class="batt">${batteryIcon(b, 20)}${b.percent}%${b.full ? ' · Full' : b.charging ? ' · Charging' : ''}</span>` : b?.error ? 'Charging error' : '—'],
      ['Firmware', f ? `${formatHex32(f.firmware)}${f.buildDate ? ` <span class="muted">built ${esc(f.buildDate)}</span>` : ''}` : '—'],
      ['Hardware', f ? formatHex32(f.hardware) : '—'],
      ['Feature version', f ? formatUpdateVersion(f.updateVersion) : '—'],
      ['Onboard profiles', !ctl.isEdge ? 'Not available on this model' : S.slots ? `${S.slots.filter(s => s.assigned).length} of 4 slots in use` : t === 'usb' ? 'Reading…' : 'Connect with USB'],
    ];
    info.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
  $('#rumble').disabled = !ctl.connected || !ctl.transport;
}

const TESTER_KEYS = ['L2', 'L1', 'R1', 'R2', 'UP', 'LEFT', 'DOWN', 'RIGHT', 'TRIANGLE', 'CIRCLE', 'CROSS', 'SQUARE',
  'CREATE', 'OPTIONS', 'PS', 'TOUCH', 'MUTE', 'L3', 'R3', 'FNL', 'FNR', 'PADL', 'PADR'];
let testerChips = {};
function buildTester() {
  $('#tester').innerHTML = `
    <div class="chips">${TESTER_KEYS.map(k => `<div class="chip" data-k="${k}" title="${esc(NAME[k])}">${glyphIcon(k, 20)}<span>${esc(SHORT[k])}</span></div>`).join('')}</div>
    <div class="analog">
      ${['L', 'R'].map(s => `<div class="stickpad"><svg viewBox="-50 -50 100 100" aria-hidden="true"><circle class="ring" r="44"/><circle class="ring faint" r="22"/><path class="axis" d="M-44 0H44M0 -44V44"/><circle class="sdot" id="t${s}" r="6"/></svg><span>${s === 'L' ? 'Left' : 'Right'} stick <b id="t${s}v">0%</b></span></div>`).join('')}
      <div class="tbars">${['l2', 'r2'].map(t => `<div class="tbar"><span>${t.toUpperCase()}</span><div class="bar"><i id="t-${t}"></i></div><b id="t-${t}v">0%</b></div>`).join('')}</div>
    </div>`;
  testerChips = Object.fromEntries($$('#tester .chip').map(el => [el.dataset.k, el]));
}
function updateTester(p) {
  for (const k of TESTER_KEYS) testerChips[k].classList.toggle('on', p.buttons.has(k));
  const pos = v => ((v - 128) / 128) * 44;
  const mag = (x, y) => Math.min(100, Math.round(Math.hypot(x - 128, y - 128) / 1.28));
  for (const [s, x, y] of [['L', p.lx, p.ly], ['R', p.rx, p.ry]]) {
    $(`#t${s}`).setAttribute('cx', pos(x).toFixed(1));
    $(`#t${s}`).setAttribute('cy', pos(y).toFixed(1));
    $(`#t${s}v`).textContent = `${mag(x, y)}%`;
  }
  for (const [t, v] of [['l2', p.l2], ['r2', p.r2]]) {
    $(`#t-${t}`).style.width = `${(v / 2.55).toFixed(1)}%`;
    $(`#t-${t}v`).textContent = `${Math.round(v / 2.55)}%`;
  }
}

/* ======================= live input ======================= */
let latest = null, livePending = false;
ctl.onInput = (p, t) => {
  meter.push(t, p.seq, p.sensorTs);
  latest = p;
  if (!livePending) { livePending = true; requestAnimationFrame(flushLive); setTimeout(flushLive, 50); }
};
function flushLive() {
  if (!livePending) return;
  livePending = false;
  const p = latest;
  if (!p) return;
  if (S.view === 'customize') {
    diagram.setPressed(p.buttons);
    diagram.setAnalog(p);
    $('#l2Live').style.width = `${(p.l2 / 2.55).toFixed(1)}%`;
    $('#r2Live').style.width = `${(p.r2 / 2.55).toFixed(1)}%`;
  } else if (S.view === 'device') updateTester(p);
}

ctl.addEventListener('change', () => {
  renderStatus(); renderBanner();
  if (!ctl.connected) {
    meter.reset(); diagram.clearLive(); latest = null; S.ocAtTarget = null;
    $('#l2Live').style.width = '0'; $('#r2Live').style.width = '0';
    S.slots = null; renderSlots(); renderDevice();
    return;
  }
  if (canOnboard() && !S.slots && !S.busy && !ctl.connecting) readEdge({ silent: true });
  else if (!canOnboard() && S.slots) { S.slots = null; renderSlots(); }
  renderDevice();
});
ctl.addEventListener('battery', () => { renderStatus(); if (S.view === 'device') renderDevice(); });

async function connect() {
  try {
    S.slots = null;
    renderSlots();
    if (!(await ctl.connect(true))) toast('No Sony controller found. Plug it in and try again.', 'error');
  } catch (e) {
    toast(e.message, 'error', 6000);
    log('warn', `Connect failed: ${e.message}`);
  }
}

/* ======================= overclock ======================= */
// Once the controller is measured at the target rate over USB, the overclock steps are folded away.
function renderOcGuide() {
  const at = S.ocAtTarget;
  $('#ocOk').hidden = !at;
  if (at) $('#ocOkTitle').textContent = `Your controller already runs at ${at} Hz. No overclock needed.`;
  $('#ocSteps').hidden = !!at && !S.ocShowSteps;
  $('#ocSteps').classList.toggle('below', !!at);
  $('#ocShowSteps').textContent = S.ocShowSteps ? 'Hide steps' : 'Show steps anyway';
}

setInterval(() => {
  if (S.view !== 'overclock') return;
  const st = meter.stats(2000);
  const target = Number($('#target').value);
  if (st && ctl.transport === 'usb' && st.hz >= target * 0.9 && (st.ctrlHz == null || st.ctrlHz >= target * 0.9)) S.ocAtTarget = Math.round(st.hz / 50) * 50;
  renderOcGuide();
  const set = (id, v) => { $(id).textContent = v; };
  if (!st) {
    ['#hz', '#ctrlHz', '#sAvg', '#sP99', '#sMax', '#sJit', '#sStale', '#sDrops'].forEach(id => set(id, '—'));
    drawIntervals($('#chart'), [], 1000 / target);
    set('#verdict', ctl.connected ? 'Waiting for input reports…' : 'Connect a controller to measure.');
    return;
  }
  set('#hz', Math.round(st.hz));
  set('#ctrlHz', st.ctrlHz ? Math.round(st.ctrlHz) : '—');
  set('#sAvg', `${st.mean.toFixed(2)} ms`);
  set('#sP99', `${st.p99.toFixed(2)} ms`);
  set('#sMax', `${st.max.toFixed(2)} ms`);
  set('#sJit', `${st.sd.toFixed(2)} ms`);
  set('#sStale', st.stalePct == null ? '—' : `${st.stalePct.toFixed(1)}%`);
  set('#sDrops', String(st.drops));
  drawIntervals($('#chart'), meter.recentIntervals(400), 1000 / target);
  let v;
  if (ctl.transport === 'bt') v = 'Over Bluetooth the controller sets its own rate. Overclocking only applies over USB.';
  else if (st.hz >= target * 0.9) v = `✓ Running at your ${target} Hz target.`;
  else if (st.hz < 320) v = `Stock rate. Follow the steps below to overclock to ${target} Hz.`;
  else v = `Partly overclocked (${Math.round(st.hz)} Hz). Check that hidusbf is set to ${target} Hz, then replug the controller.`;
  if (st.ctrlHz && st.hz > 320 && st.ctrlHz < st.hz * 0.8) v += ` Only about ${Math.round(st.ctrlHz)} reports a second carry new data.`;
  set('#verdict', v);
}, 250);

function renderBenchButton() {
  $('#benchRun').disabled = S.benchRunning;
  $('#benchRun').innerHTML = S.benchRunning ? '<span class="spin"></span><span>Measuring…</span>' : `${icon('play', 14)}<span>Run ${BENCH_MS / 1000}-second test</span>`;
}

async function runBenchmark() {
  if (!ctl.connected) { toast('Connect a controller first.', 'error'); return; }
  if (S.benchRunning) return;
  S.benchRunning = true;
  renderBenchButton();
  const bar = $('#benchProgress'), fill = bar.firstElementChild;
  bar.hidden = false;
  fill.style.transition = 'none'; fill.style.width = '0';
  void fill.offsetWidth;
  fill.style.transition = `width ${BENCH_MS}ms linear`; fill.style.width = '100%';
  const r = await meter.record(BENCH_MS);
  S.benchRunning = false;
  bar.hidden = true;
  renderBenchButton();
  if (!r) { toast('Not enough input to measure. Is the controller still connected?', 'error'); return; }
  S.bench = { ...r, when: Date.now(), transport: ctl.transport, model: ctl.model };
  store.set('bench', S.bench);
  renderBench();
  log('info', `Benchmark: ${r.hz.toFixed(1)} Hz received, ${r.ctrlHz ? r.ctrlHz.toFixed(1) : '?'} Hz fresh, p99 ${r.p99.toFixed(2)} ms`);
}

function renderBench() {
  const r = S.bench, base = S.benchBase, out = $('#benchOut');
  if (!r) {
    out.innerHTML = `<div class="bench-empty">${icon('gauge', 26)}<p>Run a test before and after overclocking to see the difference. Keep the controller still or moving; it doesn't matter.</p></div>`;
    return;
  }
  const isBase = base && base.when === r.when;
  const cmp = base && !isBase
    ? `<span class="compare">Baseline ${Math.round(base.hz)} Hz → <b>${Math.round(r.hz)} Hz</b><span class="${r.hz >= base.hz ? 'up' : 'down'}">${r.hz >= base.hz ? '+' : ''}${Math.round((r.hz / base.hz - 1) * 100)}%</span></span>` : '';
  out.innerHTML = `
    <div class="bench-grid">
      <div class="bstat big" title="Average reports your PC received per second during the test."><span>${Math.round(r.hz)}</span><small>Hz received</small></div>
      <div class="bstat big" title="Reports per second that carried new data, by the controller's own clock."><span>${r.ctrlHz ? Math.round(r.ctrlHz) : '—'}</span><small>Hz fresh data</small></div>
      <div class="bstat" title="The typical time between reports. Half were faster, half slower."><b>${r.p50.toFixed(2)} ms</b><small>Median interval</small></div>
      <div class="bstat" title="99% of reports arrived faster than this. It shows how bad the occasional slow report is."><b>${r.p99.toFixed(2)} ms</b><small>99th percentile</small></div>
      <div class="bstat" title="How uneven the timing was. Lower means smoother input."><b>${r.sd.toFixed(2)} ms</b><small>Jitter (σ)</small></div>
      <div class="bstat" title="Share of reports that repeated old data instead of sending new data."><b>${r.stalePct == null ? '—' : `${r.stalePct.toFixed(1)}%`}</b><small>Repeated data</small></div>
    </div>
    ${histogramSvg(r.histogram)}
    <div class="bench-foot">${cmp}<span class="muted">${esc(r.model)} · ${r.transport === 'usb' ? 'USB' : 'Bluetooth'} · ${esc(new Date(r.when).toLocaleString())}</span>
      <button class="btn sm ghost" id="benchBase" ${isBase ? 'disabled' : ''}>${isBase ? `${icon('check', 14)}<span>Baseline</span>` : 'Set as baseline'}</button></div>`;
  $('#benchBase').onclick = () => {
    S.benchBase = S.bench;
    store.set('benchBase', S.benchBase);
    renderBench();
    toast('Saved as baseline. Run another test after overclocking to compare.', 'success');
  };
}

let toolPath = store.get('ocTool', null);
function renderTool() { $('#toolPath').textContent = toolPath || ''; $('#launchTool').disabled = !toolPath; }
async function refreshOc() {
  const s = await api.ocStatus();
  const el = $('#ocState');
  el.className = 'pill ' + (s === 'running' ? 'ok' : s === 'installed' ? 'warn' : '');
  el.innerHTML = s === 'running' ? `${icon('check', 13)}<span>Driver running</span>` : s === 'installed' ? 'Driver installed, not running' : 'Driver not installed';
}

/* ======================= fresh start ======================= */
async function scanConflicts() {
  const list = $('#conflictList');
  list.innerHTML = '<li class="info">Checking your PC…</li>';
  let r = null;
  try { r = await api.conflicts(); } catch (e) { log('warn', `Conflict scan failed: ${e.message}`); }
  if (!r) { list.innerHTML = `<li class="warn">${icon('alert', 16)}<div><b>Couldn't check this PC</b>Try Check again.</div></li>`; return; }
  S.conflicts = r;
  const items = [];
  const svc = r.services;
  if (svc.hidusbf !== 'not-installed') {
    items.push({ kind: 'warn', title: `USB overclock driver (hidusbf) is ${svc.hidusbf === 'running' ? 'active' : 'installed'}`,
      text: 'An overclock from PadForge or another tool is set up on this PC. To go back to the stock rate, remove it with its own uninstaller.',
      button: '<button class="btn sm" data-fresh="driver">How to remove</button>' });
  } else items.push({ kind: 'ok', title: 'No USB overclock driver installed', text: 'Your controller runs at its stock polling rate.' });
  for (const a of r.apps) {
    items.push({ kind: 'warn', title: `${a.name} is running`,
      text: 'It can take over the controller or change its settings while it runs. Close it fully (also from the system tray) before using PadForge.' });
  }
  if (!r.apps.length) items.push({ kind: 'ok', title: 'No other controller apps running', text: 'Nothing else is competing for your controller.' });
  if (svc.HidHide !== 'not-installed') {
    items.push({ kind: 'warn', title: 'HidHide is installed',
      text: "It can hide your controller from other apps, including PadForge. If PadForge can't find your controller, turn hiding off in HidHide or allow PadForge there." });
  }
  if (svc.ViGEmBus !== 'not-installed') {
    items.push({ kind: 'info', title: 'ViGEmBus is installed', text: 'A virtual-controller driver used by DS4Windows and DSX. Harmless while those apps are closed.' });
  }
  items.sort((a, b) => (a.kind === 'warn' ? 0 : 1) - (b.kind === 'warn' ? 0 : 1));
  list.innerHTML = items.map(i => `<li class="${i.kind}">${icon(i.kind === 'ok' ? 'check' : i.kind === 'warn' ? 'alert' : 'info', 16)}<div><b>${esc(i.title)}</b>${esc(i.text)}</div>${i.button || ''}</li>`).join('');
}

function showDriverRemoval() {
  const body = document.createElement('div');
  body.innerHTML = `<p>PadForge doesn't remove drivers itself, because doing it wrong can stop USB devices from working. hidusbf's own tool removes it safely:</p>
    <ol class="steps">
      <li><div>Open the hidusbf tool (<b>Setup.exe</b>) and approve the admin prompt.</div><button class="btn sm" data-x="open">${toolPath ? 'Open tool' : 'Locate Setup.exe'}</button></li>
      <li><div>Select your controller, untick <i>Filter on device</i> (or set the rate back to default).</div></li>
      <li><div>Click <i>Uninstall service</i>, then <i>Restart</i>, so no other device stays overclocked.</div></li>
      <li><div>Replug the controller and click <b>Check again</b>. The polling rate should read about 250 Hz.</div></li>
    </ol>
    <p class="muted">Don't have the tool anymore? <a class="link" data-x="download">Download hidusbf</a> again and use its uninstaller.</p>`;
  body.addEventListener('click', async e => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'download') api.openLink('hidusbf');
    if (x === 'open') {
      if (!toolPath) { const p = await api.pickOcTool(); if (!p) return; toolPath = p; store.set('ocTool', p); renderTool(); e.target.closest('button').textContent = 'Open tool'; }
      const r = await api.launchOcTool(toolPath);
      if (r) toast(r, 'error');
    }
  });
  openModal({ title: 'Remove the overclock driver', body, actions: [{ text: 'Done', value: true, role: 'confirm', kind: 'primary' }], onClose: () => scanConflicts() });
}

function resetEverything() {
  const profilesOk = canOnboard() && S.slots?.some(s => s.assigned && s.crcOk);
  const body = document.createElement('div');
  body.innerHTML = `<p>Choose what to reset. This can't be undone, except controller profiles, which are backed up first.</p>
    <div class="opt-list">
      <label class="opt-check"><input type="checkbox" id="rsSettings" checked><span><b>PadForge settings</b><small>Benchmark results and baseline, the overclock tool location and target rate.</small></span></label>
      <label class="opt-check"><input type="checkbox" id="rsPresets"><span><b>Presets saved on this PC</b><small>Deletes every saved preset. Preset files you exported are not touched.</small></span></label>
      <label class="opt-check${profilesOk ? '' : ' disabled'}"><input type="checkbox" id="rsProfiles" ${profilesOk ? '' : 'disabled'}><span><b>Controller profiles back to default</b><small>${profilesOk
        ? 'Every used slot gets default buttons, linear sticks and the full trigger range. Names are kept. All four slots are backed up first.'
        : 'Connect a DualSense Edge with a USB cable to include this.'}</small></span></label>
    </div>
    <p class="muted">To remove an overclock driver, use <b>How to remove</b> in the Fresh start list.</p>`;
  openModal({
    title: 'Reset everything?', body, className: 'narrow', initialFocus: '[data-dialog=cancel]',
    actions: [{ text: 'Cancel', value: false, role: 'cancel' }, { text: 'Reset', value: true, role: 'confirm', kind: 'danger' }],
    onClose: ok => { if (ok) doReset({ settings: $('#rsSettings', body).checked, presets: $('#rsPresets', body).checked, profiles: $('#rsProfiles', body).checked }); },
  });
}

async function doReset({ settings, presets, profiles }) {
  const done = [];
  if (settings) {
    ['bench', 'benchBase', 'ocTool', 'target'].forEach(k => store.del(k));
    S.bench = null; S.benchBase = null; toolPath = null;
    $('#target').value = '1000';
    meter.reset();
    renderBench(); renderTool();
    done.push('PadForge settings');
  }
  if (presets) {
    S.presets = [];
    await api.savePresets([]);
    renderPresets();
    done.push('saved presets');
  }
  if (profiles && canOnboard() && S.slots) {
    const targets = S.slots.filter(s => s.assigned && s.crcOk);
    setBusy(true, 'Resetting profiles…');
    try {
      await api.saveBackup({ format: 'padforge-backup', when: Date.now(), firmware: ctl.firmware, slots: S.slots.map(({ selector, name, chunks }) => ({ selector, name, chunks })) });
      for (const s of targets) await Edge.writeProfile(ctl.dev, s, Edge.defaultProfile(s.label || s.name));
      S.busy = false;
      await readEdge({ silent: true });
      done.push(`${targets.length} controller profile${targets.length === 1 ? '' : 's'}`);
      const skipped = S.slots.filter(s => s.assigned && !s.crcOk).length;
      if (skipped) toast(`${skipped} profile${skipped > 1 ? 's' : ''} with unrecognized data ${skipped > 1 ? 'were' : 'was'} left untouched.`);
    } catch (e) {
      toast(`Resetting controller profiles failed: ${e.message}. Restore backup can undo it.`, 'error', 7000);
      log('error', `Profile reset failed: ${e.message}`);
    } finally { setBusy(false); }
  }
  if (done.length) { toast(`Reset ${done.join(', ')}.`, 'success'); log('info', `Fresh start: reset ${done.join(', ')}`); }
}

/* ======================= about & diagnostics ======================= */
async function renderAbout() {
  const i = await api.info();
  $('#about').innerHTML = `
    <div class="about"><img src="assets/icon.png" alt="" width="54" height="54">
      <div><div class="about-title">PadForge <span class="muted">${esc(i.version)}</span></div>
      <div class="muted">Electron ${esc(i.electron)} · Chromium ${esc(i.chrome)} · ${esc(i.os)}</div></div></div>
    <ul class="credits">
      <li>Profiles are stored on the controller itself, so they work on PS5, PC and anywhere else, even when PadForge is closed.</li>
      <li>DualSense Edge profile format reverse-engineered by <a class="link" data-link="protocol">steffalon/dualsense-edge-profile-web-application</a> (MIT license).</li>
      <li>USB overclocking uses <a class="link" data-link="hidusbf">hidusbf</a> by SweetLow, which you download separately.</li>
      <li>PadForge is an independent tool, not affiliated with or endorsed by Sony Interactive Entertainment. DualSense and PlayStation are trademarks of Sony Interactive Entertainment Inc.</li>
    </ul>
    <div class="btn-row"><button class="btn sm" id="diag">${icon('file', 15)}<span>Export diagnostics…</span></button>
      <button class="btn sm ghost" id="dataFolder">${icon('folder', 15)}<span>Open data folder</span></button></div>
    <p class="hint">If something doesn't work with your controller, the diagnostics file contains the raw profile data and recent log. It's useful for troubleshooting and contains no personal information.</p>`;
  $('#diag').onclick = exportDiagnostics;
  $('#dataFolder').onclick = () => api.openDataFolder();
}

async function exportDiagnostics() {
  const payload = {
    format: 'padforge-diagnostics', generated: new Date().toISOString(), app: await api.info(),
    device: ctl.connected ? { model: ctl.model, productId: ctl.dev.productId, productName: ctl.dev.productName, transport: ctl.transport, firmware: ctl.firmware, battery: ctl.battery } : null,
    slots: S.slots?.map(s => ({ name: s.name, selector: s.selector, readId: s.readId, assigned: s.assigned, crcOk: s.crcOk, label: s.label, map: s.map, sticks: s.sticks, triggers: s.triggers, chunks: s.chunks })) ?? null,
    polling: meter.stats(2000), benchmark: S.bench,
  };
  const f = await api.saveDiagnostics(payload);
  if (f) toast('Diagnostics saved', 'success');
}

/* ======================= navigation & shortcuts ======================= */
function showView(v) {
  S.view = v;
  $$('.tabs [role=tab]').forEach(b => {
    const on = b.dataset.view === v;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${v}`));
  if (v === 'overclock') { refreshOc(); scanConflicts(); }
  if (v === 'device') renderDevice();
}

document.addEventListener('keydown', e => {
  if (modalOpen()) return;
  if (e.target.closest?.('.tabs') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const tabs = $$('.tabs [role=tab]'), i = tabs.findIndex(t => t.classList.contains('active'));
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    showView(next.dataset.view); next.focus();
    return;
  }
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase(), typing = e.target.matches?.('input[type=text], textarea');
  if (k === 'z' && !e.shiftKey && !typing) { e.preventDefault(); undo(); }
  else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !typing) { e.preventDefault(); redo(); }
  else if (k === 's') { e.preventDefault(); if (!$('#writeEdge').disabled) writeToController(); }
  else if (k === '1' || k === '2' || k === '3') { e.preventDefault(); showView(['customize', 'overclock', 'device'][Number(k) - 1]); }
});

/* ======================= wiring ======================= */
$$('.tabs [role=tab]').forEach(b => { b.onclick = () => showView(b.dataset.view); });
$$('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, 15)));
$('#undo').innerHTML = icon('undo', 18);
$('#redo').innerHTML = icon('redo', 18);
$('#resetAll').innerHTML = icon('reset', 18);
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#resetAll').onclick = () => { S.work = Edge.defaultProfile(S.work.label); commit(); toast('Everything reset to default. Use Undo to go back.'); };
$('#connect').onclick = connect;
$('#banner').addEventListener('click', e => { if (e.target.closest('[data-action=connect]')) connect(); });
$('#about').addEventListener('click', e => { const a = e.target.closest('[data-link]'); if (a) { e.preventDefault(); api.openLink(a.dataset.link); } });
$('#writeEdge').onclick = writeToController;
$('#readEdge').onclick = async () => {
  if (isDirty() && !(await confirmDialog({ title: 'Reload from the controller?', message: 'Your edits are kept, and the slot list is refreshed from the controller.', confirmText: 'Reload' }))) return;
  readEdge();
};
$('#restoreEdge').onclick = restoreBackup;
$('#backupFolder').onclick = () => api.openBackupFolder();
$('#savePreset').onclick = savePreset;
$('#loadPreset').onclick = loadPreset;
$('#delPreset').onclick = deletePreset;
$('#exportPreset').onclick = exportPreset;
$('#importPreset').onclick = importPreset;
$('#rumble').onclick = async () => {
  try { await ctl.rumble(); } catch (e) { toast(`Vibration test failed: ${e.message}`, 'error'); log('warn', `Rumble failed: ${e.message}`); }
};
$('#benchRun').onclick = runBenchmark;
$('#scanConflicts').onclick = scanConflicts;
$('#resetAllData').onclick = resetEverything;
$('#conflictList').addEventListener('click', e => { if (e.target.closest('[data-fresh=driver]')) showDriverRemoval(); });
$('#getTool').onclick = () => api.openLink('hidusbf');
$('#pickTool').onclick = async () => { const p = await api.pickOcTool(); if (p) { toolPath = p; store.set('ocTool', p); renderTool(); } };
$('#launchTool').onclick = async () => { const r = await api.launchOcTool(toolPath); if (r) toast(r, 'error'); };
$('#target').onchange = e => { store.set('target', Number(e.target.value)); S.ocAtTarget = null; renderOcGuide(); };
$('#ocShowSteps').onclick = () => { S.ocShowSteps = !S.ocShowSteps; renderOcGuide(); };

$('#pname').addEventListener('input', e => {
  S.work.label = e.target.value;
  $('#nameCount').textContent = `${e.target.value.length}/${Edge.LABEL_MAX}`;
  renderActions();
});
$('#pname').addEventListener('change', () => { S.work.label = Edge.sanitizeLabel(S.work.label); commit(); });
[0, 1].forEach(i => {
  const p = i ? 'r' : 'l';
  $(`#${p}Preset`).innerHTML = Edge.CURVES.map(([n], k) => `<option value="${k}">${n}</option>`).join('') + '<option value="custom" disabled hidden>Custom</option>';
  $(`#${p}Preset`).addEventListener('change', e => {
    const preset = Number(e.target.value), step = preset === 0 ? 0 : 5;
    S.work.sticks[i] = { preset, step, values: Edge.curveValues(preset, step) };
    commit();
  });
  $(`#${p}Step`).addEventListener('input', e => {
    const s = S.work.sticks[i];
    if (!Edge.CURVES[s.preset] || s.preset === 0) return;
    const step = Number(e.target.value);
    S.work.sticks[i] = { preset: s.preset, step, values: Edge.curveValues(s.preset, step) };
    renderEditor();
  });
  $(`#${p}Step`).addEventListener('change', commit);
});
[['l2', 0], ['r2', 1]].forEach(([p, i]) => {
  $(`#${p}Min`).addEventListener('input', e => { const t = S.work.triggers[i]; t[0] = Math.min(Number(e.target.value), t[1] - 1); renderEditor(); });
  $(`#${p}Max`).addEventListener('input', e => { const t = S.work.triggers[i]; t[1] = Math.max(Number(e.target.value), t[0] + 1); renderEditor(); });
  $(`#${p}Min`).addEventListener('change', commit);
  $(`#${p}Max`).addEventListener('change', commit);
});

/* ======================= start ======================= */
(async function init() {
  $('#ver').textContent = `v${api.version}`;
  buildTester();
  S.bench = store.get('bench', null);
  S.benchBase = store.get('benchBase', null);
  $('#target').value = String(store.get('target', 1000));
  S.baseline = snap();
  history.reset(S.baseline);
  await loadPresets();
  renderEditor(); renderSlots(); renderStatus(); renderBanner(); renderDevice();
  renderBench(); renderBenchButton(); renderTool(); renderAbout(); refreshOc();
  try { await ctl.connect(false); } catch (e) { msg(e.message, 'bad'); }
  if (SELFTEST) runSelfTest({ S, ctl, meter, mock, api, Edge, showView });
})();
