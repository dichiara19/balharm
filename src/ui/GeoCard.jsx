// Bal'harm — geolocation card: nearest curiosity to the visitor.
window.Bh = window.Bh || {};
window.Bh.ui = window.Bh.ui || {};

(function () {
  const { useState } = React;

  function GeoCard({ lang, items, onSelect }) {
    const t = window.Bh.i18n.COPY[lang];
    const { haversineKm, fmtDist } = window.Bh.lib.format;
    const [pos, setPos] = useState(null);
    const [status, setStatus] = useState("idle"); // idle | locating | ok | denied

    const locate = () => {
      if (!navigator.geolocation) { setStatus("denied"); return; }
      setStatus("locating");
      navigator.geolocation.getCurrentPosition(
        (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setStatus("ok"); },
        () => setStatus("denied"),
        { timeout: 8000 }
      );
    };

    let nearest = null;
    if (pos) {
      let best = Infinity;
      for (const c of items) {
        const d = haversineKm(pos, { lat: c.lat, lng: c.lng });
        if (d < best) { best = d; nearest = { c, d }; }
      }
    }

    return (
      <div className="geo-card">
        <div className="geo-title">{t.nearby}</div>
        {status === "idle" && (
          <>
            <div>{t.locationOff}</div>
            <button onClick={locate}>{t.locate}</button>
          </>
        )}
        {status === "locating" && <div>{t.locating}</div>}
        {status === "denied" && (
          <>
            <div>{t.locationDenied}</div>
            <button onClick={locate}>{t.locate}</button>
          </>
        )}
        {status === "ok" && nearest && (
          <div onClick={() => onSelect(nearest.c.id)} style={{cursor: "pointer"}}>
            <div className="geo-place">{nearest.c[`title_${lang}`]}</div>
            <div className="geo-distance">{t.distance.replace("{d}", fmtDist(nearest.d))}</div>
          </div>
        )}
      </div>
    );
  }

  window.Bh.ui.GeoCard = GeoCard;
})();
