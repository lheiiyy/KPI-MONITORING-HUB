// Test server for the browser tests: serves the static site and runs the REAL apps-script/Code.gs over the
// in-memory fake spreadsheet (test/fake-sheets.js) at POST /exec. It also exposes the RAW sheet cells so a
// test can assert persistence by reading the sheet itself rather than trusting what the UI shows.
// This is NOT Google Sheets: see docs/TRAINING_DELIVERY.md, "Verification status".
const http = require('http'), fs = require('fs'), path = require('path');
const { load } = require('./fake-sheets');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const day = (d) => (d instanceof Date ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : d);

function start(port = 0) {
  let h = load({ emptySlots: 5 }), connected = true;
  const control = { failNext: null, mode: 'error', delayMs: 0, calls: [] };
  const sheet = (book, tab) => h.books[book].getSheetByName(tab);
  const json = (res, o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/exec') {
      const raw = await body(req); let p = {}; try { p = JSON.parse(raw); } catch (e) { /* backend reports it */ }
      control.calls.push(p.action);
      const hit = control.failNext && (control.failNext === 'any' || control.failNext === p.action);
      const send = () => {
        if (hit) {
          control.failNext = null;
          if (control.mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>Sign in to Google</html>'); }
          return json(res, { ok: false, error: { code: 'SERVER', message: 'Unexpected server error: simulated failure' } });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(h.ctx.doPost({ postData: { contents: raw } }).text);
      };
      return control.delayMs && p.action === 'updateSession' ? setTimeout(send, control.delayMs) : send();
    }
    if (req.method === 'POST' && url.pathname === '/__reset') { const o = JSON.parse((await body(req)) || '{}'); connected = o.connected !== false; h = load({ emptySlots: o.emptySlots == null ? 5 : o.emptySlots }); Object.assign(control, { failNext: null, mode: 'error', delayMs: 0, calls: [] }); return json(res, {}); }
    if (req.method === 'POST' && url.pathname === '/__control') { Object.assign(control, JSON.parse((await body(req)) || '{}')); return json(res, {}); }
    if (req.method === 'POST' && url.pathname === '/__raw') {        // simulate a person typing directly into the sheet
      const o = JSON.parse((await body(req)) || '{}'), rows = sheet('SESSIONS', 'SESSION_LOG').rows;
      (o.cells || []).forEach((c) => { rows[c.row][c.col] = c.date ? new Date(c.date[0], c.date[1] - 1, c.date[2]) : c.value; });
      return json(res, {});
    }
    if (req.method === 'GET' && url.pathname === '/__rows') return json(res, sheet('SESSIONS', 'SESSION_LOG').rows.map((r) => r.map(day)));
    if (req.method === 'GET' && url.pathname === '/__audit') { const t = sheet('SESSIONS', 'AUDIT_LOG'); return json(res, t ? t.rows.map((r) => r.map(day)) : []); }
    if (req.method === 'GET' && url.pathname === '/__calls') return json(res, control.calls);
    if (url.pathname === '/js/att/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end('window.ATT_CONFIG = ' + JSON.stringify({ adapter: 'sheets', apiUrl: connected ? '/exec' : '', token: connected ? 'secret-token' : '', actor: 'e2e' }) + ';');
    }
    const p = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  return new Promise((ok) => server.listen(port, () => ok({ server, url: 'http://localhost:' + server.address().port })));
}
module.exports = { start };
if (require.main === module) start(8788).then((s) => console.log('Test server (fake sheet, real Code.gs): ' + s.url + '/pages/schedule.html'));
