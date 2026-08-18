// smejj.com — Adressvorschlaege wie Chromes Omnibox.
//
// Chrome schlaegt beim Tippen aus dem Verlauf vor und hebt die erste Zeile
// hervor; Enter nimmt sie, Pfeiltasten wechseln, Escape schliesst. Unser
// Panel hatte davon nichts: getippt wurde blind, jede Adresse jedes Mal ganz.
//
// Bewusst NICHT uebernommen: Chrome fragt beim Tippen eine Suchmaschine nach
// Vorschlaegen. Das hiesse, jeden Tastendruck an einen Dritten zu senden —
// dafuer gibt es hier keinen Anlass und keine Einwilligung. Vorgeschlagen
// wird nur, was der Nutzer selbst schon besucht hat.
//
// SRP: reine Datenlogik plus eine schlanke Liste. Kein Netzwerk, kein
// Speicher — der Verlauf wird hineingereicht.

export const MAX_VORSCHLAEGE = 6;

/**
 * Passt ein Verlaufseintrag zur Eingabe?
 * Chrome gewichtet Treffer am Hostanfang hoeher als irgendwo im Pfad — das
 * ist der Unterschied zwischen "amazon.com als erstes" und "irgendein Link,
 * in dem amazon vorkommt".
 */
export function bewerte(eintrag, eingabe) {
  const text = String(eintrag || "").toLowerCase();
  const suche = String(eingabe || "").trim().toLowerCase();
  if (!suche || !text) return 0;
  const ohneSchema = text.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (ohneSchema.startsWith(suche)) return 3;   // Host beginnt so
  if (ohneSchema.includes(`/${suche}`)) return 2; // Pfadabschnitt
  if (text.includes(suche)) return 1;            // irgendwo
  return 0;
}

/**
 * Waehlt und sortiert die Vorschlaege.
 * Doppelte Adressen fliegen raus — im Verlauf steht dieselbe Seite oft
 * mehrfach, und sechs Zeilen derselben Adresse sind keine Hilfe.
 */
export function vorschlaege(verlauf, eingabe, grenze = MAX_VORSCHLAEGE) {
  const suche = String(eingabe || "").trim();
  if (!suche) return [];
  const gesehen = new Set();
  return (Array.isArray(verlauf) ? verlauf : [])
    .map((url) => ({ url: String(url || ""), punkte: bewerte(url, suche) }))
    .filter((e) => {
      if (e.punkte === 0) return false;
      const schluessel = e.url.replace(/\/$/, "").toLowerCase();
      if (gesehen.has(schluessel)) return false;
      gesehen.add(schluessel);
      return true;
    })
    .sort((a, b) => b.punkte - a.punkte || a.url.length - b.url.length)
    .slice(0, grenze)
    .map((e) => e.url);
}

/**
 * Haengt die Vorschlagsliste an ein Adressfeld.
 *
 * @returns {{zerstoere: Function}} zum Abmelden der Ereignisse
 */
