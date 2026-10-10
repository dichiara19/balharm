// Bal'harm — top bar: brand, audio, tour, mode, language.
window.Bh = window.Bh || {};
window.Bh.ui = window.Bh.ui || {};

(function () {
  const { useState, useRef, useEffect } = React;

  function TopBar({ lang, setLang, audioOn, setAudioOn, tourActive, onTour }) {
    const t = window.Bh.i18n.COPY[lang];
    const { Star } = window.Bh.ui;
    const [tipOpen, setTipOpen] = useState(false);
    const nameRef = useRef(null);
    const mobile = !!window.Bh.device?.isMobile;
    const other = lang === "it" ? "en" : "it";

    // Close the editorial popover on outside tap / Escape (mobile + desktop).
    useEffect(() => {
      if (!tipOpen) return;
      const onPointer = (e) => {
        if (nameRef.current && !nameRef.current.contains(e.target)) setTipOpen(false);
      };
      const onKey = (e) => { if (e.key === "Escape") setTipOpen(false); };
      document.addEventListener("pointerdown", onPointer);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("pointerdown", onPointer);
        document.removeEventListener("keydown", onKey);
      };
    }, [tipOpen]);

    return (
      <header className="topbar">
        <div className="brand">
          <svg className="mark" viewBox="-30 -30 60 60">
            <Star r1={26} r2={12} stroke="#c9a24a" />
            <circle r="3" fill="#c9a24a"/>
          </svg>
          <span className="brand-name" ref={nameRef}>
            <h1>Bal'harm</h1>
            <button type="button" className="brand-info"
                    aria-label={t.brandTipAria} aria-expanded={tipOpen}
                    onClick={() => setTipOpen((o) => !o)}>i</button>
            <span className={`brand-tip ${tipOpen ? "open" : ""}`} role="tooltip">
              <span className="brand-tip-chain">{t.brandTipChain}</span>
              <span className="brand-tip-body">{t.brandTip}</span>
              <span className="brand-tip-claim">{t.brandTipClaim}</span>
            </span>
          </span>
          <span className="sep"/>
          <small>{t.subtitle}</small>
        </div>
        <div className="toolbar-right" role="group">
          <button className={`tb-btn audio-toggle ${audioOn ? "on" : ""}`}
                  onClick={() => setAudioOn(!audioOn)}
                  title={t.audio} aria-label={t.audio} aria-pressed={audioOn}>
            {audioOn ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 10v4h4l5 4V6L7 10H3z"/><path d="M16 8c2 1.5 2 6.5 0 8"/><path d="M19 5c4 3 4 11 0 14"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 10v4h4l5 4V6L7 10H3z"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>
            )}
          </button>
          <button className={`tb-btn tour-toggle ${tourActive ? "active" : ""}`} onClick={onTour}
                  aria-label={tourActive ? t.tourEnd : t.tourStart}>
            {tourActive ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>
            )}
            <span className="tb-label">{tourActive ? t.tourEnd : (mobile ? t.tourShort : t.tourStart)}</span>
          </button>
          {mobile ? (
            // One slot on phones: it shows the language you switch *to*.
            <button className="tb-btn lang-switch" lang={other}
                    onClick={() => setLang(other)} aria-label={t.langSwitchAria}>
              {other.toUpperCase()}
            </button>
          ) : (
            <div className="lang-toggle">
              <button className={lang === "it" ? "active" : ""} aria-pressed={lang === "it"} onClick={() => setLang("it")}>IT</button>
              <button className={lang === "en" ? "active" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
            </div>
          )}
        </div>
      </header>
    );
  }

  window.Bh.ui.TopBar = TopBar;
})();
