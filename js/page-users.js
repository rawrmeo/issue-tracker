/* ============================================================================
 * js/page-users.js
 * ----------------------------------------------------------------------------
 * ADMIN ONLY. renderUsers() and setUserRole() are MOVED from app.js with only
 * currentUser -> ET.auth.user and toast -> ET.toast changed.
 * Non-admins are redirected to the dashboard by ET.layout.render({requireAdmin}).
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };

  var ADMIN = ET.ADMIN;
  var USER = ET.USER;

  var profiles = [];
  var escapeHtml = ET.escapeHtml;
  var toast = ET.toast;

  async function loadProfiles() {
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('profiles')
      .select('id, username, role, created_at')
      .order('created_at', { ascending: true });

    if (res.error) {
      toast('Could not load users: ' + ET.friendlyError(res.error));
      return;
    }
    profiles = res.data || [];
    renderUsers();
  }

  /* ------------------------- moved from app.js --------------------------- */

  function renderUsers() {
    if (!ET.auth.isAdmin()) {
      $('userList').innerHTML = '';
      return;
    }

    $('userList').innerHTML = profiles.map(function (p) {
      var self = p.id === ET.auth.user.id;
      var admins = profiles.filter(function (x) { return x.role === ADMIN; }).length;
      var lastAdmin = p.role === ADMIN && admins <= 1;
      var canToggle = !self && !lastAdmin;

      return (
        '<div class="user-row" data-id="' + escapeHtml(p.id) + '">' +
          '<div class="user-info">' +
            '<span class="user-name">' + escapeHtml(p.username) + '</span>' +
            '<span class="role-chip role-' + escapeHtml(p.role) + '">' + escapeHtml(p.role) + '</span>' +
            (self ? '<span class="badge mine">you</span>' : '') +
            '<span class="issue-date">joined ' +
              escapeHtml(ET.formatDate(Date.parse(p.created_at))) + '</span>' +
          '</div>' +
          '<div class="user-actions">' +
            '<button class="btn ghost" type="button" data-action="toggle-role"' +
              (canToggle ? '' : ' disabled') + '>' +
              (p.role === ADMIN ? 'Make user' : 'Make admin') +
            '</button>' +
            '<button class="btn danger" type="button" data-action="delete"' +
              (canToggle ? '' : ' disabled') + '>Delete</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    setText('userCount', profiles.length);
  }

  async function setUserRole(profile, role) {
    if (!ET.auth.isAdmin()) return;
    if (profile.id === ET.auth.user.id) { toast('You cannot change your own role.'); return; }
    if (profile.role === ADMIN &&
        profiles.filter(function (p) { return p.role === ADMIN; }).length <= 1) {
      toast('There must always be at least one admin.');
      return;
    }

    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('profiles').update({ role: role }).eq('id', profile.id);
    if (res.error) { toast(ET.friendlyError(res.error)); return; }
    await loadProfiles();
    toast(profile.username + ' is now ' + role + '.');
  }

  /* ----------------------------- delete ---------------------------------- */

  async function deleteUser(profile) {
    if (!ET.auth.isAdmin()) return;

    if (profile.id === ET.auth.user.id) {
      toast('You cannot delete your own account.');
      return;
    }

    var ok = await ET.confirm(
      'Delete \u201c' + profile.username + '\u201d?\n\n' +
      'They will no longer be able to sign in. Their issues stay on the board, ' +
      'shown as (account removed).',
      { title: 'Delete account', okLabel: 'Delete account' }
    );
    if (!ok) return;

    var sb = ET.getClient();
    if (!sb) return;

    var row = document.querySelector('.user-row[data-id="' + profile.id + '"]');
    var btn = row ? row.querySelector('button[data-action="delete"]') : null;
    ET.setBusy(btn, true, 'Deleting\u2026');

    var res = await sb.rpc('admin_delete_user', { p_id: profile.id });
    ET.setBusy(btn, false);

    if (res.error) { toast(friendlyUserError(res.error)); return; }

    await loadProfiles();
    toast(profile.username + ' deleted.');
  }

  /** Readable versions of what sql/admin_users.sql raises. */
  function friendlyUserError(error) {
    var m = String((error && error.message) || '');
    if (/Only admins/i.test(m)) return m;
    if (/cannot delete your own/i.test(m)) return 'You cannot delete your own account.';
    if (/at least one admin/i.test(m)) return 'There must always be at least one admin.';
    if (/no longer exists/i.test(m)) return 'That account no longer exists.';
    if (/Could not find the function|PGRST202/i.test(m)) {
      return 'Run sql/admin_users.sql in the Supabase SQL Editor first.';
    }
    return ET.friendlyError(error);
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  function bindEvents() {
    $('userList').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (!button) return;

      var row = button.closest('.user-row');
      if (!row) return;

      var profile = profiles.filter(function (p) { return p.id === row.dataset.id; })[0];
      if (!profile) return;

      var action = button.dataset.action;
      if (action === 'toggle-role') {
        setUserRole(profile, profile.role === ADMIN ? USER : ADMIN);
      } else if (action === 'delete') {
        deleteUser(profile);
      }
    });
  }

  async function init() {
    var user = await ET.layout.render({ active: 'users', title: 'Users', requireAdmin: true });
    if (!user) return;

    bindEvents();
    await loadProfiles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
