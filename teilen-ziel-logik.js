// smejj.com — Teilen-Ziel (Inhaber-Freigabe 16.11.2026: "Ja, Teilen-Ziel fuer
// Android und iPhone einbauen").
//
// Android (TWA/Chrome) und die iPhone-App oeffnen beim System-"Teilen" die
// Startseite mit dem geteilten Inhalt als GET-Parameter:
//   /?teilen=1&title=…&text=…&url=…   (alle optional, URL-codiert)
// Ohne teilen=1 genuegt ein vorhandener title/text/url-Parameter (so haengt der
// Browser die Felder bei method GET an die action an).
// Verhalten: neue Unterhaltung beginnen, das untere Eingabefeld VORBEFUELLEN
// (nie automatisch senden), Parameter danach aus der Adresse putzen. Nur reine
// Logik, kein Aussehen (Design-Lock). Inhalt wird ausschliesslich als
// Feldwert gesetzt (kein innerHTML) — damit kein XSS-Weg.

export const TEILEN_MAX_ZEICHEN = 4000;
export const TEILEN_PARAMETER = Object.freeze(["teilen", "title", "text", "url"]);

/** true, wenn die Adresse ein Teilen-Aufruf ist. Input: URLSearchParams. */
export function istTeilenAufruf(params) {
  if (!params) return false;
  if (params.get("teilen") === "1") return true;
  return ["title", "text", "url"].some((name) => (params.get(name) || "").trim() !== "");
}

/** Steuerzeichen raus (Zeilenumbruch und Tab bleiben), Zeilenenden vereinheitlichen. */
export function bereinige(wert) {
  return String(wert ?? "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u2028\u2029\uFEFF]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Kuerzt auf hoechstens max Zeichen, ohne ein Emoji/Surrogatpaar zu zerschneiden. */
export function kuerze(text, max = TEILEN_MAX_ZEICHEN) {
  const zeichen = Array.from(text);
  return zeichen.length <= max ? text : zeichen.slice(0, max).join("").trimEnd();
}

/** Setzt title, text und url zu EINEM Feldtext zusammen — ohne Doppelungen. */
export function teilenText({ title, text, url } = {}) {
  const t = bereinige(title);
  let x = bereinige(text);
  const u = bereinige(url);
  const teile = [];
  // Titel nur, wenn er nicht schon im Text oder in der Adresse steckt.
  const mitTitel = Boolean(t && !x.includes(t) && t !== u);
  if (mitTitel) teile.push(t);
  if (x && x === u) x = "";
  if (x) teile.push(x);
  // Adresse nur, wenn sie nicht schon im Text/Titel steht (viele Apps packen sie in text).
  if (u && !x.includes(u) && !(mitTitel && t.includes(u))) teile.push(u);
  return kuerze(teile.join("\n"));
}

/** Entfernt die Teilen-Parameter; liefert die bereinigte relative Adresse. */
export function bereinigteAdresse(loc) {
  const params = new URLSearchParams(loc.search || "");
  for (const name of TEILEN_PARAMETER) params.delete(name);
  const rest = params.toString();
  return (loc.pathname || "/") + (rest ? "?" + rest : "") + (loc.hash || "");
}

/** Fuellt das Startfeld nur als Text und laesst die vorhandene Autogroesse nachziehen. */
export function fuelleFeld(feld, inhalt) {
  if (!feld || !inhalt) return false;
  feld.value = inhalt;
  feld.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const params = new URLSearchParams(location.search);
  if (istTeilenAufruf(params)) {
    const inhalt = teilenText({ title: params.get("title"), text: params.get("text"), url: params.get("url") });
    // Sofort putzen: ein Neuladen darf den Inhalt nicht erneut einsetzen.
    try { history.replaceState(history.state, "", bereinigteAdresse(location)); } catch { /* egal */ }
    const einsetzen = () => {
      const feld = document.getElementById("startMessage");
      if (!fuelleFeld(feld, inhalt)) return;
      try { feld.focus({ preventScroll: true }); } catch { /* egal */ }
      // Spaeter startende Module (Chat-Wiederherstellung) koennten das Feld leeren —
      // einmal nachsehen; nie ueberschreiben, was der Nutzer inzwischen tippt.
      setTimeout(() => { if (!feld.value) fuelleFeld(feld, inhalt); }, 800);
    };
    const start = () => {
      // Dieselbe Modul-Kennung wie ueberall — sonst zweite Instanz (Waechter).
      import("/assets/chat-store.js?v=2026111406")
        .then((m) => m.newChat?.())
        .catch(() => { /* nicht angemeldet oder Modul fehlt: Feld trotzdem fuellen */ })
        .finally(einsetzen);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
}
