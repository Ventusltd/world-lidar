// Just enough map projection for elevation packing. No dependencies.
//   Transverse Mercator by Krüger's series (Karney 2011, 6th order in n): sub-millimetre within a UTM zone.
//   UTM on WGS84 (EPSG:326zz north, 327zz south) and ETRS89 (EPSG:258zz); ETRS89 is treated as WGS84, which
//   differs by well under a metre in Europe today.
//   British National Grid (EPSG:27700): Airy 1830 TM plus a 7-parameter Helmert shift from WGS84 to OSGB36.
//   The Helmert shift is good to a few metres, not to OSTN15's centimetres: fine for placing 30 m satellite
//   ground under a 1 m LiDAR pack, not for survey. The receipt says so.
//   Geographic CRSs (4326, 4258, 4269, 4283) are all treated as WGS84 (datum differences of 1-2 m at most).

const D = Math.PI / 180;
const ELL = {
  WGS84: { a: 6378137, f: 1 / 298.257223563 },
  GRS80: { a: 6378137, f: 1 / 298.257222101 },
  AIRY: { a: 6377563.396, f: 1 / 299.3249646 }
};

function tmConstants({ a, f }) {
  const n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const alpha = [0,
    n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
    34729 * n5 / 80640 - 3418889 * n6 / 1995840,
    212378941 * n6 / 319334400];
  const beta = [0,
    n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
    n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
    17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
    4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
    4583 * n5 / 161280 - 108847 * n6 / 3991680,
    20648693 * n6 / 638668800];
  const e = Math.sqrt(f * (2 - f));
  return { A, alpha, beta, e };
}

function makeTM(ell, lat0, lon0, k0, fe, fn) {
  const c = tmConstants(ell), { A, alpha, beta, e } = c;
  const meridian = phi => { // northing of latitude phi on the central meridian, via the same series
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
    const xi = Math.atan(t);
    let s = xi;
    for (let j = 1; j <= 6; j++) s += alpha[j] * Math.sin(2 * j * xi);
    return A * s;
  };
  const n0 = meridian(lat0 * D);
  return {
    forward(lat, lon) {
      const phi = lat * D, lam = (lon - lon0) * D;
      const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
      const xi1 = Math.atan2(t, Math.cos(lam)), eta1 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
      let xi = xi1, eta = eta1;
      for (let j = 1; j <= 6; j++) { xi += alpha[j] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1); eta += alpha[j] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1); }
      return [fe + k0 * A * eta, fn + k0 * (A * xi - n0)];
    },
    inverse(x, y) {
      const eta = (x - fe) / (k0 * A), xi = (y - fn) / (k0 * A) + n0 / A;
      let xi1 = xi, eta1 = eta;
      for (let j = 1; j <= 6; j++) { xi1 -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); eta1 -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
      const tau0 = Math.sin(xi1) / Math.sqrt(Math.sinh(eta1) ** 2 + Math.cos(xi1) ** 2);
      let tau = tau0; // conformal -> geodetic latitude by Newton on tau
      for (let k = 0; k < 8; k++) {
        const s = Math.sinh(e * Math.atanh(e * tau / Math.sqrt(1 + tau * tau)));
        const ti = tau * Math.sqrt(1 + s * s) - s * Math.sqrt(1 + tau * tau);
        const d = (tau0 - ti) / Math.sqrt(1 + ti * ti) * (1 + (1 - e * e) * tau * tau) / ((1 - e * e) * Math.sqrt(1 + tau * tau));
        tau += d;
        if (Math.abs(d) < 1e-12) break;
      }
      return [Math.atan(tau) / D, lon0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1)) / D];
    }
  };
}

