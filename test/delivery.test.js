// Training Program Delivery module: reporting maths, workflow matrix (client AND server), Conducted rule,
// empty-template handling, and reading hand-typed sheet data. Complements test/att.test.js (unchanged).
const test = require('node:test'), assert = require('node:assert/strict');
const D = require('../js/att/domain'), Svc = require('../js/att/service'), Mem = require('../js/att/adapters/memory');
const Sheets = require('../js/att/adapters/sheets'), { load } = require('./fake-sheets');

const rejects = (p, code) => assert.rejects(p, (e) => e.code === code, 'expected ' + code);
const S = (o) => Object.assign({ id: 'TPD-0001', date: '2026-03-10', program: 'P', status: 'PLANNED', facilitators: [], targetPax: null, actualPax: null, durationHrs: null, postTestAvg: null }, o);
const roster = ['Alex Rivera', 'Ricelle (Rice) Lim', 'Nica Tardio'];
const TODAY = '2026-09-29';

// ------------------------------------------------------------------ report maths
test('report: empty template => no data, and nothing is reported as 0', () => {
  const r = D.summarizeDelivery([], { today: TODAY, year: '2026', roster });
  assert.equal(r.hasData, false); assert.equal(r.total, 0);
  ['deliveryRatePct', 'targetPax', 'actualPax', 'paxFillPct', 'hoursConducted'].forEach(k => assert.equal(r[k], null, k));
  assert.equal(r.postTest.avgPct, null); assert.deepEqual(r.facilitators, []);
  assert.deepEqual(r.rosterWithoutSessions, roster);
});

test('report: counts, delivery rate, pax, post-test are derived from the records', () => {
  const list = [
    S({ id: 'A', status: 'CONDUCTED', date: '2026-03-01', targetPax: 10, actualPax: 8, durationHrs: 2, postTestAvg: 90, facilitators: ['Alex Rivera'] }),
    S({ id: 'B', status: 'CONDUCTED', date: '2026-03-05', targetPax: 20, actualPax: 20, durationHrs: 3, postTestAvg: 80, facilitators: ['Alex Rivera', 'Ricelle Lim'] }),
    S({ id: 'C', status: 'PLANNED', date: '2026-04-01', targetPax: 5 }),                    // date passed, not delivered => overdue
    S({ id: 'D', status: 'PLANNED', date: '2026-12-01', targetPax: 7 }),                    // upcoming
    S({ id: 'E', status: 'POSTPONED', date: '2026-05-01', targetPax: 4 }),                  // passed => due
    S({ id: 'F', status: 'CANCELLED', date: '2026-06-01', targetPax: 99 }),                 // excluded from due and pax
    S({ id: 'G', status: 'PLANNED', date: null }),                                          // undated
  ];
  const r = D.summarizeDelivery(list, { today: TODAY, roster });
  assert.deepEqual(r.byStatus, { PLANNED: 3, CONDUCTED: 2, POSTPONED: 1, CANCELLED: 1 });
  assert.equal(r.total, 7); assert.equal(r.undated, 1);
  assert.equal(r.due, 4); assert.equal(r.overdue, 2); assert.equal(r.upcoming, 1);
  assert.equal(r.deliveryRatePct, 50);
  assert.equal(r.targetPax, 46, 'cancelled target pax excluded'); assert.equal(r.actualPax, 28);
  assert.equal(r.paxFillPct, 93.33);
  assert.equal(r.hoursConducted, 5); assert.deepEqual(r.postTest, { avgPct: 85, sessions: 2 });
});

test('report: nothing due yet => delivery rate is null, not 0 or 100', () => {
  const r = D.summarizeDelivery([S({ status: 'PLANNED', date: '2026-12-01' })], { today: TODAY });
  assert.equal(r.deliveryRatePct, null); assert.equal(r.due, 0); assert.equal(r.upcoming, 1);
});

test('report: period filter by year and month; undated sessions are counted separately, never in a period', () => {
  const list = [S({ id: '1', date: '2026-03-01' }), S({ id: '2', date: '2027-03-01' }), S({ id: '3', date: '2027-04-01' }), S({ id: '4', date: null })];
  assert.equal(D.summarizeDelivery(list, { today: TODAY, year: '2027' }).total, 2);
  assert.equal(D.summarizeDelivery(list, { today: TODAY, year: '2027', month: '04' }).total, 1);
  assert.equal(D.summarizeDelivery(list, { today: TODAY }).total, 4);
  assert.equal(D.summarizeDelivery(list, { today: TODAY, year: '2027' }).undated, 1);
});

