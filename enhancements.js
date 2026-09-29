/* ============================================================================
 * enhancements.js
 * ----------------------------------------------------------------------------
 * ADDITIVE ONLY. Loaded after app.js. Wrapped in one IIFE so nothing leaks
 * into the global scope and nothing in app.js is modified.
 *
 * How it hooks in without touching app.js:
 *   - Role + username are READ from the DOM that app.js already writes
 *     (#roleChip, #userChip). No new auth flow is created.
 *   - The issue list is observed with a MutationObserver, so whenever app.js
 *     re-renders it we re-apply the date filter and re-inject the admin
 *     priority control.
 *   - Data it needs (created_at) is fetched READ-ONLY over the REST API using
 *     the session token app.js already stored. No writes except the admin
 *     priority change, which goes through the same RLS the app uses.
 *
 * Slices in this file:
 *   SLICE 1  role badge (CSS only) + admin-only priority quick-select
 *   SLICE 2  date filter bar with presets, month picker, custom range,
 *            live result count and URL persistence
 * ========================================================================= */

(function () {
  'use strict';

  /* ============================== helpers ================================ */

  var $ = function (id) { return document.getElementById(id); };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ==================== read-only access to Supabase ===================== */
  /* Reuses the session that app.js already stored, so we never sign anyone
     in or out and never refresh tokens on the app's behalf.                */

  var CFG = window.SUPABASE_CONFIG || {};
  var API = String(CFG.url || '').replace(/\/+$/, '');

  function authStorageKey() {
    var m = API.match(/^https?:\/\/([^.]+)\./);
    return m ? 'sb-' + m[1] + '-auth-token' : null;
  }

  function accessToken() {
    var k = authStorageKey();
    if (!k) return null;
    try {
      var raw = localStorage.getItem(k);
      if (!raw) return null;
      var sess = JSON.parse(raw);
      return sess && sess.access_token ? sess.access_token : null;
    } catch (e) {
      return null;
    }
  }

  function restHeaders(extra) {
    var key = String(CFG.anonKey || '');
    var h = {
      apikey: key,
      Authorization: 'Bearer ' + (accessToken() || key),
      Accept: 'application/json'
    };
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k]; } }
    return h;
  }

  function restGet(path) {
    if (!API) return Promise.reject(new Error('Supabase URL not configured'));
    return fetch(API + '/rest/v1/' + path, { headers: restHeaders() }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function restPatch(path, body) {
    if (!API) return Promise.reject(new Error('Supabase URL not configured'));
    return fetch(API + '/rest/v1/' + path, {
      method: 'PATCH',
      headers: restHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return true;
    });
  }

  /* ========================= role, from the DOM ========================== */

  function role() {
    // Prefer the shared auth state; fall back to the old role chip if present.
    if (window.ET && window.ET.auth && window.ET.auth.user) {
      return window.ET.auth.user.role === 'admin' ? 'admin' : 'user';
    }
    var chip = $('roleChip');
    if (!chip) return null;
    var t = String(chip.textContent || '').trim().toLowerCase();
    return t === 'admin' ? 'admin' : (t === 'user' ? 'user' : null);
  }
  function isAdmin() { return role() === 'admin'; }
  function appVisible() {
    var v = $('appView');
    if (!v) return true;      // multi-page shell: no single wrapper element
    return !v.hidden;
  }

  /* ===================== SLICE 2 — date filter =========================== */

  var PRESETS = ['today', 'week', 'month', 'lastmonth', 'year'];

  var state = { preset: null, month: null, from: null, to: null };

  /** id -> createdAt (ms). Filled lazily from the REST API. */
  var dateIndex = new Map();
  var indexLoading = false;

  function presetRange(name) {
    var today = startOfDay(new Date());
    switch (name) {
      case 'today':
        return { from: ymd(today), to: ymd(today) };
      case 'week': {
        var dow = (today.getDay() + 6) % 7;           // Monday = 0
        var mon = addDays(today, -dow);
        return { from: ymd(mon), to: ymd(addDays(mon, 6)) };
      }
      case 'month':
        return {
          from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)),
          to: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0))
        };
      case 'lastmonth':
        return {
          from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
          to: ymd(new Date(today.getFullYear(), today.getMonth(), 0))
        };
      case 'year':
        return {
          from: ymd(new Date(today.getFullYear(), 0, 1)),
          to: ymd(new Date(today.getFullYear(), 11, 31))
        };
      default:
        return { from: null, to: null };
    }
  }

  function monthRange(value) {                        // "YYYY-MM"
    if (!value) return { from: null, to: null };
    var p = value.split('-');
    var y = Number(p[0]), m = Number(p[1]);
    if (!y || !m) return { from: null, to: null };
    return {
      from: y + '-' + pad2(m) + '-01',
      to: ymd(new Date(y, m, 0))                      // day 0 of next month
    };
  }

  function hasDateFilter() { return !!(state.from || state.to); }

  function inRange(ts) {
    if (!hasDateFilter()) return true;
    if (!ts) return true;                              // unknown date: never hide
    var d = new Date(ts);
    var k = ymd(d);
    if (state.from && k < state.from) return false;
    if (state.to && k > state.to) return false;
    return true;
  }

  /** Best-effort fallback when the REST lookup is unavailable. */
  function dateFromCard(card) {
    var el = card.querySelector('.issue-date');
    if (!el) return null;
    var text = String(el.textContent || '').replace(/^\s*Created\s*/i, '').trim();
    var parsed = Date.parse(text);
    return isNaN(parsed) ? null : parsed;
  }

  function issueCreatedAt(card) {
    var id = card.dataset.id;
    if (dateIndex.has(id)) return dateIndex.get(id);
    return dateFromCard(card);
  }

  function ensureIndex() {
    if (indexLoading || !API || !appVisible()) return;
    indexLoading = true;
    restGet('issues?select=id,created_at')
      .then(function (rows) {
        rows.forEach(function (r) {
          dateIndex.set(r.id, Date.parse(r.created_at) || 0);
        });
        applyDateFilter();
      })
      .catch(function () {
        /* stay silent — the DOM fallback keeps the filter working */
      })
      .then(function () { indexLoading = false; });
  }

  function cards() {
    var list = $('issueList');
    return list ? list.querySelectorAll('.issue') : [];
  }

  function applyDateFilter() {
    var all = cards();
    var shown = 0;
    for (var i = 0; i < all.length; i++) {
      var card = all[i];
      var ok = inRange(issueCreatedAt(card));
      card.hidden = !ok;
      if (ok) shown++;
    }

    var count = $('etDateCount');
    if (count) count.textContent = shown + (shown === 1 ? ' result' : ' results');

    var clear = $('etDateClear');
    if (clear) clear.disabled = !hasDateFilter();

    // Mark the active preset chip (if any).
    var chips = document.querySelectorAll('#etDatePresets .et-chip');
    for (var j = 0; j < chips.length; j++) {
      var on = state.preset && chips[j].dataset.preset === state.preset;
      chips[j].classList.toggle('active', !!on);
    }

    // If every card is filtered out, say so rather than showing a blank list.
    var note = $('etDateNote');
    if (note) {
      note.hidden = !(all.length > 0 && shown === 0);
    }
  }

  /* ------------------------------ URL state ----------------------------- */

  function writeUrl() {
    var params = new URLSearchParams();
    if (state.preset) params.set('preset', state.preset);
    if (state.month) params.set('month', state.month);
    if (!state.preset && !state.month) {
      if (state.from) params.set('from', state.from);
      if (state.to) params.set('to', state.to);
    }
    var q = params.toString();
    var url = location.pathname + (q ? '?' + q : '') + location.hash;
    try { history.replaceState(null, '', url); } catch (e) { /* ignore */ }
  }

  function readUrl() {
    var params = new URLSearchParams(location.search);
    var preset = params.get('preset');
    var month = params.get('month');
    var from = params.get('from');
    var to = params.get('to');

    if (month) {
      state.month = month;
      var r = monthRange(month);
      state.from = r.from; state.to = r.to; state.preset = null;
    } else if (preset && PRESETS.indexOf(preset) !== -1) {
      state.preset = preset;
      var r2 = presetRange(preset);
      state.from = r2.from; state.to = r2.to; state.month = null;
    } else if (from || to) {
      state.preset = null; state.month = null;
      state.from = from || null;
      state.to = to || null;
    }
    syncControls();
  }

  function syncControls() {
    var m = $('etMonth');
    if (m) m.value = state.month || '';
    var f = $('etFrom');
    if (f) f.value = state.from || '';
    var t = $('etTo');
    if (t) t.value = state.to || '';
  }

  function setFilter(next) {
    state.preset = next.preset || null;
    state.month = next.month || null;
    state.from = next.from || null;
    state.to = next.to || null;
    syncControls();
    writeUrl();
    applyDateFilter();
  }

  function clearDateFilter() {
    setFilter({ preset: null, month: null, from: null, to: null });
  }

  /* ================== SLICE 1 — priority quick-select ==================== */

  function injectPriority() {
    var admin = isAdmin();
    var all = cards();

    for (var i = 0; i < all.length; i++) {
      var card = all[i];
      var actions = card.querySelector('.issue-actions');
      if (!actions) continue;

      var existing = actions.querySelector('.et-prio');

      if (!admin) {
        if (existing) existing.parentNode.removeChild(existing);
        continue;
      }
      if (existing) continue;

      var current = card.dataset.priority || 'medium';
      var sel = document.createElement('select');
      sel.className = 'et-prio';
      sel.dataset.p = current;
      sel.title = 'Change priority';
      sel.setAttribute('aria-label', 'Change priority');

      ['low', 'medium', 'high'].forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p;
        opt.textContent = cap(p);
        if (p === current) opt.selected = true;
        sel.appendChild(opt);
      });

      sel.addEventListener('change', function (ev) {
        onPriorityChange(card.dataset.id, ev.target.value, ev.target);
      });

      actions.insertBefore(sel, actions.firstChild);
    }
  }

  function onPriorityChange(issueId, priority, selectEl) {
    if (!isAdmin() || !issueId || !priority) return;

    selectEl.disabled = true;
    var previous = selectEl.dataset.p || 'medium';

    restPatch('issues?id=eq.' + encodeURIComponent(issueId), { priority: priority })
      .then(function () {
        selectEl.dataset.p = priority;
        // Ask the existing app to re-read from the database (no app.js change).
        var refreshBtn = $('refreshBtn');
        if (refreshBtn) refreshBtn.click();
      })
      .catch(function (err) {
        selectEl.value = previous;
        selectEl.dataset.p = previous;
        window.alert('Could not change the priority: ' + err.message);
      })
      .then(function () { selectEl.disabled = false; });
  }

  /* ============================== wiring ================================ */

  function bindDateBar() {
    var presets = $('etDatePresets');
    if (presets) {
      presets.addEventListener('click', function (ev) {
        var chip = ev.target.closest('.et-chip');
        if (!chip) return;
        var name = chip.dataset.preset;
        var r = presetRange(name);
        setFilter({ preset: name, from: r.from, to: r.to });
      });
    }

    var month = $('etMonth');
    if (month) {
      month.addEventListener('change', function () {
        var v = month.value;
        if (!v) { clearDateFilter(); return; }
        var r = monthRange(v);
        setFilter({ month: v, from: r.from, to: r.to });
      });
    }

    var from = $('etFrom');
    var to = $('etTo');
    function onRangeChange() {
      var f = from ? from.value : '';
      var t = to ? to.value : '';
      if (f && t && f > t) { var swap = f; f = t; t = swap; }
      setFilter({ from: f, to: t });
    }
    if (from) from.addEventListener('change', onRangeChange);
    if (to) to.addEventListener('change', onRangeChange);

    var clear = $('etDateClear');
    if (clear) {
      clear.addEventListener('click', function (ev) {
        ev.preventDefault();
        clearDateFilter();
      });
    }

    var noteClear = $('etDateNoteClear');
    if (noteClear) {
      noteClear.addEventListener('click', function (ev) {
        ev.preventDefault();
        clearDateFilter();
      });
    }
  }

  function watch() {
    // Whenever app.js re-renders the list, re-apply our filter + control.
    var list = $('issueList');
    if (list && window.MutationObserver) {
      var obs = new MutationObserver(debounce(function () {
        ensureIndex();
        applyDateFilter();
        injectPriority();
      }, 60));
      obs.observe(list, { childList: true });
    }

    // Role can change under us (an admin promotes/demotes you).
    var chip = $('roleChip');
    if (chip && window.MutationObserver) {
      var roleObs = new MutationObserver(debounce(function () {
        injectPriority();
      }, 60));
      roleObs.observe(chip, { childList: true, characterData: true, subtree: true, attributes: true });
    }

    // Re-check once the app becomes visible (sign-in).
    var view = $('appView');
    if (view && window.MutationObserver) {
      var viewObs = new MutationObserver(debounce(function () {
        if (appVisible()) { ensureIndex(); applyDateFilter(); injectPriority(); }
      }, 60));
      viewObs.observe(view, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  function boot() {
    if (!$('etDateBar')) return;      // nothing to do / element missing

    bindDateBar();
    readUrl();                        // apply whatever the URL asked for
    watch();

    ensureIndex();
    applyDateFilter();
    injectPriority();

    // The list may already be rendered before we ran; catch up on the next tick.
    setTimeout(function () { applyDateFilter(); injectPriority(); }, 300);
    setTimeout(function () { applyDateFilter(); injectPriority(); }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
