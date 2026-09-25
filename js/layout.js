/* ============================================================================
 * js/layout.js
 * ----------------------------------------------------------------------------
 * Renders the shared sidebar + topbar on every app page so the markup is not
 * repeated six times.
 *
 * IMPORTANT — ids the rest of the app expects:
 *   #menuBtn, #logoutBtn, #liveDot, #pageTitle, #profileMenuBtn and
 *   #profileMenuPanel. Some legacy helpers look for #userChip / #roleChip, so
 *   keep reading the role from ET.auth (enhancements.js does).
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;

  var $ = function (id) { return document.getElementById(id); };

  /* Main links sit at the top of the sidebar. Profile + Settings live in the
     top-right profile menu; Archive sits under Users; only Logout is pinned to
     the bottom. `bottom: true` also puts an entry in the phone's bottom bar. */
  var NAV = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠', href: 'dashboard.html',    group: 'main', bottom: true },
    { key: 'issues',    label: 'Issues',    icon: '📋', href: 'issues.html',       group: 'main', bottom: true },
    { key: 'reports',   label: 'Reports',   icon: '📊', href: 'reports.html',      group: 'main', admin: true, bottom: true },
    { key: 'users',     label: 'Users',     icon: '👥', href: 'users.html',        group: 'main', admin: true },
    { key: 'archive',   label: 'Archive',   icon: '🗄️', href: 'recycle-bin.html',  group: 'main', admin: true, bottom: true }
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

    return '' +
      '<div class="sidebar-brand">' +
        '<span class="brand-mark" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span>' +
        '<span>Issue Tracker</span>' +
      '</div>' +

      '<nav class="nav" aria-label="Main">' + mainLinks + '</nav>' +

      (footLinks ? '<nav class="nav sidebar-nav-bottom" aria-label="More">' + footLinks + '</nav>' : '') +

      '<div class="sidebar-foot">' +
        '<button type="button" class="btn ghost block" id="logoutBtn">Logout</button>' +
      '</div>';
  }

  function topbarHtml(title, user) {
    var admin = user && user.role === ET.ADMIN;
    var initial = ET.escapeHtml(((user && user.username) || '?').charAt(0).toUpperCase());
    var name = ET.escapeHtml((user && user.username) || '');

    return '' +
      '<button type="button" class="btn ghost icon menu-btn" id="menuBtn" aria-label="Open menu">☰</button>' +
      '<div class="topbar-heading">' +
        '<h1 class="topbar-title" id="pageTitle">' + ET.escapeHtml(title) + '</h1>' +
      '</div>' +
      '<div class="topbar-actions">' +
        '<span class="live-dot" id="liveDot" title="Live updates"></span>' +
        '<div class="role-menu">' +
          '<button type="button" class="btn profile-btn" id="profileMenuBtn" aria-haspopup="true" aria-expanded="false">' +
            '<span class="avatar" id="topAvatar">' + initial + '</span>' +
            '<span class="who" id="topName">' + name + '</span>' +
            '<span class="caret" aria-hidden="true">▾</span>' +
          '</button>' +
          '<div class="role-menu-panel" id="profileMenuPanel" hidden>' +
            '<div class="menu-head">' +
              '<span class="avatar" aria-hidden="true">' + initial + '</span>' +
              '<div>' +
                '<div class="nm">' + name + '</div>' +
                '<div class="em">' + (admin ? 'Administrator' : 'User') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="sep"></div>' +
            '<a href="profile.html">Profile</a>' +
            '<a href="settings.html">Settings</a>' +
          '</div>' +
        '</div>' +
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

    /* Top-right profile menu — Profile + Settings live in here. */
    var profileBtn = $('profileMenuBtn');
    var profilePanel = $('profileMenuPanel');
    if (profileBtn && profilePanel) {
      profileBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = profilePanel.hidden;
        profilePanel.hidden = !open;
        profileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function () {
        if (!profilePanel.hidden) {
          profilePanel.hidden = true;
          profileBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (profilePanel) profilePanel.hidden = true;
        closeSidebar();
      }
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
