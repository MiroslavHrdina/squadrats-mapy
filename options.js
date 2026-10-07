(function () {
  'use strict';
  const G = SquadratsGeo;
  const D = G.DEFAULTS;
  const $ = (id) => document.getElementById(id);
  const fields = ['gridColorA', 'gridColorB', 'fillColorA', 'fillColorB', 'lineOpacity', 'fillOpacity', 'zoomOffset', 'offsetX', 'offsetY'];

  function status(msg, ok) {
    const el = $('status');
    el.textContent = msg;
    el.className = 'status ' + (ok === true ? 'ok' : ok === false ? 'err' : '');
  }

  function loadSettings() {
    chrome.storage.local.get(['settings', 'visited'], (res) => {
      const s = Object.assign({}, D, res.settings || {});
      for (const f of fields) $(f).value = s[f];
      const v = res.visited;
      if (v && v.counts) {
        status(`Currently imported: ${v.counts[0].toLocaleString()} squadrats, ${v.counts[1].toLocaleString()} squadratinhos.`);
      }
    });
  }

  function saveField(f) {
    const el = $(f);
    const val = el.type === 'number' || el.type === 'range' ? parseFloat(el.value) : el.value;
    if (typeof val === 'number' && !Number.isFinite(val)) return;
    chrome.storage.local.get('settings', (res) => {
      chrome.storage.local.set({ settings: Object.assign({}, D, res.settings || {}, { [f]: val }) });
    });
  }
  for (const f of fields) {
    $(f).addEventListener('input', () => saveField(f));
  }

  $('file').addEventListener('change', () => {
    $('import').disabled = !$('file').files.length;
  });

  $('import').addEventListener('click', async () => {
    const files = Array.from($('file').files);
    if (!files.length) return;
    const forced = parseInt($('kind').value, 10);
    $('import').disabled = true;
    status('Reading…');
    try {
      let imported = [];
      for (const f of files) {
        const text = await f.text();
        imported = imported.concat(G.parseKml(text, DOMParser, forced).polys);
      }
      if (!imported.length) throw new Error('No tile polygons found in the selected file(s).');

      const kinds = new Set(imported.map((p) => p.k));
      const res = await new Promise((r) => chrome.storage.local.get('visited', r));
      const keep = res.visited && res.visited.polys ? res.visited.polys.filter((p) => !kinds.has(p.k)) : [];
      const polys = keep.concat(imported);
      const counts = [0, 0];
      for (const p of polys) counts[p.k]++;

      await new Promise((r) => chrome.storage.local.set({ visited: { polys, counts, importedAt: Date.now() } }, r));
      if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
      status(`Imported. Now stored: ${counts[0].toLocaleString()} squadrats, ${counts[1].toLocaleString()} squadratinhos. Reload your Mapy.com tab if it is already open.`, true);
    } catch (e) {
      status('Import failed: ' + e.message, false);
    } finally {
      $('import').disabled = !$('file').files.length;
    }
  });

  $('clear').addEventListener('click', () => {
    chrome.storage.local.remove('visited', () => status('Imported tiles removed.', true));
  });

  $('reset').addEventListener('click', () => {
    chrome.storage.local.remove('settings', loadSettings);
  });

  loadSettings();
})();