test('report: per-facilitator rating uses programs required = target/month x months; caps at 100%; credit per facilitator', () => {
  const list = [S({ id: '1', status: 'CONDUCTED', date: '2026-03-01', facilitators: ['alex  rivera'] }), S({ id: '2', status: 'CONDUCTED', date: '2026-03-02', facilitators: ['Alex Rivera', 'Ricelle Lim'] }),
    S({ id: '3', status: 'CONDUCTED', date: '2026-03-03', facilitators: ['Alex Rivera'] })];
  const m = D.summarizeDelivery(list, { today: TODAY, year: '2026', month: '03', roster });
  assert.equal(m.programsRequiredPerFacilitator, 2);
  const alex = m.facilitators.find(f => f.name === 'Alex Rivera');
  assert.deepEqual([alex.conducted, alex.required, alex.ratingPct, alex.onRoster], [3, 2, 100, true]);
  const rice = m.facilitators.find(f => /Ricelle/.test(f.name));
  assert.equal(rice.onRoster, false, '"Ricelle Lim" is NOT silently merged with "Ricelle (Rice) Lim"');
  assert.equal(rice.ratingPct, 50);
  assert.deepEqual(m.rosterWithoutSessions, ['Ricelle (Rice) Lim', 'Nica Tardio'], 'no data is listed, never scored 0');
  assert.equal(D.summarizeDelivery(list, { today: TODAY, roster }).facilitators[0].ratingPct, null, 'no period => no rating');
});

test('report: months in period - past year 12, current year to date, future year none, month 1', () => {
  const list = [S({ status: 'CONDUCTED', facilitators: ['Alex Rivera'] })];
  const req = (o) => D.summarizeDelivery(list.map(s => Object.assign({}, s, { date: (o.year || '2026') + '-03-10' })), Object.assign({ today: TODAY }, o)).programsRequiredPerFacilitator;
  assert.equal(req({ year: '2025' }), 24); assert.equal(req({ year: '2026' }), 18); assert.equal(req({ year: '2026', month: '03' }), 2); assert.equal(req({ year: '2027' }), 0);
  assert.equal(D.summarizeDelivery([S({ status: 'CONDUCTED', date: '2027-03-10', facilitators: ['Alex Rivera'] })], { today: TODAY, year: '2027' }).facilitators[0].ratingPct, null, 'future year: no requirement yet');
});

test('report: year-agnostic - 2027, 2031 and the current year appear without code changes', () => {
  assert.deepEqual(D.sessionYears([S({ date: '2031-01-01' }), S({ date: '2027-02-02' }), S({ date: null })], '2029-05-05'), ['2031', '2029', '2027']);
  assert.deepEqual(D.sessionYears([], '2030-01-01'), ['2030']);
  const r = D.summarizeDelivery([S({ status: 'CONDUCTED', date: '2031-01-01' })], { today: '2031-06-06', year: '2031' });
  assert.equal(r.deliveryRatePct, 100);
});

// ------------------------------------------------------------------ workflow matrix: every pair, client and server
const CODES = D.SESSION_STATUSES.map(s => s.code);
const ALLOWED = { PLANNED: ['CONDUCTED', 'POSTPONED', 'CANCELLED'], POSTPONED: ['PLANNED', 'CANCELLED'], CONDUCTED: [], CANCELLED: [] };
function stack(opts) { const h = load(opts); const adapter = Sheets.create({ apiUrl: 'x', token: 'secret-token', actor: 't', fetch: h.fetchImpl }); return { h, adapter, s: Svc.create(adapter), row: (i = 1) => h.books.SESSIONS.getSheetByName('SESSION_LOG').rows[i] }; }
async function reach(s, status) {   // walk a fresh session to `status` using only legal moves
  const c = await s.createSession({ program: 'M', date: '2026-03-10' });
  const path = { PLANNED: [], CONDUCTED: ['CONDUCTED'], POSTPONED: ['POSTPONED'], CANCELLED: ['CANCELLED'] }[status];
  let cur = c; for (const step of path) cur = await s.moveSession(c.id, step); return cur;
}

test('workflow: all 16 from->to pairs behave per the matrix through the service + real Code.gs', async () => {
  for (const from of CODES) for (const to of CODES) {
    const { s, row } = stack(); const cur = await reach(s, from);
    const before = JSON.stringify(row());
    if (from === to) { const same = await s.moveSession(cur.id, to); assert.equal(same.status, from, `${from}->${to} is a no-op`); continue; }
    if (ALLOWED[from].includes(to)) {
      const m = await s.moveSession(cur.id, to); assert.equal(m.status, to, `${from}->${to}`);
      assert.equal(row()[10], D.labelOf(D.SESSION_STATUSES, to), `${from}->${to} written to the sheet`);
    } else {
      await rejects(s.moveSession(cur.id, to), 'TRANSITION');
      assert.equal(JSON.stringify(row()), before, `${from}->${to} refused and the sheet row is untouched`);
    }
  }
});

test('workflow: the SERVER refuses illegal moves even when the client is bypassed (all pairs)', async () => {
  for (const from of CODES) for (const to of CODES) {
    if (from === to || ALLOWED[from].includes(to)) continue;
    const { s, adapter, row } = stack(); const cur = await reach(s, from), before = JSON.stringify(row());
    await rejects(adapter.updateSession(cur.id, { status: to }, cur.version), 'TRANSITION');
    assert.equal(JSON.stringify(row()), before, `${from}->${to}`);
  }
});

