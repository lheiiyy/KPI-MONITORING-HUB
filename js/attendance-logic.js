// Facilitator / Trainer / T&D team attendance: vocabulary, validation, identity
// resolution and KRA calculation. Pure functions, no I/O and no DOM, so the page,
// the tests and the main dashboard can all use the same code.
// Scope: attendance of T&D team members only. There is no trainee/participant
// attendance anywhere in this module. Contract: docs/ATTENDANCE_MODULE.md
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AttendanceLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function list(pairs) { return pairs.map(function (p) { return { code: p[0], label: p[1] }; }); }

  // Labels are exactly the wording of the TDD Team Attendance Monitoring 2026 LISTS tab.
  var STATUSES = list([
    ['PRESENT', 'Present'], ['LATE', 'Late'], ['HALF_DAY', 'Half Day'], ['ABSENT', 'Absent'], ['ON_LEAVE', 'On Leave'],
    ['OFFICIAL_BUSINESS', 'Official Business / Field'], ['WORK_FROM_HOME', 'Work From Home'],
    ['REST_DAY', 'Rest Day / Day Off'], ['HOLIDAY', 'Holiday']]);
  var WORK_LOCATIONS = list([
    ['HEAD_OFFICE', 'Head Office'], ['TRAINING_ROOM', 'Training Room'], ['STORE_VISIT_FIELD', 'Store Visit / Field'],
    ['COMMISSARY', 'Commissary'], ['OTHER', 'Other']]);
  // The sheet says "Vacation Leave", "Sick Leave" ...; the short names people use ("Vacation", "Sick") map to the same codes.
  var LEAVE_TYPES = list([
    ['VACATION', 'Vacation Leave'], ['SICK', 'Sick Leave'], ['EMERGENCY', 'Emergency Leave'], ['BIRTHDAY', 'Birthday Leave'],
    ['MATERNITY_PATERNITY', 'Maternity / Paternity Leave'], ['LWOP', 'Leave Without Pay'], ['OTHER', 'Other']]);

  function has(l, code) { return l.some(function (x) { return x.code === code; }); }
  function labelOf(l, code) { var f = l.filter(function (x) { return x.code === code; })[0]; return f ? f.label : (code || ''); }
  function norm(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }
  function isBlank(v) { return v === '' || v == null; }

  // ------------------------------------------------------------------ dates and times
  function parseDate(v) {
    if (isBlank(v)) return null;
    var s = String(v).trim(), m, y, mo, d;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else return null;
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return t.toISOString().slice(0, 10);
  }
  // "08:05", "8:05", "8:05:30" and "8:05 AM" / "1:30 pm" -> "HH:mm". Anything else -> null.
  function parseTime(v) {
    if (isBlank(v)) return null;
    var m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(String(v).trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (mi > 59) return null;
    if (m[3]) { if (h < 1 || h > 12) return null; h = h % 12 + (/[Pp]/.test(m[3]) ? 12 : 0); }
    else if (h > 23) return null;
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }
  function addDays(iso, n) { var t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function monthRange(month) {
    var m = /^(\d{4})-(\d{2})$/.exec(month || ''); if (!m || +m[2] < 1 || +m[2] > 12) return null;
    var last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    return { from: month + '-01', to: month + '-' + (last < 10 ? '0' : '') + last };
  }
  function addMonths(month, n) {
    var m = /^(\d{4})-(\d{2})$/.exec(month), t = new Date(Date.UTC(+m[1], +m[2] - 1 + n, 1));
    return t.getUTCFullYear() + '-' + ('0' + (t.getUTCMonth() + 1)).slice(-2);
  }

  // ------------------------------------------------------------------ identity
  // identityJson = data/team-identity.json. Only names listed there resolve; nothing is
  // matched by similarity. Every entry says whether the link is CONFIRMED or PROPOSED.
  function createIdentity(identityJson) {
    var byName = {}, people = {}, order = [];
    ((identityJson && identityJson.people) || []).forEach(function (p) {
      people[p.person_id] = { person_id: p.person_id, canonical_name: p.names[0].name, names: p.names };
      order.push(p.person_id);
      p.names.forEach(function (n) { byName[norm(n.name)] = { person_id: p.person_id, canonical_name: p.names[0].name, matched_name: n.name, status: n.status }; });
    });
    return {
      resolve: function (name) { return byName[norm(name)] || null; },
      person: function (id) { return people[id] || null; },
      ids: function () { return order.slice(); }
    };
  }

  // ------------------------------------------------------------------ validation
  // record: {person, work_date, status, time_in, time_out, work_location, leave_type, remarks}
  // Returns {ok, errors:[{field,message}], value} with codes and HH:mm times normalised.
  function validateRecord(input) {
    var i = input || {}, errs = [], v = {};
    function bad(field, message) { errs.push({ field: field, message: message }); }
    v.person = isBlank(i.person) ? '' : String(i.person).trim().replace(/\s+/g, ' ');
    if (!v.person) bad('person', 'Choose a team member.');
    v.work_date = parseDate(i.work_date);
    if (!v.work_date) bad('work_date', isBlank(i.work_date) ? 'Date is required.' : 'Date must be a real date (yyyy-mm-dd or dd/mm/yyyy).');
    v.status = i.status;
    if (isBlank(v.status)) bad('status', 'Choose a status.');
    else if (!has(STATUSES, v.status)) bad('status', 'Unknown status.');
    v.time_in = parseTime(i.time_in); if (!isBlank(i.time_in) && !v.time_in) bad('time_in', 'Time In must be hh:mm (e.g. 08:05).');
    v.time_out = parseTime(i.time_out); if (!isBlank(i.time_out) && !v.time_out) bad('time_out', 'Time Out must be hh:mm (e.g. 17:00).');
    if (v.time_in && v.time_out && v.time_out < v.time_in) bad('time_out', 'Time Out cannot be earlier than Time In.');
    v.work_location = isBlank(i.work_location) ? null : i.work_location;
    if (v.work_location && !has(WORK_LOCATIONS, v.work_location)) bad('work_location', 'Unknown work location.');
    v.leave_type = isBlank(i.leave_type) ? null : i.leave_type;
    if (v.leave_type && !has(LEAVE_TYPES, v.leave_type)) bad('leave_type', 'Unknown leave type.');
    else if (v.leave_type && v.status !== 'ON_LEAVE') bad('leave_type', 'Leave Type only applies when Status is On Leave.');
    v.remarks = isBlank(i.remarks) ? '' : String(i.remarks).trim();
    if (v.remarks.length > 1000) bad('remarks', 'Remarks are limited to 1000 characters.');
    return { ok: !errs.length, errors: errs, value: v };
  }

  // ------------------------------------------------------------------ KRA calculation
  // The ONLY documented rule (README.md, pages/attendance.html) is:
  //   (Days Present - Lates - Absences) / Total Working Days x 100%
  // Nothing in either repository says how Half Day, On Leave, Rest Day, Holiday, Official Business or
  // Work From Home enter that formula, or whether a Late day is also a Present day. Those treatments below
  // are PROVISIONAL and are reported with every result; they are not an HRAD decision.
  var POLICY = {
    formula: '(Days Present - Lates - Absences) / Total Working Days x 100%',
    formula_source: 'README.md, pages/attendance.html',
    treatments: {
      PRESENT:           { working: true,  credit: 1,   late: false, absence: false, confirmed: true,  note: 'Present is a literal term of the formula.' },
      ABSENT:            { working: true,  credit: 0,   late: false, absence: true,  confirmed: true,  note: 'Absent is a literal term of the formula.' },
      LATE:              { working: true,  credit: 1,   late: true,  absence: false, confirmed: false, note: 'The formula subtracts Lates from Days Present, which implies a Late day is first counted as present. Not confirmed.' },
      HALF_DAY:          { working: true,  credit: 0.5, late: false, absence: false, confirmed: false, note: 'Half Day treatment is not documented. Provisional: a working day credited 0.5, not a late or absence.' },
      ON_LEAVE:          { working: false, credit: 0,   late: false, absence: false, confirmed: false, note: 'Leave treatment is not documented. Provisional: excluded from working days regardless of Leave Type.' },
      OFFICIAL_BUSINESS: { working: true,  credit: 1,   late: false, absence: false, confirmed: false, note: 'Official Business treatment is not documented. Provisional: counts as a full day present.' },
      WORK_FROM_HOME:    { working: true,  credit: 1,   late: false, absence: false, confirmed: false, note: 'Work From Home treatment is not documented. Provisional: counts as a full day present.' },
      REST_DAY:          { working: false, credit: 0,   late: false, absence: false, confirmed: false, note: 'Rest Day treatment is not documented. Provisional: not a working day.' },
      HOLIDAY:           { working: false, credit: 0,   late: false, absence: false, confirmed: false, note: 'Holiday treatment is not documented. Provisional: not a working day.' }
    }
  };

  function round2(x) { return Math.round(x * 100) / 100; }

  // records: [{status, ...}] for ONE person over the period. Records with an unknown status are ignored
  // here and reported by dataQuality(). Returns null ratings, never 0, when there are no working days.
  function computeKra(records, policy) {
    policy = policy || POLICY;
    var wd = 0, present = 0, lates = 0, absences = 0, counts = {}, used = {};
    (records || []).forEach(function (r) {
      var t = policy.treatments[r.status]; if (!t) return;
      counts[r.status] = (counts[r.status] || 0) + 1; used[r.status] = t;
      if (t.working) { wd++; present += t.credit; }
      if (t.late) lates++;
      if (t.absence) absences++;
    });
    var assumptions = Object.keys(used).filter(function (k) { return !used[k].confirmed; })
      .map(function (k) { return { status: k, note: used[k].note }; });
    var raw = wd ? (present - lates - absences) / wd * 100 : null;
    if (raw !== null && raw < 0) assumptions.push({ status: null, note: 'A negative result is floored at 0%. The formula does not say what to do; this is an assumption.' });
    return {
      records: (records || []).length, working_days: wd, days_present: present, lates: lates, absences: absences,
      status_counts: counts,
      raw_pct: raw === null ? null : round2(raw),
      rating_pct: raw === null ? null : round2(Math.max(0, raw)),
      provisional: assumptions.length > 0, assumptions: assumptions
    };
  }

  // ------------------------------------------------------------------ grouping and data quality
  // Groups records by canonical person so alias spellings can never create a second person.
  // Unresolvable names are kept apart (never merged, never dropped) and reported.
  function groupByPerson(records, identity) {
    var groups = {}, order = [];
    (records || []).forEach(function (r) {
      var res = identity.resolve(r.person), key = res ? res.person_id : 'unresolved:' + norm(r.person);
      if (!groups[key]) { groups[key] = { key: key, person_id: res ? res.person_id : null, name: res ? res.canonical_name : r.person, records: [], via_proposed_alias: false }; order.push(key); }
      if (res && res.status === 'PROPOSED') groups[key].via_proposed_alias = true;
      groups[key].records.push(r);
    });
    return order.map(function (k) { return groups[k]; });
  }

  // One row per person per day. If the sheet holds more than one, the FIRST row counts and the rest are
  // reported: that is an assumption, because the documented business rule has no tie-break.
  function dedupeByPersonDay(group) {
    var seen = {}, kept = [], dups = [];
    group.records.forEach(function (r) {
      var k = r.work_date;
      if (seen[k]) dups.push({ person: group.name, work_date: k, ignored: r }); else { seen[k] = true; kept.push(r); }
    });
    return { kept: kept, duplicates: dups };
  }

  // Monthly KRA for every person present in `records`, plus data-quality findings.
  // People with no records are NOT invented as zeros; callers list them as "no data".
  function kraMonthly(records, identity, policy) {
    var groups = groupByPerson(records, identity), out = [], issues = { duplicates: [], unresolved_names: [], proposed_alias_matches: [], invalid_status_rows: 0 };
    groups.forEach(function (g) {
      var d = dedupeByPersonDay(g);
      issues.duplicates = issues.duplicates.concat(d.duplicates);
      if (!g.person_id) issues.unresolved_names.push(g.name);
      if (g.via_proposed_alias) issues.proposed_alias_matches.push(g.name);
      var valid = d.kept.filter(function (r) { return !!(policy || POLICY).treatments[r.status]; });
      issues.invalid_status_rows += d.kept.length - valid.length;
      out.push(Object.assign({ person_id: g.person_id, name: g.name }, computeKra(valid, policy)));
    });
    out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return { results: out, issues: issues };
  }

  return {
    STATUSES: STATUSES, WORK_LOCATIONS: WORK_LOCATIONS, LEAVE_TYPES: LEAVE_TYPES, POLICY: POLICY,
    labelOf: labelOf, norm: norm, parseDate: parseDate, parseTime: parseTime, addDays: addDays, monthRange: monthRange, addMonths: addMonths,
    createIdentity: createIdentity, validateRecord: validateRecord, computeKra: computeKra,
    groupByPerson: groupByPerson, dedupeByPersonDay: dedupeByPersonDay, kraMonthly: kraMonthly
  };
});
