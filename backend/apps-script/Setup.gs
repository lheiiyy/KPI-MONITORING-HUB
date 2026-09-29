/**
 * One-time administrator functions - run from the Apps Script editor, never
 * exposed through doPost. Safe to re-run: existing data is never overwritten
 * and SESSION_LOG / LISTS are never touched.
 */

function ensureTab_(ss, name, headers, widths) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);              // appended AFTER existing tabs (SESSION_LOG stays first)
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    var existing = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) throw new Error('Tab "' + name + '" already has content with a different header (missing: ' + missing.join(', ') + '). Refusing to modify it.');
  }
  // Plain text everywhere: dates stay ISO strings, "=..." can never become a formula.
  sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), headers.length).setNumberFormat('@');
  return sh;
}

function setupActivityModule() {
  var ss = spreadsheet_();
  ensureTab_(ss, ACTIVITY_SHEET, ACTIVITY_COLUMNS.map(function (c) { return c.name; }));
  ensureTab_(ss, HISTORY_SHEET, HISTORY_COLUMNS);
  var ref = ensureTab_(ss, REF_SHEET, REF_COLUMNS);
  if (ref.getLastRow() === 1) {
    var rows = REF_SEED.map(function (r, i) { return [r[0], r[1], r[2], i + 1, 'TRUE']; });
    ref.getRange(2, 1, rows.length, REF_COLUMNS.length).setValues(rows);
  }
  Logger.log('ACTIVITY module tabs are ready. Next: addActivityUser("your.name", "write").');
}

/**
 * Creates an API user and logs the token ONCE. Only the SHA-256 hash is stored.
 * role: "write" (read+write) or "read".
 */
function addActivityUser(user, role) {
  if (!user || !/^[A-Za-z0-9._@-]{2,60}$/.test(user)) throw new Error('user must be 2-60 chars: letters, digits . _ @ -');
  if (role !== 'write' && role !== 'read') throw new Error('role must be "write" or "read"');
  var props = PropertiesService.getScriptProperties();
  var users = JSON.parse(props.getProperty('ACTIVITY_TOKENS') || '{}');
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  users[sha256Hex_(token)] = { user: user, role: role };
  props.setProperty('ACTIVITY_TOKENS', JSON.stringify(users));
  Logger.log('Token for %s (%s): %s\nShare it privately. It cannot be shown again.', user, role, token);
  return token;
}

function listActivityUsers() {
  var users = JSON.parse(PropertiesService.getScriptProperties().getProperty('ACTIVITY_TOKENS') || '{}');
  Object.keys(users).forEach(function (h) { Logger.log('%s  %s  (token hash %s...)', users[h].user, users[h].role, h.slice(0, 8)); });
}

/** Revokes every token belonging to `user`. */
function revokeActivityUser(user) {
  var props = PropertiesService.getScriptProperties();
  var users = JSON.parse(props.getProperty('ACTIVITY_TOKENS') || '{}');
  Object.keys(users).forEach(function (h) { if (users[h].user === user) delete users[h]; });
  props.setProperty('ACTIVITY_TOKENS', JSON.stringify(users));
}
