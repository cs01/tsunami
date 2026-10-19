// Tsunami Check: one answer (calm / watch / advisory / warning) for one place,
// then the context a curious kid or a worried parent wants next: how high up
// you are, the big quakes, what the warning centers last said, and El Nino.
// /api/* is our Milo server (NOAA feeds without CORS); the rest is fetched direct.
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// en-US readers get feet and miles; everyone else metres and km.
const imperial = /^en-(US|LR|MM)$/i.test(navigator.language || "") || navigator.language === "en";

let place = null; // {lat, lon, name, cc}
let quakes = [];
let centers = [];
let elevation = null;
let map = null;
let mapLayer = null;

const LEVELS = ["calm", "watch", "advisory", "warning"];

// ── units and words ──

function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (k) => imperial ? Math.round(k * 0.621371).toLocaleString() + " miles" : Math.round(k).toLocaleString() + " km";
const fmtHeight = (m) => imperial ? Math.round(m * 3.28084).toLocaleString() + " ft" : Math.round(m).toLocaleString() + " m";

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return Math.round(s / 60) + " minutes ago";
  if (s < 2 * 3600) return "1 hour ago";
  if (s < 86400) return Math.round(s / 3600) + " hours ago";
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : d + " days ago";
}

// USGS PAGER's alert is its estimate of deaths and damage for the event.
const PAGER = {
  green: ["", "Little or no damage expected"],
  yellow: ["hot", "Some damage and injuries possible"],
  orange: ["hot", "Serious damage likely"],
  red: ["hot", "Disaster: widespread damage"],
};

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

// ── the answer ──

// NWS issues tsunami alerts per US coastal zone, so a point query is exact.
// Outside the US it has no zones and errors, which just means "no NWS answer".
async function nwsAlerts(p) {
  try {
    const j = await getJson(`https://api.weather.gov/alerts/active?point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`);
    return (j.features || []).map((f) => f.properties).filter((a) => /tsunami/i.test(a.event || ""));
  } catch {
    return null;
  }
}

function levelOfEvent(ev) {
  if (/warning/i.test(ev)) return "warning";
  if (/advisory/i.test(ev)) return "advisory";
  if (/watch/i.test(ev)) return "watch";
  return "calm";
}

// The centers' feeds name an earthquake, not the coasts it threatens. A live
// (non-"Information") bulletin near a low-lying place is a reason to listen
// for news, never a warning we invent.
function centerConcern(p) {
  const out = [];
  for (const c of centers) {
    if (c.empty || !c.updated) continue;
    const ageH = (Date.now() - Date.parse(c.updated)) / 3.6e6;
    if (ageH > 12 || /information|cancel/i.test(c.category || "")) continue;
    const d = km(p, { lat: c.lat, lon: c.lon });
    if (d < 3000) out.push({ c, d });
  }
  return out;
}

// A big shake in the last few hours close by: the shake itself is the warning.
function nearbyFreshQuake(p) {
  return quakes.find((q) => q.mag >= 6.5 && Date.now() - q.time < 3 * 3.6e6 && km(p, q) < 1000);
}

async function check() {
  if (!place) return;
  const p = place;
  const alerts = await nwsAlerts(p);
  if (p !== place) return;
  let level = "calm";
  let html = "";
  for (const a of alerts || []) {
    const l = levelOfEvent(a.event);
    if (LEVELS.indexOf(l) > LEVELS.indexOf(level)) level = l;
    html += `<div class="alert"><b>${esc(a.event)}</b><br>${esc(a.headline || "")}${a.instruction ? "<br><br>" + esc(a.instruction).replace(/\n/g, "<br>") : ""}</div>`;
  }
  const low = elevation == null || elevation < 30;
  if (level === "calm" && low) {
    for (const { c, d } of centerConcern(p)) {
      level = "watch";
      html += `<div class="alert"><b>${esc(c.category)}: ${esc(c.region)}</b><br>Magnitude ${esc(c.magnitude)}, ${fmtDist(d)} away. ${c.bulletin ? `<a href="${esc(c.bulletin)}" target="_blank" rel="noopener">Read the bulletin</a>` : ""}</div>`;
    }
    const q = nearbyFreshQuake(p);
    if (q) {
      level = "watch";
      html += `<div class="alert"><b>M${q.mag.toFixed(1)} earthquake ${ago(q.time)}</b><br>${esc(q.place)}, ${fmtDist(km(p, q))} away.</div>`;
    }
  }
  renderHero(level, html, alerts !== null);
}

