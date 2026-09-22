/* =========================================================================
 * Issue Tracker — browser-only app with admin / user roles
 * -------------------------------------------------------------------------
 * Roles
 *   admin : full control — create users, set status (pending/fixing/done),
 *           edit & delete any issue, clear done, export/import.
 *   user  : can sign in, report issues, and edit/delete their OWN issues.
 *           Cannot change status.
 *
 * Storage:  localStorage (per-browser). Use Export / Import for backups.
 * Auth:     first run creates the admin account; passwords are hashed with
 *           PBKDF2-SHA256 + random salt via the Web Crypto API.
 * ========================================================================= */

(function () {
  'use strict';

  const KEYS = {
    users: 'it.users',
    session: 'it.session',
    issues: 'it.issues',
    theme: 'it.theme',
  };

  const SESSION_DAYS = 7;
  const ITERATIONS = 150000;

  const ADMIN = 'admin';
  const USER = 'user';
  const STATUSES = ['pending', 'fixing', 'done'];
  const STATUS_LABEL = { pending: 'Pending', fixing: 'Fixing', done: 'Done' };

  /* ----------------------------- tiny helpers ---------------------------- */

  const $ = (id) => document.getElementById(id);

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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
    }, 2600);
  }

  /* ------------------------------- crypto -------------------------------- */

  const bytesToHex = (bytes) =>
    Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

  function hasSubtle() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
  }

  /** Fallback for insecure contexts; deliberately weaker. */
  function weakHash(text, salt) {
    const input = salt + '::' + text;
    let h1 = 0x811c9dc5;
    let h2 = 0x1000193;
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  async function hashPassword(password, saltHex) {
    if (!hasSubtle()) return { algo: 'weak', hash: weakHash(password, saltHex) };

    const enc = new TextEncoder();
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    return { algo: 'pbkdf2', hash: bytesToHex(bits) };
  }

  function makeSalt() {
    if (hasSubtle()) {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      return bytesToHex(arr);
    }
    return uid().slice(0, 32);
  }

  async function verifyPassword(password, user) {
    const result = await hashPassword(password, user.salt);
    return result.hash === user.hash;
  }

  /* -------------------------------- users -------------------------------- */

  function getUsers() {
    const list = readJSON(KEYS.users, []);
    if (!Array.isArray(list)) return [];
    return list
      .filter((u) => u && typeof u.username === 'string')
      .map((u, index) => ({
        username: u.username,
        salt: u.salt || '',
        hash: u.hash || '',
        algo: u.algo || 'pbkdf2',
        // Migrate old records: the very first account becomes the admin.
        role: u.role === ADMIN || u.role === USER ? u.role : (index === 0 ? ADMIN : USER),
        createdAt: Number(u.createdAt) || Date.now(),
      }));
  }

  function saveUsers(users) {
    writeJSON(KEYS.users, users);
  }

  function findUser(username) {
    const needle = String(username).trim().toLowerCase();
    return getUsers().find((u) => u.username.toLowerCase() === needle) || null;
  }

  function adminCount() {
    return getUsers().filter((u) => u.role === ADMIN).length;
  }

  function getSession() {
    const s = readJSON(KEYS.session, null);
    if (!s || !s.username || !s.expiresAt) return null;
    return { username: s.username, expiresAt: Number(s.expiresAt) };
  }

  function startSession(username) {
    writeJSON(KEYS.session, {
      username,
      expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  function endSession() {
    localStorage.removeItem(KEYS.session);
  }

  /* ----------------------------- current user ---------------------------- */

  let currentUser = null; // { username, role }

  const isAdmin = () => !!currentUser && currentUser.role === ADMIN;
  const isLoggedIn = () => !!currentUser;

  /** Admin can touch anything; a user only their own issues. */
  function canManage(issue) {
    if (!currentUser) return false;
    return isAdmin() || issue.author === currentUser.username;
  }

  /* ------------------------------- views --------------------------------- */

  function showAuth(showSetup) {
    currentUser = null;
    $('authView').hidden = false;
    $('appView').hidden = true;
    $('loginForm').hidden = showSetup;
    $('setupForm').hidden = !showSetup;
    if (showSetup) $('setupUsername').focus();
    else $('loginUsername').focus();
  }

  function showApp(user) {
    currentUser = { username: user.username, role: user.role };

    $('authView').hidden = true;
    $('appView').hidden = false;

    $('userChip').textContent = user.username;
    $('userChip').title = user.username;

    const roleChip = $('roleChip');
    roleChip.textContent = user.role;
    roleChip.className = 'role-chip role-' + user.role;

    // Admin-only controls
    document.querySelectorAll('.admin-only').forEach((el) => { el.hidden = !isAdmin(); });
    $('statusField').hidden = !isAdmin();
    $('usersPanel').hidden = !isAdmin();

    // Reporters see a short explanation of their limits
    const banner = $('roleBanner');
    if (isAdmin()) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      banner.className = 'banner info';
      banner.innerHTML =
        'Signed in as <strong>' + escapeHtml(user.username) + '</strong> (user). ' +
        'You can report issues and manage your own. Only admins can set an issue to ' +
        '<strong>Fixing</strong> or <strong>Done</strong>.';
    }

    $('formTitle').textContent = isAdmin() ? 'Add an issue' : 'Report an issue';
    $('issueSubmit').textContent = 'Report issue';
    $('formHint').textContent = isAdmin()
      ? 'Fill in the title, choose a status, and save.'
      : 'Describe the problem. An admin will pick it up and mark it fixed.';

    resetIssueForm();
    renderIssues();
    renderUsers();
  }

  /* -------------------------------- auth --------------------------------- */

  async function handleSetup(event) {
    event.preventDefault();
    const err = $('setupError');
    err.hidden = true;
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };

    const username = $('setupUsername').value.trim();
    const password = $('setupPassword').value;
    const confirm = $('setupConfirm').value;

    if (username.length < 3) return fail('Username must be at least 3 characters.');
    if (password.length < 6) return fail('Password must be at least 6 characters.');
    if (password !== confirm) return fail('Passwords do not match.');
    if (findUser(username)) return fail('That username is already taken.');

    const salt = makeSalt();
    const { algo, hash } = await hashPassword(password, salt);

    saveUsers([{ username, salt, hash, algo, role: ADMIN, createdAt: Date.now() }]);

    $('setupForm').reset();
    startSession(username);
    toast('Admin account created.');
    showApp({ username, role: ADMIN });
    if (algo === 'weak') {
      toast('Warning: weak hashing. Open via http://localhost or https for stronger security.');
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const err = $('loginError');
    err.hidden = true;

    const username = $('loginUsername').value.trim();
    const password = $('loginPassword').value;

    const user = findUser(username);
    const ok = user ? await verifyPassword(password, user) : false;

    if (!ok || !user) {
      err.textContent = 'Incorrect username or password.';
      err.hidden = false;
      $('loginPassword').value = '';
      $('loginPassword').focus();
      return;
    }

    $('loginForm').reset();
    startSession(user.username);
    toast('Signed in as ' + user.username + ' (' + user.role + ').');
    showApp(user);
  }

  function handleLogout() {
    endSession();
    currentUser = null;
    editingId = null;
    resetIssueForm();
    showAuth(false);
    toast('Signed out.');
  }

  function handleReset() {
    const ok = window.confirm(
      'Reset everything?\n\nThis permanently deletes every account and ALL issues stored in ' +
      'this browser. Export a backup first if you need one.'
    );
    if (!ok) return;
    Object.values(KEYS).forEach((k) => {
      if (k !== KEYS.theme) localStorage.removeItem(k);
    });
    currentUser = null;
    editingId = null;
    issues = [];
    resetIssueForm();
    showAuth(true);
    toast('Everything was reset.');
  }

  /* ------------------------------- issues -------------------------------- */

  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  let issues = [];
  let editingId = null;
  const filters = { status: 'all', priority: 'all', q: '', sort: 'newest' };

  function loadIssues() {
    const list = readJSON(KEYS.issues, []);
    issues = Array.isArray(list) ? list : [];
  }

  function saveIssues() {
    writeJSON(KEYS.issues, issues);
  }

  function resetIssueForm() {
    editingId = null;
    $('issueForm').reset();
    $('issuePriority').value = 'medium';
    $('issueStatus').value = 'pending';
    $('issueSubmit').textContent = isAdmin() ? 'Add issue' : 'Report issue';
    $('issueCancel').hidden = true;
    $('formTitle').textContent = isAdmin() ? 'Add an issue' : 'Report an issue';
    $('formHint').textContent = isAdmin()
      ? 'Fill in the title, choose a status, and save.'
      : 'Describe the problem. An admin will pick it up and mark it fixed.';
  }

  function startEdit(id) {
    const issue = issues.find((i) => i.id === id);
    if (!issue || !canManage(issue)) return;

    editingId = id;
    $('issueTitle').value = issue.title;
    $('issueDescription').value = issue.description || '';
    $('issuePriority').value = issue.priority || 'medium';
    $('issueStatus').value = issue.status || 'pending';
    $('issueLabel').value = issue.label || '';
    $('issueSubmit').textContent = isAdmin() ? 'Save changes' : 'Save my changes';
    $('issueCancel').hidden = false;
    $('formTitle').textContent = 'Edit issue';
    $('formHint').textContent = isAdmin()
      ? 'Update the details or change the status, then save.'
      : 'Update your report, then save.';
    $('issueTitle').focus();
    document.querySelector('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleIssueSubmit(event) {
    event.preventDefault();
    const title = $('issueTitle').value.trim();
    if (!title) return;

    const statusFromForm = $('issueStatus').value;
    const payload = {
      title,
      description: $('issueDescription').value.trim(),
      priority: $('issuePriority').value,
      label: $('issueLabel').value.trim(),
      updatedAt: Date.now(),
    };

    if (editingId) {
      const issue = issues.find((i) => i.id === editingId);
      if (issue && canManage(issue)) {
        Object.assign(issue, payload);
        // Only an admin may change the status.
        if (isAdmin()) {
          if (STATUSES.includes(statusFromForm)) issue.status = statusFromForm;
          issue.completedAt = issue.status === 'done' ? (issue.completedAt || Date.now()) : null;
        }
      }
      toast('Issue updated.');
      resetIssueForm();
      saveIssues();
      renderIssues();
      return;
    }

    // New issue: reporters always create PENDING issues.
    const status = isAdmin() && STATUSES.includes(statusFromForm) ? statusFromForm : 'pending';

    issues.unshift({
      id: uid(),
      ...payload,
      status,
      author: currentUser ? currentUser.username : 'unknown',
      createdAt: Date.now(),
      completedAt: status === 'done' ? Date.now() : null,
    });

    saveIssues();
    resetIssueForm();
    renderIssues();
    toast(isAdmin() ? 'Issue added.' : 'Issue reported. An admin will review it.');
  }

  /** Admin-only: move an issue between pending / fixing / done. */
  function setStatus(id, status) {
    if (!isAdmin()) { toast('Only admins can change the status.'); return; }
    if (!STATUSES.includes(status)) return;

    const issue = issues.find((i) => i.id === id);
    if (!issue) return;

    issue.status = status;
    issue.updatedAt = Date.now();
    issue.completedAt = status === 'done' ? (issue.completedAt || Date.now()) : null;
    if (status !== 'done') issue.completedAt = null;

    saveIssues();
    renderIssues();
    toast('Marked as ' + STATUS_LABEL[status].toLowerCase() + '.');
  }

  function deleteIssue(id) {
    const issue = issues.find((i) => i.id === id);
    if (!issue) return;
    if (!canManage(issue)) { toast('You can only delete your own issues.'); return; }
    if (!window.confirm('Delete "' + issue.title + '"? This cannot be undone.')) return;

    issues = issues.filter((i) => i.id !== id);
    if (editingId === id) resetIssueForm();
    saveIssues();
    renderIssues();
    toast('Issue deleted.');
  }

  function clearDone() {
    if (!isAdmin()) { toast('Only admins can clear done issues.'); return; }
    const done = issues.filter((i) => i.status === 'done');
    if (!done.length) { toast('No done issues to clear.'); return; }
    if (!window.confirm('Delete ' + done.length + ' done issue(s)? This cannot be undone.')) return;

    issues = issues.filter((i) => i.status !== 'done');
    saveIssues();
    renderIssues();
    toast('Cleared ' + done.length + ' done issue(s).');
  }

  function visibleIssues() {
    const q = filters.q.trim().toLowerCase();
    const list = issues.filter((issue) => {
      if (filters.status !== 'all' && issue.status !== filters.status) return false;
      if (filters.priority !== 'all' && issue.priority !== filters.priority) return false;
      if (q) {
        const haystack = [issue.title, issue.description, issue.label, issue.author]
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
    const mine = currentUser && issue.author === currentUser.username;
    const manageable = admin || mine;
    const status = STATUSES.includes(issue.status) ? issue.status : 'pending';

    // Admins get a live status control; everyone else gets a read-only dot.
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

    const actions = manageable
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
              '<span class="issue-author">by ' + escapeHtml(issue.author || 'unknown') + '</span>' +
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

  function onListChange(event) {
    const select = event.target.closest('select[data-action="status"]');
    if (!select) return;
    const card = select.closest('.issue');
    if (card) setStatus(card.dataset.id, select.value);
  }

  function onListClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const card = button.closest('.issue');
    if (!card) return;
    const id = card.dataset.id;

    if (button.dataset.action === 'edit') startEdit(id);
    else if (button.dataset.action === 'delete') deleteIssue(id);
  }

  /* --------------------------- user management --------------------------- */

  function renderUsers() {
    const panel = $('usersPanel');
    if (!isAdmin()) { panel.hidden = true; return; }
    panel.hidden = false;

    const users = getUsers();
    const me = currentUser.username;
    const admins = users.filter((u) => u.role === ADMIN).length;

    $('userList').innerHTML = users.map((u) => {
      const self = u.username === me;
      const lastAdmin = u.role === ADMIN && admins <= 1;
      const canRemove = !self && !lastAdmin;
      const canToggle = !self && !lastAdmin;

      return (
        '<div class="user-row" data-username="' + escapeHtml(u.username) + '">' +
          '<div class="user-info">' +
            '<span class="user-name">' + escapeHtml(u.username) + '</span>' +
            '<span class="role-chip role-' + escapeHtml(u.role) + '">' + escapeHtml(u.role) + '</span>' +
            (self ? '<span class="badge mine">you</span>' : '') +
          '</div>' +
          '<div class="user-actions">' +
            '<button class="btn ghost" type="button" data-action="toggle-role"' +
              (canToggle ? '' : ' disabled') + '>' +
              (u.role === ADMIN ? 'Make user' : 'Make admin') +
            '</button>' +
            '<button class="btn ghost" type="button" data-action="reset-pw">Reset password</button>' +
            '<button class="btn ghost danger" type="button" data-action="remove-user"' +
              (canRemove ? '' : ' disabled') + '>Remove</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  async function handleAddUser(event) {
    event.preventDefault();
    if (!isAdmin()) return;

    const err = $('userError');
    err.hidden = true;
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };

    const username = $('newUsername').value.trim();
    const password = $('newPassword').value;
    const role = $('newRole').value === ADMIN ? ADMIN : USER;

    if (username.length < 3) return fail('Username must be at least 3 characters.');
    if (password.length < 6) return fail('Password must be at least 6 characters.');
    if (findUser(username)) return fail('That username is already taken.');

    const salt = makeSalt();
    const { algo, hash } = await hashPassword(password, salt);

    const users = getUsers();
    users.push({ username, salt, hash, algo, role, createdAt: Date.now() });
    saveUsers(users);

    $('userForm').reset();
    renderUsers();
    toast('Added ' + role + ' "' + username + '".');
  }

  async function resetUserPassword(username) {
    if (!isAdmin()) return;
    const next = window.prompt('New password for "' + username + '" (minimum 6 characters):');
    if (next === null) return;
    if (next.length < 6) { toast('Password must be at least 6 characters.'); return; }

    const users = getUsers();
    const user = users.find((u) => u.username === username);
    if (!user) return;

    user.salt = makeSalt();
    const result = await hashPassword(next, user.salt);
    user.hash = result.hash;
    user.algo = result.algo;
    saveUsers(users);
    toast('Password reset for "' + username + '".');
  }

  function removeUser(username) {
    if (!isAdmin()) return;
    if (username === currentUser.username) { toast('You cannot remove your own account.'); return; }

    const users = getUsers();
    const user = users.find((u) => u.username === username);
    if (!user) return;
    if (user.role === ADMIN && adminCount() <= 1) {
      toast('Cannot remove the last admin.');
      return;
    }
    if (!window.confirm('Remove user "' + username + '"? Their issues will be kept.')) return;

    saveUsers(users.filter((u) => u.username !== username));
    renderUsers();
    renderIssues();
    toast('Removed "' + username + '".');
  }

  function toggleUserRole(username) {
    if (!isAdmin()) return;
    if (username === currentUser.username) { toast('You cannot change your own role.'); return; }

    const users = getUsers();
    const user = users.find((u) => u.username === username);
    if (!user) return;

    if (user.role === ADMIN && adminCount() <= 1) {
      toast('Cannot demote the last admin.');
      return;
    }

    user.role = user.role === ADMIN ? USER : ADMIN;
    saveUsers(users);
    renderUsers();
    renderIssues();
    toast('"' + username + '" is now ' + user.role + '.');
  }

  function onUserListClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('.user-row');
    if (!row) return;
    const username = row.dataset.username;

    if (button.dataset.action === 'toggle-role') toggleUserRole(username);
    else if (button.dataset.action === 'reset-pw') resetUserPassword(username);
    else if (button.dataset.action === 'remove-user') removeUser(username);
  }

  /* ---------------------------- import / export -------------------------- */

  function exportBackup() {
    if (!isAdmin()) { toast('Only admins can export.'); return; }
    const payload = {
      app: 'issue-tracker',
      version: 2,
      exportedAt: new Date().toISOString(),
      issues,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'issues-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded.');
  }

  function importBackup(file) {
    if (!isAdmin()) { toast('Only admins can import.'); return; }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const incoming = Array.isArray(data) ? data : data.issues;
        if (!Array.isArray(incoming)) throw new Error('bad shape');

        const mode = window.confirm(
          'Import ' + incoming.length + ' issue(s).\n\n' +
          'OK = merge with existing issues\n' +
          'Cancel = replace all existing issues'
        );

        const cleaned = incoming
          .filter((i) => i && typeof i.title === 'string' && i.title.trim())
          .map((i) => ({
            id: typeof i.id === 'string' ? i.id : uid(),
            title: i.title.trim(),
            description: typeof i.description === 'string' ? i.description : '',
            priority: ['low', 'medium', 'high'].includes(i.priority) ? i.priority : 'medium',
            status: STATUSES.includes(i.status) ? i.status : 'pending',
            label: typeof i.label === 'string' ? i.label : '',
            author: typeof i.author === 'string' ? i.author : 'unknown',
            createdAt: Number(i.createdAt) || Date.now(),
            updatedAt: Number(i.updatedAt) || Date.now(),
            completedAt: i.completedAt ? Number(i.completedAt) : null,
          }));

        if (mode) {
          const byId = new Map(issues.map((i) => [i.id, i]));
          cleaned.forEach((i) => byId.set(i.id, i));
          issues = Array.from(byId.values());
        } else {
          issues = cleaned;
        }

        saveIssues();
        renderIssues();
        toast('Imported ' + cleaned.length + ' issue(s).');
      } catch (e) {
        toast('Import failed: not a valid backup file.');
      }
    };
    reader.readAsText(file);
  }

  /* -------------------------------- theme -------------------------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(KEYS.theme, next);
  }

  /* -------------------------------- wiring ------------------------------- */

  function bindEvents() {
    $('setupForm').addEventListener('submit', handleSetup);
    $('loginForm').addEventListener('submit', handleLogin);
    $('resetBtn').addEventListener('click', handleReset);
    $('logoutBtn').addEventListener('click', handleLogout);
    $('themeBtn').addEventListener('click', toggleTheme);

    $('issueForm').addEventListener('submit', handleIssueSubmit);
    $('issueCancel').addEventListener('click', () => { resetIssueForm(); toast('Edit cancelled.'); });
    $('issueList').addEventListener('click', onListClick);
    $('issueList').addEventListener('change', onListChange);
    $('clearDoneBtn').addEventListener('click', clearDone);

    $('userForm').addEventListener('submit', handleAddUser);
    $('userList').addEventListener('click', onUserListClick);

    document.querySelectorAll('.seg[data-filter="status"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.seg[data-filter="status"]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        filters.status = btn.dataset.value;
        renderIssues();
      });
    });

    $('priorityFilter').addEventListener('change', (e) => {
      filters.priority = e.target.value;
      renderIssues();
    });

    $('sortSelect').addEventListener('change', (e) => {
      filters.sort = e.target.value;
      renderIssues();
    });

    let searchTimer = null;
    $('searchInput').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const value = e.target.value;
      searchTimer = setTimeout(() => { filters.q = value; renderIssues(); }, 120);
    });

    $('exportBtn').addEventListener('click', exportBackup);
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importBackup(file);
      e.target.value = '';
    });

    // Keep sessions honest across tabs.
    window.addEventListener('storage', (e) => {
      if (e.key === KEYS.session) {
        const session = getSession();
        if (!session && isLoggedIn()) { showAuth(false); return; }
        if (session && isLoggedIn() && session.username !== currentUser.username) {
          const user = findUser(session.username);
          if (user) showApp(user);
        }
      }
      if (e.key === KEYS.users && isLoggedIn()) {
        const user = findUser(currentUser.username);
        if (!user) { showAuth(false); toast('Your account was removed.'); return; }
        if (user.role !== currentUser.role) showApp(user);
        else renderUsers();
      }
      if (e.key === KEYS.issues) { loadIssues(); renderIssues(); }
    });
  }

  function init() {
    applyTheme(localStorage.getItem(KEYS.theme) === 'dark' ? 'dark' : 'light');
    bindEvents();
    loadIssues();

    if (!getUsers().length) {
      showAuth(true);
      return;
    }

    const session = getSession();
    const user = session ? findUser(session.username) : null;

    if (user) {
      showApp(user);
    } else {
      if (session) endSession();
      showAuth(false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
