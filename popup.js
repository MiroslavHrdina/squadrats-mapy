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

  $('open').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
})();
