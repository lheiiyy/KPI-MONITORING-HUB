// Shared monthly KPI engine for every KRA page and the landing-page roster.
// Reads data/kpi-monthly.json (built by scripts/build_kpi_monthly.py from the
// [sys] STORE VISIT 2026 roster/visit counts + the cross-training sheet).
// Every figure is computed for the selected month; "All" sums Jul-Sep and
// scales targets by 3. A KRA with no data yields null, never zero.
(function () {
  var KRAS = [
    { key: 'attendance', label: 'Attendance / Punctuality / Behavior' },
    { key: 'store_visits', label: 'Store Visit Compliance' },
    { key: 'cross_training', label: 'Staff Proficiency / Cross-Training' },
    { key: 'training_delivery', label: 'Training Program Delivery' },
    { key: 'coaching', label: 'Coaching & Feedback' }
  ];
  var UNITS = { store_visits: 'visits', cross_training: 'staff certified' };
  var EMPTY = {
    attendance: 'No attendance rows logged yet in TDD Team Attendance Monitoring 2026.',
    training_delivery: 'No sessions logged yet in Training Program & Delivery Monitoring 2026.'
  };

  function css() {
    var s = document.createElement('style');
    s.textContent =
      '.kseg{display:inline-flex;flex-wrap:wrap;gap:4px;padding:3px;border:1px solid var(--line-2,#cdd2da);border-radius:10px}' +
      '.kseg button{font:inherit;font-size:13px;border:0;background:transparent;color:var(--muted);padding:6px 12px;border-radius:7px;cursor:pointer}' +
      '.kseg button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent);font-weight:600}' +
      '.ktable{width:100%;border-collapse:collapse;font-size:13px}' +
      '.ktable th{text-align:left;color:var(--muted);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--line)}' +
      '.ktable td{padding:7px 8px;border-top:1px solid var(--line)}' +
      '.ktable .num{text-align:right;font-variant-numeric:tabular-nums}' +
      '.ktable .none,.knote{color:var(--muted)}.ktable tr.off td:first-child{font-style:italic}' +
      '.knote{font-size:12.5px;line-height:1.5}';
    document.head.appendChild(s);
  }
  function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(x) { return (x * 100).toFixed(2) + '%'; }
  function monthsOf(d, m) { return m === 'all' ? d.months : [m]; }

  // -> {actual, target, rating (0-1, capped), points} or null when no data
  function cell(d, kra, id, name, m) {
    var ms = monthsOf(d, m), w = d.weights[kra], t;
    if (kra === 'store_visits' || kra === 'cross_training') {
      t = d.targets_per_month[kra] * ms.length;
      var src = kra === 'store_visits' ? function (x) { return (d.store_visits[x] || {})[id]; }
                                        : function (x) { return (d.cross_training.roster[x] || {})[id] || 0; };
      var a = 0, seen = false;
      ms.forEach(function (x) { var v = src(x); if (v != null) { a += v; seen = true; } });
      if (!seen) return null;
      var r = Math.min(a / t, 1);
      return { actual: a, target: t, rating: r, points: r * w };
    }
    if (kra === 'coaching') {
      var c = (d.coaching[m] || {})[name];
      if (!c) return null;
      return { actual: c.n, target: null, rating: c.score / w, points: c.score, evals: c.n };
    }
    return null; // attendance, training_delivery: no source rows yet
  }

  function rowsFor(d, kra, m) {
    return d.roster.map(function (p) { return { name: p.name, id: p.id, c: cell(d, kra, p.id, p.name, m) }; });
  }
  function offRoster(d, m) {
    var out = {};
    monthsOf(d, m).forEach(function (x) {
      var o = d.cross_training.off_roster[x] || {};
      Object.keys(o).forEach(function (k) { out[k] = (out[k] || 0) + o[k]; });
    });
    return out;
  }

  function segHtml(d, id, cur) {
    var b = '<button type="button" data-m="all" aria-pressed="' + (cur === 'all') + '">All (Jul&ndash;Sep)</button>';
    d.months.forEach(function (x) { b += '<button type="button" data-m="' + x + '" aria-pressed="' + (cur === x) + '">' + esc(d.month_labels[x].split(' ')[0]) + '</button>'; });
    return '<div class="kseg" id="' + id + '" role="group" aria-label="Month">' + b + '</div>';
  }
  function bindSeg(id, fn) {
    document.getElementById(id).addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-m]'); if (!btn) return; fn(btn.dataset.m);
    });
  }
  function label(d, m) { return m === 'all' ? 'July–September 2026' : d.month_labels[m]; }

  // One KRA page: month filter, department summary, per-facilitator table.
  function mountKra(el, kra) {
    css();
    fetch(el.dataset.src || '../data/kpi-monthly.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      var w = d.weights[kra];
      function draw(m) {
        var rows = rowsFor(d, kra, m), have = rows.filter(function (r) { return r.c; });
        var avg = have.length ? have.reduce(function (a, r) { return a + r.c.rating; }, 0) / have.length : null;
        var body = rows.map(function (r) {
          if (!r.c) return '<tr><td>' + esc(r.name) + '</td><td class="num none" colspan="4">no data this period</td></tr>';
          var tgt = r.c.target == null ? '&ndash;' : r.c.target;
          var act = kra === 'coaching' ? r.c.evals + ' evals' : r.c.actual;
          return '<tr><td>' + esc(r.name) + '</td><td class="num">' + act + '</td><td class="num">' + tgt + '</td><td class="num">' + pct(r.c.rating) + '</td><td class="num">' + r.c.points.toFixed(2) + '</td></tr>';
        }).join('');
        var off = '';
        if (kra === 'cross_training') {
          var o = offRoster(d, m), ks = Object.keys(o);
          off = ks.map(function (k) { return '<tr class="off"><td>' + esc(k) + ' (not on Store Visit roster)</td><td class="num">' + o[k] + '</td><td class="num none" colspan="3">not scored</td></tr>'; }).join('');
        }
        el.innerHTML =
          '<section class="panel" style="display:grid;gap:12px"><div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center"><h2 style="margin:0">' + esc(label(d, m)) + '</h2>' + segHtml(d, 'kseg-' + kra, m) + '</div>' +
          (avg == null ? '<p class="knote">' + esc(EMPTY[kra] || 'No data for this period.') + '</p>' :
            '<div class="kpis"><div class="kpi"><div class="lbl">Department rating</div><div class="val">' + pct(avg) + '</div></div>' +
            '<div class="kpi"><div class="lbl">Weighted score</div><div class="val">' + (avg * w).toFixed(2) + '</div></div>' +
            '<div class="kpi"><div class="lbl">Weight</div><div class="val">' + w + '%</div></div>' +
            '<div class="kpi"><div class="lbl">Facilitators scored</div><div class="val">' + have.length + '/' + rows.length + '</div></div></div>') +
          '<div style="overflow-x:auto"><table class="ktable"><thead><tr><th>Facilitator</th><th class="num">Actual</th><th class="num">Target</th><th class="num">Rating</th><th class="num">Weighted (of ' + w + ')</th></tr></thead><tbody>' + body + off + '</tbody></table></div>' +
          '<p class="knote">Roster = the 12 visitors in [sys] STORE VISIT 2026 (CONFIG_VISITORS). Department rating = average of facilitators with data. Ratings are capped at 100%. Snapshot generated ' + esc(String(d.generated_at).slice(0, 10)) + '.</p></section>';
        bindSeg('kseg-' + kra, draw);
      }
      draw('all');
    }).catch(function () { el.textContent = 'KPI data is unavailable right now.'; });
  }

  // Landing page: every facilitator x every KRA for the chosen month.
  function mountRoster(el) {
    css();
    fetch(el.dataset.src || 'data/kpi-monthly.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      function draw(m) {
        var head = KRAS.map(function (k) { return '<th class="num">' + esc(k.label.split(' / ')[0].split(' & ')[0]) + '<br>' + d.weights[k.key] + '%</th>'; }).join('');
        var body = d.roster.map(function (p) {
          var pts = 0, max = 0;
          var cells = KRAS.map(function (k) {
            var c = cell(d, k.key, p.id, p.name, m);
            if (!c) return '<td class="num none">no data</td>';
            pts += c.points; max += d.weights[k.key];
            return '<td class="num">' + c.points.toFixed(2) + '<br><small class="none">' + pct(c.rating) + '</small></td>';
          }).join('');
          var tot = max ? '<b>' + pts.toFixed(2) + '</b> / ' + max : '&ndash;';
          return '<tr><td>' + esc(p.name) + '</td>' + cells + '<td class="num">' + tot + '</td></tr>';
        }).join('');
        el.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;margin-bottom:10px"><span class="knote">' + esc(label(d, m)) + '</span>' + segHtml(d, 'kseg-roster', m) + '</div>' +
          '<div style="overflow-x:auto"><table class="ktable"><thead><tr><th>Facilitator</th>' + head + '<th class="num">Scored / available</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
          '<p class="knote">Cells show weighted points, with the rating under them. &ldquo;Scored / available&rdquo; only counts KRAs that have data, so it is not comparable between people with different coverage. Attendance and Training Program Delivery have no logged rows yet. Snapshot generated ' + esc(String(d.generated_at).slice(0, 10)) + '.</p>';
        bindSeg('kseg-roster', draw);
      }
      draw('all');
    }).catch(function () { el.textContent = 'KPI data is unavailable right now.'; });
  }

  window.KPI = { mountKra: mountKra, mountRoster: mountRoster };
})();
