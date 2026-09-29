const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/activity-logic');
const Api = require('../js/activity-api');

const statuses = [
  { code: 'BACKLOG', label: 'Backlog', board: 'primary', terminal: false }, { code: 'PLANNED', label: 'Planned', board: 'primary', terminal: false },
  { code: 'IN_PROGRESS', label: 'In Progress', board: 'primary', terminal: false }, { code: 'FOR_REVIEW', label: 'For Review', board: 'primary', terminal: false },
  { code: 'COMPLETED', label: 'Completed', board: 'primary', terminal: true }, { code: 'ON_HOLD', label: 'On Hold', board: 'secondary', terminal: false },
  { code: 'CANCELLED', label: 'Cancelled', board: 'secondary', terminal: true }];
const meta = { statuses, priorities: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], people: [{ id: 'LEO', label: 'Leo Fernandez' }, { id: 'ANN', label: 'Ann Barredo' }],
  brands: [{ id: 'FIGARO', label: 'Figaro' }], kpis: [{ id: 'COACHING', label: 'Coaching & Feedback' }], activity_types: [{ id: 'TRAINING', label: 'Training' }, { id: 'REFRESHER', label: 'Refresher' }] };
const refs = { people: L.labelMap(meta.people), brands: L.labelMap(meta.brands), types: L.labelMap(meta.activity_types) };
const TODAY = '2026-10-10';
const ctx = { statuses, today: TODAY, refs };
const A = (o) => ({ activity_id: 'ACT-1', activity_title: 'T', activity_description: '', activity_type: 'TRAINING', owner_id: 'LEO', assigned_to_id: '', status: 'PLANNED', priority: 'MEDIUM', activity_date: '2026-10-01', due_date: '', location_id: '', location_name: '', brand_id: '', kpi_id: '', ...o });

test('dates: validity, formatting is timezone-safe, today is local', () => {
  assert.ok(L.isIsoDate('2028-02-29')); assert.ok(!L.isIsoDate('2027-02-29')); assert.ok(!L.isIsoDate('2026-13-01')); assert.ok(!L.isIsoDate('10/05/2026')); assert.ok(!L.isIsoDate(''));
  assert.equal(L.formatDate('2026-01-01'), '1 Jan 2026'); assert.equal(L.formatDate('2026-12-31'), '31 Dec 2026'); assert.equal(L.formatDate(''), '');
  assert.equal(L.todayISO(new Date(2030, 0, 1, 0, 30)), '2030-01-01');
  assert.equal(L.todayISO(new Date(2030, 11, 31, 23, 59)), '2030-12-31');
});

test('overdue: past due & unfinished only', () => {
  assert.ok(L.isOverdue(A({ due_date: '2026-10-09' }), statuses, TODAY));
  assert.ok(!L.isOverdue(A({ due_date: '2026-10-10' }), statuses, TODAY), 'due today is not overdue');
  assert.ok(!L.isOverdue(A({ due_date: '2026-10-01', status: 'COMPLETED' }), statuses, TODAY));
  assert.ok(!L.isOverdue(A({ due_date: '2026-10-01', status: 'CANCELLED' }), statuses, TODAY));
  assert.ok(L.isOverdue(A({ due_date: '2026-10-01', status: 'ON_HOLD' }), statuses, TODAY));
  assert.ok(!L.isOverdue(A({ due_date: '' }), statuses, TODAY));
});

test('years come from the data plus the current year, never a constant', () => {
  assert.deepEqual(L.availableYears([], '2031-05-05'), ['2031']);
  assert.deepEqual(L.availableYears([A({ activity_date: '2026-01-01' }), A({ activity_date: '2028-06-01' })], '2027-01-01'), ['2028', '2027', '2026']);
});

test('filters combine (2026 + In Progress + Training + Leo)', () => {
  const items = [A({ activity_id: '1', status: 'IN_PROGRESS' }), A({ activity_id: '2', status: 'IN_PROGRESS', owner_id: 'ANN' }), A({ activity_id: '3', status: 'IN_PROGRESS', activity_date: '2027-01-01' }),
    A({ activity_id: '4', status: 'PLANNED' }), A({ activity_id: '5', status: 'IN_PROGRESS', activity_type: 'REFRESHER' })];
  const r = L.filterActivities(items, { year: '2026', status: 'IN_PROGRESS', type: 'TRAINING', owner: 'LEO' }, ctx);
  assert.deepEqual(r.map((a) => a.activity_id), ['1']);
  assert.equal(L.filterActivities(items, { year: '2027' }, ctx).length, 1);
  assert.equal(L.filterActivities(items, { month: '10' }, ctx).length, 4);
  assert.equal(L.filterActivities(items, {}, ctx).length, 5);
});

test('state / overdue / location filters', () => {
  const items = [A({ activity_id: '1', status: 'COMPLETED' }), A({ activity_id: '2', due_date: '2026-10-01' }), A({ activity_id: '3', status: 'CANCELLED' }), A({ activity_id: '4', location_name: 'SM North' }), A({ activity_id: '5', location_id: 'ST-1', location_name: 'X' })];
  assert.deepEqual(L.filterActivities(items, { state: 'completed' }, ctx).map((a) => a.activity_id), ['1']);
  assert.deepEqual(L.filterActivities(items, { state: 'active' }, ctx).map((a) => a.activity_id), ['2', '4', '5']);
  assert.deepEqual(L.filterActivities(items, { overdue: true }, ctx).map((a) => a.activity_id), ['2']);
  assert.deepEqual(L.filterActivities(items, { location: 'ST-1' }, ctx).map((a) => a.activity_id), ['5']);
});

