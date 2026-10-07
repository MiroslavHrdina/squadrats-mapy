/*
 * Shared helpers: Web Mercator maths + KML parsing.
 * Loaded as a content script / options page script in the browser and
 * required directly from Node for tests.
 *
 * Squadrats = tiles of the standard slippy-map grid at zoom 14.
 * Squadratinhos = the same grid at zoom 17.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SquadratsGeo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 256;
  const Z_SQUADRAT = 14;
  const Z_SQUADRATINHO = 17;

  // Normalised mercator coordinates: u, v in [0, 1].
  function lonToU(lon) {
    return (lon + 180) / 360;
  }
  function latToV(lat) {
    let s = Math.sin((lat * Math.PI) / 180);
    s = Math.max(-0.9999, Math.min(0.9999, s));
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }
  function uToLon(u) {
    return u * 360 - 180;
  }
  function vToLat(v) {
    const n = Math.PI - 2 * Math.PI * v;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  // Size of the whole world in CSS pixels at (possibly fractional) zoom z.
  function worldSize(z) {
    return TILE * Math.pow(2, z);
  }

  // Tile index of a point at integer tile zoom tz.
  function lonToTileX(lon, tz) {
    return Math.floor(lonToU(lon) * Math.pow(2, tz));
  }
  function latToTileY(lat, tz) {
    return Math.floor(latToV(lat) * Math.pow(2, tz));
  }

  function round7(n) {
    return Math.round(n * 1e7) / 1e7;
  }

  function parseCoords(str) {
    const out = [];
    const cleaned = String(str || '').replace(/\s*,\s*/g, ',').trim();
    if (!cleaned) return out;
    for (const part of cleaned.split(/\s+/)) {
      const a = part.split(',');
      const lon = parseFloat(a[0]);
      const lat = parseFloat(a[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) out.push(round7(lon), round7(lat));
    }
    return out;
  }

  function childrenByName(el, name) {
    const res = [];
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && (n.localName || n.nodeName) === name) res.push(n);
    }
    return res;
  }

  function firstDescendant(el, name) {
    const l = el.getElementsByTagName(name);
    return l.length ? l[0] : null;
  }

  function ringFromLinearRing(lr) {
    const c = firstDescendant(lr, 'coordinates');
    return c ? parseCoords(c.textContent) : [];
  }

  function namePath(el) {
    const names = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      const nm = childrenByName(n, 'name')[0];
      if (nm && nm.textContent) names.push(nm.textContent.trim());
    }
    return names.join(' / ');
  }

  function bboxWidthDeg(rings) {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < min) min = r[i];
        if (r[i] > max) max = r[i];
      }
    }
    return max - min;
  }

  /*
   * Parse a KML text into polygons.
   *   forcedKind: -1 = auto, 0 = squadrats, 1 = squadratinhos
   * Returns { polys: [{ k, r: [flatLonLatArray, ...] }], counts: [n0, n1] }
   * The first ring is the outer boundary, any further rings are holes.
   *
   * Auto classification: "inho" anywhere in the folder/placemark names ->
   * squadratinho; otherwise by size (a z17 tile is ~0.00275 deg wide, a z14
   * tile ~0.022 deg).
   */
  function parseKml(text, DOMParserCtor, forcedKind) {
    const Ctor = DOMParserCtor || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!Ctor) throw new Error('No DOMParser available');
    const doc = new Ctor().parseFromString(text, 'text/xml');
    if (!doc || !doc.documentElement) throw new Error('Not a valid XML/KML file');
    const bad = doc.getElementsByTagName('parsererror');
    if (bad && bad.length) throw new Error('Not a valid XML/KML file');

    const forced = typeof forcedKind === 'number' ? forcedKind : -1;
    const polys = [];

    function push(rings, path) {
      rings = rings.filter((r) => r.length >= 6);
      if (!rings.length) return;
      let k = forced;
      if (k < 0) {
        if (/inho/i.test(path)) k = 1;
        else k = bboxWidthDeg(rings) <= 0.0035 ? 1 : 0;
      }
      polys.push({ k, r: rings });
    }

    const placemarks = doc.getElementsByTagName('Placemark');
    for (let i = 0; i < placemarks.length; i++) {
      const pm = placemarks[i];
      const path = namePath(pm);
      const polyEls = pm.getElementsByTagName('Polygon');
      if (polyEls.length) {
        for (let j = 0; j < polyEls.length; j++) {
          const pe = polyEls[j];
          const rings = [];
          for (const ob of childrenByName(pe, 'outerBoundaryIs')) {
            const lr = firstDescendant(ob, 'LinearRing');
            if (lr) rings.push(ringFromLinearRing(lr));
          }
          for (const ib of childrenByName(pe, 'innerBoundaryIs')) {
            const lr = firstDescendant(ib, 'LinearRing');
            if (lr) rings.push(ringFromLinearRing(lr));
          }
          push(rings, path);
        }
      } else {
        // Outlines exported as bare closed rings / lines.
        const lrs = pm.getElementsByTagName('LinearRing');
        for (let j = 0; j < lrs.length; j++) push([ringFromLinearRing(lrs[j])], path);
        const lss = pm.getElementsByTagName('LineString');
        for (let j = 0; j < lss.length; j++) {
          const c = firstDescendant(lss[j], 'coordinates');
          const ring = c ? parseCoords(c.textContent) : [];
          const n = ring.length;
          if (n >= 8 && ring[0] === ring[n - 2] && ring[1] === ring[n - 1]) push([ring], path);
        }
      }
    }

    const counts = [0, 0];
    for (const p of polys) counts[p.k]++;
    return { polys, counts };
  }

  // Turn stored polygons into drawing-ready structures in mercator u/v space.
  function prepare(polys) {
    const out = [];
    for (const p of polys) {
      const rings = [];
      let minU = Infinity;
      let minV = Infinity;
      let maxU = -Infinity;
      let maxV = -Infinity;
      for (const flat of p.r) {
        const a = new Float64Array(flat.length);
        for (let i = 0; i < flat.length; i += 2) {
          const u = lonToU(flat[i]);
          const v = latToV(flat[i + 1]);
          a[i] = u;
          a[i + 1] = v;
          if (u < minU) minU = u;
          if (u > maxU) maxU = u;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        rings.push(a);
      }
      out.push({ k: p.k, rings, minU, minV, maxU, maxV });
    }
    return out;
  }

  const DEFAULTS = {
    enabled: true,
    gridSquadrats: true,
    gridSquadratinhos: true,
    fillSquadrats: true,
    fillSquadratinhos: true,
    fillOpacity: 0.35,
    lineOpacity: 0.6,
    gridColorA: '#e8590c',
    gridColorB: '#1971c2',
    fillColorA: '#2f9e44',
    fillColorB: '#f08c00',
    zoomOffset: 0,
    offsetX: 0,
    offsetY: 0,
  };

  return {
    DEFAULTS,
    TILE,
    Z_SQUADRAT,
    Z_SQUADRATINHO,
    lonToU,
    latToV,
    uToLon,
    vToLat,
    worldSize,
    lonToTileX,
    latToTileY,
    parseCoords,
    parseKml,
    prepare,
  };
});
