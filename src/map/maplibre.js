/* Bal'harm — MapLibre fallback renderer.
   Vector tiles + Three.js custom layer for cupola pins. Not loaded by default
   (Cesium is the production renderer). Kept as alternative + for offline-friendly demos.
   Public API matches the Cesium scene factory. */
window.Bh = window.Bh || {};
window.Bh.map = window.Bh.map || {};

(function () {
  const PALERMO_BOUNDS = [[13.235, 38.045], [13.470, 38.260]];
  const CENTER = [13.3617, 38.1156];

  const STYLE = {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      openmaptiles: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
      },
    },
    layers: [
      { id: "bg", type: "background",
        paint: { "background-color": "#08152d" } },
      { id: "landcover", type: "fill", source: "openmaptiles", "source-layer": "landcover",
        paint: { "fill-color": "#0e2147", "fill-opacity": 0.55 } },
      { id: "landuse", type: "fill", source: "openmaptiles", "source-layer": "landuse",
        paint: { "fill-color": "#0d1f43", "fill-opacity": 0.45 } },
      { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park",
        paint: { "fill-color": "#1a3850", "fill-opacity": 0.6 } },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water",
        paint: { "fill-color": "#04101f", "fill-opacity": 1 } },
      { id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway",
        paint: { "line-color": "#0a2240", "line-width": 1 } },
      { id: "roads-minor", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["in", "class", "minor", "service", "street", "tertiary", "residential", "track"],
        paint: {
          "line-color": "#1d3160",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.3, 14, 0.7, 17, 2.0],
        } },
      { id: "roads-major", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["in", "class", "primary", "secondary", "trunk", "motorway"],
        paint: {
          "line-color": "#8a6e3a",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 14, 1.6, 17, 4.0],
        } },
      { id: "roads-major-glow", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["in", "class", "primary", "secondary", "trunk", "motorway"],
        paint: {
          "line-color": "#c9a24a",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.2, 16, 0.6],
          "line-blur": 0.6,
        } },
      { id: "buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building",
        minzoom: 13,
        filter: ["all",
          // Hide OSM building footprints under our custom landmark meshes
          ["!", ["within", { "type": "Polygon", "coordinates": [[
            [13.3548, 38.1135], [13.3578, 38.1135], [13.3578, 38.1153], [13.3548, 38.1153], [13.3548, 38.1135]
          ]]}]],
          ["!", ["within", { "type": "Polygon", "coordinates": [[
            [13.3553, 38.1188], [13.3583, 38.1188], [13.3583, 38.1206], [13.3553, 38.1206], [13.3553, 38.1188]
          ]]}]],
          ["!", ["within", { "type": "Polygon", "coordinates": [[
            [13.3510, 38.1098], [13.3552, 38.1098], [13.3552, 38.1122], [13.3510, 38.1122], [13.3510, 38.1098]
          ]]}]],
          ["!", ["within", { "type": "Polygon", "coordinates": [[
            [13.3608, 38.1148], [13.3626, 38.1148], [13.3626, 38.1164], [13.3608, 38.1164], [13.3608, 38.1148]
          ]]}]],
          ["!", ["within", { "type": "Polygon", "coordinates": [[
            [13.3625, 38.1140], [13.3641, 38.1140], [13.3641, 38.1154], [13.3625, 38.1154], [13.3625, 38.1140]
          ]]}]],
          ["!", ["within", { "type": "Polygon", "coordinates": [[
            [13.3528, 38.1252], [13.3552, 38.1252], [13.3552, 38.1268], [13.3528, 38.1268], [13.3528, 38.1252]
          ]]}]],
          ["!", ["within", { "type": "Polygon", "coordinates": [[
            [13.3470, 38.1567], [13.3490, 38.1567], [13.3490, 38.1581], [13.3470, 38.1581], [13.3470, 38.1567]
          ]]}]],
          ["!", ["within", { "type": "Polygon", "coordinates": [[
            [13.3437, 38.1370], [13.3455, 38.1370], [13.3455, 38.1384], [13.3437, 38.1384], [13.3437, 38.1370]
          ]]}]]
        ],
        paint: {
          "fill-extrusion-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "render_height"], ["get", "height"], 6],
            0,  "#1a233e",
            8,  "#26304b",
            18, "#33405e",
            32, "#3e4a68",
            55, "#4a5876",
          ],
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.92,
        } },
    ],
  };

  function buildScene(host) {
    const cats = window.Bh.data.CATEGORIES.reduce((m, c) => (m[c.id] = c, m), {});
    const items = window.Bh.data.CURIOSITIES;

    const map = new maplibregl.Map({
      container: host,
      style: STYLE,
      center: CENTER,
      zoom: 13.7,
      pitch: 62,
      bearing: -16,
      minZoom: 12,
      maxZoom: 17.5,
      maxBounds: PALERMO_BOUNDS,
      attributionControl: false,
      antialias: true,
      hash: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();

    let activeId = null;
    let filterCats = null;
    let filterYearMax = Infinity;
    let speedMul = 1;
    let onSelectCb = null;
    let onHoverCb = null;

    const pinMeshes = {};         // id -> { group, dome, spire, ball, baseColor }
    const baseColors = {};        // id -> hex int

    // --- Custom 3D landmark meshes (stylized, low-poly) -------------------
    // Built from primitives so the canon Palermo silhouette reads at any zoom.
    function landmarkMaterials() {
      return {
        stone: new THREE.MeshStandardMaterial({ color: 0xc9a98a, metalness: 0.15, roughness: 0.85 }),
        stoneDark: new THREE.MeshStandardMaterial({ color: 0x8d7458, metalness: 0.2, roughness: 0.8 }),
        roof: new THREE.MeshStandardMaterial({ color: 0x6b3a2a, metalness: 0.25, roughness: 0.7 }),
        dome: new THREE.MeshStandardMaterial({ color: 0xb45a3a, metalness: 0.45, roughness: 0.5 }),
        gold: new THREE.MeshStandardMaterial({ color: 0xe6cc7a, metalness: 0.85, roughness: 0.25 }),
        marble: new THREE.MeshStandardMaterial({ color: 0xe8e1cc, metalness: 0.1, roughness: 0.65 }),
      };
    }

    function buildCattedrale(g, M) {
      // Long basilica with central dome and four corner towers (Palermo Cathedral)
      const nave = new THREE.Mesh(new THREE.BoxGeometry(80, 25, 28), M.stone);
      nave.position.y = 12.5; g.add(nave);
      // Apse
      const apse = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 25, 12, 1, false, 0, Math.PI), M.stone);
      apse.position.set(40, 12.5, 0); apse.rotation.y = Math.PI / 2; g.add(apse);
      // Central dome on drum
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 8, 16), M.stone);
      drum.position.y = 29; g.add(drum);
      const cdome = new THREE.Mesh(new THREE.SphereGeometry(12, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.dome);
      cdome.position.y = 33; g.add(cdome);
      // Four corner towers
      [[-35,-12],[-35,12],[35,-12],[35,12]].forEach(([x,z]) => {
        const t = new THREE.Mesh(new THREE.BoxGeometry(8, 38, 8), M.stoneDark);
        t.position.set(x, 19, z); g.add(t);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(5.5, 6, 4), M.gold);
        cap.position.set(x, 41, z); cap.rotation.y = Math.PI / 4; g.add(cap);
      });
      // Roof
      const roof = new THREE.Mesh(new THREE.BoxGeometry(80, 3, 28), M.roof);
      roof.position.y = 26.5; g.add(roof);
    }

    function buildTeatroMassimo(g, M) {
      // Neoclassical: rectangular volume + hexastyle portico + central low dome
      const base = new THREE.Mesh(new THREE.BoxGeometry(75, 28, 60), M.marble);
      base.position.y = 14; g.add(base);
      // Portico columns
      for (let i = 0; i < 6; i++) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 18, 12), M.marble);
        col.position.set(-37.5 - 4, 9, -25 + i * 10); g.add(col);
      }
      // Pediment
      const ped = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 60), M.stone);
      ped.position.set(-41, 22, 0); g.add(ped);
      // Central low dome
      const dDrum = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 5, 24), M.stone);
      dDrum.position.y = 30; g.add(dDrum);
      const dDome = new THREE.Mesh(new THREE.SphereGeometry(15, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2.4), M.dome);
      dDome.position.y = 32; g.add(dDome);
    }

    function buildPalazzoNormanni(g, M) {
      // Long fortress block with Torre Pisana
      const block = new THREE.Mesh(new THREE.BoxGeometry(120, 22, 50), M.stoneDark);
      block.position.y = 11; g.add(block);
      // Crenellation strip
      for (let i = -55; i <= 55; i += 6) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), M.stoneDark);
        c.position.set(i, 23.5, 25); g.add(c);
        const c2 = c.clone(); c2.position.z = -25; g.add(c2);
      }
      // Torre Pisana
      const tower = new THREE.Mesh(new THREE.BoxGeometry(20, 45, 20), M.stoneDark);
      tower.position.set(-40, 22.5, 0); g.add(tower);
      // Royal apartments roof
      const roof = new THREE.Mesh(new THREE.BoxGeometry(80, 3, 50), M.roof);
      roof.position.set(20, 23.5, 0); g.add(roof);
    }

    function buildQuattroCanti(g, M) {
      // Four concave baroque facades meeting at corners
      const post = new THREE.Mesh(new THREE.BoxGeometry(8, 26, 8), M.stone);
      [-12,12].forEach(x => [-12,12].forEach(z => {
        const p = post.clone(); p.position.set(x, 13, z); g.add(p);
      }));
      // Cornices
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(36, 2, 36), M.gold);
      cornice.position.y = 27; g.add(cornice);
    }

    function buildMartorana(g, M) {
      // Small church with bell tower (campanile)
      const body = new THREE.Mesh(new THREE.BoxGeometry(20, 14, 14), M.stone);
      body.position.y = 7; g.add(body);
      // Bell tower
      const tw = new THREE.Mesh(new THREE.BoxGeometry(8, 30, 8), M.stoneDark);
      tw.position.set(-12, 15, 0); g.add(tw);
      // Tower cupola
      const tc = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.dome);
      tc.position.set(-12, 30, 0); g.add(tc);
      // Small dome over body
      const sd = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.dome);
      sd.position.set(4, 14, 0); g.add(sd);
    }

    function buildTeatroPolitea(g, M) {
      // Politeama: semicircular front with quadriga
      const arc = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 22, 24, 1, false, 0, Math.PI), M.stone);
      arc.position.y = 11; g.add(arc);
      // Top entablature
      const ent = new THREE.Mesh(new THREE.CylinderGeometry(23, 23, 3, 24, 1, false, 0, Math.PI), M.gold);
      ent.position.y = 23.5; g.add(ent);
      // Quadriga base
      const qb = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 4), M.gold);
      qb.position.y = 27; g.add(qb);
    }

    function buildPalazzinaCinese(g, M) {
      // Pagoda-style: 3 stacked tiers with upturned eaves
      const base = new THREE.Mesh(new THREE.BoxGeometry(22, 8, 22), M.stone);
      base.position.y = 4; g.add(base);
      const eave1 = new THREE.Mesh(new THREE.ConeGeometry(18, 4, 4), M.gold);
      eave1.position.y = 10; eave1.rotation.y = Math.PI / 4; g.add(eave1);
      const mid = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 16), M.stone);
      mid.position.y = 15; g.add(mid);
      const eave2 = new THREE.Mesh(new THREE.ConeGeometry(13, 3.5, 4), M.gold);
      eave2.position.y = 19.5; eave2.rotation.y = Math.PI / 4; g.add(eave2);
      const top = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), M.stone);
      top.position.y = 23; g.add(top);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(8, 7, 4), M.gold);
      tip.position.y = 29; tip.rotation.y = Math.PI / 4; g.add(tip);
      const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6, 6), M.gold);
      finial.position.y = 35; g.add(finial);
    }

    function buildVillinoFlorio(g, M) {
      // Liberty villa: irregular volumes + corner tower
      const main = new THREE.Mesh(new THREE.BoxGeometry(28, 14, 18), M.stone);
      main.position.y = 7; g.add(main);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(14, 11, 14), M.stoneDark);
      wing.position.set(15, 5.5, 8); g.add(wing);
      // Corner round tower
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 22, 16), M.stone);
      tower.position.set(-15, 11, -10); g.add(tower);
      const towerCap = new THREE.Mesh(new THREE.ConeGeometry(5.5, 7, 16), M.dome);
      towerCap.position.set(-15, 25.5, -10); g.add(towerCap);
      // Pitched roof on main
      const roof = new THREE.Mesh(new THREE.BoxGeometry(28, 3, 18), M.roof);
      roof.position.y = 15.5; g.add(roof);
    }

    const LANDMARKS = [
      { lat: 38.1144, lng: 13.3563, rot: -0.05, build: buildCattedrale },
      { lat: 38.1196, lng: 13.3568, rot: 0,     build: buildTeatroMassimo },
      { lat: 38.1109, lng: 13.3531, rot: 0.6,   build: buildPalazzoNormanni },
      { lat: 38.1156, lng: 13.3617, rot: 0,     build: buildQuattroCanti },
      { lat: 38.1147, lng: 13.3633, rot: 0,     build: buildMartorana },
      { lat: 38.1260, lng: 13.3540, rot: 0,     build: buildTeatroPolitea },
      { lat: 38.1574, lng: 13.3479, rot: 0,     build: buildPalazzinaCinese },
      { lat: 38.1377, lng: 13.3445, rot: 0.3,   build: buildVillinoFlorio },
    ];

    function placeLandmarks(scene) {
      const M = landmarkMaterials();
      LANDMARKS.forEach((L) => {
        const g = new THREE.Group();
        g.matrixAutoUpdate = false;
        L.build(g, M);
        // OSM footprints are filtered out under each landmark, so no need for polygon offset.
        g.traverse((o) => { if (o.isMesh) o.renderOrder = 100; });
        const merc = maplibregl.MercatorCoordinate.fromLngLat([L.lng, L.lat], 0);
        const s = merc.meterInMercatorCoordinateUnits();
        const T = new THREE.Matrix4().makeTranslation(merc.x, merc.y, merc.z);
        const S = new THREE.Matrix4().makeScale(s, -s, s);
        const Rx = new THREE.Matrix4().makeRotationX(Math.PI / 2);
        const Ry = new THREE.Matrix4().makeRotationY(L.rot || 0);
        g.matrix.copy(T).multiply(S).multiply(Rx).multiply(Ry);
        scene.add(g);
      });
    }

    function makePinGroup(c) {
      const color = cats[c.cat]?.color || "#c9a24a";
      const colorInt = parseInt(color.replace("#", ""), 16);
      baseColors[c.id] = colorInt;

      const group = new THREE.Group();
      group.matrixAutoUpdate = false;

      // Stone podium (dark base) — bigger so the dome reads at zoom 13-15
      const podium = new THREE.Mesh(
        new THREE.CylinderGeometry(16, 19, 6, 16),
        new THREE.MeshStandardMaterial({ color: 0x0a1730, metalness: 0.2, roughness: 0.8 })
      );
      podium.position.y = 3;
      group.add(podium);

      // Drum (octagonal cylinder Norman-style)
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(12, 13, 9, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a2a52, metalness: 0.3, roughness: 0.7 })
      );
      drum.position.y = 10.5;
      drum.rotation.y = Math.PI / 8;
      group.add(drum);

      // Dome (half-sphere)
      const domeMat = new THREE.MeshStandardMaterial({
        color: colorInt, metalness: 0.7, roughness: 0.28,
        emissive: colorInt, emissiveIntensity: 0.15,
      });
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(12, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2),
        domeMat
      );
      dome.position.y = 15;
      group.add(dome);

      // Spire
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, 22, 8),
        new THREE.MeshStandardMaterial({ color: 0xe6cc7a, metalness: 0.9, roughness: 0.2,
          emissive: 0xc9a24a, emissiveIntensity: 0.25 })
      );
      spire.position.y = 38;
      group.add(spire);

      // Ball finial — glowy
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(1.4, 14, 12),
        new THREE.MeshStandardMaterial({
          color: 0xfff0c0, metalness: 0.95, roughness: 0.1,
          emissive: 0xf2dc8e, emissiveIntensity: 0.7
        })
      );
      ball.position.y = 51;
      group.add(ball);

      // Per-pin matrix: translate→scale(s,-s,s)→rotateX(PI/2) so local +Y becomes mercator +Z (up).
      // Altitude offset of 60m lifts the pin above all OSM buildings → no z-fighting/flicker.
      const merc = maplibregl.MercatorCoordinate.fromLngLat([c.lng, c.lat], 60);
      const s = merc.meterInMercatorCoordinateUnits();
      const T = new THREE.Matrix4().makeTranslation(merc.x, merc.y, merc.z);
      const S = new THREE.Matrix4().makeScale(s, -s, s);
      const R = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      group.matrix.copy(T).multiply(S).multiply(R);

      // Force pins to render after buildings — eliminates flicker.
      group.traverse((obj) => {
        if (obj.isMesh) {
          obj.renderOrder = 999;
          obj.material.depthTest = true;
          obj.material.depthWrite = true;
        }
      });

      pinMeshes[c.id] = { group, dome, spire, ball, drum, domeMat };
      return group;
    }

    let scene, camera, renderer, threeMap;
    const threeLayer = {
      id: "three-pins",
      type: "custom",
      renderingMode: "3d",
      onAdd(m, gl) {
        threeMap = m;
        camera = new THREE.Camera();
        scene = new THREE.Scene();

        scene.add(new THREE.AmbientLight(0xfff5cc, 0.45));
        const sun = new THREE.DirectionalLight(0xffe9b3, 1.1);
        sun.position.set(0.5, 0.7, 1).normalize();
        scene.add(sun);
        const fill = new THREE.DirectionalLight(0x6a86c8, 0.5);
        fill.position.set(-0.6, -0.4, 0.4).normalize();
        scene.add(fill);

        items.forEach((c) => scene.add(makePinGroup(c)));
        placeLandmarks(scene);

        renderer = new THREE.WebGLRenderer({
          canvas: m.getCanvas(),
          context: gl,
          antialias: true,
        });
        renderer.autoClear = false;
      },
      render(_gl, matrix) {
        camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);
        renderer.resetState();
        renderer.render(scene, camera);
        // Pulse active pin
        const t = performance.now() / 600;
        Object.entries(pinMeshes).forEach(([id, p]) => {
          const isActive = String(id) === String(activeId);
          const target = isActive ? 1.25 + Math.sin(t) * 0.08 : 1.0;
          p.group.children.forEach(() => {});
          // Easing scale on the whole group via children offsets is overkill;
          // just bump emissive on dome material when active.
          p.domeMat.emissiveIntensity = isActive ? 0.4 + Math.sin(t * 1.5) * 0.15 : 0.05;
        });
        threeMap.triggerRepaint();
      },
    };

    // --- Hit-test layer (invisible circle on each pin position) -----------
    function pinsGeoJSON() {
      return {
        type: "FeatureCollection",
        features: items
          .filter((c) => {
            const passesCat = !filterCats || filterCats.includes(c.cat);
            const passesYear = c.year <= filterYearMax;
            return passesCat && passesYear;
          })
          .map((c) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [c.lng, c.lat] },
            properties: { id: c.id, cat: c.cat },
          })),
      };
    }

    map.on("style.load", () => {
      // Strip every symbol/label layer for a clean immersive look.
      try {
        const layers = map.getStyle().layers || [];
        layers.forEach((l) => {
          if (l.type === "symbol") map.removeLayer(l.id);
        });
      } catch (e) { /* ignore */ }

      map.addLayer(threeLayer);
      map.addSource("pins-hit", { type: "geojson", data: pinsGeoJSON() });
      map.addLayer({
        id: "pins-hit",
        type: "circle",
        source: "pins-hit",
        paint: {
          "circle-radius": 22,
          "circle-color": "#000",
          "circle-opacity": 0.001,
          "circle-pitch-alignment": "map",
        },
      });
      map.on("click", "pins-hit", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id != null) onSelectCb && onSelectCb(Number(id));
      });
      map.on("mousemove", "pins-hit", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (f) {
          const pt = map.project([f.geometry.coordinates[0], f.geometry.coordinates[1]]);
          onHoverCb && onHoverCb(Number(f.properties.id), pt.x, pt.y - 60);
        }
      });
      map.on("mouseleave", "pins-hit", () => {
        map.getCanvas().style.cursor = "";
        onHoverCb && onHoverCb(null);
      });

      // Subtle slow auto-rotation on load
      let n = 0;
      const idleSpin = setInterval(() => {
        if (++n > 60) return clearInterval(idleSpin);
        map.setBearing(map.getBearing() + 0.06);
      }, 60);
      const stop = () => clearInterval(idleSpin);
      ["mousedown", "touchstart", "wheel", "dragstart"].forEach((ev) => map.on(ev, stop));
    });

    function refreshHits() {
      const src = map.getSource("pins-hit");
      if (src) src.setData(pinsGeoJSON());
      // Also dim Three.js pins that don't pass filter
      Object.entries(pinMeshes).forEach(([id, p]) => {
        const c = items.find((x) => String(x.id) === String(id));
        if (!c) return;
        const passesCat = !filterCats || filterCats.includes(c.cat);
        const passesYear = c.year <= filterYearMax;
        const visible = passesCat && passesYear;
        p.group.visible = visible;
      });
    }

    return {
      setSelected(id) { activeId = id; },
      setFilter(catsArg, yearMax) {
        filterCats = (catsArg && catsArg.length) ? catsArg : null;
        filterYearMax = (yearMax === undefined || yearMax === null) ? Infinity : yearMax;
        refreshHits();
      },
      setSpeed(s) { speedMul = s; },
      setDensity() { /* no-op */ },
      setMode(mode) { host.classList.toggle("day-mode", mode === "day"); },
      animateTo(c) {
        map.flyTo({
          center: [c.lng, c.lat],
          zoom: 16, pitch: 64, bearing: map.getBearing() + 4,
          duration: 1600 / speedMul, essential: true,
          curve: 1.3,
        });
      },
      onHover(cb) { onHoverCb = cb; },
      onSelect(cb) { onSelectCb = cb; },
    };
  }

  window.Bh.map.maplibre = { buildScene };
})();
