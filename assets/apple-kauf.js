// smejj.com — Plan-Kauf in der iOS-App über Apple (In-App-Kauf, StoreKit 2).
// Inhaber 12.11.2026 (schriftlich): „Nein, Soll mit Plus usw Pakete sein überall, Mach überall rein.“
//
// Apple 3.1.1: In der App wird NUR über Apple verkauft. Kein Stripe-Link, kein Web-Preis, kein Hinweis
// auf einen anderen Bezahlweg. Preise kommen von Apple selbst (StoreKit, in Landeswährung).
// Die App-Hülle (ab 1.0.6) stellt window.webkit.messageHandlers.smejjKauf bereit; fehlt sie
// (alte App, Safari), bleibt alles wie bisher: keine Preise, kein Kauf.
// Ablauf: Kauf in der App mit Konto-Token -> signierter Beleg -> smejj-Server prüft ihn bei Apple-
// Zertifikaten und stellt das Konto um. Die Seite selbst schaltet nie etwas frei.
import { API_ORIGIN } from "./config.js?v=2026111232";
import { t } from "./i18n/ui.js?v=2026111232";

const TOKEN_KEY = "smejj.auth.accessToken.v1"; // wie account-sessions.js
export const APPLE_PRODUKTE = Object.freeze([
  { id: "com.smejj.app.plus", plan: "plus", name: "Plus", vorteile: ["1 000 Nachrichten", "Premium-Stimme", "Schnellere Antworten"], beliebt: true },
  { id: "com.smejj.app.pro", plan: "pro", name: "Pro", vorteile: ["Alles aus Plus", "Unbegrenzte Nachrichten", "Coding-Agent & Projekte"] },
  { id: "com.smejj.app.max", plan: "max", name: "Max", vorteile: ["Alles aus Pro", "5× Limits", "Früher Zugriff auf Neues", "Direkter Support"] }
]);
const APPLE_EULA = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

/** Die Kauf-Brücke der iOS-App oder null. */
export function appleBruecke(win = globalThis) {
  try {
    const h = win?.webkit?.messageHandlers?.smejjKauf;
    return h && typeof h.postMessage === "function" ? h : null;
  } catch {
    return null;
  }
}

/** Konto-Token für StoreKit (UUID-Form) aus checkoutRef = sha256(E-Mail). Gleiche Regel wie der Server. */
export function kontoToken(ref) {
  const r = String(ref || "");
  if (!/^[0-9a-f]{64}$/.test(r)) return "";
  return `${r.slice(0, 8)}-${r.slice(8, 12)}-${r.slice(12, 16)}-${r.slice(16, 20)}-${r.slice(20, 32)}`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Plan-Karten für die iOS-App (Preise füllt bindeAppleKauf aus StoreKit). */
export function appleKaufMarkup() {
  const karten = APPLE_PRODUKTE.map((p) => `<div class="plan-karte${p.beliebt ? " ist-beliebt" : ""}" data-apple-karte="${p.plan}"><div class="plan-kopf"><h4>${p.name}</h4>${p.beliebt ? `<span class="plan-beliebt">${t("Beliebt")}</span>` : ""}</div><p class="plan-preis"><b class="apple-preis">…</b> ${t("/ Monat")}</p><ul>${p.vorteile.map((v) => `<li>${t(v)}</li>`).join("")}</ul><button type="button" class="plan-knopf" data-apple-produkt="${p.id}" disabled>${t("Abonnieren")}</button></div>`).join("");
  return `<div id="appleKauf"><div class="plan-karten">${karten}</div>`
    + `<div class="account-actions"><button id="appleWiederherstellen" type="button">${t("Käufe wiederherstellen")}</button><button id="appleVerwalten" type="button">${t("Abo bei Apple verwalten")}</button></div>`
    + `<p class="account-note">${t("Monatsabo. Bezahlt wird über deine Apple-ID. Das Abo verlängert sich automatisch um jeweils einen Monat, wenn es nicht mindestens 24 Stunden vor Ablauf gekündigt wird. Kündigen und verwalten kannst du es jederzeit in den Einstellungen deiner Apple-ID.")} `
    + `<a href="${APPLE_EULA}">${t("Nutzungsbedingungen (EULA)")}</a> · <a href="/datenschutz.html">${t("Datenschutz")}</a> · <a href="/agb.html">${t("AGB")}</a></p>`
    + `<style>.plan-karten{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:14px 0}.plan-karte{display:flex;flex-direction:column;gap:6px;padding:16px;border:1px solid rgba(127,127,127,.35);border-radius:16px!important;background:rgba(255,255,255,.03)}.plan-karte.ist-beliebt{border-color:#2fd0bd;box-shadow:0 0 0 1px #2fd0bd inset;background:linear-gradient(160deg,rgba(47,208,189,.12),rgba(94,224,240,.03))}.plan-kopf{display:flex;align-items:center;justify-content:space-between;gap:8px}.plan-kopf h4{margin:0;font-size:18px}.plan-beliebt{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;background:#2fd0bd;color:#06201c}.plan-preis{margin:4px 0 0;font-size:15px}.plan-preis b{font-size:28px}.plan-karte ul{margin:8px 0 10px;padding-left:18px;display:grid;gap:4px}.plan-karte li{font-size:15px!important;line-height:1.45}.plan-knopf{margin-top:auto;min-height:48px;padding:10px 14px;border-radius:12px!important;font-size:16px!important;font-weight:700;line-height:1.25}.plan-karte.ist-beliebt .plan-knopf{background:linear-gradient(90deg,#2fd0bd,#5ee0f0);color:#06201c;border:0}</style></div>`;
}

function leseToken(win) {
  try { return win.sessionStorage.getItem(TOKEN_KEY) || win.localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

/** Belege an den Server. Output: Planstatus ({ ok, plan, ... }) oder { ok:false, error }. */
export async function belegeSenden(belege, { win = globalThis, fetchImpl = globalThis.fetch } = {}) {
  const liste = (Array.isArray(belege) ? belege : [belege]).filter((b) => typeof b === "string" && b).slice(0, 10);
  if (!liste.length) return { ok: false, error: "keine_belege" };
  const token = leseToken(win);
  if (!token) return { ok: false, error: "nicht_angemeldet" };
  try {
    const r = await fetchImpl(`${API_ORIGIN}/api/billing/apple/transaction`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ signedTransactions: liste })
    });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.ok ? d : { ok: false, error: d.error || `http_${r.status}` };
  } catch {
    return { ok: false, error: "netz" };
  }
}

