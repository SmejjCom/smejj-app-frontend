// smejj.com — Update-Hinweis v1152 (Geraetebefund 20.11.2026, Pixel 7 Pro): Der Hinweis „Neue Version verfügbar“ lag oben
// ueber der eigenen Frage und war im dunklen Design schlecht lesbar. Jetzt: kompakte Glas-Leiste UNTEN direkt ueber dem
// Eingabefeld; der Verlauf bekommt solange unten Platz (verdeckt keine Nachricht), Theme-Farben hell/dunkel (Kontrast AA),
// Schliessen-X, „Jetzt aktualisieren“ wie bisher (Entwurf bleibt). Erst bei Bedarf geladen (pwa-schnellstart.js),
// damit die Startseite nicht schwerer wird; die Stile bringt das Modul selbst mit (überschreiben die alte Regel).
const STIL_ID = "update-hinweis-stil";
export const UPDATE_HINWEIS_CSS = `
body #composerUpdateHinweis { position:fixed; top:auto; left:12px; right:12px; bottom:var(--uh-unten, calc(env(safe-area-inset-bottom, 0px) + 132px)); z-index:9998; display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; margin:0 auto; max-width:720px; box-sizing:border-box; padding:8px 44px 8px 14px; border-radius:16px; background:rgba(22,24,27,.94); -webkit-backdrop-filter:blur(18px) saturate(140%); backdrop-filter:blur(18px) saturate(140%); color:#f1f3f5; border:1px solid rgba(255,255,255,.14); box-shadow:0 6px 24px rgba(0,0,0,.35); font:14px/1.35 system-ui,-apple-system,sans-serif; }
body #composerUpdateHinweis .uh-text { flex:1 1 160px; min-width:0; }
body #composerUpdateHinweis .uh-jetzt { flex:0 1 auto; max-width:100%; min-height:40px; padding:8px 14px; border:0; border-radius:12px; background:#02fdfd; color:#04181a; font:600 14px/1.25 system-ui,-apple-system,sans-serif; white-space:normal; text-align:center; cursor:pointer; }
body #composerUpdateHinweis .uh-zu { position:absolute; top:4px; right:4px; width:36px; height:36px; border:0; border-radius:50%; background:transparent; color:inherit; font-size:18px; line-height:1; cursor:pointer; }
body #composerUpdateHinweis button:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
body[data-mobile-theme="light"] #composerUpdateHinweis.uh-leiste { background:rgba(255,255,255,.95); color:#16181b; border-color:rgba(0,0,0,.12); box-shadow:0 6px 24px rgba(0,0,0,.14); }
body[data-mobile-theme="light"] #composerUpdateHinweis.uh-leiste .uh-jetzt { background:#00585c; color:#ffffff; }
body.hat-update-hinweis #startLog { padding-bottom:calc(var(--uh-hoehe, 64px) + 16px); }
`;

function stil(doc) {
  if (doc.getElementById(STIL_ID)) return;
  const s = doc.createElement("style");
  s.id = STIL_ID;
  s.textContent = UPDATE_HINWEIS_CSS;
  doc.head.append(s);
}

/** Wertet den schlichten Hinweis aus pwa-schnellstart.js auf (Text + Knopf bleiben, Klick-Logik unverändert). */
export function verbessereUpdateHinweis(box, win = box?.ownerDocument?.defaultView || globalThis) {
  const doc = box?.ownerDocument;
  if (!doc?.body || !box.isConnected || box.classList.contains("uh-leiste")) return null;
  stil(doc);
  box.classList.add("uh-leiste");
  const button = box.querySelector("button");
  button?.classList.add("uh-jetzt");
  for (const knoten of [...box.childNodes]) {
    if (knoten.nodeType !== 3 || !knoten.textContent.trim()) continue;
    const text = doc.createElement("span"); text.className = "uh-text"; text.textContent = knoten.textContent.trim();
    knoten.replaceWith(text);
  }
  const zu = doc.createElement("button"); zu.type = "button"; zu.className = "uh-zu"; zu.textContent = "✕"; zu.setAttribute("aria-label", "Hinweis schließen");
  const lege = () => {
    const glas = doc.querySelector("#start.is-active .prompt-glass") || doc.querySelector(".prompt-glass");
    const oben = glas?.getBoundingClientRect?.().top;
    const hoehe = win.visualViewport?.height || win.innerHeight || 0;
    if (Number.isFinite(oben) && oben > 0 && hoehe > 0 && oben < hoehe) box.style.setProperty("--uh-unten", `${Math.round(hoehe - oben + 8)}px`);
    else box.style.removeProperty("--uh-unten");
    doc.documentElement.style.setProperty("--uh-hoehe", `${Math.round(box.getBoundingClientRect?.().height || 56)}px`);
  };
  const weg = () => {
    box.remove(); doc.body.classList.remove("hat-update-hinweis");
    win.removeEventListener?.("resize", lege); win.visualViewport?.removeEventListener?.("resize", lege);
  };
  zu.addEventListener("click", weg);
  box.append(zu);
  doc.body.classList.add("hat-update-hinweis");
  lege();
  win.addEventListener?.("resize", lege); win.visualViewport?.addEventListener?.("resize", lege);
  return box;
}
