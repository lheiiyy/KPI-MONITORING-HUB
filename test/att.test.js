const test = require('node:test'), assert = require('node:assert/strict');
const D = require('../js/att/domain'), Svc = require('../js/att/service'), Mem = require('../js/att/adapters/memory');
const Sheets = require('../js/att/adapters/sheets'), { load } = require('./fake-sheets');

const seed = { teamMembers: [{ name: 'Alex Rivera', position: 'Supervisor' }, { name: 'Ricelle Lim', position: 'Asst. Supervisor' }], sessionFacilitators: ['Alex Rivera', 'Ricelle (Rice) Lim'] };
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code, 'expected ' + code);

// ---------------------------------------------------------------- domain
test('domain: date and time parsing', () => {
  assert.equal(D.parseDate('2026-09-10'), '2026-09-10');
  assert.equal(D.parseDate('10/09/2026'), '2026-09-10');
  assert.equal(D.parseDate('31/02/2026'), null);
  assert.equal(D.parseDate('nonsense'), null);
  assert.equal(D.parseTime('8:05'), '08:05');
  assert.equal(D.parseTime('24:00'), null);
});
test('domain: workflow allows only the documented moves', () => {
  assert.ok(D.canTransition('PLANNED', 'CONDUCTED'));
  assert.ok(D.canTransition('POSTPONED', 'PLANNED'));
  assert.ok(!D.canTransition('CONDUCTED', 'PLANNED'));
  assert.ok(!D.canTransition('CANCELLED', 'PLANNED'));
  assert.deepEqual(D.SESSION_STATUSES.map(s => s.code), ['PLANNED', 'CONDUCTED', 'POSTPONED', 'CANCELLED']);
});
test('domain: KRA matches the documented formula and never reports 0 for no data', () => {
  const rows = ['PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'WORK_FROM_HOME', 'REST_DAY', 'HOLIDAY', 'ON_LEAVE'].map(status => ({ status }));
  const k = D.computeKra(rows);
  assert.deepEqual([k.workingDays, k.daysPresent, k.lates, k.absences, k.leaveDays, k.ratingPct], [10, 8.5, 1, 1, 1, 65]);
  assert.equal(D.computeKra([{ status: 'REST_DAY' }]).ratingPct, null);
  assert.equal(D.computeKra([]).ratingPct, null);
  assert.equal(D.computeKra([{ status: 'ABSENT' }, { status: 'ABSENT' }]).ratingPct, 0, 'floored at 0');
});
test('domain: facilitator attendance validation', () => {
  const ok = { person: 'Alex Rivera', date: '2026-09-01', status: 'PRESENT', timeIn: '8:05', timeOut: '17:00' };
  assert.ok(D.validateFacilitatorAttendance(ok).ok);
  assert.ok(!D.validateFacilitatorAttendance({ ...ok, timeOut: '07:00' }).ok);
  assert.ok(!D.validateFacilitatorAttendance({ ...ok, leaveType: 'SICK' }).ok, 'leave type only when on leave');
  assert.ok(D.validateFacilitatorAttendance({ ...ok, status: 'ON_LEAVE', leaveType: 'SICK' }).ok);
  assert.ok(!D.validateFacilitatorAttendance({ ...ok, status: 'SKIVING' }).ok);
});

// ---------------------------------------------------------------- service (memory adapter)
function svc() { return Svc.create(Mem.create(seed)); }

test('service: a session is created Planned and moves Planned -> Conducted', async () => {
  const s = svc();
  const c = await s.createSession({ program: 'Service Steps', date: '2026-09-10', brand: 'FIGARO', facilitators: ['alex  rivera'] });
  assert.equal(c.status, 'PLANNED'); assert.deepEqual(c.facilitators, ['Alex Rivera'], 'canonical roster spelling');
  const m = await s.moveSession(c.id, 'CONDUCTED', { patch: { actualPax: 12 }, expectedVersion: c.version });
  assert.equal(m.status, 'CONDUCTED'); assert.equal(m.actualPax, 12);
});
test('service: illegal moves, missing date, unknown roster names and stale versions are refused', async () => {
  const s = svc();
  await rejects(s.createSession({ program: '' }), 'VALIDATION');
  await rejects(s.createSession({ program: 'X', facilitators: ['Nobody Here'] }), 'VALIDATION');
  await rejects(s.createSession({ program: 'X', status: 'CONDUCTED', date: '2026-09-01' }), 'VALIDATION');
  const c = await s.createSession({ program: 'No date yet' });
  await rejects(s.moveSession(c.id, 'CONDUCTED'), 'VALIDATION');                         // needs a date
  const done = await s.moveSession(c.id, 'CONDUCTED', { patch: { date: '2026-09-02' } });
  await rejects(s.moveSession(c.id, 'PLANNED'), 'TRANSITION');                            // final state
  await rejects(s.moveSession(c.id, 'CANCELLED'), 'TRANSITION');
  const p = await s.createSession({ program: 'Stale' });
  await s.updateSession(p.id, { venue: 'HQ' });
  await rejects(s.moveSession(p.id, 'POSTPONED', { expectedVersion: p.version }), 'CONFLICT');
  await rejects(s.moveSession('TPD-9999', 'CANCELLED'), 'NOT_FOUND');
  assert.equal(done.status, 'CONDUCTED');
});
test('service: a postponed session can be re-planned', async () => {
  const s = svc(), c = await s.createSession({ program: 'P' });
  await s.moveSession(c.id, 'POSTPONED'); assert.equal((await s.moveSession(c.id, 'PLANNED')).status, 'PLANNED');
});
test('service: status in an edit goes through the workflow rules', async () => {
  const s = svc(), c = await s.createSession({ program: 'P', date: '2026-09-01' });
  await s.moveSession(c.id, 'CANCELLED');
  await rejects(s.updateSession(c.id, { status: 'PLANNED' }), 'TRANSITION');
});
test('service: schedule warnings for double-booking and days off', async () => {
  const s = svc();
  await s.createSession({ program: 'A', date: '2026-09-10', facilitators: ['Alex Rivera'] });
  const b = await s.createSession({ program: 'B', date: '2026-09-10', facilitators: ['Alex Rivera'] });
  await s.saveFacilitatorAttendance({ person: 'Alex Rivera', date: '2026-09-10', status: 'ON_LEAVE', leaveType: 'SICK' });
  const w = await s.scheduleWarnings(b);
  assert.equal(w.length, 2); assert.match(w.join(' '), /also on TPD-0001/); assert.match(w.join(' '), /On Leave/);
});
test('service: facilitator daily attendance is unique per person/day and feeds the monthly KRA', async () => {
  const s = svc();
  for (const [d, st] of [['2026-09-01', 'PRESENT'], ['2026-09-02', 'LATE'], ['2026-09-03', 'ABSENT'], ['2026-09-04', 'PRESENT']]) await s.saveFacilitatorAttendance({ person: 'Alex Rivera', date: d, status: st });
  await s.saveFacilitatorAttendance({ person: 'alex rivera', date: '2026-09-04', status: 'HALF_DAY' }); // same day: replaced, not duplicated
  await rejects(s.saveFacilitatorAttendance({ person: 'Unknown Person', date: '2026-09-04', status: 'PRESENT' }), 'VALIDATION');
  const k = await s.kraMonthly('2026-09');
  assert.equal(k.length, 1); assert.equal(k[0].workingDays, 4);
  assert.deepEqual([k[0].daysPresent, k[0].lates, k[0].absences, k[0].ratingPct], [2.5, 1, 1, 12.5]);
  assert.deepEqual(await s.kraMonthly('2026-10'), [], 'no rows -> no entry, not zero');
});
test('scope: only facilitator / T&D team attendance exists; there is no trainee attendance API', () => {
  const s = svc();
  ['saveSessionAttendance', 'listSessionAttendance', 'deleteSessionAttendance', 'sessionTurnout'].forEach(m => assert.equal(s[m], undefined, m));
  assert.equal(D.validateSessionAttendance, undefined);
  assert.equal(typeof s.saveFacilitatorAttendance, 'function');
});

// ---------------------------------------------------------------- Apps Script backend, end to end
function stack(opts) {
  const h = load(opts), adapter = Sheets.create({ apiUrl: 'https://example/exec', token: 'secret-token', actor: 'tester', fetch: h.fetchImpl });
  return { h, adapter, s: Svc.create(adapter), rows: (book, tab) => h.books[book].getSheetByName(tab).rows };
}

test('backend: enums and transitions in Code.gs equal domain.js', () => {
  const { h } = stack(), pairs = (l) => l.map(x => [x.code, x.label]);
  const E = JSON.parse(JSON.stringify(h.ctx.ENUMS));
  assert.deepEqual(E.sessionStatus, pairs(D.SESSION_STATUSES)); assert.deepEqual(E.facStatus, pairs(D.FAC_STATUSES));
  assert.deepEqual(E.workLocation, pairs(D.WORK_LOCATIONS)); assert.deepEqual(E.leaveType, pairs(D.LEAVE_TYPES));
  assert.equal(E.partStatus, undefined); assert.deepEqual(E.brand, pairs(D.BRANDS));
  assert.deepEqual(E.trainingType, pairs(D.TRAINING_TYPES)); assert.deepEqual(JSON.parse(JSON.stringify(h.ctx.TRANSITIONS)), D.TRANSITIONS);
});
test('backend: refuses bad or missing tokens, and everything when no token is configured', async () => {
  const { h } = stack(), bad = Sheets.create({ apiUrl: 'x', token: 'nope', fetch: h.fetchImpl });
  await rejects(bad.listSessions(), 'AUTH');
  const open = stack({ props: { API_TOKEN: '' } });
  await rejects(open.adapter.listSessions(), 'AUTH');
});
test('backend: empty template yields no sessions and reads the roster from LISTS', async () => {
  const { s, adapter, h } = stack();
  assert.deepEqual(await s.listSessions(), [], 'blank pre-numbered rows are not sessions');
  assert.deepEqual(await adapter.listFacilitatorAttendance({}), [], 'no attendance rows in a fresh template');
  const raw = JSON.parse(h.ctx.doPost({ postData: { contents: JSON.stringify({ token: 'secret-token', action: 'listSessionAttendance', params: { sessionId: 'TPD-0001' } }) } }).text);
  assert.equal(raw.ok, false); assert.match(raw.error.message, /Unknown action/, 'trainee attendance is not served');
  const ref = await s.reference();
  assert.deepEqual(ref.teamMembers.map(p => p.name), ['Alex Rivera', 'Ricelle Lim']);
  assert.deepEqual(ref.sessionFacilitators, ['Alex Rivera', 'Ricelle (Rice) Lim']);
});
test('backend: a new session fills the first empty pre-numbered row, then appends past the template', async () => {
  const { s, rows } = stack({ emptySlots: 2 });
  const a = await s.createSession({ program: 'A', date: '2026-09-10', brand: 'FIGARO', trainingType: 'SERVICE_STEPS', targetPax: 10, facilitators: ['Alex Rivera'] });
  const b = await s.createSession({ program: 'B' });
  const c = await s.createSession({ program: 'C' });
  assert.deepEqual([a.id, b.id, c.id], ['TPD-0001', 'TPD-0002', 'TPD-0003']);
  const r = rows('SESSIONS', 'SESSION_LOG');
  assert.equal(r.length, 4);
  assert.equal(r[1][4], 'Figaro', 'enum written as the sheet label'); assert.equal(r[1][3], 'Service Steps');
  assert.equal(r[1][6], 'Alex Rivera'); assert.equal(r[1][10], 'Planned');
  assert.equal((await s.listSessions()).length, 3);
});
test('backend: Kanban move persists to the sheet, is audited, and rejects stale writers', async () => {
  const { s, rows } = stack();
  const c = await s.createSession({ program: 'Refresh', date: '2026-09-12' });
  const moved = await s.moveSession(c.id, 'CONDUCTED', { patch: { actualPax: 9, postTestAvg: 88.5 }, expectedVersion: c.version });
  assert.equal(moved.status, 'CONDUCTED');
  const r = rows('SESSIONS', 'SESSION_LOG')[1];
  assert.equal(r[10], 'Conducted'); assert.equal(r[8], 9); assert.equal(r[11], 88.5);
  await rejects(s.moveSession(c.id, 'CONDUCTED', { expectedVersion: c.version }), 'CONFLICT'); // c.version is now stale
  await rejects(s.moveSession(c.id, 'PLANNED'), 'TRANSITION');
  const audit = rows('SESSIONS', 'AUDIT_LOG');
  assert.deepEqual(audit.slice(1).map(a => a[4]), ['CREATE', 'STATUS_CHANGE']);
  assert.equal(audit[2][1], 'tester');
});
test('backend: the server enforces the rules even if the client does not', async () => {
  const { adapter } = stack();
  const c = await adapter.createSession({ program: 'X', date: '2026-09-01' });
  await rejects(adapter.updateSession(c.id, { status: 'BOGUS' }, c.version), 'VALIDATION');
  await rejects(adapter.updateSession(c.id, { date: '31/02/2026' }, c.version), 'VALIDATION');
  await adapter.updateSession(c.id, { status: 'CANCELLED' }, c.version);
  const cur = await adapter.getSession(c.id);
  await rejects(adapter.updateSession(c.id, { status: 'PLANNED' }, cur.version), 'TRANSITION');
  await rejects(adapter.createSession({ program: 'Y', status: 'CONDUCTED' }), 'VALIDATION');
  await rejects(adapter.upsertFacilitatorAttendance({ person: 'Alex Rivera', date: '2026-09-01', status: 'PRESENT', leaveType: 'SICK' }), 'VALIDATION');
});
test('backend: facilitator daily attendance upserts by person+date and fills Position from LISTS', async () => {
  const { s, rows } = stack();
  await s.saveFacilitatorAttendance({ person: 'Alex Rivera', date: '2026-09-01', status: 'LATE', timeIn: '8:35', workLocation: 'HEAD_OFFICE' });
  await s.saveFacilitatorAttendance({ person: 'Alex Rivera', date: '2026-09-01', status: 'PRESENT', timeIn: '8:00', timeOut: '17:00' });
  await s.saveFacilitatorAttendance({ person: 'Ricelle Lim', date: '2026-09-01', status: 'ON_LEAVE', leaveType: 'VACATION' });
  const r = rows('FAC', 'ATTENDANCE_LOG');
  assert.equal(r.length, 3, 'header + 2 rows, the same-day edit did not duplicate');
  assert.equal(r[1][2], 'Supervisor'); assert.equal(r[1][3], 'Present'); assert.equal(r[1][7] || '', '');
  assert.equal(r[2][7], 'Vacation Leave');
  const list = await s.listFacilitatorAttendance({ from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(list.map(x => [x.person, x.status, x.timeIn]), [['Alex Rivera', 'PRESENT', '08:00'], ['Ricelle Lim', 'ON_LEAVE', null]]);
  assert.equal((await s.kraMonthly('2026-09')).length, 2);
  await s.deleteFacilitatorAttendance('Alex Rivera', '2026-09-01');
  assert.equal(rows('FAC', 'ATTENDANCE_LOG').length, 2);
  await rejects(s.deleteFacilitatorAttendance('Alex Rivera', '2026-09-01'), 'NOT_FOUND');
});
test('backend: scheduling a session never touches the facilitator attendance sheet', async () => {
  const { s, rows } = stack();
  await s.createSession({ program: 'P', date: '2026-09-01', facilitators: ['Alex Rivera'] });
  assert.equal(rows('FAC', 'ATTENDANCE_LOG').length, 1, 'header only');
});
test('backend: reordered columns and unknown extra columns are handled; a renamed header fails loudly', async () => {
  const h = load(), sheet = h.books.SESSIONS.getSheetByName('SESSION_LOG');
  sheet.rows.forEach(r => { const x = r.splice(2, 1)[0]; r.push(x); });        // move "Program / Module" to the end
  sheet.rows[0].push('Notes (extra)');
  const s = Svc.create(Sheets.create({ apiUrl: 'x', token: 'secret-token', fetch: h.fetchImpl }));
  const c = await s.createSession({ program: 'Reordered', date: '2026-09-01' });
  assert.equal(c.program, 'Reordered'); assert.equal(sheet.rows[1][sheet.rows[0].indexOf('Program / Module')], 'Reordered');
  sheet.rows[0][sheet.rows[0].indexOf('Status')] = 'State';
  await rejects(s.listSessions(), 'SERVER');
});
test('sheets adapter: network failure and non-JSON responses surface as typed errors', async () => {
  await rejects(Sheets.create({ apiUrl: 'x', token: 't', fetch: async () => { throw new Error('offline'); } }).listSessions(), 'NETWORK');
  await rejects(Sheets.create({ apiUrl: 'x', token: 't', fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) }).listSessions(), 'SERVER');
  await rejects(Sheets.create({ apiUrl: 'x', token: 't', fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }).listSessions(), 'NETWORK');
});

test('backend: optimistic concurrency is enforced server-side, independent of the service layer', async () => {
  const { adapter } = stack();
  const c = await adapter.createSession({ program: 'Race', date: '2026-09-01' });
  await adapter.updateSession(c.id, { venue: 'A' }, c.version);                       // first writer wins
  await rejects(adapter.updateSession(c.id, { venue: 'B' }, c.version), 'CONFLICT');  // second writer holds a stale version
  const f = await adapter.upsertFacilitatorAttendance({ person: 'Alex Rivera', date: '2026-09-01', status: 'PRESENT' });
  await adapter.upsertFacilitatorAttendance({ person: 'Alex Rivera', date: '2026-09-01', status: 'LATE' }, f.version);
  await rejects(adapter.upsertFacilitatorAttendance({ person: 'Alex Rivera', date: '2026-09-01', status: 'ABSENT' }, f.version), 'CONFLICT');
});
