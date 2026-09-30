/**
 * KPI Monitoring Hub - Attendance & Scheduling API (pilot backend over Google Sheets).
 *
 * Deploy as a Web app: Execute as "Me", access "Anyone". See apps-script/README.md.
 * The browser sends POST {token, action, params, actor} as text/plain (no CORS preflight).
 *
 * This file is the ONLY place that knows the spreadsheet layout. Columns are found by
 * header text in row 1, so reordering columns is safe; renaming a header is not (the API
 * returns a clear SERVER error naming the missing header). When the data moves to
 * PostgreSQL, this file is replaced by an adapter with the same actions; the hub's UI and
 * service layer do not change.
 *
 * Script properties: API_TOKEN (required; without it every call is refused) and optionally
 * SESSIONS_SHEET_ID / FACILITATOR_ATT_SHEET_ID (defaults below).
 *
 * Scope: the training schedule (SESSION_LOG) and the daily attendance of facilitators /
 * trainers / T&D team members. Trainee (participant) attendance is out of scope.
 */

var DEFAULT_IDS = {
  SESSIONS_SHEET_ID: '1mp4-6KHcX5iDB5Oto1Smjfyq-xW4KAZCC8CA09hhpB4',       // Training Program & Delivery Monitoring 2026
  FACILITATOR_ATT_SHEET_ID: '1mRlptbGDu-KeCt2PdaxPfMjlidmRaw2TFr-J0pqjsGc'  // TDD Team Attendance Monitoring 2026
};

// code / label pairs. Labels are the exact text in the sheets' LISTS tabs. Must stay equal
// to js/att/domain.js (a test enforces it).
var ENUMS = {
  sessionStatus: [['PLANNED', 'Planned'], ['CONDUCTED', 'Conducted'], ['POSTPONED', 'Postponed'], ['CANCELLED', 'Cancelled']],
  facStatus: [['PRESENT', 'Present'], ['LATE', 'Late'], ['HALF_DAY', 'Half Day'], ['ABSENT', 'Absent'], ['ON_LEAVE', 'On Leave'], ['OFFICIAL_BUSINESS', 'Official Business / Field'], ['WORK_FROM_HOME', 'Work From Home'], ['REST_DAY', 'Rest Day / Day Off'], ['HOLIDAY', 'Holiday']],
  workLocation: [['HEAD_OFFICE', 'Head Office'], ['TRAINING_ROOM', 'Training Room'], ['STORE_VISIT_FIELD', 'Store Visit / Field'], ['COMMISSARY', 'Commissary'], ['OTHER', 'Other']],
  leaveType: [['VACATION', 'Vacation Leave'], ['SICK', 'Sick Leave'], ['EMERGENCY', 'Emergency Leave'], ['BIRTHDAY', 'Birthday Leave'], ['MATERNITY_PATERNITY', 'Maternity / Paternity Leave'], ['LWOP', 'Leave Without Pay'], ['OTHER', 'Other']],
  brand: [['ANGELS_PIZZA', "Angel's Pizza"], ['ANGELS_PIZZA_EXPRESS', "Angel's Pizza Express"], ['FIGARO', 'Figaro'], ['TIEN_MAS', "Tien Ma's"], ['KOOBIDEH_KEBAB', 'Koobideh Kebab'], ['MULTI_BRAND', 'Multi-brand']],
  trainingType: [['ORIENTATION', 'Orientation'], ['REFRESHER', 'Refresher'], ['TLTC', 'TLTC (Team Leader Training & Certification)'], ['SEMINAR_WORKSHOP', 'Seminar / Workshop'], ['TECHNICAL_VALIDATION', 'Technical Validation'], ['BARISTA_COFFEE_BAR', 'Barista / Coffee Bar'], ['SERVICE_STEPS', 'Service Steps'], ['RIDER_REFRESHER', 'Rider Refresher'], ['COACHING_CORRECTIVE', 'Coaching / Corrective Action'], ['TRAIN_THE_TRAINER', 'Train-the-Trainer'], ['OTHER', 'Other']]
};
var TRANSITIONS = { PLANNED: ['CONDUCTED', 'POSTPONED', 'CANCELLED'], POSTPONED: ['PLANNED', 'CANCELLED'], CONDUCTED: [], CANCELLED: [] };

