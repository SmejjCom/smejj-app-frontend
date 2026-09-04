// smejj.com — zentraler API-Bereich (OpenRouter-Stil). Eine Flaeche, ZWEI
// REITER (Betreiber-Beschluss 2026-09-04, Plan Punkt 1):
//   * "Meine smejj-Schluessel" — was wir nach aussen anbieten
//     (/api/developer/keys), fuer Programme wie ZCode, Cline, Cursor. Oben die
//     drei Angaben zum Verbinden, darunter die Liste.
//   * "Eigene Anbieter" — BYOK (/api/keys), fremde Schluessel fuer den Chat,
//     serverseitig AES-256-GCM verschluesselt.
// Vorher lagen beide Arten gemischt in EINER Liste mit Typ-Spalte und
// Filter-Chips. Das war der Grund fuer "nicht uebersichtlich": zwei Dinge, die
// nichts miteinander zu tun haben, nebeneinander. Der Reiter IST jetzt der
// Filter — Typ-Chips im Formular und Filter-Chips ueber der Liste entfallen.
//
// Sicherheitsregeln unveraendert uebernommen: Der Klartext-Schluessel wird
// EINMAL angezeigt und nirgends abgelegt — kein localStorage, kein
// sessionStorage, keine zweite Abfrage. In der Liste nur der maskierte
// Pruefwert (keyHint). Wer ihn verliert, erzeugt einen neuen und widerruft
// den alten. Alle sichtbaren Texte ueber t() (Deutsch als Basis).
//
// Laufzeit (Betreiber-Beschluss 2026-09-03, docs/api/PLAN_API_SCHLUESSEL_
// LAUFZEIT_ADMIN_2026-09-03.md): beim Erstellen waehlt der Nutzer, wie lange
// der Schluessel gilt — Vorauswahl 1 Jahr, "unbefristet" nur nach Rueckfrage.
// Die Liste zeigt das Ablaufdatum, warnt 14 Tage vorher und markiert
// Abgelaufene rot. Verlaengern = neuen Schluessel erzeugen (Rotation).
//
// Zwei Orte, ein Modul: Einstellungen-Reiter "API" (kopf: "kompakt", die
// Panel-Ueberschrift liefert den Titel) und /entwickler.html
// (kopf: "voll"). Idempotent — Doppel-Init steigt aus.
import { afterFirstPaint } from "./deferred-start.js";
import { API_ORIGIN } from "./config.js";
import { catalogProvider, selectableProviders } from "./ai/providers-catalog.js?v=1";
import { t } from "./i18n/ui.js?v=3";
import { api, baseAnbieterId, cssEscape, datum, escapeAttr, escapeHtml, fehlerText, kurz, kurzZahl, statusStufe, usd, zahl } from "./api-center-helfer.js?v=1";

const MODELL_KEY = "smejj.model.selected.v2";
const AKTIVER_ANBIETER_KEY = "smejj.activeProvider.v1";
const BYOK_PREFIX = `${API_ORIGIN}/api/keys`;
const DEV_PREFIX = `${API_ORIGIN}/api/developer/keys`;
const DEV_GUTHABEN = `${API_ORIGIN}/api/developer/guthaben/checkout`;
const SUCHSCHWELLE = 5;
// Laufzeiten 1:1 wie der Server (publicApiKeys.js LAUFZEITEN). Der Server
// nennt sie auch in GET /api/developer/keys (laufzeiten) — die Liste hier
// ist die Anzeige-Reihenfolge samt Text, die Codes muessen dort vorkommen.
const LAUFZEITEN = [
  ["30t", "30 Tage"], ["90t", "90 Tage"], ["1j", "1 Jahr"], ["2j", "2 Jahre"], ["5j", "5 Jahre"],
  ["10j", "10 Jahre"], ["20j", "20 Jahre"], ["30j", "30 Jahre"], ["unbefristet", "Unbefristet"]
];
const LAUFZEIT_VORAUSWAHL = "1j";
const BALD_AB_MS = 14 * 86_400_000;

export function initApiCenter(wurzel, optionen = {}) {
  if (!wurzel || wurzel.querySelector("[data-ac-root]")) return;
  loadStyles();
  const kopf = optionen.kopf === "voll" ? "voll" : "kompakt";
  wurzel.insertAdjacentHTML("beforeend", markup(kopf));
  const root = wurzel.querySelector("[data-ac-root]");
  // reiter steuert alles: welche Liste, welches Formular, welche Spalten.
  const zustand = { reiter: "smejj", such: "", byok: null, dev: null };

  root.addEventListener("click", (event) => klick(root, zustand, event));
  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-ac-suche]")) return;
    zustand.such = event.target.value.trim().toLowerCase();
    filtere(root, zustand);
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-ac-provider]")) providerGewechselt(root);
  });
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.matches("[data-ac-form]")) absenden(root, zustand).catch((error) => melde(root, fehlerText(error), true));
  });

  // Erst nach dem ersten Bildaufbau (Architekturregel, Befund 2026-07-27).
  afterFirstPaint([() => laden(root, zustand).catch((error) => melde(root, fehlerText(error), true))]);
}

// ---- Aufbau -------------------------------------------------------------------

