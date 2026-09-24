/* ============================================================================
 * js/layout.js
 * ----------------------------------------------------------------------------
 * Renders the shared sidebar + topbar on every app page so the markup is not
 * repeated six times.
 *
 * IMPORTANT — id reuse:
 *   The sidebar/topbar deliberately reuse the ids the existing code expects
 *   (#userChip, #roleChip, #themeBtn, #logoutBtn, #liveDot). That is what lets
 *   the moved app.js logic keep working untouched. enhancements.js also reads
 *   #roleChip, so the "admin"/"user" text and the role-admin class matter.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;

  var $ = function (id) { return document.getElementById(id); };

  var NAV = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠', href: 'dashboard.html' },
    { key: 'issues',    label: 'Issues',    icon: '📋', href: 'issues.html' }
  ];

  /* These sit at the bottom of the sidebar, just above the account card. */
  var FOOTER_NAV = [
    { key: 'profile',   label: 'Profile',   icon: '👤', href: 'profile.html' },
    { key: 'settings',  label: 'Settings',  icon: '⚙️', href: 'settings.html' }
  ];

  /* ================================= theme =============================== */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    var btn = $('themeBtn');
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = btn.getAttribute('aria-label');
    }
    var sw = $('settingsTheme');
    if (sw) sw.checked = theme === 'dark';
  }

  function currentTheme() {
    try { return localStorage.getItem(ET.THEME_KEY) === 'dark' ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }

  function setTheme(theme) {
    try { localStorage.setItem(ET.THEME_KEY, theme); } catch (e) { /* ignore */ }
    applyTheme(theme);
  }

  function toggleTheme() {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  /* ============================== mobile nav ============================= */

  function openSidebar() {
    var sb = $('sidebar'), bd = $('backdrop');
    if (!sb) return;
    sb.classList.add('open');
    if (bd) { bd.hidden = false; requestAnimationFrame(function () { bd.classList.add('show'); }); }
  }

  function closeSidebar() {
    var sb = $('sidebar'), bd = $('backdrop');
    if (sb) sb.classList.remove('open');
    if (bd) {
      bd.classList.remove('show');
      setTimeout(function () { if (!bd.classList.contains('show')) bd.hidden = true; }, 220);
    }
  }

  /* ============================== rendering ============================== */

  function linkHtml(item, active) {
    return '<a class="nav-link' + (item.key === active ? ' active' : '') + '"' +
      ' href="' + item.href + '"' +
      (item.key === active ? ' aria-current="page"' : '') + '>' +
      '<span class="nav-icon" aria-hidden="true">' + item.icon + '</span>' +
      '<span>' + item.label + '</span>' +
    '</a>';
  }

  function sidebarHtml(user, active) {
    var admin = user.role === ET.ADMIN;

    var links = NAV.map(function (item) {
      if (item.admin && !admin) return '';           // Users link hidden for reporters
      return linkHtml(item, active);
    }).join('');

    var footerLinks = FOOTER_NAV.map(function (item) {
      return linkHtml(item, active);
    }).join('');

    var initial = ET.escapeHtml((user.username || '?').charAt(0).toUpperCase());
    var roleLabel = admin ? 'Admin' : 'User';

    return '' +
      '<div class="sidebar-brand">' +
        '<span class="brand-mark" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span>' +
        '<span>Issue Tracker</span>' +
      '</div>' +

      '<nav class="nav" aria-label="Main">' + links + '</nav>' +

      '<div class="sidebar-foot">' +
        '<nav class="nav nav-foot" aria-label="Account">' + footerLinks + '</nav>' +
        '<div class="user-card">' +
          '<span class="avatar" id="sidebarAvatar">' + initial + '</span>' +
          '<div class="user-meta">' +
            '<span class="user-name" id="userChip">' + ET.escapeHtml(user.username) + '</span>' +
            '<span class="role-chip role-' + ET.escapeHtml(user.role) + '" id="roleChip">' +
              ET.escapeHtml(roleLabel.toLowerCase()) +
            '</span>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn ghost block" id="logoutBtn">Logout</button>' +
      '</div>';
  }

  function topbarHtml(title, user) {
    var admin = user.role === ET.ADMIN;
    return '' +
      '<button type="button" class="btn ghost icon menu-btn" id="menuBtn" aria-label="Open menu">☰</button>' +
      '<div class="topbar-heading">' +
        '<h1 class="topbar-title" id="pageTitle">' + ET.escapeHtml(title) + '</h1>' +
        '<span class="role-badge' + (admin ? ' is-admin' : '') + '" id="roleBadge">' +
          (admin ? 'Admin' : 'User') +
        '</span>' +
      '</div>' +
      '<div class="topbar-actions">' +
        '<span class="live-dot" id="liveDot" title="Live updates"></span>' +
        '<button type="button" class="btn ghost icon" id="themeBtn" title="Toggle light / dark" aria-label="Toggle theme">🌙</button>' +
        '<div class="role-menu">' +
          '<button type="button" class="btn" id="roleMenuBtn" aria-haspopup="true" aria-expanded="false">' +
            (admin ? 'Admin' : 'User') + ' ▾' +
          '</button>' +
          '<div class="role-menu-panel" id="roleMenuPanel" hidden>' +
            '<a href="profile.html">Profile</a>' +
            '<a href="settings.html">Settings</a>' +
            '<div class="sep"></div>' +
            '<button type="button" id="roleMenuLogout">Logout</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ================================ wiring ============================== */

  function wire() {
    var menuBtn = $('menuBtn');
    if (menuBtn) menuBtn.addEventListener('click', openSidebar);

    var backdrop = $('backdrop');
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    var themeBtn = $('themeBtn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    var logout = $('logoutBtn');
    if (logout) logout.addEventListener('click', function (e) { ET.auth.logout(e); });

    var roleLogout = $('roleMenuLogout');
    if (roleLogout) roleLogout.addEventListener('click', function (e) { ET.auth.logout(e); });

    var roleBtn = $('roleMenuBtn');
    var rolePanel = $('roleMenuPanel');
    if (roleBtn && rolePanel) {
      roleBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = rolePanel.hidden;
        rolePanel.hidden = !open;
        roleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function () {
        if (!rolePanel.hidden) {
          rolePanel.hidden = true;
          roleBtn.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          rolePanel.hidden = true;
          closeSidebar();
        }
      });
    }
  }

  /**
   * ET.layout.render({ active, title, requireAdmin })
   * Renders the shell, then hands control back to the page script.
   */
  ET.layout = {
    render: async function (opts) {
      opts = opts || {};

      applyTheme(currentTheme());

      var user = await ET.auth.guard();
      if (!user) return null;                        // already redirected

      if (opts.requireAdmin && !ET.auth.isAdmin()) {
        ET.go('pages/dashboard.html');
        return null;
      }

      var sidebar = $('sidebar');
      if (sidebar) sidebar.innerHTML = sidebarHtml(user, opts.active || '');

      var topbar = $('topbar');
      if (topbar) topbar.innerHTML = topbarHtml(opts.title || '', user);

      applyTheme(currentTheme());
      wire();

      // ADDED: admin-only status sidebar. Guarded, so pages that don't load
      // js/sidebar.js (every page except Issues) are unaffected.
      if (ET.sidebar && typeof ET.sidebar.mount === 'function') {
        ET.sidebar.mount(user);
      }

      document.title = (opts.title ? opts.title + ' · ' : '') + 'Issue Tracker';
      return user;
    },
    setTitle: function (title) {
      var el = $('pageTitle');
      if (el) el.textContent = title;
    },
    closeSidebar: closeSidebar,
    applyTheme: applyTheme,
    setTheme: setTheme,
    currentTheme: currentTheme
  };
})();
