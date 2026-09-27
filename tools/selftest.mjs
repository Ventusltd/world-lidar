#!/usr/bin/env node
// Offline checks of the tools' own maths. `node tools/selftest.mjs`; add --net to also read one real COG
// per compression the TIFF reader supports (deflate + float predictor, LZW, LZW + float predictor).
import assert from 'node:assert/strict';
import { encodeTile, decodeTile, NODATA } from './lib/ght.mjs';
import { crs, utmEpsg } from './lib/proj.mjs';

let n = 0;
const ok = (name, f) => { f(); n++; console.log(`ok ${name}`); };

ok('GGH1 round trip, no data and 1 cm steps', () => {
  const s = 5, h = new Float64Array(s * s).map((_, i) => 100 + i * 0.013);
  h[7] = NaN;
  const { bytes } = encodeTile({ samples: s, spacing: 30, e0: 445440, n0: 7395840, heights: h });
  assert.equal(bytes.byteLength, 32 + s * s * 2);
  const d = decodeTile(bytes);
  assert.equal(d.samples, s); assert.equal(d.spacing, 30); assert.equal(d.e0, 445440); assert.equal(d.n0, 7395840);
  assert.equal(d.nodata, 1); assert.equal(d.q[7], NODATA);
  for (let i = 0; i < h.length; i++) if (i !== 7) assert.ok(Math.abs((d.baseCm + d.q[i]) / 100 - h[i]) <= 0.005 + 1e-9);
});

ok('GGH1 refuses more than 655.34 m of relief and spacings over 65.535 m', () => {
  assert.throws(() => encodeTile({ samples: 2, spacing: 1, e0: 0, n0: 0, heights: Float64Array.from([0, 0, 0, 700]) }));
  assert.throws(() => encodeTile({ samples: 2, spacing: 90, e0: 0, n0: 0, heights: new Float64Array(4) }));
});

ok('UTM zone choice', () => {
  assert.equal(utmEpsg(51.14, 1.37), 32631); assert.equal(utmEpsg(-23.5, -69.5), 32719); assert.equal(utmEpsg(33.3, -113.2), 32612);
});

ok('UTM forward: 0 N 3 E is (500000, 0) in zone 31; round trips to a micro-degree', () => {
  const u = crs(32631);
  const [x, y] = u.fromLL(0, 3);
  assert.ok(Math.abs(x - 500000) < 1e-6 && Math.abs(y) < 1e-6);
  for (const [la, lo] of [[52.123, 4.567], [0.5, 1.2], [60, 5.9]]) {
    const [a, b] = u.toLL(...u.fromLL(la, lo));
    assert.ok(Math.abs(a - la) < 1e-6 && Math.abs(b - lo) < 1e-6);
  }
});

ok('British National Grid within 5 m of the OS worked example (Helmert, not OSTN15)', () => {
  const [e, nn] = crs(27700).fromLL(52.658007833, 1.716073972); // OS guide: E 651409.903, N 313177.270
  assert.ok(Math.hypot(e - 651409.903, nn - 313177.270) < 5);
});

if (process.argv.includes('--net')) {
  const { openTiff, urlSource, readWindow } = await import('./lib/tiff.mjs');
  const cogs = [
    ['deflate + float predictor (Copernicus GLO-30)', 'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N51_00_E001_00_DEM/Copernicus_DSM_COG_10_N51_00_E001_00_DEM.tif'],
    ['LZW (Scotland phase 1)', 'https://srsp-open-data.s3.eu-west-2.amazonaws.com/lidar/phase-1/dtm/27700/gridded/HY20_1M_DTM_PHASE1.tif'],
    ['LZW + float predictor (USGS 1/3")', 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n33w112/USGS_13_n33w112.tif']
  ];
  for (const [name, url] of cogs) {
    const t = await openTiff(urlSource(url)), i = t.ifds[0];
    const px = await readWindow(t, i, Math.floor(i.width / 2), Math.floor(i.height / 2), 8, 8);
    const good = [...px].filter(v => Number.isFinite(v) && v > -500 && v < 9000).length;
    assert.ok(good > 0, `${name}: no plausible heights`);
    n++; console.log(`ok ${name}: ${good}/64 plausible, e.g. ${px[0].toFixed(2)} m`);
  }
}
console.log(`${n} checks passed`);
