(() => {
  const storageKey = 'rachio-winterizer-theme';
  const lightPreference = window.matchMedia?.('(prefers-color-scheme: light)');
  let choice = 'auto';
  let control;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'dark' || saved === 'light') choice = saved;
  } catch { /* Themes still work when browser storage is unavailable. */ }
  function apply() {
    document.documentElement.dataset.theme = choice === 'auto'
      ? (lightPreference?.matches ? 'light' : 'dark') : choice;
    if (control) {
      const label = document.documentElement.dataset.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
      control.setAttribute('aria-label', label);
      control.title = label;
    }
  }
  apply();
  lightPreference?.addEventListener?.('change', () => {
    if (choice === 'auto') apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    control = document.getElementById('theme');
    apply();
    control.addEventListener('click', () => {
      choice = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(storageKey, choice); }
      catch { /* Keep the selected theme even when storage is unavailable. */ }
      apply();
    });
  });
})();
