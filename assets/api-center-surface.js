// smejj.com — zentraler API-Bereich (OpenRouter-Stil). EINE Flaeche fuer
// beides: smejj-Schluessel (/api/developer/keys, was wir nach aussen
// anbieten) und eigene Anbieter-Schluessel (/api/keys, BYOK, serverseitig
// AES-256-GCM verschluesselt). Ersetzt die zwei frueheren Orte
// (Modelle-Panel "API-Keys" und das API-Konto mit sechs Karten) — gleiche
// Funktionen, eine Uebersicht: Kopfzeile mit einem Hauptknopf,
// Guthaben-Leiste, Suche + Typfilter, eine Liste fuer alle Schluessel,
// Aktionen hinter dem Drei-Punkte-Menue, Verbindung & Preise darunter.
//
// Sicherheitsregeln unveraendert uebernommen: Der Klartext-Schluessel wird
// EINMAL angezeigt und nirgends abgelegt — kein localStorage, kein
// sessionStorage, keine zweite Abfrage. In der Liste nur der maskierte
// Pruefwert (keyHint). Wer ihn verliert, erzeugt einen neuen und widerruft
// den alten. Alle sichtbaren Texte ueber t() (Deutsch als Basis).
//
// Zwei Orte, ein Modul: Einstellungen-Reiter "API" (kopf: "kompakt", die
// Panel-Ueberschrift liefert den Titel) und /entwickler.html
// (kopf: "voll"). Idempotent — Doppel-Init steigt aus.
import { afterFirstPaint } from "./deferred-start.js";
import { API_ORIGIN } from "./config.js";
import { catalogProvider, selectableProviders } from "./ai/providers-catalog.js?v=1";
import { t } from "./i18n/ui.js?v=3";

const TOKEN_KEY = "smejj.apiToken.v1";
const MODELL_KEY = "smejj.model.selected.v2";
const AKTIVER_ANBIETER_KEY = "smejj.activeProvider.v1";
const BYOK_PREFIX = `${API_ORIGIN}/api/keys`;
const DEV_PREFIX = `${API_ORIGIN}/api/developer/keys`;
const DEV_GUTHABEN = `${API_ORIGIN}/api/developer/guthaben/checkout`;
const SUCHSCHWELLE = 5;

