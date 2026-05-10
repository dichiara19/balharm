/* Bal'harm — Cesium scene setup.
   Viewer, duotone "lapis → oro" custom shader with built-in *reveal regions*
   (the spotlit landmarks come back to real photogrammetry colours, with a soft
   gradient falloff and a subtle warm lift — no second tileset, no overlapping
   geometry, true continuous falloff). Camera bounds + performance tuning. */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};
window.Bh.map.cesium = window.Bh.map.cesium || {};

(function () {
  // The Google 3D Tiles key is *never* shipped in client JS. Tiles are
  // fetched through a same-origin proxy (Cloudflare Pages Function at
  // /api/tiles/*) which adds the key server-side from a private env var.
  // For local development without the function, set window.BH_TILESET_URL
  // before this file loads to point at a direct Google URL with a dev key.
  const TILESET_URL = window.BH_TILESET_URL || "/api/tiles/root.json";

  const CENTER = { lng: 13.3614, lat: 38.1157 };
  const BOUNDS = { minLng: 13.27, maxLng: 13.45, minLat: 38.08, maxLat: 38.21 };

  const MAX_REVEALS = 12;

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

    Cesium.Ion.defaultAccessToken = "";

    // Google's recommended parallelism for the photorealistic tile server.
    Cesium.RequestScheduler.requestsByServer["tile.googleapis.com:443"] = 18;

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
    const ssc = scene.screenSpaceCameraController;
    ssc.enableLook = false;
    ssc.minimumZoomDistance = 250;
    ssc.maximumZoomDistance = 6000;

    // Desktop interaction follows the Cesium 3D defaults — the same scheme
    // used by Google Earth and Cesium ion, so the muscle memory is portable:
    //   Left-drag         → orbit (the map drags around the cursor pivot)
    //   Right-drag        → zoom (vertical motion)
    //   Wheel             → zoom
    //   Middle-drag       → tilt
    //   Ctrl + left-drag  → tilt (alternative for laptops without middle btn)
    // Free-look (turn the camera in place) is disabled — useless here.
    ssc.lookEventTypes = [];

    viewer.cesiumWidget.creditContainer.style.display = "none";

    // On mobile, render at 0.85× the device pixel ratio. Visually almost
    // identical on retina displays but cuts fillrate by ~25%.
    if (window.Bh?.device?.isMobile) {
      viewer.resolutionScale = 0.85;
    }

    // Initial view: looking due north so the on-screen compass starts aligned
    // with true north before the user rotates the map.
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(CENTER.lng, CENTER.lat - 0.022, 1900),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
    });

    scene.postRender.addEventListener(() => {
      const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
      const lng = Cesium.Math.toDegrees(carto.longitude), lat = Cesium.Math.toDegrees(carto.latitude);
      let cl = lng, ca = lat, changed = false;
      if (lng < BOUNDS.minLng) { cl = BOUNDS.minLng; changed = true; }
      if (lng > BOUNDS.maxLng) { cl = BOUNDS.maxLng; changed = true; }
      if (lat < BOUNDS.minLat) { ca = BOUNDS.minLat; changed = true; }
      if (lat > BOUNDS.maxLat) { ca = BOUNDS.maxLat; changed = true; }
      if (changed) viewer.camera.position = Cesium.Cartesian3.fromDegrees(cl, ca, carto.height);
    });

    return { viewer, scene };
  }

  function loadBaseTileset(scene, duotoneShader) {
    const isMobile = !!window.Bh?.device?.isMobile;
    return Cesium.Cesium3DTileset.fromUrl(TILESET_URL, {
      showCreditsOnScreen: false,
      // Mobile gets a much higher SSE: ~half the tile count, big perf win.
      maximumScreenSpaceError: isMobile ? 56 : 32,
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
      // Smaller tile cache on mobile (less RAM available).
      cacheBytes: (isMobile ? 256 : 512) * 1024 * 1024,
      maximumCacheOverflowBytes: (isMobile ? 128 : 256) * 1024 * 1024,
      preloadFlightDestinations: true,
    }).then((ts) => {
      scene.primitives.add(ts);
      try { ts.customShader = duotoneShader; } catch (e) { console.warn(e); }
      return ts;
    });
  }

  // Pre-warm: silently fly the camera to a list of viewpoints so Cesium fetches
  // their tiles into the cache while the splash is still showing. Returns a
  // Promise that resolves once the sequence finishes.
  async function preWarm(viewer, baseTileset, positions, msPerStop = 1100) {
    if (!baseTileset || !positions?.length) return;
    for (const p of positions) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.height),
        orientation: {
          heading: Cesium.Math.toRadians(p.heading ?? 28),
          pitch: Cesium.Math.toRadians(p.pitch ?? -45),
          roll: 0,
        },
      });
      await new Promise((res) => setTimeout(res, msPerStop));
    }
  }

  window.Bh.map.cesium.scene = {
    TILESET_URL, CENTER, BOUNDS, MAX_REVEALS,
    makeDuotoneShader, setShaderReveals, buildViewer, loadBaseTileset, preWarm,
  };
})();
