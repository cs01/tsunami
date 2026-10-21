// The tsunami page: one answer (green / yellow / orange / red) for one place,
// then whether the spot itself is safe ground, the ocean quakes near it, and
// what the warning centers last said about them. Shared helpers live in common.js.
"use strict";

let quakes = [];
let centers = [];
let ground = null; // {elev, coastKm, level}

// ── the answer ──

// NWS issues tsunami alerts per US coastal zone, so a point query is exact.
// Outside the US it has no zones and errors, which just means "no NWS answer".
// NWS sends tests and exercises through the same feed ("TEST Tsunami Warning",
// status Test, severity Extreme): one turned this page red for the Bay Area on
// 2026-10-21. Only status Actual may move the answer. The query asks for that and
// the filter re-checks it, since a test that slipped through means a false evacuation.
const isActual = (a) => a.status === "Actual";

async function nwsAlerts(p) {
  try {
    const j = await getJson(`https://api.weather.gov/alerts/active?status=actual&point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`);
    return (j.features || []).map((f) => f.properties).filter((a) => isActual(a) && /tsunami/i.test(a.event || ""));
  } catch {
    return null;
  }
}

function alertLevel(ev) {
  if (/warning/i.test(ev)) return "red";
  if (/advisory/i.test(ev)) return "orange";
  if (/watch/i.test(ev)) return "yellow";
  return "green";
}

// How far an ocean quake can be and still matter here. Everything on the page
// (quakes, bulletins, danger zones) is cut to this, so far-off events stay off.
const REACH_KM = 3200;
const REACH_TXT = imperial ? "2,000 miles" : "3,200 km";

// The centers' feeds name an earthquake, not the coasts it threatens. A live
// (non-"Information") bulletin near a spot that isn't safe ground is a reason
// to listen for news, never a warning we invent.
function centerConcern(p) {
  const out = [];
  for (const c of centers) {
    if (c.empty || !c.updated) continue;
    const ageH = (Date.now() - Date.parse(c.updated)) / 3.6e6;
    if (ageH > 12 || /information|cancel/i.test(c.category || "")) continue;
    const d = km(p, { lat: c.lat, lon: c.lon });
    if (d < REACH_KM) out.push({ c, d });
  }
  return out;
}

async function check() {
  if (!place) return;
  const p = place;
  const alerts = await nwsAlerts(p);
  if (p !== place) return;
  let level = "green";
  let html = "";
  for (const a of alerts || []) {
    level = worse(level, alertLevel(a.event));
    html += `<div class="alert"><b>${esc(a.event)}</b><br>${esc(a.headline || "")}${a.instruction ? "<br><br>" + esc(a.instruction).replace(/\n/g, "<br>") : ""}</div>`;
  }
  const exposed = !ground || ground.level !== "green";
  if (level === "green" && exposed) {
    for (const { c, d } of centerConcern(p)) {
      level = "yellow";
      html += `<div class="alert"><b>${esc(c.category)}: ${esc(c.region)}</b><br>Magnitude ${esc(c.magnitude)}, ${fmtDist(d)} away. ${c.bulletin ? `<a href="${esc(c.bulletin)}" target="_blank" rel="noopener">Read the bulletin</a>` : ""}</div>`;
    }
    // A big shake close by in the last few hours: the shake itself is the warning.
    const q = quakes.find((q) => q.mag >= 6.5 && Date.now() - q.time < 3 * 3.6e6 && km(p, q) < 1000);
    if (q) {
      level = "yellow";
      html += `<div class="alert"><b>Big earthquake ${ago(q.time)}</b><br>${esc(q.place)}, ${fmtDist(km(p, q))} away.</div>`;
    }
  }
  renderHero(level, html, alerts !== null);
}

const HERO = {
  green: ["✓", "No tsunami coming", "The ocean is calm here. Go have fun!"],
  yellow: ["!", "Keep an eye out", "Something big happened in the ocean. Scientists are checking. Stay near a grown-up and listen for news."],
  orange: ["!", "Stay away from the beach", "Strong waves and currents are coming. Get out of the water and off the beach."],
  red: ["!!", "GO TO HIGH GROUND NOW", "A tsunami may be coming. Walk uphill or far from the ocean right now. Don't wait!"],
};

