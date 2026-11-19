// Apply the saved theme before the app renders so iOS paints the status bar
// area and overscroll background in the right colour from the first frame.
(function () {
  var dark = true;
  try { dark = localStorage.getItem('workout-theme') !== 'light'; } catch (error) { /* storage unavailable */ }
  var root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#111a14' : '#f3f5f0');
})();
