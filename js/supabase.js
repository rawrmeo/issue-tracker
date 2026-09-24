/* ============================================================================
 * js/supabase.js
 * ----------------------------------------------------------------------------
 * ONE place where the Supabase client is created, shared by every page.
 * Reads supabase-config.js exactly as before — the URL, the key and the
 * username -> <username>@<emailDomain> mapping are unchanged.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;

  var CFG = window.SUPABASE_CONFIG || {};

  ET.cfg = CFG;
  ET.emailDomain = CFG.emailDomain || 'example.com';

  /* The mapping is preserved verbatim from app.js usernameToEmail(). */
  ET.usernameToEmail = function (username) {
    return String(username).trim().toLowerCase() + '@' + ET.emailDomain;
  };

  ET.isConfigured = function () {
    var url = String(CFG.url || '').trim();
    var key = String(CFG.anonKey || '').trim();
    return /^https?:\/\/\S+$/.test(url) && key.length >= 30;
  };

  /** Lazily creates the single client for this page. */
  ET.getClient = function () {
    if (!ET.isConfigured()) return null;
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) return null;
    if (!ET._sb) {
      ET._sb = window.supabase.createClient(String(CFG.url).trim(), String(CFG.anonKey).trim());
    }
    return ET._sb;
  };

  /** Works from the project root (index.html) or from /pages/*.html . */
  ET.basePath = function () {
    return /\/pages\//i.test(location.pathname) ? '../' : '';
  };

  ET.go = function (relative) {
    location.replace(ET.basePath() + relative);
  };

  /* ------------------------------ small utils ---------------------------- */

  ET.escapeHtml = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  ET.formatDate = function (ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return ''; }
  };

  ET.timeAgo = function (ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 0) return 'just now';
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 30) return d + 'd ago';
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
  };

  ET.setBusy = function (button, on, label) {
    if (!button) return;
    if (on) {
      if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
      button.textContent = label || 'Working…';
      button.disabled = true;
    } else {
      if (button.dataset.idleLabel) {
        button.textContent = button.dataset.idleLabel;
        delete button.dataset.idleLabel;
      }
      button.disabled = false;
    }
  };

  ET.friendlyError = function (error) {
    var msg = String((error && error.message) || error || '');
    if (/Only admins can change the status/i.test(msg)) return 'Only admins can change the status.';
    if (/The reporter of an issue cannot be changed/i.test(msg)) return 'The reporter cannot be changed.';
    if (/row-level security|permission denied/i.test(msg)) return 'You do not have permission to do that.';
    if (/Database error saving new user/i.test(msg)) return 'That username is already taken.';
    if (/Invalid login credentials/i.test(msg)) return 'Incorrect username or password.';
    return msg || 'Something went wrong.';
  };

  /* ------------------------------ constants ----------------------------- */

  ET.ADMIN = 'admin';
  ET.USER = 'user';
  ET.STATUSES = ['pending', 'fixing', 'done'];
  ET.STATUS_LABEL = { pending: 'Pending', fixing: 'Fixing', done: 'Done' };
  ET.PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  ET.THEME_KEY = 'it.theme';
})();
