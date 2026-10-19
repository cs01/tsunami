// The tsunami page: one answer (green / yellow / orange / red) for one place,
// then whether the spot itself is safe ground, the ocean quakes, what the
// warning centers last said, and El Nino. Shared helpers live in common.js.
"use strict";

let quakes = [];
let centers = [];
let ground = null; // {elev, coastKm, level}

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

function alertLevel(ev) {
  if (/warning/i.test(ev)) return "red";
  if (/advisory/i.test(ev)) return "orange";
  if (/watch/i.test(ev)) return "yellow";
  return "green";
}

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
    if (d < 3000) out.push({ c, d });
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
  $("hero").innerHTML = `<div class="dot">${mark}</div><h2>${title}</h2><p>${msg}</p>
    <div class="place">${esc(place.name)}</div>${extra}
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
const oceanQuakes = () => quakes.filter((q) => q.tsunami);

function renderQuakes() {
  const list = oceanQuakes();
  if (!list.length) {
    $("quakes").innerHTML = row("green", "No big ocean earthquakes in the last 30 days", "Nothing that could start a tsunami.");
  } else {
    $("quakes").innerHTML = list.slice(0, 10).map((q) => {
      const level = q.alert || "none";
      const far = place ? ` · ${fmtDist(km(place, q))} from you` : "";
      return row(level, esc(q.place), `${chip(level, PAGER[q.alert] || "No damage report")} ${ago(q.time)}${far} · M${q.mag.toFixed(1)}`, q.url);
    }).join("");
  }
  if (!window.L) return;
  map = quakeMap("map", map);
  plotQuakes(map, list.map((q) => ({ ...q, level: q.alert || "none", label: `<b>${esc(q.place)}</b><br>M${q.mag.toFixed(1)} · ${ago(q.time)}` })), place, 4);
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
  $("centers").innerHTML = centers.map((c) => {
    if (c.empty) return row("green", CENTER_NAME[c.center], "Nothing new.");
    const key = Object.keys(CATEGORY).find((k) => (c.category || "").toLowerCase().includes(k)) || "information";
    const [level, words] = CATEGORY[key];
    const when = c.updated ? ago(Date.parse(c.updated)) : "";
    const note = c.note ? `<div class="note">${esc(c.note)}</div>` : "";
    const link = c.bulletin ? ` <a href="${esc(c.bulletin)}" target="_blank" rel="noopener">Bulletin</a>` : "";
    return row(level, chip(level, words), `${CENTER_NAME[c.center]} · last said ${when}: ${esc(c.category)} about an M${esc(c.magnitude)} quake, ${esc(c.region)}.${link}${note}`);
  }).join("");
}

// ── El Nino ──

function ensoWords(v) {
  const a = Math.abs(v);
  const size = a >= 2 ? "Super strong" : a >= 1.5 ? "Strong" : a >= 1 ? "Medium" : "Weak";
  if (v >= 0.5) return { name: `${size} El Niño`, kind: "nino", level: a >= 1.5 ? "red" : a >= 1 ? "orange" : "yellow" };
  if (v <= -0.5) return { name: `${size} La Niña`, kind: "nina", level: "blue" };
  return { name: "Neutral (normal)", kind: "neutral", level: "green" };
}

// NOAA's typical winter-season El Nino / La Nina effects, by rough region.
// Typical, not promised: each event differs.
function impacts(p, kind) {
  const nino = kind === "nino";
  const out = [];
  if (kind === "neutral") return ["No big push from the Pacific right now. Weather can go either way."];
  const us = p.cc === "US" || box(p, 24, 50, -125, -66);
  if (box(p, 32, 42.5, -125, -114)) out.push(nino ? "California: more big winter storms. Watch for floods and mudslides." : "California: drier winter than usual.");
  if (us && box(p, 24, 37, -118, -75)) out.push(nino ? "The southern US gets a wetter, cooler winter." : "The southern US gets a warmer, drier winter. Drought can grow.");
  if (box(p, 42, 50, -125, -116)) out.push(nino ? "Pacific Northwest: warmer, less mountain snow." : "Pacific Northwest: cold, snowy winter.");
  if (box(p, 36, 42, -90, -78)) out.push(nino ? "Ohio Valley: drier winter." : "Ohio Valley: wetter winter.");
  if ((us && p.lat >= 40) || p.cc === "CA") out.push(nino ? "Northern US and Canada: milder winter, less snow." : "Northern US and Canada: colder winter.");
  if (box(p, 18, 23, -161, -154)) out.push(nino ? "Hawaii: drier winter, and more hurricanes nearby in summer." : "Hawaii: wetter winter.");
  if (box(p, 5, 45, -100, -55)) out.push(nino ? "Fewer Atlantic hurricanes." : "More Atlantic hurricanes.");
  if (box(p, -20, 3, -82, -68)) out.push(nino ? "Peru and Ecuador: heavy rain and floods. Warm ocean, fewer fish." : "Peru and Ecuador: cold ocean, lots of fish, dry coast.");
  if (box(p, -45, -10, 112, 155)) out.push(nino ? "Australia: hotter and drier. More bushfire danger." : "Australia: wetter. Floods possible.");
  if (box(p, -11, 20, 95, 141)) out.push(nino ? "Indonesia and the Philippines: drier, with forest-fire smoke." : "Indonesia and the Philippines: wetter.");
  if (box(p, 6, 35, 68, 92)) out.push(nino ? "India: weaker monsoon, less rain." : "India: stronger monsoon.");
  if (box(p, -35, -15, 10, 41)) out.push(nino ? "Southern Africa: drier, hotter summer." : "Southern Africa: wetter summer.");
  if (box(p, -5, 12, 33, 52)) out.push(nino ? "East Africa: wetter short rains." : "East Africa: drier short rains.");
  if (box(p, -35, -22, -62, -45)) out.push(nino ? "Southern Brazil, Uruguay, Argentina: wetter." : "Southern Brazil, Uruguay, Argentina: drier.");
  if (box(p, -10, 5, -60, -34)) out.push(nino ? "Northern Brazil: drier." : "Northern Brazil: wetter.");
  if (box(p, 14, 33, -118, -86)) out.push(nino ? "More Pacific hurricanes off Mexico." : "Fewer Pacific hurricanes off Mexico.");
  if (!out.length) out.push(nino ? "No strong typical effect where you are, but the whole world runs a little hotter." : "No strong typical effect where you are.");
  if (nino) out.push("The whole planet runs hotter. El Niño years often break heat records.");
  return out;
}

// CPC writes weeks as "07OCT2026".
const weekDate = (w) => w.length === 9 ? `${w.slice(2, 3) + w.slice(3, 5).toLowerCase()} ${+w.slice(0, 2)}` : w;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const degC = (v) => imperial ? (Math.abs(v) * 1.8).toFixed(1) + "°F" : Math.abs(v).toFixed(1) + "°C";

// El Nino is declared from the surface water, but it only becomes a full event
// when the air joins in (the SOI) and lasts while warm water piles up below
// (heat content). These three are what NOAA watches.
function signals(enso, oniNow) {
  const out = [];
  const w = ensoWords(oniNow);
  out.push({
    level: w.level === "blue" ? "yellow" : w.level,
    name: "Warm water on top",
    value: `${degC(oniNow)} ${oniNow >= 0 ? "warmer" : "colder"} than normal`,
    what: "The sea surface along the equator in the middle of the Pacific. This is the number that decides if it's El Niño: 0.5°C (0.9°F) warmer or more, for months.",
  });
  const heat = enso.heat || [];
  if (heat.length) {
    const h = heat[heat.length - 1], before = heat[Math.max(0, heat.length - 4)];
    const rising = h[2] > before[2] + 0.1, falling = h[2] < before[2] - 0.1;
    out.push({
      level: h[2] >= 1.5 ? "red" : h[2] >= 0.5 ? "orange" : h[2] <= -0.5 ? "yellow" : "green",
      name: "Warm water underneath",
      value: `${degC(h[2])} ${h[2] >= 0 ? "warmer" : "colder"}, ${rising ? "still rising" : falling ? "starting to drop" : "holding steady"}`,
      what: `The top 300 m (1,000 ft) of ocean, ${MONTHS[h[1] - 1]} ${h[0]}. This is the fuel tank: warm water below feeds the warm water on top. While it stays warm, El Niño keeps going. When it cools, El Niño is about to fade.`,
    });
  }
  const soi = enso.soi || [];
  if (soi.length) {
    const recent = soi.slice(-3);
    const avg = recent.reduce((a, r) => a + r[2], 0) / recent.length;
    const last = soi[soi.length - 1];
    out.push({
      level: avg <= -1.5 ? "red" : avg <= -0.7 ? "orange" : avg >= 0.7 ? "yellow" : "green",
      name: "The air joins in",
      value: `pressure seesaw at ${avg.toFixed(1)}`,
      what: `The Southern Oscillation Index: air pressure at Tahiti minus Darwin, Australia (3-month average to ${MONTHS[last[1] - 1]} ${last[0]}). When it goes negative, the trade winds that push warm water west get weak, so the warm water sloshes east. Below -1 means the air is really helping El Niño.`,
    });
  }
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
  const pctNeedle = Math.max(2, Math.min(98, ((now + 3) / 6) * 100));
  const status = enso.discussion?.status || "";
  let html = `<div class="enso-top">${chip(w.level, w.name)}
    <p>The Pacific Ocean along the equator is <b>${degC(now)} ${now >= 0 ? "warmer" : "colder"}</b> than normal.</p></div>
    <div class="gauge"><div class="needle" style="left:${pctNeedle}%"></div></div>
    <div class="gauge-labels"><span>La Niña</span><span>normal</span><span>El Niño</span></div>`;
  if (enso.discussion?.synopsis) html += `<div class="fact"><b>NOAA says:</b> ${esc(enso.discussion.synopsis)}${status ? ` <i>(${esc(status)})</i>` : ""}</div>`;

  html += `<h4>What to watch</h4><p class="sub" style="margin:0 0 6px">El Niño is more than warm water. It's the ocean and the air pushing each other. NOAA watches three things:</p>`;
  for (const s of signals(enso, now)) html += row(s.level, `${s.name}: ${chip(s.level, s.value)}`, s.what);
  if (weekly) html += `<p class="sub" style="margin:6px 0 0">The week of ${esc(weekDate(weekly.week))} the surface there is ${imperial ? (weekly.nino34 * 1.8 + 32).toFixed(0) + "°F" : weekly.nino34.toFixed(1) + "°C"}, ${degC(weekly.nino34Anom)} above the weekly normal.</p>`;

  html += `<h4>What it means ${place ? "where you are" : "around the world"}</h4><ul class="impacts">`;
  for (const t of impacts(place || { lat: 0, lon: 0 }, w.kind)) html += `<li>${esc(t)}</li>`;
  html += `</ul><h4>The last 30 years</h4><p class="sub" style="margin:0">Red bars = El Niño, blue = La Niña. The two tallest before now were 1997 and 2015.</p><svg id="oniChart" role="img" aria-label="Ocean temperature difference over 30 years"></svg>
    <div class="fact"><b>Is El Niño a tsunami?</b> No. A tsunami is a wave from an earthquake and lasts hours. El Niño is warm water that spreads slowly and lasts months. It does raise the sea a little and bring bigger storm waves.</div>
    <div class="fact"><b>Where the name comes from:</b> <i>El Niño</i> means "the boy" in Spanish. Fishermen in Peru named it because the warm water shows up around Christmas. Its opposite, <i>La Niña</i>, means "the girl".</div>`;
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

// ── start ──

function showPlace(p) {
  $("hero").className = "card lv-none";
  $("hero").innerHTML = `<div class="dot">…</div><h2>Checking…</h2><p class="place">${esc(p.name)}</p>`;
  loadGround(p).then(check);
  loadTeaser(p);
  renderQuakes();
  renderEnso();
}

async function refresh() {
  await Promise.all([loadQuakes(), loadCenters()]);
  check();
}

(async () => {
  loadEnso();
  await Promise.all([loadQuakes(), loadCenters()]);
  initPicker(showPlace);
  if (!place) $("height").innerHTML = '<div class="txt"><p>Pick a place and I\'ll tell you if it\'s high enough and far enough from the ocean to be safe from tsunamis.</p></div>';
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
})();
