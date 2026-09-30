/** Server-side validation. Authoritative: the browser validates too, but nothing is trusted. */

function attFail_(code, message, details) { var e = new Error(message); e.code = code; e.details = details || null; return e; }
function attBlank_(v) { return v === '' || v === null || v === undefined; }
function attNorm_(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }
function attPad_(n) { return (n < 10 ? '0' : '') + n; }

function attParseDate_(v) {
  if (attBlank_(v)) return null;
  var s = String(v).trim(), m, y, mo, d;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  var t = new Date(Date.UTC(y, mo - 1, d));
  return (t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) ? y + '-' + attPad_(mo) + '-' + attPad_(d) : null;
}

function attParseTime_(v) {
  if (attBlank_(v)) return null;
  var m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(String(v).trim());
  if (!m) return null;
  var h = +m[1], mi = +m[2];
  if (mi > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; h = h % 12 + (/[Pp]/.test(m[3]) ? 12 : 0); }
  else if (h > 23) return null;
  return attPad_(h) + ':' + attPad_(mi);
}

function attEnumCode_(name, value) {
  if (attBlank_(value)) return null;
  var l = attNorm_(value), list = ATT_ENUMS[name];
  for (var i = 0; i < list.length; i++) if (attNorm_(list[i][1]) === l || attNorm_(list[i][0]) === l) return list[i][0];
  var al = ATT_ENUM_ALIASES[name];
  if (al && Object.prototype.hasOwnProperty.call(al, l)) return al[l];
  return null;
}
function attEnumLabel_(name, code) {
  var list = ATT_ENUMS[name];
  for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i][1];
  throw attFail_('VALIDATION_ERROR', 'Unknown ' + name + ': ' + code);
}

/** Returns the cleaned record (codes, HH:mm times, ISO date) or throws VALIDATION_ERROR with details [{field,message}]. */
function attValidateRecord_(input) {
  var i = input || {}, errs = [], v = {};
  function bad(f, m) { errs.push({ field: f, message: m }); }
  v.person = attBlank_(i.person) ? '' : String(i.person).trim().replace(/\s+/g, ' ');
  if (!v.person) bad('person', 'Choose a team member.');
  v.work_date = attParseDate_(i.work_date);
  if (!v.work_date) bad('work_date', attBlank_(i.work_date) ? 'Date is required.' : 'Date must be a real date (yyyy-mm-dd or dd/mm/yyyy).');
  v.status = i.status;
  if (attBlank_(v.status)) bad('status', 'Choose a status.'); else if (!attEnumCode_('status', v.status) || attEnumCode_('status', v.status) !== v.status) bad('status', 'Unknown status.');
  v.time_in = attParseTime_(i.time_in); if (!attBlank_(i.time_in) && !v.time_in) bad('time_in', 'Time In must be hh:mm (e.g. 08:05).');
  v.time_out = attParseTime_(i.time_out); if (!attBlank_(i.time_out) && !v.time_out) bad('time_out', 'Time Out must be hh:mm (e.g. 17:00).');
  if (v.time_in && v.time_out && v.time_out < v.time_in) bad('time_out', 'Time Out cannot be earlier than Time In.');
  v.work_location = attBlank_(i.work_location) ? null : i.work_location;
  if (v.work_location && attEnumCode_('work_location', v.work_location) !== v.work_location) bad('work_location', 'Unknown work location.');
  v.leave_type = attBlank_(i.leave_type) ? null : i.leave_type;
  if (v.leave_type && attEnumCode_('leave_type', v.leave_type) !== v.leave_type) bad('leave_type', 'Unknown leave type.');
  else if (v.leave_type && v.status !== 'ON_LEAVE') bad('leave_type', 'Leave Type only applies when Status is On Leave.');
  v.remarks = attBlank_(i.remarks) ? '' : String(i.remarks).trim();
  if (v.remarks.length > 1000) bad('remarks', 'Remarks are limited to 1000 characters.');
  if (errs.length) throw attFail_('VALIDATION_ERROR', 'Some fields are not valid.', errs);
  return v;
}
