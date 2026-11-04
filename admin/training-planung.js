// smejj.com Operations Console — „Training & Wissen“: Aufgaben, Neue Aufgabe, Automatik, Kosten + Steuerung der Seite
// (Inhaber 03.11.2026, Mockup „Neue Trainingsaufgabe“).
//
// Schreibt nur über drei Server-Wege (nur Inhaber, Step-up, Grund, Audit — siehe adminFabrikAuftragRoutes.js):
//   /api/admin/fabrik/auftrag, /api/admin/fabrik/einstellungen und die bestehende Steuerung /api/admin/fabrik/wunsch.
// Ist ein Weg nicht erreichbar, bleibt der Knopf grau mit Grund — kein Knopf ohne funktionierende Schnittstelle.
// Doppelklick-Schutz: jeder Absendeknopf sperrt sich bis zur Antwort, jede Anfrage trägt eine anfrageId.
// Kosten: fehlende Preise oder Messungen sind „nicht berechenbar“, nie 0 €; Währung wie gemeldet, keine Umrechnung.
(function () {
  "use strict";
  const A = window.adminApi;
  const D = window.adminDialog;
  const e = A.escapeHtml;
  const T = window.adminTrainingAnsicht;
  const H = T.helfer;
  const pille = H.pille;
  const zahl = H.zahl;

  const REITER_SCHLUESSEL = "smejj.admin.training.reiter.v2";   // v2 (04.11.): nach dem Leitstand-Umbau öffnet jeder einmal den Leitstand, statt der alten gemerkten Ansicht
  const ENTWURF_SCHLUESSEL = "smejj.admin.training.entwurf";
  const TYPEN = [["wissen", "Wissen sammeln"], ["daten", "Daten prüfen"], ["training", "Modell trainieren"], ["qualitaet", "Qualität testen"]];
  const MODELLE = ["smejj 1.0 (Qwen3-4B-Instruct-2507)", "Qwen3.5-4B", "Qwen3.5-9B", "Qwen3.5-0.8B (nur Vortest)"];
  const ERGEBNISSE = ["neuer Kandidat", "Prüfbericht", "geprüfter Datensatz", "Wissensspeicher (RAG)"];
  const RECHNER_WAHL = [["auto", "automatisch passend"], ["macbook-pro", "MacBook Pro"], ["imac", "iMac (nur ≤ 0,8B)"], ["macbook-air", "MacBook Air (nur leichte Prüfungen)"]];
  const MODI = [["vorschlagen", "Nur vorschlagen", "Der Motor plant weiter Vorrat, reiht aber nichts selbst ein. Du gibst jede Aufgabe frei."],
    ["freigabe", "Nach Freigabe starten", "Wie oben; freigegebene Aufgaben starten, sobald ein Rechner frei ist."],
    ["auto", "Geprüfte Aufgaben automatisch starten", "Bisheriger Betrieb: Vorrat aus geprüften Rezepten wird automatisch eingereiht (höchstens 3 wartend)."]];
  const FEHLER = {
    fabrik_auftrag_doppelt: "Dieser Auftrag ist schon offen (gleiches Ziel, Modell, Datensatz und Rechner).",
    fabrik_rechner_belegt: "Der Rechner hat im selben Zeitfenster schon ein Training. Anderes Zeitfenster oder „automatisch passend“ wählen.",
    fabrik_ziel_zu_kurz: "Bitte das Ziel in mindestens 10 Zeichen beschreiben.",
    fabrik_ende_vor_start: "Die späteste Endzeit liegt vor dem Start.",
    fabrik_laufzeit_ungueltig: "Maximale Laufzeit: 1 bis 72 Stunden.",
    fabrik_zeitfenster_ungueltig: "Zeitfenster bitte als HH:MM-HH:MM, z. B. 22:00-06:00.",
    fabrik_strompreis_quelle_fehlt: "Zum Strompreis bitte die Quelle angeben (z. B. Rechnung 10/2026).",
    fabrik_grenze_ungueltig: "Eine Grenze liegt außerhalb des erlaubten Bereichs."
  };
  const ZUSTAND_TON = { gesendet: "", angenommen: "acc", freigegeben: "acc", "in-arbeit": "laeuft", ausgefuehrt: "ok", erledigt: "ok", abgelehnt: "bad", zurueckgezogen: "", fehlgeschlagen: "bad" };

  const s = { reiter: "ressourcen", rag: null, d: null, liste: null, listeOk: false, einst: null, kosten: null, bearbeite: null, rechnerVorgabe: null };
  try { s.reiter = sessionStorage.getItem(REITER_SCHLUESSEL) || "ressourcen"; } catch (_) { /* nur Bequemlichkeit */ }
  if (s.reiter === "neu") s.reiter = "aufgaben";

  const fehlerText = (a) => FEHLER[(a.data || {}).error] || a.fehler || "Fehlgeschlagen.";
  const anfrageId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  // ------------------------------------------------------------ Aufgaben
  function quittungen(o) {
    const q = {};
    ((o.t.automatik || {}).adminAuftraege || []).forEach((x) => { q[x.id] = x; });
    return q;
  }

  function aufgaben(o) {
    const a = o.t.auftraege || {};
    const z = a.zaehler || {};
    const q = quittungen(o);
    const modus = (o.t.automatik || {}).modus || "auto";
    const eigene = (s.liste || []).filter((x) => x.aktion !== "job-freigeben").slice().reverse();
    const chips = Object.keys(H.ZUSTAND).map((k) => '<span class="tb-chip ' + H.ZUSTAND[k][1] + '">' + e(H.ZUSTAND[k][0]) + " <b>" + zahl(z[k]) + "</b></span>").join("");
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Aufgaben aus dem Admin</h2><button class="tb-knopf primaer" type="button" data-tbNeu>＋ Neue Aufgabe</button></div>'
      + (!s.listeOk ? '<div class="tb-hinweis warn">Die Aufgaben-Schnittstelle antwortet nicht – Anlegen ist gesperrt, bis sie erreichbar ist.</div>' : "")
      + (eigene.length ? '<div class="tb-daten-huelle"><table class="tb-daten"><thead><tr><th>Ziel</th><th>Typ</th><th>Rechner</th><th>Zeitraum</th><th>Zustand</th><th></th></tr></thead><tbody>'
        + eigene.map((x) => {
          const qu = q[x.id];
          const zst = x.aktion === "zurueckziehen" ? (qu && qu.z === "zurueckgezogen" ? "zurueckgezogen" : "gesendet") : qu && qu.nr === x.nr ? qu.z : "gesendet";
          const offen = ["gesendet", "angenommen", "freigegeben"].indexOf(zst) >= 0 && x.aktion !== "zurueckziehen";
          return "<tr><td><b>" + e(x.ziel) + '</b><div class="tb-klein">' + e([x.ausgangsmodell, x.datensatz, (x.themen || []).join(", ")].filter(Boolean).join(" · ")) + "</div></td>"
            + "<td>" + e((TYPEN.filter((t) => t[0] === x.typ)[0] || [0, x.typ])[1]) + "</td><td>" + e(H.NAME["fabrik-" + x.rechner] || "automatisch") + "</td>"
            + "<td>" + e(x.start ? H.tagUhr(x.start) : "sobald frei") + " → " + e(x.ende ? H.tagUhr(x.ende) : "offen") + '<div class="tb-klein">max. ' + e(String(x.maxStunden || "?")) + " Std. · " + e(x.wiederholen || "") + "</div></td>"
            + "<td>" + pille(zst, ZUSTAND_TON[zst] || "") + (qu && qu.g && qu.nr === x.nr ? '<div class="tb-klein">' + e(qu.g) + "</div>" : "") + "</td>"
            + "<td>" + (offen ? '<button class="tb-knopf leise" type="button" data-tbBearbeite="' + e(x.id) + '">Bearbeiten</button> <button class="tb-knopf leise gefahr" type="button" data-tbZurueck="' + e(x.id) + '">Zurückziehen</button>' : "") + "</td></tr>";
        }).join("") + "</tbody></table></div>"
        : '<p class="tb-dim">Noch keine Aufgabe aus dem Admin. Neue Aufgaben gehen an die Fabrik; sie prüft sie (doppelt? Rechner frei? Voraussetzung?) und quittiert.</p>')
      + "</div>"
      + '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Aufträge der Fabrik (Chef-Warteschlange)</h2>' + H.altText(a._am, o.jetzt, H.TEIL_ALT_MIN) + "</div>"
      + '<div class="tb-fluss">' + chips + "</div>"
      + (modus === "auto" ? '<div class="tb-hinweis">ⓘ <span>Modus „automatisch“: der Vorrat wird von der Fabrik selbst eingereiht. Einzeln freigeben geht in den Modi „Nur vorschlagen“ und „Nach Freigabe starten“.</span></div>' : "")
      + '<div class="tb-daten-huelle"><table class="tb-daten"><thead><tr><th>Auftrag</th><th>Art</th><th>Zustand</th><th>Richtung</th><th>Stand</th><th></th></tr></thead><tbody>'
      + (a.liste || []).map((x) => "<tr><td><b>" + e(H.klartext(x.n)) + "</b></td><td>" + e(H.TYP_TEXT[x.t] || x.t) + "</td><td>" + pille((H.ZUSTAND[x.z] || [x.z])[0], (H.ZUSTAND[x.z] || [0, ""])[1])
        + "</td><td>" + e(x.r || "—") + "</td><td>" + e(H.tagUhr(x.am)) + "</td><td>"
        + (x.z === "vorrat" && modus !== "auto" && s.listeOk ? '<button class="tb-knopf leise" type="button" data-tbFreigeben="' + e(x.n) + '">Freigeben</button>' : "") + "</td></tr>").join("")
      + '</tbody></table></div><div class="tb-klein">Neueste 12 von ' + zahl(Object.keys(z).reduce((t, k) => t + (z[k] || 0), 0)) + " · Erledigt heißt fertig gerechnet, nicht bestanden.</div></div>";
  }

  // ------------------------------------------------------------ Neue Aufgabe
  function wahl(name, liste, wert) {
    return '<select name="' + name + '">' + liste.map((x) => {
      const v = Array.isArray(x) ? x[0] : x;
      return '<option value="' + e(v) + '"' + (v === wert ? " selected" : "") + ">" + e(Array.isArray(x) ? x[1] : x) + "</option>";
    }).join("") + "</select>";
  }

  function lokal(iso) {
    if (!iso || !isFinite(Date.parse(iso))) return "";
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function vorgabe() {
    let entwurf = null;
    try { entwurf = JSON.parse(localStorage.getItem(ENTWURF_SCHLUESSEL) || "null"); } catch (_) { entwurf = null; }
    const alt = s.bearbeite ? (s.liste || []).filter((x) => x.id === s.bearbeite)[0] : null;
    const w = Object.assign({ typ: "training", ausgangsmodell: MODELLE[0], ergebnis: ERGEBNISSE[0], verwendung: "training", rechner: s.rechnerVorgabe || "auto",
      stufe: "mittel", prioritaet: "normal", maxStunden: 8, wiederholen: "einmalig", beiEnde: "speichern-pausieren", themen: [] }, alt || entwurf || {});
    return w;
  }

  function vorDemStart(w, o) {
    const r = o.rechner.filter((m) => H.KENNUNG[m.id] === w.rechner)[0];
    const lage = r ? o.lagen[o.rechner.indexOf(r)].lage : null;
    const geeignet = w.rechner === "auto" ? true : lage && lage !== "stumm" && lage !== "notaus";
    const satz = ((o.t.wissen || {}).saetze || []).filter((x) => x.n === w.datensatz)[0];
    const ja = (b, t, offenText) => "<li><span class=\"" + (b === null ? "offen" : b ? "ja" : "nein") + '">' + (b === null ? "?" : b ? "✓" : "✗") + "</span>" + e(b === null && offenText ? offenText : t) + "</li>";
    const zeitOk = !(w.start && w.ende) || Date.parse(w.ende) > Date.parse(w.start);
    return '<ul class="tb-pruefliste">'
      + ja(geeignet, "Rechner erreichbar und geeignet" + (r ? " (" + H.NAME[r.id] + ")" : " – Fabrik wählt"))
      + ja(zeitOk && w.maxStunden >= 1 && w.maxStunden <= 72, "Laufzeit 1–72 Std., Endzeit nach dem Start")
      + ja(w.beiEnde === "speichern-pausieren" ? true : null, "Sicherung & Wiederaufnahme: bei Endzeit speichern und pausieren", "Bei Endzeit wird abgebrochen – Wiederaufnahme nur neu")
      + ja(satz ? satz.f === 0 : w.typ === "training" ? null : true, satz ? (satz.f === 0 ? "Herkunft des Datensatzes ohne Befund" : "Datensatz hat Herkunfts-Befunde") : "Datensatz geprüft", "Datensatz noch nicht gewählt/geprüft")
      + ja(true, "Keine neuen kostenpflichtigen Dienste (nur eigene Rechner)")
      + ja(w.typ === "training" ? null : true, "Live erst nach allen 6 Pflichtprüfungen", "Ergebnis wird Kandidat – Live bleibt gesperrt bis 6/6")
      + "</ul>";
  }

  function neu(o) {
    const w = vorgabe();
    const q = o.t.qualitaet || {};
    const saetze = (o.t.wissen || {}).saetze || [];
    const offene = (s.liste || []).filter((x) => x.aktion === "anlegen" || x.aktion === "aendern");
    const mo = (o.t.automatik || {}).modus || "auto";
    const pz = (x) => (typeof x === "number" ? Math.round(100 * x) : null);
    return '<div class="tb-kopf"><div><h2>' + (s.bearbeite ? "Aufgabe bearbeiten" : "Neue Trainingsaufgabe") + '</h2><div class="tb-unter">Du bestimmst Ziel und Grenzen. Das System prüft den Rest.</div></div>'
      + '<button class="tb-knopf leise" type="button" data-tbReiter="aufgaben">← zurück zu Aufgaben</button></div>'
      + '<div class="tb-schritte"><span><i class="tb-nr an">1</i>Ziel</span>→<span><i class="tb-nr">2</i>Daten</span>→<span><i class="tb-nr">3</i>Zeit &amp; Rechner</span>→<span><i class="tb-nr">4</i>Prüfen &amp; einplanen</span></div>'
      + '<form class="tb-form" data-tbForm novalidate><div class="tb-reihe k2"><div>'
      + '<div class="tb-karte"><h2>1 · Was soll besser werden?</h2><label for="tb-ziel">Dein Auftrag</label><input id="tb-ziel" type="text" name="ziel" maxlength="200" required value="' + e(w.ziel || "") + '" placeholder="z. B. Antworten auf Deutsch verständlicher und mit Quellen geben">'
      + '<label class="tb-oben">Aufgabentyp</label><div class="tb-typen" role="group">' + TYPEN.map((t) => '<button type="button" data-tbTyp="' + t[0] + '" aria-pressed="' + (w.typ === t[0]) + '">' + e(t[1]) + "</button>").join("") + "</div>"
      + '<input type="hidden" name="typ" value="' + e(w.typ) + '"><div class="tb-feldreihe zwei"><div><label>Ausgangsmodell</label>' + wahl("ausgangsmodell", MODELLE, w.ausgangsmodell)
      + "</div><div><label>Ergebnis</label>" + wahl("ergebnis", ERGEBNISSE, w.ergebnis) + '</div></div><div class="tb-hinweis">ⓘ Die Live-Version bleibt bis zur Freigabe erhalten.</div></div>'
      + '<div class="tb-karte"><h2>2 · Welche Daten dürfen hinein?</h2><div class="tb-feldreihe zwei"><div><label>Datensatz</label>' + wahl("datensatz", [["", "neu sammeln / Fabrik wählt"]].concat(saetze.map((x) => [x.n, x.n + " (" + zahl(x.b) + ")"])), w.datensatz || "")
      + '</div><div><label for="tb-themen">Themen (mit Komma)</label><input id="tb-themen" type="text" name="themen" maxlength="200" value="' + e((w.themen || []).join(", ")) + '" placeholder="z. B. Produktwissen, Anleitungen, Deutsch"></div></div>'
      + '<label>Verwendung</label><div class="tb-radio">' + [["training", "Modelltraining"], ["rag", "Wissenssuche (RAG)"]].map((v) => '<label class="' + (w.verwendung === v[0] ? "an" : "") + '"><input type="radio" name="verwendung" value="' + v[0] + '"' + (w.verwendung === v[0] ? " checked" : "") + "> " + v[1] + "</label>").join("")
      + '</div><div class="tb-klein">Gespeicherte Suchquellen sind nicht automatisch im Modell gelernt. Nutzungsrechte und Herkunft prüft die Fabrik (Gate 3); Einwilligungen je Lernpaar sind nicht erfasst.</div></div>'
      + '<div class="tb-karte"><h2>3 · Wann und wo?</h2><div class="tb-feldreihe"><div><label>Start</label><input type="datetime-local" name="start" value="' + e(lokal(w.start)) + '"><div class="tb-klein">leer = sobald frei</div></div>'
      + '<div><label>Spätestes Ende</label><input type="datetime-local" name="ende" value="' + e(lokal(w.ende)) + '"></div>'
      + '<div><label>Max. Laufzeit (Std.)</label><input type="number" name="maxStunden" min="1" max="72" value="' + e(String(w.maxStunden)) + '"></div></div>'
      + '<div class="tb-feldreihe"><div><label>Wiederholen</label>' + wahl("wiederholen", [["einmalig", "einmalig"], ["taeglich", "täglich"], ["woechentlich", "wöchentlich"]], w.wiederholen)
      + "</div><div><label>Priorität</label>" + wahl("prioritaet", [["niedrig", "niedrig"], ["normal", "normal"], ["hoch", "hoch"]], w.prioritaet)
      + "</div><div><label>Rechner</label>" + wahl("rechner", RECHNER_WAHL, w.rechner) + "</div></div>"
      + '<label>Leistungsmodus</label><div class="tb-radio">' + [["leise", "Leise"], ["mittel", "Mittel"], ["vollgas", "Vollgas"]].map((v) => '<label class="' + (w.stufe === v[0] ? "an" : "") + '"><input type="radio" name="stufe" value="' + v[0] + '"' + (w.stufe === v[0] ? " checked" : "") + "> " + v[1] + "</label>").join("") + "</div>"
      + '<div class="tb-feldreihe zwei tb-oben"><div><label>Bei Endzeit oder Abbruch</label>' + wahl("beiEnde", [["speichern-pausieren", "speichern und pausieren (Wiederaufnahme möglich)"], ["abbrechen", "abbrechen (keine Wiederaufnahme)"]], w.beiEnde)
      + "</div><div><label>Abhängigkeit</label>" + wahl("abhaengigVon", [["", "keine"]].concat(offene.filter((x) => x.id !== s.bearbeite).map((x) => [x.id, "erst nach: " + String(x.ziel).slice(0, 40)])), w.abhaengigVon || "") + "</div></div></div>"
      + "</div><div>"
      + '<div class="tb-karte"><h2>So wird Erfolg geprüft</h2><ul class="tb-pruefliste"><li><span class="ja">✓</span>Neue gegen bisherige Version</li><li><span class="ja">✓</span>Gleiche unabhängige Testfragen (295 Fälle)</li>'
      + '<li><span class="ja">✓</span>Qualität je Thema &amp; Sprache</li><li><span class="ja">✓</span>Keine Verschlechterung wichtiger Fähigkeiten</li><li><span class="ja">✓</span>Sicherheits- und Lizenzprüfung (6 Pflichtprüfungen)</li></ul>'
      + (q.live && q.kandidat ? '<div class="tb-hinweis"><span><b>Letzte echte Messung</b> · bisher ' + pz(q.live.breit) + " / 100 · Kandidat " + pz(q.kandidat.breit) + ' / 100 · <a data-tbReiter="qualitaet">Einzelergebnisse →</a></span></div>' : "") + "</div>"
      + '<div class="tb-karte"><h2>Vor dem Start</h2><div data-tbCheck>' + vorDemStart(w, o) + '</div><div class="tb-hinweis">ⓘ Offene Pflichtprüfung? Live bleibt gesperrt.</div></div>'
      + '<div class="tb-karte"><details><summary>Expertenoptionen · Trainingsrezept, Schritte, Lernrate</summary><p class="tb-dim">Diese Werte setzt die Fabrik-Kontrolle aus dem geprüften Rezept (motor-rezepte.json). '
      + "Sie sind hier bewusst nicht frei einstellbar, damit kein ungeprüftes Rezept startet.</p></details></div>"
      + '<div class="tb-karte"><h2>Automatik</h2><p>Aktueller Modus: <b>' + e((MODI.filter((m) => m[0] === mo)[0] || [0, mo])[1]) + '</b> · <a data-tbReiter="automatik">ändern →</a></p>'
      + '<div class="tb-klein">Du siehst vor dem Senden Ziel, Daten, Rechner und Grenzen. Die Fabrik prüft ein zweites Mal und quittiert (angenommen oder abgelehnt mit Grund).</div></div>'
      + "</div></div>"
      + '<div class="tb-karte tb-fussleiste"><button class="tb-knopf" type="button" data-tbEntwurf>Als Entwurf speichern</button>'
      + '<button class="tb-knopf primaer" type="submit"' + (s.listeOk ? "" : ' disabled title="Aufgaben-Schnittstelle nicht erreichbar"') + ">" + (s.bearbeite ? "Änderung senden" : "Prüfen &amp; einplanen") + "</button></div></form>";
  }

  function formWerte(form) {
    const f = new FormData(form);
    const datum = (v) => (v ? new Date(v).toISOString() : null);
    return {
      ziel: String(f.get("ziel") || "").trim(), typ: f.get("typ"), ausgangsmodell: f.get("ausgangsmodell"), ergebnis: f.get("ergebnis"),
      datensatz: f.get("datensatz") || null, themen: String(f.get("themen") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8),
      verwendung: f.get("verwendung"), start: datum(f.get("start")), ende: datum(f.get("ende")), maxStunden: Number(f.get("maxStunden") || 8),
      wiederholen: f.get("wiederholen"), prioritaet: f.get("prioritaet"), rechner: f.get("rechner"), stufe: f.get("stufe"),
      beiEnde: f.get("beiEnde"), abhaengigVon: f.get("abhaengigVon") || null
    };
  }

  // ------------------------------------------------------------ Automatik
  function automatik(o) {
    const a = o.t.automatik || {};
    const ein = Object.assign({}, a.einstellungen || {}, s.einst || {});
    const mo = ein.modus || a.modus || "auto";
    const mt = a.motor || {};
    const gesendet = s.einst && s.einst.nr;
    const stand = !gesendet ? pille("aktiv auf dem Rechner", "ok") : a.einstellungenNr === s.einst.nr ? (a.modusWirkt ? pille("übernommen und wirksam", "ok") : pille("übernommen, Wirkung prüfen", "warn")) : pille("gesendet, wartet auf Fabrik", "");
    const zahlFeld = (name, wert, mn, mx, schritt) => '<input type="number" name="' + name + '" min="' + mn + '" max="' + mx + '" step="' + (schritt || 1) + '" value="' + (wert == null ? "" : e(String(wert))) + '">';
    return '<form class="tb-form" data-tbEinst novalidate><div class="tb-reihe k2"><div class="tb-karte"><div class="tb-karte-kopf"><h2>Automatik-Modus</h2>' + stand + "</div>"
      + '<div class="tb-radio">' + MODI.map((m) => '<label class="' + (mo === m[0] ? "an" : "") + '"><input type="radio" name="modus" value="' + m[0] + '"' + (mo === m[0] ? " checked" : "") + "> " + e(m[1]) + "</label>").join("") + "</div>"
      + '<ul class="tb-pruefliste tb-oben">' + MODI.map((m) => "<li><b>" + e(m[1]) + ":</b>&nbsp;" + e(m[2]) + "</li>").join("") + "</ul>"
      + '<div class="tb-feldreihe tb-oben"><div><label>Erlaubte Themen (Komma)</label><input type="text" name="themen" maxlength="300" value="' + e((ein.themen || []).join(", ")) + '" placeholder="leer = alle geprüften Richtungen"></div>'
      + '<div><label>Zeitfenster</label><input type="text" name="zeitfenster" maxlength="11" value="' + e(ein.zeitfenster || "") + '" placeholder="leer = rund um die Uhr, z. B. 22:00-06:00"></div>'
      + "<div><label>Auftragslimit (wartend)</label>" + zahlFeld("auftragslimit", ein.auftragslimit == null ? 3 : ein.auftragslimit, 1, 10) + "</div></div>"
      + '<div class="tb-feldreihe"><div><label>Wiederholungsversuche</label>' + zahlFeld("versuche", ein.versuche == null ? 2 : ein.versuche, 1, 5) + '<div class="tb-klein">je Admin-Aufgabe; Motor: höchstens ' + e(String(mt.fehlschlagGrenze || 5)) + " Fehlschläge je Richtung (fest)</div></div>"
      + '<div><label>Benachrichtigen bei</label><div class="tb-radio">' + [["fehler", "Fehler"], ["entscheidung", "Entscheidung nötig"], ["fertig", "fertig"]].map((b) => '<label><input type="checkbox" name="benachrichtigen" value="' + b[0] + '"' + ((ein.benachrichtigen || ["fehler", "entscheidung"]).indexOf(b[0]) >= 0 ? " checked" : "") + "> " + b[1] + "</label>").join("") + "</div></div></div>"
      + '<div class="tb-hinweis">ⓘ <span>Push aufs Handy über den Fabrik-Wächter (alle 10 Min.): bei Leerlauf, knappem Vorrat und Schutzpausen immer; je Admin-Aufgabe nach dieser Auswahl (Fehler = abgelehnt/fehlgeschlagen, Entscheidung = Vorrat wartet auf Freigabe, fertig).</span></div></div>'
      + '<div class="tb-karte"><h2>Kosten- &amp; Speichergrenzen</h2><div class="tb-feldreihe zwei"><div><label>Strompreis (€ je kWh)</label>' + zahlFeld("strompreisEurKwh", ein.strompreisEurKwh, 0.01, 2, 0.001)
      + '</div><div><label>Quelle des Preises</label><input type="text" name="strompreisQuelle" maxlength="60" value="' + e(ein.strompreisQuelle || "") + '" placeholder="z. B. Stromrechnung 10/2026"></div></div>'
      + '<label>Speicher-Kontingent IDrive e2 (GB)</label>' + zahlFeld("speicherKontingentGb", ein.speicherKontingentGb, 1, 100000)
      + '<div class="tb-klein">Leer lassen, wenn unbekannt – dann bleibt die Kostenrechnung „nicht berechenbar“ statt 0 €.</div>'
      + '<h3 class="tb-oben">Motor (fest in der Fabrik)</h3><ul class="tb-pruefliste"><li><span class="ja">✓</span>Ziel ' + e(String(mt.zielStunden || 48)) + " Std. Vorrat · Reserve höchstens " + e(String(mt.reserveZiel || 3)) + " wartende Aufträge</li>"
      + "<li><span class=\"" + (mt.vorratKnapp ? "offen\">!" : "ja\">✓") + "</span>" + (mt.vorratKnapp ? "Vorrat knapp – neue Richtung nötig" : "Vorrat reicht") + "</li>"
      + "<li><span class=\"ja\">✓</span>" + zahl(mt.richtungen) + " Richtungen im Rezept, " + zahl(mt.angehalten) + " angehalten</li>"
      + "<li><span class=\"" + (mt.notaus ? "nein\">✗" : "ja\">✓") + "</span>Not-Aus " + (mt.notaus ? "AKTIV" : "aus") + " · Schutz (Hitze, RAM, Akku, Speicher) immer an</li></ul></div></div>"
      + '<div class="tb-karte tb-fussleiste"><span class="tb-klein">Änderungen gehen mit Grund ins Audit-Protokoll. Die Fabrik übernimmt sie im Minutentakt.</span>'
      + '<button class="tb-knopf primaer" type="submit"' + (s.listeOk ? "" : ' disabled title="Schnittstelle nicht erreichbar"') + ">Einstellungen senden</button></div></form>";
  }

  // ------------------------------------------------------------ Kosten
  function kosten(o) {
    const k = o.t.kosten || {};
    const preis = typeof k.strompreisEurKwh === "number" ? k.strompreisEurKwh : null;
    const en = k.energie || {};
    const eur = (wh) => (preis === null || typeof wh !== "number" ? '<span class="tb-pille warn">nicht berechenbar</span>' : zahl(wh / 1000 * preis, 2) + " € <span class=\"tb-klein\">geschätzt</span>");
    const zeile = (kenn, name) => {
      const x = en[kenn];
      const z = (p) => (x && x[p] ? zahl(x[p].wh / 1000, 2) + " kWh<div class=\"tb-klein\">" + zahl(x[p].stunden, 1) + " Std. gemessen · Ø " + zahl(x[p].mittelW, 1) + " W · " + x[p].proben + " Messpunkte</div>" : '<span class="tb-pille">nicht erfasst</span>');
      return "<tr><td><b>" + e(name) + '</b><div class="tb-klein">' + e(x && x.von ? H.tagUhr(x.von) + " – " + H.tagUhr(x.bis) : "keine Messpunkte") + "</div></td><td>" + z("h24") + "</td><td>" + eur(x && x.h24 && x.h24.wh) + "</td><td>" + z("t7") + "</td><td>" + eur(x && x.t7 && x.t7.wh) + "</td></tr>";
    };
    const pos = (s.kosten && s.kosten.uebernommen && s.kosten.uebernommen.positionen) || null;
    const offene = (s.liste || []).filter((x) => (x.aktion === "anlegen" || x.aktion === "aendern"));
    const mittelW = (r) => { const x = en[H.KAMEL[r === "auto" ? "macbook-pro" : r]]; return x && x.t7 ? x.t7.mittelW : null; };
    const belegt = o.speicher && o.speicher.gesamtBytes;
    const kont = typeof k.speicherKontingentGb === "number" ? k.speicherKontingentGb : null;
    return '<div class="tb-reihe k2"><div class="tb-karte"><div class="tb-karte-kopf"><h2>Fixkosten pro Monat</h2><span class="tb-klein">Quelle: Kostenpolitik (Zitat, keine Messung)</span></div>'
      + (pos ? '<div class="tb-daten-huelle"><table class="tb-daten"><thead><tr><th>Dienst</th><th>Zweck</th><th>Modell</th><th>Betrag</th></tr></thead><tbody>' + pos.map((p) => "<tr><td><b>" + e(p.dienst) + "</b></td><td>" + e(p.zweck) + "</td><td>" + e(p.modell) + '</td><td class="z">'
        + (typeof p.betragUsdProMonat === "number" ? zahl(p.betragUsdProMonat, 2) + " USD" : '<span class="tb-pille warn">nicht hinterlegt</span>') + "</td></tr>").join("") + "</tbody></table></div>"
        + '<div class="tb-klein">Summe bekannter Beträge: ' + zahl(s.kosten.uebernommen.festeSummeUsdProMonat, 2) + " USD/Monat (USD wie hinterlegt, keine Umrechnung). Gemeinsame Fixkosten werden hier nicht je Training verteilt.</div>"
        : '<div class="tb-hinweis warn">Kostenliste nicht geladen (Admin → Kosten &amp; Budgets).</div>')
      + '<div class="tb-hinweis">ⓘ <span>Die drei Fabrik-Rechner sind eigene, bezahlte Geräte: ein Trainingslauf dort verursacht keine zusätzlichen Hosting- oder Mietkosten. Variable Kosten entstehen nur als Strom.</span></div></div>'
      + '<div class="tb-karte"><h2>Speicher</h2><ul class="tb-pruefliste"><li><span class="ja">✓</span>Modelldateien in IDrive e2: <b>' + (typeof belegt === "number" ? zahl(belegt / 1e9, 1) + " GB" : "nicht erfasst") + "</b> (gemessen, nur Modelle)</li>"
      + "<li><span class=\"" + (kont ? "ja\">✓" : "offen\">?") + "</span>Kontingent: " + (kont ? zahl(kont) + " GB · verbleibend " + (typeof belegt === "number" ? zahl(kont - belegt / 1e9, 1) + " GB" : "nicht berechenbar") : "nicht hinterlegt") + "</li>"
      + '<li><span class="offen">?</span>Mehrkosten bei Überschreitung: nicht berechenbar (Jahrespaket ohne hinterlegten Preis)</li></ul>'
      + '<div class="tb-klein">Daten der Fabrik liegen lokal auf dem MacBook Pro (' + zahl(((o.t.wissen || {}).summen || {}).mb, 1) + " MB Lernstoff).</div></div></div>"
      + '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Energie &amp; Strom (gemessen, hochgerechnet)</h2>' + H.altText(k.stand, o.jetzt, 30) + "</div>"
      + '<div class="tb-daten-huelle"><table class="tb-daten"><thead><tr><th>Rechner</th><th>Letzte 24 Std.</th><th>Strom 24 Std.</th><th>Seit Messbeginn (≤ 7 Tage)</th><th>Strom</th></tr></thead><tbody>'
      + zeile("macbookPro", "MacBook Pro") + zeile("imac", "iMac") + zeile("macbookAir", "MacBook Air") + "</tbody></table></div>"
      + '<div class="tb-hinweis">ⓘ <span>Berechnung: Leistung (W) je Messpunkt × Zeit bis zum nächsten Messpunkt; Lücken über 40 Min. zählen nicht. Quelle: ' + e(k.quelle || "leistung33")
      + ". Strompreis: " + (preis === null ? "<b>nicht hinterlegt</b> – deshalb keine Euro-Werte. <a data-tbReiter=\"automatik\">Preis hinterlegen →</a>" : zahl(preis, 3) + " €/kWh (" + e(k.strompreisQuelle || "") + ")")
      + ". GPU-Auslastung ist kein Energieverbrauch.</span></div></div>"
      + '<div class="tb-karte"><h2>Geplante Aufgaben – Schätzung vor dem Start</h2>'
      + (offene.length ? '<div class="tb-daten-huelle"><table class="tb-daten"><thead><tr><th>Aufgabe</th><th>Rechner</th><th>Obergrenze Energie</th><th>Strom</th><th>Zusatzkosten Dienste</th></tr></thead><tbody>'
        + offene.map((x) => { const w = mittelW(x.rechner); const wh = typeof w === "number" ? w * (x.maxStunden || 0) : null;
          return "<tr><td>" + e(x.ziel) + "</td><td>" + e(H.NAME["fabrik-" + x.rechner] || "automatisch (Pro angenommen)") + '</td><td class="z">' + (wh === null ? "nicht berechenbar" : zahl(wh / 1000, 2) + " kWh") + '<div class="tb-klein">max. ' + e(String(x.maxStunden)) + " Std. × Ø " + zahl(w, 1) + " W</div></td><td>" + eur(wh) + "</td><td>0 € (eigene Geräte)</td></tr>"; }).join("") + "</tbody></table></div>"
        : '<p class="tb-dim">Keine geplante Admin-Aufgabe.</p>')
      + '<div class="tb-klein">Schätzung = Obergrenze aus maximaler Laufzeit und gemessener Durchschnittsleistung. Tatsächliche Werte je Aufgabe nach Abschluss: noch nicht je Aufgabe erfasst.</div></div>';
  }

  // ------------------------------------------------------------ Steuerung
  function zeichnen(ctx, deps) {
    const o = T.ordnen(s.d, Date.now());
    const inhalt = s.reiter === "ressourcen" ? T.ressourcen(o, deps.offen()) : s.reiter === "steuerung" ? T.steuerung(o, deps.offen()) : s.reiter === "aufgaben" ? aufgaben(o) : s.reiter === "neu" ? neu(o) : s.reiter === "wissen" ? T.wissen(o, s.rag)
      : s.reiter === "qualitaet" ? T.qualitaet(o) : s.reiter === "kosten" ? kosten(o) : s.reiter === "automatik" ? automatik(o)
        : s.reiter === "verlauf" ? T.verlauf(o, s.liste) : T.uebersicht(o, deps.offen());
    ctx.zeichne(T.rahmen(s.reiter === "neu" ? "aufgaben" : s.reiter, inhalt, o));
    binden(ctx, deps, o);
  }

  function reiter(ctx, deps, r) {
    s.reiter = r;
    if (r !== "neu") { s.bearbeite = null; s.rechnerVorgabe = null; }
    try { sessionStorage.setItem(REITER_SCHLUESSEL, r); } catch (_) { /* nur Bequemlichkeit */ }
    if (r === "wissen" && !s.rag) {
      A.hole("/api/admin/ops/wissen").then((a) => { if (a.ok) { s.rag = a.data; if (s.reiter === "wissen") zeichnen(ctx, deps); } });
    }
    if (r === "kosten" && !s.kosten) {
      A.hole("/api/admin/geld/kosten").then((a) => { if (a.ok) { s.kosten = a.data; if (s.reiter === "kosten") zeichnen(ctx, deps); } });
    }
    zeichnen(ctx, deps);
    window.scrollTo && window.scrollTo(0, 0);
  }

  async function senden(ctx, deps, knopf, pfad, body, titel) {
    const grund = await D.text({ titel: titel, absaetze: ["Wird mit Grund im Audit-Protokoll vermerkt. Die Fabrik prüft und quittiert im Minutentakt."], platzhalter: "Kurzer Grund", minLaenge: 5, okText: "Senden" });
    if (!grund) return null;
    if (knopf) { knopf.setAttribute("disabled", ""); knopf.textContent = "wird gesendet …"; }
    const a = await A.sende(pfad, Object.assign({ anfrageId: anfrageId(), reason: grund }, body));
    if (!a.ok) {
      if (knopf) { knopf.removeAttribute("disabled"); knopf.textContent = "Erneut senden"; }
      ctx.meldung(fehlerText(a), true);
      return null;
    }
    ctx.meldung((a.data && a.data.hinweis) || "Gesendet.", false);
    return a.data;
  }

  function binden(ctx, deps, o) {
    const alle = (sel, fn) => document.querySelectorAll(sel).forEach((el) => el.addEventListener("click", (ev) => fn(el, ev)));
    alle("[data-tbReiter]", (el, ev) => { ev.preventDefault(); reiter(ctx, deps, el.getAttribute("data-tbReiter")); });
    alle("[data-tbNeu]", (el) => { s.bearbeite = null; s.rechnerVorgabe = el.getAttribute("data-tbRechner"); s.reiter = "neu"; zeichnen(ctx, deps); });
    alle("[data-trNeu]", () => deps.neuLaden());
    alle("[data-tbThema]", (el) => {   // Hell/Dunkel sofort umschalten und je Gerät merken
      const w = el.getAttribute("data-tbThema") === "dunkel" ? "dunkel" : "hell";
      try { localStorage.setItem(T.THEMA_SCHLUESSEL, w); } catch (_) { /* nur Bequemlichkeit */ }
      const tb = document.querySelector("[data-tb]");
      if (tb) tb.classList.toggle("tb-dunkel", w === "dunkel");
      document.querySelectorAll("[data-tbThema]").forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("data-tbThema") === w)));
    });
    alle("[data-frRechner]", (el) => deps.wunsch(el.getAttribute("data-frRechner"), el.getAttribute("data-frZustand"), el.getAttribute("data-frStufe"),
      el.getAttribute("data-frBetrieb"), el.getAttribute("data-frEinmal") === "1"));
    alle("[data-tbLoesung]", (el) => { const box = document.querySelector("[data-tbLoesungen]"); if (!box) return; box.hidden = !box.hidden; el.setAttribute("aria-expanded", String(!box.hidden)); });
    alle("[data-tbBearbeite]", (el) => { s.bearbeite = el.getAttribute("data-tbBearbeite"); s.reiter = "neu"; zeichnen(ctx, deps); });
    alle("[data-tbZurueck]", async (el) => {
      const d = await senden(ctx, deps, el, "/api/admin/fabrik/auftrag", { aktion: "zurueckziehen", id: el.getAttribute("data-tbZurueck") }, "Aufgabe zurückziehen");
      if (d) deps.neuLaden();
    });
    alle("[data-tbFreigeben]", async (el) => {
      const d = await senden(ctx, deps, el, "/api/admin/fabrik/auftrag", { aktion: "job-freigeben", job: el.getAttribute("data-tbFreigeben") }, "Auftrag freigeben: " + el.getAttribute("data-tbFreigeben"));
      if (d) deps.neuLaden();
    });
    const form = document.querySelector("[data-tbForm]");
    if (form) {
      alle("[data-tbTyp]", (el) => { form.querySelector("[name=typ]").value = el.getAttribute("data-tbTyp"); form.querySelectorAll("[data-tbTyp]").forEach((b) => b.setAttribute("aria-pressed", String(b === el))); pruefen(); });
      const pruefen = () => {
        const w = formWerte(form);
        const box = form.querySelector("[data-tbCheck]");
        if (box) box.innerHTML = vorDemStart(w, o);
        form.querySelectorAll(".tb-radio label").forEach((l) => { const i = l.querySelector("input"); if (i) l.classList.toggle("an", i.checked); });
      };
      form.addEventListener("change", pruefen);
      alle("[data-tbEntwurf]", () => {
        try { localStorage.setItem(ENTWURF_SCHLUESSEL, JSON.stringify(formWerte(form))); ctx.meldung("Entwurf in diesem Browser gespeichert (nicht gesendet).", false); }
        catch (_) { ctx.meldung("Entwurf konnte in diesem Browser nicht gespeichert werden.", true); }
      });
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const w = formWerte(form);
        if (w.ziel.length < 10) return ctx.meldung(FEHLER.fabrik_ziel_zu_kurz, true);
        const knopf = form.querySelector("[type=submit]");
        const body = Object.assign({ aktion: s.bearbeite ? "aendern" : "anlegen", id: s.bearbeite || undefined }, w);
        const d = await senden(ctx, deps, knopf, "/api/admin/fabrik/auftrag", body, s.bearbeite ? "Änderung senden" : "Aufgabe einplanen: " + w.ziel.slice(0, 60));
        if (!d) return;
        try { localStorage.removeItem(ENTWURF_SCHLUESSEL); } catch (_) { /* nur Bequemlichkeit */ }
        s.bearbeite = null;
        s.reiter = "aufgaben";
        deps.neuLaden();
      });
    }
    const einst = document.querySelector("[data-tbEinst]");
    if (einst) {
      einst.addEventListener("change", () => einst.querySelectorAll(".tb-radio label").forEach((l) => { const i = l.querySelector("input"); if (i) l.classList.toggle("an", i.checked); }));
      einst.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = new FormData(einst);
        const zahlOderNull = (v) => (v === null || v === "" ? null : Number(v));
        const body = { modus: f.get("modus"), themen: String(f.get("themen") || "").split(",").map((x) => x.trim()).filter(Boolean),
          zeitfenster: String(f.get("zeitfenster") || "").trim() || null, auftragslimit: zahlOderNull(f.get("auftragslimit")), versuche: zahlOderNull(f.get("versuche")),
          benachrichtigen: f.getAll("benachrichtigen"), strompreisEurKwh: zahlOderNull(f.get("strompreisEurKwh")), strompreisQuelle: String(f.get("strompreisQuelle") || "").trim() || null,
          speicherKontingentGb: zahlOderNull(f.get("speicherKontingentGb")) };
        const d = await senden(ctx, deps, einst.querySelector("[type=submit]"), "/api/admin/fabrik/einstellungen", body, "Automatik: " + body.modus);
        if (d && d.einstellungen) { s.einst = d.einstellungen; deps.neuLaden(); }
      });
    }
  }

  /** Einstieg aus console-stage14.js. still = Minutentakt: Formulare werden dann nicht neu gezeichnet (Eingaben bleiben). */
  async function laden(ctx, deps, still) {
    const [mb, li] = await Promise.all([A.hole("/api/admin/ops/modellbestand"), A.hole("/api/admin/fabrik/auftraege")]);
    if (!mb.ok) {
      if (still && s.d) return ctx.meldung(mb.fehler, true);
      return ctx.fehler(mb.fehler);
    }
    s.d = mb.data;
    s.listeOk = li.ok;
    if (li.ok) {
      s.liste = (li.data && li.data.auftraege) || [];
      if (li.data && li.data.einstellungen && (!s.einst || li.data.einstellungen.nr >= s.einst.nr)) s.einst = li.data.einstellungen;
    }
    deps.aufraeumen(s.d);
    if (still && (s.reiter === "neu" || s.reiter === "automatik")) return;
    zeichnen(ctx, deps);
  }

  window.adminTraining = { laden: laden, _test: { formWerte: formWerte, vorDemStart: vorDemStart, kosten: kosten, aufgaben: aufgaben, neu: neu, automatik: automatik, zustand: s } };
})();
