#!/usr/bin/env node
// Re-runs the browser checks behind sources/registry.json: one small real request per source, sent with an
// Origin header and a byte range, the way a page would. Prints status, CORS header and range support.
//   node tools/probe-sources.mjs            (all)
//   node tools/probe-sources.mjs nl-ahn     (one)
const PROBES = {
  'uk-england-ea-dtm1m': 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m&subset=E(600000,600016)&subset=N(140000,140016)&format=image/tiff',
  'uk-scotland-srsp-lidar': 'https://srsp-open-data.s3.eu-west-2.amazonaws.com/lidar/phase-1/dtm/27700/gridded/HY20_1M_DTM_PHASE1.tif',
  'uk-wales-lidar': 'https://dmwproductionblob.blob.core.windows.net/cogs/lidar/wales_dtm_32bit_cog.tif',
  'ie-gsi-lidar': 'https://gsi.geodata.gov.ie/server/rest/services/Lidar/IE_GSI_LiDAR_Coverage_OPW_IE26_ITM/MapServer?f=json',
  'nl-ahn': 'https://service.pdok.nl/rws/ahn/wcs/v1_0?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=dtm_05m&subset=x(155000,155032)&subset=y(463000,463032)&format=image/tiff',
  'be-flanders-dhmv2': 'https://geo.api.vlaanderen.be/el-dtm/wcs?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=EL.GridCoverage.DTM&subset=y(51.0,51.0005)&subset=x(3.7,3.7008)&format=image/tiff',
  'be-wallonia-mnt': 'https://geoservices.wallonie.be/arcgis/rest/services/RELIEF/WALLONIE_MNT_2021_2022/MapServer?f=json',
  'dk-dhm': 'https://api.dataforsyningen.dk/dhm_wcs_DAF?service=WCS&version=1.0.0&request=GetCoverage&coverage=dhm_terraen&crs=EPSG:25832&bbox=720000,6170000,720040,6170040&width=100&height=100&format=GTiff',
  'fr-ign-lidarhd-mnt': 'https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93&STYLES=&CRS=EPSG:2154&BBOX=650000,6860000,650032,6860032&WIDTH=64&HEIGHT=64&FORMAT=image/geotiff',
  'es-ign-mdt': 'https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&CoverageId=Elevacion25830_5&subset=x(300000,300020)&subset=y(4100000,4100020)&format=application/asc',
  'ch-swissalti3d': 'https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_2019_2485-1109/swissalti3d_2019_2485-1109_2_2056_5728.tif',
  'us-usgs-3dep': 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-112.1,33.4,-112.09,33.41&bboxSR=4326&size=64,64&format=tiff&pixelType=F32&f=image',
  'ca-nrcan-hrdem': 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/8_2-mosaic-1m-dtm.tif',
  'au-ga-dem5m': 'https://services.ga.gov.au/gis/services/DEM_LiDAR_5m_2025/MapServer/WCSServer?service=WCS&version=1.0.0&request=GetCoverage&coverage=1&crs=EPSG:4283&bbox=151.0,-33.8,151.0005,-33.7996&resx=0.00005&resy=0.00005&format=GeoTIFF',
  'nz-linz-dem1m': 'https://nz-elevation.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand/dem_1m/2193/AS21.tiff',
  'copernicus-glo30': 'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N51_00_E001_00_DEM/Copernicus_DSM_COG_10_N51_00_E001_00_DEM.tif',
  'copernicus-glo30 (OpenTopography mirror)': 'https://opentopography.s3.sdsc.edu/raster/COP30/COP30_hh/Copernicus_DSM_10_N51_00_E001_00_DEM.tif',
  'copernicus-glo90': 'https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_N51_00_E001_00_DEM/Copernicus_DSM_COG_30_N51_00_E001_00_DEM.tif',
  'nasadem': 'https://opentopography.s3.sdsc.edu/raster/NASADEM/NASADEM_be/NASADEM_HGT_n51e001.tif',
  'srtm-gl1': 'https://opentopography.s3.sdsc.edu/raster/SRTM_GL1/SRTM_GL1_srtm/N51E001.tif',
  'aws-terrain-tiles': 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/511/340.png'
};

const only = process.argv[2];
for (const [id, url] of Object.entries(PROBES)) {
  if (only && !id.startsWith(only)) continue;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { Origin: 'https://example.org', Range: 'bytes=0-15' } });
    await r.arrayBuffer();
    console.log([id, `HTTP ${r.status}`, `ACAO=${r.headers.get('access-control-allow-origin') ?? 'none'}`,
      `range=${r.status === 206 ? 'yes' : 'no'}`, r.headers.get('content-type'), `${Date.now() - t0} ms`].join(' | '));
  } catch (e) { console.log(`${id} | failed: ${e.message}`); }
}
