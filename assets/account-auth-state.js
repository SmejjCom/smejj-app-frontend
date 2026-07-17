// smejj.com — Zustandsrichtige Kontoseite.
//
// Problem (Betreiber-Befund 2026-07-17): Im Tab "Anmeldung & Sicherheit" waren
// ALLE Aktionen gleichzeitig sichtbar — vier abmelde-aehnliche Knoepfe und
// zusaetzlich Anmelde-Knoepfe, obwohl der Nutzer angemeldet war. Das ist eine
// Debug-Oberflaeche, kein Kontobereich.
//
// Regel hier: Zeige nur, was im aktuellen Zustand sinnvoll ist.
//   - angemeldet      -> genau EIN "Ausloggen", keine Anmelde-Knoepfe
//   - nicht angemeldet -> Anmelde-Wege, kein Ausloggen
//   - Server-Sitzungen (Passwort, Fern-Widerruf) NUR fuer E-Mail-Konten;
//     Google-/Passkey-Sitzungen sind zustandslos signiert und kennen das nicht.
//
// Nichts wird geloescht: Alle Bedienelemente bleiben im DOM und damit
// funktionsfaehig — sie werden nur zustandsabhaengig ein-/ausgeblendet.

const LOGIN_CONTROLS = ["#googleSignIn", "#passkeyLogin", "#passkeyRegister", "#loginLocal"];
const LOGOUT_CONTROLS = ["#logoutLocal"];
const EMAIL_ONLY_BLOCK = "#serverSessionsBlock";

// Wendet den Anmeldezustand auf die Kontoseite an.
// Input: view (Element), user (Auth-Objekt oder null). Output: void.
export function applyAuthState(view, user) {
  if (!view) return;
  const authenticated = Boolean(user);
  const method = String(user?.method || (user ? "google" : "")).toLowerCase();
  view.dataset.authState = authenticated ? "authenticated" : "anonymous";
  toggle(view, LOGIN_CONTROLS, !authenticated);
  toggle(view, LOGOUT_CONTROLS, authenticated);
  // Server-Sitzungsverwaltung ergibt nur fuer E-Mail-Konten Sinn.
  toggle(view, [EMAIL_ONLY_BLOCK], authenticated && method === "email");
}

function toggle(view, selectors, visible) {
  for (const selector of selectors) {
    const node = view.querySelector(selector);
    if (!node) continue;
    node.hidden = !visible;
    // Ein leerer Google-Container hat keine Hoehe, blockiert aber das Grid.
    node.style.display = visible ? "" : "none";
  }
}
