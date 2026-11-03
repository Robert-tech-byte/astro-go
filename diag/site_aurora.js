/* Astro-Go: Nordlicht-Logik (Datenabruf-URLs, Parser, Bewertung 1–10).
   Läuft im Browser (window.AuroraCore) und in Node (module.exports) zum Testen. */
(function (root) {
  "use strict";

  const URLS = {
    // NOAA SWPC
    kpForecast: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
    kpNow: "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
    outlook27: "https://services.swpc.noaa.gov/text/27-day-outlook.txt",
    ovation: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
    mag: "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
    wind: "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json",
    // GFZ Potsdam
    // Neues Hpo-Vorhersagemodell (stündlich aktualisiert, Kp und Hp30, Median und Maximum)
    gfzHpoKp: "https://isdc-data.gfz.de/geomagnetism/HpoForecast/v0102/output/Hpo/json/hpo_forecast_mean_bars_Kp.json",
    gfzHpoHp30: "https://isdc-data.gfz.de/geomagnetism/HpoForecast/v0102/output/Hpo/json/hpo_forecast_mean_bars_Hp30.json",
    // älteres SWIFT/PAGER-Ensemble (nur Ersatz, wenn das Hpo-Modell fehlt)
    gfzForecast: "https://spaceweather.gfz.de/fileadmin/Kp-Forecast/CSV/kp_product_file_FORECAST_PAGER_SWIFT_LAST.csv",
    gfzKp: (startIso, endIso) => `https://kp.gfz.de/app/json/?start=${startIso}&end=${endIso}&index=Kp`,
    gfzHp30: (startIso, endIso) => `https://kp.gfz.de/app/json/?start=${startIso}&end=${endIso}&index=Hp30`,
    gfzHp60: (startIso, endIso) => `https://kp.gfz.de/app/json/?start=${startIso}&end=${endIso}&index=Hp60`,
    gfzHpoHp60: "https://isdc-data.gfz.de/geomagnetism/HpoForecast/v0102/output/Hpo/json/hpo_forecast_mean_bars_Hp60.json",
    // Cloudflare-Worker als Zwischendienst (cloudflare/worker.js). Leer = nicht eingerichtet.
    worker: "https://astro-go.astrobert.workers.dev",
    workerPaths: { gfzHpoKp: "/hpo-kp", gfzHpoHp30: "/hpo-hp30", gfzHpoHp60: "/hpo-hp60", gfzForecast: "/swift", gfzKp: "/kp", gfzHp30: "/hp30" },
    // Kopien neben der Seite (GitHub Actions holt sie als Reserve, weil GFZ keinen Browser-Abruf erlaubt)
    local: {
      gfzHpoKp: "data/gfz_hpo_kp.json",
      gfzHpoHp30: "data/gfz_hpo_hp30.json",
      gfzHpoHp60: "data/gfz_hpo_hp60.json",
      gfzForecast: "data/gfz_swift.csv",
      gfzKp: "data/gfz_kp.json",
      gfzHp30: "data/gfz_hp30.json",
      gfzHp60: "data/gfz_hp60.json",
      meta: "data/meta.json"
    }
  };

  const L1_KM = 1.5e6; // Abstand L1–Erde, grob

  /* ---------- Hilfen ---------- */
  function toMs(t) {
    if (t === null || t === undefined) return NaN;
    if (typeof t === "number") return t;
    let s = String(t).trim().replace(" ", "T");
    if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
    return Date.parse(s);
  }
  function num(x) { const n = typeof x === "number" ? x : parseFloat(x); return isFinite(n) ? n : null; }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const logistic = x => 1 / (1 + Math.exp(-x));

  // Akzeptiert SWPC-Arrays mit Kopfzeile (alt) und Objekt-Arrays (neu, ab 2026)
  function rows(json) {
    if (!Array.isArray(json) || !json.length) return [];
    if (Array.isArray(json[0])) {
      const head = json[0].map(String);
      return json.slice(1).map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])));
    }
    return json;
  }

  /* ---------- Geomagnetische Breite (Dipol, IGRF-Pol 2025 ca. 80,8° N / 72,7° W) ---------- */
  const POLE = { lat: 80.8, lon: -72.7 };
  function magLat(lat, lon) {
    const R = Math.PI / 180;
    const s = Math.sin(lat * R) * Math.sin(POLE.lat * R) + Math.cos(lat * R) * Math.cos(POLE.lat * R) * Math.cos((lon - POLE.lon) * R);
    let m = Math.asin(clamp(s, -1, 1)) / R;
    // Im europäischen Sektor liegt die korrigierte magnetische Breite (CGM) ca. 2,5° unter dem Dipolwert
    const lonN = ((lon + 540) % 360) - 180;
    if (lat > 0 && lonN > -30 && lonN < 60) m -= 2.5;
    return m;
  }
  // NOAA-Faustregel: Kp 0 → Oval-Südrand bei 66,5° geomag., je Kp ca. 2° weiter südlich
  function kpNeeded(mlat) {
    const overhead = Math.max(0, (66.5 - Math.abs(mlat)) / 2.04);
    const horizon = Math.max(0, overhead - 1.5); // tief am Nordhorizont sichtbar
    return { overhead, horizon };
  }
  // Wahrscheinlichkeit sichtbarer Aktivität 0..1 aus Kp
  function activityFromKp(kp, need) {
    if (kp === null || kp === undefined) return null;
    // Nur Horizont-Nordlicht zählt weniger als Nordlicht über dem Beobachter
    return clamp(0.45 * logistic((kp - need.horizon) / 0.6) + 0.55 * logistic((kp - need.overhead) / 0.6), 0, 1);
  }

  /* ---------- Parser ---------- */
  function parseKpForecast(json) {
    return rows(json).map(r => ({
      ms: toMs(r.time_tag), kp: num(r.kp ?? r.Kp),
      kind: String(r.observed || "").toLowerCase(), // observed | estimated | predicted
      scale: r.noaa_scale || null
    })).filter(r => isFinite(r.ms) && r.kp !== null);
  }

  function parseKpNow(json) {
    const r = rows(json).map(x => ({ ms: toMs(x.time_tag), kp: num(x.estimated_kp ?? x.kp_index ?? x.kp) })).filter(x => isFinite(x.ms) && x.kp !== null);
    return r.length ? r[r.length - 1] : null;
  }

  // GFZ-CSV: "Time (UTC)" im Format dd-mm-yyyy HH:MM
  function parseGfzCsv(text) {
    const lines = String(text).trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const head = lines[0].split(",").map(s => s.trim());
    const idx = n => head.indexOf(n);
    const iT = idx("Time (UTC)"), iMed = idx("median"), iMin = idx("minimum"), iMax = idx("maximum"),
      iQ1 = idx("0.25-quantile"), iQ3 = idx("0.75-quantile");
    const probCols = head.map((h, i) => [h, i]).filter(([h]) => h.startsWith("prob"));
    return lines.slice(1).map(l => {
      const c = l.split(",");
      const m = /^(\d\d)-(\d\d)-(\d{4}) (\d\d):(\d\d)/.exec((c[iT] || "").trim());
      if (!m) return null;
      const ms = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
      const p = {};
      probCols.forEach(([h, i]) => { p[h] = num(c[i]); });
      const pStorm = ["prob 5-6", "prob 6-7", "prob 7-8", "prob >= 8"].reduce((a, k) => a + (p[k] || 0), 0);
      return { ms, median: num(c[iMed]), min: num(c[iMin]), max: num(c[iMax]), q1: num(c[iQ1]), q3: num(c[iQ3]), pActive: (p["prob 4-5"] || 0) + pStorm, pStorm };
    }).filter(Boolean);
  }

  // kp.gfz.de-Webservice: {datetime:[…], Kp|Hp30:[…], status:[…]}
  function parseGfzIndex(json, key) {
    if (!json || !json.datetime || !json[key]) return [];
    return json.datetime.map((t, i) => ({ ms: toMs(t), kp: num(json[key][i]), status: json.status ? json.status[i] : null })).filter(r => isFinite(r.ms) && r.kp !== null);
  }
  const parseGfzKp = j => parseGfzIndex(j, "Kp");
  const parseGfzHp30 = j => parseGfzIndex(j, "Hp30");
  const parseGfzHp60 = j => parseGfzIndex(j, "Hp60");

  // Hpo-Vorhersage: {"MEDIAN": {"2026-10-14T09:00:00.000": 4.33, …}, "MAX": {…}}, Zeiten in UTC
  function parseHpo(json) {
    if (!json || !json.MEDIAN) return [];
    return Object.entries(json.MEDIAN).map(([t, v]) => ({
      ms: toMs(t), median: num(v), max: json.MAX ? num(json.MAX[t]) : null, min: null, q1: null, q3: null
    })).filter(r => isFinite(r.ms) && r.median !== null).sort((a, b) => a.ms - b.ms);
  }
  // Frisch = deckt jetzt ab und reicht mindestens 12 h in die Zukunft
  function isFresh(arr, nowMs, stepMs) {
    return arr.length > 0 && arr.some(r => r.ms <= nowMs && r.ms + stepMs > nowMs) && arr[arr.length - 1].ms > nowMs + 12 * 3600000;
  }

  // 27-Tage-Ausblick: "2026 Oct 13     140          8          3"
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  function parse27(text) {
    const out = [];
    const re = /^(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)\s*$/gm;
    let m;
    while ((m = re.exec(String(text)))) {
      if (!(m[2] in MONTHS)) continue;
      out.push({ dateMs: Date.UTC(+m[1], MONTHS[m[2]], +m[3]), flux: +m[4], ap: +m[5], kpMax: +m[6] });
    }
    return out;
  }

  // Sonnenwind: nur Datensätze des als aktiv markierten Satelliten
  function parseRtsw(json, fields) {
    let r = rows(json);
    if (r.some(x => x.active === true || x.active === "true")) r = r.filter(x => x.active === true || x.active === "true");
    return r.map(x => {
      const o = { ms: toMs(x.time_tag), source: x.source || null };
      for (const [k, alts] of Object.entries(fields)) o[k] = num(alts.map(a => x[a]).find(v => v !== undefined && v !== null));
      return o;
    }).filter(o => isFinite(o.ms)).sort((a, b) => a.ms - b.ms);
  }
  const parseMag = j => parseRtsw(j, { bz: ["bz_gsm"], by: ["by_gsm"], bt: ["bt"] });
  const parseWind = j => parseRtsw(j, { speed: ["proton_speed", "speed"], density: ["proton_density", "density"] });

  // OVATION: {"Forecast Time": …, "coordinates": [[lon, lat, wert], …]}
  function ovationAt(json, lat, lon) {
    if (!json || !Array.isArray(json.coordinates)) return null;
    const lon360 = ((Math.round(lon) % 360) + 360) % 360;
    const grid = new Map();
    for (const c of json.coordinates) {
      if (Math.abs(c[0] - lon360) <= 2 || Math.abs(c[0] - lon360) >= 358) grid.set(c[0] + ":" + c[1], c[2]);
    }
    const at = (lo, la) => grid.get(lo + ":" + la);
    const la0 = Math.round(lat);
    const lons = [-2, -1, 0, 1, 2].map(d => ((lon360 + d) % 360 + 360) % 360);
    const val = la => Math.max(...lons.map(lo => at(lo, la) ?? 0));
    const overhead = val(la0);
    // Polwärts (Norden) liegendes Oval ist noch tief am Horizont sichtbar, schwächer gewichtet
    let horizon = 0;
    const dir = lat >= 0 ? 1 : -1;
    for (let d = 1; d <= 8; d++) horizon = Math.max(horizon, val(la0 + dir * d) * (1 - d / 10));
    return { overhead, horizon, value: Math.max(overhead, horizon), forecastMs: toMs(json["Forecast Time"]), obsMs: toMs(json["Observation Time"]) };
  }

  /* ---------- Sonnenwind-Auswertung (kurzfristig) ---------- */
  function avgSince(arr, key, sinceMs) {
    const v = arr.filter(x => x.ms >= sinceMs && x[key] !== null).map(x => x[key]);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  function solarWindSummary(mag, wind, nowMs) {
    const lastMag = mag.length ? mag[mag.length - 1] : null;
    const lastWind = wind.length ? wind[wind.length - 1] : null;
    const ref = Math.max(lastMag ? lastMag.ms : 0, lastWind ? lastWind.ms : 0);
    if (!ref) return null;
    const bz30 = avgSince(mag, "bz", ref - 30 * 60000), bz10 = avgSince(mag, "bz", ref - 10 * 60000);
    const v30 = avgSince(wind, "speed", ref - 30 * 60000), n30 = avgSince(wind, "density", ref - 30 * 60000);
    const speed = v30 ?? (lastWind && lastWind.speed) ?? 400;
    const travelMin = speed > 0 ? Math.round(L1_KM / speed / 60) : null;
    // Faustformel: Kp-Äquivalent aus südlichem Bz und Geschwindigkeit (grobe Schätzung)
    const kpSw = bz30 === null ? null : clamp(1 + 0.25 * Math.max(0, -bz30) * (speed / 400) + Math.max(0, (speed - 500) / 200), 0, 9);
    let trend = "gleichbleibend";
    if (bz10 !== null && bz30 !== null) {
      if (bz10 < bz30 - 1.5) trend = "steigend";
      else if (bz10 > bz30 + 1.5) trend = "fallend";
    }
    return {
      source: (lastMag && lastMag.source) || (lastWind && lastWind.source) || null,
      dataAgeMin: Math.round((nowMs - ref) / 60000),
      bz: lastMag ? lastMag.bz : null, bz30, bz10, bt: lastMag ? lastMag.bt : null, bt30: avgSince(mag, "bt", ref - 30 * 60000),
      southMin: southwardMinutes(mag.filter(x => x.ms >= ref - 6 * 3600000)),
      speed: lastWind ? lastWind.speed : null, v30, density: lastWind ? lastWind.density : null, n30,
      travelMin, kpSw, trend
    };
  }
  // Einstufung von Bz (GSM) in nT
  function bzClass(bz) {
    if (bz === null || bz === undefined) return { label: "keine Daten", south: false };
    if (bz > 2) return { label: "nordwärts", south: false };
    if (bz >= -2) return { label: "neutral", south: false };
    if (bz >= -5) return { label: "schwach südwärts", south: true };
    if (bz >= -10) return { label: "moderat südwärts", south: true };
    return { label: "stark südwärts", south: true };
  }
  function bzWords(bz) {
    const c = bzClass(bz);
    return c.south ? c.label + ", geoeffektiv" : c.label;
  }
  // Minuten, die Bz (gleitendes 5-min-Mittel) zuletzt ununterbrochen unter −2 nT lag
  function southwardMinutes(mag) {
    const p = mag.filter(x => x.bz !== null);
    if (!p.length) return 0;
    const end = p[p.length - 1].ms;
    let start = null;
    for (let i = p.length - 1; i >= 0; i--) {
      const win = p.filter(x => x.ms > p[i].ms - 5 * 60000 && x.ms <= p[i].ms);
      const m = win.reduce((a, x) => a + x.bz, 0) / win.length;
      if (m < -2) start = p[i].ms; else break;
    }
    return start === null ? 0 : Math.round((end - start) / 60000);
  }
  // Rolle des Satelliten laut NOAA (seit 30.06.2026: SOLAR-1 Hauptquelle, ACE Reserve)
  function sourceRole(name) {
    const n = String(name || "").toUpperCase();
    if (n.includes("SOLAR")) return "Hauptquelle";
    if (n.includes("ACE")) return "Reserve";
    return "";
  }
  function speedWords(v) {
    if (v === null) return "keine Daten";
    if (v >= 700) return "sehr schnell";
    if (v >= 550) return "schnell";
    if (v >= 450) return "erhöht";
    return "ruhig";
  }

  /* ---------- Himmel ---------- */
  function darkFactor(sunAlt) {
    if (sunAlt <= -12) return 1;
    if (sunAlt <= -6) return 0.4 + 0.6 * ((-6 - sunAlt) / 6);
    if (sunAlt <= -3) return 0.1;
    return 0;
  }
  function skyFactor(sunAlt, cloud, moonAlt, illum) {
    const d = darkFactor(sunAlt);
    const c = cloud === null || cloud === undefined ? 1 : Math.pow(1 - clamp(cloud, 0, 100) / 100, 1.2);
    const m = moonAlt > 0 ? 1 - 0.25 * illum : 1;
    return { dark: d, cloud: c, moon: m, q: d * c * m };
  }

  /* ---------- Kp pro Stunde aus NOAA + GFZ zusammenführen ---------- */
  function kpAt(ms, noaa, gfz, gfzFresh) {
    const slot = (arr, key) => {
      const r = arr.find(x => ms >= x.ms && ms < x.ms + 3 * 3600000);
      return r ? r[key] : null;
    };
    const n = slot(noaa, "kp");
    const g = gfzFresh ? slot(gfz, "median") : null;
    const gMax = gfzFresh ? slot(gfz, "max") : null;
    const vals = [n, g].filter(v => v !== null);
    return { noaa: n, gfz: g, gfzMax: gMax, kp: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  }

  /* ---------- Stündliche Aktivität: gemessen (Vergangenheit) und Vorhersage (Zukunft) ----------
     R: { hp60m, hp30m, gfzK (gemessen), hp60f (Hpo-Vorhersage), hpoKp, kpF (NOAA) }
     Zukunft: GFZ-Median (stündlich, Hp60, auf 9 gekappt) zu 60 %, NOAA-Kp (3 h) zu 40 %. */
  function activityTimeline(R, nowMs, backH = 12, fwdH = 72) {
    const H = 3600000;
    const start = Math.floor(nowMs / H) * H - backH * H;
    const inSlot = (arr, ms, step) => arr.find(x => ms >= x.ms && ms < x.ms + step);
    const out = [];
    for (let ms = start; ms <= start + (backH + fwdH) * H; ms += H) {
      const past = ms + H <= nowMs;
      // gemessen: Hp60, sonst Mittel der beiden Hp30, sonst Kp
      let measured = null;
      const m60 = (R.hp60m || []).find(x => x.ms === ms);
      if (m60) measured = m60.kp;
      else {
        const h30 = (R.hp30m || []).filter(x => x.ms >= ms && x.ms < ms + H);
        if (h30.length) measured = h30.reduce((a, x) => a + x.kp, 0) / h30.length;
        else { const k = inSlot(R.gfzK || [], ms, 3 * H); if (k) measured = k.kp; }
      }
      const f60 = (R.hp60f || []).find(x => x.ms === ms);
      const fKp = f60 ? null : inSlot(R.hpoKp || [], ms, 3 * H);
      const gfzMed = f60 ? f60.median : (fKp ? fKp.median : null);
      const gfzMax = f60 ? f60.max : (fKp ? fKp.max : null);
      const n = inSlot(R.kpF || [], ms, 3 * H);
      const noaa = n ? n.kp : null;
      let kp;
      if (past && measured !== null) kp = measured;
      else if (gfzMed !== null && noaa !== null) kp = 0.6 * Math.min(9, gfzMed) + 0.4 * noaa;
      else kp = gfzMed !== null ? Math.min(9, gfzMed) : (noaa ?? measured);
      out.push({ ms, past, measured, gfzMed, gfzMax, noaa, kp: kp === undefined ? null : kp, gfzHourly: !!f60 });
    }
    return out;
  }

  // Trend aus einer Reihe {ms, v}: Steigung je Stunde per linearer Regression
  function trendOf(points, threshold) {
    const p = points.filter(x => x.v !== null && x.v !== undefined && isFinite(x.v));
    if (p.length < 3) return { dir: "unbekannt", slope: null };
    const t0 = p[0].ms, xs = p.map(x => (x.ms - t0) / 3600000), ys = p.map(x => x.v);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) * (x - mx); });
    const slope = den ? num / den : 0;
    return { dir: slope > threshold ? "steigt" : slope < -threshold ? "fällt" : "stabil", slope };
  }

  function score(q) { return clamp(Math.round(1 + 9 * clamp(q, 0, 1)), 1, 10); }

  const api = {
    URLS, toMs, rows, magLat, kpNeeded, activityFromKp,
    parseKpForecast, parseKpNow, parseGfzCsv, parseGfzKp, parseGfzHp30, parseGfzHp60, parseHpo, isFresh, parse27,
    activityTimeline, trendOf, parseMag, parseWind, ovationAt,
    solarWindSummary, bzWords, bzClass, southwardMinutes, sourceRole, speedWords, darkFactor, skyFactor, kpAt, score
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AuroraCore = api;
})(typeof window !== "undefined" ? window : globalThis);
