/* ============================================================================
 * js/sidebar.js
 * ----------------------------------------------------------------------------
 * ADMIN-ONLY sidebar section: real <a href> links to the admin status pages.
 *
 * ADDITIVE. It only:
 *   - reads the role that js/auth.js already resolved (profiles.role),
 *   - adds body.role-admin / body.role-user,
 *   - appends one <aside id="admin-sidebar"> inside the EXISTING sidebar.
 * Nothing else in the app is touched. No parallel data logic exists here.
 *
 * Loaded on every app page. On non-admin sessions it renders nothing.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;

  /* ---------------------------------------------------------------------------
   * Set true to hide the WHOLE sidebar from non-admins.
   * Left false: on this multi-page app the sidebar is the only navigation, so
   * a reporter would be stranded on whatever page they land on.
   * ------------------------------------------------------------------------- */
  var HIDE_NAV_FOR_USERS = false;

  var $ = function (id) { return document.getElementById(id); };

  var ADMIN_LINKS = [
    { label: 'Status',      icon: '📊', href: 'admin-status.html' },
    { label: 'All issues',  icon: '🏠', href: 'admin-all.html' },
    { sep: true },
    { label: 'Users',       icon: '👥', href: 'users.html' },
    { label: 'Backups',     icon: '💾', href: 'admin-backups.html' },
    { label: 'Recycle bin', icon: '🗑️', href: 'admin-recyclebin.html' }
  ];

  function currentFile() {
    var parts = String(location.pathname).split('/');
    return parts[parts.length - 1] || 'index.html';
  }

  function remove() {
    var old = $('admin-sidebar');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function render() {
    var sidebar = $('sidebar');
    if (!sidebar) return;

    remove();

    var here = currentFile();
    var aside = document.createElement('aside');
    aside.id = 'admin-sidebar';
    aside.setAttribute('aria-label', 'Admin issue views');

    var html = '<div class="as-title">Admin</div><nav class="as-nav">';
    ADMIN_LINKS.forEach(function (l) {
      if (l.sep) {
        html += '</nav><div class="as-sep"></div><nav class="as-nav">';
        return;
      }
      var active = l.href === here;
      html += '<a class="as-link' + (active ? ' active' : '') + '" href="' + l.href + '"' +
        (active ? ' aria-current="page"' : '') + '>' +
        '<span class="as-icon" aria-hidden="true">' + l.icon + '</span>' +
        '<span>' + l.label + '</span>' +
      '</a>';
    });
    html += '</nav>';
    html += '<div id="as-backup" style="font-size:.72rem;opacity:.72;padding:.5rem .75rem 0;" ' +
            'role="status" aria-live="polite"></div>';
    aside.innerHTML = html;

    // Between the page nav and the user card.
    var foot = sidebar.querySelector('.sidebar-foot');
    if (foot) sidebar.insertBefore(aside, foot);
    else sidebar.appendChild(aside);

    renderBackupStatus();
  }

  /* ---------------------------------------------------------------------------
   * Backup status for admins, under the admin links on every page.
   * Reads the newest snapshot. If the SQL half has not been run yet it says so
   * instead of throwing.
   * ------------------------------------------------------------------------- */
  async function renderBackupStatus() {
    var box = $('as-backup');
    if (!box) return;

    var sb = ET.getClient && ET.getClient();
    if (!sb) { box.textContent = ''; return; }

    try {
      // Switched off by an admin? Show that instead of a stale time.
      var setting = await sb.from('app_settings').select('auto_backup_enabled').limit(1);
      if (!setting.error && setting.data && setting.data.length &&
          setting.data[0].auto_backup_enabled === false) {
        box.textContent = '💾 Backups: paused';
        box.title = 'Automatic backups are switched off.';
        return;
      }

      var res = await sb.from('backups')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1);

      if (res.error) {
        box.textContent = /does not exist|schema cache|Could not find/i.test(String(res.error.message))
          ? 'Backups: run sql/auto_backup.sql'
          : '';
        return;
      }
      if (!res.data || !res.data.length) {
        box.textContent = 'Backups: none yet';
        return;
      }

      var when = Date.parse(res.data[0].created_at);
      box.textContent = '💾 Backed up ' + ET.timeAgo(when);
      box.title = 'Newest automatic backup: ' + ET.formatDate(when);
    } catch (e) {
      box.textContent = '';
    }
  }

  /* ================================ API ================================= */

  ET.sidebar = {
    mount: function (user) {
      if (!user) return;

      var isAdmin = user.role === ET.ADMIN;

      document.body.classList.toggle('role-admin', isAdmin);
      document.body.classList.toggle('role-user', !isAdmin);

      if (!isAdmin) {
        remove();                                  // reporters never see it
        if (HIDE_NAV_FOR_USERS) {
          var sb = $('sidebar');
          if (sb) sb.hidden = true;
        }
        return;
      }

      render();
    }
  };
})();
