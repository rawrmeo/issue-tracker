/* ============================================================================
 * js/sidebar.js
 * ----------------------------------------------------------------------------
 * Sets the role classes the CSS relies on (body.role-admin / body.role-user)
 * once the signed-in user is known.
 *
 * The admin status pages (Reported / Pending / Fixing / Done / All) used to be
 * listed here. They are now reached from the Issues page's status filter
 * instead, and the Archive link is part of the main navigation in js/layout.js.
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;

  ET.sidebar = {
    mount: function (user) {
      if (!user) return;

      var isAdmin = user.role === ET.ADMIN;

      document.body.classList.toggle('role-admin', isAdmin);
      document.body.classList.toggle('role-user', !isAdmin);
    }
  };
})();
