/* Bal'harm — stage lights on landmarks (visible beam shaft).
   The duotone-bypass / colour reveal is handled by the shader (scene.js).
   This module adds the *visible light fixture* above each spotlit landmark:
     - one volumetric cone with a smooth alpha gradient (no stacked shells)
     - one bright lamp sphere at the source
   Heights are anchored to the landmark's roof altitude (sampled from the
   tileset, just like the pins). Two entities per landmark — light load. */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};
window.Bh.map.cesium = window.Bh.map.cesium || {};

(function () {
  const DEFAULTS = {
    sourceOffsetY: 320,    // metres above roof — lamp altitude
    targetOffsetY: 12,     // metres above roof — where the cone meets the building
    topRadius:     1.5,    // narrowest at the lamp
    bottomScale:   1.20,   // bottom radius factor (vs landmark.radius)
    color:         "#fff5d8",
  };
  const DEFAULT_ROOF = 35;

  // Beam texture: a PNG with a vertical alpha gradient. The cylinder's surface
  // texture coords map t=0 to the bottom and t=1 to the top, so the image's
  // bottom row is transparent (where the cone meets the building) and the top
  // is the brightest (near the lamp). Using an ImageMaterialProperty with
  // transparent: true is the most reliable way to get translucency on a Cesium
  // cylinder — Fabric materials don't always honour alpha for primitive
  // geometry. PNG gradients are also rasterised by the browser, so the falloff
  // is anti-aliased and shows no banding.
  const beamImageCache = {};
  function beamImageFor(colorHex) {
    if (beamImageCache[colorHex]) return beamImageCache[colorHex];
    const r = parseInt(colorHex.slice(1, 3), 16);
    const g = parseInt(colorHex.slice(3, 5), 16);
    const b = parseInt(colorHex.slice(5, 7), 16);
    const W = 16, H = 256;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    // Canvas y=0 is top of image. For Cesium cylinders, t=1 maps to the top
    // (lamp end). Brightest at y=0, fading to fully transparent at y=H.
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.00, `rgba(${r},${g},${b},0.50)`); // near the lamp
    grad.addColorStop(0.20, `rgba(${r},${g},${b},0.32)`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},0.14)`);
    grad.addColorStop(0.85, `rgba(${r},${g},${b},0.04)`);
    grad.addColorStop(1.00, `rgba(${r},${g},${b},0.00)`); // at the building
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    beamImageCache[colorHex] = canvas.toDataURL();
    return beamImageCache[colorHex];
  }

  function makeStageLight(viewer, landmark) {
    const cfg = Object.assign({}, DEFAULTS, landmark.light || {});
    const { lng, lat, radius, key } = landmark;
    const id = `light-${key}`;

    // Use the landmark's expected altitude as the initial guess so cliffs /
    // hilltops (Castello Utveggio at ~400 m) don't ghost at sea level for a
    // few frames before the sampleHeight result lands.
    const initRoof = (typeof landmark.altitude === "number") ? landmark.altitude : DEFAULT_ROOF;
    const initSourceY = initRoof + cfg.sourceOffsetY;
    const initTargetY = initRoof + cfg.targetOffsetY;
    const centreY = (initSourceY + initTargetY) / 2;
    const coneLen = initSourceY - initTargetY;
    const bottomR = radius * cfg.bottomScale;

    // Single cone — alpha gradient comes from a rasterised PNG (vertical
    // gradient mapped onto the cylinder's surface). Translucency is honoured
    // by ImageMaterialProperty's `transparent` flag.
    const cone = viewer.entities.add({
      id: `${id}-cone`,
      position: Cesium.Cartesian3.fromDegrees(lng, lat, centreY),
      cylinder: {
        length: coneLen,
        topRadius: cfg.topRadius,
        bottomRadius: bottomR,
        slices: 36,
        material: new Cesium.ImageMaterialProperty({
          image: beamImageFor(cfg.color),
          transparent: true,
          color: Cesium.Color.WHITE,
        }),
      },
    });

    // Lamp at the tip + a soft halo. Two ellipsoids: one bright, one diffuse.
    const lampColor = Cesium.Color.fromCssColorString(cfg.color);
    const lamp = viewer.entities.add({
      id: `${id}-lamp`,
      position: Cesium.Cartesian3.fromDegrees(lng, lat, initSourceY + 2),
      ellipsoid: {
        radii: new Cesium.Cartesian3(2.6, 2.6, 2.6),
        material: lampColor.withAlpha(0.95),
      },
    });
    const halo = viewer.entities.add({
      id: `${id}-lamp-halo`,
      position: Cesium.Cartesian3.fromDegrees(lng, lat, initSourceY + 2),
      ellipsoid: {
        radii: new Cesium.Cartesian3(8, 8, 8),
        material: lampColor.withAlpha(0.18),
      },
    });

    return {
      landmark, cfg,
      parts: { cone, lamp, halo },
      roofH: null,
      sampled: false,
    };
  }

  function reposition(light) {
    const { lng, lat } = light.landmark;
    const cfg = light.cfg;
    const roof = light.roofH != null
      ? light.roofH
      : (typeof light.landmark.altitude === "number" ? light.landmark.altitude : DEFAULT_ROOF);
    const sourceY = roof + cfg.sourceOffsetY;
    const targetY = roof + cfg.targetOffsetY;
    const centreY = (sourceY + targetY) / 2;
    const coneLen = sourceY - targetY;

    light.parts.cone.position = Cesium.Cartesian3.fromDegrees(lng, lat, centreY);
    light.parts.cone.cylinder.length = coneLen;
    light.parts.lamp.position = Cesium.Cartesian3.fromDegrees(lng, lat, sourceY + 2);
    light.parts.halo.position = Cesium.Cartesian3.fromDegrees(lng, lat, sourceY + 2);
  }

  function repositionAll(lights, scene, tilesets) {
    const ts = (tilesets || []).filter(Boolean);
    if (!ts.length || !scene.sampleHeight) return;
    Object.values(lights).forEach((light) => {
      if (light.sampled) return;
      const { lng, lat, key } = light.landmark;
      const cart = Cesium.Cartographic.fromDegrees(lng, lat);
      let h;
      try { h = scene.sampleHeight(cart, ts); }
      catch (e) { h = undefined; }
      // Cap 700 m to cover Castello Utveggio / Monte Pellegrino summits.
      if (h === undefined || h === null || isNaN(h) || h > 700 || h < -50) return;
      light.roofH = h;
      light.sampled = true;
      reposition(light);
      console.log(`[Bh] stage beam "${key}" placed on roof=${h.toFixed(1)}m`);
    });
    if (scene.requestRender) scene.requestRender();
  }

  function applyStageLights(viewer, landmarks) {
    const lights = {};
    landmarks.forEach((L) => {
      try {
        lights[L.key] = makeStageLight(viewer, L);
        console.log(`[Bh] stage beam created for "${L.key}"`);
      } catch (e) { console.warn("Stage beam failed for", L.key, e); }
    });
    return lights;
  }

  function updateLandmarkPosition(light, newLng, newLat) {
    light.landmark.lng = newLng;
    light.landmark.lat = newLat;
    light.sampled = false;
    light.roofH = null;
    reposition(light);
    console.log(`[Bh] stage beam "${light.landmark.key}" centroid → ${newLat.toFixed(5)},${newLng.toFixed(5)}`);
  }

  window.Bh.map.cesium.lights = { applyStageLights, repositionAll, updateLandmarkPosition };
})();
