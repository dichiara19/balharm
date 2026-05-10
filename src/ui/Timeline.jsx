// Bal'harm — bottom timeline scrubber + era labels.
window.Bh = window.Bh || {};
window.Bh.ui = window.Bh.ui || {};

(function () {
  const { useState, useEffect, useRef, useCallback } = React;

  function Timeline({ lang, yearMax, setYearMax, items }) {
    const t = window.Bh.i18n.COPY[lang];
    const { ERAS, YEAR_MIN, YEAR_MAX, yearToPct, pctToYear, fmtYear } = window.Bh.lib.format;
    const trackRef = useRef(null);
    const [drag, setDrag] = useState(false);
    const yMaxPct = yearToPct(yearMax);

    const setFromX = useCallback((clientX) => {
      const r = trackRef.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      setYearMax(pctToYear(p));
    }, [setYearMax, pctToYear]);

    useEffect(() => {
      if (!drag) return;
      const move = (e) => setFromX(e.clientX);
      const up = () => setDrag(false);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    }, [drag, setFromX]);

    return (
      <div className="timeline">
        <div className="timeline-head">
          <span>{t.timeline}</span>
          <span className="yr">
            {yearMax >= YEAR_MAX ? t.timelineYear : `→ ${fmtYear(yearMax, lang)}`}
          </span>
          <span>{fmtYear(YEAR_MIN, lang)} ▸ {fmtYear(YEAR_MAX, lang)}</span>
        </div>
        <div ref={trackRef} className="timeline-track"
             onPointerDown={(e) => { setDrag(true); setFromX(e.clientX); }}>
          {items.map(c => {
            const p = yearToPct(c.year) * 100;
            const dim = c.year > yearMax;
            return (
              <span key={c.id}
                    className={`timeline-tick ${dim ? "dim" : ""}`}
                    style={{ left: p + "%" }}
                    title={`${fmtYear(c.year, lang)} · ${c[`title_${lang}`]}`} />
            );
          })}
          <span className="timeline-cursor" style={{ left: (yMaxPct * 100) + "%" }} />
        </div>
        <div className="timeline-eras">
          {ERAS.map((e, i) => (
            <span key={i} style={{ left: (yearToPct(e.y) * 100) + "%" }}>{t.eras[e.label]}</span>
          ))}
        </div>
      </div>
    );
  }

  window.Bh.ui.Timeline = Timeline;
})();