function markup(kopf) {
  const anbieterOptionen = selectableProviders()
    .map((entry) => `<option value="${entry.id}">${entry.name}</option>`).join("");
  const laufzeitOptionen = LAUFZEITEN
    .map(([code, text]) => `<option value="${code}"${code === LAUFZEIT_VORAUSWAHL ? " selected" : ""}>${t(text)}</option>`).join("");
  // Layout 1:1 nach OpenRouter/keys: grosse Ueberschrift, ein Hauptknopf,
  // keine Kacheln — das Konto liegt als schlanke Zeile darunter.
  const kopfZeile = kopf === "kompakt"
    ? `<span class="ac-sub">${t("smejj-Schlüssel und eigene Anbieter — verschlüsselt gespeichert.")}</span>`
    : `<span class="ac-breadcrumb">${t("Schlüssel erstellen und verwalten.")}</span>`;
  return `<div class="api-center-surface ac-surface" data-ac-root>
    ${kopfZeile}
    <div class="ac-head">
      <div>
        <h2>${t("API-Keys")}</h2>
        <p class="ac-subhead">${t("Schlüssel erstellen und verwalten — smejj-Schlüssel für Programme und eigene Anbieter-Schlüssel für den Chat. Alles verschlüsselt gespeichert.")}</p>
      </div>
      <span class="ac-spacer"></span>
      <button type="button" class="ac-primary" data-ac="neu">＋ ${t("Schlüssel erstellen")}</button>
    </div>

    <div class="ac-reiter" role="tablist" aria-label="${t("API-Keys")}">
      <button type="button" class="ac-reiter-knopf" role="tab" data-ac="reiter" data-reiter="smejj" aria-selected="true">${t("Meine smejj-Schlüssel")}</button>
      <button type="button" class="ac-reiter-knopf" role="tab" data-ac="reiter" data-reiter="anbieter" aria-selected="false">${t("Eigene Anbieter")}</button>
    </div>

    <div class="ac-stats" data-ac-stats hidden>
      <div class="ac-stat-block">
        <span class="ac-stat-label">GUTHABEN</span>
        <span class="ac-stat-value"><span data-ac-guthaben>–</span> USD</span>
        <button type="button" class="ac-stat-link" data-ac="aufladen" hidden>${t("Aufladen")}</button>
      </div>
      <div class="ac-stat-divider"></div>
      <div class="ac-stat-block">
        <span class="ac-stat-label">${t("Verbraucht")} (30 TAGE)</span>
        <span class="ac-stat-value"><span data-ac-verbraucht>–</span></span>
      </div>
      <div class="ac-stat-divider"></div>
      <div class="ac-stat-block">
        <span class="ac-stat-label">${t("HEUTE")}</span>
        <span class="ac-stat-value"><span data-ac-anfragen>0</span> ${t("Anfragen")}</span>
      </div>
      <div class="ac-stufen" data-ac-stufen hidden></div>
    </div>

    <form class="ac-form" data-ac-form hidden>
      <div data-ac-bereich="smejj">
        <label class="ac-field">${t("Name des Schlüssels")}
          <input data-ac-dev-name type="text" maxlength="60" autocomplete="off" spellcheck="false" placeholder="${t("Wofür? z. B. ZCode auf dem Laptop")}">
        </label>
        <label class="ac-field">${t("Laufzeit")}
          <select data-ac-laufzeit aria-label="${t("Laufzeit")}">${laufzeitOptionen}</select>
        </label>
        <p class="ac-klein">${t("Der Schlüssel beginnt mit")} <code class="ac-code">smejj-live-</code>${t("Er wird nur einmal angezeigt.")} ${t("Nach der Laufzeit lehnt die API ihn ab. Verlängern heißt: neuen Schlüssel erzeugen, alten widerrufen.")}</p>
      </div>
      <div data-ac-bereich="anbieter" hidden>
        <label class="ac-field">${t("Anbieter")}
          <select data-ac-provider aria-label="${t("Anbieter")}">
            ${anbieterOptionen}
            <option value="__custom">+ ${t("Eigenen Anbieter hinzufügen")}</option>
          </select>
        </label>
        <div class="ac-help" data-ac-help hidden><span data-ac-help-text></span></div>
        <div data-ac-custom hidden>
          <label class="ac-field">${t("Name des Anbieters")}<input data-ac-custom-name type="text" autocomplete="off" spellcheck="false" placeholder="${t("z. B. Mein Anbieter")}"></label>
          <label class="ac-field">${t("Basis-URL")}<input data-ac-custom-base type="url" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1"></label>
        </div>
        <label class="ac-field">${t("Name (optional)")}<input data-ac-name type="text" autocomplete="off" spellcheck="false" placeholder="${t("wird automatisch erzeugt")}"></label>
        <label class="ac-field">${t("API-Key")}<input data-ac-key class="ac-mono" type="password" autocomplete="new-password" spellcheck="false" placeholder="sk-…"></label>
      </div>
      <div class="ac-actions">
        <button type="submit" class="ac-primary" data-ac-erstelle>${t("Neuen Schlüssel erzeugen")}</button>
        <button type="button" class="ac-ghost" data-ac="form-zu">${t("Abbrechen")}</button>
      </div>
      <div class="ac-reveal" data-ac-reveal hidden></div>
    </form>

    <section class="ac-verbinden" data-ac-verbinden>
      <div class="ac-mini-row">${t("Basis-URL")} <code class="ac-code" data-ac-basis-url>https://api.smejj.com/v1</code><button type="button" class="ac-copy" data-ac="kopiere-basis" title="${t("Kopieren")}" aria-label="${t("Kopieren")}">⧉</button></div>
      <div class="ac-mini-row">${t("Modell")} <code class="ac-code">smejj-1.0</code></div>
      <button type="button" class="ac-mini-link" data-ac="zeige-beispiel">${t("curl-Beispiel anzeigen")}</button>
      <pre data-ac-beispiel hidden><code>curl <span data-ac-basis-url-2>https://api.smejj.com/v1</span>/chat/completions \
  -H "Authorization: Bearer smejj-live-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"smejj-1.0","messages":[{"role":"user","content":"Hallo"}]}'</code></pre>
    </section>

    <div class="ac-card">
      <div class="ac-toolbar">
        <input type="search" class="ac-search" data-ac-suche placeholder="• ${t("Nach Name suchen …")}" aria-label="${t("Nach Name oder Schlüssel suchen …")}">
      </div>
      <div class="ac-cols" data-ac-cols aria-hidden="true"></div>
      <div class="ac-rows" data-ac-rows></div>
      <div class="ac-foot-row">
        <span class="ac-count" data-ac-count title="${t("Läuft ab")}"></span>
        <p class="ac-foot">${t("Gelöschte Schlüssel verschwinden endgültig • Schlüssel werden nie im Klartext angezeigt")}</p>
      </div>
    </div>

    <div class="ac-unten">
      <section class="ac-unten-karte ac-token-card" data-ac-token-card hidden>
        <h3>${t("Token heute")}</h3>
        <span class="ac-token-big" data-ac-token>0</span>
        <span class="ac-token-verdacht">${t("Anfragen heute")}: —</span>
      </section>
      <details class="ac-anhang">
      <summary>${t("Preise")}</summary>
      <div class="ac-anhang-inhalt">
        <section class="ac-mini">
          <h3>${t("Preise")}</h3>
          <table class="ac-preise"><thead><tr><th>${t("Modell")}</th><th>${t("Eingabe")}</th><th>${t("Ausgabe")}</th></tr></thead><tbody data-ac-preise></tbody></table>
          <p class="ac-klein">${t("USD je 1 Million Token. Welches Modell dahinter rechnet, entscheidet smejj — Ihr Aufruf bleibt gleich.")}</p>
        </section>
      </div>
    </details>

    </div>
    <p class="ac-status" data-ac-status role="status" aria-live="polite">${t("Wird geladen …")}</p>
  </div>`;
}

