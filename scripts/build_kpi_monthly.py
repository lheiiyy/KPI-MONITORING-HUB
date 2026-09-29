#!/usr/bin/env python3
"""Builds data/kpi-monthly.json, the per-facilitator, per-month KPI feed for the hub.

Inputs (CSV exports from Google Sheets; not committed, they hold staff names):
  --kpi-tab  "KPI 2026" tab of [sys] STORE VISIT 2026 (visitor rows: name, then
             12 x [W1..W5,TOT] months, then Q1..Q4,YTD). The roster is CONFIG_VISITORS.
  --cross    CROSS TRAINED STAFFS MONITORING (COPY - NATIVE) exported as CSV.
Usage: build_kpi_monthly.py --kpi-tab kpi.csv --cross cross.csv > data/kpi-monthly.json
"""
import argparse, csv, json, datetime, sys

ROSTER = [  # CONFIG_VISITORS in [sys] STORE VISIT 2026 -> display names used on the hub
    ("GIO", "Geoffrey Carranceja"), ("ALEX", "Alex Rivera"), ("RICE", "Ricelle (Rice) Lim"),
    ("JOSH", "Josh Earnshaw"), ("JAMES", "James Nacionales"), ("SKY", "Sky"),
    ("CHARLIE", "Charlie Moises"), ("LEO", "Leo Fernandez"), ("ANN", "Ann Barredo"),
    ("YANA", "Alliana (Yana) Papa"), ("VER", "Ver Guerrero"), ("DANIEL", "Daniel De Leon"),
]
# Cross-training sheet's Training Dept column -> roster id. NICA is not a Store Visit visitor.
DEPT = {"ALLIANA KRISTINE": "YANA", "VER GUERRERO": "VER", "ANN BARREDO": "ANN", "RICE LIM": "RICE"}
MONTHS = ["07", "08", "09"]
# Coaching & Feedback, weighted points out of 20, from pages/coaching-feedback.html's 170 responses.
COACHING = json.load(open("data/coaching-monthly.json"))

def store_visits(path):
    out = {m: {} for m in MONTHS}
    ids = {r for r, _ in ROSTER}
    for row in csv.reader(open(path, encoding="utf-8")):
        if row and row[0].strip().upper() in ids and len(row) >= 73:
            for m in MONTHS:
                out[m][row[0].strip().upper()] = int(row[1 + (int(m) - 1) * 6 + 5])
    missing = ids - set(out["07"])
    if missing:
        sys.exit(f"KPI tab missing visitors: {sorted(missing)}")
    return out

def cross(path):
    out = {"roster": {m: {} for m in MONTHS}, "off_roster": {m: {} for m in MONTHS}, "failed": {m: 0 for m in MONTHS}}
    for r in csv.DictReader(open(path, encoding="utf-8")):
        m = r["validation_date"][5:7]
        if m not in MONTHS:
            continue
        if "FAILED" in (r["remarks"] or "").upper():
            out["failed"][m] += 1          # a recorded fail is not a certification
            continue
        dept = (r["training_dept"] or "").strip().upper()
        if dept in DEPT:
            bucket, key = out["roster"][m], DEPT[dept]
        else:
            bucket, key = out["off_roster"][m], dept.title() or "Unattributed"
        bucket[key] = bucket.get(key, 0) + 1
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--kpi-tab", required=True); ap.add_argument("--cross", required=True)
    a = ap.parse_args()
    doc = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "months": MONTHS,
        "month_labels": {"07": "July 2026", "08": "August 2026", "09": "September 2026"},
        "weights": {"attendance": 10, "store_visits": 25, "cross_training": 25, "training_delivery": 20, "coaching": 20},
        "targets_per_month": {"store_visits": 32, "cross_training": 12, "training_delivery": 2, "attendance": 100},
        "roster": [{"id": i, "name": n} for i, n in ROSTER],
        "store_visits": store_visits(a.kpi_tab),
        "cross_training": cross(a.cross),
        "coaching": COACHING,
        "attendance": None,          # TDD Team Attendance Monitoring 2026 has no rows yet (template only)
        "training_delivery": None,   # Training Program & Delivery Monitoring 2026 has no rows yet (template only)
    }
    json.dump(doc, sys.stdout, indent=1, ensure_ascii=False); print()

if __name__ == "__main__":
    main()
