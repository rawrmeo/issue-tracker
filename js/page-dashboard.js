/* ============================================================================
 * js/page-dashboard.js
 * ----------------------------------------------------------------------------
 * Stats + "Issues per month (last 12 months)" chart + recent activity.
 *
 * Scope note: this reads ALL issues, exactly like the existing Issues page
 * does (app.js refresh() had no author filter and RLS allows every signed-in
 * user to read every issue). Behaviour is therefore unchanged.
 *
 * "Recent activity" is derived from columns that already exist
 * (created_at / updated_at / completed_at) because no audit table exists.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };

  var STATUS_LABEL = ET.STATUS_LABEL;
  var escapeHtml = ET.escapeHtml;

  var chart = null;

  /* ------------------------------- helpers ------------------------------- */

  function mapIssue(row) {
    return {
      id: row.id,
      title: row.title || '',
      priority: ['low', 'medium', 'high'].indexOf(row.priority) !== -1 ? row.priority : 'medium',
      status: ET.STATUSES.indexOf(row.status) !== -1 ? row.status : 'pending',
      label: row.label || '',
      authorId: row.author_id,
      createdAt: Date.parse(row.created_at) || 0,
      updatedAt: Date.parse(row.updated_at) || 0,
      completedAt: row.completed_at ? Date.parse(row.completed_at) : null
    };
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  function initials(name) {
    return ET.escapeHtml(String(name || '?').charAt(0).toUpperCase());
  }

  /* -------------------------------- stats -------------------------------- */

  function renderStats(issues) {
    var total = issues.length;
    var done = issues.filter(function (i) { return i.status === 'done'; }).length;
    var fixing = issues.filter(function (i) { return i.status === 'fixing'; }).length;
    var pending = total - done - fixing;
    var high = issues.filter(function (i) {
      return i.priority === 'high' && i.status !== 'done';
    }).length;

    setText('statTotal', total);
    setText('statPending', pending);
    setText('statFixing', fixing);
    setText('statDone', done);
    setText('statHigh', high);
  }

  /* -------------------------------- chart -------------------------------- */

  function last12Months() {
    var out = [];
    var now = new Date();
    for (var i = 11; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
        label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
      });
    }
    return out;
  }

  function renderChart(issues) {
    var canvas = $('chartCanvas');
    var empty = $('chartEmpty');
    if (!canvas) return;

    var months = last12Months();
    var counts = {};
    months.forEach(function (m) { counts[m.key] = 0; });

    issues.forEach(function (i) {
      var d = new Date(i.createdAt);
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (key in counts) counts[key]++;
    });

    var total = months.reduce(function (sum, m) { return sum + counts[m.key]; }, 0);
    if (empty) empty.hidden = total > 0;
    canvas.hidden = total === 0;

    if (total === 0) { if (chart) { chart.destroy(); chart = null; } return; }

    if (typeof window.Chart === 'undefined') {
      // Chart.js failed to load (offline). Show a simple text fallback.
      if (empty) {
        empty.hidden = false;
        empty.textContent = months.map(function (m) { return counts[m.key]; }).join(' · ') +
          '  (Chart.js unavailable)';
      }
      return;
    }

    var styles = getComputedStyle(document.documentElement);
    var accent = (styles.getPropertyValue('--accent') || '#4f46e5').trim();
    var border = (styles.getPropertyValue('--border') || '#e3e5ee').trim();
    var muted = (styles.getPropertyValue('--muted') || '#6b7186').trim();

    if (chart) chart.destroy();
    chart = new window.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: months.map(function (m) { return m.label; }),
        datasets: [{
          label: 'Issues created',
          data: months.map(function (m) { return counts[m.key]; }),
          backgroundColor: accent,
          borderRadius: 6,
          maxBarThickness: 34
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.parsed.y + (ctx.parsed.y === 1 ? ' issue' : ' issues');
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: muted, font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: border },
            ticks: { color: muted, precision: 0, font: { size: 11 } }
          }
        }
      }
    });
  }

  /* ---------------------------- recent activity -------------------------- */

  function buildActivity(issues, profileById) {
    var events = [];

    issues.forEach(function (i) {
      var who = (profileById.get(i.authorId) || {}).username || 'someone';

      events.push({
        at: i.createdAt,
        status: i.status,
        text: 'opened by ' + who,
        title: i.title
      });

      if (i.completedAt) {
        events.push({
          at: i.completedAt,
          status: 'done',
          text: 'marked as done',
          title: i.title
        });
      } else if (i.updatedAt && i.updatedAt > i.createdAt + 1000) {
        events.push({
          at: i.updatedAt,
          status: i.status,
          text: 'updated',
          title: i.title
        });
      }
    });

    return events
      .filter(function (e) { return e.at > 0; })
      .sort(function (a, b) { return b.at - a.at; })
      .slice(0, 10);
  }

  function renderActivity(issues, profileById) {
    var list = $('activityList');
    if (!list) return;

    var events = buildActivity(issues, profileById);
    var empty = $('activityEmpty');
    if (empty) empty.hidden = events.length > 0;
    list.hidden = events.length === 0;

    list.innerHTML = events.map(function (e) {
      return '<div class="activity-item">' +
        '<span class="activity-dot ' + e.status + '"></span>' +
        '<div class="activity-main">' +
          '<span class="activity-text">' + escapeHtml(e.title) + ' — ' + escapeHtml(e.text) + '</span>' +
          '<span class="activity-meta">' + escapeHtml(ET.timeAgo(e.at)) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* --------------------------------- init -------------------------------- */

  async function init() {
    var user = await ET.layout.render({ active: 'dashboard', title: 'Dashboard' });
    if (!user) return;

    var greeting = $('dashGreeting');
    if (greeting) {
      greeting.textContent = 'Signed in as ' + user.username +
        ' (' + (ET.auth.isAdmin() ? 'admin' : 'user') + ').';
    }

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

    var issues = (results[0].data || []).map(mapIssue);
    var profileById = new Map(
      (results[1].data || []).map(function (p) { return [p.id, p]; })
    );

    renderStats(issues);
    renderChart(issues);
    renderActivity(issues, profileById);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
