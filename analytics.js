// First-party page-view counting on the Simple Plum hosted copy only.
// Never reads form fields, the API client, application settings, or session logs.
export function pageView(referrer = '') {
  const body = new URLSearchParams({ idsite: '1', rec: '1', apiv: '1', cookie: '0',
    action_name: 'Rachio Winterizer', url: 'https://simpleplum.com/rachio-winterizer/',
    send_image: '0', rand: String(Math.random()) });
  try {
    const source = new URL(referrer);
    if (['http:', 'https:'].includes(source.protocol)) body.set('urlref', source.origin + '/');
  } catch { /* A referrer is optional; never include paths or query strings. */ }
  return body;
}
export function initializeAnalytics({ doc = document, win = window, browser = navigator,
  fetcher = (...args) => globalThis.fetch(...args) } = {}) {
  if (win.location.origin !== 'https://simpleplum.com' || win.location.pathname !== '/rachio-winterizer/') return;
  if (browser.globalPrivacyControl === true || browser.doNotTrack === '1' || win.doNotTrack === '1') return;
  let sent = false;
  function track() {
    if (sent || doc.prerendering) return;
    sent = true;
    try {
      Promise.resolve(fetcher('/wp-content/plugins/matomo/app/matomo.php', {
        method: 'POST', mode: 'same-origin', credentials: 'omit', keepalive: true,
        referrerPolicy: 'no-referrer', body: pageView(doc.referrer),
      })).catch(() => {});
    } catch { /* Analytics failure must never interrupt the irrigation app. */ }
  }
  if (doc.prerendering) doc.addEventListener('prerenderingchange', track, { once: true });
  else track();
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') initializeAnalytics();
