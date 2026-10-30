// smejj.com — Steuerleiste und Stimmen-Menue des Sprachmodus.
//
// Inhaber-Auftrag 30.10.2026 („Premium Voice Mode wie ChatGPT und Gemini“):
// unten eine schwebende, transparente Leiste mit Antwort stoppen, Lautsprecher,
// Stimme und Einstellungen; Mikrofon, Eingabefeld und X (Schliessen) bestehen
// schon. Das Menue zeigt die Stimmenbibliothek (voice-stimmen.js) nach
// Geschlecht, mit Vorschau per Klick, und die Persoenlichkeiten — beides
// unabhaengig waehlbar und dauerhaft gespeichert.
//
// Bewusst nur ein Aufsatz: Zustandsautomat, Erkennung und Vorlese-Queue in
// composer-tools.js bleiben unberuehrt (gesperrte Datei). „Antwort stoppen“
// nutzt den vorhandenen Unterbrechen-Weg (Tipp auf das Logo,
// voice-ohr-solo.js/voice-realtime.js), statt einen zweiten zu bauen.
// Eingehaengt von voice-overlay-ui.js per dynamischem Import (fail-safe).
import { stimmText } from "./voice-overlay-ui.js?v=2026103001";
import { CLIENT_ROUTES } from "./config.js?v=2026103001";
import { createPremiumVoice } from "./voice-premium-tts.js?v=2026103001";
import {
  PERSOENLICHKEITEN, STIMMEN, leseStimmWahl, persoenlichkeitVon, speichereStimmWahl, sprechstilRegel, waehleBrowserStimme
} from "./voice-stimmen.js?v=2026103001";

// Eigene Texte dieses Menues: Deutsch ist der Schluessel (wie i18n/ui.js);
// fehlt dort eine Uebersetzung, hilft fuer Englisch diese kleine Tabelle.
const ENGLISCH = {
  "Antwort stoppen": "Stop answer", "Lautsprecher aus": "Speaker off", "Lautsprecher an": "Speaker on",
  "Stimme wählen": "Choose voice", "Einstellungen": "Settings", "Stimme und Sprechstil": "Voice and style",
  "Stimme": "Voice", "Persönlichkeit": "Personality", "Weiblich": "Female", "Männlich": "Male",
  "Vorschau": "Preview", "Fertig": "Done", "Eigene Sprechweise": "Your own speaking style",
  "Tempo": "Speed", "z. B. wie ein geduldiger Lehrer, mit Beispielen": "e.g. like a patient teacher, with examples",
  "Die Stimme gilt für die Sprachausgabe in dieser Sprache.": "The voice is used for spoken answers in this language.",
  "Ohne Sprachdienst spricht die Browser-Stimme mit passendem Geschlecht, soweit vorhanden.": "Without the voice service, the browser voice with a matching gender is used where available.",
  "Hallo, ich bin {name}. So klinge ich als deine smejj.com Stimme.": "Hi, I'm {name}. This is how I sound as your smejj.com voice.",
  "freundlich und natürlich": "friendly and natural", "ruhig und angenehm": "calm and pleasant",
  "jung und hell": "young and bright", "warm und sympathisch": "warm and likeable", "tief und souverän": "deep and confident",
  "professionell und ruhig": "professional and calm", "professionell": "professional", "jung und dynamisch": "young and dynamic",
  "Freundlich": "Friendly", "herzlich und sympathisch": "warm-hearted and likeable", "Professionell": "Professional",
  "sachlich und kompetent": "factual and competent", "Locker": "Casual", "entspannt wie ein Freund": "relaxed like a friend",
  "Emotional": "Emotional", "warm und einfühlsam": "warm and empathetic", "Humorvoll": "Humorous", "lustig und lebendig": "funny and lively",
  "Ruhig": "Calm", "langsam und beruhigend": "slow and soothing", "Direkt": "Direct", "kurz und deutlich": "short and clear",
  "Streng": "Strict", "bestimmt und konsequent": "firm and consistent", "Begeistert": "Enthusiastic",
  "energiegeladen und motivierend": "energetic and motivating", "Individuell": "Custom", "eigene Sprechweise": "your own style"
};
const VORSCHAU_SPRACHE = { de: "de-DE", en: "en-US" };

function uiEnglisch() {
  return /^en\b/i.test(document.documentElement.lang || "");
}

function tx(text) {
  const uebersetzt = stimmText(text);
  if (uebersetzt !== text) return uebersetzt;
  return uiEnglisch() ? ENGLISCH[text] || text : text;
}

