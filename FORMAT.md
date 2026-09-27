# Pack and tile format

A pack is a folder of height tiles round one place, plus an index and a receipt. The tiles are the same
`GGH1` bytes the world viewer's terrain layer already decodes for its staged England LiDAR, so a pack loads
through the existing tile loader with no new decoder. What is new is that a pack may sit in any projected
CRS (local UTM outside Great Britain), which `tiles.json` names.

```
packs/<region>/
  tiles.json      index: CRS, origin, rings, one entry per tile with its sha256
  tiles/*.ght     GGH1 height tiles
  RECEIPT.json    sources, licences, attribution, every request made, sha256 of every file
```

## GGH1 tile (`.ght`, little-endian)

32-byte header, then the heights.

| Offset | Type | Field | Notes |
| --- | --- | --- | --- |
| 0 | 4 bytes | magic | `GGH1` |
| 4 | u16 | version | 1 |
| 6 | u16 | samples | nodes per side: 257 normally; 129, 65 or 33 after a relief split |
| 8 | u16 | spacing_mm | node spacing in millimetres, 1 to 65535 (so at most 65.535 m) |
| 10 | u16 | flags | 0 |
| 12 | i32 | origin_e_m | easting of the south-west node, whole metres, in the pack CRS |
| 16 | i32 | origin_n_m | northing of the south-west node |
| 20 | i32 | base_cm | lowest height in the tile, centimetres |
| 24 | u16 | min_q | |
| 26 | u16 | max_q | |
| 28 | u32 | nodata_count | nodes with q = 0xFFFF |
| 32 | u16 x samples² | q | rows south to north, each row west to east |

`height_m = (base_cm + q) / 100`. `q = 0xFFFF` means no data. Heights are stored to 1 cm.

- A tile of `samples` nodes at `spacing` metres is `(samples - 1) * spacing` metres wide. Its nodes sit exactly
  on its edges, so neighbouring tiles share their edge nodes and meet with no gap.
- One tile can hold at most 655.34 m of relief (q from 0 to 0xFFFE). When a tile holds more, the packer
  splits it into four tiles of half the width (257 → 129 → 65 → 33 nodes), keyed `<key>q<a><b>`. Each split
  tile has its own `tile_m` in the index, which the viewer's loader already reads.
- Heights are metres above the source's own vertical datum (ODN for England, EGM2008 for Copernicus, NAVD88
  for 3DEP, Alicante for Spain). They are not converted between datums. The receipt names the sources.

## `tiles.json`

```json
{
 "format": "ght1",
 "crs": "EPSG:32719",
 "site": { "name": "atacama", "region": "Atacama desert, Chile", "lat": -23.5, "lon": -69.5,
           "origin_e": 448949, "origin_n": 7401040 },
 "tile_m": 7680, "spacing_m": 30,
 "attribution": "produced using Copernicus WorldDEM-30 © DLR e.V. ...",
 "source": "copernicus-glo30: Copernicus DEM GLO-30",
 "surface": "copernicus-glo30=DSM",
 "generated_utc": "2026-09-27T18:00:00Z",
 "rings": [ { "spacing_m": 30, "radius_m": 6000, "tile_m": 7680 } ],
 "tiles": [ { "key": "s30_445440_7395840", "file": "tiles/s30_445440_7395840.ght", "sha256": "…",
              "e0": 445440, "n0": 7395840, "bytes": 132130, "min_m": 2190.4, "max_m": 2361.8,
              "nodata": 0, "spacing_m": 30, "tile_m": 7680 } ]
}
```

- `crs` is the CRS of every `e0`, `n0` and `origin_*` in the pack: EPSG:27700 in England (matching the
  viewer's existing tiles), the source's own UTM where it has one (EPSG:25830 in Spain), otherwise the
  WGS 84 UTM zone of the centre (EPSG:326zz north, 327zz south).
- `site.origin_e`, `origin_n` is the requested point in the pack CRS, rounded to the metre. `site.lat`,
  `lon` is the point as asked.
- `rings` lists the detail rings, finest first. Tiles of every ring but the finest carry `ring: <spacing>`,
  which is how the viewer's plan inset already tells far tiles from near ones. Where rings overlap, the
  viewer keeps the finest loaded tile at each point.
- `attribution` is the line or lines (joined by ` | `) that must be shown while the pack is on screen.
  `surface` says which sources are bare earth (DTM) and which include buildings and trees (DSM).
- `tiles[].sha256` is the SHA-256 of the tile file. The SHA-256 of `tiles.json` itself is in
  `RECEIPT.json` (`files[0]`), for the viewer's hash-checked fetch.

## `RECEIPT.json`

What was fetched, from whom, under which licence, and the hash of everything written:

- `tool`, `tool_version`, `generated_utc`, `place`, `crs` (with a note when the CRS conversion carries a
  placement error, such as the Helmert shift into British National Grid).
- `chain`: the ranked sources the packer was allowed to use. `sources_used`: those that filled at least one
  node, with name, licence, licence URL, attribution, and how many nodes each filled.
- `source_errors`: any source that failed, so a gap is explained, not hidden.
- `requests`: every URL fetched, with HTTP status, bytes and the SHA-256 of the answer (byte-range reads of
  COGs are listed per range, without a hash). Over 400 requests, only a count and the first 50 are kept.
- `files`: every file written with its SHA-256 and size. `registry_sha256`: the registry the run obeyed.

## Loading it in the viewer

The viewer's tile loader takes an index path and its SHA-256 (`api.config.index`, `api.config.sha256`),
and places each tile at `e0 - origin.e`, `n0 - origin.n`. For a pack outside England the viewer has to set
its origin in the pack's CRS (`site.origin_e`, `site.origin_n` of `tiles.json`) instead of in British
National Grid. That change belongs in the viewer, not here.
