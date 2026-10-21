// The earthquake page: how hard the ground shook where you are (by felt
// intensity, not magnitude) and what each level feels like. Tapping a quake
// draws its shaking zones on the map. Helpers live in common.js.
"use strict";

const NEAR_KM = 500;
const FEEL_MIN = 3; // MMI III: people indoors notice

let near = null;
let nearMap = null;
let nearPick = null; // the quake whose zones the near map shows

function fromFeature(f) {
  return {
    id: f.id, mag: f.properties.mag ?? 0, place: f.properties.place || "Somewhere", time: f.properties.time,
    felt: f.properties.felt || 0, url: f.properties.url, detail: f.properties.detail,
    alert: f.properties.alert, mmi: f.properties.mmi, depth: f.geometry.coordinates[2],
    lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
  };
}

async function loadNear(p) {
  const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 19);
  try {
    const j = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}&maxradiuskm=${NEAR_KM}&starttime=${since}&minmagnitude=2.5&orderby=time&limit=300`);
    if (p !== place) return;
    near = j.features.map((f) => {
      const q = fromFeature(f);
      q.here = intensity(q.mag, km(p, q), q.depth);
      return q;
    // Only what you'd notice here. USGS "felt" counts come from people near the
    // quake, not near you, so they can't stand in for it.
    }).filter((q) => q.here >= FEEL_MIN);
  } catch {
    if (p === place && !near) $("near").innerHTML = '<div class="loading">Could not reach USGS. Trying again soon.</div>';
    return;
  }
  renderNear();
}

const HERO_MARK = { green: "✓", yellow: "!", orange: "!", red: "!!" };
const hardest = (list) => list.reduce((a, q) => (!a || q.here > a.here ? q : a), null);
const details = (q) => ` · <a href="${esc(q.url)}" target="_blank" rel="noopener">details</a>`;

function renderNear() {
  if (!place || !near) return;
  // The answer is about today; the month is context.
  const today = near.filter((q) => Date.now() - q.time < 86400e3);
  const t = hardest(today), m = hardest(near);
  let level, title, msg;
  if (t) {
    const s = shake(t.here);
    level = s.level;
    title = s.word;
    msg = `${ago(t.time)}, ${fmtDist(km(place, t))} away. ${s.what}`;
  } else {
    level = "green";
    title = "No shaking here today";
    msg = m ? `The last one you'd have felt: ${shake(m.here).word.toLowerCase()}, ${ago(m.time)}.` : "Nothing you'd have felt in the last 30 days either.";
  }
  $("hero").className = "card lv-" + level;
  $("hero").innerHTML = `<div class="dot">${HERO_MARK[level]}</div><h2>${title}</h2><p>${msg}</p>
    <div class="place">${esc(place.name)}</div>
    <div class="updated">Checked ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · USGS · rechecks every minute. New quakes show up a few minutes after they happen.</div>`;

  const shown = near.slice(0, 12);
  // Keep the picked quake across refreshes; default to the hardest-felt one.
  if (!nearPick || !near.some((q) => q.id === nearPick.id)) nearPick = m;
  $("near").innerHTML = shown.length
    ? shown.map((q, i) => {
        const s = shake(q.here);
        const felt = q.felt ? ` · ${q.felt.toLocaleString()} people reported feeling it` : "";
        return row(s.level, chip(s.level, s.word), `${ago(q.time)} · ${fmtDist(km(place, q))} away, ${esc(q.place)}${felt} · M${q.mag.toFixed(1)}${details(q)}`, null, i);
      }).join("")
    : row("green", "Nothing you'd feel in the last 30 days", "Small quakes may have happened, but too small or far away to notice here.");
  markPicked("near", shown, nearPick);
  if (window.L) {
    nearMap = quakeMap("nearMap", nearMap);
    plotQuakes(nearMap, near.map((q) => ({ ...q, level: shake(q.here).level, picked: q === nearPick, label: `<b>${esc(shake(q.here).word)}</b><br>${esc(q.place)}<br>${ago(q.time)} · M${q.mag.toFixed(1)}` })), place, 9, (i) => pickNear(near[i]), placeKey());
    showZones(nearMap, nearPick, $("nearZone"), place);
    if (!nearPick) $("nearZone").innerHTML = "Tap a quake to see how far its shaking reached.";
  }

  // ShakeAlert covers the US West Coast; MyShake is its free phone app.
  $("extras").innerHTML = `<div class="fact"><b>Felt a shake?</b> <a href="https://earthquake.usgs.gov/data/dyfi/" target="_blank" rel="noopener">Tell USGS what it felt like</a>. It helps them map the shaking.</div>` +
    (box(place, 32, 49, -125, -114) ? `<div class="fact"><b>Get a warning before the shaking:</b> the free <a href="https://myshake.berkeley.edu" target="_blank" rel="noopener">MyShake app</a> can buzz your phone seconds before a big quake reaches you.</div>` : "");
}

const placeKey = () => (place ? `${place.lat},${place.lon}` : "none");

function markPicked(listId, shown, picked) {
  [...$(listId).querySelectorAll("[data-pick]")].forEach((r) => r.classList.toggle("picked", shown[+r.dataset.pick] === picked));
}

function pickNear(q) {
  nearPick = q;
  renderNear();
  $("nearMap").scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderScale() {
  $("scale").innerHTML = SHAKE.slice(1).map((s) => row(s.level, chip(s.level, s.word), s.what)).join("");
}

function showPlace(p) {
  near = null;
  nearPick = null;
  $("hero").className = "card lv-none";
  $("hero").innerHTML = `<div class="dot">…</div><h2>Checking…</h2><p class="place">${esc(p.name)}</p>`;
  loadNear(p);
}

(async () => {
  renderScale();
  onPick($("near"), (i) => pickNear(near[i]));
  initPicker(showPlace);
  if (!place) $("near").innerHTML = row("none", "Pick a place", "Tap Where I am or type a town to see the shakes you'd feel there.");
  const refresh = () => { if (place) loadNear(place); };
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
})();
