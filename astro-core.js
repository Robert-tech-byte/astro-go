/* Astro-Go: Kernlogik (Sonne/Mond, Modellabfrage, Bewertung 1–10).
   Läuft im Browser (window.AstroCore) und in Node (module.exports) zum Testen. */
(function (root) {
  "use strict";

  /* ---------- Sonne & Mond (Standardformeln nach Meeus, vereinfacht) ---------- */
  const RAD = Math.PI / 180;
  const OBL = RAD * 23.4397; // Schiefe der Ekliptik

  function toDays(ms) { return ms / 86400000 - 0.5 + 2440588 - 2451545; }
  function rightAsc(l, b) { return Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l)); }
  function declination(l, b) { return Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l)); }
  function altitude(H, phi, dec) { return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)); }
  function sidereal(d, lw) { return RAD * (280.16 + 360.9856235 * d) - lw; }

  function sunCoords(d) {
    const M = RAD * (357.5291 + 0.98560028 * d);
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + RAD * 102.9372 + Math.PI;
    return { dec: declination(L, 0), ra: rightAsc(L, 0) };
  }
  function moonCoords(d) {
    const L = RAD * (218.316 + 13.176396 * d);
    const M = RAD * (134.963 + 13.064993 * d);
    const F = RAD * (93.272 + 13.22935 * d);
    const l = L + RAD * 6.289 * Math.sin(M);
    const b = RAD * 5.128 * Math.sin(F);
    return { ra: rightAsc(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
  }
  function sunAltitude(ms, lat, lon) {
    const d = toDays(ms), lw = RAD * -lon, phi = RAD * lat, c = sunCoords(d);
    return altitude(sidereal(d, lw) - c.ra, phi, c.dec) / RAD;
  }
  function moonAltitude(ms, lat, lon) {
    const d = toDays(ms), lw = RAD * -lon, phi = RAD * lat, c = moonCoords(d);
    return altitude(sidereal(d, lw) - c.ra, phi, c.dec) / RAD;
  }
  function moonIllumination(ms) {
    const d = toDays(ms), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    return (1 + Math.cos(inc)) / 2;
  }

  /* ---------- Modelle ---------- */
  // weight: Gewicht im Konsens; hours: Reichweite, in der das Modell zählt
  // box: [latMin, latMax, lonMin, lonMax] – grobes Modellgebiet; liefert ein Modell trotzdem keine Daten, fällt es weg.
  // Bei den "seamless"-Varianten zählt nur der hochauflösende Anfang (hours), danach steckt dort ECMWF bzw. ein globales Modell drin.
  const BASE_MODELS = [
    { id: "ecmwf_ifs025", label: "ECMWF IFS", note: "0,25°, bis 10 Tage", weight: 1.2, hours: 240 },
    { id: "icon_eu", label: "ICON-EU", note: "DWD, 7 km, bis 5 Tage", weight: 1.1, hours: 120, box: [29.5, 70.5, -23.5, 62.5] },
    { id: "dwd_icon_global", label: "ICON Global", note: "DWD, 11 km, bis 7 Tage", weight: 1.0, hours: 180, outsideOf: "icon_eu" }
  ];
  // id: konkretes Modell (liefert außerhalb seines Gebiets keine Daten und fällt dann weg).
  // fallback: bestätigte "seamless"-Kennung, falls Open-Meteo die konkrete Kennung nicht kennt;
  // dann zählt das Modell nur innerhalb des Rechtecks (box) und seiner Reichweite (hours).
  const REGIONAL_MODELS = [
    { id: "metno_nordic", label: "MET Nordic", note: "1 km, bis 60 h", weight: 2.0, hours: 60, box: [53, 72, 0, 33] },
    { id: "dwd_icon_d2", fallback: "icon_d2", label: "ICON-D2", note: "DWD, 2 km, bis 48 h", weight: 1.8, hours: 48, box: [43.2, 58.1, -3.9, 20.3] },
    { id: "meteoswiss_icon_ch1", fallback: "meteoswiss_icon_seamless", label: "ICON-CH1", note: "MeteoSchweiz, 1 km, bis 33 h", weight: 1.4, hours: 33, box: [42.5, 50, 0, 17] },
    { id: "meteoswiss_icon_ch2", label: "ICON-CH2", note: "MeteoSchweiz, 2 km, bis 120 h", weight: 1.3, hours: 120, box: [42.5, 50, 0, 17] },
    { id: "meteofrance_arome_france_hd", label: "AROME France HD", note: "Météo-France, 1,5 km, bis 42 h", weight: 1.4, hours: 42, box: [37.5, 55.4, -12, 16] },
    { id: "meteofrance_arome_france", fallback: "meteofrance_seamless", label: "AROME France", note: "Météo-France, 2,5 km, bis 42 h", weight: 1.2, hours: 42, box: [37.5, 55.4, -12, 16] },
    { id: "italia_meteo_arpae_icon_2i", label: "ICON 2I", note: "ItaliaMeteo, 2 km, bis 72 h", weight: 1.8, hours: 72, box: [34, 50, 3, 22] },
    { id: "ukmo_uk_deterministic_2km", fallback: "ukmo_seamless", label: "UK Met Office 2 km", note: "UKV, bis 48 h", weight: 1.8, hours: 48, box: [48, 62, -12, 5] },
    { id: "knmi_harmonie_arome_netherlands", fallback: "knmi_seamless", label: "KNMI Harmonie NL", note: "2 km, bis 60 h", weight: 1.7, hours: 60, box: [49.5, 54, 2, 7.5] },
    { id: "knmi_harmonie_arome_europe", label: "KNMI Harmonie Europa", note: "5,5 km, bis 60 h", weight: 1.3, hours: 60, box: [39, 70, -25, 40] },
    { id: "dmi_harmonie_arome_europe", fallback: "dmi_seamless", label: "DMI Harmonie", note: "2 km, bis 60 h", weight: 1.7, hours: 60, box: [48, 66, -25, 20] },
    // außerhalb Europas
    { id: "gem_hrdps_continental", fallback: "gem_seamless", label: "GEM HRDPS", note: "Kanada, 2,5 km, bis 48 h", weight: 1.7, hours: 48, box: [35, 70, -150, -50] },
    { id: "ncep_hrrr_conus", label: "HRRR", note: "USA, 3 km, bis 48 h", weight: 1.6, hours: 48, box: [21, 53, -135, -60] },
    { id: "jma_msm", label: "JMA MSM", note: "Japan, 5 km, bis 78 h", weight: 1.6, hours: 78, box: [22, 48, 120, 150] },
    { id: "kma_ldps", label: "KMA LDPS", note: "Korea, 1,5 km, bis 48 h", weight: 1.7, hours: 48, box: [32, 43, 122, 132] }
  ];
  const inBox = (b, lat, lon) => !b || (lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3]);
  // Modelle für einen Ort: ECMWF + ICON-EU (außerhalb Europas ICON Global) + Regionalmodelle, deren Gebiet den Ort enthält
  function modelsFor(lat, lon) {
    const eu = inBox(BASE_MODELS[1].box, lat, lon);
    const base = BASE_MODELS.filter(m => m.id === "ecmwf_ifs025" || (m.id === "icon_eu" ? eu : !eu));
    return base.concat(REGIONAL_MODELS.filter(m => inBox(m.box, lat, lon)).map(m => ({ ...m, regional: true })));
  }
  const MODELS = BASE_MODELS.concat(REGIONAL_MODELS);
  const SURFACE_VARS = ["cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
    "temperature_2m", "dew_point_2m", "wind_gusts_10m", "precipitation", "visibility"];
  const JET_VARS = ["wind_speed_200hPa", "wind_speed_250hPa", "wind_speed_300hPa"];

  function forecastUrl(lat, lon, modelId, vars, days) {
    const p = new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4),
      hourly: vars.join(","), models: modelId,
      timezone: "auto", timeformat: "unixtime", forecast_days: String(days)
    });
    return "https://api.open-meteo.com/v1/forecast?" + p.toString();
  }

  // Liest eine Variable; akzeptiert auch den Schlüssel mit Modell-Suffix.
  function series(hourly, name, modelId) {
    if (!hourly) return null;
    return hourly[name] || hourly[name + "_" + modelId] || null;
  }

  // Wandelt eine Modellantwort in {time(ms) -> Werte}
  function parseModel(json, modelId) {
    const h = json && json.hourly;
    if (!h || !h.time) return null;
    const get = n => series(h, n, modelId);
    const total = get("cloud_cover"), low = get("cloud_cover_low"), mid = get("cloud_cover_mid"), high = get("cloud_cover_high");
    const T = get("temperature_2m"), Td = get("dew_point_2m"), gust = get("wind_gusts_10m");
    const pr = get("precipitation"), vis = get("visibility");
    const out = new Map();
    let useful = 0;
    h.time.forEach((t, i) => {
      const v = {
        total: val(total, i), low: val(low, i), mid: val(mid, i), high: val(high, i),
        T: val(T, i), Td: val(Td, i), gust: val(gust, i), precip: val(pr, i), vis: val(vis, i)
      };
      v.cloud = effectiveCloud(v);
      if (v.cloud !== null) useful++;
      out.set(t * 1000, v);
    });
    return useful > 0 ? { map: out, tz: json.timezone, offset: json.utc_offset_seconds } : null;
  }
  function val(arr, i) { return arr && arr[i] !== null && arr[i] !== undefined ? arr[i] : null; }

  // Effektive Bedeckung in %: tiefe und mittlere Wolken blockieren voll,
  // hohe (oft dünne Cirren) zu 70 %. Zufällige Überlappung der Schichten.
  function effectiveCloud(v) {
    if (v.low !== null || v.mid !== null || v.high !== null) {
      const l = (v.low || 0) / 100, m = (v.mid || 0) / 100, h = (v.high || 0) / 100;
      return 100 * (1 - (1 - l) * (1 - m) * (1 - 0.7 * h));
    }
    return v.total;
  }

  /* ---------- Bewertung ---------- */
  const TARGETS = {
    nebula: { label: "Nebel mit Filter", moonWeight: 0.35 },
    broadband: { label: "Galaxien & Sternhaufen", moonWeight: 0.8 }
  };

  function weightedStats(values) {
    // values: [{v, w}]
    const sw = values.reduce((a, x) => a + x.w, 0);
    if (!sw) return null;
    const mean = values.reduce((a, x) => a + x.v * x.w, 0) / sw;
    const min = Math.min(...values.map(x => x.v)), max = Math.max(...values.map(x => x.v));
    return { mean, min, max, spread: max - min, n: values.length };
  }

  // Bewertet eine Stunde. models: [{model, data(Map)}], jet: Map|null
  function scoreHour(ms, lat, lon, models, jet, startMs, target) {
    const sun = sunAltitude(ms, lat, lon);
    const moonAlt = moonAltitude(ms, lat, lon);
    const illum = moonIllumination(ms);
    const leadH = (ms - startMs) / 3600000;

    const perModel = [];
    const clouds = [], Ts = [], Tds = [], gusts = [], precs = [], viss = [];
    for (const { model, data } of models) {
      const v = data.get(ms);
      if (!v || v.cloud === null) continue;
      if (leadH > model.hours) continue;
      perModel.push({ id: model.id, label: model.label, cloud: v.cloud, low: v.low, mid: v.mid, high: v.high });
      clouds.push({ v: v.cloud, w: model.weight });
      if (v.T !== null) Ts.push({ v: v.T, w: model.weight });
      if (v.Td !== null) Tds.push({ v: v.Td, w: model.weight });
      if (v.gust !== null) gusts.push({ v: v.gust, w: model.weight });
      if (v.precip !== null) precs.push({ v: v.precip, w: model.weight });
      if (v.vis !== null) viss.push({ v: v.vis, w: model.weight });
    }
    const c = weightedStats(clouds);
    if (!c) return null;

    const T = weightedStats(Ts), Td = weightedStats(Tds), G = weightedStats(gusts), P = weightedStats(precs), V = weightedStats(viss);
    const layer = name => {
      const arr = perModel.filter(m => m[name] !== null && m[name] !== undefined);
      return arr.length ? arr.reduce((a, m) => a + m[name], 0) / arr.length : null;
    };

    // Faktoren 0..1 (1 = kein Einfluss)
    const f = {};
    // Dunkelheit
    if (sun > -6) f.dark = 0;
    else if (sun > -12) f.dark = 0.35 + 0.35 * ((-6 - sun) / 6);   // nautische Dämmerung: 0,35–0,70
    else if (sun > -18) f.dark = 0.7 + 0.3 * ((-12 - sun) / 6);    // astronomische Dämmerung: 0,70–1,0
    else f.dark = 1;
    // Wolken
    f.cloud = Math.pow(1 - c.mean / 100, 1.5);
    // Mond
    const moonUp = moonAlt > 0;
    const moonHeight = moonUp ? 0.5 + 0.5 * Math.min(moonAlt, 30) / 30 : 0;
    f.moon = 1 - TARGETS[target].moonWeight * illum * moonHeight;
    // Niederschlag
    f.rain = P && P.mean >= 0.2 ? 0 : (P && P.mean >= 0.05 ? 0.5 : 1);
    // Nebel / Dunst
    f.fog = V && V.mean < 1000 ? 0.2 : (V && V.mean < 5000 ? 0.7 : 1);
    // Tau
    const gap = T && Td ? T.mean - Td.mean : null;
    f.dew = gap === null ? 1 : gap < 1 ? 0.8 : gap < 2 ? 0.9 : 1;
    // Wind (Seestar ist leicht, Böen verwackeln Einzelbilder)
    const g = G ? G.mean : null;
    f.wind = g === null ? 1 : g > 40 ? 0.5 : g > 30 ? 0.7 : g > 20 ? 0.88 : 1;
    // Seeing (grob über Jetstream; für 2,4"/px kaum relevant)
    let jetSpeed = null;
    if (jet && jet.get(ms)) jetSpeed = jet.get(ms);
    f.seeing = jetSpeed === null ? 1 : jetSpeed > 150 ? 0.9 : jetSpeed > 100 ? 0.95 : 1;

    const q = Object.values(f).reduce((a, x) => a * x, 1);
    const score = Math.max(1, Math.min(10, Math.round(1 + 9 * q)));

    return {
      ms, score, q, f, sun, moonAlt, illum, moonUp,
      cloud: c.mean, cloudMin: c.min, cloudMax: c.max, spread: c.spread, nModels: c.n,
      low: layer("low"), mid: layer("mid"), high: layer("high"),
      gap, gust: g, precip: P ? P.mean : null, vis: V ? V.mean : null, jet: jetSpeed,
      perModel
    };
  }

  // Gruppiert Stunden zu Nächten: von 15 Uhr bis 11 Uhr Ortszeit, nur Stunden mit Sonne < -6°
  function groupNights(hours, offsetSec) {
    const nights = new Map();
    for (const h of hours) {
      if (!h || h.sun > -6) continue;
      const local = new Date(h.ms + offsetSec * 1000);
      let y = local.getUTCFullYear(), mo = local.getUTCMonth(), d = local.getUTCDate();
      const hr = local.getUTCHours();
      if (hr < 15) { const prev = new Date(Date.UTC(y, mo, d - 1)); y = prev.getUTCFullYear(); mo = prev.getUTCMonth(); d = prev.getUTCDate(); }
      const key = Date.UTC(y, mo, d);
      if (!nights.has(key)) nights.set(key, []);
      nights.get(key).push(h);
    }
    return [...nights.entries()].sort((a, b) => a[0] - b[0]).map(([key, hrs]) => ({ dateKey: key, hours: hrs }));
  }

  // Bewertet eine Nacht: Note = Mittel der besten 3 aufeinanderfolgenden Stunden
  function scoreNight(night) {
    const hrs = night.hours;
    const L = Math.min(3, hrs.length);
    let best = -1, bestIdx = 0;
    for (let i = 0; i + L <= hrs.length; i++) {
      const m = hrs.slice(i, i + L).reduce((a, h) => a + h.q, 0) / L;
      if (m > best) { best = m; bestIdx = i; }
    }
    const block = hrs.slice(bestIdx, bestIdx + L);
    const score = Math.max(1, Math.min(10, Math.round(1 + 9 * best)));

    // Bestes Fenster: zusammenhängende Stunden mit Note >= 6 um den besten Block
    let win = null;
    const good = h => h.score >= 6;
    let s = -1;
    for (let i = 0; i < hrs.length; i++) {
      if (good(hrs[i])) { if (s < 0) s = i; }
      if ((!good(hrs[i]) || i === hrs.length - 1) && s >= 0) {
        const e = good(hrs[i]) ? i : i - 1;
        const run = { start: hrs[s].ms, end: hrs[e].ms + 3600000, len: e - s + 1, avg: hrs.slice(s, e + 1).reduce((a, h) => a + h.q, 0) / (e - s + 1) };
        if (!win || run.len * run.avg > win.len * win.avg) win = run;
        s = -1;
      }
    }
    return { score, block, window: win };
  }

  /* ---------- Erklärungstext ---------- */
  function fmtH(ms, offsetSec) {
    const d = new Date(ms + offsetSec * 1000);
    return String(d.getUTCHours()).padStart(2, "0") + " Uhr";
  }
  function avg(arr, k) {
    const v = arr.map(x => x[k]).filter(x => x !== null && x !== undefined);
    return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
  }

  function describeNight(nightScore, offsetSec) {
    const { block, window: win } = nightScore;
    const parts = [];

    // Fenster
    if (win) parts.push(`Bestes Fenster ${fmtH(win.start, offsetSec)} bis ${fmtH(win.end, offsetSec)}`);
    else parts.push("Kein Zeitraum mit Note 6 oder besser");

    // Begrenzende Faktoren im besten Block
    const loss = k => 1 - block.reduce((a, h) => a + h.f[k], 0) / block.length;
    const cl = avg(block, "cloud");
    const reasons = [];
    if (loss("rain") > 0.2) reasons.push({ w: loss("rain"), t: "Niederschlag erwartet" });
    if (loss("cloud") > 0.15) {
      const lo = avg(block, "low"), mi = avg(block, "mid"), hi = avg(block, "high");
      const layers = [["tiefe", lo], ["mittelhohe", mi], ["hohe", hi]].filter(x => x[1] !== null).sort((a, b) => b[1] - a[1]);
      const which = layers.length && layers[0][1] > 20 ? `, vor allem ${layers[0][0]} Wolken` : "";
      reasons.push({ w: loss("cloud"), t: `Bewölkung um ${Math.round(cl)} %${which}` });
    }
    if (loss("fog") > 0.15) reasons.push({ w: loss("fog"), t: "Nebel- oder Dunstgefahr" });
    if (loss("moon") > 0.12) {
      const up = block.filter(h => h.moonUp);
      const ill = Math.round(avg(block, "illum") * 100);
      reasons.push({ w: loss("moon"), t: `Mond zu ${ill} % beleuchtet und ${up.length === block.length ? "die ganze Zeit" : "zeitweise"} über dem Horizont` });
    }
    if (loss("dark") > 0.12) reasons.push({ w: loss("dark"), t: "nur Dämmerung, keine volle Dunkelheit" });
    if (loss("wind") > 0.1) reasons.push({ w: loss("wind"), t: `Böen bis ${Math.round(Math.max(...block.map(h => h.gust || 0)))} km/h` });
    if (loss("dew") > 0.08) reasons.push({ w: loss("dew"), t: "Taugefahr (Taupunkt sehr nah)" });
    reasons.sort((a, b) => b.w - a.w);

    // Modellübereinstimmung
    const spread = avg(block, "spread"), n = Math.round(avg(block, "nModels"));
    let agree;
    if (n <= 1) agree = "nur ein Modell verfügbar";
    else if (spread < 20) agree = `${n} Modelle einig`;
    else if (spread < 45) agree = `${n} Modelle weitgehend einig`;
    else agree = `${n} Modelle uneinig (${Math.round(Math.min(...block.map(h => h.cloudMin)))}–${Math.round(Math.max(...block.map(h => h.cloudMax)))} % Bewölkung)`;

    let text;
    if (!reasons.length) text = `Klarer, dunkler Himmel; ${agree}.`;
    else text = reasons.slice(0, 2).map(r => r.t).join("; ") + `; ${agree}.`;
    text = text.charAt(0).toUpperCase() + text.slice(1);

    const confidence = n <= 1 ? "niedrig" : spread >= 45 ? "niedrig" : spread >= 20 ? "mittel" : "hoch";
    return { headline: parts[0], text, confidence, agreeText: agree };
  }

  const api = {
    MODELS, BASE_MODELS, REGIONAL_MODELS, modelsFor, SURFACE_VARS, JET_VARS, TARGETS,
    sunAltitude, moonAltitude, moonIllumination,
    forecastUrl, parseModel, effectiveCloud, scoreHour, groupNights, scoreNight, describeNight, fmtH
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AstroCore = api;
})(typeof window !== "undefined" ? window : globalThis);
