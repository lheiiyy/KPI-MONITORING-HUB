# Attendance & Scheduling API (Google Apps Script)

`Code.gs` is the pilot backend that lets the hub **write** to Google Sheets:

| Hub page | Reads / writes | Sheet |
|---|---|---|
| `pages/schedule.html` (Kanban) | training sessions | Training Program & Delivery Monitoring 2026 → `SESSION_LOG` |
| `pages/facilitator-attendance.html` | facilitator / trainer / T&D team daily attendance | TDD Team Attendance Monitoring 2026 → `ATTENDANCE_LOG` |

Rosters come from each sheet's `LISTS` tab. Trainee attendance is out of scope and the
*Training Attendance Monitoring 2026* sheet is never opened. Every write is also appended to an
`AUDIT_LOG` tab in the sessions spreadsheet (created on first write).

## Deploy (about 5 minutes)

1. Open **script.google.com** → *New project* (sign in as the account that owns the sheets).
2. Paste `Code.gs` over the default file.
3. *Project Settings → Script properties*, add:
   - `API_TOKEN` = a long random string (required; with no token every call is refused).
   - Only if the sheets ever move: `SESSIONS_SHEET_ID`, `FACILITATOR_ATT_SHEET_ID`
     (defaults are the current pilot sheets).
4. *Deploy → New deployment → Web app*: **Execute as: Me**, **Who has access: Anyone**. Authorise when asked.
5. Copy the web-app URL (ends in `/exec`).
6. In the hub, edit `js/att/config.js`:
   ```js
   window.ATT_CONFIG = { adapter: 'sheets', apiUrl: '<the /exec URL>', token: '<API_TOKEN>', actor: '' };
   ```
7. Open `pages/schedule.html`. The banner should say **Connected**.

After editing `Code.gs` later, use *Deploy → Manage deployments → Edit → New version*; the URL stays the same.

## Sheet rules the API relies on

- Row 1 must keep the existing headers (matched by text, case-insensitive; column order does not matter, extra columns are left alone).
  Renaming a header makes the API fail with a `SERVER` error that names it.
- `SESSION_LOG` keeps its pre-numbered `TPD-0001…` rows. A new session takes the first row with no date, program, venue or facilitators; past the last row it appends the next number.
- Facilitator attendance is one row per team member per date; saving again the same day updates that row.

## Security: read this

Web apps deployed to "Anyone" are reachable by anyone who has the URL, and the token in `js/att/config.js` is delivered to every
visitor of the site. So the token only stops casual or accidental use. It is **not** user authentication, and the `actor` written
to the audit log is client-supplied. The sheets hold real staff names and attendance. Before wider rollout, either restrict who can
open the site (private distribution or a server-side gate) or replace this backend with one that authenticates real users.

## Tests

`npm test` runs `Code.gs` in a Node VM against a fake spreadsheet built from the real sheet headers, through the real browser adapter,
covering the write path, concurrency conflicts, workflow rules, header handling and auth. It cannot exercise Google's real services;
do one manual pass after deploying (create a session, drag it to Conducted, save a day of attendance, check the sheet and `AUDIT_LOG`).

## Moving to PostgreSQL later

Write an adapter with the same methods as `js/att/adapters/sheets.js` (contract at the top of `js/att/service.js`) over an API in front of the
schema in `TddProjectai/database/migrations/014_attendance_scheduling.sql`, then swap it in `js/att/boot.js`. The UI and service are unchanged.
