// smejj.com — mehrzeiliger Gast-Composer; Dateien bleiben bis zur Anmeldung lokal.
import { initEingabeHost } from "./composer-eingabe-host.js?v=2026102793";
const form = document.getElementById("probierForm"), input = document.getElementById("probierFeld");
if (form && input) {
  initEingabeHost();
  const notify = feld => feld.dispatchEvent(new Event("input", { bubbles: true }));
  const wachsen = () => { input.style.height = "auto"; input.style.height = Math.min(230, input.scrollHeight) + "px"; };
  input.addEventListener("input", wachsen); wachsen();
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  const menu = document.getElementById("gastDateiMenu"), plus = document.getElementById("gastPlus");
  plus.addEventListener("click", () => { menu.hidden = !menu.hidden; plus.setAttribute("aria-expanded", String(!menu.hidden)); });
  for (const button of menu.querySelectorAll("[data-picker]")) button.addEventListener("click", () => { document.getElementById(button.dataset.picker).click(); menu.hidden = true; plus.setAttribute("aria-expanded", "false"); });
  for (const picker of form.querySelectorAll("input[type=file]")) picker.addEventListener("change", async () => {
    const files = Array.from(picker.files || []); picker.value = "";
    const { uebernehmeDateiAuswahl } = await import("./composer-bild-anhang.js?v=2026102793");
    await uebernehmeDateiAuswahl(files, input, notify); hinweis(); input.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  function hinweis() {
    let p = document.getElementById("gastAnhangHinweis");
    if (!p) { p = document.createElement("p"); p.id = "gastAnhangHinweis"; p.setAttribute("role", "status"); form.append(p); }
    p.replaceChildren(document.createTextNode("Deine Anhänge bleiben auf diesem Gerät. Zum Senden bitte "));
    const link = document.createElement("a"); link.href = "/auth/register/"; link.textContent = "kostenlos anmelden";
    link.addEventListener("click", () => { try { sessionStorage.setItem("smejj.gastAnhangUebernahme.v1", "ja"); sessionStorage.setItem("smejj.probierFrage.v1", input.value); } catch {} void window.smejjSichereDateiEntwurf?.(); });
    p.append(link, document.createTextNode(". Deine Frage und Anhänge werden übernommen."));
  }
  window.addEventListener("smejj:gast-anhang", hinweis);
  form.addEventListener("submit", e => {
    if (window.smejjAnhangChips?.hatAnhaenge?.()) { e.preventDefault(); e.stopImmediatePropagation(); hinweis(); }
  }, true);
  let dictation;
  document.getElementById("gastDiktat").addEventListener("click", async () => {
    if (!dictation) {
      const [{ createDictation }, { createServerEar }, { CLIENT_ROUTES }] = await Promise.all([import("./composer-dictation.js?v=2026102793"), import("./voice-ear.js?v=2026102793"), import("./config.js?v=2026102793")]);
      const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      const warn = text => { const p = document.getElementById("gastDiktatStatus"); p.textContent = text; };
      dictation = createDictation({ getInput: () => input, notifyInputChanged: notify, RecognitionCtor, speechSupported: () => Boolean(RecognitionCtor), lang: () => document.documentElement.lang || "de-DE", showToast: warn, serverOhr: createServerEar({ urls: [CLIENT_ROUTES.api.voiceTranscribeFallback], budgetMs: 6000 }), setVisual: active => document.getElementById("gastDiktat").setAttribute("aria-pressed", String(active)) });
    }
    dictation.toggle();
  });
}
