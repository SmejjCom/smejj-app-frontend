// smejj.com Operations Console — Zugriff auf die eigene API.
//
// DIESELBE Datei laeuft an ZWEI Orten, und das ist Absicht:
//
//   1. smejj.com/admin  (GitHub Pages, der normale Weg seit 2026-08-07).
//      Statisch ausgeliefert, wie es die Architekturregel verlangt: "Alles, was
//      statisch ausgeliefert werden kann, wird statisch ausgeliefert. Der
//      Control Server steht nie im Pfad des normalen Seitenaufrufs."
//      Hier ist die API fremde Herkunft — Anmeldung per Bearer-Token aus
//      localStorage, genau wie in assets/account-sessions.js. Das Cookie taugt
//      cross-site nicht (SameSite=Lax).
//
//   2. <control-server>/admin  (der bisherige Weg, bleibt als Rueckfall).
//      Gleiche Herkunft, das Sitzungs-Cookie geht von selbst mit.
//
// Deshalb wird die Basis-Adresse NICHT fest verdrahtet, sondern aus der
// eigenen Herkunft abgeleitet. Wer das aendert, muss beide Wege pruefen.
//
// Klassisches Skript (kein ES-Modul), damit die CSP-Regel script-src 'self'
// ohne Sonderfall greift.
//
// Jede Antwort wird auf ein einheitliches Ergebnis gebracht: { ok, status, data,
// fehler }. Die Ansichten sollen Fehler anzeigen, nicht auffangen muessen.
(function () {
  "use strict";

  // Gleicher Schluessel wie assets/auth-page.js und assets/account-sessions.js —
  // wer sich auf smejj.com anmeldet, ist damit auch in der Konsole angemeldet.
  const TOKEN_KEY = "smejj.auth.accessToken.v1";
  const CONTROL_ORIGIN = "https://smejj-control.zeabur.app";
  const AKTIV_KEY = "smejj.admin.apiOrigin.aktiv.v1";

  let apiBasis = CONTROL_ORIGIN;
  let umschaltbar = false;
  (function () {
    try {
      sessionStorage.removeItem(AKTIV_KEY);
      if (location.origin === CONTROL_ORIGIN) { apiBasis = ""; return; }
      const eigen = localStorage.getItem("smejj.apiOrigin.v1");
      if (eigen && /^https?:\/\//.test(eigen)) { apiBasis = eigen.replace(/\/+$/, ""); return; }
      apiBasis = CONTROL_ORIGIN;
    } catch { /* Storage gesperrt: Standard bleibt */ }
  })();

  /**
   * Wann darf eine gescheiterte Anfrage auf den anderen Host ausweichen?
   * Status 0 (Netz/CSP) und 503 (Gateway ohne lebende Instanz) heissen: die
   * Anfrage hat den Server NIE erreicht — Wiederholen ist auch fuer
   * schreibende Aktionen gefahrlos. 502/504 koennen dagegen bedeuten, dass
   * der Server schon gearbeitet hat; dort weicht nur LESEN aus, sonst
   * koennte ein Doppel-POST z. B. zweimal loeschen.
   */
  function darfAusweichen(antwort, nurSicher) {
    if (!umschaltbar) return false;
    if (antwort.status === 0 || antwort.status === 503) return true;
    if (!nurSicher && (antwort.status === 502 || antwort.status === 504)) return true;
    return false;
  }

  function wechselHost() {
    apiBasis = (apiBasis === CONTROL_ORIGIN) ? ZWEIT_ORIGIN : CONTROL_ORIGIN;
    try { sessionStorage.setItem(AKTIV_KEY, apiBasis); } catch { /* egal */ }
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  }

  /** Vollstaendige Adresse fuer einen API-Pfad. */
  function url(pfad) {
    return apiBasis + pfad;
  }

  /**
   * Kopfzeilen inklusive Anmeldung. Ohne Token wird KEIN leerer
   * Authorization-Kopf gesendet — der Server wuerde ihn als Fehlversuch werten.
   */
  function kopf(extra) {
    const t = token();
    const basis = Object.assign({ accept: "application/json" }, extra || {});
    if (t) basis.Authorization = "Bearer " + t;
    return basis;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Zeitlimit je Versuch (Befund 2026-08-31): Ohne Limit hing ein zaeherr Ruf
  // beliebig lange — der Tuersteher meldete dann "Konsole nicht geladen",
  // bevor der bewaehrte Host-Wechsel ueberhaupt drankam. 12 s decken jeden
  // beobachteten Ruf ab (langsamster Live-Wert 4 s) und lassen dem
  // Ausweichhost noch Luft innerhalb der 30-s-Wache aus gate.js.
  async function holeEinmal(pfad) {
    const wache = new AbortController();
    const uhr = setTimeout(function () { wache.abort(); }, 12000);
    try {
      const antwort = await fetch(url(pfad), { headers: kopf(), cache: "no-store", signal: wache.signal });
      clearTimeout(uhr);
      const text = await antwort.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
      if (!antwort.ok) return { ok: false, status: antwort.status, data, fehler: fehlertext(antwort.status, data) };
      return { ok: true, status: antwort.status, data, fehler: "" };
    } catch (error) {
      clearTimeout(uhr);
      // Der Abbruch durch die Wache ist Status 0 wie jeder andere Netzfehler —
      // holeDirekt weicht dann auf den zweiten Host aus.
      return { ok: false, status: 0, data: {}, fehler: "Keine Verbindung zum Control-Server: " + String(error && error.message || error) };
    }
  }

  async function holeDirekt(pfad) {
    const erste = await holeEinmal(pfad);
    if (erste.ok || !darfAusweichen(erste, false)) return erste;
    const vorher = apiBasis;
    wechselHost();
    const zweite = await holeEinmal(pfad);
    if (!zweite.ok && darfAusweichen(zweite, false)) {
      // Beide Hosts unerreichbar: zurueck zum bevorzugten, damit die Sitzung
      // nicht auf dem Ausweichhost kleben bleibt, wenn der Hauptweg heilt.
      apiBasis = vorher;
      try { sessionStorage.setItem(AKTIV_KEY, apiBasis); } catch { /* egal */ }
    }
    return zweite;
  }

  // Auch LESEN kann an der Bestaetigungspflicht scheitern (seit 2026-08-06).
  // Ohne diesen Umweg saehe der Betreiber beim ersten Aufruf nur eine
  // Fehlermeldung und haette in der Konsole keinen Knopf, um sie loszuwerden.
  async function hole(pfad) {
    const antwort = await holeDirekt(pfad);
    if (!istBestaetigungNoetig(antwort)) return antwort;
    if (!(await bestaetigungEinholen())) return antwort;
    return holeDirekt(pfad);
  }

  function istBestaetigungNoetig(antwort) {
    const code = antwort && antwort.data && antwort.data.error;
    return antwort && antwort.status === 403
      && (code === "admin_step_up_required" || code === "admin_email_not_verified");
  }

  /**
   * Holt den Mail-Code und fragt ihn in EINEM Dialog der Konsole ab.
   *
   * Bewusst kein window.prompt: das Browserfenster stellt jeder Eingabe den
   * rohen Hostnamen voran ("Auf redbean-…salad.cloud wird Folgendes angezeigt")
   * und sieht damit aus wie die Aufforderung einer fremden Seite. Bei einer
   * Abfrage, die einen Sicherheitscode will, ist genau das die falsche Optik.
   *
   * Ein falscher Code schliesst den Dialog NICHT: der Server erlaubt fuenf
   * Versuche, also darf man sich auch fuenfmal vertippen, ohne die Aktion
   * von vorn zu beginnen.
   *
   * @returns {Promise<boolean>} true = bestaetigt, der Weg ist frei.
   */
  /** base64url -> ArrayBuffer (WebAuthn will Bytes, der Server schickt Text). */
  function ausBase64Url(wert) {
    const roh = atob(String(wert).replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
    return bytes.buffer;
  }

  function nachBase64Url(puffer) {
    const bytes = new Uint8Array(puffer);
    let roh = "";
    for (let i = 0; i < bytes.length; i++) roh += String.fromCharCode(bytes[i]);
    return btoa(roh).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /**
   * Bestaetigung per Passkey. Liefert true nur bei bestandener Pruefung.
   *
   * Gibt bei JEDEM Hindernis still false zurueck — der Aufrufer faellt dann auf
   * den Mail-Code zurueck. Ein Passkey, der nicht klappt, darf niemanden
   * aussperren.
   */
  async function passkeyVersuch() {
    // Passkeys haengen an der Domain (rpId smejj.com). Auf dem Rueckfallweg
    // ueber den Control-Server (*.salad.cloud) sind sie nicht ansprechbar —
    // dort erst gar nicht fragen, sonst sieht der Nutzer eine Fehlermeldung
    // fuer etwas, das dort nie funktionieren kann.
    if (!/(^|\.)smejj\.com$/.test(location.hostname)) return false;
    if (!window.PublicKeyCredential || !navigator.credentials) return false;

    const optionen = await sendeDirekt("/api/admin/step-up/passkey/options", {});
    if (!optionen.ok) return false;          // u. a. 409 = kein Passkey hinterlegt
    const d = optionen.data || {};
    let antwort;
    try {
      antwort = await navigator.credentials.get({
        publicKey: {
          challenge: ausBase64Url(d.challenge),
          rpId: d.rpId,
          timeout: d.timeout,
          userVerification: d.userVerification,
          allowCredentials: (d.allowCredentials || []).map(function (s) {
            return { type: "public-key", id: ausBase64Url(s.id) };
          })
        }
      });
    } catch {
      return false;                          // abgebrochen oder kein Geraet
    }
    if (!antwort) return false;

    const geprueft = await sendeDirekt("/api/admin/step-up/passkey/verify", {
      challengeToken: d.challengeToken,
      id: antwort.id,
      response: {
        authenticatorData: nachBase64Url(antwort.response.authenticatorData),
        clientDataJSON: nachBase64Url(antwort.response.clientDataJSON),
        signature: nachBase64Url(antwort.response.signature)
      }
    });
    return Boolean(geprueft.ok);
  }

  async function bestaetigungEinholen() {
    // Zuerst der starke Weg: nicht abtippbar, nicht abfischbar, kein Postfach
    // noetig. Klappt er nicht, kommt der Mail-Code — leise, ohne Fehlermeldung.
    if (await passkeyVersuch()) return true;

    const anforderung = await sendeDirekt("/api/admin/step-up/request", {});
    const dialog = baueStepUpDialog();
    // Jeder Rueckgabeweg raeumt den Dialog ab — bliebe das Overlay stehen,
    // waere die Konsole unbedienbar.
    try {
      if (!anforderung.ok) {
        dialog.fehler("Der Code konnte nicht verschickt werden: " + anforderung.fehler);
        dialog.nurSchliessen();
        await dialog.warten();
        return false;
      }
      while (true) {
        const code = await dialog.warten();
        if (code === null) return false;
        dialog.arbeitet(true);
        const bestaetigung = await sendeDirekt("/api/admin/step-up/confirm", { code: code });
        if (bestaetigung.ok) return true;
        dialog.arbeitet(false);
        dialog.fehler(bestaetigung.fehler);
        const fehlercode = bestaetigung.data && bestaetigung.data.error;
        if (fehlercode === "step_up_too_many_attempts" || fehlercode === "step_up_code_expired") {
          dialog.nurSchliessen();
          await dialog.warten();
          return false;
        }
      }
    } finally {
      dialog.schliessen();
    }
  }

  /** Baut den Dialog einmal auf und liefert Steuerfunktionen dafuer. */
  function baueStepUpDialog() {
    const hg = document.createElement("div");
    hg.className = "stepup-hg";
    const box = document.createElement("div");
    box.className = "stepup";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "stepupTitel");

    const marke = document.createElement("p");
    marke.className = "stepup-marke";
    marke.textContent = "smejj.com · Sicherheit";
    const titel = document.createElement("h2");
    titel.id = "stepupTitel";
    titel.textContent = "Bestätigungscode eingeben";
    const text = document.createElement("p");
    text.textContent = "Wir haben dir gerade einen 6-stelligen Code geschickt an:";
    const ziel = document.createElement("p");
    ziel.className = "stepup-ziel";
    ziel.textContent = adminAdresse();
    const dauer = document.createElement("p");
    dauer.textContent = "Der Code gilt 10 Minuten. Danach kannst du 15 Minuten lang Änderungen vornehmen.";

    const eingabe = document.createElement("input");
    eingabe.className = "stepup-eingabe";
    eingabe.type = "text";
    eingabe.inputMode = "numeric";
    eingabe.autocomplete = "one-time-code";
    eingabe.maxLength = 6;
    eingabe.placeholder = "······";
    eingabe.setAttribute("aria-label", "Sechsstelliger Bestätigungscode");

    const fehlerzeile = document.createElement("p");
    fehlerzeile.className = "stepup-fehler";
    fehlerzeile.setAttribute("role", "alert");

    const fuss = document.createElement("div");
    fuss.className = "stepup-fuss";
    const abbrechen = document.createElement("button");
    abbrechen.type = "button";
    abbrechen.className = "btn";
    abbrechen.textContent = "Abbrechen";
    const bestaetigen = document.createElement("button");
    bestaetigen.type = "button";
    bestaetigen.className = "btn haupt";
    bestaetigen.textContent = "Bestätigen";
    fuss.appendChild(abbrechen);
    fuss.appendChild(bestaetigen);

    box.appendChild(marke); box.appendChild(titel); box.appendChild(text);
    box.appendChild(ziel); box.appendChild(dauer); box.appendChild(eingabe);
    box.appendChild(fehlerzeile); box.appendChild(fuss);
    hg.appendChild(box);
    document.body.appendChild(hg);
    eingabe.focus();

    let aufloesen = null;
    function gib(wert) {
      const f = aufloesen;
      aufloesen = null;
      if (f) f(wert);
    }
    eingabe.addEventListener("input", function () {
      // Nur Ziffern — verhindert Leerzeichen aus der Zwischenablage.
      const nur = eingabe.value.replace(/\D/g, "").slice(0, 6);
      if (nur !== eingabe.value) eingabe.value = nur;
      fehlerzeile.textContent = "";
    });
    eingabe.addEventListener("keydown", function (ereignis) {
      if (ereignis.key === "Enter") { ereignis.preventDefault(); absenden(); }
    });
    // Escape haengt am ganzen Dialog, nicht nur am Eingabefeld: sonst schliesst
    // die Taste nur, solange der Fokus im Feld sitzt — und genau das ist nach
    // einem Klick auf den Hintergrund nicht mehr der Fall.
    hg.addEventListener("keydown", function (ereignis) {
      if (ereignis.key === "Escape") { ereignis.preventDefault(); gib(null); }
    });
    hg.tabIndex = -1;
    function absenden() {
      const wert = eingabe.value.trim();
      if (wert.length !== 6) {
        fehlerzeile.textContent = "Bitte alle 6 Ziffern eingeben.";
        return;
      }
      gib(wert);
    }
    bestaetigen.addEventListener("click", absenden);
    abbrechen.addEventListener("click", function () { gib(null); });

    return {
      warten: function () { return new Promise(function (f) { aufloesen = f; }); },
      fehler: function (nachricht) { fehlerzeile.textContent = String(nachricht || ""); },
      arbeitet: function (an) {
        bestaetigen.disabled = Boolean(an);
        eingabe.disabled = Boolean(an);
        bestaetigen.textContent = an ? "prüft …" : "Bestätigen";
        if (!an) { eingabe.value = ""; eingabe.focus(); }
      },
      /** Aus dem Dialog wird eine reine Meldung: nur noch Schliessen moeglich. */
      nurSchliessen: function () {
        eingabe.disabled = true;
        bestaetigen.disabled = true;
        abbrechen.textContent = "Schließen";
        abbrechen.focus();
      },
      schliessen: function () { if (hg.parentNode) hg.parentNode.removeChild(hg); }
    };
  }

  /** Adresse des angemeldeten Admins, falls die Konsole sie schon kennt. */
  function adminAdresse() {
    try {
      const el = document.querySelector("[data-admin-email]");
      const wert = el && el.getAttribute("data-admin-email");
      if (wert) return wert;
    } catch { /* egal */ }
    return "deine Admin-E-Mail-Adresse";
  }

  async function sendeEinmal(pfad, koerper) {
    try {
      const antwort = await fetch(url(pfad), {
        method: "POST",
        headers: kopf({ "content-type": "application/json" }),
        body: JSON.stringify(koerper || {})
      });
      const text = await antwort.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
      if (!antwort.ok) return { ok: false, status: antwort.status, data, fehler: fehlertext(antwort.status, data) };
      return { ok: true, status: antwort.status, data, fehler: "" };
    } catch (error) {
      return { ok: false, status: 0, data: {}, fehler: "Keine Verbindung: " + String(error && error.message || error) };
    }
  }

  async function sendeDirekt(pfad, koerper) {
    const erste = await sendeEinmal(pfad, koerper);
    // Schreibend: nur ausweichen, wenn die Anfrage den Server nie erreicht
    // hat (0/503) — siehe darfAusweichen.
    if (erste.ok || !darfAusweichen(erste, true)) return erste;
    const vorher = apiBasis;
    wechselHost();
    const zweite = await sendeEinmal(pfad, koerper);
    if (!zweite.ok && darfAusweichen(zweite, true)) {
      apiBasis = vorher;
      try { sessionStorage.setItem(AKTIV_KEY, apiBasis); } catch { /* egal */ }
    }
    return zweite;
  }

  // Step-up: verlangt der Server fuer eine aendernde Aktion einen frischen
  // Besitznachweis, holt dieser Umweg den Mail-Code, fragt ihn ab und
  // wiederholt die urspruengliche Anfrage genau einmal. Fuer alle Ansichten
  // unsichtbar — sie rufen weiter einfach sende() auf.
  async function sende(pfad, koerper) {
    // Die Step-up-Routen selbst duerfen nie durch diesen Umweg laufen —
    // sonst riefe sich der Umweg im Fehlerfall endlos selbst auf.
    if (pfad.indexOf("/api/admin/step-up/") === 0) return sendeDirekt(pfad, koerper);
    const antwort = await sendeDirekt(pfad, koerper);
    if (!istBestaetigungNoetig(antwort)) return antwort;
    if (!(await bestaetigungEinholen())) return antwort;
    return sendeDirekt(pfad, koerper);
  }

  // Aus einem Fehlercode wird ein Satz, den ein Mensch versteht.
  function fehlertext(status, data) {
    const code = data && data.error ? String(data.error) : "";
    const bekannt = {
      admin_authentication_required: "Nicht angemeldet. Bitte auf smejj.com anmelden.",
      admin_role_required: "Dieses Konto hat keine Verwaltungsrolle.",
      admin_account_not_active: "Das Konto ist gesperrt.",
      admin_permission_denied: "Diese Rolle darf das nicht.",
      admin_second_approval_required: "Dafuer ist eine zweite Freigabe noetig (Vier-Augen-Prinzip).",
      admin_subject_consent_required: "Dafuer ist die Einwilligung der betroffenen Person noetig.",
      admin_reason_required: "Ohne Grund keine Einsicht — der Zugriff wird protokolliert.",
      admin_directory_unavailable: "Das Nutzerverzeichnis ist nicht erreichbar.",
      admin_audit_unavailable: "Der Nachweis liess sich nicht schreiben, deshalb keine Ausgabe.",
      admin_rate_limit: "Zu viele Anfragen. Bitte kurz warten.",
      admin_step_up_required: "Sicherheitsbestätigung nötig — Code wurde angefordert.",
      admin_email_not_verified: "Diese E-Mail-Adresse ist noch nicht bestätigt. Der Code aus der Bestätigungsmail erledigt beides auf einmal.",
      step_up_code_wrong: "Der Code stimmt nicht.",
      step_up_code_expired: "Der Code ist abgelaufen (10 Minuten). Bitte neu anfordern.",
      step_up_code_missing: "Es ist kein Code angefordert. Aktion einfach erneut ausführen.",
      step_up_too_many_attempts: "Zu oft falsch eingegeben — der Code ist verbrannt. Bitte neu anfordern.",
      step_up_mail_failed: "Der Code konnte nicht per E-Mail zugestellt werden.",
      admin_user_not_found: "Dieses Konto gibt es nicht.",
      admin_no_change: "Das ist bereits so — nichts zu tun.",
      admin_action_unknown: "Diese Aktion gibt es nicht.",
      admin_self_block_forbidden: "Du kannst dich nicht selbst sperren.",
      admin_self_delete_forbidden: "Du kannst dich nicht selbst loeschen.",
      admin_self_demote_forbidden: "Du kannst dir nicht selbst die Rechte nehmen.",
      admin_last_owner_protected: "Das ist der letzte Owner — sonst sperrt sich die Organisation aus.",
      admin_role_invalid: "Diese Rolle gibt es nicht.",
      admin_approval_required: "Dafuer fehlt die Freigabe der zweiten Person.",
      approval_self_approval_forbidden: "Wer beantragt, darf nicht selbst freigeben. Das ist der Sinn der Sache.",
      approval_expired: "Der Antrag ist abgelaufen (24 Stunden).",
      approval_already_decided: "Ueber diesen Antrag wurde bereits entschieden.",
      approval_already_executed: "Dieser Antrag wurde bereits ausgefuehrt.",
      approval_not_approved: "Dieser Antrag ist noch nicht freigegeben.",
      impersonation_consent_wrong_person: "Nur die betroffene Person selbst kann einwilligen.",
      impersonation_consent_belongs_to_subject: "Die Einwilligung gibt die betroffene Person in ihrem eigenen Konto.",
      impersonation_expired: "Die Anfrage ist verfallen.",
      impersonation_end_not_allowed: "Nur die Beteiligten koennen den Vorgang beenden.",
      impersonation_break_glass_reason_too_short: "Break-Glass verlangt eine ausfuehrliche Begruendung (mind. 20 Zeichen).",
      index_not_built: "Der Nutzer-Index wurde noch nie gebaut.",
      index_requires_object_storage: "Ohne Objektspeicher gibt es keinen Index.",
      audit_list_failed: "Das Audit-Log liess sich nicht lesen."
    };
    if (bekannt[code]) return bekannt[code];
    if (code) return code;
    return "Unerwarteter Fehler (HTTP " + status + ").";
  }

  function zeit(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear()
      + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // Reine Kalendertage (Eingang, Faelligkeit) werden als UTC-Mitternacht
  // gespeichert. Mit zeit() gerendert wuerde daraus in westlichen Zeitzonen der
  // Vortag mit einer erfundenen Uhrzeit — bei einer gesetzlichen Frist ist das
  // kein Schoenheitsfehler, sondern ein falsches Datum in der Akte.
  function datum(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getUTCDate()) + "." + p(d.getUTCMonth() + 1) + "." + d.getUTCFullYear();
  }

  function dauer(sekunden) {
    const s = Number(sekunden);
    if (!isFinite(s) || s < 0) return "—";
    if (s < 60) return Math.round(s) + " s";
    if (s < 3600) return Math.round(s / 60) + " Min";
    if (s < 86400) return Math.round(s / 3600) + " h";
    return Math.round(s / 86400) + " T";
  }

  window.adminApi = {
    hole: hole,
    sende: sende,
    escapeHtml: escapeHtml,
    zeit: zeit,
    datum: datum,
    dauer: dauer,
    ich: function () { return hole("/api/admin/me"); },
    nutzer: function (parameter) { return hole("/api/admin/users?" + new URLSearchParams(parameter || {}).toString()); },
    akte: function (id, grund) {
      return hole("/api/admin/users/" + encodeURIComponent(id) + "?reason=" + encodeURIComponent(grund));
    },
    audit: function (parameter) { return hole("/api/admin/audit?" + new URLSearchParams(parameter || {}).toString()); },
    neubau: function (grund) { return sende("/api/admin/users/index/rebuild", { reason: grund }); },
    compliance: function () { return hole("/api/compliance/ai-systems"); },

    // ---- Stufe 3: schreibende Aktionen ----
    aktion: function (id, name, koerper) {
      return sende("/api/admin/users/" + encodeURIComponent(id) + "/actions/" + name, koerper);
    },
    freigaben: function () { return sende("/api/admin/approvals", {}); },
    freigeben: function (id) { return sende("/api/admin/approvals/" + encodeURIComponent(id) + "/approve", {}); },
    ablehnen: function (id, grund) {
      return sende("/api/admin/approvals/" + encodeURIComponent(id) + "/reject", { reason: grund });
    },
    impersonationBeantragen: function (koerper) { return sende("/api/admin/impersonation/request", koerper); },
    impersonationListe: function () { return sende("/api/admin/impersonation/list", {}); },
    impersonationBeenden: function (id) {
      return sende("/api/admin/impersonation/" + encodeURIComponent(id) + "/end", {});
    },
    eigeneVorgaenge: function () { return hole("/api/account/impersonation"); },
    einwilligen: function (id) { return sende("/api/account/impersonation/" + encodeURIComponent(id) + "/consent", {}); },
    einwilligungAblehnen: function (id) { return sende("/api/account/impersonation/" + encodeURIComponent(id) + "/deny", {}); },

    // ---- Stufe 4 ----
    moderation: function () { return hole("/api/admin/moderation"); },
    moderationEntscheiden: function (id, k) { return sende("/api/admin/moderation/" + encodeURIComponent(id) + "/entscheiden", k); },
    dsgvo: function () { return hole("/api/admin/gdpr"); },
    dsgvoErfassen: function (k) { return sende("/api/admin/gdpr/erfassen", k); },
    dsgvoStatus: function (id, k) { return sende("/api/admin/gdpr/" + encodeURIComponent(id) + "/status", k); },
    dsgvoVerlaengern: function (id, g) { return sende("/api/admin/gdpr/" + encodeURIComponent(id) + "/verlaengern", { begruendung: g }); },
    ankuendigungen: function () { return hole("/api/admin/announcements"); },
    ankuendigungErstellen: function (k) { return sende("/api/admin/announcements/erstellen", k); },
    ankuendigungZurueck: function (id, g) { return sende("/api/admin/announcements/" + encodeURIComponent(id) + "/zurueckziehen", { reason: g }); },
    flags: function () { return hole("/api/admin/flags"); },
    flagSetzen: function (k) { return sende("/api/admin/flags/setzen", k); }
  };
})();
