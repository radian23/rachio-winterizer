import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sequencer, Rachio, makePlan } from '../engine.js';
const zones = [{ id: 'a', number: 1, name: 'Front' }, { id: 'b', number: 2, name: 'Back' }];
const plan = (extra = {}) => makePlan({ zones, seconds: 30, rest: 180, rounds: 2, ...extra });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function rig(overrides = {}) {
  const calls = [], waits = []; let time = 0;
  const scheduler = { now: () => time, wait(ms, signal, tick) {
    tick(ms / 1000);
    return new Promise(resolve => {
      const end = () => { signal.removeEventListener('abort', end); const i = waits.findIndex(w => w.end === end); if (i >= 0) waits.splice(i, 1); resolve(); };
      signal.addEventListener('abort', end, { once: true }); waits.push({ ms, end });
    });
  } };
  const api = { start: async (...args) => { calls.push(['start', ...args]); }, stop: async id => { calls.push(['stop', id]); }, ...overrides };
  const runner = new Sequencer(api, () => {}, scheduler);
  return { runner, calls, waits, elapse(ms) { time += ms; }, async next() { assert(waits.length); waits.shift().end(); await flush(); } };
}
test('plan rotates all zones per pass, excludes the final rest, and snapshots zones', () => {
  const p = plan(); assert.equal(p.total, 660); assert.deepEqual(p.jobs.map(j => j.zone.id), ['a', 'b', 'a', 'b']);
  assert.notEqual(p.jobs[0].zone, zones[0]);
  assert.throws(() => plan({ seconds: NaN })); assert.throws(() => plan({ rest: -1 }));
  assert.throws(() => plan({ rounds: 1.1 })); assert.throws(() => plan({ zones: [zones[0], zones[0]] }));
});
test('normal completion has exact pass count, rest intervals, bounded starts, final Stop', async () => {
  const r = rig(), task = r.runner.run('device', plan()); await flush();
  for (let i = 0; i < 4; i++) {
    assert.equal(r.waits[0].ms, 30000); await r.next();
    if (i < 3) { assert.equal(r.waits[0].ms, 180000); await r.next(); }
  }
  await task; assert.equal(r.runner.view.state, 'finished'); assert.equal(r.runner.view.done, 4);
  assert.deepEqual(r.calls, [['start', 'a', 30], ['start', 'b', 30], ['start', 'a', 30], ['start', 'b', 30], ['stop', 'device']]);
  assert.equal(r.runner.locked, false);
});
test('failed final zone halts without counting the failed attempt or repeating', async () => {
  let starts = 0; const r = rig({ start: async () => { if (++starts === 2) throw Error('offline'); } });
  const task = r.runner.run('device', plan()); await flush(); await r.next(); await r.next(); await task;
  assert.equal(starts, 2); assert.equal(r.runner.view.state, 'failed'); assert.equal(r.runner.view.done, 1);
});
test('Stop interrupts rest; restart is rejected until teardown and no old loop revives', async () => {
  const r = rig(), task = r.runner.run('device', plan()); await flush(); await r.next();
  const stop = r.runner.stop(); await assert.rejects(r.runner.run('device', plan()), /previous/);
  await stop; await task;
  assert.equal(r.calls.filter(c => c[0] === 'start').length, 1); assert.equal(r.runner.view.state, 'stopped');
  const again = r.runner.run('device', plan()); await flush(); await r.runner.stop(); await again;
  assert.equal(r.calls.filter(c => c[0] === 'start').length, 2);
});
test('interrupted run does not count as completed', async () => {
  const r = rig(), task = r.runner.run('device', plan()); await flush(); await r.runner.stop(); await task;
  assert.equal(r.runner.view.done, 0); assert.equal(r.runner.view.state, 'stopped');
});
test('failed Stop locks future runs, permits manual retry, never claims Finished', async () => {
  let broken = true;
  const r = rig({ stop: async () => { if (broken) throw Error('unreachable'); } });
  const task = r.runner.run('device', plan()); await flush(); await r.runner.stop(); await task;
  assert.equal(r.runner.view.state, 'unconfirmed'); assert(r.runner.locked);
  await assert.rejects(r.runner.run('device', plan())); broken = false; await r.runner.stop();
  assert.equal(r.runner.locked, false); assert.equal(r.runner.view.state, 'stopped');
});
test('late Start after cancellation is followed by another Stop', async () => {
  let release; const order = [];
  const r = rig({ start: () => { order.push('start'); return new Promise(resolve => { release = resolve; }); }, stop: async () => { order.push('stop'); } });
  const task = r.runner.run('device', plan()); await flush(); await r.runner.stop(); assert(r.runner.locked);
  release(); await task; assert.deepEqual(order, ['start', 'stop', 'stop']); assert.equal(r.runner.view.done, 0);
});
test('start rejection after Stop still gets final Stop', async () => {
  let reject; const r = rig({ start: () => new Promise((_, fail) => { reject = fail; }) });
  const task = r.runner.run('device', plan()); await flush(); await r.runner.stop(); reject(Error('timeout')); await task;
  assert.equal(r.calls.filter(c => c[0] === 'stop').length, 2); assert.equal(r.runner.view.state, 'failed');
});
test('zero wait and one zone/pass work without a trailing rest', async () => {
  const r = rig(), task = r.runner.run('device', plan({ zones: [zones[0]], rounds: 1, rest: 0 }));
  await flush(); await r.next(); await task; assert.equal(r.waits.length, 0); assert.equal(r.runner.view.done, 1);
});
test('countdown reports remaining total including later phases', async () => {
  const r = rig(), task = r.runner.run('device', plan()); await flush();
  assert.equal(r.runner.view.phaseLeft, 30); assert.equal(r.runner.view.remaining, 660);
  await r.next(); assert.equal(r.runner.view.phaseLeft, 180); assert.equal(r.runner.view.remaining, 630);
  await r.runner.stop(); await task;
});
test('API uses documented methods, headers and second-based durations', async () => {
  const calls = []; const api = new Rachio('test-secret', { fetcher: async (...args) => { calls.push(args); return { ok: true, text: async () => '' }; } });
  await api.start('zone', 30); await api.stop('device');
  assert.equal(calls[0][0], 'https://api.rach.io/1/public/zone/start'); assert.equal(calls[0][1].method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0][1].body), { id: 'zone', duration: 30 }); assert.equal(calls[0][1].headers.Authorization, 'Bearer test-secret');
});
test('API rate limits are explicit and starts are not retried', async () => {
  let calls = 0; const api = new Rachio('test', { fetcher: async () => { calls++; return { ok: false, status: 429 }; } });
  await assert.rejects(api.start('zone', 30), /rate limit/); assert.equal(calls, 1);
});
test('timeout covers a hung request even if transport ignores abort', async () => {
  const api = new Rachio('test', { timeout: 5, fetcher: () => new Promise(() => {}) });
  await assert.rejects(api.start('zone', 30), /timed out/);
});
test('timeout covers reading response bodies', async () => {
  const api = new Rachio('test', { timeout: 5, fetcher: async () => ({ ok: true, text: () => new Promise(() => {}) }) });
  await assert.rejects(api.device('device'), /timed out/);
});
test('controller discovery uses person ID and device lists from Rachio', async () => {
  const urls = []; const replies = [{ id: 'person' }, { devices: [{ id: 'device' }] }];
  const api = new Rachio('test', { fetcher: async url => { urls.push(url); return { ok: true, text: async () => JSON.stringify(replies.shift()) }; } });
  assert.deepEqual(await api.controllers(), [{ id: 'device' }]); assert(urls[1].endsWith('/person/person'));
});

