(function () {
  var theme = 'system', view = 'standard';
  var raw = null;
  try { raw = localStorage.getItem('dataagent:appearance:boot:v1'); } catch (_) { /* 无存储时继续跟随系统。 */ }
  try {
    if (raw) {
      var stored = JSON.parse(raw);
      theme = stored && (stored.theme === 'system' || stored.theme === 'light' || stored.theme === 'dark') ? stored.theme : 'light';
      view = stored && stored.view === 'concise' ? 'concise' : 'standard';
    }
  } catch (_) { theme = 'light'; view = 'standard'; }
  var dark = theme === 'dark' || (theme === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.view = view;
  if (theme !== 'system') document.documentElement.dataset.themeFix = '';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0d1110' : '#f2f4f3');
}());