export function initApiCenter(wurzel, optionen = {}) {
  if (!wurzel || wurzel.querySelector("[data-ac-root]")) return;
  loadStyles();
  const kopf = optionen.kopf === "voll" ? "voll" : "kompakt";
  wurzel.insertAdjacentHTML("beforeend", markup(kopf));
  const root = wurzel.querySelector("[data-ac-root]");
  const zustand = { filter: "alle", such: "", typ: "smejj", byok: null, dev: null };

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
      <div class="ac-chips" role="group" aria-label="${t("Schlüssel erstellen")}">
        <button type="button" class="ac-chip" data-ac="typ" data-typ="smejj" aria-pressed="true">${t("smejj-Schlüssel")}</button>
        <button type="button" class="ac-chip" data-ac="typ" data-typ="anbieter" aria-pressed="false">${t("Anbieter-Key")}</button>
      </div>
      <div data-ac-bereich="smejj">
        <label class="ac-field">${t("Name des Schlüssels")}
          <input data-ac-dev-name type="text" maxlength="60" autocomplete="off" spellcheck="false" placeholder="${t("Wofür? z. B. ZCode auf dem Laptop")}">
        </label>
        <p class="ac-klein">${t("Der Schlüssel beginnt mit")} <code class="ac-code">smejj-live-</code>${t("Er wird nur einmal angezeigt.")}</p>
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

    <div class="ac-card">
      <div class="ac-toolbar">
        <input type="search" class="ac-search" data-ac-suche placeholder="• ${t("Nach Name suchen …")}" aria-label="${t("Nach Name oder Schlüssel suchen …")}">
        <div class="ac-chips" role="group" aria-label="${t("Nach Typ filtern")}">
          <button type="button" class="ac-chip" data-ac="filter" data-filter="alle" aria-pressed="true">${t("Alle")}</button>
          <button type="button" class="ac-chip" data-ac="filter" data-filter="smejj" aria-pressed="false">smejj</button>
          <button type="button" class="ac-chip" data-ac="filter" data-filter="anbieter" aria-pressed="false">${t("Anbieter")}</button>
        </div>
      </div>
      <div class="ac-cols" aria-hidden="true">
        <span>${t("Schlüssel")}</span><span>${t("Typ")}</span><span>${t("Status")}</span><span>${t("Zuletzt genutzt")}</span><span></span>
      </div>
      <div class="ac-rows" data-ac-rows></div>
      <div class="ac-foot-row">
        <span class="ac-count" data-ac-count title="${t("Läuft ab")}"></span>
        <p class="ac-foot" title="${t("Widerrufene Schlüssel bleiben sichtbar. Klartext wird nie wieder angezeigt.")}">${t("Widerrufene Schlüssel bleiben 30 Tage sichtbar • Schlüssel werden nie im Klartext angezeigt")}</p>
      </div>
    </div>

    <div class="ac-unten">
      <section class="ac-unten-karte ac-token-card" data-ac-token-card hidden>
        <h3>${t("Token heute")}</h3>
        <span class="ac-token-big" data-ac-token>0</span>
        <span class="ac-token-verdacht">${t("Anfragen heute")}: —</span>
      </section>
      <details class="ac-anhang">
      <summary>${t("Verbinden & Preise")}</summary>
      <div class="ac-anhang-inhalt">
        <section class="ac-mini">
          <h3>${t("Verbinden")}</h3>
          <div class="ac-mini-row">${t("Basis-URL")} <code class="ac-code" data-ac-basis-url>https://api.smejj.com/v1</code><button type="button" class="ac-copy" data-ac="kopiere-basis" title="${t("Kopieren")}" aria-label="${t("Kopieren")}">⧉</button></div>
          <div class="ac-mini-row">${t("Modell")} <code class="ac-code">smejj-1.0</code></div>
          <div class="ac-beispiel">
            <button type="button" class="ac-mini-link" data-ac="zeige-beispiel">${t("curl-Beispiel anzeigen")}</button>
            <pre data-ac-beispiel hidden><code>curl <span data-ac-basis-url-2>https://api.smejj.com/v1</span>/chat/completions \
  -H "Authorization: Bearer smejj-live-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"smejj-1.0","messages":[{"role":"user","content":"Hallo"}]}'</code></pre>
          </div>
        </section>
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
  if (!alleEintraege(zustand).length) {
    if (fehler.length) return { text: fehlerText(fehler[0]), fehler: true };
    return { text: t("Noch keine Schlüssel. Erstelle deinen ersten Schlüssel."), fehler: false };
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

function alleEintraege(zustand) {
  const byokOk = zustand.byok && !zustand.byok.fehler ? zustand.byok : null;
  const devOk = zustand.dev && !zustand.dev.fehler ? zustand.dev : null;
  const smejj = devOk ? (devOk.schluessel || []).map((k) => smejjEintrag(k)) : [];
  const anbieter = byokOk ? byokOk.providers.map((p) => anbieterEintrag(p, byokOk)) : [];
  return [...smejj, ...anbieter];
}

function smejjEintrag(k) {
  const widerrufen = k.zustand === "widerrufen";
  return {
    art: "smejj", id: k.id,
    name: k.name || t("Ohne Namen"),
    hinweis: k.keyHint || "",
    erstellt: datum(k.erstelltAm),
    zuletztBenutzt: datum(k.zuletztBenutztAm),
    nutzungAnfragen: (k.nutzung && k.nutzung.anfragen) || 0,
    nutzungToken: (k.nutzung && k.nutzung.token) || 0,
    status: widerrufen ? { lvl: "o", txt: t("Widerrufen") } : { lvl: "g", txt: t("Aktiv") },
    off: widerrufen
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
  return { art: "anbieter", id: p.id, provider: p, name: p.name.split(" · ")[0], hinweis, erstellt: "", status, off: false };
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
  const eintraege = alleEintraege(zustand);
  const liste = root.querySelector("[data-ac-rows]");
  liste.textContent = "";
  liste.innerHTML = eintraege.map((eintrag) => zeilenMarkup(eintrag, zustand)).join("");
  // OpenRouter zeigt das Suchfeld immer — auch mit wenigen Schluesseln.
  const anzahl = eintraege.length;
  root.querySelector("[data-ac-count]").textContent = anzahl ? `${zahl(anzahl)} ${t("Schlüssel")}` : "";
  filtere(root, zustand);
}


function zeilenMarkup(eintrag, zustand) {
  const typ = eintrag.art === "smejj" ? "smejj API" : t("Anbieter");
  const suchText = escapeAttr(`${eintrag.name} ${eintrag.hinweis} ${eintrag.art}`.toLowerCase());
  const klassen = ["ac-row"];
  if (eintrag.status.lvl === "r") klassen.push("ac-row-red");
  if (eintrag.off) klassen.push("ac-row-off");
  const badge = `<span class="ac-badge ac-badge-${eintrag.status.lvl}">• ${escapeHtml(eintrag.status.txt)}</span>`;
  return `<div class="${klassen.join(" ")}" data-ac-zeile="${escapeAttr(eintrag.id)}" data-art="${eintrag.art}" data-name="${suchText}">
    <div class="ac-who">
      <span class="ac-name">${escapeHtml(eintrag.name)}</span>
      <span class="ac-sub"><code>${escapeHtml(eintrag.hinweis)}</code>${eintrag.erstellt ? ` · ${escapeHtml(eintrag.erstellt)}` : ""}</span>
    </div>
    <span class="ac-cell ac-cell-typ">${escapeHtml(typ)}</span>
    <span class="ac-cell ac-cell-status">${badge}</span>
    <span class="ac-cell ac-cell-when">${eintrag.zuletztBenutzt || t("Nie")}</span>
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
  if (aktion === "neu") return oeffneFormular(root, true);
  if (aktion === "form-zu") return oeffneFormular(root, false);
  if (aktion === "typ") return typWahl(root, zustand, trigger.dataset.typ);
  if (aktion === "filter") return filterWahl(root, zustand, trigger.dataset.filter);
  if (aktion === "menue") return menue(root, zustand, trigger.dataset.popid);
  if (aktion === "modell-waehlen") return modellMenue(root, zustand, trigger.dataset.popid);
  if (aktion === "kopieren") return kopiereHint(root, zustand, trigger.dataset.id);
  if (aktion === "widerrufen") return widerrufe(root, zustand, trigger.dataset.id);
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

function oeffneFormular(root, offen) {
  const form = root.querySelector("[data-ac-form]");
  form.hidden = !offen;
  if (offen) {
    providerGewechselt(root);
    form.querySelector("[data-ac-key]").focus();
  } else {
    form.reset();
    form.querySelector("[data-ac-reveal]").hidden = true;
  }
}

function typWahl(root, zustand, typ) {
  zustand.typ = typ === "anbieter" ? "anbieter" : "smejj";
  const form = root.querySelector("[data-ac-form]");
  form.querySelectorAll("[data-ac='typ']").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.typ === zustand.typ));
  });
  form.querySelector("[data-ac-bereich='smejj']").hidden = zustand.typ !== "smejj";
  form.querySelector("[data-ac-bereich='anbieter']").hidden = zustand.typ !== "anbieter";
  form.querySelector("[data-ac-erstelle]").textContent = zustand.typ === "smejj"
    ? t("Neuen Schlüssel erzeugen") : t("Prüfen und verbinden");
}

function filterWahl(root, zustand, filter) {
  zustand.filter = filter;
  root.querySelectorAll("[data-ac='filter']").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.filter === filter));
  });
  filtere(root);
}

function filtere(root, zustand) {
  const frage = root.querySelector("[data-ac-suche]").value.trim().toLowerCase();
  const filter = zustand.filter;
  let sichtbar = 0;
  root.querySelectorAll("[data-ac-zeile]").forEach((zeile) => {
    const passtFilter = filter === "alle"
      || (filter === "smejj" ? zeile.dataset.art === "smejj" : zeile.dataset.art === "anbieter");
    const passtSuche = !frage || (zeile.dataset.name || "").includes(frage);
    const zeige = passtFilter && passtSuche;
    zeile.style.display = zeige ? "" : "none";
    if (zeige) sichtbar += 1;
  });
  const zaehler = root.querySelector("[data-ac-count]");
  if (filter !== "alle" || frage) zaehler.textContent = `${zahl(sichtbar)} ${t("Schlüssel")}`;
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
    teile.push(`<button type="button" role="menuitem" class="ac-item" data-ac="kopieren" data-id="${escapeAttr(eintrag.id)}"><span class="ac-item-icon">⧉</span>${t("Maskierten Schlüssel kopieren")}</button>`);
    teile.push(`<button type="button" role="menuitem" class="ac-item ac-item-danger" data-ac="widerrufen" data-id="${escapeAttr(eintrag.id)}"><span class="ac-item-icon">⊘</span>${t("Widerrufen")}</button>`);
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

async function widerrufe(root, zustand, id) {
  const eintrag = alleEintraege(zustand).find((e) => e.id === id);
  const name = eintrag ? `\n${eintrag.name}` : "";
  if (!confirm(`${t("Diesen Schlüssel dauerhaft widerrufen? Programme, die ihn benutzen, bekommen danach 401.")}${name}`)) return;
  try {
    await api(`${DEV_PREFIX}/${encodeURIComponent(id)}/revoke`, { method: "POST", body: {} });
    await laden(root, zustand);
    melde(root, t("Schlüssel widerrufen."));
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

// ---- Formular absenden --------------------------------------------------------

async function absenden(root, zustand) {
  if (zustand.typ === "smejj") return erzeugeSmejjSchluessel(root, zustand);
  return verbindeAnbieter(root, zustand);
}

async function erzeugeSmejjSchluessel(root, zustand) {
  const feld = root.querySelector("[data-ac-dev-name]");
  const name = feld.value.trim();
  setzeBeschaeftigt(root, true);
  try {
    const daten = await api(DEV_PREFIX, { method: "POST", body: { name } });
    zeigeEinmal(root, daten.apiKey || "");
    feld.value = "";
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
    <span class="ac-reveal-note">${t("wird danach nicht mehr angezeigt")}</span>`;
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

// ---- Netzwerk / Auth (Muster wie in provider-settings.js, dort begruendet) ------

async function api(url, { method = "GET", body } = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY) || holeLokalesToken() || await holeSitzungsToken();
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.error || "";
    error.retryAfterSec = payload.retryAfterSec;
    throw error;
  }
  return payload;
}

function holeLokalesToken() {
  const token = String(localStorage.getItem("smejj.auth.accessToken.v1") || "");
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return "";
  sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

async function holeSitzungsToken() {
  const response = await fetch(`${API_ORIGIN}/api/auth/session-token`, { credentials: "include" }).catch(() => null);
  if (!response?.ok) return "";
  const payload = await response.json().catch(() => ({}));
  const token = String(payload.accessToken || "");
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

function fehlerText(error) {
  if (error?.code === "authentication_required" || error?.status === 401) return t("Bitte zuerst bei smejj.com anmelden.");
  if (error?.code === "public_api_disabled") return t("Die Entwickler-API ist auf diesem Server noch nicht eingeschaltet.");
  if (error?.code === "api_key_limit_reached") return t("Zu viele aktive Schlüssel. Bitte zuerst einen widerrufen.");
  if (error?.code === "billing_not_configured") return t("Aufladen ist auf diesem Server noch nicht eingerichtet.");
  if (error?.status === 429) return t("Zu viele Versuche. Bitte kurz warten.");
  if (error?.code === "provider_api_key_rejected") return t("Der API-Key wurde vom Anbieter abgelehnt (ungültig).");
  if (error?.code === "provider_insufficient_credits" || error?.status === 402) return t("Der Anbieter meldet unzureichendes Guthaben. Kein kostenpflichtiger Fallback gestartet.");
  if (error?.code === "provider_rate_limit") return t("Rate-Limit erreicht. Bitte später erneut versuchen.");
  if (error?.code === "provider_credential_encryption_not_configured") return t("Der verschlüsselte Credential-Vault ist serverseitig noch nicht konfiguriert.");
  return `${t("Verbindung fehlgeschlagen:")} ${String(error?.message || error).slice(0, 240)}`;
}

// ---- Kleine Helfer ------------------------------------------------------------

function statusStufe(p) {
  if (p.status === "invalid" || p.status === "error" || p.status === "no_credits") return "red";
  if (p.status === "low_credits") return "yellow";
  return "green";
}

function baseAnbieterId(id) {
  return String(id || "").replace(/^custom-/, "").replace(/-[a-z0-9]{1,6}$/, "");
}

function buchstabe(eintrag) {
  if (eintrag.art === "smejj") return "s";
  const cat = catalogProvider(baseAnbieterId(eintrag.id));
  if (cat?.logo) return cat.logo;
  return (eintrag.name || "?").trim().slice(0, 1).toUpperCase();
}

function kurz(model) {
  const value = String(model).split("/").pop() || String(model);
  return value.length > 28 ? `${value.slice(0, 27)}…` : value;
}

function usd(wert) {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(wert) || 0);
}

function zahl(wert) {
  return new Intl.NumberFormat("de-DE").format(Number(wert) || 0);
}

function kurzZahl(wert) {
  const n = Number(wert) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + " M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".0", "") + " k";
  return String(n);
}

function datum(iso) {
  const zeit = new Date(iso || "");
  return Number.isNaN(zeit.getTime()) ? "" : zeit.toLocaleDateString("de-DE");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
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
  link.href = "/assets/api-center-surface.css?v=4";
  document.head.append(link);
}