export function verdrahteVorschlaege({
  feld,
  liste,
  verlauf = () => [],
  uebernehmen = () => {},
  // Escape: was "abbrechen" bedeutet, weiss nur der Aufrufer.
  zuruecksetzen = () => {}
} = {}) {
  if (!feld || !liste) return { zerstoere: () => {} };
  let aktuell = [];
  let markiert = -1;

  function schliesse() {
    aktuell = [];
    markiert = -1;
    liste.hidden = true;
    liste.innerHTML = "";
    feld.setAttribute("aria-expanded", "false");
  }

  function zeichne() {
    liste.innerHTML = "";
    aktuell.forEach((url, index) => {
      const zeile = document.createElement("button");
      zeile.type = "button";
      zeile.className = `bp-vorschlag${index === markiert ? " is-markiert" : ""}`;
      zeile.setAttribute("role", "option");
      zeile.setAttribute("aria-selected", String(index === markiert));
      zeile.textContent = url;
      // mousedown statt click: das Feld verliert sonst vorher den Fokus und
      // "blur" schliesst die Liste, bevor der Klick ankommt. Ein Klassiker.
      zeile.addEventListener("mousedown", (event) => {
        event.preventDefault();
        schliesse();
        uebernehmen(url);
      });
      liste.appendChild(zeile);
    });
    liste.hidden = aktuell.length === 0;
    feld.setAttribute("aria-expanded", String(aktuell.length > 0));
  }

  function beiEingabe() {
    aktuell = vorschlaege(verlauf(), feld.value);
    markiert = -1;
    zeichne();
  }

  function beiTaste(event) {
    // Escape MUSS auch greifen, wenn keine Vorschlaege stehen. Vorher stieg
    // die Behandlung hier aus, und wer eine falsche Adresse getippt hatte,
    // blieb auf seinem halben Text sitzen — Chrome holt die alte Adresse
    // zurueck und gibt den Fokus an die Seite. Der Ausstieg oben war fuer die
    // Pfeiltasten gedacht und hat Escape mit verschluckt.
    if (event.key === "Escape") {
      event.preventDefault();
      schliesse();
      zuruecksetzen();
      return;
    }
    if (liste.hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const richtung = event.key === "ArrowDown" ? 1 : -1;
      markiert = (markiert + richtung + aktuell.length + 1) % (aktuell.length + 1);
      // Position aktuell.length bedeutet "nichts markiert" — so kommt man
      // per Pfeil auch wieder zur eigenen Eingabe zurueck, wie in Chrome.
      if (markiert === aktuell.length) markiert = -1;
      zeichne();
      return;
    }
    if (event.key === "Enter" && markiert >= 0) {
      event.preventDefault();
      const url = aktuell[markiert];
      schliesse();
      uebernehmen(url);
      return;
    }
  }

  feld.addEventListener("input", beiEingabe);
  feld.addEventListener("keydown", beiTaste);
  feld.addEventListener("blur", () => setTimeout(schliesse, 120));
  feld.setAttribute("role", "combobox");
  feld.setAttribute("aria-autocomplete", "list");
  feld.setAttribute("aria-expanded", "false");
  liste.setAttribute("role", "listbox");
  liste.hidden = true;

  return {
    zerstoere() {
      feld.removeEventListener("input", beiEingabe);
      feld.removeEventListener("keydown", beiTaste);
      schliesse();
    }
  };
}

/**
 * Adresse so anzeigen wie Chrome: ohne "https://", ohne "www.", ohne
 * abschliessenden Schraegstrich. Chrome zeigt "smejj.com", nicht
 * "https://www.smejj.com/" — das ist der auffaelligste Unterschied, den ein
 * Nebeneinander der beiden Leisten zeigt.
 *
 * "http://" bleibt SICHTBAR. Chrome ersetzt es durch eine Warnung; solange
 * wir die nicht haben, ist das sichtbare Schema das ehrlichere Signal —
 * eine unverschluesselte Verbindung darf nicht aussehen wie eine sichere.
 */
export function anzeigeAdresse(url) {
  const text = String(url || "");
  if (!/^https:\/\//i.test(text)) return text;
  const kurz = text.replace(/^https:\/\//i, "").replace(/^www\./i, "");
  // Nur den Schraegstrich der blossen Startseite weglassen, nie einen Pfad.
  return kurz.replace(/\/$/, "");
}

/**
 * Bequemer Einstieg fuer das Panel: nimmt Feld, Liste, den Panel-Zustand und
 * die Navigationsfunktion — und weiss selbst, dass der Verlauf aller Tabs die
 * Quelle ist. So bleibt in browser-pane.js ein einziger Aufruf stehen.
 */
export function verdrahtePanelVorschlaege(feld, liste, zustand, oeffne) {
  // Beim Bearbeiten die VOLLE Adresse zeigen und alles auswaehlen — sonst
  // koennte man eine gekuerzte Adresse nicht sinnvoll aendern. Genau so
  // verhaelt sich Chrome beim Klick in die Leiste.
  feld.addEventListener("focus", () => {
    const voll = zustand?.tabs?.find((t) => t.id === zustand.activeId)?.url || "";
    if (voll) feld.value = voll;
    feld.select();
  });
  feld.addEventListener("blur", () => {
    const voll = zustand?.tabs?.find((t) => t.id === zustand.activeId)?.url || "";
    feld.value = anzeigeAdresse(voll);
  });
  const aktuelleUrl = () => zustand?.tabs?.find((t) => t.id === zustand.activeId)?.url || "";
  return verdrahteVorschlaege({
    feld,
    liste,
    verlauf: () => (zustand?.tabs || []).flatMap((t) => t.history || []),
    uebernehmen: (url) => { feld.value = url; oeffne(url); },
    // Escape: zurueck zur gekuerzten Adresse der Seite und Fokus abgeben —
    // wie in Chrome.
    zuruecksetzen: () => { feld.value = anzeigeAdresse(aktuelleUrl()); feld.blur(); }
  });
}
