/* Bal'harm — Cesium scene setup.
   Viewer, duotone "lapis → oro" custom shader with built-in *reveal regions*
   (the spotlit landmarks come back to real photogrammetry colours, with a soft
   gradient falloff and a subtle warm lift — no second tileset, no overlapping
   geometry, true continuous falloff). Camera bounds + performance tuning. */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};
window.Bh.map.cesium = window.Bh.map.cesium || {};

(function () {
  // Google Photorealistic 3D Tiles are not available directly to EEA-billed
  // Google Cloud accounts. We instead use Cesium ion's catalogue copy
  // (asset 2275207), which is delivered through Cesium's own CDN under their
  // commercial agreement with Google. The access token is set on
  // window.CESIUM_ION_TOKEN — locally via dev.local.js, in production by the
  // value hard-coded just below (restricted to balharm domains on the Cesium
  // ion dashboard, so leaking it doesn't enable use elsewhere).
  const GOOGLE_3D_TILES_ION_ASSET_ID = 2275207;
  // Restricted on the Cesium ion dashboard to balharm.com/* and balharm.it/* —
  // safe to ship in client JS because outside those domains the token is
  // useless. Add balharm.pages.dev to the allowed URLs there too if you need
  // to test on the Cloudflare default subdomain before DNS cutover.
  const PROD_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjYTU1M2Y0Zi1jMjFhLTQxOTAtYmE0Yi1hZGZhYjMxYWI5ODIiLCJpZCI6NDMwMDQxLCJzdWIiOiJkaWNoaWFyYTE5IiwiaXNzIjoiaHR0cHM6Ly9pb24uY2VzaXVtLmNvbSIsImF1ZCI6ImJhbGhhcm0iLCJpYXQiOjE3Nzg0OTcyNDN9.d9ARgtWw3aVDYpXgzNPmC513omOCBWKgaAUhSqhb280";

  const CENTER = { lng: 13.3614, lat: 38.1157 };
  // Tightened from ~15×14 km to ~13×7 km: covers Mondello (north), Cappuccini
  // (west), Foro Italico (east) and south of the city, but excludes far-away
  // narrative points (e.g. Targa Florio) that don't need photogrammetric
  // tiles. Camera is clamped to this rectangle on every postRender frame.
  const BOUNDS = { minLng: 13.32, maxLng: 13.39, minLat: 38.09, maxLat: 38.21 };

  // Shader reveal slots. Keep a little headroom above the spotlit-landmark
  // count (currently 13) so adding a "light" doesn't silently drop off the end.
  const MAX_REVEALS = 16;

  // ── Custom shader with reveal regions ──────────────────────────────────
  // Inside a reveal region: skip duotone, lift base colour with a warm tint.
  // Outside: classic duotone. Falloff is smoothstep(0.7r, r) so the boundary
  // is continuous — no visible ring, no overlapping shells.
  function makeDuotoneShader() {
    const uniforms = {};
    for (let i = 0; i < MAX_REVEALS; i++) {
      uniforms[`u_reveal${i}`] = {
        type: Cesium.UniformType.VEC3,
        value: new Cesium.Cartesian3(0, 0, 0),
      };
      uniforms[`u_radius${i}`] = {
        type: Cesium.UniformType.FLOAT,
        value: 0.0, // 0 disables the slot
      };
    }

    const revealLoop = Array.from({ length: MAX_REVEALS }, (_, i) => `
      if (u_radius${i} > 0.5) {
        float d${i} = distance(posW, u_reveal${i});
        // Full reveal up to 85% of the radius; only the last 15% feathers.
        // This makes the no-duotone zone visibly cover the whole building
        // instead of fading out before reaching its outer walls.
        reveal = max(reveal, 1.0 - smoothstep(u_radius${i} * 0.85, u_radius${i}, d${i}));
      }
    `).join("\n");

    const fragmentShaderText = `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        // World ECEF position of this fragment.
        vec3 posW = (czm_inverseView * vec4(fsInput.attributes.positionEC, 1.0)).xyz;

        float reveal = 0.0;
        ${revealLoop}

        vec3 base = material.diffuse;

        // Duotone: lapis → oro (existing palette).
        float lum = dot(base, vec3(0.299, 0.587, 0.114));
        lum = smoothstep(0.05, 0.92, lum);
        vec3 dark  = vec3(0.04, 0.07, 0.20);
        vec3 mid   = vec3(0.13, 0.18, 0.42);
        vec3 warm  = vec3(0.55, 0.40, 0.18);
        vec3 light = vec3(0.92, 0.78, 0.48);
        vec3 toned;
        if (lum < 0.45)      { toned = mix(dark, mid, lum / 0.45); }
        else if (lum < 0.78) { toned = mix(mid, warm, (lum - 0.45) / 0.33); }
        else                 { toned = mix(warm, light, (lum - 0.78) / 0.22); }

        // Inside the reveal: warm-tinted real colour, gentle exposure lift.
        vec3 warmTint = vec3(1.06, 1.00, 0.90);
        vec3 lit = base * warmTint * (1.0 + reveal * 0.30);

        material.diffuse  = mix(toned, lit, reveal);
        material.specular = vec3(0.0);
        material.roughness = 1.0;
      }
    `;

    return new Cesium.CustomShader({ uniforms, fragmentShaderText });
  }

  // Push reveal centres + radii into the shader.
  // `reveals` is an array of { centre: Cartesian3 (ECEF), radius: number }.
  function setShaderReveals(shader, reveals) {
    if (!shader || !shader.uniforms) return;
    for (let i = 0; i < MAX_REVEALS; i++) {
      const r = reveals[i];
      if (r) {
        shader.uniforms[`u_reveal${i}`].value = r.centre;
        shader.uniforms[`u_radius${i}`].value = r.radius;
      } else {
        shader.uniforms[`u_radius${i}`].value = 0.0;
      }
    }
  }

  function buildViewer(host) {
    host.classList.add("cesium-host");
    const cesiumDiv = document.createElement("div");
    cesiumDiv.className = "cesium-stage";
    host.appendChild(cesiumDiv);

    Cesium.Ion.defaultAccessToken = window.CESIUM_ION_TOKEN || PROD_ION_TOKEN;

    // Cesium ion redirects tile fetches to tile.googleapis.com under the
    // hood, so we still need Google's recommended parallelism on *that*
    // server, not on the ion endpoint. Also bump the ion endpoint itself in
    // case future Cesium versions serve tiles directly.
    Cesium.RequestScheduler.requestsByServer["tile.googleapis.com:443"] = 18;
    Cesium.RequestScheduler.requestsByServer["assets.ion.cesium.com:443"] = 18;

    const viewer = new Cesium.Viewer(cesiumDiv, {
      baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, animation: false,
      timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      // Render only when the camera moves or tiles arrive — drops idle GPU load
      // dramatically when the user isn't interacting.
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      shouldAnimate: true,
    });
    const scene = viewer.scene;
    // Keep the globe enabled (invisible behind the duotone tileset). Without
    // a globe Cesium can't pick a stable pivot for left-drag, so rotation
    // behaves erratically — slow, sluggish, indistinguishable from tilt.
    // Painting it the same dark blue as the background hides it visually.
    scene.globe.show = true;
    scene.globe.baseColor = Cesium.Color.fromCssColorString("#06112a");
    scene.globe.depthTestAgainstTerrain = false;
    scene.skyBox.show = false;
    scene.skyAtmosphere.show = false;
    scene.fog.enabled = false;
    scene.backgroundColor = Cesium.Color.fromCssColorString("#06112a");

    // Replace the default sun-based light (which is below the horizon at
    // night-local-time and leaves glTF models pitch-black) with a constant
    // warm-key directional light. Intensity 2.2 keeps the highlights from
    // saturating to pure white — that's what made the bells look like flat
    // cardboard. The duotone tileset shader ignores this anyway, only the
    // bells (and any future glTF entities) get a key light.
    const keyDir = new Cesium.Cartesian3(0.45, 0.55, -0.7);
    Cesium.Cartesian3.normalize(keyDir, keyDir);
    scene.light = new Cesium.DirectionalLight({
      direction: keyDir,
      intensity: 2.6,
      color: Cesium.Color.fromCssColorString("#ffe9b8"),
    });
    // Camera controller: mostly Cesium defaults. Two tweaks:
    //
    //  • maximumZoomDistance = 5000 m → frames the whole Palermo basin
    //    (sea ↔ Monte Pellegrino) and stops the wheel before it ascends to
    //    orbital altitudes and triggers a flood of low-LOD tile loads.
    //
    //  • the three minimum-height thresholds are forced to 0. By default
    //    Cesium switches between "pick the cursor's terrain depth" mode and
    //    "use the globe ellipsoid as pivot" mode based on altitude. At our
    //    300-5000 m range we sit in pick mode, where the rotation speed
    //    follows the distance from camera to the picked point. When the
    //    cursor lands on the empty backdrop, the picked point is the far-
    //    away globe surface → each pixel = tiny angle → drag feels frozen.
    //    Forcing the thresholds to 0 keeps it in trackball mode always, so
    //    rotation speed is consistent no matter where the cursor lands.
    const ssc = scene.screenSpaceCameraController;
    ssc.maximumZoomDistance = 5000;
    ssc.minimumPickingTerrainHeight = 0;
    ssc.minimumCollisionTerrainHeight = 0;
    ssc.minimumTrackBallHeight = 0;

    viewer.cesiumWidget.creditContainer.style.display = "none";

    // Mobile renders at full device pixel ratio — the previous 0.85× setting
    // made the photogrammetry look muddy on retina screens.

    // Initial view: looking due north so the on-screen compass starts aligned
    // with true north before the user rotates the map. Lower altitude than
    // before (1000m vs 1900m) so the initial frame covers a smaller area and
    // needs ~4× fewer tiles to render — the biggest startup-cost lever after
    // the SSE knob.
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(CENTER.lng, CENTER.lat - 0.008, 1000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    });

    // Cesium pitch convention: 0 = looking flat at the horizon, negative =
    // looking down (toward the ground), positive = looking up (toward sky).
    // Ctrl+Left-drag in the default controller can tilt past 0 → the camera
    // ends up looking at the sky, and a small forward movement then plants
    // it inside the photogrammetry. Clamp the pitch in [-85°, -3°]:
    //   • lower limit keeps a couple of degrees from "straight down" — that
    //     vertical gimbal feels vertiginous and easy to flip past
    //   • upper limit -3° is always at least slightly looking down → no sky,
    //     no underground
    const MIN_PITCH = Cesium.Math.toRadians(-85);
    const MAX_PITCH = Cesium.Math.toRadians(-3);
    // Reuse one Cartographic across frames — this listener fires on every
    // rendered frame during a gesture, so allocating per-frame churned the GC.
    const scratchCarto = new Cesium.Cartographic();
    scene.postRender.addEventListener(() => {
      const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position, undefined, scratchCarto);
      const lng = Cesium.Math.toDegrees(carto.longitude), lat = Cesium.Math.toDegrees(carto.latitude);
      let cl = lng, ca = lat, changed = false;
      if (lng < BOUNDS.minLng) { cl = BOUNDS.minLng; changed = true; }
      else if (lng > BOUNDS.maxLng) { cl = BOUNDS.maxLng; changed = true; }
      if (lat < BOUNDS.minLat) { ca = BOUNDS.minLat; changed = true; }
      else if (lat > BOUNDS.maxLat) { ca = BOUNDS.maxLat; changed = true; }
      // Only write the position back when actually outside the rectangle —
      // writing every frame fought the controller's inertia and read as jitter.
      if (changed) viewer.camera.position = Cesium.Cartesian3.fromDegrees(cl, ca, carto.height);

      const p = viewer.camera.pitch;
      if (p > MAX_PITCH || p < MIN_PITCH) {
        const clamped = Math.max(MIN_PITCH, Math.min(MAX_PITCH, p));
        viewer.camera.setView({
          destination: viewer.camera.position,
          orientation: { heading: viewer.camera.heading, pitch: clamped, roll: 0 },
        });
      }
    });

    return { viewer, scene };
  }

  function loadBaseTileset(scene, duotoneShader) {
    const isMobile = !!window.Bh?.device?.isMobile;
    return Cesium.Cesium3DTileset.fromIonAssetId(GOOGLE_3D_TILES_ION_ASSET_ID, {
      showCreditsOnScreen: false,
      // SSE = max on-screen tile error before refining. Desktop was unified to
      // 32 with mobile, but that quietly raised desktop streaming cost and made
      // zoom/pan feel laggy on machines that should be faster. Give desktop a
      // looser 40 (the previously-shipped, visually-fine value → fewer tile
      // loads, smoother navigation) while keeping mobile at 32, where the small
      // screen hides the extra error and a higher value looked like a smear.
      maximumScreenSpaceError: isMobile ? 32 : 40,
      skipLevelOfDetail: true,
      baseScreenSpaceError: 1024,
      skipScreenSpaceErrorFactor: 16,
      skipLevels: 1,
      immediatelyLoadDesiredLevelOfDetail: false,
      loadSiblings: false,
      dynamicScreenSpaceError: true,
      dynamicScreenSpaceErrorDensity: 0.00278,
      dynamicScreenSpaceErrorFactor: 4.0,
      dynamicScreenSpaceErrorHeightFalloff: 0.25,
      // Bigger desktop tile cache so panning back over already-visited streets
      // doesn't re-stream tiles (a major source of desktop pan stutter); mobile
      // stays small (less RAM available).
      cacheBytes: (isMobile ? 256 : 1024) * 1024 * 1024,
      maximumCacheOverflowBytes: (isMobile ? 128 : 512) * 1024 * 1024,
      preloadFlightDestinations: true,
    }).then((ts) => {
      scene.primitives.add(ts);
      try { ts.customShader = duotoneShader; } catch (e) { console.warn(e); }
      return ts;
    });
  }

  window.Bh.map.cesium.scene = {
    CENTER, BOUNDS, MAX_REVEALS,
    makeDuotoneShader, setShaderReveals, buildViewer, loadBaseTileset,
  };
})();
