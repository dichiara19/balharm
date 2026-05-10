// Bal'harm — top bar: brand, audio, tour, mode, language.
window.Bh = window.Bh || {};
window.Bh.ui = window.Bh.ui || {};

(function () {
  function TopBar({ lang, setLang, audioOn, setAudioOn, tourActive, onTour }) {
    const t = window.Bh.i18n.COPY[lang];
    const { Star } = window.Bh.ui;
    return (
      <div className="topbar">
        <div className="brand">
          <svg className="mark" viewBox="-30 -30 60 60">
            <Star r1={26} r2={12} stroke="#c9a24a" />
            <circle r="3" fill="#c9a24a"/>
          </svg>
          <h1>Bal'harm</h1>
          <span className="sep"/>
          <small>{t.subtitle}</small>
        </div>
        <div className="toolbar-right">
          <button className={`audio-toggle ${audioOn ? "on" : ""}`}
                  onClick={() => setAudioOn(!audioOn)}
                  title={t.audio} aria-label={t.audio}>
            {audioOn ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 10v4h4l5 4V6L7 10H3z"/><path d="M16 8c2 1.5 2 6.5 0 8"/><path d="M19 5c4 3 4 11 0 14"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 10v4h4l5 4V6L7 10H3z"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>
            )}
          </button>
          <button className={`pill ${tourActive ? "active" : ""}`} onClick={onTour}>
            {tourActive ? t.tourEnd : t.tourStart}
          </button>
          <div className="lang-toggle">
            <button className={lang === "it" ? "active" : ""} onClick={() => setLang("it")}>IT</button>
            <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>
      </div>
    );
  }

  window.Bh.ui.TopBar = TopBar;
})();
