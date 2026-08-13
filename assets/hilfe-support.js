// smejj.com — Hilfeseite: direkt an den Support schreiben (Stufe 1).
//
// Eigene Datei statt Inline-Skript: die Hilfeseite traegt eine strikte CSP
// (script-src 'self'), und das ist gut so — sie bleibt unangetastet.
//
// Der Weg: POST an den Control-Server (/api/support/ticket) mit dem
// Anmelde-Token der App. Die KI-Sofortantwort kommt direkt in der Antwort
// zurueck und wird EHRLICH als automatische Antwort angezeigt.
(function () {
  "use strict";
  const TOKEN_KEY = "smejj.auth.accessToken.v1";
  const CONTROL = "https://smejj-control.zeabur.app";

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
      zeige("Bitte zuerst anmelden — der Support gehört zu Ihrem Konto, damit wir Ihnen wirklich helfen können.", "hinweis");
      return;
    }
    if (String(text.value || "").trim().length < 5) {
      zeige("Bitte beschreiben Sie kurz, was nicht geht.", "hinweis");
      return;
    }
    knopf.disabled = true;
    knopf.textContent = "Wird gesendet …";
    try {
      const antwort = await fetch(CONTROL + "/api/support/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
        body: JSON.stringify({ betreff: betreff.value, text: text.value })
      });
      const daten = await antwort.json().catch(() => ({}));
      if (antwort.status === 401) {
        zeige("Ihre Anmeldung ist abgelaufen. Bitte neu anmelden und noch einmal senden.", "hinweis");
        return;
      }
      if (antwort.status === 429) {
        zeige("Sie haben gerade mehrere Anfragen gestellt. Bitte kurz warten — Ihre bisherigen Tickets sind angekommen.", "hinweis");
        return;
      }
      if (!antwort.ok || !daten.ok) {
        zeige("Das hat gerade nicht geklappt (" + (daten.error || antwort.status) + "). Ihre Meldung ging NICHT verloren, wenn oben eine Ticket-Nummer steht — sonst bitte noch einmal versuchen.", "fehler");
        return;
      }
      const t = daten.ticket || {};
      const auto = (t.verlauf || []).find((v) => v.von === "automatik");
      const kopf = zeige("Ticket " + t.id + " ist angekommen.", "ok");
      if (auto) {
        const titel = document.createElement("p");
        titel.innerHTML = "<strong>Automatische Antwort</strong> (ein Mensch liest mit):";
        const inhalt = document.createElement("p");
        inhalt.textContent = auto.text;
        ausgabe.appendChild(titel);
        ausgabe.appendChild(inhalt);
      } else {
        const info = document.createElement("p");
        info.textContent = "Ein Mensch übernimmt Ihren Fall — Sie hören von uns.";
        ausgabe.appendChild(info);
      }
      form.reset();
      void kopf;
    } catch {
      zeige("Keine Verbindung zum Support-Server. Bitte später noch einmal versuchen.", "fehler");
    } finally {
      knopf.disabled = false;
      knopf.textContent = "An den Support senden";
    }
  });
})();
