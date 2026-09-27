// Minimal GeoTIFF / Cloud Optimised GeoTIFF reader for elevation. No dependencies (Node 18+ or a browser).
// Reads classic TIFF and BigTIFF, either byte order, tiled or stripped, one band of int16, uint16, int32,
// uint32, float32 or float64; compression none (1), LZW (5) or deflate (8, 32946); predictor none (1),
// horizontal (2) or floating point (3). Anything else is refused by name. Pixels are read by HTTP range (or
// from a buffer), so a COG is read one internal block at a time.

const TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };

// A byte source: read(offset, length) -> Promise<Uint8Array>. From a URL (HTTP range) or from a buffer.
export function urlSource(url, { fetchImpl = globalThis.fetch, onBytes = () => {}, retries = 3 } = {}) {
  let whole = null;
  return {
    url,
    async read(off, len) {
      if (whole) return whole.subarray(off, off + len);
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetchImpl(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
          if (res.status !== 206 && res.status !== 200) throw Error(`HTTP ${res.status} for ${url}`);
          const b = new Uint8Array(await res.arrayBuffer());
          onBytes(b.byteLength);
          if (res.status === 200) { whole = b; return b.subarray(off, off + len); } // the server ignored the range
          return b;
        } catch (e) {
          if (attempt >= retries || /HTTP 4\d\d/.test(e.message)) throw e;
          await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
        }
      }
    }
  };
}
export function bufferSource(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return { async read(off, len) { return u.subarray(off, Math.min(off + len, u.byteLength)); } };
}

const dv = u => new DataView(u.buffer, u.byteOffset, u.byteLength);

// Reads the header and every IFD (full resolution first, then overviews). Tag values beyond the first
// `head` bytes are fetched on demand.
export async function openTiff(src, { head = 65536 } = {}) {
  const h = await src.read(0, head);
  const d = dv(h), bo = String.fromCharCode(h[0], h[1]);
  if (bo !== 'II' && bo !== 'MM') throw Error(`not a TIFF (byte order "${bo}")`);
  const le = bo === 'II', magic = d.getUint16(2, le), big = magic === 43;
  if (magic !== 42 && !big) throw Error(`TIFF magic ${magic} is neither 42 nor 43`);
  const u64 = (v, p) => Number(v.getBigUint64(p, le));
  const at = async (off, len) => (off + len <= h.byteLength ? h.subarray(off, off + len) : src.read(off, len));
  const ifds = [];
  let next = big ? u64(d, 8) : d.getUint32(4, le);
  while (next && ifds.length < 64) {
    const cntB = await at(next, big ? 8 : 2), n = big ? u64(dv(cntB), 0) : dv(cntB).getUint16(0, le);
    const esz = big ? 20 : 12, body = await at(next + (big ? 8 : 2), n * esz + (big ? 8 : 4)), bd = dv(body);
    const tags = new Map();
    for (let i = 0; i < n; i++) {
      const p = i * esz, tag = bd.getUint16(p, le), type = bd.getUint16(p + 2, le);
      const count = big ? u64(bd, p + 4) : bd.getUint32(p + 4, le), size = (TYPE_BYTES[type] || 1) * count;
      const vp = p + (big ? 12 : 8), inline = size <= (big ? 8 : 4);
      const raw = inline ? body.subarray(vp, vp + size) : await at(big ? u64(bd, vp) : bd.getUint32(vp, le), size);
      const rv = dv(raw), vals = new Array(count);
      for (let k = 0; k < count; k++) {
        const q = k * (TYPE_BYTES[type] || 1);
        vals[k] = type === 3 ? rv.getUint16(q, le) : type === 4 || type === 13 ? rv.getUint32(q, le)
          : type === 8 ? rv.getInt16(q, le) : type === 9 ? rv.getInt32(q, le)
            : type === 11 ? rv.getFloat32(q, le) : type === 12 ? rv.getFloat64(q, le)
              : type === 16 || type === 18 ? u64(rv, q) : type === 17 ? Number(rv.getBigInt64(q, le))
                : type === 5 ? rv.getUint32(q, le) / rv.getUint32(q + 4, le) : raw[q];
      }
      tags.set(tag, type === 2 ? String.fromCharCode(...vals).replace(/\0+$/, '') : vals);
    }
    ifds.push(describe(tags));
    next = big ? u64(bd, n * esz) : bd.getUint32(n * esz, le);
  }
  if (!ifds.length) throw Error('TIFF has no image');
  const g = ifds[0];
  for (const o of ifds.slice(1)) { // overviews carry no georeference of their own: scale the full image's
    if (o.west === undefined) Object.assign(o, { west: g.west, north: g.north, resX: g.resX * g.width / o.width, resY: g.resY * g.height / o.height });
    if (o.nodata === undefined) o.nodata = g.nodata;
    if (!o.geoKeys) o.geoKeys = g.geoKeys;
  }
  return { le, big, ifds: ifds.filter(i => !(i.subfileType & 4) && i.photometric !== 4), src }; // masks dropped
}