function knopf(klasse, label, svg) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = klasse;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
  return b;
}

const ICON = {
  stopp: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  lautAn: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  lautAus: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  stimme: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  einstellungen: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  play: '<path d="M8 5v14l11-7z"/>'
};

/** Laufende Antwort ueber den vorhandenen Weg unterbrechen (Tipp auf das Logo). */
export function unterbrecheAntwort(doc = document) {
  const ziel = doc.querySelector("#voiceModeOverlay .voice-mode-logo") || doc.querySelector("#voiceModeStatus");
  if (!ziel) return false;
  const Ereignis = typeof PointerEvent === "function" ? PointerEvent : Event;
  ziel.dispatchEvent(new Ereignis("pointerup", { bubbles: true, cancelable: true }));
  return true;
}

// Wortwahl der Persoenlichkeit reist mit jeder Sprachmodus-Anfrage mit:
// composer-tools.js setzt window.smejjVoiceModePreferences = { voiceMode: true }
// (gesperrte Datei), app.js mischt das Objekt in preferences. Der Getter haengt
// die aktuelle Wahl an, ohne einen der beiden Wege zu aendern.
export function verbindeSprechstil(ziel = window) {
  const beschreibung = Object.getOwnPropertyDescriptor(ziel, "smejjVoiceModePreferences");
  if (beschreibung?.get) return;
  let wert = ziel.smejjVoiceModePreferences;
  Object.defineProperty(ziel, "smejjVoiceModePreferences", {
    configurable: true,
    get() {
      if (!wert || wert.voiceMode !== true) return wert;
      const stil = sprechstilRegel();
      return stil.regel ? { ...wert, sprechstil: stil } : wert;
    },
    set(neu) { wert = neu; }
  });
}

function baueSheet() {
  const sheet = document.createElement("div");
  sheet.className = "voice-stimmen-sheet";
  sheet.id = "voiceStimmenSheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", tx("Stimme und Sprechstil"));
  sheet.hidden = true;
  sheet.innerHTML = `
    <div class="voice-stimmen-kopf">
      <div class="voice-stimmen-reiter" role="tablist">
        <button type="button" role="tab" data-reiter="stimme">${tx("Stimme")}</button>
        <button type="button" role="tab" data-reiter="stil">${tx("Persönlichkeit")}</button>
      </div>
      <button type="button" class="voice-stimmen-fertig">${tx("Fertig")}</button>
    </div>
    <section data-bereich="stimme">
      <div class="voice-stimmen-sprachen" role="radiogroup" aria-label="Sprache">
        <button type="button" data-sprache="de">Deutsch</button>
        <button type="button" data-sprache="en">English</button>
      </div>
      <p class="voice-stimmen-hinweis">${tx("Die Stimme gilt für die Sprachausgabe in dieser Sprache.")}</p>
      <div class="voice-stimmen-liste"></div>
      <p class="voice-stimmen-hinweis">${tx("Ohne Sprachdienst spricht die Browser-Stimme mit passendem Geschlecht, soweit vorhanden.")}</p>
    </section>
    <section data-bereich="stil">
      <div class="voice-stil-liste" role="radiogroup" aria-label="${tx("Persönlichkeit")}"></div>
      <div class="voice-stil-eigen">
        <label>${tx("Eigene Sprechweise")}
          <textarea maxlength="160" rows="2" placeholder="${tx("z. B. wie ein geduldiger Lehrer, mit Beispielen")}"></textarea>
        </label>
        <label>${tx("Tempo")} <input type="range" min="0.8" max="1.25" step="0.05"></label>
      </div>
    </section>`;
  return sheet;
}

function zeileFuer(stimme, gewaehlt) {
  const zeile = document.createElement("div");
  zeile.className = "voice-stimme";
  zeile.innerHTML = `
    <button type="button" class="voice-stimme-wahl" role="radio" aria-checked="${gewaehlt}" data-stimme="${stimme.id}">
      <strong>${stimme.name}</strong><span>${tx(stimme.art)} · ${stimme.sprache}</span>
    </button>`;
  const vorschau = knopf("voice-stimme-vorschau", `${tx("Vorschau")}: ${stimme.name}`, ICON.play);
  vorschau.dataset.stimme = stimme.id;
  zeile.appendChild(vorschau);
  return zeile;
}

