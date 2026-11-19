// Apply the saved theme before the app renders so iOS paints the status bar
// area and overscroll background in the right colour from the first frame.
(function () {
  var root = document.documentElement;
  var mode = 'dark';
  try {
    if (localStorage.getItem('workout-theme') === 'light') mode = 'light';
    var palette = localStorage.getItem('workout-palette');
    if (palette && !/^\/demo\/?$/.test(window.location.pathname)) {
      root.dataset.palette = palette;
      var paletteMode = getComputedStyle(root).getPropertyValue('--palette-mode').trim();
      if (paletteMode === 'light' || paletteMode === 'dark') mode = paletteMode;
      else delete root.dataset.palette;
    }
  } catch { /* storage unavailable */ }
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  var meta = document.querySelector('meta[name="theme-color"]');
  var color = getComputedStyle(root).getPropertyValue('--document-background').trim();
  if (meta && color) meta.setAttribute('content', color);
})();
