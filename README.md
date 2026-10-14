# Astro-Go

Zwei Fragen für den gewählten Ort, jeweils als Note von 1 bis 10 mit kurzer Erklärung:

- **Astrofoto:** Lohnt sich das Aufbauen der Seestar S50 Pro heute Nacht?
- **Nordlicht:** Wie gut sind die Chancen jetzt, in den nächsten Nächten und grob in den nächsten 27 Tagen?

Live: https://robert-tech-byte.github.io/astro-go/ (Nordlicht direkt: `#nordlicht`)

## Daten

- Wetter: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0) mit MET Nordic, ICON-EU, ECMWF IFS, UK Met Office, GFS
- Weltraumwetter: [NOAA SWPC](https://www.swpc.noaa.gov/) (Kp-Vorhersage 3 Tage, Kp-Schätzung je Minute, OVATION-Oval, 27-Tage-Ausblick, Sonnenwind in Echtzeit vom aktiven L1-Satelliten) und [GFZ Potsdam](https://spaceweather.gfz.de/) (Kp-Ensemble-Vorhersage, gemessener Kp, CC BY 4.0)
- Sonne und Mond werden im Browser berechnet

## Dateien

- `index.html` – Seite
- `astro-core.js` – Astrofoto-Bewertung
- `aurora-core.js` – Nordlicht-Bewertung

Beide Kern-Dateien laufen auch in Node (`require`) und lassen sich so mit Testdaten prüfen.
