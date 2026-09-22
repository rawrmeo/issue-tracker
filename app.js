/* =========================================================================
 * Issue Tracker — browser-only app
 * -------------------------------------------------------------------------
 * Storage:  localStorage (per-browser). Use Export / Import for backups.
 * Auth:     first run creates one admin account; password is hashed with
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

  /* ----------------------------- tiny helpers ---------------------------- */

  const $ = (id) => document.getElementById(id);

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
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
    } catch {
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
    }, 2400);
  }

  /* ------------------------------- crypto -------------------------------- */

  const bytesToHex = (bytes) =>
    Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

  function hasSubtle() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
  }

  /**
   * Fallback used only when Web Crypto is unavailable (e.g. an insecure
   * context). It is deliberately weaker; the UI warns about it.
   */
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

  /* -------------------------------- auth --------------------------------- */

  function getUsers() {
    const list = readJSON(KEYS.users, []);
    return Array.isArray(list) ? list : [];
  }

  function findUser(username) {
    const needle = String(username).trim().toLowerCase();
    return getUsers().find((u) => u.username.toLowerCase() === needle) || null;
  }

  function getSession() {
    const s = readJSON(KEYS.session, null);
    if (!s || !s.username || !s.expiresAt) return null;
    if (Date.now() > s.expiresAt) {
      localStorage.removeItem(KEYS.session);
      return null;
    }
    return s;
  }

  function startSession(username, remember) {
    const days = remember ? SESSION_DAYS : 1;
    writeJSON(KEYS.session, {
      username,
      expiresAt: Date.now() + days * 24 * 60 * 60 * 1000,
    });
  }

  function endSession() {
    localStorage.removeItem(KEYS.session);
  }

  let currentUser = null;

  function showAuth(showSetup) {
    $('authView').hidden = false;
    $('appView').hidden = true;
    $('loginForm').hidden = showSetup;
    $('setupForm').hidden = !showSetup;
    if (showSetup) $('setupUsername').focus();
    else $('loginUsername').focus();
  }

  function showApp(username) {
    currentUser = username;
    $('authView').hidden = true;
    $('appView').hidden = false;
    $('userChip').textContent = username;
    $('userChip').title = username;
    renderIssues();
  }

  async function handleSetup(event) {
    event.preventDefault();
    const err = $('setupError');
    err.hidden = true;

    const username = $('setupUsername').value.trim();
    const password = $('setupPassword').value;
    const confirm = $('setupConfirm').value;

    const fail = (msg) => { err.textContent = msg; err.hidden = false; };

    if (username.length < 3) return fail('Username must be at least 3 characters.');
    if (password.length < 6) return fail('Password must be at least 6 characters.');
    if (password !== confirm) return fail('Passwords do not match.');
    if (findUser(username)) return fail('That username is already taken.');

    const salt = makeSalt();
    const { algo, hash } = await hashPassword(password, salt);

    writeJSON(KEYS.users, [
      ...getUsers(),
      { username, salt, hash, algo, createdAt: Date.now() },
    ]);

    $('setupForm').reset();
    startSession(username, true);
    toast('Account created. Welcome!');
    showApp(username);
    if (algo === 'weak') {
      toast('Warning: weak hashing (open via http://localhost or https for stronger security).');
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

    if (!ok) {
      err.textContent = 'Incorrect username or password.';
      err.hidden = false;
      $('loginPassword').value = '';
      $('loginPassword').focus();
      return;
    }

    $('loginForm').reset();
    startSession(user.username, true);
    toast('Signed in.');
    showApp(user.username);
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
      'Reset everything?\n\nThis permanently deletes the account and ALL issues stored in this browser. ' +
      'Export a backup first if you need one.'
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
    $('issueSubmit').textContent = 'Add issue';
    $('issueCancel').hidden = true;
    $('formTitle').textContent = 'Add an issue';
    $('formHint').textContent = 'Issues are added manually. Fill in the title and save.';
  }

  function startEdit(id) {
    const issue = issues.find((i) => i.id === id);
    if (!issue) return;
    editingId = id;
    $('issueTitle').value = issue.title;
    $('issueDescription').value = issue.description || '';
    $('issuePriority').value = issue.priority || 'medium';
    $('issueStatus').value = issue.status || 'pending';
    $('issueLabel').value = issue.label || '';
    $('issueSubmit').textContent = 'Save changes';
    $('issueCancel').hidden = false;
    $('formTitle').textContent = 'Edit issue';
    $('formHint').textContent = 'Update the details and save your changes.';
    $('issueTitle').focus();
    document.querySelector('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleIssueSubmit(event) {
    event.preventDefault();
    const title = $('issueTitle').value.trim();
    if (!title) return;

    const payload = {
      title,
      description: $('issueDescription').value.trim(),
      priority: $('issuePriority').value,
      status: $('issueStatus').value,
      label: $('issueLabel').value.trim(),
      updatedAt: Date.now(),
    };

    if (editingId) {
      const issue = issues.find((i) => i.id === editingId);
      if (issue) {
        Object.assign(issue, payload);
        issue.completedAt = issue.status === 'done' ? (issue.completedAt || Date.now()) : null;
      }
      toast('Issue updated.');
      resetIssueForm();
      saveIssues();
      renderIssues();
      return;
    }

    issues.unshift({
      id: uid(),
      ...payload,
      createdAt: Date.now(),
      completedAt: payload.status === 'done' ? Date.now() : null,
    });
    saveIssues();
    resetIssueForm();
    renderIssues();
    toast('Issue added.');
  }

  function toggleStatus(id) {
    const issue = issues.find((i) => i.id === id);
    if (!issue) return;
    if (issue.status === 'done') {
      issue.status = 'pending';
      issue.completedAt = null;
    } else {
      issue.status = 'done';
      issue.completedAt = Date.now();
    }
    issue.updatedAt = Date.now();
    saveIssues();
    renderIssues();
    toast(issue.status === 'done' ? 'Marked as done.' : 'Marked as pending.');
  }

  function deleteIssue(id) {
    const issue = issues.find((i) => i.id === id);
    if (!issue) return;
    if (!window.confirm('Delete "' + issue.title + '"? This cannot be undone.')) return;
    issues = issues.filter((i) => i.id !== id);
    if (editingId === id) resetIssueForm();
    saveIssues();
    renderIssues();
    toast('Issue deleted.');
  }

  function clearDone() {
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
    let list = issues.filter((issue) => {
      if (filters.status !== 'all' && issue.status !== filters.status) return false;
      if (filters.priority !== 'all' && issue.priority !== filters.priority) return false;
      if (q) {
        const haystack = [issue.title, issue.description, issue.label]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const sorters = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      priority: (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) ||
        b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    };
    return list.sort(sorters[filters.sort] || sorters.newest);
  }

  function issueCard(issue) {
    const label = issue.label
      ? '<span class="badge">' + escapeHtml(issue.label) + '</span>'
      : '';
    const description = issue.description
      ? '<p class="issue-desc">' + escapeHtml(issue.description) + '</p>'
      : '';

    return (
      '<article class="issue" data-id="' + escapeHtml(issue.id) + '"' +
        ' data-status="' + escapeHtml(issue.status) + '"' +
        ' data-priority="' + escapeHtml(issue.priority) + '">' +
        '<div class="issue-top">' +
          '<button class="issue-toggle" type="button" data-action="toggle" ' +
            'title="Toggle done / pending" aria-label="Toggle status">✓</button>' +
          '<div class="issue-body">' +
            '<div class="issue-title">' + escapeHtml(issue.title) + '</div>' +
            description +
            '<div class="issue-meta">' +
              '<span class="badge ' + escapeHtml(issue.status) + '">' + escapeHtml(issue.status) + '</span>' +
              '<span class="badge ' + escapeHtml(issue.priority) + '">' + escapeHtml(issue.priority) + '</span>' +
              label +
              '<span class="issue-date">Created ' + escapeHtml(formatDate(issue.createdAt)) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="issue-actions">' +
            '<button class="btn ghost" type="button" data-action="edit">Edit</button>' +
            '<button class="btn ghost danger" type="button" data-action="delete">Delete</button>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderIssues() {
    const total = issues.length;
    const done = issues.filter((i) => i.status === 'done').length;
    const pending = total - done;
    const high = issues.filter((i) => i.priority === 'high' && i.status !== 'done').length;

    $('statTotal').textContent = total;
    $('statPending').textContent = pending;
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
        $('emptyText').textContent = 'Add your first issue using the form above.';
      } else {
        $('emptyTitle').textContent = 'No matching issues';
        $('emptyText').textContent = 'Try changing the filters or search text.';
      }
      return;
    }

    emptyEl.hidden = true;
    listEl.innerHTML = list.map(issueCard).join('');
  }

  function onListClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = button.closest('.issue');
    if (!card) return;
    const id = card.dataset.id;
    const action = button.dataset.action;

    if (action === 'toggle') toggleStatus(id);
    else if (action === 'edit') startEdit(id);
    else if (action === 'delete') deleteIssue(id);
  }

  /* ---------------------------- import / export -------------------------- */

  function exportBackup() {
    const payload = {
      app: 'issue-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      issues,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'issues-backup-' + stamp + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded.');
  }

  function importBackup(file) {
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
            status: i.status === 'done' ? 'done' : 'pending',
            label: typeof i.label === 'string' ? i.label : '',
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
      } catch {
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
    $('clearDoneBtn').addEventListener('click', clearDone);

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

    // Keep the session honest if another tab signs out.
    window.addEventListener('storage', (e) => {
      if (e.key === KEYS.session && !getSession() && currentUser) {
        currentUser = null;
        showAuth(false);
      }
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
    if (session) showApp(session.username);
    else showAuth(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
