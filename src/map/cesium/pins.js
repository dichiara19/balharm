/* Bal'harm — 3D pins as souk-style bells, rendered from a real glTF model.
   Each curiosity is a single Cesium entity backed by uploads/elements/bell.glb.
   On click the bell swings around its handle (top of the model) using a true
   3D rotation (Quaternion via HeadingPitchRoll) plus a small lateral+vertical
   compensation so the pivot point stays anchored. The recording in
   uploads/sounds plays via WebAudio (overlap-safe). */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};
window.Bh.map.cesium = window.Bh.map.cesium || {};

(function () {
  // ── Asset paths ──────────────────────────────────────────────────────────
  const BELL_MODEL_URI = "uploads/elements/bell.glb";
  const BELL_FILENAME  = "Single_small_brass_h_#4-1778336929730.mp3";
  const BELL_AUDIO_URL = "uploads/sounds/" + encodeURIComponent(BELL_FILENAME);

  // ── Geometry constants ───────────────────────────────────────────────────
  // BELL_SCALE controls visual size; BELL_HALF_HEIGHT is the distance from the
  // model's centre (its position anchor) to the handle (the swing pivot).
  // glTF authors usually centre the bbox, so half-height ≈ scale × 0.5.
  // Tune if the reference model uses a different origin.
  const BELL_SCALE       = 14;
  const BELL_HALF_HEIGHT = 7;
  // Clearance above the sampled rooftop. The cross-sampler in
  // sampleGroundFor already picks the *highest* surrounding point, so we
  // don't need a huge buffer on top — 8m is enough for the bell to read as
  // "perched on the roof" without floating like a skyscraper antenna.
  const BELL_GROUND_OFFSET = 8;

  // Per-category coloured aura ("shadow") on the rooftop under each bell.
  // The model itself keeps its native texture; the aura carries the theme.
  const AURA_COLORS = {
    arch: "#caa05a",
    art:  "#b65a4d",
    hist: "#d6c4a0",
    sci:  "#7ab0d4",
    nat:  "#9bbd80",
    food: "#dd9070",
  };
  const FALLBACK_AURA = AURA_COLORS.arch;
  const AURA_RADIUS    = 18;   // metres
  const AURA_HEIGHT_OFF = 0.5; // metres above the sampled rooftop

  // Generate a radial-gradient PNG (data URL) we can use as ImageMaterialProperty
  // on the aura ellipse. A real raster gradient avoids the visible-rings look
  // of stacked translucent ellipsoids.
  const auraImageCache = {};
  function auraImageFor(cat) {
    if (auraImageCache[cat]) return auraImageCache[cat];
    const hex = AURA_COLORS[cat] || FALLBACK_AURA;
    const rgb = {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
    const SIZE = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createRadialGradient(SIZE/2, SIZE/2, 0, SIZE/2, SIZE/2, SIZE/2);
    grad.addColorStop(0.00, `rgba(${rgb.r},${rgb.g},${rgb.b},0.78)`);
    grad.addColorStop(0.25, `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`);
    grad.addColorStop(0.55, `rgba(${rgb.r},${rgb.g},${rgb.b},0.22)`);
    grad.addColorStop(0.85, `rgba(${rgb.r},${rgb.g},${rgb.b},0.05)`);
    grad.addColorStop(1.00, `rgba(${rgb.r},${rgb.g},${rgb.b},0.00)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);
    auraImageCache[cat] = canvas.toDataURL();
    return auraImageCache[cat];
  }

  function metersToLngDeg(m, latDeg) {
    return m / (111320 * Math.cos(latDeg * Math.PI / 180));
  }
  function metersToLatDeg(m) {
    return m / 111320;
  }

  // Bells whose coordinates land within MERGE_RADIUS_M of one another are
  // bunched too close to read distinctly. We greedy-cluster them by geographic
  // proximity (not exact equality) and arrange the cluster on a small circle
  // around the group centroid. The result: identical or near-identical pins
  // are gently fanned out, but no bell is ever moved more than ~30 m.
  const MERGE_RADIUS_M  = 25;
  const PIN_SEPARATION_M = 16;
  function disambiguateOffsets(items) {
    const groups = [];
    items.forEach((c) => {
      const found = groups.find((g) => {
        const dLatM = (c.lat - g.centre.lat) * 111320;
        const dLngM = (c.lng - g.centre.lng) * 111320 * Math.cos(c.lat * Math.PI / 180);
        return Math.hypot(dLatM, dLngM) < MERGE_RADIUS_M;
      });
      if (found) {
        found.members.push(c);
        // Recompute centroid as we add members so the cluster doesn't drift.
        const n = found.members.length;
        found.centre.lat = ((n - 1) * found.centre.lat + c.lat) / n;
        found.centre.lng = ((n - 1) * found.centre.lng + c.lng) / n;
      } else {
        groups.push({ centre: { lat: c.lat, lng: c.lng }, members: [c] });
      }
    });

    const offsets = {};
    groups.forEach((g) => {
      if (g.members.length === 1) {
        offsets[g.members[0].id] = { dxM: 0, dyM: 0 };
        return;
      }
      const n = g.members.length;
      const radius = PIN_SEPARATION_M * (n > 4 ? 1.55 : 1.1);
      g.members.forEach((c, i) => {
        const angle = (i / n) * Math.PI * 2;
        // Offset is from the *centroid*, not from c itself, so two bells that
        // started 8 m apart end up symmetric around their midpoint.
        const baseDxM = (g.centre.lng - c.lng) * 111320 * Math.cos(c.lat * Math.PI / 180);
        const baseDyM = (g.centre.lat - c.lat) * 111320;
        offsets[c.id] = {
          dxM: baseDxM + Math.cos(angle) * radius,
          dyM: baseDyM + Math.sin(angle) * radius,
        };
      });
    });
    return offsets;
  }

  // ── Audio (one-shot, overlap-safe) ──────────────────────────────────────
  // AudioContext + decoded buffer are created lazily on the first user gesture
  // (the click that rings the bell) — Chrome blocks AudioContext creation
  // outside a gesture, so eager init left audio silent permanently.
  let audioCtx = null;
  let audioRawBytes = null;     // ArrayBuffer fetched once, decoded on demand
  let audioBuffer = null;       // decoded AudioBuffer ready to play
  let audioRawLoading = null;

  function preFetchBellBytes() {
    if (audioRawBytes || audioRawLoading) return audioRawLoading;
    audioRawLoading = fetch(BELL_AUDIO_URL)
      .then((r) => r.arrayBuffer())
      .then((ab) => { audioRawBytes = ab; console.log("[Bh] bell audio bytes ready"); })
      .catch((e) => { console.warn("[Bh] bell audio fetch failed:", e); });
    return audioRawLoading;
  }

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      console.log("[Bh] AudioContext created, state:", audioCtx.state);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().then(() => console.log("[Bh] AudioContext resumed"));
    }
    return audioCtx;
  }

  // Master enable flag — when the user toggles the ambient audio off, bells
  // should fall silent too. Animation still plays.
  let audioEnabled = true;
  function setAudioEnabled(v) { audioEnabled = !!v; }

  function playBell() {
    if (!audioEnabled) return;
    const ctx = ensureAudioCtx();
    if (audioBuffer) return doPlay(ctx);
    if (!audioRawBytes) {
      // bytes still in flight — try again as soon as they arrive
      preFetchBellBytes().then(() => playBell());
      return;
    }
    // Decode lazily on first gesture.
    ctx.decodeAudioData(audioRawBytes.slice(0))
      .then((buf) => { audioBuffer = buf; doPlay(ctx); })
      .catch((e) => console.warn("[Bh] decodeAudioData failed:", e));
  }

  function doPlay(ctx) {
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    const g = ctx.createGain();
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    g.gain.value = 0.55 + Math.random() * 0.15;
    src.connect(g); g.connect(ctx.destination);
    src.start();
  }

  // ── Pin system ──────────────────────────────────────────────────────────
  function makePinSystem(viewer, scene, items, categoriesById) {
    preFetchBellBytes(); // pull the bytes early; decode happens on first click

    // Compute spread offsets for any curiosities that share coordinates (the
    // data-side fix may leave a residue, and any future duplicate is handled
    // automatically by this safety net).
    const pinOffsets = disambiguateOffsets(items);

    const pinData = {};      // id -> { groundH, entity, aura, sampled, offset }
    const ringingPins = {};  // id -> { start (perfNow ms) }

    function centrePosition(c, h, dxMeters = 0, dhMeters = 0) {
      const off = pinOffsets[c.id] || { dxM: 0, dyM: 0 };
      const lng = c.lng + metersToLngDeg(off.dxM + dxMeters, c.lat);
      const lat = c.lat + metersToLatDeg(off.dyM);
      const alt = h + BELL_GROUND_OFFSET + BELL_HALF_HEIGHT + dhMeters;
      return Cesium.Cartesian3.fromDegrees(lng, lat, alt);
    }

    function createPin(c) {
      const baseH = 80;
      const position = centrePosition(c, baseH);

      const entity = viewer.entities.add({
        id: `pin-${c.id}`,
        position,
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
          position, new Cesium.HeadingPitchRoll(0, 0, 0)),
        model: {
          uri: BELL_MODEL_URI,
          scale: BELL_SCALE,
          minimumPixelSize: 32,
          maximumScale: BELL_SCALE * 5,
          runAnimations: false,
        },
      });
      entity.curiosityId = c.id;

      // Aura — a single horizontal ellipse painted with a radial-gradient PNG
      // so the falloff is rasterised, smooth, and never shows concentric rings.
      const off = pinOffsets[c.id] || { dxM: 0, dyM: 0 };
      const auraLng = c.lng + metersToLngDeg(off.dxM, c.lat);
      const auraLat = c.lat + metersToLatDeg(off.dyM);
      const aura = viewer.entities.add({
        id: `pin-${c.id}-aura`,
        position: Cesium.Cartesian3.fromDegrees(auraLng, auraLat),
        ellipse: {
          semiMajorAxis: AURA_RADIUS,
          semiMinorAxis: AURA_RADIUS,
          height: baseH + AURA_HEIGHT_OFF,
          material: new Cesium.ImageMaterialProperty({
            image: auraImageFor(c.cat),
            transparent: true,
          }),
          classificationType: Cesium.ClassificationType.NONE,
        },
      });
      aura.curiosityId = c.id;

      pinData[c.id] = { groundH: baseH, entity, aura, sampled: false };
    }

    // Apply translation + rotation. Rotating around the handle (top of model)
    // means the centre of the model moves: it shifts laterally by sin(θ)·arm
    // and rises by (1−cos θ)·arm — that compensation keeps the handle fixed.
    function applyPose(c, h, bellAng = 0) {
      const data = pinData[c.id]; if (!data) return;
      const arm = BELL_HALF_HEIGHT;
      const dx = Math.sin(bellAng) * arm;
      const dh = -(1 - Math.cos(bellAng)) * arm; // negative: centre rises towards pivot
      const pos = centrePosition(c, h, dx, dh);
      data.entity.position = pos;
      // Roll around the East axis (the pin swings north-south); for a tour-y
      // swing we could use pitch, but roll keeps the silhouette readable from
      // the default camera heading.
      data.entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
        pos, new Cesium.HeadingPitchRoll(0, 0, bellAng));
    }

    // Aura rests on the rooftop, not on the bell, so it only needs to move
    // when the rooftop sample changes — not on every swing frame.
    function placeAura(c, h, data) {
      data.aura.ellipse.height = h + AURA_HEIGHT_OFF;
    }

    // Sampling a single column at the pin's lat/lng often hits the floor of
    // an inner courtyard (Palazzo dei Normanni, Steri…) instead of the roof.
    // We probe a small cross around the pin and keep the *maximum* valid
    // sample — that gives us the highest roof in the immediate vicinity, so
    // the bell sits above the structure rather than inside it.
    // Five-point cross (vs. nine): still catches buildings with inner
    // courtyards by sampling around the pin centre, but cuts main-thread time
    // per pin by ~45% — important because we run this for 50 pins on every
    // tile-load batch until all pins are locked.
    const SAMPLE_OFFSETS_M = [
      [0, 0], [12, 0], [-12, 0], [0, 12], [0, -12],
    ];
    function sampleGroundFor(c, baseTileset) {
      const data = pinData[c.id]; if (!data) return;
      if (data.sampled) return;
      if (!baseTileset || !scene.sampleHeight) return;
      const off = pinOffsets[c.id] || { dxM: 0, dyM: 0 };
      let bestH = -Infinity;
      for (const [dxM, dyM] of SAMPLE_OFFSETS_M) {
        const lng = c.lng + metersToLngDeg(off.dxM + dxM, c.lat);
        const lat = c.lat + metersToLatDeg(off.dyM + dyM);
        const cart = Cesium.Cartographic.fromDegrees(lng, lat);
        let h;
        try { h = scene.sampleHeight(cart, [baseTileset]); }
        catch (e) { continue; }
        if (h === undefined || h === null || isNaN(h) || h > 250 || h < -50) continue;
        if (h > bestH) bestH = h;
      }
      if (bestH === -Infinity) return;
      data.groundH = bestH;
      data.sampled = true;
      applyPose(c, bestH);
      placeAura(c, bestH, data);
    }

    function ringBell(c) {
      ringingPins[c.id] = { start: performance.now() };
      playBell();
      // requestRenderMode is on, so Cesium isn't redrawing every frame. Kick
      // the render loop so the swing animation actually animates.
      scene.requestRender();
    }

    // Damped pendulum: A·sin(ωt)·exp(−kt). Tuned for a "ceremonial" cadence
    // visible from the default camera height.
    const RING_DURATION = 3.6;
    const RING_OMEGA = 2 * Math.PI * 1.0;
    const RING_DECAY = 0.95;
    const RING_AMP_BELL = 0.32; // ~18°

    let lastActive = null;
    function tick(activeId) {
      const tNow = performance.now();
      const tSec = tNow / 1000;

      Object.keys(ringingPins).forEach((cid) => {
        const c = items.find((x) => String(x.id) === String(cid));
        const data = pinData[cid];
        if (!c || !data) { delete ringingPins[cid]; return; }
        const elapsed = (tNow - ringingPins[cid].start) / 1000;
        if (elapsed > RING_DURATION) {
          delete ringingPins[cid];
          applyPose(c, data.groundH);
          return;
        }
        const damp = Math.exp(-elapsed * RING_DECAY);
        const ang = RING_AMP_BELL * Math.sin(RING_OMEGA * elapsed) * damp;
        applyPose(c, data.groundH, ang);
      });

      if (activeId != null && pinData[activeId] && !ringingPins[activeId]) {
        const c = items.find((x) => x.id === activeId);
        if (c) applyPose(c, pinData[activeId].groundH, 0.025 * Math.sin(tSec * 1.2));
      }

      if (lastActive !== activeId) {
        if (lastActive != null && pinData[lastActive] && !ringingPins[lastActive]) {
          const c = items.find((x) => x.id === lastActive);
          if (c) applyPose(c, pinData[lastActive].groundH);
        }
        lastActive = activeId;
      }
    }

    function hasActiveAnimation() {
      return Object.keys(ringingPins).length > 0;
    }

    function applyVisibility(filterCats, filterYearMax) {
      items.forEach((c) => {
        const d = pinData[c.id]; if (!d) return;
        const passesCat = !filterCats || filterCats.includes(c.cat);
        const passesYear = c.year <= filterYearMax;
        const visible = passesCat && passesYear;
        d.entity.show = visible;
        d.aura.show = visible;
      });
    }

    items.forEach(createPin);

    return {
      pinData,
      pinOffsets,
      sampleGroundFor,
      ringBell,
      tick,
      hasActiveAnimation,
      applyVisibility,
      setAudioEnabled,
    };
  }

  window.Bh.map.cesium.pins = { makePinSystem };
})();
