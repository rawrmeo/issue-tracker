/* ============================================================================
 * js/page-admin-backups.js
 * ----------------------------------------------------------------------------
 * ADMIN ONLY. The automatic half lives in the database (see
 * sql/auto_backup.sql): a trigger snapshots every issue whenever the board
 * changes, and a daily cron job covers quiet days.
 *
 * This page is the window onto those snapshots. It lets an admin:
 *   - see when each backup was taken and how many issues it holds,
 *   - take one immediately ("Back up now"),
 *   - download one as JSON,
 *   - restore one (the database takes a safety snapshot first),
 *   - delete one.
 *
 * It also tops up on its own: opening this page when the newest backup is more
 * than a day old takes a fresh one, without anyone pressing anything. That is
 * the fallback for projects where pg_cron was never enabled.
 *
 * Snapshots are only ever written by the database functions, never from here,
 * so a reporter cannot fill the table.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };

  var KEEP              = 30;    // must match n_keep in sql/auto_backup.sql
  var TOP_UP_AFTER_HOURS = 24;   // top up automatically if the newest is older

  var backups = [];
  var autoOn = true;             // mirrors app_settings.auto_backup_enabled
  var escapeHtml = ET.escapeHtml;
  var toast = ET.toast;

  function client() { return ET.getClient(); }

  function setStatus(text) {
    var el = $('backupStatus');
    if (el) el.textContent = text || '';
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  /** Is the SQL half missing? Give the one instruction that fixes it. */
  function missingTable(error) {
    var msg = String((error && error.message) || '');
    return /does not exist|schema cache|Could not find the table/i.test(msg);
  }

  /* ------------------------------- loading ------------------------------- */

  async function loadBackups() {
    var sb = client();
    if (!sb) return;

    var res = await sb.from('backups')
      .select('id, created_at, kind, issue_count')
      .order('created_at', { ascending: false })
      .limit(60);

    if (res.error) {
      if (missingTable(res.error)) {
        setStatus('The backups table is not there yet. Run sql/auto_backup.sql in the Supabase SQL Editor, then reload this page.');
      } else {
        setStatus('Could not load backups: ' + ET.friendlyError(res.error));
      }
      return;
    }

    backups = res.data || [];
    renderList();
  }

  /* ------------------------------ settings ------------------------------- */

  /** The automatic-backup switch, stored in the database so the trigger and
      the nightly job see it too — not in this browser. */
  async function loadSettings() {
    var sb = client();
    if (!sb) return;

    var res = await sb.from('app_settings').select('auto_backup_enabled').limit(1);

    if (res.error) {
      setAutoState(null, res.error);
      return;
    }

    autoOn = !!(res.data && res.data.length) ? res.data[0].auto_backup_enabled !== false : true;
    setAutoState(autoOn);
  }

  function setAutoState(on, error) {
    var toggle = $('autoBackupToggle');
    var chip = $('autoState');
    var note = $('autoBackupNote');

    // Never leave a dead switch. It stays usable, and if the SQL half is not
    // in place yet the note says so and the change reports itself.
    if (toggle) {
      toggle.disabled = false;
      toggle.checked = on !== false;
    }

    if (on === null) {
      if (chip) {
        chip.textContent = 'not set up';
        chip.className = 'role-chip role-user';
        chip.title = String((error && error.message) || '');
      }
      if (note) {
        note.textContent = 'Automatic backups are not set up in this database yet, ' +
          'so this switch cannot be saved. Run sql/auto_backup.sql in the Supabase ' +
          'SQL Editor, then reload this page.';
      }
      return;
    }

    if (note) note.textContent = '';

    if (chip) {
      if (on) {
        chip.textContent = 'on';
        chip.className = 'role-chip role-admin';
        chip.title = 'Snapshots are taken automatically as issues change.';
      } else {
        chip.textContent = 'paused';
        chip.className = 'role-chip role-user';
        chip.title = 'Automatic snapshots are switched off.';
      }
    }
  }

  /** Say which file to run rather than showing a raw PostgREST error. */
  function friendlyBackupError(error) {
    var m = String((error && error.message) || '');
    if (/Could not find the table|PGRST205|does not exist|schema cache/i.test(m)) {
      return 'Automatic backups are not set up in this database yet. Run sql/auto_backup.sql in the Supabase SQL Editor, then reload.';
    }
    if (/Could not find the function|PGRST202/i.test(m)) {
      return 'The backup functions are missing. Run sql/auto_backup.sql in the Supabase SQL Editor, then reload.';
    }
    if (/row-level security|permission denied/i.test(m)) {
      return 'Only an admin can change the automatic-backup switch.';
    }
    return ET.friendlyError(error);
  }

  async function saveAutoBackup(on) {
    var sb = client();
    if (!sb) return;

    var toggle = $('autoBackupToggle');
    if (toggle) toggle.disabled = true;

    var res = await sb.from('app_settings')
      .update({ auto_backup_enabled: on, updated_at: new Date().toISOString() })
      .eq('id', true);

    if (toggle) toggle.disabled = false;

    if (res.error) {
      toast(friendlyBackupError(res.error));
      loadSettings();                 // put the switch back where it really is
      return;
    }

    autoOn = on;
    setAutoState(on);
    toast(on ? 'Automatic backups resumed.' : 'Automatic backups paused.');
    setStatus(on
      ? 'Automatic backups are on \u2014 a snapshot is taken as issues change.'
      : 'Automatic backups are paused. Nothing is being snapshotted automatically.');
  }

  /* ------------------------------ rendering ------------------------------ */

  function renderList() {
    var list = $('backupList');
    if (!list) return;

    setText('backupCount', backups.length);

    if (!backups.length) {
      list.innerHTML =
        '<p class="muted">No snapshots yet. One is taken automatically as soon as ' +
        'an issue is filed, or press <strong>Back up now</strong>.</p>';
      setStatus('No backups yet.');
      return;
    }

    list.innerHTML = backups.map(function (b, i) {
      var taken = Date.parse(b.created_at);
      var isNewest = i === 0;
      var kindLabel = b.kind === 'manual' ? 'manual' : 'auto';
      var count = b.issue_count;

      return (
        '<div class="user-row" data-id="' + escapeHtml(b.id) + '">' +
          '<div class="user-info">' +
            '<span class="user-name">' + escapeHtml(ET.formatDate(taken)) + '</span>' +
            '<span class="role-chip role-' + (b.kind === 'manual' ? 'admin' : 'user') + '">' +
              escapeHtml(kindLabel) +
            '</span>' +
            (isNewest ? '<span class="badge mine">latest</span>' : '') +
            '<span class="issue-date">' +
              escapeHtml(ET.timeAgo(taken)) + ' &middot; ' + count +
              ' issue' + (count === 1 ? '' : 's') +
            '</span>' +
          '</div>' +
          '<div class="user-actions">' +
            '<button class="btn ghost" type="button" data-action="download">Download</button>' +
            '<button class="btn ghost" type="button" data-action="restore">Restore</button>' +
            '<button class="btn danger" type="button" data-action="delete">Delete</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    setStatus(
      backups.length + ' snapshot' + (backups.length === 1 ? '' : 's') +
      ' \u2014 newest ' + ET.timeAgo(Date.parse(backups[0].created_at)) +
      '. Keeping the newest ' + KEEP + '.'
    );
  }

  /* ------------------------------- actions ------------------------------- */

  async function createBackup(silent) {
    var sb = client();
    if (!sb) return;

    var btn = $('backupNowBtn');
    if (!silent) ET.setBusy(btn, true, 'Backing up\u2026');

    var res = await sb.rpc('create_backup');

    if (!silent) ET.setBusy(btn, false);

    if (res.error) {
      var msg = friendlyBackupError(res.error);
      setStatus(msg);
      if (!silent) toast(msg);
      return;
    }

    await loadBackups();
    if (silent) {
      setStatus('Automatic backup taken just now.');
    } else {
      toast('Backup taken.');
    }
  }

  /** Opening the page is itself enough to keep backups fresh — unless an admin
      has switched automatic backups off. */
  async function topUpIfStale() {
    if (!autoOn) return;
    if (!backups.length) {
      await createBackup(true);
      return;
    }
    var ageMs = Date.now() - Date.parse(backups[0].created_at);
    if (ageMs > TOP_UP_AFTER_HOURS * 3600 * 1000) await createBackup(true);
  }

  async function downloadBackup(b) {
    var sb = client();
    if (!sb) return;

    var res = await sb.from('backups').select('payload').eq('id', b.id).single();
    if (res.error) { toast(ET.friendlyError(res.error)); return; }

    var doc = {
      app: 'issue-tracker',
      kind: 'backup',
      backupId: b.id,
      takenAt: b.created_at,
      issueCount: b.issue_count,
      exportedAt: new Date().toISOString(),
      issues: (res.data && res.data.payload) || []
    };

    var blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'issue-tracker-backup-' + String(b.created_at).replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

    toast('Backup downloaded.');
  }

  async function restoreBackup(b) {
    var ok = await ET.confirm(
      'Replace the current issues with the ' + b.issue_count + ' in this snapshot from ' +
      ET.formatDate(Date.parse(b.created_at)) + '?\n\n' +
      'A safety snapshot is taken first, so you can undo this by restoring the newest backup afterwards.',
      { title: 'Restore this backup?', okLabel: 'Restore' }
    );
    if (!ok) return;

    var sb = client();
    if (!sb) return;

    var row = document.querySelector('.user-row[data-id="' + b.id + '"]');
    var btn = row ? row.querySelector('button[data-action="restore"]') : null;
    ET.setBusy(btn, true, 'Restoring\u2026');

    var res = await sb.rpc('restore_backup', { p_id: b.id });
    ET.setBusy(btn, false);

    if (res.error) { toast(ET.friendlyError(res.error)); return; }

    await loadBackups();
    toast('Restored ' + res.data + ' issue' + (res.data === 1 ? '' : 's') + '.');
  }

  async function deleteBackup(b) {
    var ok = await ET.confirm(
      'Delete this snapshot? The issues themselves are not touched \u2014 only this saved copy.',
      { title: 'Delete backup', okLabel: 'Delete' }
    );
    if (!ok) return;

    var sb = client();
    if (!sb) return;

    var res = await sb.from('backups').delete().eq('id', b.id);
    if (res.error) { toast(ET.friendlyError(res.error)); return; }

    await loadBackups();
    toast('Backup deleted.');
  }

  /* -------------------------------- wiring ------------------------------- */

  function bindEvents() {
    var nowBtn = $('backupNowBtn');
    if (nowBtn) nowBtn.addEventListener('click', function () { createBackup(false); });

    var refreshBtn = $('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { loadBackups(); });

    var toggle = $('autoBackupToggle');
    if (toggle) toggle.addEventListener('change', function () { saveAutoBackup(toggle.checked); });

    var list = $('backupList');
    if (!list) return;

    list.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (!button) return;

      var row = button.closest('.user-row');
      if (!row) return;

      var backup = backups.filter(function (x) { return x.id === row.dataset.id; })[0];
      if (!backup) return;

      var action = button.dataset.action;
      if (action === 'download') downloadBackup(backup);
      else if (action === 'restore') restoreBackup(backup);
      else if (action === 'delete') deleteBackup(backup);
    });
  }

  /* --------------------------------- boot -------------------------------- */

  async function init() {
    var user = await ET.layout.render({
      active: 'admin-backups',
      title: 'Backups',
      requireAdmin: true
    });
    if (!user) return;

    if (!ET.isConfigured()) {
      setStatus('Supabase is not configured, so backups are unavailable.');
      return;
    }

    bindEvents();
    await loadSettings();
    await loadBackups();
    await topUpIfStale();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
