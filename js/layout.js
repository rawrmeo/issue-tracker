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

  /* ============================ install prompt ==========================
   * Chrome, Edge and Android fire "beforeinstallprompt", which we can trigger
   * from our own button. Safari has no such event, so there the button says
   * what to tap instead. It never shows when the app is already installed.
   * =================================================================== */
  var installPrompt = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function installShouldShow() {
    return !isStandalone() && Boolean(installPrompt || isIOS());
  }

  function refreshInstall() {
    var b = $('installAppBtn');
    if (b) b.hidden = !installShouldShow();
  }

  function doInstall() {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted' && ET.toast) ET.toast('Installing…');
        installPrompt = null;
        refreshInstall();
      });
      return;
    }

    window.alert('Install this app on your phone\n\n' +
      'iPhone / iPad:\n' +
      '  1. Tap the Share button (square with an arrow)\n' +
      '  2. Scroll down and tap "Add to Home Screen"\n' +
      '  3. Tap Add\n\n' +
      'Android:\n' +
      '  Open the browser menu and tap "Install app",\n' +
      '  or "Add to Home screen".');
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();                 // ask in our own time, from our own button
    installPrompt = e;
    refreshInstall();
  });

  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    refreshInstall();
    if (ET.toast) ET.toast('App installed');
  });

  function wireInstall() {
    var b = $('installAppBtn');
    if (!b) return;
    b.addEventListener('click', doInstall);
    refreshInstall();
  }

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
        // Only rendered when the app can actually be installed, and hidden
        // again once it has been.
        '<button type="button" class="nav-link" id="installAppBtn" hidden ' +
          'style="width:100%;background:none;border:0;cursor:pointer;font:inherit;text-align:left;">' +
          '<span class="nav-icon" aria-hidden="true">⬇️</span>' +
          '<span>Install app</span>' +
        '</button>' +
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

  /* ============================ notifications ===========================
   * A bell in the topbar with an unread count and a short list, kept in
   * localStorage per account.
   *
   * Why localStorage and not a table: the list is a convenience, not a
   * record. It needs no migration, works the moment this file loads, and a
   * reporter still gets "your issue was marked Done" without anyone having to
   * run extra SQL first.
   *
   * Only things that concern the signed-in person are pushed in - see
   * worthNotifying() in page-issues.js. A reporter hears about their own
   * issues; an admin hears about everything.
   * ==================================================================== */
  var NOTIF_LIMIT = 40;
  var NOTIF_COLOUR = {
    created: '#4f46e5', pending: '#b45309', fixing: '#2563eb',
    done: '#15803d', removed: '#dc2626'
  };

  var notifUser = null;
  var notifList = [];
  var notifSeen = 0;

  function notifKey(user, suffix) {
    var who = (user && (user.username || user.id)) || 'guest';
    return 'it.notifications.' + who + (suffix || '');
  }

  function notifLoad(user) {
    notifUser = user;
    try { notifList = JSON.parse(localStorage.getItem(notifKey(user)) || '[]'); } catch (e) { notifList = []; }
    try { notifSeen = Number(localStorage.getItem(notifKey(user, '.seen')) || 0); } catch (e) { notifSeen = 0; }
  }

  function notifSave() {
    try { localStorage.setItem(notifKey(notifUser), JSON.stringify(notifList.slice(0, NOTIF_LIMIT))); } catch (e) {}
  }

  function notifUnread() {
    return notifList.filter(function (n) { return n.at > notifSeen; }).length;
  }

  function notifPaintBadge() {
    var badge = $('notifBadge');
    if (!badge) return;
    var n = notifUnread();
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n === 0;
  }

  function notifColour(kind) {
    return NOTIF_COLOUR[kind] || '#6b7280';
  }

  /** Styles are injected once, so no page needs a new stylesheet. */
  function notifStyles() {
    if ($('notifStyles')) return;
    var style = document.createElement('style');
    style.id = 'notifStyles';
    style.textContent = [
      '.notif-wrap{position:relative}',
      '.notif-btn{position:relative}',
      '.notif-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;',
      'border-radius:999px;background:#dc2626;color:#fff;font-size:10px;font-weight:700;',
      'display:flex;align-items:center;justify-content:center;line-height:1}',
      '.notif-panel{position:absolute;right:0;top:calc(100% + .5rem);width:min(88vw,330px);max-height:70vh;',
      'overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;',
      'box-shadow:0 12px 34px rgba(16,20,30,.22);z-index:90}',
      '.notif-head{display:flex;align-items:center;gap:.5rem;padding:.6rem .75rem;',
      'border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface)}',
      '.notif-head strong{margin-right:auto;font-size:.85rem}',
      '.notif-head button{background:none;border:0;color:var(--accent);font-size:.75rem;cursor:pointer;padding:.15rem .25rem}',
      '.notif-item{display:flex;gap:.6rem;padding:.65rem .75rem;border-bottom:1px solid var(--border)}',
      '.notif-item:last-child{border-bottom:0}',
      '.notif-item.unread{background:color-mix(in srgb, var(--accent) 8%, transparent)}',
      '.notif-dot{flex:none;width:8px;height:8px;border-radius:50%;margin-top:.35rem}',
      '.notif-title{display:block;font-size:.82rem}',
      '.notif-body{display:block;color:var(--muted);font-size:.78rem;word-break:break-word}',
      '.notif-when{display:block;color:var(--muted);font-size:.72rem;margin-top:.1rem}',
      '.notif-empty{padding:.9rem .75rem;color:var(--muted);font-size:.85rem}'
    ].join('');
    document.head.appendChild(style);
  }

  function notifPanelHtml() {
    if (!notifList.length) {
      return '<div class="notif-empty">Nothing yet. Updates to your issues show up here.</div>';
    }
    return notifList.map(function (n) {
      return '<div class="notif-item' + (n.at > notifSeen ? ' unread' : '') + '">' +
        '<span class="notif-dot" style="background:' + notifColour(n.kind) + '"></span>' +
        '<span style="min-width:0">' +
          '<span class="notif-title">' + ET.escapeHtml(n.title) + '</span>' +
          (n.body ? '<span class="notif-body">' + ET.escapeHtml(n.body) + '</span>' : '') +
          '<span class="notif-when">' + ET.escapeHtml(ET.timeAgo(n.at)) + '</span>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  function notifRenderPanel() {
    var panel = $('notifPanel');
    if (!panel) return;

    panel.innerHTML =
      '<div class="notif-head">' +
        '<strong>Notifications</strong>' +
        '<button type="button" id="notifMarkRead">Mark read</button>' +
        '<button type="button" id="notifClear">Clear</button>' +
      '</div>' +
      notifPanelHtml();

    var markBtn = $('notifMarkRead');
    if (markBtn) markBtn.addEventListener('click', function () {
      notifSeen = Date.now();
      try { localStorage.setItem(notifKey(notifUser, '.seen'), String(notifSeen)); } catch (e) {}
      notifPaintBadge();
      notifRenderPanel();
    });

    var clearBtn = $('notifClear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      notifList = [];
      notifSave();
      notifPaintBadge();
      notifRenderPanel();
    });
  }

  function notifWire() {
    var btn = $('notifBtn');
    var panel = $('notifPanel');
    if (!btn || !panel) return;

    notifStyles();
    notifRenderPanel();
    notifPaintBadge();

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) {                       // opening counts as reading
        notifSeen = Date.now();
        try { localStorage.setItem(notifKey(notifUser, '.seen'), String(notifSeen)); } catch (err) {}
        notifPaintBadge();
        notifRenderPanel();
      }
    });

    document.addEventListener('click', function (e) {
      if (!panel.hidden && !e.target.closest('.notif-wrap')) {
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  ET.notifications = {
    load: function (user) { notifLoad(user); },
    push: function (entry) {
      if (!notifUser) return;
      notifList.unshift({
        at: entry.at || Date.now(),
        kind: entry.kind || 'created',
        title: entry.title || '',
        body: entry.body || ''
      });
      notifSave();
      notifPaintBadge();
      var panel = $('notifPanel');
      if (panel && !panel.hidden) notifRenderPanel();
    },
    unread: notifUnread
  };

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
        '<div class="notif-wrap">' +
          '<button type="button" class="btn ghost icon notif-btn" id="notifBtn" aria-label="Notifications" aria-expanded="false">🔔' +
            '<span class="notif-badge" id="notifBadge" hidden>0</span>' +
          '</button>' +
          '<div class="notif-panel" id="notifPanel" hidden></div>' +
        '</div>' +
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
      wireInstall();

      var topbar = $('topbar');
      if (topbar) topbar.innerHTML = topbarHtml(opts.title || '', user);

      applyTheme(currentTheme());
      wire();

      // The bell lives in the topbar, so it is available on every page and to
      // every role - not just admins.
      ET.notifications.load(user);
      notifWire();

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
