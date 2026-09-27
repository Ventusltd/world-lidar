# Licences

Two separate things carry licences here: the data in `packs/`, and this repository's own code and text.

## Data in packs

Every pack keeps the licence of the data it was made from. Nothing in a pack is relicensed.

- Each pack's `RECEIPT.json` names every source that filled at least one height, with its licence, licence
  URL and attribution line. `tiles.json` repeats the attribution in its `attribution` field.
- Whoever shows a pack must show its attribution while it is on screen.
- The packer only writes data from sources that `sources/registry.json` marks `"status": "ADOPT"` and
  `"packable": true`. A licence that bars redistribution, or a source whose licence we could not confirm,
  is never packed. Such a source may at most be read live, from its own server, by whoever displays it.
- A pack is adapted data (heights resampled onto a new grid), so where a publisher gives a separate line
  for adapted data, the pack uses it. Copernicus DEM is the case here ("produced using Copernicus
  WorldDEM-30 ...").

| Pack | Region | Sources | Licence | Attribution to show |
| --- | --- | --- | --- | --- |
| `packs/kent-coast` | Kent coast, England | EA LIDAR Composite DTM 1 m; Copernicus GLO-30 where the EA answered with no survey (open sea) | OGL v3.0; Copernicus DEM free licence | © Environment Agency copyright and/or database right 2022. All rights reserved. \| produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved |
| `packs/atacama` | Atacama desert, Chile | Copernicus GLO-30 | Copernicus DEM free licence | produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved |
| `packs/andalusia` | Andalusia, Spain | IGN/CNIG MDT05 and MDT25 | CC BY 4.0 scne.es | CC BY 4.0 scne.es (shown as: MDT derived from PNOA LiDAR, © Instituto Geográfico Nacional, CC BY 4.0 scne.es) |
| `packs/arizona` | Arizona desert, USA | USGS 3DEP (1 m LiDAR here) | public domain | USGS National Map 3D Elevation Program (3DEP). |

## Code and text in this repository

This repository has no licence file yet. Choosing one is the owner's decision, so none has been added.
Until one is chosen, the default applies: others may read the code here but have no granted right to reuse
it. The data licences above apply to the packs whatever is chosen for the code.

## Third-party code

None. The tools use only Node's standard library. The TIFF reader, the projection code and the tile
encoder in `tools/lib/` were written for this repository.
