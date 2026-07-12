/* smejj.com — ui-modern.js (v1)
   Sicherheitsabfrage fuer gefaehrliche Aktionen.
   Greift NICHT in bestehende Funktionen ein: der Klick wird nur
   gestoppt, wenn der Nutzer die Abfrage ablehnt. */
(function () {
  "use strict";

  var guards = [
    ["projectDelete", "Projekt wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden."],
    ["clearLocal", "Alle lokalen Daten wirklich leeren? Diese Aktion kann nicht rückgängig gemacht werden."]
  ];

  function armGuards() {
    guards.forEach(function (guard) {
      var btn = document.getElementById(guard[0]);
      if (!btn || btn.dataset.guarded) return;
      btn.dataset.guarded = "true";
      btn.addEventListener(
        "click",
        function (event) {
          var menu = btn.closest("details.more-menu");
          if (!window.confirm(guard[1])) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
          if (menu) menu.open = false;
        },
        true
      );
    });
  }

  function closeMenusOnOutsideClick(event) {
    document.querySelectorAll("details.more-menu[open]").forEach(function (menu) {
      if (!menu.contains(event.target)) menu.open = false;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", armGuards);
  } else {
    armGuards();
  }
  document.addEventListener("click", closeMenusOnOutsideClick);
})();
