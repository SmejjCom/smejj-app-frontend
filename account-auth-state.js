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

// --- Stil-Marke der Kontoseite -------------------------------------------
// Steht hier und NICHT in account-privacy.js, obwohl sie dorthin gehoert.
// Der Grund (Betreiber-Freigabe 2026-08-22, "Marke auslagern"):
// account-privacy.js liegt im ABO-LOCK und ist byte-genau eingefroren. Die
// CSS-Marke muss aber bei JEDER Aenderung an account-privacy.css steigen,
// sonst laedt ein offener Browser die alte Datei. Damit brach kuenftig jede
// Designarbeit am Kontobereich die Zahlungs-Sperre — und wer sie dann
// routinemaessig neu stempelt, gewoehnt sich genau das ab, wovor sie
// schuetzt. Gemessen am 2026-08-22: der Lock war rot, und der GESAMTE
// Unterschied zum eingefrorenen Stand war diese eine Zeile.
//
// Warum keine eigene Datei: die muesste in den sw.js-Precache, und sw.js
// liegt im Start-Lock — das waere eine zweite Sperre fuer denselben Zweck.
// Diese Datei ist ungesperrt, liegt bereits im Precache und wird von
// account-privacy.js ohnehin importiert.
//
// WICHTIG: Der Import drueben traegt bewusst KEIN ?v= mehr. Sonst muesste
// bei jeder Aenderung hier wieder die gesperrte Datei angefasst werden —
// dasselbe Problem, nur eine Ebene weiter. Frisch wird diese Datei ueber
// den Service-Worker-Vorrat (CACHE_NAME-Bump), wie autonomous-intent.js
// und die anderen markenlosen Module auch.
export const KONTO_STIL_MARKE = "v11-tokens-b50";

const LOGIN_CONTROLS = ["#googleSignIn", "#passkeyLogin", "#loginLocal"];
// "Passkey einrichten" gehoert NICHT zu den Anmelde-Wegen (Befund 2026-08-07):
// Das Einrichten verlangt serverseitig eine Sitzung — ohne sie antwortet
// /api/auth/passkey/register/options mit 401. Der Knopf stand aber in
// LOGIN_CONTROLS und war damit genau dann sichtbar, wenn er nicht funktionieren
// KANN, und ausgeblendet, sobald er funktioniert haette. Er ist unerreichbar
// gewesen: angemeldet unsichtbar, abgemeldet wirkungslos.
const ANGEMELDET_CONTROLS = ["#passkeyRegister"];
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
  toggle(view, ANGEMELDET_CONTROLS, authenticated);
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
