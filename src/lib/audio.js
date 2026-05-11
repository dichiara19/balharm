// Bal'harm — ambient audio. Streams a looping recording from uploads/sounds
// when the user flips the toggle, with fade-in/out for a graceful transition.
window.Bh = window.Bh || {};
window.Bh.lib = window.Bh.lib || {};

(function () {
  const { useState, useEffect, useRef } = React;

  const AMBIENT_URL = encodeURI("uploads/sounds/Port of Ash Layers.mp3");
  const TARGET_VOLUME = 0.55;
  const FADE_IN_MS = 1800;
  const FADE_OUT_MS = 700;

  function useAmbientAudio(initialOn = true) {
    // Callers pass `false` on mobile so we don't even attempt autoplay there
    // (mobile browsers block it permanently after the first refusal). The
    // mobile UI shows a small consent popup post-splash instead.
    const [on, setOn] = useState(initialOn);
    const audioRef = useRef(null);
    const fadeRef = useRef(0);
    const retryRef = useRef(null);

    useEffect(() => {
      if (!audioRef.current) {
        const a = new Audio(AMBIENT_URL);
        a.loop = true;
        a.preload = "auto";
        a.volume = 0;
        audioRef.current = a;
      }
      const a = audioRef.current;
      cancelAnimationFrame(fadeRef.current);

      if (on) {
        const tryPlay = () => a.play()
          .then(() => console.log("[Bh] ambient audio playing"))
          .catch((e) => {
            console.warn("[Bh] ambient autoplay blocked, will retry on next gesture:", e.message);
            // Hook a one-shot retry on the very first user gesture.
            if (!retryRef.current) {
              retryRef.current = () => {
                document.removeEventListener("pointerdown", retryRef.current, true);
                retryRef.current = null;
                if (audioRef.current && a.paused) a.play().catch(() => {});
              };
              document.addEventListener("pointerdown", retryRef.current, true);
            }
          });
        tryPlay();
        const start = performance.now();
        const from = a.volume;
        const tick = () => {
          const t = Math.min(1, (performance.now() - start) / FADE_IN_MS);
          a.volume = from + (TARGET_VOLUME - from) * t;
          if (t < 1) fadeRef.current = requestAnimationFrame(tick);
        };
        fadeRef.current = requestAnimationFrame(tick);
      } else {
        const start = performance.now();
        const from = a.volume;
        const tick = () => {
          const t = Math.min(1, (performance.now() - start) / FADE_OUT_MS);
          a.volume = from * (1 - t);
          if (t < 1) fadeRef.current = requestAnimationFrame(tick);
          else a.pause();
        };
        fadeRef.current = requestAnimationFrame(tick);
      }

      return () => cancelAnimationFrame(fadeRef.current);
    }, [on]);

    return [on, setOn];
  }

  window.Bh.lib.audio = { useAmbientAudio };
})();
