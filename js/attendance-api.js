// Data-access layer for the Attendance module. The UI talks ONLY to this object; nothing here knows about
// spreadsheets, rows or columns. To move to PostgreSQL keep this contract and re-point `url`.
// Same transport, envelope and error codes as the Activity module. Contract: docs/ATTENDANCE_MODULE.md
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AttendanceApi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function AttendanceApiError(code, message, details) {
    var e = new Error(message); e.name = 'AttendanceApiError'; e.code = code; e.details = details || null; return e;
  }

  // opts: {url, getToken():string, fetchImpl?, timeoutMs?}
  function create(opts) {
    var doFetch = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    var timeoutMs = opts.timeoutMs || 25000;

    function call(action, params) {
      if (!opts.url) return Promise.reject(AttendanceApiError('CONFIG_MISSING', 'The Attendance API is not configured. Set apiUrl in js/attendance-config.js.'));
      var token = (opts.getToken && opts.getToken()) || '';
      var body = JSON.stringify(Object.assign({ action: action, token: token }, params || {}));
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs) : null;
      // text/plain keeps this a "simple" request: Apps Script cannot answer CORS preflights.
      return doFetch(opts.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow', signal: ctl ? ctl.signal : undefined })
        .catch(function (err) {
          if (timer) clearTimeout(timer);
          throw AttendanceApiError('BACKEND_UNAVAILABLE', err && err.name === 'AbortError'
            ? 'The server took too long to respond. Your change may not have been saved: reload to check.'
            : 'Cannot reach the Attendance server. Check your connection and try again.');
        })
        .then(function (res) {
          if (timer) clearTimeout(timer);
          return res.text().then(function (text) {
            var json;
            try { json = JSON.parse(text); } catch (e) {
              throw AttendanceApiError('BAD_RESPONSE', 'The Attendance server returned an unexpected response (' + res.status + '). The web app may be misdeployed or not shared with "Anyone".');
            }
            if (!json || json.ok !== true) {
              var er = (json && json.error) || {};
              throw AttendanceApiError(er.code || 'INTERNAL_ERROR', er.message || 'The request failed.', er.details);
            }
            return json.data;
          });
        });
    }

    return {
      getMeta: function () { return call('meta'); },
      // -> {records, total_rows_in_sheet, problem_rows}
      listRecords: function (q) { return call('list', q || {}); },
      // record: {person, work_date, status, time_in, time_out, work_location, leave_type, remarks}.
      // Pass expectedVersion when editing a record you loaded; omit it only for a brand-new person/day.
      saveRecord: function (record, expectedVersion) { return call('save', { record: record, expected_version: expectedVersion == null ? null : expectedVersion }); },
      deleteRecord: function (person, workDate, expectedVersion) { return call('remove', { person: person, work_date: workDate, expected_version: expectedVersion }); }
    };
  }

  return { create: create, AttendanceApiError: AttendanceApiError };
});
