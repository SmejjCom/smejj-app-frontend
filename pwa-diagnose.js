// smejj.com — VORUEBERGEHENDE Messanzeige fuer den schwarzen Balken am iPhone.
//
// Warum das hier steht: Drei Anlaeufe gegen den Streifen ueber dem Home-Balken
// haben nichts gebracht (Wurzel-Gefaelle, festes Hintergrundelement, PWA neu
// hinzugefuegt). Alle drei waren Vermutungen — gemessen wurde nie, weil auf dem
// Mac kein Xcode und damit kein iPhone-Simulator vorhanden ist. Diese Zeile
// Zahlen beendet das Raten: sie steht nur IM VOLLBILD (installierte App), nur
// am Telefon, ist zwei Zeilen hoch und verschwindet mit dem naechsten Deploy,
// sobald die Ursache feststeht.
//
// Was die Zahlen bedeuten:
//   S  = Hoehe des GERAETS in Punkten (screen.height)
//   V  = Hoehe, die die SEITE bekommt (innerHeight)
//   SA = untere Safe-Area, die der Browser meldet (env(safe-area-inset-bottom))
//   D  = S minus V. Ist D groesser als 0, endet die Seite VOR der Geraetekante —
//        dann kann kein CSS den Balken fuellen, weil die Seite dort nicht hinreicht.
//   ST = laeuft als installierte App (standalone) ja/nein
//
// Der pinke Strich am unteren Rand ist die gemeldete Safe-Area. Reicht er bis zur
// untersten Kante des Bildschirms, deckt die Seite alles; bleibt Schwarz darunter,
// ist D die Erklaerung.

function envWert(name) {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;visibility:hidden;height:env(${name},0px)`;
  document.body.append(probe);
  const wert = Math.round(parseFloat(getComputedStyle(probe).height) || 0);
  probe.remove();
  return wert;
}

function zeigeMessung() {
  const standalone = window.navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  // Nur am Telefon und nur im Vollbild — am Schreibtisch stoert es niemanden.
  if (!standalone || window.innerWidth > 600) return;
  if (document.getElementById("pwaMess")) return;

  const sab = envWert("safe-area-inset-bottom");
  const sat = envWert("safe-area-inset-top");
  const d = Math.round(screen.height - window.innerHeight);

  const zeile = document.createElement("div");
  zeile.id = "pwaMess";
  zeile.style.cssText = [
    "position:fixed", "left:0", "right:0", "top:0", "z-index:2147483647",
    "background:rgba(255,62,165,.92)", "color:#fff", "font:600 12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace",
    "padding:calc(env(safe-area-inset-top,0px) + 2px) 8px 3px", "text-align:center",
    "letter-spacing:.2px", "pointer-events:none"
  ].join(";");
  zeile.textContent = `S${screen.height} V${window.innerHeight} D${d} SAoben${sat} SAunten${sab} ST${standalone ? "1" : "0"} DPR${window.devicePixelRatio}`;
  document.body.append(zeile);

  // Der pinke Strich zeigt, wie weit die Seite unten wirklich reicht.
  const strich = document.createElement("div");
  strich.id = "pwaMessKante";
  strich.style.cssText = [
    "position:fixed", "left:0", "right:0", "bottom:0", "z-index:2147483647",
    "height:calc(env(safe-area-inset-bottom,0px) + 5px)",
    "background:#ff3ea5", "pointer-events:none"
  ].join(";");
  document.body.append(strich);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", zeigeMessung);
  else zeigeMessung();
}

export { envWert, zeigeMessung };
