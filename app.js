import { Rachio, Sequencer, makePlan } from './engine.js';
import { ControllerSettings, DEFAULT_SETTINGS, ScreenAwake } from './browser-support.js';
const $ = id => document.getElementById(id);
let api, runner, loading = false, simulation = false, knownZones = [];
let displayedLog = null;
let finishTicker = null;
const settings = new ControllerSettings();
const awake = new ScreenAwake();
const pretty = value => {
  const s = Math.max(0, Math.ceil(value));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function plan() {
  const values = ['seconds', 'rest', 'rounds', 'passRest'].map(id => {
    if (!$(id).value.trim()) throw Error('Fill in all timing fields.');
    return Number($(id).value);
  });
  const chosen = new Set([...$('zones').querySelectorAll('input:checked')].map(input => input.value));
  return makePlan({ zones: knownZones.filter(zone => chosen.has(zone.id)), seconds: values[0], rest: values[1], rounds: values[2], passRest: values[3] });
}
function durationInWords(totalSeconds) {
  const total = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  const parts = [];
  const unit = (value, name) => `${value} ${name}${value === 1 ? '' : 's'}`;
  if (hours) parts.push(unit(hours, 'hour'));
  if (minutes) parts.push(unit(minutes, 'minute'));
  if (seconds || !parts.length) parts.push(unit(seconds, 'second'));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
}
function estimate() {
  try {
    const p = plan();
    $('estimate').textContent = `${p.jobs.length} runs · About ${durationInWords(p.total)} total · Finish around ${new Date(Date.now() + p.total * 1000).toLocaleTimeString()} (plus API delays).`;
  } catch (e) { $('estimate').textContent = e.message; }
}
function locks() {
  const locked = loading || Boolean(runner?.locked);
  for (const id of ['key', 'connect', 'demo', 'device', 'seconds', 'rest', 'rounds', 'passRest', 'clearSettings']) $(id).disabled = locked || (id === 'device' && !api);
  for (const input of $('zones').querySelectorAll('input')) input.disabled = locked;
  $('clearSettings').disabled = locked || !api || !knownZones.length;
  $('start').disabled = locked || !runner || !knownZones.length;
  $('pause').disabled = !runner?.session || ['pausing', 'resuming', 'stopping'].includes(runner.view.state);
  $('pause').textContent = runner?.view.state === 'paused' ? 'Resume session' : 'Pause session';
  $('stop').disabled = !runner || !runner.locked || runner.view.state === 'stopping';
  $('stop').textContent = runner?.uncertainDevice ? 'Retry Stop' : 'Stop session';
}
function render(view) {
  $('badge').textContent = `${simulation ? 'SIMULATION · ' : ''}${view.state.toUpperCase()}`;
  $('status').textContent = view.message;
  $('countdown').textContent = view.phaseLeft == null ? '—' : pretty(view.phaseLeft);
  $('phase').textContent = view.state === 'cooling' ? 'Extra rest before the next pass' : view.state === 'resting' ? 'Until the next zone' : 'Time remaining in this phase';
  $('progress').max = view.total || 1; $('progress').value = view.done;
  $('timeRemaining').textContent = view.remaining == null ? 'Total remaining —' : `Total remaining ${pretty(view.remaining)}${['paused', 'pausing'].includes(view.state) ? ' · paused' : ''}`;
  $('completed').textContent = `${view.done}${view.total ? '/' + view.total : ''} timed runs completed`;
  updateFinish(view);
  if (view.state === 'paused' && finishTicker === null) {
    finishTicker = setInterval(() => updateFinish(runner?.view), 1000);
  } else if (view.state !== 'paused' && finishTicker !== null) {
    clearInterval(finishTicker);
    finishTicker = null;
  }
  renderLog(view.log); locks();
  awake.setActive(Boolean(runner?.session));
}
function updateFinish(view) {
  $('finish').textContent = view?.remaining == null ? 'Finish —' :
    `Finish ≈ ${new Date(Date.now() + view.remaining * 1000).toLocaleTimeString()}${view.state === 'paused' ? ' · if resumed now' : ''}`;
}
function followingLog() {
  const log = $('log');
  return log.scrollHeight - log.clientHeight - log.scrollTop <= 24;
}
function renderLog(entries) {
  // Countdown updates should not rebuild the log or move its scroll position.
  if (entries === displayedLog) return;
  const log = $('log');
  const follow = !displayedLog?.length || followingLog();
  const previousTop = log.scrollTop;
  const appendOnly = displayedLog && displayedLog.length <= entries.length &&
    displayedLog.every((entry, i) => entry === entries[i]);
  const added = appendOnly ? entries.slice(displayedLog.length) : entries;
  const rows = added.map(entry => {
    const row = document.createElement('li');
    row.textContent = `[${entry.at}] ${entry.message}`;
    return row;
  });
  if (appendOnly) log.append(...rows);
  else log.replaceChildren(...rows);
  displayedLog = entries;
  if (follow || !entries.length) log.scrollTop = log.scrollHeight;
  else log.scrollTop = previousTop;
  $('latest').hidden = followingLog();
}
$('log').addEventListener('scroll', () => { $('latest').hidden = followingLog(); });
$('latest').addEventListener('click', () => {
  $('log').scrollTop = $('log').scrollHeight;
  $('latest').hidden = true;
});
function restoreSettings() {
  const saved = settings.read($('device').value, simulation);
  for (const name of Object.keys(DEFAULT_SETTINGS)) $(name).value = String(saved[name]);
  for (const box of $('zones').querySelectorAll('input')) box.checked = saved.selected === null || saved.selected.includes(box.value);
  $('settingsStatus').textContent = saved.saved ? 'Loaded saved settings for this controller.' : 'Changes are saved on this device separately for each controller.';
}
function settingsChanged() {
  estimate();
  if (!api || loading || runner?.locked) return;
  const values = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(id => [id, $(id).value.trim() === '' ? NaN : Number($(id).value)]));
  values.selected = [...$('zones').querySelectorAll('input:checked')].map(box => box.value);
  const saved = settings.save($('device').value, simulation, values);
  $('settingsStatus').textContent = saved ? 'Settings saved for this controller on this device.' : 'Settings were not saved. Check the values; browser storage may be unavailable.';
}
$('clearSettings').addEventListener('click', () => {
  if (loading || runner?.locked || !api) return;
  const cleared = settings.clear($('device').value, simulation);
  for (const [id, value] of Object.entries(DEFAULT_SETTINGS)) $(id).value = String(value);
  // Clear the live client as well as the form so a reconnect is required.
  if (api instanceof Rachio) api.key = '';
  $('key').value = '';
  api = null;
  runner = null;
  simulation = false;
  knownZones = [];
  $('zones').replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.textContent = 'Connect to load controllers';
  placeholder.value = '';
  $('device').replaceChildren(placeholder);
  $('connection').textContent = 'Disconnected. API key cleared. Connect again to load your controller.';
  $('settingsStatus').textContent = cleared
    ? 'Saved settings cleared for this controller. Defaults restored and API key cleared.'
    : 'Defaults restored and API key cleared. Saved settings could not be removed from browser storage.';
  awake.setActive(false);
  render({ state: 'ready', message: 'Connect your controller to start a session.', done: 0, log: [], remaining: null, phaseLeft: null });
  error();
  estimate();
});
document.addEventListener?.('visibilitychange', () => awake.visibilityChanged());
async function loadController() {
  knownZones = []; $('zones').replaceChildren(); loading = true; locks();
  try {
    const device = await api.device($('device').value);
    knownZones = (device.zones || []).filter(z => z.enabled !== false).map(z => ({ id: z.id, name: z.name || `Zone ${z.zoneNumber}`, number: z.zoneNumber })).sort((a, b) => a.number - b.number);
    for (const zone of knownZones) {
      const label = document.createElement('label'); label.className = 'zone';
      const box = document.createElement('input'); box.type = 'checkbox'; box.value = zone.id; box.checked = true;
      box.addEventListener('change', settingsChanged);
      const text = document.createElement('span'); text.textContent = `${zone.number} · ${zone.name}`;
      label.append(box, text); $('zones').append(label);
    }
    restoreSettings();
    if (!knownZones.length) error('No enabled zones found on this controller.');
  } catch (e) { error(e.message); }
  finally { loading = false; locks(); estimate(); }
}
async function connect(client, demo = false) {
  if (loading || runner?.locked) return;
  error(); loading = true; locks();
  try {
    const devices = await client.controllers();
    if (!devices.length) throw Error('No Rachio controllers were found.');
    api = client; simulation = demo; runner = new Sequencer(api, render);
    $('device').replaceChildren(...devices.map(device => {
      const option = document.createElement('option'); option.value = device.id; option.textContent = device.name; return option;
    }));
    $('connection').textContent = demo ? 'Simulation: no commands will be sent to Rachio.' : 'Connected. Your API key is sent directly to Rachio and is not saved.';
    $('key').value = ''; render(runner.view);
    await loadController();
  } catch (e) { error(e.message); }
  finally { loading = false; locks(); }
}
$('connectForm').addEventListener('submit', event => {
  event.preventDefault(); const key = $('key').value.trim();
  if (key) void connect(new Rachio(key));
});
$('device').addEventListener('change', () => { if (!runner?.locked) { error(); void loadController(); } });
for (const id of ['seconds', 'rest', 'rounds', 'passRest']) $(id).addEventListener('input', settingsChanged);
$('start').addEventListener('click', async () => {
  error();
  try { if (runner) await runner.run($('device').value, plan()); }
  catch (e) { error(e.message); }
});
$('pause').addEventListener('click', () => {
  if (runner?.view.state === 'paused') runner.resume();
  else runner?.pause();
});
$('stop').addEventListener('click', async () => {
  try { await runner?.stop(); } catch (e) { error(e.message); }
});
$('demo').addEventListener('click', () => {
  const zones = Array.from({ length: 8 }, (_, i) => ({ id: `demo-${i}`, zoneNumber: i + 1, name: ['Front lawn', 'Entry garden', 'Driveway', 'East side', 'Back lawn', 'Patio', 'West side', 'Trees'][i], enabled: true }));
  void connect({ controllers: async () => [{ id: 'demo', name: 'Simulated 8-zone controller' }], device: async () => ({ zones }), start: async () => {}, stop: async () => {} }, true);
});
window.addEventListener('beforeunload', event => {
  if (runner?.locked) { event.preventDefault(); event.returnValue = ''; }
});
estimate();
