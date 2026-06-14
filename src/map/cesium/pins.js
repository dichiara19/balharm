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

  // ── Clustering ───────────────────────────────────────────────────────────
  // Bells whose coordinates land near one another (e.g. the 5-bell Palazzo dei
  // Normanni / Cappella Palatina knot) would pile into a "pasticcio" up close.
  // We group them with union-find — order-independent and transitive, so the
  // *whole* knot becomes ONE cluster (the old greedy running-centroid join left
  // stragglers that still overlapped). A cluster then presents itself by camera
  // distance (see applyClusterLOD): collapsed to a single counted "cluster bell"
  // when zoomed out, fanned into a readable ring when zoomed in.
  const JOIN_RADIUS_M    = 65;   // members within this distance join one cluster
  const PIN_SEPARATION_M = 16;
  // Camera-height thresholds with hysteresis so the cluster doesn't flicker
  // open/closed while hovering at the boundary altitude.
  const LOD_COLLAPSE_ABOVE_M = 560;
  const LOD_EXPAND_BELOW_M   = 420;

  function distMeters(a, b) {
    const dLatM = (a.lat - b.lat) * 111320;
    const dLngM = (a.lng - b.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    return Math.hypot(dLatM, dLngM);
  }

  // Returns { pinOffsets (per-member fan offset, 0 for singletons),
  //           clusters [{ members, centre, isMulti }], clusterOf (id -> index) }.
  function computeClustering(items) {
    const parent = items.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (distMeters(items[i], items[j]) < JOIN_RADIUS_M) union(i, j);

    const byRoot = {};
    items.forEach((c, i) => { const r = find(i); (byRoot[r] = byRoot[r] || []).push(c); });

    const clusters = [], clusterOf = {}, pinOffsets = {};
    Object.values(byRoot).forEach((members) => {
      let lat = 0, lng = 0;
      members.forEach((c) => { lat += c.lat; lng += c.lng; });
      const centre = { lat: lat / members.length, lng: lng / members.length };
      const idx = clusters.length;
      const isMulti = members.length > 1;
      clusters.push({ members, centre, isMulti });
      const n = members.length;
      // Fan radius wide enough to clear the bell footprint (~BELL_SCALE m) so
      // fanned bells never interpenetrate, growing a little with member count.
      const radius = Math.max(PIN_SEPARATION_M, BELL_SCALE * 1.6) * (n > 4 ? 1.5 : 1.15);
      members.forEach((c, i) => {
        clusterOf[c.id] = idx;
        if (!isMulti) { pinOffsets[c.id] = { dxM: 0, dyM: 0 }; return; }
        const angle = (i / n) * Math.PI * 2;
        // Measured from the centroid so members sit symmetric around the group.
        const baseDxM = (centre.lng - c.lng) * 111320 * Math.cos(c.lat * Math.PI / 180);
        const baseDyM = (centre.lat - c.lat) * 111320;
        pinOffsets[c.id] = {
          dxM: baseDxM + Math.cos(angle) * radius,
          dyM: baseDyM + Math.sin(angle) * radius,
        };
      });
    });
    return { pinOffsets, clusters, clusterOf };
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

    // Group near-coincident curiosities; pinOffsets fan each cluster's members
    // out around their shared centroid, clusters[] drives the zoom LOD.
    const { pinOffsets, clusters, clusterOf } = computeClustering(items);

    const pinData = {};      // id -> { groundH, entity, aura, sampled, offset }
    const ringingPins = {};  // id -> { start (perfNow ms) }
    const clusterData = {};  // clusterIndex -> { entity, aura, centre, groundH, sampled }

    // LOD state: clusters start collapsed (camera opens far at ~1000 m). These
    // are recomputed only when the collapse/expand boundary is crossed or a
    // filter changes — never per frame.
    let collapsed = true;
    let filterCats = null;
    let filterYearMax = Infinity;
    function memberVisible(c) {
      return (!filterCats || filterCats.includes(c.cat)) && c.year <= filterYearMax;
    }

    function centrePosition(c, h, dxMeters = 0, dhMeters = 0) {
      const off = pinOffsets[c.id] || { dxM: 0, dyM: 0 };
      const lng = c.lng + metersToLngDeg(off.dxM + dxMeters, c.lat);
      const lat = c.lat + metersToLatDeg(off.dyM);
      const alt = h + BELL_GROUND_OFFSET + BELL_HALF_HEIGHT + dhMeters;
      return Cesium.Cartesian3.fromDegrees(lng, lat, alt);
    }

    function createPin(c) {
      // Curiosities on Monte Pellegrino (Santuario di Santa Rosalia, summit)
      // carry an `altitude` hint: their tiles aren't loaded while the camera is
      // over the city, so scene.sampleHeight returns nothing and a default 80 m
      // would bury the bell inside the mountain. Start at the known altitude;
      // sampleGroundFor still refines it precisely once the tiles stream in.
      const baseH = (typeof c.altitude === "number") ? c.altitude : 80;
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
          // Keep the glTF's PBR shading visible — earlier we forced MIX with
          // a flat gold, which averaged lit and shaded pixels together and
          // killed the relief. Now: a gentle warm light multiplier so the
          // bronze surface still feels metallic and shows highlights, plus
          // a HIGHLIGHT-mode tint at low amount (multiplicative, preserves
          // dynamic range). The silhouette gives a thin outline against the
          // dark duotone backdrop without compromising shading.
          lightColor: new Cesium.Cartesian3(1.6, 1.5, 1.2),
          colorBlendMode: Cesium.ColorBlendMode.HIGHLIGHT,
          color: Cesium.Color.fromCssColorString("#f6deb0"),
          colorBlendAmount: 0.2,
          silhouetteColor: Cesium.Color.fromCssColorString("#fff5d8"),
          silhouetteSize: 1.0,
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

    function clusterCentrePosition(cl, h) {
      const alt = h + BELL_GROUND_OFFSET + BELL_HALF_HEIGHT;
      return Cesium.Cartesian3.fromDegrees(cl.centre.lng, cl.centre.lat, alt);
    }

    // A collapsed cluster reads as one slightly larger bell wearing a count
    // badge. It carries clusterIndex (not curiosityId) so a click flies the
    // camera in to expand the cluster instead of opening a single curiosity.
    function createClusterMarker(idx) {
      const cl = clusters[idx];
      const baseH = 80;
      const position = clusterCentrePosition(cl, baseH);
      const counts = {};
      cl.members.forEach((c) => { counts[c.cat] = (counts[c.cat] || 0) + 1; });
      const domCat = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

      const entity = viewer.entities.add({
        id: `cluster-${idx}`,
        position,
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
          position, new Cesium.HeadingPitchRoll(0, 0, 0)),
        model: {
          uri: BELL_MODEL_URI,
          scale: BELL_SCALE * 1.12,
          minimumPixelSize: 40,
          maximumScale: BELL_SCALE * 5,
          runAnimations: false,
          lightColor: new Cesium.Cartesian3(1.6, 1.5, 1.2),
          colorBlendMode: Cesium.ColorBlendMode.HIGHLIGHT,
          color: Cesium.Color.fromCssColorString("#f6deb0"),
          colorBlendAmount: 0.2,
          silhouetteColor: Cesium.Color.fromCssColorString("#fff5d8"),
          silhouetteSize: 1.4,
        },
        label: {
          text: String(cl.members.length),
          font: "600 14px 'Hanken Grotesk', system-ui, sans-serif",
          fillColor: Cesium.Color.fromCssColorString("#231708"),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#e7c879").withAlpha(0.96),
          backgroundPadding: new Cesium.Cartesian2(8, 5),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, -34),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entity.clusterIndex = idx;

      const aura = viewer.entities.add({
        id: `cluster-${idx}-aura`,
        position: Cesium.Cartesian3.fromDegrees(cl.centre.lng, cl.centre.lat),
        ellipse: {
          semiMajorAxis: AURA_RADIUS * 1.25,
          semiMinorAxis: AURA_RADIUS * 1.25,
          height: baseH + AURA_HEIGHT_OFF,
          material: new Cesium.ImageMaterialProperty({
            image: auraImageFor(domCat), transparent: true,
          }),
          classificationType: Cesium.ClassificationType.NONE,
        },
      });
      aura.clusterIndex = idx;

      clusterData[idx] = { entity, aura, groundH: baseH, sampled: false };
    }

    function positionCluster(idx) {
      const cd = clusterData[idx]; if (!cd) return;
      const pos = clusterCentrePosition(clusters[idx], cd.groundH);
      cd.entity.position = pos;
      cd.aura.ellipse.height = cd.groundH + AURA_HEIGHT_OFF;
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
        // Cap of 700 m allows Castello Utveggio (~400 m on Monte Pellegrino)
        // and Monte Pellegrino itself (~600 m) while still rejecting Cesium's
        // garbage sample values that crop up while tiles are still streaming.
        if (h === undefined || h === null || isNaN(h) || h > 700 || h < -50) continue;
        if (h > bestH) bestH = h;
      }
      if (bestH === -Infinity) return;
      // `altitude` acts as a floor, not just a seed: on Monte Pellegrino the
      // cross-sampler often catches the terrace/road in front of the Santuario
      // (lower than the building + cliff behind it), which would re-bury the
      // bell. Never let a sample pull a hinted pin below its known altitude.
      const h = (typeof c.altitude === "number") ? Math.max(bestH, c.altitude) : bestH;
      data.groundH = h;
      data.sampled = true;
      applyPose(c, h);
      placeAura(c, h, data);
      // The cluster bell sits at the centroid; reuse the members' roof samples
      // (highest wins) instead of sampling the centroid column separately.
      const ci = clusterOf[c.id];
      const cd = clusterData[ci];
      if (cd) {
        cd.groundH = cd.sampled ? Math.max(cd.groundH, bestH) : bestH;
        cd.sampled = true;
        positionCluster(ci);
      }
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

    // Clusters that must stay open regardless of zoom because one of their
    // members is the currently-selected curiosity (tour / geo / deep link).
    const forcedExpand = new Set();

    // Single source of truth for what is shown. Reconciles three inputs: the
    // category/year filter, the camera-distance LOD (collapsed?), and any
    // forced-open cluster. Cheap, and only called on a real state change.
    function refresh() {
      clusters.forEach((cl, idx) => {
        if (!cl.isMulti) {
          const c = cl.members[0];
          const d = pinData[c.id]; if (!d) return;
          const v = memberVisible(c);
          d.entity.show = v; d.aura.show = v;
          return;
        }
        const cd = clusterData[idx]; if (!cd) return;
        const open = !collapsed || forcedExpand.has(idx);
        if (open) {
          cd.entity.show = false; cd.aura.show = false;
          cl.members.forEach((c) => {
            const d = pinData[c.id]; if (!d) return;
            const v = memberVisible(c);
            d.entity.show = v; d.aura.show = v;
          });
        } else {
          cl.members.forEach((c) => {
            const d = pinData[c.id]; if (!d) return;
            d.entity.show = false; d.aura.show = false;
          });
          const visN = cl.members.filter(memberVisible).length;
          cd.entity.show = visN > 0;
          cd.aura.show = visN > 0;
          if (visN > 0) cd.entity.label.text = String(visN);
        }
      });
      scene.requestRender();
    }

    // Called on camera move (throttled by index.js). Crosses the collapse/expand
    // boundary with hysteresis so a cluster doesn't flicker at the threshold.
    function applyClusterLOD(cameraHeight) {
      const next = collapsed
        ? (cameraHeight < LOD_EXPAND_BELOW_M ? false : true)
        : (cameraHeight > LOD_COLLAPSE_ABOVE_M ? true : false);
      if (next !== collapsed) { collapsed = next; refresh(); }
    }

    // Keep the selected curiosity visible even if its cluster would be collapsed.
    function revealFor(curiosityId) {
      forcedExpand.clear();
      if (curiosityId != null) {
        const ci = clusterOf[curiosityId];
        if (ci != null && clusters[ci] && clusters[ci].isMulti) forcedExpand.add(ci);
      }
      refresh();
    }

    function applyVisibility(cats, yearMax) {
      filterCats = (cats && cats.length) ? cats : null;
      filterYearMax = (yearMax === undefined || yearMax === null) ? Infinity : yearMax;
      refresh();
    }

    items.forEach(createPin);
    clusters.forEach((cl, idx) => { if (cl.isMulti) createClusterMarker(idx); });
    refresh();   // initial paint: multi-clusters start collapsed

    return {
      pinData,
      pinOffsets,
      clusters,
      sampleGroundFor,
      ringBell,
      tick,
      hasActiveAnimation,
      applyVisibility,
      applyClusterLOD,
      revealFor,
      setAudioEnabled,
    };
  }

  window.Bh.map.cesium.pins = { makePinSystem };
})();
