/* ============================================================================
 * js/auth.js
 * ----------------------------------------------------------------------------
 * Two jobs:
 *   1. On index.html  — run the login / signup forms (moved from app.js's
 *      handleLogin, handleSignup, applyRoleUi and view helpers).
 *   2. On app pages   — guard the page: no session => back to index.html.
 *
 * The auth calls, the username -> email mapping and the error handling are
 * copied verbatim from app.js. Only the "what happens next" changed: instead
 * of revealing an in-page app view, we redirect to pages/dashboard.html.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;

  var A = {};
  ET.auth = A;

  A.user = null;                 // { id, username, role, createdAt }
  A.isAdmin = function () { return !!A.user && A.user.role === ET.ADMIN; };

  var $ = function (id) { return document.getElementById(id); };

  /* ======================= 1. LOGIN PAGE (index.html) ==================== */

  function hideAuthPanels() {
    ['configNotice', 'loginForm', 'signupForm'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
  }

  function showConfigNotice() {
    if (!document.body.contains($('configNotice'))) return;
    hideAuthPanels();
    $('configNotice').hidden = false;
  }

  function showLogin() {
    hideAuthPanels();
    if ($('loginForm')) {
      $('loginForm').hidden = false;
      if ($('loginUsername')) $('loginUsername').focus();
    }
  }

  function showSignup() {
    hideAuthPanels();
    if ($('signupForm')) {
      $('signupForm').hidden = false;
      if ($('signupUsername')) $('signupUsername').focus();
    }
  }

  /* ---- the four handlers below are moved from app.js, unchanged ---- */

  async function handleSignup(event) {
    event.preventDefault();
    var sb = ET.getClient();
    if (!sb) return;

    var err = $('signupError');
    err.hidden = true;
    var fail = function (m) { err.textContent = m; err.hidden = false; };

    var username = $('signupUsername').value.trim();
    var password = $('signupPassword').value;
    var confirm = $('signupConfirm').value;

    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      return fail('Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen.');
    }
    if (password.length < 6) return fail('Password must be at least 6 characters.');
    if (password !== confirm) return fail('Passwords do not match.');

    ET.setBusy($('signupSubmit'), true, 'Creating…');
    try {
      var res = await sb.auth.signUp({
        email: ET.usernameToEmail(username),
        password,
        options: { data: { username: username } }
      });

      if (res.error) return fail(ET.friendlyError(res.error));

      if (!res.data || !res.data.session) {
        return fail(
          'Account created, but email confirmation is switched ON in this Supabase project. ' +
          'Turn it off under Authentication -> Sign In / Providers -> Email -> "Confirm email", ' +
          'then sign in.'
        );
      }

      $('signupForm').reset();
      ET.toast('Account created. Taking you in…');
      setTimeout(function () { ET.go('pages/dashboard.html'); }, 400);
    } finally {
      ET.setBusy($('signupSubmit'), false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    var sb = ET.getClient();
    if (!sb) return;

    var err = $('loginError');
    err.hidden = true;

    var username = $('loginUsername').value.trim();
    var password = $('loginPassword').value;

    if (!username || !password) {
      err.textContent = 'Enter your username and password.';
      err.hidden = false;
      return;
    }

    ET.setBusy($('loginSubmit'), true, 'Signing in…');
    try {
      var res = await sb.auth.signInWithPassword({
        email: ET.usernameToEmail(username),
        password: password
      });

      if (res.error || !res.data || !res.data.session) {
        err.textContent = /Invalid login credentials/i.test(String(res.error && res.error.message))
          ? 'Incorrect username or password.'
          : ET.friendlyError(res.error);
        err.hidden = false;
        $('loginPassword').value = '';
        $('loginPassword').focus();
        return;
      }

      $('loginForm').reset();
      ET.toast('Signed in as ' + username + '.');
      setTimeout(function () { ET.go('pages/dashboard.html'); }, 400);
    } finally {
      ET.setBusy($('loginSubmit'), false);
    }
  }

  A.initLoginPage = function () {
    if (!$('loginForm')) return;

    if (!ET.isConfigured() || !ET.getClient()) {
      showConfigNotice();
      return;
    }

    $('loginForm').addEventListener('submit', handleLogin);
    $('signupForm').addEventListener('submit', handleSignup);
    $('showSignup').addEventListener('click', showSignup);
    $('showLogin').addEventListener('click', showLogin);

    // Already signed in? Skip straight to the app.
    ET.getClient().auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (session && session.user) ET.go('pages/dashboard.html');
      else showLogin();
    }).catch(function () { showLogin(); });
  };

  /* ===================== 2. APP PAGES: session guard ===================== */

  /**
   * Resolves with the user, or returns null and sends them to index.html.
   * The profile row (which carries the ROLE) is fetched exactly as app.js did.
   */
  A.guard = async function () {
    if (!ET.isConfigured()) { ET.go('index.html'); return null; }
    var sb = ET.getClient();
    if (!sb) { ET.go('index.html'); return null; }

    try {
      var res = await sb.auth.getSession();
      var session = res.data && res.data.session;
      if (!session || !session.user) { ET.go('index.html'); return null; }

      var p = await sb.from('profiles')
        .select('id, username, role, created_at')
        .eq('id', session.user.id)
        .maybeSingle();

      if (p.error || !p.data) {
        await sb.auth.signOut();
        ET.go('index.html');
        return null;
      }

      A.user = {
        id: session.user.id,
        username: p.data.username,
        role: p.data.role,
        email: session.user.email || ET.usernameToEmail(p.data.username),
        createdAt: Date.parse(p.data.created_at) || 0
      };
      return A.user;
    } catch (e) {
      ET.go('index.html');
      return null;
    }
  };

  A.logout = async function (event) {
    if (event) event.preventDefault();
    var sb = ET.getClient();
    try { if (sb) await sb.auth.signOut(); } catch (e) { /* ignore */ }
    A.user = null;
    ET.go('index.html');
  };

  /* Belt and braces: if the session ends anywhere, leave the page. */
  function watchSignOut() {
    var sb = ET.getClient();
    if (!sb || !sb.auth || !sb.auth.onAuthStateChange) return;
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT' && !$('loginForm')) ET.go('index.html');
    });
  }
  ET.authReady = watchSignOut;
})();
