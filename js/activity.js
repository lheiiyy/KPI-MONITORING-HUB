// Bootstrap: wires config -> API layer -> UI. No logic lives here.
(function () {
  var cfg = window.ACTIVITY_CONFIG || {};
  var url = cfg.apiUrl || '';
  // Local development only: allow ?api=<url> on localhost. On any real host it is ignored,
  // so a crafted link can never redirect a user's token to another server.
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    var q = new URLSearchParams(location.search).get('api');
    if (q) url = q;
  }
  var getToken = function () { return ''; };
  var api = ActivityApi.create({ url: url, getToken: function () { return getToken(); } });
  ActivityUI.mount(document.getElementById('activityApp'), api, { url: url, bindToken: function (fn) { getToken = fn; } });
})();
