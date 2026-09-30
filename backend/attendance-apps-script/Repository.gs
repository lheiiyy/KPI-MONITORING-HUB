/**
 * The ONLY file that knows the spreadsheet layout. Columns are found by header text in row 1 of
 * ATTENDANCE_LOG (order does not matter; extra columns are left untouched). ATTENDANCE_LOG and LISTS are never
 * restructured. Rows are identified by (canonical person, work date): one row per team member per day.
 */

function attSpreadsheet_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty('ATTENDANCE_SPREADSHEET_ID');
    if (!id) throw attFail_('CONFIG_MISSING', 'No spreadsheet configured. Bind the script to the attendance workbook or set the ATTENDANCE_SPREADSHEET_ID script property.');
    try { ss = SpreadsheetApp.openById(id); } catch (e) { throw attFail_('CONFIG_MISSING', 'Cannot open the attendance spreadsheet. Check ATTENDANCE_SPREADSHEET_ID and that the script owner can edit it.'); }
  }
  return ss;
}

// ---- identity (from Identity.gs)
function attResolve_(name) {
  var n = attNorm_(name);
  for (var i = 0; i < ATT_IDENTITY.length; i++) for (var j = 0; j < ATT_IDENTITY[i].names.length; j++)
    if (attNorm_(ATT_IDENTITY[i].names[j][0]) === n) return { id: ATT_IDENTITY[i].id, canonical: ATT_IDENTITY[i].names[0][0], status: ATT_IDENTITY[i].names[j][1], names: ATT_IDENTITY[i].names };
  return null;
}

// ---- LISTS tab (the team roster and dropdown vocabulary maintained by the team)
function attReadList_(lists, header) {
  var vals = lists.getDataRange().getDisplayValues(), c = -1;
  for (var i = 0; i < vals[0].length; i++) if (attNorm_(vals[0][i]) === attNorm_(header)) { c = i; break; }
  if (c < 0) return [];
  var out = []; for (var r = 1; r < vals.length; r++) if (!attBlank_(vals[r][c])) out.push(String(vals[r][c]).trim());
  return out;
}
function attTeamRoster_(ss) {
  var lists = ss.getSheetByName(ATT_LISTS_TAB);
  if (!lists) throw attFail_('CONFIG_MISSING', 'Tab "' + ATT_LISTS_TAB + '" not found.');
  var names = attReadList_(lists, 'TEAM MEMBER'), pos = attReadList_(lists, 'POSITION');
  return names.map(function (n, i) { var r = attResolve_(n); return { name: n, position: pos[i] || '', person_id: r ? r.id : null, link_status: r ? r.status : 'UNMAPPED' }; });
}
function attVocabularyWarnings_(ss) {
  var lists = ss.getSheetByName(ATT_LISTS_TAB), warn = [];
  if (!lists) return warn;
  [['STATUS', 'status'], ['WORK LOCATION', 'work_location'], ['LEAVE TYPE', 'leave_type']].forEach(function (p) {
    attReadList_(lists, p[0]).forEach(function (label) { if (!attEnumCode_(p[1], label)) warn.push('LISTS ' + p[0] + ' contains "' + label + '", which this module does not recognise.'); });
  });
  return warn;
}
/** Maps any accepted spelling to the sheet's own LISTS spelling. Throws if the person is not on the team list. */
function attCanonicalName_(ss, typed) {
  var roster = attTeamRoster_(ss), t = attNorm_(typed), res = attResolve_(typed), i;
  if (res) {
    for (i = 0; i < roster.length; i++) for (var j = 0; j < res.names.length; j++) if (attNorm_(roster[i].name) === attNorm_(res.names[j][0])) return roster[i];
  } else {
    for (i = 0; i < roster.length; i++) if (attNorm_(roster[i].name) === t) return roster[i];
  }
  throw attFail_('VALIDATION_ERROR', 'That person is not on the team list.', [{ field: 'person', message: '"' + typed + '" is not on the TEAM MEMBER list of the attendance workbook.' }]);
}

// ---- ATTENDANCE_LOG
function attTable_(ss) {
  var sheet = ss.getSheetByName(ATT_LOG_TAB);
  if (!sheet) throw attFail_('CONFIG_MISSING', 'Tab "' + ATT_LOG_TAB + '" not found.');
  var width = Math.max(sheet.getLastColumn(), 1), rows = Math.max(sheet.getLastRow(), 1);
  var vals = sheet.getRange(1, 1, rows, width).getValues(), disp = sheet.getRange(1, 1, rows, width).getDisplayValues();
  var heads = vals[0].map(attNorm_), colOf = {};
  ATT_COLUMNS.forEach(function (c) {
    var i = heads.indexOf(attNorm_(c[1]));
    if (i < 0) throw attFail_('CONFIG_MISSING', 'Header "' + c[1] + '" was not found in row 1 of ' + ATT_LOG_TAB + '.');
    colOf[c[0]] = i;
  });
  return { sheet: sheet, ss: ss, tz: ss.getSpreadsheetTimeZone(), colOf: colOf, width: width, vals: vals, disp: disp };
}

function attCellDate_(t, raw) {
  if (attBlank_(raw)) return null;
  if (Object.prototype.toString.call(raw) === '[object Date]') return Utilities.formatDate(raw, t.tz, 'yyyy-MM-dd');
  if (typeof raw === 'number') { var d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000); return d.getUTCFullYear() + '-' + attPad_(d.getUTCMonth() + 1) + '-' + attPad_(d.getUTCDate()); }
  return attParseDate_(raw);
}

