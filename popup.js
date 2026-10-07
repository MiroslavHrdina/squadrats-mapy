(function () {
  'use strict';
  const D = SquadratsGeo.DEFAULTS;
  const $ = (id) => document.getElementById(id);
  const boolKeys = ['enabled', 'gridSquadrats', 'gridSquadratinhos', 'fillSquadrats', 'fillSquadratinhos'];

  chrome.storage.local.get(['settings', 'visited'], (res) => {
    const s = Object.assign({}, D, res.settings || {});
    for (const k of boolKeys) {
      $(k).checked = !!s[k];
      $(k).addEventListener('change', () => save({ [k]: $(k).checked }));
    }
    for (const k of ['gridColorMode', 'fillColorMode']) {
      $(k).value = s[k];
      $(k).addEventListener('change', () => save({ [k]: $(k).value }));
    }
    for (const k of ['lineOpacity', 'lineWidth']) {
      $(k).value = s[k];
      $(k).addEventListener('input', () => save({ [k]: parseFloat($(k).value) }));
    }
    $('fillOpacity').value = s.fillOpacity;
    $('fillOpacity').addEventListener('input', () => save({ fillOpacity: parseFloat($('fillOpacity').value) }));
    $('dA').style.background = s.gridColorA;
    $('dB').style.background = s.gridColorB;
    $('fA').style.background = s.fillColorA;
    $('fB').style.background = s.fillColorB;

    const v = res.visited;
    $('counts').textContent = v && v.counts
      ? `Imported: ${v.counts[0].toLocaleString()} squadrats, ${v.counts[1].toLocaleString()} squadratinhos`
      : 'No visited tiles imported yet.';
  });

  function save(patch) {
    chrome.storage.local.get('settings', (res) => {
      chrome.storage.local.set({ settings: Object.assign({}, D, res.settings || {}, patch) });
    });
  }

  // Ask the overlay on the current tab what it is doing.
  const describe = (r) => {
    switch (r.state) {
      case 'drawing':
        return `Overlay active (zoom ${r.zoom}, ${r.polygons.toLocaleString()} polygons loaded, ${r.canvas}px, in <${r.host}>${r.ms != null ? ', ' + r.ms + ' ms' : ''}).`;
      case 'disabled': return 'Overlay is switched off (tick “Overlay on”).';
      case 'no-view': return 'Overlay is waiting: no x/y/z found in the page address. Move the map a little.';
      case 'error': return 'Overlay error: ' + r.error;
      default: return 'Overlay is starting…';
    }
  };
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'sq-status' }, (r) => {
      if (chrome.runtime.lastError || !r) {
        $('status').textContent = 'No overlay on this tab. Open mapy.com and reload the page.';
      } else {
        $('status').textContent = describe(r);
      }
    });
  });

  $('reset').addEventListener('click', () => {
    chrome.storage.local.remove('settings', () => window.close());
  });

  $('open').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
})();
