// Bal'harm — curiosity detail modal (image + body + mini OSM map).
window.Bh = window.Bh || {};
window.Bh.ui = window.Bh.ui || {};

(function () {
  function MiniMap({ item }) {
    const z = 15;
    const lng2tx = (lng) => ((lng + 180) / 360) * Math.pow(2, z);
    const lat2ty = (lat) => {
      const r = (lat * Math.PI) / 180;
      return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
    };
    const tx = lng2tx(item.lng);
    const ty = lat2ty(item.lat);
    const cols = 3, rows = 2;
    const baseX = Math.floor(tx) - 1;
    const baseY = Math.floor(ty) - 0;
    const tileW = 256, tileH = 256;
    const offsetX = (tx - baseX) * tileW;
    const offsetY = (ty - baseY) * tileH;
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tiles.push({ x: baseX + c, y: baseY + r, c, r });
      }
    }
    return (
      <div className="mini-map">
        <div className="mini-tiles" style={{ transform: `translate(calc(50% - ${offsetX}px), calc(50% - ${offsetY}px))` }}>
          {tiles.map((t) => (
            <img key={`${t.x}-${t.y}`} className="mini-tile" alt=""
                 src={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`}
                 style={{ left: t.c * tileW, top: t.r * tileH }} loading="lazy" />
          ))}
        </div>
        <div className="mini-pin" aria-hidden="true">
          <span className="mini-pin-dot"/>
          <span className="mini-pin-ring"/>
        </div>
        <div className="mini-attrib">© OpenStreetMap</div>
      </div>
    );
  }

  // Mobile tour stepper. Rendered by app.jsx in the BottomSheet header slot,
  // above the scrolling body, so it never scrolls away or bleeds past the
  // sheet edges (it used to be a sticky child with negative margins).
  function TourNav({ lang, index, total, onPrev, onNext, onExit }) {
    const t = window.Bh.i18n.COPY[lang];
    const pct = ((index + 1) / Math.max(1, total)) * 100;
    return (
      <div className="tour-nav" role="navigation" aria-label={t.tour}>
        <button type="button" className="tour-nav-btn prev" onClick={onPrev} aria-label={t.tourPrev}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6"/></svg>
        </button>
        <div className="tour-nav-mid">
          <span className="tour-nav-count">
            {String(index + 1).padStart(2, "0")}<i>/</i>{String(total).padStart(2, "0")}
          </span>
          <span className="tour-nav-track" aria-hidden="true">
            <span className="tour-nav-fill" style={{ width: `${pct}%` }} />
          </span>
        </div>
        <button type="button" className="tour-nav-exit" onClick={onExit}>{t.tourEnd}</button>
        <button type="button" className="tour-nav-btn next" onClick={onNext} aria-label={t.tourNext}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>
        </button>
      </div>
    );
  }

  function Modal({ item, onClose, lang, total, onShare, sharedFlash, mobile = false, inTour = false }) {
    const t = window.Bh.i18n.COPY[lang];
    const { Star } = window.Bh.ui;
    const { fmtYear } = window.Bh.lib.format;
    const cat = window.Bh.data.CATEGORIES.find(c => c.id === item.cat);
    // On mobile the modal is hosted inside a BottomSheet (no scrim wrapper).
    const Wrapper = ({ children }) => mobile
      ? <div className={`modal modal-mobile${inTour ? " in-tour" : ""}`}>{children}</div>
      : <div className="scrim" onClick={onClose}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>{children}</div>
        </div>;
    // Mobile puts title + theme above the photo: at the peek snap the sheet
    // shows what the curiosity is while the camera flies to it.
    const head = (
      <>
        {!inTour && <div className="num">{String(item.id).padStart(2,"0")} / {String(total).padStart(2,"0")}</div>}
        <h2>{item[`title_${lang}`]}</h2>
        <div className="meta">
          <span className="cat-swatch" style={{background: cat.color}}/>
          <span>{cat[lang]}</span>
          <span className="dot"/>
          <span>{fmtYear(item.year, lang)}</span>
          {!mobile && <>
            <span className="dot"/>
            <span>{item.lat.toFixed(4)}°N · {item.lng.toFixed(4)}°E</span>
          </>}
        </div>
      </>
    );
    return (
      <Wrapper>
          <button className="close" onClick={onClose} aria-label={t.closeAria}>×</button>
          {mobile && <div className="m-head">{head}</div>}
          <div className={`img${item.img ? "" : " no-img"}`}>
            {item.img ? (
              <img src={item.img} alt="" loading="lazy" onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.nextElementSibling.style.display = "grid";
                e.currentTarget.parentElement.classList.add("no-img");
              }}/>
            ) : null}
            <div className="placeholder" style={{ display: item.img ? "none" : "grid" }}>
              <div>
                <svg viewBox="-50 -50 100 100" width="96" height="96" aria-hidden="true"><Star r1={48} r2={22} stroke="#c9a24a" /></svg>
                <span>{item[`title_${lang}`]}</span>
                <div style={{marginTop:14, fontSize: 9}}>{t.placeholderLabel}</div>
              </div>
            </div>
            {item.source && <div className="src">{t.sourceLabel}: {item.source}</div>}
            <MiniMap item={item} />
          </div>
          <div className="body">
            {!mobile && head}
            <p>{item[`body_${lang}`]}</p>
            <div className="actions">
              <button className="pill" onClick={() => onShare(item)}>
                {sharedFlash ? t.shared : t.share}
              </button>
              <a className="pill" target="_blank" rel="noreferrer"
                 href={`https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lng}#map=16/${item.lat}/${item.lng}`}>
                {lang === "it" ? "Apri in mappa" : "Open in map"}
              </a>
            </div>
          </div>
      </Wrapper>
    );
  }

  // Memoise the modal so root re-renders triggered by the live camera
  // heading (compass) don't re-mount the scrim + image + body 30×/sec during
  // a flyTo — that re-render storm was the flicker the user reported.
  const MemoModal = React.memo(Modal);

  window.Bh.ui.MiniMap = MiniMap;
  window.Bh.ui.TourNav = TourNav;
  window.Bh.ui.Modal = MemoModal;
})();
