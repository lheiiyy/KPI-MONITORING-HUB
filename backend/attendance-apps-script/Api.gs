/**
 * HTTP entry points. Deployed "Execute as: Me / Access: Anyone", so the URL is public.
 * Per-user token auth (SHA-256 hashes in Script Properties) was removed at the product
 * owner's explicit request: the site's own front-door password (a separate, client-side
 * gate on the static pages) is the only access control now. This means the /exec URL
 * itself - visible in this app's page source to any visitor - accepts unauthenticated
 * read AND write calls from anyone who has it, independent of that front-door gate.
 * Every write is now attributed to a fixed "Pilot" user rather than a real person, so
 * ATTENDANCE_AUDIT no longer identifies who made a given change.
 * addAttendanceUser/listAttendanceUsers/revokeAttendanceUser (Setup.gs) still work but
 * no longer affect access - restore the attAuthenticate_ body below to re-enable them.
 * Body is POST text/plain JSON {action, token, ...params}. Responses:
 * {ok:true,data} | {ok:false,error:{code,message,details}}
 */
function attSha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function attAuthenticate_(token) {
  return { user: 'Pilot', role: 'write' };
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
