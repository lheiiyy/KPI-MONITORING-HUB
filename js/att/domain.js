// Domain rules for scheduling and attendance. No I/O, no DOM: shared by the UI,
// the service, the adapters and the tests. Codes mirror the reference tables in
// TddProjectai/database/migrations/014_attendance_scheduling.sql; labels are the
// exact text the pilot Google Sheets use in their LISTS tabs.
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.ATT = root.ATT || {}; root.ATT.domain = m; }
})(typeof self !== 'undefined' ? self : this, function () {
  function opts(list) { return list.map(function (x) { return { code: x[0], label: x[1] }; }); }

  var SESSION_STATUSES = opts([['PLANNED', 'Planned'], ['CONDUCTED', 'Conducted'], ['POSTPONED', 'Postponed'], ['CANCELLED', 'Cancelled']]);
  // Planned -> Conducted is the main path. Postponed sessions can be re-planned.
  // Conducted and Cancelled are final.
  var TRANSITIONS = { PLANNED: ['CONDUCTED', 'POSTPONED', 'CANCELLED'], POSTPONED: ['PLANNED', 'CANCELLED'], CONDUCTED: [], CANCELLED: [] };

  // KRA flags are defaults pending HRAD confirmation (see the SQL COMMENT on the ref table).
  var FAC_STATUSES = [
    { code: 'PRESENT', label: 'Present', workingDay: true, credit: 1, late: false, absence: false },
    { code: 'LATE', label: 'Late', workingDay: true, credit: 1, late: true, absence: false },
    { code: 'HALF_DAY', label: 'Half Day', workingDay: true, credit: 0.5, late: false, absence: false },
    { code: 'ABSENT', label: 'Absent', workingDay: true, credit: 0, late: false, absence: true },
    { code: 'ON_LEAVE', label: 'On Leave', workingDay: false, credit: 0, late: false, absence: false },
    { code: 'OFFICIAL_BUSINESS', label: 'Official Business / Field', workingDay: true, credit: 1, late: false, absence: false },
    { code: 'WORK_FROM_HOME', label: 'Work From Home', workingDay: true, credit: 1, late: false, absence: false },
    { code: 'REST_DAY', label: 'Rest Day / Day Off', workingDay: false, credit: 0, late: false, absence: false },
    { code: 'HOLIDAY', label: 'Holiday', workingDay: false, credit: 0, late: false, absence: false }
  ];
  var WORK_LOCATIONS = opts([['HEAD_OFFICE', 'Head Office'], ['TRAINING_ROOM', 'Training Room'], ['STORE_VISIT_FIELD', 'Store Visit / Field'], ['COMMISSARY', 'Commissary'], ['OTHER', 'Other']]);
  var LEAVE_TYPES = opts([['VACATION', 'Vacation Leave'], ['SICK', 'Sick Leave'], ['EMERGENCY', 'Emergency Leave'], ['BIRTHDAY', 'Birthday Leave'], ['MATERNITY_PATERNITY', 'Maternity / Paternity Leave'], ['LWOP', 'Leave Without Pay'], ['OTHER', 'Other']]);
  var BRANDS = opts([['ANGELS_PIZZA', "Angel's Pizza"], ['ANGELS_PIZZA_EXPRESS', "Angel's Pizza Express"], ['FIGARO', 'Figaro'], ['TIEN_MAS', "Tien Ma's"], ['KOOBIDEH_KEBAB', 'Koobideh Kebab'], ['MULTI_BRAND', 'Multi-brand']]);
  var TRAINING_TYPES = opts([['ORIENTATION', 'Orientation'], ['REFRESHER', 'Refresher'], ['TLTC', 'TLTC (Team Leader Training & Certification)'], ['SEMINAR_WORKSHOP', 'Seminar / Workshop'], ['TECHNICAL_VALIDATION', 'Technical Validation'], ['BARISTA_COFFEE_BAR', 'Barista / Coffee Bar'], ['SERVICE_STEPS', 'Service Steps'], ['RIDER_REFRESHER', 'Rider Refresher'], ['COACHING_CORRECTIVE', 'Coaching / Corrective Action'], ['TRAIN_THE_TRAINER', 'Train-the-Trainer'], ['OTHER', 'Other']]);

  function has(list, code) { return list.some(function (x) { return x.code === code; }); }
  function labelOf(list, code) { var f = list.filter(function (x) { return x.code === code; })[0]; return f ? f.label : (code || ''); }
  function codeOf(list, label) {
    var l = String(label == null ? '' : label).trim().toLowerCase();
    var f = list.filter(function (x) { return x.label.toLowerCase() === l || x.code.toLowerCase() === l; })[0];
    return f ? f.code : null;
  }
  function facStatus(code) { return FAC_STATUSES.filter(function (s) { return s.code === code; })[0] || null; }

  function canTransition(from, to) { return (TRANSITIONS[from] || []).indexOf(to) >= 0; }

  // "Ricelle  Lim " -> "ricelle lim"; identity matching only, never displayed.
  function normName(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }

  // Accepts ISO yyyy-mm-dd or the sheet's dd/mm/yyyy; returns ISO or null.
  function parseDate(v) {
    if (v == null || v === '') return null;
    var s = String(v).trim(), m, y, mo, d;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else return null;
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return t.toISOString().slice(0, 10);
  }
  // Accepts h:mm or hh:mm (24h); returns zero-padded "hh:mm" or null.
  function parseTime(v) {
    if (v == null || v === '') return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return (m[1].length < 2 ? '0' : '') + m[1] + ':' + m[2];
  }
  function numOrNull(v) { if (v === '' || v == null) return null; var n = Number(v); return isFinite(n) ? n : NaN; }
  function str(v) { return v == null ? '' : String(v).trim(); }

  // ---- validators: return {ok, errors:[..], value} ------------------------------------------
  // `partial` (updates) only validates the keys that are present.
  function validateSession(input, partial) {
    var e = [], v = {}, i = input || {};
    function want(k) { return !partial || Object.prototype.hasOwnProperty.call(i, k); }
    if (want('program')) { v.program = str(i.program); if (!v.program) e.push('Program / Module is required.'); }
    if (want('date')) {
      if (i.date === '' || i.date == null) v.date = null;
      else { v.date = parseDate(i.date); if (!v.date) e.push('Date must be a valid date (yyyy-mm-dd or dd/mm/yyyy).'); }
    }
    if (want('trainingType')) { v.trainingType = i.trainingType || null; if (v.trainingType && !has(TRAINING_TYPES, v.trainingType)) e.push('Unknown training type.'); }
    if (want('brand')) { v.brand = i.brand || null; if (v.brand && !has(BRANDS, v.brand)) e.push('Unknown brand.'); }
    if (want('venue')) v.venue = str(i.venue);
    if (want('remarks')) v.remarks = str(i.remarks);
    ['targetPax', 'actualPax'].forEach(function (k) {
      if (!want(k)) return;
      var n = numOrNull(i[k]);
      if (n !== null && (isNaN(n) || n < 0 || Math.floor(n) !== n)) e.push((k === 'targetPax' ? 'Target' : 'Actual') + ' Pax must be a whole number, 0 or more.');
      else v[k] = n;
    });
    if (want('durationHrs')) { var d = numOrNull(i.durationHrs); if (d !== null && (isNaN(d) || d < 0)) e.push('Duration must be 0 or more.'); else v.durationHrs = d; }
    if (want('postTestAvg')) { var p = numOrNull(i.postTestAvg); if (p !== null && (isNaN(p) || p < 0 || p > 100)) e.push('Post-Test Avg must be between 0 and 100.'); else v.postTestAvg = p; }
    if (want('status')) { v.status = i.status || 'PLANNED'; if (!has(SESSION_STATUSES, v.status)) e.push('Unknown session status.'); }
    if (want('facilitators')) v.facilitators = (i.facilitators || []).map(str).filter(Boolean);
    if (!partial && v.status === 'CONDUCTED' && !v.date) e.push('A Conducted session needs a date.');
    return { ok: !e.length, errors: e, value: v };
  }

  function validateFacilitatorAttendance(input) {
    var e = [], i = input || {}, v = {};
    v.person = str(i.person); if (!v.person) e.push('Team member is required.');
    v.date = parseDate(i.date); if (!v.date) e.push('Date is required.');
    v.status = i.status; if (!facStatus(v.status)) e.push('Status is required.');
    v.timeIn = parseTime(i.timeIn); if (i.timeIn && !v.timeIn) e.push('Time In must be hh:mm.');
    v.timeOut = parseTime(i.timeOut); if (i.timeOut && !v.timeOut) e.push('Time Out must be hh:mm.');
    if (v.timeIn && v.timeOut && v.timeOut < v.timeIn) e.push('Time Out cannot be before Time In.');
    v.workLocation = i.workLocation || null; if (v.workLocation && !has(WORK_LOCATIONS, v.workLocation)) e.push('Unknown work location.');
    v.leaveType = i.leaveType || null;
    if (v.leaveType && !has(LEAVE_TYPES, v.leaveType)) e.push('Unknown leave type.');
    else if (v.leaveType && v.status !== 'ON_LEAVE') e.push('Leave Type is only allowed when Status is On Leave.');
    v.remarks = str(i.remarks);
    return { ok: !e.length, errors: e, value: v };
  }

  // Attendance KRA for one person over the given daily rows:
  //   (days present - lates - absences) / working days, floored at 0; null if no working days.
  function computeKra(rows) {
    var wd = 0, present = 0, lates = 0, absences = 0, leave = 0;
    rows.forEach(function (r) {
      var s = facStatus(r.status); if (!s) return;
      if (s.workingDay) { wd++; present += s.credit; }
      if (s.late) lates++;
      if (s.absence) absences++;
      if (r.status === 'ON_LEAVE') leave++;
    });
    var pct = wd ? Math.round(Math.max(0, (present - lates - absences) / wd) * 10000) / 100 : null;
    return { workingDays: wd, daysPresent: present, lates: lates, absences: absences, leaveDays: leave, ratingPct: pct };
  }

  // ---- Training delivery reporting ----------------------------------------------------------
  // Everything here is derived from session records; nothing is stored or hard-coded.
  // The hub's Training Program Delivery page states: "Programs Delivered / Programs Required x 100%"
  // with target "at least 2 programs per month". That target is the only number below, and it is
  // a parameter (defaults pending HRAD confirmation, like the attendance flags).
  var TARGET_PROGRAMS_PER_MONTH = 2;

  function todayISO(d) { d = d || new Date(); function p(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function round2(n) { return Math.round(n * 100) / 100; }

  // Years present in the data plus the current year: never a constant, so 2027+ needs no code change.
  function sessionYears(sessions, today) {
    var seen = {}; seen[(today || todayISO()).slice(0, 4)] = true;
    (sessions || []).forEach(function (s) { if (s.date) seen[s.date.slice(0, 4)] = true; });
    return Object.keys(seen).sort().reverse();
  }

  // Months of the period that count towards "programs required" (0 => no requirement yet).
  function monthsInPeriod(year, month, today) {
    if (!year) return null;
    if (month) return 1;
    var cy = +today.slice(0, 4), cm = +today.slice(5, 7);
    if (+year < cy) return 12; if (+year === cy) return cm; return 0;
  }

  // opts: { year:'2026'|'', month:'01'..'12'|'', today:'yyyy-mm-dd', roster:[names], targetPerMonth }
  function summarizeDelivery(sessions, opts) {
    opts = opts || {}; sessions = sessions || [];
    var today = opts.today || todayISO(), year = opts.year || '', month = opts.month || '';
    var perMonth = opts.targetPerMonth == null ? TARGET_PROGRAMS_PER_MONTH : opts.targetPerMonth;
    var roster = opts.roster || [], rosterIdx = {};
    roster.forEach(function (n) { rosterIdx[normName(n)] = n; });

    var undated = sessions.filter(function (s) { return !s.date; }).length;
    var rows = sessions.filter(function (s) {
      if (!year && !month) return true;
      if (!s.date) return false;
      return (!year || s.date.slice(0, 4) === year) && (!month || s.date.slice(5, 7) === month);
    });
    var by = { PLANNED: 0, CONDUCTED: 0, POSTPONED: 0, CANCELLED: 0 };
    rows.forEach(function (s) { if (s.status in by) by[s.status]++; });

    // "Due" = should have been delivered by now: Conducted, or not cancelled and dated today or earlier.
    var due = rows.filter(function (s) { return s.status !== 'CANCELLED' && (s.status === 'CONDUCTED' || (s.date && s.date <= today)); });
    var overdue = due.filter(function (s) { return s.status !== 'CONDUCTED'; }).length;
    var upcoming = rows.filter(function (s) { return s.status === 'PLANNED' && s.date && s.date > today; }).length;

    var conducted = rows.filter(function (s) { return s.status === 'CONDUCTED'; });
    var targetPax = 0, targetPaxN = 0;
    rows.forEach(function (s) { if (s.status !== 'CANCELLED' && isNum(s.targetPax)) { targetPax += s.targetPax; targetPaxN++; } });
    var actualPax = 0, actualPaxN = 0, fillA = 0, fillT = 0, hours = 0, hoursN = 0, ptSum = 0, ptN = 0;
    conducted.forEach(function (s) {
      if (isNum(s.actualPax)) { actualPax += s.actualPax; actualPaxN++; if (isNum(s.targetPax) && s.targetPax > 0) { fillA += s.actualPax; fillT += s.targetPax; } }
      if (isNum(s.durationHrs)) { hours += s.durationHrs; hoursN++; }
      if (isNum(s.postTestAvg)) { ptSum += s.postTestAvg; ptN++; }
    });

    var months = monthsInPeriod(year, month, today), required = months == null ? null : perMonth * months;
    var facMap = {};
    rows.forEach(function (s) {
      (s.facilitators || []).forEach(function (n) {
        var k = normName(n); if (!k) return;
        var f = facMap[k] || (facMap[k] = { name: rosterIdx[k] || n, onRoster: !!rosterIdx[k], planned: 0, conducted: 0, postponed: 0, cancelled: 0, actualPax: 0 });
        f[s.status.toLowerCase()]++;
        if (s.status === 'CONDUCTED' && isNum(s.actualPax)) f.actualPax += s.actualPax;
      });
    });
    var facilitators = Object.keys(facMap).sort().map(function (k) {
      var f = facMap[k];
      f.required = required;
      f.ratingPct = required ? round2(Math.min(f.conducted / required, 1) * 100) : null;   // capped at 100%, as kpi.js does
      return f;
    });
    var withSessions = {}; Object.keys(facMap).forEach(function (k) { withSessions[k] = 1; });

    return {
      period: { year: year, month: month, today: today },
      hasData: rows.length > 0,
      total: rows.length, undated: undated,
      byStatus: by,
      due: due.length, overdue: overdue, upcoming: upcoming,
      deliveryRatePct: due.length ? round2(conducted.length / due.length * 100) : null,   // null = nothing was due, not 0%
      targetPax: targetPaxN ? targetPax : null,
      actualPax: actualPaxN ? actualPax : null,
      paxFillPct: fillT ? round2(fillA / fillT * 100) : null,
      hoursConducted: hoursN ? hours : null,
      postTest: { avgPct: ptN ? round2(ptSum / ptN) : null, sessions: ptN },               // unweighted mean of session averages
      programsRequiredPerFacilitator: required,
      targetPerMonth: perMonth,
      facilitators: facilitators,
      rosterWithoutSessions: roster.filter(function (n) { return !withSessions[normName(n)]; })
    };
  }

  return {
    SESSION_STATUSES: SESSION_STATUSES, TRANSITIONS: TRANSITIONS, FAC_STATUSES: FAC_STATUSES, WORK_LOCATIONS: WORK_LOCATIONS,
    LEAVE_TYPES: LEAVE_TYPES, BRANDS: BRANDS, TRAINING_TYPES: TRAINING_TYPES,
    labelOf: labelOf, codeOf: codeOf, facStatus: facStatus, canTransition: canTransition, normName: normName,
    parseDate: parseDate, parseTime: parseTime,
    TARGET_PROGRAMS_PER_MONTH: TARGET_PROGRAMS_PER_MONTH, todayISO: todayISO, sessionYears: sessionYears, summarizeDelivery: summarizeDelivery,
    validateSession: validateSession, validateFacilitatorAttendance: validateFacilitatorAttendance, computeKra: computeKra
  };
});