// ---- Laden --------------------------------------------------------------------

async function laden(root, zustand) {
  melde(root, t("Wird geladen …"));
  const [byok, dev] = await Promise.allSettled([byokLaden(), devLaden()]);
  zustand.byok = byok.status === "fulfilled" ? byok.value : { fehler: byok.reason };
  zustand.dev = dev.status === "fulfilled" ? dev.value : { fehler: dev.reason };
  zeichneAlles(root, zustand);
  // allSettled wirft nicht: Fehler werden hier je Quelle sichtbar gemacht —
  // sonst verschluckt die Flaeche z. B. die Anmelde-Aufforderung still.
  const meldung = startmeldung(zustand);
  if (meldung) melde(root, meldung.text, meldung.fehler);
  else melde(root, "");
}

function startmeldung(zustand) {
  const fehler = [];
  if (zustand.byok?.fehler) fehler.push(zustand.byok.fehler);
  if (zustand.dev?.fehler) fehler.push(zustand.dev.fehler);
  if (fehler.some((e) => e?.code === "authentication_required" || e?.status === 401)) {
    return { text: t("Bitte zuerst bei smejj.com anmelden."), fehler: true };
  }
  if (fehler.length === 1 && fehler[0]?.code === "public_api_disabled") {
    return { text: t("Die Entwickler-API ist auf diesem Server noch nicht eingeschaltet."), fehler: true };
  }
  if (!reiterEintraege(zustand).length) {
    if (fehler.length) return { text: fehlerText(fehler[0]), fehler: true };
    return zustand.reiter === "smejj"
      ? { text: t("Noch keine Schlüssel. Erstelle deinen ersten Schlüssel."), fehler: false }
      : { text: t("Noch kein Anbieter verbunden. Hinterlege einen eigenen API-Key für den Chat."), fehler: false };
  }
  return null;
}

async function byokLaden() {
  const data = await api(BYOK_PREFIX, {});
  return {
    activeProviderId: data.activeProviderId || "",
    activeModel: data.activeModel || "",
    providers: Array.isArray(data.providers) ? data.providers : []
  };
}

async function devLaden() {
  return api(DEV_PREFIX, {});
}

// ---- Zeichnen -----------------------------------------------------------------

/** Alle Eintraege beider Arten — fuer Nachschlagen per id (Menue, Aktionen). */
function alleEintraege(zustand) {
  const byokOk = zustand.byok && !zustand.byok.fehler ? zustand.byok : null;
  const devOk = zustand.dev && !zustand.dev.fehler ? zustand.dev : null;
  const smejj = devOk ? (devOk.schluessel || []).map((k) => smejjEintrag(k)) : [];
  const anbieter = byokOk ? byokOk.providers.map((p) => anbieterEintrag(p, byokOk)) : [];
  return [...smejj, ...anbieter];
}

/** Was im offenen Reiter steht — die Liste zeigt nur diese. */
function reiterEintraege(zustand) {
  return alleEintraege(zustand).filter((e) => e.art === zustand.reiter);
}

function smejjEintrag(k) {
  const widerrufen = k.zustand === "widerrufen";
  const inaktiv = k.zustand === "inaktiv";
  // "abgelaufen" sagt der Server; die Vorwarnung (14 Tage) rechnet die Flaeche
  // aus dem Ablaufdatum, damit kein zweiter Serverbegriff noetig ist.
  const ablaufMs = Date.parse(k.laeuftAbAm || "");
  const abgelaufen = k.zustand === "abgelaufen" || (Number.isFinite(ablaufMs) && ablaufMs <= Date.now() && !widerrufen);
  const baldAb = !widerrufen && !abgelaufen && Number.isFinite(ablaufMs) && ablaufMs - Date.now() < BALD_AB_MS;
  const status = widerrufen ? { lvl: "o", txt: t("Widerrufen") }
    : abgelaufen ? { lvl: "r", txt: t("Abgelaufen") }
    : inaktiv ? { lvl: "o", txt: t("Inaktiv") }
    : baldAb ? { lvl: "y", txt: t("Läuft bald ab") }
    : { lvl: "g", txt: t("Aktiv") };
  return {
    art: "smejj", id: k.id,
    name: k.name || t("Ohne Namen"),
    hinweis: k.keyHint || "",
    erstellt: datum(k.erstelltAm),
    laeuftAb: datum(k.laeuftAbAm),
    zuletztBenutzt: datum(k.zuletztBenutztAm),
    nutzungAnfragen: (k.nutzung && k.nutzung.anfragen) || 0,
    nutzungToken: (k.nutzung && k.nutzung.token) || 0,
    widerrufen, inaktiv, abgelaufen,
    status,
    off: widerrufen || abgelaufen
  };
}

