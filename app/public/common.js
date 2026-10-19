// Shared by the tsunami and earthquake pages: units, fetch, the color levels,
// shaking intensity in words, and the place picker (GPS or town search).
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// en-US readers get feet and miles; everyone else metres and km.
const imperial = /^en-(US|LR|MM)$/i.test(navigator.language || "") || navigator.language === "en";

function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(k) {
  if (!imperial) return Math.round(k).toLocaleString() + " km";
  const mi = Math.round(k * 0.621371);
  return mi === 1 ? "1 mile" : mi.toLocaleString() + " miles";
}
const fmtHeight = (m) => imperial ? Math.round(m * 3.28084).toLocaleString() + " ft" : Math.round(m).toLocaleString() + " m";
const box = (p, s, n, w, e) => p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e;

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return Math.round(s / 60) + " minutes ago";
  if (s < 2 * 3600) return "1 hour ago";
  if (s < 86400) return Math.round(s / 3600) + " hours ago";
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : d + " days ago";
}

async function getJson(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ── color levels ──
// One scale everywhere: the color is the message, the words say why.
const LEVEL_ORDER = ["none", "green", "yellow", "orange", "red"];
const chip = (level, text) => `<span class="chip ${level}">${esc(text)}</span>`;
const worse = (a, b) => (LEVEL_ORDER.indexOf(b) > LEVEL_ORDER.indexOf(a) ? b : a);

// A colored list row: the bar on its left is its level.
function row(level, title, sub, href) {
  const tag = href ? "a" : "div";
  const link = href ? ` href="${esc(href)}" target="_blank" rel="noopener"` : "";
  return `<${tag} class="row lv-${level}"${link}><div><b>${title}</b><span>${sub}</span></div></${tag}>`;
}

// ── shaking ──

// Magnitude is the size of the quake; what you feel depends on how far away it
// was. Intensity (Modified Mercalli, I to X) estimated with Bakun & Wentworth
// (1997, California): MMI = 3.67 + 1.17 M - 3.19 log10(R), R hypocentral km.
// Rough outside California, fine for words.
function intensity(mag, epiKm, depthKm) {
  const r = Math.max(5, Math.hypot(epiKm, Math.max(0, depthKm || 0)));
  return 3.67 + 1.17 * mag - 3.19 * Math.log10(r);
}

const SHAKE = [
  { min: -99, level: "none", word: "Too small to feel", what: "Only instruments notice." },
  { min: 3, level: "green", word: "A little rumble", what: "Some people inside notice. Like a big truck going by." },
  { min: 4, level: "yellow", word: "Rattled dishes", what: "Most people inside feel it. Windows and dishes rattle." },
  { min: 5, level: "orange", word: "Woke people up", what: "Everyone feels it. Small things tip over." },
  { min: 6, level: "orange", word: "Things fell off shelves", what: "Scary. Furniture moves, plaster cracks." },
  { min: 7, level: "red", word: "Damaged buildings", what: "Hard to stand up. Weak buildings break." },
  { min: 8, level: "red", word: "Dangerous", what: "Serious damage. Many buildings hurt." },
];
const shake = (mmi) => SHAKE.reduce((a, s) => (mmi >= s.min ? s : a));

// USGS PAGER: its estimate of deaths and damage for an event.
const PAGER = {
  green: "Little or no damage",
  yellow: "Some damage possible",
  orange: "Serious damage likely",
  red: "Disaster",
};

// ── place ──

let place = null; // {lat, lon, name, cc}
let onPlace = () => {};

function initialPlace() {
  const u = new URLSearchParams(location.search);
  const lat = parseFloat(u.get("lat")), lon = parseFloat(u.get("lon"));
  if (isFinite(lat) && isFinite(lon)) return { lat, lon, name: u.get("name") || "This spot", cc: u.get("cc") || "" };
  try { return JSON.parse(localStorage.getItem("place") || "null"); } catch { return null; }
}

function placeQuery(p) {
  const u = new URLSearchParams({ lat: p.lat.toFixed(4), lon: p.lon.toFixed(4), name: p.name });
  if (p.cc) u.set("cc", p.cc);
  return "?" + u;
}

function setPlace(p) {
  place = p;
  try { localStorage.setItem("place", JSON.stringify(p)); } catch {}
  history.replaceState(null, "", location.pathname + placeQuery(p));
  // The other page opens on the same place.
  for (const a of document.querySelectorAll("a.keep-place")) a.search = placeQuery(p);
  onPlace(p);
}

function initPicker(handler) {
  onPlace = handler;
  $("gpsBtn").onclick = () => {
    if (!navigator.geolocation) return noGps();
    $("gpsBtn").textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(async (pos) => {
      $("gpsBtn").textContent = "Where I am";
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Where you are", cc: "" };
      try {
        const r = await getJson(`https://nominatim.openstreetmap.org/reverse?lat=${p.lat}&lon=${p.lon}&format=json&zoom=10`, 6000);
        const a = r.address || {};
        p.name = [a.city || a.town || a.village || a.county, a.state || a.country].filter(Boolean).join(", ") || p.name;
        p.cc = (a.country_code || "").toUpperCase();
      } catch {}
      setPlace(p);
    }, noGps, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  };

  // Our own index on the Milo server: one in-memory scan, no remote geocoder,
  // so it keeps up with typing. Ranked by population, the reader's country first.
  const home = (place?.cc || (navigator.language || "").split("-")[1] || "").toUpperCase();
  let suggestions = [];
  let sel = -1;
  let timer = 0;
  const hide = () => { $("suggest").hidden = true; suggestions = []; };
  const pick = (i) => {
    const s = suggestions[i];
    if (!s) return;
    hide();
    $("search").value = "";
    $("search").blur();
    setPlace(s);
  };
  $("search").addEventListener("input", () => {
    clearTimeout(timer);
    const q = $("search").value.trim();
    if (q.length < 2) return hide();
    timer = setTimeout(async () => {
      try {
        const j = await getJson(`api/places?home=${home}&q=${encodeURIComponent(q)}`, 6000);
        if ($("search").value.trim() !== q) return;
        suggestions = j.map((r) => ({
          lat: r.lat, lon: r.lon, cc: r.cc,
          name: r.cc === "US" ? `${r.name}, ${r.region}` : [r.name, r.region && r.region !== r.name ? r.region : null, r.country].filter(Boolean).join(", "),
        }));
        sel = -1;
        if (!suggestions.length) return hide();
        $("suggest").innerHTML = suggestions.map((s, i) => `<div data-i="${i}">${esc(s.name)}</div>`).join("");
        $("suggest").hidden = false;
      } catch {}
    }, 40);
  });
  $("suggest").addEventListener("pointerdown", (e) => {
    const d = e.target.closest("[data-i]");
    if (d) { e.preventDefault(); pick(+d.dataset.i); }
  });
  $("search").addEventListener("keydown", (e) => {
    if ($("suggest").hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
      [...$("suggest").children].forEach((c, i) => c.classList.toggle("on", i === sel));
    } else if (e.key === "Escape") hide();
  });
  $("search").addEventListener("blur", () => setTimeout(hide, 150));
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    // Enter takes the highlighted row, else the top one: the place the list offered.
    if (suggestions.length) pick(sel >= 0 ? sel : 0);
  });

  const p = initialPlace();
  if (p) setPlace(p);
}