function describe(tags) {
  const one = (t, d) => (tags.has(t) ? tags.get(t)[0] : d);
  const tiled = tags.has(322);
  const i = {
    width: one(256), height: one(257), bits: one(258, 1), comp: one(259, 1), photometric: one(262, 1), spp: one(277, 1),
    fmt: one(339, 1), predictor: one(317, 1), planar: one(284, 1), subfileType: one(254, 0),
    tiled, tw: one(322), th: one(323), rowsPerStrip: one(278, one(257)),
    offsets: tags.get(tiled ? 324 : 273), counts: tags.get(tiled ? 325 : 279)
  };
  if (tags.has(34264)) { const m = tags.get(34264); Object.assign(i, { resX: m[0], resY: -m[5], west: m[3], north: m[7] }); }
  else if (tags.has(33550) && tags.has(33922)) {
    const s = tags.get(33550), t = tags.get(33922);
    Object.assign(i, { resX: s[0], resY: s[1], west: t[3] - t[0] * s[0], north: t[4] + t[1] * s[1] });
  }
  if (tags.has(42113)) { const v = parseFloat(tags.get(42113)); if (!Number.isNaN(v)) i.nodata = v; }
  if (tags.has(34735)) {
    const k = tags.get(34735), g = {};
    for (let p = 4; p + 3 < k.length; p += 4) if (k[p + 1] === 0) g[k[p]] = k[p + 3];
    i.geoKeys = g; // 1024 model type, 1025 raster type (1 area, 2 point), 2048 geographic CRS, 3072 projected CRS
  }
  return i;
}

export function epsgOf(ifd) {
  const g = ifd.geoKeys || {};
  return g[3072] && g[3072] !== 32767 ? g[3072] : g[2048] && g[2048] !== 32767 ? g[2048] : null;
}

// ---- decompression -------------------------------------------------------------------------------
async function inflate(u) {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const z = await import('node:zlib');
    return new Uint8Array(z.inflateSync(u));
  }
  const s = new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// TIFF LZW (MSB first, early change).
export function lzw(input, expected) {
  const out = new Uint8Array(expected);
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; length[i] = 1; }
  let op = 0, bit = 0, width = 9, next = 258, prev = -1;
  const total = input.length * 8;
  const emit = c => {
    const n = length[c]; let p = op + n - 1, k = c;
    while (k >= 0) { if (p < expected) out[p] = suffix[k]; p--; k = prefix[k]; }
    op += n;
  };
  while (bit + width <= total) {
    let c = 0;
    for (let i = 0; i < width; i++, bit++) c = (c << 1) | ((input[bit >> 3] >> (7 - (bit & 7))) & 1);
    if (c === 257) break;
    if (c === 256) { width = 9; next = 258; prev = -1; continue; }
    if (prev < 0) { emit(c); prev = c; continue; }
    if (c < next) {
      emit(c);
      if (next < 4096) { prefix[next] = prev; suffix[next] = first[c]; first[next] = first[prev]; length[next] = length[prev] + 1; next++; }
    } else {
      prefix[next] = prev; suffix[next] = first[prev]; first[next] = first[prev]; length[next] = length[prev] + 1; next++;
      emit(c);
    }
    prev = c;
    if (next + 1 >= (1 << width) && width < 12) width++;
    if (op >= expected) break;
  }
  return out;
}