function anbieterEintrag(p, byok) {
  const lvl = statusStufe(p);
  const aktiv = p.id === byok.activeProviderId && !!byok.activeModel;
  const hinweis = aktiv && p.selectedModel
    ? `${kurz(p.selectedModel)} · ${t("aktives Modell")}`
    : (p.keyHint || (p.selectedModel ? kurz(p.selectedModel) : ""));
  const status = lvl === "red" ? { lvl: "r", txt: t("Ungültig") }
    : lvl === "yellow" ? { lvl: "y", txt: t("Guthaben niedrig") }
    : { lvl: "g", txt: t("Getestet") };
  return {
    art: "anbieter", id: p.id, provider: p, name: p.name.split(" · ")[0], hinweis, erstellt: "",
    modell: p.selectedModel ? kurz(p.selectedModel) : "",
    status, off: false
  };
}

function zeichneAlles(root, zustand) {
  zeichneKonto(root, zustand);
  zeichneVerbindung(root, zustand);
  zeichneListe(root, zustand);
}

function zeichneKonto(root, zustand) {
  const guthaben = zustand.dev && !zustand.dev.fehler ? zustand.dev.guthaben : null;
  const verbrauch = zustand.dev && !zustand.dev.fehler ? zustand.dev.verbrauch : null;
  const stats = root.querySelector("[data-ac-stats]");
  stats.hidden = !guthaben;
  if (!guthaben) return;
  root.querySelector("[data-ac-guthaben]").textContent = usd(guthaben.usd);
  root.querySelector("[data-ac-verbraucht]").textContent = usd(guthaben.verbrauchtUsd);
  root.querySelector("[data-ac-anfragen]").textContent = zahl(verbrauch?.anfragen);
  root.querySelector("[data-ac-token]").textContent = zahl(verbrauch?.gesamtTokens);
  const aufladen = root.querySelector("[data-ac='aufladen']");
  aufladen.hidden = guthaben.aufladenMoeglich === false;
  aufladen.dataset.stufen = JSON.stringify(guthaben.stufenUsd || []);
  // Token-Karte
  const tokenCard = root.querySelector("[data-ac-token-card]");
  const tokens = verbrauch?.gesamtTokens || 0;
  const anfragenVal = verbrauch?.anfragen || 0;
  tokenCard.hidden = !tokens && !anfragenVal;
  root.querySelector("[data-ac-token]").textContent = kurzZahl(tokens);
  const verd = root.querySelector(".ac-token-verdacht");
  const verbrauchtUsd = guthaben?.verbrauchtUsd || 0;
  verd.textContent = verbrauchtUsd ? `$${usd(verbrauchtUsd)} · ${kurzZahl(tokens)} Token` : "—";
}