const HERO = {
  calm: ["😊", "No tsunami coming", "The ocean is calm here. Go have fun!"],
  watch: ["👀", "Keep an eye out", "Something big happened in the ocean. Scientists are checking. Stay near a grown-up and listen for news."],
  advisory: ["⚠️", "Stay away from the beach", "Strong waves and currents are coming. Get out of the water and off the beach."],
  warning: ["🚨", "GO TO HIGH GROUND NOW", "A tsunami may be coming. Walk uphill or far from the ocean right now. Don't wait!"],
};

function renderHero(level, extra, haveNws) {
  const [emoji, title, msg] = HERO[level];
  const hero = $("hero");
  hero.className = "card " + level;
  const src = haveNws ? "NWS alerts + tsunami.gov" : "tsunami.gov + USGS";
  hero.innerHTML = `<div class="big">${emoji}</div><h2>${title}</h2><p>${msg}</p>
    <div class="place">📍 ${esc(place.name)}</div>${extra}
    <div class="updated">Checked ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${src} · rechecks every minute</div>`;
  document.title = (level === "calm" ? "" : emoji + " ") + "Tsunami Check";
}

// ── how high up ──

async function loadHeight(p) {
  $("height").hidden = true;
  elevation = null;
  try {
    const j = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${p.lat}&longitude=${p.lon}`);
    if (p !== place) return;
    elevation = j.elevation?.[0];
  } catch {
    return;
  }
  if (elevation == null) return;
  const m = Math.max(0, elevation);
  // Most tsunamis stay under 10 m at the shore; 2011 Japan reached about 40 m.
  let head, body;
  if (m >= 40) {
    head = "Way up high 🏔️";
    body = "That's higher than the biggest tsunamis ever reach. You're super safe from waves here.";
  } else if (m >= 15) {
    head = "Pretty high up 🙂";
    body = "Almost all tsunamis stay lower than this. If you're near the ocean, you're already a good spot to go to.";
  } else {
    head = "Close to sea level 🌊";
    body = "If you're near the ocean, know your way uphill. Look for the blue tsunami route signs.";
  }
  const top = 50; // the meter's scale, in metres
  const pct = (v) => Math.min(96, (v / top) * 100);
  $("height").innerHTML = `<div class="meter">
      <div class="sea" style="height:4%"></div>
      <div class="wave" style="bottom:${pct(10)}%" title="a big tsunami"></div>
      <div class="me" style="bottom:${pct(m)}%">🧍</div>
    </div>
    <div class="txt"><b>${fmtHeight(m)} above the sea</b><p>${head}. ${body}</p>
    <p class="sub" style="margin-top:6px">Red dashes = a big tsunami (${fmtHeight(10)}).</p></div>`;
  $("height").hidden = false;
}

// ── quakes ──

async function loadQuakes() {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  try {
    const j = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=6&starttime=${since}&orderby=time&limit=40`);
    quakes = j.features.map((f) => ({
      mag: f.properties.mag, place: f.properties.place || "Somewhere", time: f.properties.time,
      tsunami: f.properties.tsunami === 1, url: f.properties.url, alert: f.properties.alert,
      mmi: f.properties.mmi, depth: f.geometry.coordinates[2],
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    }));
  } catch {
    $("quakes").innerHTML = '<div class="loading">Could not reach USGS. Trying again soon.</div>';
    return;
  }
  renderQuakes();
}

function renderQuakes() {
  if (!quakes.length) {
    $("quakes").innerHTML = '<div class="loading">No big earthquakes in the last 30 days. 😌</div>';
  } else {
    $("quakes").innerHTML = quakes.slice(0, 12).map((q) => {
      // USGS's ShakeMap peak intensity when it has one, else our estimate right above it.
      const mmi = q.mmi ?? intensity(q.mag, 0, q.depth);
      // ShakeMap's peak is over land and sea alike; a weak peak means open ocean.
      const [e, word] = mmi < 3 ? ["🌊", "Far out at sea. Nobody felt it"] : feelWords(mmi);
      const pager = PAGER[q.alert];
      const danger = pager ? ` · <span class="tag ${pager[0]}">${pager[1]}</span>` : "";
      const far = place ? ` · ${fmtDist(km(place, q))} from you` : "";
      return `<a class="row" href="${esc(q.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <div class="e">${e}</div><div><b>${esc(q.place)}</b>
        <span>Near the center: ${word.toLowerCase()}${danger} · ${ago(q.time)}${far} <span class="tag">M${q.mag.toFixed(1)}</span></span></div></a>`;
    }).join("");
  }
  drawMap();
}

