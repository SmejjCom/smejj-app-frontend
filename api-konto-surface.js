// smejj.com — API-Konto des Nutzers: eigene Schluessel, Guthaben, Verbrauch,
// Preise. EIN Modul fuer zwei Orte: den Einstellungsreiter "API & Schluessel"
// in der App und die Einzelseite /entwickler.html. Vorbild sind die
// Plattformseiten von DeepSeek, OpenAI und Anthropic — vier Karten, eine Seite.
//
// Der Klartext-Schluessel wird EINMAL angezeigt und nirgends abgelegt — kein
// localStorage, kein sessionStorage, keine zweite Abfrage. Wer ihn verliert,
// erzeugt einen neuen und widerruft den alten; so haelt es jeder Anbieter.
//
// Auth-Muster (Bearer aus der Sitzung, Rueckfall /api/auth/session-token) wie
// in api-keys-surface.js — dort steht die Begruendung.
import { API_ORIGIN } from "./config.js";
import { t } from "./i18n/ui.js?v=3";

const TOKEN_KEY = "smejj.apiToken.v1";
const PREFIX = `${API_ORIGIN}/api/developer/keys`;
const GUTHABEN = `${API_ORIGIN}/api/developer/guthaben`;

/** Baut das Konto in `container` auf und bindet alles. Idempotent. */
export function initApiKontoSurface(container) {
  if (!container || container.querySelector("[data-dev-root]")) return;
  container.insertAdjacentHTML("beforeend", markup());
  const root = container.querySelector("[data-dev-root]");
  const el = (name) => root.querySelector(`[data-dev="${name}"]`);

  el("form").addEventListener("submit", (event) => {
    event.preventDefault();
    erzeuge(root, el("name").value).catch((error) => zeigeFehler(root, error));
  });
  root.addEventListener("click", (event) => {
    const widerruf = event.target.closest("[data-key-id]");
    if (widerruf) {
      if (!globalThis.confirm(t("Diesen Schlüssel dauerhaft widerrufen? Programme, die ihn benutzen, bekommen danach 401."))) return;
      widerrufe(root, widerruf.dataset.keyId).catch((error) => zeigeFehler(root, error));
      return;
    }
    const aufladen = event.target.closest("[data-aufladen]");
    if (aufladen) ladeAuf(root, Number(aufladen.dataset.aufladen)).catch((error) => zeigeFehler(root, error));
    if (event.target.closest('[data-dev="kopieren"]')) kopiere(root);
  });

  if (new URLSearchParams(location.search).get("aufgeladen") === "1") {
    melde(root, t("Zahlung angekommen. Das Guthaben erscheint in wenigen Sekunden."));
  }
  lade(root).catch((error) => zeigeFehler(root, error));
}

