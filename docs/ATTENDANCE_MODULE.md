# Facilitator / Trainer / T&D Attendance module

Scope: the **daily work attendance of facilitators, trainers and Training & Development team members** and the
Attendance / Punctuality / Behavior KRA calculated from it. There is **no** trainee or participant attendance in this
module (no table, API or UI), and it does not touch Training Program Delivery: attendance belongs to a person and a work
date, training sessions belong to sessions.

```
pages/facilitator-attendance.html
   js/attendance-ui.js        renders; sends every change to the server first; keeps only the access token (sessionStorage)
   js/attendance-logic.js     vocabulary, validation, identity resolution, KRA calculation (pure functions, shared with tests and the dashboard)
   js/attendance-api.js       the only code that talks to the backend
        | HTTPS POST text/plain {action, token, ...}
backend/attendance-apps-script/   Api (token auth, router) -> Service -> Repository (the only file that knows the sheet) + Validation, Identity, Config, Setup
        |
Google Sheet "TDD Team Attendance Monitoring 2026", tab ATTENDANCE_LOG (LISTS = roster and vocabulary)
```

The browser never edits the sheet. The frontend holds no attendance database: it shows what the server returned, so an
empty sheet is shown as empty. Configuration is `js/attendance-config.js` (`apiUrl` only, never a token).

## Data model

