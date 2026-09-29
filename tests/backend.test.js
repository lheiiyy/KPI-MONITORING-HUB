const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./gas-harness');

function fresh() {
  const rt = createRuntime();
  // Pre-existing training workbook tabs that must never be disturbed.
  rt.ss.insertSheet('SESSION_LOG').getRange(1, 1, 1, 2).setValues([['Session ID', 'Date']]);
  rt.ss.insertSheet('LISTS');
  rt.setup();
  const W = rt.addUser('leo', 'write'), R = rt.addUser('viewer', 'read');
  const call = (token, action, p = {}) => rt.handle({ action, token, ...p });
  const w = (action, p) => call(W, action, p);
  return { rt, W, R, call, w };
}
const base = (o = {}) => ({ activity_date: '2026-10-05', activity_type: 'REFRESHER', activity_title: 'Refresher at SM North', owner_id: 'LEO', ...o });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };
const code = (r) => { assert.equal(r.ok, false); return r.error.code; };

test('setup is idempotent, appends tabs, never touches SESSION_LOG/LISTS', () => {
  const { rt } = fresh();
  const order = [...rt.sheets.keys()];
  assert.deepEqual(order.slice(0, 2), ['SESSION_LOG', 'LISTS']);
  assert.deepEqual(order.slice(2), ['ACTIVITY', 'ACTIVITY_HISTORY', 'ACTIVITY_REF']);
  assert.equal(rt.sheets.get('SESSION_LOG').getRange(1, 1).getValues()[0][0], 'Session ID');
  const refRows = rt.sheets.get('ACTIVITY_REF').getLastRow();
  rt.setup();
  assert.equal(rt.sheets.get('ACTIVITY_REF').getLastRow(), refRows, 're-run must not duplicate seed');
});

test('setup refuses to overwrite an incompatible existing ACTIVITY tab', () => {
  const rt = createRuntime();
  rt.ss.insertSheet('ACTIVITY').getRange(1, 1, 1, 2).setValues([['foo', 'bar']]);
  assert.throws(() => rt.setup(), /Refusing to modify/);
});

test('auth: missing config, no token, bad token, read-only role', () => {
  const rt = createRuntime(); rt.setup();
  assert.equal(code(rt.handle({ action: 'list', token: 'x' })), 'CONFIG_MISSING');
  const { call, R, W } = fresh();
  assert.equal(code(call(undefined, 'list')), 'UNAUTHORIZED');
  assert.equal(code(call('nope', 'list')), 'UNAUTHORIZED');
  assert.equal(code(call(W, 'bogus')), 'BAD_REQUEST');
  assert.equal(code(call(R, 'create', { activity: base() })), 'FORBIDDEN');
  ok(call(R, 'list'));
});

test('tokens are stored hashed only', () => {
  const { rt, W } = fresh();
  assert.ok(!rt.props.get('ACTIVITY_TOKENS').includes(W));
});

test('missing ACTIVITY tab gives a clear CONFIG_MISSING', () => {
  const rt = createRuntime(); const T = rt.addUser('ab', 'write');
  const r = rt.handle({ action: 'list', token: T });
  assert.equal(code(r), 'CONFIG_MISSING'); assert.match(r.error.message, /setupActivityModule/);
});

test('create: server id, defaults, audit fields, meta lists', () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base() }));
  assert.match(a.activity_id, /^ACT-\d{6}$/);
  assert.equal(a.status, 'BACKLOG'); assert.equal(a.priority, 'MEDIUM'); assert.equal(a.progress_percent, 0);
  assert.equal(a.created_by, 'leo'); assert.equal(a.updated_by, 'leo'); assert.equal(a.created_at, a.updated_at);
  assert.equal(a.activity_date, '2026-10-05', 'date stays an ISO string, not a Date');
  const b = ok(w('create', { activity: base() }));
  assert.notEqual(a.activity_id, b.activity_id);
  const meta = ok(w('meta'));
  assert.equal(meta.statuses.length, 7); assert.ok(meta.people.some((p) => p.id === 'LEO'));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(meta.today));
});

