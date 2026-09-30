// In-memory data adapter. Starts EMPTY (no sample data). Used by the tests and as the
// "not connected" mode of the pages, where nothing is persisted across reloads.
// Implements the same contract as adapters/sheets.js; see js/att/service.js for the shapes.
(function (root, factory) {
  var deps = (typeof require === 'function' && typeof module === 'object')
    ? { errors: require('../errors'), domain: require('../domain') } : { errors: root.ATT.errors, domain: root.ATT.domain };
  var m = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.ATT = root.ATT || {}; root.ATT.adapters = root.ATT.adapters || {}; root.ATT.adapters.memory = m; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  var AttError = deps.errors.AttError, D = deps.domain;

  // seed (optional): { teamMembers:[{name,position}], sessionFacilitators:[name] } -- roster reference data only.
  function create(seed) {
    seed = seed || {};
    var teamMembers = (seed.teamMembers || []).map(function (p) { return { name: p.name, position: p.position || '' }; });
    var sessionFacilitators = (seed.sessionFacilitators || []).slice();
    var sessions = {}, fac = {}, audit = [], ver = 0;
    function next() { return String(++ver); }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }
    function log(entity, id, action, before, after) { audit.push({ at: new Date().toISOString(), entity: entity, id: id, action: action, before: before || null, after: after || null }); }

    return {
      kind: 'memory',
      _audit: audit,
      getReference: function () { return Promise.resolve({ teamMembers: copy(teamMembers), sessionFacilitators: copy(sessionFacilitators) }); },

      listSessions: function () { return Promise.resolve(copy(Object.keys(sessions).sort().map(function (k) { return sessions[k]; }))); },
      getSession: function (id) { return Promise.resolve(sessions[id] ? copy(sessions[id]) : null); },
      createSession: function (f) {
        var n = Object.keys(sessions).length, id;
        do { id = 'TPD-' + String(++n).padStart(4, '0'); } while (sessions[id]);
        var s = Object.assign({ facilitators: [], status: 'PLANNED' }, copy(f), { id: id, version: next() });
        sessions[id] = s; log('TRAINING_SESSION', id, 'CREATE', null, s);
        return Promise.resolve(copy(s));
      },
      updateSession: function (id, patch, expectedVersion) {
        var cur = sessions[id];
        if (!cur) return Promise.reject(AttError('NOT_FOUND', 'Session ' + id + ' not found.'));
        if (expectedVersion != null && expectedVersion !== cur.version) return Promise.reject(AttError('CONFLICT', 'Session ' + id + ' was changed by someone else.'));
        var before = copy(cur), s = Object.assign({}, cur, copy(patch), { id: id, version: next() });
        sessions[id] = s; log('TRAINING_SESSION', id, patch.status && patch.status !== before.status ? 'STATUS_CHANGE' : 'UPDATE', before, s);
        return Promise.resolve(copy(s));
      },

      listFacilitatorAttendance: function (q) {
        q = q || {};
        return Promise.resolve(copy(Object.keys(fac).map(function (k) { return fac[k]; }).filter(function (r) {
          return (!q.from || r.date >= q.from) && (!q.to || r.date <= q.to);
        }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.person < b.person ? -1 : 1; })));
      },
      upsertFacilitatorAttendance: function (e, expectedVersion) {
        var k = D.normName(e.person) + '|' + e.date, cur = fac[k];
        if (cur && expectedVersion != null && expectedVersion !== cur.version) return Promise.reject(AttError('CONFLICT', 'This attendance row was changed by someone else.'));
        var r = Object.assign({}, copy(e), { version: next() });
        fac[k] = r; log('FACILITATOR_ATTENDANCE', k, cur ? 'UPDATE' : 'CREATE', cur, r);
        return Promise.resolve(copy(r));
      },
      deleteFacilitatorAttendance: function (person, date) {
        var k = D.normName(person) + '|' + date, cur = fac[k];
        if (!cur) return Promise.reject(AttError('NOT_FOUND', 'No such attendance row.'));
        delete fac[k]; log('FACILITATOR_ATTENDANCE', k, 'DELETE', cur, null);
        return Promise.resolve(true);
      }
    };
  }
  return { create: create };
});