function zeichneVerbindung(root, zustand) {
  const devOk = zustand.dev && !zustand.dev.fehler ? zustand.dev : null;
  const basis = devOk?.basisUrl || "https://api.smejj.com/v1";
  root.querySelectorAll("[data-ac-basis-url],[data-ac-basis-url-2]").forEach((el) => { el.textContent = basis; });
  const tbody = root.querySelector("[data-ac-preise]");
  tbody.textContent = "";
  const preise = devOk?.preise || {};
  for (const [id, satz] of Object.entries(preise)) {
    const tr = document.createElement("tr");
    for (const text of [id, `${Number(satz.eingabe).toFixed(2)} $`, `${Number(satz.ausgabe).toFixed(2)} $`]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  if (!Object.keys(preise).length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = t("Keine Modelle verfügbar.");
    tr.append(td);
    tbody.append(tr);
  }
}

function zeichneListe(root, zustand) {
  const eintraege = reiterEintraege(zustand);
  const liste = root.querySelector("[data-ac-rows]");
  liste.textContent = "";
  liste.innerHTML = eintraege.map((eintrag) => zeilenMarkup(eintrag, zustand)).join("");
  // Spaltenkoepfe gehoeren zum Reiter: ein Anbieter hat kein Ablaufdatum, ein
  // smejj-Schluessel kein Modell. Eine gemeinsame Kopfzeile waere fuer beide falsch.
  root.querySelector("[data-ac-cols]").innerHTML = zustand.reiter === "smejj"
    ? `<span>${t("Schlüssel")}</span><span>${t("Status")}</span><span>${t("Läuft ab")}</span><span>${t("Zuletzt genutzt")}</span><span></span>`
    : `<span>${t("Anbieter")}</span><span>${t("Status")}</span><span>${t("Modell")}</span><span></span>`;
  root.querySelector("[data-ac-verbinden]").hidden = zustand.reiter !== "smejj";
  const anzahl = eintraege.length;
  root.querySelector("[data-ac-count]").textContent = anzahl
    ? `${zahl(anzahl)} ${zustand.reiter === "smejj" ? t("Schlüssel") : t("Anbieter")}`
    : "";
  filtere(root, zustand);
}


function zeilenMarkup(eintrag, zustand) {
  const suchText = escapeAttr(`${eintrag.name} ${eintrag.hinweis} ${eintrag.art}`.toLowerCase());
  const klassen = ["ac-row"];
  if (eintrag.status.lvl === "r") klassen.push("ac-row-red");
  if (eintrag.off) klassen.push("ac-row-off");
  const badge = `<span class="ac-badge ac-badge-${eintrag.status.lvl}">• ${escapeHtml(eintrag.status.txt)}</span>`;
  return `<div class="${klassen.join(" ")}" data-ac-zeile="${escapeAttr(eintrag.id)}" data-art="${eintrag.art}" data-name="${suchText}">
    <div class="ac-who">
      <span class="ac-name">${escapeHtml(eintrag.name)}</span>
      <span class="ac-sub"><code>${escapeHtml(eintrag.hinweis)}</code>${eintrag.erstellt ? ` · ${escapeHtml(eintrag.erstellt)}` : ""}${eintrag.laeuftAb ? ` · ${t("Läuft ab")} ${escapeHtml(eintrag.laeuftAb)}` : ""}</span>
      <button type="button" class="ac-row-copy" data-ac="kopieren" data-id="${escapeAttr(eintrag.id)}" title="${t("Kopieren")}" aria-label="${t("Kopieren")}">⧉</button>
    </div>
    <span class="ac-cell ac-cell-status">${badge}</span>
    ${eintrag.art === "smejj"
      ? `<span class="ac-cell ac-cell-ablauf">${eintrag.laeuftAb ? escapeHtml(eintrag.laeuftAb) : t("Unbefristet")}</span>
    <span class="ac-cell ac-cell-when">${eintrag.zuletztBenutzt || t("Nie")}</span>`
      : `<span class="ac-cell ac-cell-modell">${escapeHtml(eintrag.modell || "—")}</span>`}
    <span class="ac-zelle-menu"><button type="button" class="ac-kebab" data-ac="menue" data-popid="${escapeAttr(popId(eintrag))}" aria-haspopup="menu" aria-expanded="false" aria-label="${t("Weitere Aktionen")}">…</button></span>
    <div class="ac-popover" data-ac-pop="${escapeAttr(popId(eintrag))}" role="menu" hidden></div>
  </div>`;
}

function popId(eintrag) {
  return `${eintrag.art}:${eintrag.id}`;
}

// ---- Interaktion --------------------------------------------------------------

async function klick(root, zustand, event) {
  const trigger = event.target.closest("[data-ac]");
  if (!trigger) return schliessePopovers(root);
  const aktion = trigger.dataset.ac;
  if (aktion === "neu") return oeffneFormular(root, true, zustand);
  if (aktion === "form-zu") return oeffneFormular(root, false, zustand);
  if (aktion === "reiter") return reiterWahl(root, zustand, trigger.dataset.reiter);
  if (aktion === "menue") return menue(root, zustand, trigger.dataset.popid);
  if (aktion === "modell-waehlen") return modellMenue(root, zustand, trigger.dataset.popid);
  if (aktion === "kopieren") return kopiereHint(root, zustand, trigger.dataset.id);
  if (aktion === "widerrufen") return widerrufe(root, zustand, trigger.dataset.id);
  if (aktion === "umbenennen") return umbenenne(root, zustand, trigger.dataset.id);
  if (aktion === "loeschen") return loescheEndgueltig(root, zustand, trigger.dataset.id);
  if (aktion === "umschalten") return schalteUm(root, zustand, trigger.dataset.id);
  if (aktion === "aktivitaet") return zeigeAktivitaet(root, zustand, trigger.dataset.id);
  if (aktion === "entfernen") return entferne(root, zustand, trigger.dataset.id);
  if (aktion === "aufladen") return stufenMenue(root, trigger);
  if (aktion === "kopiere-basis") return kopiereText(root, root.querySelector("[data-ac-basis-url]")?.textContent || "");
  if (aktion === "zeige-beispiel") {
    const pre = root.querySelector("[data-ac-beispiel]");
    if (pre) pre.hidden = !pre.hidden;
    return;
  }
  if (aktion === "stufe") {
    root.querySelector("[data-ac-stufen]").hidden = true;
    return ladeAuf(root, Number(trigger.dataset.betrag));
  }
}

function oeffneFormular(root, offen, zustand) {
  const form = root.querySelector("[data-ac-form]");
  form.hidden = !offen;
  if (offen) {
    // Das Formular gehoert zum offenen Reiter — es gibt keine zweite Wahl mehr.
    formularFuerReiter(root, zustand);
    if (zustand.reiter === "anbieter") providerGewechselt(root);
    const erstes = zustand.reiter === "smejj"
      ? form.querySelector("[data-ac-dev-name]")
      : form.querySelector("[data-ac-key]");
    erstes?.focus();
  } else {
    form.reset();
    form.querySelector("[data-ac-reveal]").hidden = true;
  }
}

function formularFuerReiter(root, zustand) {
  const form = root.querySelector("[data-ac-form]");
  form.querySelector("[data-ac-bereich='smejj']").hidden = zustand.reiter !== "smejj";
  form.querySelector("[data-ac-bereich='anbieter']").hidden = zustand.reiter !== "anbieter";
  form.querySelector("[data-ac-erstelle]").textContent = zustand.reiter === "smejj"
    ? t("Neuen Schlüssel erzeugen") : t("Prüfen und verbinden");
}

function reiterWahl(root, zustand, reiter) {
  zustand.reiter = reiter === "anbieter" ? "anbieter" : "smejj";
  root.querySelectorAll("[data-ac='reiter']").forEach((knopf) => {
    knopf.setAttribute("aria-selected", String(knopf.dataset.reiter === zustand.reiter));
  });
  // Ein halb ausgefuelltes Formular des anderen Reiters waere eine Falle.
  oeffneFormular(root, false, zustand);
  zeichneListe(root, zustand);
  const meldung = startmeldung(zustand);
  melde(root, meldung ? meldung.text : "", Boolean(meldung?.fehler));
}

// Der Reiter hat schon aussortiert; hier wirkt nur noch die Suche.
function filtere(root, zustand) {
  const frage = root.querySelector("[data-ac-suche]").value.trim().toLowerCase();
  let sichtbar = 0;
  root.querySelectorAll("[data-ac-zeile]").forEach((zeile) => {
    const zeige = !frage || (zeile.dataset.name || "").includes(frage);
    zeile.style.display = zeige ? "" : "none";
    if (zeige) sichtbar += 1;
  });
  if (!frage) return;
  const wort = zustand.reiter === "smejj" ? t("Schlüssel") : t("Anbieter");
  root.querySelector("[data-ac-count]").textContent = `${zahl(sichtbar)} ${wort}`;
}

function schliessePopovers(root) {
  root.querySelectorAll(".ac-popover").forEach((pop) => { pop.hidden = true; });
  root.querySelector("[data-ac-stufen]").hidden = true;
  root.querySelectorAll('[aria-expanded="true"]').forEach((knopf) => knopf.setAttribute("aria-expanded", "false"));
}

function stufenMenue(root, trigger) {
  const box = root.querySelector("[data-ac-stufen]");
  if (!box.hidden) { box.hidden = true; return; }
  let stufen = [];
  try { stufen = JSON.parse(trigger.dataset.stufen || "[]"); } catch { stufen = []; }
  if (!stufen.length) return melde(root, t("Aufladen ist auf diesem Server noch nicht eingerichtet."), true);
  box.textContent = "";
  for (const betrag of stufen) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.dataset.ac = "stufe";
    knopf.dataset.betrag = String(betrag);
    knopf.textContent = `+ ${betrag} USD`;
    box.append(knopf);
  }
  box.hidden = false;
}

async function ladeAuf(root, betragUsd) {
  if (!Number.isFinite(betragUsd) || betragUsd <= 0) return;
  melde(root, t("Weiter zu Stripe …"));
  try {
    const daten = await api(DEV_GUTHABEN, { method: "POST", body: { betragUsd } });
    if (daten.url) location.assign(daten.url);
  } catch (error) {
    melde(root, fehlerText(error), true);
  }
}

// ---- Zeilen-Menue -------------------------------------------------------------

async function menue(root, zustand, popid) {
  const pop = root.querySelector(`[data-ac-pop="${cssEscape(popid)}"]`);
  if (!pop) return;
  if (!pop.hidden) return schliessePopovers(root);
  schliessePopovers(root);
  pop.innerHTML = menueMarkup(root, zustand, popid);
  pop.hidden = false;
  const knopf = pop.parentElement?.querySelector('[data-ac="menue"][aria-expanded="false"]');
  if (knopf) knopf.setAttribute("aria-expanded", "true");
}

function menueMarkup(root, zustand, popid) {
  const eintrag = alleEintraege(zustand).find((e) => popId(e) === popid);
  if (!eintrag) return `<div class="ac-pop-empty">${t("Keine Modelle verfügbar.")}</div>`;
  const teile = [];
  if (eintrag.art === "smejj") {
    // Menue 1:1 wie OpenRouter/keys: Bearbeiten, Aktivitaet, Deaktivieren, Loeschen.
    // Loeschen ist ENDGUELTIG (Eintrag verschwindet sofort und fuer immer) — der
    // umkehrbare Schritt ist "Deaktivieren". Widerrufene bleiben nur bis zum
    // naechsten Klick: "Endgültig löschen" nimmt sie ganz raus.
    if (!eintrag.widerrufen) {
      teile.push(`<button type="button" role="menuitem" class="ac-item" data-ac="umbenennen" data-id="${escapeAttr(eintrag.id)}"><span class="ac-item-icon">✎</span>${t("Bearbeiten")}</button>`);
      teile.push(`<button type="button" role="menuitem" class="ac-item" data-ac="aktivitaet" data-id="${escapeAttr(eintrag.id)}"><span class="ac-item-icon">📊</span>${t("Aktivität")}</button>`);
      teile.push(`<button type="button" role="menuitem" class="ac-item" data-ac="umschalten" data-id="${escapeAttr(eintrag.id)}"><span class="ac-item-icon">⊗</span>${eintrag.inaktiv ? t("Aktivieren") : t("Deaktivieren")}</button>`);
    }
    teile.push(`<button type="button" role="menuitem" class="ac-item" data-ac="kopieren" data-id="${escapeAttr(eintrag.id)}"><span class="ac-item-icon">⧉</span>${t("Maskierten Schlüssel kopieren")}</button>`);
    teile.push(`<button type="button" role="menuitem" class="ac-item ac-item-danger" data-ac="loeschen" data-id="${escapeAttr(eintrag.id)}"><span class="ac-item-icon">🗑</span>${eintrag.widerrufen ? t("Endgültig löschen") : t("Löschen")}</button>`);
  } else {
    const cat = catalogProvider(baseAnbieterId(eintrag.id));
    if (eintrag.provider.modelCount > 1 || eintrag.provider.selectedModel) {
      teile.push(`<button type="button" role="menuitem" class="ac-item" data-ac="modell-waehlen" data-popid="${escapeAttr(popid)}"><span class="ac-item-icon">☰</span>${t("Modell wählen")}</button>`);
    }
    if (cat?.billingUrl) {
      teile.push(`<a role="menuitem" class="ac-item" href="${escapeAttr(cat.billingUrl)}" target="_blank" rel="noopener noreferrer"><span class="ac-item-icon">＋</span>${t("Guthaben aufladen")}</a>`);
    }
    teile.push(`<button type="button" role="menuitem" class="ac-item" data-ac="kopieren" data-id="${escapeAttr(eintrag.id)}"><span class="ac-item-icon">⧉</span>${t("Maskierten Schlüssel kopieren")}</button>`);
    teile.push(`<button type="button" role="menuitem" class="ac-item ac-item-danger" data-ac="entfernen" data-id="${escapeAttr(eintrag.id)}"><span class="ac-item-icon">🗑</span>${t("Entfernen")}</button>`);
  }
  return teile.join("");
}

async function modellMenue(root, zustand, popid) {
  const pop = root.querySelector(`[data-ac-pop="${cssEscape(popid)}"]`);
  if (!pop) return;
  const eintrag = alleEintraege(zustand).find((e) => popId(e) === popid);
  if (!eintrag || eintrag.art !== "anbieter") return;
  pop.innerHTML = `<div class="ac-pop-loading">${t("Modelle werden geladen…")}</div>`;
  const modelle = await api(`${BYOK_PREFIX}/${encodeURIComponent(eintrag.id)}/models`, {}).then((r) => r.models || []).catch(() => []);
  if (!modelle.length) {
    pop.innerHTML = `<div class="ac-pop-empty">${t("Keine Modelle verfügbar.")}</div>`;
    return;
  }
  pop.innerHTML = gruppeMarkup(eintrag, zustand, modelle);
  pop.querySelectorAll("[data-ac-pick]").forEach((item) => item.addEventListener("click", () => {
    waehleModell(root, zustand, eintrag.id, item.dataset.model);
  }));
}

function gruppeMarkup(eintrag, zustand, modelle) {
  const aktiv = zustand.byok && !zustand.byok.fehler ? zustand.byok : null;
  const teile = modelle.slice(0, 40).map((m) => {
    const geprueft = aktiv && eintrag.id === aktiv.activeProviderId && m.id === aktiv.activeModel;
    return `<button type="button" role="menuitemradio" class="ac-item" aria-checked="${geprueft}" data-ac-pick data-model="${escapeAttr(m.id)}">${geprueft ? "✓ " : ""}${escapeHtml(kurz(m.id))}</button>`;
  }).join("");
  const mehr = modelle.length > 40 ? `<div class="ac-pop-more">${t("Alle")} ${modelle.length} ${t("Modelle")}</div>` : "";
  return `${teile}${mehr}`;
}

async function waehleModell(root, zustand, providerId, model) {
  schliessePopovers(root);
  try {
    const ergebnis = await api(`${BYOK_PREFIX}/${encodeURIComponent(providerId)}/select`, { method: "POST", body: { model } });
    uebernimmWahl(providerId, ergebnis.selectedModel || model);
    await laden(root, zustand);
    melde(root, `${t("Modell ohne Neustart gewechselt:")} ${kurz(ergebnis.selectedModel || model)}`);
  } catch (error) {
    melde(root, fehlerText(error), true);
  }
}

// Uebernimmt die Auswahl sofort in Modell-Picker + Chat-Routing (ohne Neustart).
function uebernimmWahl(providerId, model) {
  localStorage.setItem(MODELL_KEY, `key:${providerId}`);
  localStorage.setItem(AKTIVER_ANBIETER_KEY, JSON.stringify({ providerId, model }));
  const picker = document.querySelector("#modelPickerButton");
  const cat = catalogProvider(baseAnbieterId(providerId));
  if (picker) picker.textContent = `${cat?.name || "BYOK"} · ${kurz(model)}`;
  document.dispatchEvent(new CustomEvent("smejj:provider-selected", { detail: { providerId, model } }));
}

function kopiereHint(root, zustand, id) {
  schliessePopovers(root);
  const eintrag = alleEintraege(zustand).find((e) => e.id === id);
  const wert = eintrag?.hinweis || "";
  if (!wert) return;
  navigator.clipboard?.writeText(wert).then(() => melde(root, t("Maskierter Schlüssel kopiert.")));
}

function kopiereText(root, text) {
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => melde(root, t("In die Zwischenablage kopiert.")));
}

