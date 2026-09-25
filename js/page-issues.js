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

  /* An issue that is not done and has been open a week or more. */
  var STALE_DAYS = 7;
  function openDays(issue) {
    if (!issue || !issue.createdAt) return 0;
    return Math.floor((Date.now() - issue.createdAt) / 86400000);
  }
  function isStale(issue) {
    return issue.status !== 'done' && openDays(issue) >= STALE_DAYS;
  }

  /* Admin bulk-action selection. */
  var selection = {};
  function selectedIds() {
    return Object.keys(selection).filter(function (id) {
      return issues.some(function (i) { return i.id === id; });
    });
  }

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
      completedAt: row.completed_at ? Date.parse(row.completed_at) : null,
      adminNote: row.admin_note || '',
      adminNoteAt: row.admin_note_at ? Date.parse(row.admin_note_at) : 0
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

  function subscribeRealtime() {
    var sb = ET.getClient();
    if (!sb) return;
    if (channel) { try { sb.removeChannel(channel); } catch (e) { /* ignore */ } }
    channel = sb.channel('tracker-issues')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' },
        function () { refresh({ silent: true }); })
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
    $('issueSubmit').textContent = 'Report issue';
    $('issueCancel').hidden = true;
    $('formTitle').textContent = 'Report an issue';
    $('formHint').textContent = formHintText();

    ['issueTitle', 'issueDescription', 'issueLabel', 'issuePriority'].forEach(function (id) {
      var field = $(id);
      if (field) field.disabled = false;
    });
    var noteField = $('noteField');
    if (noteField) noteField.hidden = true;
    var noteBox = $('issueNote');
    if (noteBox) noteBox.value = '';
    var lockBox = $('lockNote');
    if (lockBox) { lockBox.hidden = true; lockBox.textContent = ''; }
  }

  /* ---- small "message to the reporter" dialog (admins, others' issues) ---- */

  var noteId = null;

  function openNoteDialog(issue) {
    noteId = issue.id;
    $('noteWho').textContent = 'Reported by ' + authorName(issue.authorId) +
      '. The report itself is kept as written.';
    $('noteStatus').value = issue.status;
    $('notePriority').value = issue.priority;
    $('noteText').value = issue.adminNote || '';
    $('notePop').hidden = false;
    setTimeout(function () { $('noteText').focus(); }, 30);
  }

  function closeNoteDialog() {
    noteId = null;
    $('notePop').hidden = true;
  }

  async function saveNoteDialog() {
    if (!noteId || !isAdmin()) return;
    var issue = issues.filter(function (i) { return i.id === noteId; })[0];
    if (!issue) { closeNoteDialog(); return; }

    var sb = ET.getClient();
    if (!sb) return;

    var patch = {
      status: $('noteStatus').value,
      priority: $('notePriority').value
    };
    var note = $('noteText').value.trim();
    if (note !== (issue.adminNote || '')) {
      patch.admin_note = note;
      patch.admin_note_at = new Date().toISOString();
    }

    var btn = $('noteSave');
    btn.disabled = true;
    try {
      var res = await sb.from('issues').update(patch).eq('id', noteId);
      if (res.error && /admin_note|column .* does not exist/i.test(String(res.error.message || ''))) {
        delete patch.admin_note;
        delete patch.admin_note_at;
        res = await sb.from('issues').update(patch).eq('id', noteId);
      }
      if (res.error) { toast(ET.friendlyError(res.error)); return; }
      closeNoteDialog();
      await refresh({ silent: true });
      toast(note ? 'Message sent to the reporter.' : 'Issue updated.');
    } finally {
      btn.disabled = false;
    }
  }

  function startEdit(id) {
    var issue = issues.filter(function (i) { return i.id === id; })[0];
    if (!issue || !canManage(issue)) return;

    var u = ET.auth.user;
    var mine = !!u && issue.authorId === u.id;

    /* An admin opening someone else's issue gets the small comment dialog
       instead of the big form: the report itself stays exactly as written. */
    if (isAdmin() && !mine) { openNoteDialog(issue); return; }

    /* Once reported, the reporter's own words are kept — nobody rewrites the
       title and description of someone else's report. */
    var lockText = !mine;

    editingId = id;
    $('issueTitle').value = issue.title;
    $('issueDescription').value = issue.description || '';
    $('issuePriority').value = issue.priority;
    $('issueStatus').value = issue.status;
    $('issueLabel').value = issue.label || '';

    $('issueTitle').disabled = lockText;
    $('issueDescription').disabled = lockText;
    $('issueLabel').disabled = lockText;
    $('issuePriority').disabled = false;

    var lockBox = $('lockNote');
    if (lockBox) {
      lockBox.hidden = !lockText;
      lockBox.textContent = lockText
        ? 'Reported by ' + authorName(issue.authorId) +
          '. The title and description are kept as written — you can set the status, the priority, and leave a message.'
        : '';
    }

    var noteField = $('noteField');
    if (noteField) noteField.hidden = !isAdmin();
    var noteBox = $('issueNote');
    if (noteBox) noteBox.value = issue.adminNote || '';

    $('issueSubmit').textContent = 'Save changes';
    $('issueCancel').hidden = false;
    $('formTitle').textContent = 'Edit issue';
    $('formHint').textContent = isAdmin()
      ? 'Set the status or priority, and leave a message for the reporter.'
      : 'Update your report, then save.';
    if (!lockText) $('issueTitle').focus();
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
        var current = issues.filter(function (i) { return i.id === editingId; })[0];
        var iAmAuthor = !!current && !!u && current.authorId === u.id;

        // Only the reporter may rewrite the report itself; an admin still
        // triages priority. (Status is added below, admins only.)
        var patch = iAmAuthor ? Object.assign({}, base) : { priority: base.priority };
        if (isAdmin()) patch.status = $('issueStatus').value;

        // A message for the reporter — only sent when an admin changed it.
        if (isAdmin() && !$('noteField').hidden) {
          var note = $('issueNote').value.trim();
          var prevNote = current ? (current.adminNote || '') : '';
          if (note !== prevNote) {
            patch.admin_note = note;
            patch.admin_note_at = new Date().toISOString();
          }
        }

        var upd = await sb.from('issues').update(patch).eq('id', editingId);
        if (upd.error && /admin_note|column .* does not exist/i.test(String(upd.error.message || ''))) {
          // The admin-message migration has not been run yet — save the rest.
          delete patch.admin_note;
          delete patch.admin_note_at;
          upd = await sb.from('issues').update(patch).eq('id', editingId);
        }
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

    var res = await sb.from('issues').update({ status: status }).eq('id', id);
    if (res.error) toast(ET.friendlyError(res.error));
    else toast('Status changed to ' + STATUS_LABEL[status] + '.');
    await refresh({ silent: true });
  }

  /* Bin an issue. If the database has not had the recycle-bin migration yet,
     fall back to a real delete so the button keeps working. */
  async function binIssue(buildUpdate, buildDelete) {
    var sb = ET.getClient();
    if (!sb) return { error: null, fellBack: false };
    var res = await buildUpdate(sb);
    if (res.error && /deleted_at|column .* does not exist/i.test(String(res.error.message || ''))) {
      var hard = await buildDelete(sb);
      return { error: hard.error, fellBack: true };
    }
    return { error: res.error, fellBack: false };
  }

  async function deleteIssue(id) {
    var issue = issues.filter(function (i) { return i.id === id; })[0];
    if (!issue) return;
    if (!canManage(issue)) { toast('You can only delete your own issues.'); return; }

    var ok = await ET.confirm('Move “' + issue.title + '” to the archive? An admin can restore it.',
      { title: 'Delete issue', okLabel: 'Move to archive' });
    if (!ok) return;

    // Soft delete: the row stays in the database, hidden, until the bin is emptied.
    var result = await binIssue(
      function (sb) { return sb.from('issues').update({ deleted_at: new Date().toISOString() }).eq('id', id); },
      function (sb) { return sb.from('issues').delete().eq('id', id); }
    );
    if (result.error) { toast(ET.friendlyError(result.error)); return; }
    if (editingId === id) resetIssueForm();
    delete selection[id];
    await refresh({ silent: true });
    toast(result.fellBack ? 'Issue deleted.' : 'Moved to the archive.');
  }

  async function clearDone() {
    if (!isAdmin()) { toast('Only admins can clear done issues.'); return; }
    var done = issues.filter(function (i) { return i.status === 'done'; });
    if (!done.length) { toast('No done issues to clear.'); return; }

    var ok = await ET.confirm('Move ' + done.length + ' done issue(s) to the archive?',
      { title: 'Clear done issues', okLabel: 'Move ' + done.length });
    if (!ok) return;

    var result = await binIssue(
      function (sb) { return sb.from('issues').update({ deleted_at: new Date().toISOString() }).eq('status', 'done'); },
      function (sb) { return sb.from('issues').delete().eq('status', 'done'); }
    );
    if (result.error) { toast(ET.friendlyError(result.error)); return; }
    await refresh({ silent: true });
    toast(result.fellBack
      ? ('Cleared ' + done.length + ' done issue(s).')
      : ('Moved ' + done.length + ' done issue(s) to the archive.'));
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

    var check = admin
      ? '<input type="checkbox" class="issue-check" data-action="select" value="' + escapeHtml(issue.id) + '"' +
          (selection[issue.id] ? ' checked' : '') + ' aria-label="Select this issue" />'
      : '';

    var stale = isStale(issue)
      ? '<span class="stale-badge" title="Open for ' + openDays(issue) + ' days">Open ' + openDays(issue) + 'd</span>'
      : '';

    var adminNote = (issue.adminNote && (mine || admin))
      ? '<div class="admin-note"><b>Message from admin:</b> ' + escapeHtml(issue.adminNote) +
          (issue.adminNoteAt ? '<span class="when">' + escapeHtml(ET.timeAgo(issue.adminNoteAt)) + '</span>' : '') +
        '</div>'
      : '';

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
          check +
          statusControl +
          '<div class="issue-body">' +
            '<div class="issue-title">' + escapeHtml(issue.title) + ' ' + stale + '</div>' +
            description +
            adminNote +
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

  /* ---------------------------- bulk actions ----------------------------- */

  function pruneSelection() {
    var live = {};
    issues.forEach(function (i) { if (selection[i.id]) live[i.id] = true; });
    selection = live;
  }

  function updateBulkBar() {
    var bar = $('bulkBar');
    if (!bar) return;
    if (!isAdmin()) { bar.hidden = true; return; }
    var ids = selectedIds();
    var count = $('bulkCount');
    if (count) count.textContent = ids.length + ' selected';
    bar.hidden = ids.length === 0;
  }

  async function bulkApplyStatus() {
    if (!isAdmin()) return;
    var ids = selectedIds();
    if (!ids.length) return;
    var status = $('bulkStatus').value;
    if (STATUSES.indexOf(status) === -1) return;
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('issues').update({ status: status }).in('id', ids);
    if (res.error) { toast(ET.friendlyError(res.error)); return; }
    selection = {};
    await refresh({ silent: true });
    toast(ids.length + ' issue(s) set to ' + STATUS_LABEL[status] + '.');
  }

  async function bulkDelete() {
    if (!isAdmin()) return;
    var ids = selectedIds();
    if (!ids.length) return;
    var ok = await ET.confirm('Move ' + ids.length + ' selected issue(s) to the archive?',
      { title: 'Delete issues', okLabel: 'Move ' + ids.length });
    if (!ok) return;
    var result = await binIssue(
      function (sb) { return sb.from('issues').update({ deleted_at: new Date().toISOString() }).in('id', ids); },
      function (sb) { return sb.from('issues').delete().in('id', ids); }
    );
    if (result.error) { toast(ET.friendlyError(result.error)); return; }
    selection = {};
    if (editingId && ids.indexOf(editingId) !== -1) resetIssueForm();
    await refresh({ silent: true });
    toast(result.fellBack
      ? ('Deleted ' + ids.length + ' issue(s).')
      : ('Moved ' + ids.length + ' issue(s) to the archive.'));
  }

  function bulkSelectAll() {
    visibleIssues().forEach(function (i) { selection[i.id] = true; });
    renderIssues();
  }

  function bulkClear() {
    selection = {};
    renderIssues();
  }

  function renderIssues() {
    pruneSelection();
    updateBulkBar();

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
      if (select) {
        var card = select.closest('.issue');
        if (card) setStatus(card.dataset.id, select.value);
        return;
      }
      var box = event.target.closest('input[data-action="select"]');
      if (box) {
        var row = box.closest('.issue');
        if (!row) return;
        if (box.checked) selection[row.dataset.id] = true;
        else delete selection[row.dataset.id];
        updateBulkBar();
      }
    });

    $('clearDoneBtn').addEventListener('click', clearDone);
    $('refreshBtn').addEventListener('click', async function () {
      await refresh();
      toast('Reloaded from the database.');
    });

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

    /* ---- admin bulk actions ---- */
    var selectAll = $('bulkSelectAll');
    if (selectAll) selectAll.addEventListener('click', bulkSelectAll);
    var clearSel = $('bulkClear');
    if (clearSel) clearSel.addEventListener('click', bulkClear);
    var applySel = $('bulkApply');
    if (applySel) applySel.addEventListener('click', bulkApplyStatus);
    var delSel = $('bulkDelete');
    if (delSel) delSel.addEventListener('click', bulkDelete);

    /* ---- message-to-the-reporter dialog ---- */
    var noteSave = $('noteSave');
    if (noteSave) noteSave.addEventListener('click', saveNoteDialog);
    var noteCancel = $('noteCancel');
    if (noteCancel) noteCancel.addEventListener('click', closeNoteDialog);
    var notePop = $('notePop');
    if (notePop) notePop.addEventListener('click', function (e) { if (e.target === notePop) closeNoteDialog(); });

    /* ---- keyboard shortcuts ---- */
    var keysPop = $('keysPop');
    var keysClose = $('keysClose');

    function closeKeys() { if (keysPop) keysPop.hidden = true; }
    if (keysClose) keysClose.addEventListener('click', closeKeys);
    if (keysPop) keysPop.addEventListener('click', function (e) { if (e.target === keysPop) closeKeys(); });

    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;

      if (e.key === '/') {
        e.preventDefault();
        var search = $('searchInput');
        if (search) { search.focus(); search.select(); }
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        resetIssueForm();
        var panel = document.querySelector('#issueFormPanel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('issueTitle').focus();
      } else if (e.key === '?') {
        e.preventDefault();
        if (keysPop) keysPop.hidden = !keysPop.hidden;
      } else if (e.key === 'Escape') {
        closeKeys();
        closeNoteDialog();
      }
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
