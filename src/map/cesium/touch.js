/* Bal'harm — two-finger touch navigation, Google Earth style.
   Cesium's default PINCH drives zoom *and* tilt at once, zooms toward the
   screen centre (terrain picking is off, see scene.js) and tilts around a
   pivot at ellipsoid height, so moving two fingers upward swung the camera
   under the rooftops. This replaces it. The point under the fingers is picked
   once per gesture and everything happens around it:
     • spread / pinch      → zoom toward / away from it (it stays under the fingers)
     • twist               → heading around it
     • both fingers up/down → tilt around it, clamped in pitch and in height
                              above it, so the camera never goes underground.
   The gesture locks to tilt *or* zoom-and-twist after a few pixels, like
   Google Maps, so a pinch doesn't tilt and a tilt doesn't zoom.
   One-finger drag and the mouse are untouched (Cesium's controller). */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};
window.Bh.map.cesium = window.Bh.map.cesium || {};

(function () {
  // Inside scene.js's postRender clamp (-85°…-3°), so the two never fight.
  const MIN_PITCH = Cesium.Math.toRadians(-84.5);
  const MAX_PITCH = Cesium.Math.toRadians(-12);   // never flatter than this
  const MIN_RANGE = 120;          // m from the pivot
  const MAX_RANGE = 5000;         // m from the pivot
  const MAX_HEIGHT = 5000;        // m above the ellipsoid, = ssc.maximumZoomDistance
  const MIN_CLEARANCE = 60;       // m above the pivot, after zoom or tilt
  const TILT_PER_PX = Cesium.Math.toRadians(0.3);
  const LOCK_PX = 10;             // movement before the gesture picks a mode
  const TWIST_START = Cesium.Math.toRadians(8); // twist ignored until this much

  // A NaN written into the camera poisons Cesium's near/far planes and stops
  // rendering ("Invalid array length"): nothing non-finite reaches it.
  const finite3 = (c) => !!c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z);

  function installPinch(viewer) {
    const scene = viewer.scene, camera = viewer.camera, canvas = scene.canvas;
    const ssc = scene.screenSpaceCameraController;
    const ellipsoid = scene.ellipsoid || Cesium.Ellipsoid.WGS84;

    // Take PINCH away from Cesium's zoom and tilt; LEFT_DRAG etc. stay.
    const strip = (types) => (Array.isArray(types) ? types : [types])
      .filter((t) => t !== Cesium.CameraEventType.PINCH);
    ssc.zoomEventTypes = strip(ssc.zoomEventTypes);
    ssc.tiltEventTypes = strip(ssc.tiltEventTypes);

    // All scratch state allocated once: touchmove fires at display rate.
    const g = {
      active: false, mode: null,
      pivot: new Cesium.Cartesian3(), up: new Cesium.Cartesian3(),
      frame: new Cesium.Matrix4(),
      rect: null,
      start: { mx: 0, my: 0, dist: 0, angle: 0 },
      last: { mx: 0, my: 0, dist: 0, angle: 0 },
      twist: 0, twisting: false,
    };
    const cur = { mx: 0, my: 0, dist: 0, angle: 0 };
    const win = new Cesium.Cartesian2();
    const off = new Cesium.Cartesian3();
    const pos = new Cesium.Cartesian3();

    function read(e, out) {
      const r = g.rect;
      const a = e.touches[0], b = e.touches[1];
      const ax = a.clientX - r.left, ay = a.clientY - r.top;
      const bx = b.clientX - r.left, by = b.clientY - r.top;
      out.mx = (ax + bx) / 2;
      out.my = (ay + by) / 2;
      out.dist = Math.max(1, Math.hypot(bx - ax, by - ay));
      out.angle = Math.atan2(by - ay, bx - ax);
      return out;
    }
    const copy = (src, dst) => { dst.mx = src.mx; dst.my = src.my; dst.dist = src.dist; dst.angle = src.angle; };

    // One depth pick per gesture (a readPixels, fine once); falls back to the
    // ellipsoid under the fingers, then under the screen centre.
    function pickPivot(mx, my) {
      win.x = mx; win.y = my;
      let p = scene.pickPositionSupported ? scene.pickPosition(win, g.pivot) : undefined;
      if (!finite3(p)) p = camera.pickEllipsoid(win, ellipsoid, g.pivot);
      if (!finite3(p)) {
        win.x = canvas.clientWidth / 2; win.y = canvas.clientHeight / 2;
        p = camera.pickEllipsoid(win, ellipsoid, g.pivot);
      }
      if (!finite3(p)) return false;
      ellipsoid.geodeticSurfaceNormal(g.pivot, g.up);
      Cesium.Transforms.eastNorthUpToFixedFrame(g.pivot, ellipsoid, g.frame);
      return true;
    }

    const pivotCarto = new Cesium.Cartographic();
    const heightAbovePivot = (p) =>
      Cesium.Cartesian3.dot(Cesium.Cartesian3.subtract(p, g.pivot, off), g.up);

    function zoom(ratio) {
      Cesium.Cartesian3.subtract(camera.positionWC, g.pivot, off);
      const range = Cesium.Cartesian3.magnitude(off);
      if (range < 1e-3) return;
      const elevPerM = Cesium.Cartesian3.dot(off, g.up) / range; // sin(elevation)
      let minRange = MIN_RANGE, maxRange = MAX_RANGE;
      if (elevPerM > 1e-3) {
        minRange = Math.max(minRange, MIN_CLEARANCE / elevPerM);
        // Cesium's maximumZoomDistance no longer applies to pinch: cap height.
        const pivotC = Cesium.Cartographic.fromCartesian(g.pivot, ellipsoid, pivotCarto);
        if (!pivotC) return;
        maxRange = Math.min(maxRange, (MAX_HEIGHT - pivotC.height) / elevPerM);
      }
      // Limits only stop motion in their own direction: a camera already
      // outside them (far pivot near the horizon, close after a flyTo) is
      // never yanked to the limit by the first pinch event.
      const want = range / ratio;
      const next = ratio > 1
        ? Math.max(want, Math.min(range, minRange))
        : Math.min(want, Math.max(range, maxRange));
      if (next === range) return;
      Cesium.Cartesian3.multiplyByScalar(off, next / range, off);
      Cesium.Cartesian3.add(g.pivot, off, pos);
      if (!finite3(pos)) return;
      Cesium.Cartesian3.clone(pos, camera.position);
    }

    // Heading and tilt both rotate the camera around the pivot, in its
    // east-north-up frame. Pitch is read in world space (inside the lookAt
    // frame camera.pitch is not the real one); a tilt step that would leave
    // the pitch range or drop below MIN_CLEARANCE is rolled back whole, and so
    // is any step that leaves the camera non-finite.
    const saved = {
      position: new Cesium.Cartesian3(), direction: new Cesium.Cartesian3(),
      up: new Cesium.Cartesian3(), right: new Cesium.Cartesian3(),
    };
    function save() {
      Cesium.Cartesian3.clone(camera.position, saved.position);
      Cesium.Cartesian3.clone(camera.direction, saved.direction);
      Cesium.Cartesian3.clone(camera.up, saved.up);
      Cesium.Cartesian3.clone(camera.right, saved.right);
    }
    function restore() {
      Cesium.Cartesian3.clone(saved.position, camera.position);
      Cesium.Cartesian3.clone(saved.direction, camera.direction);
      Cesium.Cartesian3.clone(saved.up, camera.up);
      Cesium.Cartesian3.clone(saved.right, camera.right);
    }
    function orbit(dHeading, dPitch) {
      let d = 0;
      if (dPitch) {
        const p = camera.pitch;
        d = Cesium.Math.clamp(p + dPitch, MIN_PITCH, MAX_PITCH) - p;
      }
      save();
      camera.lookAtTransform(g.frame);
      // rotate(axis, a) turns the camera by -a about the pivot's vertical.
      if (dHeading) camera.rotate(Cesium.Cartesian3.UNIT_Z, dHeading);
      // rotateUp lifts the view toward the horizon (pitch rises).
      if (d) camera.rotateUp(d);
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      if (!finite3(camera.position) || !finite3(camera.direction) || !finite3(camera.up)) {
        restore();
        return;
      }
      if (d) {
        const p = camera.pitch;
        if (p > MAX_PITCH + 1e-3 || p < MIN_PITCH - 1e-3 ||
            heightAbovePivot(camera.positionWC) < MIN_CLEARANCE) restore();
      }
    }

    function onStart(e) {
      if (e.touches.length !== 2 || !ssc.enableInputs) { g.active = false; return; }
      g.rect = canvas.getBoundingClientRect();   // once per gesture, not per move
      read(e, g.start); copy(g.start, g.last);
      g.active = pickPivot(g.start.mx, g.start.my);
      g.mode = null; g.twist = 0; g.twisting = false;
    }

    function onMove(e) {
      if (!g.active || e.touches.length !== 2 || !ssc.enableInputs) return;
      read(e, cur);
      if (!g.mode) {
        const dy = Math.abs(cur.my - g.start.my);
        const dx = Math.abs(cur.mx - g.start.mx);
        const dd = Math.abs(cur.dist - g.start.dist);
        let da = Math.abs(cur.angle - g.start.angle);
        if (da > Math.PI) da = 2 * Math.PI - da;
        const arc = da * g.start.dist / 2;   // a pure twist leaves the midpoint still
        if (Math.max(dy, dx, dd, arc) < LOCK_PX) return;
        // Tilt: both fingers travel vertically together, side by side.
        const sideBySide = Math.abs(Math.sin(g.start.angle)) < 0.6;
        g.mode = sideBySide && dy > 2 * dd && dy > dx && dy > arc ? "tilt" : "zoom";
        // Not returning: the move that locks the mode is applied below
        // (g.last is still the gesture start), so nothing is lost.
      }
      if (g.mode === "tilt") {
        // Fingers up → toward the horizon (pitch rises), as in Google Earth.
        orbit(0, -(cur.my - g.last.my) * TILT_PER_PX);
      } else {
        zoom(cur.dist / g.last.dist);
        let da = cur.angle - g.last.angle;
        if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
        if (!g.twisting) {
          g.twist += da;
          if (Math.abs(g.twist) > TWIST_START) g.twisting = true;
        } else if (da) {
          // The map turns with the fingers: a clockwise twist (da > 0, y is
          // down) turns the content clockwise, so the heading decreases.
          orbit(-da, 0);
        }
      }
      copy(cur, g.last);
      scene.requestRender();
    }

    function onEnd(e) {
      if (e.touches.length < 2) { g.active = false; return; }
      // A third finger lifted: carry on with the two left, same pivot (no
      // second readPixels mid-gesture), re-baselined so nothing jumps.
      if (e.touches.length === 2 && g.active) {
        read(e, g.start); copy(g.start, g.last);
        g.mode = null; g.twist = 0; g.twisting = false;
      }
    }

    canvas.addEventListener("touchstart", onStart, { passive: true });
    canvas.addEventListener("touchmove", onMove, { passive: true });
    canvas.addEventListener("touchend", onEnd, { passive: true });
    canvas.addEventListener("touchcancel", onEnd, { passive: true });

    // For the render-error report: was a two-finger gesture under way?
    return { isActive: () => g.active };
  }

  window.Bh.map.cesium.touch = { installPinch };
})();
