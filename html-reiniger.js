// smejj.com — gespeichertes Verlaufs-HTML vor innerHTML reinigen (Sicherheitspruefung 28.09.).
// Sperrliste auf DOM-Ebene: nur Gefaehrliches, das die App nie selbst erzeugt, fliegt raus.

const VERBOTENE_ELEMENTE = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input",
  "textarea", "select", "option", "meta", "link", "base", "style", "noscript", "template",
  "portal", "foreignobject", "math", "dialog"
]);

const ADRESS_ATTRIBUTE = new Set(["href", "src", "xlink:href", "action", "poster", "background", "cite", "data", "srcset", "ping"]);

function sichereAdresse(wert, attribut, element) {
  const roh = String(wert || "").replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  if (!roh) return true;
  if (attribut === "srcset" || attribut === "ping" || attribut === "action") return false;
  if (roh.startsWith("/") || roh.startsWith("#") || roh.startsWith("?") || roh.startsWith("./")) return true;
  if (/^(https?|mailto|blob):/.test(roh)) return true;
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml|avif)[;,]/.test(roh)) return element === "img" && attribut === "src";
  return !/^[a-z][a-z0-9+.-]*:/.test(roh);
}

export function reinigeGespeichertesHtml(html, dokument = globalThis.document) {
  const text = String(html || "");
  if (!text || !dokument?.createElement) return text;
  const vorlage = dokument.createElement("template");
  vorlage.innerHTML = text;
  for (const element of [...vorlage.content.querySelectorAll("*")]) {
    const name = element.localName.toLowerCase();
    if (VERBOTENE_ELEMENTE.has(name)) {
      element.remove();
      continue;
    }
    for (const attribut of [...element.attributes]) {
      const a = attribut.name.toLowerCase();
      if (a.startsWith("on") || a === "srcdoc" || a === "formaction" || a === "http-equiv") {
        element.removeAttribute(attribut.name);
      } else if (ADRESS_ATTRIBUTE.has(a) && !sichereAdresse(attribut.value, a, name)) {
        element.removeAttribute(attribut.name);
      }
    }
  }
  return vorlage.innerHTML;
}
