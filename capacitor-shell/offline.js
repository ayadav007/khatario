/**
 * Capacitor errorPath fallback — no Capacitor plugins (plain WebView page).
 * On cold start offline, redirects into the cached remote app (service worker).
 * When online, probes the server and opens the normal login URL.
 */
(function () {
  var DEFAULT_SERVER = 'https://staging.khatario.com/login';
  var BOOTSTRAP_PARAM = 'khatario_offline_bootstrap';
  var serverUrl = DEFAULT_SERVER;
  var bootstrapUrl = '';
  var checking = false;
  var bootstrapAttempted = false;
  var root = document.getElementById('root');
  var statusEl = document.getElementById('status');
  var retryBtn = document.getElementById('retry');
  var bootstrapBtn = document.getElementById('bootstrap');

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  function setChecking(active) {
    checking = active;
    if (root) root.classList.toggle('checking', active);
    if (retryBtn) retryBtn.disabled = active;
    if (bootstrapBtn) bootstrapBtn.disabled = active;
  }

  function resolveBootstrapUrl(fromServerUrl) {
    try {
      var url = new URL(fromServerUrl);
      url.pathname = '/login';
      url.search = BOOTSTRAP_PARAM + '=1';
      return url.href;
    } catch (e) {
      var base = String(fromServerUrl || '').replace(/\/login\/?$/, '');
      return base + '/login?' + BOOTSTRAP_PARAM + '=1';
    }
  }

  /** Immediate redirect before async config load (cold start offline). */
  function bootstrapImmediately() {
    if (navigator.onLine) return;
    var target = resolveBootstrapUrl(serverUrl);
    window.location.replace(target);
  }

  function loadConfig() {
    return fetch('config.json', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (cfg) {
        if (cfg && cfg.bootstrapUrl) {
          bootstrapUrl = cfg.bootstrapUrl;
        }
        if (cfg && cfg.serverUrl) {
          serverUrl = cfg.serverUrl;
        }
        if (!bootstrapUrl) {
          bootstrapUrl = resolveBootstrapUrl(serverUrl);
        }
      })
      .catch(function () {
        bootstrapUrl = resolveBootstrapUrl(serverUrl);
      });
  }

  function probeServer(timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(false);
      }, timeoutMs);

      try {
        var url = new URL(serverUrl);
        var probe = url.origin + '/manifest.json';
        fetch(probe, { method: 'GET', cache: 'no-store', mode: 'cors' })
          .then(function (res) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(res.ok);
          })
          .catch(function () {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(false);
          });
      } catch (e) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    });
  }

  function redirectToApp() {
    setStatus('Connected — opening Khatario…');
    window.location.replace(serverUrl);
  }

  function tryBootstrapCachedApp(source) {
    if (!bootstrapUrl || bootstrapAttempted) return false;
    bootstrapAttempted = true;
    setStatus(
      source === 'auto'
        ? 'Opening offline app…'
        : 'Opening cached app — billing works offline after your first online sign-in.'
    );
    window.location.replace(bootstrapUrl);
    return true;
  }

  function showOfflineFallback() {
    if (root) root.classList.remove('checking');
    setStatus(
      bootstrapAttempted
        ? 'No cached app yet. Open Khatario once online, then offline billing works.'
        : 'Still offline. Open the cached app or reconnect and try again.'
    );
  }

  function tryConnect(source) {
    if (checking) return;
    setChecking(true);

    loadConfig().then(function () {
      if (!navigator.onLine) {
        setChecking(false);
        if (source === 'manual' && tryBootstrapCachedApp('manual')) {
          return;
        }
        showOfflineFallback();
        return;
      }

      setStatus('Checking connection…');
      probeServer(8000).then(function (ok) {
        setChecking(false);
        if (ok) {
          redirectToApp();
        } else {
          setStatus(
            source === 'auto'
              ? 'Waiting for connection…'
              : 'Could not reach Khatario. Try again shortly.'
          );
        }
      });
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      tryConnect('manual');
    });
  }

  if (bootstrapBtn) {
    bootstrapBtn.addEventListener('click', function () {
      bootstrapAttempted = false;
      tryBootstrapCachedApp('manual');
    });
  }

  window.addEventListener('online', function () {
    tryConnect('auto');
  });

  loadConfig().finally(function () {
    if (!navigator.onLine) {
      tryBootstrapCachedApp('auto');
      return;
    }
    tryConnect('boot');
  });

  bootstrapImmediately();
})();

