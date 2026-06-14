// Bal'harm — geolocation card: places a 3D "you are here" star in the scene
// and surfaces the nearest curiosity. Live-tracks via watchPosition.
window.Bh = window.Bh || {};
window.Bh.ui = window.Bh.ui || {};

(function () {
  const { useState, useEffect, useRef } = React;

  // Palermo centre — past this radius the visitor isn't really "here", so we
  // don't drop the marker on an empty sea of un-streamed tiles or snap the
  // nearest line to a curiosity 30 km away (e.g. Targa Florio).
  const PALERMO = { lat: 38.1157, lng: 13.3614 };
  const NEAR_KM = 6;

  function GeoCard({ lang, items, onSelect, onLocate, onClearLocate }) {
    const t = window.Bh.i18n.COPY[lang];
    const { haversineKm, fmtDist } = window.Bh.lib.format;
    const [pos, setPos] = useState(null);
    const [status, setStatus] = useState("idle"); // idle | locating | ok | far | denied
    const watchRef = useRef(null);
    const firstFixRef = useRef(true);

    // Stop tracking + clear the scene marker when the card unmounts.
    useEffect(() => () => {
      if (watchRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchRef.current);
      }
      onClearLocate && onClearLocate();
    }, []);

    const locate = () => {
      if (!navigator.geolocation) { setStatus("denied"); return; }
      setStatus("locating");
      firstFixRef.current = true;
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = navigator.geolocation.watchPosition(
        (p) => {
          const here = { lat: p.coords.latitude, lng: p.coords.longitude };
          setPos(here);
          if (haversineKm(here, PALERMO) > NEAR_KM) {
            setStatus("far");
            onClearLocate && onClearLocate();
            return;
          }
          setStatus("ok");
          // Fly the camera only on the first fix; later updates just glide the
          // star to the new position.
          onLocate && onLocate(here, { fly: firstFixRef.current });
          firstFixRef.current = false;
          window.Bh.track?.(window.Bh.lib.analytics.EVENTS.GEO_LOCATE, {});
        },
        () => setStatus("denied"),
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
      );
    };

    let nearest = null;
    if (pos && status === "ok") {
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
        {status === "far" && (
          <>
            <div>{t.notNearby}</div>
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
