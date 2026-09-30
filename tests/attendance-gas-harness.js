// Runs the REAL backend/attendance-apps-script/*.gs files in a Node vm over an in-memory fake of the Google
// services they use. The fake workbook carries the real sheet's headers and LISTS values and NO attendance rows
// (the real sheet is an empty template). It proves the backend logic, NOT Google's runtime: see
// docs/ATTENDANCE_MODULE.md, "Verification status".
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'backend', 'attendance-apps-script');
const LOG_HEAD = ['Date', 'Team Member', 'Position', 'Status', 'Time In', 'Time Out', 'Work Location / Assignment', 'Leave Type', 'Remarks'];
const LISTS_ROWS = [
  ['TEAM MEMBER', 'POSITION', 'STATUS', 'WORK LOCATION', 'LEAVE TYPE', '', 'HOW TO USE'],
  ['Geoffrey Carranceja', 'Sr. Manager', 'Present', 'Head Office', 'Vacation Leave', '', 'One row per team member per working day.'],
  ['Daniel De Leon', 'Manager', 'Late', 'Training Room', 'Sick Leave', '', ''],
  ['Alex Rivera', 'Supervisor', 'Half Day', 'Store Visit / Field', 'Emergency Leave', '', ''],
  ['Ricelle Lim', 'Asst. Supervisor', 'Absent', 'Commissary', 'Birthday Leave', '', ''],
  ['James Nacionales', 'Officer', 'On Leave', 'Other', 'Maternity / Paternity Leave', '', ''],
  ['Josh Earnshaw', 'Officer', 'Official Business / Field', '', 'Leave Without Pay', '', ''],
  ['Nica Tardio', 'Officer', 'Work From Home', '', 'Other', '', ''],
  ['Charlie Moises', 'Assistant', 'Rest Day / Day Off', '', '', '', ''],
  ['Leo Fernandez', 'Assistant', 'Holiday', '', '', '', ''],
  ['Ann Barredo', 'Assistant', '', '', '', '', ''],
  ['Alliana Papa', 'Assistant', '', '', '', '', ''],
  ['Jeliver Guerrero', 'Assistant', '', '', '', '', '']
];

function pad(n) { return String(n).padStart(2, '0'); }
// A cell is {v, f}: raw value and number format. Display strings are derived like Sheets would.
function display(c) {
  if (c.d !== undefined) return c.d;                       // explicit display (used to seed human-typed cells)
  const v = c.v;
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number' && c.f === 'HH:mm') { const m = Math.round(v * 1440); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v);
}
function makeSheet(name, rows) {
  const s = {
    name, cells: rows.map(r => r.map(v => (v !== null && typeof v === 'object' && !(v instanceof Date) ? v : { v }))),
    getName: () => name,
    getLastRow() { let last = 0; s.cells.forEach((r, i) => { if (r.some(c => c.v !== '' && c.v != null)) last = i + 1; }); return last; },
    getLastColumn() { return Math.max(1, ...s.cells.map(r => r.length)); },
    getDataRange() { return s.getRange(1, 1, Math.max(1, s.cells.length), s.getLastColumn()); },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const at = (i, j) => (s.cells[r - 1 + i] || [])[c - 1 + j] || { v: '' };
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => at(i, j).v)),
        getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => display(at(i, j)))),
        setValues: (vals) => vals.forEach((row, i) => { const t = s.cells[r - 1 + i] = s.cells[r - 1 + i] || []; row.forEach((v, j) => { const old = t[c - 1 + j]; t[c - 1 + j] = { v, f: old && old.f }; }); }),
        setNumberFormat: (f) => { for (let i = 0; i < nr; i++) { const t = s.cells[r - 1 + i] = s.cells[r - 1 + i] || []; for (let j = 0; j < nc; j++) { const cell = t[c - 1 + j] = t[c - 1 + j] || { v: '' }; cell.f = f; delete cell.d; } } }
      };
    },
    appendRow(vals) { s.cells.push(vals.map(v => ({ v }))); },
    deleteRow(n) { s.cells.splice(n - 1, 1); }
  };
  return s;
}
function makeBook(sheets) {
  const b = { sheets, getSheetByName: (n) => b.sheets.find(x => x.name === n) || null, getSpreadsheetTimeZone: () => 'Asia/Manila',
    insertSheet: (n) => { const s = makeSheet(n, []); b.sheets.push(s); return s; } };
  return b;
}

function load(opts = {}) {
  const log = makeSheet('ATTENDANCE_LOG', [(opts.header || LOG_HEAD).slice()]);
  const lists = makeSheet('LISTS', (opts.lists || LISTS_ROWS).map(r => r.slice()));
  const book = makeBook([log, lists]);
  const props = new Map(Object.entries(opts.props || {}));
  let lockBusy = false;
  const ctx = {
    console: { error() {}, log() {} }, Logger: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => (opts.unbound ? null : book), openById: (id) => { if (id !== 'WB') throw new Error('bad id'); return book; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() { if (lockBusy) throw new Error('lock'); }, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s).digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, f) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      parseDate: (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
      getUuid: () => crypto.randomUUID()
    },
    Object, JSON, Date, Math, Array, String, Number, RegExp, Error, Map, isFinite
  };
  vm.createContext(ctx);
  ['Config', 'Identity', 'Validation', 'Repository', 'Service', 'Api', 'Setup'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(DIR, f + '.gs'), 'utf8'), ctx, { filename: f + '.gs' }));
  const tokens = {};
  function addUser(user, role) {
    const sec = 'tok-' + user + '-' + role;
    const users = JSON.parse(props.get('ATTENDANCE_TOKENS') || '{}');
    users[crypto.createHash('sha256').update(sec).digest('hex')] = { user, role };
    props.set('ATTENDANCE_TOKENS', JSON.stringify(users)); tokens[user] = sec; return sec;
  }
  // What the browser would POST to the deployed web app.
  const fetchImpl = async (url, init) => {
    const resp = ctx.doPost({ postData: { contents: init.body } });
    return { ok: true, status: 200, text: async () => resp.text };
  };
  return { ctx, book, log, lists, props, addUser, tokens, fetchImpl, setLockBusy: (b) => { lockBusy = b; },
    call: (body) => JSON.parse(JSON.stringify(ctx.attHandleRequest_(body))) };
}
module.exports = { load, LOG_HEAD, LISTS_ROWS };