// [field, header in row 1, type, enum]
var SCHEMAS = {
  session: { idKey: 'SESSIONS_SHEET_ID', tab: 'SESSION_LOG', cols: [
    ['id', 'Session ID', 'text'], ['date', 'Date', 'date'], ['program', 'Program / Module', 'text'],
    ['trainingType', 'Training Type', 'enum', 'trainingType'], ['brand', 'Brand', 'enum', 'brand'], ['venue', 'Store / Venue', 'text'],
    ['facilitators', 'Facilitator(s)', 'list'], ['targetPax', 'Target Pax', 'int'], ['actualPax', 'Actual Pax', 'int'],
    ['durationHrs', 'Duration (hrs)', 'num'], ['status', 'Status', 'enum', 'sessionStatus'], ['postTestAvg', 'Post-Test Avg (%)', 'num'], ['remarks', 'Remarks', 'text']] },
  fac: { idKey: 'FACILITATOR_ATT_SHEET_ID', tab: 'ATTENDANCE_LOG', cols: [
    ['date', 'Date', 'date'], ['person', 'Team Member', 'text'], ['position', 'Position', 'text'], ['status', 'Status', 'enum', 'facStatus'],
    ['timeIn', 'Time In', 'time'], ['timeOut', 'Time Out', 'time'], ['workLocation', 'Work Location / Assignment', 'enum', 'workLocation'],
    ['leaveType', 'Leave Type', 'enum', 'leaveType'], ['remarks', 'Remarks', 'text']] }
};

// ------------------------------------------------------------------ entry points
function doGet() { return out_({ ok: true, data: { service: 'kpi-attendance-api', protocol: 1 } }); }

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return out_(err_('VALIDATION', 'Request body must be JSON.')); }
  var expected = prop_('API_TOKEN');
  if (!expected || !body || body.token !== expected) return out_(err_('AUTH', 'Not authorised.')); // fail closed
  var fn = ACTIONS[body.action];
  if (!fn) return out_(err_('VALIDATION', 'Unknown action: ' + body.action));
  var isWrite = WRITES[body.action] === true, lock = null;
  try {
    if (isWrite) { lock = LockService.getScriptLock(); lock.waitLock(20000); }
    var data = fn(body.params || {}, String(body.actor || '').slice(0, 80));
    return out_({ ok: true, data: data });
  } catch (x) {
    if (x && x.attCode) return out_(err_(x.attCode, x.message));
    return out_(err_('SERVER', 'Unexpected server error: ' + (x && x.message ? x.message : x)));
  } finally { if (lock) lock.releaseLock(); }
}

var ACTIONS = {
  ping: function () { return { ok: true }; },
  getReference: getReference_,
  listSessions: listSessions_, getSession: getSession_, createSession: createSession_, updateSession: updateSession_,
  listFacilitatorAttendance: listFac_, upsertFacilitatorAttendance: upsertFac_, deleteFacilitatorAttendance: deleteFac_
};
var WRITES = { createSession: true, updateSession: true, upsertFacilitatorAttendance: true, deleteFacilitatorAttendance: true };

// ------------------------------------------------------------------ helpers
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, message) { return { ok: false, error: { code: code, message: message } }; }
function fail_(code, message) { var e = new Error(message); e.attCode = code; throw e; }
function prop_(k) { var v = PropertiesService.getScriptProperties().getProperty(k); return v || DEFAULT_IDS[k] || ''; }
function norm_(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }
function blank_(v) { return v === '' || v == null; }
function pad_(n) { return (n < 10 ? '0' : '') + n; }

function enumCode_(name, label) {
  if (blank_(label)) return null;
  var l = norm_(label), list = ENUMS[name];
  for (var i = 0; i < list.length; i++) if (norm_(list[i][1]) === l || norm_(list[i][0]) === l) return list[i][0];
  return null;
}
function enumLabel_(name, code) {
  if (blank_(code)) return '';
  var list = ENUMS[name];
  for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i][1];
  fail_('VALIDATION', 'Unknown ' + name + ' code: ' + code);
}

