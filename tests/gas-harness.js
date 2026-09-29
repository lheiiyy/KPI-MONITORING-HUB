// Loads the REAL backend/apps-script/*.gs files into a Node vm with an in-memory
// fake of the Google services they use. No logic is reimplemented here: the
// fake only stores cells. It deliberately mimics two Sheets behaviours that
// corrupt data when code forgets to guard them:
//   - a cell NOT formatted as plain text ("@") turns "2026-03-01" into a Date
//   - a cell NOT formatted as plain text turns "=..." into a formula
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const GS_DIR = path.join(__dirname, '..', 'backend', 'apps-script');
const FILES = ['Config.gs', 'Validation.gs', 'Repository.gs', 'Service.gs', 'Api.gs', 'Setup.gs'];

class FakeSheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.fmt = new Map(); this.frozen = 0; }
  getName() { return this.name; }
  _maxR() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[0]); return m; }
  getLastRow() { return this._maxR(); }
  getLastColumn() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[1]); return m; }
  getMaxRows() { return Math.max(1000, this._maxR()); }
  setFrozenRows(n) { this.frozen = n; }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    const range = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
        const v = s.cells.get(`${r + i},${c + j}`); return v === undefined ? '' : v;
      })),
      setValues(vals) {
        vals.forEach((row, i) => row.forEach((v, j) => {
          const key = `${r + i},${c + j}`;
          if (s.fmt.get(key) !== '@' && typeof v === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v = new Date(v + 'T00:00:00Z');       // Sheets auto-date
            else if (/^=/.test(v)) v = { formula: v };                               // Sheets formula
          }
          s.cells.set(key, v);
        }));
        return range;
      },
      setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.fmt.set(`${r + i},${c + j}`, f); return range; },
      setFontWeight() { return range; },
    };
    return range;
  }
}

function createRuntime() {
  const sheets = new Map();
  const props = new Map();
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
    getSpreadsheetTimeZone: () => 'Asia/Manila',
  };
  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => props.set(k, v),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
          .formatToParts(d).map((x) => [x.type, x.value]));
        if (fmt !== 'yyyy-MM-dd') throw new Error('unsupported format in fake');
        return `${p.year}-${p.month}-${p.day}`;
      },
    },
  };
  const ctx = vm.createContext(sandbox);
  // Files share one global scope in Apps Script; concatenate to mimic that.
  const src = FILES.map((f) => fs.readFileSync(path.join(GS_DIR, f), 'utf8')).join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'apps-script-bundle.gs' });
  const call = (name, ...args) => vm.runInContext(`${name}`, ctx)(...args);
  return {
    ctx, sheets, props, ss, call,
    setup() { call('setupActivityModule'); },
    addUser(user, role) { return call('addActivityUser', user, role); },
    // JSON round trip = what the wire does (also normalises vm-realm arrays/objects)
    handle(body) { return JSON.parse(JSON.stringify(call('handleRequest_', JSON.parse(JSON.stringify(body))))); },
    /** Full doPost round trip as a string, like the real web app. */
    post(bodyObj) { return JSON.parse(call('doPost', { postData: { contents: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj) } }).getContent()); },
  };
}

module.exports = { createRuntime, FakeSheet };
