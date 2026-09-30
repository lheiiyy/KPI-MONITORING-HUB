const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, LOG_HEAD } = require('./attendance-gas-harness');
const L = require('../js/attendance-logic');

function ready(opts) { const h = load(opts); h.wtok = h.addUser('lea', 'write'); h.rtok = h.addUser('viewer', 'read'); return h; }
const W = (h, action, params) => h.call(Object.assign({ action, token: h.wtok }, params || {}));
const vals = (sheet) => sheet.cells.map(r => r.map(c => c.v));
const snap = (sheet) => JSON.stringify(sheet.cells.map(r => r.map(c => c.v)));

// ---------------------------------------------------------------- consistency with the shared logic and identity file
test('vocabulary and identity in the backend equal the frontend logic and data/team-identity.json', () => {
  const h = load(), E = JSON.parse(JSON.stringify(h.ctx.ATT_ENUMS)), pairs = (l) => l.map(x => [x.code, x.label]);
  assert.deepEqual(E.status, pairs(L.STATUSES)); assert.deepEqual(E.work_location, pairs(L.WORK_LOCATIONS)); assert.deepEqual(E.leave_type, pairs(L.LEAVE_TYPES));
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'team-identity.json'), 'utf8'));
  const gs = JSON.parse(JSON.stringify(h.ctx.ATT_IDENTITY));
  assert.deepEqual(gs.map(p => ({ id: p.id, names: p.names })), json.people.map(p => ({ id: p.person_id, names: p.names.map(n => [n.name, n.status]) })));
});
test('status vocabulary is the project vocabulary, unrenamed', () => {
  assert.deepEqual(L.STATUSES.map(s => s.label), ['Present', 'Late', 'Half Day', 'Absent', 'On Leave', 'Official Business / Field', 'Work From Home', 'Rest Day / Day Off', 'Holiday']);
  assert.deepEqual(L.LEAVE_TYPES.map(s => s.label), ['Vacation Leave', 'Sick Leave', 'Emergency Leave', 'Birthday Leave', 'Maternity / Paternity Leave', 'Leave Without Pay', 'Other']);
});

