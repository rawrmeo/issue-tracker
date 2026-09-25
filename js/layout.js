/* ============================================================================
 * js/layout.js
 * ----------------------------------------------------------------------------
 * Renders the shared sidebar + topbar on every app page so the markup is not
 * repeated six times.
 *
 * IMPORTANT — id reuse:
 *   The sidebar/topbar reuse the ids the existing code expects
 *   (#userChip, #roleChip, #logoutBtn, #liveDot, #menuBtn). enhancements.js
 *   also reads #roleChip, so the role text and the role-admin class matter.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;

  var $ = function (id) { return document.getElementById(id); };

  /* Main links sit at the top of the sidebar; the account group (Profile,
     Settings, Archive) is pinned to the bottom. `bottom: true` also puts an
     entry in the phone's bottom bar. */
  var NAV = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠', href: 'dashboard.html',    group: 'main', bottom: true },
    { key: 'issues',    label: 'Issues',    icon: '📋', href: 'issues.html',       group: 'main', bottom: true },
    { key: 'users',     label: 'Users',     icon: '👥', href: 'users.html',        group: 'main', admin: true },
    { key: 'profile',   label: 'Profile',   icon: '👤', href: 'profile.html',      group: 'foot', bottom: true },
    { key: 'settings',  label: 'Settings',  icon: '⚙️', href: 'settings.html',     group: 'foot', bottom: true },
    { key: 'archive',   label: 'Archive',   icon: '🗄️', href: 'recycle-bin.html',  group: 'foot', admin: true, bottom: true }
  ];

  /* ================================= theme =============================== */

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');   // "auto" — the OS decides
    }
    syncThemeControl(theme);
  }

  function currentTheme() {
    try {
      var t = localStorage.getItem(ET.THEME_KEY);
      return (t === 'dark' || t === 'light') ? t : 'auto';
    } catch (e) { return 'auto'; }
  }

  function setTheme(theme) {
    try {
      if (theme === 'auto') localStorage.removeItem(ET.THEME_KEY);
      else localStorage.setItem(ET.THEME_KEY, theme);
    } catch (e) { /* ignore */ }
    applyTheme(theme);
  }

  /* Highlights the Auto / Light / Night buttons on the Settings page. */
  function syncThemeControl(theme) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-opt]'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-theme-opt') === theme);
    });
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

  function sidebarHtml(user, active) {
    var admin = user.role === ET.ADMIN;

    function link(item) {
      return '<a class="nav-link' + (item.key === active ? ' active' : '') + '"' +
        ' href="' + item.href + '"' +
        (item.key === active ? ' aria-current="page"' : '') + '>' +
        '<span class="nav-icon" aria-hidden="true">' + item.icon + '</span>' +
        '<span>' + item.label + '</span>' +
      '</a>';
    }

    var allowed = function (item) { return !item.admin || admin; };
    var mainLinks = NAV.filter(function (i) { return i.group === 'main' && allowed(i); }).map(link).join('');
    var footLinks = NAV.filter(function (i) { return i.group === 'foot' && allowed(i); }).map(link).join('');

    var initial = ET.escapeHtml((user.username || '?').charAt(0).toUpperCase());
    var roleLabel = admin ? 'Admin' : 'User';

    return '' +
      '<div class="sidebar-brand">' +
        '<span class="brand-mark" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span>' +
        '<span>Issue Tracker</span>' +
      '</div>' +

      '<nav class="nav" aria-label="Main">' + mainLinks + '</nav>' +

      '<nav class="nav sidebar-nav-bottom" aria-label="Account">' + footLinks + '</nav>' +

      '<div class="sidebar-foot">' +
        '<div class="user-card">' +
          '<span class="avatar" id="sidebarAvatar">' + initial + '</span>' +
          '<div class="user-meta">' +
            '<span class="user-name" id="userChip">' + ET.escapeHtml(user.username) + '</span>' +
            '<span class="role-chip role-' + ET.escapeHtml(user.role) + '" id="roleChip">' +
              ET.escapeHtml(roleLabel.toLowerCase()) +
            '</span>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn ghost block" data-install-btn hidden>Install app</button>' +
        '<button type="button" class="btn ghost block" id="logoutBtn">Logout</button>' +
      '</div>';
  }

  function topbarHtml(title) {
    return '' +
      '<button type="button" class="btn ghost icon menu-btn" id="menuBtn" aria-label="Open menu">☰</button>' +
      '<div class="topbar-heading">' +
        '<h1 class="topbar-title" id="pageTitle">' + ET.escapeHtml(title) + '</h1>' +
      '</div>' +
      '<div class="topbar-actions">' +
        '<span class="live-dot" id="liveDot" title="Live updates"></span>' +
      '</div>';
  }

  /* =========================== bottom nav (mobile) ======================= */

  /* A fixed bottom bar for phones, showing the NAV entries flagged `bottom`.
     The hamburger in the topbar still opens the full sidebar. Hidden by CSS on
     wider screens. */
  function bottomNavHtml(user, active) {
    var admin = user.role === ET.ADMIN;
    var items = NAV.filter(function (item) { return item.bottom && (!item.admin || admin); });

    return items.map(function (item) {
      return '<a class="bn-link' + (item.key === active ? ' active' : '') + '"' +
        ' href="' + item.href + '"' +
        (item.key === active ? ' aria-current="page"' : '') + '>' +
        '<span class="bn-icon" aria-hidden="true">' + item.icon + '</span>' +
        '<span class="bn-label">' + item.label + '</span>' +
      '</a>';
    }).join('');
  }

  function mountBottomNav(user, active) {
    var old = $('bottomNav');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var nav = document.createElement('nav');
    nav.id = 'bottomNav';
    nav.className = 'bottom-nav';
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = bottomNavHtml(user, active);

    document.body.appendChild(nav);
  }

  /* ================================ wiring ============================== */

  function wire() {
    var menuBtn = $('menuBtn');
    if (menuBtn) menuBtn.addEventListener('click', openSidebar);

    var backdrop = $('backdrop');
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    var logout = $('logoutBtn');
    if (logout) logout.addEventListener('click', function (e) { ET.auth.logout(e); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSidebar();
    });
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

      mountBottomNav(user, opts.active || '');

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