function drawMap() {
  if (!window.L) return;
  if (!map) {
    map = L.map("map", { worldCopyJump: true, attributionControl: false, scrollWheelZoom: false }).setView([15, -170], 1);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12 }).addTo(map);
  }
  if (mapLayer) mapLayer.remove();
  mapLayer = L.layerGroup().addTo(map);
  for (const q of quakes) {
    const ref = place ? place.lon : quakes[0].lon;
    L.circleMarker([q.lat, q.lon + 360 * Math.round((ref - q.lon) / 360)], {
      radius: 3 + (q.mag - 5.5) * 5, color: q.tsunami ? "#c41d1d" : "#ff9a3c", weight: 2, fillOpacity: 0.45,
    }).bindPopup(`<b>M${q.mag.toFixed(1)}</b><br>${esc(q.place)}<br>${ago(q.time)}`).addTo(mapLayer);
  }
  if (place) {
    L.marker([place.lat, place.lon], { icon: L.divIcon({ className: "pin", html: "🏠", iconSize: [28, 28] }) }).addTo(mapLayer);
  }
  // Frame you and every quake. Pacific quakes straddle the antimeridian, so
  // longitudes are unwrapped toward you before fitting.
  const ref = place ? place.lon : quakes[0]?.lon ?? 0;
  const pts = quakes.map((q) => [q.lat, q.lon + 360 * Math.round((ref - q.lon) / 360)]);
  if (place) pts.push([place.lat, place.lon]);
  if (pts.length) map.fitBounds(pts, { padding: [20, 20], maxZoom: 4 });
}

// ── shakes near you ──

// Magnitude is abstract; what matters is how hard it shook where you are, which
// falls off with distance. Intensity (Modified Mercalli, I to X) estimated with
// Bakun & Wentworth (1997, California): MMI = 3.67 + 1.17 M - 3.19 log10(R),
// R the hypocentral distance in km. Rough outside California, fine for words.
const NEAR_KM = 500;
const FEEL_MIN = 3; // MMI III: people indoors notice

function intensity(mag, epiKm, depthKm) {
  const r = Math.max(5, Math.hypot(epiKm, Math.max(0, depthKm || 0)));
  return 3.67 + 1.17 * mag - 3.19 * Math.log10(r);
}

// MMI in words: what you feel and what it does.
function feelWords(mmi) {
  if (mmi < 3) return ["🤏", "Too small to feel", "Only instruments notice."];
  if (mmi < 4) return ["😮", "A little rumble", "Some people inside notice. Like a big truck going by."];
  if (mmi < 5) return ["🍽️", "Rattled dishes", "Most people inside feel it. Windows and dishes rattle."];
  if (mmi < 6) return ["😳", "Woke people up", "Everyone feels it. Small things tip over."];
  if (mmi < 7) return ["📚", "Things fell off shelves", "Scary. Furniture moves, plaster cracks."];
  if (mmi < 8) return ["🏚️", "Damaged buildings", "Hard to stand up. Weak buildings break."];
  return ["🚨", "Dangerous", "Serious damage. Many buildings hurt."];
}

let nearQuakes = null;

