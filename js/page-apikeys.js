/* ============================================================================
 * js/page-apikeys.js
 * ----------------------------------------------------------------------------
 * ADMIN ONLY. Manage API keys for the public REST API (see API.md).
 *
 *   • lists keys (name, prefix, role, last used) — never the secret
 *   • creates a key: generate it here, store only its SHA-256 hash
 *   • shows the plaintext key exactly once, then never again
 *   • revokes a key (sets revoked_at)
 *
 * The API gateway in supabase/functions/api/index.ts reads the same table.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };
  var escapeHtml = ET.escapeHtml;

  var keys = [];
  var profiles = [];

  /* ------------------------------- helpers ------------------------------- */

  function hex(bytes) {
    return Array.prototype.map.call(bytes, function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  function newSecret() {
    var bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return 'itk_' + hex(bytes);                       // itk_ + 48 hex chars
  }

  function sha256Hex(text) {
    return window.crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(text))
      .then(function (buf) { return hex(new Uint8Array(buf)); });
  }

  function profileName(id) {
    var p = profiles.filter(function (x) { return x.id === id; })[0];
    return p ? p.username : 'unknown';
  }

  /* ------------------------------- rendering ------------------------------ */

  function render() {
    var list = $('keyList');
    var empty = $('keyEmpty');
    $('keyCount').textContent = keys.length;

    if (!keys.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    list.innerHTML = keys.map(function (k) {
      var revoked = !!k.revoked_at;
      return '<div class="key-row' + (revoked ? ' revoked' : '') + '" data-id="' + escapeHtml(k.id) + '">' +
        '<div class="key-info">' +
          '<span class="key-name">' + escapeHtml(k.name) + '</span>' +
          '<span class="role-chip role-' + escapeHtml(k.role) + '">' + escapeHtml(k.role) + '</span>' +
          (revoked ? '<span class="badge">revoked</span>' : '') +
          '<code class="key-prefix">' + escapeHtml(k.prefix) + '…</code>' +
          '<span class="issue-date">acts as ' + escapeHtml(profileName(k.profile_id)) +
            ' · created ' + escapeHtml(ET.formatDate(Date.parse(k.created_at))) +
            ' · ' + (k.last_used_at ? 'last used ' + escapeHtml(ET.timeAgo(Date.parse(k.last_used_at))) : 'never used') +
          '</span>' +
        '</div>' +
        '<div class="key-actions">' +
          '<button class="btn ghost danger" type="button" data-action="revoke"' +
            (revoked ? ' disabled' : '') + '>Revoke</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function revealKey(value) {
    $('newKeyValue').textContent = value;
    $('newKey').hidden = false;
    $('newKey').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* --------------------------------- data -------------------------------- */

  async function loadKeys() {
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('api_keys')
      .select('id, name, prefix, role, profile_id, created_at, last_used_at, revoked_at')
      .order('created_at', { ascending: false });
    if (res.error) { ET.toast('Could not load keys: ' + ET.friendlyError(res.error)); return; }
    keys = res.data || [];
    render();
  }

  async function loadProfiles() {
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('profiles').select('id, username, role').order('created_at', { ascending: true });
    profiles = res.data || [];

    $('keyProfile').innerHTML = profiles.map(function (p) {
      var self = ET.auth.user && p.id === ET.auth.user.id;
      return '<option value="' + escapeHtml(p.id) + '"' + (self ? ' selected' : '') + '>' +
        escapeHtml(p.username) + ' (' + escapeHtml(p.role) + ')' + (self ? ' — you' : '') +
      '</option>';
    }).join('');
  }

  async function createKey(event) {
    event.preventDefault();
    var sb = ET.getClient();
    if (!sb) return;

    var name = $('keyName').value.trim();
    if (!name) return;

    var role = $('keyRole').value === 'admin' ? 'admin' : 'user';
    var profileId = $('keyProfile').value || (ET.auth.user && ET.auth.user.id);
    if (!profileId) return;

    var button = $('keyCreate');
    button.disabled = true;
    try {
      var secret = newSecret();
      var hash = await sha256Hex(secret);

      var res = await sb.from('api_keys').insert({
        name: name,
        prefix: secret.slice(0, 12),
        key_hash: hash,
        role: role,
        profile_id: profileId
      }).select('id').single();

      if (res.error) { ET.toast('Could not create the key: ' + ET.friendlyError(res.error)); return; }

      $('keyForm').reset();
      revealKey(secret);
      ET.toast('Key created. Copy it now.');
      await loadKeys();
    } finally {
      button.disabled = false;
    }
  }

  async function revokeKey(id) {
    var row = keys.filter(function (k) { return k.id === id; })[0];
    if (!row) return;
    var ok = await ET.confirm('Revoke “' + row.name + '”? Any app using it stops working immediately.',
      { title: 'Revoke API key', okLabel: 'Revoke' });
    if (!ok) return;

    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    if (res.error) { ET.toast(ET.friendlyError(res.error)); return; }
    ET.toast('Key revoked.');
    await loadKeys();
  }

  function bind() {
    $('keyForm').addEventListener('submit', createKey);

    $('keyList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action="revoke"]');
      if (!btn) return;
      var row = btn.closest('.key-row');
      if (row) revokeKey(row.dataset.id);
    });

    $('newKeyCopy').addEventListener('click', function () {
      var value = $('newKeyValue').textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(value).then(function () { ET.toast('Copied.'); });
      } else {
        ET.toast('Select the key and copy it manually.');
      }
    });
  }

  /* --------------------------------- init -------------------------------- */

  async function init() {
    var user = await ET.layout.render({ active: 'api-keys', title: 'API keys', requireAdmin: true });
    if (!user) return;

    bind();
    await loadProfiles();
    await loadKeys();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