async function loescheEndgueltig(root, zustand, id) {
  const eintrag = alleEintraege(zustand).find((e) => e.id === id);
  const name = eintrag ? `\n${eintrag.name}` : "";
  if (!confirm(`${t("Endgültig löschen? Der Schlüssel verschwindet komplett und kann nicht zurückgeholt werden. Programme mit diesem Schlüssel bekommen danach 401.")}${name}`)) return;
  try {
    await api(`${DEV_PREFIX}/${encodeURIComponent(id)}/delete`, { method: "POST", body: {} });
    await laden(root, zustand);
    melde(root, t("Schlüssel endgültig gelöscht."));
  } catch (error) {
    melde(root, fehlerText(error), true);
  }
}

async function entferne(root, zustand, id) {
  const eintrag = alleEintraege(zustand).find((e) => e.id === id);
  if (!confirm(`${t("Verbindung wirklich entfernen?")}${eintrag ? ` (${eintrag.name})` : ""}`)) return;
  try {
    await api(`${BYOK_PREFIX}/${encodeURIComponent(id)}/remove`, { method: "POST", body: {} });
    const byok = zustand.byok;
    if (byok && !byok.fehler && localStorage.getItem(MODELL_KEY) === `key:${id}`) localStorage.removeItem(MODELL_KEY);
    await laden(root, zustand);
    melde(root, t("Verbindung wurde entfernt."));
  } catch (error) {
    melde(root, fehlerText(error), true);
  }
}

