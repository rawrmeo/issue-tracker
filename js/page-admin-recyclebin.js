/* ============================================================================
 * js/page-admin-recyclebin.js
 * ----------------------------------------------------------------------------
 * ADMIN ONLY. The bin itself lives in the database (see sql/recycle_bin.sql).
 *
 * Deleting an issue no longer removes it: it is stamped with deleted_at, which
 * drops it out of every list because the SELECT policy only shows rows where
 * deleted_at is null. This page is the way back — restore one, or remove it
 * for good.
 *
 * All four actions are database functions that re-check the admin role
 * themselves, so this page cannot do more than the database allows.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };

  var items = [];
  var escapeHtml = ET.escapeHtml;
  var toast = ET.toast;

  function client() { return ET.getClient(); }

  function setStatus(text) {
    var el = $('binStatus');
    if (el) el.textContent = text || '';
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  /** The SQL half not run yet? Say exactly that rather than showing a raw error. */
  function notInstalled(error) {
    var msg = String((error && error.message) || '');
    return /Could not find the function|PGRST202|deleted_at|schema cache/i.test(msg);
  }

  /* ------------------------------- loading ------------------------------- */

  async function loadBin() {
    var sb = client();
    if (!sb) return;

    var res = await sb.rpc('list_deleted_issues');

    if (res.error) {
      if (notInstalled(res.error)) {
        setStatus('The recycle bin is not set up yet. Run sql/recycle_bin.sql in the Supabase SQL Editor, then reload this page.');
      } else {
        setStatus(ET.friendlyError(res.error));
      }
      return;
    }

    items = res.data || [];
    renderList();
  }

  /* ------------------------------ rendering ------------------------------ */

  function statusChip(status) {
    var label = ET.STATUS_LABEL[status] || status;
    return '<span class="role-chip role-admin">' + escapeHtml(label) + '</span>';
  }

  function renderList() {
    var list = $('binList');
    if (!list) return;

    setText('binCount', items.length);

    var emptyBtn = $('emptyBtn');
    if (emptyBtn) emptyBtn.disabled = items.length === 0;

    if (!items.length) {
      list.innerHTML = '<p class="muted">Nothing here. Deleted issues will collect in this bin ' +
        'instead of disappearing, and can be put back at any time.</p>';
      setStatus('The recycle bin is empty.');
      return;
    }

    list.innerHTML = items.map(function (it) {
      var deleted = Date.parse(it.deleted_at);
      var created = Date.parse(it.created_at);

      return (
        '<div class="user-row" data-id="' + escapeHtml(it.id) + '">' +
          '<div class="user-info">' +
            '<span class="user-name">' + escapeHtml(it.title) + '</span>' +
            statusChip(it.status) +
            '<span class="role-chip role-user">' + escapeHtml(it.priority) + '</span>' +
            '<span class="issue-date">' +
              'by ' + escapeHtml(it.author_name) +
              ' &middot; reported ' + escapeHtml(ET.formatDate(created)) +
              ' &middot; deleted ' + escapeHtml(ET.timeAgo(deleted)) +
            '</span>' +
          '</div>' +
          '<div class="user-actions">' +
            '<button class="btn primary" type="button" data-action="restore">Restore</button>' +
            '<button class="btn danger" type="button" data-action="purge">Delete for good</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    setStatus(items.length + ' deleted issue' + (items.length === 1 ? '' : 's') +
      ' \u2014 newest deleted ' + ET.timeAgo(Date.parse(items[0].deleted_at)) + '.');
  }

  /* ------------------------------- actions ------------------------------- */

  async function restore(it) {
    var ok = await ET.confirm(
      'Put \u201c' + it.title + '\u201d back on the board?',
      { title: 'Restore issue', okLabel: 'Restore', danger: false }
    );
    if (!ok) return;

    var sb = client();
    if (!sb) return;

    var row = document.querySelector('.user-row[data-id="' + it.id + '"]');
    var btn = row ? row.querySelector('button[data-action="restore"]') : null;
    ET.setBusy(btn, true, 'Restoring\u2026');

    var res = await sb.rpc('restore_issue', { p_id: it.id });
    ET.setBusy(btn, false);

    if (res.error) { toast(ET.friendlyError(res.error)); return; }

    await loadBin();
    toast('Restored.');
  }

  async function purge(it) {
    var ok = await ET.confirm(
      'Delete \u201c' + it.title + '\u201d for good?\n\nThis one cannot be undone \u2014 the issue and its history are gone.',
      { title: 'Delete for good', okLabel: 'Delete for good' }
    );
    if (!ok) return;

    var sb = client();
    if (!sb) return;

    var res = await sb.rpc('purge_issue', { p_id: it.id });
    if (res.error) { toast(ET.friendlyError(res.error)); return; }

    await loadBin();
    toast('Deleted for good.');
  }

  async function emptyBin() {
    if (!items.length) return;

    var ok = await ET.confirm(
      'Delete all ' + items.length + ' issue(s) in the bin for good?\n\n' +
      'This cannot be undone. If you are not sure, restore the ones you want back first.',
      { title: 'Empty the recycle bin', okLabel: 'Delete all ' + items.length }
    );
    if (!ok) return;

    var sb = client();
    if (!sb) return;

    var btn = $('emptyBtn');
    ET.setBusy(btn, true, 'Emptying\u2026');

    var res = await sb.rpc('empty_recycle_bin');
    ET.setBusy(btn, false);

    if (res.error) { toast(ET.friendlyError(res.error)); return; }

    await loadBin();
    toast('Recycle bin emptied.');
  }

  /* -------------------------------- wiring ------------------------------- */

  function bindEvents() {
    var refreshBtn = $('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { loadBin(); });

    var emptyBtn = $('emptyBtn');
    if (emptyBtn) emptyBtn.addEventListener('click', emptyBin);

    var list = $('binList');
    if (!list) return;

    list.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (!button) return;

      var row = button.closest('.user-row');
      if (!row) return;

      var it = items.filter(function (x) { return x.id === row.dataset.id; })[0];
      if (!it) return;

      if (button.dataset.action === 'restore') restore(it);
      else if (button.dataset.action === 'purge') purge(it);
    });
  }

  /* --------------------------------- boot -------------------------------- */

  async function init() {
    var user = await ET.layout.render({
      active: 'admin-recyclebin',
      title: 'Recycle bin',
      requireAdmin: true
    });
    if (!user) return;

    if (!ET.isConfigured()) {
      setStatus('Supabase is not configured, so the recycle bin is unavailable.');
      return;
    }

    bindEvents();
    await loadBin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