/** One sheet row -> record, or null for a blank row. Problems are reported on the record, never hidden or "fixed". */
function attRowToRecord_(t, r) {
  var v = t.vals[r], d = t.disp[r], o = {}, problems = [];
  function cell(f) { return v[t.colOf[f]]; }
  function shown(f) { return d[t.colOf[f]]; }
  if (attBlank_(cell('person')) && attBlank_(cell('work_date')) && attBlank_(cell('status'))) return null;
  o.row = r + 1;
  o.person = String(cell('person') == null ? '' : cell('person')).trim();
  o.position = String(cell('position') == null ? '' : cell('position')).trim();
  o.work_date = attCellDate_(t, cell('work_date'));
  if (!o.work_date) problems.push(attBlank_(cell('work_date')) ? 'Date is missing.' : 'Date "' + shown('work_date') + '" is not a valid date.');
  o.status = attEnumCode_('status', cell('status'));
  if (!o.status) problems.push(attBlank_(cell('status')) ? 'Status is missing.' : 'Status "' + cell('status') + '" is not a recognised status.');
  if (!o.person) problems.push('Team Member is missing.');
  ['time_in', 'time_out'].forEach(function (f) {
    o[f] = attParseTime_(shown(f));
    if (!attBlank_(shown(f)) && !o[f]) problems.push(f === 'time_in' ? 'Time In "' + shown(f) + '" is not a valid time.' : 'Time Out "' + shown(f) + '" is not a valid time.');
  });
  o.work_location = attEnumCode_('work_location', cell('work_location'));
  if (!attBlank_(cell('work_location')) && !o.work_location) problems.push('Work Location "' + cell('work_location') + '" is not recognised.');
  o.leave_type = attEnumCode_('leave_type', cell('leave_type'));
  if (!attBlank_(cell('leave_type')) && !o.leave_type) problems.push('Leave Type "' + cell('leave_type') + '" is not recognised.');
  o.remarks = String(cell('remarks') == null ? '' : cell('remarks')).trim();
  o.problems = problems;
  o.version = attVersion_(o);
  return o;
}

function attVersion_(o) {
  var k = { person: attNorm_(o.person), work_date: o.work_date, status: o.status, time_in: o.time_in, time_out: o.time_out, work_location: o.work_location, leave_type: o.leave_type, remarks: o.remarks };
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(k, Object.keys(k).sort()))
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function attAllRecords_(t) {
  var out = []; for (var r = 1; r < t.vals.length; r++) { var o = attRowToRecord_(t, r); if (o) out.push(o); }
  return out;
}

/** Identity key: a person is the resolved person id when the name is known, otherwise the normalised name. */
function attPersonKey_(name) { var r = attResolve_(name); return r ? 'id:' + r.id : 'nm:' + attNorm_(name); }

function attFindRow_(t, person, workDate) {
  var key = attPersonKey_(person);
  for (var r = 1; r < t.vals.length; r++) {
    var o = attRowToRecord_(t, r);
    if (o && o.work_date === workDate && attPersonKey_(o.person) === key) return o;
  }
  return null;
}

function attWriteRecord_(t, existing, rec, position) {
  var rowN = existing ? existing.row : 0, row;
  if (rowN) row = t.vals[rowN - 1].slice(); else { row = []; for (var i = 0; i < t.width; i++) row.push(''); }
  function put(f, val) { row[t.colOf[f]] = val; }
  put('work_date', Utilities.parseDate(rec.work_date, t.tz, 'yyyy-MM-dd'));
  put('person', rec.person);
  if (existing ? attBlank_(row[t.colOf.position]) : true) put('position', position || '');
  put('status', attEnumLabel_('status', rec.status));
  ['time_in', 'time_out'].forEach(function (f) {
    if (!rec[f]) { put(f, ''); return; }
    var hm = rec[f].split(':'); put(f, (+hm[0] * 60 + +hm[1]) / 1440);   // a real time value, not text
  });
  put('work_location', rec.work_location ? attEnumLabel_('work_location', rec.work_location) : '');
  put('leave_type', rec.leave_type ? attEnumLabel_('leave_type', rec.leave_type) : '');
  put('remarks', rec.remarks);
  if (!rowN) {
    rowN = 1; for (var r = 1; r < t.vals.length; r++) if (!attBlank_(t.vals[r][t.colOf.person]) || !attBlank_(t.vals[r][t.colOf.work_date]) || !attBlank_(t.vals[r][t.colOf.status])) rowN = r + 1;
    rowN += 1;
  }
  t.sheet.getRange(rowN, 1, 1, t.width).setValues([row]);
  // Show the times as hh:mm and the date as a date, whatever the cell had before.
  t.sheet.getRange(rowN, t.colOf.time_in + 1).setNumberFormat('HH:mm');
  t.sheet.getRange(rowN, t.colOf.time_out + 1).setNumberFormat('HH:mm');
  t.sheet.getRange(rowN, t.colOf.work_date + 1).setNumberFormat('yyyy-mm-dd');
  return rowN;
}

function attDeleteRow_(t, rowN) { t.sheet.deleteRow(rowN); }

function attAudit_(ss, user, action, person, workDate, before, after) {
  var tab = ss.getSheetByName(ATT_AUDIT_TAB);
  if (!tab) { tab = ss.insertSheet(ATT_AUDIT_TAB); tab.appendRow(ATT_AUDIT_HEADERS); }
  function slim(o) { if (!o) return ''; var c = {}; Object.keys(o).forEach(function (k) { if (k !== 'row' && k !== 'problems') c[k] = o[k]; }); return JSON.stringify(c); }
  tab.appendRow([new Date(), user || '', action, person, workDate, slim(before), slim(after)]);
}
