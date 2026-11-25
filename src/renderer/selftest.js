// End-to-end UI test against the simulated Edge (PADFORGE_SELFTEST=1). Drives the real UI through the DOM.
import { WIRE } from '../shared/dualsense.mjs';

export async function runSelfTest({ S, ctl, meter, mock, api, Edge, showView }) {
  const checks = [];
  const check = (name, pass, info) => checks.push({ name, pass: !!pass, ...(info === undefined ? {} : { info: String(info) }) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 5000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { try { if (fn()) return true; } catch { /* keep polling */ } await wait(40); }
    return false;
  };
  const $ = s => document.querySelector(s);
  const dialog = role => document.querySelector(`.modal-backdrop [data-dialog="${role}"]`);
  const answer = async role => { await until(() => dialog(role)); dialog(role).click(); await until(() => !$('.modal-backdrop')); };
  const set = (sel, v, events = ['input', 'change']) => { const el = $(sel); el.value = String(v); events.forEach(t => el.dispatchEvent(new Event(t, { bubbles: true }))); };
  const shot = async name => { await wait(300); await api.selftestCapture(name); };
  const slotData = readId => Edge.decode([0, 1, 2].map(k => mock.reports[readId + k]));
  const clickBubble = k => $(`.bubble[data-k="${k}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const pick = async (key, target, capture) => {
    clickBubble(key);
    await until(() => $(`.picker .opt[data-t="${target}"]`));
    if (capture) await shot(capture);
    $(`.picker .opt[data-t="${target}"]`).click();
    await until(() => !$('.modal-backdrop'));
  };

  try {
    await until(() => S.slots && !S.busy, 8000);
    check('connects to the Edge over USB', ctl.connected && ctl.isEdge && ctl.transport === 'usb', `${ctl.model} ${ctl.transport}`);
    await until(() => ctl.battery);
    check('reads battery level', ctl.battery?.percent === 55 && ctl.battery.charging, JSON.stringify(ctl.battery));
    check('reads firmware info', ctl.firmware?.firmware === 0x0110002a && ctl.firmware.buildDate === 'Jun 15 2024', JSON.stringify(ctl.firmware));
    check('hides the connection banner once connected', getComputedStyle($('#banner')).display === 'none');
    check('reads all four profile slots', S.slots?.length === 4 && S.slots.filter(s => s.assigned).length === 2);
    check('verifies profile checksums', S.slots.filter(s => s.assigned).every(s => s.crcOk === true));
    check('loads the first used slot', S.work.label === 'Mock', S.work.label);
    const fps = [...$('#slot').options].find(o => o.textContent.includes('FPS'));
    check('escapes HTML in profile names', fps && fps.textContent.includes('<i>FPS</i>'), fps?.textContent);

    await wait(1500);
    const st = meter.stats(2000);
    check('measures ~250 Hz polling', st && st.hz > 150 && st.hz < 400, st?.hz?.toFixed(1));
    check('measures the controller clock', st && Math.abs(st.ctrlHz - 250) < 3, st?.ctrlHz?.toFixed(2));
    check('counts no missed reports', st && st.drops === 0, st?.drops);

    // Edit through the UI
    await pick('CROSS', 'TRIANGLE', 'picker');
    await pick('TRIANGLE', 'CROSS');
    await pick('PADL', 'SQUARE');
    check('marks remapped buttons', $('.bubble[data-k="CROSS"]').classList.contains('remapped'));
    check('shows the unsaved badge', $('#dirty').classList.contains('show'));
    $('#undo').click();
    check('undo reverts the last change', S.work.map[WIRE.PADL] === WIRE.PADL);
    $('#redo').click();
    check('redo reapplies it', S.work.map[WIRE.PADL] === WIRE.SQUARE);
    clickBubble('PS');
    await wait(200);
    check('fixed buttons cannot be remapped', !$('.modal-backdrop') && /PS button/.test($('#toasts').textContent));

    set('#pname', 'Café ☆ Pro');
    set('#lPreset', 2, ['change']);
    set('#lStep', 7);
    set('#rPreset', 1, ['change']);
    set('#rStep', 3);
    set('#l2Min', 20); set('#l2Max', 230); set('#r2Max', 200);
    check('draws stick response curves', $('#lCurve .cline') && $('#rCurve .cline'));
    await shot('customize');

    // Write, confirm, verify
    $('#writeEdge').click();
    await answer('confirm');
    await until(() => /verified|failed/i.test($('#edgeMsg').textContent), 8000);
    check('write is verified by read-back', /verified/i.test($('#edgeMsg').textContent), $('#edgeMsg').textContent);
    const d = slotData(0x73);
    check('controller has the remapped buttons', d.map[WIRE.CROSS] === WIRE.TRIANGLE && d.map[WIRE.TRIANGLE] === WIRE.CROSS && d.map[WIRE.PADL] === WIRE.SQUARE, d.map.join(','));
    check('controller has the Unicode name', d.label === 'Café ☆ Pro', d.label);
    check('controller has the stick curves', d.sticks[0].preset === 2 && d.sticks[0].step === 7 && d.sticks[1].preset === 1 && d.sticks[1].step === 3, JSON.stringify(d.sticks.map(s => [s.preset, s.step])));
    check('controller has the trigger ranges', d.triggers.flat().join() === '20,230,0,200', d.triggers.flat().join());
    check('profile checksum is valid after the write', d.crcOk);
    check('unknown bytes survive the write', mock.reports[0x75][28] === 0xc0);
    check('other slots are untouched', slotData(0x70).label === '<i>FPS</i>');
    check('unsaved badge clears after the write', !$('#dirty').classList.contains('show'));

    // Unsaved-changes guard
    set('#pname', 'Unsaved edit');
    set('#slot', 0x63, ['change']);
    await answer('cancel');
    check('asks before discarding edits', S.selector === 0x60 && S.work.label === 'Unsaved edit', `${S.selector} ${S.work.label}`);
    set('#slot', 0x63, ['change']);
    await answer('confirm');
    check('discarding loads the other slot', S.selector === 0x63 && S.work.label === '<i>FPS</i>', S.work.label);

    // Empty slot
    set('#slot', 0x61, ['change']);
    await wait(100);
    check('empty slots cannot be written', $('#writeEdge').disabled && /empty/i.test($('#slotNote').textContent));

    // Corrupted data is flagged and needs explicit confirmation
    mock.corruptCrc(0x70);
    $('#readEdge').click();
    await until(() => !S.busy && S.slots?.find(s => s.selector === 0x63)?.crcOk === false);
    set('#slot', 0x63, ['change']);
    await wait(100);
    check('flags unrecognized profile data', /checksum/i.test($('#slotNote').textContent), $('#slotNote').textContent);
    const writes = mock.device.featureWrites;
    $('#writeEdge').click();
    await until(() => dialog('cancel'));
    check('warns before writing unrecognized data', /Unrecognized/i.test($('.modal-backdrop h2')?.textContent));
    await answer('cancel');
    check('cancel leaves the controller untouched', mock.device.featureWrites === writes);

    // Presets
    set('#slot', 0x60, ['change']);
    await wait(100);
    $('#savePreset').click();
    await until(() => S.presets.length === 1);
    check('saves a preset', S.presets[0]?.label === 'Café ☆ Pro', S.presets[0]?.label);

    // Device tab
    showView('device');
    await wait(300);
    $('#rumble').click();
    await until(() => mock.outputs.length >= 2, 3000);
    const [on, off] = mock.outputs;
    check('vibration test sends rumble, then stop', on?.id === 0x02 && on.data.length === 47 && on.data[2] === 170 && on.data[3] === 170 && off?.data[2] === 0, JSON.stringify(on?.data.slice(0, 4)));
    check('input tester lights up', document.querySelectorAll('#tester .chip').length === 23);
    await shot('device');

    // Overclock tab
    showView('overclock');
    $('#benchRun').click();
    await until(() => $('#benchOut .hist'), 8000);
    check('benchmark measures ~250 Hz', S.bench && S.bench.hz > 150 && S.bench.hz < 400, S.bench?.hz?.toFixed(1));
    check('benchmark sees fresh data at 250 Hz', S.bench && Math.abs(S.bench.ctrlHz - 250) < 3, S.bench?.ctrlHz?.toFixed(2));
    await shot('overclock');

    // Disconnect
    showView('customize');
    mock.disconnect();
    await wait(400);
    check('handles a disconnect', !ctl.connected && $('#writeEdge').disabled && /No controller/.test($('#status').textContent));
    check('shows the connection banner when disconnected', getComputedStyle($('#banner')).display !== 'none');
    check('keeps unsaved edits across a disconnect', S.work.label === 'Café ☆ Pro');
    await shot('disconnected');
  } catch (e) {
    check('no exceptions', false, e.stack);
  }
  api.selftestDone({ ok: checks.every(c => c.pass), checks });
}
