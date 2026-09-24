/* ============================================================================
 * js/page-admin.js
 * ----------------------------------------------------------------------------
 * Loaded ONLY by the pages/admin-*.html pages, after js/page-issues.js.
 *
 * It does not render or fetch anything itself. It:
 *   1. sets the page title,
 *   2. clicks the page's status button so the EXISTING filter runs,
 *   3. adds a confirm step before a status is changed to Done.
 *
 * Both the list rendering and the status write come from js/page-issues.js
 * (issueCard / renderIssues / setStatus). Nothing parallel is written here.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };

  var TITLES = {
    pending: 'Pending issues',
    fixing: 'Issues being fixed',
    done: 'Done issues',
    all: 'All issues'
  };

  function pageStatus() {
    return document.body.dataset.adminStatus || '';
  }

  /**
   * An explicit data-admin-title on <body> wins over the status default, so a
   * page that shows several statuses at once can still name itself.
   */
  function pageTitle(status) {
    return document.body.dataset.adminTitle || TITLES[status] || '';
  }

  /* --------------- 1. click the EXISTING status filter button ------------ */

  function applyStatusFilter() {
    var status = pageStatus();
    if (!status || status === 'all') return;   // 'all' is the default state

    var seg = document.querySelector(
      '.seg[data-filter="status"][data-value="' + status + '"]'
    );
    if (!seg) return;
    if (!seg.classList.contains('active')) seg.click();   // existing handler
  }

  /**
   * page-issues.js binds its events asynchronously (it awaits layout.render
   * first), so wait until the list has actually rendered — by then the
   * buttons are definitely wired.
   */
  function waitForList(cb) {
    var tries = 0;
    (function tick() {
      var hasCards = document.querySelector('#issueList .issue');
      var emptyShown = $('emptyState') && !$('emptyState').hidden;
      if (hasCards || emptyShown || tries > 60) { cb(); return; }
      tries++;
      setTimeout(tick, 120);
    })();
  }

  /* ------------- 2. confirm before marking an issue Done ---------------- */

  function confirmBeforeDone() {
    var list = $('issueList');
    if (!list) return;

    var bypass = false;

    // Capture phase: runs BEFORE js/page-issues.js's own change handler.
    list.addEventListener('change', function (ev) {
      var sel = ev.target.closest('select[data-action="status"]');
      if (!sel) return;
      if (sel.value !== 'done') return;          // only guard "Done"
      if (bypass) { bypass = false; return; }    // second pass, let it through

      ev.stopPropagation();
      ev.preventDefault();

      var card = sel.closest('.issue');
      var prev = card ? (card.dataset.status || 'pending') : 'pending';
      var id = card ? String(card.dataset.id || '') : '';

      ET.confirm('Mark issue #' + id.slice(0, 8) + ' as done?', {
        title: 'Mark as done',
        okLabel: 'Mark done'
      }).then(function (ok) {
        if (ok) {
          bypass = true;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          sel.value = prev;
        }
      });
    }, true);
  }

  /* --------------------------------- boot -------------------------------- */

  /** These are ADMIN pages — send reporters back to the Issues page. */
  function guardAdmin() {
    var tries = 0;
    (function tick() {
      if (ET.auth && ET.auth.user) {
        if (!ET.auth.isAdmin()) ET.go('pages/issues.html');
        return;
      }
      if (tries++ > 80) return;
      setTimeout(tick, 100);
    })();
  }

  function init() {
    guardAdmin();

    var status = pageStatus();
    var title = pageTitle(status);

    if (title && ET.layout && ET.layout.setTitle) {
      ET.layout.setTitle(title);
    }

    confirmBeforeDone();

    waitForList(function () {
      applyStatusFilter();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
