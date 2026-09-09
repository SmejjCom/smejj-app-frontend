// smejj.com — Verlauf-Ansicht: Karten-Bausteine (ausgelagert 2026-08-10).
//
// Aus chat-history-view.js herausgeloest (800-Zeilen-Regel), INHALTLICH
// unveraendert. Diese Bausteine bauen die DOM-Knoten des Verlaufs (Kopf mit
// Suchfeld, Filter-Chips, Gruppenkoepfe, Karten). Anders als die reinen Helfer
// in chat-history-format.js haengen sie am Zustand der Ansicht — deshalb NICHT
// als freie Funktionen, sondern als Factory: createCardBuilders(ctx) bekommt die
// Zustands-Accessoren (Suchbegriff, Themenfilter, offenes Menue) und die
// Rueckruf-Funktionen (zeichne, host, menuSchliessen, oeffneMenu) hereingereicht.
// So bleibt der EINE Zustand in chat-history-view.js; hier wird er nur gelesen
// und ueber die Setter zurueckgeschrieben — kein zweiter Wahrheitsort.
//
// Die reinen Anzeige-Helfer und der Chat-Store werden direkt importiert (sie
// haengen an keinem Ansichts-Zustand).

import {
  newChat, openChat, erstelleProjekt, benenneProjektUm, loescheProjekt, setzeChatProjekt
} from "/assets/chat-store.js?v=b69";
// Seit der Zusammenfuehrung der beiden Aufteilungen (2026-08-10) wohnen die
// reinen Anzeige-Helfer in chat-history-text.js — format.js war deren
// Teilmenge und ist entfallen.
import { zeitText, mitHervorhebung, trefferAusschnitt } from "/assets/chat-history-text.js?v=b47c";

// Auf 375 px passt "Donnerstag, 09:13 · 30 Nachrichten" nicht in eine Zeile —
// gemessen brach der Text mitten im Wort ab ("30 Nachrich"). CSS kann hier
// nicht helfen, weil die Zeile aus mehreren Elementen besteht; also wird das
// lange Wort auf schmalen Schirmen gar nicht erst geschrieben.
export function schmalerSchirm() {
  try {
    return window.matchMedia("(max-width: 600px)").matches;
  } catch {
    return false;
  }
}

