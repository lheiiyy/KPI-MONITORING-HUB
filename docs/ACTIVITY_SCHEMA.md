# ACTIVITY schema

Status: implemented in `backend/apps-script/` (pilot backend: Google Sheets). Written so the same
model becomes a PostgreSQL table without redesign (see [Migration](#sql-migration-notes)).

## 1. Audit findings (what existed before this module)

**Workbook** "Training Program & Delivery Monitoring 2026"
(`1mp4-6KHcX5iDB5Oto1Smjfyq-xW4KAZCC8CA09hhpB4`, owner `lheii.fcsitraining@gmail.com`), audited 2026-09-29:

| Tab | Content |
|---|---|
| `SESSION_LOG` | 13 columns (`Session ID, Date, Program / Module, Training Type, Brand, Store / Venue, Facilitator(s), Target Pax, Actual Pax, Duration (hrs), Status, Post-Test Avg (%), Remarks`), 300 rows, IDs `TPD-0001`… pre-filled, **every data cell empty**. |
| `LISTS` | Dropdown sources: 11 training types, 6 brands, 4 statuses (`Planned / Conducted / Postponed / Cancelled`), 13 facilitator names, and a "HOW TO USE" note. |

Findings:

1. **There is no `ACTIVITY` sheet.** The closest thing is `SESSION_LOG`, which models *training sessions only*
   (attendance/pax metrics), not general activity tracking. It is left untouched.
2. `SESSION_LOG` problems for use as a transactional table: multiple facilitators in one cell
   (comma-separated), dates typed `dd/mm/yyyy`, names instead of IDs, status vocabulary that has no in-progress /
   review state, no owner/priority/progress/audit columns.
3. **Dependencies (must not break):** `pages/training-program-delivery.html` links to the workbook, and `LISTS!F` states
   *"Keep SESSION_LOG as the first tab — the dashboard reads the first tab."* The Activity module therefore **adds new
   tabs after the existing ones** and never edits, renames or reorders `SESSION_LOG` / `LISTS`.
4. The facilitator roster in `LISTS` (13 names, no IDs) differs from the hub roster (`data/kpi-monthly.json`, 12 people
   with stable IDs `GIO, ALEX, …` from `CONFIG_VISITORS`): **Nica Tardio** is in `LISTS` but has no ID in the hub roster.
   `ACTIVITY_REF` is seeded from the hub roster (IDs exist); add Nica once an ID is assigned.

| Field disposition | Fields |
|---|---|
| Retained (renamed) | Session date → `activity_date`; Program/Module → `activity_title`; Training Type → `activity_type`; Brand → `brand_id`; Store/Venue → `location_name` (+ `location_id`); Status → `status`; Remarks → `notes` |
| Added | `activity_id` (stable), `owner_id`, `assigned_to_id`, `priority`, `start_date`, `due_date`, `completed_date`, `progress_percent`, `kpi_id`, `target_value`, `actual_value`, `evidence_url`, audit + archive columns |
| Deprecated for Activity use | Facilitator(s) multi-value cell (→ `owner_id` / `assigned_to_id`), `Target/Actual Pax`, `Duration`, `Post-Test Avg` (session-delivery metrics: stay in `SESSION_LOG`) |

Status mapping if `SESSION_LOG` rows are ever migrated: `Planned→PLANNED`, `Conducted→COMPLETED`, `Postponed→ON_HOLD`,
`Cancelled→CANCELLED`. **No migration was run or written: there are no rows to migrate.**

## 2. Tabs created (by `setupActivityModule()`)

| Tab | Purpose |
|---|---|
| `ACTIVITY` | The transactional table. **Source of truth.** |
| `ACTIVITY_HISTORY` | Append-only change log (one row per changed field). |
| `ACTIVITY_REF` | Reference lists: `PERSON`, `BRAND`, `ACTIVITY_TYPE`, `KPI` (editable without code changes). |

All cells are formatted plain text (`@`): dates stay ISO strings and text such as `=HYPERLINK(...)` can never become a
formula. Columns are located **by header name**; column order and row numbers are not part of the contract.

## 3. `ACTIVITY` table

Primary key: **`activity_id`** (`ACT-000001`, generated server-side, immutable, unique; imports may supply their own
`A-Z0-9_-`, 3–40 chars, uppercased). Never a row number, title or person name.

| Field | Type | Req | Purpose / rules | Example |
|---|---|---|---|---|
| `activity_id` | text | sys | Immutable PK | `ACT-000042` |
| `activity_date` | date | ✔ | When it occurred / is scheduled. `YYYY-MM-DD`, real calendar date | `2026-10-05` |
| `activity_type` | text | ✔ | FK → `ACTIVITY_REF` (`ACTIVITY_TYPE`) | `REFRESHER` |
| `activity_title` | text | ✔ | ≤ 200 chars | `Refresher – SM North` |
| `activity_description` | text | | ≤ 4000 chars | |
| `owner_id` | text | ✔ | FK → `PERSON` (accountable) | `LEO` |
| `assigned_to_id` | text | | FK → `PERSON` (executes) | `ALEX` |
| `status` | enum | ✔ | See §4. Default `BACKLOG` | `IN_PROGRESS` |
| `priority` | enum | ✔ | See §4. Default `MEDIUM` | `HIGH` |
| `start_date` / `due_date` | date | | `due_date ≥ start_date` | |
| `completed_date` | date | | Only allowed when `status=COMPLETED`; auto-set to today (script time zone) on completion; cleared when leaving `COMPLETED` | |
| `progress_percent` | int | | 0–100 whole number; forced to 100 on `COMPLETED` | `60` |
| `location_id` | text | | Store ID from the SVMI store master (format-checked only – that master is a different system) | `ST-014` |
| `location_name` | text | | Display value (no store master is reachable from this backend) | `Figaro Ayala` |
| `brand_id` | text | | FK → `BRAND` | `FIGARO` |
| `kpi_id` | text | | FK → `KPI` (the 5 KRAs) | `COACHING` |
| `target_value` / `actual_value` | number | | Expected / actual output | `12` / `9` |
| `evidence_url` | text | | `http(s)://` only | |
| `notes` | text | | ≤ 4000 chars | |
| `status_changed_at` | timestamp | sys | Set only when `status` changes | |
| `archived_at` / `archived_by` | timestamp / text | sys | Soft delete (blank = live) | |
| `created_at` / `created_by` | timestamp / text | sys | Never modified after insert | |
| `updated_at` / `updated_by` | timestamp / text | sys | Every real change; also the optimistic-concurrency version | |

Timestamps are UTC ISO-8601 (`2026-10-05T03:20:11.123Z`). Dropped on purpose: `owner_name`, `brand_name` (derivable
from IDs – storing them invites drift). `location_name` is kept only because there is no store master to join to.

System columns can never be set by a client (`IMMUTABLE_FIELD` / `UNKNOWN_FIELD`).

## 4. Controlled values

* **Status** (code-defined, ordered — `Config.gs`, served to the UI via `meta`):
  `BACKLOG → PLANNED → IN_PROGRESS → FOR_REVIEW → COMPLETED`, plus `ON_HOLD`, `CANCELLED` (secondary columns, shown via
  a toggle or the status filter). Terminal (never "overdue"): `COMPLETED`, `CANCELLED`. Any status → any status is allowed.
* **Priority:** `LOW, MEDIUM, HIGH, URGENT`.
* **Activity type** (data, `ACTIVITY_REF`): the 11 training types exactly as in `LISTS` (Orientation, Refresher, TLTC,
  Seminar / Workshop, Technical Validation, Barista / Coffee Bar, Service Steps, Rider Refresher, Coaching / Corrective
  Action, Train-the-Trainer, Other→`OTHER`) **plus** `STORE_VISIT, MEETING, FOLLOW_UP, REPORTING`, which are *not* in
  the source sheet and are added because the KRAs cover non-training work. **Needs business confirmation**; edit rows in
  `ACTIVITY_REF` (set `active` to `FALSE` to retire one — existing records keep the ID).
* **Overdue** (derived, never stored): `due_date < today` and status not terminal.

## 5. Indexes / search

Pilot volume (hundreds of rows) → the UI loads all live rows and filters/searches client-side. For SQL:
PK `activity_id`; indexes on `(status)`, `(activity_date)`, `(owner_id)`, `(assigned_to_id)`, `(due_date) WHERE status NOT IN
('COMPLETED','CANCELLED')`, `(brand_id)`, `(kpi_id)`; full-text/`pg_trgm` on `activity_title || activity_description`.

## SQL migration notes

```sql
CREATE TABLE activity (
  activity_id text PRIMARY KEY CHECK (activity_id ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  activity_date date NOT NULL,
  activity_type text NOT NULL REFERENCES ref_activity_type(id),
  activity_title text NOT NULL CHECK (char_length(activity_title) <= 200),
  activity_description text, owner_id text NOT NULL REFERENCES person(id), assigned_to_id text REFERENCES person(id),
  status text NOT NULL CHECK (status IN ('BACKLOG','PLANNED','IN_PROGRESS','FOR_REVIEW','COMPLETED','ON_HOLD','CANCELLED')),
  priority text NOT NULL CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  start_date date, due_date date, completed_date date,
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  location_id text REFERENCES stores(store_id), brand_id text REFERENCES brand(id), kpi_id text REFERENCES kpi(id),
  target_value numeric, actual_value numeric, evidence_url text CHECK (evidence_url ~* '^https?://'),
  notes text, status_changed_at timestamptz NOT NULL, archived_at timestamptz, archived_by text,
  created_at timestamptz NOT NULL, created_by text NOT NULL, updated_at timestamptz NOT NULL, updated_by text NOT NULL,
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date),
  CHECK (completed_date IS NULL OR status = 'COMPLETED'));
```

* `ACTIVITY_HISTORY` → `activity_history` (FK on `activity_id`, append-only).
* `ACTIVITY_REF` → four small tables (or one typed table). **Do not fork the reference data:** the existing
  `TddProjectai/database` design already has stores/visitors; point `owner_id` / `location_id` at those rows rather than
  copying, then drop `location_name`.
* Replace `Repository.gs` only; `Service.gs` rules map 1:1 to a service layer, the UI contract (`docs/ACTIVITY_API.md`)
  is unchanged. Optimistic concurrency (`updated_at`) carries over as-is.
* Import: dates already ISO, IDs already stable, blank cells → `NULL`.
