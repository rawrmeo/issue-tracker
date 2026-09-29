/* ============================================================================
 * js/page-webhooks.js
 * ----------------------------------------------------------------------------
 * ADMIN ONLY. Manage outbound webhooks — the "Web API".
 *
 *   • register a URL that receives issue events
 *   • choose which events (or all)
 *   • a shared secret signs every request (x-webhook-secret)
 *   • see the recent delivery log (public.webhook_deliveries)
 *
 * Delivery itself is done by the database trigger api_dispatch_webhooks()
 * (see sql/api.sql); this page only configures it.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };
  var escapeHtml = ET.escapeHtml;

  var endpoints = [];
  var deliveries = [];
  var eventsByEndpoint = {};

  var ALL_EVENTS = ['*', 'issue.created', 'issue.updated', 'issue.status_changed', 'issue.done', 'issue.deleted'];

  /* ------------------------------- helpers ------------------------------- */

  function hex(bytes) {
    return Array.prototype.map.call(bytes, function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  function newSecret() {
    var bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return hex(bytes);
  }

  function syncEventChips() {
    var all = $('hookEvents').querySelector('input[value="*"]');
    var others = $('hookEvents').querySelectorAll('input:not([value="*"])');
    Array.prototype.forEach.call(others, function (c) { c.disabled = all.checked; if (all.checked) c.checked = false; });
  }

  function selectedEvents() {
    var all = $('hookEvents').querySelector('input[value="*"]');
    if (all.checked) return ['*'];
    var out = [];
    Array.prototype.forEach.call($('hookEvents').querySelectorAll('input:checked'), function (c) { out.push(c.value); });
    return out.length ? out : ['*'];
  }

  /* ------------------------------- rendering ------------------------------ */

  function eventChips(events) {
    var list = (events && events.length) ? events : ['*'];
    return list.map(function (e) { return '<span class="badge">' + escapeHtml(e) + '</span>'; }).join('');
  }

  function renderEndpoints() {
    var list = $('hookList');
    $('hookCount').textContent = endpoints.length;

    if (!endpoints.length) {
      list.innerHTML = '';
      $('hookEmpty').hidden = false;
      return;
    }
    $('hookEmpty').hidden = true;

    list.innerHTML = endpoints.map(function (h) {
      var last = eventsByEndpoint[h.id];       // most recent delivery (ms)
      return '<div class="hook-row' + (h.active ? '' : ' inactive') + '" data-id="' + escapeHtml(h.id) + '">' +
        '<div class="hook-info">' +
          '<span class="hook-name">' + escapeHtml(h.name || '(unnamed)') + '</span>' +
          '<span class="hook-url" title="' + escapeHtml(h.url) + '">' + escapeHtml(h.url) + '</span>' +
          eventChips(h.events) +
          '<span class="issue-date">' +
            (last ? 'last delivery ' + escapeHtml(ET.timeAgo(last)) : 'no deliveries yet') +
          '</span>' +
        '</div>' +
        '<div class="hook-actions">' +
          '<button class="btn ghost" type="button" data-action="secret">Secret</button>' +
          '<label class="hook-toggle"><input type="checkbox" data-action="active"' + (h.active ? ' checked' : '') + ' /> active</label>' +
          '<button class="btn ghost danger" type="button" data-action="delete">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderDeliveries() {
    var list = $('deliveryList');
    if (!deliveries.length) {
      list.innerHTML = '';
      $('deliveryEmpty').hidden = false;
      return;
    }
    $('deliveryEmpty').hidden = true;

    list.innerHTML = deliveries.map(function (d) {
      var ep = endpoints.filter(function (x) { return x.id === d.endpoint_id; })[0];
      var payload = '';
      try { payload = JSON.stringify(d.payload, null, 2); } catch (e) { payload = String(d.payload); }
      return '<details class="delivery">' +
        '<summary>' +
          '<span class="badge">' + escapeHtml(d.event) + '</span>' +
          '<span class="delivery-when">' + escapeHtml(ET.formatDate(Date.parse(d.created_at))) + '</span>' +
          '<span class="muted small">' + escapeHtml(ep ? ep.name : 'unknown endpoint') + '</span>' +
        '</summary>' +
        '<pre class="delivery-payload">' + escapeHtml(payload) + '</pre>' +
      '</details>';
    }).join('');
  }

  /* --------------------------------- data -------------------------------- */

  async function loadEndpoints() {
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('webhook_endpoints')
      .select('id, name, url, secret, events, active, created_at')
      .order('created_at', { ascending: false });
    if (res.error) { ET.toast('Could not load webhooks: ' + ET.friendlyError(res.error)); return; }
    endpoints = res.data || [];
    renderEndpoints();
  }

  async function loadDeliveries() {
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('webhook_deliveries')
      .select('id, endpoint_id, event, payload, created_at')
      .order('created_at', { ascending: false })
      .limit(25);
    if (res.error) { ET.toast('Could not load deliveries: ' + ET.friendlyError(res.error)); return; }

    deliveries = res.data || [];
    eventsByEndpoint = {};
    deliveries.forEach(function (d) {
      var t = Date.parse(d.created_at) || 0;
      if (!eventsByEndpoint[d.endpoint_id] || t > eventsByEndpoint[d.endpoint_id]) {
        eventsByEndpoint[d.endpoint_id] = t;
      }
    });
    renderEndpoints();
    renderDeliveries();
  }

  async function createEndpoint(event) {
    event.preventDefault();
    var sb = ET.getClient();
    if (!sb) return;

    var name = $('hookName').value.trim();
    var url = $('hookUrl').value.trim();
    var secret = $('hookSecret').value.trim() || newSecret();

    if (!/^https?:\/\/\S+$/i.test(url)) { ET.toast('Enter a valid http(s) URL.'); return; }

    var button = $('hookCreate');
    button.disabled = true;
    try {
      var res = await sb.from('webhook_endpoints').insert({
        name: name,
        url: url,
        secret: secret,
        events: selectedEvents(),
        active: true,
        created_by: ET.auth.user ? ET.auth.user.id : null
      }).select('id').single();

      if (res.error) { ET.toast('Could not save the endpoint: ' + ET.friendlyError(res.error)); return; }

      $('hookForm').reset();
      $('hookEvents').querySelector('input[value="*"]').checked = true;
      syncEventChips();
      ET.toast('Endpoint added.');
      await loadEndpoints();
    } finally {
      button.disabled = false;
    }
  }

  async function toggleActive(id, active) {
    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('webhook_endpoints').update({ active: active }).eq('id', id);
    if (res.error) { ET.toast(ET.friendlyError(res.error)); return; }
    ET.toast(active ? 'Endpoint enabled.' : 'Endpoint paused.');
    await loadEndpoints();
  }

  async function deleteEndpoint(id) {
    var ep = endpoints.filter(function (x) { return x.id === id; })[0];
    if (!ep) return;
    var ok = await ET.confirm('Delete “' + (ep.name || ep.url) + '”? Its delivery history is removed too.',
      { title: 'Delete endpoint', okLabel: 'Delete' });
    if (!ok) return;

    var sb = ET.getClient();
    if (!sb) return;
    var res = await sb.from('webhook_endpoints').delete().eq('id', id);
    if (res.error) { ET.toast(ET.friendlyError(res.error)); return; }
    ET.toast('Endpoint deleted.');
    await loadEndpoints();
    await loadDeliveries();
  }

  function showSecret(id) {
    var ep = endpoints.filter(function (x) { return x.id === id; })[0];
    if (!ep) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(ep.secret).then(function () { ET.toast('Secret copied to the clipboard.'); });
    } else {
      window.prompt('Webhook secret', ep.secret);
    }
  }

  function bind() {
    $('hookForm').addEventListener('submit', createEndpoint);
    $('hookEvents').addEventListener('change', syncEventChips);

    $('hookList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var row = btn.closest('.hook-row');
      if (!row) return;
      if (btn.dataset.action === 'delete') deleteEndpoint(row.dataset.id);
      else if (btn.dataset.action === 'secret') showSecret(row.dataset.id);
    });

    $('hookList').addEventListener('change', function (e) {
      var box = e.target.closest('input[data-action="active"]');
      if (!box) return;
      var row = box.closest('.hook-row');
      if (row) toggleActive(row.dataset.id, box.checked);
    });

    syncEventChips();
  }

  /* --------------------------------- init -------------------------------- */

  async function init() {
    var user = await ET.layout.render({ active: 'webhooks', title: 'Webhooks', requireAdmin: true });
    if (!user) return;

    bind();
    await loadEndpoints();
    await loadDeliveries();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
