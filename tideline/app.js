"use strict";
const HOUR = 3600e3, DAY = 86400e3, MIN = 60e3;
const NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const STATIONS_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
const APP = "tideline_pwa";
const $ = id => document.getElementById(id);

// ---------- storage (best effort) ----------
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch { // quota: drop cached tide months, then retry once
      try { Object.keys(localStorage).filter(x => x.startsWith("tide:")).forEach(x => localStorage.removeItem(x)); localStorage.setItem(k, JSON.stringify(v)); } catch {}
    }
  }
};

// ---------- stations ----------
const DEFAULT_STATION = { id: "9410230", name: "La Jolla", state: "CA", lat: 32.86689, lng: -117.25714, tzc: -8, type: "R" };
function ianaFor(st) {
  const s = st.state, c = st.tzc;
  if (c === -8) return "America/Los_Angeles";
  if (c === -9) return "America/Anchorage";
  if (c === -10) return s === "AK" ? "America/Adak" : "Pacific/Honolulu";
  if (c === -7) return "America/Denver";
  if (c === -6) return "America/Chicago";
  if (c === -5) return "America/New_York";
  if (c === -4) return "America/Puerto_Rico";
  if (c === -11) return "Pacific/Pago_Pago";
  if (c === 10) return "Pacific/Guam";
  if (Number.isInteger(c) && Math.abs(c) <= 12) return "Etc/GMT" + (c <= 0 ? "+" : "-") + Math.abs(c);
  return "UTC";
}
let stations = store.get("stations:v1")?.list || null;
async function loadStations() {
  const cached = store.get("stations:v1");
  if (cached && Date.now() - cached.at < 30 * DAY) { stations = cached.list; return stations; }
  const r = await fetch(STATIONS_URL); if (!r.ok) throw new Error("Station list unavailable");
  const j = await r.json();
  stations = j.stations.filter(s => s.lat && s.lng).map(s => ({ id: s.id, name: s.name, state: s.state || "", lat: +s.lat, lng: +s.lng, tzc: +s.timezonecorr, type: s.type || "R" }));
  store.set("stations:v1", { at: Date.now(), list: stations });
  return stations;
}
let station = store.get("station:last") || DEFAULT_STATION;
let TZ = ianaFor(station);
let favs = store.get("favs", []);

// ---------- time helpers in station time zone ----------
let fmtTime, fmtDate, fmtDay, fmtParts, fmtISO;
function setFormatters() {
  fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  fmtDate = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
  fmtDay = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
  fmtParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  midCache.clear();
}
const midCache = new Map();
function parts(t) { const o = {}; for (const p of fmtParts.formatToParts(t)) o[p.type] = +p.value; return o; }
function tzOffset(t) { const p = parts(t); return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000; }
function localMidnight(t) {
  const key = Math.floor(t / HOUR); if (midCache.has(key)) return midCache.get(key);
  const p = parts(t), g = Date.UTC(p.year, p.month - 1, p.day);
  let m = g - tzOffset(g); m = g - tzOffset(m);
  midCache.set(key, m); return m;
}
const nextMidnight = d => localMidnight(d + 30 * HOUR);
function localDateFromInput(v) { const [y, m, d] = v.split("-").map(Number); const g = Date.UTC(y, m - 1, d, 12); return g - tzOffset(g); }
function inputValue(t) { const p = parts(t); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; }

