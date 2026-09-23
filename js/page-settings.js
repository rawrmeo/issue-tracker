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

  async function init() {
    var user = await ET.layout.render({ active: 'settings', title: 'Settings' });
    if (!user) return;

    var theme = $('settingsTheme');
    if (theme) {
      theme.checked = ET.layout.currentTheme() === 'dark';
      theme.addEventListener('change', function () {
        ET.layout.setTheme(theme.checked ? 'dark' : 'light');
      });
    }

    var clearBtn = $('clearFiltersBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);

    var logoutBtn = $('settingsLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', function (e) { ET.auth.logout(e); });

    // Keep the switch in sync if the topbar toggle is used on this page.
    var topBtn = $('themeBtn');
    if (topBtn) {
      topBtn.addEventListener('click', function () {
        setTimeout(function () {
          if (theme) theme.checked = ET.layout.currentTheme() === 'dark';
        }, 0);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
