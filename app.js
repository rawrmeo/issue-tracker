/* =========================================================================
 * Issue Tracker — Supabase edition
 * -------------------------------------------------------------------------
 * Data lives in a real PostgreSQL database (Supabase), so it survives
 * clearing your browser and is identical on every device.
 *
 * Security model — enforced by the DATABASE, not by this file:
 *   - Only authenticated users can read anything.
 *   - Reporter: may create issues (always as 'pending') and edit/delete
 *     their own.  CANNOT change a status  -> enforced by the
 *     `issues_guard` trigger in supabase/schema.sql.
 *   - Admin: may do all of the above to anyone's issue, and may promote or
 *     demote users.
 * The checks below only decide what the UI *shows*. The database is the
 * authority, so tampering with this script gains nothing.
 * ========================================================================= */

(function () {
  'use strict';

  /* ------------------------------ constants ------------------------------ */

  const CFG = window.SUPABASE_CONFIG || {};
  const EMAIL_DOMAIN = CFG.emailDomain || 'example.com';
  const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

  const ADMIN = 'admin';
  const USER = 'user';
  const STATUSES = ['pending', 'fixing', 'done'];
  const STATUS_LABEL = { pending: 'Pending', fixing: 'Fixing', done: 'Done' };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  const THEME_KEY = 'it.theme';

  /* ------------------------------- state --------------------------------- */

  let sb = null;                 // Supabase client
  let currentUser = null;        // { id, username, role }
  let issues = [];               // mapped rows
  let profiles = [];             // raw rows
  let profileById = new Map();
  let editingId = null;
  let channel = null;
  let refreshing = false;
  let entering = false;

  const filters = { status: 'all', priority: 'all', q: '', sort: 'newest' };

  /* ------------------------------ utilities ------------------------------ */

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (e) {
      return '';
    }
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 220);
    }, 3200);
  }

  function setBusy(button, on, label) {
    if (!button) return;
    if (on) {
      if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
      button.textContent = label || 'Working…';
      button.disabled = true;
    } else {
      if (button.dataset.idleLabel) {
        button.textContent = button.dataset.idleLabel;
        delete button.dataset.idleLabel;
      }
      button.disabled = false;
    }
  }

  /** Turn raw Postgres / PostgREST errors into something readable. */
  function friendlyError(error) {
    const msg = String((error && error.message) || error || '');
    if (/Only admins can change the status/i.test(msg)) return 'Only admins can change the status.';
    if (/The reporter of an issue cannot be changed/i.test(msg)) return 'The reporter cannot be changed.';
    if (/row-level security|permission denied/i.test(msg)) return 'You do not have permission to do that.';
    if (/Database error saving new user/i.test(msg)) return 'That username is already taken.';
    return msg || 'Something went wrong.';
  }

  const isAdmin = () => !!currentUser && currentUser.role === ADMIN;
  const isLoggedIn = () => !!currentUser;
  const canManage = (issue) => !!currentUser && (isAdmin() || issue.authorId === currentUser.id);

  const authorName = (id) => {
    const p = profileById.get(id);
    return p ? p.username : 'unknown';
  };

  function usernameToEmail(username) {
    return String(username).trim().toLowerCase() + '@' + EMAIL_DOMAIN;
  }

  function isConfigured() {
    const url = String(CFG.url || '').trim();
    const key = String(CFG.anonKey || '').trim();
    return /^https?:\/\/\S+$/.test(url) && key.length >= 30;
  }

  /* -------------------------------- views -------------------------------- */

  function hideAuthPanels() {
    ['configNotice', 'loginForm', 'signupForm'].forEach((id) => { $(id).hidden = true; });
  }

  function showConfigNotice() {
    $('authView').hidden = false;
    $('appView').hidden = true;
    hideAuthPanels();
    $('configNotice').hidden = false;
  }

  function showLogin() {
    $('authView').hidden = false;
    $('appView').hidden = true;
    hideAuthPanels();
    $('loginForm').hidden = false;
    $('loginUsername').focus();
  }

  function showSignup() {
    $('authView').hidden = false;
    $('appView').hidden = true;
    hideAuthPanels();
    $('signupForm').hidden = false;
    $('signupUsername').focus();
  }

  function applyRoleUi() {
    $('userChip').textContent = currentUser.username;
    $('userChip').title = currentUser.username;

    const roleChip = $('roleChip');
    roleChip.textContent = currentUser.role;
    roleChip.className = 'role-chip role-' + currentUser.role;

    document.querySelectorAll('.admin-only').forEach((el) => { el.hidden = !isAdmin(); });
    $('statusField').hidden = !isAdmin();
    $('usersPanel').hidden = !isAdmin();

    const banner = $('roleBanner');
    if (isAdmin()) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      banner.className = 'banner info';
      banner.innerHTML =
        'Signed in as <strong>' + escapeHtml(currentUser.username) + '</strong> (user). ' +
        'Report issues and manage your own. Only admins can set an issue to ' +
        '<strong>Fixing</strong> or <strong>Done</strong> — this is enforced by the database.';
    }
  }

  async function enterApp(user) {
    if (entering) return;
    entering = true;
    try {
      const { data: profile, error } = await sb
        .from('profiles')
        .select('id, username, role')
        .eq('id', user.id)
        .maybeSingle();

      if (error || !profile) {
        console.error(error);
        toast('No profile found for this account. Did you run supabase/schema.sql?');
        await sb.auth.signOut();
        return;
      }

      currentUser = { id: user.id, username: profile.username, role: profile.role };

      $('authView').hidden = true;
      $('appView').hidden = false;

      applyRoleUi();
      resetIssueForm();
      await refresh({ silent: true });
      subscribeRealtime();
    } catch (e) {
      console.error(e);
      toast('Could not load your account.');
    } finally {
      entering = false;
    }
  }

  /* -------------------------------- auth --------------------------------- */

  async function handleSignup(event) {
    event.preventDefault();
    const err = $('signupError');
    err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; };

    const username = $('signupUsername').value.trim();
    const password = $('signupPassword').value;
    const confirm = $('signupConfirm').value;

    if (!USERNAME_RE.test(username)) {
      return fail('Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen.');
    }
    if (password.length < 6) return fail('Password must be at least 6 characters.');
    if (password !== confirm) return fail('Passwords do not match.');

    setBusy($('signupSubmit'), true, 'Creating…');
    try {
      const { data, error } = await sb.auth.signUp({
        email: usernameToEmail(username),
        password,
        // Read by the handle_new_user() trigger. Note the ROLE is not sent:
        // the database decides it, so nobody can self-promote to admin.
        options: { data: { username } },
      });

      if (error) return fail(friendlyError(error));

      if (!data || !data.session) {
        return fail(
          'Account created, but email confirmation is switched ON in this Supabase project. ' +
          'Turn it off under Authentication -> Sign In / Providers -> Email -> "Confirm email", ' +
          'then sign in.'
        );
      }

      $('signupForm').reset();
      toast('Account created. You are signed in.');
      await enterApp(data.session.user);
    } finally {
      setBusy($('signupSubmit'), false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const err = $('loginError');
    err.hidden = true;

    const username = $('loginUsername').value.trim();
    const password = $('loginPassword').value;

    if (!username || !password) {
      err.textContent = 'Enter your username and password.';
      err.hidden = false;
      return;
    }

    setBusy($('loginSubmit'), true, 'Signing in…');
    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });

      if (error || !data || !data.session) {
        err.textContent = /Invalid login credentials/i.test(String(error && error.message))
          ? 'Incorrect username or password.'
          : friendlyError(error);
        err.hidden = false;
        $('loginPassword').value = '';
        $('loginPassword').focus();
        return;
      }

      $('loginForm').reset();
      toast('Signed in as ' + username + '.');
      await enterApp(data.session.user);
    } finally {
      setBusy($('loginSubmit'), false);
    }
  }

  async function handleLogout() {
    if (channel && sb) { try { await sb.removeChannel(channel); } catch (e) { /* ignore */ } channel = null; }
    try { await sb.auth.signOut(); } catch (e) { console.error(e); }
    currentUser = null;
    editingId = null;
    issues = [];
    profiles = [];
    profileById = new Map();
    resetIssueForm();
    showLogin();
    toast('Signed out.');
  }

  /* -------------------------------- data --------------------------------- */

  function mapIssue(row) {
    return {
      id: row.id,
      title: row.title || '',
      description: row.description || '',
      priority: ['low', 'medium', 'high'].includes(row.priority) ? row.priority : 'medium',
      status: STATUSES.includes(row.status) ? row.status : 'pending',
      label: row.label || '',
      authorId: row.author_id,
      createdAt: Date.parse(row.created_at) || 0,
      updatedAt: Date.parse(row.updated_at) || 0,
      completedAt: row.completed_at ? Date.parse(row.completed_at) : null,
    };
  }

  async function refresh(opts) {
    const silent = !!(opts && opts.silent);
    if (refreshing || !sb || !currentUser) return;
    refreshing = true;
    try {
      const [issueRes, profileRes] = await Promise.all([
        sb.from('issues').select('*').order('created_at', { ascending: false }),
        sb.from('profiles').select('id, username, role, created_at').order('created_at', { ascending: true }),
      ]);

      if (issueRes.error) {
        console.error(issueRes.error);
        toast('Could not load issues: ' + friendlyError(issueRes.error));
      } else {
        issues = (issueRes.data || []).map(mapIssue);
      }

      if (profileRes.error) {
        console.error(profileRes.error);
      } else {
        profiles = profileRes.data || [];
        profileById = new Map(profiles.map((p) => [p.id, p]));

        // An admin may have promoted or demoted you while you were signed in.
        const me = profileById.get(currentUser.id);
        if (me && me.role !== currentUser.role) {
          currentUser.role = me.role;
          applyRoleUi();
          toast('Your role is now ' + me.role + '.');
        }
      }

      renderIssues();
      renderUsers();
      if (!silent) flashLive();
    } catch (e) {
      console.error(e);
      toast('Could not reach the database.');
    } finally {
      refreshing = false;
    }
  }

  function flashLive() {
    const dot = $('liveDot');
    if (!dot) return;
    dot.classList.add('pulse');
    setTimeout(() => dot.classList.remove('pulse'), 600);
  }

  function subscribeRealtime() {
    if (channel) { try { sb.removeChannel(channel); } catch (e) { /* ignore */ } }
    channel = sb
      .channel('tracker-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' },
        () => refresh({ silent: true }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' },
        () => refresh({ silent: true }))
      .subscribe((status) => {
        const dot = $('liveDot');
        if (!dot) return;
        dot.classList.toggle('on', status === 'SUBSCRIBED');
        dot.title = status === 'SUBSCRIBED' ? 'Live updates on' : 'Live updates: ' + status;
      });
  }

  /* ------------------------------- form ---------------------------------- */

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
    const issue = issues.find((i) => i.id === id);
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
    document.querySelector('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleIssueSubmit(event) {
    event.preventDefault();
    if (!currentUser) return;

    const title = $('issueTitle').value.trim();
    if (!title) return;

    const base = {
      title,
      description: $('issueDescription').value.trim(),
      priority: $('issuePriority').value,
      label: $('issueLabel').value.trim(),
    };

    const button = $('issueSubmit');
    button.disabled = true;
    try {
      if (editingId) {
        const patch = Object.assign({}, base);
        // The database rejects this for non-admins anyway; not sending it
        // keeps the request honest.
        if (isAdmin()) patch.status = $('issueStatus').value;

        const { error } = await sb.from('issues').update(patch).eq('id', editingId);
        if (error) { toast(friendlyError(error)); return; }

        resetIssueForm();
        await refresh({ silent: true });
        toast('Issue updated.');
        return;
      }

      const chosen = $('issueStatus').value;
      const status = isAdmin() && STATUSES.includes(chosen) ? chosen : 'pending';

      const { error } = await sb.from('issues').insert(Object.assign({}, base, {
        status,
        author_id: currentUser.id,
      }));
      if (error) { toast(friendlyError(error)); return; }

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
    if (!STATUSES.includes(status)) return;

    const { error } = await sb.from('issues').update({ status }).eq('id', id);
    if (error) toast(friendlyError(error));
    else toast('Marked as ' + STATUS_LABEL[status].toLowerCase() + '.');
    await refresh({ silent: true });
  }

  async function deleteIssue(id) {
    const issue = issues.find((i) => i.id === id);
    if (!issue) return;
    if (!canManage(issue)) { toast('You can only delete your own issues.'); return; }
    if (!window.confirm('Delete "' + issue.title + '"? This cannot be undone.')) return;

    const { error } = await sb.from('issues').delete().eq('id', id);
    if (error) { toast(friendlyError(error)); return; }
    if (editingId === id) resetIssueForm();
    await refresh({ silent: true });
    toast('Issue deleted.');
  }

  async function clearDone() {
    if (!isAdmin()) { toast('Only admins can clear done issues.'); return; }
    const done = issues.filter((i) => i.status === 'done');
    if (!done.length) { toast('No done issues to clear.'); return; }
    if (!window.confirm('Delete ' + done.length + ' done issue(s)? This cannot be undone.')) return;

    const { error } = await sb.from('issues').delete().eq('status', 'done');
    if (error) { toast(friendlyError(error)); return; }
    await refresh({ silent: true });
    toast('Cleared ' + done.length + ' done issue(s).');
  }

  async function setUserRole(profile, role) {
    if (!isAdmin()) return;
    if (profile.id === currentUser.id) { toast('You cannot change your own role.'); return; }
    if (profile.role === ADMIN && profiles.filter((p) => p.role === ADMIN).length <= 1) {
      toast('There must always be at least one admin.');
      return;
    }

    const { error } = await sb.from('profiles').update({ role }).eq('id', profile.id);
    if (error) { toast(friendlyError(error)); return; }
    await refresh({ silent: true });
    toast(profile.username + ' is now ' + role + '.');
  }

  /* ------------------------------ rendering ------------------------------ */

  function visibleIssues() {
    const q = filters.q.trim().toLowerCase();
    const list = issues.filter((issue) => {
      if (filters.status !== 'all' && issue.status !== filters.status) return false;
      if (filters.priority !== 'all' && issue.priority !== filters.priority) return false;
      if (q) {
        const haystack = [issue.title, issue.description, issue.label, authorName(issue.authorId)]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const sorters = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      priority: (a, b) =>
        (PRIORITY_RANK[a.priority] == null ? 3 : PRIORITY_RANK[a.priority]) -
        (PRIORITY_RANK[b.priority] == null ? 3 : PRIORITY_RANK[b.priority]) ||
        b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    };
    return list.sort(sorters[filters.sort] || sorters.newest);
  }

  function issueCard(issue) {
    const admin = isAdmin();
    const mine = !!currentUser && issue.authorId === currentUser.id;
    const status = issue.status;

    const statusControl = admin
      ? '<select class="status-select status-' + status + '" data-action="status" aria-label="Set status">' +
          STATUSES.map((s) =>
            '<option value="' + s + '"' + (status === s ? ' selected' : '') + '>' +
            STATUS_LABEL[s] + '</option>'
          ).join('') +
        '</select>'
      : '<span class="status-dot ' + status + '" title="' + STATUS_LABEL[status] +
        '" aria-label="Status: ' + STATUS_LABEL[status] + '"></span>';

    const label = issue.label
      ? '<span class="badge">' + escapeHtml(issue.label) + '</span>'
      : '';

    const description = issue.description
      ? '<p class="issue-desc">' + escapeHtml(issue.description) + '</p>'
      : '';

    const actions = canManage(issue)
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
    const total = issues.length;
    const done = issues.filter((i) => i.status === 'done').length;
    const fixing = issues.filter((i) => i.status === 'fixing').length;
    const pending = total - done - fixing;
    const high = issues.filter((i) => i.priority === 'high' && i.status !== 'done').length;

    $('statTotal').textContent = total;
    $('statPending').textContent = pending;
    $('statFixing').textContent = fixing;
    $('statDone').textContent = done;
    $('statHigh').textContent = high;

    const list = visibleIssues();
    const listEl = $('issueList');
    const emptyEl = $('emptyState');

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

  function renderUsers() {
    const panel = $('usersPanel');
    if (!isAdmin()) {
      panel.hidden = true;
      $('userList').innerHTML = '';   // don't leave another account's list behind
      return;
    }
    panel.hidden = false;

    $('userList').innerHTML = profiles.map((p) => {
      const self = p.id === currentUser.id;
      const lastAdmin = p.role === ADMIN && profiles.filter((x) => x.role === ADMIN).length <= 1;
      const canToggle = !self && !lastAdmin;

      return (
        '<div class="user-row" data-id="' + escapeHtml(p.id) + '">' +
          '<div class="user-info">' +
            '<span class="user-name">' + escapeHtml(p.username) + '</span>' +
            '<span class="role-chip role-' + escapeHtml(p.role) + '">' + escapeHtml(p.role) + '</span>' +
            (self ? '<span class="badge mine">you</span>' : '') +
            '<span class="issue-date">joined ' + escapeHtml(formatDate(Date.parse(p.created_at))) + '</span>' +
          '</div>' +
          '<div class="user-actions">' +
            '<button class="btn ghost" type="button" data-action="toggle-role"' +
              (canToggle ? '' : ' disabled') + '>' +
              (p.role === ADMIN ? 'Make user' : 'Make admin') +
            '</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  /* -------------------------------- events ------------------------------- */

  function exportBackup() {
    if (!isAdmin()) { toast('Only admins can export.'); return; }
    const payload = issues.map((i) => ({
      id: i.id, title: i.title, description: i.description,
      priority: i.priority, status: i.status, label: i.label,
      reporter: authorName(i.authorId),
      createdAt: new Date(i.createdAt).toISOString(),
      completedAt: i.completedAt ? new Date(i.completedAt).toISOString() : null,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'issues-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported ' + payload.length + ' issue(s).');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  }

  function bindEvents() {
    $('loginForm').addEventListener('submit', handleLogin);
    $('signupForm').addEventListener('submit', handleSignup);
    $('showSignup').addEventListener('click', showSignup);
    $('showLogin').addEventListener('click', showLogin);
    $('logoutBtn').addEventListener('click', handleLogout);
    $('themeBtn').addEventListener('click', toggleTheme);

    $('issueForm').addEventListener('submit', handleIssueSubmit);
    $('issueCancel').addEventListener('click', () => { resetIssueForm(); toast('Edit cancelled.'); });

    $('issueList').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const card = button.closest('.issue');
      if (!card) return;
      if (button.dataset.action === 'edit') startEdit(card.dataset.id);
      else if (button.dataset.action === 'delete') deleteIssue(card.dataset.id);
    });

    $('issueList').addEventListener('change', (event) => {
      const select = event.target.closest('select[data-action="status"]');
      if (!select) return;
      const card = select.closest('.issue');
      if (card) setStatus(card.dataset.id, select.value);
    });

    $('userList').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="toggle-role"]');
      if (!button) return;
      const row = button.closest('.user-row');
      if (!row) return;
      const profile = profiles.find((p) => p.id === row.dataset.id);
      if (profile) setUserRole(profile, profile.role === ADMIN ? USER : ADMIN);
    });

    $('clearDoneBtn').addEventListener('click', clearDone);
    $('refreshBtn').addEventListener('click', async () => { await refresh(); toast('Reloaded from the database.'); });
    $('exportBtn').addEventListener('click', exportBackup);

    document.querySelectorAll('.seg[data-filter="status"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.seg[data-filter="status"]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        filters.status = btn.dataset.value;
        renderIssues();
      });
    });

    $('priorityFilter').addEventListener('change', (e) => { filters.priority = e.target.value; renderIssues(); });
    $('sortSelect').addEventListener('change', (e) => { filters.sort = e.target.value; renderIssues(); });

    let searchTimer = null;
    $('searchInput').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const value = e.target.value;
      searchTimer = setTimeout(() => { filters.q = value; renderIssues(); }, 120);
    });
  }

  /* --------------------------------- boot -------------------------------- */

  async function init() {
    applyTheme(localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light');
    bindEvents();

    if (!isConfigured() || !window.supabase || typeof window.supabase.createClient !== 'function') {
      showConfigNotice();
      return;
    }

    try {
      sb = window.supabase.createClient(String(CFG.url).trim(), String(CFG.anonKey).trim());
    } catch (e) {
      console.error(e);
      showConfigNotice();
      return;
    }

    // React to sign-out happening anywhere (another tab, token revoked).
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        if (channel) { try { sb.removeChannel(channel); } catch (e) { /* ignore */ } channel = null; }
        showLogin();
      }
    });

    try {
      const { data, error } = await sb.auth.getSession();
      if (error) console.error(error);
      const session = data && data.session;
      if (session && session.user) await enterApp(session.user);
      else showLogin();
    } catch (e) {
      console.error(e);
      showLogin();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
