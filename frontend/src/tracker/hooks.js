import { useState, useEffect, useRef } from "react";

export function useCountUp(target, duration = 1000) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame === "undefined") { setVal(target); fromRef.current = target; return; }
    const from = fromRef.current;
    const start = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let raf;
    const tick = (t) => {
      const p = Math.min(1, ((typeof performance !== "undefined" ? t : Date.now()) - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}
