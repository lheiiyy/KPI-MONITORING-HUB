# ACTIVITY API contract

Implementation: `backend/apps-script/Api.gs` (Google Apps Script web app) → `Service.gs` → `Repository.gs`.
Client: `js/activity-api.js` (the only file the UI uses to reach data).

## Transport

`POST <web-app-url>` with a JSON body sent as `Content-Type: text/plain` (avoids a CORS preflight, which Apps Script
cannot answer). One endpoint; the operation is the `action` field. Tokens travel in the body, never in the URL.

```json
{ "action": "updateStatus", "token": "<per-user token>", "activity_id": "ACT-000042", "status": "IN_PROGRESS", "expected_updated_at": "2026-10-05T03:20:11.123Z" }
```

Success `{ "ok": true, "data": … }` — failure `{ "ok": false, "error": { "code", "message", "details" } }`.
`GET` returns only a health object (no data). Apps Script always answers HTTP 200; errors are in the envelope.

## Operations

| `action` | Params | Returns | Client method | REST-style equivalent |
|---|---|---|---|---|
| `meta` | – | statuses, priorities, people, brands, activity types, KPIs, `today`, `role`, `user` | `getMeta()` | `GET /meta` |
| `list` | `include_archived?` | `Activity[]` | `listActivities()` | `GET /activities` |
| `get` | `activity_id` | `Activity` | `getActivity(id)` | `GET /activities/:id` |
| `history` | `activity_id` | `HistoryEntry[]` (newest first) | `getActivityHistory(id)` | `GET /activities/:id/history` |
| `create` | `activity` | `Activity` | `createActivity(a)` | `POST /activities` |
| `update` | `activity_id`, `changes`, `expected_updated_at?` | `Activity` | `updateActivity(id, changes, ts)` | `PATCH /activities/:id` |
| `updateStatus` | `activity_id`, `status`, `expected_updated_at?` | `Activity` | `updateActivityStatus(id, s, ts)` | `PATCH /activities/:id/status` |
| `updateProgress` | `activity_id`, `progress_percent`, `expected_updated_at?` | `Activity` | `updateActivityProgress(id, n, ts)` | `PATCH /activities/:id/progress` |
| `archive` | `activity_id` | `Activity` | `archiveActivity(id)` | `DELETE /activities/:id` (soft) |
| `restore` | `activity_id` | `Activity` | `restoreActivity(id)` | `POST /activities/:id/restore` |

`Activity` = every column in `docs/ACTIVITY_SCHEMA.md` + `is_archived`. Physical delete is intentionally not offered.

Behaviour: `create` generates `activity_id` (or accepts a unique client one), defaults `status=BACKLOG`,
`priority=MEDIUM`; a no-op `update` writes nothing; each changed field adds an `ACTIVITY_HISTORY` row; `COMPLETED`
sets `completed_date` (today) and `progress_percent=100`; leaving `COMPLETED` clears `completed_date`;
`expected_updated_at` mismatch → `CONFLICT`; archived records cannot be edited until restored. Writes are serialised with
`LockService`.

## Error codes

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | Missing / unknown token |
| `FORBIDDEN` | Read-only token used for a write |
| `VALIDATION_ERROR` | `details: [{field, message}]` |
| `DUPLICATE_ID` | Client-supplied `activity_id` exists |
| `NOT_FOUND` | Unknown `activity_id` |
| `CONFLICT` | Record changed since `expected_updated_at` |
| `ARCHIVED` | Edit attempted on archived record |
| `IMMUTABLE_FIELD` / `UNKNOWN_FIELD` | System or unknown field in payload |
| `CONFIG_MISSING` | No spreadsheet / tab / columns / tokens configured |
| `BUSY` | Could not get the write lock within 20 s |
| `BAD_REQUEST` | Malformed body or unknown action |
| `INTERNAL_ERROR` | Unexpected; details logged server-side only |

Client-only codes: `BACKEND_UNAVAILABLE` (network/timeout), `BAD_RESPONSE` (non-JSON reply, e.g. a Google sign-in page
because the web app is not shared with "Anyone").

## Authentication

Per-user tokens, verified server-side against SHA-256 hashes in the `ACTIVITY_TOKENS` script property
(`{hash: {user, role}}`, role `write` or `read`). The verified `user` becomes `created_by` / `updated_by` — the client can
not claim to be someone else. Tokens are issued/revoked only from the Apps Script editor
(`addActivityUser`, `revokeActivityUser`); no credential is stored in the repository or in client code.
