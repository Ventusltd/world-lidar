#!/usr/bin/env node
// Fetch and pack: heights round a point into GGH1 tiles (see FORMAT.md), from the best source the registry
// allows, falling back node by node to the satellite model. Writes <out>/tiles.json, <out>/tiles/*.ght and
// <out>/RECEIPT.json (sources, licences, attribution, every request, sha256 of every file).
//
//   node tools/pack.mjs --lat 51.14 --lon 1.37 --out packs/kent-coast [--region "Kent coast, England"]
//        [--rings 1:300,8:4000] [--sources uk-england-ea-dtm1m,copernicus-glo30] [--crs 32631]
//
// --rings  spacing_m:radius_m pairs, finest first. Each ring is a lattice of 257 x 257-node tiles (256
//          spacings a side) on multiples of the tile width in the pack CRS, kept where the tile touches the
//          circle. Default: 1:300,8:4000 for a 1 m source, 5:1200,30:4000 for 5 m, else 30:6000.
// --sources  ranked list; default: every ADOPT + packable source whose adapter covers the point, finest
//          first, then copernicus-glo30, copernicus-glo90.
// --crs    pack CRS (EPSG). Default: the finest source's projected CRS when it has one, else local UTM.
// Needs Node 18+ (global fetch). No other dependencies.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { crs as makeCrs, utmEpsg, transform } from './lib/proj.mjs';
import { adapters, createLog, sampleRaster } from './lib/sources.mjs';
import { encodeTile, MAX_SPAN_CM } from './lib/ght.mjs';

export const TOOL_VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw Error(`unexpected argument ${k}`);
    o[k.slice(2)] = argv[i + 1]; i++;
  }
  return o;
}

export function loadRegistry(file = path.join(HERE, '..', 'sources', 'registry.json')) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const all = [...j.sources, ...j.satellite_fallbacks];
  return { raw: j, byId: new Map(all.map(s => [s.id, s])), all };
}

function defaultRings(res, radius) {
  if (res <= 2) return [[1, 300], [8, radius]];
  if (res <= 10) return [[5, 1200], [30, radius]];
  return [[30, radius]];
}

// Tiles of one ring: south-west corners on multiples of tile_m that touch the circle.
function ringTiles(cx, cy, spacing, radius) {
  const t = 256 * spacing, out = [];
  for (let i = Math.floor((cx - radius) / t); i <= Math.floor((cx + radius) / t); i++) {
    for (let j = Math.floor((cy - radius) / t); j <= Math.floor((cy + radius) / t); j++) {
      const e0 = i * t, n0 = j * t;
      const d = Math.hypot(Math.max(e0 - cx, 0, cx - e0 - t), Math.max(n0 - cy, 0, cy - n0 - t));
      if (d <= radius) out.push({ e0, n0 });
    }
  }
  return out;
}

