/* ============================================================================
 * js/page-reports.js
 * ----------------------------------------------------------------------------
 * The Reports page (admins): filter the issues by date (a day, a month, a year
 * or a custom range) and export exactly what is shown.
 *
 * Read-only: it never writes to the database.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };
  var escapeHtml = ET.escapeHtml;

  var issues = [];
  var profileById = new Map();
  var filters = { from: null, to: null, status: 'all', priority: 'all', q: '' };

  /* ------------------------------- date helpers -------------------------- */

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function ymd(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function presetRange(name) {
    var now = new Date();
    var today = startOfDay(now);
    if (name === 'today') return [today, addDays(today, 1)];
    if (name === 'week') {
      var dow = (today.getDay() + 6) % 7;                 // Monday = 0
      return [addDays(today, -dow), addDays(today, 1)];
    }
    if (name === 'month') {
      return [new Date(now.getFullYear(), now.getMonth(), 1), addDays(today, 1)];
    }
    if (name === 'lastmonth') {
      return [new Date(now.getFullYear(), now.getMonth() - 1, 1),
              new Date(now.getFullYear(), now.getMonth(), 1)];
    }
    if (name === 'year') return [new Date(now.getFullYear(), 0, 1), addDays(today, 1)];
    return [null, null];
  }

  function monthRange(value) {
    var parts = String(value || '').split('-');
    var y = Number(parts[0]), m = Number(parts[1]);
    if (!y || !m) return [null, null];
    return [new Date(y, m - 1, 1), new Date(y, m, 1)];
  }

  /* -------------------------------- mapping ------------------------------ */

  function mapIssue(row) {
    return {
      id: row.id,
      title: row.title || '',
      description: row.description || '',
      priority: row.priority || 'medium',
      status: row.status || 'pending',
      label: row.label || '',
      authorId: row.author_id,
      createdAt: Date.parse(row.created_at) || 0
    };
  }

  function authorName(id) {
    var p = profileById.get(id);
    return p ? p.username : 'unknown';
  }

  /* ------------------------------- filtering ----------------------------- */

  function visible() {
    var q = filters.q.trim().toLowerCase();

    return issues.filter(function (it) {
      if (filters.from && it.createdAt < filters.from.getTime()) return false;
      if (filters.to && it.createdAt >= filters.to.getTime()) return false;
      if (filters.status !== 'all' && it.status !== filters.status) return false;
      if (filters.priority !== 'all' && it.priority !== filters.priority) return false;
      if (q) {
        var hay = [it.title, it.description, it.label, authorName(it.authorId)]
          .filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function rangeText() {
    if (!filters.from && !filters.to) return 'Showing every issue.';
    var from = filters.from ? ymd(filters.from) : 'the beginning';
    var to = filters.to ? ymd(addDays(filters.to, -1)) : 'today';
    return 'Showing issues created from ' + from + ' to ' + to + '.';
  }

  /* -------------------------------- render ------------------------------- */

  function render() {
    var list = visible();
    $('repCount').textContent = list.length;
    $('repRange').textContent = rangeText();

    if (!list.length) {
      $('repTable').innerHTML = '<p class="muted small">No issues match this report.</p>';
      return;
    }

    var rows = list.map(function (it, i) {
      return '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + escapeHtml(it.title) + '</td>' +
        '<td>' + escapeHtml(ET.STATUS_LABEL[it.status] || it.status) + '</td>' +
        '<td>' + escapeHtml(it.priority) + '</td>' +
        '<td>' + escapeHtml(authorName(it.authorId)) + '</td>' +
        '<td>' + escapeHtml(ET.formatDate(it.createdAt)) + '</td>' +
      '</tr>';
    }).join('');

    $('repTable').innerHTML =
      '<table class="report-table">' +
        '<thead><tr>' +
          '<th class="num">#</th><th>Title</th><th>Status</th><th>Priority</th>' +
          '<th>Reported by</th><th>Created</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  /* -------------------------------- export ------------------------------- */

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function stamp() { return ymd(new Date()); }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    var list = visible();
    if (!list.length) { ET.toast('Nothing to export for this report.'); return; }
    var lines = [['#', 'Title', 'Description', 'Status', 'Priority', 'Label', 'Reported by', 'Created'].map(csvCell).join(',')];
    list.forEach(function (it, i) {
      lines.push([
        i + 1, it.title, it.description,
        ET.STATUS_LABEL[it.status] || it.status,
        it.priority, it.label, authorName(it.authorId),
        new Date(it.createdAt).toISOString()
      ].map(csvCell).join(','));
    });
    download('issues-report-' + stamp() + '.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    ET.toast('Exported ' + list.length + ' issue(s) to CSV.');
  }

  function exportJson() {
    var list = visible();
    if (!list.length) { ET.toast('Nothing to export for this report.'); return; }
    var payload = list.map(function (it) {
      return {
        title: it.title,
        description: it.description,
        status: it.status,
        priority: it.priority,
        label: it.label,
        reporter: authorName(it.authorId),
        createdAt: new Date(it.createdAt).toISOString()
      };
    });
    download('issues-report-' + stamp() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    ET.toast('Exported ' + list.length + ' issue(s) to JSON.');
  }

  /* -------------------------------- wiring ------------------------------- */

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('#repPresets .et-chip'), function (chip) {
      chip.addEventListener('click', function () {
        var r = presetRange(chip.dataset.preset);
        filters.from = r[0];
        filters.to = r[1];
        $('repFrom').value = r[0] ? ymd(r[0]) : '';
        $('repTo').value = r[1] ? ymd(addDays(r[1], -1)) : '';
        $('repMonth').value = '';
        render();
      });
    });

    $('repMonth').addEventListener('change', function (e) {
      var r = monthRange(e.target.value);
      filters.from = r[0];
      filters.to = r[1];
      $('repFrom').value = r[0] ? ymd(r[0]) : '';
      $('repTo').value = r[1] ? ymd(addDays(r[1], -1)) : '';
      render();
    });

    $('repFrom').addEventListener('change', function (e) {
      filters.from = e.target.value ? startOfDay(new Date(e.target.value + 'T00:00:00')) : null;
      $('repMonth').value = '';
      render();
    });

    $('repTo').addEventListener('change', function (e) {
      filters.to = e.target.value ? addDays(startOfDay(new Date(e.target.value + 'T00:00:00')), 1) : null;
      $('repMonth').value = '';
      render();
    });

    $('repStatus').addEventListener('change', function (e) { filters.status = e.target.value; render(); });
    $('repPriority').addEventListener('change', function (e) { filters.priority = e.target.value; render(); });

    var timer = null;
    $('repSearch').addEventListener('input', function (e) {
      clearTimeout(timer);
      var v = e.target.value;
      timer = setTimeout(function () { filters.q = v; render(); }, 120);
    });

    $('repClear').addEventListener('click', function () {
      filters = { from: null, to: null, status: 'all', priority: 'all', q: '' };
      ['repMonth', 'repFrom', 'repTo', 'repSearch'].forEach(function (id) { $(id).value = ''; });
      $('repStatus').value = 'all';
      $('repPriority').value = 'all';
      render();
    });

    $('repCsv').addEventListener('click', exportCsv);
    $('repJson').addEventListener('click', exportJson);
    $('repPrint').addEventListener('click', function () { window.print(); });
  }

  /* --------------------------------- init -------------------------------- */

  async function init() {
    var user = await ET.layout.render({ active: 'reports', title: 'Reports', requireAdmin: true });
    if (!user) return;

    var sb = ET.getClient();
    if (!sb) return;

    var results = await Promise.all([
      sb.from('issues').select('*').order('created_at', { ascending: false }),
      sb.from('profiles').select('id, username, role')
    ]);

    if (results[0].error) {
      ET.toast('Could not load issues: ' + ET.friendlyError(results[0].error));
      return;
    }

    issues = (results[0].data || []).map(mapIssue);
    profileById = new Map((results[1].data || []).map(function (p) { return [p.id, p]; }));

    bind();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
