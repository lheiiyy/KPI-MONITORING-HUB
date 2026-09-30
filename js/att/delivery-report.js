// Training Program Delivery report panel. Reads ONLY through ATT.service.deliveryReport(), which
// derives every figure from the live SESSION_LOG records; nothing is stored or hard-coded here.
// When the API is not connected the panel says so instead of showing an empty (misleading) report.
(function () {
  var A = window.ATT, D = A.domain, S = A.service;
  var host = document.getElementById('deliveryReport'); if (!host) return;
  var state = { year: '', month: '', gen: 0 };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') n.textContent = v; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v; else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function pct(v) { return v == null ? 'no data' : v.toFixed(2) + '%'; }
  function num(v) { return v == null ? '–' : String(v); }

  var css = document.createElement('style');
  css.textContent = '.tdr{display:grid;gap:12px}.tdr .tdr-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:end}' +
    '.tdr label{display:grid;gap:3px;font:500 11px var(--mono,monospace);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}' +
    '.tdr select{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line-2);border-radius:8px;padding:6px 9px;min-height:36px}' +
    '.tdr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}' +
    '.tdr-k{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:grid;gap:3px}' +
    '.tdr-k .l{font:500 10.5px var(--mono,monospace);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}' +
    '.tdr-k .v{font:700 22px var(--display);color:var(--accent)}.tdr-k .v.none{font:500 14px var(--body);color:var(--muted)}' +
    '.tdr-k .s{font-size:11.5px;color:var(--muted)}' +
    '.tdr table{width:100%;border-collapse:collapse;font-size:13px}.tdr th,.tdr td{padding:6px 8px;border-top:1px solid var(--line);text-align:right;white-space:nowrap}' +
    '.tdr th:first-child,.tdr td:first-child{text-align:left}.tdr th{font:500 10.5px var(--mono,monospace);text-transform:uppercase;color:var(--muted);border-top:0}' +
    '.tdr .warn{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:8px 12px;font-size:13px}.tdr .note{font-size:12.5px;color:var(--muted)}' +
    '.tdr .tw{overflow-x:auto}';
  document.head.appendChild(css);

  function kpi(key, label, value, sub) {
    var none = value === 'no data' || value === '–';
    return el('div', { class: 'tdr-k', 'data-k': key }, [el('span', { class: 'l', text: label }), el('span', { class: 'v' + (none ? ' none' : ''), text: value }), sub ? el('span', { class: 's', text: sub }) : null]);
  }

  function draw(r) {
    host.textContent = '';
    var years = r.years, monthOpts = D.SESSION_STATUSES && ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    var yearSel = el('select', { id: 'tdr-year', 'aria-label': 'Year', onchange: function (e) { state.year = e.target.value; state.month = ''; load(); } },
      [el('option', { value: '', text: 'All years' })].concat(years.map(function (y) { return el('option', { value: y, text: y, selected: y === state.year }); })));
    var monthSel = el('select', { id: 'tdr-month', 'aria-label': 'Month', disabled: !state.year, onchange: function (e) { state.month = e.target.value; load(); } },
      [el('option', { value: '', text: 'Whole year' })].concat(monthOpts.map(function (m) { return el('option', { value: m, text: m, selected: m === state.month }); })));
    var root = el('div', { class: 'tdr' }, [el('div', { class: 'tdr-bar' }, [el('label', {}, ['Year', yearSel]), el('label', {}, ['Month', monthSel])])]);

    if (!r.hasData) {
      root.appendChild(el('div', { class: 'warn', role: 'status', 'data-empty': 'true', text: r.total === 0 && r.undated === 0 && !state.year && !state.month
        ? 'No training sessions have been logged yet, so there is nothing to report. (Empty template rows are not sessions.)'
        : 'No dated sessions in this period.' + (r.undated ? ' ' + r.undated + ' logged session(s) have no date yet and are not counted in any period.' : '') }));
    } else {
      var by = r.byStatus;
      root.appendChild(el('div', { class: 'tdr-grid' }, [
        kpi('total', 'Sessions', String(r.total)), kpi('planned', 'Planned', String(by.PLANNED), r.upcoming + ' upcoming · ' + r.overdue + ' overdue'),
        kpi('conducted', 'Conducted', String(by.CONDUCTED)), kpi('postponed', 'Postponed', String(by.POSTPONED)), kpi('cancelled', 'Cancelled', String(by.CANCELLED)),
        kpi('rate', 'Delivery rate', pct(r.deliveryRatePct), r.due ? by.CONDUCTED + ' conducted of ' + r.due + ' due' : 'nothing due yet'),
        kpi('target-pax', 'Target pax', num(r.targetPax), 'non-cancelled sessions'), kpi('actual-pax', 'Actual pax', num(r.actualPax), 'conducted sessions'),
        kpi('pax-fill', 'Pax fill', pct(r.paxFillPct), 'actual ÷ target, conducted'), kpi('post-test', 'Post-test avg', pct(r.postTest.avgPct), r.postTest.sessions + ' session(s) with a score')
      ]));
      if (r.undated) root.appendChild(el('div', { class: 'note', text: r.undated + ' logged session(s) have no date; they are excluded from period filters.' }));
      var head = ['Facilitator', 'Planned', 'Conducted', 'Postponed', 'Cancelled', 'Actual pax', 'Required', 'Rating'];
      var body = r.facilitators.map(function (f) {
        return el('tr', { 'data-fac': f.name }, [el('td', { text: f.name + (f.onRoster ? '' : ' (not on roster)') }), el('td', { text: String(f.planned) }), el('td', { text: String(f.conducted) }),
          el('td', { text: String(f.postponed) }), el('td', { text: String(f.cancelled) }), el('td', { text: String(f.actualPax) }),
          el('td', { text: f.required == null ? '–' : String(f.required) }), el('td', { text: pct(f.ratingPct) })]);
      });
      root.appendChild(el('div', { class: 'tw' }, [el('table', {}, [el('thead', {}, [el('tr', {}, head.map(function (h) { return el('th', { text: h }); }))]), el('tbody', {}, body)])]));
      root.appendChild(el('div', { class: 'note', text: r.programsRequiredPerFacilitator == null ? 'Pick a year (and optionally a month) to see each facilitator’s rating against programs required.'
        : 'Rating = Conducted ÷ Programs Required (' + r.targetPerMonth + ' per month × ' + (r.programsRequiredPerFacilitator / r.targetPerMonth) + ' month(s) in the period), capped at 100%.' }));
      if (r.rosterWithoutSessions.length) root.appendChild(el('div', { class: 'note', text: 'No sessions logged in this period for: ' + r.rosterWithoutSessions.join(', ') + '. (No data is not scored as 0.)' }));
    }
    root.appendChild(el('div', { class: 'note', text: 'Delivery rate = Conducted ÷ due sessions (Conducted, plus non-cancelled sessions dated today or earlier). A session with several facilitators counts once for each. Figures are computed from SESSION_LOG on every load; the "2 per month" target and the rate definition are pending HRAD confirmation.' }));
    host.appendChild(root);
  }

  function load() {
    var gen = ++state.gen; host.setAttribute('aria-busy', 'true');
    S.deliveryReport({ year: state.year, month: state.month }).then(function (r) { if (gen === state.gen) { draw(r); host.removeAttribute('aria-busy'); } })
      .catch(function (e) { if (gen !== state.gen) return; host.textContent = ''; host.appendChild(el('div', { class: 'warn', role: 'alert', text: 'Could not load the report from the data source: ' + ((e && e.message) || 'unknown error') + ' Nothing is shown rather than showing stale numbers.' })); });
  }

  if (!A.connected) {
    host.appendChild(el('div', { class: 'warn', role: 'status', 'data-unconnected': 'true', text: 'Not connected to the data source (apiUrl/token in js/att/config.js), so the live report is unavailable. This is not an empty report: nothing has been read.' }));
  } else load();
})();
