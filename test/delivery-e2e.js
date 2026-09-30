// Browser tests for the Training Program Delivery module (Playwright + the preinstalled Chromium).
//   NODE_PATH=$(npm root -g) node test/delivery-e2e.js        (SHOTS_DIR=dir to keep screenshots)
// Every persistence assertion reads the RAW sheet cells from the test server, not the UI: a card that moved
// on screen but was not written to the sheet FAILS these tests. The sheet is an in-memory fake running the real
// Code.gs; it is not Google Sheets (see docs/TRAINING_DELIVERY.md).
const assert = require('node:assert/strict'), path = require('path');
const { chromium } = require('playwright');
const { start } = require('./delivery-server');

let passed = 0, failed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ')); } }
const C = { id: 0, date: 1, program: 2, type: 3, brand: 4, venue: 5, fac: 6, target: 7, actual: 8, hrs: 9, status: 10, post: 11, remarks: 12 };

(async () => {
  const srv = await start(0), base = srv.url;
  const post = (p, b) => fetch(base + p, { method: 'POST', body: JSON.stringify(b || {}) });
  const rows = async () => (await (await fetch(base + '/__rows')).json()).slice(1);
  const audit = async () => (await (await fetch(base + '/__audit')).json()).slice(1);
  const sessions = async () => (await rows()).filter((r) => r[C.program] !== '' && r[C.program] != null);
  const rowOf = async (id) => (await rows()).find((r) => r[C.id] === id);
  const reset = (o) => post('/__reset', o);
  const raw = (cells) => post('/__raw', { cells });
  const calls = async () => (await fetch(base + '/__calls')).json();
  const until = async (fn, what) => { for (let i = 0; i < 60; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timed out waiting for: ' + what); };
  const SHOTS = process.env.SHOTS_DIR;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !/^http:\/\/localhost/.test(u.href), (r) => r.abort());   // sandbox has no route to Google Fonts
  const errors = [];
  async function open(url = '/pages/schedule.html', vp) {
    const pg = await ctx.newPage(); if (vp) await pg.setViewportSize(vp);
    pg.on('pageerror', (e) => errors.push(url + ': ' + e)); pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(url + ': ' + m.text()); });
    pg.on('dialog', (d) => d.accept());
    await pg.goto(base + url); return pg;
  }
  const board = (pg) => pg.waitForSelector('#board .col');
  const card = (pg, id) => pg.locator(`.card[data-id="${id}"]`);
  const inCol = (pg, id, st) => pg.locator(`.col[data-status="${st}"] .card[data-id="${id}"]`);
  const drag = (pg, id, to) => pg.dragAndDrop(`.card[data-id="${id}"]`, `.col[data-status="${to}"]`);
  const sel = (pg, id, to) => card(pg, id).locator('select').selectOption(to);
  const toasts = (pg) => pg.locator('#toasts').innerText();
  const seedTwo = async () => { await reset(); await raw([
    { row: 1, col: C.id, value: 'TPD-0001' }, { row: 1, col: C.date, date: [2026, 3, 10] }, { row: 1, col: C.program, value: 'Service Steps refresher' }, { row: 1, col: C.brand, value: 'Figaro' }, { row: 1, col: C.venue, value: 'Ayala' }, { row: 1, col: C.fac, value: 'Alex Rivera' }, { row: 1, col: C.target, value: 10 }, { row: 1, col: C.status, value: 'Planned' },
    { row: 2, col: C.date, date: [2026, 3, 20] }, { row: 2, col: C.program, value: 'Orientation batch' }, { row: 2, col: C.status, value: 'Planned' }]); };

  console.log('Empty template');
  await step('empty SESSION_LOG: board shows an explicit empty state, four columns, zero counts, and nothing is invented', async () => {
    await reset(); const pg = await open(); await board(pg);
    assert.equal(await pg.locator('.col').count(), 4); assert.equal(await pg.locator('.card').count(), 0);
    assert.match(await pg.locator('.emptyboard').innerText(), /No training sessions have been logged yet/);
    assert.equal(await pg.locator('[data-stat="total"] .v').innerText(), '0');
    assert.equal((await sessions()).length, 0, 'viewing wrote nothing to the sheet');
    assert.equal((await rows())[0][C.id], 'TPD-0001'); assert.equal((await rows())[0][C.program], '');
    await pg.close();
  });
  await step('empty SESSION_LOG: the report says "no data" (no 0% figures, no cards)', async () => {
    const pg = await open('/pages/training-program-delivery.html'); await pg.waitForSelector('#deliveryReport .tdr');
    assert.match(await pg.locator('[data-empty]').innerText(), /No training sessions have been logged yet/);
    assert.equal(await pg.locator('.tdr-grid').count(), 0); assert.doesNotMatch(await pg.locator('#deliveryReport').innerText(), /\b0\.00%|100\.00%/);
    await pg.close();
  });

  console.log('Create / edit');
  await step('create: validation blocks an empty program (nothing written); a valid session lands in the first pre-numbered row as Planned', async () => {
    await reset(); const pg = await open(); await board(pg);
    await pg.click('#new'); await pg.waitForSelector('#dlg[open]'); await pg.getByRole('button', { name: 'Create session' }).click();
    assert.match(await pg.locator('#dlg .errs').innerText(), /Program \/ Module is required/); assert.equal((await sessions()).length, 0);
    await pg.locator('#dlg').getByLabel('Program / Module *').fill('Barista basics'); await pg.locator('#dlg').getByLabel('Date').fill('2026-10-05'); await pg.locator('#dlg').getByLabel('Store / Venue').fill('HQ Training Room');
    await pg.locator('#dlg').getByLabel('Brand').selectOption('FIGARO'); await pg.locator('#dlg').getByLabel('Alex Rivera').check(); await pg.locator('#dlg').getByLabel('Target pax').fill('12');
    await pg.getByRole('button', { name: 'Create session' }).click(); await pg.waitForFunction(() => !document.querySelector('#dlg').open);
    const r = await rowOf('TPD-0001');
    assert.deepEqual([r[C.program], r[C.date], r[C.brand], r[C.venue], r[C.fac], r[C.target], r[C.status]], ['Barista basics', '2026-10-05', 'Figaro', 'HQ Training Room', 'Alex Rivera', 12, 'Planned']);
    assert.equal(await rowOf('TPD-0002').then((x) => x[C.program]), '', 'the next template row is untouched');
    assert.equal(await inCol(pg, 'TPD-0001', 'PLANNED').count(), 1); assert.equal((await audit())[0][4], 'CREATE');
    await pg.close();
  });
  await step('edit: saves to the same row (no duplicate), status untouched', async () => {
    await seedTwo(); const pg = await open(); await board(pg);
    await card(pg, 'TPD-0001').getByRole('button', { name: 'Open' }).click(); await pg.waitForSelector('#dlg[open]');
    await pg.locator('#dlg').getByLabel('Store / Venue').fill('Greenbelt'); await pg.locator('#dlg').getByLabel('Target pax').fill('15'); await pg.getByRole('button', { name: 'Save changes' }).click();
    await pg.waitForFunction(() => !document.querySelector('#dlg').open);
    const r = await rowOf('TPD-0001'); assert.deepEqual([r[C.venue], r[C.target], r[C.status]], ['Greenbelt', 15, 'Planned']);
    assert.equal((await sessions()).length, 2); await pg.close();
  });

  console.log('Status changes: drag & drop, Move to, persistence');
  await step('DRAG Planned -> Conducted is written to the sheet cell, audited, and survives a reload', async () => {
    await seedTwo(); const pg = await open(); await board(pg);
    await drag(pg, 'TPD-0001', 'CONDUCTED'); await until(async () => (await rowOf('TPD-0001'))[C.status] === 'Conducted', 'sheet cell = Conducted');
    assert.equal(await inCol(pg, 'TPD-0001', 'CONDUCTED').count(), 1); assert.match(await toasts(pg), /saved to the sheet/);
    const a = await audit(); assert.equal(a[a.length - 1][4], 'STATUS_CHANGE'); assert.equal(a[a.length - 1][1], 'e2e');
    assert.equal(await pg.locator('[data-stat="CONDUCTED"] .v').innerText(), '1'); assert.equal(await pg.locator('[data-stat="PLANNED"] .v').innerText(), '1');
    await pg.reload(); await board(pg); assert.equal(await inCol(pg, 'TPD-0001', 'CONDUCTED').count(), 1, 'reload reads the same state from the sheet');
    await pg.close();
  });
  await step('MOVE TO menu does the same real write: Planned -> Postponed -> Planned -> Cancelled', async () => {
    await seedTwo(); const pg = await open(); await board(pg);
    for (const [to, label] of [['POSTPONED', 'Postponed'], ['PLANNED', 'Planned'], ['CANCELLED', 'Cancelled']]) {
      await sel(pg, 'TPD-0002', to); await until(async () => (await rowOf('TPD-0002'))[C.status] === label, 'sheet = ' + label);
      await pg.waitForSelector(`.col[data-status="${to}"] .card[data-id="TPD-0002"]`);
    }
    assert.equal((await audit()).filter((a) => a[4] === 'STATUS_CHANGE').length, 3); await pg.close();
  });
  await step('final states: Conducted and Cancelled cards offer no moves ("Final")', async () => {
    await seedTwo(); const pg = await open(); await board(pg);
    await sel(pg, 'TPD-0001', 'CONDUCTED'); await sel(pg, 'TPD-0002', 'CANCELLED'); await pg.waitForSelector('.col[data-status="CANCELLED"] .card');
    for (const id of ['TPD-0001', 'TPD-0002']) { const s = card(pg, id).locator('select'); await until(async () => s.isDisabled(), id + ' select disabled'); assert.match(await s.innerText(), /Final/); }
    await pg.close();
  });
  await step('INVALID drags change nothing: Conducted->Planned, Cancelled->Planned, Postponed->Conducted', async () => {
    await seedTwo(); const pg = await open(); await board(pg);
    await sel(pg, 'TPD-0001', 'CONDUCTED'); await sel(pg, 'TPD-0002', 'POSTPONED'); await until(async () => (await rowOf('TPD-0002'))[C.status] === 'Postponed', 'setup');
    const before = JSON.stringify(await rows()), n = (await calls()).filter((c) => c === 'updateSession').length;
    await drag(pg, 'TPD-0001', 'PLANNED'); await drag(pg, 'TPD-0002', 'CONDUCTED'); await pg.waitForTimeout(400);
    assert.equal(JSON.stringify(await rows()), before, 'sheet unchanged'); assert.equal((await calls()).filter((c) => c === 'updateSession').length, n, 'no write was even attempted');
    assert.equal(await inCol(pg, 'TPD-0001', 'CONDUCTED').count(), 1); assert.equal(await inCol(pg, 'TPD-0002', 'POSTPONED').count(), 1); await pg.close();
  });
  await step('server refuses an illegal move even if the UI is bypassed (direct API call), sheet unchanged', async () => {
    await seedTwo(); const pg = await open(); await board(pg); await sel(pg, 'TPD-0001', 'CONDUCTED'); await until(async () => (await rowOf('TPD-0001'))[C.status] === 'Conducted', 'setup');
    const before = JSON.stringify(await rows());
    const r = await pg.evaluate(async () => (await (await fetch('/exec', { method: 'POST', body: JSON.stringify({ token: 'secret-token', action: 'updateSession', params: { id: 'TPD-0001', patch: { status: 'PLANNED' } } }) })).json()));
    assert.equal(r.ok, false); assert.equal(r.error.code, 'TRANSITION'); assert.equal(JSON.stringify(await rows()), before);
    const bad = await pg.evaluate(async () => (await (await fetch('/exec', { method: 'POST', body: JSON.stringify({ token: 'wrong', action: 'listSessions' }) })).json()));
    assert.equal(bad.error.code, 'AUTH'); await pg.close();
  });

  console.log('Conducted validation');
  await step('undated session -> Conducted: the move does not happen; the dialog asks for a date; saving without one is refused; with one it persists', async () => {
    await reset(); await raw([{ row: 3, col: C.program, value: 'Undated idea' }, { row: 3, col: C.status, value: 'Planned' }]);
    const pg = await open(); await board(pg); const before = JSON.stringify(await rows());
    await drag(pg, 'TPD-0003', 'CONDUCTED'); await pg.waitForSelector('#dlg[open]');
    assert.equal(JSON.stringify(await rows()), before, 'nothing written by the drag'); assert.equal(await inCol(pg, 'TPD-0003', 'PLANNED').count(), 1);
    await pg.getByRole('button', { name: 'Save changes' }).click(); await pg.waitForSelector('#dlg .errs:not([hidden])');
    assert.match(await pg.locator('#dlg .errs').innerText(), /Conducted session needs a date/); assert.equal(JSON.stringify(await rows()), before);
    await pg.locator('#dlg').getByLabel('Date').fill('2026-03-15'); await pg.getByRole('button', { name: 'Save changes' }).click(); await pg.waitForFunction(() => !document.querySelector('#dlg').open);
    const r = await rowOf('TPD-0003'); assert.deepEqual([r[C.status], r[C.date]], ['Conducted', '2026-03-15']); assert.equal(await inCol(pg, 'TPD-0003', 'CONDUCTED').count(), 1); await pg.close();
  });
  await step('undated session -> Conducted via Move to behaves the same (no silent write)', async () => {
    await reset(); await raw([{ row: 3, col: C.program, value: 'Undated idea' }]);
    const pg = await open(); await board(pg); const before = JSON.stringify(await rows());
    await sel(pg, 'TPD-0003', 'CONDUCTED'); await pg.waitForSelector('#dlg[open]'); assert.equal(JSON.stringify(await rows()), before); await pg.close();
  });

  console.log('Failures: nothing is reported as saved unless it was');
  await step('server error on a drag: card rolls back, error shown, sheet unchanged', async () => {
    await seedTwo(); const pg = await open(); await board(pg); const before = JSON.stringify(await rows());
    await post('/__control', { failNext: 'updateSession', mode: 'error' }); await drag(pg, 'TPD-0001', 'CONDUCTED');
    await pg.waitForSelector('.toast.err'); assert.match(await toasts(pg), /simulated failure/);
    await until(async () => (await inCol(pg, 'TPD-0001', 'PLANNED').count()) === 1, 'card back in Planned');
    assert.equal(JSON.stringify(await rows()), before); assert.doesNotMatch(await toasts(pg), /saved to the sheet/); await pg.close();
  });
  await step('non-JSON reply (e.g. Google sign-in page): rolled back and reported', async () => {
    await seedTwo(); const pg = await open(); await board(pg); const before = JSON.stringify(await rows());
    await post('/__control', { failNext: 'updateSession', mode: 'html' }); await sel(pg, 'TPD-0001', 'CONDUCTED');
    await pg.waitForSelector('.toast.err'); await until(async () => (await inCol(pg, 'TPD-0001', 'PLANNED').count()) === 1, 'rolled back'); assert.equal(JSON.stringify(await rows()), before); await pg.close();
  });
  await step('network down before the request: rolled back, reported, sheet unchanged', async () => {
    await seedTwo(); const pg = await open(); await board(pg); const before = JSON.stringify(await rows());
    await pg.route('**/exec', (r) => r.abort('connectionreset')); await drag(pg, 'TPD-0001', 'POSTPONED');
    await pg.waitForSelector('.toast.err'); assert.match(await toasts(pg), /Could not reach/); await pg.unroute('**/exec');
    await until(async () => (await inCol(pg, 'TPD-0001', 'PLANNED').count()) === 1, 'rolled back'); assert.equal(JSON.stringify(await rows()), before); await pg.close();
  });
  await step('AMBIGUOUS failure (write applied, reply lost): the board reconciles to the sheet instead of showing a false rollback', async () => {
    await seedTwo(); const pg = await open(); await board(pg);
    let dropped = false;
    await pg.route('**/exec', async (route) => {
      if (!dropped && (route.request().postData() || '').includes('"updateSession"')) { dropped = true; await route.fetch(); await route.abort('connectionreset'); } else await route.continue();
    });
    await drag(pg, 'TPD-0001', 'CONDUCTED'); await pg.waitForSelector('.toast.err');
    assert.equal((await rowOf('TPD-0001'))[C.status], 'Conducted', 'the write really did happen');
    await pg.waitForSelector('.col[data-status="CONDUCTED"] .card[data-id="TPD-0001"]', { timeout: 8000 });     // reconciled from the sheet
    assert.equal(await inCol(pg, 'TPD-0001', 'PLANNED').count(), 0); await pg.close();
  });
  await step('stale board (someone edited the sheet meanwhile): CONFLICT is reported, nothing overwritten, board refreshed', async () => {
    await seedTwo(); const pg = await open(); await board(pg);
    await raw([{ row: 1, col: C.venue, value: 'Edited in the sheet' }]);
    await drag(pg, 'TPD-0001', 'CONDUCTED'); await pg.waitForSelector('.toast.err'); assert.match(await toasts(pg), /changed by someone else/);
    const r = await rowOf('TPD-0001'); assert.deepEqual([r[C.status], r[C.venue]], ['Planned', 'Edited in the sheet']);
    await pg.waitForFunction(() => document.body.innerText.includes('Edited in the sheet')); await pg.close();
  });
  await step('double action on one card while saving: only ONE write is sent', async () => {
    await seedTwo(); const pg = await open(); await board(pg); await post('/__control', { delayMs: 800 });
    const n0 = (await calls()).filter((c) => c === 'updateSession').length;
    await drag(pg, 'TPD-0001', 'POSTPONED'); await pg.waitForTimeout(150);
    await card(pg, 'TPD-0001').locator('select').selectOption('CANCELLED', { timeout: 300 }).catch(() => {});
    await drag(pg, 'TPD-0001', 'CANCELLED').catch(() => {});
    await until(async () => (await rowOf('TPD-0001'))[C.status] === 'Postponed', 'first write lands');
    assert.equal((await calls()).filter((c) => c === 'updateSession').length - n0, 1); await pg.close();
  });
  await step('NOT connected (no apiUrl): moves are labelled NOT SAVED, the report refuses to pretend, nothing is written', async () => {
    await reset({ connected: false }); const pg = await open(); await board(pg);
    assert.match(await pg.locator('#banner').innerText(), /Not connected/);
    await pg.click('#new'); await pg.locator('#dlg').getByLabel('Program / Module *').fill('Demo only'); await pg.getByRole('button', { name: 'Create session' }).click(); await pg.waitForFunction(() => !document.querySelector('#dlg').open);
    await sel(pg, 'TPD-0001', 'CONDUCTED').catch(async () => {}); await pg.waitForTimeout(300);
    assert.equal((await sessions()).length, 0, 'the sheet was never touched');
    const rp = await open('/pages/training-program-delivery.html'); await rp.waitForSelector('[data-unconnected]'); assert.match(await rp.locator('#deliveryReport').innerText(), /not an empty report/); await rp.close(); await pg.close();
  });

  console.log('Reading real-looking sheet data, filters, report');
  await step('hand-typed sheet rows (text dates, Date cells, blank status) render; year/month/search/facilitator filters work', async () => {
    await reset({ emptySlots: 8 });
    await raw([
      { row: 1, col: C.date, value: '10/03/2026' }, { row: 1, col: C.program, value: 'Service Steps' }, { row: 1, col: C.type, value: 'Service Steps' }, { row: 1, col: C.brand, value: 'Figaro' }, { row: 1, col: C.venue, value: 'Ayala' }, { row: 1, col: C.fac, value: 'Alex Rivera, Ricelle (Rice) Lim' }, { row: 1, col: C.target, value: '10' }, { row: 1, col: C.actual, value: '8' }, { row: 1, col: C.status, value: 'Conducted' },
      { row: 2, col: C.date, date: [2027, 4, 5] }, { row: 2, col: C.program, value: 'Orientation 2027' }, { row: 2, col: C.brand, value: "Angel's Pizza" }, { row: 2, col: C.fac, value: 'Alex Rivera' }]);
    const pg = await open(); await board(pg);
    assert.equal(await pg.locator('.card').count(), 2); assert.equal(await inCol(pg, 'TPD-0002', 'PLANNED').count(), 1, 'blank status reads as Planned');
    const yrs = await pg.locator('#f-year option').allInnerTexts(); ['All years', '2027', '2026', String(new Date().getFullYear())].forEach((y) => assert.ok(yrs.includes(y), 'year option ' + y));
    await pg.selectOption('#f-year', '2027'); assert.equal(await pg.locator('.card').count(), 1); assert.match(await pg.locator('.card').innerText(), /Orientation 2027/);
    await pg.selectOption('#f-year', ''); await pg.selectOption('#f-who', 'Ricelle (Rice) Lim'); assert.equal(await pg.locator('.card').count(), 1);
    await pg.selectOption('#f-who', ''); await pg.fill('#f-q', 'ayala'); assert.equal(await pg.locator('.card').count(), 1); await pg.close();
  });

  const seedReport = async () => { await reset({ emptySlots: 8 }); await raw([
    { row: 1, col: C.date, value: '10/03/2026' }, { row: 1, col: C.program, value: 'Service Steps' }, { row: 1, col: C.fac, value: 'Alex Rivera' }, { row: 1, col: C.target, value: 10 }, { row: 1, col: C.actual, value: 8 }, { row: 1, col: C.hrs, value: 2 }, { row: 1, col: C.status, value: 'Conducted' }, { row: 1, col: C.post, value: 90 },
    { row: 2, col: C.date, date: [2026, 3, 20] }, { row: 2, col: C.program, value: 'Refresher' }, { row: 2, col: C.fac, value: 'Alex Rivera, Ricelle (Rice) Lim' }, { row: 2, col: C.target, value: 20 }, { row: 2, col: C.actual, value: 20 }, { row: 2, col: C.hrs, value: 3 }, { row: 2, col: C.status, value: 'Conducted' }, { row: 2, col: C.post, value: 80 },
    { row: 3, col: C.date, date: [2099, 1, 15] }, { row: 3, col: C.program, value: 'Future orientation' }, { row: 3, col: C.fac, value: 'Nica Tardio' }, { row: 3, col: C.target, value: 5 }, { row: 3, col: C.status, value: 'Planned' },
    { row: 4, col: C.date, date: [2020, 5, 1] }, { row: 4, col: C.program, value: 'Old postponed' }, { row: 4, col: C.target, value: 4 }, { row: 4, col: C.status, value: 'Postponed' },
    { row: 5, col: C.date, date: [2026, 6, 1] }, { row: 5, col: C.program, value: 'Cancelled thing' }, { row: 5, col: C.target, value: 99 }, { row: 5, col: C.status, value: 'Cancelled' },
    { row: 6, col: C.program, value: 'Undated idea' }]); };
  const kv = async (pg, k) => (await pg.locator(`[data-k="${k}"] .v`).innerText());
  await step('report: every figure is derived from the sheet rows (hand-computed expectations)', async () => {
    await seedReport(); const pg = await open('/pages/training-program-delivery.html'); await pg.waitForSelector('.tdr-grid');
    assert.deepEqual([await kv(pg, 'total'), await kv(pg, 'planned'), await kv(pg, 'conducted'), await kv(pg, 'postponed'), await kv(pg, 'cancelled')], ['6', '2', '2', '1', '1']);
    assert.equal(await kv(pg, 'rate'), '66.67%');                                    // 2 conducted of 3 due
    assert.deepEqual([await kv(pg, 'target-pax'), await kv(pg, 'actual-pax'), await kv(pg, 'pax-fill'), await kv(pg, 'post-test')], ['39', '28', '93.33%', '85.00%']);
    assert.match(await pg.locator('#deliveryReport').innerText(), /1 logged session\(s\) have no date/);
    await pg.close();
  });
  await step('report: year filter is data-driven, period figures change, per-facilitator ratings follow the documented formula, unknown names are not merged', async () => {
    await seedReport(); const pg = await open('/pages/training-program-delivery.html'); await pg.waitForSelector('.tdr-grid');
    const years = await pg.locator('#tdr-year option').allInnerTexts(); ['2099', '2026', '2020'].forEach((y) => assert.ok(years.includes(y), y));
    await pg.selectOption('#tdr-year', '2026'); await pg.waitForFunction(() => document.querySelector('[data-k="total"] .v').textContent === '3');
    assert.equal(await kv(pg, 'rate'), '100.00%'); assert.equal(await kv(pg, 'cancelled'), '1');
    await pg.selectOption('#tdr-month', '03'); await pg.waitForFunction(() => document.querySelector('[data-k="total"] .v').textContent === '2');
    assert.match(await pg.locator('tr[data-fac="Alex Rivera"]').innerText(), /2\s+2\s+100\.00%|100\.00%/);
    assert.match(await pg.locator('tr[data-fac="Ricelle (Rice) Lim"]').innerText(), /50\.00%/);
    await pg.selectOption('#tdr-year', '2099'); await pg.waitForFunction(() => document.querySelector('[data-k="total"] .v').textContent === '1');
    assert.match(await pg.locator('tr[data-fac="Nica Tardio"]').innerText(), /not on roster/);
    assert.equal(await pg.locator('tr[data-fac="Nica Tardio"] td').last().innerText(), 'no data', 'future year: no requirement yet, not 0%'); await pg.close();
  });
  await step('SESSION_LOG -> board -> report: a board move changes the report on the next load', async () => {
    await seedReport(); const pg = await open(); await board(pg);
    await sel(pg, 'TPD-0004', 'CANCELLED'); await until(async () => (await rowOf('TPD-0004'))[C.status] === 'Cancelled', 'written');
    const rp = await open('/pages/training-program-delivery.html'); await rp.waitForSelector('.tdr-grid');
    assert.deepEqual([await kv(rp, 'postponed'), await kv(rp, 'cancelled'), await kv(rp, 'rate')], ['0', '2', '100.00%']); await rp.close(); await pg.close();
  });

  console.log('Responsive');
  const noHScroll = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  for (const [name, w, h] of [['desktop', 1440, 900], ['laptop', 1100, 760], ['tablet', 820, 1100], ['phone', 375, 800]]) {
    await step(`${name} ${w}px: page does not scroll sideways, board and Move to usable`, async () => {
      await seedTwo(); const pg = await open('/pages/schedule.html', { width: w, height: h }); await board(pg);
      assert.ok(await noHScroll(pg), 'page-level horizontal scroll');
      if (w <= 700) { const b = await pg.locator('#board').evaluate((n) => [n.scrollWidth, n.clientWidth]); assert.ok(b[0] > b[1], 'board scrolls inside itself'); }
      if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'delivery-' + name + '.png'), fullPage: true });
      const rp = await open('/pages/training-program-delivery.html', { width: w, height: h }); await rp.waitForSelector('.tdr-grid, [data-empty]'); assert.ok(await noHScroll(rp), 'report page scrolls sideways'); await rp.close(); await pg.close();
    });
  }
  await step('phone 375px: Move to (no drag) meets touch size and persists to the sheet; dialog fits the screen', async () => {
    await seedTwo(); const pg = await open('/pages/schedule.html', { width: 375, height: 800 }); await board(pg);
    const s = card(pg, 'TPD-0001').locator('select'); await s.scrollIntoViewIfNeeded(); assert.ok((await s.boundingBox()).height >= 43.5, 'Move to too small');
    await s.selectOption('CONDUCTED'); await until(async () => (await rowOf('TPD-0001'))[C.status] === 'Conducted', 'sheet = Conducted');
    await card(pg, 'TPD-0002').getByRole('button', { name: 'Open' }).click(); await pg.waitForSelector('#dlg[open]');
    const box = await pg.locator('#dlg').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 376, 'dialog exceeds the viewport');
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'delivery-phone-dialog.png') }); await pg.close();
  });

  console.log('Regression');
  await step('other hub pages still load without script errors (index, KRA pages, attendance, schedule)', async () => {
    const before = errors.length;
    for (const p of ['/index.html', '/pages/attendance.html', '/pages/store-visit-compliance.html', '/pages/staff-proficiency.html', '/pages/coaching-feedback.html', '/pages/facilitator-attendance.html', '/pages/training-program-delivery.html', '/pages/schedule.html']) {
      const pg = await open(p); await pg.waitForLoadState('load'); assert.ok((await pg.locator('h1').first().innerText()).length > 0, p); await pg.close();
    }
    assert.equal(errors.slice(before).length, 0, errors.slice(before).join('; '));
  });
  await step('the existing KPI monthly card on the delivery page (js/kpi.js) is still rendered', async () => {
    const pg = await open('/pages/training-program-delivery.html'); await pg.waitForSelector('#kraMount .panel'); await pg.close();
  });
  await step('no script errors during any interaction above', async () => { assert.equal(errors.length, 0, errors.join('; ')); });

  await browser.close(); srv.server.close();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
