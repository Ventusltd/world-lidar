LiDAR models for the world where available and allowed by open source licenses, otherwise use open source satelite data for animating wrolds

## What is here

| Path | What it is |
| --- | --- |
| [`SOURCES.md`](SOURCES.md), [`sources/registry.json`](sources/registry.json) | Open national LiDAR and DTM services and the satellite fallbacks: resolution, licence, exact attribution, access method, whether a browser can read them (CORS, byte ranges), rate limits, and ADOPT or NO. Checked with real requests on 27 Sept 2026. |
| [`FORMAT.md`](FORMAT.md) | The pack and tile format: GGH1 height tiles, `tiles.json`, `RECEIPT.json`. |
| [`LICENCES.md`](LICENCES.md) | Data licences per pack, and the status of this repository's own licence. |
| `tools/pack.mjs` | Fetch and pack: a lat/lon and rings in, GGH1 tiles, index and receipt out. |
| `tools/verify-pack.mjs` | Checks a pack against its receipt, its index and the size cap. |
| `tools/probe-sources.mjs` | Re-runs the CORS and range checks behind the registry. |
| `tools/selftest.mjs` | Offline checks of the tile encoder and projections (`--net` also reads real COGs). |
| `packs/` | Demo packs for anonymous places, each with its receipt. |

## Make a pack

Node 18 or later; no packages to install.

```
node tools/pack.mjs --lat 51.14 --lon 1.37 --out packs/kent-coast --region "Kent coast, England" --rings 1:300,4:1000,16:4000
node tools/verify-pack.mjs packs/kent-coast
```

`--rings` is a list of `spacing_m:radius_m`, finest first. Each ring is a set of 257 x 257-node tiles
round the point. The packer picks the finest source the registry allows at that point (ADOPT and
packable, with an adapter), and fills any node it leaves empty from Copernicus GLO-30, then GLO-90. Every
height is traceable: the receipt lists each source used, how many nodes it filled, every request made, and
the SHA-256 of every file written.

Adapters today: England (EA 1 m), Spain (IGN MDT 5 m and 25 m), the USA (USGS 3DEP), and Copernicus
GLO-30 and GLO-90 everywhere. The other ADOPT sources in the registry have tested endpoints and are waiting
for adapters.

## Demo packs

Region names and coordinates only.

| Pack | Point | Rings (spacing:radius, m) | Source | Tiles | Size |
| --- | --- | --- | --- | --- | --- |
| `packs/kent-coast` | 51.1400 N, 1.3700 E | 1:300, 4:1000, 16:4000 | EA LIDAR DTM 1 m; Copernicus GLO-30 over open sea | 24 | 3.03 MB |
| `packs/atacama` | 23.5000 S, 69.5000 W | 30:6000 | Copernicus GLO-30 (no open national source in Chile) | 7 | 0.88 MB |
| `packs/andalusia` | 37.4000 N, 5.6000 W | 5:1000, 25:4000 | IGN/CNIG MDT05 and MDT25 | 10 | 1.26 MB |
| `packs/arizona` | 33.3000 N, 113.2000 W | 1:300, 4:1000, 16:4000 | USGS 3DEP (1 m LiDAR at this point) | 26 | 3.28 MB |

What these are not: survey data. The Copernicus heights are a 30 m surface model (buildings and trees
included). British National Grid placement uses a Helmert shift good to a few metres, not OSTN15. Heights
stay on each source's own vertical datum.
