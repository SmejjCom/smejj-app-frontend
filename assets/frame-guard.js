// smejj.com — Klickjacking-Schutz (QA-Welle 1, Befund F-04).
//
// Warum ein eigenes Modul und nicht die CSP: Die Direktive `frame-ancestors`
// wirkt ausschliesslich als HTTP-Header. In einer <meta http-equiv>-CSP
// ignorieren Browser sie laut Spezifikation vollstaendig — und GitHub Pages Free
// kann keine eigenen Header setzen. Ein Inline-Skript scheidet ebenfalls aus, weil
// die CSP `script-src 'self'` erzwingt. Bleibt genau dieser Weg: ein kleines,
// eigenstaendiges Modul im Shell-Precache.
//
// Verhalten: Laeuft die Seite in einem fremden Rahmen, wird sie sofort aus dem
// Rahmen heraus auf die eigene Adresse geleitet. Ein Angreifer kann die Oberflaeche
// damit nicht mehr unsichtbar ueber eine eigene Seite legen und Klicks abfangen.
//
// Fail-safe statt fail-closed: Kann der Rahmenzustand nicht gelesen werden (in
// einem fremden Rahmen wirft der Zugriff auf top.location eine Sicherheitsausnahme),
// gilt die Seite als eingerahmt und bricht aus. Lieber einmal zu viel ausbrechen
// als eine abgefangene Sitzung.

function istEingerahmt() {
  try {
    return window.self !== window.top;
  } catch {
    // Zugriff verweigert = fremder Rahmen mit anderer Herkunft.
    return true;
  }
}

if (istEingerahmt()) {
  try {
    window.top.location.replace(window.location.href);
  } catch {
    // Der Rahmen laesst die Navigation nicht zu: Inhalt wenigstens leeren,
    // damit nichts Anklickbares stehen bleibt.
    document.documentElement.replaceChildren();
    window.location.replace("about:blank");
  }
}
