/* ============================================================================
 * js/page-apidocs.js
 * ----------------------------------------------------------------------------
 * ADMIN ONLY. Shows the API base URL (built from supabase-config.js), wires
 * the copy button, and fills the examples with the real URL.
 *
 * The catalog itself is static markup; the source of truth for the API is
 * API.md and openapi.yaml.
 * ========================================================================= */

(function () {
  'use strict';

  var ET = window.ET;
  var $ = function (id) { return document.getElementById(id); };

  function baseUrl() {
    var url = String((window.SUPABASE_CONFIG || {}).url || '').replace(/\/+$/, '');
    return url ? url + '/functions/v1/api' : 'https://<ref>.supabase.co/functions/v1/api';
  }

  async function init() {
    var user = await ET.layout.render({ active: 'api-docs', title: 'API docs', requireAdmin: true });
    if (!user) return;

    var base = baseUrl();

    var baseEl = $('apiBase');
    if (baseEl) baseEl.textContent = base;

    var examples = $('apiExamples');
    if (examples) examples.textContent = examples.textContent.split('$BASE').join(base);

    var copy = $('apiBaseCopy');
    if (copy) copy.addEventListener('click', function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(base).then(function () { ET.toast('Base URL copied.'); });
      } else {
        ET.toast('Select the URL and copy it manually.');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