function renderHero(level, extra, haveNws) {
  const [mark, title, msg] = HERO[level];
  $("hero").className = "card lv-" + level;
  const src = haveNws ? "NWS alerts + tsunami.gov" : "tsunami.gov + USGS";
  // "GO TO HIGH GROUND NOW" stays short; the place goes on its own line there.
  const head = level === "red" ? title : title + inPlace(place);
  $("hero").innerHTML = `<div class="dot">${mark}</div><h2>${esc(head)}</h2><p>${msg}</p>
    ${level === "red" ? `<div class="place">${esc(place.name)}</div>` : ""}${extra}
    <div class="updated">Checked ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${src} · rechecks every minute</div>`;
}

// ── is this spot safe ground? ──

// NOAA's evacuation rule of thumb: 100 ft (30 m) up or 2 miles (3 km) inland.
// The coastline data is only good to a couple of km, so "inland" needs margin.
const SAFE_UP_M = 30, SAFE_INLAND_KM = 8;
const OK_UP_M = 10, OK_INLAND_KM = 3;

async function loadGround(p) {
  ground = null;
  const [e, c] = await Promise.allSettled([
    getJson(`https://api.open-meteo.com/v1/elevation?latitude=${p.lat}&longitude=${p.lon}`),
    getJson(`api/coast?lat=${p.lat}&lon=${p.lon}`),
  ]);
  if (p !== place) return;
  const elev = e.status === "fulfilled" ? e.value.elevation?.[0] : null;
  const coastKm = c.status === "fulfilled" ? c.value.km : null;
  if (elev == null && coastKm == null) {
    $("height").innerHTML = '<div class="txt"><p>Could not look up the height here. Try again in a bit.</p></div>';
    return;
  }
  const up = Math.max(0, elev ?? 0);
  let level, head, body;
  if ((elev != null && up >= SAFE_UP_M) || (coastKm != null && coastKm >= SAFE_INLAND_KM)) {
    level = "green";
    head = "Safe from tsunamis here";
    body = coastKm != null && coastKm >= SAFE_INLAND_KM
      ? "You're far enough from the ocean that tsunami waves can't reach you."
      : "You're higher than tsunami waves go. If you're ever near the beach in a warning, this is the kind of place to go.";
  } else if ((elev != null && up >= OK_UP_M) || (coastKm != null && coastKm >= OK_INLAND_KM)) {
    level = "yellow";
    head = "Safe from most tsunamis, not the biggest";
    body = "In a tsunami warning, go higher or farther inland: 100 ft up or 2 miles from the water.";
  } else {
    level = "red";
    head = "Not safe in a tsunami";
    body = "You're low and close to the ocean. If there's a warning or a long, strong shake, go 100 ft up or 2 miles inland right away. Look for the blue tsunami route signs.";
  }
  ground = { elev, coastKm, level };
  const facts = [];
  if (elev != null) facts.push(`<b>${fmtHeight(up)}</b> above the sea`);
  if (coastKm != null) facts.push(coastKm < 0.5 ? "<b>right by</b> the ocean" : `<b>${fmtDist(coastKm)}</b> from the ocean`);
  // The meter: sea at the bottom, NOAA's 100 ft line, and you.
  const top = Math.max(50, Math.min(up * 1.15, 60));
  const pct = (v) => Math.min(94, (v / top) * 100);
  $("height").className = "card lv-" + level;
  $("height").innerHTML = `<div class="meter">
      <div class="sea" style="height:4%"></div>
      <div class="line" style="bottom:${pct(SAFE_UP_M)}%"><span>${imperial ? "100 ft" : "30 m"}</span></div>
      <div class="me" style="bottom:${pct(up)}%"></div>
    </div>
    <div class="txt">${chip(level, head)}<p class="facts">${facts.join(" · ")}</p><p>${body}</p></div>`;
}

// ── ocean quakes ──

let map = null;