// Doppelte Karten (gleicher Titel UND gleiche Vorschau) bekommen einen
// Zeitstempel an den Titel, damit sie unterscheidbar bleiben — sonst nur dann,
// nie generell (die Uhrzeit steht ohnehin in der Fusszeile).
export function entdoppeln(aufbereitet) {
  const zaehler = new Map();
  for (const eintrag of aufbereitet) {
    const schluessel = `${eintrag.titel}\u0000${eintrag.vorschau}`;
    zaehler.set(schluessel, (zaehler.get(schluessel) || 0) + 1);
  }
  for (const eintrag of aufbereitet) {
    const schluessel = `${eintrag.titel}\u0000${eintrag.vorschau}`;
    if (zaehler.get(schluessel) < 2) continue;
    const datum = new Date(eintrag.chat.updatedAt);
    if (!Number.isFinite(datum.getTime())) continue;
    eintrag.titel += ` · ${datum.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  }
}

export function bausteinLeer(text) {
  const leer = document.createElement("div");
  leer.className = "chat-history-empty";
  leer.textContent = text;
  return leer;
}

export function bausteinGruppe(titel, anzahl) {
  const kopf = document.createElement("div");
  kopf.className = "ch-gruppe";
  kopf.textContent = titel;
  if (Number.isFinite(anzahl)) {
    // Mockup Bildschirm 47: rechts am Gruppenkopf steht, wie viele es sind.
    const n = document.createElement("span");
    n.className = "ch-gruppe-n";
    n.textContent = `${anzahl} ${anzahl === 1 ? "Gespräch" : "Gespräche"}`;
    kopf.append(n);
  }
  return kopf;
}

// Eigener Baustein, weil der Knopf an ZWEI Stellen steht: neben dem Suchfeld
// und allein im leeren Verlauf (dort ist er der einzige Weg nach vorn).
export function bausteinNeuKnopf() {
  const neuKnopf = document.createElement("button");
  neuKnopf.type = "button";
  neuKnopf.className = "ch-neu";
  neuKnopf.textContent = "＋ Neuer Chat";
  neuKnopf.title = "Neue Unterhaltung beginnen";
  neuKnopf.addEventListener("click", () => { try { newChat(); } catch { /* fail-safe */ } });
  return neuKnopf;
}

// Factory: bindet die zustandsabhaengigen Bausteine an die Ansicht.
// ctx = { getSuchbegriff, setSuchbegriff, getThemenFilter, setThemenFilter,
//         getOffenesMenu, zeichne, host, menuSchliessen, oeffneMenu }
export function createCardBuilders(ctx) {
  function bausteinKopf(gefunden, gesamt) {
    const kopf = document.createElement("div");
    kopf.className = "ch-kopf";

    const feld = document.createElement("div");
    feld.className = "ch-suche";
    feld.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.6-3.6"></path></svg>';

    const eingabe = document.createElement("input");
    eingabe.type = "search";
    eingabe.autocomplete = "off";
    eingabe.value = ctx.getSuchbegriff();
    eingabe.setAttribute("aria-label", "Verlauf durchsuchen");
    // Auf dem Handy passt "18 Unterhaltungen durchsuchen…" nicht ins Feld und
    // wird abgeschnitten ("… durchs"). Dort die kurze Fassung.
    // Mockup Bildschirm 47: das Feld sagt, dass auch der ANTWORTTEXT
    // durchsucht wird — genau das koennen viele nicht erwarten.
    eingabe.placeholder = gefunden === gesamt
      ? (schmalerSchirm() ? "Durchsuchen…" : `In allen ${gesamt} Gesprächen suchen — auch im Text der Antworten`)
      : `${gefunden} von ${gesamt}${schmalerSchirm() ? "" : " Gesprächen"}`;
    eingabe.addEventListener("input", () => {
      ctx.setSuchbegriff(eingabe.value);
      const stand = eingabe.selectionStart;
      ctx.zeichne();
      // Nach dem Neuzeichnen ist das Feld ein neues Element — Fokus zurueckholen,
      // sonst bricht das Tippen nach dem ersten Zeichen ab.
      const neu = ctx.host()?.querySelector(".ch-suche input");
      if (neu) {
        neu.focus();
        try { neu.setSelectionRange(stand, stand); } catch { /* search-Feld ohne Auswahl */ }
      }
    });
    feld.append(eingabe);

    kopf.append(feld, bausteinNeuKnopf());
    return kopf;
  }

  function bausteinChips(aufbereitet) {
    // Mockup V11, Bildschirm 47: gefiltert wird nach dem, was NACHWEISBAR in
    // der Unterhaltung steckt (Werkzeug-Kennzeichen) — nicht nach geratenen
    // Themen. Das Mockup nennt geratene Themenkategorien ausdruecklich als
    // Fehler der Vorlage. Die Themen-Tabelle bleibt fuer das Etikett auf der
    // Karte erhalten; gefiltert wird hier.
    const leiste = document.createElement("div");
    leiste.className = "ch-chips";

    const zaehl = { angeheftet: 0, datei: 0, bild: 0, code: 0 };
    for (const eintrag of aufbereitet) {
      if (eintrag.chat.pinned === true) zaehl.angeheftet += 1;
      if (eintrag.merkmale?.datei) zaehl.datei += 1;
      if (eintrag.merkmale?.bild) zaehl.bild += 1;
      if (eintrag.merkmale?.code) zaehl.code += 1;
    }

    const machChip = (schluessel, beschriftung, anzahl) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ch-chip";
      chip.setAttribute("aria-pressed", ctx.getThemenFilter() === schluessel ? "true" : "false");
      chip.append(document.createTextNode(beschriftung));
      const n = document.createElement("span");
      n.className = "ch-n";
      n.textContent = String(anzahl);
      chip.append(n);
      chip.addEventListener("click", () => {
        ctx.setThemenFilter(ctx.getThemenFilter() === schluessel ? "" : schluessel);
        ctx.zeichne();
      });
      return chip;
    };

    leiste.append(machChip("", "Alle", aufbereitet.length));
    if (zaehl.angeheftet) leiste.append(machChip("angeheftet", "📌 Angeheftet", zaehl.angeheftet));
    if (zaehl.datei) leiste.append(machChip("datei", "Mit Datei", zaehl.datei));
    if (zaehl.bild) leiste.append(machChip("bild", "Mit Bild", zaehl.bild));
    if (zaehl.code) leiste.append(machChip("code", "Mit Code", zaehl.code));
    return leiste;
  }

  // Projektgruppen-Kopf (2026-08-13): wie bausteinGruppe, aber mit eigenem
  // ⋯-Knopf fuer Umbenennen/Loeschen des Projekts. Bei leeren Projekten steht
  // ein gedaempfter Hinweis dabei — sonst waere die Gruppe vom Datumskopf
  // nicht zu unterscheiden und ein leeres Projekt unauffindbar.
  function bausteinProjektGruppe(projekt, anzahl) {
    const kopf = document.createElement("div");
    kopf.className = "ch-gruppe ch-projekt";
    kopf.dataset.projektId = projekt.id;

    const text = document.createElement("span");
    text.className = "ch-projekt-name";
    text.textContent = `📁 ${projekt.name || "Projekt"}`;
    kopf.append(text);

    if (anzahl === 0) {
      const leer = document.createElement("span");
      leer.className = "ch-projekt-leer";
      leer.textContent = "Keine Chats";
      kopf.append(leer);
    }

    const mehr = document.createElement("button");
    mehr.type = "button";
    mehr.className = "ch-proj-mehr";
    mehr.textContent = "⋯";
    mehr.title = "Projekt-Aktionen";
    mehr.setAttribute("aria-label", `Aktionen für Projekt ${projekt.name || ""}`);
    mehr.addEventListener("click", (event) => {
      event.stopPropagation();
      const offen = ctx.getOffenesMenu();
      const warOffen = offen && offen.dataset.projektId === projekt.id;
      ctx.menuSchliessen();
      if (!warOffen) ctx.oeffneProjektMenu(kopf, projekt);
    });
    kopf.append(mehr);
    return kopf;
  }

  function bausteinKarte(eintrag, aktiv, nadel) {
    const { chat } = eintrag;
    const karte = document.createElement("div");
    karte.className = `ch-karte${chat.id === aktiv ? " is-active" : ""}`;
    karte.dataset.chatId = chat.id;
    karte.title = "Unterhaltung öffnen";

    const titel = document.createElement("div");
    titel.className = "ch-titel";
    if (chat.pinned === true) {
      const pin = document.createElement("span");
      pin.className = "ch-pin";
      pin.setAttribute("aria-label", "Angeheftet");
      pin.textContent = "📌";
      titel.append(pin);
    }
    titel.append(mitHervorhebung(eintrag.titel, nadel));

    const vorschauText = (nadel && trefferAusschnitt(chat, nadel)) || eintrag.vorschau;
    const vorschau = document.createElement("div");
    vorschau.className = "ch-vorschau";
    vorschau.append(mitHervorhebung(vorschauText, nadel));

    const meta = document.createElement("div");
    meta.className = "ch-meta";
    const tag = document.createElement("span");
    tag.className = "ch-tag";
    tag.textContent = eintrag.thema;
    const anzahl = Array.isArray(chat.messages) ? chat.messages.length : 0;
    const rest = document.createElement("span");
    rest.textContent = `${zeitText(chat.updatedAt)} · ${anzahl} ${schmalerSchirm() ? "Nachr." : "Nachrichten"}`;
    meta.append(tag, rest);

    const mehr = document.createElement("button");
    mehr.type = "button";
    mehr.className = "ch-mehr";
    mehr.textContent = "⋯";
    mehr.title = "Weitere Aktionen";
    mehr.setAttribute("aria-label", "Weitere Aktionen");
    mehr.addEventListener("click", (event) => {
      event.stopPropagation();
      const offen = ctx.getOffenesMenu();
      const warOffen = offen && offen.dataset.chatId === chat.id;
      ctx.menuSchliessen();
      if (!warOffen) ctx.oeffneMenu(karte, chat);
    });

    karte.addEventListener("click", (event) => {
      if (event.target.closest(".ch-menu, .ch-mehr, .ch-umbenennen")) return;
      openChat(chat.id).catch(() => {});
    });

    karte.append(titel);
    if (vorschauText) karte.append(vorschau);
    karte.append(meta, mehr);
    return karte;
  }

  return { entdoppeln, bausteinLeer, bausteinGruppe, bausteinNeuKnopf, schmalerSchirm, bausteinKopf, bausteinChips, bausteinKarte, bausteinProjektGruppe };
}

/* ------------------------------------------------------------------ *
 *  Projekte (2026-08-13): Menue am Gruppenkopf + Picker an der Karte.
 *  Hierher verschoben (800-Zeilen-Regel in chat-history-view.js),
 *  INHALTLICH unveraendert. Beide nutzen dasselbe offenesMenu-Handle wie
 *  das Chat-Menue — damit greifen Render-Sperre (zeichne) und
 *  Outside-Click-Schliessen mit. Der EINE Zustand bleibt in der Ansicht;
 *  die Factory bekommt Accessoren, wie createCardBuilders oben.
 * ------------------------------------------------------------------ */

export function createProjektAktionen(ctx) {
  let confirmingProjektId = "";

  function oeffneProjektMenu(kopf, projekt) {
    const menu = document.createElement("div");
    menu.className = "ch-menu ch-projekt-menu";
    menu.dataset.projektId = projekt.id;
    menu.addEventListener("click", (event) => event.stopPropagation());

    const eintrag = (text, aktion, gefaehrlich) => {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.textContent = text;
      if (gefaehrlich) knopf.classList.add("is-danger");
      knopf.addEventListener("click", aktion);
      return knopf;
    };

    menu.append(eintrag("✎ Umbenennen", () => { ctx.menuSchliessen(); zeigeProjektUmbenennen(kopf, projekt); }));
    menu.append(document.createElement("hr"));

    // Zweistufig wie beim Chat — mit dem Hinweis, dass die Chats NICHT
    // mitgeloescht werden (sie rutschen in die Datumsgruppen zurueck).
    const loeschen = eintrag("🗑 Löschen…", async () => {
      if (confirmingProjektId !== projekt.id) {
        confirmingProjektId = projekt.id;
        loeschen.textContent = "🗑 Wirklich? Chats bleiben erhalten";
        ctx.armConfirmTimer(() => { ctx.menuSchliessen(); }, 4000);
        return;
      }
      ctx.menuSchliessen();
      await loescheProjekt(projekt.id).catch(() => {});
      ctx.render();
    }, true);
    menu.append(loeschen);

    kopf.append(menu);
    ctx.setOffenesMenu(menu);
  }

  function zeigeProjektUmbenennen(kopf, projekt) {
    if (kopf.querySelector(".ch-umbenennen")) return;
    const zeile = document.createElement("div");
    zeile.className = "ch-umbenennen ch-projekt-umbenennen";
    zeile.addEventListener("click", (event) => event.stopPropagation());

    const eingabe = document.createElement("input");
    eingabe.type = "text";
    eingabe.maxLength = 60;
    eingabe.value = projekt.name || "";
    eingabe.setAttribute("aria-label", "Neuer Projektname");

    const speichern = document.createElement("button");
    speichern.type = "button";
    speichern.textContent = "Speichern";
    const abbrechen = document.createElement("button");
    abbrechen.type = "button";
    abbrechen.textContent = "Abbrechen";

    const senden = async () => {
      await benenneProjektUm(projekt.id, eingabe.value).catch(() => {});
      ctx.render();
    };
    speichern.addEventListener("click", senden);
    abbrechen.addEventListener("click", () => zeile.remove());
    eingabe.addEventListener("keydown", (event) => {
      if (event.key === "Enter") senden();
      if (event.key === "Escape") zeile.remove();
    });

    zeile.append(eingabe, speichern, abbrechen);
    kopf.after(zeile);
    eingabe.focus();
    eingabe.select();
  }

  // Picker: Chat einem Projekt zuordnen. Bei null Projekten direkt die
  // Eingabe fuer das erste — ein leerer Picker waere eine Sackgasse.
  function zeigeProjektPicker(karte, chat) {
    const menu = document.createElement("div");
    menu.className = "ch-menu ch-projekt-picker";
    menu.dataset.chatId = chat.id;
    menu.addEventListener("click", (event) => event.stopPropagation());

    const eintrag = (text, aktion, aktivGewaehlt) => {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.textContent = text;
      if (aktivGewaehlt) knopf.classList.add("is-gewaehlt");
      knopf.addEventListener("click", aktion);
      return knopf;
    };

    const zuordnen = async (projektId) => {
      ctx.menuSchliessen();
      await setzeChatProjekt(chat.id, projektId).catch(() => {});
      ctx.render();
    };

    const alleProjekte = ctx.getAlleProjekte();
    for (const projekt of alleProjekte) {
      const gewaehlt = chat.projectId === projekt.id;
      menu.append(eintrag(`${gewaehlt ? "✓ " : ""}📁 ${projekt.name}`, () => zuordnen(gewaehlt ? "" : projekt.id), gewaehlt));
    }
    if (chat.projectId && alleProjekte.some((projekt) => projekt.id === chat.projectId)) {
      menu.append(eintrag("Kein Projekt", () => zuordnen("")));
    }
    if (alleProjekte.length) menu.append(document.createElement("hr"));

    const neu = eintrag("＋ Neues Projekt…", () => {
      // Menue-Inhalt gegen die Eingabezeile tauschen — kein zweites Overlay.
      menu.replaceChildren();
      const zeile = document.createElement("div");
      zeile.className = "ch-projekt-neu";
      const eingabe = document.createElement("input");
      eingabe.type = "text";
      eingabe.maxLength = 60;
      eingabe.placeholder = "Projektname";
      eingabe.setAttribute("aria-label", "Name des neuen Projekts");
      const anlegen = document.createElement("button");
      anlegen.type = "button";
      anlegen.textContent = "Anlegen";
      const senden = async () => {
        const name = eingabe.value;
        ctx.menuSchliessen();
        const projektId = await erstelleProjekt(name).catch(() => "");
        if (projektId) await setzeChatProjekt(chat.id, projektId).catch(() => {});
        ctx.render();
      };
      anlegen.addEventListener("click", senden);
      eingabe.addEventListener("keydown", (event) => {
        if (event.key === "Enter") senden();
        if (event.key === "Escape") ctx.menuSchliessen();
      });
      zeile.append(eingabe, anlegen);
      menu.append(zeile);
      eingabe.focus();
    });
    menu.append(neu);

    karte.append(menu);
    ctx.setOffenesMenu(menu);
    if (!alleProjekte.length) neu.click();
  }

  return { oeffneProjektMenu, zeigeProjektUmbenennen, zeigeProjektPicker };
}
