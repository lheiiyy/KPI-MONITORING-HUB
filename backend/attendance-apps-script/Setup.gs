/**
 * One-time administrator functions: run from the Apps Script editor, never exposed through doPost.
 * They never modify ATTENDANCE_LOG or LISTS. Safe to re-run.
 */

/** Checks the workbook is usable and creates the ATTENDANCE_AUDIT tab. Writes no attendance data. */
function setupAttendanceModule() {
  var ss = attSpreadsheet_(), t = attTable_(ss);   // throws CONFIG_MISSING naming any missing header
  attTeamRoster_(ss);
  if (!ss.getSheetByName(ATT_AUDIT_TAB)) { ss.insertSheet(ATT_AUDIT_TAB).appendRow(ATT_AUDIT_HEADERS); }
  Logger.log('Attendance module ready. ATTENDANCE_LOG has %s data rows. Next: addAttendanceUser("your.name", "write").', attAllRecords_(t).length);
}

/** Creates an API user and logs the token ONCE. Only the SHA-256 hash is stored. role: "write" or "read". */
function addAttendanceUser(user, role) {
  if (!user || !/^[A-Za-z0-9._@-]{2,60}$/.test(user)) throw new Error('user must be 2-60 chars: letters, digits . _ @ -');
  if (role !== 'write' && role !== 'read') throw new Error('role must be "write" or "read"');
  var props = PropertiesService.getScriptProperties();
  var users = JSON.parse(props.getProperty('ATTENDANCE_TOKENS') || '{}');
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  users[attSha256Hex_(token)] = { user: user, role: role };
  props.setProperty('ATTENDANCE_TOKENS', JSON.stringify(users));
  Logger.log('Token for %s (%s): %s\nShare it privately. It cannot be shown again.', user, role, token);
  return token;
}

function listAttendanceUsers() {
  var users = JSON.parse(PropertiesService.getScriptProperties().getProperty('ATTENDANCE_TOKENS') || '{}');
  Object.keys(users).forEach(function (h) { Logger.log('%s  %s  (token hash %s...)', users[h].user, users[h].role, h.slice(0, 8)); });
}

function revokeAttendanceUser(user) {
  var props = PropertiesService.getScriptProperties();
  var users = JSON.parse(props.getProperty('ATTENDANCE_TOKENS') || '{}');
  Object.keys(users).forEach(function (h) { if (users[h].user === user) delete users[h]; });
  props.setProperty('ATTENDANCE_TOKENS', JSON.stringify(users));
}
