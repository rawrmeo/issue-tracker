/* ============================================================================
 * js/modal.js
 * ----------------------------------------------------------------------------
 * A small replacement for window.confirm() and a read-only info modal.
 * Creates its own <dialog> on first use, so no page markup is required.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};

  var dlg = null;
  var titleEl, bodyEl, okEl, cancelEl;

  function build() {
    if (dlg) return;

    dlg = document.createElement('dialog');
    dlg.className = 'et-modal';
    dlg.innerHTML =
      '<form method="dialog" class="et-modal-form">' +
        '<h3 class="et-modal-title"></h3>' +
        '<p class="et-modal-body"></p>' +
        '<div class="et-modal-actions">' +
          '<button type="button" class="btn ghost et-modal-cancel">Cancel</button>' +
          '<button type="button" class="btn primary et-modal-ok">Confirm</button>' +
        '</div>' +
      '</form>';

    document.body.appendChild(dlg);

    titleEl = dlg.querySelector('.et-modal-title');
    bodyEl = dlg.querySelector('.et-modal-body');
    okEl = dlg.querySelector('.et-modal-ok');
    cancelEl = dlg.querySelector('.et-modal-cancel');
  }

  /**
   * ET.confirm(message, opts) -> Promise<boolean>
   * opts: { title, okLabel, danger }
   */
  window.ET.confirm = function (message, opts) {
    opts = opts || {};
    build();

    return new Promise(function (resolve) {
      var settled = false;

      titleEl.textContent = opts.title || 'Are you sure?';
      bodyEl.textContent = message;
      okEl.textContent = opts.okLabel || 'Confirm';
      okEl.className = 'btn ' + (opts.danger === false ? 'primary' : 'danger');
      cancelEl.hidden = !!opts.infoOnly;
      okEl.textContent = opts.infoOnly ? 'OK' : okEl.textContent;

      function cleanup() {
        okEl.removeEventListener('click', onOk);
        cancelEl.removeEventListener('click', onCancel);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
      }
      function settle(v) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(v);
      }
      function onOk() { settle(true); }
      function onCancel() { settle(false); }
      function onClose() { settle(false); }

      okEl.addEventListener('click', onOk);
      cancelEl.addEventListener('click', onCancel);
      dlg.addEventListener('close', onClose);

      if (dlg.open) dlg.close();
      dlg.showModal();
    });
  };

  /** ET.info(title, message) -> Promise<true> */
  window.ET.info = function (title, message) {
    return window.ET.confirm(message, { title: title, infoOnly: true, okLabel: 'OK' });
  };
})();