async function umbenenne(root, zustand, id) {
  schliessePopovers(root);
  const eintrag = alleEintraege(zustand).find((e) => e.id === id);
  if (!eintrag) return;
  const name = prompt(t("Neuer Name für den Schlüssel"), eintrag.name);
  if (name === null) return;
  if (!name.trim()) return melde(root, t("Der Name darf nicht leer sein."), true);
  try {
    await api(`${DEV_PREFIX}/${encodeURIComponent(id)}/rename`, { method: "POST", body: { name: name.trim() } });
    await laden(root, zustand);
    melde(root, t("Name geändert."));
  } catch (error) {
    melde(root, fehlerText(error), true);
  }
}

async function schalteUm(root, zustand, id) {
  schliessePopovers(root);
  const eintrag = alleEintraege(zustand).find((e) => e.id === id);
  if (!eintrag) return;
  const aktiv = !!eintrag.inaktiv;
  try {
    await api(`${DEV_PREFIX}/${encodeURIComponent(id)}/toggle`, { method: "POST", body: { aktiv } });
    await laden(root, zustand);
    melde(root, aktiv ? t("Schlüssel aktiviert.") : t("Schlüssel deaktiviert — Aufrufe bekommen jetzt 401."));
  } catch (error) {
    melde(root, fehlerText(error), true);
  }
}

