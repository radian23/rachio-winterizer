import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM smoke test for UI event wiring; not a browser rendering test.
class Element {
  constructor() { this.children = []; this.handlers = {}; this.value = ''; this.disabled = false; this.hidden = false; this.textContent = ''; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  append(...children) { this.children.push(...children); if (!this.value && this.children[0]?.value) this.value = this.children[0].value; }
  replaceChildren(...children) { this.children = []; this.value = ''; this.append(...children); }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('input')]);
    return all.filter(child => child.type === 'checkbox' && (!selector.includes(':checked') || child.checked));
  }
}
test('simulation connects, renders zones, runs selected settings, and stops through UI', async () => {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get('seconds').value = '1'; get('rest').value = '0'; get('rounds').value = '1'; get('passRest').value = '0';
  const listeners = {};
  globalThis.document = { getElementById: get, createElement: () => new Element() };
  globalThis.window = { addEventListener: (name, fn) => { listeners[name] = fn; } };
  const savedFetch = globalThis.fetch;
  const savedStorage = globalThis.localStorage;
  const stored = new Map();
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  globalThis.fetch = () => { throw Error('Simulation must never call the network'); };
  try {
    await import('../app.js');
    get('demo').handlers.click();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(get('zones').querySelectorAll('input').length, 8);
    assert.match(get('connection').textContent, /Simulation/);
    assert.equal(get('start').disabled, false);
    // A newly loaded controller starts from defaults, not the previous controller.
    get('seconds').value = '1'; get('rest').value = '0'; get('rounds').value = '1'; get('passRest').value = '0';
    const boxes = get('zones').querySelectorAll('input'); boxes.slice(1).forEach(box => { box.checked = false; });
    boxes[0].handlers.change();
    assert.match(get('estimate').textContent, /1 runs/);
    const run = get('start').handlers.click();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(get('start').disabled, true); assert.match(get('badge').textContent, /SIMULATION/);
    assert.match(get('timeRemaining').textContent, /Total remaining/);
    get('pause').handlers.click();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(get('pause').textContent, 'Resume session');
    assert.match(get('badge').textContent, /PAUSED/);
    assert.match(get('finish').textContent, /Finish ≈ .*if resumed now/);
    get('pause').handlers.click();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(get('pause').textContent, 'Pause session');

    let prevented = false; listeners.beforeunload({ preventDefault() { prevented = true; } }); assert(prevented);
    await get('stop').handlers.click(); await run;
    assert.equal(get('start').disabled, false); assert.match(get('status').textContent, /Stopped/);
    const complete = get('start').handlers.click(); await complete;
    assert.match(get('status').textContent, /Finished 1 timed runs/);
    assert.equal(get('progress').value, 1);
    get('rest').value = ''; await get('start').handlers.click();
    assert.match(get('error').textContent, /Fill in/);
    get('key').value = 'placeholder';
    get('clearSettings').handlers.click();
    assert.equal(get('key').value, '');
    assert.equal(get('seconds').value, '30');
    assert.equal(get('rest').value, '360');
    assert.equal(get('rounds').value, '5');
    assert.equal(get('passRest').value, '180');
    assert.equal(get('start').disabled, true);
    assert.equal(get('device').disabled, true);
    assert.equal(get('zones').children.length, 0);
    assert.match(get('connection').textContent, /Disconnected.*API key cleared/);
    await get('start').handlers.click();
    assert.equal(get('zones').children.length, 0);
    // Exercise controller switching through the actual interface with a fake API.
    globalThis.fetch = async url => {
      const path = new URL(url).pathname;
      const result = path.endsWith('/person/info') ? { id: 'person' }
        : path.endsWith('/person/person') ? { devices: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }] }
        : { zones: [{ id: `${path.split('/').at(-1)}-zone`, zoneNumber: 1, name: 'Lawn', enabled: true }] };
      return { ok: true, text: async () => JSON.stringify(result) };
    };
    get('key').value = 'fake-ui-test-key';
    get('connectForm').handlers.submit({ preventDefault() {} });
    for (let i = 0; i < 60; i++) await Promise.resolve();
    assert.equal(get('device').value, 'first');
    get('seconds').value = '17'; get('seconds').handlers.input();
    get('device').value = 'second'; get('device').handlers.change();
    for (let i = 0; i < 60; i++) await Promise.resolve();
    assert.equal(get('seconds').value, '30');
    get('seconds').value = '45'; get('seconds').handlers.input();
    get('device').value = 'first'; get('device').handlers.change();
    for (let i = 0; i < 60; i++) await Promise.resolve();
    assert.equal(get('seconds').value, '17');
    get('clearSettings').handlers.click();
    assert.equal(get('seconds').value, '30');
    assert.equal(get('key').value, '');
    assert.equal(get('start').disabled, true);
    assert(![...stored.values()].join('').includes('fake-ui-test-key'));
    assert([...stored.values()].some(value => value.includes('45')));

  } finally { globalThis.fetch = savedFetch; if (savedStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = savedStorage; delete globalThis.document; delete globalThis.window; }
});
