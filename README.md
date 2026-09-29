# KPI Monitoring Hub

Facilitator KRA (Key Result Area) scorecard for Figaro Culinary Group's
Training & Development Division, covering the five KRAs HRAD scores
facilitators on:

| KRA | Weight | Formula |
|---|---|---|
| Attendance / Punctuality / Behavior | 10% | (Days Present − Lates − Absences) / Total Working Days × 100% |
| Store Visit Compliance | 25% | Actual Store Visits / Target Store Visits × 100% |
| Staff Proficiency / Cross-Training | 25% | Staff Certified / Staff Scheduled for Certification × 100% |
| Training Program Delivery | 20% | Programs Delivered / Programs Required × 100% |
| Coaching & Feedback | 20% | Average Survey Score / Maximum Possible Score × 100% |

This repo was split out of [`lheiiyy/TddProjectai`](https://github.com/lheiiyy/TddProjectai)'s
`KPI_Monitoring_Initiative/` folder (see that repo's PR #10 for history)
so it can be deployed on its own.

## Hosting & pilot access

Live at **https://lheiiyy.github.io/kpi-monitoring-hub/** via GitHub
Pages (Settings → Pages → Deploy from branch `main` / root) — no build
step, no credits/build-minutes, rebuilds automatically on every push.

A Netlify deployment (`netlify/edge-functions/basic-auth.ts`) was tried
first, with real server-side HTTP Basic Auth gating every page. It's
kept in the repo but unused, since that Netlify team's build credits
were exhausted before it could deploy.

Every page now has a **client-side password prompt** instead (see the
inline `<script>` at the top of each `<head>`, password
`FigaroTDD-Pilot2026`). Be clear about what this is and isn't: it's a
casual deterrent against someone stumbling on the link, not real
access control — the password and the full page content both ship in
the page source, so anyone who opens dev tools or disables JavaScript
can bypass it. Don't treat this as sufficient protection for the real
employee names and individual performance ratings in here; if that
matters, move back to the Netlify (or equivalent) server-side gate
once credits/budget allow, or make the repo's audience otherwise
trusted (private distribution of the link only).

## Pages

- **`index.html`** — the landing page. Not a dashboard itself: five nav
  cards, one per KRA above (name, weight, formula, target), each linking
  to that KRA's monitoring page under `/pages`. Also shows an
  illustrative total KRA score (weighted sum across all five).

- **`pages/coaching-feedback.html`** — the Coaching & Feedback KRA page.
  This is the Facilitator KPI Scorecard, scoring facilitators against
  the 15-criteria, 5-point Store Visit Evaluation Survey (5 Excellent ..
  1 Poor). Ranked scorecard table, evaluations-received and
  average-rating charts, a monthly activity heatmap, per-facilitator
  drill-down profiles, a "responses to review" table for averages below
  3.00, month/brand filters, and CSV export. Department average for
  Jul–Sep 2026 was 4.80/5 (96.00%), which is what `index.html` uses for
  the Coaching & Feedback slice of the illustrative total — swap in one
  facilitator's own row from the scorecard for their individual KRA
  score instead.

- **`pages/store-visit-compliance.html`**, **`pages/staff-proficiency.html`**
  — executive-summary-only pages (KPI cards + formula/target), by design
  not linked to the underlying raw logs. Both are tracked in
  `TddProjectai/SVMI_Project`'s existing "[sys] STORE VISIT 2026" system,
  in the KPI Data sheet (Pilot) Drive folder — open that directly if you
  need the visit-by-visit or certification-by-certification records.

- **`pages/training-program-delivery.html`**, **`pages/attendance.html`**
  — executive-summary pages that also link out to their underlying log
  sheets in the same Drive folder: "Training Program & Delivery
  Monitoring 2026" and "TDD Team Attendance Monitoring 2026"
  (per-facilitator daily attendance/status/leave log) respectively.

- **`Facilitator_KPI_Scorecard_Demo.html`** — an earlier (Jul–Aug)
  snapshot of the scorecard, kept for reference — it additionally
  declares a live "Refresh from Drive" capability that
  `pages/coaching-feedback.html`'s static Jul–Sep export does not.

No build step — every page is a self-contained static HTML file, so
Netlify can serve this repo's root directly with no build command.

## Google Drive

All five KRAs' underlying logs live in the "KPI Data sheet (Pilot)"
folder: https://drive.google.com/drive/folders/1YBnR_TIvEhNh4uDXyqyTy0RKejOFQbSq
  - Figaro Culinary Group - Store Visit Evaluation Survey Form (RESPONSE)
  - [sys] STORE VISIT 2026 (store visit + staff certification log)
  - Trainee Deployment Satisfaction Survey
  - Training Program & Delivery Monitoring 2026
  - Training Attendance Monitoring 2026 (trainee attendance at sessions)
  - TDD Team Attendance Monitoring 2026 (facilitator's own attendance —
    this is the one the Attendance KRA page links to)

## Cross-training data (database-backed)

`pages/staff-proficiency.html` reads `data/cross-training.json`, a names-free
export of the `v_cross_training_monthly` view in `TddProjectai/database`
(migration `013_cross_training.sql`; refresh with
`database/scripts/export_cross_training.sh`). Source of truth is the
native Google Sheet "CROSS TRAINED STAFFS MONITORING (COPY - NATIVE)".

## Status / next steps

This is a static, repo-tracked snapshot of the KRA scorecard system —
no Apps Script backend or tests yet. If this needs to run live against
the Drive folder above (the way `TddProjectai/SVMI_Project` runs
against its Sheet), the next piece of work is an Apps Script (or
Sheets-API) backend that reads all five sources and recomputes the KRA
numbers on `index.html` and each `pages/*.html` automatically, plus a
test suite — sharing the survey-parsing/name-matching logic with
SVMI_Project's existing `SVMKPI_*` scripts rather than duplicating it.
