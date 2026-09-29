/**
 * Repository: the ONLY file that knows the data lives in a Google Sheet.
 * Columns are located by header NAME, never by position, and no row number
 * ever leaves this file. Replace this file (and nothing else) to move the
 * ACTIVITY table to PostgreSQL.
 */

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('ACTIVITY_SPREADSHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw fail_('CONFIG_MISSING', 'No spreadsheet is configured. Bind the script to the sheet or set the ACTIVITY_SPREADSHEET_ID script property.');
  return ss;
}

function tz_() { return spreadsheet_().getSpreadsheetTimeZone() || 'UTC'; }

function todayIso_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

function nowIso_() { return new Date().toISOString(); }

function sheet_(name) {
  var sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw fail_('CONFIG_MISSING', 'Sheet tab "' + name + '" is missing. Run setupActivityModule() once from the Apps Script editor.');
  return sh;
}

function headerIndex_(sh, expected) {
  var last = sh.getLastColumn();
  var header = last ? sh.getRange(1, 1, 1, last).getValues()[0] : [];
  var idx = {};
  header.forEach(function (h, i) { if (h !== '') idx[String(h).trim()] = i; });
  var missing = expected.filter(function (n) { return !(n in idx); });
  if (missing.length) throw fail_('CONFIG_MISSING', 'Tab "' + sh.getName() + '" is missing columns: ' + missing.join(', ') + '.');
  return { idx: idx, width: last };
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { throw fail_('BUSY', 'The database is busy. Please try again in a moment.'); }
  try { return fn(); } finally { lock.releaseLock(); }
}

function cellOut_(col, v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) {
    return col.type === 'date' ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : v.toISOString();
  }
  if (col.type === 'int' || col.type === 'number') { var n = Number(v); return isFinite(n) ? n : ''; }
  return String(v);
}

/** Returns [{row: <1-based sheet row, internal>, rec: {...}}]. */
function loadActivityRows_() {
  var sh = sheet_(ACTIVITY_SHEET);
  var h = headerIndex_(sh, ACTIVITY_COLUMNS.map(function (c) { return c.name; }));
  var n = sh.getLastRow() - 1;
  if (n < 1) return { sh: sh, h: h, rows: [] };
  var values = sh.getRange(2, 1, n, h.width).getValues();
  var rows = [];
  values.forEach(function (r, i) {
    var rec = {};
    ACTIVITY_COLUMNS.forEach(function (col) { rec[col.name] = cellOut_(col, r[h.idx[col.name]]); });
    if (rec.activity_id !== '') rows.push({ row: i + 2, rec: rec });
  });
  return { sh: sh, h: h, rows: rows };
}

function writeActivityRecord_(loaded, rec, rowOrNull) {
  var line = new Array(loaded.h.width);
  for (var i = 0; i < line.length; i++) line[i] = '';
  ACTIVITY_COLUMNS.forEach(function (col) { line[loaded.h.idx[col.name]] = rec[col.name] === undefined ? '' : rec[col.name]; });
  var row = rowOrNull || Math.max(loaded.sh.getLastRow(), 1) + 1;
  var range = loaded.sh.getRange(row, 1, 1, loaded.h.width);
  // Plain-text format first: stops Sheets turning "2026-03-01" into a Date and,
  // more importantly, stops text like "=HYPERLINK(...)" being stored as a formula.
  range.setNumberFormat('@');
  range.setValues([line]);
  return row;
}

function appendHistory_(entries) {
  if (!entries.length) return;
  var sh = sheet_(HISTORY_SHEET);
  var h = headerIndex_(sh, HISTORY_COLUMNS);
  var start = Math.max(sh.getLastRow(), 1) + 1;
  var lines = entries.map(function (e) {
    var line = new Array(h.width);
    for (var i = 0; i < line.length; i++) line[i] = '';
    HISTORY_COLUMNS.forEach(function (c) { line[h.idx[c]] = e[c] === undefined ? '' : e[c]; });
    return line;
  });
  var range = sh.getRange(start, 1, lines.length, h.width);
  range.setNumberFormat('@');
  range.setValues(lines);
}

function loadHistory_(activityId) {
  var sh = sheet_(HISTORY_SHEET);
  var h = headerIndex_(sh, HISTORY_COLUMNS);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var out = [];
  sh.getRange(2, 1, n, h.width).getValues().forEach(function (r) {
    if (String(r[h.idx.activity_id]) !== activityId) return;
    var e = {};
    HISTORY_COLUMNS.forEach(function (c) { e[c] = r[h.idx[c]] instanceof Date ? r[h.idx[c]].toISOString() : String(r[h.idx[c]]); });
    out.push(e);
  });
  return out;
}

/** {PERSON:{id:label}, BRAND:{...}, ...} of ACTIVE reference rows, plus ordered lists. */
function loadRefs_() {
  var sh = sheet_(REF_SHEET);
  var h = headerIndex_(sh, REF_COLUMNS);
  var n = sh.getLastRow() - 1;
  var byType = {}, lists = {};
  REF_TYPES.forEach(function (t) { byType[t] = {}; lists[t] = []; });
  if (n >= 1) {
    var rows = sh.getRange(2, 1, n, h.width).getValues().map(function (r) {
      return { type: String(r[h.idx.ref_type]).trim(), id: String(r[h.idx.ref_id]).trim(), label: String(r[h.idx.label]).trim(),
        sort: Number(r[h.idx.sort_order]) || 0, active: String(r[h.idx.active]).trim().toUpperCase() !== 'FALSE' };
    }).filter(function (r) { return r.active && byType[r.type] && r.id; });
    rows.sort(function (a, b) { return a.sort - b.sort; });
    rows.forEach(function (r) { byType[r.type][r.id] = r.label || r.id; lists[r.type].push({ id: r.id, label: r.label || r.id }); });
  }
  return { byType: byType, lists: lists };
}
