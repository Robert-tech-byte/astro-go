// Astro-Go: Zwischendienst für GFZ-Daten (Cloudflare Worker)
//
// Warum: Die GFZ-Server erlauben keinen Abruf direkt aus dem Browser (CORS).
// Dieser Worker holt die Daten beim GFZ ab und gibt sie mit der nötigen
// Browser-Erlaubnis an die Astro-Go-Seite weiter.
//
// Sicherheit: Er ruft nur die unten fest eingetragenen GFZ-Adressen ab.
// Andere Ziele lassen sich darüber nicht abrufen.
// Jede Antwort wird 5 Minuten zwischengespeichert, um GFZ und das
// Gratis-Kontingent zu schonen.

const ALLOWED_ORIGINS = ["https://robert-tech-byte.github.io"];
const CACHE_SECONDS = 300;

const HPO = "https://isdc-data.gfz.de/geomagnetism/HpoForecast/v0102/output/Hpo/json/";
const iso = ms => new Date(ms).toISOString().slice(0, 19) + "Z";

// Pfad -> GFZ-Adresse. Zeiträume für gemessene Werte bestimmt der Worker selbst
// (auf 10 Minuten gerundet), damit der Zwischenspeicher greift.
function target(path, now) {
  const end = Math.floor(now / 600000) * 600000;
  switch (path) {
    case "/hpo-kp": return HPO + "hpo_forecast_mean_bars_Kp.json";
    case "/hpo-hp30": return HPO + "hpo_forecast_mean_bars_Hp30.json";
    case "/hpo-hp60": return HPO + "hpo_forecast_mean_bars_Hp60.json";
    case "/swift": return "https://spaceweather.gfz.de/fileadmin/Kp-Forecast/CSV/kp_product_file_FORECAST_PAGER_SWIFT_LAST.csv";
    case "/kp": return `https://kp.gfz.de/app/json/?start=${iso(end - 2 * 86400000)}&end=${iso(end)}&index=Kp`;
    case "/hp30": return `https://kp.gfz.de/app/json/?start=${iso(end - 86400000)}&end=${iso(end)}&index=Hp30`;
    default: return null;
  }
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Expose-Headers": "X-Upstream-Date",
    "Vary": "Origin"
  };
}

export default {
  async fetch(request) {
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response("Nur GET erlaubt", { status: 405, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/status") {
      return new Response(JSON.stringify({ ok: true, paths: ["/hpo-kp", "/hpo-hp30", "/hpo-hp60", "/swift", "/kp", "/hp30"] }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }
    const t = target(url.pathname, Date.now());
    if (!t) return new Response("Unbekannter Pfad", { status: 404, headers: cors });

    let up;
    try {
      up = await fetch(t, {
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
        headers: { "User-Agent": "astro-go (github.com/Robert-tech-byte/astro-go)" }
      });
    } catch (e) {
      return new Response("GFZ nicht erreichbar", { status: 502, headers: cors });
    }
    const h = new Headers(cors);
    h.set("Content-Type", up.headers.get("Content-Type") || (t.endsWith(".csv") ? "text/csv" : "application/json"));
    h.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    h.set("X-Upstream-Date", up.headers.get("Date") || new Date().toUTCString());
    return new Response(up.body, { status: up.status, headers: h });
  }
};
