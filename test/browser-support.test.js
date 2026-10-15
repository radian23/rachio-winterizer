import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControllerSettings, DEFAULT_SETTINGS, ScreenAwake } from '../browser-support.js';
function storage() {
  const data = new Map();
  return { data, getItem: id => data.get(id) ?? null, setItem: (id, value) => data.set(id, value), removeItem: id => data.delete(id) };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
test('saved settings are isolated by controller and simulation; clear affects only one', () => {
  const memory = storage(), settings = new ControllerSettings(() => memory);
  const a = { ...DEFAULT_SETTINGS, seconds: 20, selected: ['zone-a'], key: 'DO-NOT-SAVE' };
  assert(settings.save('controller-a', false, a));
  assert(settings.save('controller-b', false, { ...a, seconds: 45 }));
  assert(settings.save('controller-a', true, { ...a, seconds: 1 }));
  assert.equal(settings.read('controller-a').seconds, 20);
  assert.equal(settings.read('controller-b').seconds, 45);
  assert.equal(settings.read('controller-a', true).seconds, 1);
  assert(![...memory.data.values()].join('').includes('DO-NOT-SAVE'));
  memory.setItem('rachio-winterizer-theme', 'light');
  assert(settings.clear('controller-a', false));
  assert.equal(settings.read('controller-a').seconds, 30);
  assert.equal(settings.read('controller-b').seconds, 45);
  assert.equal(memory.getItem('rachio-winterizer-theme'), 'light');
});
test('settings preserve an empty zone selection, validate numbers, and tolerate blocked/corrupt storage', () => {
  const memory = storage(), settings = new ControllerSettings(() => memory);
  settings.save('a', false, { ...DEFAULT_SETTINGS, selected: [] });
  assert.deepEqual(settings.read('a').selected, []);
  assert.equal(settings.save('a', false, { ...DEFAULT_SETTINGS, seconds: NaN, selected: [] }), false);
  memory.setItem(settings.key('a', false), '{invalid'); assert.equal(settings.read('a').saved, false);
  memory.setItem(settings.key('a', false), JSON.stringify({ seconds: -1, selected: [123] }));
  assert.equal(settings.read('a').seconds, 30); assert.equal(settings.read('a').selected, null);
  const blocked = new ControllerSettings(() => { throw Error('blocked'); });
  assert.equal(blocked.read('a').saved, false);
  assert.equal(blocked.save('a', false, { ...DEFAULT_SETTINGS, selected: [] }), false);
  assert.equal(blocked.clear('a'), false);
});
function sentinel() {
  const token = { released: false, listener: null, addEventListener: (name, fn) => { token.listener = fn; },
    release: async () => { token.released = true; token.listener?.(); } };
  return token;
}
test('wake lock requested once during session and released at completion', async () => {
  let requests = 0; const token = sentinel(), messages = [];
  const wake = new ScreenAwake({ request: async () => { requests++; return token; }, supported: () => true, visible: () => true, status: m => messages.push(m) });
  wake.setActive(true); wake.setActive(true); await flush();
  assert.equal(requests, 1); assert.match(messages.at(-1), /is active/);
  wake.setActive(false); await flush(); assert(token.released); assert.equal(wake.token, null);
});
test('wake lock reacquires on return to visible tab and reports system release', async () => {
  let visible = true, requests = 0; const tokens = [], messages = [];
  const wake = new ScreenAwake({ request: async () => { requests++; const t = sentinel(); tokens.push(t); return t; }, supported: () => true, visible: () => visible, status: m => messages.push(m) });
  wake.setActive(true); await flush(); visible = false; wake.visibilityChanged();
  assert.match(messages.at(-1), /not visible/); await tokens[0].release();
  assert.match(messages.at(-1), /released/); visible = true; wake.visibilityChanged(); await flush();
  assert.equal(requests, 2); wake.setActive(false); await flush();
});
test('unsupported or rejected wake locks do not throw or retry in a tight loop', async () => {
  const messages = [];
  const unsupported = new ScreenAwake({ supported: () => false, status: m => messages.push(m) });
  unsupported.setActive(true); assert.match(messages.at(-1), /unavailable/);
  let calls = 0;
  const rejected = new ScreenAwake({ supported: () => true, visible: () => true, request: async () => { calls++; throw Error('denied'); }, status: m => messages.push(m) });
  rejected.setActive(true); await flush(); rejected.setActive(true); await flush();
  assert.equal(calls, 1); assert.match(messages.at(-1), /not granted/);
});
test('late wake lock is released after stop and does not leak into a new session', async () => {
  let resolve; const first = sentinel(), second = sentinel(); let calls = 0;
  const wake = new ScreenAwake({ supported: () => true, visible: () => true,
    request: () => ++calls === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(second) });
  wake.setActive(true); wake.setActive(false); wake.setActive(true); resolve(first); await flush();
  assert(first.released); assert.equal(wake.token, second); assert.equal(calls, 2);
  wake.setActive(false); await flush(); assert(second.released);
});
test('optional settings start disabled and their flags are saved independently per controller', () => {
  const memory = storage(), settings = new ControllerSettings(() => memory);
  assert.equal(settings.read('new').firstPassEnabled,false); assert.equal(settings.read('new').extraRestEnabled,false);
  assert(settings.save('a',false,{...DEFAULT_SETTINGS,firstPassEnabled:true,extraRestEnabled:true,firstSeconds:75,passRest:180,selected:[]}));
  assert.equal(settings.read('a').firstSeconds,75); assert.equal(settings.read('a').firstPassEnabled,true);
  assert.equal(settings.read('a').extraRestEnabled,true); assert.equal(settings.read('b').firstPassEnabled,false);
});
