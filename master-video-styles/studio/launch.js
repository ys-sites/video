// "Open editor": find Masvid Studio on this PC and open it, or explain how to start it.
// The check runs only after a click, so Chrome's local-network permission prompt (if any)
// appears in response to the user's own action, never on page load.
(function () {
  'use strict';
  var box = document.getElementById('studio-launch');
  if (!box) return;
  var url = box.dataset.url, ping = box.dataset.ping;
  var btn = document.getElementById('ls-open');
  var status = document.getElementById('ls-status');
  var help = document.getElementById('ls-help');

  function check() {
    if (!ping) return Promise.resolve(true);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 3000);
    return fetch(ping, { mode: 'cors', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.ok); })
      .catch(function () { return false; })
      .then(function (ok) { clearTimeout(timer); return ok; });
  }

  btn.addEventListener('click', function () {
    btn.disabled = true;
    status.textContent = 'Looking for Masvid Studio on this PC…';
    help.hidden = true;
    check().then(function (ok) {
      btn.disabled = false;
      if (ok) {
        status.textContent = 'Found it. Opening…';
        window.location.href = url;
      } else {
        status.textContent = '';
        help.hidden = false;
      }
    });
  });
})();
