/* Bal'harm — Cesium scene factory.
   Single Cesium-ion-hosted Google 3D Tileset rendered through a duotone
   custom shader that already knows about the *reveal regions* (the spotlit
   landmarks), so we don't need a second clipped tileset to show real colours.
   OSM footprint centroids refine the reveal centres after they arrive
   (background fetch). */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};

(function () {
  const { CATEGORIES, CURIOSITIES } = window.Bh.data;
  const sceneMod = window.Bh.map.cesium.scene;
  const landmarksMod = window.Bh.map.cesium.landmarks;
  const pinsMod = window.Bh.map.cesium.pins;
  const lightsMod = window.Bh.map.cesium.lights;

  const SPOTLIT_KEYS = new Set([
    "cattedrale", "massimo", "normanni", "politeama",
    "quattroCanti", "portaNuova", "portaFelice", "villaGiulia",
    "villinoFlorio", "utveggio", "laCala", "cappuccini",
    "villaBonanno", "santaRosalia",
  ]);

  // ── "You are here" marker sprites ─────────────────────────────────────────
  // A gold 8-point star (mirrors the app's Star mark) floats over the visitor's
  // position, with a soft ground aura. Both are rasterised once to data URLs.
  let _userStarUrl = null;
  function userStarImage() {
    if (_userStarUrl) return _userStarUrl;
    const S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const ctx = cv.getContext("2d");
    const cx = S / 2, cy = S / 2, spikes = 8, rOut = S * 0.45, rIn = S * 0.19;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? rOut : rIn;
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, rOut);
    g.addColorStop(0, "#fff3cf"); g.addColorStop(0.5, "#e7c879"); g.addColorStop(1, "#c9a24a");
    ctx.shadowColor = "rgba(231,200,121,0.9)"; ctx.shadowBlur = 16;
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff5d8"; ctx.stroke();
    _userStarUrl = cv.toDataURL();
    return _userStarUrl;
  }
  let _userAuraUrl = null;
  function userAuraImage() {
    if (_userAuraUrl) return _userAuraUrl;
    const S = 256, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, "rgba(231,200,121,0.80)");
    g.addColorStop(0.35, "rgba(231,200,121,0.42)");
    g.addColorStop(0.70, "rgba(231,200,121,0.13)");
    g.addColorStop(1.00, "rgba(231,200,121,0.00)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    _userAuraUrl = cv.toDataURL();
    return _userAuraUrl;
  }

  function buildScene(host) {
    const categoriesById = CATEGORIES.reduce((m, c) => (m[c.id] = c, m), {});
    const items = CURIOSITIES;

    let activeId = null;
    let filterCats = null;
    let filterYearMax = Infinity;
    let speedMul = 1;
    let onSelectCb = null;
    let onHoverCb = null;
    let onInitialLoadCb = null;
    let onHeadingCb = null;
    let initialLoadFired = false;

    const { viewer, scene } = sceneMod.buildViewer(host);
    const duotoneShader = sceneMod.makeDuotoneShader();

    // Initial reveal configs from the hard-coded landmark catalogue. They get
    // refined later by the OSM centroids when the network responds.
    const spotlit = landmarksMod.LANDMARKS.filter((L) => SPOTLIT_KEYS.has(L.key));
    // Repeat visitors have OSM centroids cached in localStorage — use them
    // for the first frame so reveals + lights don't shift after async OSM
    // resolves. First-time visitors fall through to hard-coded coords and
    // get the snap once, then never again.
    const cachedFootprints = landmarksMod.getCachedFootprintsSync(spotlit);
    const spotlitInitial = spotlit.map((L) => {
      const fp = cachedFootprints[L.key];
      return fp ? { ...L, lng: fp.centroid[0], lat: fp.centroid[1] } : L;
    });
    const initialReveals = landmarksMod.makeRevealConfigs(spotlitInitial, null);
    sceneMod.setShaderReveals(duotoneShader, initialReveals);

    const pins = pinsMod.makePinSystem(viewer, scene, items, categoriesById);

    // Stage-light cones (lamp + halo + beam) disabled: the duotone-disabled
    // reveal on the building reads cleanly on its own, and the cones felt
    // floaty especially on hill-top landmarks like Castello Utveggio. Helpers
    // in lights.js are still exported in case we want to re-enable per-key.
    const stageLights = {};

    let baseTileset = null;

    // Entities a roof-sampling ray must pass through to reach the 3D tiles:
    // every bell / aura, plus the "you are here" marker while it exists.
    const sampleExclude = pins.entities.slice();

    function fireInitialLoadOnce() {
      if (initialLoadFired) return;
      initialLoadFired = true;
      console.log("[Bh] initial tiles loaded");
      onInitialLoadCb && onInitialLoadCb();
    }

    // True while the splash-time cache-warming pass is moving the camera —
    // roof sampling must stay off (it would sample mid-preload altitudes).
    let preloading = false;

    // Splash gate. Cesium's initialTilesLoaded fires when the first tiles are
    // ready — with the Google tileset that is still a coarse level, and finer
    // tiles keep streaming in after the splash has gone. So gate on
    // allTilesLoaded instead, and require tilesLoaded to hold for SETTLE_FRAMES
    // consecutive frames: a pass that is followed by new requests (the next
    // level being asked for) resets the count. Counting frames, not ms, keeps
    // the margin meaningful on slow GPUs too.
    const SETTLE_FRAMES = 12;
    function watchViewSettled(ts) {
      let idleFrames = 0;
      const onFrame = () => {
        idleFrames = ts.tilesLoaded ? idleFrames + 1 : 0;
        if (idleFrames >= SETTLE_FRAMES) {
          scene.postRender.removeEventListener(onFrame);
          preloadZoomLevels(ts, fireInitialLoadOnce);
        }
      };
      ts.allTilesLoaded.addEventListener(function arm() {
        ts.allTilesLoaded.removeEventListener(arm);
        scene.postRender.addEventListener(onFrame);
      });
    }

    // Cache-warming pass: while the splash still covers the canvas, jump the
    // camera through two intermediate zoom levels above the centre and wait
    // for each level's tiles to stream in. The first user zooms then hit a
    // warm cache instead of stalling on cold downloads. Bounded by timeouts
    // so a slow network can't hold the splash hostage; on finish the camera
    // returns to the exact initial view.
    const PRELOAD_LEVELS = [
      { height: 700, pitchDeg: -45 },
      { height: 450, pitchDeg: -45 },
    ];
    const PRELOAD_STEP_TIMEOUT_MS = 2500;
    const PRELOAD_TOTAL_MS = 6000;
    function preloadZoomLevels(ts, onDone) {
      const centre = sceneMod.CENTER;
      const savedDest = viewer.camera.position.clone();
      const savedOrient = {
        heading: viewer.camera.heading,
        pitch: viewer.camera.pitch,
        roll: viewer.camera.roll,
      };
      const startedAt = Date.now();
      let step = 0;
      preloading = true;
      function finish() {
        preloading = false;
        viewer.camera.setView({ destination: savedDest, orientation: savedOrient });
        console.log("[Bh] preload done, splash can lift");
        onDone();
      }
      function nextStep() {
        if (step >= PRELOAD_LEVELS.length || Date.now() - startedAt > PRELOAD_TOTAL_MS) {
          finish();
          return;
        }
        const lv = PRELOAD_LEVELS[step++];
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(centre.lng, centre.lat, lv.height),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(lv.pitchDeg), roll: 0 },
        });
        const stepStart = Date.now();
        const check = () => {
          if (ts.tilesLoaded || Date.now() - stepStart > PRELOAD_STEP_TIMEOUT_MS) {
            setTimeout(nextStep, 50);
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      }
      nextStep();
    }

    sceneMod.loadBaseTileset(scene, duotoneShader).then((ts) => {
      baseTileset = ts;
      ts.allTilesLoaded.addEventListener(sampleRoofs);
      watchViewSettled(ts);

      // Zoom-aware SSE: while the user is actively zooming (wheel / pinch),
      // temporarily raise the screen-space error so Cesium requests fewer,
      // coarser tiles — the gesture stays smooth even on a cold cache. When
      // the camera settles, restore the base SSE and the correct tiles stream
      // in quietly in the background. Ctrl/Shift+wheel (tilt/rotate) excluded.
      const BASE_SSE = ts.maximumScreenSpaceError;
      const ZOOM_SSE = Math.max(BASE_SSE * 2, 80);
      let zoomSseTimer = null;
      const raiseSse = () => {
        ts.maximumScreenSpaceError = ZOOM_SSE;
        clearTimeout(zoomSseTimer);
      };
      const restoreSse = () => {
        clearTimeout(zoomSseTimer);
        zoomSseTimer = setTimeout(() => { ts.maximumScreenSpaceError = BASE_SSE; }, 120);
      };
      scene.canvas.addEventListener("wheel", (e) => {
        if (e.ctrlKey || e.shiftKey) return; // tilt/rotate, not zoom
        raiseSse();
      }, { passive: true });
      const zoomHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
      zoomHandler.setInputAction(raiseSse, Cesium.ScreenSpaceEventType.PINCH_START);
      viewer.camera.moveEnd.addEventListener(restoreSse);

      // OSM refinement disabled — the LANDMARKS table now carries
      // human-verified coords (from Google Maps URLs), so the async Overpass
      // lookup added a visible "snap" on first visit for no real accuracy
      // gain. The helpers in landmarks.js are still exported in case we want
      // to re-enable later for a specific landmark.
    }).catch((err) => { console.warn("Cesium ion 3D Tiles failed:", err); scene.globe.show = true; });

    // Roof sampling: each sample is an extra render + readPixels, so a pass
    // only runs with the camera at rest (never mid-drag / mid-flight) and the
    // view's tiles fully loaded (tilesLoaded — the only moment sampleHeight
    // sees full-detail geometry; a pin locks on its first valid sample).
    // Triggered by allTilesLoaded and by camera moveEnd, whichever comes
    // last. Each pass only samples pins still unlocked *and* in view (see
    // pins.sampleGroundFor), so it costs nothing for the rest; once all are
    // locked the listeners go away. Chunked (5 pins per task) so a pass never
    // stalls the main thread; a camera move aborts it until the next rest.
    let sampling = false, cameraMoving = false, roofsLocked = false;
    function sampleRoofs() {
      if (preloading || sampling || roofsLocked || cameraMoving || !baseTileset?.tilesLoaded) return;
      sampling = true;
      (function chunk(i) {
        if (cameraMoving) { sampling = false; return; }
        for (let n = 0; n < 5 && i < items.length; n++, i++) pins.sampleGroundFor(items[i], sampleExclude);
        if (i < items.length) { setTimeout(() => chunk(i), 0); return; }
        lightsMod.repositionAll(stageLights, scene, sampleExclude);
        sampling = false;
        const pending = items.filter((c) => !pins.pinData[c.id]?.sampled).length
          + Object.values(stageLights).filter((l) => !l.sampled).length;
        if (pending === 0) {
          roofsLocked = true;
          baseTileset.allTilesLoaded.removeEventListener(sampleRoofs);
          console.log("[Bh] all pins + lights locked; roof sampling off");
        }
      })(0);
    }
    viewer.camera.moveStart.addEventListener(() => { cameraMoving = true; });
    viewer.camera.moveEnd.addEventListener(() => { cameraMoving = false; sampleRoofs(); });

    // Click + hover. A single pick() resolves either a real bell (curiosityId)
    // or a collapsed cluster bell (clusterIndex): the two never overlap — when
    // collapsed the members are hidden, when expanded the cluster is hidden.
    // (drillPick used to be needed to see through the translucent stage-light
    // cones; with the cones gone it only multiplied the pick passes per event.)
    // Exception: the "you are here" star billboard ignores depth and floats in
    // front of nearby bells (with its pulse ring over their auras), so only
    // when it is the top hit we drill a few levels for the bell behind it.
    function hitOf(p) {
      const cid = p?.id?.curiosityId ?? p?.primitive?.curiosityId;
      if (cid != null) return { kind: "curiosity", id: cid };
      const ci = p?.id?.clusterIndex ?? p?.primitive?.clusterIndex;
      if (ci != null) return { kind: "cluster", id: ci };
      return null;
    }
    function pickPinOrCluster(windowPos) {
      const p = scene.pick(windowPos);
      if (p?.id?.id !== "user-star") return hitOf(p);
      for (const q of scene.drillPick(windowPos, 4)) {
        const hit = hitOf(q);
        if (hit) return hit;
      }
      return null;
    }

    // Clicking a collapsed cluster flies the camera down past the expand
    // threshold, so the LOD opens the cluster into its fanned ring of bells.
    function flyToCluster(idx) {
      const cl = pins.clusters && pins.clusters[idx];
      if (!cl) return;
      const groundH = pins.pinData[cl.members[0].id]?.groundH ?? 60;
      const target = Cesium.Cartesian3.fromDegrees(cl.centre.lng, cl.centre.lat, groundH + 40);
      const heading = Cesium.Math.toRadians(20 + Math.random() * 30);
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 70), {
        offset: new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(-40), 300),
        duration: 1.6 / speedMul,
        easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT,
      });
    }

    // Find the spotlit landmark whose reveal disk contains the cursor's
    // ground point. Used so the user can click anywhere inside a duotone-
    // disabled patch to fly around the building (Earth-style tour).
    function pickLandmark(windowPos) {
      const pos = scene.pickPosition(windowPos);
      if (!pos) return null;
      const carto = Cesium.Cartographic.fromCartesian(pos);
      const clickLng = Cesium.Math.toDegrees(carto.longitude);
      const clickLat = Cesium.Math.toDegrees(carto.latitude);
      const cosLat = Math.cos(clickLat * Math.PI / 180);
      let best = null, bestDist = Infinity;
      for (const L of spotlitInitial) {
        const dLat = (clickLat - L.lat) * 111320;
        const dLng = (clickLng - L.lng) * 111320 * cosLat;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist <= L.radius * 1.3 && dist < bestDist) { best = L; bestDist = dist; }
      }
      return best;
    }

    // Earth-style fly-and-orbit: lerp into a tilted framing of the landmark
    // then slowly rotate around it. Any user gesture (drag, wheel, click)
    // releases the lock and returns control immediately.
    let orbitStopper = null;
    let orbitJustReleasedAt = 0;
    function flyAroundLandmark(L) {
      if (orbitStopper) orbitStopper();
      const roofH = (typeof L.altitude === "number") ? L.altitude : 35;
      const target = Cesium.Cartesian3.fromDegrees(L.lng, L.lat, roofH);
      const radius = L.radius;
      const range = Math.max(radius * 6, 280);
      const startHeading = Cesium.Math.toRadians(Math.random() * 360);
      const pitch = Cesium.Math.toRadians(-30);
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, radius), {
        offset: new Cesium.HeadingPitchRange(startHeading, pitch, range),
        duration: 2.0 / speedMul,
        easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT,
        complete: () => {
          // Fully explicit orbit: every frame we re-compute the camera pose
          // in *world* coordinates from the static (target, pitch, range)
          // tuple + an incrementing heading. No camera.lookAt, no transform
          // games, no inertia from the default controller (we disable it).
          const ssc = scene.screenSpaceCameraController;
          ssc.enableInputs = false;

          const targetCarto = Cesium.Cartographic.fromCartesian(target);
          const targetLng = Cesium.Math.toDegrees(targetCarto.longitude);
          const targetLat = Cesium.Math.toDegrees(targetCarto.latitude);
          const targetH = targetCarto.height;
          const horizDist = range * Math.cos(pitch);
          const vertDist = -range * Math.sin(pitch);  // pitch < 0 → camera above target
          const metersPerDegLat = 111320;
          const metersPerDegLng = 111320 * Math.cos(targetCarto.latitude);

          const ORBIT_SPEED = Cesium.Math.toRadians(0.08);
          let currentHeading = startHeading;
          let cancelled = false;

          const placeCamera = () => {
            // Camera sits OPPOSITE the heading direction at horizDist.
            const eastOff = -horizDist * Math.sin(currentHeading);
            const northOff = -horizDist * Math.cos(currentHeading);
            const camLng = targetLng + eastOff / metersPerDegLng;
            const camLat = targetLat + northOff / metersPerDegLat;
            const camH = targetH + vertDist;
            viewer.camera.setView({
              destination: Cesium.Cartesian3.fromDegrees(camLng, camLat, camH),
              orientation: { heading: currentHeading, pitch, roll: 0 },
            });
          };

          const onRender = () => {
            if (cancelled) return;
            currentHeading += ORBIT_SPEED;
            placeCamera();
            scene.requestRender();
          };
          placeCamera();  // first frame, immediately after flyTo finished
          scene.preRender.addEventListener(onRender);

          const release = () => {
            if (cancelled) return;
            cancelled = true;
            orbitStopper = null;
            orbitJustReleasedAt = Date.now();
            scene.preRender.removeEventListener(onRender);
            ssc.enableInputs = true;
            scene.requestRender();
            scene.canvas.removeEventListener("pointerdown", release, true);
            scene.canvas.removeEventListener("wheel", release, true);
            window.removeEventListener("keydown", release, true);
          };
          orbitStopper = release;
          scene.canvas.addEventListener("pointerdown", release, true);
          scene.canvas.addEventListener("wheel", release, true);
          window.addEventListener("keydown", release, true);
        },
      });
    }

    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      const hit = pickPinOrCluster(e.position);
      if (hit && hit.kind === "curiosity") {
        const c = items.find((x) => x.id === hit.id);
        if (c) pins.ringBell(c);
        if (onSelectCb) onSelectCb(hit.id);
        return;
      }
      if (hit && hit.kind === "cluster") { flyToCluster(hit.id); return; }
      // Suppress landmark fly-around for ~400 ms after an orbit release —
      // otherwise the same click that stopped the tour can immediately re-
      // start it if it lands inside the reveal radius.
      if (Date.now() - orbitJustReleasedAt < 400) return;
      const L = pickLandmark(e.position);
      if (L) flyAroundLandmark(L);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Hover. A pick is a full extra render pass + readPixels, so at most one
    // runs per HOVER_PICK_MS: straight in the MOUSE_MOVE handler, or from a
    // trailing timeout for the latest position. Deliberately not in a rAF
    // callback: there it lands right after Cesium has submitted its frame and
    // readPixels stalls until the GPU finishes it (measured pick p95 ~39 ms vs
    // ~16 ms from the handler). While a button / finger is down the camera is
    // being dragged: hover is meaningless then, so we skip picking altogether
    // (and drop any stale tooltip once). Consumers are only notified on an
    // actual change — same-id moves still report the new position so the
    // tooltip can follow the cursor.
    const HOVER_PICK_MS = 16;
    let dragging = false;
    let hoverTimer = 0;
    let lastPickAt = 0;
    const hoverPos = new Cesium.Cartesian2();
    let lastHoverId = null;
    let lastCursorHit = false;

    function applyHover(hit, pos) {
      const isHit = !!hit;
      if (isHit !== lastCursorHit) {
        lastCursorHit = isHit;
        scene.canvas.style.cursor = isHit ? "pointer" : "";
      }
      const id = hit && hit.kind === "curiosity" ? hit.id : null;
      if (id == null && lastHoverId == null) return;
      lastHoverId = id;
      if (onHoverCb) onHoverCb(id, pos.x, pos.y);
    }

    const setDragging = (v) => () => { dragging = v; };
    for (const t of ["LEFT", "RIGHT", "MIDDLE"]) {
      handler.setInputAction(setDragging(true), Cesium.ScreenSpaceEventType[`${t}_DOWN`]);
      handler.setInputAction(setDragging(false), Cesium.ScreenSpaceEventType[`${t}_UP`]);
    }
    handler.setInputAction(setDragging(true), Cesium.ScreenSpaceEventType.PINCH_START);
    handler.setInputAction(setDragging(false), Cesium.ScreenSpaceEventType.PINCH_END);

    handler.setInputAction((e) => {
      if (dragging) {
        if (lastCursorHit || lastHoverId != null) applyHover(null, hoverPos);
        return;
      }
      // endPosition is a scratch object Cesium reuses — copy it.
      Cesium.Cartesian2.clone(e.endPosition, hoverPos);
      if (hoverTimer) return;
      const wait = HOVER_PICK_MS - (performance.now() - lastPickAt);
      if (wait <= 0) hoverPick();
      else hoverTimer = setTimeout(hoverPick, wait);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    function hoverPick() {
      hoverTimer = 0;
      if (dragging) return;
      lastPickAt = performance.now();
      applyHover(pickPinOrCluster(hoverPos), hoverPos);
    }

    // requestRenderMode is on, so we can't rely on every-frame preRender for
    // animation. We attach it to preUpdate (fires when scene.requestRender is
    // pending) AND we ourselves call requestRender() on every ringing tick.
    scene.preRender.addEventListener(() => {
      pins.tick(activeId);
      if (pins.hasActiveAnimation?.()) scene.requestRender();
    });

    // ── Heading tracking ───────────────────────────────────────────────────
    // Push the current camera heading (degrees) to the consumer whenever the
    // camera moves. Used to keep the on-screen compass aligned with true N.
    // The native event fires at up to 60 Hz during flyTo, which was causing
    // a cascade of React re-renders on the modal & cornice mid-flight — we
    // rAF-throttle here so at most one update per animation frame reaches
    // React, and raise the no-op threshold so jitter doesn't trigger work.
    let lastHeadingDeg = -1;
    let rafPending = false;
    function emitCameraState() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        // Cluster LOD keys off camera *height* (zoom) — must run even when the
        // heading hasn't changed, so it goes before the heading dead-band below.
        pins.applyClusterLOD?.(viewer.camera.positionCartographic.height);
        const h = Cesium.Math.toDegrees(viewer.camera.heading);
        if (Math.abs(h - lastHeadingDeg) < 0.5) return;
        lastHeadingDeg = h;
        onHeadingCb && onHeadingCb(h);
      });
    }
    viewer.camera.changed.addEventListener(emitCameraState);
    setTimeout(emitCameraState, 0);

    // ── "You are here" marker ────────────────────────────────────────────────
    // A floating, slowly-spinning gold star over the visitor's GPS position,
    // a ground aura, and a "radar" ring that periodically sweeps outward over
    // the nearby curiosities — a non-invasive in-world nearby signal. Animated
    // via preRender + an explicit requestRender (requestRenderMode is on), but
    // only while the marker exists, so the scene returns to idle once cleared.
    const STAR_FLOAT = 72;
    let userMarker = null;
    let userAnimAttached = false;
    // Fallback: typical street level in the old town (ellipsoidal metres —
    // Quattro Canti samples ~57) when the user's spot isn't rendered yet.
    function sampleUserGround(lng, lat) {
      const STREET_H = 55;
      if (!baseTileset) return STREET_H;
      const h = sceneMod.sampleGround(scene, Cesium.Cartographic.fromDegrees(lng, lat), sampleExclude);
      return h === undefined ? STREET_H : h;
    }
    function animateUser() {
      if (!userMarker) return;
      const t = (performance.now() - userMarker.t0) / 1000;
      const { lng, lat, groundH } = userMarker;
      userMarker.star.billboard.rotation = -t * 0.6;                 // slow spin
      userMarker.star.billboard.scale = 0.46 + 0.05 * Math.sin(t * 2.1);
      userMarker.star.position = Cesium.Cartesian3.fromDegrees(
        lng, lat, groundH + STAR_FLOAT + 4 * Math.sin(t * 1.25));    // gentle float
      const PERIOD = 3.4, MAXR = 95;
      const phase = (t % PERIOD) / PERIOD;
      userMarker.pulseR = 8 + phase * MAXR;
      userMarker.pulseColor.alpha = 0.30 * (1 - phase);
      scene.requestRender();
    }
    function clearUserPosition() {
      if (!userMarker) return;
      viewer.entities.remove(userMarker.star);
      viewer.entities.remove(userMarker.aura);
      viewer.entities.remove(userMarker.pulse);
      for (const e of [userMarker.star, userMarker.aura, userMarker.pulse]) {
        sampleExclude.splice(sampleExclude.indexOf(e), 1);
      }
      userMarker = null;
      scene.requestRender();
    }
    function setUserPosition(coords, opts = {}) {
      if (!coords) return;
      const { lat, lng } = coords;
      const groundH = sampleUserGround(lng, lat);
      // watchPosition streams updates: move the existing marker in place rather
      // than recreate it (no flicker), and never re-fly the camera mid-walk.
      if (userMarker) {
        userMarker.lng = lng; userMarker.lat = lat; userMarker.groundH = groundH;
        userMarker.aura.position = Cesium.Cartesian3.fromDegrees(lng, lat);
        userMarker.aura.ellipse.height = groundH + 0.5;
        userMarker.pulse.position = Cesium.Cartesian3.fromDegrees(lng, lat);
        userMarker.pulse.ellipse.height = groundH + 0.6;
        scene.requestRender();
        if (opts.fly === true) flyToUser(lng, lat, groundH);
        return;
      }
      const star = viewer.entities.add({
        id: "user-star",
        position: Cesium.Cartesian3.fromDegrees(lng, lat, groundH + STAR_FLOAT),
        billboard: {
          image: userStarImage(), scale: 0.46, rotation: 0,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      const aura = viewer.entities.add({
        id: "user-aura",
        position: Cesium.Cartesian3.fromDegrees(lng, lat),
        ellipse: {
          semiMajorAxis: 24, semiMinorAxis: 24, height: groundH + 0.5,
          material: new Cesium.ImageMaterialProperty({ image: userAuraImage(), transparent: true }),
          classificationType: Cesium.ClassificationType.NONE,
        },
      });
      // The pulse radius/alpha change every frame, so they are CallbackProperty
      // values read by a dynamic updater. Assigning plain values per frame
      // instead made the entity's geometry "static but changed": the whole
      // batch was rebuilt through the createGeometry workers on every frame.
      const pulseColor = Cesium.Color.fromCssColorString("#e7c879").withAlpha(0.3);
      const pulseRadius = new Cesium.CallbackProperty(() => userMarker ? userMarker.pulseR : 8, false);
      const pulse = viewer.entities.add({
        id: "user-pulse",
        position: Cesium.Cartesian3.fromDegrees(lng, lat),
        ellipse: {
          semiMajorAxis: pulseRadius, semiMinorAxis: pulseRadius, height: groundH + 0.6,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => pulseColor, false)),
          classificationType: Cesium.ClassificationType.NONE,
        },
      });
      userMarker = { star, aura, pulse, pulseR: 8, pulseColor, lng, lat, groundH, t0: performance.now() };
      sampleExclude.push(star, aura, pulse);
      if (!userAnimAttached) { scene.preRender.addEventListener(animateUser); userAnimAttached = true; }
      scene.requestRender();
      if (opts.fly === true) flyToUser(lng, lat, groundH);
    }
    function flyToUser(lng, lat, groundH) {
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lng, lat, groundH), 120),
        { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 440),
          duration: 2.2 / speedMul, easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT });
    }

    return {
      setSelected(id) {
        activeId = id;
        pins.revealFor?.(id);   // keep a selected clustered bell visible
        scene.requestRender();
      },
      setFilter(catsArg, yearMax) {
        filterCats = (catsArg && catsArg.length) ? catsArg : null;
        filterYearMax = (yearMax === undefined || yearMax === null) ? Infinity : yearMax;
        pins.applyVisibility(filterCats, filterYearMax);
        scene.requestRender();
      },
      setSpeed(s) { speedMul = s; },
      setDensity() {},
      setMode(mode) {
        host.classList.toggle("day-mode", mode === "day");
        if (baseTileset) baseTileset.customShader = (mode === "day") ? undefined : duotoneShader;
        scene.requestRender();
      },
      animateTo(c) {
        const d = pins.pinData[c.id];
        const groundH = d ? d.groundH : 80;
        const target = Cesium.Cartesian3.fromDegrees(c.lng, c.lat, groundH + 90);
        const sphere = new Cesium.BoundingSphere(target, 60);
        const heading = Cesium.Math.toRadians(20 + Math.random() * 30);
        viewer.camera.flyToBoundingSphere(sphere, {
          offset: new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(-35), 520),
          duration: 2.4 / speedMul,
          easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT,
        });
      },
      onHover(cb) { onHoverCb = cb; },
      onSelect(cb) { onSelectCb = cb; },
      onInitialLoad(cb) {
        onInitialLoadCb = cb;
        if (initialLoadFired) cb();
      },
      onHeading(cb) { onHeadingCb = cb; },
      setAudioEnabled(v) { pins.setAudioEnabled?.(v); },
      setUserPosition(coords, opts) { setUserPosition(coords, opts); },
      clearUserPosition() { clearUserPosition(); },
    };
  }

  window.Bh.scene = { buildScene };
})();