async function loadNear(p) {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 19);
  try {
    const j = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}&maxradiuskm=${NEAR_KM}&starttime=${since}&minmagnitude=2.5&orderby=time&limit=300`);
    if (p !== place) return;
    nearQuakes = j.features.map((f) => {
      const q = {
        mag: f.properties.mag ?? 0, place: f.properties.place || "Nearby", time: f.properties.time,
        felt: f.properties.felt || 0, url: f.properties.url, depth: f.geometry.coordinates[2],
        lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      };
      q.here = intensity(q.mag, km(p, q), q.depth);
      return q;
    // Only what you'd notice here. USGS "felt" counts come from people near the
    // quake, not near you, so they can't stand in for it.
    }).filter((q) => q.here >= FEEL_MIN);
  } catch {
    if (p === place && !nearQuakes) $("shakes").innerHTML = '<div class="loading">Could not reach USGS. Trying again soon.</div>';
    $("shakesCard").hidden = false;
    return;
  }
  renderNear();
}

function renderNear() {
  if (!place || !nearQuakes) return;
  let head;
  if (!nearQuakes.length) {
    head = `<div class="enso-top"><div class="big">😌</div><div><b>Nothing you'd feel</b><p>No earthquake shook ${esc(place.name.split(",")[0])} hard enough to notice in the last 30 days.</p></div></div>`;
  } else {
    const hardest = nearQuakes.reduce((a, q) => (q.here > a.here ? q : a));
    const [e, word, what] = feelWords(hardest.here);
    const n = nearQuakes.length;
    head = `<div class="enso-top"><div class="big">${e}</div><div><b>${word}</b>
      <p>The strongest shake here this month, ${ago(hardest.time)}. ${what}${n > 1 ? ` ${n} quakes you might have noticed in all.` : ""}</p></div></div>`;
  }
  const rows = nearQuakes.slice(0, 8).map((q) => {
    const [e, word] = feelWords(q.here);
    const felt = q.felt ? ` · ${q.felt.toLocaleString()} people reported feeling it` : "";
    return `<a class="row" href="${esc(q.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
      <div class="e">${e}</div><div><b>${word}</b>
      <span>${ago(q.time)} · ${fmtDist(km(place, q))} away, ${esc(q.place)}${felt} <span class="tag">M${q.mag.toFixed(1)}</span></span></div></a>`;
  }).join("");
  // ShakeAlert covers the US West Coast; MyShake is its free phone app.
  const westCoast = box(place, 32, 49, -125, -114);
  $("shakes").innerHTML = head + (rows ? `<div style="margin-top:10px">${rows}</div>` : "") +
    `<div class="fact">🙋 <b>Felt a shake?</b> <a href="https://earthquake.usgs.gov/data/dyfi/" target="_blank" rel="noopener">Tell USGS what it felt like</a>. New quakes show up here a few minutes after they happen.</div>` +
    (westCoast ? `<div class="fact">📱 <b>Get a warning before the shaking:</b> the free <a href="https://myshake.berkeley.edu" target="_blank" rel="noopener">MyShake app</a> can buzz your phone seconds before a big quake reaches you.</div>` : "");
  $("shakesCard").hidden = false;
}

// ── centers ──

const CENTER_NAME = { ntwc: "Alaska center (US & Canada coasts)", ptwc: "Hawaii center (Hawaii & the Pacific)" };
const CATEGORY = {
  information: ["ℹ️", "Just letting you know. No danger."],
  cancellation: ["✅", "All clear. The danger is over."],
  watch: ["👀", "Watching closely. A wave might come."],
  advisory: ["⚠️", "Strong currents. Stay off beaches."],
  warning: ["🚨", "Danger! Get to high ground."],
  threat: ["🚨", "Danger possible for some coasts."],
};

async function loadCenters() {
  try {
    centers = (await getJson("api/centers")).centers || [];
  } catch {
    $("centers").innerHTML = '<div class="loading">Could not reach tsunami.gov. Trying again soon.</div>';
    return;
  }
  $("centers").innerHTML = centers.map((c) => {
    if (c.empty) return `<div class="row"><div class="e">✅</div><div><b>${CENTER_NAME[c.center]}</b><span>Nothing new.</span></div></div>`;
    const key = Object.keys(CATEGORY).find((k) => (c.category || "").toLowerCase().includes(k)) || "information";
    const [e, words] = CATEGORY[key];
    const when = c.updated ? ago(Date.parse(c.updated)) : "";
    const note = c.note ? `<div class="note">${esc(c.note)}</div>` : "";
    return `<div class="row center"><div class="e">${e}</div><div><b>${words}</b>
      <span>${CENTER_NAME[c.center]} · last said ${when}: ${esc(c.category)} about an M${esc(c.magnitude)} quake, ${esc(c.region)}.
      ${c.bulletin ? `<a href="${esc(c.bulletin)}" target="_blank" rel="noopener">Bulletin</a>` : ""}</span>${note}</div></div>`;
  }).join("");
}

// ── El Nino ──

function ensoWords(v) {
  const a = Math.abs(v);
  const size = a >= 2 ? "Super strong" : a >= 1.5 ? "Strong" : a >= 1 ? "Medium" : "Weak";
  if (v >= 0.5) return { emoji: "🔥", name: `${size} El Niño`, kind: "nino" };
  if (v <= -0.5) return { emoji: "🧊", name: `${size} La Niña`, kind: "nina" };
  return { emoji: "😐", name: "Neutral (normal)", kind: "neutral" };
}