function markup() {
  return `<div class="dev-konto" data-dev-root>
    <section class="dev-karte">
      <h3>${t("Die drei Angaben")}</h3>
      <p><strong>${t("Basis-URL")}:</strong> <code data-dev="basis-url">https://api.smejj.com/v1</code></p>
      <p><strong>${t("Modell")}:</strong> <code>smejj-1.0</code></p>
      <p><strong>${t("API-Schlüssel")}:</strong> ${t("unten erzeugen (beginnt mit")} <code>smejj-live-</code>)</p>
    </section>

    <section class="dev-karte">
      <h3>${t("Guthaben")}</h3>
      <p class="dev-guthaben"><strong data-dev="guthaben">–</strong> USD</p>
      <p class="dev-klein">${t("Aufgeladen")}: <span data-dev="aufgeladen">–</span> USD · ${t("Verbraucht")}: <span data-dev="verbraucht">–</span> USD</p>
      <div class="dev-feld" data-dev="auflade-stufen"></div>
      <p class="dev-klein" data-dev="auflade-hinweis" hidden>${t("Aufladen ist auf diesem Server noch nicht eingerichtet.")}</p>
    </section>

    <section class="dev-karte">
      <h3>${t("Meine Schlüssel")}</h3>
      <p class="dev-meldung" data-dev="meldung" role="status" aria-live="polite">${t("Wird geladen …")}</p>
      <div class="dev-neuer-key" data-dev="neuer-key" hidden>
        <p><strong>${t("Einmalige Anzeige.")}</strong> ${t("Kopieren Sie den Schlüssel jetzt — er wird nie wieder angezeigt. Gespeichert ist bei uns nur sein Prüfwert, nicht er selbst.")}</p>
        <p><code data-dev="neuer-key-wert"></code></p>
        <button type="button" class="dev-knopf" data-dev="kopieren">${t("Kopieren")}</button>
      </div>
      <ul class="dev-key-liste" data-dev="liste"></ul>
      <form class="dev-feld" data-dev="form">
        <label class="visually-hidden" for="devKeyName">${t("Name des Schlüssels")}</label>
        <input type="text" id="devKeyName" data-dev="name" maxlength="60" placeholder="${t("Wofür? z. B. ZCode auf dem Laptop")}">
        <button type="submit" class="dev-knopf" data-dev="erzeugen">${t("Neuen Schlüssel erzeugen")}</button>
      </form>
    </section>

    <section class="dev-karte">
      <h3>${t("Verbrauch heute")}</h3>
      <div class="dev-verbrauch">
        <span><strong data-dev="v-anfragen">0</strong> ${t("Anfragen")}</span>
        <span><strong data-dev="v-tokens">0</strong> ${t("Token gesamt")}</span>
        <span><strong data-dev="v-eingabe">0</strong> ${t("Eingabe")}</span>
        <span><strong data-dev="v-ausgabe">0</strong> ${t("Ausgabe")}</span>
      </div>
      <p class="dev-klein">${t("Der Zähler setzt täglich um 00:00 UTC zurück.")}</p>
    </section>

    <section class="dev-karte">
      <h3>${t("Preise")}</h3>
      <table class="dev-preise"><thead><tr><th>${t("Modell")}</th><th>${t("Eingabe")}</th><th>${t("Ausgabe")}</th></tr></thead><tbody data-dev="preise"></tbody></table>
      <p class="dev-klein">${t("USD je 1 Million Token. Welches Modell dahinter rechnet, entscheidet smejj — Ihr Aufruf bleibt gleich.")}</p>
    </section>

    <section class="dev-karte">
      <h3>${t("Beispiel")}</h3>
      <pre class="dev-code"><code>curl <span data-dev="basis-url-2">https://api.smejj.com/v1</span>/chat/completions \\
  -H "Authorization: Bearer smejj-live-…" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"smejj-1.0","messages":[{"role":"user","content":"Hallo"}]}'</code></pre>
    </section>
  </div>`;
}

// ---- Aktionen ----------------------------------------------------------------

async function lade(root) {
  const daten = await api("");
  const el = (name) => root.querySelector(`[data-dev="${name}"]`);
  for (const name of ["basis-url", "basis-url-2"]) el(name).textContent = daten.basisUrl || el(name).textContent;
  zeichneListe(root, daten.schluessel || []);
  zeichneVerbrauch(root, daten.verbrauch || {});
  zeichneGuthaben(root, daten.guthaben || {});
  zeichnePreise(root, daten.preise || {});
  if (!el("meldung").textContent.startsWith(t("Zahlung angekommen"))) {
    melde(root, daten.schluessel?.length ? "" : t("Noch kein Schlüssel. Unten einen erzeugen."));
  }
}

async function erzeuge(root, name) {
  const knopf = root.querySelector('[data-dev="erzeugen"]');
  knopf.disabled = true;
  try {
    const daten = await api("", { method: "POST", body: { name } });
    root.querySelector('[data-dev="neuer-key-wert"]').textContent = daten.apiKey;
    root.querySelector('[data-dev="neuer-key"]').hidden = false;
    root.querySelector('[data-dev="name"]').value = "";
    await lade(root);
    melde(root, t("Schlüssel erzeugt. Jetzt kopieren — er wird nicht noch einmal angezeigt."));
  } finally {
    knopf.disabled = false;
  }
}

async function widerrufe(root, keyId) {
  await api(`/${encodeURIComponent(keyId)}/revoke`, { method: "POST" });
  await lade(root);
  melde(root, t("Schlüssel widerrufen."));
}

async function ladeAuf(root, betragUsd) {
  melde(root, t("Weiter zu Stripe …"));
  const daten = await apiRoh(`${GUTHABEN}/checkout`, { method: "POST", body: { betragUsd } });
  if (daten.url) location.assign(daten.url);
}

function kopiere(root) {
  const wert = root.querySelector('[data-dev="neuer-key-wert"]').textContent;
  navigator.clipboard?.writeText(wert).then(
    () => melde(root, t("Schlüssel kopiert.")),
    () => melde(root, t("Kopieren ging nicht — bitte von Hand markieren."), true)
  );
}

// ---- Zeichnen ----------------------------------------------------------------

