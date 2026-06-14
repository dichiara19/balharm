// Bal'harm — analytics facade. A thin seam over Google Analytics (gtag.js) so
// the rest of the app depends on Bh.track(...) — an abstraction — instead of
// calling gtag directly. If GA is ever swapped, gated behind a cookie consent,
// or disabled, this is the ONLY file that changes.
window.Bh = window.Bh || {};
window.Bh.lib = window.Bh.lib || {};

(function () {
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  // Send to GA only off-localhost so dev traffic never pollutes the real
  // metrics; on localhost events are logged instead. Mirrors the config guard
  // in index.html. Flip this (or run from a deployed preview) to see live hits.
  const ENABLED = !isLocal;

  // Canonical event names — defined once so call sites can't drift on spelling
  // and the whole tracked surface is readable in one place. GA4 event names:
  // snake_case, ≤40 chars.
  const EVENTS = {
    APP_READY:       "app_ready",        // splash lifted, experience usable
    CURIOSITY_OPEN:  "curiosity_open",   // a curiosity card was shown
    CURIOSITY_SHARE: "curiosity_share",  // user shared / copied a curiosity
    TOUR_START:      "tour_start",
    TOUR_STEP:       "tour_step",
    TOUR_EXIT:       "tour_exit",
    FILTER_CHANGE:   "filter_change",
    LANG_CHANGE:     "lang_change",
    AUDIO_TOGGLE:    "audio_toggle",
    GEO_LOCATE:      "geo_locate",        // visitor located themselves on the map
  };

  // The single dispatch seam. Safe before gtag's script loads (it buffers via
  // dataLayer) and safe when gtag is missing entirely (adblock) — degrades to a
  // no-op. Never throws: a telemetry failure must never surface to the user.
  function track(name, params = {}) {
    try {
      if (!ENABLED) {
        console.log("[Bh] track (dev, not sent):", name, params);
        return;
      }
      if (typeof window.gtag === "function") {
        window.gtag("event", name, params);
      }
    } catch (e) {
      console.warn("[Bh] track failed:", e && e.message);
    }
  }

  window.Bh.lib.analytics = { track, EVENTS, enabled: ENABLED };
  // Convenience alias at the top namespace so call sites read `Bh.track(...)`.
  window.Bh.track = track;
})();
