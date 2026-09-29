/* ============================================================================
 * js/page-settings.js
 * ----------------------------------------------------------------------------
 * Dark mode (localStorage, same "it.theme" key as before), clear all filters,
 * and logout.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };

  /** Filters are remembered in localStorage by the enhancements layer. */
  var FILTER_PREFIXES = ['et.', 'it.filters', 'filters'];

  function clearAllFilters() {
    var removed = 0;

    try {
      var keys = Object.keys(localStorage);
      keys.forEach(function (k) {
        var lower = k.toLowerCase();
        var match = FILTER_PREFIXES.some(function (p) {
          return lower.indexOf(p.toLowerCase()) === 0;
        });
        if (match) { localStorage.removeItem(k); removed++; }
      });
    } catch (e) { /* ignore */ }

    // Drop any ?preset / ?month / ?from / ?to / ?status query string too.
    if (location.search) {
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
    }

    var status = $('settingsStatus');
    if (status) {
      status.textContent = removed
        ? 'Cleared ' + removed + ' saved filter(s). Reload the Issues page to see all issues.'
        : 'Cleared filters. Reload the Issues page to see all issues.';
    }
    ET.toast('Filters cleared.');
  }

  /* ------------------------------ notifications -------------------------- */

  function initPush() {
    var toggle = $('pushToggle');
    var note = $('pushNote');
    if (!toggle || !note) return;

    function say(text) { note.textContent = text; }

    if (!ET.push || !ET.push.supported()) {
      toggle.disabled = true;
      say('This browser does not support notifications.');
      return;
    }
    if (!ET.push.configured()) {
      toggle.disabled = true;
      say('Not set up yet — add your VAPID public key to supabase-config.js.');
      return;
    }

    ET.push.isEnabled().then(function (on) {
      toggle.checked = on;
      say(on ? 'On for this device.' : 'Off for this device.');
    });

    toggle.addEventListener('change', function () {
      toggle.disabled = true;
      var work = toggle.checked ? ET.push.enable() : ET.push.disable();
      work.then(function (result) {
        toggle.disabled = false;
        toggle.checked = !!result;
        say(result ? 'On for this device.' : 'Off for this device.');
      });
    });
  }

  /* --------------------------- automatic backups ------------------------- */

  var backups = [];

  function backupNote(text) {
    var n = $('backupNote');
    if (n) n.textContent = text || '';
  }

  function renderBackups() {
    var list = $('backupList');
    var count = $('backupCount');
    if (count) count.textContent = backups.length;
    if (!list) return;

    if (!backups.length) {
      list.innerHTML = '<p class="muted small">No snapshots yet.</p>';
      return;
    }
    list.innerHTML = backups.map(function (b) {
      return '<div class="backup-row">' +
        '<span class="backup-when">' + ET.escapeHtml(ET.formatDate(Date.parse(b.created_at))) + '</span>' +
        '<span class="badge">' + ET.escapeHtml(b.kind) + '</span>' +
        '<span class="muted small">' + b.issue_count + ' issue(s)</span>' +
        '<button type="button" class="btn ghost" data-restore="' + ET.escapeHtml(b.id) + '">Restore</button>' +
      '</div>';
    }).join('');
  }

  async function loadBackups() {
    var sb = ET.getClient();
    if (!sb) return;
    var results = await Promise.all([
      sb.from('app_settings').select('auto_backup_enabled').limit(1),
      sb.from('backups').select('id, created_at, kind, issue_count')
        .order('created_at', { ascending: false }).limit(30)
    ]);
    var settingsRes = results[0], backupsRes = results[1];
    if (settingsRes.error || backupsRes.error) {
      backupNote('Could not load backups: ' + ET.friendlyError(settingsRes.error || backupsRes.error));
      return;
    }
    var row = (settingsRes.data || [])[0];
    var toggle = $('autoBackupToggle');
    if (toggle) toggle.checked = !row || row.auto_backup_enabled !== false;
    backups = backupsRes.data || [];
    renderBackups();
  }

  async function createBackup() {
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.rpc('create_backup');
    if (res.error) { backupNote(ET.friendlyError(res.error)); return; }
    await loadBackups();
    backupNote('Backup taken.');
    ET.toast('Backup taken.');
  }

  async function restoreBackup(id) {
    var ok = await ET.confirm('Restore this snapshot? The current issues will be replaced ' +
      '(a safety snapshot is taken first).', { title: 'Restore backup', okLabel: 'Restore' });
    if (!ok) return;
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.rpc('restore_backup', { p_id: id });
    if (res.error) { backupNote(ET.friendlyError(res.error)); return; }
    await loadBackups();
    backupNote('Restored ' + (res.data || 0) + ' issue(s).');
    ET.toast('Backup restored.');
  }

  function initBackups() {
    var panel = $('backupPanel');
    if (panel) panel.hidden = false;

    var toggle = $('autoBackupToggle');
    if (toggle) toggle.addEventListener('change', async function () {
      var sb = ET.getClient();
      if (!sb) return;
      var res = await sb.from('app_settings').update({ auto_backup_enabled: toggle.checked }).eq('id', true);
      if (res.error) { backupNote(ET.friendlyError(res.error)); return; }
      backupNote(toggle.checked ? 'Automatic backups on.' : 'Automatic backups off.');
    });

    var now = $('backupNowBtn');
    if (now) now.addEventListener('click', createBackup);
    var refresh = $('backupRefreshBtn');
    if (refresh) refresh.addEventListener('click', loadBackups);

    var list = $('backupList');
    if (list) list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-restore]');
      if (btn) restoreBackup(btn.getAttribute('data-restore'));
    });

    loadBackups();
  }

  async function init() {
    var user = await ET.layout.render({ active: 'settings', title: 'Settings' });
    if (!user) return;

    var themeOpts = document.querySelectorAll('[data-theme-opt]');
    if (themeOpts.length) {
      function paintTheme() {
        var t = ET.layout.currentTheme();
        Array.prototype.forEach.call(themeOpts, function (b) {
          b.classList.toggle('active', b.getAttribute('data-theme-opt') === t);
        });
      }
      Array.prototype.forEach.call(themeOpts, function (b) {
        b.addEventListener('click', function () {
          ET.layout.setTheme(b.getAttribute('data-theme-opt'));
          paintTheme();
        });
      });
      paintTheme();
    }

    if (ET.auth.isAdmin()) initBackups();
    initPush();

    var clearBtn = $('clearFiltersBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);

    var logoutBtn = $('settingsLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', function (e) { ET.auth.logout(e); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
