// Bal'harm — root React app. Wires UI components, scene, and global state.
(function () {
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const { Cornice, Filters, Modal, GeoCard, TopBar, Star, BottomSheet } = window.Bh.ui;
  const isMobile = !!window.Bh.device?.isMobile;
  const MIN_LOADER_MS = 7000;   // give pre-warming time to populate the tile cache
  const MAX_LOADER_MS = 18000;
  const { useAmbientAudio } = window.Bh.lib.audio;
  const { fmtYear } = window.Bh.lib.format;
  const { COPY } = window.Bh.i18n;
  const { CURIOSITIES } = window.Bh.data;
  const { track, EVENTS } = window.Bh.lib.analytics;

  function readInitialLang() {
    const m = location.hash.match(/lang=(it|en)/);
    if (m) return m[1];
    const saved = localStorage.getItem("bh.lang");
    if (saved === "it" || saved === "en") return saved;
    return "it";
  }
  function readInitialMode() {
    const saved = localStorage.getItem("bh.mode");
    if (saved === "night" || saved === "day") return saved;
    return "night";
  }

  function App() {
    const [lang, setLang] = useState(readInitialLang);
    // Mode is fixed to "night"; the day/night toggle has been removed since
    // the duotone identity hinges on the dusk lapis-and-gold palette.
    const mode = "night";
    const t = COPY[lang];

    const [activeId, setActiveId] = useState(null);
    const [modalId, setModalId] = useState(null);
    const [filterCats, setFilterCats] = useState([]);
    const [hoverId, setHoverId] = useState(null);
    const modalTimerRef = useRef(null);
    const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
    const [tour, setTour] = useState(null);
    const [shared, setShared] = useState(false);
    // Try to start the ambient audio as the splash appears, on both
    // platforms — it pulls the user into the world before the map is even
    // visible. On mobile the browser will block the initial play() (no
    // gesture yet); the catch handler in audio.js auto-retries on the very
    // first pointerdown, so any tap kicks it off.
    const [audioOn, setAudioOn] = useAmbientAudio(true);
    const [loading, setLoading] = useState(true);
    // Compass: driven imperatively (no React state) so camera rotation never
    // re-renders the tree. app writes the rotation straight to the SVG <g>.
    const compassRef = useRef(null);
    const [loaderKw, setLoaderKw] = useState(0);
    const [loaderFade, setLoaderFade] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(true);   // mobile only
    const [modalSheetSnap, setModalSheetSnap] = useState("peek"); // mobile only

    const sceneRef = useRef(null);
    const threeHostRef = useRef(null);

    const items = CURIOSITIES;
    const filtered = useMemo(() =>
      items.filter(c => filterCats.length === 0 || filterCats.includes(c.cat)),
      [filterCats, items]);

    const counts = useMemo(() => {
      const m = {};
      items.forEach(c => { m[c.cat] = (m[c.cat]||0)+1; });
      return m;
    }, [items]);

    const modalItem = modalId ? items.find(c => c.id === modalId) : null;
    const hoverItem = hoverId ? items.find(c => c.id === hoverId) : null;

    // Selection helper. opts.delayed=true postpones the modal so the bell can
    // finish swinging (and the click sound can play) before the curiosity card
    // covers the scene. Map clicks use delayed; tour / geo / hash use immediate.
    const select = useCallback((id, opts = {}) => {
      clearTimeout(modalTimerRef.current);
      setActiveId(id);
      if (id == null) { setModalId(null); return; }
      if (opts.delayed) {
        modalTimerRef.current = setTimeout(() => setModalId(id), 1200);
      } else {
        setModalId(id);
      }
    }, []);

    // Mode is fixed to night — set the CSS attr once.
    useEffect(() => { document.documentElement.setAttribute("data-mode", "night"); }, []);

    useEffect(() => { localStorage.setItem("bh.lang", lang); }, [lang]);

    // --- Analytics: state-change events. Each effect skips its initial mount
    // so we record genuine user actions, not React's first commit. ---
    const readyTracked = useRef(false);
    useEffect(() => {
      if (!loading && !readyTracked.current) {
        readyTracked.current = true;
        track(EVENTS.APP_READY, { platform: isMobile ? "mobile" : "desktop", lang });
      }
    }, [loading]);

    const langInit = useRef(true);
    useEffect(() => {
      if (langInit.current) { langInit.current = false; return; }
      track(EVENTS.LANG_CHANGE, { lang });
    }, [lang]);

    const audioInit = useRef(true);
    useEffect(() => {
      if (audioInit.current) { audioInit.current = false; return; }
      track(EVENTS.AUDIO_TOGGLE, { on: audioOn });
    }, [audioOn]);

    const filterInit = useRef(true);
    useEffect(() => {
      if (filterInit.current) { filterInit.current = false; return; }
      track(EVENTS.FILTER_CHANGE, { count: filterCats.length, cats: filterCats.join(",") });
    }, [filterCats]);

    // Loader keyword rotation with cross-fade.
    useEffect(() => {
      if (!loading) return;
      const phrases = COPY[lang].loadingPhrases || [COPY[lang].loading];
      const tick = setInterval(() => {
        setLoaderFade(true);
        setTimeout(() => {
          setLoaderKw((i) => (i + 1) % phrases.length);
          setLoaderFade(false);
        }, 450);
      }, 2200);
      return () => clearInterval(tick);
    }, [loading, lang]);

    // Bridge the audio toggle through to the bell click sounds.
    useEffect(() => {
      sceneRef.current?.setAudioEnabled?.(audioOn);
    }, [audioOn]);

    // Cinematic camera during a tour: slower fly-to easing.
    useEffect(() => {
      sceneRef.current?.setSpeed?.(tour !== null ? 0.65 : 1.0);
    }, [tour]);

    // Init scene once
    useEffect(() => {
      if (!threeHostRef.current || sceneRef.current) return;
      sceneRef.current = window.Bh.scene.buildScene(threeHostRef.current);
      sceneRef.current.onSelect((id) => select(id, { delayed: true }));
      sceneRef.current.onHover((id, x, y) => {
        setHoverId(id);
        if (id) setHoverPos({ x, y });
      });
      sceneRef.current.onHeading?.((deg) => {
        const g = compassRef.current;
        if (g) g.setAttribute("transform", `translate(800,450) rotate(${-deg})`);
      });
      // Sync the initial audio state.
      sceneRef.current.setAudioEnabled?.(audioOn);
      // Hide the splash when (a) the first batch of Google 3D tiles is on screen
      // AND (b) a minimum on-screen time has passed (so the splash never flashes
      // by). Safety net: never block forever — fall through after MAX_LOADER_MS.
      const startedAt = Date.now();
      let tilesReady = false;
      const tryHide = () => {
        if (!tilesReady) return;
        const remaining = Math.max(0, MIN_LOADER_MS - (Date.now() - startedAt));
        setTimeout(() => setLoading(false), remaining);
      };
      sceneRef.current.onInitialLoad?.(() => { tilesReady = true; tryHide(); });
      const safety = setTimeout(() => setLoading(false), MAX_LOADER_MS);
      return () => clearTimeout(safety);
    }, [select]);

    // Sync scene with state
    useEffect(() => { sceneRef.current?.setSelected(activeId); }, [activeId]);
    useEffect(() => { sceneRef.current?.setFilter(filterCats, null); }, [filterCats]);
    // Mode is a build-time constant; no runtime sync needed.

    // Camera flies to the pin only when the modal is about to appear, so the
    // user sees the bell swinging in place before the camera repositions.
    useEffect(() => {
      if (modalId) {
        const c = items.find(x => x.id === modalId);
        if (c) {
          sceneRef.current?.animateTo(c);
          track(EVENTS.CURIOSITY_OPEN, { id: c.id, title: c.title_it, cat: c.cat, year: c.year });
        }
      }
    }, [modalId, items]);

    // Stable callback so the memoised Modal doesn't re-render on every
    // root re-render (compass heading ticks during a flyTo, etc.).
    const closeModal = useCallback(() => select(null), [select]);

    const onShare = useCallback((item) => {
      const url = `${location.origin}${location.pathname}#c=${item.id}&lang=${lang}`;
      const text = `${item[`title_${lang}`]} — ${item[`body_${lang}`]}`;
      if (navigator.share) {
        navigator.share({ title: item[`title_${lang}`], text, url }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
      track(EVENTS.CURIOSITY_SHARE, {
        id: item.id, title: item.title_it,
        method: navigator.share ? "native" : "clipboard",
      });
      setShared(true);
      setTimeout(() => setShared(false), 1600);
    }, [lang]);

    // Geolocation → 3D "you are here" star in the scene (and clear it when the
    // visitor stops sharing / leaves the area).
    const onLocate = useCallback((here, opts) => {
      sceneRef.current?.setUserPosition?.(here, opts);
    }, []);
    const onClearLocate = useCallback(() => {
      sceneRef.current?.clearUserPosition?.();
    }, []);

    // Tour — modal opens immediately during a guided tour (no delay).
    const tourList = filtered;
    const startTour = () => {
      if (tourList.length === 0) return;
      setTour(0); select(tourList[0].id);
      track(EVENTS.TOUR_START, { count: tourList.length });
    };
    const nextTour = () => {
      const next = (tour + 1) % tourList.length;
      setTour(next); select(tourList[next].id);
      track(EVENTS.TOUR_STEP, { dir: "next", index: next });
    };
    const prevTour = () => {
      const next = (tour - 1 + tourList.length) % tourList.length;
      setTour(next); select(tourList[next].id);
      track(EVENTS.TOUR_STEP, { dir: "prev", index: next });
    };
    const exitTour = () => { setTour(null); select(null); track(EVENTS.TOUR_EXIT); };
    const onTourToggle = () => tour === null ? startTour() : exitTour();

    // Keyboard
    useEffect(() => {
      const onKey = (e) => {
        if (e.key === "Escape") {
          if (activeId) select(null);
          if (tour !== null) exitTour();
        }
        if (e.key === "ArrowRight" && tour !== null) nextTour();
        if (e.key === "ArrowLeft" && tour !== null) prevTour();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [activeId, tour, select]);

    // Hash deep link (one-shot)
    useEffect(() => {
      const m = location.hash.match(/c=(\d+)/);
      if (m) select(parseInt(m[1], 10));
    }, [select]);

    return (
      <div id="stage" data-screen-label="Bal'harm" className={tour !== null ? "tour-mode" : ""}>
        <div id="three-root" ref={threeHostRef} />
        <Cornice compassRef={compassRef} />

        <TopBar lang={lang} setLang={setLang}
                audioOn={audioOn} setAudioOn={setAudioOn}
                tourActive={tour !== null} onTour={onTourToggle} />

        {!isMobile && (
          <>
            <Filters lang={lang} active={filterCats} setActive={setFilterCats} counts={counts}/>
            <div className="aux-stack">
              <GeoCard lang={lang} items={items} onSelect={(id) => select(id)}
                       onLocate={onLocate} onClearLocate={onClearLocate}/>
            </div>
          </>
        )}

        {isMobile && (
          <BottomSheet open={drawerOpen} onOpenChange={setDrawerOpen}
                       snap={["peek", "full"]}
                       peekHeight={88} fullHeight="58%"
                       initial="peek"
                       className="bh-drawer">
            <div className="drawer-content">
              <Filters lang={lang} active={filterCats} setActive={setFilterCats} counts={counts}/>
              <GeoCard lang={lang} items={items} onSelect={(id) => select(id)}
                       onLocate={onLocate} onClearLocate={onClearLocate}/>
            </div>
          </BottomSheet>
        )}

        <div className="hint">{isMobile ? (t.hintMobile || t.hint) : t.hint}</div>

        {tour !== null && (
          <div className="tour-bar">
            <button onClick={prevTour}>← {t.tourPrev}</button>
            <button className="primary" onClick={() => select(tourList[tour].id)}>
              {String(tour+1).padStart(2,"0")} / {String(tourList.length).padStart(2,"0")}
            </button>
            <button onClick={nextTour}>{t.tourNext} →</button>
          </div>
        )}

        {hoverId && hoverItem && !activeId && (
          <div className="pin-tooltip show" style={{ left: hoverPos.x, top: hoverPos.y }}>
            <small>{fmtYear(hoverItem.year, lang)}</small>
            {hoverItem[`title_${lang}`]}
          </div>
        )}

        {modalItem && !isMobile && (
          <Modal item={modalItem} onClose={closeModal} lang={lang}
                 total={items.length} onShare={onShare} sharedFlash={shared}/>
        )}

        {modalItem && isMobile && (
          <BottomSheet open={true}
                       onOpenChange={(o) => { if (!o) select(null); }}
                       snap={["peek", "full"]}
                       peekHeight="38%"
                       fullHeight="92%"
                       initial={tour !== null ? "full" : "peek"}
                       backdrop={true}
                       focusTrap={true}
                       closeOnSwipeDown={true}
                       onSnap={setModalSheetSnap}
                       className="bh-modal-sheet">
            <Modal item={modalItem} onClose={closeModal} lang={lang}
                   total={items.length} onShare={onShare} sharedFlash={shared}
                   mobile={true} />
          </BottomSheet>
        )}

        <div className={`loader ${loading ? "" : "hide"}`}>
          <div className="loader-inner">
            <svg className="loader-mark" viewBox="-30 -30 60 60" aria-hidden="true">
              <Star r1={26} r2={12} stroke="#c9a24a" />
              <Star r1={18} r2={9} stroke="#c9a24a" />
              <circle r="3" fill="#c9a24a"/>
            </svg>
            <div className="loader-title">Bal'harm</div>
            <div className="loader-tagline">{t.subtitle}</div>
            <div className="loader-bar"><span/></div>
            <div className={`loader-status ${loaderFade ? "fade" : ""}`}>
              <span>{(t.loadingPhrases || [t.loading])[loaderKw % (t.loadingPhrases?.length || 1)]}</span>
              <span className="dots">
                <span className="dot"/><span className="dot"/><span className="dot"/>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById("app")).render(<App />);
})();
