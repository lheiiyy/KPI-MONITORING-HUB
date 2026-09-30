# Training Program & Delivery module

Owner: Training Program Delivery. Pages: `pages/schedule.html` (Kanban), `pages/training-program-delivery.html` (KRA page + live report).
Source of truth: **`SESSION_LOG`** in *Training Program & Delivery Monitoring 2026* (`1mp4-6KHcX5iDB5Oto1Smjfyq-xW4KAZCC8CA09hhpB4`).

```
SESSION_LOG  ->  Code.gs (Apps Script)  ->  js/att/adapters/sheets.js  ->  js/att/service.js  ->  Kanban / report
   (data)          (only file that            (transport only)             (rules: workflow,        (UI, no sheet
                    knows the sheet)                                        validation, report)       knowledge)
```

This module **extends the existing implementation** (`js/att/*`, `apps-script/Code.gs`, introduced on `attendance-scheduling`);
it adds no second backend, adapter, or identity list. Nothing in `SESSION_LOG` or any report sheet is copied: every figure is
computed from session rows on each load.

## What is here

| Area | Behaviour |
|---|---|
| Kanban | Columns Planned / Conducted / Postponed / Cancelled. Drag a card **or** use its *Move to…* menu (works on phones). Both call `service.moveSession`, i.e. the same validated write. |
| Write-back order | validate transition -> show the move -> write to the sheet -> replace the card with what the sheet returned -> confirm ("saved to the sheet"). |
| Failure handling | Any failure puts the card back and shows the reason. For **unknown outcomes** (network/server error, conflict) the board re-reads the sheet instead of assuming nothing was written. A card that is saving cannot be moved again (one write per action). |
| Not connected | With no `apiUrl`/`token` the pages run in memory only; a move is labelled **NOT SAVED** and the report says it is unavailable rather than showing an empty report. |
| Filters | Year (from the data, never a constant), month, brand, facilitator, search. Live summary strip for what is shown. |
| Report (KRA page) | Sessions by status, delivery rate, overdue/upcoming, target/actual pax, pax fill, post-test average, per-facilitator table; year/month filter. |

## Status workflow (unchanged; mirrors `ref_session_status_transitions` in migration 014)

| From \ To | Planned | Conducted | Postponed | Cancelled |
|---|---|---|---|---|
| **Planned** | – | yes | yes | yes |
| **Conducted** | no | – | no | no |
| **Postponed** | yes | no | – | yes |
| **Cancelled** | no | no | no | no |

Conducted and Cancelled are final: never silently reopened. Enforced in `js/att/domain.js` (UI + service) **and** `Code.gs`
(server); a test checks all 16 pairs on both, plus that a refused move leaves the sheet row byte-identical.

## Validation

* Program / Module required. Date `yyyy-mm-dd` or the sheet's `dd/mm/yyyy`, real calendar dates only. Pax whole numbers >= 0; duration >= 0; post-test 0-100. Training type / brand must be a value from `LISTS`.
* **Conducted needs a date** (documented rule, also a DB constraint). Dragging an undated session to Conducted does *not* move it: the dialog opens for the date; saving without one is refused by the service and by the server. A Conducted session cannot be edited to have no date. A new session is always created Planned.
* Facilitators must be on the `LISTS` roster (canonical spelling); unknown names are refused on write.
* Optimistic concurrency: a content hash of the row is the version; a stale writer gets `CONFLICT`.
* No rule was added beyond the repository's (e.g. Conducted does not require pax or post-test).

## Report definitions (derived, none stored)

