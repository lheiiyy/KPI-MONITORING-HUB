// Facilitator daily attendance (Attendance / Punctuality / Behavior KRA). One row per team
// member per day. This is NOT training-session attendance; that lives on the schedule board.
(function () {
  var A = window.ATT, D = A.domain, S = A.service, U = A.ui, el = U.el;
  var dateEl = document.getElementById('day'), rowsEl = document.getElementById('rows'), kraEl = document.getElementById('kra');
  var team = [], byPerson = {};

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function personRow(p, rec) {
    var f = {
      status: el('select', { 'aria-label': 'Status for ' + p.name }, U.options(D.FAC_STATUSES, '—', rec && rec.status)),
      tin: el('input', { type: 'time', value: (rec && rec.timeIn) || '', 'aria-label': 'Time in' }),
      tout: el('input', { type: 'time', value: (rec && rec.timeOut) || '', 'aria-label': 'Time out' }),
      loc: el('select', { 'aria-label': 'Work location' }, U.options(D.WORK_LOCATIONS, '—', rec && rec.workLocation)),
      leave: el('select', { 'aria-label': 'Leave type' }, U.options(D.LEAVE_TYPES, '—', rec && rec.leaveType)),
      rem: el('input', { type: 'text', value: (rec && rec.remarks) || '', 'aria-label': 'Remarks' })
    };
    var msg = el('span', { class: 'saved' }), version = rec && rec.version, exists = !!rec;
    function syncLeave() { f.leave.disabled = f.status.value !== 'ON_LEAVE'; if (f.leave.disabled) f.leave.value = ''; }
    f.status.addEventListener('change', syncLeave); syncLeave();
    var save = el('button', { type: 'button', class: 'primary', text: 'Save', onclick: function () {
      msg.textContent = ''; save.disabled = true;
      S.saveFacilitatorAttendance({ person: p.name, date: dateEl.value, status: f.status.value, timeIn: f.tin.value, timeOut: f.tout.value, workLocation: f.loc.value, leaveType: f.leave.value, remarks: f.rem.value }, exists ? version : undefined)
        .then(function (saved) { version = saved.version; exists = true; del.hidden = false; msg.textContent = 'Saved'; loadKra(); })
        .catch(function (e) { U.fail(e); if (e.code === 'CONFLICT') load(); }).then(function () { save.disabled = false; });
    } });
    var del = el('button', { type: 'button', class: 'danger', text: 'Clear', hidden: !exists, onclick: function () {
      S.deleteFacilitatorAttendance(p.name, dateEl.value).then(function () { load(); U.toast('Cleared ' + p.name); }).catch(U.fail);
    } });
    return el('tr', {}, [el('td', {}, [el('b', { text: p.name }), el('div', { class: 'muted', text: p.position || '' })]), el('td', {}, [f.status]), el('td', {}, [f.tin]), el('td', {}, [f.tout]),
      el('td', {}, [f.loc]), el('td', {}, [f.leave]), el('td', {}, [f.rem]), el('td', {}, [save, ' ', del, ' ', msg])]);
  }

  function load() {
    var d = dateEl.value; if (!D.parseDate(d)) return;
    S.listFacilitatorAttendance({ from: d, to: d }).then(function (recs) {
      byPerson = {}; recs.forEach(function (r) { byPerson[D.normName(r.person)] = r; });
      rowsEl.textContent = '';
      if (!team.length) { rowsEl.appendChild(el('tr', {}, [el('td', { colspan: '8', class: 'muted', text: 'No team members are listed yet (LISTS tab of TDD Team Attendance Monitoring 2026).' })])); return; }
      team.forEach(function (p) { rowsEl.appendChild(personRow(p, byPerson[D.normName(p.name)])); });
    }).catch(U.fail);
    loadKra();
  }

  function loadKra() {
    var month = dateEl.value.slice(0, 7);
    S.kraMonthly(month).then(function (list) {
      var by = {}; list.forEach(function (k) { by[D.normName(k.person)] = k; });
      var body = el('tbody');
      team.forEach(function (p) {
        var k = by[D.normName(p.name)];
        body.appendChild(el('tr', {}, k
          ? [el('td', { text: p.name }), el('td', { class: 'num', text: String(k.workingDays) }), el('td', { class: 'num', text: String(k.daysPresent) }), el('td', { class: 'num', text: String(k.lates) }),
            el('td', { class: 'num', text: String(k.absences) }), el('td', { class: 'num', text: String(k.leaveDays) }), el('td', { class: 'num', text: k.ratingPct == null ? 'no data' : k.ratingPct.toFixed(2) + '%' })]
          : [el('td', { text: p.name }), el('td', { class: 'num muted', colspan: '6', text: 'no data this month' })]));
      });
      kraEl.textContent = '';
      kraEl.appendChild(el('table', {}, [el('thead', {}, [el('tr', {}, ['Team member', 'Working days', 'Days present', 'Lates', 'Absences', 'Leave days', 'KRA rating'].map(function (h, i) { return el('th', { class: i ? 'num' : '', text: h }); }))]), body]));
    }).catch(U.fail);
  }

  U.banner(document.getElementById('banner'));
  dateEl.value = today();
  dateEl.addEventListener('change', load);
  S.reference().then(function (r) { team = r.teamMembers || []; load(); }).catch(function (e) { U.fail(e); });
})();
