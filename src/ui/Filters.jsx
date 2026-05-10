// Bal'harm — theme filter chips (left rail).
window.Bh = window.Bh || {};
window.Bh.ui = window.Bh.ui || {};

(function () {
  function Filters({ lang, active, setActive, counts }) {
    const t = window.Bh.i18n.COPY[lang];
    const cats = window.Bh.data.CATEGORIES;
    const all = active.length === 0 || active.length === cats.length;
    return (
      <div className="filters">
        <div className="label">{t.filters}</div>
        <button className={`filter-chip ${all ? "active" : "dim"}`}
                onClick={() => setActive([])}>
          <span className="swatch" style={{background: "linear-gradient(45deg,#c9a24a,#7a1f2b)"}}/>
          {t.showAll}
          <span className="count">{window.Bh.data.CURIOSITIES.length}</span>
        </button>
        {cats.map(c => {
          const on = active.includes(c.id);
          return (
            <button key={c.id} className={`filter-chip ${on ? "active" : (active.length ? "dim" : "")}`}
                    onClick={() => {
                      if (on) setActive(active.filter(x => x !== c.id));
                      else setActive([...active, c.id]);
                    }}>
              <span className="swatch" style={{background: c.color}}/>
              {c[lang]}
              <span className="count">{counts[c.id] || 0}</span>
            </button>
          );
        })}
      </div>
    );
  }

  window.Bh.ui.Filters = Filters;
})();