// ---------- sun & moon ----------
const sunCache = new Map();
function sunTimes(mid) {
  const key = station.id + ":" + mid; if (sunCache.has(key)) return sunCache.get(key);
  const rad = Math.PI / 180, LAT = station.lat, LON = station.lng;
  const jdNoon = (mid + 12 * HOUR) / DAY + 2440587.5;
  const n = Math.round(jdNoon - 2451545.0 - 0.0009 + LON / 360);
  const Js = n - LON / 360;
  const M = (357.5291 + 0.98560028 * Js) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  const cw = (Math.sin(-0.833 * rad) - Math.sin(LAT * rad) * Math.sin(dec)) / (Math.cos(LAT * rad) * Math.cos(dec));
  const toMs = j => (j - 2440587.5) * DAY;
  let r;
  if (cw <= -1) r = { rise: mid, set: mid + DAY, polar: "day" };
  else if (cw >= 1) r = { rise: mid + 12 * HOUR, set: mid + 12 * HOUR, polar: "night" };
  else { const w0 = Math.acos(cw) / rad; r = { rise: toMs(Jt - w0 / 360), set: toMs(Jt + w0 / 360) }; }
  sunCache.set(key, r); return r;
}
const SYN = 29.530588853, NEW_REF = Date.UTC(2000, 0, 6, 18, 14);
const moonAge = t => ((((t - NEW_REF) / DAY) % SYN) + SYN) % SYN;
const PHASES = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
const phaseName = a => PHASES[Math.floor((a / SYN) * 8 + 0.5) % 8];
const mctx = $("moon").getContext("2d");
function drawMoon(age) {
  const s = 160, r = 70, cx = s / 2, cy = s / 2, dark = "#14232b", lit = "#e9eef0";
  const k = Math.cos(2 * Math.PI * age / SYN), waxing = age < SYN / 2;
  mctx.clearRect(0, 0, s, s); mctx.save();
  mctx.beginPath(); mctx.arc(cx, cy, r, 0, 7); mctx.fillStyle = dark; mctx.fill(); mctx.clip();
  mctx.beginPath(); mctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing); mctx.closePath(); mctx.fillStyle = lit; mctx.fill();
  mctx.beginPath(); mctx.ellipse(cx, cy, Math.abs(k) * r, r, 0, 0, 7); mctx.fillStyle = k > 0 ? dark : lit; mctx.fill();
  const g = mctx.createRadialGradient(cx - 20, cy - 24, 10, cx, cy, r);
  g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,0.35)");
  mctx.fillStyle = g; mctx.fillRect(0, 0, s, s);
  [[-22, -18, 11], [17, 9, 8], [-8, 26, 6], [28, -24, 6], [-32, 13, 5]].forEach(([x, y, rr]) => { mctx.beginPath(); mctx.arc(cx + x, cy + y, rr, 0, 7); mctx.fillStyle = "rgba(20,35,43,0.13)"; mctx.fill(); });
  mctx.restore();
  mctx.beginPath(); mctx.arc(cx, cy, r, 0, 7); mctx.strokeStyle = "rgba(231,241,244,0.12)"; mctx.lineWidth = 2; mctx.stroke();
}

