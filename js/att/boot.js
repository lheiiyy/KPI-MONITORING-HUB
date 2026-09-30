// Builds the service for a page from window.ATT_CONFIG. Not connected => in-memory adapter.
(function () {
  var A = window.ATT, c = window.ATT_CONFIG || {};
  var connected = !!(c.apiUrl && c.token);
  var adapter = connected ? A.adapters.sheets.create({ apiUrl: c.apiUrl, token: c.token, actor: c.actor }) : A.adapters.memory.create();
  A.connected = connected;
  A.service = A.service.create(adapter);
})();