const box = (p, s, n, w, e) => p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e;

// NOAA's typical winter-season El Nino / La Nina effects, by rough region.
// Typical, not promised: each event differs.
function impacts(p, kind) {
  const nino = kind === "nino";
  const out = [];
  if (kind === "neutral") return [["🌤️", "No big push from the Pacific right now. Weather can go either way."]];
  const us = p.cc === "US" || box(p, 24, 50, -125, -66);
  if (box(p, 32, 42.5, -125, -114)) out.push(nino ? ["🌧️", "California: more big winter storms. Watch for floods and mudslides."] : ["☀️", "California: drier winter than usual."]);
  if (us && box(p, 24, 37, -118, -75)) out.push(nino ? ["🌧️", "The southern US gets a wetter, cooler winter."] : ["☀️", "The southern US gets a warmer, drier winter. Drought can grow."]);
  if (box(p, 42, 50, -125, -116)) out.push(nino ? ["🏔️", "Pacific Northwest: warmer, less mountain snow."] : ["❄️", "Pacific Northwest: cold, snowy winter."]);
  if (box(p, 36, 42, -90, -78)) out.push(nino ? ["🌤️", "Ohio Valley: drier winter."] : ["🌧️", "Ohio Valley: wetter winter."]);
  if ((us && p.lat >= 40) || p.cc === "CA" || p.cc === "US" && p.lat > 50) out.push(nino ? ["🧤", "Northern US and Canada: milder winter, less snow."] : ["🥶", "Northern US and Canada: colder winter."]);
  if (box(p, 18, 23, -161, -154)) out.push(nino ? ["☀️", "Hawaii: drier winter, and more hurricanes nearby in summer."] : ["🌧️", "Hawaii: wetter winter."]);
  if (box(p, 5, 45, -100, -55)) out.push(nino ? ["🌀", "Fewer Atlantic hurricanes."] : ["🌀", "More Atlantic hurricanes."]);
  if (box(p, -20, 3, -82, -68)) out.push(nino ? ["🌧️", "Peru and Ecuador: heavy rain and floods. Warm ocean, fewer fish."] : ["🐟", "Peru and Ecuador: cold ocean, lots of fish, dry coast."]);
  if (box(p, -45, -10, 112, 155)) out.push(nino ? ["🔥", "Australia: hotter and drier. More bushfire danger."] : ["🌧️", "Australia: wetter. Floods possible."]);
  if (box(p, -11, 20, 95, 141)) out.push(nino ? ["🏜️", "Indonesia and the Philippines: drier, with forest-fire smoke."] : ["🌧️", "Indonesia and the Philippines: wetter."]);
  if (box(p, 6, 35, 68, 92)) out.push(nino ? ["☁️", "India: weaker monsoon, less rain."] : ["🌧️", "India: stronger monsoon."]);
  if (box(p, -35, -15, 10, 41)) out.push(nino ? ["🏜️", "Southern Africa: drier, hotter summer."] : ["🌧️", "Southern Africa: wetter summer."]);
  if (box(p, -5, 12, 33, 52)) out.push(nino ? ["🌧️", "East Africa: wetter short rains."] : ["🏜️", "East Africa: drier short rains."]);
  if (box(p, -35, -22, -62, -45)) out.push(nino ? ["🌧️", "Southern Brazil, Uruguay, Argentina: wetter."] : ["🏜️", "Southern Brazil, Uruguay, Argentina: drier."]);
  if (box(p, -10, 5, -60, -34)) out.push(nino ? ["🏜️", "Northern Brazil: drier."] : ["🌧️", "Northern Brazil: wetter."]);
  if (box(p, 14, 33, -118, -86)) out.push(nino ? ["🌀", "More Pacific hurricanes off Mexico."] : ["🌀", "Fewer Pacific hurricanes off Mexico."]);
  if (!out.length) out.push(["🌍", nino ? "No strong typical effect where you are, but the whole world runs a little hotter." : "No strong typical effect where you are."]);
  if (nino) out.push(["🌡️", "The whole planet runs hotter. El Niño years often break heat records."]);
  return out;
}

let enso = null;

async function loadEnso() {
  try {
    enso = await getJson("api/enso");
  } catch {
    $("enso").innerHTML = '<div class="loading">Could not reach NOAA. Trying again later.</div>';
    return;
  }
  renderEnso();
}