// ---------------------------------------------------------------- access
test('auth: refuses when no tokens are configured, on a wrong token, and read-only tokens cannot write', () => {
  const h = load();
  assert.equal(h.call({ action: 'meta', token: 'x' }).error.code, 'CONFIG_MISSING');
  h.addUser('lea', 'write'); h.addUser('viewer', 'read');
  assert.equal(h.call({ action: 'meta', token: 'nope' }).error.code, 'UNAUTHORIZED');
  assert.equal(h.call({ action: 'meta' }).error.code, 'UNAUTHORIZED');
  assert.equal(h.call({ action: 'meta', token: h.tokens.viewer }).data.role, 'read');
  const rec = { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT' };
  assert.equal(h.call({ action: 'save', token: h.tokens.viewer, record: rec }).error.code, 'FORBIDDEN');
  assert.equal(h.call({ action: 'remove', token: h.tokens.viewer, person: 'Alex Rivera', work_date: '2026-09-01' }).error.code, 'FORBIDDEN');
  assert.equal(h.call({ action: 'nope', token: h.tokens.lea }).error.code, 'BAD_REQUEST');
  assert.equal(h.call(null).error.code, 'BAD_REQUEST');
  assert.equal(h.log.cells.length, 1, 'nothing written by refused calls');
});
test('transport: doPost rejects non-JSON and doGet returns no data', () => {
  const h = ready();
  assert.equal(JSON.parse(h.ctx.doPost({ postData: { contents: 'not json' } }).text).error.code, 'BAD_REQUEST');
  const g = JSON.parse(h.ctx.doGet().text); assert.deepEqual(Object.keys(g.data).sort(), ['api_version', 'service']);
});
test('a busy sheet returns BUSY instead of writing', () => {
  const h = ready(); h.setLockBusy(true);
  assert.equal(W(h, 'save', { record: { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT' } }).error.code, 'BUSY');
  assert.equal(h.log.cells.length, 1);
});

// ---------------------------------------------------------------- the empty template
test('empty sheet: zero records, the roster and vocabulary from the sheet, and nothing is written by reading', () => {
  const h = ready(), before = snap(h.log), lists = snap(h.lists);
  const meta = W(h, 'meta').data;
  assert.equal(meta.team_members.length, 12); assert.equal(meta.role, 'write');
  const by = Object.fromEntries(meta.team_members.map(m => [m.name, m]));
  assert.deepEqual([by['Ricelle Lim'].person_id, by['Ricelle Lim'].link_status, by['Ricelle Lim'].position], ['RICE', 'PROPOSED', 'Asst. Supervisor']);
  assert.equal(by['Alex Rivera'].link_status, 'CONFIRMED'); assert.equal(by['Nica Tardio'].person_id, 'NICA');
  assert.deepEqual(meta.vocabulary_warnings, []);
  const list = W(h, 'list', {}).data;
  assert.deepEqual([list.records.length, list.total_rows_in_sheet, list.problem_rows], [0, 0, 0]);
  assert.equal(W(h, 'list', { from: '2026-09-01', to: '2026-09-30', person: 'Alex Rivera' }).data.records.length, 0);
  assert.equal(snap(h.log), before); assert.equal(snap(h.lists), lists); assert.equal(h.book.getSheetByName('ATTENDANCE_AUDIT'), null, 'reads create nothing');
});
test('vocabulary drift in LISTS is reported, not silently accepted', () => {
  const h = ready(); h.lists.cells[1][2] = { v: 'Remote' };
  assert.match(W(h, 'meta').data.vocabulary_warnings.join(' '), /Remote/);
});

// ---------------------------------------------------------------- writing
test('save writes one row in the sheet format, fills Position, and audits; header and LISTS untouched', () => {
  const h = ready(), lists = snap(h.lists);
  const r = W(h, 'save', { record: { person: 'Alex Rivera', work_date: '2026-09-01', status: 'LATE', time_in: '8:35', time_out: '17:00', work_location: 'HEAD_OFFICE', remarks: ' traffic ' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.person, r.data.work_date, r.data.status, r.data.time_in, r.data.time_out, r.data.work_location, r.data.remarks, r.data.position], ['Alex Rivera', '2026-09-01', 'LATE', '08:35', '17:00', 'HEAD_OFFICE', 'traffic', 'Supervisor']);
  const row = h.log.cells[1];
  assert.equal(h.log.cells.length, 2); assert.deepEqual(h.log.cells[0].map(c => c.v), LOG_HEAD);
  assert.ok(row[0].v instanceof Date, 'a real date, not text'); assert.equal(row[3].v, 'Late', 'the sheet label, not the code');
  assert.equal(typeof row[4].v, 'number'); assert.equal(row[4].f, 'HH:mm'); assert.equal(row[6].v, 'Head Office'); assert.equal(row[7].v, '');
  assert.equal(snap(h.lists), lists);
  const audit = vals(h.book.getSheetByName('ATTENDANCE_AUDIT'));
  assert.deepEqual([audit.length, audit[1][1], audit[1][2], audit[1][3]], [2, 'lea', 'CREATE', 'Alex Rivera']);
});
test('one record per person per day: an existing row must be edited with its version, never blindly overwritten', () => {
  const h = ready(), rec = { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT' };
  const a = W(h, 'save', { record: rec }).data;
  assert.equal(W(h, 'save', { record: { ...rec, status: 'ABSENT' } }).error.code, 'CONFLICT', 'no version given for an existing row');
  assert.equal(W(h, 'save', { record: { ...rec, status: 'ABSENT' }, expected_version: 'stale' }).error.code, 'CONFLICT');
  assert.equal(W(h, 'save', { record: { ...rec, person: 'Leo Fernandez' }, expected_version: a.version }).error.code, 'NOT_FOUND', 'a version for a row that does not exist');
  const b = W(h, 'save', { record: { ...rec, status: 'LATE', time_in: '09:00' }, expected_version: a.version });
  assert.equal(b.ok, true); assert.equal(h.log.cells.length, 2, 'updated in place, no duplicate'); assert.notEqual(b.data.version, a.version);
  assert.equal(W(h, 'save', { record: { ...rec, status: 'HALF_DAY' }, expected_version: a.version }).error.code, 'CONFLICT', 'the old version is now stale');
  assert.deepEqual(vals(h.book.getSheetByName('ATTENDANCE_AUDIT')).slice(1).map(x => x[2]), ['CREATE', 'UPDATE']);
});
test('alias spellings resolve to one person: no duplicate person/day, and the sheet keeps its own LISTS spelling', () => {
  const h = ready(), d = '2026-09-02';
  const a = W(h, 'save', { record: { person: 'Ricelle (Rice) Lim', work_date: d, status: 'PRESENT' } });
  assert.equal(a.ok, true); assert.equal(a.data.person, 'Ricelle Lim', 'written as the LISTS spelling');
  assert.equal(W(h, 'save', { record: { person: 'rice  lim', work_date: d, status: 'LATE' } }).error.code, 'CONFLICT', 'same person under another spelling');
  assert.equal(W(h, 'save', { record: { person: 'Alliana (Yana) Papa', work_date: d, status: 'PRESENT' } }).data.person, 'Alliana Papa');
  assert.equal(W(h, 'save', { record: { person: 'Ver Guerrero', work_date: d, status: 'PRESENT' } }).data.person, 'Jeliver Guerrero');
  assert.equal(W(h, 'list', { person: 'Ricelle (Rice) Lim' }).data.records.length, 1, 'listing by any alias finds the person');
  assert.equal(h.log.cells.length, 4);
});
test('only people on the sheet\'s TEAM MEMBER list can be recorded; a name added there later is accepted as unmapped', () => {
  const h = ready();
  const bad = W(h, 'save', { record: { person: 'Sky', work_date: '2026-09-01', status: 'PRESENT' } });
  assert.equal(bad.error.code, 'VALIDATION_ERROR'); assert.equal(bad.error.details[0].field, 'person');
  assert.equal(W(h, 'save', { record: { person: 'Nobody Known', work_date: '2026-09-01', status: 'PRESENT' } }).error.code, 'VALIDATION_ERROR');
  h.lists.cells.push([{ v: 'Pat New' }, { v: 'Officer' }]);
  const m = W(h, 'meta').data.team_members.find(x => x.name === 'Pat New');
  assert.deepEqual([m.person_id, m.link_status], [null, 'UNMAPPED']);
  assert.equal(W(h, 'save', { record: { person: 'Pat New', work_date: '2026-09-01', status: 'PRESENT' } }).ok, true);
});

const INVALID = [
  ['missing person', { work_date: '2026-09-01', status: 'PRESENT' }, 'person'],
  ['missing date', { person: 'Alex Rivera', status: 'PRESENT' }, 'work_date'],
  ['impossible date', { person: 'Alex Rivera', work_date: '31/02/2026', status: 'PRESENT' }, 'work_date'],
  ['missing status', { person: 'Alex Rivera', work_date: '2026-09-01' }, 'status'],
  ['unknown status', { person: 'Alex Rivera', work_date: '2026-09-01', status: 'SKIVING' }, 'status'],
  ['label instead of code', { person: 'Alex Rivera', work_date: '2026-09-01', status: 'Present' }, 'status'],
  ['bad time in', { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT', time_in: '25:00' }, 'time_in'],
  ['bad time out', { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT', time_out: 'noon' }, 'time_out'],
  ['time out before in', { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT', time_in: '17:00', time_out: '08:00' }, 'time_out'],
  ['leave type on a present day', { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT', leave_type: 'SICK' }, 'leave_type'],
  ['unknown leave type', { person: 'Alex Rivera', work_date: '2026-09-01', status: 'ON_LEAVE', leave_type: 'HOLIDAYING' }, 'leave_type'],
  ['unknown location', { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT', work_location: 'Moon' }, 'work_location'],
  ['remarks too long', { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT', remarks: 'x'.repeat(1001) }, 'remarks']
];
test('validation: the server and the browser logic reject the same invalid records, naming the same field', () => {
  const h = ready();
  INVALID.forEach(([label, rec, field]) => {
    const s = W(h, 'save', { record: rec });
    assert.equal(s.error && s.error.code, 'VALIDATION_ERROR', label);
    assert.ok(s.error.details.some(e => e.field === field), 'server flags ' + field + ' for ' + label);
    const c = L.validateRecord(rec);
    assert.equal(c.ok, false, label); assert.ok(c.errors.some(e => e.field === field), 'client flags ' + field + ' for ' + label);
  });
  assert.equal(h.log.cells.length, 1, 'nothing written');
  ['ON_LEAVE'].forEach(st => assert.equal(W(h, 'save', { record: { person: 'Alex Rivera', work_date: '2026-09-03', status: st, leave_type: 'SICK' } }).ok, true));
  assert.equal(W(h, 'save', { record: { person: 'Leo Fernandez', work_date: '2026-09-03', status: 'ON_LEAVE' } }).ok, true, 'Leave Type is optional even on leave: the sheet says only "needed", not required');
  assert.equal(W(h, 'save', { record: { person: 'Ann Barredo', work_date: '2026-09-03', status: 'REST_DAY' } }).ok, true, 'no times needed');
});

// ---------------------------------------------------------------- reading what people typed into the sheet
test('reading human-entered rows: 12-hour times, text dates, lower-case status; problems are reported and rows are never dropped or fixed', () => {
  const h = ready(), row = (vals) => h.log.cells.push(vals.map(v => (v && typeof v === 'object' && !(v instanceof Date) ? v : { v })));
  row([new Date(2026, 8, 1), 'Alex Rivera', 'Supervisor', 'present', { v: 0.34, d: '8:05 AM' }, { v: 0.7, d: '4:48 PM' }, 'head office', '', 'ok']);
  row(['02/09/2026', 'Leo Fernandez', '', 'Late', { v: '08:20', d: '08:20' }, '', '', '', '']);
  row([new Date(2026, 8, 3), 'Ann Barredo', '', 'Prsent', '', '', '', '', '']);            // typo in status
  row(['', 'Josh Earnshaw', '', 'Present', '', '', '', '', '']);                          // no date
  row([new Date(2026, 8, 4), 'Charlie Moises', '', 'Absent', { v: 'x', d: 'late' }, '', 'Moon', 'Sabbatical', '']);
  row([new Date(2026, 8, 5), 'Leo Fernandez', '', 'On Leave', '', '', '', 'Sick', '']);   // documented shorthand
  row(['', '', '', '', '', '', '', '', '']);                                                // blank row
  row([46269, 'Nica Tardio', '', 'Work From Home', '', '', '', '', '']);                   // date stored as a serial number
  const l = W(h, 'list', {}).data, by = Object.fromEntries(l.records.filter(r => r.work_date !== '2026-09-05').map(r => [r.person, r]));
  assert.equal(l.records.find(r => r.work_date === '2026-09-05').leave_type, 'SICK', '"Sick" is read as Sick Leave');
  assert.equal(l.records.length, 7, 'the blank row is skipped, everything else kept');
  assert.deepEqual([by['Alex Rivera'].status, by['Alex Rivera'].time_in, by['Alex Rivera'].time_out, by['Alex Rivera'].work_location, by['Alex Rivera'].problems.length], ['PRESENT', '08:05', '16:48', 'HEAD_OFFICE', 0]);
  assert.deepEqual([by['Leo Fernandez'].work_date, by['Leo Fernandez'].status], ['2026-09-02', 'LATE']);
  assert.deepEqual([by['Ann Barredo'].status, by['Ann Barredo'].problems.length], [null, 1]); assert.match(by['Ann Barredo'].problems[0], /Prsent/);
  assert.equal(by['Josh Earnshaw'].work_date, null); assert.match(by['Josh Earnshaw'].problems.join(' '), /Date is missing/);
  assert.equal(by['Charlie Moises'].problems.length, 3, 'time, location and leave type problems');
  assert.equal(by['Nica Tardio'].work_date, '2026-09-04', 'serial-number date read correctly');
  assert.equal(l.problem_rows, 3);
  assert.equal(W(h, 'list', { from: '2026-09-02', to: '2026-09-02' }).data.records.length, 1, 'date filter ignores rows with no usable date');
});
test('a row typed by hand under an alias is found and edited, not duplicated', () => {
  const h = ready(); h.log.cells.push([new Date(2026, 8, 1), 'Ricelle (Rice) Lim', 'Asst. Supervisor', 'Present', '', '', '', '', ''].map(v => ({ v })));
  const existing = W(h, 'list', {}).data.records[0];
  assert.equal(W(h, 'save', { record: { person: 'Ricelle Lim', work_date: '2026-09-01', status: 'LATE' } }).error.code, 'CONFLICT');
  const s = W(h, 'save', { record: { person: 'Ricelle Lim', work_date: '2026-09-01', status: 'LATE' }, expected_version: existing.version });
  assert.equal(s.ok, true); assert.equal(h.log.cells.length, 2);
});

// ---------------------------------------------------------------- layout tolerance and refusal
test('columns can be reordered and extra columns are preserved; a renamed header is reported by name', () => {
  const head = ['Remarks', 'Extra note', 'Date', 'Team Member', 'Position', 'Status', 'Time In', 'Time Out', 'Work Location / Assignment', 'Leave Type'];
  const h = ready({ header: head });
  h.log.cells[0].push({ v: 'Trailing' });
  const s = W(h, 'save', { record: { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT', remarks: 'hi' } });
  assert.equal(s.ok, true, JSON.stringify(s));
  const r = h.log.cells[1]; assert.equal(r[0].v, 'hi'); assert.equal(r[3].v, 'Alex Rivera'); assert.equal(r[5].v, 'Present');
  h.log.cells[0][5] = { v: 'State' };
  const e = W(h, 'list', {}); assert.equal(e.error.code, 'CONFIG_MISSING'); assert.match(e.error.message, /Status/);
});
test('without a bound workbook or an ATTENDANCE_SPREADSHEET_ID the API refuses to guess', () => {
  const h = load({ unbound: true }); const t = h.addUser('lea', 'write');
  assert.equal(h.call({ action: 'meta', token: t }).error.code, 'CONFIG_MISSING');
  h.props.set('ATTENDANCE_SPREADSHEET_ID', 'WB'); assert.equal(h.call({ action: 'meta', token: t }).ok, true);
});

// ---------------------------------------------------------------- delete and filters
test('remove needs the current version, deletes the row and audits it', () => {
  const h = ready(), a = W(h, 'save', { record: { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT' } }).data;
  assert.equal(W(h, 'remove', { person: 'Alex Rivera', work_date: '2026-09-01' }).error.code, 'CONFLICT');
  assert.equal(W(h, 'remove', { person: 'Alex Rivera', work_date: '2026-09-01', expected_version: 'old' }).error.code, 'CONFLICT');
  assert.equal(W(h, 'remove', { person: 'Alex Rivera', work_date: '2026-09-09', expected_version: a.version }).error.code, 'NOT_FOUND');
  assert.equal(W(h, 'remove', { person: 'Alex Rivera', work_date: '2026-09-01', expected_version: a.version }).ok, true);
  assert.equal(h.log.cells.length, 1); assert.equal(vals(h.book.getSheetByName('ATTENDANCE_AUDIT')).slice(1).map(x => x[2]).join(), 'CREATE,DELETE');
});
test('list filters by date range and person', () => {
  const h = ready();
  [['Alex Rivera', '2026-08-31'], ['Alex Rivera', '2026-09-01'], ['Leo Fernandez', '2026-09-01'], ['Alex Rivera', '2026-10-01']].forEach(([p, d]) => W(h, 'save', { record: { person: p, work_date: d, status: 'PRESENT' } }));
  assert.equal(W(h, 'list', { from: '2026-09-01', to: '2026-09-30' }).data.records.length, 2);
  assert.equal(W(h, 'list', { person: 'Alex Rivera' }).data.records.length, 3);
  assert.equal(W(h, 'list', { from: 'bad' }).error.code, 'VALIDATION_ERROR');
});
test('setupAttendanceModule creates only the audit tab and never touches ATTENDANCE_LOG or LISTS', () => {
  const h = load(), log = snap(h.log), lists = snap(h.lists);
  h.ctx.setupAttendanceModule(); h.ctx.setupAttendanceModule();
  assert.equal(snap(h.log), log); assert.equal(snap(h.lists), lists); assert.equal(h.book.getSheetByName('ATTENDANCE_AUDIT').cells.length, 1);
  const tok = h.ctx.addAttendanceUser('lea', 'write');
  assert.equal(h.call({ action: 'meta', token: tok }).data.user, 'lea');
  assert.ok(!h.props.get('ATTENDANCE_TOKENS').includes(tok), 'only the hash is stored');
});