function ss_(schema) {
  var id = prop_(schema.idKey);
  if (!id) fail_('SERVER', 'Spreadsheet id for ' + schema.idKey + ' is not configured.');
  return SpreadsheetApp.openById(id);
}

// Read a tab: { sheet, tz, colOf: field->0-based column, width, rows:[{n: sheetRow, v: [values]}] }
function table_(key) {
  var schema = SCHEMAS[key], book = ss_(schema), sheet = book.getSheetByName(schema.tab);
  if (!sheet) fail_('SERVER', 'Tab "' + schema.tab + '" not found in the spreadsheet.');
  var lastCol = Math.max(sheet.getLastColumn(), 1), lastRow = Math.max(sheet.getLastRow(), 1);
  var vals = sheet.getRange(1, 1, lastRow, lastCol).getValues(), heads = vals[0].map(norm_), colOf = {};
  schema.cols.forEach(function (c) {
    var i = heads.indexOf(norm_(c[1]));
    if (i < 0) fail_('SERVER', 'Header "' + c[1] + '" not found in tab ' + schema.tab + ' (row 1).');
    colOf[c[0]] = i;
  });
  var rows = [];
  for (var r = 1; r < vals.length; r++) rows.push({ n: r + 1, v: vals[r] });
  return { key: key, schema: schema, book: book, sheet: sheet, tz: book.getSpreadsheetTimeZone(), colOf: colOf, width: lastCol, rows: rows };
}

function readCell_(t, type, enumName, raw) {
  if (blank_(raw)) return type === 'list' ? [] : null;
  switch (type) {
    case 'text': return String(raw).trim();
    case 'date':
      if (Object.prototype.toString.call(raw) === '[object Date]') return Utilities.formatDate(raw, t.tz, 'yyyy-MM-dd');
      return parseDate_(raw);
    case 'time':
      if (Object.prototype.toString.call(raw) === '[object Date]') return Utilities.formatDate(raw, t.tz, 'HH:mm');
      return parseTime_(raw);
    case 'int': case 'num': var n = Number(raw); return isFinite(n) ? n : null;
    case 'enum': return enumCode_(enumName, raw);
    case 'list': return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  return raw;
}

function parseDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim()), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim()))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  var t = new Date(Date.UTC(y, mo - 1, d));
  return (t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d) ? y + '-' + pad_(mo) + '-' + pad_(d) : null;
}
function parseTime_(s) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(s).trim());
  return (m && +m[1] < 24 && +m[2] < 60) ? pad_(+m[1]) + ':' + m[2] : null;
}

function version_(obj) {
  var copy = {}; Object.keys(obj).forEach(function (k) { if (k !== 'version') copy[k] = obj[k]; });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(copy, Object.keys(copy).sort()))
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function toObject_(t, row) {
  var o = {};
  t.schema.cols.forEach(function (c) { o[c[0]] = readCell_(t, c[2], c[3], row.v[t.colOf[c[0]]]); });
  o.version = version_(o);
  return o;
}

// Write only this schema's columns into an existing row; columns it does not know are preserved.
function writeRow_(t, rowN, existingValues, obj) {
  var vals = existingValues ? existingValues.slice() : [];
  while (vals.length < t.width) vals.push('');
  t.schema.cols.forEach(function (c) {
    var f = c[0], type = c[2], v = obj[f], cell;
    if (!(f in obj)) return;
    if (blank_(v) || (type === 'list' && !v.length)) cell = '';
    else if (type === 'enum') cell = enumLabel_(c[3], v);
    else if (type === 'list') cell = v.join(', ');
    else if (type === 'date') { var p = v.split('-'); cell = new Date(+p[0], +p[1] - 1, +p[2]); }
    else cell = v;
    vals[t.colOf[f]] = cell;
  });
  if (rowN) t.sheet.getRange(rowN, 1, 1, t.width).setValues([vals]);
  else { t.sheet.appendRow(vals); }
}

