# Sources

Open elevation for the world, national LiDAR first and satellite where there is none. The machine-readable
copy is [`sources/registry.json`](sources/registry.json); the packer obeys it and refuses any source it does
not mark ADOPT and packable. Checked on 27 Sept 2026 with real requests.

**How the browser columns were checked.** One small real request per source, sent with an `Origin` header
and `Range: bytes=0-15`, the way a page would send it. `tools/probe-sources.mjs` re-runs every check.
"CORS" is the `Access-Control-Allow-Origin` answer: `*`, "reflects" (it echoes the page's origin back, which
also works), or none (a page cannot read it). "Range" means the server answered 206 to the byte range, so a
page can read a COG one block at a time. A dynamic service (WCS or ImageServer) needs no range support,
because it cuts the box itself.

**How the licence column was checked.** "Verified" means we read the text on the publisher's own page, in
the service capabilities, or in the metadata record, and the note says which. Where we did not read it, the
registry says `"verified": false`.

## National LiDAR and DTM

| Region | Source | Res. | Licence | Access | Browser | Status |
| --- | --- | --- | --- | --- | --- | --- |
| England | EA LIDAR Composite DTM | 1 m | OGL v3.0 (verified) | WCS 2.0.1, float32 GeoTIFF, scalefactor works | yes: CORS `*` | **ADOPT**, packable, adapter |
| Scotland | Scottish Remote Sensing Portal, phases 1-6 and National LiDAR Programme | 0.5-1 m | OGL (data.gov.uk, every phase; verified) | Public S3, tiled GeoTIFF (LZW) | yes: CORS `*`, range | **ADOPT**, packable |
| Wales | Welsh Government LiDAR 2020-23 | 1 m | not stated on the serving record | All-Wales COG and 1 km tiles on Azure blob | no CORS | **NO** until the licence is confirmed |
| Ireland | GSI / OPW LiDAR tiles | 2 m (varies) | CC BY 4.0 (verified, per tile record) | Zip per 2 km tile | no (zips) | **ADOPT**, packable |
| Netherlands | AHN DTM | 0.5 m | CC0 (verified, capabilities) | PDOK WCS 2.0.1 | yes: CORS `*`, range | **ADOPT**, packable |
| Belgium, Flanders | DHM Vlaanderen II DTM | 1 m | Modellicentie gratis hergebruik (verified, metadata) | WCS 2.0.1, multipart answer | yes: CORS `*` | **ADOPT**, packable |
| Belgium, Wallonia | MNT 2021-2022 | n/s | viewing-service conditions only | WMS / MapServer pictures, no heights | reflects | **NO** |
| Denmark | Danmarks Højdemodel | 0.4 m | Danish free data terms (not read) | WCS with a personal token (403 without) | token in a public page | **NO** unless the owner registers a token |
| France | IGN LiDAR HD MNT | 0.5 m | Licence Ouverte 2.0 (verified, data.gouv.fr) | Géoplateforme WMS-R GetMap, `image/geotiff` float32 | yes: CORS `*` | **ADOPT**, packable |
| Spain | IGN/CNIG MDT (PNOA LiDAR) | 5 m (25 m) | CC BY 4.0 scne.es (verified, capabilities) | IDEE WCS 2.0.1; ASCII keeps cm, GeoTIFF is whole metres | yes: CORS `*` | **ADOPT**, packable, adapter |
| Switzerland | swisstopo swissALTI3D | 0.5 / 2 m | swisstopo free geodata terms (verified) | STAC + 1 km COGs | yes: CORS `*`, range | **ADOPT**, packable |
| USA | USGS 3DEP (1 m, 1/3") | 1-10 m | public domain (not re-read) | ImageServer exportImage (any EPSG) and COGs on S3 | yes: CORS `*`, range on S3 | **ADOPT**, packable, adapter |
| Canada | NRCan HRDEM mosaic, MRDEM | 1-2 m, 30 m | OGL-Canada 2.0 (verified, STAC) | STAC + COGs (BigTIFF) | CORS `*`, range, but the 1 m mosaic's index is ~15 MB | **ADOPT**, packable |
| Australia | GA DEM from LiDAR 5 m | 5 m | CC BY 4.0 (verified, capabilities) | WCS 1.0.0 GeoTIFF | yes: reflects | **ADOPT**, packable |
| Australia | ELVIS portal | 0.5-5 m | per custodian, mostly CC BY 4.0 (not read) | order form, emailed links | no | **NO** (use GA 5 m) |
| New Zealand | LINZ LiDAR 1 m DEM | 1 m | CC BY 4.0 (verified, STAC) | Public S3 + STAC, COGs with LERC compression | CORS `*`, range; needs a LERC decoder | **ADOPT**, packable |
| Chile | none found | | | datos.gob.cl: 0 LiDAR datasets; IDE Chile lists metadata only | | **NO**: use GLO-30 |

## Satellite fallbacks

| Source | Res. | Surface | Licence | Access | Browser | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Copernicus DEM GLO-30 | 30 m | DSM | Copernicus DEM free licence (verified, CDSE page) | COGs on AWS (`copernicus-dem-30m`) | AWS: **no CORS**. OpenTopography mirror: reflects, range | **ADOPT**, packable, adapter |
| Copernicus DEM GLO-90 | 90 m | DSM | same, WorldDEM-90 notice | COGs on AWS | no CORS | **ADOPT**, packable, adapter |
| NASADEM | 30 m | DSM | public domain (not re-read) | COGs on the OpenTopography mirror | reflects, range | **ADOPT**, packable |
| SRTM GL1 | 30 m | DSM | public domain (not re-read) | COGs on the OpenTopography mirror | reflects, range | **ADOPT**, packable |
| AWS Terrain Tiles (Terrarium) | ~5 m at z15, source-dependent | mixed | each component's own licence (verified list) | XYZ PNG | CORS `*`, range | **ADOPT** for live reading only, **not packable** (per-pixel source unknown) |

Satellite models are surface models: they include buildings and trees, and Copernicus states an absolute
vertical accuracy under 4 m (LE90). Wherever one stands in for a DTM, the pack's `surface` field says so.

## Attribution lines

Exact lines, as the publisher gives them. Show every line whose source is on screen.

- **England (EA):** © Environment Agency copyright and/or database right 2022. All rights reserved.
- **Scotland, phase 1:** Crown copyright Scottish Government, SEPA and Scottish Water (2012). Each phase has
  its own line on its data.gov.uk record.
- **Ireland:** Contains Irish Public Sector Data (Geological Survey Ireland & the Office of Public Works)
  licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.
- **Netherlands:** none required (CC0).
- **Flanders:** Bron: Digitaal Vlaanderen
- **France:** the Licence Ouverte asks for the source and the date of its last update. No verbatim line is
  published; ours is "IGN – MNT LiDAR HD, <date>".
- **Spain:** the service states "CC BY 4.0 scne.es". The line we show is "MDT derived from PNOA LiDAR,
  © Instituto Geográfico Nacional, CC BY 4.0 scne.es".
- **Switzerland:** ©swisstopo
- **USA:** USGS National Map 3D Elevation Program (3DEP). (A requested credit; public domain.)
- **Canada:** Contains information licensed under the Open Government Licence – Canada.
- **Australia (GA 5 m):** © Commonwealth of Australia (Geoscience Australia) 2025. This product is released
  under the Creative Commons Attribution 4.0 International Licence.
- **New Zealand:** Toitū Te Whenua Land Information New Zealand, CC BY 4.0 (licensor as named in the STAC
  collection).
- **Copernicus GLO-30, original data:** © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018
  provided under COPERNICUS by the European Union and ESA; all rights reserved
- **Copernicus GLO-30, adapted data (what a pack is):** produced using Copernicus WorldDEM-30 © DLR e.V.
  2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and
  ESA; all rights reserved. For GLO-90, WorldDEM-90.
- **AWS Terrain Tiles:** the full list is in the registry.

## Rate limits

No source we checked publishes a numeric rate limit for anonymous use. swisstopo reserves the right to
restrict "excessive use". The Danish service is limited per token. The tools send one request at a time per
tile, with a small number of parallel COG block reads, and identify themselves with a User-Agent that
names this repository.

## What the tools read today

Adapters exist for England (EA), Spain (IDEE), the USA (3DEP) and Copernicus GLO-30 and GLO-90. The other
ADOPT sources are recorded with tested endpoints; each needs a small adapter in `tools/lib/sources.mjs`.
New Zealand also needs a LERC decoder.
