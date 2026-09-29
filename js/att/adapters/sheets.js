// Pilot adapter: talks to the Google Apps Script web app in apps-script/Code.gs, which reads
// and writes the pilot Google Sheets. All spreadsheet knowledge lives in Code.gs; this file
// is only transport. The request is POSTed as text/plain so the browser sends no CORS preflight.
(function (root, factory) {
  var deps = (typeof require === 'function' && typeof module === 'object') ? { errors: require('../errors') } : { errors: root.ATT.errors };
  var m = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.ATT = root.ATT || {}; root.ATT.adapters = root.ATT.adapters || {}; root.ATT.adapters.sheets = m; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  var AttError = deps.errors.AttError;

  // cfg: { apiUrl, token, actor?, fetch? }
  function create(cfg) {
    var doFetch = cfg.fetch || (typeof fetch === 'function' ? fetch.bind(typeof self !== 'undefined' ? self : this) : null);
    function call(action, params) {
      if (!doFetch) return Promise.reject(AttError('NETWORK', 'fetch is not available.'));
      return doFetch(cfg.apiUrl, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: cfg.token, action: action, params: params || {}, actor: cfg.actor || '' })
      }).then(function (res) {
        if (!res.ok) throw AttError('NETWORK', 'The scheduling service returned HTTP ' + res.status + '.');
        return res.json();
      }, function () { throw AttError('NETWORK', 'Could not reach the scheduling service.'); })
        .then(function (body) {
          if (!body || typeof body.ok !== 'boolean') throw AttError('SERVER', 'Unexpected response from the scheduling service.');
          if (!body.ok) throw AttError((body.error && body.error.code) || 'SERVER', (body.error && body.error.message) || 'Request failed.');
          return body.data;
        });
    }
    return {
      kind: 'sheets',
      ping: function () { return call('ping'); },
      getReference: function () { return call('getReference'); },
      listSessions: function () { return call('listSessions'); },
      getSession: function (id) { return call('getSession', { id: id }); },
      createSession: function (fields) { return call('createSession', { fields: fields }); },
      updateSession: function (id, patch, expectedVersion) { return call('updateSession', { id: id, patch: patch, expectedVersion: expectedVersion }); },
      listFacilitatorAttendance: function (q) { return call('listFacilitatorAttendance', q || {}); },
      upsertFacilitatorAttendance: function (row, v) { return call('upsertFacilitatorAttendance', { row: row, expectedVersion: v }); },
      deleteFacilitatorAttendance: function (person, date) { return call('deleteFacilitatorAttendance', { person: person, date: date }); }
    };
  }
  return { create: create };
});
