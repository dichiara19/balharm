/* Bal'harm — render-error recovery and telemetry.
   When anything throws inside a frame, Cesium stops its render loop and puts
   up a modal "An error occurred while rendering" panel: the UI keeps working
   but the map stays black until a reload. Seen on iOS as "RangeError: Invalid
   array length" (a NaN reaching the multi-frustum split, Oct 2026).
   Every such error now goes to analytics with the top of its stack, and the
   map recovers on its own: a non-finite camera is put back on the last good
   frame, any flight is cancelled, an entity whose bounds went non-finite is
   hidden, and the render loop restarts. Errors that
   keep coming back are not looped on forever: past the budget Cesium's own
   panel shows, as before. */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};
window.Bh.map.cesium = window.Bh.map.cesium || {};

(function () {
  const MAX_RECOVERIES = 3;      // within WINDOW_MS, then give up
  const WINDOW_MS = 30000;
  const RESTART_DELAY_MS = 200;

  // Entities hidden for non-finite bounds stay hidden: pins.js refresh()
  // re-applies show on every filter or cluster change and checks this set.
  const quarantine = new Set();
  // Raised before each restart, so per-frame camera drivers (the landmark
  // orbit in index.js) stop instead of feeding the same error back in.
  const recovering = new Cesium.Event();

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

    // A NaN can also sit in one primitive's bounds with the camera fine. The
    // failed frame's commands are still in frameState.commandList (cleared
    // when the next frame starts): find the first with non-finite bounds.
    const finiteBounds = (b) => finite3(b.center) &&
      (b.radius === undefined || Number.isFinite(b.radius)) &&
      (!b.halfAxes || Cesium.Matrix3.toArray(b.halfAxes).every(Number.isFinite));
    function badCommand() {
      const list = scene.frameState.commandList;
      for (let i = 0; i < list.length; i++) {
        const b = list[i].boundingVolume;
        if (b && !finiteBounds(b)) return list[i];
      }
      return null;
    }

    // Both of Cesium's render-loop error paths (an error inside scene.render
    // and one thrown by a pre/postRender listener) end in showErrorPanel, with
    // the loop already stopped: this is the one seam that sees them all.
    let recent = [];
    let restartPending = false;
    widget.showErrorPanel = function (title, message, error) {
      const now = performance.now();
      recent = recent.filter((t) => now - t < WINDOW_MS);
      recent.push(now);
      const cameraOk = cameraFinite();
      const recover = recent.length <= MAX_RECOVERIES && (cameraOk || good.valid);
      // Model entities: the command's owner is the Model, whose id is the
      // entity. Batched geometry (ellipses, cylinders) has no single owner.
      let bad = null, badEntity = null;
      try {
        bad = badCommand();
        const id = bad && bad.owner && bad.owner.id;
        if (id instanceof Cesium.Entity) badEntity = id;
      } catch (e) { /* diagnosis is best effort */ }

      console.error("[Bh] render error:", error);
      try {
        window.Bh.track?.(window.Bh.lib.analytics.EVENTS.RENDER_ERROR, Object.assign(errorParams(error), {
          camera_ok: cameraOk,
          bad_owner: badEntity ? String(badEntity.id).slice(0, 100) : (bad ? "primitive" : ""),
          cesium_v: Cesium.VERSION,
          pinch: !!(opts.isPinching && opts.isPinching()),
          recovered: recover,
          count: recent.length,
        }));
      } catch (e) { /* telemetry never blocks recovery */ }

      if (!recover) {
        // Giving up: a restart still pending would revive the loop behind
        // the panel.
        restartPending = false;
        showPanel(title, message, error);
        return;
      }

      try {
        recovering.raiseEvent();
        // A flight (a tour step) is only cut when it left the camera broken.
        if (!cameraOk) { camera.cancelFlight(); restoreCamera(); }
        if (badEntity) {
          quarantine.add(badEntity);
          badEntity.show = false;
          console.warn(`[Bh] hid entity "${badEntity.id}": non-finite bounds`);
        }
      } catch (e) { console.warn("[Bh] recovery step failed:", e); }
      // One restart at a time: two errors in the same frame (render + a
      // listener) must not schedule two. Restart on a later frame: the
      // stopped loop may still have one requestAnimationFrame pending, which
      // ends it when it sees the flag off. Registered after it, ours runs
      // after it, so only one loop is left.
      if (restartPending) return;
      restartPending = true;
      setTimeout(() => requestAnimationFrame(() => {
        if (!restartPending || widget.isDestroyed()) return;
        restartPending = false;
        widget.useDefaultRenderLoop = true;
        scene.requestRender();
        console.log("[Bh] render loop restarted");
      }), RESTART_DELAY_MS);
    };
  }

  window.Bh.map.cesium.recovery = { install, quarantine, recovering };
})();
