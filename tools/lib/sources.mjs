// Source adapters for the packer. Each adapter turns "heights for this box, at about this spacing" into one
// or more rasters in the source's own CRS. Licence, attribution and ADOPT/NO live in sources/registry.json,
// not here: the packer refuses any source the registry does not mark adopt + packable.
//
// A raster: { epsg, x0, y0, dx, dy, w, h, data } where (x0, y0) is the CENTRE of the north-west pixel,
// dx, dy > 0, rows run north to south, and data holds NaN for no data.

import crypto from 'node:crypto';
import { openTiff, bufferSource, urlSource, readWindow, epsgOf } from './tiff.mjs';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const UA = { 'User-Agent': 'world-lidar pack tool (+https://github.com/Ventusltd/world-lidar)' };

// Shared request log: every URL fetched, bytes, sha256 of the body.
export function createLog() {
  const requests = [];
  return {
    requests,
    async get(url, { expect = 'binary', headers = {} } = {}) {
      const t0 = Date.now();
      let res, body;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await fetch(url, { headers: { ...UA, ...headers } });
          body = new Uint8Array(await res.arrayBuffer());
          break;
        } catch (e) { if (attempt >= 2) throw e; await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); }
      }
      requests.push({ url, status: res.status, bytes: body.byteLength, sha256: sha(body), ms: Date.now() - t0 });
      return { res, body };
    }
  };
}

function tiffRaster(t, ifd, data, x0px, y0px, w, h) {
  const point = ifd.geoKeys?.[1025] === 2; // pixel-is-point: the tiepoint is the centre of pixel (0, 0)
  const cx = ifd.west + (point ? 0 : ifd.resX / 2), cy = ifd.north - (point ? 0 : ifd.resY / 2);
  return { epsg: epsgOf(ifd), x0: cx + x0px * ifd.resX, y0: cy - y0px * ifd.resY, dx: ifd.resX, dy: ifd.resY, w, h, data };
}

async function wholeTiff(body) {
  const t = await openTiff(bufferSource(body));
  const i = t.ifds[0];
  return tiffRaster(t, i, await readWindow(t, i, 0, 0, i.width, i.height), 0, 0, i.width, i.height);
}

// ---- England: EA LIDAR Composite DTM 1 m, WCS 2.0.1 --------------------------------------------------
const EA = {
  url: 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs',
  coverage: '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m',
  extent: { x0: 80000, y0: 4000, x1: 656000, y1: 665000 }
};

// ---- Spain: IGN/CNIG MDT via the IDEE INSPIRE WCS (ETRS89 UTM 30N) -----------------------------------
const ES = { url: 'https://servicios.idee.es/wcs-inspire/mdt', extent: { x0: -19452.5, y0: 3901197.5, x1: 1140352.5, y1: 4865682.5 } };

function parseAsc(text) {
  const lines = text.split(/\r?\n/), head = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].trim().match(/^([a-zA-Z_]+)\s+(-?[\d.eE+-]+)$/);
    if (!m) break;
    head[m[1].toLowerCase()] = parseFloat(m[2]);
  }
  const w = head.ncols, h = head.nrows, cs = head.cellsize, nd = head.nodata_value;
  if (!(w > 0 && h > 0 && cs > 0)) throw Error('ASCII grid has no header');
  const vals = lines.slice(i).join(' ').trim().split(/\s+/).map(Number);
  if (vals.length < w * h) throw Error(`ASCII grid has ${vals.length} values, expected ${w * h}`);
  const data = new Float64Array(w * h);
  for (let k = 0; k < w * h; k++) data[k] = vals[k] === nd || !Number.isFinite(vals[k]) ? NaN : vals[k];
  const x0 = head.xllcorner !== undefined ? head.xllcorner + cs / 2 : head.xllcenter;
  const yll = head.yllcorner !== undefined ? head.yllcorner + cs / 2 : head.yllcenter;
  return { x0, y0: yll + (h - 1) * cs, dx: cs, dy: cs, w, h, data };
}

// Pulls one part out of a multipart/related answer by its Content-Type.
function multipartPart(body, type) {
  const text = Buffer.from(body).toString('latin1');
  const idx = text.indexOf(`Content-Type: ${type}`);
  if (idx < 0) throw Error(`multipart answer has no ${type} part`);
  const start = text.indexOf('\r\n\r\n', idx) >= 0 ? text.indexOf('\r\n\r\n', idx) + 4 : text.indexOf('\n\n', idx) + 2;
  const end = text.indexOf('\n--', start);
  return Buffer.from(body).subarray(start, end < 0 ? undefined : end);
}

