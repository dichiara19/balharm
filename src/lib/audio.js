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

  // Gesture events that grant user activation. pointerdown is not one of them
  // for touch input, which is why the old retry never fired on phones.
  const GESTURES = ["pointerup", "touchend", "click", "keydown"];

  function useAmbientAudio(initialOn = true) {
    // Desktop passes `true` and tries to autoplay with the splash. Phones pass
    // `false`: the splash gate ("Entra") calls start() inside the tap, the
    // one place where both iOS and Android let audio begin.
    const [on, setOn] = useState(initialOn);
    const audioRef = useRef(null);
    const graphRef = useRef(null);   // { ctx, gain } once built
    const fadeRef = useRef(0);
    const retryRef = useRef(null);

    const ensureAudio = () => {
      if (!audioRef.current) {
        const a = new Audio(AMBIENT_URL);
        a.loop = true;
        a.preload = "auto";
        a.volume = 0;
        audioRef.current = a;
      }
      return audioRef.current;
    };

    // iOS Safari ignores HTMLMediaElement.volume (always 1), so level and
    // fades go through a Web Audio GainNode. Built only inside a gesture: a
    // context created without one starts suspended and would mute the element.
    const ensureGraph = () => {
      if (graphRef.current) return graphRef.current;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        const a = ensureAudio();
        const ctx = new AC();
        const gain = ctx.createGain();
        gain.gain.value = a.volume;   // carry over a fade already in progress
        ctx.createMediaElementSource(a).connect(gain).connect(ctx.destination);
        a.volume = 1;
        graphRef.current = { ctx, gain };
      } catch (e) {
        console.warn("[Bh] Web Audio unavailable, using element volume:", e.message);
        graphRef.current = null;
      }
      return graphRef.current;
    };
    const getVol = () => graphRef.current ? graphRef.current.gain.gain.value : ensureAudio().volume;
    const setVol = (v) => {
      if (graphRef.current) graphRef.current.gain.gain.value = v;
      else ensureAudio().volume = v;
    };

    // Must run synchronously inside a user gesture handler.
    const unlock = () => {
      const g = ensureGraph();
      if (g && g.ctx.state !== "running") g.ctx.resume().catch(() => {});
      const a = ensureAudio();
      if (a.paused) a.play().catch(() => {});
    };
    const start = () => { unlock(); setOn(true); };

    useEffect(() => {
      const a = ensureAudio();
      cancelAnimationFrame(fadeRef.current);

      if (on) {
        a.play()
          .then(() => console.log("[Bh] ambient audio playing"))
          .catch((e) => {
            console.warn("[Bh] ambient autoplay blocked, will retry on next gesture:", e.message);
            // One-shot retry on the very first real gesture.
            if (!retryRef.current) {
              retryRef.current = () => {
                GESTURES.forEach((ev) => document.removeEventListener(ev, retryRef.current, true));
                retryRef.current = null;
                unlock();
              };
              GESTURES.forEach((ev) => document.addEventListener(ev, retryRef.current, true));
            }
          });
        const start = performance.now();
        const from = getVol();
        const tick = () => {
          const t = Math.min(1, (performance.now() - start) / FADE_IN_MS);
          setVol(from + (TARGET_VOLUME - from) * t);
          if (t < 1) fadeRef.current = requestAnimationFrame(tick);
        };
        fadeRef.current = requestAnimationFrame(tick);
      } else {
        if (retryRef.current) {
          GESTURES.forEach((ev) => document.removeEventListener(ev, retryRef.current, true));
          retryRef.current = null;
        }
        const start = performance.now();
        const from = getVol();
        const tick = () => {
          const t = Math.min(1, (performance.now() - start) / FADE_OUT_MS);
          setVol(from * (1 - t));
          if (t < 1) fadeRef.current = requestAnimationFrame(tick);
          else a.pause();
        };
        fadeRef.current = requestAnimationFrame(tick);
      }

      return () => cancelAnimationFrame(fadeRef.current);
    }, [on]);

    return [on, setOn, start];
  }

  window.Bh.lib.audio = { useAmbientAudio };
})();