test('create: validation matrix', () => {
  const { w } = fresh();
  const bad = (over, field) => {
    const r = w('create', { activity: base(over) });
    assert.equal(code(r), 'VALIDATION_ERROR', JSON.stringify(over));
    assert.ok(r.error.details.some((d) => d.field === field), `${field} in ${JSON.stringify(r.error.details)}`);
  };
  bad({ activity_title: '  ' }, 'activity_title');
  bad({ activity_title: 'x'.repeat(201) }, 'activity_title');
  bad({ activity_date: '' }, 'activity_date');
  bad({ activity_date: '2026-02-30' }, 'activity_date');
  bad({ activity_date: '05/10/2026' }, 'activity_date');
  bad({ due_date: 'soon' }, 'due_date');
  bad({ start_date: '2026-10-10', due_date: '2026-10-01' }, 'due_date');
  bad({ status: 'DONE' }, 'status');
  bad({ priority: 'CRITICAL' }, 'priority');
  bad({ progress_percent: 101 }, 'progress_percent');
  bad({ progress_percent: -1 }, 'progress_percent');
  bad({ progress_percent: 12.5 }, 'progress_percent');
  bad({ progress_percent: 'abc' }, 'progress_percent');
  bad({ activity_type: 'MADE_UP' }, 'activity_type');
  bad({ owner_id: 'NOBODY' }, 'owner_id');
  bad({ assigned_to_id: 'NOBODY' }, 'assigned_to_id');
  bad({ brand_id: 'NOPE' }, 'brand_id');
  bad({ kpi_id: 'NOPE' }, 'kpi_id');
  bad({ target_value: 'lots' }, 'target_value');
  bad({ evidence_url: 'javascript:alert(1)' }, 'evidence_url');
  bad({ completed_date: '2026-10-06' }, 'completed_date');           // not COMPLETED
  bad({ owner_id: '' }, 'owner_id');
  assert.equal(code(w('create', { activity: { ...base(), bogus: 1 } })), 'UNKNOWN_FIELD');
  assert.equal(code(w('create', { activity: { ...base(), created_by: 'evil' } })), 'UNKNOWN_FIELD');
  assert.equal(ok(w('list')).length, 0, 'nothing persisted by failed creates');
});

test('create: status/priority are case-normalised; COMPLETED gets date + 100%', () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base({ status: 'in_progress', priority: 'high' }) }));
  assert.equal(a.status, 'IN_PROGRESS'); assert.equal(a.priority, 'HIGH');
  const c = ok(w('create', { activity: base({ status: 'COMPLETED' }) }));
  assert.equal(c.progress_percent, 100); assert.match(c.completed_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('duplicate client-supplied id is rejected; bad format rejected; id normalised', () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base({ activity_id: 'imp-001' }) }));
  assert.equal(a.activity_id, 'IMP-001');
  assert.equal(code(w('create', { activity: base({ activity_id: 'IMP-001' }) })), 'DUPLICATE_ID');
  assert.equal(code(w('create', { activity: base({ activity_id: 'a b' }) })), 'VALIDATION_ERROR');
  assert.equal(ok(w('list')).length, 1);
});

test('generated ids never collide with imported ones', () => {
  const { w } = fresh();
  ok(w('create', { activity: base({ activity_id: 'ACT-000001' }) }));
  const b = ok(w('create', { activity: base() }));
  assert.notEqual(b.activity_id, 'ACT-000001');
});

test('formula-looking text and dates survive a round trip literally', () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base({ activity_title: '=HYPERLINK("http://evil","x")', notes: '+1', location_name: '@SUM(A1)', start_date: '2026-10-01', due_date: '2026-10-31' }) }));
  const g = ok(w('get', { activity_id: a.activity_id }));
  assert.equal(g.activity_title, '=HYPERLINK("http://evil","x")');
  assert.equal(g.notes, '+1'); assert.equal(g.location_name, '@SUM(A1)');
  assert.equal(g.start_date, '2026-10-01'); assert.equal(g.due_date, '2026-10-31');
});

test('update: partial change, history per field, updated_* change, created_* preserved', async () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base() }));
  await new Promise((r) => setTimeout(r, 5));
  const u = ok(w('update', { activity_id: a.activity_id, changes: { activity_title: 'New title', priority: 'URGENT' } }));
  assert.equal(u.activity_title, 'New title'); assert.equal(u.priority, 'URGENT'); assert.equal(u.owner_id, 'LEO');
  assert.notEqual(u.updated_at, a.updated_at); assert.equal(u.created_at, a.created_at);
  assert.equal(u.status_changed_at, a.status_changed_at, 'status untouched');
  const h = ok(w('history', { activity_id: a.activity_id }));
  assert.equal(h.filter((x) => x.action === 'UPDATE').length, 2);
  assert.ok(h.some((x) => x.field === 'priority' && x.old_value === 'MEDIUM' && x.new_value === 'URGENT'));
  assert.ok(h.some((x) => x.action === 'CREATE'));
});

test('update: no-op writes nothing; immutable/unknown fields rejected; not found', () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base() }));
  const same = ok(w('update', { activity_id: a.activity_id, changes: { activity_title: a.activity_title } }));
  assert.equal(same.updated_at, a.updated_at);
  assert.equal(code(w('update', { activity_id: a.activity_id, changes: { activity_id: 'X-1' } })), 'IMMUTABLE_FIELD');
  assert.equal(code(w('update', { activity_id: a.activity_id, changes: { created_at: 'x' } })), 'IMMUTABLE_FIELD');
  assert.equal(code(w('update', { activity_id: a.activity_id, changes: { nope: 1 } })), 'UNKNOWN_FIELD');
  assert.equal(code(w('update', { activity_id: 'ACT-999999', changes: { notes: 'x' } })), 'NOT_FOUND');
  assert.equal(code(w('update', { activity_id: a.activity_id, changes: { progress_percent: 500 } })), 'VALIDATION_ERROR');
  assert.equal(ok(w('get', { activity_id: a.activity_id })).progress_percent, 0, 'failed update did not persist');
});

