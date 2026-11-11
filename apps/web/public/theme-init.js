// Applies the saved theme before the first paint (no flash). Mirrors src/lib/theme.ts.
(function () {
  var choice = 'system';
  try {
    choice = localStorage.getItem('chameleon.theme') || 'system';
  } catch {
    /* storage blocked: follow the system */
  }
  var dark =
    choice === 'dark' ||
    (choice !== 'light' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
