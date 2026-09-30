// Typed errors so the UI can react to the cause (conflict -> reload, validation -> show messages).
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.ATT = root.ATT || {}; root.ATT.errors = m; }
})(typeof self !== 'undefined' ? self : this, function () {
  // code: VALIDATION | CONFLICT | NOT_FOUND | TRANSITION | AUTH | NETWORK | SERVER
  function AttError(code, message, details) {
    var e = new Error(message); e.name = 'AttError'; e.code = code; e.details = details || null; return e;
  }
  return { AttError: AttError };
});
