// Activity Kanban UI. Holds only a *cache* of records fetched from the backend:
// every mutation goes to the API first (or is rolled back), and the server's
// returned record replaces the cached one. Nothing is persisted in the browser
// except the session token (sessionStorage).
(function (root) {
  var L = root.ActivityLogic;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  var FILTER_DEFAULTS = { q: '', year: '', month: '', status: '', priority: '', type: '', owner: '', assignee: '', location: '', brand: '', kpi: '', state: 'all', overdue: false, secondary: false };
  var TOKEN_KEY = 'activity.token';

  function mount(host, api, config) {
    var S = {
      meta: null, items: [], filters: Object.assign({}, FILTER_DEFAULTS), busy: new Set(), editing: null, loaded: false
    };
    var storage = (function () { try { return root.sessionStorage; } catch (e) { return null; } })();
    var memToken = '';
    var tokenStore = {
      get: function () { try { return (storage && storage.getItem(TOKEN_KEY)) || memToken; } catch (e) { return memToken; } },
      set: function (t) { memToken = t; try { storage && storage.setItem(TOKEN_KEY, t); } catch (e) { /* private mode */ } },
      clear: function () { memToken = ''; try { storage && storage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }
    };
    config.bindToken(tokenStore.get);

    host.innerHTML =
      '<div id="act-toasts" class="toasts" role="region" aria-live="polite" aria-label="Notifications"></div>' +
      '<div id="act-banner" role="alert"></div>' +
      '<section id="act-auth" class="panel auth" hidden></section>' +
      '<div id="act-main" hidden>' +
      '  <div class="toolbar">' +
      '    <label class="search"><span class="sr">Search activities</span><input id="act-search" type="search" placeholder="Search ID, title, description, owner, assignee, location, brand, type" autocomplete="off"></label>' +
      '    <button id="btn-add" class="btn primary" type="button">+ Add Activity</button>' +
      '    <button id="btn-refresh" class="btn" type="button">Refresh</button>' +
      '    <span class="who" id="act-who"></span>' +
      '  </div>' +
      '  <details class="filters" id="act-filters" open><summary>Filters <span id="filter-count" class="pill"></span></summary><div class="fgrid" id="fgrid"></div></details>' +
      '  <div class="kpis" id="act-summary" aria-label="Activity summary"></div>' +
      '  <div id="act-empty" class="empty" hidden></div>' +
      '  <div class="board" id="act-board" aria-label="Activity Kanban board"></div>' +
      '</div>' +
      '<dialog id="act-dialog" aria-labelledby="dlg-title"></dialog>';

    var main = $('#act-main', host), auth = $('#act-auth', host), banner = $('#act-banner', host), dlg = $('#act-dialog', host);

    // ---------- notifications ----------
    function toast(msg, kind) {
      var t = document.createElement('div');
      t.className = 'toast ' + (kind || 'ok');
      t.innerHTML = '<span>' + esc(msg) + '</span><button type="button" aria-label="Dismiss">&times;</button>';
      $('button', t).addEventListener('click', function () { t.remove(); });
      var box = $('#act-toasts', host);
      box.appendChild(t);
      while (box.children.length > 4) box.removeChild(box.firstChild);   // keep the stack from covering the board
      if (kind !== 'err') setTimeout(function () { t.remove(); }, 3500);
    }
    function friendly(err) {
      if (!err) return 'Something went wrong.';
      if (err.code === 'CONFLICT') return err.message + ' (Use Refresh.)';
      return err.message || 'Something went wrong.';
    }
    function showBanner(msg, retry) {
      banner.innerHTML = msg ? '<div class="banner err"><span>' + esc(msg) + '</span>' + (retry ? '<button class="btn small" type="button" id="banner-retry">Try again</button>' : '') + '</div>' : '';
      if (retry) $('#banner-retry', banner).addEventListener('click', retry);
    }

    // ---------- auth ----------
    function showAuth(message, opts) {
      opts = opts || {};
      main.hidden = true; auth.hidden = false;
      if (opts.notConfigured) {
        auth.innerHTML = '<h2>Activity API not configured</h2><p class="knote">' + esc(message) + '</p>';
        return;
      }
      auth.innerHTML = '<h2>Sign in to Activity Monitoring</h2>' +
        '<p class="knote">Enter the access token issued to you by the Training &amp; Development administrator. It is kept only for this browser tab.</p>' +
        (message ? '<p class="ferr" role="alert">' + esc(message) + '</p>' : '') +
        '<form id="auth-form" class="authrow"><label class="sr" for="auth-token">Access token</label>' +
        '<input id="auth-token" type="password" autocomplete="off" required placeholder="Access token">' +
        '<button class="btn primary" type="submit">Connect</button></form>';
      $('#auth-form', auth).addEventListener('submit', function (e) {
        e.preventDefault();
        tokenStore.set($('#auth-token', auth).value.trim());
        boot();
      });
      $('#auth-token', auth).focus();
    }

    // ---------- data ----------
    function boot() {
      showBanner('');
      if (!config.url) { showAuth('Set apiUrl in js/activity-config.js to your deployed Apps Script web-app URL (see docs/ACTIVITY_SETUP.md).', { notConfigured: true }); return; }
      if (!tokenStore.get()) { showAuth(''); return; }
      auth.hidden = true; main.hidden = false;
      $('#act-board', host).innerHTML = '<p class="knote loading">Loading activities&hellip;</p>';
      Promise.all([api.getMeta(), api.listActivities()]).then(function (r) {
        S.meta = r[0]; S.items = r[1];
        if (!S.loaded) {
          var yrs = L.availableYears(S.items, S.meta.today);
          var cur = S.meta.today.slice(0, 4);
          var hasCur = S.items.some(function (a) { return L.yearOf(a) === cur; });
          S.filters.year = (hasCur && yrs.length) ? cur : '';
          S.loaded = true;
        }
        buildStatic(); render();
      }).catch(function (err) {
        if (err.code === 'UNAUTHORIZED') { tokenStore.clear(); showAuth(err.message === 'Enter your access token to continue.' ? '' : err.message); return; }
        if (err.code === 'CONFIG_MISSING' && !S.meta) { showAuth(err.message, { notConfigured: true }); return; }
        $('#act-board', host).innerHTML = '';
        showBanner(friendly(err), boot);
      });
    }

    function refresh() {
      return api.listActivities().then(function (items) { S.items = items; showBanner(''); render(); toast('Refreshed.'); })
        .catch(function (err) { showBanner(friendly(err), refresh); });
    }

    // ---------- filters ----------
    function options(list, val, allLabel) {
      return '<option value="">' + esc(allLabel) + '</option>' + list.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === val ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
    }
    function refs() {
      return { people: L.labelMap(S.meta.people), brands: L.labelMap(S.meta.brands), types: L.labelMap(S.meta.activity_types), kpis: L.labelMap(S.meta.kpis) };
    }
    function buildStatic() {
      $('#act-who', host).textContent = S.meta.user + (S.meta.role === 'write' ? '' : ' (read-only)');
      $('#btn-add', host).hidden = S.meta.role !== 'write';
      buildFilters();
      // Phones: start with filters collapsed so the board is reachable without a long scroll.
      if (!S.filtersInit) { S.filtersInit = true; if (root.matchMedia && root.matchMedia('(max-width:640px)').matches) $('#act-filters', host).open = false; }
    }
    function buildFilters() {
      var f = S.filters, m = S.meta;
      var years = L.availableYears(S.items, m.today).map(function (y) { return { id: y, label: y }; });
      var months = L.MONTHS.map(function (n, i) { return { id: (i < 9 ? '0' : '') + (i + 1), label: n }; });
      var locs = {}; S.items.forEach(function (a) { var k = L.locationKey(a); if (k) locs[k] = L.locationLabel(a); });
      var locList = Object.keys(locs).sort().map(function (k) { return { id: k, label: locs[k] }; });
      function sel(id, label, list, val, all) { return '<label class="f"><span>' + label + '</span><select id="f-' + id + '">' + options(list, val, all) + '</select></label>'; }
      $('#fgrid', host).innerHTML =
        sel('year', 'Year', years, f.year, 'All years') + sel('month', 'Month', months, f.month, 'All months') +
        sel('status', 'Status', m.statuses.map(function (s) { return { id: s.code, label: s.label }; }), f.status, 'All statuses') +
        sel('priority', 'Priority', m.priorities.map(function (p) { return { id: p, label: p.charAt(0) + p.slice(1).toLowerCase() }; }), f.priority, 'All priorities') +
        sel('type', 'Activity type', m.activity_types, f.type, 'All types') +
        sel('owner', 'Owner', m.people, f.owner, 'All owners') + sel('assignee', 'Assignee', m.people, f.assignee, 'All assignees') +
        sel('location', 'Location / store', locList, f.location, 'All locations') + sel('brand', 'Brand', m.brands, f.brand, 'All brands') +
        sel('kpi', 'KPI / KRA', m.kpis, f.kpi, 'All KPIs') +
        '<label class="f"><span>Progress</span><select id="f-state"><option value="all">Completed &amp; active</option><option value="active"' + (f.state === 'active' ? ' selected' : '') + '>Active only</option><option value="completed"' + (f.state === 'completed' ? ' selected' : '') + '>Completed only</option></select></label>' +
        '<label class="chk"><input type="checkbox" id="f-overdue"' + (f.overdue ? ' checked' : '') + '> Overdue only</label>' +
        '<label class="chk"><input type="checkbox" id="f-secondary"' + (f.secondary ? ' checked' : '') + '> Show On Hold &amp; Cancelled</label>' +
        '<button type="button" class="btn small" id="btn-clear">Clear filters</button>';
    }
    function activeFilterCount() {
      var f = S.filters, n = 0;
      ['q', 'year', 'month', 'status', 'priority', 'type', 'owner', 'assignee', 'location', 'brand', 'kpi'].forEach(function (k) { if (f[k]) n++; });
      if (f.state !== 'all') n++; if (f.overdue) n++;
      return n;
    }

    // ---------- render ----------
    function ctxFor() { return { statuses: S.meta.statuses, today: S.meta.today, refs: refs() }; }
    function canWrite() { return S.meta.role === 'write'; }

    function cardHtml(a, r) {
      var over = L.isOverdue(a, S.meta.statuses, S.meta.today), w = canWrite() && !S.busy.has(a.activity_id);
      var owner = r.people[a.owner_id] || a.owner_id, asg = a.assigned_to_id ? (r.people[a.assigned_to_id] || a.assigned_to_id) : '';
      var meta = [];
      if (a.location_name || a.location_id) meta.push('<span title="Location / store">&#128205; ' + esc(L.locationLabel(a)) + '</span>');
      if (a.brand_id) meta.push('<span title="Brand">&#127991; ' + esc(r.brands[a.brand_id] || a.brand_id) + '</span>');
      if (a.kpi_id) meta.push('<span title="KPI / KRA">&#127919; ' + esc(r.kpis[a.kpi_id] || a.kpi_id) + '</span>');
      var opts = S.meta.statuses.map(function (s) { return '<option value="' + s.code + '"' + (s.code === a.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('');
      return '<article class="card' + (over ? ' overdue' : '') + (S.busy.has(a.activity_id) ? ' busy' : '') + '" data-id="' + esc(a.activity_id) + '" tabindex="0" draggable="' + w + '" aria-label="' + esc(a.activity_title) + '">' +
        '<div class="ctop"><span class="chip type">' + esc(r.types[a.activity_type] || a.activity_type) + '</span><span class="chip pr ' + esc(a.priority) + '">' + esc(a.priority) + '</span></div>' +
        '<h3>' + esc(a.activity_title) + '</h3>' +
        '<div class="who2">' + esc(owner) + (asg && asg !== owner ? ' &rarr; ' + esc(asg) : '') + '</div>' +
        '<div class="dates"><span>&#128197; ' + esc(L.formatDate(a.activity_date)) + '</span>' +
        (a.due_date ? '<span class="due' + (over ? ' late' : '') + '">Due ' + esc(L.formatDate(a.due_date)) + '</span>' : '') +
        (over ? '<span class="chip bad">OVERDUE</span>' : '') + (a.evidence_url ? '<a class="chip ev" href="' + esc(a.evidence_url) + '" target="_blank" rel="noopener noreferrer" title="Open evidence">&#128206; Evidence</a>' : '') + '</div>' +
        '<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + esc(a.progress_percent) + '" aria-label="Progress"><i style="width:' + Math.max(0, Math.min(100, Number(a.progress_percent) || 0)) + '%"></i><b>' + (Number(a.progress_percent) || 0) + '%</b></div>' +
        (meta.length ? '<div class="cmeta">' + meta.join('') + '</div>' : '') +
        '<div class="cfoot"><span class="cid">' + esc(a.activity_id) + '</span>' +
        '<label class="move"><span class="sr">Move ' + esc(a.activity_title) + ' to status</span><select class="move-select" ' + (w ? '' : 'disabled') + '>' + opts + '</select></label></div>' +
        '</article>';
    }

    function render() {
      if (!S.meta) return;
      var f = S.filters, r = refs(), ctx = ctxFor();
      var shown = L.filterActivities(S.items, f, ctx);
      var sum = L.summarize(shown, S.meta.statuses, S.meta.today);
      var fc = activeFilterCount();
      $('#filter-count', host).textContent = fc ? fc + ' active' : '';

      var cards = [
        ['total', 'Total activities', sum.total], ['BACKLOG'], ['PLANNED'], ['IN_PROGRESS'], ['FOR_REVIEW'], ['COMPLETED'], ['overdue', 'Overdue', sum.overdue]
      ].map(function (c) {
        var label = c[1], val = c[2], key = c[0];
        if (!label) { var d = L.statusDef(S.meta.statuses, key); if (!d) return ''; label = d.label; val = sum.byStatus[key]; }
        return '<div class="kpi' + (key === 'overdue' && val ? ' warn' : '') + '" data-sum="' + esc(key) + '"><div class="lbl">' + esc(label) + '</div><div class="val">' + val + '</div></div>';
      }).join('');
      var sec = S.meta.statuses.filter(function (s) { return s.board === 'secondary'; }).map(function (s) { return s.label + ' ' + sum.byStatus[s.code]; }).join(' · ');
      $('#act-summary', host).innerHTML = cards + (sec ? '<div class="kpi-note" data-sum="secondary">' + esc(sec) + '</div>' : '');

      var showSecondary = f.secondary || (f.status && L.statusDef(S.meta.statuses, f.status).board === 'secondary');
      var cols = S.meta.statuses.filter(function (s) { return s.board === 'primary' || showSecondary; });
      var groups = L.groupByStatus(shown, S.meta.statuses);
      var board = $('#act-board', host), keep = board.scrollLeft;
      board.innerHTML = cols.map(function (s) {
        var list = groups[s.code] || [];
        return '<section class="col" data-col="' + s.code + '" aria-label="' + esc(s.label) + '"><header><h2>' + esc(s.label) + '</h2><span class="pill" data-count>' + list.length + '</span></header>' +
          '<div class="col-body">' + (list.length ? list.map(function (a) { return cardHtml(a, r); }).join('') : '<p class="knote none">No activities</p>') + '</div></section>';
      }).join('');
      board.scrollLeft = keep;

      var empty = $('#act-empty', host);
      if (!S.items.length) { empty.hidden = false; empty.innerHTML = 'No activities yet.' + (canWrite() ? ' Use <b>+ Add Activity</b> to create the first one.' : ''); }
      else if (!shown.length) { empty.hidden = false; empty.textContent = 'No activities match the current search and filters.'; }
      else empty.hidden = true;
    }

    // ---------- status change (drag/drop AND the touch-friendly selector) ----------
    function moveStatus(id, status) {
      var old = S.items.filter(function (a) { return a.activity_id === id; })[0];
      if (!old || old.status === status || S.busy.has(id) || !canWrite()) { render(); return; }
      var snapshot = Object.assign({}, old);
      S.busy.add(id);
      replaceItem(Object.assign({}, old, { status: status }));           // optimistic
      render();
      api.updateActivityStatus(id, status, old.updated_at).then(function (saved) {
        S.busy.delete(id); replaceItem(saved); render();
        toast('Moved "' + saved.activity_title + '" to ' + L.statusDef(S.meta.statuses, saved.status).label + '.');
      }).catch(function (err) {
        S.busy.delete(id); replaceItem(snapshot); render();                // rollback
        if (err.code === 'UNAUTHORIZED') { tokenStore.clear(); showAuth(err.message); return; }
        toast('Not saved - the card was moved back. ' + friendly(err), 'err');
      });
    }
    function replaceItem(rec) {
      var i = S.items.findIndex(function (a) { return a.activity_id === rec.activity_id; });
      if (i >= 0) S.items[i] = rec; else S.items.push(rec);
    }

    // ---------- modal ----------
    var FIELD_ORDER = ['activity_title', 'activity_type', 'activity_date', 'owner_id', 'assigned_to_id', 'status', 'priority', 'start_date', 'due_date', 'completed_date', 'progress_percent', 'location_id', 'location_name', 'brand_id', 'kpi_id', 'target_value', 'actual_value', 'evidence_url', 'activity_description', 'notes'];

    function fld(name, label, control, wide, req) {
      return '<div class="fld' + (wide ? ' wide' : '') + '"><label for="m-' + name + '">' + label + (req ? ' <em title="required">*</em>' : '') + '</label>' + control + '<p class="ferr" data-err="' + name + '" role="alert"></p></div>';
    }
    function opts(list, val, blank) { return (blank ? '<option value="">&mdash;</option>' : '<option value="" disabled' + (val ? '' : ' selected') + '>Select&hellip;</option>') + list.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === val ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join(''); }

    function openDialog(rec) {
      var isNew = !rec, m = S.meta, ro = !canWrite();
      var a = rec || { activity_date: m.today, status: 'BACKLOG', priority: 'MEDIUM', progress_percent: 0 };
      S.editing = rec ? rec.activity_id : null;
      var dis = ro ? ' disabled' : '';
      function inp(name, type, extra) { return '<input id="m-' + name + '" name="' + name + '" type="' + type + '" value="' + esc(a[name]) + '"' + dis + (extra || '') + '>'; }
      var html = '<form id="act-form" novalidate method="dialog"><header class="dhead"><h2 id="dlg-title">' + (isNew ? 'Add Activity' : esc(a.activity_title)) + '</h2>' +
        (isNew ? '' : '<span class="cid">' + esc(a.activity_id) + '</span>') + '<button type="button" class="x" data-close aria-label="Close">&times;</button></header>' +
        '<p class="ferr" id="form-err" role="alert"></p><div class="dgrid">' +
        fld('activity_title', 'Activity title', inp('activity_title', 'text', ' maxlength="200"'), true, true) +
        fld('activity_type', 'Activity type', '<select id="m-activity_type" name="activity_type"' + dis + '>' + opts(m.activity_types, a.activity_type) + '</select>', false, true) +
        fld('activity_date', 'Activity date', inp('activity_date', 'date'), false, true) +
        fld('owner_id', 'Owner', '<select id="m-owner_id" name="owner_id"' + dis + '>' + opts(m.people, a.owner_id) + '</select>', false, true) +
        fld('assigned_to_id', 'Assigned to', '<select id="m-assigned_to_id" name="assigned_to_id"' + dis + '>' + opts(m.people, a.assigned_to_id, true) + '</select>') +
        fld('status', 'Status', '<select id="m-status" name="status"' + dis + '>' + opts(m.statuses.map(function (s) { return { id: s.code, label: s.label }; }), a.status) + '</select>', false, true) +
        fld('priority', 'Priority', '<select id="m-priority" name="priority"' + dis + '>' + opts(m.priorities.map(function (p) { return { id: p, label: p.charAt(0) + p.slice(1).toLowerCase() }; }), a.priority) + '</select>', false, true) +
        fld('start_date', 'Start date', inp('start_date', 'date')) + fld('due_date', 'Due date', inp('due_date', 'date')) +
        fld('completed_date', 'Completed date', inp('completed_date', 'date', a.status === 'COMPLETED' ? '' : ' disabled title="Set automatically when the status is Completed"')) +
        fld('progress_percent', 'Progress (%)', inp('progress_percent', 'number', ' min="0" max="100" step="1" inputmode="numeric"')) +
        fld('location_id', 'Location / store ID', inp('location_id', 'text', ' maxlength="60"')) + fld('location_name', 'Location / store name', inp('location_name', 'text', ' maxlength="200"')) +
        fld('brand_id', 'Brand', '<select id="m-brand_id" name="brand_id"' + dis + '>' + opts(m.brands, a.brand_id, true) + '</select>') +
        fld('kpi_id', 'KPI / KRA', '<select id="m-kpi_id" name="kpi_id"' + dis + '>' + opts(m.kpis, a.kpi_id, true) + '</select>') +
        fld('target_value', 'Target value', inp('target_value', 'number', ' step="any"')) + fld('actual_value', 'Actual value', inp('actual_value', 'number', ' step="any"')) +
        fld('evidence_url', 'Evidence link', inp('evidence_url', 'url', ' placeholder="https://"'), true) +
        fld('activity_description', 'Description', '<textarea id="m-activity_description" name="activity_description" rows="3" maxlength="4000"' + dis + '>' + esc(a.activity_description) + '</textarea>', true) +
        fld('notes', 'Notes', '<textarea id="m-notes" name="notes" rows="2" maxlength="4000"' + dis + '>' + esc(a.notes) + '</textarea>', true) +
        '</div>' +
        (isNew ? '' : '<dl class="meta"><dt>Created</dt><dd>' + esc(L.formatTimestamp(a.created_at)) + ' by ' + esc(a.created_by) + '</dd><dt>Last updated</dt><dd>' + esc(L.formatTimestamp(a.updated_at)) + ' by ' + esc(a.updated_by) + '</dd><dt>Status changed</dt><dd>' + esc(L.formatTimestamp(a.status_changed_at)) + '</dd></dl>' +
          '<details id="hist"><summary>Change history</summary><div id="hist-body" class="knote">Loading&hellip;</div></details>') +
        '<footer class="dfoot">' + (!isNew && !ro ? '<button type="button" class="btn danger" id="btn-archive">Archive</button>' : '') + '<span class="sp"></span><button type="button" class="btn" data-close>' + (ro ? 'Close' : 'Cancel') + '</button>' + (ro ? '' : '<button type="submit" class="btn primary" id="btn-save">' + (isNew ? 'Create activity' : 'Save changes') + '</button>') + '</footer></form>';
      dlg.innerHTML = html;
      if (!dlg.open) dlg.showModal();
      var form = $('#act-form', dlg);
      $('#m-status', dlg).addEventListener('change', function (e) {
        var c = $('#m-completed_date', dlg);
        if (e.target.value === 'COMPLETED') { c.disabled = false; c.removeAttribute('title'); if (!c.value) c.value = m.today; if (!isNew) $('#m-progress_percent', dlg).value = 100; }
        else { c.disabled = true; c.value = ''; }
      });
      if (!isNew) $('#hist', dlg).addEventListener('toggle', function () { loadHistory(a.activity_id); }, { once: true });
      form.addEventListener('submit', function (e) { e.preventDefault(); save(isNew, rec); });
      var arch = $('#btn-archive', dlg);
      if (arch) arch.addEventListener('click', function () {
        if (!root.confirm('Archive "' + a.activity_title + '"? It will disappear from the board but its record and history are kept.')) return;
        arch.disabled = true;
        api.archiveActivity(a.activity_id).then(function () { S.items = S.items.filter(function (x) { return x.activity_id !== a.activity_id; }); dlg.close(); render(); toast('Archived.'); })
          .catch(function (err) { arch.disabled = false; setFormError(friendly(err)); });
      });
      if (isNew) $('#m-activity_title', dlg).focus();
    }

    function loadHistory(id) {
      api.getActivityHistory(id).then(function (h) {
        $('#hist-body', dlg).innerHTML = h.length ? '<ul class="hist">' + h.map(function (x) {
          return '<li><b>' + esc(x.action) + '</b>' + (x.field ? ' ' + esc(x.field) + ': ' + esc(x.old_value || '(empty)') + ' &rarr; ' + esc(x.new_value || '(empty)') : (x.new_value ? ' ' + esc(x.new_value) : '')) + '<br><small>' + esc(L.formatTimestamp(x.changed_at)) + ' &middot; ' + esc(x.changed_by) + '</small></li>';
        }).join('') + '</ul>' : 'No history.';
      }).catch(function (err) { $('#hist-body', dlg).textContent = friendly(err); });
    }

    function readDraft() {
      var d = {};
      FIELD_ORDER.forEach(function (n) {
        var el = $('[name="' + n + '"]', dlg); if (!el) return;
        d[n] = el.value.trim();
      });
      return d;
    }
    function setFormError(msg) { var e = $('#form-err', dlg); if (e) e.textContent = msg || ''; }
    function setFieldErrors(errs) {
      $$('[data-err]', dlg).forEach(function (p) { p.textContent = errs[p.dataset.err] || ''; });
      $$('.fld', dlg).forEach(function (f) { var i = $('input,select,textarea', f); if (i) i.setAttribute('aria-invalid', errs[i.name] ? 'true' : 'false'); });
      var first = FIELD_ORDER.filter(function (n) { return errs[n]; })[0];
      if (first) $('[name="' + first + '"]', dlg).focus();
    }

    function save(isNew, orig) {
      setFormError(''); var draft = readDraft();
      var errs = L.validateDraft(draft, S.meta);
      setFieldErrors(errs);
      if (Object.keys(errs).length) { setFormError('Please fix the highlighted fields.'); return; }
      var payload = {}, numeric = { progress_percent: 1, target_value: 1, actual_value: 1 };
      FIELD_ORDER.forEach(function (n) {
        if (draft[n] === undefined) return;
        payload[n] = numeric[n] ? (draft[n] === '' ? '' : Number(draft[n])) : draft[n];
      });
      var btn = $('#btn-save', dlg); btn.disabled = true; btn.textContent = 'Saving…';
      var p;
      if (isNew) p = api.createActivity(payload);
      else {
        var changes = {};
        FIELD_ORDER.forEach(function (n) { if (n in payload && String(payload[n]) !== String(orig[n] === undefined ? '' : orig[n])) changes[n] = payload[n]; });
        if (!Object.keys(changes).length) { dlg.close(); return; }
        p = api.updateActivity(orig.activity_id, changes, orig.updated_at);
      }
      p.then(function (saved) {
        replaceItem(saved); dlg.close(); buildFilters(); render();
        toast(isNew ? 'Created ' + saved.activity_id + '.' : 'Saved changes to ' + saved.activity_id + '.');
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = isNew ? 'Create activity' : 'Save changes';
        if (err.code === 'UNAUTHORIZED') { dlg.close(); tokenStore.clear(); showAuth(err.message); return; }
        var fe = {}; ((err.details && Array.isArray(err.details)) ? err.details : []).forEach(function (d) { if (d.field) fe[d.field] = d.message; });
        setFieldErrors(fe);
        setFormError(friendly(err));
      });
    }

    // ---------- events ----------
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
    dlg.addEventListener('close', function () { S.editing = null; dlg.innerHTML = ''; });
    $('#btn-add', host).addEventListener('click', function () { openDialog(null); });
    $('#btn-refresh', host).addEventListener('click', refresh);

    var searchTimer;
    $('#act-search', host).addEventListener('input', function (e) {
      clearTimeout(searchTimer); var v = e.target.value;
      searchTimer = setTimeout(function () { S.filters.q = v; render(); }, 120);
    });
    host.addEventListener('change', function (e) {
      var t = e.target;
      if (t.closest('#fgrid')) {
        var k = t.id.replace('f-', '');
        S.filters[k] = t.type === 'checkbox' ? t.checked : t.value; render();
      } else if (t.classList.contains('move-select')) {
        moveStatus(t.closest('.card').dataset.id, t.value);
      }
    });
    host.addEventListener('click', function (e) {
      if (e.target.id === 'btn-clear') {
        S.filters = Object.assign({}, FILTER_DEFAULTS, { year: '' }); $('#act-search', host).value = ''; buildFilters(); render(); return;
      }
      var card = e.target.closest('.card');
      if (card && !e.target.closest('select,a,label')) openDialog(S.items.filter(function (a) { return a.activity_id === card.dataset.id; })[0]);
    });
    host.addEventListener('keydown', function (e) {
      var card = e.target.classList && e.target.classList.contains('card') ? e.target : null;
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDialog(S.items.filter(function (a) { return a.activity_id === card.dataset.id; })[0]); }
    });

    // Drag & drop (mouse/pen). Touch users use the per-card status selector.
    var board = $('#act-board', host);
    board.addEventListener('dragstart', function (e) {
      var c = e.target.closest && e.target.closest('.card'); if (!c || !canWrite()) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging');
    });
    board.addEventListener('dragend', function () { $$('.dragging,.dropover', board).forEach(function (n) { n.classList.remove('dragging', 'dropover'); }); });
    board.addEventListener('dragover', function (e) {
      var col = e.target.closest('.col'); if (!col || !canWrite()) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      $$('.dropover', board).forEach(function (n) { if (n !== col) n.classList.remove('dropover'); }); col.classList.add('dropover');
    });
    board.addEventListener('drop', function (e) {
      var col = e.target.closest('.col'); if (!col) return; e.preventDefault();
      var id = e.dataTransfer.getData('text/plain'); $$('.dropover', board).forEach(function (n) { n.classList.remove('dropover'); });
      if (id) moveStatus(id, col.dataset.col);
    });

    boot();
    return { state: S, reload: boot };
  }

  root.ActivityUI = { mount: mount };
})(typeof self !== 'undefined' ? self : this);
