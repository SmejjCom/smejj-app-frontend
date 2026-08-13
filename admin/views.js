// smejj.com Operations Console — die Ansichten.
//
// Jede Ansicht ist eine reine Funktion (Daten -> HTML-Zeichenkette). Kein
// Zustand, kein Netzzugriff: das Laden macht console.js, das Zeichnen hier.
// Damit sind die Ansichten einzeln pruefbar und bleiben unter 800 Zeilen.
//
// Keine style="..."-Attribute: die CSP des eigenen Servers verbietet
// Inline-Stile. Balkenbreiten setzt console.js ueber die CSSOM-Schnittstelle.
(function () {
  "use strict";
  const A = window.adminApi;
  const e = A.escapeHtml;

  function kachel(titel, wert, unterzeile, ton) {
    return '<div class="kpi glass"><div class="k">' + e(titel) + '</div>'
      + '<div class="v">' + e(wert) + '</div>'
      + '<div class="d ' + (ton || "") + '">' + e(unterzeile || "") + '</div></div>';
  }

  function pille(text, ton) {
    return '<span class="pill ' + (ton || "") + '">' + e(text) + '</span>';
  }

  function kopf(buchstabe, oberzeile, titel, text) {
    return '<div class="head"><div class="eyebrow"><span class="kbd">' + e(buchstabe) + '</span>'
      + e(oberzeile) + '</div><h1>' + e(titel) + '</h1><p>' + e(text) + '</p></div>';
  }

  function panel(titel, unter, inhalt, werkzeuge) {
    return '<section class="panel glass"><div class="ph"><h3>' + e(titel) + '</h3>'
      + (unter ? '<span class="sub">' + e(unter) + '</span>' : "")
      + '<span class="spacer"></span>' + (werkzeuge || "")
      + '</div>' + inhalt + '</section>';
  }

  function tabelle(spalten, zeilen) {
    if (!zeilen.length) return '<div class="pb flush"><div class="leer">Nichts vorhanden.</div></div>';
    return '<div class="pb flush"><table><thead><tr>'
      + spalten.map((s) => "<th>" + e(s) + "</th>").join("")
      + '</tr></thead><tbody>' + zeilen.join("") + '</tbody></table></div>';
  }

  function fehlerblock(text) {
    return '<div class="note glass fehler"><div class="nx">▲</div><div>'
      + '<div class="nt">Das hat nicht geklappt</div>'
      + '<div class="ns">' + e(text) + '</div></div></div>';
  }

  // ---- A · Übersicht ---------------------------------------------------------

  /**
   * Sicherheitsalarme aus den geladenen Audit-Eintraegen zaehlen.
   *
   * Bewusst KEIN eigener Endpunkt: die Alarme stehen ohnehin als
   * `security.alarm` in der Hash-Kette, und die Uebersicht laedt sie schon.
   * Gezaehlt wird deshalb nur der GELADENE Ausschnitt — die Beschriftung sagt
   * das auch. "0" heisst hier "keiner in den letzten N Eintraegen", nicht
   * "nie einer gewesen"; alles andere waere eine falsche Beruhigung.
   */
  function alarmLage(audit) {
    const eintraege = (audit && audit.entries) || [];
    const alarme = eintraege.filter(function (eintrag) { return eintrag && eintrag.action === "security.alarm"; });
    return {
      anzahl: alarme.length,
      geprueft: eintraege.length,
      letzter: alarme[0] || null   // Audit-Seite liefert neueste zuerst
    };
  }

  function uebersicht(d) {
    const index = d.nutzer && d.nutzer.index ? d.nutzer.index : {};
    const kette = d.audit && d.audit.chain ? d.audit.chain : {};
    const systeme = (d.compliance && d.compliance.systeme) || [];
    const pflichtig = systeme.filter((s) => s.transparenzpflicht).length;
    const alarm = alarmLage(d.audit);

    const kacheln = '<div class="kpis">'
      + kachel("Konten", index.count == null ? "—" : String(index.count),
        index.unreadable ? index.unreadable + " unlesbar" : "alle lesbar", index.unreadable ? "wr" : "up")
      + kachel("Index-Alter", A.dauer(index.ageSeconds),
        index.refreshing ? "wird gerade aufgefrischt" : "aktuell", index.refreshing ? "wr" : "up")
      + kachel("Audit-Eintraege", d.audit && d.audit.total != null ? String(d.audit.total) : "—",
        "Zeitraum " + e((d.audit && d.audit.window) || "—"))
      + kachel("Nachweiskette", kette.ok ? "intakt" : "gebrochen",
        kette.ok ? "lueckenlos geprueft" : String(kette.reason || ""), kette.ok ? "up" : "dn")
      + kachel("KI-Systeme", String(systeme.length),
        pflichtig + " mit Transparenzpflicht")
      + kachel("Sicherheitsalarme", String(alarm.anzahl),
        alarm.anzahl > 0
          ? "zuletzt " + A.zeit(alarm.letzter.at)
          : "keiner in den letzten " + alarm.geprueft + " Eintraegen",
        alarm.anzahl > 0 ? "dn" : "up")
      + '</div>';

    const dienste = tabelle(["Bereich", "Stand", "Anmerkung"], [
      '<tr><td><b>Nutzer-Index</b></td><td>' + (index.count == null ? pille("nicht gebaut", "bad") : pille("bereit", "ok"))
        + '</td><td>' + e(index.builtAt ? "gebaut " + A.zeit(index.builtAt) : "—") + '</td></tr>',
      '<tr><td><b>Audit-Log</b></td><td>' + (kette.ok ? pille("unveraendert", "ok") : pille("pruefen", "bad"))
        + '</td><td>' + e(kette.ok ? "Hash-Kette lueckenlos" : String(kette.reason || "")) + '</td></tr>',
      '<tr><td><b>EU AI Act</b></td><td>' + (d.compliance && d.compliance.hochrisiko === false
        ? pille("kein Hochrisiko", "ok") : pille("unbekannt", "warn"))
        + '</td><td>' + e(d.compliance ? "Durchsetzung ab " + (d.compliance.rechtsrahmen || {}).durchsetzungAb : "—") + '</td></tr>',
      '<tr><td><b>Schreibende Aktionen</b></td><td>' + pille("mit Nachweis", "ok")
        + '</td><td>Löschen und Rollenvergabe nur mit vier Augen</td></tr>',
      '<tr><td><b>Offene Freigaben</b></td><td>' + ((d.freigaben || 0) > 0
        ? pille(String(d.freigaben) + " warten", "warn") : pille("keine", "ok"))
        + '</td><td>Anträge verfallen nach 24 Stunden</td></tr>',
      // Die Wache meldet MUSTER, nicht Einzelvorgaenge: gedrosselte Anfragen an
      // der Vortuer und falsche Step-up-Codes. Ein Alarm heisst "abgewehrt und
      // auffaellig oft", nicht "eingebrochen".
      '<tr><td><b>Sicherheitswache</b></td><td>' + (alarm.anzahl > 0
        ? pille(String(alarm.anzahl) + (alarm.anzahl === 1 ? " Alarm" : " Alarme"), "bad")
        : pille("ruhig", "ok"))
        + '</td><td>' + (alarm.anzahl > 0
          ? e("zuletzt " + String((alarm.letzter && alarm.letzter.target) || "") + " — " + String((alarm.letzter && alarm.letzter.reason) || ""))
          : "Abgewehrte Muster stehen als security.alarm im Audit-Log")
        + '</td></tr>'
    ]);

    return kopf("A", "Cockpit", "Übersicht",
      "Der Betriebszustand auf einen Blick. Alle Zahlen kommen live aus der eigenen API — nichts ist hier fest verdrahtet.")
      + kacheln + '<div class="stack">' + panel("Zustand", "live abgefragt", dienste) + '</div>';
  }

  // ---- B · Nutzer -------------------------------------------------------------

  function nutzer(d) {
    const index = d.index || {};
    const eintraege = d.entries || [];
    const zeilen = eintraege.map((n) =>
      '<tr class="klickbar" data-akte="' + e(n.userId) + '">'
      + '<td><b>' + e(n.name || "—") + '</b><br><span class="mono">' + e(n.email) + '</span></td>'
      + '<td><span class="mono">' + e(n.userId) + '</span></td>'
      + '<td>' + (n.role === "user" ? '<span class="pill">user</span>' : pille(n.role, "acc")) + '</td>'
      + '<td>' + (n.status === "active" ? pille("aktiv", "ok") : pille(n.status, "bad")) + '</td>'
      + '<td>' + (n.emailVerified ? pille("ja", "ok") : pille("nein", "warn")) + '</td>'
      + '<td>' + e(String(n.activeSessions)) + '</td>'
      + '<td>' + e(A.zeit(n.createdAt)) + '</td>'
      + '<td><span class="act">Akte öffnen</span></td></tr>');

    const werkzeuge = '<span class="btn" id="neubauKnopf">Index neu bauen</span>';
    const suche = '<div class="bar"><input class="suche-feld" id="sucheFeld" type="search" '
      + 'placeholder="Name, E-Mail oder Konto-ID …" value="' + e(d.suchbegriff || "") + '">'
      + '<span class="btn" id="sucheKnopf">Suchen</span>'
      + (d.suchbegriff ? '<span class="btn" id="sucheLeeren">Zurücksetzen</span>' : "") + '</div>';

    const stand = "Index " + A.dauer(index.ageSeconds) + " alt"
      + (index.refreshing ? " · wird aufgefrischt" : "")
      + (index.unreadable ? " · " + index.unreadable + " unlesbar" : "");

    return kopf("B", "Nutzer", "Nutzerverwaltung",
      "Suchen und blättern. Die Liste zeigt nur Metadaten — der Blick in eine Akte verlangt einen Grund und wird protokolliert.")
      + suche
      + '<div class="stack">' + panel(
        "Konten", (d.total || 0) + " Treffer · " + stand,
        tabelle(["Nutzer", "Konto-ID", "Rolle", "Status", "Verifiziert", "Sitzungen", "Registriert", ""], zeilen),
        werkzeuge) + '</div>';
  }

  // ---- B2 · Nutzerakte --------------------------------------------------------

  function akte(d) {
    const u = d.user || {};
    const sitzungen = (u.sessions || []).map((s) =>
      '<tr><td><b>' + e(s.device) + '</b></td>'
      + '<td><span class="mono">' + e(s.sidHint) + '…</span></td>'
      + '<td>' + e(A.zeit(s.lastSeenAt)) + '</td>'
      + '<td>' + e(A.zeit(s.expiresAt)) + '</td>'
      + '<td>' + (s.active ? pille("aktiv", "ok") : pille("beendet", "dim")) + '</td></tr>');

    const stamm = tabelle(["Merkmal", "Wert"], [
      '<tr><td><b>Name</b></td><td>' + e(u.name || "—") + '</td></tr>',
      '<tr><td><b>E-Mail</b></td><td><span class="mono">' + e(u.email) + '</span></td></tr>',
      '<tr><td><b>Konto-ID</b></td><td><span class="mono">' + e(u.userId) + '</span></td></tr>',
      '<tr><td><b>Anmeldeweg</b></td><td>' + e(u.method) + '</td></tr>',
      '<tr><td><b>Rolle</b></td><td>' + (u.role === "user" ? "user" : pille(u.role, "acc")) + '</td></tr>',
      '<tr><td><b>Status</b></td><td>' + (u.status === "active" ? pille("aktiv", "ok") : pille(u.status, "bad")) + '</td></tr>',
      '<tr><td><b>E-Mail bestätigt</b></td><td>' + e(u.emailVerifiedAt ? A.zeit(u.emailVerifiedAt) : "nein") + '</td></tr>',
      '<tr><td><b>Registriert</b></td><td>' + e(A.zeit(u.createdAt)) + '</td></tr>',
      '<tr><td><b>Zuletzt geändert</b></td><td>' + e(A.zeit(u.updatedAt)) + '</td></tr>',
      '<tr><td><b>Fehlversuche</b></td><td>' + e(String((u.loginGuard || {}).failedCount || 0))
        + ((u.loginGuard || {}).lockedUntil ? " · " + pille("gesperrt bis " + A.zeit(u.loginGuard.lockedUntil), "bad") : "") + '</td></tr>',
      '<tr><td><b>Offene Verifikation</b></td><td>' + (u.hasPendingVerification ? pille("ja", "warn") : "nein") + '</td></tr>',
      '<tr><td><b>Offener Reset</b></td><td>' + (u.hasPendingReset ? pille("ja", "warn") : "nein") + '</td></tr>'
    ]);

    const nachweis = '<div class="note glass"><div class="nx">§</div><div>'
      + '<div class="nt">Dieser Zugriff wurde protokolliert</div>'
      + '<div class="ns">Grund: „' + e(d.grund) + '“ — als <span class="mono">user.record.read</span> '
      + 'unveränderlich im Audit-Log. Passwort-Hash, Token und vollständige Sitzungs-IDs werden gar nicht erst übertragen.'
      + '</div></div></div>';

    return kopf("B", "Nutzerakte", u.name || u.email || "Akte",
      "Einsicht in ein einzelnes Konto. Nur die Felder, die der Adminbereich sehen darf.")
      + '<div class="bar"><span class="btn zurueck" id="zurueckKnopf">← Zurück zur Liste</span></div>'
      + '<div class="stack">' + nachweis
      + panel("Stammdaten", u.userId || "", stamm)
      + panel("Sitzungen", (u.sessions || []).length + " insgesamt",
        tabelle(["Gerät", "Sitzung", "Zuletzt", "Läuft ab", "Stand"], sitzungen))
      + '</div>';
  }

  // ---- O · Audit --------------------------------------------------------------

  function audit(d) {
    const kette = d.chain || {};
    const zeilen = (d.entries || []).map((eintrag) =>
      '<tr><td><span class="mono">' + e(A.zeit(eintrag.at)) + '</span></td>'
      + '<td><b>' + e(eintrag.actorEmail) + '</b><br>' + pille(eintrag.actorRole, "acc")
      + (eintrag.actorRoleSource === "bootstrap" ? " " + pille("bootstrap", "warn") : "") + '</td>'
      + '<td><span class="mono">' + e(eintrag.action) + '</span></td>'
      + '<td><span class="mono">' + e(eintrag.target) + '</span></td>'
      + '<td>' + e(eintrag.reason) + '</td>'
      + '<td><span class="mono">' + e(eintrag.ip) + '</span></td></tr>');

    const kettenblock = kette.ok
      ? '<div class="note glass"><div class="nx">⛓</div><div><div class="nt">Kette lückenlos</div>'
        + '<div class="ns">Jeder Eintrag trägt die Prüfsumme seines Vorgängers. Es fehlt keiner, '
        + 'und keiner wurde nachträglich verändert.</div></div></div>'
      : '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">Kette gebrochen</div>'
        + '<div class="ns">Grund: ' + e(kette.reason) + ' bei Eintrag ' + e(String(kette.brokenAt))
        + '. Das ist ein ernster Befund — bitte sofort prüfen.</div></div></div>';

    const zeitraum = '<div class="bar zeitraum">'
      + '<span>Zeitraum</span>'
      + '<input type="date" id="von" value="' + e(d.von || "") + '">'
      + '<span>bis</span>'
      + '<input type="date" id="bis" value="' + e(d.bis || "") + '">'
      + '<span class="btn" id="zeitraumKnopf">Anwenden</span>'
      + (d.von || d.bis ? '<span class="btn" id="zeitraumLeeren">Zurücksetzen</span>' : "")
      + '</div>';

    const umfang = d.window === "all" ? "gesamtes Log"
      : d.window === "2m" ? "laufender und voriger Monat"
        : d.window === "memory" ? "Arbeitsspeicher" : "gewählter Zeitraum (" + e(d.window || "—") + ")";

    return kopf("O", "Audit", "Audit-Log",
      "Jede schreibende Aktion und jede Akteneinsicht. Anfügend, unveränderlich — auch für den Owner.")
      + zeitraum
      + '<div class="stack">' + kettenblock
      + panel("Einträge", (d.total || 0) + " im Umfang: " + umfang,
        tabelle(["Zeit", "Wer", "Aktion", "Ziel", "Grund", "Herkunft"], zeilen))
      + '</div>';
  }

  // ---- C · Rollen -------------------------------------------------------------

  function rollen(d) {
    const rechte = d.permissions || {};
    const namen = { allow: ["darf", "ok"], dual: ["Vier-Augen", "warn"], consent: ["mit Einwilligung", "warn"], deny: ["nein", "bad"] };
    const zeilen = Object.keys(rechte).map((schluessel) => {
      const stufe = namen[rechte[schluessel]] || ["—", ""];
      return '<tr><td><b>' + e(schluessel) + '</b></td><td>' + pille(stufe[0], stufe[1]) + '</td></tr>';
    });

    const hinweis = '<div class="note glass"><div class="nx">⚿</div><div>'
      + '<div class="nt">Serverseitig durchgesetzt, nicht im Browser</div>'
      + '<div class="ns">Diese Liste zeigt nur, was der Server ohnehin erzwingt. Die Rolle wird bei '
      + 'jeder Anfrage frisch aus dem Nutzer-Store gelesen — nie aus dem Sitzungs-Token.'
      + (d.actor && d.actor.roleSource === "bootstrap"
        ? ' Diese Rolle stammt aus <span class="mono">SMEJJ_ADMIN_OWNER_EMAILS</span>, nicht aus dem Konto.'
        : "")
      + '</div></div></div>';

    return kopf("C", "Rollen", "Deine Rechte",
      "Was dein Konto in dieser Konsole darf — und was zusätzlich eine zweite Freigabe oder eine Einwilligung braucht.")
      + '<div class="stack">' + hinweis
      + panel("Berechtigungen", "Rolle: " + ((d.actor || {}).role || "—"),
        tabelle(["Berechtigung", "Stufe"], zeilen)) + '</div>';
  }

  // ---- N · EU AI Act ----------------------------------------------------------

  function compliance(d) {
    const systeme = d.systeme || [];
    const zeilen = systeme.map((s) =>
      '<tr><td><b>' + e(s.id) + '</b></td>'
      + '<td>' + e(s.zweck) + '</td>'
      + '<td>' + e(s.anbieter) + '</td>'
      + '<td>' + (s.risiko === "minimal" ? pille("minimal", "dim") : pille("begrenzt", "acc")) + '</td>'
      + '<td>' + (s.transparenzpflicht
        ? pille(s.verschaerft ? "verschärft" : "vorhanden", s.verschaerft ? "warn" : "ok")
        : pille("nicht nötig", "dim")) + '</td>'
      + '<td>' + (s.protokolliert ? pille("aktiv", "ok") : pille("—", "dim")) + '</td></tr>');

    const rahmen = d.rechtsrahmen || {};
    const kacheln = '<div class="kpis">'
      + kachel("Durchsetzung ab", String(rahmen.durchsetzungAb || "—"), rahmen.name || "")
      + kachel("Hochrisiko", d.hochrisiko === false ? "nein" : "unbekannt",
        d.hochrisiko === false ? "kein Fall aus Anhang III" : "", d.hochrisiko === false ? "up" : "wr")
      + kachel("Erfasste Systeme", String(systeme.length),
        systeme.filter((s) => s.transparenzpflicht).length + " mit Transparenzpflicht")
      + '</div>';

    const hinweise = d.hinweise || {};
    const texte = '<div class="pb"><div class="field"><label>Allgemeiner Hinweis</label>'
      + '<div class="in">' + e(hinweise.allgemein || "") + '</div></div>'
      + '<div class="field"><label>Maus-Engine (verschärft)</label>'
      + '<div class="in">' + e(hinweise.mausEngine || "") + '</div>'
      + '<div class="hint">Dieser Text geht mit jeder Antwort der Maus-Engine mit — im Feld '
      + '<span class="mono">transparenzhinweis</span> und als Kopfzeile '
      + '<span class="mono">x-smejj-ai-notice</span>.</div></div></div>';

    return kopf("N", "KI-Nachweise", "EU AI Act",
      "Bestandsverzeichnis, Einstufung und die Hinweistexte — live aus dem öffentlichen Transparenzbericht.")
      + kacheln
      + '<div class="stack">'
      + panel("Eingesetzte KI-Systeme", "Stand " + e(A.zeit(d.stand)),
        tabelle(["System", "Zweck", "Anbieter", "Risiko", "Transparenz", "Protokoll"], zeilen))
      + panel("Hinweistexte", "maschinenlesbar ausgeliefert", texte)
      + panel("Belege", "aufbewahrungspflichtig, 10 Jahre",
        tabelle(["Dokument"], (d.dokumentation || []).map((doc) =>
          '<tr><td><span class="mono">' + e(doc) + '</span></td></tr>')))
      + '</div>';
  }

  // ---- Y · Freigaben (Vier-Augen) ---------------------------------------------

  function freigaben(d) {
    const eintraege = d.approvals || [];
    const zeilen = eintraege.map((a) => {
      const offen = a.status === "pending";
      const eigener = a.requestedBy === (d.ich || "");
      return '<tr><td><span class="mono">' + e(A.zeit(a.requestedAt)) + '</span></td>'
        + '<td><span class="mono">' + e(a.action) + '</span></td>'
        + '<td><span class="mono">' + e(a.target) + '</span></td>'
        + '<td>' + e(a.reason) + '</td>'
        + '<td><b>' + e(a.requestedBy) + '</b></td>'
        + '<td>' + zustandsPille(a.status) + '</td>'
        + '<td>' + (offen
          ? (eigener
            ? '<span class="pill warn">dein Antrag — du darfst nicht freigeben</span>'
            : '<span class="act" data-frei="' + e(a.id) + '">Freigeben</span>'
              + '<span class="act dg" data-ab="' + e(a.id) + '">Ablehnen</span>')
          : e(a.decidedBy ? "durch " + a.decidedBy : "—"))
        + '</td></tr>';
    });

    const hinweis = '<div class="note glass"><div class="nx">⇄</div><div>'
      + '<div class="nt">Zwei Augen reichen hier nicht</div>'
      + '<div class="ns">Löschen und Rollenvergabe brauchen die Freigabe einer zweiten Person. '
      + 'Wer beantragt, kann nicht selbst freigeben — auch der Owner nicht. Ein Antrag verfällt nach 24 Stunden.'
      + '</div></div></div>';

    return kopf("Y", "Freigaben", "Vier-Augen-Prinzip",
      "Anträge, die eine zweite Person bestätigen muss. Bis dahin ist nichts passiert.")
      + '<div class="stack">' + hinweis
      + panel("Anträge", (d.total || 0) + " insgesamt",
        tabelle(["Beantragt", "Aktion", "Ziel", "Grund", "Von", "Stand", ""], zeilen)) + '</div>';
  }

  function zustandsPille(status) {
    if (status === "pending") return pille("offen", "warn");
    if (status === "approved") return pille("freigegeben", "ok");
    if (status === "executed") return pille("ausgeführt", "ok");
    if (status === "rejected") return pille("abgelehnt", "bad");
    if (status === "expired") return pille("abgelaufen", "dim");
    return pille(status, "dim");
  }

  // ---- D · Support & Impersonation ---------------------------------------------

  function support(d) {
    const vorgaenge = d.impersonations || [];
    const zeilen = vorgaenge.map((v) =>
      '<tr><td><span class="mono">' + e(A.zeit(v.requestedAt)) + '</span></td>'
      + '<td><b>' + e(v.subjectEmail) + '</b></td>'
      + '<td>' + e(v.operatorEmail) + '</td>'
      + '<td>' + (v.scopes || []).map((s) => pille(s, "acc")).join(" ") + '</td>'
      + '<td>' + e(v.reason) + '</td>'
      + '<td>' + impStatusPille(v) + '</td>'
      + '<td>' + (["active", "awaiting_consent"].includes(v.status)
        ? '<span class="act dg" data-ende="' + e(v.id) + '">Beenden</span>' : "—") + '</td></tr>');

    const eigene = (d.eigene || []).map((v) =>
      '<tr><td><b>' + e(v.wer) + '</b><br><span class="s">' + e(v.rolle) + '</span></td>'
      + '<td>' + e(v.grund) + '</td>'
      + '<td>' + (v.umfang || []).map((s) => pille(s, "acc")).join(" ") + '</td>'
      + '<td>' + impStatusPille(v) + '</td>'
      + '<td>' + (v.status === "awaiting_consent"
        ? '<span class="act" data-ja="' + e(v.id) + '">Einwilligen</span>'
          + '<span class="act dg" data-nein="' + e(v.id) + '">Ablehnen</span>'
        : v.status === "active"
          ? '<span class="act dg" data-selbstEnde="' + e(v.id) + '">Beenden</span>' : "—")
      + '</td></tr>');

    const regeln = '<div class="note glass"><div class="nx">◉</div><div>'
      + '<div class="nt">Einwilligung statt Vollmacht</div>'
      + '<div class="ns">Ein Support-Zugriff startet erst, wenn die betroffene Person in ihrer eigenen '
      + 'Sitzung zustimmt. Höchstens 30 Minuten, nur der beantragte Umfang, jederzeit von beiden Seiten '
      + 'beendbar. Chat-Inhalte sind nie im Standardumfang. Ohne Einwilligung geht es nur per Break-Glass — '
      + 'mit ausführlicher Begründung, nur 10 Minuten und als Alarm markiert.</div></div></div>';

    return kopf("D", "Support", "Support & Impersonation",
      "Echte Hilfe ohne Blankoscheck. Jeder Zugriff ist beantragt, begründet, befristet und sichtbar.")
      + '<div class="stack">' + regeln
      + panel("Deine eigenen Vorgänge", "wer in DEIN Konto geschaut hat",
        tabelle(["Wer", "Grund", "Umfang", "Stand", ""], eigene))
      + panel("Alle Vorgänge", (d.total || 0) + " insgesamt",
        tabelle(["Beantragt", "Betroffen", "Support", "Umfang", "Grund", "Stand", ""], zeilen))
      + '</div>';
  }

  function impStatusPille(v) {
    if (v.breakGlass && v.status === "active") return pille("BREAK-GLASS aktiv", "bad");
    if (v.status === "active") return pille("aktiv", "ok");
    if (v.status === "awaiting_consent") return pille("wartet auf Einwilligung", "warn");
    if (v.status === "denied") return pille("abgelehnt", "bad");
    if (v.status === "ended") return pille("beendet", "dim");
    if (v.status === "expired") return pille("verfallen", "dim");
    return pille(v.status, "dim");
  }

  window.adminViews = {
    // Bausteine, damit views-stage4.js sie nicht noch einmal bauen muss.
    kopfBlock: kopf,
    kachelBlock: kachel,
    panelBlock: panel,
    tabelleBlock: tabelle,
    pilleBlock: pille,
    freigaben: freigaben,
    support: support,
    uebersicht: uebersicht,
    nutzer: nutzer,
    akte: akte,
    audit: audit,
    rollen: rollen,
    compliance: compliance,
    fehlerblock: fehlerblock
  };
})();