function audit_(actor, entity, id, action, before, after) {
  var book = ss_(SCHEMAS.session), tab = book.getSheetByName('AUDIT_LOG');
  if (!tab) { tab = book.insertSheet('AUDIT_LOG'); tab.appendRow(['Timestamp', 'Actor (client-supplied)', 'Entity', 'Entity ID', 'Action', 'Before', 'After']); }
  tab.appendRow([new Date(), actor || '', entity, id, action, before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '']);
}

function checkEnums_(o, key) {
  SCHEMAS[key].cols.forEach(function (c) {
    if (c[2] === 'enum' && !blank_(o[c[0]]) && !enumCode_(c[3], o[c[0]])) fail_('VALIDATION', 'Invalid ' + c[1] + ': ' + o[c[0]]);
    if (c[2] === 'date' && !blank_(o[c[0]]) && !parseDate_(o[c[0]])) fail_('VALIDATION', 'Invalid ' + c[1] + ': ' + o[c[0]]);
    if (c[2] === 'time' && !blank_(o[c[0]]) && !parseTime_(o[c[0]])) fail_('VALIDATION', 'Invalid ' + c[1] + ': ' + o[c[0]]);
  });
}

// ------------------------------------------------------------------ reference lists
function listColumn_(tab, header) {
  var vals = tab.getDataRange().getValues(), c = -1;
  for (var i = 0; i < vals[0].length; i++) if (norm_(vals[0][i]).indexOf(norm_(header)) === 0) { c = i; break; }
  if (c < 0) return [];
  var out = []; for (var r = 1; r < vals.length; r++) if (!blank_(vals[r][c])) out.push(String(vals[r][c]).trim());
  return out;
}
function getReference_() {
  var fb = ss_(SCHEMAS.fac).getSheetByName('LISTS'), sb = ss_(SCHEMAS.session).getSheetByName('LISTS');
  var members = fb ? listColumn_(fb, 'TEAM MEMBER') : [], pos = fb ? listColumn_(fb, 'POSITION') : [];
  return {
    teamMembers: members.map(function (n, i) { return { name: n, position: pos[i] || '' }; }),
    sessionFacilitators: sb ? listColumn_(sb, 'FACILITATOR ROSTER') : []
  };
}

// ------------------------------------------------------------------ schedule (SESSION_LOG)
function isSession_(o) { return !blank_(o.program) || !blank_(o.date) || !blank_(o.venue) || o.facilitators.length; }
function listSessions_() {
  var t = table_('session'), out = [];
  t.rows.forEach(function (r) { if (blank_(r.v[t.colOf.id])) return; var o = toObject_(t, r); if (isSession_(o)) { if (!o.status) o.status = 'PLANNED'; o.version = version_(o); out.push(o); } });
  return out;
}
function findSession_(t, id) {
  for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].v[t.colOf.id]).trim() === id) return t.rows[i];
  return null;
}
function getSession_(p) {
  var t = table_('session'), r = findSession_(t, String(p.id)); if (!r) return null;
  var o = toObject_(t, r); if (!isSession_(o)) return null; if (!o.status) o.status = 'PLANNED'; o.version = version_(o); return o;
}
function createSession_(p, actor) {
  var f = p.fields || {}; checkEnums_(f, 'session');
  if (blank_(f.program)) fail_('VALIDATION', 'Program / Module is required.');
  var t = table_('session'), fresh = Object.assign({}, f, { status: f.status || 'PLANNED' });
  if (fresh.status !== 'PLANNED') fail_('VALIDATION', 'New sessions start as Planned.');
  // "Session IDs are pre-filled; start from the first empty row."
  var slot = null, maxN = 0;
  t.rows.forEach(function (r) {
    var id = String(r.v[t.colOf.id]).trim(), m = /^TPD-(\d+)$/.exec(id);
    if (m) maxN = Math.max(maxN, +m[1]);
    if (!slot && m && !isSession_(toObject_(t, r))) slot = r;
  });
  var id = slot ? String(slot.v[t.colOf.id]).trim() : 'TPD-' + ('0000' + (maxN + 1)).slice(-Math.max(4, String(maxN + 1).length));
  fresh.id = id;
  writeRow_(t, slot ? slot.n : 0, slot ? slot.v : null, fresh);
  var saved = getSession_({ id: id }); audit_(actor, 'TRAINING_SESSION', id, 'CREATE', null, saved);
  return saved;
}
function updateSession_(p, actor) {
  var id = String(p.id), patch = p.patch || {}; checkEnums_(patch, 'session');
  var t = table_('session'), r = findSession_(t, id); if (!r) fail_('NOT_FOUND', 'Session ' + id + ' not found.');
  var cur = toObject_(t, r); if (!cur.status) cur.status = 'PLANNED'; cur.version = version_(cur);
  if (p.expectedVersion != null && p.expectedVersion !== cur.version) fail_('CONFLICT', 'Session ' + id + ' was changed by someone else.');
  if (patch.status && patch.status !== cur.status && (TRANSITIONS[cur.status] || []).indexOf(patch.status) < 0) {
    fail_('TRANSITION', cur.status + ' cannot become ' + patch.status + '.');
  }
  var next = Object.assign({}, cur, patch, { id: id });
  if (next.status === 'CONDUCTED' && blank_(next.date)) fail_('VALIDATION', 'A Conducted session needs a date.');
  if (blank_(next.program)) fail_('VALIDATION', 'Program / Module is required.');
  delete patch.id;
  writeRow_(t, r.n, r.v, Object.assign({}, patch));
  var saved = getSession_({ id: id });
  audit_(actor, 'TRAINING_SESSION', id, patch.status && patch.status !== cur.status ? 'STATUS_CHANGE' : 'UPDATE', cur, saved);
  return saved;
}

