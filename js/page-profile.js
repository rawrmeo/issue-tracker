/* ============================================================================
 * js/page-profile.js
 * ----------------------------------------------------------------------------
 * Read-only account details + change password via Supabase auth.updateUser().
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };
  var escapeHtml = ET.escapeHtml;

  /** s****a@example.com — the email is derived, so we never show it raw. */
  function maskEmail(email) {
    var text = String(email || '');
    var at = text.indexOf('@');
    if (at < 1) return '••••';
    var name = text.slice(0, at);
    var domain = text.slice(at);
    if (name.length <= 2) return name.charAt(0) + '•••' + domain;
    return name.charAt(0) + '•'.repeat(Math.max(4, name.length - 2)) +
      name.charAt(name.length - 1) + domain;
  }

  function render(user) {
    var setV = function (id, v) {
      var el = $(id);
      if (el) el.textContent = v;
    };

    setV('profileName', user.username);
    setV('profileRole', user.role === ET.ADMIN ? 'Admin' : 'User');
    setV('profileEmail', maskEmail(user.email));
    setV('profileJoined', user.createdAt ? ET.formatDate(user.createdAt) : '—');
    setV('profileId', user.id);

    var avatar = $('profileAvatar');
    if (avatar) avatar.textContent = String(user.username || '?').charAt(0).toUpperCase();
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    var sb = ET.getClient();
    if (!sb) return;

    var err = $('passwordError');
    var ok = $('passwordOk');
    err.hidden = true;
    ok.hidden = true;
    var fail = function (m) { err.textContent = m; err.hidden = false; };

    var current = $('currentPassword').value;
    var next = $('newPassword').value;
    var confirm = $('confirmPassword').value;

    if (next.length < 6) return fail('New password must be at least 6 characters.');
    if (next !== confirm) return fail('New passwords do not match.');
    if (next === current) return fail('Choose a password different from your current one.');

    ET.setBusy($('passwordSubmit'), true, 'Updating…');
    try {
      // Verify the current password first (also refreshes the session).
      var check = await sb.auth.signInWithPassword({
        email: ET.usernameToEmail(ET.auth.user.username),
        password: current
      });
      if (check.error) return fail('Your current password is incorrect.');

      var res = await sb.auth.updateUser({ password: next });
      if (res.error) return fail(ET.friendlyError(res.error));

      $('passwordForm').reset();
      ok.textContent = 'Password updated.';
      ok.hidden = false;
      ET.toast('Password updated.');
    } finally {
      ET.setBusy($('passwordSubmit'), false);
    }
  }

  async function init() {
    var user = await ET.layout.render({ active: 'profile', title: 'Profile' });
    if (!user) return;

    render(user);
    $('passwordForm').addEventListener('submit', handlePasswordChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
