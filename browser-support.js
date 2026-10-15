export const DEFAULT_SETTINGS = Object.freeze({ seconds: 30, rest: 360, rounds: 5, passRest: 180 });
const limits = { seconds: [1, 10800], rest: [0, 86400], rounds: [1, 100], passRest: [0, 86400] };

export class ControllerSettings {
  constructor(storage = () => globalThis.localStorage) { this.storage = storage; }
  key(id, demo) { return `rachio-winterizer-settings-v1:${demo ? 'demo' : 'controller'}:${encodeURIComponent(id)}`; }
  read(id, demo = false) {
    try {
      const raw = this.storage()?.getItem(this.key(id, demo));
      if (!raw) return { ...DEFAULT_SETTINGS, selected: null, saved: false };
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') throw Error('Invalid settings');
      const result = { ...DEFAULT_SETTINGS, selected: null, saved: true };
      for (const [name, [min, max]] of Object.entries(limits))
        if (Number.isInteger(data[name]) && data[name] >= min && data[name] <= max) result[name] = data[name];
      if (Array.isArray(data.selected) && data.selected.every(id => typeof id === 'string')) result.selected = data.selected;
      return result;
    } catch { return { ...DEFAULT_SETTINGS, selected: null, saved: false }; }
  }
  save(id, demo, values) {
    // Explicit allowlist: never serialize the API client, key, or controller object.
    const data = {};
    for (const [name, [min, max]] of Object.entries(limits)) {
      if (!Number.isInteger(values[name]) || values[name] < min || values[name] > max) return false;
      data[name] = values[name];
    }
    data.selected = [...values.selected];
    try { const storage = this.storage(); if (!storage) return false; storage.setItem(this.key(id, demo), JSON.stringify(data)); return true; }
    catch { return false; }
  }
  clear(id, demo) {
    try { const storage = this.storage(); if (!storage) return false; storage.removeItem(this.key(id, demo)); return true; }
    catch { return false; }
  }
}

export class ScreenAwake {
  constructor({ request = () => globalThis.navigator?.wakeLock?.request('screen'),
    supported = () => Boolean(globalThis.navigator?.wakeLock), visible = () => globalThis.document.visibilityState === 'visible',
    status = () => {} } = {}) {
    Object.assign(this, { request, supported, visible, status });
    this.wanted = false; this.token = null; this.pending = false; this.epoch = 0;
  }
  setActive(active) {
    if (this.wanted === active) return;
    this.wanted = active; this.epoch++;
    if (active) void this.acquire();
    else {
      const old = this.token; this.token = null;
      if (old) void old.release().catch(() => {});
      this.status('Screen sleep protection is requested automatically during a session.');
    }
  }
  visibilityChanged() {
    if (!this.wanted) return;
    if (this.visible()) void this.acquire();
    else this.status('This page is not visible. Screen sleep protection may be lost; return to this page to keep the sequence running reliably.');
  }
  async acquire() {
    if (!this.wanted || this.pending || (this.token && !this.token.released)) return;
    if (!this.supported()) { this.status('Screen sleep protection is unavailable. Keep your device awake manually.'); return; }
    if (!this.visible()) { this.status('Return to this page to request screen sleep protection.'); return; }
    const epoch = this.epoch;
    this.pending = true;
    this.status('Requesting screen sleep protection…');
    try {
      const token = await this.request();
      if (!this.wanted || epoch !== this.epoch) { await token.release(); return; }
      this.token = token;
      token.addEventListener('release', () => {
        if (this.token !== token) return;
        this.token = null;
        if (this.wanted) this.status('Screen sleep protection was released. Keep your device awake; return to this page to request it again.');
      });
      this.status(token.released ? 'Screen sleep protection was released. Keep your device awake manually.' : 'Screen sleep protection is active. Keep this page open and remain with your equipment.');
    } catch {
      if (this.wanted && epoch === this.epoch) this.status('Screen sleep protection was not granted. Keep your device awake manually.');
    } finally {
      this.pending = false;
      // A new session can start while an earlier lock request is still settling.
      if (this.wanted && epoch !== this.epoch) void this.acquire();
    }
  }
}
