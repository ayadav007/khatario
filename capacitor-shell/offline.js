/**
 * Capacitor errorPath handler — loaded from APK assets when the remote server
 * is unreachable. Immediately redirects to the cached dashboard (served by the
 * service worker from a prior online session). No manual buttons needed.
 *
 * If the redirect fails (first install, never opened, truly offline) the parent
 * HTML reveals a minimal "connect to internet" message after a timeout.
 */
(function () {
  var DEFAULT_SERVER = 'https://staging.khatario.com';
  var shown = false;

  function show() {
    if (shown) return;
    shown = true;
    var spinner = document.getElementById('spinner');
    var msg = document.getElementById('offline-msg');
    if (spinner) spinner.style.display = 'none';
    if (msg) msg.style.display = 'flex';
  }

  function go(url) {
    try { window.location.replace(url); } catch (_) {}
  }

  function getBootstrapUrl(cfg) {
    if (cfg && cfg.bootstrapUrl) return cfg.bootstrapUrl;
    var serverUrl = (cfg && cfg.serverUrl) ? cfg.serverUrl : DEFAULT_SERVER;
    try {
      var u = new URL(serverUrl);
      u.pathname = '/dashboard';
      u.search = '';
      return u.href;
    } catch (_) {
      return DEFAULT_SERVER + '/dashboard';
    }
  }

  // ── Immediate redirect ─────────────────────────────────────────────────────
  // The service worker (registered on a prior online session) intercepts this
  // navigation and serves the cached dashboard shell without network access.
  // navigator.onLine is intentionally NOT checked — Android WebView often
  // reports online=true even when the actual server is unreachable.
  go(DEFAULT_SERVER + '/dashboard');

  // ── Config-aware redirect ──────────────────────────────────────────────────
  // Load the baked-in config.json (staging vs. production URL). The fetch
  // callback is a no-op if the page already navigated away above.
  fetch('config.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; })
    .then(function (cfg) { go(getBootstrapUrl(cfg)); });

  // ── First-time offline fallback ────────────────────────────────────────────
  // If we're still on this page after 2.5 s the redirect failed (no service
  // worker cache yet — user has never opened the app online on this device).
  setTimeout(show, 2500);

  // ── Auto-retry when connectivity returns ───────────────────────────────────
  window.addEventListener('online', function () {
    go(DEFAULT_SERVER + '/dashboard');
  });
})();