export function bindeStimmenPanel({ overlay = document.querySelector("#voiceModeOverlay") } = {}) {
  if (!overlay || overlay.dataset.stimmenPanel === "true") return null;
  overlay.dataset.stimmenPanel = "true";
  verbindeSprechstil();
  let sprache = /^en\b/i.test(document.documentElement.lang || "") ? "en" : "de";
  let mikrofonVonUnsStumm = false;

  const leiste = document.createElement("div");
  leiste.className = "voice-steuerleiste";
  leiste.setAttribute("role", "toolbar");
  leiste.setAttribute("aria-label", "Sprachmodus");
  const stopp = knopf("voice-steuer-stopp", tx("Antwort stoppen"), ICON.stopp);
  const laut = knopf("voice-steuer-laut", tx("Lautsprecher aus"), ICON.lautAn);
  const stimmeKnopf = knopf("voice-steuer-stimme", tx("Stimme wählen"), ICON.stimme);
  const einst = knopf("voice-steuer-einstellungen", tx("Einstellungen"), ICON.einstellungen);
  leiste.append(stopp, laut, stimmeKnopf, einst);
  const bar = overlay.querySelector(".voice-mode-bar");
  overlay.insertBefore(leiste, bar || null);
  const sheet = baueSheet();
  overlay.appendChild(sheet);

  const vorschauStimme = createPremiumVoice({
    statusUrl: CLIENT_ROUTES.api.voiceStatus,
    ttsUrl: CLIENT_ROUTES.api.voiceTts,
    lang: () => VORSCHAU_SPRACHE[sprache],
    parameter: () => ({ voice: vorschauId, ...stilWerte() }),
    vorlader: false
  });
  let vorschauId = "";
  const stilWerte = () => {
    const wahl = leseStimmWahl();
    const stil = persoenlichkeitVon(wahl);
    return { tempo: stil.id === "individuell" ? wahl.eigenesTempo : stil.tempo, ausdruck: stil.ausdruck };
  };

  function zeigeLautsprecher() {
    const an = leseStimmWahl().lautsprecher;
    laut.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${an ? ICON.lautAn : ICON.lautAus}</svg>`;
    laut.setAttribute("aria-pressed", String(!an));
    laut.title = tx(an ? "Lautsprecher aus" : "Lautsprecher an");
    laut.setAttribute("aria-label", laut.title);
    overlay.dataset.lautsprecher = an ? "an" : "aus";
  }

  function zeichneStimmen() {
    const wahl = leseStimmWahl();
    sheet.querySelectorAll("[data-sprache]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sprache === sprache)));
    const liste = sheet.querySelector(".voice-stimmen-liste");
    liste.textContent = "";
    for (const [geschlecht, titel] of [["w", "Weiblich"], ["m", "Männlich"]]) {
      const gruppe = document.createElement("div");
      gruppe.className = "voice-stimmen-gruppe";
      gruppe.setAttribute("role", "radiogroup");
      gruppe.setAttribute("aria-label", tx(titel));
      gruppe.innerHTML = `<h3>${tx(titel)}</h3>`;
      STIMMEN[sprache].filter((s) => s.geschlecht === geschlecht)
        .forEach((s) => gruppe.appendChild(zeileFuer(s, s.id === wahl.stimmen[sprache])));
      liste.appendChild(gruppe);
    }
  }

  function zeichneStile() {
    const wahl = leseStimmWahl();
    const liste = sheet.querySelector(".voice-stil-liste");
    liste.textContent = "";
    for (const stil of PERSOENLICHKEITEN) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "voice-stil";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(stil.id === wahl.persoenlichkeit));
      b.dataset.stil = stil.id;
      b.innerHTML = `<strong>${tx(stil.name)}</strong><span>${tx(stil.art)}</span>`;
      liste.appendChild(b);
    }
    const eigen = sheet.querySelector(".voice-stil-eigen");
    eigen.hidden = wahl.persoenlichkeit !== "individuell";
    eigen.querySelector("textarea").value = wahl.eigenerStil;
    eigen.querySelector("input").value = String(wahl.eigenesTempo);
  }

  function zeigeReiter(reiter) {
    sheet.querySelectorAll("[data-reiter]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.reiter === reiter)));
    sheet.querySelectorAll("[data-bereich]").forEach((s) => { s.hidden = s.dataset.bereich !== reiter; });
  }

  function oeffne(reiter) {
    unterbrecheAntwort();
    // Mikrofon waehrend des Menues stumm: sonst hoert das Ohr die Vorschau als Frage.
    const mic = overlay.querySelector("#voiceModeMic");
    mikrofonVonUnsStumm = Boolean(mic && overlay.dataset.muted !== "true");
    if (mikrofonVonUnsStumm) mic.click();
    zeichneStimmen();
    zeichneStile();
    zeigeReiter(reiter);
    sheet.hidden = false;
    overlay.dataset.stimmenMenue = "offen";
    sheet.querySelector(`[data-reiter="${reiter}"]`)?.focus({ preventScroll: true });
  }

  function schliesse() {
    if (sheet.hidden) return;
    vorschauStimme.cancel();
    try { window.speechSynthesis?.cancel(); } catch { /* keine Browser-Stimme */ }
    sheet.hidden = true;
    delete overlay.dataset.stimmenMenue;
    const mic = overlay.querySelector("#voiceModeMic");
    if (mikrofonVonUnsStumm && mic && !overlay.hidden && overlay.dataset.muted === "true") mic.click();
    mikrofonVonUnsStumm = false;
    stimmeKnopf.focus({ preventScroll: true });
  }

  async function spieleVorschau(id) {
    const stimme = STIMMEN[sprache].find((s) => s.id === id);
    if (!stimme) return;
    vorschauStimme.cancel();
    try { window.speechSynthesis?.cancel(); } catch { /* still */ }
    vorschauId = id;
    const text = tx("Hallo, ich bin {name}. So klinge ich als deine smejj.com Stimme.").replace("{name}", stimme.name);
    const knopfEl = sheet.querySelector(`.voice-stimme-vorschau[data-stimme="${id}"]`);
    knopfEl?.classList.add("is-playing");
    const fertig = () => knopfEl?.classList.remove("is-playing");
    vorschauStimme.unlock();
    try {
      if (!(await vorschauStimme.isAvailable())) throw new Error("kein Sprachdienst");
      await vorschauStimme.speak(text, { onend: fertig });
    } catch {
      // Rueckfall: Browser-Stimme passenden Geschlechts (wie im Gespraech).
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = VORSCHAU_SPRACHE[sprache];
        const passende = (window.speechSynthesis.getVoices() || []).filter((v) => (v.lang || "").startsWith(sprache));
        const v = waehleBrowserStimme(passende, stimme.geschlecht);
        if (v) u.voice = v;
        u.onend = fertig;
        u.onerror = fertig;
        window.speechSynthesis.speak(u);
      } catch { fertig(); }
    }
  }

  stopp.addEventListener("click", () => unterbrecheAntwort());
  laut.addEventListener("click", () => {
    speichereStimmWahl({ lautsprecher: !leseStimmWahl().lautsprecher });
    zeigeLautsprecher();
  });
  stimmeKnopf.addEventListener("click", () => (sheet.hidden ? oeffne("stimme") : schliesse()));
  einst.addEventListener("click", () => (sheet.hidden ? oeffne("stil") : schliesse()));
  sheet.querySelector(".voice-stimmen-fertig").addEventListener("click", schliesse);
  sheet.addEventListener("click", (ereignis) => {
    const ziel = ereignis.target.closest("button");
    if (!ziel) return;
    if (ziel.dataset.reiter) zeigeReiter(ziel.dataset.reiter);
    else if (ziel.dataset.sprache) { sprache = ziel.dataset.sprache; zeichneStimmen(); }
    else if (ziel.classList.contains("voice-stimme-vorschau")) spieleVorschau(ziel.dataset.stimme);
    else if (ziel.classList.contains("voice-stimme-wahl")) {
      speichereStimmWahl({ stimmen: { [sprache]: ziel.dataset.stimme } });
      zeichneStimmen();
      vorschauId = ziel.dataset.stimme;
      vorschauStimme.isAvailable().catch(() => {}); // Bruecke laedt die Stimme schon vor
      spieleVorschau(ziel.dataset.stimme);
    } else if (ziel.dataset.stil) {
      speichereStimmWahl({ persoenlichkeit: ziel.dataset.stil });
      zeichneStile();
    }
  });
  sheet.querySelector("textarea").addEventListener("change", (e) => speichereStimmWahl({ eigenerStil: e.target.value }));
  sheet.querySelector("input[type=range]").addEventListener("change", (e) => speichereStimmWahl({ eigenesTempo: Number(e.target.value) }));
  // Escape schliesst zuerst das Menue, erst das naechste Escape den Sprachmodus.
  document.addEventListener("keydown", (ereignis) => {
    if (ereignis.key !== "Escape" || sheet.hidden) return;
    ereignis.stopPropagation();
    schliesse();
  }, true);
  // Beim Schliessen des Sprachmodus (X) verschwindet auch das Menue.
  new MutationObserver(() => { if (overlay.hidden) schliesse(); }).observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
  zeigeLautsprecher();
  return { oeffne, schliesse, leiste, sheet };
}