function zeichneListe(root, schluessel) {
  const liste = root.querySelector('[data-dev="liste"]');
  liste.textContent = "";
  for (const eintrag of schluessel) {
    const zeile = document.createElement("li");
    if (eintrag.zustand === "widerrufen") zeile.className = "dev-key-widerrufen";
    const links = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = eintrag.name || t("Ohne Namen");
    const hinweis = document.createElement("div");
    const code = document.createElement("code");
    code.textContent = eintrag.keyHint;
    hinweis.append(code, document.createTextNode(` · ${datum(eintrag.erstelltAm)}`));
    links.append(name, hinweis);
    const rechts = document.createElement("div");
    if (eintrag.zustand === "widerrufen") {
      rechts.textContent = `${t("widerrufen")} ${datum(eintrag.widerrufenAm)}`;
    } else {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = "dev-knopf";
      knopf.dataset.keyId = eintrag.id;
      knopf.textContent = t("Widerrufen");
      rechts.append(knopf);
    }
    zeile.append(links, rechts);
    liste.append(zeile);
  }
}

function zeichneVerbrauch(root, v) {
  setz(root, "v-anfragen", v.anfragen);
  setz(root, "v-tokens", v.gesamtTokens);
  setz(root, "v-eingabe", v.promptTokens);
  setz(root, "v-ausgabe", v.completionTokens);
}

function zeichneGuthaben(root, g) {
  const usd = (wert) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(wert) || 0);
  root.querySelector('[data-dev="guthaben"]').textContent = usd(g.usd);
  root.querySelector('[data-dev="aufgeladen"]').textContent = usd(g.aufgeladenUsd);
  root.querySelector('[data-dev="verbraucht"]').textContent = usd(g.verbrauchtUsd);
  const stufen = root.querySelector('[data-dev="auflade-stufen"]');
  stufen.textContent = "";
  root.querySelector('[data-dev="auflade-hinweis"]').hidden = g.aufladenMoeglich !== false;
  if (g.aufladenMoeglich === false) return;
  for (const betrag of g.stufenUsd || []) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "dev-knopf";
    knopf.dataset.aufladen = String(betrag);
    knopf.textContent = `+ ${betrag} USD`;
    stufen.append(knopf);
  }
}

function zeichnePreise(root, preise) {
  const tbody = root.querySelector('[data-dev="preise"]');
  tbody.textContent = "";
  for (const [id, satz] of Object.entries(preise)) {
    const tr = document.createElement("tr");
    for (const text of [id, `${satz.eingabe.toFixed(2)} $`, `${satz.ausgabe.toFixed(2)} $`]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

function setz(root, name, wert) {
  root.querySelector(`[data-dev="${name}"]`).textContent = new Intl.NumberFormat("de-DE").format(Number(wert) || 0);
}

function datum(iso) {
  const zeit = new Date(iso || "");
  return Number.isNaN(zeit.getTime()) ? "" : zeit.toLocaleDateString("de-DE");
}

function melde(root, text, fehler = false) {
  const ziel = root.querySelector('[data-dev="meldung"]');
  ziel.textContent = text;
  ziel.dataset.art = fehler ? "fehler" : "";
}

function zeigeFehler(root, error) {
  if (error?.status === 401) return melde(root, t("Bitte zuerst bei smejj.com anmelden."), true);
  if (error?.code === "public_api_disabled") return melde(root, t("Die Entwickler-API ist auf diesem Server noch nicht eingeschaltet."), true);
  if (error?.code === "api_key_limit_reached") return melde(root, t("Zu viele aktive Schlüssel. Bitte zuerst einen widerrufen."), true);
  if (error?.code === "billing_not_configured") return melde(root, t("Aufladen ist auf diesem Server noch nicht eingerichtet."), true);
  if (error?.status === 429) return melde(root, t("Zu viele Versuche. Bitte kurz warten."), true);
  return melde(root, `${t("Ging nicht:")} ${String(error?.message || error).slice(0, 200)}`, true);
}

// ---- Netzwerk ----------------------------------------------------------------

function api(pfad, optionen) {
  return apiRoh(`${PREFIX}${pfad}`, optionen);
}

async function apiRoh(url, { method = "GET", body } = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY) || holeLokalesToken() || await holeSitzungsToken();
  const antwort = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const nutzlast = await antwort.json().catch(() => ({}));
  if (!antwort.ok) {
    const fehler = new Error(nutzlast.error || `HTTP ${antwort.status}`);
    fehler.status = antwort.status;
    fehler.code = nutzlast.error || "";
    throw fehler;
  }
  return nutzlast;
}

function holeLokalesToken() {
  const token = String(localStorage.getItem("smejj.auth.accessToken.v1") || "");
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return "";
  sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

async function holeSitzungsToken() {
  const antwort = await fetch(`${API_ORIGIN}/api/auth/session-token`, { credentials: "include" }).catch(() => null);
  if (!antwort?.ok) return "";
  const nutzlast = await antwort.json().catch(() => ({}));
  const token = String(nutzlast.accessToken || "");
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}
