/* ============================================================================
 * js/page-my-reports.js
 * ----------------------------------------------------------------------------
 * "My Reports" — the signed-in user's own issues, whatever their status,
 * including the ones an admin has already fixed and any message left for them.
 *
 * Read-only. Every signed-in user can open it (admins see their own too).
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };
  var escapeHtml = ET.escapeHtml;

  var mine = [];
  var filter = 'all';
  var q = '';

  function setText(id, value) { var el = $(id); if (el) el.textContent = value; }

  function mapIssue(row) {
    return {
      id: row.id,
      title: row.title || '',
      description: row.description || '',
      priority: row.priority || 'medium',
      status: ET.STATUSES.indexOf(row.status) !== -1 ? row.status : 'pending',
      label: row.label || '',
      authorId: row.author_id,
      createdAt: Date.parse(row.created_at) || 0,
      updatedAt: Date.parse(row.updated_at) || 0,
      adminNote: row.admin_note || '',
      adminNoteAt: row.admin_note_at ? Date.parse(row.admin_note_at) : 0
    };
  }

  function visible() {
    var needle = q.trim().toLowerCase();
    return mine.filter(function (it) {
      if (filter !== 'all' && it.status !== filter) return false;
      if (needle) {
        var hay = [it.title, it.description, it.label].filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(needle) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function card(it) {
    var status = ET.STATUS_LABEL[it.status] || it.status;
    var note = it.adminNote
      ? '<div class="admin-note"><b>Message from admin:</b> ' + escapeHtml(it.adminNote) +
        (it.adminNoteAt ? '<span class="when">' + escapeHtml(ET.timeAgo(it.adminNoteAt)) + '</span>' : '') +
        '</div>'
      : '';

    return '<article class="issue" data-id="' + escapeHtml(it.id) + '">' +
      '<div class="issue-top">' +
        '<span class="status-dot ' + escapeHtml(it.status) + '" title="' + escapeHtml(status) + '"></span>' +
        '<div class="issue-body">' +
          '<div class="issue-title">' + escapeHtml(it.title) + '</div>' +
          (it.description ? '<p class="issue-desc">' + escapeHtml(it.description) + '</p>' : '') +
          note +
          '<div class="issue-meta">' +
            '<span class="badge ' + escapeHtml(it.priority) + '">' + escapeHtml(it.priority) + '</span>' +
            (it.label ? '<span class="badge">' + escapeHtml(it.label) + '</span>' : '') +
            '<span class="badge">' + escapeHtml(status) + '</span>' +
            '<span class="issue-date">Reported ' + escapeHtml(ET.formatDate(it.createdAt)) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function render() {
    setText('myTotal', mine.length);
    setText('myPending', mine.filter(function (i) { return i.status === 'pending'; }).length);
    setText('myFixing', mine.filter(function (i) { return i.status === 'fixing'; }).length);
    setText('myDone', mine.filter(function (i) { return i.status === 'done'; }).length);

    var list = visible();
    var listEl = $('myList');
    var emptyEl = $('myEmpty');

    if (!list.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      $('myEmptyTitle').textContent = mine.length
        ? 'Nothing matches that filter'
        : 'You have not reported anything yet';
      $('myEmptyText').textContent = mine.length
        ? 'Try another status or clear the search.'
        : 'Reports you file on the Issues page appear here.';
      return;
    }

    emptyEl.hidden = true;
    listEl.innerHTML = list.map(card).join('');
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('.seg[data-filter]'), function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.seg[data-filter]'), function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        filter = btn.dataset.filter;
        render();
      });
    });

    var timer = null;
    $('mySearch').addEventListener('input', function (e) {
      clearTimeout(timer);
      var v = e.target.value;
      timer = setTimeout(function () { q = v; render(); }, 120);
    });
  }

  async function init() {
    var user = await ET.layout.render({ active: 'my-reports', title: 'My Reports' });
    if (!user) return;

    var sb = ET.getClient();
    if (!sb) return;

    var res = await sb.from('issues').select('*').order('updated_at', { ascending: false });
    if (res.error) {
      ET.toast('Could not load your reports: ' + ET.friendlyError(res.error));
      return;
    }

    mine = (res.data || []).map(mapIssue).filter(function (it) {
      return it.authorId === user.id;
    });

    bind();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
