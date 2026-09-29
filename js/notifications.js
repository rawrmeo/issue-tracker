/* ============================================================================
 * js/notifications.js
 * ----------------------------------------------------------------------------
 * The bell in the top bar, for BOTH roles.
 *
 *   • a new issue is reported      → admins are told
 *   • an admin marks it done        → the reporter is told
 *   • an admin leaves a comment     → the reporter is told
 *
 * The rows come from the `notifications` table (see sql/notifications.sql).
 * Push notifications (js/push.js + sw.js) deliver the same three events to a
 * phone; this is the in-app feed so nothing is missed.
 *
 * Safe when the SQL has not been run yet: the table is missing, the request
 * fails quietly, and the bell simply shows nothing.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };

  var items = [];
  var channel = null;
  var bound = false;

  function openPanel() {
    var p = $('notifPanel'), b = $('notifBtn');
    if (p) p.hidden = false;
    if (b) b.setAttribute('aria-expanded', 'true');
  }

  function closePanel() {
    var p = $('notifPanel'), b = $('notifBtn');
    if (p) p.hidden = true;
    if (b) b.setAttribute('aria-expanded', 'false');
  }

  function render() {
    var dot = $('notifDot');
    var n = items.filter(function (i) { return !i.read_at; }).length;
    if (dot) { dot.hidden = n === 0; dot.textContent = n > 99 ? '99+' : String(n); }

    var list = $('notifList');
    if (!list) return;

    if (!items.length) {
      list.innerHTML = '<div class="notif-empty">Nothing yet. New issues, fixes and messages show up here.</div>';
      return;
    }

    list.innerHTML = items.map(function (it) {
      return '<div class="notif-item' + (it.read_at ? '' : ' unread') + '" data-id="' + ET.escapeHtml(it.id) + '">' +
        '<div class="t">' + ET.escapeHtml(it.title) + '</div>' +
        (it.body ? '<div class="b">' + ET.escapeHtml(it.body) + '</div>' : '') +
        '<div class="w">' + ET.escapeHtml(ET.timeAgo(Date.parse(it.created_at))) + '</div>' +
      '</div>';
    }).join('');
  }

  function load() {
    var sb = ET.getClient();
    if (!sb || !ET.auth || !ET.auth.user) return Promise.resolve();

    return sb.from('notifications')
      .select('id, kind, title, body, issue_id, created_at, read_at')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(function (res) {
        if (res.error) return;                 // table not there yet — stay quiet
        items = res.data || [];
        render();
      })
      .catch(function () { /* ignore */ });
  }

  function markAll() {
    var sb = ET.getClient();
    if (!sb) return;
    var ids = items.filter(function (i) { return !i.read_at; }).map(function (i) { return i.id; });
    if (!ids.length) return;
    sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
      .then(load);
  }

  function openItem(id) {
    var sb = ET.getClient();
    var it = items.filter(function (x) { return x.id === id; })[0];
    closePanel();
    if (it && !it.read_at && sb) {
      sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).then(load);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || typeof t.closest !== 'function') return;

      if (t.closest('#notifBtn')) {
        e.stopPropagation();
        var p = $('notifPanel');
        if (p && p.hidden) { openPanel(); load(); } else { closePanel(); }
        return;
      }
      if (t.closest('#notifMarkAll')) { e.preventDefault(); markAll(); return; }

      var item = t.closest('.notif-item');
      if (item) { openItem(item.getAttribute('data-id')); return; }

      if (!t.closest('.role-menu')) closePanel();
    });

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
  }

  function subscribe() {
    var sb = ET.getClient();
    if (!sb || channel) return;
    try {
      channel = sb.channel('tracker-notifications')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' },
          function () { load(); })
        .subscribe();
    } catch (e) { /* ignore */ }
  }

  function boot() {
    bind();
    var tries = 0;
    (function tick() {
      if (ET.auth && ET.auth.user && ET.getClient()) { load(); subscribe(); return; }
      if (tries++ > 100) return;
      setTimeout(tick, 120);
    })();
  }

  ET.notifications = { load: load };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
