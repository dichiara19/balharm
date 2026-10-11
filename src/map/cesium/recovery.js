/* Bal'harm — render-error recovery and telemetry.
   When anything throws inside a frame, Cesium stops its render loop and puts
   up a modal "An error occurred while rendering" panel: the UI keeps working
   but the map stays black until a reload. Seen on iOS as "RangeError: Invalid
   array length" (a NaN reaching the multi-frustum split, Oct 2026).
   Every such error now goes to analytics with the top of its stack, and the
   map recovers on its own: a non-finite camera is put back on the last good
   frame, any flight is cancelled and the render loop restarts. Errors that
   keep coming back are not looped on forever: past the budget Cesium's own
   panel shows, as before. */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};
window.Bh.map.cesium = window.Bh.map.cesium || {};

(function () {
  const MAX_RECOVERIES = 3;      // within WINDOW_MS, then give up
  const WINDOW_MS = 30000;
  const RESTART_DELAY_MS = 200;

  const finite3 = (c) => !!c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z);

  // GA4 caps parameter values at 100 characters: the message and the first
  // three stack frames go in separate parameters, with the origin stripped.
  // Frames are the lines ending in :line:col (V8 "at f (url:l:c)", WebKit
  // "f@url:l:c"); V8's leading "RangeError: …" line is not one.
  function errorParams(error) {
    const clip = (s) => String(s || "").slice(0, 100);
    const message = error ? `${error.name || "Error"}: ${error.message || error}` : "unknown";
    const frames = String((error && error.stack) || "")
      .split("\n")
      .map((l) => l.trim().replace(location.origin, ""))
      .filter((l) => /:\d+:\d+\)?$/.test(l));
    return {
      message: clip(message),
      stack_1: clip(frames[0]),
      stack_2: clip(frames[1]),
      stack_3: clip(frames[2]),
    };
  }

  function install(viewer, opts = {}) {
    const widget = viewer.cesiumWidget;
    const scene = viewer.scene;
    const camera = viewer.camera;
    const showPanel = widget.showErrorPanel.bind(widget);

    // Last camera pose that was entirely finite, in world coordinates.
    const good = {
      valid: false,
      position: new Cesium.Cartesian3(), direction: new Cesium.Cartesian3(),
      up: new Cesium.Cartesian3(), right: new Cesium.Cartesian3(),
    };
    const cameraFinite = () =>
      finite3(camera.positionWC) && finite3(camera.directionWC) &&
      finite3(camera.upWC) && finite3(camera.rightWC);
    scene.postRender.addEventListener(() => {
      if (!cameraFinite()) return;
      Cesium.Cartesian3.clone(camera.positionWC, good.position);
      Cesium.Cartesian3.clone(camera.directionWC, good.direction);
      Cesium.Cartesian3.clone(camera.upWC, good.up);
      Cesium.Cartesian3.clone(camera.rightWC, good.right);
      good.valid = true;
    });
    function restoreCamera() {
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      Cesium.Cartesian3.clone(good.position, camera.position);
      Cesium.Cartesian3.clone(good.direction, camera.direction);
      Cesium.Cartesian3.clone(good.up, camera.up);
      Cesium.Cartesian3.clone(good.right, camera.right);
    }

    // Both of Cesium's render-loop error paths (an error inside scene.render
    // and one thrown by a pre/postRender listener) end in showErrorPanel, with
    // the loop already stopped: this is the one seam that sees them all.
    let recent = [];
    widget.showErrorPanel = function (title, message, error) {
      const now = performance.now();
      recent = recent.filter((t) => now - t < WINDOW_MS);
      recent.push(now);
      const cameraOk = cameraFinite();
      const recover = recent.length <= MAX_RECOVERIES && (cameraOk || good.valid);

      console.error("[Bh] render error:", error);
      try {
        window.Bh.track?.(window.Bh.lib.analytics.EVENTS.RENDER_ERROR, Object.assign(errorParams(error), {
          camera_ok: cameraOk,
          pinch: !!(opts.isPinching && opts.isPinching()),
          recovered: recover,
          count: recent.length,
        }));
      } catch (e) { /* telemetry never blocks recovery */ }

      if (!recover) { showPanel(title, message, error); return; }

      try {
        camera.cancelFlight();
        if (!cameraOk) restoreCamera();
      } catch (e) { console.warn("[Bh] camera reset failed:", e); }
      // Restart on a later frame: the stopped loop may still have one
      // requestAnimationFrame pending, which ends it when it sees the flag
      // off. Registered after it, ours runs after it, so only one loop is left.
      setTimeout(() => requestAnimationFrame(() => {
        widget.useDefaultRenderLoop = true;
        scene.requestRender();
        console.log("[Bh] render loop restarted");
      }), RESTART_DELAY_MS);
    };
  }

  window.Bh.map.cesium.recovery = { install };
})();
