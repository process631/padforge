// Connection to a Sony controller over WebHID: transport detection, battery, firmware info, rumble.
import { SONY_VID, PID, parseInput, buildOutput, parseFirmwareInfo, normalizeFeature } from '../shared/dualsense.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Controller extends EventTarget {
  constructor(hid, log = () => {}) {
    super();
    this.hid = hid;
    this.log = log;
    this.dev = null;
    this.transport = null;      // 'usb' | 'bt' | null (unknown until the first report)
    this.firmware = null;
    this.battery = null;
    this.state = null;
    this.outSeq = 0;
    this.onInput = null;        // fast path: (parsedReport, timestamp) => void
    hid.addEventListener('disconnect', e => { if (e.device === this.dev) this.lost(); });
    hid.addEventListener('connect', () => { if (!this.dev) setTimeout(() => this.connect(false).catch(() => {}), 300); });
  }

  get connected() { return !!this.dev; }
  get isEdge() { return this.dev?.productId === PID.DUALSENSE_EDGE; }
  get model() {
    if (!this.dev) return '';
    if (this.isEdge) return 'DualSense Edge';
    if (this.dev.productId === PID.DUALSENSE) return 'DualSense';
    return this.dev.productName || 'Sony controller';
  }

  async connect(interactive = true) {
    if (this.connecting) return !!this.dev;
    this.connecting = true;
    try { return await this.doConnect(interactive); } finally { this.connecting = false; this.emit(); }
  }

  async doConnect(interactive) {
    let devs = (await this.hid.getDevices()).filter(d => d.vendorId === SONY_VID);
    if (!devs.length && interactive) devs = await this.hid.requestDevice({ filters: [{ vendorId: SONY_VID }] });
    const dev = devs.find(d => d.productId === PID.DUALSENSE_EDGE) || devs.find(d => d.productId === PID.DUALSENSE) || devs[0];
    if (!dev) return false;
    if (this.dev && this.dev !== dev) this.dev.oninputreport = null;
    try {
      if (!dev.opened) await dev.open();
    } catch (e) {
      throw new Error('Windows would not let PadForge open the controller. Close Steam, DSX or DS4Windows (or turn off HidHide) and try again.');
    }
    this.dev = dev;
    this.transport = null; this.firmware = null; this.battery = null; this.state = null;
    dev.oninputreport = e => this.report(e);
    this.emit();
    for (let i = 0; i < 6 && !this.transport; i++) await sleep(50);
    if (!this.transport) { await this.enhance(); await sleep(250); }
    await this.readFirmware();
    this.log('info', `Connected ${this.model} over ${this.transport || 'unknown link'}${this.firmware ? `, firmware ${this.firmware.firmware.toString(16)}` : ''}`);
    return true;
  }

  report(e) {
    const p = parseInput(e.reportId, e.data);
    if (!p) return;
    if (this.transport !== p.transport) { this.transport = p.transport; this.emit(); }
    if (p.simple && !this.enhancing) this.enhance();
    const b = p.battery;
    if (b && (!this.battery || b.percent !== this.battery.percent || b.charging !== this.battery.charging || b.full !== this.battery.full)) {
      this.battery = b;
      this.emit('battery');
    }
    this.state = p;
    this.onInput?.(p, e.timeStamp);
  }

  /** Bluetooth starts in a reduced "simple" mode; reading calibration (feature 0x05) enables full reports. */
  async enhance() {
    if (!this.dev) return;
    this.enhancing = true;
    try { await this.dev.receiveFeatureReport(0x05); } catch { /* not supported: stay in simple mode */ }
    setTimeout(() => { this.enhancing = false; }, 2000);
  }

  async readFirmware() {
    try { this.firmware = parseFirmwareInfo(normalizeFeature(0x20, await this.dev.receiveFeatureReport(0x20), 64)); }
    catch { this.firmware = null; }
  }

  async rumble(ms = 350, strength = 170) {
    if (!this.dev || !this.transport) throw new Error('No controller connected');
    const useV2 = this.isEdge || (this.firmware?.updateVersion ?? 0) >= 0x0215;
    const send = async v => {
      const { reportId, data } = buildOutput(this.transport, this.outSeq++, { left: v, right: v, useV2 });
      await this.dev.sendReport(reportId, data);
    };
    await send(strength);
    await sleep(ms);
    await send(0);
  }

  lost() {
    const was = this.model;
    if (this.dev) this.dev.oninputreport = null;
    this.dev = null; this.transport = null; this.state = null; this.battery = null; this.firmware = null;
    this.emit();
    this.log('info', `Disconnected ${was}`);
  }

  emit(type = 'change') { this.dispatchEvent(new Event(type)); }
}
