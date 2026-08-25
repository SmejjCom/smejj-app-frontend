// smejj.com — PWA-Schnellstarts (Manifest-Shortcuts, 25.08.).
//
// Android/Chrome zeigt beim App-Icon Langdruck die Manifest-Shortcuts. Damit
// "Neuer Chat" und "Sprachmodus" ECHTE Funktionen sind (keine Attrappen,
// Regel des Projekts), setzt dieses Modul die Startparameter um:
//   /?neu=1       -> neue Unterhaltung beginnen
//   /?sprechen=1  -> Sprachmodus oeffnen (klickt den echten Knopf)
// Fail-safe: fehlt etwas (abgemeldet, Knopf nie da), passiert nichts weiter;
// der Parameter wird immer aus der Adresse geputzt, damit ein Reload ihn
// nicht wiederholt.
const params = new URLSearchParams(location.search);
const willNeu = params.get("neu") === "1";
const willSprechen = params.get("sprechen") === "1";

if (willNeu || willSprechen) {
  params.delete("neu");
  params.delete("sprechen");
  const rest = params.toString();
  history.replaceState(history.state, "", location.pathname + (rest ? "?" + rest : "") + location.hash);

  if (willNeu) {
    // Dieselbe Modul-Kennung wie ueberall — sonst zweite Instanz (Waechter).
    import("/assets/chat-store.js?v=b64")
      .then((m) => m.newChat?.())
      .catch(() => { /* nicht angemeldet oder Modul fehlt: Start bleibt Start */ });
  }
  if (willSprechen) {
    let versuche = 0;
    const takt = setInterval(() => {
      versuche += 1;
      const knopf = document.querySelector('button[aria-label="Sprachmodus starten"]');
      if (knopf) { clearInterval(takt); knopf.click(); return; }
      if (versuche > 40) clearInterval(takt); // ~8 s, dann aufgeben
    }, 200);
  }
}