test('default browser fetch retains the global receiver', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async function () {
    // Browser Window.fetch requires its receiver to be the window/global object.
    assert.equal(this, globalThis, 'fetch must retain its browser receiver');
    requests++;
    return { ok: true, text: async () => JSON.stringify({ id: 'test-person' }) };
  };
  try {
    const api = new Rachio('fake-key');
    assert.deepEqual(await api.request('person/info'), { id: 'test-person' });
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});
test('extra pass rest follows normal wait only at pass boundaries and affects estimate', async () => {
  const p = plan({ passRest: 180 }); assert.equal(p.total, 840);
  const r = rig(), task = r.runner.run('device', p); await flush();
  await r.next(); await r.next(); // Zone 1 and its normal wait.
  await r.next(); // Zone 2 completes first pass.
  assert.equal(r.runner.view.state, 'resting'); await r.next();
  assert.equal(r.runner.view.state, 'cooling'); assert.equal(r.waits[0].ms, 180000);
  assert.equal(r.runner.view.remaining, 420); await r.next();
  await r.next(); await r.next(); await r.next(); await task;
  assert.equal(r.runner.view.state, 'finished'); assert.equal(r.waits.length, 0);
});
test('Stop interrupts extra pass rest without starting the next pass', async () => {
  const r = rig(), task = r.runner.run('device', plan({ passRest: 300 })); await flush();
  await r.next(); await r.next(); await r.next(); await r.next();
  assert.equal(r.runner.view.state, 'cooling'); await r.runner.stop(); await task;
  assert.equal(r.calls.filter(c => c[0] === 'start').length, 2);
  assert.equal(r.runner.view.state, 'stopped');
});
test('a single pass never adds extra rest; invalid extra rest is rejected', () => {
  assert.equal(plan({ rounds: 1, passRest: 300 }).total, 240);
  assert.throws(() => plan({ passRest: -1 })); assert.throws(() => plan({ passRest: NaN }));
});
test('pause closes a zone, holds its time, then resumes only the remaining seconds', async () => {
  const r = rig(), task = r.runner.run('device', plan({ zones: [zones[0]], rounds: 1 }));
  await flush(); r.elapse(10500); r.runner.pause(); await flush();
  assert.equal(r.runner.view.state, 'paused'); assert.equal(r.runner.view.phaseLeft, 19.5);
  assert.equal(r.runner.view.done, 0); assert.equal(r.waits.length, 0);
  assert.deepEqual(r.calls, [['start', 'a', 30], ['stop', 'device']]);
  r.elapse(60000); r.runner.resume(); await flush();
  assert.deepEqual(r.calls[2], ['start', 'a', 20]); assert.equal(r.waits[0].ms, 20000);
  await r.next(); await task; assert.equal(r.runner.view.state, 'finished'); assert.equal(r.runner.view.done, 1);
});
test('pausing a recovery interval holds only its remaining wait without restarting a zone', async () => {
  const r = rig(), task = r.runner.run('device', plan()); await flush(); await r.next();
  r.elapse(40000); r.runner.pause(); await flush();
  assert.equal(r.runner.view.state, 'paused'); assert.equal(r.runner.view.phaseLeft, 140);
  assert.equal(r.calls.filter(c => c[0] === 'start').length, 1);
  r.runner.resume(); await flush(); assert.equal(r.waits[0].ms, 140000);
  await r.next(); assert.deepEqual(r.calls.at(-1), ['start', 'b', 30]);
  await r.runner.stop(); await task;
});
test('Stop during pause cancels the gate and prevents later Resume', async () => {
  const r = rig(), task = r.runner.run('device', plan()); await flush(); r.runner.pause(); await flush();
  assert.equal(r.runner.view.state, 'paused'); await r.runner.stop(); await task;
  r.runner.resume(); await flush(); assert.equal(r.calls.filter(c => c[0] === 'start').length, 1);
  assert.equal(r.runner.view.state, 'stopped');
});
test('a failed pause Stop halts the sequence instead of offering unsafe Resume', async () => {
  let stops = 0;
  const r = rig({ stop: async () => { if (++stops === 1) throw Error('offline'); } });
  const task = r.runner.run('device', plan()); await flush(); r.runner.pause(); await task;
  assert.equal(r.runner.view.state, 'failed'); assert.equal(r.runner.view.done, 0); assert.equal(stops, 2);
});
test('Pause while initial Start is pending stops it once the request settles', async () => {
  let release;
  const r = rig({ start: () => new Promise(resolve => { release = resolve; }) });
  const task = r.runner.run('device', plan()); r.runner.pause(); release(); await flush();
  assert.equal(r.runner.view.state, 'paused'); assert.equal(r.runner.view.phaseLeft, 30);
  assert.equal(r.calls[0][0], 'stop'); await r.runner.stop(); await task;
});
test('a failed Resume Start halts without counting the interrupted zone', async () => {
  let starts = 0;
  const r = rig({ start: async () => { if (++starts === 2) throw Error('resume failed'); } });
  const task = r.runner.run('device', plan()); await flush(); r.runner.pause(); await flush(); r.runner.resume(); await task;
  assert.equal(r.runner.view.state, 'failed'); assert.equal(r.runner.view.done, 0);
});
test('Stop during pending Resume is followed by final Stop after Start settles', async () => {
  let starts = 0, release; const order = [];
  const r = rig({ start: () => { order.push('start'); return ++starts === 2 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); }, stop: async () => { order.push('stop'); } });
  const task = r.runner.run('device', plan()); await flush(); r.runner.pause(); await flush(); r.runner.resume(); await flush();
  await r.runner.stop(); release(); await task;
  assert.deepEqual(order, ['start', 'stop', 'start', 'stop', 'stop']); assert.equal(r.runner.view.state, 'stopped');
});
test('all 16 controller zones are supported without truncation', async () => {
  const full = Array.from({ length: 16 }, (_, i) => ({ id: `zone-${i+1}`, number: i+1, name: `Zone ${i+1}` }));
  const repeated = plan({ zones: full, rounds: 5 }); assert.equal(repeated.jobs.length, 80);
  assert.equal(repeated.jobs[79].zone.number, 16); assert.equal(repeated.jobs[79].pass, 5);
  const r = rig(), task = r.runner.run('device', plan({ zones: full, rounds: 1, seconds: 1, rest: 0 }));
  await flush(); for (let i=0; i<16; i++) await r.next(); await task;
  assert.equal(r.runner.view.done, 16); assert.equal(r.calls.filter(c => c[0] === 'start').length, 16);
  assert.equal(r.runner.view.state, 'finished');
});
test('first-pass duration applies to every first-pass zone and estimates correctly', async () => {
  const p = plan({ firstSeconds: 60, rest: 0 });
  assert.equal(p.total, 180); assert.deepEqual(p.jobs.map(j => j.seconds), [60,60,30,30]);
  const r = rig(), task = r.runner.run('device', p); await flush();
  for (const seconds of [60,60,30,30]) { assert.equal(r.waits[0].ms, seconds*1000); await r.next(); }
  await task; assert.deepEqual(r.calls.filter(c => c[0] === 'start').map(c => c[2]),[60,60,30,30]);
  assert.equal(r.runner.view.done,4);
});
test('pausing a longer first pass resumes only its remaining time', async () => {
  const r = rig(), task = r.runner.run('device', plan({ firstSeconds: 60 })); await flush();
  r.elapse(10000); r.runner.pause(); await flush(); r.runner.resume(); await flush();
  assert.deepEqual(r.calls.filter(c => c[0] === 'start').map(c => c[2]),[60,50]);
  await r.runner.stop(); await task;
});
