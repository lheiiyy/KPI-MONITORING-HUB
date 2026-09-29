/**
 * HTTP entry points. The web app is deployed "Execute as: Me / Access: Anyone",
 * so the URL itself is public: EVERY data call must carry a token, which is
 * verified here against SHA-256 hashes kept in Script Properties (never in the
 * repo, never in client code). See docs/ACTIVITY_API.md.
 *
 * Requests are POST with a JSON body sent as text/plain (avoids a CORS preflight,
 * which Apps Script cannot answer):  {action, token, ...params}
 * Responses: {ok:true,data} | {ok:false,error:{code,message,details}}
 */

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function authenticate_(token) {
  var raw = PropertiesService.getScriptProperties().getProperty('ACTIVITY_TOKENS');
  if (!raw) throw fail_('CONFIG_MISSING', 'API access is not configured yet. An administrator must run addActivityUser() in the Apps Script editor.');
  var users;
  try { users = JSON.parse(raw); } catch (e) { throw fail_('CONFIG_MISSING', 'ACTIVITY_TOKENS script property is corrupt.'); }
  if (isBlank_(token) || typeof token !== 'string') throw fail_('UNAUTHORIZED', 'An access token is required.');
  var u = users[sha256Hex_(token.trim())];
  if (!u) throw fail_('UNAUTHORIZED', 'The access token is not valid.');
  return { user: u.user, role: u.role === 'write' ? 'write' : 'read' };
}

var ACTIONS_ = {
  meta: function (c) { return getMeta(c); },
  list: function (c, p) { return listActivities(c, { include_archived: p.include_archived === true }); },
  get: function (c, p) { return getActivity(c, p.activity_id); },
  history: function (c, p) { return getActivityHistory(c, p.activity_id); },
  create: function (c, p) { return createActivity(c, p.activity); },
  update: function (c, p) { return updateActivity(c, p.activity_id, p.changes, p.expected_updated_at); },
  updateStatus: function (c, p) { return updateActivityStatus(c, p.activity_id, p.status, p.expected_updated_at); },
  updateProgress: function (c, p) { return updateActivityProgress(c, p.activity_id, p.progress_percent, p.expected_updated_at); },
  archive: function (c, p) { return archiveActivity(c, p.activity_id); },
  restore: function (c, p) { return restoreActivity(c, p.activity_id); }
};

/** Transport-independent dispatcher (unit-testable without ContentService). */
function handleRequest_(body) {
  try {
    if (!body || typeof body !== 'object') throw fail_('BAD_REQUEST', 'Request body must be a JSON object.');
    var handler = Object.prototype.hasOwnProperty.call(ACTIONS_, body.action) ? ACTIONS_[body.action] : null;
    if (!handler) throw fail_('BAD_REQUEST', 'Unknown action "' + body.action + '".');
    var ctx = authenticate_(body.token);
    return { ok: true, data: handler(ctx, body) };
  } catch (e) {
    if (!e.code) console.error(e && e.stack || e);   // unexpected: log server-side, hide internals
    return { ok: false, error: { code: e.code || 'INTERNAL_ERROR', message: e.code ? e.message : 'Unexpected server error. Nothing was saved.', details: e.details || null } };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = null;
  try { body = JSON.parse(e && e.postData && e.postData.contents || ''); } catch (err) {
    return json_({ ok: false, error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON.', details: null } });
  }
  return json_(handleRequest_(body));
}

/** Health check only - deliberately returns no data. */
function doGet() { return json_({ ok: true, data: { service: 'activity-api', api_version: API_VERSION } }); }
