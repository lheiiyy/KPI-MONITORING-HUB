// Browser test for pages/facilitator-attendance.html (Playwright + Chromium).
//   NODE_PATH=$(npm root -g) node tests/attendance-e2e.js            (set PW_CHROMIUM to a chrome binary if needed)
// The page talks to a local server that runs the REAL backend .gs files over a fake sheet. That verifies the UI and the
// backend logic together, but NOT Google's runtime or a real spreadsheet: see docs/ATTENDANCE_MODULE.md.
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
const { load } = require('./attendance-gas-harness');

const ROOT = path.join(__dirname, '..'), PORT = 8791, BASE = 'http://localhost:' + PORT;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let H = null; // current fake backend

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/exec') {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => { const r = H.ctx.doPost({ postData: { contents: b } }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(r.text); });
    return;
  }
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
});

const CONFIG_ON = `window.ATTENDANCE_CONFIG={apiUrl:'${BASE}/exec'};`;
const vals = (s) => s.cells.map(r => r.map(c => c.v));
let step = 0; const ok = (m) => console.log('  ok ' + (++step) + ' - ' + m);

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const errors = [];
  async function newPage(configured, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    if (configured) await ctx.route('**/js/attendance-config.js', r => r.fulfill({ contentType: 'text/javascript', body: CONFIG_ON }));
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
    p.answer = true; p.on('dialog', d => (p.answer ? d.accept() : d.dismiss()));
    return p;
  }
  const row = (p, name) => p.locator('#rows tr', { has: p.locator('b', { hasText: new RegExp('^' + name + '$') }) });
  const connect = async (p, token) => { await p.fill('#token', token); await p.click('#tokenform button'); };

  // ---------------------------------------------------------------- 1. not configured
  H = load(); const wtok = H.addUser('lea', 'write'), rtok = H.addUser('viewer', 'read');
  let p = await newPage(false);
  await p.goto(BASE + '/pages/facilitator-attendance.html');
  await p.waitForFunction(() => /Not configured/.test(document.getElementById('status').textContent));
  assert.ok(await p.locator('#app').isHidden()); assert.equal(await p.locator('#rows tr').count(), 0);
  ok('not configured: says so, shows no attendance and no invented data');
  await p.context().close();

  // ---------------------------------------------------------------- 2. token gate
  p = await newPage(true);
  await p.goto(BASE + '/pages/facilitator-attendance.html');
  await p.waitForSelector('#tokenbox:not([hidden])'); assert.ok(await p.locator('#app').isHidden());
  await connect(p, 'wrong-token');
  await p.waitForFunction(() => /not accepted/.test(document.getElementById('status').textContent));
  assert.ok(await p.locator('#tokenbox').isVisible()); ok('wrong token is refused and asked again');
  await connect(p, wtok);
  await p.waitForSelector('#app:not([hidden])');
  assert.match(await p.textContent('#status'), /Connected as lea \(can edit\)/);
  assert.equal(await p.evaluate(() => sessionStorage.getItem('attendance_token')), wtok, 'token lives in sessionStorage for this tab only');
  assert.equal(await p.evaluate(() => localStorage.length), 0); ok('write token connects; token is kept per tab, never in localStorage');

  // ---------------------------------------------------------------- 3. empty sheet
  await p.waitForSelector('#rows tr');
  assert.equal(await p.locator('#rows tr').count(), 12);
  assert.match(await p.textContent('#day-empty'), /No attendance has been recorded for/);
  assert.match(await p.textContent('#day-count'), /^0 records/);
  assert.deepEqual(await p.locator('#rows select[aria-label^="Status"]').evaluateAll(s => s.map(x => x.value)), Array(12).fill(''));
  assert.match(await p.textContent('#rows tr:has(b:text-is("Ricelle Lim"))'), /identity link unconfirmed/);
  ok('empty sheet, daily view: 12 blank rows, "0 records", explicit empty message, unconfirmed identity flagged');
  await p.click('#tab-month');
  await p.waitForFunction(() => /0 attendance records/.test(document.getElementById('month-count').textContent));
  assert.match(await p.textContent('#month-empty'), /no data", not zero/);
  assert.equal(await p.locator('#kra-rows td:has-text("no data this month")').count(), 12);
  assert.ok(await p.locator('#assume-box').isHidden()); assert.ok(await p.locator('#quality-box').isHidden());
  assert.ok(!/0\.00%|\b0%/.test(await p.textContent('#kra-rows')), 'no zero percentages invented');
  ok('empty sheet, month view: "0 records", every person "no data", no zero ratings');
  await p.click('#tab-day');

  // ---------------------------------------------------------------- 4. save, persist, validate
  const alex = row(p, 'Alex Rivera'), before = vals(H.log).length;
  await alex.locator('select[aria-label^="Status"]').selectOption('LATE');
  await alex.locator('input[aria-label^="Time in"]').fill('08:35'); await alex.locator('input[aria-label^="Time out"]').fill('17:00');
  await alex.locator('select[aria-label^="Work location"]').selectOption('HEAD_OFFICE');
  await alex.locator('input[aria-label^="Remarks"]').fill('Traffic');
  await alex.locator('button.primary').click();
  await alex.locator('.rowmsg.good').waitFor();
  assert.equal(await alex.locator('button.primary').textContent(), 'Update');
  assert.ok(await p.locator('#day-empty').isHidden()); assert.match(await p.textContent('#day-count'), /^1 record /);
  const w = vals(H.log)[1]; assert.equal(vals(H.log).length, before + 1);
  assert.deepEqual([w[1], w[2], w[3], w[6], w[8]], ['Alex Rivera', 'Supervisor', 'Late', 'Head Office', 'Traffic']);
  ok('save writes one row to the sheet in the sheet\'s own vocabulary and gives inline feedback');
  await p.click('#reload'); await p.waitForFunction(() => document.querySelector('#day-count').textContent.startsWith('1 record'));
  assert.equal(await row(p, 'Alex Rivera').locator('select[aria-label^="Status"]').inputValue(), 'LATE');
  assert.equal(await row(p, 'Alex Rivera').locator('input[aria-label^="Time in"]').inputValue(), '08:35');
  ok('after reload the record comes back from the sheet');

  const leo = row(p, 'Leo Fernandez'), n1 = vals(H.log).length;
  await leo.locator('select[aria-label^="Status"]').selectOption('PRESENT');
  await leo.locator('input[aria-label^="Time in"]').fill('17:00'); await leo.locator('input[aria-label^="Time out"]').fill('08:00');
  await leo.locator('button.primary').click();
  assert.match(await leo.locator('.rowmsg.bad').textContent(), /Time Out cannot be earlier/);
  assert.equal(await leo.locator('input[aria-label^="Time out"]').getAttribute('aria-invalid'), 'true');
  assert.equal(vals(H.log).length, n1); ok('invalid times: inline error, field marked invalid, nothing written');
  await leo.locator('select[aria-label^="Status"]').selectOption(''); await leo.locator('button.primary').click();
  assert.match(await leo.locator('.rowmsg.bad').textContent(), /Choose a status/); ok('missing status is refused');

  assert.ok(await leo.locator('select[aria-label^="Leave type"]').isDisabled());
  await leo.locator('input[aria-label^="Time in"]').fill(''); await leo.locator('input[aria-label^="Time out"]').fill('');
  await leo.locator('select[aria-label^="Status"]').selectOption('ON_LEAVE');
  assert.ok(await leo.locator('select[aria-label^="Leave type"]').isEnabled());
  await leo.locator('select[aria-label^="Leave type"]').selectOption('SICK'); await leo.locator('button.primary').click(); await leo.locator('.rowmsg.good').waitFor();
  assert.equal(vals(H.log)[2][7], 'Sick Leave'); ok('Leave Type is only enabled for On Leave, and is saved with the sheet label');

  await alex.locator('select[aria-label^="Status"]').selectOption('PRESENT'); await alex.locator('button.primary').click(); await alex.locator('.rowmsg.good').waitFor();
  assert.equal(vals(H.log).length, 3); assert.equal(vals(H.log)[1][3], 'Present'); ok('editing updates the same row: still one record per person per day');

  // ---------------------------------------------------------------- 5. conflict: someone edits the sheet meanwhile
  H.log.cells[1][3] = { v: 'Absent' };
  await alex.locator('select[aria-label^="Status"]').selectOption('HALF_DAY'); await alex.locator('button.primary').click();
  await p.waitForSelector('.toast.err'); assert.match(await p.textContent('.toast.err'), /changed by someone else/);
  await p.waitForFunction(() => document.querySelector('#rows tr select[aria-label="Status for Alex Rivera"]').value === 'ABSENT');
  assert.equal(vals(H.log)[1][3], 'Absent', 'the other person\'s edit was not overwritten'); ok('concurrent edit: refused, sheet value kept, row reloaded');

  // ---------------------------------------------------------------- 6. clear
  await row(p, 'Leo Fernandez').locator('button.danger').click();
  await p.waitForFunction(() => document.querySelector('#day-count').textContent.startsWith('1 record'));
  assert.equal(vals(H.log).length, 2); ok('Clear removes the record from the sheet after confirmation');

  // ---------------------------------------------------------------- 7. filter and navigation
  await p.selectOption('#f-person', 'Alex Rivera'); await p.waitForFunction(() => document.querySelectorAll('#rows tr').length === 1);
  await p.selectOption('#f-person', ''); await p.waitForFunction(() => document.querySelectorAll('#rows tr').length === 12);
  const d0 = await p.inputValue('#f-date');
  const leo2 = row(p, 'Leo Fernandez'); await leo2.locator('input[aria-label^="Remarks"]').fill('typed, not saved');
  p.answer = false; await p.click('#d-next'); p.answer = true;
  assert.equal(await p.inputValue('#f-date'), d0, 'declining the prompt stays on the same day'); assert.equal(await row(p, 'Leo Fernandez').locator('input[aria-label^="Remarks"]').inputValue(), 'typed, not saved');
  await p.click('#d-next');
  await p.waitForFunction((d) => document.getElementById('f-date').value > d, d0);
  await p.waitForFunction(() => document.querySelector('#day-count').textContent.startsWith('0 record'));
  assert.ok(await p.locator('#day-empty').isVisible()); await p.click('#d-prev'); await p.waitForFunction(() => document.querySelector('#day-count').textContent.startsWith('1 record'));
  await p.click('#d-today'); assert.equal(await p.inputValue('#f-date'), d0);
  ok('team member filter and previous / next / today navigation; unsaved typing is not discarded without asking');

  // ---------------------------------------------------------------- 8. month summary from sheet records
  const at = (person, date, status, extra) => H.call(Object.assign({ action: 'save', token: wtok, record: Object.assign({ person, work_date: date, status }, extra || {}) }));
  const m = d0.slice(0, 7);
  H.log.cells.length = 1;                                                     // start the month clean
  ['01', '02', '03', '04'].forEach((d, i) => at('Alex Rivera', m + '-' + d, ['PRESENT', 'LATE', 'ABSENT', 'PRESENT'][i]));
  at('Ricelle Lim', m + '-01', 'PRESENT'); at('Ricelle Lim', m + '-02', 'REST_DAY');
  H.log.cells.push([new Date(+m.slice(0, 4), +m.slice(5) - 1, 5), 'Ricelle (Rice) Lim', '', 'Present', '', '', '', '', ''].map(v => ({ v })));  // typed by hand under an alias
  H.log.cells.push([new Date(+m.slice(0, 4), +m.slice(5) - 1, 5), 'Ricelle Lim', '', 'Late', '', '', '', '', ''].map(v => ({ v })));              // duplicate day
  H.log.cells.push([new Date(+m.slice(0, 4), +m.slice(5) - 1, 6), 'Ann Barredo', '', 'Prsent', '', '', '', '', ''].map(v => ({ v })));           // typo
  await p.click('#tab-month'); await p.click('#m-this');
  await p.waitForFunction(() => /attendance records in/.test(document.getElementById('month-count').textContent));
  const alexK = p.locator('#kra-rows tr', { hasText: 'Alex Rivera' });
  assert.match(await alexK.textContent(), /4.*4.*3.*1.*1.*25\.00% \*/s);
  assert.match(await p.textContent('#kra-rows tr:has-text("Ricelle Lim")'), /\*/);
  assert.ok(await p.locator('#assume-box').isVisible()); assert.match(await p.textContent('#assume-box'), /HRAD has not confirmed/);
  assert.match(await p.textContent('#assumptions'), /Late day is first counted as present/); assert.match(await p.textContent('#assumptions'), /Rest Day treatment is not documented/);
  const q = await p.textContent('#quality'); assert.match(q, /More than one record for Ricelle Lim/); assert.match(q, /not yet confirmed/); assert.match(q, /missing or unrecognised status/);
  assert.equal(await p.locator('#kra-rows tr', { hasText: 'Ricelle' }).count(), 1, 'two spellings are one person');
  assert.match(await p.textContent('#month-count'), /with problems/);
  ok('month summary is computed from sheet records; provisional ratings, assumptions, duplicate, alias and bad-row findings are shown');
  await p.selectOption('#f-person', 'Alex Rivera'); await p.waitForSelector('#detail:not([hidden])');
  assert.equal(await p.locator('#detail tbody tr').count(), 4); assert.equal(await p.locator('#kra-rows tr').count(), 1); ok('one-person month drill-down');
  await p.selectOption('#f-person', '');

  // ---------------------------------------------------------------- 9. revoked token mid-session
  H.props.set('ATTENDANCE_TOKENS', '{}'); H.addUser('other', 'write');
  await p.click('#reload'); await p.waitForSelector('#tokenbox:not([hidden])');
  assert.equal(await p.evaluate(() => sessionStorage.getItem('attendance_token')), null); ok('a revoked token returns to the token prompt and is forgotten');
  await p.context().close();

  // ---------------------------------------------------------------- 10. read-only token
  H = load(); H.addUser('lea', 'write'); const rt = H.addUser('viewer', 'read'); at('Alex Rivera', new Date().toISOString().slice(0, 10), 'PRESENT');
  p = await newPage(true); await p.goto(BASE + '/pages/facilitator-attendance.html'); await p.waitForSelector('#tokenbox:not([hidden])'); await connect(p, rt);
  await p.waitForSelector('#rows tr'); assert.match(await p.textContent('#status'), /read-only/);
  const controls = await p.locator('#rows select, #rows input, #rows button').evaluateAll(n => n.map(x => x.disabled || x.hidden));
  assert.ok(controls.length > 0 && controls.every(Boolean)); ok('read-only token: every entry control is disabled');
  await p.context().close();

  // ---------------------------------------------------------------- 11. responsive
  for (const [w, h, label] of [[1280, 900, 'desktop'], [768, 1024, 'tablet'], [390, 800, 'phone']]) {
    H = load(); const t = H.addUser('lea', 'write');
    p = await newPage(true, { width: w, height: h }); await p.goto(BASE + '/pages/facilitator-attendance.html'); await p.waitForSelector('#tokenbox:not([hidden])'); await connect(p, t); await p.waitForSelector('#rows tr');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), label + ': no page-level horizontal scroll');
    const card = await p.locator('#rows tr').first().evaluate(tr => getComputedStyle(tr).display);
    if (w <= 900) { assert.equal(card, 'block', label + ': rows become cards'); const lab = await p.locator('#rows tr td').nth(1).evaluate(td => getComputedStyle(td, '::before').content); assert.match(lab, /Status/); }
    else assert.equal(card, 'table-row');
    const btn = await p.locator('#rows tr').first().locator('button.primary').boundingBox(); assert.ok(btn.height >= 30, label + ': buttons are tappable');
    assert.ok(btn.x >= 0 && btn.x + btn.width <= w, label + ': the Save button is on screen without sideways scrolling');
    const clipped = await p.locator('#rows tr').first().locator('select, input, button').evaluateAll((els, vw) => els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; }).length, w);
    assert.equal(clipped, 0, label + ': no control extends past the viewport');
    if (w === 390) { await p.selectOption('#f-person', 'Alex Rivera'); await p.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'attendance-phone.png') : '/tmp/attendance-phone.png' }); }
    if (w === 1280) await p.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'attendance-desktop.png') : '/tmp/attendance-desktop.png' });
    await p.context().close();
  }
  ok('responsive: no sideways page scroll at desktop, tablet and phone widths; cards with labels below 900px');

  assert.deepEqual(errors, [], 'no console or page errors'); ok('no console or page errors');
  await browser.close(); server.close(); console.log('ATTENDANCE E2E PASSED (' + step + ' checks)');
})().catch(e => { console.error('ATTENDANCE E2E FAILED\n', e); process.exit(1); });
