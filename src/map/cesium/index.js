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
  ]);

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
    let allLocked = false;

    function fireInitialLoadOnce() {
      if (initialLoadFired) return;
      initialLoadFired = true;
      console.log("[Bh] initial tiles loaded");
      onInitialLoadCb && onInitialLoadCb();
    }

    sceneMod.loadBaseTileset(scene, duotoneShader).then((ts) => {
      baseTileset = ts;
      // Sample 50 pins × N points synchronously can block the main thread
      // for several seconds when tiles are still streaming. Chunk it: 5 pins
      // per microtask, yielding between batches so the splash + first frame
      // stay responsive.
      (function chunkedSample(i) {
        for (let n = 0; n < 5 && i < items.length; n++, i++) pins.sampleGroundFor(items[i], ts);
        if (i < items.length) setTimeout(() => chunkedSample(i), 0);
      })(0);
      ts.tileLoad?.addEventListener?.(() => debouncedReposition());
      ts.initialTilesLoaded?.addEventListener?.(fireInitialLoadOnce);

      // OSM refinement disabled — the LANDMARKS table now carries
      // human-verified coords (from Google Maps URLs), so the async Overpass
      // lookup added a visible "snap" on first visit for no real accuracy
      // gain. The helpers in landmarks.js are still exported in case we want
      // to re-enable later for a specific landmark.
    }).catch((err) => { console.warn("Cesium ion 3D Tiles failed:", err); scene.globe.show = true; });

    let repoTimer = null;
    function debouncedReposition() {
      if (allLocked) return;
      if (repoTimer) return;
      // Bumped 1500 → 3000 ms so the heavy sample loop runs at most once every
      // 3 s during the busy tile-streaming window — keeps interaction smooth.
      repoTimer = setTimeout(() => {
        repoTimer = null;
        // Chunked, async sampling so a slow tileLoad burst doesn't stall the
        // main thread. Lights piggyback on the final chunk.
        let pendingPins = 0;
        (function chunkedReposition(i) {
          for (let n = 0; n < 5 && i < items.length; n++, i++) {
            const c = items[i];
            const d = pins.pinData[c.id];
            if (!d?.sampled) {
              pins.sampleGroundFor(c, baseTileset);
              if (!pins.pinData[c.id]?.sampled) pendingPins++;
            }
          }
          if (i < items.length) { setTimeout(() => chunkedReposition(i), 0); return; }
          lightsMod.repositionAll(stageLights, scene, [baseTileset]);
          const pendingLights = Object.values(stageLights).filter((l) => !l.sampled).length;
          if (pendingPins === 0 && pendingLights === 0) {
            allLocked = true;
            console.log("[Bh] all pins + lights locked; tileLoad listener idle");
          }
        })(0);
      }, 3000);
    }

    // Click + hover. Stage-light cones are translucent and sit *in front of*
    // the bells from the camera's POV — a plain pick() would always return
    // the cone instead of the bell. drillPick searches in depth and we keep
    // the first hit that carries a curiosityId (i.e. a real pin).
    function pickCuriosity(windowPos) {
      const drilled = scene.drillPick(windowPos, 6) || [];
      for (const p of drilled) {
        const cid = p?.id?.curiosityId ?? p?.primitive?.curiosityId;
        if (cid != null) return cid;
      }
      return null;
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
      const cid = pickCuriosity(e.position);
      if (cid != null) {
        const c = items.find((x) => x.id === cid);
        if (c) pins.ringBell(c);
        if (onSelectCb) onSelectCb(cid);
        return;
      }
      // Suppress landmark fly-around for ~400 ms after an orbit release —
      // otherwise the same click that stopped the tour can immediately re-
      // start it if it lands inside the reveal radius.
      if (Date.now() - orbitJustReleasedAt < 400) return;
      const L = pickLandmark(e.position);
      if (L) flyAroundLandmark(L);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e) => {
      const cid = pickCuriosity(e.endPosition);
      scene.canvas.style.cursor = cid != null ? "pointer" : "";
      if (onHoverCb) {
        if (cid != null) onHoverCb(cid, e.endPosition.x, e.endPosition.y);
        else onHoverCb(null);
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

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
    function emitHeading() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const h = Cesium.Math.toDegrees(viewer.camera.heading);
        if (Math.abs(h - lastHeadingDeg) < 0.5) return;
        lastHeadingDeg = h;
        onHeadingCb && onHeadingCb(h);
      });
    }
    viewer.camera.changed.addEventListener(emitHeading);
    setTimeout(emitHeading, 0);

    return {
      setSelected(id) {
        activeId = id;
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
    };
  }

  window.Bh.scene = { buildScene };
})();
