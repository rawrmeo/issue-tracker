/* ============================================================================
 * js/page-bin.js
 * ----------------------------------------------------------------------------
 * The Archive (admins only). Deleting an issue sets issues.deleted_at, so
 * the row leaves the board but is still in the database. This page lists those
 * rows and lets an admin restore one, or empty the archive for good.
 *
 * All three operations go through database functions so the admin check lives
 * in the database, not just the UI.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };
  var escapeHtml = ET.escapeHtml;

  var rows = [];

  function card(row) {
    var status = ET.STATUS_LABEL[row.status] || row.status;
    return '<article class="issue" data-id="' + escapeHtml(row.id) + '">' +
      '<div class="issue-top">' +
        '<span class="status-dot ' + escapeHtml(row.status) + '" title="' + escapeHtml(status) + '"></span>' +
        '<div class="issue-body">' +
          '<div class="issue-title">' + escapeHtml(row.title) + '</div>' +
          (row.description ? '<p class="issue-desc">' + escapeHtml(row.description) + '</p>' : '') +
          '<div class="issue-meta">' +
            '<span class="badge ' + escapeHtml(row.priority) + '">' + escapeHtml(row.priority) + '</span>' +
            '<span class="issue-date">Deleted ' + escapeHtml(ET.formatDate(Date.parse(row.deleted_at))) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="issue-actions">' +
          '<button class="btn ghost" type="button" data-action="restore">Restore</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function render() {
    var list = $('binList');
    var empty = $('binEmpty');
    var count = $('binCount');
    if (count) count.textContent = rows.length;

    if (!rows.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = rows.map(card).join('');
  }

  async function load() {
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.rpc('list_deleted_issues');
    if (res.error) { ET.toast('Could not load the archive: ' + ET.friendlyError(res.error)); return; }
    rows = res.data || [];
    render();
  }

  async function restore(id) {
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.rpc('restore_issue', { p_id: id });
    if (res.error) { ET.toast(ET.friendlyError(res.error)); return; }
    await load();
    ET.toast('Issue restored.');
  }

  async function emptyBin() {
    if (!rows.length) { ET.toast('The archive is already empty.'); return; }
    var ok = await ET.confirm('Permanently delete ' + rows.length + ' issue(s)? This cannot be undone.',
      { title: 'Empty archive', okLabel: 'Delete forever' });
    if (!ok) return;

    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.rpc('empty_recycle_bin');
    if (res.error) { ET.toast(ET.friendlyError(res.error)); return; }
    await load();
    ET.toast('Archive emptied.');
  }

  async function init() {
    var user = await ET.layout.render({ active: 'archive', title: 'Archive', requireAdmin: true });
    if (!user) return;

    $('binList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var article = btn.closest('.issue');
      if (article && btn.dataset.action === 'restore') restore(article.dataset.id);
    });
    $('binEmptyBtn').addEventListener('click', emptyBin);
    $('binRefreshBtn').addEventListener('click', function () { load(); ET.toast('Reloaded.'); });

    await load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
