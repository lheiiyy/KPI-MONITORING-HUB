const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const L = require('../js/attendance-logic'), Api = require('../js/attendance-api');
const { load } = require('./attendance-gas-harness');
const identity = L.createIdentity(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'team-identity.json'), 'utf8')));
const rec = (person, work_date, status) => ({ person, work_date, status });

test('dates and times: sheet formats are normalised, junk is rejected', () => {
  assert.equal(L.parseDate('2026-09-10'), '2026-09-10'); assert.equal(L.parseDate('10/09/2026'), '2026-09-10');
  assert.equal(L.parseDate('31/02/2026'), null); assert.equal(L.parseDate('2026-13-01'), null); assert.equal(L.parseDate(''), null);
  assert.deepEqual(['8:05', '08:05', '8:05:59', '8:05 AM', '1:30 pm', '12:00 AM', '12:00 PM', '23:59'].map(L.parseTime), ['08:05', '08:05', '08:05', '08:05', '13:30', '00:00', '12:00', '23:59']);
  assert.deepEqual(['24:00', '8:60', '13:00 PM', '0:30 AM', 'noon', '8'].map(L.parseTime), [null, null, null, null, null, null]);
  assert.equal(L.addDays('2026-02-28', 1), '2026-03-01'); assert.equal(L.addDays('2026-01-01', -1), '2025-12-31');
  assert.deepEqual(L.monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' }); assert.equal(L.monthRange('2026-13'), null);
  assert.equal(L.addMonths('2026-12', 1), '2027-01'); assert.equal(L.addMonths('2026-01', -1), '2025-12');
});

test('identity: only listed names resolve, case/spacing tolerant, never by similarity; each link says CONFIRMED or PROPOSED', () => {
  const r = (n) => identity.resolve(n);
  assert.deepEqual([r('Ricelle Lim').person_id, r('Ricelle Lim').status, r('Ricelle Lim').canonical_name], ['RICE', 'PROPOSED', 'Ricelle Lim']);
  assert.deepEqual([r('  ricelle  (rice) LIM ').person_id, r('Ricelle (Rice) Lim').status], ['RICE', 'CONFIRMED']);
  assert.equal(r('Rice Lim').person_id, 'RICE'); assert.equal(r('Alliana Kristine').person_id, 'YANA'); assert.equal(r('Ver Guerrero').person_id, 'VER');
  assert.equal(r('Jeliver Guerrero').status, 'PROPOSED'); assert.equal(r('Nica Tardio').person_id, 'NICA');
  ['Ricelle', 'Rice', 'Ricelle L', 'Jeliver', 'Guerrero', 'Sky', 'Alex'].forEach(n => assert.equal(r(n), null, n + ' must not be guessed'));
  assert.equal(identity.ids().length, 12);
  const hub = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kpi-monthly.json'), 'utf8')).roster.map(p => p.id);
  identity.ids().filter(i => i !== 'NICA').forEach(id => assert.ok(hub.includes(id), id + ' is a hub roster id'));
});

test('alias spellings can never create a second person', () => {
  const g = L.groupByPerson([rec('Ricelle Lim', '2026-09-01', 'PRESENT'), rec('Ricelle (Rice) Lim', '2026-09-02', 'PRESENT'), rec('Rice Lim', '2026-09-03', 'LATE'), rec('Stranger', '2026-09-01', 'PRESENT'), rec('stranger ', '2026-09-02', 'PRESENT')], identity);
  assert.equal(g.length, 2); const rice = g.find(x => x.person_id === 'RICE');
  assert.deepEqual([rice.records.length, rice.name, rice.via_proposed_alias], [3, 'Ricelle Lim', true]);
  const s = g.find(x => !x.person_id); assert.equal(s.records.length, 2, 'unknown names group by normalised text but are never merged into a real person');
});

test('validation: required fields, formats and the leave-type rule', () => {
  const ok = { person: 'Alex Rivera', work_date: '2026-09-01', status: 'PRESENT', time_in: '8:05 AM', time_out: '5:00 PM' };
  const v = L.validateRecord(ok); assert.equal(v.ok, true); assert.deepEqual([v.value.time_in, v.value.time_out], ['08:05', '17:00']);
  assert.equal(L.validateRecord({ ...ok, status: 'ON_LEAVE', leave_type: 'SICK' }).ok, true);
  assert.equal(L.validateRecord({ ...ok, status: 'ON_LEAVE' }).ok, true, 'Leave Type is optional');
  assert.equal(L.validateRecord({}).errors.length, 3);
  assert.equal(L.validateRecord({ ...ok, time_in: '17:00', time_out: '17:00' }).ok, true, 'equal times are allowed');
});

// ---------------------------------------------------------------- KRA
test('KRA: formula terms are confirmed; every other treatment is flagged provisional with its reason', () => {
  const only = L.computeKra([{ status: 'PRESENT' }, { status: 'PRESENT' }, { status: 'ABSENT' }, { status: 'PRESENT' }]);
  assert.deepEqual([only.working_days, only.days_present, only.absences, only.rating_pct, only.provisional, only.assumptions.length], [4, 3, 1, 50, false, 0]);
  const mixed = L.computeKra('PRESENT PRESENT PRESENT PRESENT PRESENT PRESENT LATE HALF_DAY ABSENT WORK_FROM_HOME REST_DAY HOLIDAY ON_LEAVE'.split(' ').map(status => ({ status })));
  assert.deepEqual([mixed.working_days, mixed.days_present, mixed.lates, mixed.absences, mixed.rating_pct, mixed.provisional], [10, 8.5, 1, 1, 65, true]);
  assert.deepEqual(mixed.assumptions.map(a => a.status).sort(), ['HALF_DAY', 'HOLIDAY', 'LATE', 'ON_LEAVE', 'REST_DAY', 'WORK_FROM_HOME']);
  assert.ok(mixed.assumptions.every(a => a.note.length > 20));
  assert.equal(mixed.status_counts.PRESENT, 6);
  assert.equal(L.computeKra([{ status: 'OFFICIAL_BUSINESS' }]).provisional, true);
  assert.match(L.POLICY.formula, /Days Present - Lates - Absences/);
});
test('KRA: no data is null, never zero; a negative result is floored and says so', () => {
  assert.equal(L.computeKra([]).rating_pct, null); assert.equal(L.computeKra([]).records, 0);
  assert.equal(L.computeKra([{ status: 'REST_DAY' }, { status: 'HOLIDAY' }]).rating_pct, null);
  const neg = L.computeKra([{ status: 'ABSENT' }, { status: 'ABSENT' }]);
  assert.deepEqual([neg.raw_pct, neg.rating_pct], [-100, 0]); assert.ok(neg.assumptions.some(a => /floored/.test(a.note)));
});
test('KRA: HRAD can change a treatment without code changes; the result follows the supplied policy', () => {
  const policy = JSON.parse(JSON.stringify(L.POLICY)); policy.treatments.ON_LEAVE.working = true; policy.treatments.ON_LEAVE.confirmed = true;
  const rows = [{ status: 'PRESENT' }, { status: 'ON_LEAVE' }];
  assert.equal(L.computeKra(rows).rating_pct, 100); assert.equal(L.computeKra(rows, policy).rating_pct, 50);
});
test('kraMonthly: per canonical person, first duplicate counts and is reported, bad rows are reported, nobody is invented', () => {
  const r = L.kraMonthly([rec('Alex Rivera', '2026-09-01', 'PRESENT'), rec('Alex Rivera', '2026-09-02', 'ABSENT'), rec('Alex Rivera', '2026-09-02', 'PRESENT'), rec('Ricelle Lim', '2026-09-01', 'PRESENT'),
    rec('Ricelle (Rice) Lim', '2026-09-02', 'LATE'), rec('Ghost', '2026-09-01', 'PRESENT'), rec('Leo Fernandez', '2026-09-01', null)], identity);
  const by = Object.fromEntries(r.results.map(x => [x.name, x]));
  assert.deepEqual(Object.keys(by).sort(), ['Alex Rivera', 'Ghost', 'Leo Fernandez', 'Ricelle Lim']);
  assert.deepEqual([by['Alex Rivera'].working_days, by['Alex Rivera'].absences, by['Alex Rivera'].rating_pct], [2, 1, 0], 'first row for 09-02 (Absent) counts');
  assert.equal(by['Ricelle Lim'].records, 2, 'two spellings, one person');
  assert.equal(by['Leo Fernandez'].rating_pct, null, 'only an invalid row: no data, not zero');
  assert.deepEqual([r.issues.duplicates.length, r.issues.unresolved_names, r.issues.proposed_alias_matches, r.issues.invalid_status_rows], [1, ['Ghost'], ['Ricelle Lim'], 1]);
  assert.deepEqual(L.kraMonthly([], identity), { results: [], issues: { duplicates: [], unresolved_names: [], proposed_alias_matches: [], invalid_status_rows: 0 } });
});

// ---------------------------------------------------------------- API client
function api(fetchImpl, over) { return Api.create(Object.assign({ url: 'https://x/exec', getToken: () => 'T', fetchImpl }, over)); }
const okRes = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data }) });
test('api client: flat text/plain body, token in the body never the URL, save/remove params', async () => {
  const calls = []; const a = api(async (url, init) => { calls.push({ url, init }); return okRes({}); });
  await a.saveRecord({ person: 'Alex Rivera' }, 'v1'); await a.saveRecord({ person: 'Alex Rivera' }); await a.deleteRecord('Alex Rivera', '2026-09-01', 'v1'); await a.listRecords({ from: '2026-09-01' }); await a.getMeta();
  const bodies = calls.map(c => JSON.parse(c.init.body));
  assert.deepEqual(bodies.map(b => b.action), ['save', 'save', 'remove', 'list', 'meta']);
  assert.equal(bodies[0].expected_version, 'v1'); assert.equal(bodies[1].expected_version, null);
  assert.deepEqual([bodies[2].person, bodies[2].work_date, bodies[2].expected_version], ['Alex Rivera', '2026-09-01', 'v1']);
  calls.forEach(c => { assert.equal(c.url, 'https://x/exec'); assert.match(c.init.headers['Content-Type'], /^text\/plain/); assert.equal(JSON.parse(c.init.body).token, 'T'); });
});
test('api client: unconfigured, no token, offline, non-JSON and error envelopes each give a distinct code', async () => {
  const code = (p) => p.then(() => 'ok', e => e.code);
  assert.equal(await code(api(null, { url: '' }).getMeta()), 'CONFIG_MISSING');
  assert.equal(await code(api(async () => okRes({}), { getToken: () => '' }).getMeta()), 'UNAUTHORIZED');
  assert.equal(await code(api(async () => { throw new Error('offline'); }).getMeta()), 'BACKEND_UNAVAILABLE');
  assert.equal(await code(api(async () => ({ ok: true, status: 200, text: async () => '<html>Sign in</html>' })).getMeta()), 'BAD_RESPONSE');
  const env = (c, d) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: { code: c, message: 'm', details: d } }) });
  assert.equal(await code(api(env('CONFLICT')).getMeta()), 'CONFLICT');
  const e = await api(env('VALIDATION_ERROR', [{ field: 'status', message: 'x' }])).saveRecord({}).catch(x => x); assert.equal(e.details[0].field, 'status');
});

