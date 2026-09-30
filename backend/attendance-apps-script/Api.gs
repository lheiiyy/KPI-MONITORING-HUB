/**
 * HTTP entry points. Deployed "Execute as: Me / Access: Anyone", so the URL is public and EVERY data call must
 * carry a per-user token, verified against SHA-256 hashes kept in Script Properties (never in the repo, never in
 * client code). This is the same model as the Activity module. Body is POST text/plain JSON {action, token, ...params}.
 * Responses: {ok:true,data} | {ok:false,error:{code,message,details}}
 */
function attSha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function attAuthenticate_(token) {
  var raw = PropertiesService.getScriptProperties().getProperty('ATTENDANCE_TOKENS');
  if (!raw) throw attFail_('CONFIG_MISSING', 'API access is not configured yet. An administrator must run addAttendanceUser() in the Apps Script editor.');
  var users;
  try { users = JSON.parse(raw); } catch (e) { throw attFail_('CONFIG_MISSING', 'ATTENDANCE_TOKENS script property is corrupt.'); }
  if (attBlank_(token) || typeof token !== 'string') throw attFail_('UNAUTHORIZED', 'An access token is required.');
  var u = users[attSha256Hex_(token.trim())];
  if (!u) throw attFail_('UNAUTHORIZED', 'The access token is not valid.');
  return { user: u.user, role: u.role === 'write' ? 'write' : 'read' };
}

var ATT_ACTIONS = {
  meta:   { write: false, run: function (c) { return attMeta_(c); } },
  list:   { write: false, run: function (c, b) { return attList_(c, b); } },
  save:   { write: true,  run: function (c, b) { return attSave_(c, b); } },
  remove: { write: true,  run: function (c, b) { return attDelete_(c, b); } }
};

/** Transport-independent dispatcher (unit-testable without ContentService). */
function attHandleRequest_(body) {
  var lock = null;
  try {
    if (!body || typeof body !== 'object') throw attFail_('BAD_REQUEST', 'Request body must be a JSON object.');
    var a = Object.prototype.hasOwnProperty.call(ATT_ACTIONS, body.action) ? ATT_ACTIONS[body.action] : null;
    if (!a) throw attFail_('BAD_REQUEST', 'Unknown action "' + body.action + '".');
    var ctx = attAuthenticate_(body.token);
    if (a.write) {
      lock = LockService.getScriptLock();
      try { lock.waitLock(20000); } catch (e) { lock = null; throw attFail_('BUSY', 'The attendance sheet is busy. Try again in a moment.'); }
    }
    return { ok: true, data: a.run(ctx, body) };
  } catch (e) {
    if (!e.code) console.error(e && e.stack || e);
    return { ok: false, error: { code: e.code || 'INTERNAL_ERROR', message: e.code ? e.message : 'Unexpected server error. Nothing was saved.', details: e.details || null } };
  } finally { if (lock) lock.releaseLock(); }
}

function attJson_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  var body = null;
  try { body = JSON.parse(e && e.postData && e.postData.contents || ''); } catch (err) {
    return attJson_({ ok: false, error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON.', details: null } });
  }
  return attJson_(attHandleRequest_(body));
}

/** Health check only - deliberately returns no data. */
function doGet() { return attJson_({ ok: true, data: { service: 'attendance-api', api_version: ATT_API_VERSION } }); }
