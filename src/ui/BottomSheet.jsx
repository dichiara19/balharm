// Bal'harm — generic bottom sheet with snap points (peek + full).
// Used for the mobile drawer (filters + geo) and the mobile curiosity modal.
// Drag is constrained to the .bh-sheet-handle region so scrolling the body
// doesn't accidentally collapse the sheet.
window.Bh = window.Bh || {};
window.Bh.ui = window.Bh.ui || {};

(function () {
  const { useRef, useEffect, useState, useCallback } = React;

  // Resolve a height descriptor ("60%", 88, "100dvh") to pixels relative to
  // the viewport so we can do clamp/translate math on the same scale.
  function toPx(value) {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return 0;
    if (value.endsWith("%")) return (parseFloat(value) / 100) * window.innerHeight;
    if (value.endsWith("dvh") || value.endsWith("vh")) return (parseFloat(value) / 100) * window.innerHeight;
    if (value.endsWith("px")) return parseFloat(value);
    return parseFloat(value) || 0;
  }

  function BottomSheet({
    open = true,
    onOpenChange,
    snap = ["peek", "full"],
    peekHeight = 88,
    fullHeight = "60%",
    initial = "peek",
    backdrop = false,
    focusTrap = false,
    closeOnSwipeDown = false,
    onSnap,
    className = "",
    children,
  }) {
    const sheetRef  = useRef(null);
    const handleRef = useRef(null);
    const dragRef = useRef({ active: false, startY: 0, baseTranslate: 0, lastY: 0, lastT: 0, velocity: 0 });

    const [snapState, setSnapState] = useState(snap.includes(initial) ? initial : snap[0]);
    const [dragging, setDragging] = useState(false);
    const [translateY, setTranslateY] = useState(0);

    // Compute the translateY (down from full) for each snap state.
    // The sheet itself is positioned bottom: 0 with height = fullHeightPx,
    // so translate=0 means "fully extended", positive translate hides it.
    const fullPx = toPx(fullHeight);
    const peekPx = toPx(peekHeight);
    const closedPx = fullPx + 40; // off-screen
    const stateY = useCallback((state) => {
      if (state === "full") return 0;
      if (state === "peek") return Math.max(0, fullPx - peekPx);
      return closedPx;
    }, [fullPx, peekPx, closedPx]);

    // Apply snap when state changes (and we're not actively dragging).
    useEffect(() => {
      if (dragging) return;
      setTranslateY(open ? stateY(snapState) : closedPx);
    }, [snapState, open, dragging, stateY, closedPx]);

    // Notify parent on snap changes.
    useEffect(() => { onSnap && onSnap(snapState); }, [snapState, onSnap]);

    const onPointerDown = useCallback((e) => {
      if (!handleRef.current?.contains(e.target)) return;
      e.preventDefault();
      handleRef.current.setPointerCapture?.(e.pointerId);
      dragRef.current.active = true;
      dragRef.current.startY = e.clientY;
      dragRef.current.baseTranslate = translateY;
      dragRef.current.lastY = e.clientY;
      dragRef.current.lastT = performance.now();
      dragRef.current.velocity = 0;
      setDragging(true);
    }, [translateY]);

    const onPointerMove = useCallback((e) => {
      if (!dragRef.current.active) return;
      const dy = e.clientY - dragRef.current.startY;
      const next = Math.max(0, Math.min(closedPx, dragRef.current.baseTranslate + dy));
      // Track velocity (px/ms) for fling
      const now = performance.now();
      const dt = Math.max(1, now - dragRef.current.lastT);
      dragRef.current.velocity = (e.clientY - dragRef.current.lastY) / dt;
      dragRef.current.lastY = e.clientY;
      dragRef.current.lastT = now;
      setTranslateY(next);
    }, [closedPx]);

    const onPointerUp = useCallback((e) => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      handleRef.current?.releasePointerCapture?.(e.pointerId);
      setDragging(false);

      const v = dragRef.current.velocity;
      const FLING_THRESHOLD = 0.4; // px/ms
      // If swiping fast down past peek, close (only if allowed).
      if (closeOnSwipeDown && v > FLING_THRESHOLD && translateY > stateY("peek")) {
        onOpenChange && onOpenChange(false);
        return;
      }
      // Snap to nearest target, biased by velocity.
      const targets = snap.map((s) => ({ s, y: stateY(s) }));
      let best = targets[0], bestDist = Infinity;
      const biasedY = translateY + v * 80; // 80ms projection
      targets.forEach((t) => {
        const d = Math.abs(t.y - biasedY);
        if (d < bestDist) { bestDist = d; best = t; }
      });
      setSnapState(best.s);
    }, [translateY, snap, stateY, closeOnSwipeDown, onOpenChange]);

    // Cleanup on unmount mid-drag.
    useEffect(() => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      sheet.addEventListener("pointerdown", onPointerDown);
      sheet.addEventListener("pointermove", onPointerMove);
      sheet.addEventListener("pointerup",   onPointerUp);
      sheet.addEventListener("pointercancel", onPointerUp);
      return () => {
        sheet.removeEventListener("pointerdown", onPointerDown);
        sheet.removeEventListener("pointermove", onPointerMove);
        sheet.removeEventListener("pointerup",   onPointerUp);
        sheet.removeEventListener("pointercancel", onPointerUp);
      };
    }, [onPointerDown, onPointerMove, onPointerUp]);

    // ESC closes (when backdrop/dialog).
    useEffect(() => {
      if (!open || !backdrop) return;
      const onKey = (e) => { if (e.key === "Escape") onOpenChange && onOpenChange(false); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open, backdrop, onOpenChange]);

    // Public method: jump to a snap state programmatically (handle tap).
    const cycleSnap = useCallback(() => {
      const idx = snap.indexOf(snapState);
      const next = snap[(idx + 1) % snap.length];
      setSnapState(next);
    }, [snap, snapState]);

    return (
      <>
        {backdrop && open && (
          <div className="bh-sheet-backdrop"
               style={{ opacity: dragging ? Math.max(0, 1 - translateY / fullPx) * 0.7 : (snapState === "full" ? 0.7 : 0.45) }}
               onClick={() => onOpenChange && onOpenChange(false)} />
        )}
        <div ref={sheetRef}
             className={`bh-sheet ${className} ${dragging ? "dragging" : ""} bh-snap-${snapState}`}
             style={{
               height: fullPx,
               transform: `translateY(${translateY}px)`,
               transition: dragging ? "none" : "transform 320ms cubic-bezier(.2,.7,.2,1), opacity .25s",
             }}
             role={backdrop ? "dialog" : undefined}
             aria-modal={backdrop ? "true" : undefined}>
          <div ref={handleRef} className="bh-sheet-handle" onClick={cycleSnap}>
            <span className="bh-sheet-grabber"/>
          </div>
          <div className="bh-sheet-body">{children}</div>
        </div>
      </>
    );
  }

  window.Bh.ui.BottomSheet = BottomSheet;
})();
