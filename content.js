/*
 * Squadrats overlay for Mapy.com.
 *
 * Draws the squadrat (z14) and squadratinho (z17) grids, plus the tiles you
 * have already visited (from a KML downloaded at squadrats.com), on top of the
 * Mapy.com map. The canvas ignores the mouse, so you can keep planning routes
 * as usual.
 *
 * Mapy.com exposes no map API to extensions, so the overlay reads the map
 * centre and zoom from the page URL (?x=lon&y=lat&z=zoom) and assumes the map
 * is a standard 256px Web Mercator map. If the grid ever looks shifted or the
 * wrong size, use the calibration controls on the options page.
 */
(function () {
  'use strict';
  if (window.__squadratsOverlayLoaded) return;
  window.__squadratsOverlayLoaded = true;

  const G = window.SquadratsGeo;

  const DEFAULTS = G.DEFAULTS;

  const num = (v, d, lo, hi) => {
    v = Number(v);
    if (!Number.isFinite(v)) return d;
    return Math.min(hi, Math.max(lo, v));
  };
  // Never let a malformed stored value switch the overlay off silently.
  function sanitize(raw) {
    const s = Object.assign({}, DEFAULTS, raw || {});
    s.fillOpacity = num(s.fillOpacity, DEFAULTS.fillOpacity, 0.05, 1);
    s.lineOpacity = num(s.lineOpacity, DEFAULTS.lineOpacity, 0.05, 1);
    s.gridColorMode = s.gridColorMode === 'one' ? 'one' : 'two';
    s.fillColorMode = s.fillColorMode === 'one' ? 'one' : 'two';
    s.lineWidth = num(s.lineWidth, DEFAULTS.lineWidth, 0.25, 4);
    s.zoomOffset = num(s.zoomOffset, 0, -5, 5);
    s.offsetX = num(s.offsetX, 0, -2000, 2000);
    s.offsetY = num(s.offsetY, 0, -2000, 2000);
    for (const k of ['gridColorA', 'gridColorB', 'fillColorA', 'fillColorB']) {
      if (typeof s[k] !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(s[k])) s[k] = DEFAULTS[k];
    }
    return s;
  }

  let status = { state: 'starting' };
  let settings = Object.assign({}, DEFAULTS);
  let polys = []; // prepared polygons
  let canvas = null;
  let host = null;
  let rafId = 0;
  let lastHref = '';
  let drag = null;
  let tick = 0;
  let lastSig = '';

  // ---------------------------------------------------------------- storage

  function loadAll(cb) {
    chrome.storage.local.get(['settings', 'visited'], (res) => {
      settings = sanitize(res.settings);
      polys = res.visited && res.visited.polys ? G.prepare(res.visited.polys) : [];
      cb && cb();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) settings = sanitize(changes.settings.newValue);
    if (changes.visited) {
      const v = changes.visited.newValue;
      polys = v && v.polys ? G.prepare(v.polys) : [];
    }
    schedule();
  });

  // ------------------------------------------------------------------- view

  function readView() {
    const sources = [location.search, location.hash.replace(/^#/, '?')];
    for (const s of sources) {
      const p = new URLSearchParams(s);
      const lon = parseFloat(p.get('x'));
      const lat = parseFloat(p.get('y'));
      const zoom = parseFloat(p.get('z'));
      if (Number.isFinite(lon) && Number.isFinite(lat) && Number.isFinite(zoom)) {
        return { lon, lat, zoom };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- canvas

  function findHost() {
    let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    if (!el || el === canvas) return null;
    const leaf = /^(CANVAS|IMG|VIDEO|SVG|PICTURE)$/i;
    while (el && leaf.test(el.tagName)) el = el.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const r = el.getBoundingClientRect();
      if (r.width >= innerWidth * 0.6 && r.height >= innerHeight * 0.6) return el;
      el = el.parentElement;
    }
    return null;
  }

  function hostOk() {
    if (!host || !host.isConnected) return false;
    if (host === document.body) return false; // fallback: keep looking for the real map element
    const r = host.getBoundingClientRect();
    return r.width >= innerWidth * 0.6 && r.height >= innerHeight * 0.6;
  }

  function ensureCanvas() {
    if (canvas && canvas.isConnected && hostOk()) return true;
    // The map element can be replaced or resized while the page loads, so look again.
    const h = findHost();
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'squadrats-overlay';
      canvas.style.cssText = 'position:fixed;pointer-events:none;left:0;top:0;';
    }
    if (h) {
      host = h;
      canvas.style.zIndex = '';
      if (canvas.parentElement !== h) h.appendChild(canvas);
    } else {
      // Fallback: cover the viewport; drawn above everything but never blocks clicks.
      host = document.body;
      canvas.style.zIndex = '2147483000';
      if (canvas.parentElement !== document.body) document.body.appendChild(canvas);
    }
    return true;
  }

  function hideCanvas() {
    if (canvas) canvas.style.display = 'none';
  }

  // ------------------------------------------------------------------ draw

  function schedule() {
    if (rafId) return;
    rafId = requestAnimationFrame(draw);
  }

  function draw() {
    rafId = 0;
    const t0 = performance.now();
    try {
      drawInner();
      if (status.state === 'drawing') status.ms = Math.round(performance.now() - t0);
    } catch (e) {
      status = { state: 'error', error: String((e && e.message) || e) };
      console.error('[Squadrats overlay]', e);
      // Make sure a failed draw never leaves a half-hidden canvas behind.
      if (canvas) canvas.style.opacity = '1';
    }
  }

  function drawInner() {
    if (!settings.enabled) {
      status = { state: 'disabled' };
      return hideCanvas();
    }
    const view = readView();
    if (!view) {
      status = { state: 'no-view', href: location.href.slice(0, 120) };
      return hideCanvas();
    }
    ensureCanvas();

    const rect = host === document.body ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;

    canvas.style.display = 'block';
    canvas.style.opacity = '1';
    canvas.style.transform = 'none';
    canvas.style.left = rect.left + 'px';
    canvas.style.top = rect.top + 'px';
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const z = view.zoom + (Number(settings.zoomOffset) || 0);
    const S = G.worldSize(z);
    // World pixel position of the canvas' top-left corner.
    const ox = G.lonToU(view.lon) * S - (w / 2 + (Number(settings.offsetX) || 0));
    const oy = G.latToV(view.lat) * S - (h / 2 + (Number(settings.offsetY) || 0));

    status = {
      state: 'drawing',
      zoom: Math.round(z * 100) / 100,
      host: host === document.body ? 'body (fallback)' : host.tagName.toLowerCase(),
      canvas: w + 'x' + h,
      polygons: polys.length,
      hostConnected: host.isConnected,
    };
    drawFills(ctx, w, h, S, ox, oy);
    drawGrid(ctx, w, h, z, ox, oy, G.Z_SQUADRATINHO, settings.gridSquadratinhos, settings.gridColorMode === 'one' ? settings.gridColorA : settings.gridColorB, Math.max(0.5, settings.lineWidth * 0.5));
    drawGrid(ctx, w, h, z, ox, oy, G.Z_SQUADRAT, settings.gridSquadrats, settings.gridColorA, settings.lineWidth);
  }

  function drawGrid(ctx, w, h, z, ox, oy, tz, on, color, lineWidth) {
    if (!on) return;
    const tilePx = G.TILE * Math.pow(2, z - tz);
    if (tilePx < 10) return; // too dense to be useful
    ctx.save();
    ctx.globalAlpha = settings.lineOpacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    const tx0 = Math.floor(ox / tilePx);
    const tx1 = Math.ceil((ox + w) / tilePx);
    for (let t = tx0; t <= tx1; t++) {
      const x = Math.round(t * tilePx - ox) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    const ty0 = Math.floor(oy / tilePx);
    const ty1 = Math.ceil((oy + h) / tilePx);
    for (let t = ty0; t <= ty1; t++) {
      const y = Math.round(t * tilePx - oy) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawFills(ctx, w, h, S, ox, oy) {
    if (!polys.length) return;
    const want = [settings.fillSquadrats, settings.fillSquadratinhos];
    const colors = settings.fillColorMode === 'one' ? [settings.fillColorA, settings.fillColorA] : [settings.fillColorA, settings.fillColorB];
    const uMin = ox / S;
    const uMax = (ox + w) / S;
    const vMin = oy / S;
    const vMax = (oy + h) / S;

    ctx.save();
    ctx.globalAlpha = settings.fillOpacity;
    for (let k = 0; k < 2; k++) {
      if (!want[k]) continue;
      ctx.fillStyle = colors[k];
      ctx.beginPath(); // batched path for tiny polygons (drawn as small rects)
      let anyTiny = false;
      for (let i = 0; i < polys.length; i++) {
        const p = polys[i];
        if (p.k !== k) continue;
        if (p.maxU < uMin || p.minU > uMax || p.maxV < vMin || p.minV > vMax) continue;
        const bw = (p.maxU - p.minU) * S;
        const bh = (p.maxV - p.minV) * S;
        if (bw < 3 && bh < 3) {
          ctx.rect(p.minU * S - ox, p.minV * S - oy, Math.max(bw, 1), Math.max(bh, 1));
          anyTiny = true;
          continue;
        }
        // Larger polygons: own path, even-odd so holes stay empty.
        const path = new Path2D();
        for (const ring of p.rings) {
          path.moveTo(ring[0] * S - ox, ring[1] * S - oy);
          for (let j = 2; j < ring.length; j += 2) path.lineTo(ring[j] * S - ox, ring[j + 1] * S - oy);
          path.closePath();
        }
        ctx.fill(path, 'evenodd');
      }
      if (anyTiny) ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------- keeping in sync

  // The map is re-centred by Mapy.com, which updates the URL. Poll it: cheap and
  // independent of how the site changes history.
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      schedule();
    } else if (canvas && !canvas.isConnected) {
      schedule();
    } else if (settings.enabled && ++tick % 5 === 0 && canvas) {
      // Every ~0.5 s: has the map element changed size or been replaced?
      let sig;
      if (host === document.body) sig = findHost() ? 'found' : 'none';
      else if (!hostOk()) sig = 'bad';
      else {
        const r = host.getBoundingClientRect();
        sig = r.width + 'x' + r.height;
      }
      if (sig !== lastSig) {
        lastSig = sig;
        schedule();
      }
    }
  }, 100);

  window.addEventListener('resize', schedule);

  // While dragging the map, slide the canvas along so it doesn't lag behind.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || !canvas || !host || !host.contains(e.target) || e.target === canvas) return;
      drag = { x: e.clientX, y: e.clientY };
    },
    true
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || !canvas) return;
      canvas.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
    },
    true
  );
  window.addEventListener(
    'pointerup',
    () => {
      if (!drag) return;
      drag = null;
      setTimeout(schedule, 700); // in case the URL did not change
    },
    true
  );
  window.addEventListener(
    'wheel',
    () => {
      if (!canvas) return;
      canvas.style.opacity = '0';
      setTimeout(schedule, 450);
    },
    { passive: true, capture: true }
  );

  try {
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
      if (msg && msg.type === 'sq-status') {
        reply(Object.assign({ href: location.hostname }, status));
        return false;
      }
    });
  } catch (e) {
    /* extension context gone; the tab needs a reload */
  }

  loadAll(() => {
    lastHref = location.href;
    schedule();
  });
})();
