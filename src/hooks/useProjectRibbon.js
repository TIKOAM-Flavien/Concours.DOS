import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useProjectRibbon({ unfinishedCount, overviewVisible }) {
  const ribbonSentinelRef = useRef(null);
  const ribbonNavRef = useRef(null);
  const ribbonTrackRef = useRef(null);
  const [ribbonStuck, setRibbonStuck] = useState(false);
  const [ribbonDockedTop, setRibbonDockedTop] = useState(false);

  useEffect(() => {
    const sentinel = ribbonSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => setRibbonStuck(!entry.isIntersecting),
      { threshold: [0], rootMargin: "0px 0px 0px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [unfinishedCount]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (unfinishedCount === 0) return undefined;
    const nav = ribbonNavRef.current;
    if (!nav) return undefined;

    const thresholdPx = 2;
    const sync = () => {
      setRibbonDockedTop(nav.getBoundingClientRect().top <= thresholdPx);
    };

    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => sync()) : null;
    if (ro) ro.observe(nav);
    sync();
    requestAnimationFrame(sync);

    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      ro?.disconnect();
    };
  }, [unfinishedCount, overviewVisible]);

  useEffect(() => {
    const nav = ribbonNavRef.current;
    if (!nav) return undefined;

    function handleWheel(event) {
      const track = ribbonTrackRef.current;
      if (!track) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (delta === 0) return;
      const canScrollLeft = track.scrollLeft > 0 && delta < 0;
      const canScrollRight =
        track.scrollLeft + track.clientWidth < track.scrollWidth - 1 &&
        delta > 0;
      if (!canScrollLeft && !canScrollRight) return;
      event.preventDefault();
      track.scrollLeft += delta;
    }

    nav.addEventListener("wheel", handleWheel, { passive: false });
    return () => nav.removeEventListener("wheel", handleWheel);
  }, [unfinishedCount]);

  return {
    ribbonSentinelRef,
    ribbonNavRef,
    ribbonTrackRef,
    ribbonStuck,
    ribbonDockedTop,
  };
}
