#!/usr/bin/env node
// Checks a pack: every file in RECEIPT.json matches its sha256, tiles.json lists exactly the files on disk,
// every tile decodes as GGH1 with a header that agrees with its index entry, and the pack is under a size cap.
//   node tools/verify-pack.mjs packs/<name> [--max-mb 5]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeTile, NODATA } from './lib/ght.mjs';

const dir = process.argv[2];
const maxMb = Number(process.argv[process.argv.indexOf('--max-mb') + 1]) || 5;
if (!dir) { console.error('usage: node tools/verify-pack.mjs <pack dir> [--max-mb 5]'); process.exit(2); }
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fails = [];
const fail = m => fails.push(m);

const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'RECEIPT.json'), 'utf8'));
const indexBytes = fs.readFileSync(path.join(dir, 'tiles.json'));
const index = JSON.parse(indexBytes);
for (const f of receipt.files) {
  const p = path.join(dir, f.file);
  if (!fs.existsSync(p)) { fail(`${f.file} missing`); continue; }
  const b = fs.readFileSync(p);
  if (sha(b) !== f.sha256) fail(`${f.file} sha256 does not match the receipt`);
  if (b.byteLength !== f.bytes) fail(`${f.file} is ${b.byteLength} bytes, receipt says ${f.bytes}`);
}
const onDisk = fs.readdirSync(path.join(dir, 'tiles')).filter(f => f.endsWith('.ght')).map(f => `tiles/${f}`).sort();
const listed = index.tiles.map(t => t.file).sort();
if (JSON.stringify(onDisk) !== JSON.stringify(listed)) fail('tiles/ on disk and tiles.json disagree');
if (index.format !== 'ght1') fail(`format ${index.format} is not ght1`);
if (!/^EPSG:\d+$/.test(index.crs)) fail(`crs ${index.crs} is not EPSG:<code>`);
if (!receipt.sources_used?.length) fail('receipt names no source');
for (const s of receipt.sources_used || []) if (!s.licence || !(s.attribution || s.attribution_adapted)) fail(`source ${s.id} has no licence or attribution in the receipt`);
let total = indexBytes.byteLength, nodes = 0, empty = 0;
for (const t of index.tiles) {
  const b = fs.readFileSync(path.join(dir, t.file));
  total += b.byteLength;
  if (sha(b) !== t.sha256) fail(`${t.file} sha256 does not match tiles.json`);
  let d;
  try { d = decodeTile(new Uint8Array(b)); } catch (e) { fail(`${t.file}: ${e.message}`); continue; }
  if (d.e0 !== t.e0 || d.n0 !== t.n0) fail(`${t.file} origin ${d.e0},${d.n0} differs from index ${t.e0},${t.n0}`);
  if (Math.abs(d.spacing - t.spacing_m) > 1e-9) fail(`${t.file} spacing ${d.spacing} differs from index ${t.spacing_m}`);
  if ((d.samples - 1) * d.spacing !== t.tile_m) fail(`${t.file} width ${(d.samples - 1) * d.spacing} differs from index tile_m ${t.tile_m}`);
  let nd = 0, maxQ = 0;
  for (const q of d.q) { if (q === NODATA) nd++; else if (q > maxQ) maxQ = q; }
  if (nd !== d.nodata || nd !== t.nodata) fail(`${t.file} nodata count ${nd} disagrees with header ${d.nodata} / index ${t.nodata}`);
  if (maxQ !== d.maxQ) fail(`${t.file} max_q ${maxQ} disagrees with header ${d.maxQ}`);
  nodes += d.q.length; empty += nd;
}
if (total > maxMb * 1024 * 1024) fail(`pack is ${(total / 1048576).toFixed(2)} MB, over ${maxMb} MB`);
const summary = `${dir}: ${index.tiles.length} tiles, ${(total / 1048576).toFixed(2)} MB, ${nodes} nodes, ${empty} without data, crs ${index.crs}, tiles.json sha256 ${sha(indexBytes)}`;
if (fails.length) { console.error(`FAIL ${summary}\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log(`ok ${summary}`);
