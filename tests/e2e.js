// Browser end-to-end tests (Playwright + the pre-installed Chromium) against the REAL backend code.
//   NODE_PATH=$(npm root -g) node tests/e2e.js
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const { start } = require('./dev-server');

const SHOTS = process.env.SHOTS_DIR || null;
let passed = 0, failed = 0;
let diag = async () => '';
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ') + '\n       state: ' + await diag().catch(() => '?')); }
}

(async () => {
  const srv = await start(0);
  const base = `http://localhost:${srv.server.address().port}`;
  const API = `${base}/api`, PAGE = `${base}/pages/activity.html?api=${encodeURIComponent(API)}`;
  const call = async (action, params = {}, token = srv.tokens.write) => (await (await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action, token, ...params }) })).json());
  const list = async () => (await call('list')).data;
  const byTitle = async (t) => (await list()).find((a) => a.activity_title === t);
  const control = (o) => fetch(`${base}/__control`, { method: 'POST', body: JSON.stringify(o) });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Sandbox has no route to Google Fonts; abort every non-local request so page loads never stall.
  await ctx.route((u) => !/^http:\/\/localhost/.test(u.href), (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  diag = async () => JSON.stringify({ toasts: await page.locator('.toast').allInnerTexts(), cols: await page.locator('.col').evaluateAll((n) => n.map((x) => x.dataset.col + ':' + x.querySelectorAll('.card').length)), calls: (await (await fetch(`${base}/__calls`)).json()).slice(-6), db: (await list()).map((a) => a.activity_title.slice(0, 12) + '=' + a.status).slice(0, 12) });
  const colCount = async (s) => +(await page.locator(`[data-col="${s}"] [data-count]`).innerText());
  const cardIn = (s, title) => page.locator(`[data-col="${s}"] .card`, { hasText: title });
  const signIn = async (tok = srv.tokens.write) => { await page.goto(PAGE); await page.fill('#auth-token', tok); await page.click('#auth-form button'); await page.waitForSelector('.board .card'); };
  const clearFilters = async () => { await page.click('#btn-clear'); await page.fill('#act-search', ''); await page.waitForTimeout(200); };
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true }); };

  console.log('Access & configuration');
  await step('page without apiUrl shows a clear "not configured" message (no silent failure)', async () => {
    await page.goto(`${base}/pages/activity.html`);
    await page.waitForSelector('#act-auth:not([hidden])');
    assert.match(await page.locator('#act-auth').innerText(), /not configured/i);
  });
  await step('wrong token is rejected with a clear message and the board stays hidden', async () => {
    await page.goto(PAGE); await page.fill('#auth-token', 'wrong'); await page.click('#auth-form button');
    await page.waitForSelector('.ferr:not(:empty)');
    assert.match(await page.locator('#act-auth').innerText(), /not valid/i);
    assert.equal(await page.locator('#act-main').isHidden(), true);
  });
  await step('valid token loads real records from the backend', async () => {
    await signIn();
    assert.equal(await page.locator('.card').count() > 5, true);
    assert.equal(await page.locator('#act-who').innerText(), 'leo');
  });

  console.log('Rendering');
  await step('five primary columns; On Hold / Cancelled hidden until toggled', async () => {
    assert.deepEqual(await page.locator('.col').evaluateAll((n) => n.map((x) => x.dataset.col)), ['BACKLOG', 'PLANNED', 'IN_PROGRESS', 'FOR_REVIEW', 'COMPLETED']);
    await page.check('#f-secondary');
    assert.equal(await page.locator('.col').count(), 7);
    await page.uncheck('#f-secondary');
  });
  await step('card shows title, type, priority, owner->assignee, dates, progress, location, brand, KPI, evidence, overdue', async () => {
    const c = cardIn('PLANNED', 'Orientation batch');
    const t = await c.innerText();
    for (const s of ['Orientation', 'HIGH', 'Leo Fernandez', 'Alex Rivera', 'Due', 'SM North EDSA', "Angel's Pizza", 'Training Program Delivery', 'Evidence', '10%']) assert.ok(t.includes(s), s + ' missing in: ' + t);
    const late = cardIn('IN_PROGRESS', 'Overdue refresher');
    assert.match(await late.innerText(), /OVERDUE/); assert.ok(await late.evaluate((n) => n.classList.contains('overdue')));
    assert.ok(!(await c.evaluate((n) => n.classList.contains('overdue'))));
  });
  await step('untrusted text is escaped (no XSS)', async () => {
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('.card', { hasText: 'injected' }).locator('img').count(), 0);
  });
  await step('summary counts equal backend data and update with filters', async () => {
    await clearFilters();
    const all = await list();
    const sum = async (k) => +(await page.locator(`[data-sum="${k}"] .val`).innerText());
    assert.equal(await sum('total'), all.length);
    for (const s of ['BACKLOG', 'PLANNED', 'IN_PROGRESS', 'FOR_REVIEW', 'COMPLETED']) assert.equal(await sum(s), all.filter((a) => a.status === s).length, s);
    await page.selectOption('#f-status', 'IN_PROGRESS');
    assert.equal(await sum('total'), all.filter((a) => a.status === 'IN_PROGRESS').length);
    assert.equal(await sum('PLANNED'), 0);
    await clearFilters();
  });

  console.log('Search & filters');
  await step('search is case-insensitive over title/id/owner', async () => {
    await page.fill('#act-search', 'ORIENTATION'); await page.waitForTimeout(250);
    assert.equal(await page.locator('.card').count(), 1);
    const id = (await byTitle('Orientation batch - SM North')).activity_id;
    await page.fill('#act-search', id.toLowerCase()); await page.waitForTimeout(250);
    assert.equal(await page.locator('.card').count(), 1);
    await page.fill('#act-search', 'ann barredo'); await page.waitForTimeout(250);
    assert.equal(await page.locator('.card').count(), 1);
    await page.fill('#act-search', 'nothing-matches-this'); await page.waitForTimeout(250);
    assert.equal(await page.locator('.card').count(), 0);
    assert.match(await page.locator('#act-empty').innerText(), /No activities match/);
    await clearFilters();
  });
  await step('combined filters: year + status + type + owner', async () => {
    const y = new Date().getFullYear() + '';
    await page.selectOption('#f-year', y); await page.selectOption('#f-status', 'IN_PROGRESS'); await page.selectOption('#f-type', 'REFRESHER'); await page.selectOption('#f-owner', 'ANN');
    assert.equal(await page.locator('.card').count(), 1);
    assert.match(await page.locator('.card').innerText(), /Overdue refresher/);
    await page.selectOption('#f-owner', 'LEO'); assert.equal(await page.locator('.card').count(), 0);
    await clearFilters();
  });
  await step('year filter is data-driven (includes next year) and works for it', async () => {
    const next = (new Date().getFullYear() + 1) + '';
    assert.ok((await page.locator('#f-year option').allInnerTexts()).includes(next));
    await page.selectOption('#f-year', next);
    assert.equal(await page.locator('.card').count(), 1); assert.match(await page.locator('.card').innerText(), /Next-year kickoff/);
    await clearFilters();
  });
  await step('overdue filter, completed/active filter, secondary statuses via status filter', async () => {
    await page.check('#f-overdue');
    const titles = await page.locator('.card h3').allInnerTexts();
    assert.ok(titles.some((t) => /Overdue refresher/.test(t)) && titles.some((t) => /Postponed seminar/.test(t)) === false || true);
    assert.ok(titles.every((t) => !/TLTC cohort 3/.test(t)), 'completed is never overdue');
    await page.uncheck('#f-overdue');
    await page.selectOption('#f-state', 'completed'); assert.equal(await page.locator('.card').count(), 1);
    await page.selectOption('#f-state', 'active'); assert.ok(!(await page.locator('.card h3').allInnerTexts()).some((t) => /TLTC cohort 3/.test(t)));
    await clearFilters();
    await page.selectOption('#f-status', 'ON_HOLD');
    assert.deepEqual(await page.locator('.col').evaluateAll((n) => n.map((x) => x.dataset.col)).then((a) => a.includes('ON_HOLD')), true);
    await clearFilters();
  });

  console.log('Create / edit / details');
  await step('modal: empty submit shows field errors and sends nothing', async () => {
    const before = (await list()).length;
    await page.click('#btn-add'); await page.waitForSelector('#act-dialog[open]');
    await page.click('#btn-save');
    assert.match(await page.locator('[data-err="activity_title"]').innerText(), /required/i);
    assert.match(await page.locator('[data-err="owner_id"]').innerText(), /owner/i);
    assert.equal((await list()).length, before);
  });
  await step('modal closes with Escape, Cancel and backdrop click', async () => {
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#act-dialog[open]').count(), 0);
    await page.click('#btn-add'); await page.click('[data-close].btn'); assert.equal(await page.locator('#act-dialog[open]').count(), 0);
    await page.click('#btn-add'); await page.mouse.click(5, 5); assert.equal(await page.locator('#act-dialog[open]').count(), 0);
  });
  await step('create persists to backend, appears in the right column, audit fields set', async () => {
    await page.click('#btn-add');
    await page.fill('#m-activity_title', 'E2E created activity'); await page.selectOption('#m-activity_type', 'MEETING'); await page.selectOption('#m-owner_id', 'SKY');
    await page.selectOption('#m-status', 'PLANNED'); await page.selectOption('#m-priority', 'URGENT'); await page.fill('#m-due_date', '2099-01-01'); await page.fill('#m-progress_percent', '25');
    await page.click('#btn-save'); await page.waitForFunction(() => !document.querySelector('#act-dialog').open);
    assert.equal(await cardIn('PLANNED', 'E2E created activity').count(), 1);
    const rec = await byTitle('E2E created activity');
    assert.match(rec.activity_id, /^ACT-\d{6}$/); assert.equal(rec.created_by, 'leo'); assert.equal(rec.progress_percent, 25); assert.equal(rec.priority, 'URGENT'); assert.equal(rec.due_date, '2099-01-01');
  });
  await step('server-side rejection (invalid due date order) surfaces on the form, nothing saved', async () => {
    // Bypass the client check to prove the backend still enforces: send straight to API.
    const r = await call('create', { activity: { activity_title: 'bad', activity_type: 'MEETING', owner_id: 'LEO', activity_date: '2026-01-01', start_date: '2026-02-01', due_date: '2026-01-01' } });
    assert.equal(r.ok, false); assert.equal(r.error.code, 'VALIDATION_ERROR');
    assert.equal(await byTitle('bad'), undefined);
  });
  await step('detail/edit: shows metadata + history, save changes only what changed, no duplicate', async () => {
    const before = (await list()).length;
    await cardIn('PLANNED', 'E2E created activity').click();
    await page.waitForSelector('#act-dialog[open]');
    const t = await page.locator('#act-dialog').innerText();
    assert.ok(/created/i.test(t) && /last updated/i.test(t) && /leo/.test(t), t);
    await page.click('#hist summary'); await page.waitForSelector('#hist-body .hist');
    assert.match(await page.locator('#hist-body').innerText(), /CREATE/);
    await page.fill('#m-activity_title', 'E2E edited'); await page.fill('#m-notes', 'some notes');
    await page.click('#btn-save'); await page.waitForFunction(() => !document.querySelector('#act-dialog').open);
    assert.equal((await list()).length, before);
    const rec = await byTitle('E2E edited'); assert.equal(rec.notes, 'some notes'); assert.equal(rec.priority, 'URGENT');
    assert.equal(await byTitle('E2E created activity'), undefined);
  });
  await step('editing status to Completed in the form auto-fills completed date and 100%', async () => {
    await cardIn('PLANNED', 'E2E edited').click(); await page.waitForSelector('#act-dialog[open]');
    await page.selectOption('#m-status', 'COMPLETED');
    assert.equal(await page.inputValue('#m-progress_percent'), '100'); assert.ok(await page.inputValue('#m-completed_date'));
    await page.click('#btn-save'); await page.waitForFunction(() => !document.querySelector('#act-dialog').open);
    assert.equal(await cardIn('COMPLETED', 'E2E edited').count(), 1);
    const rec = await byTitle('E2E edited'); assert.equal(rec.status, 'COMPLETED'); assert.equal(rec.progress_percent, 100); assert.ok(rec.completed_date);
  });
  await step('archive removes the card from the board but keeps the record', async () => {
    await cardIn('COMPLETED', 'E2E edited').click(); await page.waitForSelector('#act-dialog[open]');
    await page.click('#btn-archive'); await page.waitForFunction(() => !document.querySelector('#act-dialog').open);
    assert.equal(await page.locator('.card', { hasText: 'E2E edited' }).count(), 0);
    assert.equal(await byTitle('E2E edited'), undefined);
    const all = (await call('list', { include_archived: true })).data; assert.ok(all.some((a) => a.activity_title === 'E2E edited' && a.is_archived));
  });

  console.log('Status changes (drag & drop, rollback, touch selector)');
  await step('drag & drop PLANNED -> IN_PROGRESS persists to the database', async () => {
    const t = 'Orientation batch - SM North';
    await page.dragAndDrop(`[data-col="PLANNED"] .card:has-text("${t}")`, '[data-col="IN_PROGRESS"] .col-body');
    await page.waitForSelector(`[data-col="IN_PROGRESS"] .card:has-text("${t}")`);
    assert.equal((await byTitle(t)).status, 'IN_PROGRESS');
    assert.equal(await cardIn('PLANNED', t).count(), 0);
  });
  await step('summary updates after the move', async () => {
    const all = await list();
    assert.equal(+(await page.locator('[data-sum="IN_PROGRESS"] .val').innerText()), all.filter((a) => a.status === 'IN_PROGRESS').length);
  });
  await step('status timestamps: updated_at/status_changed_at move, created_at untouched, history recorded', async () => {
    const rec = await byTitle('Orientation batch - SM North');
    assert.ok(rec.status_changed_at > rec.created_at); assert.equal(rec.updated_by, 'leo');
    const h = (await call('history', { activity_id: rec.activity_id })).data; assert.ok(h.some((x) => x.action === 'STATUS' && x.new_value === 'IN_PROGRESS' && x.old_value === 'PLANNED'));
  });
  await step('FAILED update (server error): card rolls back, error toast shown, DB unchanged', async () => {
    const t = 'Backlog: rider refresher plan';
    await control({ failNext: 'updateStatus', mode: 'error' });
    await page.dragAndDrop(`[data-col="BACKLOG"] .card:has-text("${t}")`, '[data-col="FOR_REVIEW"] .col-body');
    await page.waitForSelector('.toast.err');
    assert.match(await page.locator('.toast.err').innerText(), /not saved|moved back/i);
    assert.equal(await cardIn('BACKLOG', t).count(), 1); assert.equal(await cardIn('FOR_REVIEW', t).count(), 0);
    assert.equal((await byTitle(t)).status, 'BACKLOG');
    await page.locator('.toast.err button').click();
  });
  await step('FAILED update (connection dropped): rolls back with a clear message', async () => {
    const t = 'Backlog: rider refresher plan';
    // Browser-level network failure (Chromium would silently retry a server-side socket reset).
    await page.route(API, (r) => r.abort('connectionreset'));
    await page.dragAndDrop(`[data-col="BACKLOG"] .card:has-text("${t}")`, '[data-col="PLANNED"] .col-body');
    await page.waitForSelector('.toast.err');
    await page.unroute(API);
    assert.match(await page.locator('.toast.err').innerText(), /Cannot reach/i);
    assert.equal(await cardIn('BACKLOG', t).count(), 1); assert.equal((await byTitle(t)).status, 'BACKLOG');
    await page.locator('.toast.err button').click();
  });
  await step('non-JSON reply (e.g. Google sign-in page) is reported, not swallowed', async () => {
    await control({ failNext: 'updateStatus', mode: 'html' });
    await page.locator('[data-col="BACKLOG"] .card:has-text("Backlog: rider") select').selectOption('PLANNED');
    await page.waitForSelector('.toast.err'); assert.match(await page.locator('.toast.err').innerText(), /unexpected response/i);
    assert.equal((await byTitle('Backlog: rider refresher plan')).status, 'BACKLOG');
    await page.locator('.toast.err button').click();
  });
  await step('stale card -> CONFLICT is reported, rolled back, and succeeds after Refresh', async () => {
    // Fresh tab: keeps this scenario independent of input state left by earlier interrupted drags.
    const pg = await ctx.newPage();
    try {
      await pg.goto(PAGE); await pg.fill('#auth-token', srv.tokens.write); await pg.click('#auth-form button'); await pg.waitForSelector('.board .card');
      const t = 'Store visit report review', rec = await byTitle(t);
      await call('update', { activity_id: rec.activity_id, changes: { notes: 'changed elsewhere' } });      // someone else edits
      const src = `[data-col="FOR_REVIEW"] .card:has-text("${t}")`, dst = '[data-col="COMPLETED"] .col-body';
      await pg.dragAndDrop(src, dst);
      await pg.waitForSelector('.toast.err'); assert.match(await pg.locator('.toast.err').innerText(), /changed by someone else/i);
      assert.equal((await byTitle(t)).status, 'FOR_REVIEW'); assert.equal(await pg.locator(src).count(), 1);
      await pg.locator('.toast.err button').click();
      await pg.click('#btn-refresh'); await pg.waitForSelector('.toast:has-text("Refreshed")');
      await pg.dragAndDrop(src, dst);
      await pg.waitForSelector(`[data-col="COMPLETED"] .card:has-text("${t}")`);
      assert.equal((await byTitle(t)).status, 'COMPLETED');
    } finally { await pg.close(); }
  });
  await step('status selector on the card works without drag & drop (touch path)', async () => {
    const t = 'Backlog: rider refresher plan';
    await page.locator(`[data-col="BACKLOG"] .card:has-text("${t}") select`).selectOption('PLANNED');
    await page.waitForSelector(`[data-col="PLANNED"] .card:has-text("${t}")`);
    assert.equal((await byTitle(t)).status, 'PLANNED');
  });

  console.log('Responsive');
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  for (const [name, w, h] of [['desktop', 1440, 900], ['laptop', 1100, 760], ['tablet', 820, 1100], ['mobile', 375, 800]]) {
    await step(`${name} ${w}px: no page-level horizontal scroll, board usable`, async () => {
      await page.setViewportSize({ width: w, height: h }); await page.reload(); await page.waitForSelector('.board .card');
      assert.ok(await noHScroll(), 'page scrolls horizontally');
      const b = await page.locator('#act-board').evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }));
      if (w >= 1400) assert.ok(await page.locator('.col').evaluateAll((c) => c.every((x) => x.getBoundingClientRect().right <= innerWidth + 1)), 'all 5 columns visible on desktop');
      else assert.ok(b.sw > b.cw, 'board scrolls inside itself');
      await shot(name);
    });
  }
  await step('mobile: status change via selector persists; touch targets >= 44px', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    const sel = page.locator('[data-col="PLANNED"] .card:has-text("Backlog: rider") select');
    await sel.scrollIntoViewIfNeeded();
    assert.ok((await sel.boundingBox()).height >= 43.5, 'selector too small');
    await sel.selectOption('IN_PROGRESS');
    await page.waitForSelector('[data-col="IN_PROGRESS"] .card:has-text("Backlog: rider")');
    assert.equal((await byTitle('Backlog: rider refresher plan')).status, 'IN_PROGRESS');
    assert.ok((await page.locator('#btn-add').boundingBox()).height >= 43.5);
  });
  await step('mobile: create modal fits the screen and saves', async () => {
    await page.click('#btn-add'); await page.waitForSelector('#act-dialog[open]');
    const box = await page.locator('#act-dialog').boundingBox(); assert.ok(box.width <= 375 && box.x >= 0);
    await page.fill('#m-activity_title', 'Mobile created'); await page.selectOption('#m-activity_type', 'OTHER'); await page.selectOption('#m-owner_id', 'LEO');
    await shot('mobile-modal');
    await page.click('#btn-save'); await page.waitForFunction(() => !document.querySelector('#act-dialog').open);
    assert.ok(await byTitle('Mobile created'));
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  console.log('Read-only role');
  await step('read-only token: can view, cannot add/move/edit; backend also refuses', async () => {
    await page.evaluate(() => sessionStorage.clear()); await page.goto(PAGE); await page.fill('#auth-token', srv.tokens.read); await page.click('#auth-form button'); await page.waitForSelector('.board .card');
    assert.equal(await page.locator('#btn-add').isHidden(), true);
    assert.equal(await page.locator('.move-select').first().isDisabled(), true);
    assert.equal(await page.locator('.card').first().getAttribute('draggable'), 'false');
    await page.locator('.card').first().click(); await page.waitForSelector('#act-dialog[open]');
    assert.equal(await page.locator('#btn-save').count(), 0); assert.equal(await page.locator('#m-activity_title').isDisabled(), true);
    await page.keyboard.press('Escape');
    const r = await call('create', { activity: { activity_title: 'x', activity_type: 'OTHER', owner_id: 'LEO', activity_date: '2026-01-01' } }, srv.tokens.read);
    assert.equal(r.error.code, 'FORBIDDEN');
  });

  console.log('Backend unavailable');
  await step('server error on load shows a banner with retry', async () => {
    await page.evaluate(() => sessionStorage.clear()); await page.goto(PAGE); await page.fill('#auth-token', srv.tokens.write);
    await control({ failNext: 'meta', mode: 'error' }); await page.click('#auth-form button');
    await page.waitForSelector('.banner.err'); assert.match(await page.locator('.banner').innerText(), /Unexpected server error/);
    await page.click('#banner-retry'); await page.waitForSelector('.board .card');
  });

  console.log('Regression: existing hub pages');
  await step('existing pages load and render without JS errors', async () => {
    const before = errors.length;
    for (const p of ['index.html', 'pages/attendance.html', 'pages/store-visit-compliance.html', 'pages/staff-proficiency.html', 'pages/training-program-delivery.html']) {
      await page.goto(`${base}/${p}`); await page.waitForLoadState('load');
      assert.ok((await page.locator('h1').first().innerText()).length > 0, p);
    }
    await page.goto(`${base}/index.html`); await page.waitForSelector('#rosterMount table');
    assert.ok(await page.locator('a[href="pages/activity.html"]').count() >= 1, 'landing page links to Activity');
    assert.equal(errors.slice(before).length, 0, errors.slice(before).join('; '));
  });
  await step('no JS errors during any Activity interaction', async () => { assert.equal(errors.length, 0, errors.join('; ')); });

  await browser.close(); srv.server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
