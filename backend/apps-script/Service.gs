/**
 * Activity service - business rules. Signatures mirror docs/ACTIVITY_API.md.
 * `ctx` = {user, role} resolved from the API token by Api.gs.
 */

var SYSTEM_FIELDS_ = ACTIVITY_COLUMNS.filter(function (c) { return c.mutable === false; }).map(function (c) { return c.name; });
var EDITABLE_FIELDS_ = ACTIVITY_COLUMNS.filter(function (c) { return c.mutable !== false; }).map(function (c) { return c.name; });

function requireWrite_(ctx) {
  if (!ctx || ctx.role !== 'write') throw fail_('FORBIDDEN', 'Your access token is read-only.');
}

function pub_(rec) {
  var out = {};
  ACTIVITY_COLUMNS.forEach(function (c) { out[c.name] = rec[c.name]; });
  out.is_archived = rec.archived_at !== '';
  return out;
}

function findOrFail_(loaded, id) {
  for (var i = 0; i < loaded.rows.length; i++) if (loaded.rows[i].rec.activity_id === id) return loaded.rows[i];
  throw fail_('NOT_FOUND', 'Activity "' + id + '" was not found.');
}

function nextActivityId_(loaded) {
  var props = PropertiesService.getScriptProperties();
  var taken = {};
  loaded.rows.forEach(function (r) { taken[r.rec.activity_id] = true; });
  var seq = Number(props.getProperty('ACTIVITY_SEQ')) || loaded.rows.length;
  var id;
  do { seq++; id = 'ACT-' + ('000000' + seq).slice(-6); } while (taken[id]);
  props.setProperty('ACTIVITY_SEQ', String(seq));
  return id;
}

function getMeta(ctx) {
  var refs = loadRefs_();
  return {
    api_version: API_VERSION,
    user: ctx.user, role: ctx.role, today: todayIso_(), timezone: tz_(),
    statuses: ACTIVITY_STATUSES, priorities: ACTIVITY_PRIORITIES,
    people: refs.lists.PERSON, brands: refs.lists.BRAND, activity_types: refs.lists.ACTIVITY_TYPE, kpis: refs.lists.KPI,
    limits: { progress_min: 0, progress_max: 100 }
  };
}

function listActivities(ctx, opts) {
  opts = opts || {};
  var rows = loadActivityRows_().rows.map(function (r) { return pub_(r.rec); });
  if (!opts.include_archived) rows = rows.filter(function (r) { return !r.is_archived; });
  return rows;
}

function getActivity(ctx, id) {
  return pub_(findOrFail_(loadActivityRows_(), id).rec);
}

function createActivity(ctx, input) {
  requireWrite_(ctx);
  input = input || {};
  var illegal = Object.keys(input).filter(function (k) { return k !== 'activity_id' && EDITABLE_FIELDS_.indexOf(k) < 0; });
  if (illegal.length) throw fail_('UNKNOWN_FIELD', 'Field(s) not accepted on create: ' + illegal.join(', '));
  return withLock_(function () {
    var loaded = loadActivityRows_(), refs = loadRefs_().byType, now = nowIso_();
    var draft = {};
    EDITABLE_FIELDS_.forEach(function (f) { draft[f] = input[f]; });
    if (isBlank_(draft.status)) draft.status = 'BACKLOG';
    if (isBlank_(draft.priority)) draft.priority = 'MEDIUM';
    if (String(draft.status).toUpperCase() === 'COMPLETED') {
      if (isBlank_(draft.completed_date)) draft.completed_date = todayIso_();
      draft.progress_percent = 100;
    }
    var v = validateActivity_(draft, refs);
    throwIfInvalid_(v);
    var rec = v.record;

    if (!isBlank_(input.activity_id)) {
      var wanted = String(input.activity_id).trim().toUpperCase();
      if (!ID_PATTERN_.test(wanted)) throw fail_('VALIDATION_ERROR', 'activity_id must be 3-40 characters: A-Z, 0-9, "_" or "-".', [{ field: 'activity_id', message: 'invalid format' }]);
      if (loaded.rows.some(function (r) { return r.rec.activity_id === wanted; })) throw fail_('DUPLICATE_ID', 'Activity ID "' + wanted + '" already exists.');
      rec.activity_id = wanted;
    } else {
      rec.activity_id = nextActivityId_(loaded);
    }
    rec.status_changed_at = now; rec.archived_at = ''; rec.archived_by = '';
    rec.created_at = now; rec.created_by = ctx.user; rec.updated_at = now; rec.updated_by = ctx.user;
    writeActivityRecord_(loaded, rec, null);
    appendHistory_([hist_(rec.activity_id, now, ctx, 'CREATE', '', '', rec.status)]);
    return pub_(rec);
  });
}

