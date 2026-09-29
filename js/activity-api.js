// Data-access layer for the Activity module. The UI talks ONLY to this object;
// nothing here (or in the UI) knows about spreadsheets, rows or columns. To move
// to PostgreSQL, keep this contract and re-point `url` at the new service.
// Contract: docs/ACTIVITY_API.md
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ActivityApi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function ActivityApiError(code, message, details) {
    var e = new Error(message);
    e.name = 'ActivityApiError'; e.code = code; e.details = details || null;
    return e;
  }

  // opts: {url, getToken():string, fetchImpl?, timeoutMs?}
  function create(opts) {
    var doFetch = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    var timeoutMs = opts.timeoutMs || 25000;

    function call(action, params) {
      if (!opts.url) return Promise.reject(ActivityApiError('CONFIG_MISSING', 'The Activity API is not configured. Set apiUrl in js/activity-config.js.'));
      var token = opts.getToken && opts.getToken();
      if (!token) return Promise.reject(ActivityApiError('UNAUTHORIZED', 'Enter your access token to continue.'));
      var body = JSON.stringify(Object.assign({ action: action, token: token }, params || {}));
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs) : null;
      // text/plain keeps this a "simple" request: Apps Script cannot answer CORS preflights.
      return doFetch(opts.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow', signal: ctl ? ctl.signal : undefined })
        .catch(function (err) {
          if (timer) clearTimeout(timer);
          throw ActivityApiError('BACKEND_UNAVAILABLE', err && err.name === 'AbortError'
            ? 'The server took too long to respond. Your change may not have been saved - refresh to check.'
            : 'Cannot reach the Activity server. Check your connection and try again.');
        })
        .then(function (res) {
          if (timer) clearTimeout(timer);
          return res.text().then(function (text) {
            var json;
            try { json = JSON.parse(text); } catch (e) {
              throw ActivityApiError('BAD_RESPONSE', 'The Activity server returned an unexpected response (' + res.status + '). The web app may be misdeployed or not shared correctly.');
            }
            if (!json || json.ok !== true) {
              var er = (json && json.error) || {};
              throw ActivityApiError(er.code || 'INTERNAL_ERROR', er.message || 'The request failed.', er.details);
            }
            return json.data;
          });
        });
    }

    return {
      getMeta: function () { return call('meta'); },
      listActivities: function (o) { return call('list', { include_archived: !!(o && o.includeArchived) }); },
      getActivity: function (id) { return call('get', { activity_id: id }); },
      getActivityHistory: function (id) { return call('history', { activity_id: id }); },
      createActivity: function (activity) { return call('create', { activity: activity }); },
      updateActivity: function (id, changes, expectedUpdatedAt) { return call('update', { activity_id: id, changes: changes, expected_updated_at: expectedUpdatedAt }); },
      updateActivityStatus: function (id, status, expectedUpdatedAt) { return call('updateStatus', { activity_id: id, status: status, expected_updated_at: expectedUpdatedAt }); },
      updateActivityProgress: function (id, pct, expectedUpdatedAt) { return call('updateProgress', { activity_id: id, progress_percent: pct, expected_updated_at: expectedUpdatedAt }); },
      archiveActivity: function (id) { return call('archive', { activity_id: id }); },
      restoreActivity: function (id) { return call('restore', { activity_id: id }); }
    };
  }

  return { create: create, ActivityApiError: ActivityApiError };
});
