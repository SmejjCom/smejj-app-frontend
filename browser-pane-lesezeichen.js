// smejj.com — Lesezeichen-Stern in der Adressleiste, wie in Chrome.
//
// Chrome setzt den Stern rechts IN die Adressleiste: ein Klick merkt sich die
// Seite, ein zweiter nimmt sie zurueck. Gefuellt heisst gemerkt.
//
// Bewusst klein gehalten: kein Ordnerbaum, keine Lesezeichenleiste, kein
// Import aus anderen Browsern. Wer eine Seite wiederfinden will, braucht
// zuerst genau eine Sache — sie mit einem Klick merken zu koennen. Alles
// Weitere kann folgen, wenn es jemand vermisst.
//
// Der Speicher wird hineingereicht, damit dieses Modul ohne Browser testbar
// ist und spaeter ohne Umbau auf die Konto-Ablage umgestellt werden kann.

const SCHLUESSEL = "smejj.browser.lesezeichen.v1";
export const MAX_LESEZEICHEN = 200;

const STERN_VOLL = '<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" fill="currentColor"/>';
const STERN_LEER = '<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z"/>';

/** Adresse auf ihre vergleichbare Form bringen (Schraegstrich am Ende egal). */
export function schluesselFuer(url) {
  return String(url || "").trim().replace(/\/$/, "").toLowerCase();
}

export function ladeLesezeichen(speicher = globalThis.localStorage) {
  try {
    const roh = speicher?.getItem(SCHLUESSEL);
    const liste = roh ? JSON.parse(roh) : [];
    return Array.isArray(liste) ? liste.filter((e) => e && typeof e.url === "string") : [];
  } catch {
    // Gesperrter oder beschaedigter Speicher darf das Panel nie aufhalten.
    return [];
  }
}

export function speichereLesezeichen(liste, speicher = globalThis.localStorage) {
  try {
    speicher?.setItem(SCHLUESSEL, JSON.stringify(liste.slice(0, MAX_LESEZEICHEN)));
    return true;
  } catch {
    return false;
  }
}

export function istGemerkt(url, liste) {
  const s = schluesselFuer(url);
  return Boolean(s) && (liste || []).some((e) => schluesselFuer(e.url) === s);
}

/**
 * Merken oder Vergessen — gibt die NEUE Liste und den neuen Zustand zurueck.
 * Reine Rechnung; der Aufrufer entscheidet ueber das Speichern.
 */
export function umschalten(url, titel, liste) {
  const s = schluesselFuer(url);
  if (!s) return { liste: liste || [], gemerkt: false };
  const ohne = (liste || []).filter((e) => schluesselFuer(e.url) !== s);
  if (ohne.length !== (liste || []).length) return { liste: ohne, gemerkt: false };
  // Neueste zuerst — beim Wiederfinden sucht man fast immer das Letzte.
  return {
    liste: [{ url: String(url), titel: String(titel || url) }, ...ohne].slice(0, MAX_LESEZEICHEN),
    gemerkt: true
  };
}

/**
 * Zeichnet den Stern in die Adressleiste und haelt ihn aktuell.
 * Wird bei jedem Zeichnen aufgerufen — idempotent.
 */
export function zeigeLesezeichen(form, url, titel = "", speicher = globalThis.localStorage) {
  if (!form) return null;
  let knopf = form.querySelector(".bp-stern");
  if (!knopf) {
    knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "bp-stern";
    form.appendChild(knopf);
    knopf.addEventListener("click", (event) => {
      event.preventDefault();
      const jetzt = knopf.dataset.url || "";
      if (!jetzt) return;
      const { liste, gemerkt } = umschalten(jetzt, knopf.dataset.titel || "", ladeLesezeichen(speicher));
      speichereLesezeichen(liste, speicher);
      male(knopf, gemerkt);
    });
  }
  if (!String(url || "").trim()) {
    knopf.hidden = true;
    return null;
  }
  knopf.hidden = false;
  knopf.dataset.url = url;
  knopf.dataset.titel = titel;
  const gemerkt = istGemerkt(url, ladeLesezeichen(speicher));
  male(knopf, gemerkt);
  return gemerkt;
}

function male(knopf, gemerkt) {
  knopf.dataset.gemerkt = gemerkt ? "ja" : "nein";
  // Der Text sagt, was ein Klick TUT — nicht, wie der Zustand heisst.
  const text = gemerkt ? "Aus Lesezeichen entfernen" : "Als Lesezeichen merken";
  knopf.title = text;
  knopf.setAttribute("aria-label", text);
  knopf.setAttribute("aria-pressed", String(gemerkt));
  knopf.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${gemerkt ? STERN_VOLL : STERN_LEER}</svg>`;
}