async function loadQuakes() {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  try {
    const j = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=6&starttime=${since}&orderby=time&limit=60`);
    quakes = j.features.map((f) => ({
      mag: f.properties.mag, place: f.properties.place || "Somewhere", time: f.properties.time,
      tsunami: f.properties.tsunami === 1, url: f.properties.url, alert: f.properties.alert,
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    }));
  } catch {
    $("quakes").innerHTML = '<div class="loading">Could not reach USGS. Trying again soon.</div>';
    return;
  }
  renderQuakes();
}

// USGS sets its tsunami flag on big quakes in ocean regions: the ones that matter here.
const oceanQuakes = () => place ? quakes.filter((q) => q.tsunami && km(place, q) < REACH_KM) : [];

function renderQuakes() {
  const list = oceanQuakes();
  if (!place) {
    $("quakes").innerHTML = row("none", "Pick a place", "Then you'll see the big ocean earthquakes close enough to matter there.");
  } else if (!list.length) {
    $("quakes").innerHTML = row("green", "No big ocean earthquakes near you in the last 30 days", `Nothing within ${REACH_TXT} that could start a tsunami.`);
  } else {
    $("quakes").innerHTML = list.slice(0, 10).map((q) => {
      const level = q.alert || "none";
      const far = place ? ` · ${fmtDist(km(place, q))} from you` : "";
      return row(level, esc(q.place), `${chip(level, PAGER[q.alert] || "No damage report")} ${ago(q.time)}${far} · M${q.mag.toFixed(1)}`, q.url);
    }).join("");
  }
  if (!window.L) return;
  map = quakeMap("map", map);
  plotQuakes(map, list.map((q) => ({ ...q, level: q.alert || "none", label: `<b>${esc(q.place)}</b><br>M${q.mag.toFixed(1)} · ${ago(q.time)}` })), place, 4, null, place ? `${place.lat},${place.lon}` : "none");
  renderTsuZones();
}

// ── tsunami danger zones ──

// A tsunami's danger zone is the stretch of coast under an alert, not a circle.
// NWS publishes these for US coasts: polygons on the alert, or zone IDs whose
// shapes live at their own URLs (cached; coastal zones don't move).
const TSU_KEY = `<div class="zone-key"><span class="chip red">Warning: go to high ground</span><span class="chip orange">Advisory: stay off the beach</span><span class="chip yellow">Watch: be ready</span></div>`;
const zoneShapes = new Map();
let tsuAlerts = []; // [{level, event, area, geom: [GeoJSON geometry]}], null if NWS failed

async function zoneShape(url) {
  if (!zoneShapes.has(url)) zoneShapes.set(url, getJson(url, 8000).then((z) => z.geometry).catch(() => null));
  return zoneShapes.get(url);
}

async function loadTsuZones() {
  try {
    const j = await getJson("https://api.weather.gov/alerts/active?status=actual&event=Tsunami%20Warning,Tsunami%20Advisory,Tsunami%20Watch");
    tsuAlerts = await Promise.all(j.features.filter((f) => isActual(f.properties)).map(async (f) => {
      const a = f.properties;
      const geom = f.geometry ? [f.geometry] : (await Promise.all((a.affectedZones || []).slice(0, 60).map(zoneShape))).filter(Boolean);
      return { level: alertLevel(a.event), event: a.event, area: a.areaDesc || "", geom };
    }));
  } catch {
    tsuAlerts = null;
  }
  renderTsuZones();
}

// Alerts whose coast comes within REACH_KM of the place; all of them before a place is picked.
function nearAlerts() {
  if (!place || !tsuAlerts) return tsuAlerts;
  return tsuAlerts.filter((a) => a.geom.some((g) => {
    const c = L.geoJSON(g).getBounds().getCenter();
    return km(place, { lat: c.lat, lon: c.lng }) < REACH_KM;
  }));
}

function renderTsuZones() {
  if (!map) return;
  map.zones.clearLayers();
  const tsuAlerts = nearAlerts();
  if (tsuAlerts === null) {
    $("tsuZone").innerHTML = "Could not reach the National Weather Service for danger zones. Trying again soon." + TSU_KEY;
    return;
  }
  if (!tsuAlerts.length) {
    $("tsuZone").innerHTML = `${chip("green", "No tsunami danger zones right now")} When there's an alert, the coasts in danger get colored here.${TSU_KEY}`;
    map.zoneFor = null;
    return;
  }
  const order = ["yellow", "orange", "red"];
  const b = L.latLngBounds([]);
  // Mildest first, so a warning draws over a watch on the same coast.
  for (const a of tsuAlerts.slice().sort((x, y) => order.indexOf(x.level) - order.indexOf(y.level))) {
    const c = LEVEL_COLOR[a.level];
    for (const g of a.geom) {
      const layer = L.geoJSON(g, { style: { color: c, weight: 3, fillColor: c, fillOpacity: 0.35 } }).bindTooltip(esc(a.event)).addTo(map.zones);
      b.extend(layer.getBounds());
    }
  }
  $("tsuZone").innerHTML = tsuAlerts.map((a) => `${chip(a.level, a.event)} ${esc(a.area.length > 140 ? a.area.slice(0, 140) + "…" : a.area)}`).join("<br>") + TSU_KEY;
  // Fit once per set of alerts, not every minute.
  const key = tsuAlerts.map((a) => a.event + a.area).join("|");
  if (map.zoneFor !== key && b.isValid()) {
    if (place) b.extend([place.lat, place.lon]);
    map.fitBounds(b, { padding: [16, 16], maxZoom: 7 });
  }
  map.zoneFor = key;
}

