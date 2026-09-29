// Small DOM helpers shared by the scheduling pages. Text is always set via textContent /
// value, never innerHTML, because session and attendance data is user-entered.
(function () {
  var A = (window.ATT = window.ATT || {});
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function options(list, blankLabel, selected) {
    var out = blankLabel != null ? [el('option', { value: '', text: blankLabel })] : [];
    list.forEach(function (o) { out.push(el('option', { value: o.code, text: o.label, selected: o.code === selected })); });
    return out;
  }
  function toast(msg, isErr) {
    var box = document.getElementById('toasts'); if (!box) return;
    var t = el('div', { class: 'toast' + (isErr ? ' err' : ''), role: isErr ? 'alert' : 'status', text: msg });
    box.appendChild(t); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, isErr ? 7000 : 3500);
  }
  function banner(node) {
    node.className = 'banner ' + (A.connected ? 'live' : 'off');
    node.textContent = A.connected
      ? 'Connected: changes are saved to the Google Sheets pilot data source.'
      : 'Not connected to the data source: you can try everything, but nothing is saved and it is lost on reload. Set apiUrl and token in js/att/config.js (see apps-script/README.md).';
  }
  function fail(e) { toast((e && e.message) || 'Something went wrong.', true); }
  A.ui = { el: el, options: options, toast: toast, banner: banner, fail: fail };
})();
