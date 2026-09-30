// Loads apps-script/Code.gs into a Node VM against an in-memory fake of the Apps Script
// services it uses. The fake spreadsheets carry the pilot sheets' real headers and LISTS
// reference values, and NO attendance rows (the real sheets are an empty template).
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const SESSION_HEAD = ['Session ID', 'Date', 'Program / Module', 'Training Type', 'Brand', 'Store / Venue', 'Facilitator(s)', 'Target Pax', 'Actual Pax', 'Duration (hrs)', 'Status', 'Post-Test Avg (%)', 'Remarks'];
const FAC_HEAD = ['Date', 'Team Member', 'Position', 'Status', 'Time In', 'Time Out', 'Work Location / Assignment', 'Leave Type', 'Remarks'];

function makeSheet(name, rows) {
  const s = {
    name, rows,
    getName: () => name,
    getLastRow: () => s.rows.length,
    getLastColumn: () => Math.max(...s.rows.map(r => r.length)),
    getRange(r, c, nr, nc) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (s.rows[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })),
        setValues: (vals) => vals.forEach((row, i) => { const t = s.rows[r - 1 + i] = s.rows[r - 1 + i] || []; row.forEach((v, j) => { t[c - 1 + j] = v; }); })
      };
    },
    getDataRange: () => s.getRange(1, 1, s.rows.length, s.getLastColumn()),
    appendRow: (vals) => { s.rows.push(vals.slice()); },
    deleteRow: (n) => { s.rows.splice(n - 1, 1); }
  };
  return s;
}
function makeBook(sheets) {
  const b = { sheets, getSheetByName: (n) => b.sheets.find(s => s.name === n) || null, getSpreadsheetTimeZone: () => 'Asia/Manila',
    insertSheet: (n) => { const s = makeSheet(n, []); b.sheets.push(s); return s; } };
  return b;
}

function load(opts = {}) {
  const slots = opts.emptySlots == null ? 5 : opts.emptySlots;
  const sessionRows = [SESSION_HEAD.slice()];
  for (let i = 1; i <= slots; i++) sessionRows.push(['TPD-' + String(i).padStart(4, '0'), '', '', '', '', '', '', '', '', '', '', '', '']);
  const facLists = [['TEAM MEMBER', 'POSITION', 'STATUS'], ['Alex Rivera', 'Supervisor', 'Present'], ['Ricelle Lim', 'Asst. Supervisor', 'Late']];
  const sessLists = [['TRAINING TYPE', 'BRAND', 'STATUS', 'FACILITATOR ROSTER (type names separated by commas)'], ['Orientation', "Angel's Pizza", 'Planned', 'Alex Rivera'], ['', '', '', 'Ricelle (Rice) Lim']];
  const books = {
    SESSIONS: makeBook([makeSheet('SESSION_LOG', sessionRows), makeSheet('LISTS', sessLists)]),
    FAC: makeBook([makeSheet('ATTENDANCE_LOG', [FAC_HEAD.slice()]), makeSheet('LISTS', facLists)])
  };
  const idToBook = { S: books.SESSIONS, F: books.FAC };
  const props = Object.assign({ API_TOKEN: 'secret-token', SESSIONS_SHEET_ID: 'S', FACILITATOR_ATT_SHEET_ID: 'F' }, opts.props || {});
  const fmt = (d, tz, f) => { const p = (n) => String(n).padStart(2, '0'); return f === 'yyyy-MM-dd' ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` : `${p(d.getHours())}:${p(d.getMinutes())}`; };
  const ctx = {
    SpreadsheetApp: { openById: (id) => { if (!idToBook[id]) throw new Error('no book ' + id); return idToBook[id]; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Utilities: { formatDate: fmt, DigestAlgorithm: { MD5: 'md5' }, computeDigest: (_, s) => Array.from(crypto.createHash('md5').update(s).digest()).map(b => b > 127 ? b - 256 : b) },
    Object, JSON, Date, Math, Array, String, Number, isFinite
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  // fetch stand-in: what the browser would POST to the deployed web app.
  const fetchImpl = async (url, init) => {
    const resp = ctx.doPost({ postData: { contents: init.body } });
    return { ok: true, status: 200, json: async () => JSON.parse(resp.text) };
  };
  return { ctx, books, fetchImpl, props };
}
module.exports = { load };