// ------------------------------------------------------------------ facilitator daily attendance
function listFac_(p) {
  var t = table_('fac'), out = [];
  t.rows.forEach(function (r) {
    if (blank_(r.v[t.colOf.person]) || blank_(r.v[t.colOf.date])) return;
    var o = toObject_(t, r); if (!o.date || !o.status) return;
    if ((p.from && o.date < p.from) || (p.to && o.date > p.to)) return;
    out.push(o);
  });
  return out;
}
function findFac_(t, person, date) {
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    if (norm_(r.v[t.colOf.person]) === norm_(person) && readCell_(t, 'date', null, r.v[t.colOf.date]) === date) return r;
  }
  return null;
}
function upsertFac_(p, actor) {
  var e = p.row || {}; checkEnums_(e, 'fac');
  if (blank_(e.person) || blank_(e.date) || blank_(e.status)) fail_('VALIDATION', 'Team member, date and status are required.');
  if (e.leaveType && e.status !== 'ON_LEAVE') fail_('VALIDATION', 'Leave Type is only allowed when Status is On Leave.');
  if (e.timeIn && e.timeOut && parseTime_(e.timeOut) < parseTime_(e.timeIn)) fail_('VALIDATION', 'Time Out cannot be before Time In.');
  var t = table_('fac'), r = findFac_(t, e.person, e.date), before = r ? toObject_(t, r) : null;
  if (r && p.expectedVersion != null && p.expectedVersion !== before.version) fail_('CONFLICT', 'This attendance row was changed by someone else.');
  var row = Object.assign({}, e); delete row.version;
  if (!row.position) { var m = getReference_().teamMembers.filter(function (x) { return norm_(x.name) === norm_(e.person); })[0]; if (m) row.position = m.position; }
  writeRow_(t, r ? r.n : 0, r ? r.v : null, row);
  var t2 = table_('fac'), r2 = findFac_(t2, e.person, e.date), saved = toObject_(t2, r2);
  audit_(actor, 'FACILITATOR_ATTENDANCE', e.person + '|' + e.date, before ? 'UPDATE' : 'CREATE', before, saved);
  return saved;
}
function deleteFac_(p, actor) {
  var t = table_('fac'), r = findFac_(t, p.person, p.date); if (!r) fail_('NOT_FOUND', 'No such attendance row.');
  var before = toObject_(t, r); t.sheet.deleteRow(r.n);
  audit_(actor, 'FACILITATOR_ATTENDANCE', p.person + '|' + p.date, 'DELETE', before, null);
  return true;
}
