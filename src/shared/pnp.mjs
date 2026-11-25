// Turns Windows Plug and Play entries (Get-PnpDevice) into a privacy-safe list of controllers.
// Only vendor/product IDs, model, link, status and the generic name are kept; serial numbers and
// Bluetooth addresses inside instance IDs are dropped.

const SONY = '054C';
const MODELS = { '0CE6': 'DualSense', '0DF2': 'DualSense Edge', '05C4': 'DualShock 4', '09CC': 'DualShock 4', '0BA0': 'DualShock 4 wireless adapter' };
export const SUPPORTED_PIDS = ['0CE6', '0DF2'];

export function describePnp(d) {
  const id = String(d?.InstanceId ?? '');
  const m = id.match(/VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i) || id.match(/VID&[0-9A-F]{4}([0-9A-F]{4})_PID&([0-9A-F]{4})/i);
  if (!m) return null;
  const vid = m[1].toUpperCase(), pid = m[2].toUpperCase();
  const transport = /\{00001124-0000-1000-8000-00805F9B34FB\}|^BTH/i.test(id) ? 'Bluetooth' : 'USB';
  const model = vid === SONY ? (MODELS[pid] || `Sony device (product ${pid})`) : `non-Sony controller (vendor ${vid})`;
  return { model, vid, pid, transport, status: String(d.Status || 'Unknown'), sony: vid === SONY, supported: vid === SONY && SUPPORTED_PIDS.includes(pid) };
}

/** One entry per physical controller; a problem on any of its HID entries is kept. */
export function summarizePnp(list) {
  const out = new Map();
  for (const raw of Array.isArray(list) ? list : [list]) {
    const d = describePnp(raw);
    if (!d) continue;
    const key = `${d.vid}:${d.pid}:${d.transport}`;
    const prev = out.get(key);
    if (!prev) out.set(key, d);
    else if (prev.status === 'OK' && d.status !== 'OK') out.set(key, { ...prev, status: d.status });
  }
  return [...out.values()];
}

/** Plain-language diagnosis for "PadForge can't find my controller". */
export function diagnose(devices, conflicts) {
  const supported = devices.filter(d => d.supported);
  const sonyOther = devices.filter(d => d.sony && !d.supported);
  const others = devices.filter(d => !d.sony);
  const apps = (conflicts?.apps || []).map(a => a.name);
  if (conflicts?.services?.HidHide && conflicts.services.HidHide !== 'not-installed') apps.push('HidHide');
  const bad = supported.find(d => d.status !== 'OK');
  if (bad) {
    return { kind: 'warn', cause: 'device-error', title: `Windows sees your ${bad.model}, but reports a problem with it (${bad.status})`,
      text: 'Unplug it and try a different USB port. If it keeps happening, restart the PC; Windows usually resets the driver then.' };
  }
  if (supported.length) {
    const d = supported[0];
    return { kind: 'info', cause: 'blocked', title: `Windows sees your ${d.model} (${d.transport}), so the cable and port are fine`,
      text: apps.length
        ? `Another program is most likely holding or hiding it: ${apps.join(', ')}. Close it fully (also from the system tray). PadForge keeps trying and connects by itself once the controller is free.`
        : 'Something else is holding it. Close any game or controller app, then unplug the controller and plug it back in. PadForge keeps trying and connects by itself.' };
  }
  if (sonyOther.length) {
    return { kind: 'warn', cause: 'unsupported', title: `Windows sees a ${sonyOther[0].model}`,
      text: 'PadForge works with the PS5 DualSense and DualSense Edge controllers only.' };
  }
  if (others.length) {
    return { kind: 'warn', cause: 'not-sony', title: 'Windows sees a controller, but not a Sony one',
      text: `Found: ${others.map(d => d.model).join(', ')}. PadForge only works with official Sony DualSense and DualSense Edge controllers. Third-party "PS5-style" controllers use different hardware.` };
  }
  return { kind: 'warn', cause: 'not-visible', title: "Windows can't see any controller",
    text: "That's almost always the cable or the port. Use a USB data cable (the one that came with the controller; many cables only charge), plug it straight into the PC, and try another port. On Bluetooth, connect it in Windows Settings › Bluetooth & devices first." };
}
