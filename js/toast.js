/* ============================================================================
 * js/toast.js
 * ----------------------------------------------------------------------------
 * The same toast behaviour app.js used, so the existing #toast styling in
 * styles.css keeps working. app.js's toast() set the text, unhid the element,
 * added .show, and auto-hid after 3.2s — identical here.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};

  var timer = null;

  window.ET.toast = function (message, kind) {
    var el = document.getElementById('toast');
    if (!el) return;

    el.textContent = message;
    if (kind) el.dataset.kind = kind;
    else delete el.dataset.kind;

    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('show'); });

    clearTimeout(timer);
    timer = setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.hidden = true; }, 220);
    }, 3200);
  };
})();