function hist_(id, at, ctx, action, field, oldV, newV) {
  return { history_id: 'HIS-' + Utilities.getUuid().slice(0, 8).toUpperCase(), activity_id: id, changed_at: at,
    changed_by: ctx.user, action: action, field: field, old_value: oldV === undefined ? '' : String(oldV), new_value: newV === undefined ? '' : String(newV) };
}

/** Core PATCH. `changes` may only contain editable fields. */
function updateActivity(ctx, id, changes, expectedUpdatedAt) {
  requireWrite_(ctx);
  changes = changes || {};
  var keys = Object.keys(changes);
  keys.forEach(function (k) {
    if (SYSTEM_FIELDS_.indexOf(k) >= 0) throw fail_('IMMUTABLE_FIELD', 'Field "' + k + '" is system-managed and cannot be changed.');
    if (EDITABLE_FIELDS_.indexOf(k) < 0) throw fail_('UNKNOWN_FIELD', 'Unknown field "' + k + '".');
  });
  return withLock_(function () {
    var loaded = loadActivityRows_(), refs = loadRefs_().byType, now = nowIso_();
    var target = findOrFail_(loaded, id), before = target.rec;
    if (before.archived_at !== '') throw fail_('ARCHIVED', 'Activity "' + id + '" is archived. Restore it before editing.');
    if (expectedUpdatedAt && expectedUpdatedAt !== before.updated_at) {
      throw fail_('CONFLICT', 'This activity was changed by someone else. Reload and try again.', { current_updated_at: before.updated_at });
    }
    var draft = {};
    EDITABLE_FIELDS_.forEach(function (f) { draft[f] = (f in changes) ? changes[f] : before[f]; });
    var newStatus = isBlank_(draft.status) ? '' : String(draft.status).toUpperCase();
    var statusChanged = keys.indexOf('status') >= 0 && newStatus !== before.status;
    if (statusChanged) {
      if (newStatus === 'COMPLETED') {
        if (isBlank_(changes.completed_date)) draft.completed_date = todayIso_();
        draft.progress_percent = 100;
      } else if (before.status === 'COMPLETED' && !('completed_date' in changes)) {
        draft.completed_date = '';
      }
    }
    var v = validateActivity_(draft, refs);
    throwIfInvalid_(v);
    var rec = v.record;
    SYSTEM_FIELDS_.forEach(function (f) { rec[f] = before[f]; });
    var diffs = EDITABLE_FIELDS_.filter(function (f) { return String(rec[f]) !== String(before[f]); });
    if (!diffs.length) return pub_(before);
    rec.updated_at = now; rec.updated_by = ctx.user;
    if (statusChanged) rec.status_changed_at = now;
    writeActivityRecord_(loaded, rec, target.row);
    appendHistory_(diffs.map(function (f) { return hist_(id, now, ctx, f === 'status' ? 'STATUS' : 'UPDATE', f, before[f], rec[f]); }));
    return pub_(rec);
  });
}

function updateActivityStatus(ctx, id, status, expectedUpdatedAt) {
  if (isBlank_(status) || statusCodes_().indexOf(String(status).toUpperCase()) < 0) {
    throw fail_('VALIDATION_ERROR', 'status must be one of: ' + statusCodes_().join(', '), [{ field: 'status', message: 'invalid status' }]);
  }
  return updateActivity(ctx, id, { status: String(status).toUpperCase() }, expectedUpdatedAt);
}

function updateActivityProgress(ctx, id, progress, expectedUpdatedAt) {
  return updateActivity(ctx, id, { progress_percent: progress }, expectedUpdatedAt);
}

/** Soft delete. Physical deletion is deliberately not offered. */
function archiveActivity(ctx, id) {
  requireWrite_(ctx);
  return withLock_(function () {
    var loaded = loadActivityRows_(), now = nowIso_();
    var t = findOrFail_(loaded, id), rec = t.rec;
    if (rec.archived_at !== '') return pub_(rec);
    rec.archived_at = now; rec.archived_by = ctx.user; rec.updated_at = now; rec.updated_by = ctx.user;
    writeActivityRecord_(loaded, rec, t.row);
    appendHistory_([hist_(id, now, ctx, 'ARCHIVE', '', '', '')]);
    return pub_(rec);
  });
}

function restoreActivity(ctx, id) {
  requireWrite_(ctx);
  return withLock_(function () {
    var loaded = loadActivityRows_(), now = nowIso_();
    var t = findOrFail_(loaded, id), rec = t.rec;
    if (rec.archived_at === '') return pub_(rec);
    rec.archived_at = ''; rec.archived_by = ''; rec.updated_at = now; rec.updated_by = ctx.user;
    writeActivityRecord_(loaded, rec, t.row);
    appendHistory_([hist_(id, now, ctx, 'RESTORE', '', '', '')]);
    return pub_(rec);
  });
}

function getActivityHistory(ctx, id) {
  findOrFail_(loadActivityRows_(), id);
  return loadHistory_(id).sort(function (a, b) { return a.changed_at < b.changed_at ? 1 : -1; });
}
