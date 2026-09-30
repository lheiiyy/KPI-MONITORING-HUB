/** Business operations. Writes are serialised by Api.gs with LockService. */

function attToday_(ss) { return Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }
function attRequireWrite_(ctx) { if (ctx.role !== 'write') throw attFail_('FORBIDDEN', 'This access token is read-only.'); }

function attMeta_(ctx) {
  var ss = attSpreadsheet_();
  function opts(name) { return ATT_ENUMS[name].map(function (p) { return { code: p[0], label: p[1] }; }); }
  return { api_version: ATT_API_VERSION, user: ctx.user, role: ctx.role, today: attToday_(ss),
    team_members: attTeamRoster_(ss), statuses: opts('status'), work_locations: opts('work_location'), leave_types: opts('leave_type'),
    vocabulary_warnings: attVocabularyWarnings_(ss) };
}

/** params: {from?, to?, person?}. An empty sheet returns zero records; nothing is invented. */
function attList_(ctx, p) {
  var t = attTable_(attSpreadsheet_()), all = attAllRecords_(t), from = p.from ? attParseDate_(p.from) : null, to = p.to ? attParseDate_(p.to) : null;
  if ((p.from && !from) || (p.to && !to)) throw attFail_('VALIDATION_ERROR', 'from/to must be dates (yyyy-mm-dd).');
  var key = p.person ? attPersonKey_(p.person) : null;
  var recs = all.filter(function (o) {
    if (from && (!o.work_date || o.work_date < from)) return false;
    if (to && (!o.work_date || o.work_date > to)) return false;
    if (key && attPersonKey_(o.person) !== key) return false;
    return true;
  });
  return { records: recs, total_rows_in_sheet: all.length, problem_rows: recs.filter(function (o) { return o.problems.length; }).length };
}

/** params: {record, expected_version?, expect_new?}. Never overwrites a row the caller has not seen. */
function attSave_(ctx, p) {
  attRequireWrite_(ctx);
  var rec = attValidateRecord_(p.record), ss = attSpreadsheet_(), who = attCanonicalName_(ss, rec.person);
  rec.person = who.name;
  var t = attTable_(ss), existing = attFindRow_(t, rec.person, rec.work_date);
  if (existing) {
    if (attBlank_(p.expected_version)) throw attFail_('CONFLICT', 'A record for ' + rec.person + ' on ' + rec.work_date + ' already exists. Reload it before changing it.');
    if (p.expected_version !== existing.version) throw attFail_('CONFLICT', 'This record was changed by someone else. Reload it and try again.');
  } else if (!attBlank_(p.expected_version)) {
    throw attFail_('NOT_FOUND', 'That record no longer exists. Reload.');
  }
  var rowN = attWriteRecord_(t, existing, rec, who.position);
  var saved = attRowToRecord_(attTable_(ss), rowN - 1);
  attAudit_(ss, ctx.user, existing ? 'UPDATE' : 'CREATE', rec.person, rec.work_date, existing, saved);
  return saved;
}

/** params: {person, work_date, expected_version}. */
function attDelete_(ctx, p) {
  attRequireWrite_(ctx);
  var date = attParseDate_(p.work_date); if (!date || attBlank_(p.person)) throw attFail_('VALIDATION_ERROR', 'person and work_date are required.');
  var ss = attSpreadsheet_(), t = attTable_(ss), existing = attFindRow_(t, p.person, date);
  if (!existing) throw attFail_('NOT_FOUND', 'No such attendance record.');
  if (attBlank_(p.expected_version) || p.expected_version !== existing.version) throw attFail_('CONFLICT', 'This record was changed by someone else. Reload it and try again.');
  attDeleteRow_(t, existing.row);
  attAudit_(ss, ctx.user, 'DELETE', existing.person, date, existing, null);
  return { deleted: true };
}