/** Kontostand frisch vom Server (falls die Kontoseite ihn noch nicht geladen hat). */
export async function holeStatus({ win = globalThis, fetchImpl = globalThis.fetch } = {}) {
  const token = leseToken(win);
  if (!token) return null;
  try {
    const r = await fetchImpl(`${API_ORIGIN}/api/billing/status`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.ok ? d : null;
  } catch {
    return null;
  }
}

/**
 * Knöpfe nach Serverstand: eigener Apple-Plan markiert, andere Pläne „Wechseln“ (Apple stellt innerhalb
 * der Abo-Gruppe selbst um). Läuft ein Web-Abo, wird in der App nichts zusätzlich verkauft.
 */
export function zeichneAppleKnoepfe(panel, billing, { bereit = true } = {}) {
  const wurzel = panel?.querySelector?.("#appleKauf");
  if (!wurzel) return;
  const aktiv = billing && billing.plan && billing.plan !== "free";
  const webAbo = aktiv && billing.quelle !== "apple";
  for (const p of APPLE_PRODUKTE) {
    const knopf = wurzel.querySelector(`[data-apple-produkt="${p.id}"]`);
    if (!knopf) continue;
    if (aktiv && p.plan === billing.plan) { knopf.textContent = t("Dein Plan"); knopf.disabled = true; continue; }
    knopf.textContent = aktiv ? t("Wechseln") : t("Abonnieren");
    knopf.disabled = !bereit || webAbo || knopf.dataset.preisFehlt === "1";
  }
  const verwalten = wurzel.querySelector("#appleVerwalten");
  if (verwalten) verwalten.hidden = Boolean(webAbo);
  if (billing?.quelle === "apple" && aktiv) {
    const hinweis = panel.querySelector(".account-plan small");
    const datum = billing.periodEnd ? new Date(billing.periodEnd).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "";
    if (hinweis && datum) {
      hinweis.textContent = billing.cancelAtPeriodEnd
        ? t("Gekündigt — dein Abo läuft noch bis {datum}.").replace("{datum}", datum)
        : t("Aktiv über Apple — verlängert sich am {datum}.").replace("{datum}", datum);
    }
  }
}

/**
 * Verdrahtet die Karten. Input: Konto-Ansicht und Rückrufe der Kontoseite:
 *   holeBilling() -> letzter Serverstand, setzeBilling(stand) -> neu zeichnen, ausgabe(text).
 */
export function bindeAppleKauf(view, { holeBilling, setzeBilling, ausgabe, win = globalThis } = {}) {
  const bruecke = appleBruecke(win);
  const wurzel = view?.querySelector?.("#appleKauf");
  if (!bruecke || !wurzel || wurzel.dataset.gebunden) return false;
  wurzel.dataset.gebunden = "1";
  const sag = (text) => { try { ausgabe?.(text); } catch { /* Anzeige ist Komfort */ } };
  const fertig = (stand) => { if (stand?.ok) setzeBilling?.(stand); };

  bruecke.postMessage({ aktion: "produkte" }).then((liste) => {
    const nachId = new Map((Array.isArray(liste) ? liste : []).map((p) => [p.id, p]));
    for (const p of APPLE_PRODUKTE) {
      const karte = wurzel.querySelector(`[data-apple-karte="${p.plan}"]`);
      const knopf = wurzel.querySelector(`[data-apple-produkt="${p.id}"]`);
      const info = nachId.get(p.id);
      if (karte) karte.querySelector(".apple-preis").textContent = info ? info.preis : "—";
      if (knopf) knopf.dataset.preisFehlt = info ? "" : "1";
    }
    zeichneAppleKnoepfe(view, holeBilling?.());
  }).catch(() => {
    for (const k of wurzel.querySelectorAll("[data-apple-produkt]")) { k.dataset.preisFehlt = "1"; k.disabled = true; }
    sag(t("Die Abos sind gerade nicht erreichbar. Bitte später erneut versuchen."));
  });

  wurzel.addEventListener("click", async (event) => {
    const knopf = event.target.closest("[data-apple-produkt]");
    if (knopf && !knopf.disabled) {
      knopf.disabled = true;
      let stand = holeBilling?.();
      if (!kontoToken(stand?.checkoutRef)) {
        stand = await holeStatus({ win });
        if (stand) setzeBilling?.(stand);
      }
      const token = kontoToken(stand?.checkoutRef);
      if (!token) { knopf.disabled = false; sag(t("Bitte melde dich zuerst an — das Abo gehört zu deinem smejj-Konto.")); return; }
      if (stand.plan && stand.plan !== "free" && stand.quelle !== "apple") { zeichneAppleKnoepfe(view, stand); return; }
      try {
        const r = await bruecke.postMessage({ aktion: "kaufen", produkt: knopf.dataset.appleProdukt, kontoToken: token });
        if (r?.status === "gekauft") {
          sag(t("Danke! Dein Kauf wird geprüft …"));
          const stand = await belegeSenden(r.signedTransaction, { win });
          if (stand.ok) { fertig(stand); sag(t("Dein Plan ist aktiv.")); } else sag(t("Kauf bei Apple erfolgreich. Die Freischaltung folgt in Kürze — sonst „Käufe wiederherstellen“ tippen."));
        } else if (r?.status === "wartet") {
          sag(t("Der Kauf wartet auf Bestätigung (z. B. durch die Familienfreigabe)."));
        }
      } catch {
        sag(t("Der Kauf konnte nicht abgeschlossen werden. Es wurde nichts abgebucht."));
      } finally {
        zeichneAppleKnoepfe(view, holeBilling?.());
      }
      return;
    }
    if (event.target.closest("#appleWiederherstellen")) {
      sag(t("Käufe werden gesucht …"));
      try {
        const r = await bruecke.postMessage({ aktion: "wiederherstellen" });
        const belege = r?.signedTransactions || [];
        if (!belege.length) { sag(t("Keine laufenden Käufe gefunden.")); return; }
        const stand = await belegeSenden(belege, { win });
        if (stand.ok) { fertig(stand); sag(t("Käufe wiederhergestellt.")); } else sag(t("Wiederherstellen fehlgeschlagen. Bitte später erneut versuchen."));
      } catch {
        sag(t("Wiederherstellen fehlgeschlagen. Bitte später erneut versuchen."));
      }
      return;
    }
    if (event.target.closest("#appleVerwalten")) bruecke.postMessage({ aktion: "verwalten" }).catch(() => {});
  });

  // Verlängerungen/Käufe, die Apple der App meldet, und laufende Abos beim Öffnen: still abgleichen.
  win.addEventListener?.("smejj-kauf-update", (e) => {
    belegeSenden(e?.detail?.signedTransaction, { win }).then(fertig);
  });
  bruecke.postMessage({ aktion: "berechtigungen" }).then((r) => {
    const belege = r?.signedTransactions || [];
    if (belege.length) belegeSenden(belege, { win }).then(fertig);
  }).catch(() => {});
  return true;
}

/** Kündigen in der App: Apples Abo-Verwaltung (dort kündigt man Apple-Abos). true = übernommen. */
export function appleVerwalten(win = globalThis) {
  const bruecke = appleBruecke(win);
  if (!bruecke) return false;
  bruecke.postMessage({ aktion: "verwalten" }).catch(() => {});
  return true;
}
