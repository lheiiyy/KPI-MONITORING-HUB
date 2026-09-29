// Training schedule Kanban. Columns are the SESSION_LOG statuses (Planned, Conducted,
// Postponed, Cancelled). Every change goes through ATT.service, which enforces the workflow
// and persists via the adapter. The UI updates optimistically and rolls back on failure.
(function () {
  var A = window.ATT, D = A.domain, S = A.service, U = A.ui, el = U.el;
  var state = { sessions: [], ref: { teamMembers: [], sessionFacilitators: [] }, f: { month: '', brand: '', who: '', q: '' }, dragId: null };
  var boardEl = document.getElementById('board'), dlg = document.getElementById('dlg');

  function byId(id) { return state.sessions.filter(function (s) { return s.id === id; })[0]; }
  function fmtDate(d) { return d ? d.split('-').reverse().join('/') : 'No date'; }
  function pax(s) { return s.actualPax != null || s.targetPax != null ? (s.actualPax == null ? '–' : s.actualPax) + ' / ' + (s.targetPax == null ? '–' : s.targetPax) + ' pax' : ''; }
  function visible(s) {
    var f = state.f;
    if (f.month && (s.date || '').slice(0, 7) !== f.month) return false;
    if (f.brand && s.brand !== f.brand) return false;
    if (f.who && (s.facilitators || []).map(D.normName).indexOf(D.normName(f.who)) < 0) return false;
    if (f.q && (s.program + ' ' + s.id + ' ' + (s.venue || '')).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
    return true;
  }
  function cmp(a, b) { return (a.date || '9999') < (b.date || '9999') ? -1 : (a.date || '9999') > (b.date || '9999') ? 1 : a.id < b.id ? -1 : 1; }

  // ---------------------------------------------------------------- board
  function render() {
    boardEl.textContent = '';
    D.SESSION_STATUSES.forEach(function (st) {
      var list = state.sessions.filter(function (s) { return s.status === st.code && visible(s); }).sort(cmp);
      var cards = el('div', { class: 'cards' }, list.length ? list.map(card) : [el('div', { class: 'empty', text: 'No sessions' })]);
      var col = el('section', { class: 'col', 'data-status': st.code, 'aria-label': st.label }, [
        el('h2', {}, [st.label, el('span', { class: 'n', text: String(list.length) })]), cards]);
      col.addEventListener('dragover', function (e) {
        var s = state.dragId && byId(state.dragId);
        if (!s || s.status === st.code) return;
        var ok = D.canTransition(s.status, st.code);
        col.classList.add(ok ? 'ok' : 'no'); if (ok) e.preventDefault();
      });
      col.addEventListener('dragleave', function () { col.classList.remove('ok', 'no'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault(); col.classList.remove('ok', 'no');
        var s = state.dragId && byId(state.dragId); state.dragId = null;
        if (s && s.status !== st.code) move(s, st.code);
      });
      boardEl.appendChild(col);
    });
  }

  function card(s) {
    var next = D.TRANSITIONS[s.status] || [];
    var sel = el('select', { 'aria-label': 'Move ' + s.id + ' to', disabled: !next.length, onchange: function () { if (sel.value) move(s, sel.value); sel.value = ''; } },
      [el('option', { value: '', text: next.length ? 'Move to…' : 'Final' })].concat(next.map(function (c) { return el('option', { value: c, text: D.labelOf(D.SESSION_STATUSES, c) }); })));
    var meta = [fmtDate(s.date), s.brand ? D.labelOf(D.BRANDS, s.brand) : '', s.venue].filter(Boolean).join(' · ');
    var c = el('article', { class: 'card', draggable: 'true', tabindex: '0', 'data-id': s.id }, [
      el('div', { class: 'id', text: s.id + (s.trainingType ? ' · ' + D.labelOf(D.TRAINING_TYPES, s.trainingType) : '') }),
      el('div', { class: 't', text: s.program || '(untitled)' }),
      el('div', { class: 'm', text: meta }),
      (s.facilitators || []).length ? el('div', { class: 'm', text: 'Facilitator: ' + s.facilitators.join(', ') }) : null,
      pax(s) ? el('div', {}, [el('span', { class: 'chip', text: pax(s) })]) : null,
      el('div', { class: 'row' }, [sel, el('button', { type: 'button', text: 'Open', onclick: function () { openDialog(s.id); } })])
    ]);
    c.addEventListener('dragstart', function (e) { state.dragId = s.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); });
    c.addEventListener('dragend', function () { c.classList.remove('dragging'); state.dragId = null; });
    c.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === c) openDialog(s.id); });
    return c;
  }

  function replace(saved) {
    var i = state.sessions.map(function (x) { return x.id; }).indexOf(saved.id);
    if (i < 0) state.sessions.push(saved); else state.sessions[i] = saved;
  }
  function reload() { return S.listSessions().then(function (l) { state.sessions = l; render(); }); }

  // Optimistic status change with rollback. A Conducted session needs a date, so ask for it first.
  function move(s, to) {
    if (!D.canTransition(s.status, to)) { U.toast('A ' + D.labelOf(D.SESSION_STATUSES, s.status) + ' session cannot become ' + D.labelOf(D.SESSION_STATUSES, to) + '.', true); return; }
    if (to === 'CONDUCTED' && !s.date) { openDialog(s.id, { moveTo: to }); U.toast('Enter the session date to mark it Conducted.'); return; }
    var prev = Object.assign({}, s);
    replace(Object.assign({}, s, { status: to })); render();
    S.moveSession(s.id, to, { expectedVersion: s.version }).then(function (saved) {
      replace(saved); render(); U.toast(s.id + ' → ' + D.labelOf(D.SESSION_STATUSES, to));
    }).catch(function (e) {
      replace(prev); render(); U.fail(e);
      if (e && e.code === 'CONFLICT') reload().catch(U.fail);
    });
  }

  // ---------------------------------------------------------------- dialog
  function facilitatorField(selected) {
    var roster = state.ref.sessionFacilitators;
    if (!roster.length) {
      var t = el('input', { type: 'text', value: (selected || []).join(', '), placeholder: 'Full names, separated by commas' });
      return { node: el('label', { class: 'full' }, ['Facilitator(s)', t]), get: function () { return t.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); } };
    }
    var sel = (selected || []).map(D.normName), boxes = roster.map(function (n) {
      return el('input', { type: 'checkbox', value: n, checked: sel.indexOf(D.normName(n)) >= 0 });
    });
    return {
      node: el('div', { class: 'field full' }, ['Facilitator(s)', el('div', { class: 'checks' }, roster.map(function (n, i) { return el('label', {}, [boxes[i], n]); }))]),
      get: function () { return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }); }
    };
  }

  function openDialog(id, o) {
    o = o || {};
    var s = id ? byId(id) : null, creating = !s;
    dlg.textContent = '';
    var errs = el('div', { hidden: true }), warns = el('div', { hidden: true });
    var title = el('h2', { text: creating ? 'New training session' : s.id + ' · ' + (s.program || '') });

    function showErr(msg) { errs.hidden = !msg; errs.className = 'errs'; errs.textContent = msg || ''; }
    function showWarn(list) { warns.hidden = !list.length; warns.className = 'warns'; warns.textContent = list.join(' '); }

    function details() {
      var cur = s || { status: 'PLANNED', facilitators: [] };
      var allowed = creating ? [cur.status] : [cur.status].concat(D.TRANSITIONS[cur.status] || []);
      var f = {
        program: el('input', { type: 'text', value: cur.program || '', required: true }),
        date: el('input', { type: 'date', value: cur.date || '' }),
        type: el('select', {}, U.options(D.TRAINING_TYPES, '—', cur.trainingType)),
        brand: el('select', {}, U.options(D.BRANDS, '—', cur.brand)),
        venue: el('input', { type: 'text', value: cur.venue || '' }),
        target: el('input', { type: 'number', min: '0', step: '1', value: cur.targetPax == null ? '' : cur.targetPax }),
        actual: el('input', { type: 'number', min: '0', step: '1', value: cur.actualPax == null ? '' : cur.actualPax }),
        hrs: el('input', { type: 'number', min: '0', step: '0.25', value: cur.durationHrs == null ? '' : cur.durationHrs }),
        post: el('input', { type: 'number', min: '0', max: '100', step: '0.01', value: cur.postTestAvg == null ? '' : cur.postTestAvg }),
        status: el('select', { disabled: creating }, D.SESSION_STATUSES.filter(function (x) { return allowed.indexOf(x.code) >= 0; }).map(function (x) { return el('option', { value: x.code, text: x.label, selected: x.code === (o.moveTo || cur.status) }); })),
        remarks: el('textarea', { rows: '2' })
      };
      f.remarks.value = cur.remarks || '';
      var fac = facilitatorField(cur.facilitators);
      function collect() {
        return { program: f.program.value, date: f.date.value, trainingType: f.type.value, brand: f.brand.value, venue: f.venue.value, facilitators: fac.get(),
          targetPax: f.target.value, actualPax: f.actual.value, durationHrs: f.hrs.value, postTestAvg: f.post.value, remarks: f.remarks.value, status: f.status.value };
      }
      function preview() { S.scheduleWarnings(Object.assign({ id: s && s.id }, collect(), { status: f.status.value })).then(showWarn).catch(function () {}); }
      f.date.addEventListener('change', preview);
      var save = el('button', { type: 'button', class: 'primary', text: creating ? 'Create session' : 'Save changes', onclick: function () {
        showErr(''); save.disabled = true;
        var v = collect(), p;
        if (creating) { delete v.status; p = S.createSession(v); }
        else {
          var patch = v; if (patch.status === s.status) delete patch.status;
          p = S.updateSession(s.id, patch, s.version);
        }
        p.then(function (saved) {
          replace(saved); render(); U.toast((creating ? 'Created ' : 'Saved ') + saved.id);
          return S.scheduleWarnings(saved).then(function (w) { if (w.length) { showWarn(w); s = saved; title.textContent = saved.id + ' · ' + saved.program; } else dlg.close(); });
        }).catch(function (e) { showErr(e.message); if (e.code === 'CONFLICT') reload().catch(U.fail); }).then(function () { save.disabled = false; });
      } });
      var box = el('div', { class: 'grid2' }, [
        el('label', { class: 'full' }, ['Program / Module *', f.program]),
        el('label', {}, ['Date', f.date]), el('label', {}, ['Status', f.status]),
        el('label', {}, ['Training type', f.type]), el('label', {}, ['Brand', f.brand]),
        el('label', { class: 'full' }, ['Store / Venue', f.venue]),
        fac.node,
        el('label', {}, ['Target pax', f.target]), el('label', {}, ['Actual pax', f.actual]),
        el('label', {}, ['Duration (hrs)', f.hrs]), el('label', {}, ['Post-test avg (%)', f.post]),
        el('label', { class: 'full' }, ['Remarks', f.remarks])
      ]);
      return el('div', { class: 'dlg', style: 'padding:0' }, [box, el('div', { class: 'actions' }, [el('button', { type: 'button', text: 'Close', onclick: function () { dlg.close(); } }), save])]);
    }

    dlg.appendChild(el('div', { class: 'dlg' }, [title, errs, warns, details()]));
    if (!dlg.open) dlg.showModal();
  }

  // ---------------------------------------------------------------- filters and startup
  function initFilters() {
    var months = {}; state.sessions.forEach(function (s) { if (s.date) months[s.date.slice(0, 7)] = 1; });
    var m = document.getElementById('f-month'); m.textContent = '';
    m.appendChild(el('option', { value: '', text: 'All months' }));
    Object.keys(months).sort().forEach(function (k) { m.appendChild(el('option', { value: k, text: k })); });
    m.value = state.f.month;
    var b = document.getElementById('f-brand'); b.textContent = ''; U.options(D.BRANDS, 'All brands', '').forEach(function (o) { b.appendChild(o); });
    var w = document.getElementById('f-who'); w.textContent = ''; w.appendChild(el('option', { value: '', text: 'All facilitators' }));
    state.ref.sessionFacilitators.forEach(function (n) { w.appendChild(el('option', { value: n, text: n })); });
  }
  ['month', 'brand', 'who'].forEach(function (k) { document.getElementById('f-' + k).addEventListener('change', function (e) { state.f[k] = e.target.value; render(); }); });
  document.getElementById('f-q').addEventListener('input', function (e) { state.f.q = e.target.value; render(); });
  document.getElementById('new').addEventListener('click', function () { openDialog(null); });
  document.getElementById('reload').addEventListener('click', function () { reload().then(initFilters).catch(U.fail); });

  U.banner(document.getElementById('banner'));
  Promise.all([S.reference(), S.listSessions()]).then(function (r) {
    state.ref = r[0]; state.sessions = r[1]; initFilters(); render();
    if (!state.sessions.length) U.toast(A.connected ? 'No sessions scheduled yet. Use "New session" to add the first one.' : 'Empty board. Use "New session" to try it out.');
  }).catch(function (e) { U.fail(e); boardEl.textContent = 'Could not load the schedule.'; });
})();
