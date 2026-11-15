(function () {
  'use strict';
  // Live numbers from ChromieCraft's public API. If it does not answer, the section simply stays hidden.
  var api = String((window.IRONVAULT_CONFIG || {}).chromieApi || '').replace(/\/+$/, '');
  if (!api) return;
  var NAMES = [[1, 'Hardcore'], [2, 'Ironman'], [4, 'Bloodthirsty']];
  function label(mask) { return NAMES.filter(function (m) { return mask & m[0]; }).map(function (m) { return m[1]; }).join(' + '); }
  function show(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    var grid = document.getElementById('liveGrid');
    rows.filter(function (r) { return r.challenge >= 1 && r.challenge <= 7; })
      .sort(function (a, b) { return (+b.active || 0) - (+a.active || 0); })
      .forEach(function (r) {
        var d = document.createElement('div'), b = document.createElement('b'), s = document.createElement('span'), m = document.createElement('small');
        b.textContent = (+r.active || 0).toLocaleString('en');
        s.textContent = label(+r.challenge);
        m.textContent = (+r.completed || 0).toLocaleString('en') + ' completed · ' + (+r.dead || 0).toLocaleString('en') + ' fallen';
        d.appendChild(b); d.appendChild(s); d.appendChild(m); grid.appendChild(d);
      });
    if (grid.children.length) document.getElementById('live').hidden = false;
  }
  var key = 'ivcc:stats', hit = null;
  try { hit = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) {}
  if (hit && Date.now() - hit.t < 15 * 6e4) return show(hit.d);
  fetch(api + '/characters/challenge_modes/stats').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
    show(d);
  }).catch(function () {});
})();