test('status change: timestamps, COMPLETED side effects, leaving COMPLETED clears date', async () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base({ status: 'PLANNED' }) }));
  await new Promise((r) => setTimeout(r, 5));
  const p = ok(w('updateStatus', { activity_id: a.activity_id, status: 'IN_PROGRESS' }));
  assert.equal(p.status, 'IN_PROGRESS'); assert.notEqual(p.status_changed_at, a.status_changed_at); assert.equal(p.created_at, a.created_at);
  const c = ok(w('updateStatus', { activity_id: a.activity_id, status: 'COMPLETED' }));
  assert.equal(c.progress_percent, 100); assert.ok(c.completed_date);
  const back = ok(w('updateStatus', { activity_id: a.activity_id, status: 'FOR_REVIEW' }));
  assert.equal(back.completed_date, ''); assert.equal(back.status, 'FOR_REVIEW');
  assert.equal(code(w('updateStatus', { activity_id: a.activity_id, status: 'DONE' })), 'VALIDATION_ERROR');
  const h = ok(w('history', { activity_id: a.activity_id }));
  assert.ok(h.filter((x) => x.action === 'STATUS').length >= 3);
});

test('same-status move is a no-op (no timestamp churn)', () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base({ status: 'PLANNED' }) }));
  const s = ok(w('updateStatus', { activity_id: a.activity_id, status: 'PLANNED' }));
  assert.equal(s.updated_at, a.updated_at); assert.equal(s.status_changed_at, a.status_changed_at);
});

test('progress update + validation', () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base() }));
  assert.equal(ok(w('updateProgress', { activity_id: a.activity_id, progress_percent: 40 })).progress_percent, 40);
  assert.equal(code(w('updateProgress', { activity_id: a.activity_id, progress_percent: 101 })), 'VALIDATION_ERROR');
  assert.equal(ok(w('updateProgress', { activity_id: a.activity_id, progress_percent: 0 })).progress_percent, 0);
});

test('optimistic concurrency: stale expected_updated_at -> CONFLICT', async () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base() }));
  await new Promise((r) => setTimeout(r, 5));
  ok(w('update', { activity_id: a.activity_id, changes: { notes: 'one' }, expected_updated_at: a.updated_at }));
  const r = w('updateStatus', { activity_id: a.activity_id, status: 'PLANNED', expected_updated_at: a.updated_at });
  assert.equal(code(r), 'CONFLICT');
});

test('archive is a soft delete: hidden from list, kept, restorable, not editable while archived', () => {
  const { w } = fresh();
  const a = ok(w('create', { activity: base() }));
  ok(w('archive', { activity_id: a.activity_id }));
  assert.equal(ok(w('list')).length, 0);
  const all = ok(w('list', { include_archived: true }));
  assert.equal(all.length, 1); assert.equal(all[0].is_archived, true); assert.equal(all[0].archived_by, 'leo');
  assert.equal(code(w('update', { activity_id: a.activity_id, changes: { notes: 'x' } })), 'ARCHIVED');
  ok(w('restore', { activity_id: a.activity_id }));
  assert.equal(ok(w('list')).length, 1);
  const h = ok(w('history', { activity_id: a.activity_id }));
  assert.ok(h.some((x) => x.action === 'ARCHIVE') && h.some((x) => x.action === 'RESTORE'));
});

test('doPost transport: bad JSON, unknown action, error envelope never leaks internals', () => {
  const { rt, W } = fresh();
  assert.equal(rt.post('not json').error.code, 'BAD_REQUEST');
  assert.equal(rt.post({ action: 'list', token: W }).ok, true);
  assert.equal(rt.post({ action: '__proto__', token: W }).error.code, 'BAD_REQUEST');
  assert.equal(rt.post({ action: 'toString', token: W }).error.code, 'BAD_REQUEST');
});

test('year-agnostic: activities in any year store and list', () => {
  const { w } = fresh();
  ['2026-12-31', '2027-01-01', '2035-06-15', '2019-02-28'].forEach((d) => ok(w('create', { activity: base({ activity_date: d }) })));
  assert.deepEqual(ok(w('list')).map((a) => a.activity_date).sort(), ['2019-02-28', '2026-12-31', '2027-01-01', '2035-06-15']);
  assert.equal(code(w('create', { activity: base({ activity_date: '2027-02-29' }) })), 'VALIDATION_ERROR'); // 2027 not a leap year
  ok(w('create', { activity: base({ activity_date: '2028-02-29' }) }));                                     // 2028 is
});
