// OpenMotion corrections shared by the adapted Hyperframes extractors.
export const browserHelpers = String.raw`
  var isVisible = (el) => {
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    for (var node = el; node; node = node.parentElement) {
      var s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  var colorCanvas = document.createElement('canvas'); colorCanvas.width = colorCanvas.height = 1;
  var colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
  var colorCache = new Map();
  function brandColor(color, keepAlpha) {
    if (!color || !CSS.supports('color', color) || /^(inherit|initial|unset|currentcolor)$/i.test(color)) return null;
    if (!colorCache.has(color)) {
      colorContext.clearRect(0, 0, 1, 1); colorContext.fillStyle = color; colorContext.fillRect(0, 0, 1, 1);
      colorCache.set(color, Array.from(colorContext.getImageData(0, 0, 1, 1).data));
    }
    var px = colorCache.get(color);
    if (!px[3]) return null;
    return '#' + px.slice(0, keepAlpha && px[3] < 255 ? 4 : 3).map(function(n) { return n.toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }
`;
