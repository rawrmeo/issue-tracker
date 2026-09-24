/* ============================================================================
 * js/page-issues.js
 * ----------------------------------------------------------------------------
 * The Issues page. Every function below is MOVED from app.js, with only these
 * changes:
 *   - currentUser        -> ET.auth.user
 *   - isAdmin()          -> ET.auth.isAdmin()
 *   - toast()            -> ET.toast()
 *   - stat card updates   -> guarded (those cards now live on the dashboard)
 *   - renderUsers()/setUserRole() removed (they moved to page-users.js)
 *   - auth / theme / view-switching functions removed (js/auth.js + layout.js)
 *   - window.confirm      -> ET.confirm() modal
 * No behaviour was changed.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };

  var ADMIN = ET.ADMIN;
  var USER = ET.USER;
  var STATUSES = ET.STATUSES;
  var STATUS_LABEL = ET.STATUS_LABEL;
  var PRIORITY_RANK = ET.PRIORITY_RANK;

  /* ------------------------------- state --------------------------------- */

  var issues = [];
  var profiles = [];
  var profileById = new Map();
  var editingId = null;
  var channel = null;
  var refreshing = false;

  var filters = { status: 'all', priority: 'all', q: '', sort: 'newest' };

  var isAdmin = function () { return ET.auth.isAdmin(); };
  var currentUser = function () { return ET.auth.user; };
  var canManage = function (issue) {
    var u = ET.auth.user;
    return !!u && (isAdmin() || issue.authorId === u.id);
  };

  /* ------------------------------ helpers -------------------------------- */

  var escapeHtml = ET.escapeHtml;
  var formatDate = ET.formatDate;
  var toast = ET.toast;

  /** Stat cards moved to the dashboard, so only update them if present. */
  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  var authorName = function (id) {
    var p = profileById.get(id);
    return p ? p.username : 'unknown';
  };

  function mapIssue(row) {
    return {
      id: row.id,
      title: row.title || '',
      description: row.description || '',
      priority: ['low', 'medium', 'high'].indexOf(row.priority) !== -1 ? row.priority : 'medium',
      status: STATUSES.indexOf(row.status) !== -1 ? row.status : 'pending',
      label: row.label || '',
      authorId: row.author_id,
      createdAt: Date.parse(row.created_at) || 0,
      updatedAt: Date.parse(row.updated_at) || 0,
      completedAt: row.completed_at ? Date.parse(row.completed_at) : null
    };
  }

  /* -------------------------------- data --------------------------------- */

  async function refresh(opts) {
    var silent = !!(opts && opts.silent);
    if (refreshing) return;
    var sb = ET.getClient();
    if (!sb || !ET.auth.user) return;
    refreshing = true;
    try {
      var results = await Promise.all([
        sb.from('issues').select('*').order('created_at', { ascending: false }),
        sb.from('profiles').select('id, username, role, created_at').order('created_at', { ascending: true })
      ]);
      var issueRes = results[0], profileRes = results[1];

      if (issueRes.error) {
        console.error(issueRes.error);
        toast('Could not load issues: ' + ET.friendlyError(issueRes.error));
      } else {
        issues = (issueRes.data || []).map(mapIssue);
      }

      if (profileRes.error) {
        console.error(profileRes.error);
      } else {
        profiles = profileRes.data || [];
        profileById = new Map(profiles.map(function (p) { return [p.id, p]; }));
      }

      renderIssues();
      if (!silent) flashLive();
    } catch (e) {
      console.error(e);
      toast('Could not reach the database.');
    } finally {
      refreshing = false;
    }
  }

  function flashLive() {
    var dot = $('liveDot');
    if (!dot) return;
    dot.classList.add('pulse');
    setTimeout(function () { dot.classList.remove('pulse'); }, 600);
  }

  /* --------------------------------- alerts ------------------------------
   * A change to an issue shows up as a card in the corner for everyone
   * looking at the board - including the admin who made it, so there is no
   * doubt the write landed. Built with inline styles on purpose: it stays in
   * this one file rather than needing its own stylesheet on every page.
   * --------------------------------------------------------------------- */
  var ALERT_COLOUR = {
    created: '#4f46e5',
    pending: '#b45309',
    fixing:  '#2563eb',
    done:    '#15803d',
    removed: '#dc2626'
  };

  function alertHost() {
    var host = $('issueAlerts');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'issueAlerts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.style.cssText =
      'position:fixed;top:.9rem;right:.9rem;z-index:80;display:flex;flex-direction:column;' +
      'gap:.5rem;max-width:min(92vw,340px);pointer-events:none;';
    document.body.appendChild(host);
    return host;
  }

  /* Who cares about this change? A reporter only about their own issues; an
     admin about everything on the board. */
  function worthNotifying(row) {
    if (isAdmin()) return true;
    var me = ET.auth && ET.auth.user && ET.auth.user.id;
    return Boolean(row && row.author_id && me && row.author_id === me);
  }

  /** Add it to the bell list as well as the corner alert. */
  function notify(kind, title, body, row) {
    if (!ET.notifications || !ET.notifications.push) return;
    if (!worthNotifying(row)) return;
    ET.notifications.push({ kind: kind, title: title, body: body });
  }

  /* A status change WE made, remembered for a minute.
     Our own update refreshes the list immediately, so by the time the realtime
     event comes back the cached status is already the new one and the change
     would look like no change at all. This keeps "what it was" for our own
     writes, so the bell still rings for them. */
  var myStatusChanges = {};

  function rememberMyStatusChange(id, from, to) {
    if (!id) return;
    myStatusChanges[id] = { from: from, to: to, at: Date.now() };
  }

  function takeMyStatusChange(id) {
    var entry = myStatusChanges[id];
    if (!entry) return null;
    delete myStatusChanges[id];
    if (Date.now() - entry.at > 60000) return null;
    return entry;
  }

  function showAlert(kind, heading, detail) {
    var card = document.createElement('div');
    card.style.cssText =
      'pointer-events:auto;cursor:pointer;background:var(--surface);border:1px solid var(--border);' +
      'border-left:4px solid ' + (ALERT_COLOUR[kind] || ALERT_COLOUR.created) + ';border-radius:10px;' +
      'padding:.7rem .85rem;box-shadow:0 10px 30px rgba(16,20,30,.22);font-size:.85rem;' +
      'opacity:0;transform:translateY(-6px);transition:opacity .18s,transform .18s;';

    var headingEl = document.createElement('strong');
    headingEl.textContent = heading;
    headingEl.style.cssText = 'display:block;';
    card.appendChild(headingEl);

    if (detail) {
      var detailEl = document.createElement('div');
      detailEl.textContent = detail;
      detailEl.style.cssText = 'color:var(--muted);margin-top:.15rem;word-break:break-word;';
      card.appendChild(detailEl);
    }

    alertHost().appendChild(card);
    requestAnimationFrame(function () {
      card.style.opacity = '1';
      card.style.transform = 'none';
    });

    function dismiss() {
      card.style.opacity = '0';
      card.style.transform = 'translateY(-6px)';
      setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 220);
    }

    card.addEventListener('click', dismiss);   // click to dismiss early
    setTimeout(dismiss, 8000);
  }

  function subscribeRealtime() {
    var sb = ET.getClient();
    if (!sb) return;
    if (channel) { try { sb.removeChannel(channel); } catch (e) { /* ignore */ } }
    channel = sb.channel('tracker-issues')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'issues' },
        function (payload) {
          var row = payload.new || {};
          flashLive();
          showAlert('created', 'New issue reported', row.title || '');
          notify('created', 'New issue reported', row.title || '', row);
          refresh({ silent: true });
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'issues' },
        function (payload) {
          var row = payload.new || {};
          var previous = payload.old || {};

          // With REPLICA IDENTITY FULL the event itself carries what the
          // status WAS, and that is the only reliable source: by the time this
          // event lands, the list may already have refreshed, in which case
          // our own cache holds the NEW value and the change looks like none.
          var wasStatus = previous.status;
          if (!wasStatus) {
            var mine = takeMyStatusChange(row.id);
            if (mine) wasStatus = mine.from;
          }
          if (!wasStatus) {
            var cached = issues.filter(function (i) { return i.id === row.id; })[0];
            wasStatus = cached ? cached.status : null;
          }

          // Alert on a status change only - an edit that leaves the status
          // alone should not shout.
          if (row.status && wasStatus && wasStatus !== row.status) {
            var label = 'Status changed to ' + (STATUS_LABEL[row.status] || row.status);
            flashLive();
            showAlert(row.status, label, row.title || '');
            notify(row.status, label, row.title || '', row);
          }
          refresh({ silent: true });
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'issues' },
        function (payload) {
          var row = payload.old || {};
          // With REPLICA IDENTITY FULL this carries the whole old row, so the
          // title is there and a reporter can be told which issue went.
          flashLive();
          showAlert('removed', 'Issue removed', row.title || 'An issue was removed.');
          notify('removed', 'Issue removed', row.title || '', row);
          refresh({ silent: true });
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' },
        function () { refresh({ silent: true }); })
      .subscribe(function (status) {
        var dot = $('liveDot');
        if (!dot) return;
        dot.classList.toggle('on', status === 'SUBSCRIBED');
        dot.title = status === 'SUBSCRIBED' ? 'Live updates on' : 'Live updates: ' + status;
      });
  }

  /* -------------------------------- form --------------------------------- */

  function formHintText() {
    return isAdmin()
      ? 'Fill in the title, choose a status, and save.'
      : 'Describe the problem. An admin will pick it up and mark it fixed.';
  }

  function resetIssueForm() {
    editingId = null;
    $('issueForm').reset();
    $('issuePriority').value = 'medium';
    $('issueStatus').value = 'pending';
    $('issueSubmit').textContent = isAdmin() ? 'Add issue' : 'Report issue';
    $('issueCancel').hidden = true;
    $('formTitle').textContent = isAdmin() ? 'Add an issue' : 'Report an issue';
    $('formHint').textContent = formHintText();
  }

  function startEdit(id) {
    var issue = issues.filter(function (i) { return i.id === id; })[0];
    if (!issue || !canManage(issue)) return;

    editingId = id;
    $('issueTitle').value = issue.title;
    $('issueDescription').value = issue.description || '';
    $('issuePriority').value = issue.priority;
    $('issueStatus').value = issue.status;
    $('issueLabel').value = issue.label || '';
    $('issueSubmit').textContent = 'Save changes';
    $('issueCancel').hidden = false;
    $('formTitle').textContent = 'Edit issue';
    $('formHint').textContent = isAdmin()
      ? 'Update the details or change the status, then save.'
      : 'Update your report, then save.';
    $('issueTitle').focus();
    var panel = document.querySelector('#issueFormPanel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleIssueSubmit(event) {
    event.preventDefault();
    var u = ET.auth.user;
    if (!u) return;
    var sb = ET.getClient();
    if (!sb) return;

    var title = $('issueTitle').value.trim();
    if (!title) return;

    var base = {
      title: title,
      description: $('issueDescription').value.trim(),
      priority: $('issuePriority').value,
      label: $('issueLabel').value.trim()
    };

    var button = $('issueSubmit');
    button.disabled = true;
    try {
      if (editingId) {
        var patch = Object.assign({}, base);
        // The database rejects this for non-admins anyway; not sending it
        // keeps the request honest.
        if (isAdmin()) patch.status = $('issueStatus').value;

        if (patch.status) {
          var wasIssue = issues.filter(function (i) { return i.id === editingId; })[0];
          rememberMyStatusChange(editingId, wasIssue ? wasIssue.status : null, patch.status);
        }

        var upd = await sb.from('issues').update(patch).eq('id', editingId);
        if (upd.error) { toast(ET.friendlyError(upd.error)); return; }

        resetIssueForm();
        await refresh({ silent: true });
        toast('Issue updated.');
        return;
      }

      var chosen = $('issueStatus').value;
      var status = isAdmin() && STATUSES.indexOf(chosen) !== -1 ? chosen : 'pending';

      var ins = await sb.from('issues').insert(Object.assign({}, base, {
        status: status,
        author_id: u.id
      }));
      if (ins.error) { toast(ET.friendlyError(ins.error)); return; }

      resetIssueForm();
      await refresh({ silent: true });
      toast(isAdmin() ? 'Issue added.' : 'Issue reported. An admin will review it.');
    } catch (e) {
      console.error(e);
      toast('Could not save the issue.');
    } finally {
      button.disabled = false;
    }
  }

  /* ------------------------------ mutations ------------------------------ */

  async function setStatus(id, status) {
    if (!isAdmin()) {
      toast('Only admins can change the status.');
      await refresh({ silent: true });   // snap the control back
      return;
    }
    if (STATUSES.indexOf(status) === -1) return;
    var sb = ET.getClient();
    if (!sb) return;

    var current = issues.filter(function (i) { return i.id === id; })[0];
    rememberMyStatusChange(id, current ? current.status : null, status);

    var res = await sb.from('issues').update({ status: status }).eq('id', id);
    if (res.error) toast(ET.friendlyError(res.error));
    else toast('Status changed to ' + STATUS_LABEL[status] + '.');
    await refresh({ silent: true });
  }

  /* The SQL half of the recycle bin not run yet? Say exactly that rather than
     letting "Could not find the function ... in the schema cache" through. */
  function friendlyWriteError(error) {
    var m = String((error && error.message) || '');
    if (/Could not find the function|PGRST202/i.test(m)) {
      return 'The recycle bin is not set up yet. Run sql/recycle_bin.sql in the Supabase SQL Editor, then reload this page.';
    }
    if (/deleted_at|schema cache.*column/i.test(m)) {
      return 'The recycle bin is not set up yet. Run sql/recycle_bin.sql in the Supabase SQL Editor, then reload this page.';
    }
    return ET.friendlyError(error);
  }

  async function deleteIssue(id) {
    var issue = issues.filter(function (i) { return i.id === id; })[0];
    if (!issue) return;
    if (!canManage(issue)) { toast('You can only delete your own issues.'); return; }

    var ok = await ET.confirm('Move “' + issue.title + '” to the recycle bin? An admin can put it back.',
      { title: 'Delete issue', okLabel: 'Move to bin' });
    if (!ok) return;

    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.rpc('soft_delete_issue', { p_id: id });
    if (res.error) { toast(friendlyWriteError(res.error)); return; }
    if (editingId === id) resetIssueForm();
    await refresh({ silent: true });
    toast('Moved to the recycle bin.');
  }

  async function clearDone() {
    if (!isAdmin()) { toast('Only admins can clear done issues.'); return; }
    var done = issues.filter(function (i) { return i.status === 'done'; });
    if (!done.length) { toast('No done issues to clear.'); return; }

    var ok = await ET.confirm('Move ' + done.length + ' done issue(s) to the recycle bin? An admin can put them back.',
      { title: 'Clear done issues', okLabel: 'Move ' + done.length + ' to bin' });
    if (!ok) return;

    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.rpc('soft_delete_done');
    if (res.error) { toast(friendlyWriteError(res.error)); return; }
    await refresh({ silent: true });
    toast('Moved ' + done.length + ' issue(s) to the recycle bin.');
  }

  /* ------------------------------ rendering ------------------------------ */

  function visibleIssues() {
    var q = filters.q.trim().toLowerCase();
    var list = issues.filter(function (issue) {
      if (filters.status !== 'all' && issue.status !== filters.status) return false;
      if (filters.priority !== 'all' && issue.priority !== filters.priority) return false;
      if (q) {
        var haystack = [issue.title, issue.description, issue.label, authorName(issue.authorId)]
          .filter(Boolean).join(' ').toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
      }
      return true;
    });

    var u = ET.auth.user;
    var sorters = {
      newest: function (a, b) { return b.createdAt - a.createdAt; },
      oldest: function (a, b) { return a.createdAt - b.createdAt; },
      priority: function (a, b) {
        return (PRIORITY_RANK[a.priority] == null ? 3 : PRIORITY_RANK[a.priority]) -
               (PRIORITY_RANK[b.priority] == null ? 3 : PRIORITY_RANK[b.priority]) ||
               b.createdAt - a.createdAt;
      },
      title: function (a, b) { return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }); }
    };
    return list.sort(sorters[filters.sort] || sorters.newest);
  }

  function issueCard(issue) {
    var admin = isAdmin();
    var u = ET.auth.user;
    var mine = !!u && issue.authorId === u.id;
    var status = issue.status;

    var statusControl = admin
      ? '<select class="status-select status-' + status + '" data-action="status" aria-label="Set status">' +
          STATUSES.map(function (s) {
            return '<option value="' + s + '"' + (status === s ? ' selected' : '') + '>' +
              STATUS_LABEL[s] + '</option>';
          }).join('') +
        '</select>'
      : '<span class="status-dot ' + status + '" title="' + STATUS_LABEL[status] +
        '" aria-label="Status: ' + STATUS_LABEL[status] + '"></span>';

    var label = issue.label
      ? '<span class="badge">' + escapeHtml(issue.label) + '</span>'
      : '';

    var description = issue.description
      ? '<p class="issue-desc">' + escapeHtml(issue.description) + '</p>'
      : '';

    var actions = canManage(issue)
      ? '<div class="issue-actions">' +
          '<button class="btn ghost" type="button" data-action="edit">Edit</button>' +
          '<button class="btn ghost danger" type="button" data-action="delete">Delete</button>' +
        '</div>'
      : '';

    return (
      '<article class="issue" data-id="' + escapeHtml(issue.id) + '"' +
        ' data-status="' + escapeHtml(status) + '"' +
        ' data-priority="' + escapeHtml(issue.priority) + '">' +
        '<div class="issue-top">' +
          statusControl +
          '<div class="issue-body">' +
            '<div class="issue-title">' + escapeHtml(issue.title) + '</div>' +
            description +
            '<div class="issue-meta">' +
              '<span class="badge ' + escapeHtml(issue.priority) + '">' + escapeHtml(issue.priority) + '</span>' +
              label +
              '<span class="issue-author">by ' + escapeHtml(authorName(issue.authorId)) + '</span>' +
              (mine ? '<span class="badge mine">your report</span>' : '') +
              '<span class="issue-date">Created ' + escapeHtml(formatDate(issue.createdAt)) + '</span>' +
            '</div>' +
          '</div>' +
          actions +
        '</div>' +
      '</article>'
    );
  }

  function renderIssues() {
    var total = issues.length;
    var done = issues.filter(function (i) { return i.status === 'done'; }).length;
    var fixing = issues.filter(function (i) { return i.status === 'fixing'; }).length;
    var pending = total - done - fixing;
    var high = issues.filter(function (i) {
      return i.priority === 'high' && i.status !== 'done';
    }).length;

    setText('statTotal', total);
    setText('statPending', pending);
    setText('statFixing', fixing);
    setText('statDone', done);
    setText('statHigh', high);

    var list = visibleIssues();
    var listEl = $('issueList');
    var emptyEl = $('emptyState');

    if (!list.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      if (!total) {
        $('emptyTitle').textContent = 'No issues yet';
        $('emptyText').textContent = isAdmin()
          ? 'Add the first issue using the form above.'
          : 'Report your first issue using the form above.';
      } else {
        $('emptyTitle').textContent = 'No matching issues';
        $('emptyText').textContent = 'Try changing the filters or search text.';
      }
      return;
    }

    emptyEl.hidden = true;
    listEl.innerHTML = list.map(issueCard).join('');
  }

  /* -------------------------------- events ------------------------------- */

  function exportBackup() {
    if (!isAdmin()) { toast('Only admins can export.'); return; }
    var payload = issues.map(function (i) {
      return {
        id: i.id, title: i.title, description: i.description,
        priority: i.priority, status: i.status, label: i.label,
        reporter: authorName(i.authorId),
        createdAt: new Date(i.createdAt).toISOString(),
        completedAt: i.completedAt ? new Date(i.completedAt).toISOString() : null
      };
    });
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'issues-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported ' + payload.length + ' issue(s).');
  }

  function applyRoleUi() {
    // In the multi-page shell the role lives in the sidebar; this also hides
    // the admin-only toolbar buttons and locks the status field.
    var admin = isAdmin();

    Array.prototype.forEach.call(document.querySelectorAll('.admin-only'), function (el) {
      el.hidden = !admin;
    });

    var banner = $('roleBanner');
    if (banner) {
      if (admin) banner.hidden = true;
      else {
        var u = ET.auth.user;
        banner.hidden = false;
        banner.className = 'banner info';
        banner.innerHTML =
          'Signed in as <strong>' + escapeHtml(u.username) + '</strong> (user). ' +
          'Report issues and manage your own. Only admins can set an issue to ' +
          '<strong>Fixing</strong> or <strong>Done</strong> — this is enforced by the database.';
      }
    }
    var statusField = $('statusField');
    if (statusField) statusField.hidden = !admin;
  }

  function bindEvents() {
    $('issueForm').addEventListener('submit', handleIssueSubmit);
    $('issueCancel').addEventListener('click', function () {
      resetIssueForm();
      toast('Edit cancelled.');
    });

    $('issueList').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (!button) return;
      var card = button.closest('.issue');
      if (!card) return;
      if (button.dataset.action === 'edit') startEdit(card.dataset.id);
      else if (button.dataset.action === 'delete') deleteIssue(card.dataset.id);
    });

    $('issueList').addEventListener('change', function (event) {
      var select = event.target.closest('select[data-action="status"]');
      if (!select) return;
      var card = select.closest('.issue');
      if (card) setStatus(card.dataset.id, select.value);
    });

    $('clearDoneBtn').addEventListener('click', clearDone);
    $('refreshBtn').addEventListener('click', async function () {
      await refresh();
      toast('Reloaded from the database.');
    });
    $('exportBtn').addEventListener('click', exportBackup);

    Array.prototype.forEach.call(document.querySelectorAll('.seg[data-filter="status"]'), function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.seg[data-filter="status"]'), function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        filters.status = btn.dataset.value;
        renderIssues();
      });
    });

    $('priorityFilter').addEventListener('change', function (e) {
      filters.priority = e.target.value;
      renderIssues();
    });

    $('sortSelect').addEventListener('change', function (e) {
      filters.sort = e.target.value;
      renderIssues();
    });

    var searchTimer = null;
    $('searchInput').addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      var value = e.target.value;
      searchTimer = setTimeout(function () { filters.q = value; renderIssues(); }, 120);
    });
  }

  /* --------------------------------- init -------------------------------- */

  async function init() {
    var user = await ET.layout.render({ active: 'issues', title: 'Issues' });
    if (!user) return;

    applyRoleUi();
    resetIssueForm();
    bindEvents();

    await refresh({ silent: true });
    subscribeRealtime();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
