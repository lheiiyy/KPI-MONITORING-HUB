// Attendance page (facilitators / trainers / T&D team members). Renders what the server returned and sends
// every change to the server first; nothing is stored or invented in the browser except the access token
// (sessionStorage, this tab only). Records shown are always the sheet's records: an empty sheet shows as empty.
(function (root) {
  var L = root.AttendanceLogic, Api = root.AttendanceApi;
  var TOKEN_KEY = 'attendance_token';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function options(list, blank, selected) {
    var out = blank != null ? [el('option', { value: '', text: blank })] : [];
    list.forEach(function (o) { out.push(el('option', { value: o.code, text: o.label, selected: o.code === selected })); });
    return out;
  }
  function getToken() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ } }
  function longDate(iso) { var d = new Date(iso + 'T00:00:00Z'); return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function longMonth(m) { var d = new Date(m + '-01T00:00:00Z'); return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }

  function start(cfg) {
    var $ = function (id) { return document.getElementById(id); };
    var S = { api: null, identity: null, meta: null, date: '', month: '', person: '', view: 'day', canWrite: false, dayRecords: [], lastMonth: null, dirty: {} };
    // Rows with typed-but-unsaved changes. Navigating away would discard them, so ask first.
    function guard(fn) { return function () { var n = Object.keys(S.dirty).length; if (n && !window.confirm('You have ' + n + ' unsaved row' + (n === 1 ? '' : 's') + '. Discard the changes?')) return false; S.dirty = {}; return fn.apply(this, arguments); }; }
    var statusEl = $('status'), tokenBox = $('tokenbox'), app = $('app'), toasts = $('toasts');

    function toast(msg, isErr) {
      var t = el('div', { class: 'toast' + (isErr ? ' err' : ''), role: isErr ? 'alert' : 'status', text: msg });
      toasts.appendChild(t); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, isErr ? 8000 : 3500);
    }
    function banner(kind, text) { statusEl.className = 'banner ' + kind; statusEl.textContent = text; }

    // ---------------------------------------------------------------- connection
    function needToken(msg) {
      app.hidden = true; tokenBox.hidden = false;
      if (msg) $('tokenmsg').textContent = msg;
    }
    function connect() {
      if (!cfg.apiUrl) { app.hidden = true; tokenBox.hidden = true; banner('off', 'Not configured: the attendance API address (apiUrl in js/attendance-config.js) is empty, so no attendance can be loaded or saved. Nothing is shown because nothing is available.'); return; }
      if (!getToken()) { banner('off', 'Enter your access token to load attendance.'); needToken(''); return; }
      banner('info', 'Connecting…');
      S.api.getMeta().then(function (meta) {
        S.meta = meta; S.canWrite = meta.role === 'write';
        banner(S.canWrite ? 'live' : 'off', 'Connected as ' + meta.user + ' (' + (S.canWrite ? 'can edit' : 'read-only') + '). Data source: TDD Team Attendance Monitoring 2026.' +
          (meta.vocabulary_warnings.length ? ' Warning: ' + meta.vocabulary_warnings.join(' ') : ''));
        tokenBox.hidden = true; app.hidden = false;
        S.date = S.date || meta.today; S.month = S.month || meta.today.slice(0, 7);
        buildControls(); refresh();
      }).catch(handleErr);
    }
    function handleErr(e) {
      if (e && e.code === 'UNAUTHORIZED') { setToken(''); banner('off', 'That access token was not accepted.'); needToken('The token is missing, wrong or was revoked. Ask an administrator for a token.'); return; }
      banner('off', (e && e.message) || 'Something went wrong.'); toast((e && e.message) || 'Something went wrong.', true);
    }

    // ---------------------------------------------------------------- controls
    function buildControls() {
      var who = $('f-person'); who.textContent = '';
      who.appendChild(el('option', { value: '', text: 'All team members' }));
      S.meta.team_members.forEach(function (m) { who.appendChild(el('option', { value: m.name, text: m.name + (m.position ? ' (' + m.position + ')' : '') })); });
      who.value = S.person;
      $('f-date').value = S.date; $('f-month').value = S.month;
      setView(S.view);
    }
    function setView(v) {
      S.view = v;
      $('tab-day').setAttribute('aria-selected', String(v === 'day')); $('tab-month').setAttribute('aria-selected', String(v === 'month'));
      $('day-view').hidden = v !== 'day'; $('month-view').hidden = v !== 'month';
      $('nav-day').hidden = v !== 'day'; $('nav-month').hidden = v !== 'month';
    }
    function refresh() { return S.view === 'day' ? loadDay() : loadMonth(); }

    // ---------------------------------------------------------------- daily entry
    function memberMatches(m, rec) {
      var a = S.identity.resolve(rec.person), b = S.identity.resolve(m.name);
      if (a && b) return a.person_id === b.person_id;
      return L.norm(rec.person) === L.norm(m.name);
    }
    function loadDay() {
      var d = S.date; if (!L.parseDate(d)) return;
      $('day-title').textContent = longDate(d);
      return S.api.listRecords({ from: d, to: d }).then(function (r) {
        if (d !== S.date) return; // user moved on
        S.dayRecords = r.records; renderDay(r);
      }).catch(handleErr);
    }
    function renderDay(r) {
      var members = S.meta.team_members.filter(function (m) { return !S.person || L.norm(m.name) === L.norm(S.person); });
      var body = $('rows'); body.textContent = '';
      var empty = $('day-empty');
      empty.hidden = r.records.length > 0;
      empty.textContent = r.records.length ? '' : 'No attendance has been recorded for ' + longDate(S.date) + '. The rows below are blank: nothing has been logged for this day.';
      $('day-count').textContent = r.records.length + ' record' + (r.records.length === 1 ? '' : 's') + ' for this day';
      members.forEach(function (m) {
        var rec = r.records.filter(function (x) { return memberMatches(m, x); })[0] || null;
        body.appendChild(memberRow(m, rec));
      });
      if (!members.length) body.appendChild(el('tr', {}, [el('td', { colspan: '8', class: 'muted', text: 'The TEAM MEMBER list in the attendance workbook is empty.' })]));
      // Records on this day that match nobody on the team list: shown, never hidden.
      var orphans = r.records.filter(function (x) { return !S.meta.team_members.some(function (m) { return memberMatches(m, x); }); });
      var box = $('orphans'); box.textContent = ''; box.hidden = !orphans.length;
      if (orphans.length) {
        box.appendChild(el('h3', { text: 'Records that do not match anyone on the team list' }));
        box.appendChild(el('p', { class: 'muted', text: 'Read-only. Fix the name in the sheet or add the person to the TEAM MEMBER list.' }));
        orphans.forEach(function (o) { box.appendChild(el('div', { class: 'orphan', text: o.person + ': ' + L.labelOf(L.STATUSES, o.status) + (o.problems.length ? ' (' + o.problems.join(' ') + ')' : '') })); });
      }
    }

    function memberRow(m, rec) {
      var f = {
        status: el('select', { 'aria-label': 'Status for ' + m.name }, options(L.STATUSES, '— not recorded —', rec && rec.status)),
        tin: el('input', { type: 'time', value: (rec && rec.time_in) || '', 'aria-label': 'Time in for ' + m.name }),
        tout: el('input', { type: 'time', value: (rec && rec.time_out) || '', 'aria-label': 'Time out for ' + m.name }),
        loc: el('select', { 'aria-label': 'Work location for ' + m.name }, options(L.WORK_LOCATIONS, '—', rec && rec.work_location)),
        leave: el('select', { 'aria-label': 'Leave type for ' + m.name }, options(L.LEAVE_TYPES, '—', rec && rec.leave_type)),
        rem: el('input', { type: 'text', maxlength: '1000', value: (rec && rec.remarks) || '', 'aria-label': 'Remarks for ' + m.name })
      };
      var msg = el('div', { class: 'rowmsg', role: 'status' }), version = rec ? rec.version : null, exists = !!rec;
      [f.status, f.tin, f.tout, f.loc, f.leave, f.rem].forEach(function (c) { c.addEventListener('input', function () { S.dirty[m.name] = true; }); c.addEventListener('change', function () { S.dirty[m.name] = true; }); });
      var fieldMap = { person: f.status, work_date: f.status, status: f.status, time_in: f.tin, time_out: f.tout, work_location: f.loc, leave_type: f.leave, remarks: f.rem };
      function clearErrors() { Object.keys(fieldMap).forEach(function (k) { fieldMap[k].removeAttribute('aria-invalid'); }); msg.className = 'rowmsg'; msg.textContent = ''; }
      function showErrors(list) {
        list.forEach(function (e) { if (fieldMap[e.field]) fieldMap[e.field].setAttribute('aria-invalid', 'true'); });
        msg.className = 'rowmsg bad'; msg.textContent = list.map(function (e) { return e.message; }).join(' ');
      }
      function syncLeave() { f.leave.disabled = !S.canWrite || f.status.value !== 'ON_LEAVE'; if (f.leave.disabled && f.status.value !== 'ON_LEAVE') f.leave.value = ''; }
      f.status.addEventListener('change', syncLeave);
      var save = el('button', { type: 'button', class: 'primary', text: exists ? 'Update' : 'Save', disabled: !S.canWrite, onclick: function () {
        clearErrors();
        var v = L.validateRecord({ person: m.name, work_date: S.date, status: f.status.value, time_in: f.tin.value, time_out: f.tout.value, work_location: f.loc.value, leave_type: f.leave.value, remarks: f.rem.value });
        if (!v.ok) { showErrors(v.errors); return; }
        save.disabled = true; msg.textContent = 'Saving…';
        S.api.saveRecord(v.value, exists ? version : null).then(function (saved) {
          version = saved.version; exists = true; save.textContent = 'Update'; del.hidden = false; delete S.dirty[m.name];
          msg.className = 'rowmsg good'; msg.textContent = 'Saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          toast('Saved ' + m.name + ' for ' + S.date);
          S.dayRecords = S.dayRecords.filter(function (x) { return !memberMatches(m, x); }).concat([saved]);
          $('day-empty').hidden = true; $('day-count').textContent = S.dayRecords.length + ' record' + (S.dayRecords.length === 1 ? '' : 's') + ' for this day';
        }).catch(function (e) {
          if (e.code === 'VALIDATION_ERROR' && e.details) showErrors(e.details);
          else if (e.code === 'CONFLICT') { msg.className = 'rowmsg bad'; msg.textContent = e.message; toast(e.message, true); loadDay(); }
          else { msg.className = 'rowmsg bad'; msg.textContent = e.message; handleErr(e); }
        }).then(function () { save.disabled = !S.canWrite; });
      } });
      var del = el('button', { type: 'button', class: 'danger', text: 'Clear', hidden: !exists || !S.canWrite, onclick: function () {
        if (!window.confirm('Remove ' + m.name + '\'s attendance record for ' + longDate(S.date) + '?')) return;
        S.api.deleteRecord(m.name, S.date, version).then(function () { toast('Removed ' + m.name + ' for ' + S.date); loadDay(); }).catch(function (e) { toast(e.message, true); if (e.code === 'CONFLICT') loadDay(); });
      } });
      [f.status, f.tin, f.tout, f.loc, f.rem].forEach(function (c) { c.disabled = !S.canWrite; });
      syncLeave();
      var warn = rec && rec.problems.length ? el('div', { class: 'rowmsg bad', text: 'Sheet problem: ' + rec.problems.join(' ') }) : null;
      var pos = el('div', { class: 'muted', text: m.position || '' });
      if (m.link_status === 'PROPOSED') pos.appendChild(el('span', { class: 'chip', title: 'Spelling differs from the hub roster; identity link not yet confirmed', text: 'identity link unconfirmed' }));
      if (m.link_status === 'UNMAPPED') pos.appendChild(el('span', { class: 'chip', title: 'Not in data/team-identity.json', text: 'no person id' }));
      return el('tr', {}, [
        el('td', { 'data-label': 'Team member' }, [el('b', { text: m.name }), pos]),
        el('td', { 'data-label': 'Status' }, [f.status]), el('td', { 'data-label': 'Time in' }, [f.tin]), el('td', { 'data-label': 'Time out' }, [f.tout]),
        el('td', { 'data-label': 'Work location' }, [f.loc]), el('td', { 'data-label': 'Leave type' }, [f.leave]), el('td', { 'data-label': 'Remarks' }, [f.rem]),
        el('td', { 'data-label': '', class: 'act' }, [save, ' ', del, msg, warn])]);
    }

    // ---------------------------------------------------------------- month summary
    function loadMonth() {
      var range = L.monthRange(S.month); if (!range) return;
      $('month-title').textContent = longMonth(S.month);
      return S.api.listRecords({ from: range.from, to: range.to }).then(function (r) { S.lastMonth = r; renderMonth(r); }).catch(handleErr);
    }
    function renderMonth(r) {
      var res = L.kraMonthly(r.records, S.identity);
      var members = S.meta.team_members.filter(function (m) { return !S.person || L.norm(m.name) === L.norm(S.person); });
      $('month-count').textContent = r.records.length + ' attendance record' + (r.records.length === 1 ? '' : 's') + ' in ' + longMonth(S.month) + (r.problem_rows ? ' · ' + r.problem_rows + ' with problems' : '');
      $('month-empty').hidden = r.records.length > 0;
      $('month-empty').textContent = r.records.length ? '' : 'No attendance records for ' + longMonth(S.month) + ' (0 records). Every figure below is "no data", not zero.';
      var body = $('kra-rows'); body.textContent = '';
      var shown = {};
      members.forEach(function (m) {
        var res1 = S.identity.resolve(m.name), k = res.results.filter(function (x) { return res1 ? x.person_id === res1.person_id : L.norm(x.name) === L.norm(m.name); })[0];
        if (k) shown[k.person_id || k.name] = 1;
        body.appendChild(kraRow(m.name, k));
      });
      res.results.forEach(function (k) { if (!shown[k.person_id || k.name] && (!S.person || L.norm(k.name) === L.norm(S.person))) body.appendChild(kraRow(k.name + ' (not on team list)', k)); });

      // assumptions actually used, once each
      var notes = {}; res.results.forEach(function (k) { k.assumptions.forEach(function (a) { notes[a.note] = 1; }); });
      var ul = $('assumptions'); ul.textContent = '';
      Object.keys(notes).forEach(function (n) { ul.appendChild(el('li', { text: n })); });
      $('assume-box').hidden = !Object.keys(notes).length;

      // data quality
      var q = res.issues, dq = $('quality'); dq.textContent = '';
      function add(t) { dq.appendChild(el('li', { text: t })); }
      q.duplicates.forEach(function (d) { add('More than one record for ' + d.person + ' on ' + d.work_date + '. Only the first is counted.'); });
      q.unresolved_names.forEach(function (n) { add('"' + n + '" is not a known team member spelling, so it is kept separate.'); });
      q.proposed_alias_matches.forEach(function (n) { add(n + ': matched to a person through a spelling whose link is not yet confirmed.'); });
      if (q.invalid_status_rows) add(q.invalid_status_rows + ' record(s) have a missing or unrecognised status and are not counted.');
      $('quality-box').hidden = !dq.children.length;

      // one-person drill-down
      var det = $('detail'); det.textContent = ''; det.hidden = !S.person;
      if (S.person) {
        var mine = r.records.filter(function (x) { var a = S.identity.resolve(x.person), b = S.identity.resolve(S.person); return a && b ? a.person_id === b.person_id : L.norm(x.person) === L.norm(S.person); })
          .sort(function (a, b) { return (a.work_date || '') < (b.work_date || '') ? -1 : 1; });
        det.appendChild(el('h3', { text: S.person + ': records in ' + longMonth(S.month) }));
        if (!mine.length) det.appendChild(el('p', { class: 'muted', text: 'No records for this person in this month.' }));
        else {
          var tb = el('tbody');
          mine.forEach(function (x) { tb.appendChild(el('tr', {}, [el('td', { text: x.work_date || '?' }), el('td', { text: L.labelOf(L.STATUSES, x.status) || '?' }), el('td', { text: x.time_in || '' }), el('td', { text: x.time_out || '' }),
            el('td', { text: x.work_location ? L.labelOf(L.WORK_LOCATIONS, x.work_location) : '' }), el('td', { text: x.leave_type ? L.labelOf(L.LEAVE_TYPES, x.leave_type) : '' }), el('td', { text: x.remarks || '' })])); });
          det.appendChild(el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [el('tr', {}, ['Date', 'Status', 'In', 'Out', 'Location', 'Leave', 'Remarks'].map(function (h) { return el('th', { text: h }); }))]), tb])]));
        }
      }
    }
    function kraRow(name, k) {
      if (!k) return el('tr', {}, [el('td', { 'data-label': 'Team member', text: name }), el('td', { class: 'muted', colspan: '6', text: 'no data this month' })]);
      function n(v) { return String(v); }
      return el('tr', {}, [el('td', { 'data-label': 'Team member', text: name }), el('td', { class: 'num', 'data-label': 'Records', text: n(k.records) }), el('td', { class: 'num', 'data-label': 'Working days', text: n(k.working_days) }),
        el('td', { class: 'num', 'data-label': 'Days present', text: n(k.days_present) }), el('td', { class: 'num', 'data-label': 'Lates', text: n(k.lates) }), el('td', { class: 'num', 'data-label': 'Absences', text: n(k.absences) }),
        el('td', { class: 'num', 'data-label': 'KRA', text: k.rating_pct == null ? 'no working days' : k.rating_pct.toFixed(2) + '%' + (k.provisional ? ' *' : '') })]);
    }

    // ---------------------------------------------------------------- wiring
    $('tab-day').addEventListener('click', guard(function () { setView('day'); refresh(); }));
    $('tab-month').addEventListener('click', guard(function () { setView('month'); refresh(); }));
    $('f-person').addEventListener('change', function (e) {
      var prev = S.person, go = guard(function () {
        S.person = e.target.value;
        if (S.view === 'day') renderDay({ records: S.dayRecords }); else if (S.lastMonth) renderMonth(S.lastMonth); else refresh();   // filter from what is already loaded
      });
      if (go() === false) e.target.value = prev;
    });
    $('f-date').addEventListener('change', function (e) { var prev = S.date; if (!L.parseDate(e.target.value)) return; if (guard(function () { S.date = e.target.value; loadDay(); })() === false) e.target.value = prev; });
    $('d-prev').addEventListener('click', guard(function () { S.date = L.addDays(S.date, -1); $('f-date').value = S.date; loadDay(); }));
    $('d-next').addEventListener('click', guard(function () { S.date = L.addDays(S.date, 1); $('f-date').value = S.date; loadDay(); }));
    $('d-today').addEventListener('click', guard(function () { S.date = S.meta.today; $('f-date').value = S.date; loadDay(); }));
    $('f-month').addEventListener('change', function (e) { if (L.monthRange(e.target.value)) { S.month = e.target.value; loadMonth(); } });
    $('m-prev').addEventListener('click', function () { S.month = L.addMonths(S.month, -1); $('f-month').value = S.month; loadMonth(); });
    $('m-next').addEventListener('click', function () { S.month = L.addMonths(S.month, 1); $('f-month').value = S.month; loadMonth(); });
    $('m-this').addEventListener('click', function () { S.month = S.meta.today.slice(0, 7); $('f-month').value = S.month; loadMonth(); });
    $('reload').addEventListener('click', guard(function () { refresh(); }));
    $('tokenform').addEventListener('submit', function (e) { e.preventDefault(); var t = $('token').value.trim(); if (t) { setToken(t); $('token').value = ''; connect(); } });
    $('signout').addEventListener('click', function () { setToken(''); S.meta = null; connect(); });

    S.api = Api.create({ url: cfg.apiUrl, getToken: getToken });
    return fetch('../data/team-identity.json').then(function (r) { if (!r.ok) throw new Error('identity file'); return r.json(); })
      .then(function (j) { S.identity = L.createIdentity(j); connect(); })
      .catch(function () { banner('off', 'Could not load data/team-identity.json, so people cannot be identified. Nothing was loaded.'); });
  }

  root.AttendanceUi = { start: start };
})(typeof self !== 'undefined' ? self : this);
