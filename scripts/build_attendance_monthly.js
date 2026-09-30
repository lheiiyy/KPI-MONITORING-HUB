#!/usr/bin/env node
/**
 * Builds the monthly Attendance KRA feed for the dashboard FROM THE SHEET'S RECORDS (never typed in):
 *
 *   ATTENDANCE_TOKEN=<read token> node scripts/build_attendance_monthly.js \
 *       --api <web-app /exec URL> --from 2026-07 --to 2026-09 > data/attendance-monthly.json
 *
 * Output is keyed by canonical person_id (the hub roster ids), holds no names, and states whether each rating is
 * provisional. An empty sheet produces months with zero records and no results: never zeros.
 * The token is read from the environment only. Contract: docs/ATTENDANCE_MODULE.md
 */
const fs = require('fs'), path = require('path');
const L = require('../js/attendance-logic'), Api = require('../js/attendance-api');

function months(from, to) { const out = []; for (let m = from; m <= to; m = L.addMonths(m, 1)) out.push(m); return out; }

async function build(opts) {
  const range = { from: L.monthRange(opts.from), to: L.monthRange(opts.to) };
  if (!range.from || !range.to || opts.from > opts.to) throw new Error('--from and --to must be months (yyyy-mm) with from <= to');
  const identity = L.createIdentity(JSON.parse(fs.readFileSync(opts.identityPath || path.join(__dirname, '..', 'data', 'team-identity.json'), 'utf8')));
  const data = await opts.api.listRecords({ from: range.from.from, to: range.to.to });
  const out = { generated_at: (opts.now || new Date()).toISOString(), source: 'TDD Team Attendance Monitoring 2026 / ATTENDANCE_LOG', formula: L.POLICY.formula,
    policy_note: 'Treatments other than Present and Absent are provisional pending HRAD confirmation. See docs/ATTENDANCE_MODULE.md.',
    sheet_rows_total: data.total_rows_in_sheet, months: {} };
  months(opts.from, opts.to).forEach(m => {
    const r = L.monthRange(m), recs = data.records.filter(x => x.work_date && x.work_date >= r.from && x.work_date <= r.to);
    const k = L.kraMonthly(recs, identity);
    out.months[m] = {
      records: recs.length,
      results: k.results.filter(x => x.person_id).map(x => ({ person_id: x.person_id, records: x.records, working_days: x.working_days, days_present: x.days_present,
        lates: x.lates, absences: x.absences, rating_pct: x.rating_pct, provisional: x.provisional })),
      issues: { duplicate_person_days: k.issues.duplicates.length, unresolved_names: k.issues.unresolved_names.length, invalid_status_rows: k.issues.invalid_status_rows,
        via_unconfirmed_identity_link: k.issues.proposed_alias_matches.length }
    };
  });
  return out;
}

if (require.main === module) {
  const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const token = process.env.ATTENDANCE_TOKEN;
  if (!arg('api') || !arg('from') || !arg('to') || !token) { console.error('usage: ATTENDANCE_TOKEN=... node scripts/build_attendance_monthly.js --api <url> --from yyyy-mm --to yyyy-mm'); process.exit(2); }
  build({ api: Api.create({ url: arg('api'), getToken: () => token }), from: arg('from'), to: arg('to') })
    .then(o => process.stdout.write(JSON.stringify(o, null, 1) + '\n')).catch(e => { console.error('failed:', e.message); process.exit(1); });
}
module.exports = { build };
