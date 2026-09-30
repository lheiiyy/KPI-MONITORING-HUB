/**
 * ATTENDANCE module (facilitators / trainers / T&D team members only) - constants.
 * Data source: the "TDD Team Attendance Monitoring 2026" workbook, tab ATTENDANCE_LOG.
 * There is NO trainee/participant attendance in this module.
 * Docs: docs/ATTENDANCE_MODULE.md
 */
var ATT_API_VERSION = '1.0.0';
var ATT_LOG_TAB = 'ATTENDANCE_LOG';
var ATT_LISTS_TAB = 'LISTS';
var ATT_AUDIT_TAB = 'ATTENDANCE_AUDIT';
var ATT_AUDIT_HEADERS = ['Timestamp', 'User', 'Action', 'Team Member', 'Work Date', 'Before', 'After'];

// code / label pairs. Labels are exactly the sheet's LISTS wording. Kept equal to js/attendance-logic.js by a test.
var ATT_ENUMS = {
  status: [['PRESENT', 'Present'], ['LATE', 'Late'], ['HALF_DAY', 'Half Day'], ['ABSENT', 'Absent'], ['ON_LEAVE', 'On Leave'],
    ['OFFICIAL_BUSINESS', 'Official Business / Field'], ['WORK_FROM_HOME', 'Work From Home'], ['REST_DAY', 'Rest Day / Day Off'], ['HOLIDAY', 'Holiday']],
  work_location: [['HEAD_OFFICE', 'Head Office'], ['TRAINING_ROOM', 'Training Room'], ['STORE_VISIT_FIELD', 'Store Visit / Field'],
    ['COMMISSARY', 'Commissary'], ['OTHER', 'Other']],
  leave_type: [['VACATION', 'Vacation Leave'], ['SICK', 'Sick Leave'], ['EMERGENCY', 'Emergency Leave'], ['BIRTHDAY', 'Birthday Leave'],
    ['MATERNITY_PATERNITY', 'Maternity / Paternity Leave'], ['LWOP', 'Leave Without Pay'], ['OTHER', 'Other']]
};

// Short leave names people use in the sheet map to the sheet's own labels. This mapping is deliberate and documented
// (docs/ATTENDANCE_MODULE.md); anything else is reported as a problem, never guessed.
var ATT_ENUM_ALIASES = {
  leave_type: { 'vacation': 'VACATION', 'sick': 'SICK', 'emergency': 'EMERGENCY', 'birthday': 'BIRTHDAY',
    'maternity / paternity': 'MATERNITY_PATERNITY', 'maternity/paternity': 'MATERNITY_PATERNITY', 'leave without pay': 'LWOP', 'lwop': 'LWOP' }
};

// [field, header in row 1 of ATTENDANCE_LOG, type, enum]. Headers are matched by text, so column order does not matter.
var ATT_COLUMNS = [
  ['work_date', 'Date', 'date'], ['person', 'Team Member', 'text'], ['position', 'Position', 'text'],
  ['status', 'Status', 'enum', 'status'], ['time_in', 'Time In', 'time'], ['time_out', 'Time Out', 'time'],
  ['work_location', 'Work Location / Assignment', 'enum', 'work_location'], ['leave_type', 'Leave Type', 'enum', 'leave_type'],
  ['remarks', 'Remarks', 'text']
];