| Figure | Definition |
|---|---|
| Sessions / by status | Count of session rows in the period. Empty template rows are not sessions. |
| Due | Conducted, **or** not cancelled and dated today or earlier. |
| Delivery rate | Conducted / Due. **null ("no data") when nothing is due**, never 0 or 100. |
| Overdue / Upcoming | Due but not Conducted / Planned and dated after today. |
| Target pax | Sum over non-cancelled sessions with a target. Actual pax: Conducted sessions. |
| Pax fill | Actual / target over Conducted sessions that have both (headcount only; **no trainee attendance records**). |
| Post-test | Unweighted mean of Post-Test Avg over Conducted sessions that have one. |
| Per-facilitator rating | Conducted / Programs Required, capped at 100%. Required = **2 per month** (from the KRA page's stated target) x months in the period (month = 1; past year = 12; current year = months elapsed; future year = none -> no rating). A session with several facilitators counts once for each. Facilitators with no session in the period are listed as "no data", not scored 0. |

**Assumptions needing HRAD confirmation:** the 2-per-month target (a parameter, `TARGET_PROGRAMS_PER_MONTH`), the definition of "due", and unweighted post-test averaging.

## Data & the empty template

`SESSION_LOG` headers (verified read-only against the live sheet, see below) are matched by text, in any column order. A row counts as a session only if it has a program, date, venue, or facilitator; a row with only a status or only numbers is *not* a session. Pre-numbered IDs (`TPD-0001` ...) are preserved: a new session fills the first empty row keeping its ID, and appends `TPD-n+1` past the template. No dates, facilitators, pax or results are ever generated. A blank Status reads as Planned.

## API used (existing contract, `apps-script/Code.gs`; nothing new was added)

POST `text/plain` JSON `{token, action, params, actor}` -> `{ok, data}` | `{ok:false, error:{code,message}}`.
Read: `getReference`, `listSessions`, `getSession` (the report and board use `listSessions`). Write: `createSession`, `updateSession` (a status change is an `updateSession` with `patch.status`). Errors: `VALIDATION, CONFLICT, NOT_FOUND, TRANSITION, AUTH, NETWORK, SERVER`. Every write is appended to `AUDIT_LOG`.
The module uses **no endpoint that does not already exist**. For PostgreSQL, implement the adapter contract at the top of `js/att/service.js`.

**Security assumptions (unchanged, and weak):** the API is deployed "Anyone" and its token ships to every visitor of the site, so it only stops casual misuse; `actor` in the audit log is client-supplied. Real protection today is the site-level Basic Auth on Netlify (`netlify/edge-functions/basic-auth.js`). See `apps-script/README.md`, "Security".

## Identity

Facilitators are the names on `SESSION_LOG`'s `LISTS!D` roster; the service maps typed names to that spelling (case/space-insensitive) and refuses others. **The module does not invent identities or merge spellings**: the report shows a name not on the roster as "(not on roster)", and "Ricelle Lim" is not treated as "Ricelle (Rice) Lim". Open item for the project's shared people strategy (`people` / `person_aliases` in migration 014, or the hub's `data/kpi-monthly.json` ids): the attendance sheet's `TEAM MEMBER` list and this roster spell some people differently (and Nica Tardio has no id in the hub roster), so cross-module warnings only match identical normalised names. Fix belongs in the shared alias table, not here.

## Year handling

No year appears in logic or UI. Year options come from the data plus the current year; the 2026 in the workbook name is only the default `SESSIONS_SHEET_ID` (override via Script Property). 2027+ rows can live in the same tab (IDs keep counting) or in another workbook by changing that property; no code changes.

## Integration

* Landing page / `js/kpi.js` (owned by the dashboard session) were **not modified**. `kpi.js` still reads static JSON and shows "no data" for Training Program Delivery. To feed it from live data, call `ATT.service.deliveryReport({year, month})` (or the pure `ATT.domain.summarizeDelivery(sessions, opts)`): it returns `{byStatus, deliveryRatePct, facilitators:[{name, conducted, required, ratingPct, onRoster}], ...}`.
* Attendance: separate tables/sheet; this module only reads the attendance list to warn about double-booking/days off (existing behaviour). It adds no participant attendance.

## Tests

```
npm test                                             # 37 Node tests: att.test.js (22, existing) + delivery.test.js (15)
NODE_PATH=$(npm root -g) node test/delivery-e2e.js   # 30 browser tests, real Code.gs over a fake sheet, raw cells asserted
```
Mutation checks done: loosening the server matrix, dropping the server's Conducted-date rule, counting cancelled as due, and making the drop UI-only each turn tests red (the UI-only mutation fails 12 browser tests).

## Verification status - read before calling this production-ready

* **Not verified against the real Google Sheet.** All write tests use an in-memory fake of Sheets/Apps Script; `Code.gs` has never run in Google's runtime from this work, and the web app is not confirmed deployed or configured (`apiUrl`/`token` in `js/att/config.js`, `API_TOKEN` property).
* **Verified read-only against the live sheet (2026-09-29, Drive):** `SESSION_LOG` row 1 has exactly the 13 headers `Code.gs` expects, `LISTS!D` header starts with `FACILITATOR ROSTER`, statuses/brands/training types match the code lists, and no data rows exist (IDs `TPD-0001`...`TPD-0152` visible, all other cells empty). Nothing was written.
* **Controlled real-sheet smoke test to run after deployment** (uses one clearly labelled test row, then removes it): (1) open the schedule page, banner says Connected, board empty; (2) create "SMOKE TEST - delete" -> check row `TPD-0001` filled, Status `Planned`, `AUDIT_LOG` has CREATE; (3) drag it to Postponed, then Planned, then Cancelled -> Status cell follows each move and `AUDIT_LOG` has STATUS_CHANGE rows; (4) refresh: board matches the sheet; (5) edit the row in the sheet by hand, then drag a stale card -> CONFLICT message; (6) clear the test row's cells (keep the ID) and delete the audit rows.