function unpredict(u, predictor, w, rows, bps, le) {
  if (predictor === 1) return u;
  if (predictor === 2) {
    const d = dv(u);
    for (let r = 0; r < rows; r++) for (let c = 1; c < w; c++) {
      const p = (r * w + c) * bps;
      if (bps === 2) d.setUint16(p, (d.getUint16(p, le) + d.getUint16(p - 2, le)) & 0xffff, le);
      else if (bps === 4) d.setUint32(p, (d.getUint32(p, le) + d.getUint32(p - 4, le)) >>> 0, le);
      else u[p] = (u[p] + u[p - 1]) & 0xff;
    }
    return u;
  }
  if (predictor === 3) { // floating point: each row is byte planes (most significant first), byte-differenced
    const out = new Uint8Array(u.length), rowB = w * bps;
    for (let r = 0; r < rows; r++) {
      const row = u.subarray(r * rowB, (r + 1) * rowB);
      for (let i = 1; i < rowB; i++) row[i] = (row[i] + row[i - 1]) & 0xff;
      for (let c = 0; c < w; c++) for (let b = 0; b < bps; b++) out[r * rowB + c * bps + (le ? bps - 1 - b : b)] = row[b * w + c];
    }
    return out;
  }
  throw Error(`TIFF predictor ${predictor} is not supported`);
}

function checkReadable(i) {
  if (i.spp !== 1) throw Error(`TIFF has ${i.spp} samples per pixel; expected one band`);
  const ok = (i.fmt === 3 && (i.bits === 32 || i.bits === 64)) || ((i.fmt === 1 || i.fmt === 2) && (i.bits === 16 || i.bits === 32));
  if (!ok) throw Error(`TIFF sample format ${i.fmt} x ${i.bits}-bit is not supported`);
  if (![1, 5, 8, 32946].includes(i.comp)) throw Error(`TIFF compression ${i.comp} is not supported`);
  if (!i.offsets || !i.counts) throw Error('TIFF has no pixel blocks');
}

function getter(i, d, le) {
  if (i.fmt === 3) return i.bits === 32 ? k => d.getFloat32(k * 4, le) : k => d.getFloat64(k * 8, le);
  if (i.fmt === 2) return i.bits === 16 ? k => d.getInt16(k * 2, le) : k => d.getInt32(k * 4, le);
  return i.bits === 16 ? k => d.getUint16(k * 2, le) : k => d.getUint32(k * 4, le);
}

// Reads the pixel window [x0, x0 + w) x [y0, y0 + h) (rows north to south) of an IFD.
// Returns a Float64Array (w * h) holding NaN outside the image and where the file says no data.
export async function readWindow(tiff, ifd, x0, y0, w, h, { parallel = 4 } = {}) {
  checkReadable(ifd);
  const out = new Float64Array(w * h).fill(NaN), le = tiff.le, bps = ifd.bits / 8;
  const bw = ifd.tiled ? ifd.tw : ifd.width, bh = ifd.tiled ? ifd.th : ifd.rowsPerStrip;
  const across = Math.ceil(ifd.width / bw), down = Math.ceil(ifd.height / bh);
  const cx0 = Math.max(0, Math.floor(x0 / bw)), cx1 = Math.min(across - 1, Math.floor((x0 + w - 1) / bw));
  const cy0 = Math.max(0, Math.floor(y0 / bh)), cy1 = Math.min(down - 1, Math.floor((y0 + h - 1) / bh));
  const jobs = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) jobs.push([cx, cy]);
  const nd = ifd.nodata;
  const one = async ([cx, cy]) => {
    const k = cy * across + cx, len = ifd.counts[k];
    if (!len) return; // a sparse block: no data
    let raw = await tiff.src.read(ifd.offsets[k], len);
    const rows = ifd.tiled ? bh : Math.min(bh, ifd.height - cy * bh), expected = bw * rows * bps;
    if (ifd.comp === 5) raw = lzw(raw, expected);
    else if (ifd.comp !== 1) raw = await inflate(raw);
    else raw = raw.slice();
    if (raw.byteLength < expected) throw Error(`TIFF block ${k} is ${raw.byteLength} bytes, expected ${expected}`);
    raw = unpredict(raw, ifd.predictor, bw, rows, bps, le);
    const get = getter(ifd, dv(raw), le);
    for (let r = 0; r < rows; r++) {
      const oy = cy * bh + r - y0;
      if (oy < 0 || oy >= h || cy * bh + r >= ifd.height) continue;
      for (let c = 0; c < bw; c++) {
        const px = cx * bw + c, ox = px - x0;
        if (ox < 0 || ox >= w || px >= ifd.width) continue;
        const v = get(r * bw + c);
        out[oy * w + ox] = (nd !== undefined && v === nd) || !Number.isFinite(v) || v < -1e30 || v > 1e5 ? NaN : v;
      }
    }
  };
  for (let p = 0; p < jobs.length; p += parallel) await Promise.all(jobs.slice(p, p + parallel).map(one));
  return out;
}
