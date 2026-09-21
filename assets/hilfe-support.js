// smejj.com — Hilfeseite: direkt an den Support schreiben (Stufe 1).
//
// Eigene Datei statt Inline-Skript: die Hilfeseite traegt eine strikte CSP
// (script-src 'self'), und das ist gut so — sie bleibt unangetastet.
//
// Zweisprachig (21.09.2026): dieselbe Datei traegt die deutsche Hilfeseite UND
// /en/support.html — die Support-URL, die Apple im App Store sieht. Die Sprache
// kommt aus <html lang>, damit ein englischer Pruefer keine deutschen Meldungen
// bekommt. Kein i18n-Modul: die statischen Seiten laufen ausserhalb der Huelle.
//
// Der Weg: POST an den Control-Server (/api/support/ticket) mit dem
// Anmelde-Token der App. Die KI-Sofortantwort kommt direkt in der Antwort
// zurueck und wird EHRLICH als automatische Antwort angezeigt.
(function () {
  "use strict";
  const TOKEN_KEY = "smejj.auth.accessToken.v1";
  const CONTROL = "https://api.smejj.com";

  const EN = String(document.documentElement.lang || "de").toLowerCase().startsWith("en");
  const W = EN ? {
    anmelden: "Please sign in first — support tickets belong to your account so we can actually help you.",
    zuKurz: "Please describe in a few words what is not working.",
    sendet: "Sending …",
    senden: "Send to support",
    abgelaufen: "Your session has expired. Please sign in again and send it once more.",
    zuOft: "You have sent several requests just now. Please wait a moment — the earlier tickets did arrive.",
    fehler: (grund) => "That did not work just now (" + grund + "). Your report is NOT lost if a ticket number is shown above — otherwise please try again.",
    angekommen: (id) => "Ticket " + id + " has arrived.",
    autoTitel: "<strong>Automatic answer</strong> (a human is reading along):",
    mensch: "A human is taking over your case — you will hear from us.",
    keineVerbindung: "No connection to the support server. Please try again later."
  } : {
    anmelden: "Bitte zuerst anmelden — der Support gehört zu Ihrem Konto, damit wir Ihnen wirklich helfen können.",
    zuKurz: "Bitte beschreiben Sie kurz, was nicht geht.",
    sendet: "Wird gesendet …",
    senden: "An den Support senden",
    abgelaufen: "Ihre Anmeldung ist abgelaufen. Bitte neu anmelden und noch einmal senden.",
    zuOft: "Sie haben gerade mehrere Anfragen gestellt. Bitte kurz warten — Ihre bisherigen Tickets sind angekommen.",
    fehler: (grund) => "Das hat gerade nicht geklappt (" + grund + "). Ihre Meldung ging NICHT verloren, wenn oben eine Ticket-Nummer steht — sonst bitte noch einmal versuchen.",
    angekommen: (id) => "Ticket " + id + " ist angekommen.",
    autoTitel: "<strong>Automatische Antwort</strong> (ein Mensch liest mit):",
    mensch: "Ein Mensch übernimmt Ihren Fall — Sie hören von uns.",
    keineVerbindung: "Keine Verbindung zum Support-Server. Bitte später noch einmal versuchen."
  };

  const form = document.getElementById("supportForm");
  if (!form) return;
  const betreff = document.getElementById("supportBetreff");
  const text = document.getElementById("supportText");
  const knopf = document.getElementById("supportSenden");
  const ausgabe = document.getElementById("supportAusgabe");

  function zeige(html, art) {
    ausgabe.hidden = false;
    ausgabe.className = "card support-ausgabe" + (art ? " support-" + art : "");
    ausgabe.textContent = "";
    const p = document.createElement("p");
    p.textContent = html;
    ausgabe.appendChild(p);
    return p;
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  }

  form.addEventListener("submit", async (ereignis) => {
    ereignis.preventDefault();
    if (!token()) {
      zeige(W.anmelden, "hinweis");
      return;
    }
    if (String(text.value || "").trim().length < 5) {
      zeige(W.zuKurz, "hinweis");
      return;
    }
    knopf.disabled = true;
    knopf.textContent = W.sendet;
    try {
      const antwort = await fetch(CONTROL + "/api/support/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
        body: JSON.stringify({ betreff: betreff.value, text: text.value })
      });
      const daten = await antwort.json().catch(() => ({}));
      if (antwort.status === 401) {
        zeige(W.abgelaufen, "hinweis");
        return;
      }
      if (antwort.status === 429) {
        zeige(W.zuOft, "hinweis");
        return;
      }
      if (!antwort.ok || !daten.ok) {
        zeige(W.fehler(daten.error || antwort.status), "fehler");
        return;
      }
      const t = daten.ticket || {};
      const auto = (t.verlauf || []).find((v) => v.von === "automatik");
      const kopf = zeige(W.angekommen(t.id), "ok");
      if (auto) {
        const titel = document.createElement("p");
        titel.innerHTML = W.autoTitel;
        const inhalt = document.createElement("p");
        inhalt.textContent = auto.text;
        ausgabe.appendChild(titel);
        ausgabe.appendChild(inhalt);
      } else {
        const info = document.createElement("p");
        info.textContent = W.mensch;
        ausgabe.appendChild(info);
      }
      form.reset();
      void kopf;
    } catch {
      zeige(W.keineVerbindung, "fehler");
    } finally {
      knopf.disabled = false;
      knopf.textContent = W.senden;
    }
  });
})();
