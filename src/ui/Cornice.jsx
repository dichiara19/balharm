// Bal'harm — arabesque cornice (decorative SVG frame) + reusable Star polygon helper.
window.Bh = window.Bh || {};
window.Bh.ui = window.Bh.ui || {};

(function () {
  function Star({ r1, r2, stroke }) {
    const pts = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const r = k % 2 === 0 ? r1 : r2;
      pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
    }
    return <polygon points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="1" />;
  }

  // The compass rotates *opposite* to the camera heading so its N always
  // points to true north. Its transform is driven IMPERATIVELY via compassRef
  // (app.jsx writes the rotation straight to the DOM node on every camera tick)
  // so rotating the map never triggers a React re-render of the whole tree —
  // that per-frame reconciliation in the dev build was a real source of the
  // "glitchy" desktop navigation. Everything else here is static, so the
  // component is memoised below and renders exactly once.
  function Cornice({ compassRef }) {
    return (
      <svg className="cornice" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern id="arabesqueTop" x="0" y="0" width="80" height="40" patternUnits="userSpaceOnUse">
            <path d="M0,20 Q20,0 40,20 T80,20" stroke="#c9a24a" strokeWidth="0.8" fill="none" opacity="0.55"/>
            <circle cx="40" cy="20" r="2" fill="#c9a24a" opacity="0.6"/>
            <path d="M20,20 L40,8 L60,20 L40,32 Z" stroke="#c9a24a" strokeWidth="0.5" fill="none" opacity="0.4"/>
          </pattern>
        </defs>
        <rect x="0" y="0" width="1600" height="40" fill="url(#arabesqueTop)" />
        <rect x="0" y="860" width="1600" height="40" fill="url(#arabesqueTop)" />
        <g transform="translate(40,0) rotate(90 0 0)">
          <rect x="0" y="-40" width="900" height="40" fill="url(#arabesqueTop)" />
        </g>
        <g transform="translate(1560,0) rotate(90 0 0)">
          <rect x="0" y="0" width="900" height="40" fill="url(#arabesqueTop)" />
        </g>
        {/* Bottom medallions only — the upper ones were too close to brand/topbar. */}
        {[[40,860],[1560,860]].map(([cx,cy],i) => (
          <g key={i} transform={`translate(${cx},${cy})`}>
            <Star r1={28} r2={14} stroke="#c9a24a" />
            <circle r="4" fill="#c9a24a" opacity="0.9"/>
          </g>
        ))}
        {/* Central compass — rotates with the camera so N stays towards true north. */}
        <g ref={compassRef} transform="translate(800,450) rotate(0)" opacity="0.18">
          <Star r1={140} r2={70} stroke="#c9a24a" />
          <Star r1={90} r2={45} stroke="#c9a24a" />
          <circle r="4" fill="#c9a24a"/>
          <text x="0" y="-150" textAnchor="middle" fill="#c9a24a" fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="3">N</text>
          <text x="155" y="4" textAnchor="middle" fill="#c9a24a" fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="3">E</text>
          <text x="0" y="160" textAnchor="middle" fill="#c9a24a" fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="3">S</text>
          <text x="-155" y="4" textAnchor="middle" fill="#c9a24a" fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="3">O</text>
        </g>
      </svg>
    );
  }

  window.Bh.ui.Star = Star;
  // Memoised: compassRef is stable, so Cornice mounts once and the camera-driven
  // compass rotation is applied straight to the DOM, bypassing React entirely.
  window.Bh.ui.Cornice = React.memo(Cornice);
})();