// ---- USA: USGS 3DEP dynamic elevation ImageServer (best available: 1 m, 1/3", 1") ---------------------
const US = { url: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage' };

// ---- World: Copernicus DEM GLO-30 / GLO-90 COGs on AWS -------------------------------------------------
function copName(res, lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
  const la = String(Math.abs(lat)).padStart(2, '0'), lo = String(Math.abs(lon)).padStart(3, '0');
  const code = res === 30 ? '10' : '30';
  return `Copernicus_DSM_COG_${code}_${ns}${la}_00_${ew}${lo}_00_DEM`;
}

export function adapters(log) {
  const cogCache = new Map();
  const copernicus = (res, bucket) => ({
    id: res === 30 ? 'copernicus-glo30' : 'copernicus-glo90',
    nativeRes: res,
    crsFor: () => 4326,
    covers: () => true,
    async rasters(b /* lon/lat box */) {
      const out = [];
      for (let lat = Math.floor(b.y0); lat <= Math.floor(b.y1); lat++) {
        for (let lon = Math.floor(b.x0); lon <= Math.floor(b.x1); lon++) {
          const name = copName(res, lat, lon), url = `https://${bucket}.s3.amazonaws.com/${name}/${name}.tif`;
          let t = cogCache.get(url);
          if (t === undefined) {
            try {
              t = await openTiff(urlSource(url, { fetchImpl: async (u, o) => { const r = await fetch(u, { ...o, headers: { ...o.headers, ...UA } }); return r; }, onBytes: n => log.requests.push({ url, range: true, bytes: n }) }));
            } catch (e) { if (/HTTP 40[34]/.test(e.message)) t = null; else throw e; } // no tile: ocean or not released
            cogCache.set(url, t);
          }
          if (!t) continue;
          const i = t.ifds[0];
          const px0 = Math.max(0, Math.floor((b.x0 - i.west) / i.resX) - 1), px1 = Math.min(i.width - 1, Math.ceil((b.x1 - i.west) / i.resX) + 1);
          const py0 = Math.max(0, Math.floor((i.north - b.y1) / i.resY) - 1), py1 = Math.min(i.height - 1, Math.ceil((i.north - b.y0) / i.resY) + 1);
          if (px1 < px0 || py1 < py0) continue;
          const w = px1 - px0 + 1, h = py1 - py0 + 1;
          out.push(tiffRaster(t, i, await readWindow(t, i, px0, py0, w, h), px0, py0, w, h));
        }
      }
      return out;
    }
  });

  return {
    'uk-england-ea-dtm1m': {
      id: 'uk-england-ea-dtm1m', nativeRes: 1, crsFor: () => 27700,
      covers: (lat, lon) => lat > 49.8 && lat < 55.9 && lon > -6.5 && lon < 2.1,
      async rasters(b, res) {
        const s = Math.max(1, Math.round(res));
        const x0 = Math.floor(b.x0 / s) * s, y0 = Math.floor(b.y0 / s) * s, x1 = Math.ceil(b.x1 / s) * s, y1 = Math.ceil(b.y1 / s) * s;
        if (x0 < EA.extent.x0 || y0 < EA.extent.y0 || x1 > EA.extent.x1 || y1 > EA.extent.y1) return [];
        const out = [], step = 2048 * s; // at most 2048 x 2048 pixels per request
        for (let ex = x0; ex < x1; ex += step) for (let ny = y0; ny < y1; ny += step) {
          const ex1 = Math.min(ex + step, x1), ny1 = Math.min(ny + step, y1);
          const url = `${EA.url}?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=${EA.coverage}` +
            `&subset=E(${ex},${ex1})&subset=N(${ny},${ny1})&format=image/tiff${s > 1 ? `&scalefactor=${1 / s}` : ''}`;
          const { res: r, body } = await log.get(url);
          if (!r.ok) { if (r.status >= 500) continue; throw Error(`EA WCS HTTP ${r.status}`); }
          const ras = await wholeTiff(body);
          // Outside the survey the service answers exact zeros with no nodata tag: that is no data, not sea level.
          if (ras.data.every(v => v === 0)) ras.data.fill(NaN);
          out.push({ ...ras, epsg: 27700 });
        }
        return out;
      }
    },

    'es-ign-mdt': {
      id: 'es-ign-mdt', nativeRes: 5, crsFor: () => 25830,
      covers: (lat, lon) => lat > 35.9 && lat < 43.9 && lon > -9.4 && lon < 3.4,
      async rasters(b, res) {
        const cov = res < 25 ? 'Elevacion25830_5' : 'Elevacion25830_25', cs = res < 25 ? 5 : 25;
        const out = [], step = 1000 * cs;
        for (let ex = b.x0; ex < b.x1; ex += step) for (let ny = b.y0; ny < b.y1; ny += step) {
          const x0 = Math.floor(ex / cs) * cs, y0 = Math.floor(ny / cs) * cs;
          const x1 = Math.ceil(Math.min(ex + step, b.x1) / cs) * cs, y1 = Math.ceil(Math.min(ny + step, b.y1) / cs) * cs;
          if (x0 < ES.extent.x0 || y0 < ES.extent.y0 || x1 > ES.extent.x1 || y1 > ES.extent.y1) continue;
          const url = `${ES.url}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&CoverageId=${cov}` +
            `&subset=x(${x0},${x1})&subset=y(${y0},${y1})&format=application/asc`; // the GeoTIFF answer is whole metres (int16); ASCII keeps centimetres
          const { res: r, body } = await log.get(url);
          if (!r.ok) throw Error(`IDEE WCS HTTP ${r.status}`);
          out.push({ ...parseAsc(multipartPart(body, 'application/asc').toString('latin1')), epsg: 25830 });
        }
        return out;
      }
    },

    'us-usgs-3dep': {
      id: 'us-usgs-3dep', nativeRes: 1, crsFor: pack => pack, // the server reprojects to the pack's own CRS
      covers: (lat, lon) => (lat > 17.5 && lat < 72 && lon > -180 && lon < -64) || (lat > 13 && lat < 21 && lon > 144 && lon < 146),
      async rasters(b, res, epsg) {
        const out = [], maxPx = 4000;
        const step = maxPx * res;
        for (let ex = b.x0; ex < b.x1; ex += step) for (let ny = b.y0; ny < b.y1; ny += step) {
          const x1 = Math.min(ex + step, b.x1), y1 = Math.min(ny + step, b.y1);
          const w = Math.max(2, Math.round((x1 - ex) / res)), h = Math.max(2, Math.round((y1 - ny) / res));
          const url = `${US.url}?bbox=${ex},${ny},${x1},${y1}&bboxSR=${epsg}&imageSR=${epsg}&size=${w},${h}` +
            '&format=tiff&pixelType=F32&noDataInterpretation=esriNoDataMatchAny&interpolation=RSP_BilinearInterpolation&f=image';
          const { res: r, body } = await log.get(url);
          if (!r.ok) throw Error(`3DEP ImageServer HTTP ${r.status}`);
          const ras = await wholeTiff(body);
          out.push({ ...ras, epsg });
        }
        return out;
      }
    },

    'copernicus-glo30': copernicus(30, 'copernicus-dem-30m'),
    'copernicus-glo90': copernicus(90, 'copernicus-dem-90m')
  };
}

// Bilinear height at (x, y) in the raster's CRS; NaN outside or where a weighted neighbour has no data.
export function sampleRaster(r, x, y) {
  const fx = (x - r.x0) / r.dx, fy = (r.y0 - y) / r.dy;
  if (fx < -0.5 || fy < -0.5 || fx > r.w - 0.5 || fy > r.h - 0.5) return NaN;
  const cx = Math.min(Math.max(fx, 0), r.w - 1), cy = Math.min(Math.max(fy, 0), r.h - 1);
  const i = Math.min(Math.floor(cx), r.w - 2 < 0 ? 0 : r.w - 2), j = Math.min(Math.floor(cy), r.h - 2 < 0 ? 0 : r.h - 2);
  const ax = r.w > 1 ? cx - i : 0, ay = r.h > 1 ? cy - j : 0;
  let sum = 0, wsum = 0;
  for (const [di, dj, w] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
    if (w < 1e-9) continue;
    const v = r.data[(j + dj) * r.w + i + di];
    if (Number.isNaN(v)) return NaN;
    sum += w * v; wsum += w;
  }
  return wsum > 0 ? sum / wsum : NaN;
}