test('workflow: a final session is never silently reopened, edited into another state, or re-dated to nothing', async () => {
  const { s } = stack(); const done = await reach(s, 'CONDUCTED');
  await rejects(s.updateSession(done.id, { status: 'PLANNED' }), 'TRANSITION');
  await rejects(s.updateSession(done.id, { date: '' }), 'VALIDATION');                  // would leave Conducted without a date
  const ok = await s.updateSession(done.id, { actualPax: 12 }); assert.equal(ok.status, 'CONDUCTED');
});

// ------------------------------------------------------------------ Conducted validation
test('conducted: needs a date - refused by the service and by the server, nothing written', async () => {
  const { s, adapter, row } = stack();
  const c = await s.createSession({ program: 'No date yet' });
  const before = JSON.stringify(row());
  await rejects(s.moveSession(c.id, 'CONDUCTED'), 'VALIDATION');
  await rejects(adapter.updateSession(c.id, { status: 'CONDUCTED' }, c.version), 'VALIDATION');
  await rejects(adapter.createSession({ program: 'Born conducted', status: 'CONDUCTED', date: '2026-03-01' }), 'VALIDATION');
  assert.equal(JSON.stringify(row()), before);
  const m = await s.moveSession(c.id, 'CONDUCTED', { patch: { date: '2026-03-02' } });   // date supplied with the move
  assert.equal(m.status, 'CONDUCTED'); assert.equal(m.date, '2026-03-02'); assert.equal(row()[10], 'Conducted');
});

// ------------------------------------------------------------------ empty template and hand-typed data
test('empty template: pre-numbered rows are not sessions; report says "no data"; IDs are preserved on first use', async () => {
  const { s, row } = stack();
  assert.deepEqual(await s.listSessions(), []);
  const r = await s.deliveryReport({});
  assert.equal(r.hasData, false); assert.equal(r.deliveryRatePct, null); assert.deepEqual(r.byStatus, { PLANNED: 0, CONDUCTED: 0, POSTPONED: 0, CANCELLED: 0 });
  const first = await s.createSession({ program: 'First' });
  assert.equal(first.id, 'TPD-0001'); assert.equal(row(1)[0], 'TPD-0001'); assert.equal(row(2)[0], 'TPD-0002'); assert.equal(row(2)[2], '', 'other template rows untouched');
});

test('empty template: a row with only a status or only numbers is still not a session', async () => {
  const { s, h } = stack(); const rows = h.books.SESSIONS.getSheetByName('SESSION_LOG').rows;
  rows[1][10] = 'Planned'; rows[2][7] = 10; rows[2][8] = 5; rows[3][11] = 88;
  assert.deepEqual(await s.listSessions(), []);
  assert.equal((await s.deliveryReport({})).hasData, false);
});

test('hand-typed data: dd/mm/yyyy text, real Date cells, blank status and numeric strings are read correctly', async () => {
  const { s, h } = stack(); const rows = h.books.SESSIONS.getSheetByName('SESSION_LOG').rows;
  rows[1].splice(0, 13, 'TPD-0001', '10/03/2026', 'Service Steps', 'Service Steps', 'Figaro', 'Ayala', 'Alex Rivera, Ricelle (Rice) Lim', '12', '10', '2', 'Conducted', '91.5', '');
  rows[2].splice(0, 13, 'TPD-0002', new Date(2026, 3, 5), 'Orientation batch', '', "Angel's Pizza", '', 'Alex Rivera', 15, '', '', '', '', '');   // blank status => Planned
  rows[3].splice(0, 13, 'TPD-0003', '', 'Undated idea', '', '', '', '', '', '', '', 'Cancelled', '', '');
  const list = await s.listSessions(); assert.equal(list.length, 3);
  const a = list.find(x => x.id === 'TPD-0001'), b = list.find(x => x.id === 'TPD-0002');
  assert.deepEqual([a.date, a.status, a.targetPax, a.actualPax, a.postTestAvg, a.facilitators], ['2026-03-10', 'CONDUCTED', 12, 10, 91.5, ['Alex Rivera', 'Ricelle (Rice) Lim']]);
  assert.deepEqual([b.date, b.status, b.brand], ['2026-04-05', 'PLANNED', 'ANGELS_PIZZA']);
  const r = await s.deliveryReport({ year: '2026', today: TODAY });
  assert.equal(r.total, 2); assert.equal(r.undated, 1); assert.equal(r.byStatus.CONDUCTED, 1);
  assert.equal(r.actualPax, 10); assert.equal(r.postTest.avgPct, 91.5);
  assert.ok(r.facilitators.every(f => f.onRoster), 'names match the LISTS roster exactly');
});

test('scope: no trainee-attendance surface was added by this module', () => {
  const s = Svc.create(Mem.create({}));
  Object.keys(s).forEach(k => assert.ok(!/participant|trainee|sessionAttendance/i.test(k), k));
  assert.equal(typeof s.deliveryReport, 'function');
});
