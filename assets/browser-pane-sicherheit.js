// smejj.com — Sicherheitsanzeige der Adressleiste, wie Chromes Schloss.
//
// WARUM DAS MEHR IST ALS EIN SYMBOL: Seit die Adresse gekuerzt angezeigt wird
// (kein "https://" mehr), fehlt dem Nutzer genau die Auskunft, die vorher im
// Text stand — ist diese Verbindung verschluesselt? Chrome loest das mit dem
// Zeichen links in der Leiste. Ohne es waere unser Kuerzen ein Rueckschritt:
// weniger Text UND weniger Wissen.
//
// Deshalb gilt hier die Umkehrung der ueblichen Logik: NICHT "sicher" wird
// betont, sondern "unsicher". Ein Schloss, das immer da ist, sieht niemand
// mehr; eine Warnung, die selten kommt, liest man.

export const ZUSTAende = Object.freeze({
  SICHER: "sicher",
  UNSICHER: "unsicher",
  INTERN: "intern",
  LEER: "leer"
});

/**
 * Welchen Zustand hat diese Adresse?
 * Reine Funktion, keine DOM-Beruehrung — direkt testbar.
 */
export function sicherheitsZustand(url) {
  const text = String(url || "").trim();
  if (!text) return ZUSTAende.LEER;
  if (/^https:\/\//i.test(text)) return ZUSTAende.SICHER;
  if (/^http:\/\//i.test(text)) return ZUSTAende.UNSICHER;
  // about:, data:, blob: und unsere eigenen Ansichten — keine Netzverbindung,
  // also weder sicher noch unsicher zu nennen.
  return ZUSTAende.INTERN;
}

const TEXTE = Object.freeze({
  [ZUSTAende.SICHER]: {
    kurz: "",
    titel: "Verbindung ist verschluesselt",
    hinweis: "Was du hier eingibst, kann unterwegs niemand mitlesen."
  },
  [ZUSTAende.UNSICHER]: {
    kurz: "Nicht sicher",
    titel: "Verbindung ist NICHT verschluesselt",
    hinweis: "Gib hier keine Passwoerter oder Zahlungsdaten ein — sie waeren unterwegs lesbar."
  },
  [ZUSTAende.INTERN]: {
    kurz: "",
    titel: "Interne Ansicht",
    hinweis: "Diese Seite kommt nicht aus dem Netz."
  },
  [ZUSTAende.LEER]: { kurz: "", titel: "", hinweis: "" }
});

export function sicherheitsText(zustand) {
  return TEXTE[zustand] || TEXTE[ZUSTAende.LEER];
}

const SYMBOLE = Object.freeze({
  // Geschlossenes Schloss.
  [ZUSTAende.SICHER]: '<path d="M6 10V7a6 6 0 0 1 12 0v3"/><rect x="4" y="10" width="16" height="11" rx="2"/>',
  // Warndreieck — bewusst eine andere FORM, nicht nur eine andere Farbe:
  // rund 8 % der Maenner sehen Rot und Gruen nicht auseinander.
  [ZUSTAende.UNSICHER]: '<path d="M12 3 1.5 21h21L12 3z"/><path d="M12 10v5"/><path d="M12 18h.01"/>',
  [ZUSTAende.INTERN]: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/>',
  [ZUSTAende.LEER]: ""
});

/**
 * Erzeugt den Knopf einmalig und haengt ihn VOR das Adressfeld.
 * Gibt das Element zurueck (oder null, wenn kein Formular da ist).
 */
export function baueSicherheitsKnopf(form) {
  if (!form) return null;
  const vorhanden = form.querySelector(".bp-sicherheit");
  if (vorhanden) return vorhanden;
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "bp-sicherheit";
  knopf.hidden = true;
  form.insertBefore(knopf, form.firstChild);
  return knopf;
}

/**
 * Setzt die Anzeige auf den Zustand der Adresse.
 * Wird bei jedem Zeichnen aufgerufen — deshalb idempotent und billig.
 */
export function zeigeSicherheit(form, url) {
  const knopf = baueSicherheitsKnopf(form);
  if (!knopf) return null;
  const zustand = sicherheitsZustand(url);
  const { kurz, titel, hinweis } = sicherheitsText(zustand);

  if (zustand === ZUSTAende.LEER) {
    knopf.hidden = true;
    return zustand;
  }
  knopf.hidden = false;
  knopf.dataset.zustand = zustand;
  knopf.title = `${titel}\n${hinweis}`;
  knopf.setAttribute("aria-label", `${titel}. ${hinweis}`);
  knopf.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${SYMBOLE[zustand]}</svg>`;
  if (kurz) {
    const text = document.createElement("span");
    text.className = "bp-sicherheit-text";
    text.textContent = kurz;
    knopf.appendChild(text);
  }
  return zustand;
}

// --- Zoom-Anzeige -------------------------------------------------------------
//
// Chrome zeigt eine abweichende Zoomstufe DAUERHAFT in der Adressleiste an,
// und ein Klick stellt 100 % wieder her. Bei uns stand sie nur kurz in der
// Hinweiszeile und verschwand dann — wer eine Seite auf 150 % gestellt hat
// und spaeter zurueckkommt, sieht keinen Grund mehr fuer die grosse Schrift
// und haelt es fuer einen Fehler der Seite.
//
// Sichtbar nur bei Abweichung: eine Anzeige, die immer "100 %" sagt, ist
// Rauschen.

export function zeigeZoom(form, zoom, aufKlick = null) {
  if (!form) return null;
  let knopf = form.querySelector(".bp-zoom");
  if (!knopf) {
    knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "bp-zoom";
    // Vor den Stern haengen, damit die Reihenfolge stabil bleibt.
    const stern = form.querySelector(".bp-stern");
    if (stern) form.insertBefore(knopf, stern); else form.appendChild(knopf);
    knopf.addEventListener("click", (event) => {
      event.preventDefault();
      if (typeof aufKlick === "function") aufKlick();
    });
  }
  const prozent = Math.round((Number(zoom) || 1) * 100);
  // Die Klasse sitzt am FORMULAR, nicht am Feld: Das Zeichen steht im DOM
  // NACH dem Eingabefeld, deshalb kann eine Geschwister-Regel (~) es nicht
  // erreichen. Gemessen — der Text lief sonst unter die Anzeige.
  form.classList.toggle("hat-zoom", prozent !== 100);
  if (prozent === 100) {
    knopf.hidden = true;
    return null;
  }
  knopf.hidden = false;
  knopf.textContent = `${prozent} %`;
  const text = `Zoom ${prozent} % — klicken fuer 100 %`;
  knopf.title = text;
  knopf.setAttribute("aria-label", text);
  return prozent;
}

// --- Neu laden / Stopp --------------------------------------------------------
//
// Derselbe Knopf, zwei Bedeutungen — wie in Chrome. Waehrend des Ladens ein
// Kreuz zum Abbrechen, sonst der Kreispfeil. Ein Knopf, dessen Beschriftung
// NICHT mitwandert, ist eine Falle: man klickt "neu laden" und bricht ab.
//
// Liegt bei den anderen Leisten-Anzeigen, weil es dasselbe Muster ist:
// ein Zeichen, das den Zustand spiegelt.
export function zeigeNeuladen(knopf, laedt) {
  if (!knopf) return;
  const text = laedt ? "Laden abbrechen" : "Neu laden";
  knopf.title = text;
  knopf.setAttribute("aria-label", text);
  knopf.innerHTML = laedt
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3v4h-4"/></svg>';
}