test('search: case-insensitive across id/title/description/people/location/brand/type, AND of terms', () => {
  const items = [A({ activity_id: 'ACT-000042', activity_title: 'Orientation SM North', activity_description: 'crew onboarding', assigned_to_id: 'ANN', location_name: 'Ayala Malls', brand_id: 'FIGARO' })];
  const s = (q) => L.filterActivities(items, { q: q }, ctx).length;
  assert.equal(s('act-000042'), 1); assert.equal(s('ORIENTATION'), 1); assert.equal(s('onboarding'), 1); assert.equal(s('leo fern'), 1);
  assert.equal(s('ann barredo'), 1); assert.equal(s('ayala'), 1); assert.equal(s('figaro'), 1); assert.equal(s('training'), 1);
  assert.equal(s('orientation ayala'), 1); assert.equal(s('orientation nowhere'), 0); assert.equal(s('zzz'), 0);
});

test('summary is derived from the list it is given', () => {
  const items = [A({ status: 'PLANNED' }), A({ status: 'PLANNED', due_date: '2026-10-01' }), A({ status: 'COMPLETED', due_date: '2026-10-01' }), A({ status: 'ON_HOLD' })];
  const s = L.summarize(items, statuses, TODAY);
  assert.equal(s.total, 4); assert.equal(s.byStatus.PLANNED, 2); assert.equal(s.byStatus.COMPLETED, 1); assert.equal(s.byStatus.ON_HOLD, 1); assert.equal(s.overdue, 1);
  assert.equal(L.summarize([], statuses, TODAY).total, 0);
});

test('cards sort by priority, then due date', () => {
  const g = L.groupByStatus([A({ activity_id: 'a', priority: 'LOW' }), A({ activity_id: 'b', priority: 'URGENT', due_date: '2026-11-01' }), A({ activity_id: 'c', priority: 'URGENT', due_date: '2026-10-15' })], statuses);
  assert.deepEqual(g.PLANNED.map((a) => a.activity_id), ['c', 'b', 'a']);
});

test('client validation mirrors the rules', () => {
  const ok = { activity_title: 'x', activity_type: 'TRAINING', activity_date: '2026-10-01', owner_id: 'LEO', status: 'PLANNED', priority: 'LOW' };
  assert.deepEqual(L.validateDraft(ok, meta), {});
  const e = L.validateDraft({ ...ok, activity_title: ' ', activity_date: '2026-02-30', progress_percent: '101', due_date: '2026-09-01', start_date: '2026-10-01', status: 'DONE', evidence_url: 'ftp://x', owner_id: 'X' }, meta);
  ['activity_title', 'activity_date', 'progress_percent', 'due_date', 'status', 'evidence_url', 'owner_id'].forEach((k) => assert.ok(e[k], k));
  assert.ok(L.validateDraft({ ...ok, progress_percent: '12.5' }, meta).progress_percent);
  assert.deepEqual(L.validateDraft({ ...ok, progress_percent: '0' }, meta), {});
});

test('api layer: envelope, error mapping, config/token/network/bad-response handling', async () => {
  const mk = (impl, url = 'http://x', token = 't') => Api.create({ url, getToken: () => token, fetchImpl: impl });
  const res = (text, status = 200) => Promise.resolve({ status, text: () => Promise.resolve(text) });
  assert.deepEqual(await mk(() => res('{"ok":true,"data":[1]}')).listActivities(), [1]);
  await assert.rejects(mk(() => res('{"ok":false,"error":{"code":"DUPLICATE_ID","message":"dup"}}')).createActivity({}), { code: 'DUPLICATE_ID', message: 'dup' });
  await assert.rejects(mk(() => Promise.reject(new TypeError('fail'))).listActivities(), { code: 'BACKEND_UNAVAILABLE' });
  await assert.rejects(mk(() => res('<html>login</html>')).listActivities(), { code: 'BAD_RESPONSE' });
  await assert.rejects(mk(() => res('{}')).listActivities(), { code: 'INTERNAL_ERROR' });
  await assert.rejects(mk(() => res('{}'), '').listActivities(), { code: 'CONFIG_MISSING' });
  await assert.rejects(mk(() => res('{}'), 'http://x', '').listActivities(), { code: 'UNAUTHORIZED' });
  let seen; await mk((u, o) => { seen = { u, o }; return res('{"ok":true,"data":{}}'); }).updateActivityStatus('ACT-1', 'PLANNED', 'ts');
  assert.equal(seen.o.method, 'POST'); assert.match(seen.o.headers['Content-Type'], /text\/plain/);
  assert.deepEqual(JSON.parse(seen.o.body), { action: 'updateStatus', token: 't', activity_id: 'ACT-1', status: 'PLANNED', expected_updated_at: 'ts' });
  assert.ok(!seen.u.includes('t'.repeat(1)) || seen.u === 'http://x', 'token is never put in the URL');
});
