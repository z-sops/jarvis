'use strict';
// Moves the Activity list (its heading and the list) from the Status panel to the crew panel on the left.
// It only moves existing elements, so everything that writes to #activity keeps working. Safe to run again.
(function () {
  function move() {
    try {
      var crew = document.querySelector('.panel.crew'), act = document.getElementById('activity');
      if (!crew || !act || (act.parentElement && act.parentElement.classList.contains('act-box'))) return;
      var box = document.createElement('div'); box.className = 'act-box';
      var head = act.previousElementSibling;
      if (!(head && head.classList.contains('ph'))) { head = document.createElement('div'); head.className = 'ph sub'; var h = document.createElement('h3'); h.textContent = 'Activity'; head.appendChild(h); }
      box.appendChild(head); box.appendChild(act); crew.appendChild(box);
    } catch (e) { /* the layout is optional */ }
  }
  document.addEventListener('DOMContentLoaded', move); window.addEventListener('load', move);
  [300, 1200, 3500].forEach(function (ms) { setTimeout(move, ms); });
})();
