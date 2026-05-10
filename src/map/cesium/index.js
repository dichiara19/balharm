/* Bal'harm — Cesium scene factory.
   Single Google 3D Tileset rendered through a duotone custom shader that
   already knows about the *reveal regions* (the spotlit landmarks), so we
   don't need a second clipped tileset to show real colours. OSM footprint
   centroids refine the reveal centres after they arrive (background fetch).
   Camera pre-warming during the splash pulls the relevant tiles into cache
   so the user lands on a fluid scene. */
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

  // Camera viewpoints used to pre-warm the Google tile cache before the
  // splash hides. They cover the two heroes + a city overview.
  const PREWARM_HOPS = [
    { lng: 13.3563, lat: 38.1142, height: 350,  heading: 35,  pitch: -35 }, // Cattedrale close
    { lng: 13.3578, lat: 38.1207, height: 350,  heading: 0,   pitch: -35 }, // Massimo close
    { lng: 13.3617, lat: 38.1157, height: 1900, heading: 28,  pitch: -32 }, // city overview
  ];

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
    const initialReveals = landmarksMod.makeRevealConfigs(spotlit, null);
    sceneMod.setShaderReveals(duotoneShader, initialReveals);

    const pins = pinsMod.makePinSystem(viewer, scene, items, categoriesById);

    // Visible stage beams over the spotlit landmarks.
    const stageLights = lightsMod.applyStageLights(viewer, spotlit);

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
      items.forEach((c) => pins.sampleGroundFor(c, ts));
      ts.tileLoad?.addEventListener?.(() => debouncedReposition());
      ts.initialTilesLoaded?.addEventListener?.(fireInitialLoadOnce);

      // Pre-warm the cache while the splash is still visible.
      sceneMod.preWarm(viewer, ts, PREWARM_HOPS, 1100).then(() => {
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            sceneMod.CENTER.lng - 0.012, sceneMod.CENTER.lat - 0.020, 1900),
          orientation: {
            heading: Cesium.Math.toRadians(28),
            pitch: Cesium.Math.toRadians(-32),
            roll: 0,
          },
        });
      });

      // Refine reveal centres with OSM footprints in the background.
      landmarksMod.fetchFootprints(spotlit).then((footprints) => {
        if (Object.keys(footprints).length) {
          const refined = landmarksMod.makeRevealConfigs(spotlit, footprints);
          sceneMod.setShaderReveals(duotoneShader, refined);
          // Move the stage beams to the true centroids too.
          spotlit.forEach((L) => {
            const fp = footprints[L.key];
            const light = stageLights[L.key];
            if (fp && light) lightsMod.updateLandmarkPosition(light, fp.centroid[0], fp.centroid[1]);
          });
        } else {
          console.warn("[Bh] no OSM footprints — keeping landmark centres");
        }
        scene.requestRender();
      });
    }).catch((err) => { console.warn("Google 3D Tiles failed:", err); scene.globe.show = true; });

    let repoTimer = null;
    function debouncedReposition() {
      if (allLocked) return;
      if (repoTimer) return;
      repoTimer = setTimeout(() => {
        repoTimer = null;
        let pendingPins = 0;
        items.forEach((c) => {
          const d = pins.pinData[c.id];
          if (!d?.sampled) { pins.sampleGroundFor(c, baseTileset); if (!d?.sampled) pendingPins++; }
        });
        // Sample rooftops for stage lights too.
        lightsMod.repositionAll(stageLights, scene, [baseTileset]);
        const pendingLights = Object.values(stageLights).filter((l) => !l.sampled).length;
        if (pendingPins === 0 && pendingLights === 0) {
          allLocked = true;
          console.log("[Bh] all pins + lights locked; tileLoad listener idle");
        }
      }, 1500);
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

    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      const cid = pickCuriosity(e.position);
      if (cid != null) {
        const c = items.find((x) => x.id === cid);
        if (c) pins.ringBell(c);
        if (onSelectCb) onSelectCb(cid);
      }
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
    let lastHeadingDeg = -1;
    function emitHeading() {
      const h = Cesium.Math.toDegrees(viewer.camera.heading);
      if (Math.abs(h - lastHeadingDeg) < 0.25) return;
      lastHeadingDeg = h;
      onHeadingCb && onHeadingCb(h);
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
