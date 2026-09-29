/* ============================================================================
 * js/install.js
 * ----------------------------------------------------------------------------
 * "Install app" button.
 *
 *   Chrome / Edge / Android fire a "beforeinstallprompt" event we can trigger
 *   from our own button. Safari has no such event, so there the button explains
 *   what to tap instead. In every case the button hides once the app is
 *   installed (or is already running as an installed app).
 *
 * Any element carrying [data-install-btn] is wired automatically, so the same
 * button can live in the sidebar and on the sign-in page.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;

  var installPrompt = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function buttons() { return document.querySelectorAll('[data-install-btn]'); }

  function refresh() {
    var show = !isStandalone() && Boolean(installPrompt || isIOS());
    Array.prototype.forEach.call(buttons(), function (b) { b.hidden = !show; });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();                 // ask in our own time, from our own button
    installPrompt = e;
    refresh();
  });

  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    refresh();
    if (ET.toast) ET.toast('App installed');
  });

  if (window.matchMedia) {
    try {
      window.matchMedia('(display-mode: standalone)').addEventListener('change', refresh);
    } catch (e) { /* older browsers */ }
  }

  function doInstall() {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted' && ET.toast) ET.toast('Installing…');
        installPrompt = null;
        refresh();
      });
      return;
    }

    window.alert('Install this app on your phone\n\n' +
      'iPhone / iPad:\n' +
      '  1. Tap the Share button (square with an arrow)\n' +
      '  2. Scroll down and tap "Add to Home Screen"\n' +
      '  3. Tap Add\n\n' +
      'Android:\n' +
      '  Open the browser menu and tap "Install app",\n' +
      '  or "Add to Home screen".');
  }

  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    var btn = target.closest('[data-install-btn]');
    if (!btn) return;
    e.preventDefault();
    doInstall();
  });

  ET.install = { refresh: refresh, isStandalone: isStandalone };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})();
