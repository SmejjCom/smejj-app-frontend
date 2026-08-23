// smejj.com — Entwicklerseite: eigene API-Schluessel erzeugen, sehen, widerrufen.
//
// Bedient /api/developer/keys. Der Klartext-Schluessel wird EINMAL angezeigt
// und danach bewusst nirgends abgelegt — kein localStorage, kein sessionStorage,
// keine zweite Abfrage. Wer ihn verliert, erzeugt einen neuen und widerruft den
// alten; das ist der Umgang, den jeder Anbieter am Markt so haelt.
//
// Das Auth-Muster (Bearer aus der Sitzung, Rueckfall ueber /api/auth/session-token)
// ist dasselbe wie in api-keys-surface.js — dort steht die Begruendung.
import { API_ORIGIN } from "./config.js";

const TOKEN_KEY = "smejj.apiToken.v1";
const PREFIX = `${API_ORIGIN}/api/developer/keys`;

const doc = document;
const el = (name) => doc.querySelector(`[data-dev="${name}"]`);

start();

function start() {
  const form = el("form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      erzeuge(doc.querySelector("#devKeyName")?.value || "").catch(zeigeFehler);
    });
  }
  el("liste")?.addEventListener("click", (event) => {
    const knopf = event.target.closest("[data-key-id]");
    if (!knopf) return;
    if (!globalThis.confirm("Diesen Schluessel dauerhaft widerrufen? Programme, die ihn benutzen, bekommen danach 401.")) return;
    widerrufe(knopf.dataset.keyId).catch(zeigeFehler);
  });
  el("kopieren")?.addEventListener("click", () => {
    const wert = el("neuer-key-wert")?.textContent || "";
    navigator.clipboard?.writeText(wert).then(
      () => melde("Schluessel kopiert."),
      () => melde("Kopieren ging nicht — bitte von Hand markieren.", true)
    );
  });
  lade().catch(zeigeFehler);
}

async function lade() {
  const daten = await api("");
  zeichneBasisUrl(daten.basisUrl);
  zeichneListe(daten.schluessel || []);
  zeichneVerbrauch(daten.verbrauch || {});
  melde(daten.schluessel?.length ? "" : "Noch kein Schluessel. Unten einen erzeugen.");
}

async function erzeuge(name) {
  const knopf = el("erzeugen");
  if (knopf) knopf.disabled = true;
  try {
    const daten = await api("", { method: "POST", body: { name } });
    const kasten = el("neuer-key");
    if (kasten) {
      el("neuer-key-wert").textContent = daten.apiKey;
      kasten.hidden = false;
    }
    const feld = doc.querySelector("#devKeyName");
    if (feld) feld.value = "";
    zeichneBasisUrl(daten.basisUrl);
    // Erst neu laden, DANN melden: lade() setzt die Meldung selbst und
    // ueberschrieb den Hinweis sonst sofort wieder (gemessen im Browser).
    await lade();
    melde("Schluessel erzeugt. Jetzt kopieren — er wird nicht noch einmal angezeigt.");
  } finally {
    if (knopf) knopf.disabled = false;
  }
}

async function widerrufe(keyId) {
  await api(`/${encodeURIComponent(keyId)}/revoke`, { method: "POST" });
  melde("Schluessel widerrufen.");
  await lade();
}

// ---- Zeichnen ----------------------------------------------------------------

function zeichneBasisUrl(basisUrl) {
  if (!basisUrl) return;
  for (const name of ["basis-url", "basis-url-2", "basis-url-3"]) {
    const ziel = el(name);
    if (ziel) ziel.textContent = basisUrl;
  }
}

function zeichneListe(schluessel) {
  const liste = el("liste");
  if (!liste) return;
  liste.textContent = "";
  for (const eintrag of schluessel) {
    const zeile = doc.createElement("li");
    if (eintrag.zustand === "widerrufen") zeile.className = "dev-key-widerrufen";

    const links = doc.createElement("div");
    const name = doc.createElement("strong");
    name.textContent = eintrag.name || "Ohne Namen";
    const hinweis = doc.createElement("div");
    const code = doc.createElement("code");
    code.textContent = eintrag.keyHint;
    hinweis.append(code, doc.createTextNode(` · ${datum(eintrag.erstelltAm)}`));
    links.append(name, hinweis);

    const rechts = doc.createElement("div");
    if (eintrag.zustand === "widerrufen") {
      rechts.textContent = `widerrufen ${datum(eintrag.widerrufenAm)}`;
    } else {
      const knopf = doc.createElement("button");
      knopf.type = "button";
      knopf.className = "dev-knopf";
      knopf.dataset.keyId = eintrag.id;
      knopf.textContent = "Widerrufen";
      rechts.append(knopf);
    }
    zeile.append(links, rechts);
    liste.append(zeile);
  }
}

function zeichneVerbrauch(verbrauch) {
  setz("v-anfragen", verbrauch.anfragen);
  setz("v-tokens", verbrauch.gesamtTokens);
  setz("v-eingabe", verbrauch.promptTokens);
  setz("v-ausgabe", verbrauch.completionTokens);
}

function setz(name, wert) {
  const ziel = el(name);
  if (ziel) ziel.textContent = new Intl.NumberFormat("de-DE").format(Number(wert) || 0);
}

function datum(iso) {
  if (!iso) return "";
  const zeit = new Date(iso);
  return Number.isNaN(zeit.getTime()) ? "" : zeit.toLocaleDateString("de-DE");
}

function melde(text, fehler = false) {
  const ziel = el("meldung");
  if (!ziel) return;
  ziel.textContent = text;
  ziel.dataset.art = fehler ? "fehler" : "";
}

function zeigeFehler(error) {
  if (error?.status === 401) return melde("Bitte zuerst bei smejj.com anmelden.", true);
  if (error?.code === "public_api_disabled") return melde("Die Entwickler-API ist auf diesem Server noch nicht eingeschaltet.", true);
  if (error?.code === "api_key_limit_reached") return melde("Zu viele aktive Schluessel. Bitte zuerst einen widerrufen.", true);
  if (error?.status === 429) return melde("Zu viele Versuche. Bitte kurz warten.", true);
  return melde(`Ging nicht: ${String(error?.message || error).slice(0, 200)}`, true);
}

// ---- Netzwerk ----------------------------------------------------------------

async function api(pfad, { method = "GET", body } = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY) || holeLokalesToken() || await holeSitzungsToken();
  const antwort = await fetch(`${PREFIX}${pfad}`, {
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
