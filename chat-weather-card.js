// Nur vorhandene deutschsprachige Wetterwerte darstellen. Bei uneindeutigen
// Antworten bleibt das normale Markdown erhalten; keine nachtraeglichen Abrufe.
export function wetterKarte(source, toHtml, escapeHtml) {
  if (!/Open-Meteo/i.test(source) || /morgen|vorhersage|```|\|.*\|/i.test(source)) return "";
  const plain = source.replace(/\*\*/g, "");
  const number = "(-?\\d+(?:[.,]\\d+)?)";
  const temperature = plain.match(new RegExp("(?:bei|Temperatur:|Aktuell[^\\n:]*:)\\s*" + number + "\\s*°C", "i"));
  const place = plain.match(/(?:in|fuer|für) ([^\n:,.!?]{2,65}?)(?=:|,|\s+(?:ist|wird|heute)|[.!?])/i);
  if (!temperature || !place) return "";
  const metrics = [];
  const add = (label, value, unit) => {
    if (value !== undefined) metrics.push(`<div><dt>${label}</dt><dd>${escapeHtml(value)} ${unit}</dd></div>`);
  };
  const feels = plain.match(new RegExp("gef(?:ue|ü)hlt(?: nur)?\\s*" + number + "\\s*°C", "i"));
  const range = plain.match(new RegExp(number + "\\s*(?:°C)?\\s*bis\\s*" + number + "\\s*°C", "i"));
  const rain = plain.match(/(?:Regenwahrscheinlichkeit|Regenrisiko)[^%\n]{0,55}?(\d+(?:[.,]\d+)?)\s*%/i);
  const wind = plain.match(/Wind[^.\n]{0,45}?(\d+(?:[.,]\d+)?)\s*km\/h/i);
  add("Gefühlt", feels?.[1], "°C");
  add("Minimum", range?.[1], "°C");
  add("Maximum", range?.[2], "°C");
  add("Regenrisiko", rain?.[1], "%");
  add("Wind", wind?.[1], "km/h");
  if (metrics.length < 2) return "";
  return `<section class="chat-weather"><h3>${escapeHtml(place[1].trim())}</h3>`
    + `<p class="chat-weather-temperature">${escapeHtml(temperature[1])} °C</p>`
    + `<dl>${metrics.join("")}</dl>`
    + `<p><a class="chat-link" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a></p>`
    + `<details><summary>Wetterbericht und Aktualisierungszeit</summary>${toHtml(source)}</details></section>`;
}