function zeigeAktivitaet(root, zustand, id) {
  schliessePopovers(root);
  const eintrag = alleEintraege(zustand).find((e) => e.id === id);
  if (!eintrag) return;
  const zeilen = [
    [t("Zuletzt genutzt"), eintrag.zuletztBenutzt || t("Nie")],
    [t("Anfragen"), zahl(eintrag.nutzungAnfragen)],
    [t("Token"), zahl(eintrag.nutzungToken)],
    [t("Erstellt"), eintrag.erstellt || "—"],
    [t("Läuft ab"), eintrag.laeuftAb || t("Unbefristet")]
  ];
  const pop = root.querySelector(`[data-ac-zeile="${cssEscape(id)}"] .ac-popover`);
  if (!pop) return;
  pop.innerHTML = `<div class="ac-aktivitaet">
    <div class="ac-pop-head">${escapeHtml(eintrag.name)}</div>
    ${zeilen.map(([label, wert]) => `<div class="ac-aktivitaet-zeile"><span>${escapeHtml(label)}</span><b>${escapeHtml(String(wert))}</b></div>`).join("")}
  </div>`;
  pop.hidden = false;
}

// ---- Formular absenden --------------------------------------------------------

async function absenden(root, zustand) {
  if (zustand.reiter === "smejj") return erzeugeSmejjSchluessel(root, zustand);
  return verbindeAnbieter(root, zustand);
}

async function erzeugeSmejjSchluessel(root, zustand) {
  const feld = root.querySelector("[data-ac-dev-name]");
  const name = feld.value.trim();
  const wahl = root.querySelector("[data-ac-laufzeit]");
  const laufzeit = wahl?.value || LAUFZEIT_VORAUSWAHL;
  // Unbefristet nur bewusst: einmal nachfragen, dann respektieren.
  if (laufzeit === "unbefristet" && !confirm(t("Unbefristet wirklich? Dieser Schlüssel läuft nie von selbst ab. Er gilt, bis du ihn widerrufst."))) return;
  setzeBeschaeftigt(root, true);
  try {
    const daten = await api(DEV_PREFIX, { method: "POST", body: { name, laufzeit } });
    zeigeEinmal(root, daten.apiKey || "");
    feld.value = "";
    if (wahl) wahl.value = LAUFZEIT_VORAUSWAHL;
    await laden(root, zustand);
    melde(root, t("Schlüssel erzeugt. Jetzt kopieren — er wird nicht noch einmal angezeigt."));
  } finally {
    setzeBeschaeftigt(root, false);
  }
}

async function verbindeAnbieter(root, zustand) {
  const select = root.querySelector("[data-ac-provider]");
  const eigen = select.value === "__custom";
  const apiKey = root.querySelector("[data-ac-key]").value.trim();
  if (!apiKey) return melde(root, t("API-Key fehlt."), true);
  const body = { apiKey, name: root.querySelector("[data-ac-name]").value.trim() };
  if (eigen) {
    body.providerId = "custom";
    body.name = root.querySelector("[data-ac-custom-name]").value.trim() || body.name;
    body.baseUrl = root.querySelector("[data-ac-custom-base]").value.trim();
    if (!body.baseUrl) return melde(root, t("Basis-URL fehlt."), true);
  } else body.providerId = select.value;
  setzeBeschaeftigt(root, true);
  melde(root, t("Key wird geprüft und anschließend verschlüsselt gespeichert…"));
  try {
    const ergebnis = await api(BYOK_PREFIX, { method: "POST", body });
    // Vollständiger Key nur EINMAL sichtbar, danach nie wieder.
    zeigeEinmal(root, apiKey);
    root.querySelector("[data-ac-key]").value = "";
    await laden(root, zustand);
    melde(root, `${t("Verbunden und getestet.")} ${ergebnis.selectedModel ? kurz(ergebnis.selectedModel) : ""}`.trim());
  } catch (error) {
    melde(root, fehlerText(error), true);
  } finally {
    setzeBeschaeftigt(root, false);
  }
}

function zeigeEinmal(root, apiKey) {
  const box = root.querySelector("[data-ac-reveal]");
  box.hidden = false;
  box.innerHTML = `<div class="ac-reveal-key"><code>${escapeHtml(apiKey)}</code>
    <button type="button" class="ac-copy" data-ac-kopiere-voll title="${t("Kopieren")}" aria-label="${t("Kopieren")}">⧉</button></div>
    <span class="ac-reveal-note">${t("wird danach nicht mehr angezeigt")}</span>
    <button type="button" class="ac-primary ac-reveal-done" data-ac="form-zu">${t("Fertig")}</button>`;
  box.querySelector("[data-ac-kopiere-voll]").addEventListener("click", () => {
    navigator.clipboard?.writeText(apiKey).then(() => melde(root, t("In die Zwischenablage kopiert.")));
  });
}

function providerGewechselt(root) {
  const value = root.querySelector("[data-ac-provider]").value;
  const eigen = value === "__custom";
  root.querySelector("[data-ac-custom]").hidden = !eigen;
  const help = root.querySelector("[data-ac-help]");
  const cat = eigen ? null : catalogProvider(value);
  if (cat?.keyUrl) {
    help.hidden = false;
    help.querySelector("[data-ac-help-text]").innerHTML = `${t("Key hier holen")}: <a class="ac-link" href="${escapeAttr(cat.keyUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cat.keyUrl.replace(/^https?:\/\//, ""))}</a>`;
  } else help.hidden = true;
}

// ---- Oberflaechen-Helfer (Netzwerk/Format/Escaping liegen in api-center-helfer.js) ----

function buchstabe(eintrag) {
  if (eintrag.art === "smejj") return "s";
  const cat = catalogProvider(baseAnbieterId(eintrag.id));
  if (cat?.logo) return cat.logo;
  return (eintrag.name || "?").trim().slice(0, 1).toUpperCase();
}

function setzeBeschaeftigt(root, beschaeftigt) {
  const form = root.querySelector("[data-ac-form]");
  form.querySelectorAll("button, input, select").forEach((el) => { el.disabled = beschaeftigt; });
}

function melde(root, text, fehler = false) {
  const node = root.querySelector("[data-ac-status]");
  if (!node) return;
  node.textContent = text;
  node.dataset.error = String(fehler);
}

function loadStyles() {
  if (document.querySelector('link[href^="/assets/api-center-surface.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/api-center-surface.css?v=8";
  document.head.append(link);
}
