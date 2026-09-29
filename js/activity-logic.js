// Activity business logic: pure functions only (no DOM, no network), so they are
// unit-testable in Node. Enumerations (statuses, priorities, people ...) are NEVER
// declared here - they arrive from the backend's `meta` call and are passed in.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ActivityLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PRIORITY_RANK = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Local calendar date as YYYY-MM-DD (no UTC shift: a user at 00:30 local still gets "today").
  function todayISO(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function isIsoDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // "2026-10-05" -> "5 Oct 2026", built from the string parts so no timezone can move the day.
  function formatDate(iso) {
    if (!isIsoDate(iso)) return iso ? String(iso) : '';
    return (+iso.slice(8, 10)) + ' ' + MONTHS[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4);
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d)) return String(ts);
    return formatDate(todayISO(d)) + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function yearOf(a) { return isIsoDate(a.activity_date) ? a.activity_date.slice(0, 4) : ''; }
  function monthOf(a) { return isIsoDate(a.activity_date) ? a.activity_date.slice(5, 7) : ''; }

  function statusDef(statuses, code) {
    for (var i = 0; i < statuses.length; i++) if (statuses[i].code === code) return statuses[i];
    return null;
  }

  // Overdue = has a due date in the past and is not finished (COMPLETED / CANCELLED).
  function isOverdue(a, statuses, today) {
    var def = statusDef(statuses, a.status);
    if (!a.due_date || !isIsoDate(a.due_date) || (def && def.terminal)) return false;
    return a.due_date < today;
  }

  function labelMap(list) { var m = {}; (list || []).forEach(function (x) { m[x.id] = x.label; }); return m; }

  // Years present in the data (never a constant), always including the current year.
  function availableYears(items, today) {
    var seen = {}; seen[today.slice(0, 4)] = true;
    items.forEach(function (a) { var y = yearOf(a); if (y) seen[y] = true; });
    return Object.keys(seen).sort().reverse();
  }

  function locationKey(a) { return a.location_id || a.location_name || ''; }
  function locationLabel(a) { return a.location_name || a.location_id || ''; }

  function searchHaystack(a, refs) {
    return [a.activity_id, a.activity_title, a.activity_description, refs.people[a.owner_id] || a.owner_id,
      refs.people[a.assigned_to_id] || a.assigned_to_id, a.location_id, a.location_name,
      refs.brands[a.brand_id] || a.brand_id, refs.types[a.activity_type] || a.activity_type].join(' \u0001 ').toLowerCase();
  }

  // filters: {year, month, status, priority, type, owner, assignee, location, brand, kpi,
  //           overdue(bool), state:'all'|'active'|'completed', q}. Empty string = no filter.
  function filterActivities(items, f, ctx) {
    var terms = (f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(function (a) {
      if (f.year && yearOf(a) !== f.year) return false;
      if (f.month && monthOf(a) !== f.month) return false;
      if (f.status && a.status !== f.status) return false;
      if (f.priority && a.priority !== f.priority) return false;
      if (f.type && a.activity_type !== f.type) return false;
      if (f.owner && a.owner_id !== f.owner) return false;
      if (f.assignee && a.assigned_to_id !== f.assignee) return false;
      if (f.location && locationKey(a) !== f.location) return false;
      if (f.brand && a.brand_id !== f.brand) return false;
      if (f.kpi && a.kpi_id !== f.kpi) return false;
      if (f.overdue && !isOverdue(a, ctx.statuses, ctx.today)) return false;
      if (f.state === 'completed' && a.status !== 'COMPLETED') return false;
      if (f.state === 'active') { var d = statusDef(ctx.statuses, a.status); if (d && d.terminal) return false; }
      if (terms.length) { var h = searchHaystack(a, ctx.refs); for (var i = 0; i < terms.length; i++) if (h.indexOf(terms[i]) < 0) return false; }
      return true;
    });
  }

  function summarize(items, statuses, today) {
    var by = {}; statuses.forEach(function (s) { by[s.code] = 0; });
    var overdue = 0;
    items.forEach(function (a) { if (a.status in by) by[a.status]++; if (isOverdue(a, statuses, today)) overdue++; });
    return { total: items.length, byStatus: by, overdue: overdue };
  }

  function compareCards(a, b) {
    var p = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0);
    if (p) return p;
    var da = a.due_date || '9999-12-31', db = b.due_date || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    return String(a.activity_title).localeCompare(String(b.activity_title));
  }

  function groupByStatus(items, statuses) {
    var g = {}; statuses.forEach(function (s) { g[s.code] = []; });
    items.forEach(function (a) { if (g[a.status]) g[a.status].push(a); });
    Object.keys(g).forEach(function (k) { g[k].sort(compareCards); });
    return g;
  }

  // Client-side mirror of the backend rules, for instant feedback only.
  // The backend re-validates everything and remains the authority.
  function validateDraft(d, meta) {
    var e = {};
    function blank(v) { return v === undefined || v === null || String(v).trim() === ''; }
    function known(list, id) { return (list || []).some(function (x) { return x.id === id; }); }
    if (blank(d.activity_title)) e.activity_title = 'Title is required.';
    else if (String(d.activity_title).length > 200) e.activity_title = 'Title must be 200 characters or fewer.';
    if (blank(d.activity_type)) e.activity_type = 'Choose an activity type.';
    else if (!known(meta.activity_types, d.activity_type)) e.activity_type = 'Unknown activity type.';
    if (blank(d.activity_date)) e.activity_date = 'Activity date is required.';
    else if (!isIsoDate(d.activity_date)) e.activity_date = 'Enter a valid date.';
    if (blank(d.owner_id)) e.owner_id = 'Choose an owner.';
    else if (!known(meta.people, d.owner_id)) e.owner_id = 'Unknown owner.';
    if (!blank(d.assigned_to_id) && !known(meta.people, d.assigned_to_id)) e.assigned_to_id = 'Unknown assignee.';
    if (!statusDef(meta.statuses, d.status)) e.status = 'Choose a status.';
    if (meta.priorities.indexOf(d.priority) < 0) e.priority = 'Choose a priority.';
    ['start_date', 'due_date', 'completed_date'].forEach(function (f) {
      if (!blank(d[f]) && !isIsoDate(d[f])) e[f] = 'Enter a valid date.';
    });
    if (!e.start_date && !e.due_date && d.start_date && d.due_date && d.due_date < d.start_date) e.due_date = 'Due date cannot be before the start date.';
    if (!blank(d.progress_percent)) {
      var n = Number(d.progress_percent);
      if (!isFinite(n) || Math.floor(n) !== n || n < 0 || n > 100) e.progress_percent = 'Progress must be a whole number from 0 to 100.';
    }
    ['target_value', 'actual_value'].forEach(function (f) { if (!blank(d[f]) && !isFinite(Number(d[f]))) e[f] = 'Enter a number.'; });
    if (!blank(d.evidence_url) && !/^https?:\/\/\S+$/i.test(String(d.evidence_url).trim())) e.evidence_url = 'Enter a link starting with http:// or https://';
    if (!blank(d.brand_id) && !known(meta.brands, d.brand_id)) e.brand_id = 'Unknown brand.';
    if (!blank(d.kpi_id) && !known(meta.kpis, d.kpi_id)) e.kpi_id = 'Unknown KPI/KRA.';
    return e;
  }

  return {
    todayISO: todayISO, isIsoDate: isIsoDate, formatDate: formatDate, formatTimestamp: formatTimestamp,
    yearOf: yearOf, monthOf: monthOf, isOverdue: isOverdue, statusDef: statusDef, labelMap: labelMap,
    availableYears: availableYears, locationKey: locationKey, locationLabel: locationLabel,
    filterActivities: filterActivities, summarize: summarize, groupByStatus: groupByStatus,
    compareCards: compareCards, validateDraft: validateDraft, MONTHS: MONTHS
  };
});
