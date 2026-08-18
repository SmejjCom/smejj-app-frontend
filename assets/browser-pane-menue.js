// smejj.com — ein Kontextmenue fuer alles im Panel.
//
// Es gab schon eines fuer die Tabs. Statt fuer den Rechtsklick auf die Seite
// ein zweites danebenzustellen (mit eigener Positionierung, eigenem
// Schliessverhalten, eigenem Aussehen), steht die Mechanik jetzt einmal hier.
// Zwei Menues, die sich unterschiedlich schliessen, faellt niemandem als
// Absicht auf — nur als Schlamperei.
//
// SRP: kennt nur Eintraege und Koordinaten. WAS ein Eintrag bedeutet, weiss
// allein der Aufrufer.

/**
 * Haelt das Menue im sichtbaren Bereich.
 * Reine Rechnung — ein Menue, das unten rechts halb aus dem Fenster ragt, ist
 * genau dort am wahrscheinlichsten, wo man zuletzt geklickt hat.
 */
export function menuePosition(x, y, breite, hoehe, fensterBreite, fensterHoehe, rand = 8) {
  const links = Math.max(rand, Math.min(x, fensterBreite - breite - rand));
  const oben = Math.max(rand, Math.min(y, fensterHoehe - hoehe - rand));
  return { links, oben };
}

/** Schliesst ein offenes Menue, falls eines steht. */
export function schliesseMenue() {
  document.querySelector(".bp-tabmenue")?.remove();
}

/**
 * Zeigt ein Menue an (x, y) im Fenster.
 *
 * @param {number} x
 * @param {number} y
 * @param {Array<{id:string,text:string,aktiv?:boolean}>} eintraege
 * @param {Function} aufWahl  bekommt die id des gewaehlten Eintrags
 */
export function zeigeMenue(x, y, eintraege, aufWahl) {
  schliesseMenue();
  const menue = document.createElement("div");
  menue.className = "bp-tabmenue";
  menue.setAttribute("role", "menu");
  // Erst unsichtbar einhaengen, um die echte Groesse zu messen — vorher
  // kann niemand wissen, ob es unten noch hinpasst.
  menue.style.visibility = "hidden";
  menue.style.left = "0px";
  menue.style.top = "0px";

  for (const eintrag of eintraege) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "bp-tabmenue-eintrag";
    knopf.setAttribute("role", "menuitem");
    knopf.textContent = eintrag.text;
    knopf.disabled = eintrag.aktiv === false;
    knopf.addEventListener("click", () => {
      schliesseMenue();
      aufWahl(eintrag.id);
    });
    menue.appendChild(knopf);
  }
  document.body.appendChild(menue);

  const { links, oben } = menuePosition(
    x, y, menue.offsetWidth, menue.offsetHeight,
    window.innerWidth, window.innerHeight
  );
  menue.style.left = `${links}px`;
  menue.style.top = `${oben}px`;
  menue.style.visibility = "";

  // Beim naechsten Klick oder Escape wieder weg — ein Menue, das haengen
  // bleibt, verdeckt genau das, was man als Naechstes anklicken will.
  setTimeout(() => {
    document.addEventListener("click", schliesseMenue, { once: true });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") schliesseMenue(); }, { once: true });
  }, 0);
  return menue;
}

// --- Eintraege fuer den Rechtsklick auf die Seite ------------------------------

/**
 * Chromes Seitenmenue, auf das reduziert, was hier wirklich geht.
 * Was nicht geht, steht gar nicht erst drin — ein Menue voller toter
 * Eintraege ("Drucken", "Uebersetzen") sieht nach Browser aus und ist keiner.
 */
export function seitenEintraege({ kannZurueck = false, kannVor = false, hatAdresse = false } = {}) {
  return [
    { id: "zurueck", text: "Zurueck", aktiv: kannZurueck },
    { id: "vor", text: "Vor", aktiv: kannVor },
    { id: "neuLaden", text: "Neu laden", aktiv: hatAdresse },
    { id: "adresseKopieren", text: "Adresse kopieren", aktiv: hatAdresse },
    { id: "externOeffnen", text: "In neuem Tab oeffnen", aktiv: hatAdresse }
  ];
}

/**
 * Einstieg fuer das Panel: zeigt das Seitenmenue und fuehrt die Wahl aus.
 * Die Koordinaten kommen aus dem Rahmen und sind auf DESSEN Fenster bezogen —
 * deshalb wird die Position des Rahmens dazugerechnet, sonst erscheint das
 * Menue in der linken oberen Ecke des Panels statt am Mauszeiger.
 */
export function zeigeSeitenMenue({ x, y, tab, rahmen, befehle }) {  // eslint-disable-line
  const kasten = rahmen?.getBoundingClientRect?.() || { left: 0, top: 0 };
  const eintraege = seitenEintraege({
    kannZurueck: (tab?.historyIndex ?? -1) > 0,
    kannVor: (tab?.historyIndex ?? -1) < (tab?.history?.length ?? 0) - 1,
    hatAdresse: Boolean(tab?.url)
  });
  return zeigeMenue(kasten.left + Number(x || 0), kasten.top + Number(y || 0), eintraege, (id) => {
    if (id === "adresseKopieren") {
      // Nur die Zwischenablage schreiben, nichts lesen — und leise scheitern,
      // wenn der Browser es verweigert.
      navigator.clipboard?.writeText?.(tab.url).catch(() => {});
      befehle.hinweis?.("Adresse kopiert.");
      return;
    }
    befehle[id]?.();
  });
}

/**
 * Behandelt die Rechtsklick-Meldung aus einem Rahmen.
 * Nimmt die Panel-Bausteine und baut die Befehle daraus — so bleibt in
 * browser-pane.js eine Zeile stehen statt zehn.
 */
export function behandleRechtsklick(message, tab, { stepHistory, navigate, showHint }) {
  return zeigeSeitenMenue({
    x: message.x, y: message.y, tab, rahmen: tab.frame,
    befehle: {
      zurueck: () => stepHistory(-1),
      vor: () => stepHistory(1),
      neuLaden: () => navigate(tab, tab.url, { push: false }),
      externOeffnen: () => window.open(tab.url, "_blank", "noopener"),
      hinweis: showHint
    }
  });
}
