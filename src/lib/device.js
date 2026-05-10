// Bal'harm — runtime device detection.
// One-shot evaluation at boot. The result drives both UI layout (via CSS
// classes on <html>) and Cesium performance tuning (read by scene.js).
window.Bh = window.Bh || {};

window.Bh.device = (function () {
  const coarse  = matchMedia("(pointer: coarse)").matches;
  const narrow  = matchMedia("(max-width: 900px)").matches;
  const tabletW = matchMedia("(max-width: 1280px)").matches;

  // Mobile = touch primary input AND narrow viewport. Desktop browsers
  // resized to 800px stay on the desktop layout (they have hover, mouse).
  const isMobile = coarse && narrow;
  const isTablet = coarse && !narrow && tabletW;
  const isTouch  = coarse || ("ontouchstart" in window);

  const cls = isMobile ? "is-mobile" : isTablet ? "is-tablet" : "is-desktop";
  document.documentElement.classList.add(cls);
  if (isTouch) document.documentElement.classList.add("is-touch");

  console.log(`[Bh] device: ${cls}${isTouch ? " (touch)" : ""}`);

  return { isMobile, isTablet, isTouch, viewportClass: cls };
})();
