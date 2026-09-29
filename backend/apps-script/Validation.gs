/**
 * Server-side validation. Never trusts the client: every write goes through
 * validateActivity_() with the full merged record.
 */

var ID_PATTERN_ = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;
var REF_ID_PATTERN_ = /^[A-Z0-9_]{1,40}$/;

function fail_(code, message, details) {
  var e = new Error(message);
  e.code = code;
  e.details = details || null;
  return e;
}

function isBlank_(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Strict YYYY-MM-DD that is also a real calendar date (rejects 2026-02-30). */
function isIsoDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function statusCodes_() { return ACTIVITY_STATUSES.map(function (s) { return s.code; }); }
function statusDef_(code) {
  for (var i = 0; i < ACTIVITY_STATUSES.length; i++) if (ACTIVITY_STATUSES[i].code === code) return ACTIVITY_STATUSES[i];
  return null;
}

/** Coerce one raw input value to its column type; returns {value} or {error}. */
function coerce_(col, raw) {
  if (isBlank_(raw)) return { value: '' };
  switch (col.type) {
    case 'date':
      return isIsoDate_(String(raw).trim()) ? { value: String(raw).trim() } : { error: 'must be a valid date in YYYY-MM-DD format' };
    case 'int':
      var n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return (isFinite(n) && Math.floor(n) === n) ? { value: n } : { error: 'must be a whole number' };
    case 'number':
      var f = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return isFinite(f) ? { value: f } : { error: 'must be a number' };
    default:
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'must be text' };
      var t = String(raw).trim();
      if (col.max && t.length > col.max) return { error: 'must be at most ' + col.max + ' characters' };
      return { value: t };
  }
}

/**
 * Validates a FULL activity record (post-merge). `refs` = {PERSON:{id:label},...}
 * Returns {record, errors:[{field,message}]}. Does not check ID uniqueness
 * (that needs the repository, done in the service under the lock).
 */
function validateActivity_(input, refs) {
  var errors = [], rec = {};
  ACTIVITY_COLUMNS.forEach(function (col) {
    if (col.mutable === false) { rec[col.name] = isBlank_(input[col.name]) ? '' : input[col.name]; return; }
    var r = coerce_(col, input[col.name]);
    if (r.error) { errors.push({ field: col.name, message: col.name + ' ' + r.error }); rec[col.name] = ''; return; }
    rec[col.name] = r.value;
  });
  function err(field, msg) { errors.push({ field: field, message: msg }); }
  function has(f) { return !errors.some(function (e) { return e.field === f; }); }

  ACTIVITY_COLUMNS.forEach(function (col) {
    if (col.required && isBlank_(rec[col.name]) && has(col.name)) err(col.name, col.name + ' is required');
  });

  if (has('status') && rec.status !== '') {
    rec.status = String(rec.status).toUpperCase();
    if (statusCodes_().indexOf(rec.status) < 0) err('status', 'status must be one of: ' + statusCodes_().join(', '));
  }
  if (has('priority') && rec.priority !== '') {
    rec.priority = String(rec.priority).toUpperCase();
    if (ACTIVITY_PRIORITIES.indexOf(rec.priority) < 0) err('priority', 'priority must be one of: ' + ACTIVITY_PRIORITIES.join(', '));
  }
  if (has('progress_percent') && rec.progress_percent !== '' && (rec.progress_percent < 0 || rec.progress_percent > 100)) {
    err('progress_percent', 'progress_percent must be between 0 and 100');
  }
  if (rec.progress_percent === '' ) rec.progress_percent = 0;

  // Reference integrity: IDs must exist (and be active) in ACTIVITY_REF.
  ACTIVITY_COLUMNS.forEach(function (col) {
    if (!col.ref || isBlank_(rec[col.name]) || !has(col.name)) return;
    var bucket = refs[col.ref] || {};
    if (!Object.prototype.hasOwnProperty.call(bucket, rec[col.name])) {
      err(col.name, col.name + ' "' + rec[col.name] + '" is not a known ' + col.ref + ' id');
    }
  });

  if (!isBlank_(rec.evidence_url) && has('evidence_url') && !/^https?:\/\/[^\s]+$/i.test(rec.evidence_url)) {
    err('evidence_url', 'evidence_url must be an http(s) link');
  }

  // Cross-field date rules.
  if (rec.start_date && rec.due_date && has('start_date') && has('due_date') && rec.due_date < rec.start_date) {
    err('due_date', 'due_date cannot be earlier than start_date');
  }
  if (rec.start_date && rec.completed_date && has('start_date') && has('completed_date') && rec.completed_date < rec.start_date) {
    err('completed_date', 'completed_date cannot be earlier than start_date');
  }
  if (rec.completed_date && rec.status && rec.status !== 'COMPLETED') {
    err('completed_date', 'completed_date can only be set when status is COMPLETED');
  }
  return { record: rec, errors: errors };
}

function throwIfInvalid_(result) {
  if (result.errors.length) {
    throw fail_('VALIDATION_ERROR', result.errors[0].message + (result.errors.length > 1 ? ' (+' + (result.errors.length - 1) + ' more)' : ''), result.errors);
  }
}
