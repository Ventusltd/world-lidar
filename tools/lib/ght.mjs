// GGH1 height tiles, byte for byte the format the world viewer's terrain layer decodes
// (web/world/layers/terrain.mjs, decodeTile). Little-endian, 32-byte header:
//   0 magic "GGH1" | 4 u16 version=1 | 6 u16 samples | 8 u16 spacing_mm | 10 u16 flags
//   12 i32 origin_e_m | 16 i32 origin_n_m (south-west node) | 20 i32 base_cm | 24 u16 min_q | 26 u16 max_q
//   28 u32 nodata_count. Body: samples*samples u16, rows south to north, each row west to east.
//   height_m = (base_cm + q) / 100; q = 0xFFFF is no data.
// One tile holds at most 655.34 m of relief (q 0..0xFFFE); the packer splits a tile that holds more.

export const HEADER_BYTES = 32, NODATA = 0xffff, MAX_SPAN_CM = 0xfffe;

// heights: Float64Array(samples*samples), rows south to north, NaN = no data.
export function encodeTile({ samples, spacing, e0, n0, heights, flags = 0 }) {
  const spacingMm = Math.round(spacing * 1000);
  if (!(samples >= 2 && samples <= 65535)) throw Error(`samples ${samples} out of range`);
  if (!(spacingMm >= 1 && spacingMm <= 65535)) throw Error(`spacing ${spacing} m does not fit u16 millimetres (max 65.535 m)`);
  if (!Number.isInteger(e0) || !Number.isInteger(n0)) throw Error('tile origin must be whole metres');
  let min = Infinity, max = -Infinity, nodata = 0;
  for (const v of heights) { if (Number.isNaN(v)) { nodata++; continue; } if (v < min) min = v; if (v > max) max = v; }
  const baseCm = Number.isFinite(min) ? Math.floor(min * 100) : 0;
  const q = new Uint16Array(samples * samples);
  let minQ = NODATA, maxQ = 0;
  for (let i = 0; i < q.length; i++) {
    const v = heights[i];
    if (Number.isNaN(v)) { q[i] = NODATA; continue; }
    const k = Math.round(v * 100 - baseCm);
    if (k > MAX_SPAN_CM) throw Error(`tile relief ${((max - min)).toFixed(1)} m is more than 655.34 m`);
    q[i] = k; if (k < minQ) minQ = k; if (k > maxQ) maxQ = k;
  }
  if (minQ === NODATA) minQ = 0;
  const buf = new ArrayBuffer(HEADER_BYTES + q.length * 2), dv = new DataView(buf);
  [71, 71, 72, 49].forEach((c, i) => dv.setUint8(i, c));
  dv.setUint16(4, 1, true); dv.setUint16(6, samples, true); dv.setUint16(8, spacingMm, true); dv.setUint16(10, flags, true);
  dv.setInt32(12, e0, true); dv.setInt32(16, n0, true); dv.setInt32(20, baseCm, true);
  dv.setUint16(24, minQ, true); dv.setUint16(26, maxQ, true); dv.setUint32(28, nodata, true);
  for (let i = 0; i < q.length; i++) dv.setUint16(HEADER_BYTES + 2 * i, q[i], true);
  return { bytes: new Uint8Array(buf), baseCm, min, max, nodata };
}

export function decodeTile(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'GGH1') throw Error(`magic "${magic}" is not GGH1`);
  const samples = dv.getUint16(6, true);
  if (u8.byteLength !== HEADER_BYTES + samples * samples * 2) throw Error('tile length does not match its samples');
  const q = new Uint16Array(samples * samples);
  for (let i = 0; i < q.length; i++) q[i] = dv.getUint16(HEADER_BYTES + 2 * i, true);
  return { version: dv.getUint16(4, true), samples, spacing: dv.getUint16(8, true) / 1000, flags: dv.getUint16(10, true),
    e0: dv.getInt32(12, true), n0: dv.getInt32(16, true), baseCm: dv.getInt32(20, true),
    minQ: dv.getUint16(24, true), maxQ: dv.getUint16(26, true), nodata: dv.getUint32(28, true), q };
}
