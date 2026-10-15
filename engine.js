/** Application logic written for radian23's irrigation winterizer. */
export function makePlan({ zones, seconds, rest, rounds, passRest = 0 }) {
  for (const [label, value, min, max] of [
    ['Zone duration', seconds, 1, 10800], ['Recovery interval', rest, 0, 86400], ['Passes', rounds, 1, 100], ['Rest between passes', passRest, 0, 86400],
  ]) if (!Number.isInteger(value) || value < min || value > max) throw Error(`${label}: enter a whole number from ${min} to ${max}.`);
  if (!Array.isArray(zones) || !zones.length || zones.some(z => !z.id) || new Set(zones.map(z => z.id)).size !== zones.length) throw Error('Select one or more distinct zones.');
  const jobs = Array.from({ length: rounds }, (_, i) => zones.map(zone => ({ zone: { ...zone }, pass: i + 1 }))).flat();
  return { jobs, seconds, rest, rounds, passRest, total: jobs.length * seconds + (jobs.length - 1) * rest + (rounds - 1) * passRest };
}

export class Rachio {
  constructor(key, { fetcher = globalThis.fetch.bind(globalThis), timeout = 15000 } = {}) {
    this.key = key; this.fetcher = fetcher; this.timeout = timeout;
  }
  async request(path, body) {
    const abort = new AbortController();
    let timer;
    // Race as well as abort, so even a transport ignoring AbortSignal is bounded.
    const expiry = new Promise((_, reject) => { timer = setTimeout(() => {
      abort.abort(); reject(Error('Rachio request timed out; command delivery is unknown.'));
    }, this.timeout); });
    try {
      return await Promise.race([expiry, (async () => {
        const response = await this.fetcher(`https://api.rach.io/1/public/${path}`, {
          method: body ? 'PUT' : 'GET', signal: abort.signal,
          headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (response.status === 401) throw Error('Rachio rejected the API key (HTTP 401). Copy it again from Rachio Profile → API key → Copy, and paste only the key, without quotes or the word Bearer.');
        if (!response.ok) throw Error(response.status === 429 ? 'Rachio API rate limit reached.' : `Rachio returned HTTP ${response.status}.`);
        const text = await response.text();
        return body || !text.trim() ? null : JSON.parse(text);
      })()]);
    } finally { clearTimeout(timer); }
  }
  async controllers() {
    const person = await this.request('person/info');
    const account = await this.request(`person/${encodeURIComponent(person.id)}`);
    return account.devices || [];
  }
  async device(id) { return this.request(`device/${encodeURIComponent(id)}`); }
  start(id, seconds) { return this.request('zone/start', { id, duration: seconds }); }
  stop(id) { return this.request('device/stop_water', { id }); }
}

const clock = {
  now: () => performance.now(),
  wait(ms, signal, tick) {
    return new Promise(resolve => {
      if (signal.aborted) return resolve();
      const until = performance.now() + ms;
      const update = () => tick(Math.max(0, (until - performance.now()) / 1000));
      const finish = () => { clearTimeout(end); clearInterval(pulse); signal.removeEventListener('abort', finish); resolve(); };
      const end = setTimeout(finish, ms);
      const pulse = setInterval(update, 200);
      signal.addEventListener('abort', finish, { once: true }); update();
    });
  },
};

export class Sequencer {
  constructor(api, changed = () => {}, scheduler = clock) {
    this.api = api; this.changed = changed; this.clock = scheduler;
    this.session = null; this.uncertainDevice = null;
    this.view = { state: 'ready', message: 'Ready to prepare a session.', done: 0, log: [] };
  }
  get locked() { return Boolean(this.session || this.uncertainDevice || this.retrying); }
  publish(update) { Object.assign(this.view, update); this.changed(this.view); }
  note(message) {
    this.view.log = [...this.view.log, { at: new Date().toLocaleTimeString(), message }].slice(-300);
    this.publish({});
  }
  async sendStop(device) {
    try { await this.api.stop(device); this.note('Rachio acknowledged Stop.'); return true; }
    catch (error) { this.note(`Stop was not confirmed: ${error.message}`); return false; }
  }
  async run(device, plan) {
    if (this.locked) throw Error('Finish stopping the previous session before starting another.');
    if (!device) throw Error('Choose a controller.');
    // Rebuild rather than trust caller-supplied job counts or timings.
    plan = makePlan({ zones: plan.jobs.filter(j => j.pass === 1).map(j => j.zone), seconds: plan.seconds, rest: plan.rest, rounds: plan.rounds, passRest: plan.passRest });
    const session = { cancel: new AbortController(), device, immediateStop: null, pauseWanted: false, phaseAbort: null, resumeGate: null };
    this.session = session;
    this.publish({ state: 'starting', message: 'Starting session…', done: 0, counts: {}, total: plan.jobs.length, remaining: plan.total, log: [] });
    let failure = '', done = 0, remaining = plan.total;
    const counts = {};
    const phase = async (state, seconds, job) => {
      const future = remaining - seconds;
      let left = seconds;
      while (left > 0 && !session.cancel.signal.aborted) {
        if (session.pauseWanted) {
          // Stop must be acknowledged before offering Resume. Do not rely on a
          // timed native pause that could automatically reopen a zone later.
          this.publish({ state: 'pausing', phaseLeft: left, message: 'Pausing the current run…' });
          if (state === 'blowing' && !await this.sendStop(device)) throw Error('Pause could not be confirmed.');
          if (session.cancel.signal.aborted) break;
          this.note(`Session paused with ${Math.ceil(left)}s left in ${state === 'blowing' ? job.zone.name : state === 'cooling' ? 'pass rest' : 'recovery wait'}.`);
          await new Promise(resolve => {
            const wake = () => { session.cancel.signal.removeEventListener('abort', wake); session.resumeGate = null; resolve(); };
            session.resumeGate = wake;
            session.cancel.signal.addEventListener('abort', wake, { once: true });
            this.publish({ state: 'paused', phaseLeft: left, remaining: future + left,
              message: `Paused · ${state === 'blowing' ? job.zone.name : state === 'cooling' ? 'pass rest' : 'recovery wait'} · ${Math.ceil(left)}s remaining` });
          });
          if (session.cancel.signal.aborted) break;
          if (state === 'blowing') {
            left = Math.ceil(left);
            this.publish({ state: 'resuming', message: `Resuming ${job.zone.name} for ${left}s…` });
            this.note(`Resuming ${job.zone.name} for ${left}s remaining.`);
            await this.api.start(job.zone.id, left);
            if (session.cancel.signal.aborted) break;
          } else this.note('Resuming the remaining wait.');
          // A second Pause during a pending Resume request is handled before
          // another clock starts, after that command has settled.
          if (session.pauseWanted) continue;
        }
        const abort = new AbortController();
        session.phaseAbort = abort;
        const cancel = () => abort.abort();
        session.cancel.signal.addEventListener('abort', cancel, { once: true });
        const started = this.clock.now();
        const before = left;
        try {
          await this.clock.wait(left * 1000, abort.signal, value => {
            this.publish({ state, job, phaseLeft: value, remaining: future + value,
              message: state === 'blowing' ? `Zone ${job.zone.number} · ${job.zone.name} · pass ${job.pass}/${plan.rounds}` : state === 'cooling' ? `Extra rest after pass ${job.pass}` : 'Recovery and cooldown' });
          });
        } finally {
          session.cancel.signal.removeEventListener('abort', cancel);
          session.phaseAbort = null;
        }
        left = abort.signal.aborted ? Math.max(0, before - (this.clock.now() - started) / 1000) : 0;
      }
      remaining = future;
    };

    try {
      for (const job of plan.jobs) {
        if (session.cancel.signal.aborted) break;
        this.publish({ state: 'starting', job, phaseLeft: null, message: `Requesting zone ${job.zone.number} · pass ${job.pass}/${plan.rounds}…` });
        this.note(`Requesting ${job.zone.name}, pass ${job.pass}, for ${plan.seconds}s.`);
        // No automatic retry: an unanswered Start may still have been delivered.
        await this.api.start(job.zone.id, plan.seconds);
        if (session.cancel.signal.aborted) break;
        await phase('blowing', plan.seconds, job);
        if (session.cancel.signal.aborted) break;
        done++; counts[job.zone.id] = (counts[job.zone.id] || 0) + 1;
        this.publish({ done, counts: { ...counts } });
        this.note(`Timed run finished: ${job.zone.name} (${counts[job.zone.id]}/${plan.rounds}).`);
        if (done < plan.jobs.length) {
          await phase('resting', plan.rest, job);
          if (!session.cancel.signal.aborted && done % (plan.jobs.length / plan.rounds) === 0 && plan.passRest > 0) {
            this.note(`Pass ${job.pass} completed. Extra rest: ${plan.passRest}s.`);
            await phase('cooling', plan.passRest, job);
          }
        }
      }
    } catch (error) {
      failure = error.message;
      session.cancel.abort(); this.note(`Session halted: ${failure}`);
    } finally {
      this.publish({ state: 'stopping', phaseLeft: null, message: 'Confirming Stop with Rachio…' });
      if (session.immediateStop) await session.immediateStop;
      // Final Stop follows any pending Start, even if an earlier Stop succeeded.
      const stopped = await this.sendStop(device);
      this.uncertainDevice = stopped ? null : device;
      this.session = null;
      const state = !stopped ? 'unconfirmed' : failure ? 'failed' : session.cancel.signal.aborted ? 'stopped' : 'finished';
      this.publish({ state, remaining: null, phaseLeft: null, message: !stopped ? 'Stop unconfirmed. Check the Rachio app; retry Stop before starting again.' : failure ? `Halted: ${failure} Stop acknowledged.` : state === 'finished' ? `Finished ${done} timed runs.` : `Stopped after ${done} completed timed runs.` });
    }
  }
  pause() {
    const session = this.session;
    if (!session || session.cancel.signal.aborted || session.pauseWanted || this.view.state === 'stopping') return;
    session.pauseWanted = true;
    session.phaseAbort?.abort();
    this.publish({ state: 'pausing', message: 'Pause requested. Waiting for pending commands and confirming Stop…' });
  }
  resume() {
    const session = this.session;
    if (!session || session.cancel.signal.aborted || this.view.state !== 'paused' || !session.resumeGate) return;
    session.pauseWanted = false;
    this.publish({ state: 'resuming', message: 'Resuming session…' });
    session.resumeGate();
  }
  async stop() {
    if (this.session) {
      const current = this.session;
      if (current.cancel.signal.aborted) return;
      current.cancel.abort();
      this.publish({ state: 'stopping', message: 'Cancelling future runs and sending Stop…', phaseLeft: null });
      current.immediateStop = this.sendStop(current.device);
      await current.immediateStop;
    } else if (this.uncertainDevice && !this.retrying) {
      this.retrying = true; this.publish({ state: 'stopping', message: 'Retrying Stop…' });
      if (await this.sendStop(this.uncertainDevice)) this.uncertainDevice = null;
      this.retrying = false;
      this.publish({ state: this.uncertainDevice ? 'unconfirmed' : 'stopped', message: this.uncertainDevice ? 'Stop still unconfirmed. Check Rachio or retry.' : 'Stop acknowledged. Ready for a new session.' });
    }
  }
}
