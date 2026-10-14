# Astro-Go

Zwei Fragen für den gewählten Ort, jeweils als Note von 1 bis 10 mit kurzer Erklärung:

- **Astrofoto:** Lohnt sich das Aufbauen der Seestar S50 Pro heute Nacht?
- **Nordlicht:** Wie gut sind die Chancen jetzt, in den nächsten Nächten und grob in den nächsten 27 Tagen?

Live: https://robert-tech-byte.github.io/astro-go/ (Nordlicht direkt: `#nordlicht`)

## Daten

- Wetter: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Basis ECMWF IFS und ICON-EU (außerhalb Europas ICON Global), je nach Ort ergänzt um Regionalmodelle wie MET Nordic, ICON-D2, ICON-CH1/CH2, AROME France, ICON 2I, UKV, KNMI- und DMI-Harmonie. Kein GFS.
- Weltraumwetter: [NOAA SWPC](https://www.swpc.noaa.gov/) (Kp-Vorhersage 3 Tage, Kp-Schätzung je Minute, OVATION-Oval, 27-Tage-Ausblick, Sonnenwind in Echtzeit vom aktiven L1-Satelliten) und [GFZ Potsdam](https://spaceweather.gfz.de/) (Kp- und Hp30-Vorhersage aus dem stündlichen Hpo-Modell, gemessener Kp und Hp30, CC BY 4.0; SWIFT-Ensemble als Reserve)
- Sonne und Mond werden im Browser berechnet

## Dateien

- `index.html` – Seite
- `astro-core.js` – Astrofoto-Bewertung
- `aurora-core.js` – Nordlicht-Bewertung

Beide Kern-Dateien laufen auch in Node (`require`) und lassen sich so mit Testdaten prüfen.

## GFZ-Daten über Cloudflare

Die GFZ-Server erlauben keinen Abruf direkt aus dem Browser. `cloudflare/worker.js`
ist ein kleiner Cloudflare-Worker, der nur die benötigten GFZ-Dateien weiterreicht
(5 Minuten Zwischenspeicher, Browser-Erlaubnis nur für robert-tech-byte.github.io).
Seine Adresse steht in `aurora-core.js` unter `URLS.worker`. Fällt er aus, nutzt die
Seite die stündliche Kopie aus dem GitHub-Ablauf.