function renderEnso() {
  if (!enso) return;
  const oni = enso.oni || [];
  const last = oni[oni.length - 1];
  const weekly = enso.weekly;
  // ONI (3-month Nino 3.4 average) is how NOAA names an event; the weekly
  // reading is fresher and noisier, so it is quoted, not used to classify.
  const now = last ? last[2] : weekly ? weekly.nino34Anom : 0;
  const w = ensoWords(now);
  const warm = now >= 0;
  const pctNeedle = Math.max(2, Math.min(98, ((now + 3) / 6) * 100));
  const deg = imperial ? (Math.abs(now) * 1.8).toFixed(1) + "°F" : Math.abs(now).toFixed(1) + "°C";
  const status = enso.discussion?.status || "";
  let html = `<div class="enso-top"><div class="big">${w.emoji}</div><div><b>${w.name}</b>
    <p>The Pacific Ocean near the equator is <b style="display:inline;font-size:inherit">${deg} ${warm ? "warmer" : "colder"}</b> than normal right now.</p></div></div>
    <div class="gauge"><div class="needle" style="left:${pctNeedle}%"></div></div>
    <div class="gauge-labels"><span>🧊 La Niña</span><span>normal</span><span>El Niño 🔥</span></div>`;
  if (weekly) html += `<div class="fact">📈 <b>This week:</b> the ocean there is ${imperial ? (weekly.nino34 * 1.8 + 32).toFixed(0) + "°F" : weekly.nino34.toFixed(1) + "°C"}, ${imperial ? (Math.abs(weekly.nino34Anom) * 1.8).toFixed(1) + "°F" : Math.abs(weekly.nino34Anom).toFixed(1) + "°C"} ${weekly.nino34Anom >= 0 ? "above" : "below"} normal.${weekly.nino34 >= 29 ? " Warm as a heated swimming pool!" : ""}</div>`;
  if (enso.discussion?.synopsis) html += `<div class="fact">📡 <b>NOAA says:</b> ${esc(enso.discussion.synopsis)}${status ? ` <i>(${esc(status)})</i>` : ""}</div>`;
  html += `<h4>What it means ${place ? "where you are" : "around the world"}</h4><ul class="impacts">`;
  const p = place || { lat: 0, lon: 0 };
  for (const [e, t] of impacts(p, w.kind)) html += `<li><span>${e}</span><div>${esc(t)}</div></li>`;
  html += `</ul><h4>The last 30 years</h4><p class="sub" style="margin:0">Red bars = El Niño, blue = La Niña. Look how tall the newest one is.</p><svg id="oniChart" role="img" aria-label="Ocean temperature difference over 30 years"></svg>
    <div class="fact">🤓 <b>Fun fact:</b> <i>El Niño</i> means "the boy" in Spanish. Fishermen in Peru named it, because the warm water shows up around Christmas. Its opposite, <i>La Niña</i>, means "the girl".</div>
    <div class="fact">🌊 <b>Is El Niño a tsunami?</b> Nope! A tsunami is a wave from an earthquake and lasts hours. El Niño is warm water that spreads slowly and lasts months. But it does make the sea rise a bit and bring bigger storm waves.</div>`;
  $("enso").innerHTML = html;
  drawOni(oni);
}

function drawOni(oni) {
  const svg = document.getElementById("oniChart");
  if (!svg || !oni.length) return;
  const W = svg.clientWidth || 600, H = 150, pad = 18;
  const max = Math.max(2.8, ...oni.map((r) => Math.abs(r[2])));
  const y0 = H / 2, k = (H / 2 - pad) / max;
  const bw = (W - 30) / oni.length;
  let s = `<line x1="30" x2="${W}" y1="${y0}" y2="${y0}" stroke="#c7d3e3"/>`;
  s += `<text x="0" y="${pad}">+${max.toFixed(0)}°</text><text x="0" y="${H - 4}">-${max.toFixed(0)}°</text>`;
  oni.forEach((r, i) => {
    const v = r[2], x = 30 + i * bw, h = Math.abs(v) * k;
    const c = v >= 0.5 ? "#e0412f" : v <= -0.5 ? "#2f6fe0" : "#b7c3d3";
    s += `<rect x="${x.toFixed(1)}" y="${(v >= 0 ? y0 - h : y0).toFixed(1)}" width="${Math.max(1, bw - 0.4).toFixed(1)}" height="${h.toFixed(1)}" fill="${c}"/>`;
    if (r[0] === "DJF" && r[1] % 5 === 0) s += `<text x="${x.toFixed(1)}" y="${H - 2}">${r[1]}</text>`;
  });
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = s;
}

