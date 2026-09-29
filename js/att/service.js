// Schedule & Attendance Service: the only thing the UI talks to. It owns the business
// rules (validation, status workflow, warnings, KRA maths) and delegates storage to an
// adapter, so moving from Google Sheets to PostgreSQL means writing a new adapter, not
// touching the UI or these rules.
//
// ADAPTER CONTRACT (all methods return Promises; reject with AttError on failure)
//   kind: string
//   getReference()                        -> { teamMembers:[{name,position}], sessionFacilitators:[name] }
//   listSessions()                        -> [Session]
//   getSession(id)                        -> Session | null
//   createSession(fields)                 -> Session          (adapter assigns id + version)
//   updateSession(id, patch, expVersion)  -> Session          (CONFLICT if expVersion is stale)
//   listFacilitatorAttendance({from,to})  -> [FacilitatorDay]
//   upsertFacilitatorAttendance(row, expVersion?) -> FacilitatorDay
//   deleteFacilitatorAttendance(person, date)     -> true
//
// SHAPES (camelCase; enum fields hold CODES from domain.js; dates ISO yyyy-mm-dd; times hh:mm)
//   Session           {id, date, program, trainingType, brand, venue, targetPax, actualPax,
//                      durationHrs, status, postTestAvg, remarks, facilitators:[name], version}
//   FacilitatorDay    {person, date, status, timeIn, timeOut, workLocation, leaveType, remarks, version}
// `version` is opaque: pass back what you read. Scope is the training schedule plus the daily
// attendance of facilitators / trainers / T&D team members; trainee attendance is out of scope.
(function (root, factory) {
  var deps = (typeof require === 'function' && typeof module === 'object')
    ? { errors: require('./errors'), domain: require('./domain') } : { errors: root.ATT.errors, domain: root.ATT.domain };
  var m = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.ATT = root.ATT || {}; root.ATT.service = m; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  var AttError = deps.errors.AttError, D = deps.domain;

  function fail(res) { return Promise.reject(AttError('VALIDATION', res.errors.join(' '), res.errors)); }
  function monthRange(month) { // 'YYYY-MM' -> {from,to}
    var m = /^(\d{4})-(\d{2})$/.exec(month || ''); if (!m) throw AttError('VALIDATION', 'Month must be yyyy-mm.');
    var last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    return { from: month + '-01', to: month + '-' + String(last).padStart(2, '0') };
  }

  function create(adapter) {
    var refCache = null;
    function reference() { return refCache || (refCache = adapter.getReference().catch(function (e) { refCache = null; throw e; })); }

    // Map typed names to the roster's canonical spelling; unknown names are rejected when a roster exists.
    function canonical(names, roster, what) {
      if (!roster.length) return { names: names, errors: [] };
      var idx = {}; roster.forEach(function (n) { idx[D.normName(n)] = n; });
      var out = [], errors = [];
      names.forEach(function (n) { var c = idx[D.normName(n)]; if (c) out.push(c); else errors.push('"' + n + '" is not on the ' + what + ' roster.'); });
      return { names: out, errors: errors };
    }

    var svc = {
      adapterKind: adapter.kind,
      reference: reference,

      // -------- schedule --------
      listSessions: function () { return adapter.listSessions(); },

      createSession: function (input) {
        var res = D.validateSession(Object.assign({ status: 'PLANNED' }, input), false);
        if (res.value.status !== 'PLANNED') res.errors.push('New sessions start as Planned.');
        return reference().then(function (ref) {
          var c = canonical(res.value.facilitators || [], ref.sessionFacilitators || [], 'facilitator');
          var errors = res.errors.concat(c.errors);
          if (errors.length) return fail({ errors: errors });
          res.value.facilitators = c.names; res.value.status = 'PLANNED';
          return adapter.createSession(res.value);
        });
      },

      // Field edits. A status change in the patch goes through the workflow rules.
      updateSession: function (id, patch, expectedVersion) {
        patch = Object.assign({}, patch);
        if (patch.status) {
          var to = patch.status; delete patch.status;
          return svc.moveSession(id, to, { patch: patch, expectedVersion: expectedVersion });
        }
        var res = D.validateSession(patch, true);
        return reference().then(function (ref) {
          var errors = res.errors.slice();
          if (res.value.facilitators) {
            var c = canonical(res.value.facilitators, ref.sessionFacilitators || [], 'facilitator');
            errors = errors.concat(c.errors); res.value.facilitators = c.names;
          }
          if (errors.length) return fail({ errors: errors });
          return adapter.getSession(id).then(function (cur) {
            if (!cur) throw AttError('NOT_FOUND', 'Session ' + id + ' not found.');
            if (cur.status === 'CONDUCTED' && res.value.date === null) throw AttError('VALIDATION', 'A Conducted session needs a date.');
            return adapter.updateSession(id, res.value, expectedVersion != null ? expectedVersion : cur.version);
          });
        });
      },

      // Kanban drop: PLANNED -> CONDUCTED, POSTPONED, CANCELLED; POSTPONED -> PLANNED, CANCELLED.
      moveSession: function (id, to, o) {
        o = o || {};
        return adapter.getSession(id).then(function (cur) {
          if (!cur) throw AttError('NOT_FOUND', 'Session ' + id + ' not found.');
          if (o.expectedVersion != null && o.expectedVersion !== cur.version) throw AttError('CONFLICT', 'Session ' + id + ' was changed by someone else. Reloaded.');
          if (cur.status === to) return cur;
          if (!D.canTransition(cur.status, to)) {
            throw AttError('TRANSITION', 'A ' + D.labelOf(D.SESSION_STATUSES, cur.status) + ' session cannot become ' + D.labelOf(D.SESSION_STATUSES, to) + '.');
          }
          var patchRes = D.validateSession(o.patch || {}, true);
          var merged = Object.assign({}, cur, patchRes.value, { status: to });
          var full = D.validateSession(merged, false);
          var errors = patchRes.errors.concat(full.errors.filter(function (m) { return patchRes.errors.indexOf(m) < 0; }));
          if (errors.length) throw AttError('VALIDATION', errors.join(' '), errors);
          return adapter.updateSession(id, Object.assign({}, patchRes.value, { status: to }), cur.version);
        });
      },

      // Training delivery report, derived from the live session records (never stored).
      // filter: { year:'2026'|'', month:'01'..'12'|'', today?, targetPerMonth? }
      deliveryReport: function (filter) {
        filter = filter || {};
        return Promise.all([adapter.listSessions(), reference().catch(function () { return { sessionFacilitators: [] }; })]).then(function (r) {
          var today = filter.today || D.todayISO();
          var out = D.summarizeDelivery(r[0], { year: filter.year, month: filter.month, today: today, roster: r[1].sessionFacilitators || [], targetPerMonth: filter.targetPerMonth });
          out.years = D.sessionYears(r[0], today);
          return out;
        });
      },

      // Non-blocking: double-booked facilitators, and facilitators marked off on that date.
      // Names are matched after normalisation; the two sheets can spell a person differently,
      // so an unmatched name yields no warning rather than a false one.
      scheduleWarnings: function (session) {
        var out = [];
        if (!session.date || !(session.facilitators || []).length || session.status === 'CANCELLED') return Promise.resolve(out);
        var mine = (session.facilitators || []).map(D.normName);
        return Promise.all([adapter.listSessions(), adapter.listFacilitatorAttendance({ from: session.date, to: session.date })]).then(function (r) {
          r[0].forEach(function (o) {
            if (o.id === session.id || o.date !== session.date || o.status === 'CANCELLED') return;
            (o.facilitators || []).forEach(function (n) {
              if (mine.indexOf(D.normName(n)) >= 0) out.push(n + ' is also on ' + o.id + ' (' + o.program + ') that day.');
            });
          });
          r[1].forEach(function (a) {
            if (['ON_LEAVE', 'ABSENT', 'REST_DAY', 'HOLIDAY'].indexOf(a.status) >= 0 && mine.indexOf(D.normName(a.person)) >= 0) {
              out.push(a.person + ' is logged as ' + D.facStatus(a.status).label + ' on that date.');
            }
          });
          return out;
        });
      },

      // -------- facilitator daily attendance (KRA) --------
      listFacilitatorAttendance: function (q) { return adapter.listFacilitatorAttendance(q || {}); },
      saveFacilitatorAttendance: function (input, expectedVersion) {
        var res = D.validateFacilitatorAttendance(input);
        if (!res.ok) return fail(res);
        return reference().then(function (ref) {
          var c = canonical([res.value.person], (ref.teamMembers || []).map(function (p) { return p.name; }), 'team');
          if (c.errors.length) return fail(c);
          res.value.person = c.names[0];
          return adapter.upsertFacilitatorAttendance(res.value, expectedVersion);
        });
      },
      deleteFacilitatorAttendance: function (person, date) { return adapter.deleteFacilitatorAttendance(person, date); },

      // Monthly KRA per person for 'YYYY-MM'. People with no rows are absent from the result
      // (no data is not zero).
      kraMonthly: function (month) {
        var r = monthRange(month);
        return adapter.listFacilitatorAttendance(r).then(function (rows) {
          var by = {};
          rows.forEach(function (x) { (by[x.person] = by[x.person] || []).push(x); });
          return Object.keys(by).sort().map(function (p) { return Object.assign({ person: p }, D.computeKra(by[p])); });
        });
      }
    };
    return svc;
  }
  return { create: create };
});
