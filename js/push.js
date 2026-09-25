/* ============================================================================
 * js/push.js
 * ----------------------------------------------------------------------------
 * Web Push, so a reporter gets told on their phone when an admin leaves a
 * message or marks their issue done — even with the app closed.
 *
 * How the pieces fit together:
 *   js/push.js  →  asks permission, subscribes, saves the subscription
 *   sw.js       →  receives the push and shows the notification
 *   sql/push_notifications.sql →  the table + the trigger that sends it
 *   supabase/functions/send-push → the sender (needs your VAPID keys)
 *
 * The public VAPID key lives in supabase-config.js (`vapidPublicKey`). The
 * private key never leaves the server (it is a Supabase secret).
 * ========================================================================= */

(function () {
  'use strict';

  window.ET = window.ET || {};
  var ET = window.ET;

  function config() { return window.SUPABASE_CONFIG || {}; }

  function publicKey() { return String(config().vapidPublicKey || '').trim(); }

  function supported() {
    return 'serviceWorker' in navigator &&
           'PushManager' in window &&
           'Notification' in window;
  }

  /* The VAPID key arrives base64url; the browser wants raw bytes. */
  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function ready() {
    if (!supported()) return Promise.reject(new Error('unsupported'));
    return navigator.serviceWorker.ready;
  }

  function currentSubscription() {
    if (!supported()) return Promise.resolve(null);
    return ready().then(function (reg) { return reg.pushManager.getSubscription(); });
  }

  function isEnabled() {
    if (!supported() || Notification.permission !== 'granted') return Promise.resolve(false);
    return currentSubscription().then(function (sub) { return !!sub; });
  }

  function enable() {
    if (!supported()) { ET.toast('This browser cannot show notifications.'); return Promise.resolve(false); }
    if (!publicKey()) { ET.toast('Push is not set up yet (no VAPID key in supabase-config.js).'); return Promise.resolve(false); }
    if (!ET.auth || !ET.auth.user) return Promise.resolve(false);

    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { ET.toast('Notifications were not allowed.'); return false; }

      return ready().then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          if (existing) return existing;
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey())
          });
        });
      }).then(function (sub) {
        var json = sub.toJSON ? sub.toJSON() : {
          endpoint: sub.endpoint,
          keys: { p256dh: '', auth: '' }
        };
        var sb = ET.getClient();
        if (!sb) return false;
        return sb.from('push_subscriptions').upsert({
          user_id: ET.auth.user.id,
          endpoint: json.endpoint,
          p256dh: (json.keys && json.keys.p256dh) || '',
          auth: (json.keys && json.keys.auth) || ''
        }, { onConflict: 'endpoint' }).then(function (res) {
          if (res.error) { ET.toast(ET.friendlyError(res.error)); return false; }
          ET.toast('Notifications are on for this device.');
          return true;
        });
      });
    }).catch(function (err) {
      ET.toast('Could not turn on notifications: ' + (err && err.message ? err.message : 'unknown'));
      return false;
    });
  }

  function disable() {
    return currentSubscription().then(function (sub) {
      if (!sub) return false;
      var sb = ET.getClient();
      var forget = sb
        ? sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        : Promise.resolve();
      return forget.then(function () { return sub.unsubscribe(); }).then(function () {
        ET.toast('Notifications are off for this device.');
        return true;
      });
    }).catch(function () { return false; });
  }

  ET.push = {
    supported: supported,
    configured: function () { return !!publicKey(); },
    isEnabled: isEnabled,
    enable: enable,
    disable: disable
  };
})();
