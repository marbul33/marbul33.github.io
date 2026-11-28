/**
 * Cloudflare Worker — Contador privado y minimalista de visitas (D1)
 * --------------------------------------------------------------------------
 * - POST /p : Registra una visita (sin cookies, IP hasheada con sal secreta).
 * - GET  /  : Panel privado (requiere ?k=VIEW_TOKEN o Authorization: Bearer).
 */

const BOT_REGEX =
  /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|whatsapp|telegram|discord|slack|headless|phantom|puppeteer|playwright|lighthouse|pagespeed|curl|wget|python|go-http|java\/|node-fetch|axios|postman|insomnia|uptimerobot|pingdom|ahrefs|semrush|mj12bot|dotbot|petalbot|yandex|baiduspider|bingpreview|duckduckbot|applebot/i;

const MOBILE_REGEX = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;

function getAllowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function buildCorsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${ip}:${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function normalizePath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) return "/";
  let p = rawPath.split("?")[0].split("#")[0].trim();
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/index\.html$/i, "/").replace(/\/{2,}/g, "/");
  return p.slice(0, 120) || "/";
}

function normalizeReferrer(rawRef, originHost) {
  if (typeof rawRef !== "string" || !rawRef.trim()) return "Directo";
  try {
    const u = new URL(rawRef);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "Directo";
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || host === originHost) return "Directo";
    return host.slice(0, 100);
  } catch {
    return "Directo";
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function countryName(code) {
  if (!code || code === "XX") return "Desconocido";
  try {
    const dn = new Intl.DisplayNames(["es"], { type: "region" });
    return `${dn.of(code)} (${code})`;
  } catch {
    return code;
  }
}

function isoDateOffset(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

async function handlePing(request, env) {
  const origin = (request.headers.get("Origin") || "").replace(/\/$/, "");
  const allowed = getAllowedOrigins(env);

  if (!origin || !allowed.includes(origin)) {
    return new Response(null, { status: 403 });
  }

  const cors = buildCorsHeaders(origin);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const ua = request.headers.get("User-Agent") || "";
  if (!ua || BOT_REGEX.test(ua)) {
    return new Response(null, { status: 204, headers: cors });
  }

  let payload = {};
  try {
    const text = await request.text();
    if (text && text.length <= 2048) {
      payload = JSON.parse(text);
    }
  } catch {
    payload = {};
  }

  let originHost = "";
  try {
    originHost = new URL(origin).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    originHost = "";
  }

  const now = Math.floor(Date.now() / 1000);
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const ipHash = await hashIp(ip, env.IP_SALT || "mbs-default-salt");
  const country = (request.cf && request.cf.country) || "XX";
  const path = normalizePath(payload.p);
  const referrer = normalizeReferrer(payload.r, originHost);
  const device = MOBILE_REGEX.test(ua) ? "mobile" : "desktop";

  await env.DB.prepare(
    "INSERT INTO visits (ts, day, ip_hash, country, path, referrer, device) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(now, day, ipHash, country, path, referrer, device)
    .run();

  return new Response(null, { status: 204, headers: cors });
}

function renderDashboard(data) {
  const s = data.summary;
  const maxCountry = Math.max(1, ...data.countries.map((c) => c.unique_ips));
  const maxDay = Math.max(1, ...data.days.map((d) => d.views));

  const countryRows = data.countries.length
    ? data.countries
        .map((c) => {
          const pct = Math.round((c.unique_ips / maxCountry) * 100);
          return `<tr>
            <td>${escapeHtml(countryName(c.country))}</td>
            <td class="num"><strong>${c.unique_ips}</strong></td>
            <td class="num muted">${c.views}</td>
            <td class="bar-cell"><div class="bar" style="width:${pct}%"></div></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="muted">Sin visitas todavía</td></tr>`;

  const pathRows = data.paths.length
    ? data.paths
        .map(
          (p) => `<tr>
            <td class="mono">${escapeHtml(p.path)}</td>
            <td class="num">${p.unique_ips}</td>
            <td class="num">${p.views}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="3" class="muted">Sin datos</td></tr>`;

  const refRows = data.referrers.length
    ? data.referrers
        .map(
          (r) => `<tr>
            <td>${escapeHtml(r.referrer)}</td>
            <td class="num">${r.unique_ips}</td>
            <td class="num">${r.views}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="3" class="muted">Sin datos</td></tr>`;

  const deviceSummary = data.devices.length
    ? data.devices
        .map(
          (d) =>
            `<span class="pill">${d.device === "mobile" ? "Móvil" : "Escritorio"}: <strong>${d.unique_ips}</strong> IPs (${d.views})</span>`
        )
        .join("")
    : `<span class="muted">Sin datos</span>`;

  const dayBars = data.days.length
    ? data.days
        .map((d) => {
          const h = Math.max(4, Math.round((d.views / maxDay) * 100));
          return `<div class="col" title="${escapeHtml(d.day)} — ${d.unique_ips} IPs únicas / ${d.views} visitas">
            <div class="col-bar" style="height:${h}%"></div>
            <span class="col-lbl">${escapeHtml(d.day.slice(5))}</span>
          </div>`;
        })
        .join("")
    : `<p class="muted">Aún no hay actividad en los últimos 30 días.</p>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Panel de Visitas</title>
<style>
  :root { --bg:#0d1117; --card:#161b22; --border:#30363d; --text:#e6edf3; --muted:#8b949e; --accent:#58a6ff; }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:960px; margin:0 auto; }
  header { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:20px; gap:12px; flex-wrap:wrap; }
  h1 { margin:0; font-size:20px; font-weight:600; }
  h2 { margin:0 0 12px; font-size:14px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:20px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px; }
  .kpi-val { font-size:28px; font-weight:700; line-height:1.1; }
  .kpi-lbl { font-size:12px; color:var(--muted); margin-top:4px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; margin-top:16px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:7px 6px; border-bottom:1px solid #21262d; }
  th { font-size:12px; color:var(--muted); font-weight:500; }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .muted { color:var(--muted); }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
  .bar-cell { width:28%; }
  .bar { height:7px; border-radius:4px; background:var(--accent); }
  .chart { display:flex; align-items:flex-end; gap:6px; height:120px; padding-top:8px; overflow-x:auto; }
  .col { flex:1; min-width:22px; display:flex; flex-direction:column; align-items:center; height:100%; justify-content:flex-end; gap:4px; }
  .col-bar { width:100%; max-width:24px; background:var(--accent); border-radius:3px 3px 0 0; }
  .col-lbl { font-size:10px; color:var(--muted); }
  .pills { display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
  .pill { background:#0d1117; border:1px solid var(--border); border-radius:999px; padding:4px 12px; font-size:12.5px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Visitas — marbul33.github.io</h1>
    <span class="muted">Actualizado (UTC): ${escapeHtml(data.generatedAt)}</span>
  </header>

  <section class="kpis">
    <div class="card"><div class="kpi-val">${s.unique_ips || 0}</div><div class="kpi-lbl">IPs únicas totales</div></div>
    <div class="card"><div class="kpi-val">${s.total_views || 0}</div><div class="kpi-lbl">Visitas totales</div></div>
    <div class="card"><div class="kpi-val">${s.today_ips || 0} <span class="muted" style="font-size:15px;font-weight:400">/ ${s.today_views || 0}</span></div><div class="kpi-lbl">Hoy (IPs / visitas)</div></div>
    <div class="card"><div class="kpi-val">${s.week_ips || 0} <span class="muted" style="font-size:15px;font-weight:400">/ ${s.week_views || 0}</span></div><div class="kpi-lbl">Últimos 7 días (IPs / visitas)</div></div>
  </section>

  <section class="card" style="margin-bottom:16px">
    <h2>IPs únicas por país</h2>
    <table>
      <thead><tr><th>País</th><th class="num">IPs únicas</th><th class="num">Visitas</th><th></th></tr></thead>
      <tbody>${countryRows}</tbody>
    </table>
    <div class="pills">${deviceSummary}</div>
  </section>

  <section class="card">
    <h2>Actividad diaria (últimos 30 días)</h2>
    <div class="chart">${dayBars}</div>
  </section>

  <div class="grid">
    <section class="card">
      <h2>Páginas vistas</h2>
      <table>
        <thead><tr><th>Ruta</th><th class="num">IPs</th><th class="num">Visitas</th></tr></thead>
        <tbody>${pathRows}</tbody>
      </table>
    </section>

    <section class="card">
      <h2>Origen (Referrer)</h2>
      <table>
        <thead><tr><th>Fuente</th><th class="num">IPs</th><th class="num">Visitas</th></tr></thead>
        <tbody>${refRows}</tbody>
      </table>
    </section>
  </div>
</div>
</body>
</html>`;
}

async function handleStats(request, env) {
  const url = new URL(request.url);
  const authHeader = request.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const token = url.searchParams.get("k") || bearer;

  if (!env.VIEW_TOKEN || !timingSafeEqual(token, env.VIEW_TOKEN)) {
    return new Response("Not Found", { status: 404 });
  }

  const today = isoDateOffset(0);
  const weekAgo = isoDateOffset(6);
  const monthAgo = isoDateOffset(29);

  const [summaryRes, countriesRes, pathsRes, referrersRes, daysRes, devicesRes] =
    await env.DB.batch([
      env.DB.prepare(
        `SELECT
           COUNT(*) AS total_views,
           COUNT(DISTINCT ip_hash) AS unique_ips,
           SUM(CASE WHEN day = ? THEN 1 ELSE 0 END) AS today_views,
           COUNT(DISTINCT CASE WHEN day = ? THEN ip_hash END) AS today_ips,
           SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END) AS week_views,
           COUNT(DISTINCT CASE WHEN day >= ? THEN ip_hash END) AS week_ips
         FROM visits`
      ).bind(today, today, weekAgo, weekAgo),
      env.DB.prepare(
        `SELECT country, COUNT(DISTINCT ip_hash) AS unique_ips, COUNT(*) AS views
         FROM visits
         GROUP BY country
         ORDER BY unique_ips DESC, views DESC
         LIMIT 30`
      ),
      env.DB.prepare(
        `SELECT path, COUNT(DISTINCT ip_hash) AS unique_ips, COUNT(*) AS views
         FROM visits
         GROUP BY path
         ORDER BY views DESC
         LIMIT 20`
      ),
      env.DB.prepare(
        `SELECT referrer, COUNT(DISTINCT ip_hash) AS unique_ips, COUNT(*) AS views
         FROM visits
         GROUP BY referrer
         ORDER BY views DESC
         LIMIT 15`
      ),
      env.DB.prepare(
        `SELECT day, COUNT(DISTINCT ip_hash) AS unique_ips, COUNT(*) AS views
         FROM visits
         WHERE day >= ?
         GROUP BY day
         ORDER BY day ASC`
      ).bind(monthAgo),
      env.DB.prepare(
        `SELECT device, COUNT(DISTINCT ip_hash) AS unique_ips, COUNT(*) AS views
         FROM visits
         GROUP BY device
         ORDER BY views DESC`
      ),
    ]);

  const data = {
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 16),
    summary: summaryRes.results[0] || {},
    countries: countriesRes.results || [],
    paths: pathsRes.results || [],
    referrers: referrersRes.results || [],
    days: daysRes.results || [],
    devices: devicesRes.results || [],
  };

  if (url.searchParams.get("format") === "json") {
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  return new Response(renderDashboard(data), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/p" && (request.method === "POST" || request.method === "OPTIONS")) {
      return handlePing(request, env);
    }

    if (url.pathname === "/" && request.method === "GET") {
      return handleStats(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
