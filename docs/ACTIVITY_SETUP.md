# Activity module — architecture, setup, deployment, limitations

```
Google Sheet (ACTIVITY, ACTIVITY_HISTORY, ACTIVITY_REF)      <- source of truth
        ^  Repository.gs   (only file that knows about Sheets)
        |  Service.gs      (business rules)   Validation.gs (server validation)   Config.gs (schema, enums)
        |  Api.gs          (token auth + router, Apps Script web app)
        v  HTTPS POST (text/plain JSON)
js/activity-api.js   (data-access layer)  ->  js/activity-logic.js (filters, search, summary, dates, client validation)
        ->  js/activity-ui.js (Kanban rendering / interaction)  ->  pages/activity.html
```

The browser keeps only a cache of what the server returned. Every change is sent to the backend first; a failed status
move is rolled back on screen. Summary numbers are computed from the loaded records every render.

## One-time setup (administrator)

1. Open the **Training Program & Delivery Monitoring 2026** workbook → *Extensions → Apps Script*.
2. Create one script file per `backend/apps-script/*.gs` (same names) and paste the contents; paste
   `appsscript.json` via *Project Settings → Show "appsscript.json"*. (Or use `clasp` with a `.clasp.json` pointing at
   that script — do **not** commit `.clasp.json`/credentials.)
3. Run **`setupActivityModule()`** once. It appends `ACTIVITY`, `ACTIVITY_HISTORY`, `ACTIVITY_REF`; it refuses to touch a
   pre-existing tab with a different header and never modifies `SESSION_LOG` / `LISTS`.
4. Review `ACTIVITY_REF` (activity types marked *pending confirmation* in `docs/ACTIVITY_SCHEMA.md`).
5. Run **`addActivityUser("leo", "write")`** for each user (`"read"` for viewers). The token is logged **once**
   (*Executions* log); send it privately. Only its hash is stored.
6. *Deploy → New deployment → Web app*: **Execute as: Me**, **Who has access: Anyone**. (The URL is public; every call
   needs a token.) Copy the `/exec` URL.
7. Put the URL in `js/activity-config.js` (`apiUrl`) and publish the hub as usual. The URL is not a secret; tokens must
   never be put in the repo.
8. To ship backend edits: *Deploy → Manage deployments → edit → New version*.

Standalone (not container-bound) script? Set the `ACTIVITY_SPREADSHEET_ID` script property instead.
Time zone: `appsscript.json` = `Asia/Manila`; "today" for `completed_date` uses the spreadsheet's time zone.

## Tests

```
node --test tests/backend.test.js tests/frontend-logic.test.js     # 30 tests, no dependencies
NODE_PATH=$(npm root -g) node tests/e2e.js                          # 36 browser tests (Playwright + Chromium)
node tests/dev-server.js                                            # try the UI locally against the real backend code
```

`tests/gas-harness.js` runs the **real `.gs` files** in a Node `vm` over an in-memory fake sheet (which deliberately
mimics Sheets' auto-date and formula conversion so plain-text formatting is actually tested). The dev server and e2e suite
use the same fake sheet, so they verify the real backend logic — but **not** Google's runtime (see limitations).

## Known limitations

* **Not yet run against real Google Sheets/Apps Script.** Tests use a fake of the Google services; first deployment
  needs a smoke test (setup → add user → open the page → create / move / edit a card).
* **No real SSO.** Access is per-user shared-secret tokens held in `sessionStorage` (per tab). A leaked token works until
  revoked. There is no rate limiting or lockout (Apps Script offers none). The client-side password mentioned in the
  hub README is **not** access control and was not reused; note the pages in this repo currently contain no such gate.
* The web app must be "Anyone" so a static site can call it; anyone can reach the URL (they get `UNAUTHORIZED`).
* Load-all + client-side filtering: fine for hundreds/low thousands of rows; move filtering server-side for more.
  Apps Script has daily quotas and ~1–3 s latency per call.
* Reference data (`ACTIVITY_REF`) is a seeded copy of the hub roster / LISTS values, not synced with the SVMI master.
  `location_id` is format-checked only (store master is in another system).
* Drag & drop is mouse/pen only; touch users use the status menu on every card (by design).
* No bulk import, no per-user permissions beyond read/write, no notifications. `SESSION_LOG` rows are not migrated
  (none exist).