// ---- WGS84 <-> OSGB36 (Helmert, OS "Transformations and OSGM15" guide, section 6.6) --------------
function toCart(lat, lon, h, { a, f }) {
  const e2 = f * (2 - f), p = lat * D, l = lon * D, nu = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [(nu + h) * Math.cos(p) * Math.cos(l), (nu + h) * Math.cos(p) * Math.sin(l), (nu * (1 - e2) + h) * Math.sin(p)];
}
function fromCart([x, y, z], { a, f }) {
  const e2 = f * (2 - f), p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 10; i++) { const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); lat = Math.atan2(z + e2 * nu * Math.sin(lat), p); }
  return [lat / D, Math.atan2(y, x) / D];
}
function helmert([x, y, z], t, sign) {
  const s = 1 + sign * t.s * 1e-6, rx = sign * t.rx / 3600 * D, ry = sign * t.ry / 3600 * D, rz = sign * t.rz / 3600 * D;
  return [sign * t.tx + s * x - rz * y + ry * z, sign * t.ty + rz * x + s * y - rx * z, sign * t.tz - ry * x + rx * y + s * z];
}
const WGS_TO_OSGB = { tx: -446.448, ty: 125.157, tz: -542.060, s: 20.4894, rx: -0.1502, ry: -0.2470, rz: -0.8421 };
const bngTM = makeTM(ELL.AIRY, 49, -2, 0.9996012717, 400000, -100000);

// ---- public ---------------------------------------------------------------------------------------
export const GEOGRAPHIC = new Set([4326, 4258, 4269, 4283, 4167, 4617]);

export function utmEpsg(lat, lon) {
  const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
  return (lat >= 0 ? 32600 : 32700) + zone;
}

// A CRS object: { epsg, name, toLL(x, y) -> [lat, lon], fromLL(lat, lon) -> [x, y], geographic, approxM }.
export function crs(epsg) {
  epsg = Number(epsg);
  if (GEOGRAPHIC.has(epsg)) return { epsg, name: `EPSG:${epsg} (as WGS84)`, geographic: true, toLL: (x, y) => [y, x], fromLL: (lat, lon) => [lon, lat], approxM: 2 };
  if (epsg === 27700) {
    return {
      epsg, name: 'EPSG:27700 British National Grid (Helmert from WGS84, a few metres)', geographic: false, approxM: 5,
      fromLL(lat, lon) { const [la, lo] = fromCart(helmert(toCart(lat, lon, 0, ELL.WGS84), WGS_TO_OSGB, 1), ELL.AIRY); return bngTM.forward(la, lo); },
      toLL(x, y) { const [la, lo] = bngTM.inverse(x, y); return fromCart(helmert(toCart(la, lo, 0, ELL.AIRY), WGS_TO_OSGB, -1), ELL.WGS84); }
    };
  }
  let zone = 0, south = false, ell = ELL.WGS84, label = 'WGS 84';
  if (epsg > 32600 && epsg <= 32660) zone = epsg - 32600;
  else if (epsg > 32700 && epsg <= 32760) { zone = epsg - 32700; south = true; }
  else if (epsg >= 25828 && epsg <= 25838) { zone = epsg - 25800; ell = ELL.GRS80; label = 'ETRS89 (as WGS84)'; }
  else if (epsg >= 26901 && epsg <= 26923) { zone = epsg - 26900; ell = ELL.GRS80; label = 'NAD83 (as WGS84)'; }
  else throw Error(`EPSG:${epsg} is not supported by tools/lib/proj.mjs`);
  const tm = makeTM(ell, 0, zone * 6 - 183, 0.9996, 500000, south ? 10000000 : 0);
  return { epsg, name: `EPSG:${epsg} UTM zone ${zone}${south ? 'S' : 'N'} ${label}`, geographic: false, approxM: label === 'WGS 84' ? 0 : 1, fromLL: (lat, lon) => tm.forward(lat, lon), toLL: (x, y) => tm.inverse(x, y) };
}

// Converts a point between two CRSs through WGS84.
export function transform(from, to) {
  if (from.epsg === to.epsg) return (x, y) => [x, y];
  return (x, y) => { const [lat, lon] = from.toLL(x, y); return to.fromLL(lat, lon); };
}
