// Local test server: serves the static site AND exposes the REAL Apps Script backend
// (backend/apps-script/*.gs, run over an in-memory fake sheet) at POST /api.
// Used by the browser tests; also handy for trying the UI without deploying anything.
//   node tests/dev-server.js [port]     ->  http://localhost:8787/pages/activity.html?api=http://localhost:8787/api
// Test controls (dev only): POST /__control {"failNext":"updateStatus"|"any","mode":"error"|"drop"|"slow"}
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createRuntime } = require('./gas-harness');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function iso(offsetDays) { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function start(port = 8787) {
  const rt = createRuntime();
  rt.setup();
  const W = rt.addUser('leo', 'write'), R = rt.addUser('viewer', 'read');
  const mk = (a) => { const r = rt.handle({ action: 'create', token: W, activity: a }); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data; };
  const seed = [
    { activity_title: 'Orientation batch - SM North', activity_type: 'ORIENTATION', owner_id: 'LEO', assigned_to_id: 'ALEX', status: 'PLANNED', priority: 'HIGH', activity_date: iso(3), due_date: iso(5), brand_id: 'ANGELS_PIZZA', location_name: 'SM North EDSA', kpi_id: 'TRAINING_DELIVERY', progress_percent: 10, evidence_url: 'https://example.com/evidence' },
    { activity_title: 'Overdue refresher - Figaro Ayala', activity_type: 'REFRESHER', owner_id: 'ANN', status: 'IN_PROGRESS', priority: 'URGENT', activity_date: iso(-20), due_date: iso(-3), brand_id: 'FIGARO', location_id: 'ST-014', location_name: 'Figaro Ayala', progress_percent: 60 },
    { activity_title: 'Coaching follow-up (Tien Ma\'s)', activity_type: 'COACHING_CORRECTIVE_ACTION', owner_id: 'LEO', assigned_to_id: 'LEO', status: 'IN_PROGRESS', priority: 'MEDIUM', activity_date: iso(-2), due_date: iso(10), brand_id: 'TIEN_MAS', kpi_id: 'COACHING', progress_percent: 30 },
    { activity_title: 'Backlog: rider refresher plan', activity_type: 'RIDER_REFRESHER', owner_id: 'JOSH', status: 'BACKLOG', priority: 'LOW', activity_date: iso(30) },
    { activity_title: 'Store visit report review', activity_type: 'REPORTING', owner_id: 'RICE', status: 'FOR_REVIEW', priority: 'MEDIUM', activity_date: iso(-1), due_date: iso(2), kpi_id: 'STORE_VISITS', progress_percent: 90 },
    { activity_title: 'TLTC cohort 3 (done)', activity_type: 'TLTC', owner_id: 'VER', status: 'COMPLETED', priority: 'HIGH', activity_date: iso(-40), due_date: iso(-30), brand_id: 'MULTI_BRAND' },
    { activity_title: 'Postponed seminar', activity_type: 'SEMINAR_WORKSHOP', owner_id: 'DANIEL', status: 'ON_HOLD', priority: 'LOW', activity_date: iso(15), due_date: iso(-1) },
    { activity_title: 'Cancelled workshop', activity_type: 'SEMINAR_WORKSHOP', owner_id: 'DANIEL', status: 'CANCELLED', priority: 'LOW', activity_date: iso(-10) },
    { activity_title: 'Next-year kickoff', activity_type: 'MEETING', owner_id: 'LEO', status: 'PLANNED', priority: 'MEDIUM', activity_date: (new Date().getFullYear() + 1) + '-01-15' },
    { activity_title: '<img src=x onerror=window.__xss=1> injected', activity_type: 'OTHER', owner_id: 'LEO', status: 'BACKLOG', priority: 'LOW', activity_date: iso(1) },
  ];
  seed.forEach(mk);

  const control = { failNext: null, mode: 'error', calls: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (req.method === 'POST' && url.pathname === '/__control') {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { Object.assign(control, JSON.parse(b || '{}')); res.writeHead(200, cors); res.end('{}'); }); return;
    }
    if (req.method === 'GET' && url.pathname === '/__calls') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(control.calls)); return; }
    if (req.method === 'POST' && url.pathname === '/api') {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
        let parsed = {}; try { parsed = JSON.parse(b); } catch (e) { /* handled by backend */ }
        control.calls.push(parsed.action);
        const hit = control.failNext && (control.failNext === 'any' || control.failNext === parsed.action);
        if (hit) {
          control.failNext = null;
          if (control.mode === 'drop') { req.socket.destroy(); return; }
          if (control.mode === 'html') { res.writeHead(200, { ...cors, 'Content-Type': 'text/html' }); res.end('<html>Sign in to Google</html>'); return; }
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error. Nothing was saved.', details: null } })); return;
        }
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rt.post(b)));
      }); return;
    }
    let p = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, rt, tokens: { write: W, read: R }, control, port, url: `http://localhost:${port}` })));
}

module.exports = { start };
if (require.main === module) start(+process.argv[2] || 8787).then((s) => {
  console.log(`Dev server ${s.url}\n  write token: ${s.tokens.write}\n  read token:  ${s.tokens.read}\n  open: ${s.url}/pages/activity.html?api=${s.url}/api`);
});