// ── earthquake teaser ──

// One line about local shaking; the earthquake page has the rest.
async function loadTeaser(p) {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 19);
  try {
    const j = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}&maxradiuskm=500&starttime=${since}&minmagnitude=2.5&orderby=time&limit=300`);
    if (p !== place) return;
    let best = null;
    for (const f of j.features) {
      const q = { mag: f.properties.mag ?? 0, time: f.properties.time, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
      q.here = intensity(q.mag, km(p, q), f.geometry.coordinates[2]);
      if (q.here >= 3 && (!best || q.here > best.here)) best = q;
    }
    const s = best ? shake(best.here) : null;
    $("quakeTeaser").innerHTML = best
      ? `Strongest shaking here this month: ${chip(s.level, s.word)} ${ago(best.time)}.`
      : `${chip("green", "Nothing you'd feel")} No earthquake shook here hard enough to notice this month.`;
  } catch {}
}

// ── centers ──

const CENTER_NAME = { ntwc: "Alaska center (US and Canada coasts)", ptwc: "Hawaii center (Hawaii and the Pacific)" };
const CATEGORY = {
  information: ["green", "Just letting you know. No danger."],
  cancellation: ["green", "All clear. The danger is over."],
  watch: ["yellow", "Watching closely. A wave might come."],
  advisory: ["orange", "Strong currents. Stay off beaches."],
  warning: ["red", "Danger! Get to high ground."],
  threat: ["red", "Danger possible for some coasts."],
};

async function loadCenters() {
  try {
    centers = (await getJson("api/centers")).centers || [];
  } catch {
    $("centers").innerHTML = '<div class="loading">Could not reach tsunami.gov. Trying again soon.</div>';
    return;
  }
  renderCenters();
}

function renderCenters() {
  if (!place) {
    $("centers").innerHTML = row("none", "Pick a place", "Then you'll see what the centers say about quakes near it.");
    return;
  }
  const near = centers.filter((c) => !c.empty && c.updated && km(place, { lat: c.lat, lon: c.lon }) < REACH_KM);
  if (!near.length) {
    $("centers").innerHTML = row("green", "Nothing about your area", `No bulletins about quakes within ${REACH_TXT} of here.`);
    return;
  }
  $("centers").innerHTML = near.map((c) => {
    const key = Object.keys(CATEGORY).find((k) => (c.category || "").toLowerCase().includes(k)) || "information";
    const [level, words] = CATEGORY[key];
    const when = c.updated ? ago(Date.parse(c.updated)) : "";
    const note = c.note ? `<div class="note">${esc(c.note)}</div>` : "";
    const link = c.bulletin ? ` <a href="${esc(c.bulletin)}" target="_blank" rel="noopener">Bulletin</a>` : "";
    return row(level, chip(level, words), `${CENTER_NAME[c.center]} · last said ${when}: ${esc(c.category)} about an M${esc(c.magnitude)} quake, ${esc(c.region)}.${link}${note}`);
  }).join("");
}

function showPlace(p) {
  $("hero").className = "card lv-none";
  $("hero").innerHTML = `<div class="dot">…</div><h2>Checking${esc(inPlace(p))}…</h2>`;
  loadGround(p).then(check);
  loadTeaser(p);
  renderQuakes();
  renderCenters();
}

async function refresh() {
  await Promise.all([loadQuakes(), loadCenters(), loadTsuZones()]);
  check();
}

(async () => {
  await Promise.all([loadQuakes(), loadCenters(), loadTsuZones()]);
  initPicker(showPlace);
  if (!place) $("height").innerHTML = '<div class="txt"><p>Pick a place and I\'ll tell you if it\'s high enough and far enough from the ocean to be safe from tsunamis.</p></div>';
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
})();