function noGps() {
  $("gpsBtn").textContent = "Where I am";
  $("search").placeholder = "No GPS. Type a town…";
  $("search").focus();
}

// ── map ──

// Pacific quakes straddle the antimeridian, so longitudes are unwrapped toward
// a reference before plotting and fitting.
const unwrap = (lon, ref) => lon + 360 * Math.round((ref - lon) / 360);
const LEVEL_COLOR = { none: "#9aa8bb", green: "#2fbf71", yellow: "#e5b800", orange: "#ff8a1f", red: "#e5322d" };

function quakeMap(el, old) {
  if (old) return old;
  const m = L.map(el, { worldCopyJump: true, attributionControl: false, scrollWheelZoom: false }).setView([15, -170], 1);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12 }).addTo(m);
  m.layer = L.layerGroup().addTo(m);
  return m;
}

// points: [{lat, lon, mag, level, label}]
function plotQuakes(m, points, home, maxZoom) {
  m.layer.clearLayers();
  const ref = home ? home.lon : points[0]?.lon ?? 0;
  const fit = [];
  for (const q of points) {
    const ll = [q.lat, unwrap(q.lon, ref)];
    fit.push(ll);
    L.circleMarker(ll, {
      radius: Math.max(4, 3 + (q.mag - 3) * 3), color: LEVEL_COLOR[q.level], weight: 2, fillOpacity: 0.5,
    }).bindPopup(q.label).addTo(m.layer);
  }
  if (home) {
    fit.push([home.lat, home.lon]);
    L.circleMarker([home.lat, home.lon], { radius: 7, color: "#18304d", weight: 3, fillColor: "#fff", fillOpacity: 1 })
      .bindPopup("You: " + esc(home.name)).addTo(m.layer);
  }
  if (fit.length > 1) m.fitBounds(fit, { padding: [20, 20], maxZoom });
  else if (fit.length) m.setView(fit[0], Math.min(maxZoom, 6));
}