// ---------- tide data: per-month loading from NOAA, cached ----------
// months keyed "YYYYMM" in UTC; each holds { hilo:[{t,h,hi}], six:{start,v[]} | null }
let months = new Map(), pending = new Map(), EX = [], SIX = [], yRange = null, failed = new Set();
const monthKey = t => { const d = new Date(t); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; };
const monthStart = k => Date.UTC(Math.floor(k / 100), (k % 100) - 1, 1);
const monthEnd = k => Date.UTC(Math.floor(k / 100), (k % 100), 1);
const ymd = t => { const d = new Date(t); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`; };
const parseGMT = s => Date.parse(s.replace(" ", "T") + ":00Z");

async function noaa(params) {
  const u = new URL(NOAA);
  Object.entries({ product: "predictions", datum: "MLLW", units: "english", time_zone: "gmt", format: "json", application: APP, ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u); if (!r.ok) throw new Error("NOAA returned " + r.status);
  const j = await r.json(); if (j.error) throw new Error(j.error.message || "NOAA error");
  return j.predictions || [];
}
async function fetchMonth(st, k) {
  const cacheKey = `tide:${st.id}:${k}`;
  const cached = store.get(cacheKey); if (cached) return cached;
  // pad by a day each side so the curve joins across month boundaries
  const begin = ymd(monthStart(k) - DAY), end = ymd(monthEnd(k));
  const hiloRaw = await noaa({ station: st.id, begin_date: begin, end_date: end, interval: "hilo" });
  const hilo = hiloRaw.map(p => ({ t: parseGMT(p.t), h: +p.v, hi: p.type === "H" }));
  let six = null;
  if (st.type !== "S") {
    try {
      const raw = await noaa({ station: st.id, begin_date: begin, end_date: end, interval: "6" });
      if (raw.length > 10) six = { start: parseGMT(raw[0].t), v: raw.map(p => Math.round(+p.v * 1000) / 1000) };
    } catch { six = null; }
  }
  const data = { hilo, six };
  store.set(cacheKey, data);
  return data;
}
function rebuild() {
  const exMap = new Map(); const sixPts = [];
  for (const [, m] of [...months.entries()].sort((a, b) => a[0] - b[0])) {
    m.hilo.forEach(e => exMap.set(e.t, e));
    if (m.six) m.six.v.forEach((v, i) => sixPts.push([m.six.start + i * 6 * MIN, v]));
  }
  EX = [...exMap.values()].sort((a, b) => a.t - b.t);
  sixPts.sort((a, b) => a[0] - b[0]);
  SIX = []; let last = -Infinity; for (const p of sixPts) if (p[0] !== last) { SIX.push(p); last = p[0]; }
  if (EX.length) {
    let lo = Infinity, hi = -Infinity; EX.forEach(e => { lo = Math.min(lo, e.h); hi = Math.max(hi, e.h); });
    const nr = { min: Math.floor(lo - 0.6), max: Math.ceil(hi + 0.6) };
    yRange = yRange ? { min: Math.min(yRange.min, nr.min), max: Math.max(yRange.max, nr.max) } : nr;
  }
}
function ensureData() {
  const keys = new Set([monthKey(center - 2 * DAY), monthKey(center), monthKey(center + 2 * DAY)]);
  for (const k of keys) {
    const id = station.id + ":" + k;
    if (months.has(k) || pending.has(id) || failed.has(id)) continue;
    const st = station;
    showStatus("Loading tides…");
    const p = fetchMonth(st, k).then(d => {
      if (st.id !== station.id) return;
      months.set(k, d); rebuild(); lastMin = null; draw();
    }).catch(err => {
      if (st.id !== station.id) return;
      failed.add(id);
      if (st.id === DEFAULT_STATION.id && !months.size && window.FALLBACK) { useFallback(); return; }
      showStatus(navigator.onLine === false ? "Offline: no saved tides for this date" : "Couldn't load tides: " + err.message, true);
    }).finally(() => { pending.delete(id); if (!pending.size && !document.querySelector(".status.err")) hideStatus(); });
    pending.set(id, p);
  }
}
function useFallback() {
  const m = new Map();
  window.FALLBACK.forEach(e => { const k = monthKey(e.t); if (!m.has(k)) m.set(k, { hilo: [], six: null }); m.get(k).hilo.push(e); });
  months = m; rebuild(); showStatus("Offline sample data (Nov–Dec 2026)", true); draw();
}

function bsearch(arr, t, get) { let lo = 0, hi = arr.length - 1; if (hi < 0 || t < get(arr[0]) || t > get(arr[hi])) return -1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (get(arr[m]) <= t) lo = m; else hi = m; } return lo; }
function heightAt(t) {
  const i = bsearch(SIX, t, p => p[0]);
  if (i >= 0 && i < SIX.length - 1 && SIX[i + 1][0] - SIX[i][0] <= 6 * MIN) {
    const a = SIX[i], b = SIX[i + 1]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
  }
  const j = bsearch(EX, t, e => e.t);
  if (j < 0 || j >= EX.length - 1) return NaN;
  const a = EX[j], b = EX[j + 1]; if (b.t - a.t > 14 * HOUR) return NaN;
  const f = (t - a.t) / (b.t - a.t); return a.h + (b.h - a.h) * (1 - Math.cos(Math.PI * f)) / 2;
}
function nextExtreme(t) { for (const e of EX) if (e.t > t) return e; return null; }

// ---------- weather (Open-Meteo, free, no key) ----------
let wx = null, pierTemp = null;
async function loadPierTemp(st) {
  pierTemp = null;
  try {
    const u = new URL(NOAA);
    Object.entries({ product: "water_temperature", station: st.id, date: "latest", units: "english", time_zone: "gmt", format: "json", application: APP }).forEach(([k, v]) => u.searchParams.set(k, v));
    const j = await (await fetch(u)).json(); const d = j.data && j.data[0];
    if (st.id === station.id && d && d.v !== "") { pierTemp = { t: parseGMT(d.t), v: +d.v }; lastMin = null; draw(true); }
  } catch { /* many stations have no sensor */ }
}
async function loadWeather(st) {
  const key = "wx:" + st.id, c = store.get(key);
  if (c && Date.now() - c.at < HOUR) { wx = c; draw(true); return; }
  const base = { latitude: st.lat.toFixed(3), longitude: st.lng.toFixed(3), timezone: "GMT", timeformat: "unixtime" };
  const f = new URL("https://api.open-meteo.com/v1/forecast");
  Object.entries({ ...base, hourly: "temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m", wind_speed_unit: "mph", temperature_unit: "fahrenheit", past_days: 2, forecast_days: 14 }).forEach(([k, v]) => f.searchParams.set(k, v));
  const m = new URL("https://marine-api.open-meteo.com/v1/marine");
  Object.entries({ ...base, hourly: "swell_wave_height,swell_wave_period,swell_wave_direction,wave_height,sea_surface_temperature", length_unit: "imperial", past_days: 2, forecast_days: 8 }).forEach(([k, v]) => m.searchParams.set(k, v));
  try {
    const [fr, mr] = await Promise.allSettled([fetch(f).then(r => r.json()), fetch(m).then(r => r.json())]);
    const out = { at: Date.now(), f: fr.status === "fulfilled" ? fr.value.hourly : null, m: mr.status === "fulfilled" ? mr.value.hourly : null };
    if (st.id !== station.id) return;
    wx = out; store.set(key, out); lastMin = null; draw(true);
  } catch { /* weather is optional */ }
}
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = d => COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
function wxAt(h, t) {
  if (!h || !h.time) return null;
  const s = t / 1000, i = Math.round((s - h.time[0]) / 3600);
  return i >= 0 && i < h.time.length ? i : null;
}
function fmtNum(v, d = 0) { return v == null || Number.isNaN(v) ? null : (+v).toFixed(d); }
function updateWeather(t) {
  const fi = wxAt(wx?.f, t), mi = wxAt(wx?.m, t);
  const F = wx?.f, M = wx?.m;
  const ws = fi != null ? fmtNum(F.wind_speed_10m[fi]) : null;
  $("wind").textContent = ws != null ? `${ws} mph ${compass(F.wind_direction_10m[fi])}` : "—";
  $("wind2").textContent = fi != null && F.wind_gusts_10m[fi] != null ? `gusts ${fmtNum(F.wind_gusts_10m[fi])}` : "";
  const sh = mi != null ? fmtNum(M.swell_wave_height[mi], 1) : null;
  $("swell").textContent = sh != null ? `${sh} ft · ${fmtNum(M.swell_wave_period[mi])}s` : "—";
  $("swell2").textContent = sh != null ? `${compass(M.swell_wave_direction[mi])} · seas ${fmtNum(M.wave_height[mi], 1) ?? "—"}` : "";
  const sst = mi != null && M.sea_surface_temperature[mi] != null ? (M.sea_surface_temperature[mi] * 9 / 5 + 32) : null;
  const air = fi != null ? fmtNum(F.temperature_2m[fi]) : null;
  const usePier = pierTemp && Math.abs(t - pierTemp.t) < 3 * HOUR;
  $("temp").textContent = usePier ? `${pierTemp.v.toFixed(0)}°F` : sst != null ? `${sst.toFixed(0)}°F` : "—";
  $("tempK").textContent = usePier ? "Water (pier) · Air" : "Water · Air";
  $("temp2").textContent = air != null ? `air ${air}°F` : "";
}

// ---------- chart ----------
const chart = $("chart"), cv = $("c"), ctx = cv.getContext("2d");
let W = 0, H = 0, dpr = 1, pxPerMs = 0;
const T_LO = Date.now() - 365 * DAY, T_HI = Date.now() + 2 * 365 * DAY;
let center = Date.now();
// Horizontal scale follows the chart's height too, so wide screens show more days instead of flattening the waves
let zoom = store.get("zoom", 1);
function setScale() {
  const base = Math.min(Math.max(W, 320) / 22, Math.max(H - 142, 200) * 0.055);
  pxPerMs = (base * zoom) / HOUR;
}
function resize() { dpr = Math.min(window.devicePixelRatio || 1, 3); W = chart.clientWidth; H = chart.clientHeight; cv.width = W * dpr; cv.height = H * dpr; setScale(); draw(); }
function setZoom(z, anchorX) {
  const anchorT = center + ((anchorX ?? W / 2) - W / 2) / pxPerMs;
  const minZ = (W / (7 * 24)) / (Math.min(Math.max(W, 320) / 22, Math.max(H - 142, 200) * 0.055)); // at most 7 days on screen
  const maxZ = (W / 6) / (Math.min(Math.max(W, 320) / 22, Math.max(H - 142, 200) * 0.055));        // at least 6 hours on screen
  zoom = Math.min(Math.max(z, Math.min(minZ, 1)), Math.max(maxZ, 1)); setScale();
  center = clamp(anchorT - ((anchorX ?? W / 2) - W / 2) / pxPerMs);
  store.set("zoom", zoom); draw();
}
const yOf = h => { const r = yRange || { min: -2, max: 7 }, top = 78, bot = H - 64; return top + (r.max - h) / (r.max - r.min) * (bot - top); };
const xOf = t => W / 2 + (t - center) * pxPerMs;
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

function sunGlyph(x, y, rising) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = ctx.strokeStyle = "#ffc861"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, -2, 6, Math.PI, 0); ctx.fill();
  for (let i = 0; i < 5; i++) { const a = Math.PI + (i + 0.5) * Math.PI / 5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 9, -2 + Math.sin(a) * 9); ctx.lineTo(Math.cos(a) * 12, -2 + Math.sin(a) * 12); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(12, -2); ctx.stroke();
  const tip = rising ? -22 : -14, tail = rising ? -14 : -22;
  ctx.beginPath(); ctx.moveTo(0, tail); ctx.lineTo(0, tip); ctx.moveTo(-3, tip + (rising ? 3 : -3)); ctx.lineTo(0, tip); ctx.lineTo(3, tip + (rising ? 3 : -3)); ctx.stroke();
  ctx.restore();
}
function days(t0, t1) { const out = []; for (let d = localMidnight(t0 - DAY); d <= t1 + DAY; d = nextMidnight(d)) out.push(d); return out; }

function draw(forceReadout) {
  if (!W) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const t0 = center - (W / 2) / pxPerMs, t1 = center + (W / 2) / pxPerMs, ds = days(t0, t1);
  for (const d of ds) { const s = sunTimes(d); ctx.fillStyle = "rgba(120,180,205,0.06)"; ctx.fillRect(xOf(s.rise), 0, xOf(s.set) - xOf(s.rise), H); }
  if (yRange) { ctx.strokeStyle = "rgba(231,241,244,0.10)"; ctx.setLineDash([2, 5]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(W, yOf(0)); ctx.stroke(); ctx.setLineDash([]); }

  // water: build runs where data exists
  const water = new Path2D(), crest = new Path2D(); let run = false, runStart = 0, lastX = 0;
  for (let x = 0; x <= W + 3; x += 3) {
    const h = heightAt(center + (x - W / 2) / pxPerMs);
    if (Number.isNaN(h)) { if (run) { water.lineTo(lastX, H); water.closePath(); run = false; } continue; }
    const y = yOf(h);
    if (!run) { water.moveTo(x, H); water.lineTo(x, y); crest.moveTo(x, y); run = true; runStart = x; } else { water.lineTo(x, y); crest.lineTo(x, y); }
    lastX = x;
  }
  if (run) { water.lineTo(lastX, H); water.closePath(); }
  const g = ctx.createLinearGradient(0, 60, 0, H); g.addColorStop(0, "#3fb4dc"); g.addColorStop(0.45, "#1d7fa8"); g.addColorStop(1, "#0a3247");
  ctx.fillStyle = g; ctx.fill(water);
  ctx.save(); ctx.clip(water);
  for (const d of ds) { const s = sunTimes(d), p = sunTimes(localMidnight(d - 2 * HOUR)); ctx.fillStyle = "rgba(2,14,22,0.42)"; ctx.fillRect(xOf(p.set), 0, xOf(s.rise) - xOf(p.set), H); }
  ctx.strokeStyle = "rgba(231,241,244,0.35)"; ctx.setLineDash([2, 4]);
  for (const d of ds) { const h = heightAt(d); const x = xOf(d); ctx.beginPath(); ctx.moveTo(x, Number.isNaN(h) ? 0 : yOf(h) + 4); ctx.lineTo(x, H); ctx.stroke(); }
  ctx.setLineDash([]); ctx.restore();
  ctx.strokeStyle = "rgba(200,240,255,0.55)"; ctx.lineWidth = 1.5; ctx.stroke(crest);

  ctx.font = "500 12px " + MONO; ctx.fillStyle = "rgba(231,241,244,0.85)"; ctx.textAlign = "left";
  for (const d of ds) ctx.fillText(fmtDay.format(d + 12 * HOUR).toUpperCase(), xOf(d) + 8, H - 14);
  for (const d of ds) { const s = sunTimes(d); if (s.polar) continue; for (const [t, up] of [[s.rise, true], [s.set, false]]) { const x = xOf(t), h = heightAt(t); if (x > -20 && x < W + 20 && !Number.isNaN(h)) sunGlyph(x, yOf(h) - 2, up); } }

  ctx.textAlign = "center";
  for (const e of EX) {
    const x = xOf(e.t); if (x < -60 || x > W + 60) continue;
    const y = yOf(e.h); ctx.globalAlpha = Math.abs(x - W / 2) < 46 ? 0.25 : 1;
    const ft = e.h.toFixed(2) + " ft", tm = fmtTime.format(e.t);
    if (e.hi) { ctx.fillStyle = "#e7f1f4"; ctx.font = "500 14px " + MONO; ctx.fillText(ft, x, y - 44); ctx.fillStyle = "#8aa6b1"; ctx.font = "400 12px " + MONO; ctx.fillText(tm, x, y - 28); }
    else { ctx.fillStyle = e.h < 0 ? "#ffc861" : "#e7f1f4"; ctx.font = "500 14px " + MONO; ctx.fillText(ft, x, y + 26); ctx.fillStyle = "rgba(231,241,244,0.7)"; ctx.font = "400 12px " + MONO; ctx.fillText(tm, x, y + 42); }
    ctx.globalAlpha = 1;
  }

  const cx = W / 2, ch = heightAt(center);
  ctx.strokeStyle = "rgba(255,200,97,0.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
  if (!Number.isNaN(ch)) {
    const cy = yOf(ch);
    ctx.beginPath(); ctx.arc(cx, cy, 16, 0, 7); ctx.fillStyle = "rgba(255,200,97,0.18)"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 7); ctx.fillStyle = "#ffc861"; ctx.fill();
    const l1 = ch.toFixed(2) + " ft", l2 = fmtTime.format(center);
    ctx.font = "500 13px " + MONO; const bw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 20, bh = 42;
    const bx = cx + 22 + bw > W - 8 ? cx - 22 - bw : cx + 22, by = cy - bh / 2;
    ctx.fillStyle = "rgba(4,13,18,0.82)"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 8) : ctx.rect(bx, by, bw, bh); ctx.fill();
    ctx.fillStyle = "#ffc861"; ctx.textAlign = "left"; ctx.fillText(l1, bx + 10, by + 18); ctx.fillText(l2, bx + 10, by + 34);
  }
  updateReadout(forceReadout);
  ensureData();
}

// ---------- readout ----------
let lastMin = null, lastDay = null, lastMoonDay = null;
function dur(ms) { const m = Math.round(ms / MIN), h = Math.floor(m / 60), mm = m % 60; return (h ? h + (h === 1 ? " hr " : " hrs ") : "") + mm + (mm === 1 ? " min" : " mins"); }
function updateReadout(force) {
  const min = Math.floor(center / MIN); if (min === lastMin && !force) return; lastMin = min;
  const t = min * MIN, h = heightAt(t);
  $("h").textContent = Number.isNaN(h) ? "—" : h.toFixed(1);
  $("t").textContent = fmtTime.format(t);
  const nx = nextExtreme(t);
  $("next").innerHTML = nx && !Number.isNaN(h) ? `<span aria-hidden="true">${nx.hi ? "▲" : "▼"}</span> ${nx.hi ? "High" : "Low"} ${nx.h.toFixed(1)} ft in <b>${dur(nx.t - t)}</b>` : (pending.size ? "Loading tides…" : "—");
  const day = localMidnight(t), age = moonAge(t);
  if (day !== lastDay || force) {
    lastDay = day; $("date").textContent = fmtDate.format(t);
    const s = sunTimes(day); $("rise").textContent = s.polar ? "—" : fmtTime.format(s.rise); $("set").textContent = s.polar ? "—" : fmtTime.format(s.set);
  }
  const moonKey = Math.floor(t / HOUR);
  if (moonKey !== lastMoonDay) { lastMoonDay = moonKey; drawMoon(age); $("phase").textContent = phaseName(age); $("illum").textContent = Math.round((1 - Math.cos(2 * Math.PI * age / SYN)) / 2 * 100) + "% lit"; }
  updateWeather(t);
  $("now").classList.toggle("off", Math.abs(center - Date.now()) < 10 * MIN);
}

let statusTimer;
function showStatus(msg, err) { const s = $("status"); s.textContent = msg; s.classList.toggle("err", !!err); s.hidden = false; clearTimeout(statusTimer); if (err) statusTimer = setTimeout(hideStatus, 6000); }
function hideStatus() { $("status").hidden = true; $("status").classList.remove("err"); }

// ---------- interaction ----------
let dragging = false, lx = 0, lt = 0, vel = 0, anim = null, hinted = store.get("hinted", false);
if (hinted) $("hint").hidden = true;
const clamp = t => Math.min(Math.max(t, T_LO), T_HI);
const stopAnim = () => { if (anim) cancelAnimationFrame(anim); anim = null; };
const hideHint = () => { if (!hinted) { hinted = true; $("hint").style.opacity = 0; store.set("hinted", true); } };
const ptrs = new Map(); let pinch = null, downX = 0, downT = 0, moved = 0, lastEx = null;
function tick() { const i = bsearch(EX, center, e => e.t); if (lastEx !== null && i !== lastEx && dragging && navigator.vibrate) navigator.vibrate(8); lastEx = i; }
chart.addEventListener("pointerdown", e => {
  stopAnim(); chart.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e.clientX); hideHint();
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.abs(a - b) || 1, z: zoom, mid: (a + b) / 2 - chart.getBoundingClientRect().left }; dragging = false; return; }
  dragging = true; lx = downX = e.clientX; lt = downT = performance.now(); vel = 0; moved = 0;
});
chart.addEventListener("pointermove", e => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e.clientX);
  if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; setZoom(pinch.z * (Math.abs(a - b) || 1) / pinch.d, pinch.mid); return; }
  if (!dragging) return;
  const n = performance.now(), dx = e.clientX - lx, dt = Math.max(n - lt, 1);
  moved = Math.max(moved, Math.abs(e.clientX - downX));
  center = clamp(center - dx / pxPerMs); vel = 0.8 * (dx / dt) + 0.2 * vel; lx = e.clientX; lt = n; tick(); draw();
});
function release(e) {
  ptrs.delete(e.pointerId);
  if (pinch) { if (ptrs.size < 2) pinch = null; return; }
  if (!dragging) return; dragging = false;
  if (moved < 6 && performance.now() - downT < 350) { // tap: glide the cursor to that moment
    const x = e.clientX - chart.getBoundingClientRect().left; glideTo(center + (x - W / 2) / pxPerMs); return;
  }
  if (performance.now() - lt > 80) vel = 0;
  let v = vel, prev = performance.now();
  const step = n => { const dt = n - prev; prev = n; v *= Math.pow(0.994, dt); center = clamp(center - (v * dt) / pxPerMs); draw(); anim = Math.abs(v) > 0.02 ? requestAnimationFrame(step) : null; };
  if (Math.abs(v) > 0.05) anim = requestAnimationFrame(step);
}
chart.addEventListener("pointerup", release); chart.addEventListener("pointercancel", release);
chart.addEventListener("wheel", e => {
  e.preventDefault(); stopAnim(); hideHint();
  if (e.ctrlKey || e.metaKey) { setZoom(zoom * Math.exp(-e.deltaY * 0.01), e.clientX - chart.getBoundingClientRect().left); return; }
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; center = clamp(center + d / pxPerMs); draw();
}, { passive: false });
window.addEventListener("keydown", e => { if ($("sheet").hidden && (e.key === "+" || e.key === "=")) setZoom(zoom * 1.25); if ($("sheet").hidden && (e.key === "-" || e.key === "_")) setZoom(zoom / 1.25); });
window.addEventListener("keydown", e => { if ($("sheet").hidden && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { stopAnim(); center = clamp(center + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 6 * HOUR : 15 * MIN)); draw(); } });
function glideTo(to) {
  stopAnim(); const from = center, st = performance.now(), D = 600, reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (Math.abs(to - from) > 5 * DAY || reduce) { center = clamp(to); draw(); return; }
  const step = n => { const f = Math.min((n - st) / D, 1); center = from + (to - from) * (1 - Math.pow(1 - f, 3)); draw(); anim = f < 1 ? requestAnimationFrame(step) : null; };
  anim = requestAnimationFrame(step);
}
$("now").addEventListener("click", () => glideTo(Date.now()));
$("calBtn").addEventListener("click", () => { const i = $("dateInput"); i.value = inputValue(center); if (i.showPicker) { try { i.showPicker(); return; } catch {} } i.focus(); i.click(); });
$("dateInput").addEventListener("change", e => { if (!e.target.value) return; const p = parts(center); const sameTime = (p.hour * 60 + p.minute) * MIN; glideTo(localDateFromInput(e.target.value) - 12 * HOUR + sameTime); });

// ---------- station switching ----------
function setStation(st) {
  station = st; TZ = ianaFor(st); setFormatters(); store.set("station:last", st);
  months = new Map(); pending = new Map(); failed = new Set(); EX = []; SIX = []; yRange = null; wx = null; lastMin = null; lastDay = null;
  $("stName").textContent = st.name + (st.state ? ", " + st.state : "");
  $("stMeta").textContent = `NOAA ${st.id} · MLLW${st.type === "S" ? " · high/low only" : ""}`;
  $("fav").setAttribute("aria-pressed", favs.some(f => f.id === st.id) ? "true" : "false");
  draw(true); loadWeather(st); loadPierTemp(st);
}
$("fav").addEventListener("click", () => {
  const i = favs.findIndex(f => f.id === station.id);
  if (i >= 0) favs.splice(i, 1); else favs.unshift(station);
  store.set("favs", favs); $("fav").setAttribute("aria-pressed", i >= 0 ? "false" : "true");
});

// ---------- picker ----------
let here = store.get("here", null);
const km = (a, b) => { const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
function row(st) {
  const b = document.createElement("button"); b.className = "st";
  const d = here ? ` · ${(km(here, st) * 0.621).toFixed(km(here, st) < 16 ? 1 : 0)} mi` : "";
  b.innerHTML = `<span class="n"></span><span class="m"></span>`;
  b.querySelector(".n").textContent = st.name + (st.state ? ", " + st.state : "");
  b.querySelector(".m").textContent = `${st.id}${st.type === "S" ? " · H/L" : ""}${d}`;
  b.addEventListener("click", () => { closeSheet(); setStation(st); });
  return b;
}
function section(title, items, emptyMsg) {
  const frag = document.createDocumentFragment(); const h = document.createElement("h3"); h.textContent = title; frag.append(h);
  if (!items.length) { const p = document.createElement("div"); p.className = "empty"; p.textContent = emptyMsg; frag.append(p); }
  items.forEach(s => frag.append(row(s))); return frag;
}
function renderList() {
  const q = $("q").value.trim().toLowerCase(), L = $("list"); L.textContent = "";
  if (q) {
    if (!stations) { L.append(section("Results", [], "Loading station list…")); return; }
    const words = q.split(/\s+/);
    const res = stations.filter(s => { const hay = (s.name + " " + s.state + " " + s.id).toLowerCase(); return words.every(w => hay.includes(w)); });
    if (here) res.sort((a, b) => km(here, a) - km(here, b));
    L.append(section(`Results (${res.length})`, res.slice(0, 60), "No stations match. Try a nearby town or bay name."));
    return;
  }
  L.append(section("Saved", favs, "Tap the star in the bottom bar to save a station."));
  if (here && stations) L.append(section("Nearest to you", [...stations].sort((a, b) => km(here, a) - km(here, b)).slice(0, 12), ""));
}
function openSheet() { $("sheet").hidden = false; renderList(); if (!stations) loadStations().then(renderList).catch(() => { $("list").prepend(Object.assign(document.createElement("div"), { className: "empty", textContent: "Couldn't load the station list. Check your connection." })); }); setTimeout(() => $("q").focus(), 50); }
function closeSheet() { $("sheet").hidden = true; $("q").value = ""; }
$("stationBtn").addEventListener("click", openSheet);
$("closeSheet").addEventListener("click", closeSheet);
$("q").addEventListener("input", renderList);
$("locate").addEventListener("click", () => {
  if (!navigator.geolocation) return;
  $("locate").textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(p => {
    here = { lat: p.coords.latitude, lng: p.coords.longitude }; store.set("here", here);
    $("locate").textContent = "Find nearest to me";
    (stations ? Promise.resolve() : loadStations()).then(renderList);
  }, () => { $("locate").textContent = "Location unavailable"; }, { timeout: 10000, maximumAge: 10 * MIN });
});

// ---------- boot ----------
setFormatters();
new ResizeObserver(resize).observe(chart);
document.fonts && document.fonts.ready.then(() => draw(true));
setStation(station);
resize();
setInterval(() => { if (!dragging && !anim && Math.abs(center - Date.now()) < 2 * MIN) { center = Date.now(); draw(); } }, 30e3);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
