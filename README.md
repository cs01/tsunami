# tsunami

Tsunami Check: is a tsunami coming, was that an earthquake, and what is El Niño doing, in words a five year old can follow. Live at https://chadsmith.dev/tsunami/

- `app/app.milo`: Milo server. Proxies and caches the NOAA tsunami warning center Atom feeds and the CPC El Niño data (neither sends CORS headers) as small JSON at `/api/centers` and `/api/enso`; embeds the page.
- `app/public/`: the page. Fetches CORS-open sources directly: NWS point alerts, USGS quakes, Open-Meteo elevation and geocoding.

Run locally:

```bash
bun run ~/git/milo/src/main.ts build app/app.milo -o tsunami && ./tsunami -p 7899
```

Deploy: `make tsunami` in `~/git/digitalocean` (cross-compiles for the droplet, port 7894, nginx `/tsunami/`).