One record = **person + work date + status + time in + time out + work location + leave type + remarks**, one per team
member per day (the sheet's own rule). Raw records are authoritative; nothing derived is stored.

| Sheet column (`ATTENDANCE_LOG`) | Field | Notes |
|---|---|---|
| Date | `work_date` | ISO `yyyy-mm-dd`; `dd/mm/yyyy`, real dates and serial numbers are all read |
| Team Member | `person` | the sheet's LISTS spelling is what gets written |
| Position | `position` | filled from LISTS when a row is created |
| Status | `status` | code below; labels are the sheet's own |
| Time In / Time Out | `time_in`, `time_out` | `HH:mm`; `8:05 AM` style is read; written as real time values formatted `HH:mm` |
| Work Location / Assignment | `work_location` | |
| Leave Type | `leave_type` | only with status On Leave (optional even then: the sheet says "only needed when") |
| Remarks | `remarks` | max 1000 characters |

Columns are found by header text, so order does not matter and extra columns are left alone. A missing header is reported
by name. `ATTENDANCE_LOG` and `LISTS` are never restructured; the only thing added to the workbook is an `ATTENDANCE_AUDIT`
tab (append-only log of who created, updated or deleted what).

**Statuses (unrenamed):** Present, Late, Half Day, Absent, On Leave, Official Business / Field, Work From Home, Rest Day / Day Off, Holiday.
**Work locations:** Head Office, Training Room, Store Visit / Field, Commissary, Other.
**Leave types (the sheet's wording):** Vacation Leave, Sick Leave, Emergency Leave, Birthday Leave, Maternity / Paternity Leave, Leave Without Pay, Other.
Short forms typed in the sheet are read through one documented mapping: Vacation, Sick, Emergency, Birthday, Maternity / Paternity, Leave Without Pay (or LWOP) map to the codes above. Nothing else is guessed; unrecognised values are reported as row problems and never "fixed".
No categories were added. If the sheet's LISTS tab gains a value this module does not know, `meta.vocabulary_warnings` says so.

**Validation** (server-authoritative, mirrored in the browser, and a test checks both reject the same cases): person required and on the TEAM MEMBER list; date required and real; status required and known; times valid `hh:mm` and Time Out not before Time In; leave type known and only with On Leave; location known; remarks length. Duplicate person/day is impossible through the API (see concurrency).

**Concurrency:** editing sends the record's `expected_version` (a content hash). A save with no version for an existing row, or a stale one, returns `CONFLICT` and the page reloads the row: nobody's edit is silently overwritten. Writes are serialised with `LockService`.

## Identity

`data/team-identity.json` (mirrored in `backend/attendance-apps-script/Identity.gs`; a test fails if they drift) maps every
spelling to one `person_id`, reusing the hub roster ids (`data/kpi-monthly.json`). Only listed names resolve; nothing is
matched by similarity. Every name is tagged `CONFIRMED` (exact repo/sheet spelling or an explicit repo mapping) or
`PROPOSED` (plausible, unconfirmed). Alias spellings can never create a second person: the same person under two spellings is
one record per day, one KRA row, and the sheet keeps its LISTS spelling. Names not in the identity file are kept separate and reported.

Unconfirmed links (the attendance sheet spells them differently from the hub roster, and no repo file confirms the link):
**Ricelle Lim -> RICE**, **Alliana Papa -> YANA**, **Jeliver Guerrero -> VER**. The UI marks them "identity link unconfirmed" and the KRA lists them under data quality.
**Sky** (hub roster, Training Program facilitators) is not on the attendance sheet's TEAM MEMBER list; **Nica Tardio** (`NICA`) is on the sheet but not on the Store Visit roster.

## Attendance KRA

The only documented rule is the formula (README, `pages/attendance.html`):

> (Days Present − Lates − Absences) / Total Working Days × 100%

**No file in either repository says how Half Day, On Leave, Rest Day, Holiday, Official Business or Work From Home enter it.**
`js/attendance-logic.js` therefore carries an explicit `POLICY` whose every non-literal treatment is marked
`confirmed: false`, and every result reports `provisional` plus the reason for each assumption it used.

| Status | Working day | Present credit | Late / Absence | Confirmed? |
|---|---|---|---|---|
| Present | yes | 1 | | **yes** (formula term) |
| Absent | yes | 0 | absence | **yes** (formula term) |
| Late | yes | 1 | late | no: formula subtracts Lates from Days Present, implying a late day is first "present" |
| Half Day | yes | 0.5 | | no |
| Official Business / Field, Work From Home | yes | 1 | | no |
| On Leave (any Leave Type) | no | 0 | | no |
| Rest Day / Day Off, Holiday | no | 0 | | no |

Other calculation assumptions, all reported with the result: a negative result is floored at 0%; if a person has more than one
record for a day, the first counts and the rest are flagged; records with a missing/unrecognised status are excluded and counted. A person or month with no
working days gets `null`, never 0. A rating with only Present/Absent records is not provisional.
Changing a treatment is a data change in `POLICY` (a test shows the result follows the supplied policy). The SQL reference table in
`TddProjectai/database/migrations/014_attendance_scheduling.sql` mirrors the same provisional flags.

## API

`POST <web-app URL>`, body sent as `text/plain` JSON `{action, token, ...params}` (no CORS preflight). Same transport, envelope and error codes as the Activity module.
Response `{ok:true,data}` or `{ok:false,error:{code,message,details}}`. `GET` returns a health object only.

| action | params | returns | client method |
|---|---|---|---|
| `meta` | | `user`, `role`, `today` (sheet time zone), `team_members[{name,position,person_id,link_status}]`, vocabularies, `vocabulary_warnings` | `getMeta()` |
| `list` | `from?`, `to?`, `person?` | `{records, total_rows_in_sheet, problem_rows}`; each record has `problems[]` and `version` | `listRecords(q)` |
| `save` | `record`, `expected_version?` | the saved record (create or update) | `saveRecord(record, expectedVersion)` |
| `remove` | `person`, `work_date`, `expected_version` | `{deleted:true}` | `deleteRecord(person, date, version)` |

Errors: `UNAUTHORIZED`, `FORBIDDEN` (read-only token writing), `VALIDATION_ERROR` (`details:[{field,message}]`), `CONFLICT`, `NOT_FOUND`, `CONFIG_MISSING`, `BUSY`, `BAD_REQUEST`, `INTERNAL_ERROR`; client-side `BACKEND_UNAVAILABLE`, `BAD_RESPONSE`.

### Authentication and security assumptions

This module **reuses the design the Activity module already established** rather than inventing another mechanism: the web app is deployed
"Execute as me / Anyone"; every call needs a per-user token; only SHA-256 hashes of tokens are stored (script property `ATTENDANCE_TOKENS`); tokens are
entered in the browser and kept for the tab only; no token, key or password is ever in the repo. Roles: `write` and `read`.
**Dependency:** if the main-application session provides a shared gateway or proxy, point `apiUrl` at it and keep this contract; no code here
depends on the token model. Limits inherited from that design: a leaked token works until revoked, there is no rate limiting, and the URL is public (it answers `UNAUTHORIZED` without a token).
The site's own gate (`netlify/edge-functions/basic-auth.js`) is separate and was not changed or re-verified here.

## Setup (administrator, one time)

1. Open **TDD Team Attendance Monitoring 2026 -> Extensions -> Apps Script** (script bound to the workbook), or use a standalone script and set the `ATTENDANCE_SPREADSHEET_ID` property.
2. Create one file per `backend/attendance-apps-script/*.gs` (same names) and paste `appsscript.json` (Project Settings -> show manifest). Do not commit `.clasp.json` or credentials.
3. Run **`setupAttendanceModule()`**. It checks the headers and roster, creates the `ATTENDANCE_AUDIT` tab and writes no attendance.
4. Run **`addAttendanceUser("name", "write")`** for each editor (`"read"` for viewers). The token is logged once; share it privately.
5. **Deploy -> Web app**: Execute as **Me**, access **Anyone**. Put the `/exec` URL in `js/attendance-config.js` (`apiUrl`). Redeploy edits as a *new version*.

## Dashboard integration (owned by the main-application session)

The dashboard must not contain typed attendance figures. Two supported paths, both computing from the sheet's records with the same `AttendanceLogic`:

* **Snapshot feed (matches how the other KRAs work):** `ATTENDANCE_TOKEN=<read token> node scripts/build_attendance_monthly.js --api <url> --from 2026-07 --to 2026-09 > data/attendance-monthly.json`.
  Output is keyed by `person_id`, holds no names, and includes `records`, `working_days`, `days_present`, `lates`, `absences`, `rating_pct` (or none) and `provisional` per person per month, plus issue counts. An empty sheet gives months with `records: 0` and no results.
* **Live:** `AttendanceApi.listRecords({from,to})` then `AttendanceLogic.kraMonthly(records, AttendanceLogic.createIdentity(identityJson))`. This needs the per-user token flow on the dashboard pages.

`js/kpi.js` was **not** modified. To use the feed there, `cell(d,'attendance',id,...)` would map `rating_pct/100` to `rating` and `rating * weights.attendance` to `points`, showing "no data" when a person has no result, and should label provisional values.

## Tests

```
TZ=Asia/Manila node --test tests/attendance.backend.test.js tests/attendance.logic.test.js     # 31 tests, no dependencies
NODE_PATH=$(npm root -g) node tests/attendance-e2e.js                                           # 20 browser checks (Playwright + Chromium)
```

`tests/attendance-gas-harness.js` runs the **real `.gs` files** in a Node `vm` over an in-memory fake sheet seeded with the real headers and LISTS, no attendance rows, and human-style rows (12-hour times, text dates, typos, aliases, duplicates).

## Verification status

| Item | Status |
|---|---|
| Sheet structure (headers, LISTS roster and vocabulary, zero data rows) | **Verified** against the real workbook, read-only, via the Drive connector on 2026-09-29 |
| Backend logic, validation, concurrency, alias handling, empty-sheet behaviour | Verified against a **fake** sheet (31 tests) |
| UI in a real browser (desktop, tablet, phone) | Verified against the **fake-backed** server (20 checks) |
| Deployed Apps Script web app, real reads and writes on the real sheet | **Not yet possible: not deployed.** No smoke test has run against Google's runtime. |

Google-runtime behaviours the fake cannot prove, to check on the first real run: reading times/dates from real cell formats and locales (`getDisplayValues`), `setNumberFormat`, `Utilities.parseDate`, `LockService`, and the browser calling an "Anyone" web app across Google's redirect.

**Safe smoke test once deployed** (get the sheet owner's OK first, because the sheet is an operational template): run `setupAttendanceModule()` (writes nothing but the audit tab); open the page and confirm the empty state; save one clearly labelled record (Remarks "SMOKE TEST - delete") for a real team member on a far-future date, confirm the row, then use *Clear* to remove it. The append-only `ATTENDANCE_AUDIT` tab will keep the create/delete lines.

## Known limitations

* Time Out earlier than Time In is rejected, so a shift crossing midnight cannot be recorded (none is documented).
* The browser loads a day or a month at a time and filters client-side; fine for one team, revisit for much larger volumes. Apps Script adds about 1-3 seconds per call.
* Removing a record deletes the sheet row (the audit tab records it); there is no soft delete.
* Not covered: bulk import, notifications, per-user permissions beyond read/write, real SSO.

## Open questions

**HRAD / business rules:** how Half Day, On Leave (and Leave Without Pay vs other leave), Rest Day, Holiday, Official Business and Work From Home count; whether a Late day is also a Present day; whether a negative result is floored; whether the Attendance target is per month or cumulative.
**Identity:** confirm Ricelle Lim = RICE, Alliana Papa = YANA, Jeliver Guerrero = VER; is Sky a T&D team member whose attendance is tracked?
**Sheet:** is Leave Type required when Status is On Leave (the sheet says "only needed")? Is night-shift attendance possible?
