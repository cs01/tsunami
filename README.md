# tsunami

Tsunami Check: is a tsunami coming, was that an earthquake, and what is El Niño doing, in words a five year old can follow. Live at https://chadsmith.dev/tsunami/

- `app/app.milo`: Milo server. Proxies and caches the NOAA tsunami warning center Atom feeds and the CPC El Niño data (neither sends CORS headers) as small JSON at `/api/centers` and `/api/enso`; embeds the page.
- `app/public/`: two pages (tsunami at `/tsunami/`, earthquakes at `/tsunami/earthquakes`) sharing `common.js`. They fetch CORS-open sources directly: NWS point alerts, USGS quakes, Open-Meteo elevation.
- `app/data/`: embedded indexes. `places.tsv` (typeahead, built by `tools/places.py` from GeoNames and the weather app's US list) and `coast.txt` (Natural Earth 50m coastline, for distance to the ocean).

Run locally:

```bash
bun run ~/git/milo/src/main.ts build app/app.milo -o tsunami && ./tsunami -p 7899
```

Deploy: `make tsunami` in `~/git/digitalocean` (cross-compiles for the droplet, port 7894, nginx `/tsunami/`).
