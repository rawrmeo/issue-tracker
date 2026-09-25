/* ============================================================================
 * js/page-my-reports.js
 * ----------------------------------------------------------------------------
 * "My reports" — every issue the signed-in user reported, whatever its status,
 * with a summary row and a status filter.
 *
 * Read-only: it never writes. Realtime keeps it current while the tab is open.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };
  var escapeHtml = ET.escapeHtml;

  var issues = [];
  var profileById = new Map();
  var filter = 'all';
  var channel = null;

  function mapIssue(row) {
    return {
      id: row.id,
      title: row.title || '',
      description: row.description || '',
      priority: ['low', 'medium', 'high'].indexOf(row.priority) !== -1 ? row.priority : 'medium',
      status: ET.STATUSES.indexOf(row.status) !== -1 ? row.status : 'pending',
      label: row.label || '',
      authorId: row.author_id,
      createdAt: Date.parse(row.created_at) || 0,
      updatedAt: Date.parse(row.updated_at) || 0,
      adminNote: row.admin_note || '',
      adminNoteAt: row.admin_note_at ? Date.parse(row.admin_note_at) : 0
    };
  }

  function mine() {
    var u = ET.auth.user;
    return issues.filter(function (i) { return u && i.authorId === u.id; });
  }

  function visible() {
    return mine()
      .filter(function (i) { return filter === 'all' ? true : i.status === filter; })
      .sort(function (a, b) {
        return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
      });
  }

  function stat(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  function card(it) {
    var status = it.status;
    var note = it.adminNote
      ? '<div class="admin-note"><b>Message from admin:</b> ' + escapeHtml(it.adminNote) +
          (it.adminNoteAt ? '<span class="when">' + escapeHtml(ET.timeAgo(it.adminNoteAt)) + '</span>' : '') +
        '</div>'
      : '';

    return '<article class="issue" data-id="' + escapeHtml(it.id) + '" data-status="' + escapeHtml(status) + '">' +
      '<div class="issue-top">' +
        '<span class="status-dot ' + escapeHtml(status) + '" title="' + escapeHtml(ET.STATUS_LABEL[status] || status) + '"' +
          ' aria-label="Status: ' + escapeHtml(ET.STATUS_LABEL[status] || status) + '"></span>' +
        '<div class="issue-body">' +
          '<div class="issue-title">' + escapeHtml(it.title) + '</div>' +
          (it.description ? '<p class="issue-desc">' + escapeHtml(it.description) + '</p>' : '') +
          note +
          '<div class="issue-meta">' +
            '<span class="badge ' + escapeHtml(it.priority) + '">' + escapeHtml(it.priority) + '</span>' +
            (it.label ? '<span class="badge">' + escapeHtml(it.label) + '</span>' : '') +
            '<span class="badge">' + escapeHtml(ET.STATUS_LABEL[status] || status) + '</span>' +
            '<span class="issue-date">Reported ' + escapeHtml(ET.formatDate(it.createdAt)) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function render() {
    var all = mine();
    stat('myTotal', all.length);
    stat('myPending', all.filter(function (i) { return i.status === 'pending'; }).length);
    stat('myFixing', all.filter(function (i) { return i.status === 'fixing'; }).length);
    stat('myDone', all.filter(function (i) { return i.status === 'done'; }).length);

    var list = visible();
    var listEl = $('myList');
    var empty = $('myEmpty');

    if (!list.length) {
      listEl.innerHTML = '';
      empty.hidden = false;
      $('myEmptyTitle').textContent = all.length ? 'Nothing in this filter' : 'No reports yet';
      $('myEmptyText').textContent = all.length
        ? 'Try a different status.'
        : 'Issues you report from the Issues page appear here.';
      return;
    }

    empty.hidden = true;
    listEl.innerHTML = list.map(card).join('');
  }

  function refresh() {
    var sb = ET.getClient();
    if (!sb || !ET.auth.user) return Promise.resolve();

    return sb.from('issues')
      .select('*')
      .eq('author_id', ET.auth.user.id)
      .order('updated_at', { ascending: false })
      .then(function (res) {
        if (res.error) { ET.toast('Could not load your reports: ' + ET.friendlyError(res.error)); return; }
        issues = (res.data || []).map(mapIssue);
        render();
      });
  }

  function subscribe() {
    var sb = ET.getClient();
    if (!sb || channel) return;
    try {
      channel = sb.channel('my-reports')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' },
          function () { refresh(); })
        .subscribe();
    } catch (e) { /* ignore */ }
  }

  async function init() {
    var user = await ET.layout.render({ active: 'my-reports', title: 'My reports' });
    if (!user) return;

    Array.prototype.forEach.call(document.querySelectorAll('[data-myfilter]'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('[data-myfilter]'), function (x) {
          x.classList.remove('active');
        });
        b.classList.add('active');
        filter = b.getAttribute('data-myfilter');
        render();
      });
    });

    var refreshBtn = $('myRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { refresh(); ET.toast('Reloaded.'); });

    await refresh();
    subscribe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
