import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeAnalytics, pageView } from '../analytics.js';
function rig({ origin = 'https://simpleplum.com', browser = {}, prerendering = false, fetcher } = {}) {
  const requests = [], events = {};
  const doc = { prerendering, referrer: 'https://www.reddit.com/r/rachio/?private=value#secret', addEventListener: (name, fn) => { events[name] = fn; } };
  initializeAnalytics({ doc, win: { location: { origin, pathname: '/rachio-winterizer/' } }, browser,
    fetcher: fetcher || ((...args) => { requests.push(args); return Promise.resolve({ ok: true }); }) });
  return { requests, events, doc };
}
test('page view uses only allowlisted values, no cookies, and sanitized referrer', () => {
  const r = rig(); assert.equal(r.requests.length, 1);
  const [url, options] = r.requests[0]; assert.equal(url, '/wp-content/plugins/matomo/app/matomo.php');
  assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.body.get('cookie'), '0'); assert.equal(options.body.get('urlref'), 'https://www.reddit.com/');
  assert.equal(options.body.get('url'), 'https://simpleplum.com/rachio-winterizer/');
  assert(!options.body.toString().includes('private')); assert(!options.headers);
});
test('self-hosted copies do not send analytics to the maintainer', () => {
  assert.equal(rig({ origin: 'https://somebody-else.example' }).requests.length, 0);
});
test('Do Not Track and Global Privacy Control suppress tracking', () => {
  assert.equal(rig({ browser: { doNotTrack: '1' } }).requests.length, 0);
  assert.equal(rig({ browser: { globalPrivacyControl: true } }).requests.length, 0);
});
test('analytics failures are isolated from the application', () => {
  assert.doesNotThrow(() => rig({ fetcher: () => { throw Error('blocked'); } }));
  assert.doesNotThrow(() => rig({ fetcher: () => Promise.reject(Error('offline')) }));
});
test('invalid referrers are omitted and prerendering does not count a visit', () => {
  assert.equal(pageView('javascript:alert(1)').has('urlref'), false);
  const r = rig({ prerendering: true }); assert.equal(r.requests.length, 0);
  r.doc.prerendering = false; r.events.prerenderingchange(); assert.equal(r.requests.length, 1);
  r.events.prerenderingchange(); assert.equal(r.requests.length, 1);
});