// ── choosing a place ──

function setPlace(p, push = true) {
  place = p;
  try { localStorage.setItem("place", JSON.stringify(p)); } catch {}
  if (push) {
    const u = new URL(location.href);
    u.searchParams.set("lat", p.lat.toFixed(4));
    u.searchParams.set("lon", p.lon.toFixed(4));
    u.searchParams.set("name", p.name);
    if (p.cc) u.searchParams.set("cc", p.cc);
    history.replaceState(null, "", u);
  }
  $("hero").className = "card calm";
  $("hero").innerHTML = `<div class="big">🔎</div><h2>Checking…</h2><p class="place">📍 ${esc(p.name)}</p>`;
  nearQuakes = null;
  $("shakesCard").hidden = true;
  loadNear(p);
  loadHeight(p).then(check);
  renderQuakes();
  renderEnso();
}

$("gpsBtn").onclick = () => {
  if (!navigator.geolocation) return alertNoGps();
  $("gpsBtn").textContent = "📍 Finding you…";
  navigator.geolocation.getCurrentPosition(async (pos) => {
    $("gpsBtn").textContent = "📍 Where I am";
    const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Where you are", cc: "" };
    try {
      const r = await getJson(`https://nominatim.openstreetmap.org/reverse?lat=${p.lat}&lon=${p.lon}&format=json&zoom=10`, 6000);
      const a = r.address || {};
      p.name = [a.city || a.town || a.village || a.county, a.state || a.country].filter(Boolean).join(", ") || p.name;
      p.cc = (a.country_code || "").toUpperCase();
    } catch {}
    setPlace(p);
  }, alertNoGps, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
};

function alertNoGps() {
  $("gpsBtn").textContent = "📍 Where I am";
  $("search").placeholder = "No GPS. Type a town…";
  $("search").focus();
}

// Open-Meteo's geocoder prefix-matches worldwide ("hil" finds Hilo), which is
// what a typeahead needs; Nominatim does not.
let suggestions = [];
let sel = -1;
let typingTimer = 0;
$("search").addEventListener("input", () => {
  clearTimeout(typingTimer);
  const q = $("search").value.trim();
  if (q.length < 2) return hideSuggest();
  typingTimer = setTimeout(async () => {
    try {
      const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en`, 6000);
      if ($("search").value.trim() !== q) return;
      suggestions = (j.results || []).map((r) => ({
        lat: r.latitude, lon: r.longitude, cc: r.country_code || "",
        name: [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : null, r.country_code !== "US" ? r.country : null].filter(Boolean).join(", "),
      }));
      showSuggest();
    } catch {}
  }, 180);
});

function showSuggest() {
  sel = -1;
  if (!suggestions.length) return hideSuggest();
  $("suggest").innerHTML = suggestions.map((s, i) => `<div data-i="${i}">${esc(s.name)}</div>`).join("");
  $("suggest").hidden = false;
}
function hideSuggest() { $("suggest").hidden = true; suggestions = []; }
function pick(i) {
  const s = suggestions[i];
  if (!s) return;
  hideSuggest();
  $("search").value = "";
  $("search").blur();
  setPlace(s);
}
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
  } else if (e.key === "Escape") hideSuggest();
});
$("search").addEventListener("blur", () => setTimeout(hideSuggest, 150));
$("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  // Enter takes the highlighted row, else the top one: same place the list offered.
  if (suggestions.length) pick(sel >= 0 ? sel : 0);
});

// ── start ──

function initialPlace() {
  const u = new URLSearchParams(location.search);
  const lat = parseFloat(u.get("lat")), lon = parseFloat(u.get("lon"));
  if (isFinite(lat) && isFinite(lon)) return { lat, lon, name: u.get("name") || "This spot", cc: u.get("cc") || "" };
  try { return JSON.parse(localStorage.getItem("place") || "null"); } catch { return null; }
}

async function refresh() {
  await Promise.all([loadQuakes(), loadCenters(), place ? loadNear(place) : null]);
  check();
}

(async () => {
  const p = initialPlace();
  loadEnso();
  await Promise.all([loadQuakes(), loadCenters()]);
  if (p) setPlace(p, false);
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
})();
