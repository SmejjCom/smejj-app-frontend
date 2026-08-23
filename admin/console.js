// smejj.com Operations Console — Aufbau, Navigation und Laden.
//
// Trennung: api.js spricht mit dem Server, views.js zeichnet, diese Datei
// verbindet beides und haelt den Zustand. Klassisches Skript, damit die CSP
// script-src 'self' ohne Sonderfall greift.
(function () {
  "use strict";
  const A = window.adminApi;
  const D = window.adminDialog;
  const V = window.adminViews;

  const SEITEN = [
    { id: "B", pfad: "nutzer", gruppe: "Menschen", name: "Nutzerverwaltung" },
    { id: "C", pfad: "rollen", gruppe: "Menschen", name: "Rollen & Rechte" },
    { id: "D", pfad: "support", gruppe: "Menschen", name: "Support & Impersonation" },
    { id: "Y", pfad: "freigaben", gruppe: "Verwaltung", name: "Freigaben" },
    { id: "O", pfad: "audit", gruppe: "Recht", name: "Audit-Log" },
    { id: "N", pfad: "compliance", gruppe: "Recht", name: "EU AI Act" }
  ];

  // Stufe 4 meldet sich selbst an (console-stage4.js). So bleibt diese Datei
  // unter der 800-Zeilen-Regel und kennt nur die Schnittstelle, nicht die
  // Einzelheiten der vier Bereiche.
  // Stufe 5 (Betrieb) meldet sich auf demselben Weg an. Beide Register werden
  // zusammengefuehrt, damit der Kern nur EINE Nachschlagetabelle kennt.
  const ANGEMELDET = Object.assign(
    {},
    (window.adminStage4 || {}).seiten || {},
    (window.adminStage5 || {}).seiten || {},
    (window.adminStage6 || {}).seiten || {},
    (window.adminStage7 || {}).seiten || {},
    (window.adminStage8 || {}).seiten || {},
    (window.adminStage9 || {}).seiten || {},
    (window.adminStageCockpit || {}).seiten || {},
    (window.adminStage10 || {}).seiten || {},
    (window.adminStage11 || {}).seiten || {},
    (window.adminStage12 || {}).seiten || {}
  );
  Object.keys(ANGEMELDET).forEach(function (pfad) {
    SEITEN.push({ id: ANGEMELDET[pfad].id, pfad: pfad, gruppe: ANGEMELDET[pfad].gruppe, name: ANGEMELDET[pfad].name });
  });

  // Nach Gruppen ordnen, sonst erscheint dieselbe Ueberschrift zweimal: die
  // Stufe-4-Seiten haengen sich hinten an, gehoeren aber teils in bestehende
  // Gruppen.
  const GRUPPEN_REIHENFOLGE = ["Überblick", "Menschen", "Sicherheit", "Geld", "Betrieb", "Produkt", "Recht", "Verwaltung"];
  SEITEN.sort(function (a, b) {
    const links = GRUPPEN_REIHENFOLGE.indexOf(a.gruppe);
    const rechts = GRUPPEN_REIHENFOLGE.indexOf(b.gruppe);
    return (links < 0 ? 99 : links) - (rechts < 0 ? 99 : rechts);
  });

  /** Was die angemeldeten Ansichten vom Kern brauchen — bewusst klein gehalten. */
  function seitenKontext(pfad) {
    return {
      zeichne: function (html) { seite.innerHTML = html; },
      fehler: function (text) { zeigeFehler(text); },
      meldung: function (text, istFehler) { meldung(text, istFehler); },
      neuLaden: function () { ANGEMELDET[pfad].laden(seitenKontext(pfad)); }
    };
  }

  const zustand = { akteur: null, suchbegriff: "", von: "", bis: "" };
  const nav = document.getElementById("nav");
  const seite = document.getElementById("seite");

  // ---- Adressen ohne # ---------------------------------------------------------
  // Auf smejj.com liegt jede Seite als eigener Ordner (admin/<seite>/index.html,
  // erzeugt vom Spiegel-Skript) — die Links sind ECHTE Links, jede Adresse ist
  // teilbar und neu ladbar. Der Rueckfallweg ueber den Control-Server hat diese
  // Ordner nicht; dort bleibt die alte #-Route erhalten, damit die Konsole im
  // Notfall weiter bedienbar ist, ohne die (gesperrte) Auslieferung anzufassen.
  const PFAD_MODUS = /(^|\.)smejj\.com$/.test(location.hostname);

  // Welche Seite unter der nackten Adresse /admin/ liegt. Seit 2026-08-14 das
  // Cockpit: es beantwortet in einem Satz, ob gerade etwas zu tun ist. Die alte
  // Seite A "Uebersicht" ist seit 2026-08-23 aufgeloest — das Cockpit traegt
  // alles, was sie zeigte (Konten, Freigaben, Protokoll, Sicherheitsalarme).
  // Alte Lesezeichen auf /admin/uebersicht/ landen still auf /admin/.
  const STARTSEITE = "cockpit";
  const AUFGELOEST = { uebersicht: STARTSEITE };

  function seitenLink(pfad) {
    if (!PFAD_MODUS) return "#" + pfad;
    return pfad === STARTSEITE ? "/admin/" : "/admin/" + pfad + "/";
  }

  /** Wohin navigieren — im Pfad-Modus als echte Navigation, sonst per Hash. */
  function geheZu(pfadTeil) {
    if (!PFAD_MODUS) { location.hash = "#" + pfadTeil; return; }
    if (pfadTeil.indexOf("akte/") === 0) {
      // Die Akte hat bewusst KEINEN eigenen Ordner: sie verlangt bei jedem
      // Einstieg einen protokollierten Grund. Als Anhang der Nutzerliste
      // uebersteht sie das Neuladen, ohne die Grund-Pflicht zu umgehen.
      location.href = "/admin/nutzer/?akte=" + encodeURIComponent(pfadTeil.slice("akte/".length));
      return;
    }
    location.href = seitenLink(pfadTeil);
  }

  /** Das Ziel aus der Adresse lesen — Pfad zuerst, alte #-Links bleiben gueltig. */
  function aktuellerPfad() {
    if (!PFAD_MODUS) return (location.hash || ("#" + STARTSEITE)).replace(/^#/, "");
    const akte = new URLSearchParams(location.search).get("akte");
    if (akte) return "akte/" + akte;
    const teil = location.pathname.replace(/^\/admin\/?/, "").replace(/\/$/, "");
    if (teil) return teil;
    return (location.hash || ("#" + STARTSEITE)).replace(/^#/, "");
  }

  function schreibeNav(aktiv) {
    let gruppe = null;
    nav.innerHTML = SEITEN.map(function (s) {
      let vorsatz = "";
      if (s.gruppe !== gruppe) { gruppe = s.gruppe; vorsatz = '<div class="rail-group">' + A.escapeHtml(s.gruppe) + '</div>'; }
      return vorsatz + '<a class="rail-item' + (s.pfad === aktiv ? " on" : "") + '" href="' + seitenLink(s.pfad) + '">'
        + '<span class="ltr">' + s.id + '</span><span>' + A.escapeHtml(s.name) + '</span></a>';
    }).join("");
  }

  function laedt(text) {
    seite.innerHTML = '<div class="laedt glass">' + A.escapeHtml(text || "wird geladen …") + '</div>';
  }

  function setzeKopf(name) {
    document.getElementById("crumb").textContent = name;
    document.title = name + " — smejj.com Operations Console";
  }

  // Nur zeigen, was einen Wert hat: die Pillen bleiben versteckt, bis eine
  // Seite ihren Stand liefert — und verschwinden beim Seitenwechsel wieder.
  function zeigeStand(index, kette) {
    const i = document.getElementById("indexStand");
    if (index) {
      i.textContent = "Index " + A.dauer(index.ageSeconds) + (index.refreshing ? " · frischt auf" : "");
      i.className = "pill " + (index.refreshing ? "warn" : "ok");
      i.hidden = false;
    }
    const k = document.getElementById("ketteStand");
    if (kette) {
      k.textContent = kette.ok ? "Kette intakt" : "Kette gebrochen";
      k.className = "pill " + (kette.ok ? "ok" : "bad");
      k.hidden = false;
    }
  }

  function versteckeStand() {
    ["indexStand", "ketteStand"].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  }

  // ---- Ansichten laden --------------------------------------------------------

  async function zeigeNutzer() {
    laedt("Konten werden geholt …");
    // Seit 2026-08-23: die Nutzer-Lage (Plan, bezahlt als, zuletzt, Verbrauch) statt der reinen Index-Seite.
    const antwort = await A.hole("/api/admin/users/lage?" + new URLSearchParams({ limit: "50", query: zustand.suchbegriff || "" }).toString());
    if (!antwort.ok) {
      seite.innerHTML = V.fehlerblock(antwort.fehler)
        + (antwort.data && antwort.data.hint ? '<div class="bar"><span class="btn" id="neubauKnopf">Index jetzt bauen</span></div>' : "");
      bindeNeubau();
      return;
    }
    const daten = antwort.data;
    daten.suchbegriff = zustand.suchbegriff;
    seite.innerHTML = V.nutzer(daten);
    zeigeStand(daten.index, null);
    bindeNutzerAktionen();
  }

  async function zeigeAkte(id) {
    const grund = await D.text({
      titel: "Grund für die Akteneinsicht",
      absaetze: ["Die Einsicht in eine Nutzerakte wird unveränderlich protokolliert — mit deinem Namen, der Zeit und diesem Grund."],
      platzhalter: "z. B. Ticket 4471, Rückfrage der Nutzerin",
      minLaenge: 3,
      okText: "Akte öffnen"
    });
    if (grund === null) { geheZu("nutzer"); return; }
    if (String(grund).trim().length < 3) {
      seite.innerHTML = V.fehlerblock("Ohne Grund keine Einsicht. Bitte mindestens drei Zeichen angeben.")
        + '<div class="bar"><span class="btn zurueck" id="zurueckKnopf">← Zurück zur Liste</span></div>';
      bindeZurueck();
      return;
    }
    laedt("Akte wird geholt und der Zugriff protokolliert …");
    const antwort = await A.akte(id, String(grund).trim());
    if (!antwort.ok) {
      seite.innerHTML = V.fehlerblock(antwort.fehler)
        + '<div class="bar"><span class="btn zurueck" id="zurueckKnopf">← Zurück zur Liste</span></div>';
      bindeZurueck();
      return;
    }
    seite.innerHTML = V.akte({ user: antwort.data.user, grund: String(grund).trim() });
    bindeZurueck();
    bindeAkteAktionen(id);
  }

  async function zeigeAudit() {
    laedt("Audit-Log wird geholt …");
    const parameter = { limit: 100 };
    if (zustand.von) parameter.from = zustand.von;
    if (zustand.bis) parameter.to = zustand.bis;
    const antwort = await A.audit(parameter);
    if (!antwort.ok) return zeigeFehler(antwort.fehler);
    const daten = antwort.data;
    daten.von = zustand.von;
    daten.bis = zustand.bis;
    seite.innerHTML = V.audit(daten);
    zeigeStand(null, daten.chain);
    bindeZeitraum();
  }

  async function zeigeFreigaben() {
    laedt("Anträge werden geholt …");
    const antwort = await A.freigaben();
    if (!antwort.ok) return zeigeFehler(antwort.fehler);
    const daten = antwort.data;
    daten.ich = (zustand.akteur || {}).email || "";
    seite.innerHTML = V.freigaben(daten);
    bindeFreigaben();
  }

  async function zeigeSupport() {
    laedt("Support-Vorgänge werden geholt …");
    const [alle, eigene] = await Promise.all([A.impersonationListe(), A.eigeneVorgaenge()]);
    // Jeder Abruf zaehlt fuer sich. Frueher stand hier "&&" — die Seite galt
    // also schon als heil, wenn EINER von beiden ging. Ein toter Endpunkt sah
    // dadurch aus wie "0 Vorgaenge" — genau so blieb der 404 auf
    // /api/admin/impersonation/list unbemerkt.
    if (!alle.ok) return zeigeFehler(alle.fehler);
    if (!eigene.ok) meldung(eigene.fehler, true);
    seite.innerHTML = V.support({
      impersonations: (alle.data || {}).impersonations || [],
      total: (alle.data || {}).total || 0,
      eigene: (eigene.data || {}).impersonations || []
    });
    bindeSupport();
  }

  async function zeigeRollen() {
    laedt("Rechte werden geholt …");
    const antwort = await A.ich();
    if (!antwort.ok) return zeigeFehler(antwort.fehler);
    seite.innerHTML = V.rollen(antwort.data);
  }

  async function zeigeCompliance() {
    laedt("Transparenzbericht wird geholt …");
    const antwort = await A.compliance();
    if (!antwort.ok) return zeigeFehler(antwort.fehler);
    seite.innerHTML = V.compliance(antwort.data);
  }

  function zeigeFehler(text) {
    seite.innerHTML = V.fehlerblock(text);
  }

  // ---- Ereignisse -------------------------------------------------------------

  function bindeNutzerAktionen() {
    document.querySelectorAll("tr.klickbar").forEach(function (zeile) {
      zeile.addEventListener("click", function () {
        geheZu("akte/" + zeile.getAttribute("data-akte"));
      });
    });
    const feld = document.getElementById("sucheFeld");
    const knopf = document.getElementById("sucheKnopf");
    function suchen() { zustand.suchbegriff = feld ? feld.value.trim() : ""; zeigeNutzer(); }
    if (knopf) knopf.addEventListener("click", suchen);
    if (feld) feld.addEventListener("keydown", function (ereignis) { if (ereignis.key === "Enter") suchen(); });
    const leeren = document.getElementById("sucheLeeren");
    if (leeren) leeren.addEventListener("click", function () { zustand.suchbegriff = ""; zeigeNutzer(); });
    bindeNeubau();
    bindeAboUmhaengen();
  }

  // Abo ohne Konto -> auf ein bestehendes Konto haengen. Zwei Fragen (welches
  // Konto, warum), dann dieselbe Kontoaktion wie alle anderen: Step-up, Recht,
  // Audit mit Vorher/Nachher. Die Kaufadresse bleibt als Beleg am Kunden.
  function bindeAboUmhaengen() {
    document.querySelectorAll("[data-aboUmhaengen]").forEach(function (knopf) {
      knopf.addEventListener("click", async function () {
        const kundenId = knopf.getAttribute("data-aboUmhaengen");
        const konto = await D.text({
          titel: "Abo auf ein Konto umhängen",
          absaetze: ["Das Abo " + kundenId + " wird dem Konto mit dieser Adresse zugeordnet. Die Adresse, mit der bezahlt wurde, bleibt als Beleg erhalten; bei Stripe ändert sich nichts."],
          platzhalter: "Konto-Adresse, z. B. name@example.org",
          minLaenge: 5,
          okText: "Weiter"
        });
        if (!konto || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(konto).trim())) return;
        const grund = await D.text({
          titel: "Warum?",
          absaetze: ["Der Grund steht dauerhaft im Audit-Log."],
          platzhalter: "z. B. Kunde hat unter seiner Zweitadresse bezahlt",
          minLaenge: 3,
          okText: "Umhängen"
        });
        if (grund === null || String(grund).trim().length < 3) return;
        knopf.textContent = "läuft …";
        knopf.setAttribute("disabled", "disabled");
        const antwort = await A.aktion(String(konto).trim().toLowerCase(), "billing.relink", { reason: String(grund).trim(), customerId: kundenId });
        if (!antwort.ok) { meldung(antwort.fehler, true); knopf.textContent = "Auf ein Konto umhängen"; knopf.removeAttribute("disabled"); return; }
        meldung("Abo umgehängt — das Konto sieht jetzt seinen Plan.", false);
        zeigeNutzer();
      });
    });
  }

  function bindeNeubau() {
    const knopf = document.getElementById("neubauKnopf");
    if (!knopf) return;
    knopf.addEventListener("click", async function () {
      const grund = await D.text({
        titel: "Nutzer-Index neu bauen",
        absaetze: ["Der Neubau liest alle Konten neu ein und wird protokolliert. Bestehende Daten ändert er nicht."],
        vorgabe: "Turnusmässige Auffrischung",
        minLaenge: 3,
        okText: "Neu bauen"
      });
      if (grund === null || String(grund).trim().length < 3) return;
      knopf.textContent = "wird gebaut …";
      knopf.setAttribute("disabled", "disabled");
      const antwort = await A.neubau(String(grund).trim());
      if (!antwort.ok) { zeigeFehler(antwort.fehler); return; }
      zeigeNutzer();
    });
  }

  // Auswahl statt Abtippen: ein vertippter Rollenname wurde frueher erst vom
  // Server abgewiesen ("admin_role_invalid") — jetzt gibt es nur gueltige.
  const ROLLEN = [
    { wert: "user", text: "user — normales Konto, kein Zugang zur Konsole" },
    { wert: "readonly", text: "readonly — darf zuschauen, nichts ändern" },
    { wert: "auditor", text: "auditor — Audit-Log und Nachweise" },
    { wert: "finance", text: "finance — Abrechnung und Budgets" },
    { wert: "support", text: "support — Sitzungen widerrufen, Support-Zugriff" },
    { wert: "admin", text: "admin — Konten verwalten, sperren" },
    { wert: "owner", text: "owner — alle Rechte, inklusive Rollenvergabe" }
  ];

  const AKTIONSTEXT = {
    block: ["Sperren", "Das Konto wird gesperrt und alle Sitzungen werden beendet.", "Grund für die Sperre:"],
    unblock: ["Entsperren", "Das Konto wird wieder freigegeben.", "Grund für die Entsperrung:"],
    verify: ["E-Mail bestätigen", "Die Adresse gilt danach als bestätigt.", "Grund (z. B. Ticketnummer):"],
    unlock: ["Login-Sperre aufheben", "Die Fehlversuche werden zurückgesetzt. Das Passwort bleibt unverändert.", "Grund:"],
    "sessions.revoke": ["Sitzungen widerrufen", "Alle angemeldeten Geräte werden abgemeldet.", "Grund:"],
    "role.grant": ["Rolle vergeben", "Rechteausweitung — braucht die Freigabe einer zweiten Person.", "Grund:"],
    delete: ["Konto löschen", "UNUMKEHRBAR. Personenbezogene Daten werden entfernt. Braucht die Freigabe einer zweiten Person.", "Grund (z. B. DSGVO Art. 17, Ticket):"]
  };

  function bindeAkteAktionen(kennung) {
    const leiste = document.getElementById("akteAktionen");
    if (!leiste) return;
    leiste.querySelectorAll("[data-aktion]").forEach(function (knopf) {
      knopf.addEventListener("click", async function () {
        const name = knopf.getAttribute("data-aktion");
        if (name === "impersonation") return supportAnfragen(kennung);
        const text = AKTIONSTEXT[name] || [name, "", "Grund:"];
        let rolle = null;
        if (name === "role.grant") {
          rolle = await D.auswahl({
            titel: "Welche Rolle?",
            absaetze: ["Eine Rechteausweitung braucht anschließend die Freigabe einer zweiten Person."],
            optionen: ROLLEN,
            vorgabe: "support",
            okText: "Weiter"
          });
          if (!rolle) return;
        }
        const grund = await D.text({
          titel: text[0],
          absaetze: [text[1]],
          platzhalter: text[2].replace(/:$/, ""),
          minLaenge: 3,
          mehrzeilig: name === "delete",
          okText: text[0]
        });
        if (grund === null || String(grund).trim().length < 3) return;
        knopf.textContent = "läuft …";
        knopf.setAttribute("disabled", "disabled");
        const antwort = await A.aktion(kennung, name, { reason: String(grund).trim(), role: rolle });
        if (!antwort.ok) { meldung(antwort.fehler, true); return; }
        if (antwort.data.vierAugen) {
          meldung("Beantragt. Eine zweite Person muss freigeben — du selbst darfst das nicht. "
            + "Antrag: " + antwort.data.approval.id, false);
          return;
        }
        geheZu("nutzer");
      });
    });
  }

  async function supportAnfragen(kennung) {
    const grund = await D.text({
      titel: "Support-Zugriff anfragen",
      absaetze: ["Die betroffene Person muss in ihrer eigenen Sitzung einwilligen. Ohne Einwilligung passiert nichts."],
      platzhalter: "Grund, z. B. Ticket 4471 — Nutzerin bittet um Hilfe",
      minLaenge: 3,
      okText: "Anfragen"
    });
    if (grund === null || String(grund).trim().length < 3) return;
    const antwort = await A.impersonationBeantragen({ subject: kennung, reason: String(grund).trim() });
    if (!antwort.ok) { meldung(antwort.fehler, true); return; }
    meldung("Angefragt. Der Zugriff startet erst nach der Einwilligung der betroffenen Person.", false);
  }

  function bindeFreigaben() {
    document.querySelectorAll("[data-frei]").forEach(function (el) {
      el.addEventListener("click", async function () {
        const sicher = await D.bestaetige({
          titel: "Antrag freigeben?",
          absaetze: ["Die beantragte Aktion wird danach sofort ausgeführt. Bei einer Löschung ist das unumkehrbar."],
          okText: "Freigeben und ausführen"
        });
        if (!sicher) return;
        const antwort = await A.freigeben(el.getAttribute("data-frei"));
        if (!antwort.ok) { meldung(antwort.fehler, true); return; }
        zeigeFreigaben();
      });
    });
    document.querySelectorAll("[data-ab]").forEach(function (el) {
      el.addEventListener("click", async function () {
        const grund = await D.text({
          titel: "Antrag ablehnen",
          absaetze: ["Der Grund steht dauerhaft im Audit-Log und ist für die antragstellende Person sichtbar."],
          platzhalter: "Warum wird der Antrag abgelehnt?",
          minLaenge: 3,
          okText: "Ablehnen"
        });
        if (grund === null || String(grund).trim().length < 3) return;
        const antwort = await A.ablehnen(el.getAttribute("data-ab"), String(grund).trim());
        if (!antwort.ok) { meldung(antwort.fehler, true); return; }
        zeigeFreigaben();
      });
    });
  }

  function bindeSupport() {
    const paare = [["data-ja", A.einwilligen], ["data-nein", A.einwilligungAblehnen],
      ["data-selbstEnde", A.impersonationBeenden], ["data-ende", A.impersonationBeenden]];
    paare.forEach(function (paar) {
      document.querySelectorAll("[" + paar[0] + "]").forEach(function (el) {
        el.addEventListener("click", async function () {
          const antwort = await paar[1](el.getAttribute(paar[0]));
          if (!antwort.ok) { meldung(antwort.fehler, true); return; }
          zeigeSupport();
        });
      });
    });
  }

  function meldung(text, istFehler) {
    const kasten = document.createElement("div");
    kasten.className = "note glass" + (istFehler ? " fehler" : "");
    kasten.innerHTML = '<div class="nx">' + (istFehler ? "▲" : "✓") + '</div><div>'
      + '<div class="nt">' + (istFehler ? "Das hat nicht geklappt" : "Erledigt") + '</div>'
      + '<div class="ns">' + A.escapeHtml(text) + '</div></div>';
    seite.insertBefore(kasten, seite.firstChild);
    window.scrollTo(0, 0);
  }

  function bindeZurueck() {
    const knopf = document.getElementById("zurueckKnopf");
    if (knopf) knopf.addEventListener("click", function () { geheZu("nutzer"); });
  }

  function bindeZeitraum() {
    const anwenden = document.getElementById("zeitraumKnopf");
    if (anwenden) anwenden.addEventListener("click", function () {
      zustand.von = (document.getElementById("von") || {}).value || "";
      zustand.bis = (document.getElementById("bis") || {}).value || "";
      zeigeAudit();
    });
    const leeren = document.getElementById("zeitraumLeeren");
    if (leeren) leeren.addEventListener("click", function () {
      zustand.von = ""; zustand.bis = ""; zeigeAudit();
    });
  }

  // ---- Routing ----------------------------------------------------------------

  function route() {
    let ziel = aktuellerPfad();
    if (AUFGELOEST[ziel]) {
      ziel = AUFGELOEST[ziel];
      if (PFAD_MODUS) history.replaceState(null, "", seitenLink(ziel));
    }
    // Ein alter #-Link auf der neuen Auslieferung: Adresse still bereinigen,
    // damit Lesezeichen und geteilte Links ab jetzt ohne # weiterwandern.
    if (PFAD_MODUS && location.hash) {
      history.replaceState(null, "", ziel.indexOf("akte/") === 0
        ? "/admin/nutzer/?akte=" + encodeURIComponent(ziel.slice("akte/".length))
        : seitenLink(ziel));
    }
    if (ziel.indexOf("akte/") === 0) {
      schreibeNav("nutzer");
      setzeKopf("Nutzerakte");
      return zeigeAkte(decodeURIComponent(ziel.slice("akte/".length)));
    }
    const treffer = SEITEN.filter(function (s) { return s.pfad === ziel; })[0]
      || SEITEN.filter(function (s) { return s.pfad === STARTSEITE; })[0]
      || SEITEN[0];
    schreibeNav(treffer.pfad);
    setzeKopf(treffer.name);
    versteckeStand();
    if (treffer.pfad === "nutzer") return zeigeNutzer();
    if (treffer.pfad === "rollen") return zeigeRollen();
    if (treffer.pfad === "audit") return zeigeAudit();
    if (treffer.pfad === "freigaben") return zeigeFreigaben();
    if (treffer.pfad === "support") return zeigeSupport();
    if (ANGEMELDET[treffer.pfad]) {
      laedt("wird geladen …");
      return ANGEMELDET[treffer.pfad].laden(seitenKontext(treffer.pfad));
    }
    if (treffer.pfad === "compliance") return zeigeCompliance();
    // Kein Treffer mehr moeglich: das Cockpit ist registriert und faengt auf.
    laedt("wird geladen …");
    return ANGEMELDET[STARTSEITE].laden(seitenKontext(STARTSEITE));
  }

  // Spiegel zu public/admin/console.js. Hier liegt gate.js NICHT daneben:
  // adminUiRoutes.js prueft schon vor dem Ausliefern und gibt ohne Adminrolle
  // keine Datei heraus. Der Fallback macht die Zeilen damit wirkungslos — sie
  // stehen trotzdem hier, damit die beiden Kopien nicht auseinanderlaufen.
  const GATE = window.smejjAdminGate || { freigeben: function () {}, abweisen: function () {} };
  const KEIN_ADMIN = ["admin_role_required", "admin_account_not_active"];

  async function start() {
    // Auch mit einer alten, noch im Browser-Cache liegenden index.html ohne
    // hidden-Attribut: die Pillen starten versteckt.
    versteckeStand();
    schreibeNav(STARTSEITE);
    laedt("Anmeldung wird geprüft …");
    const antwort = await A.ich();
    if (!antwort.ok) {
      // Der Server hat nicht JA gesagt — also bleibt die Huelle weg. Sie
      // verraet sonst jedem, der die Adresse kennt, welche Module es gibt und
      // wie sie heissen (Befund 2026-08-14).
      //
      // WICHTIG, zweiter Befund desselben Tages: der erste Entwurf gab die
      // Huelle bei jeder unklaren Antwort frei (Netz, CORS, 5xx) — damit war
      // die Luecke sofort wieder offen, denn "der Server antwortet nicht" ist
      // der Zustand, den ein Angreifer am leichtesten herstellt. Im Browser
      // gemessen und behoben: sichtbar wird die Konsole AUSSCHLIESSLICH nach
      // einem bestaetigten Akteur.
      if (antwort.status === 401) {
        location.replace(GATE.anmeldeAdresse ? GATE.anmeldeAdresse("abgelaufen=1") : "/auth/login/");
        return;
      }
      // Nur diese beiden 403 heissen "du bist kein Admin" — sie sind die
      // einzigen, die adminAuth.js VOR der Rollenpruefung vergeben kann.
      // Alle anderen 403 (Adresse noch nicht bestaetigt, Step-up noetig)
      // treffen jemanden, der SEHR WOHL Admin ist und die Konsole braucht,
      // um genau das zu erledigen.
      if (antwort.status === 403) {
        if (KEIN_ADMIN.indexOf((antwort.data || {}).error) >= 0) {
          GATE.abweisen(antwort.fehler || "Dieser Bereich ist der Betreiberverwaltung vorbehalten.");
          return;
        }
        // Ein anderer 403 heisst: Adminrolle JA, aber ein Schritt fehlt noch
        // (Adresse bestaetigen, zweiter Faktor). Genau dafuer braucht dieser
        // Mensch die Konsole — adminUiRoutes.js laesst ihn deshalb ausdruecklich
        // herein ("erlaubeUnbestaetigt"). Huelle zeigen, Grund darin nennen.
        GATE.freigeben();
        seite.innerHTML = V.fehlerblock(antwort.fehler);
        return;
      }
      // Alles Uebrige: der Grund im Klartext und ein Knopf zum Wiederholen.
      // Der Betreiber verliert dabei nichts — ohne Serverantwort stuende in
      // der Huelle ohnehin keine einzige Zeile Inhalt.
      GATE.abweisen({
        titel: "Konsole nicht erreichbar",
        text: antwort.fehler || "Der Control-Server hat nicht geantwortet.",
        neuLaden: true
      });
      return;
    }
    // Ab hier ist der Akteur vom SERVER bestaetigt — erst jetzt darf die
    // Konsole ueberhaupt sichtbar werden.
    GATE.freigeben();
    zustand.akteur = antwort.data.actor || {};
    // (zeigeUmgebung() steht weiter unten, nach den Kopfzeilen-Feldern.)
    // Damit der Sicherheitsdialog sagen kann, WOHIN der Code ging, statt nur
    // "deine Admin-E-Mail-Adresse". Beim allerersten Aufruf einer noch nicht
    // bestaetigten Adresse steht das hier noch nicht — dort greift der
    // allgemeine Text in api.js.
    if (zustand.akteur.email) document.body.setAttribute("data-admin-email", zustand.akteur.email);
    const name = zustand.akteur.name || zustand.akteur.email || "—";
    document.getElementById("akteurName").textContent = name;
    document.getElementById("akteurRolle").textContent = zustand.akteur.role || "—";
    document.getElementById("akteurKuerzel").textContent =
      name.replace(/[^A-Za-zÄÖÜäöü ]/g, " ").trim().split(/\s+/).map(function (t) { return t[0]; })
        .join("").slice(0, 2).toUpperCase() || "··";
    const stufe = document.getElementById("stufe");
    stufe.textContent = "Stufe " + (antwort.data.stage || 2)
      + (antwort.data.writable ? " · schreibend" : " · nur lesend");
    zeigeUmgebung();
    // Im Pfad-Modus ist jeder Seitenwechsel eine echte Navigation — es gibt
    // nichts zu beobachten. Der Hash-Horcher bleibt dem Rueckfallweg vorbehalten.
    if (!PFAD_MODUS) window.addEventListener("hashchange", route);
    route();
  }

  /**
   * Sagt, WO diese Konsole gerade arbeitet.
   *
   * Befund 2026-08-15 (A-bis-Z-Pruefung): in index.html stand fest
   * "Produktion" — kein Skript hat das je gesetzt. Eine Konsole auf einem
   * Testserver haette genauso ausgesehen, und wer zwei Fenster offen hat,
   * konnte sie nicht unterscheiden. Ein Etikett, das immer dasselbe sagt,
   * sagt nichts.
   *
   * Jetzt steht dort der Host, von dem diese Konsole ausgeliefert wird. Das
   * ist genau die Frage, die das Etikett beantworten soll: "Ist das hier die
   * echte?" Nur smejj.com und der Rueckfallweg heissen weiter "Produktion",
   * jeder andere Host wird beim Namen genannt.
   *
   * Bewusst aus `location` und nicht aus api.js: dessen Auswahl der API-Basis
   * ist privat, und api.js liegt unter dem Admin-Lock. Eine zweite Kopie
   * dieser Logik wuerde frueher oder spaeter auseinanderlaufen.
   */
  function zeigeUmgebung() {
    const feld = document.getElementById("umgebung");
    if (!feld) return;
    const host = String(location.hostname || "").toLowerCase();
    const echt = host === "smejj.com" || host === "www.smejj.com" || host === "smejj-control.zeabur.app";
    feld.textContent = echt ? "Produktion" : (host || "unbekannt");
    feld.title = "Diese Konsole wird von " + (host || "unbekannt") + " ausgeliefert";
  }

  start();
})();