// ---------------------------------------------------------------- client <-> real backend code
test('end to end: api client -> real .gs -> fake sheet. Empty sheet is empty; saved records come back and feed the KRA', async () => {
  const h = load(); const tok = h.addUser('lea', 'write');
  const a = Api.create({ url: 'u', getToken: () => tok, fetchImpl: h.fetchImpl });
  const meta = await a.getMeta(); assert.equal(meta.team_members.length, 12);
  const empty = await a.listRecords({ from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual([empty.records.length, empty.total_rows_in_sheet], [0, 0]);
  assert.deepEqual(L.kraMonthly(empty.records, identity).results, [], 'an empty sheet yields no results, not zeros');
  for (const [d, s] of [['2026-09-01', 'PRESENT'], ['2026-09-02', 'LATE'], ['2026-09-03', 'ABSENT'], ['2026-09-04', 'PRESENT']]) await a.saveRecord(rec('Alex Rivera', d, s));
  const back = await a.listRecords({ from: '2026-09-01', to: '2026-09-30' });
  assert.equal(back.records.length, 4);
  const k = L.kraMonthly(back.records, identity).results[0];
  assert.deepEqual([k.person_id, k.working_days, k.days_present, k.lates, k.absences, k.rating_pct, k.provisional], ['ALEX', 4, 3, 1, 1, 25, true]);
  const err = await a.saveRecord({ person: 'Alex Rivera', work_date: '2026-09-09', status: 'PRESENT', time_in: '9:00', time_out: '8:00' }).catch(e => e);
  assert.equal(err.code, 'VALIDATION_ERROR'); assert.equal(err.details[0].field, 'time_out');
});

// ---------------------------------------------------------------- dashboard feed
test('dashboard feed: built from the sheet\'s records, keyed by person id, no names; an empty sheet gives no results', async () => {
  const { build } = require('../scripts/build_attendance_monthly');
  const h = load(); const tok = h.addUser('lea', 'write');
  const a = Api.create({ url: 'u', getToken: () => tok, fetchImpl: h.fetchImpl }), now = new Date('2026-09-29T00:00:00Z');
  const empty = await build({ api: a, from: '2026-07', to: '2026-09', now });
  assert.deepEqual(Object.keys(empty.months), ['2026-07', '2026-08', '2026-09']);
  Object.values(empty.months).forEach(m => { assert.equal(m.records, 0); assert.deepEqual(m.results, []); });
  assert.equal(empty.sheet_rows_total, 0);
  for (const [p, d, s] of [['Alex Rivera', '2026-08-03', 'PRESENT'], ['Alex Rivera', '2026-08-04', 'ABSENT'], ['Ricelle (Rice) Lim', '2026-09-01', 'PRESENT'], ['Ricelle Lim', '2026-09-02', 'LATE']]) await a.saveRecord(rec(p, d, s));
  const feed = await build({ api: a, from: '2026-07', to: '2026-09', now });
  assert.equal(feed.months['2026-07'].records, 0);
  assert.deepEqual(feed.months['2026-08'].results.map(r => [r.person_id, r.working_days, r.rating_pct, r.provisional]), [['ALEX', 2, 0, false]]);
  assert.deepEqual(feed.months['2026-09'].results.map(r => [r.person_id, r.records, r.rating_pct, r.provisional]), [['RICE', 2, 50, true]]);
  assert.equal(feed.months['2026-09'].issues.via_unconfirmed_identity_link, 1);
  assert.ok(!/Alex|Rivera|Ricelle/.test(JSON.stringify(feed)), 'no names in the feed');
  await assert.rejects(build({ api: a, from: '2026-09', to: '2026-07' }), /from <= to/);
});