// Heights at every node of a tile, source by source until no node is left empty.
async function fillTile(tile, samples, spacing, packCrs, chain, used) {
  const n = samples * samples, h = new Float64Array(n).fill(NaN), from = new Int8Array(n).fill(-1);
  for (let si = 0; si < chain.length; si++) {
    const src = chain[si], need = [];
    for (let k = 0; k < n; k++) if (Number.isNaN(h[k])) need.push(k);
    if (!need.length) break;
    const srcEpsg = src.adapter.crsFor(packCrs.epsg), srcCrs = makeCrs(srcEpsg), f = transform(packCrs, srcCrs);
    const pts = new Float64Array(need.length * 2);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    need.forEach((k, q) => {
      const [x, y] = f(tile.e0 + (k % samples) * spacing, tile.n0 + Math.floor(k / samples) * spacing);
      pts[2 * q] = x; pts[2 * q + 1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    });
    const res = Math.max(src.adapter.nativeRes, spacing);
    const m = srcCrs.geographic ? 2 * res / 111320 : 2 * res;
    let rasters;
    try { rasters = await src.adapter.rasters({ x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m }, srcCrs.geographic ? res / 111320 : res, srcEpsg); }
    catch (e) { used.errors.push(`${src.id}: ${e.message}`); continue; }
    let got = 0;
    need.forEach((k, q) => {
      for (const r of rasters) {
        const v = sampleRaster(r, pts[2 * q], pts[2 * q + 1]);
        if (!Number.isNaN(v)) { h[k] = v; from[k] = si; got++; break; }
      }
    });
    used.nodes[src.id] = (used.nodes[src.id] || 0) + got;
  }
  return { h, from };
}

// Splits a tile whose relief is over 655.34 m into four of half the width (129 nodes, 65, ...).
function splitToFit(tile, samples, spacing, h) {
  let min = Infinity, max = -Infinity;
  for (const v of h) if (!Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
  if (!(max - min > (MAX_SPAN_CM - 100) / 100) || samples <= 33) return [{ ...tile, samples, heights: h }];
  const half = (samples - 1) / 2, out = [];
  for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const s2 = half + 1, sub = new Float64Array(s2 * s2);
    for (let j = 0; j < s2; j++) for (let i = 0; i < s2; i++) sub[j * s2 + i] = h[(b * half + j) * samples + a * half + i];
    out.push(...splitToFit({ e0: tile.e0 + a * half * spacing, n0: tile.n0 + b * half * spacing, key: `${tile.key}q${a}${b}` }, s2, spacing, sub));
  }
  return out;
}

export async function pack(opts) {
  const lat = Number(opts.lat), lon = Number(opts.lon);
  if (!(Math.abs(lat) <= 84 && Math.abs(lon) <= 180)) throw Error('--lat and --lon are required (lat within +-84)');
  const out = opts.out; if (!out) throw Error('--out is required');
  const reg = loadRegistry(opts.registry);
  const log = createLog(), ad = adapters(log);

  // Ranked chain of allowed sources.
  const ids = opts.sources ? String(opts.sources).split(',') : [...reg.all.filter(s => s.adapter && ad[s.adapter] && !s.id.startsWith('copernicus') && ad[s.adapter].covers(lat, lon)).sort((a, b) => ad[a.adapter].nativeRes - ad[b.adapter].nativeRes).map(s => s.id), 'copernicus-glo30', 'copernicus-glo90'];
  const chain = [];
  for (const id of ids) {
    const s = reg.byId.get(id);
    if (!s) throw Error(`source ${id} is not in the registry`);
    if (s.status !== 'ADOPT' || !s.packable) throw Error(`source ${id} is ${s.status}${s.packable ? '' : ', not packable'}: the registry does not allow packing it`);
    if (!s.adapter || !ad[s.adapter]) throw Error(`source ${id} has no adapter yet`);
    chain.push({ id, reg: s, adapter: ad[s.adapter] });
  }
  const best = chain[0];
  const bestEpsg = best.adapter.crsFor(null);
  const packEpsg = Number(opts.crs) || (bestEpsg && bestEpsg !== 4326 ? bestEpsg : utmEpsg(lat, lon));
  const packCrs = makeCrs(packEpsg);
  const [cx, cy] = packCrs.fromLL(lat, lon);
  const radius = Number(opts.radius) || 4000;
  const rings = opts.rings ? String(opts.rings).split(',').map(r => r.split(':').map(Number)) : defaultRings(best.adapter.nativeRes, radius);
  rings.sort((a, b) => a[0] - b[0]);
  const originE = Math.round(cx), originN = Math.round(cy);

  fs.mkdirSync(path.join(out, 'tiles'), { recursive: true });
  for (const f of fs.readdirSync(path.join(out, 'tiles'))) if (f.endsWith('.ght')) fs.unlinkSync(path.join(out, 'tiles', f));
  const used = { nodes: {}, errors: [] }, entries = [];
  for (const [spacing, r] of rings) {
    if (spacing * 1000 > 65535) throw Error(`ring spacing ${spacing} m does not fit GGH1 (max 65.535 m)`);
    const tiles = ringTiles(cx, cy, spacing, r);
    process.stderr.write(`ring ${spacing} m to ${r} m: ${tiles.length} tiles\n`);
    for (const t of tiles) {
      const key = `s${spacing}_${t.e0}_${t.n0}`;
      const { h } = await fillTile(t, 257, spacing, packCrs, chain, used);
      for (const part of splitToFit({ ...t, key }, 257, spacing, h)) {
        const enc = encodeTile({ samples: part.samples, spacing, e0: part.e0, n0: part.n0, heights: part.heights });
        const file = `tiles/${part.key}.ght`;
        fs.writeFileSync(path.join(out, file), enc.bytes);
        const e = { key: part.key, file, sha256: sha(enc.bytes), e0: part.e0, n0: part.n0, bytes: enc.bytes.byteLength,
          min_m: Number.isFinite(enc.min) ? +enc.min.toFixed(2) : null, max_m: Number.isFinite(enc.max) ? +enc.max.toFixed(2) : null,
          nodata: enc.nodata, spacing_m: spacing, tile_m: (part.samples - 1) * spacing };
        if (spacing !== rings[0][0]) e.ring = spacing;
        entries.push(e);
      }
      process.stderr.write('.');
    }
    process.stderr.write('\n');
  }

  const usedIds = chain.map(c => c.id).filter(id => used.nodes[id] > 0);
  const lines = usedIds.map(id => { const s = reg.byId.get(id); return s.display || s.attribution_adapted || s.attribution || s.name; });
  const generated = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const index = {
    format: 'ght1', crs: `EPSG:${packEpsg}`,
    site: { name: path.basename(out), region: opts.region || null, lat, lon, origin_e: originE, origin_n: originN },
    tile_m: 256 * rings[0][0], spacing_m: rings[0][0],
    attribution: lines.join(' | '),
    source: usedIds.map(id => `${id}: ${reg.byId.get(id).name}`).join('; '),
    surface: usedIds.map(id => `${id}=${reg.byId.get(id).surface}`).join(', '),
    generated_utc: generated,
    rings: rings.map(([s, r]) => ({ spacing_m: s, radius_m: r, tile_m: 256 * s })),
    tiles: entries
  };
  const indexBytes = Buffer.from(JSON.stringify(index, null, 1) + '\n');
  fs.writeFileSync(path.join(out, 'tiles.json'), indexBytes);
  const total = entries.reduce((a, e) => a + e.bytes, 0) + indexBytes.byteLength;
  const receipt = {
    tool: 'world-lidar tools/pack.mjs', tool_version: TOOL_VERSION, generated_utc: generated,
    place: { region: opts.region || null, lat, lon }, crs: packCrs.name, crs_note: packCrs.approxM ? `Placement error of the CRS conversion is up to about ${packCrs.approxM} m.` : null,
    rings: index.rings, chain: chain.map(c => c.id),
    sources_used: usedIds.map(id => {
      const s = reg.byId.get(id);
      return { id, name: s.name, surface: s.surface, licence: s.licence.name, licence_url: s.licence.url, attribution: s.attribution, attribution_adapted: s.attribution_adapted || null, nodes: used.nodes[id] };
    }),
    source_errors: used.errors,
    requests: log.requests.length > 400 ? { count: log.requests.length, bytes: log.requests.reduce((a, r) => a + r.bytes, 0), first: log.requests.slice(0, 50) } : log.requests,
    files: [{ file: 'tiles.json', sha256: sha(indexBytes), bytes: indexBytes.byteLength }, ...entries.map(e => ({ file: e.file, sha256: e.sha256, bytes: e.bytes }))],
    total_bytes: total,
    registry_sha256: sha(fs.readFileSync(opts.registry || path.join(HERE, '..', 'sources', 'registry.json')))
  };
  fs.writeFileSync(path.join(out, 'RECEIPT.json'), JSON.stringify(receipt, null, 1) + '\n');
  return { out, tiles: entries.length, bytes: total, crs: packCrs.name, used: used.nodes, errors: used.errors, tilesJsonSha: sha(indexBytes) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = await pack(args(process.argv.slice(2)));
    console.log(JSON.stringify(r, null, 1));
  } catch (e) { console.error(`pack: ${e.message}`); process.exit(1); }
}
