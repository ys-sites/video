import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Measure the clipped text itself, including two-line clamps and translated labels. */
export function useTextOverflow(text: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const measure = useCallback(() => {
    const element = ref.current;
    setOverflowing(Boolean(element && element.clientWidth > 0 && element.clientHeight > 0
      && (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)));
  }, []);
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    // Browsers re-measure once web fonts finish loading; environments without a
    // fully implemented font set (such as jsdom) simply keep the initial result.
    const fonts = document.fonts;
    const listensToFonts = typeof fonts?.addEventListener === "function";
    if (listensToFonts) fonts.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      if (listensToFonts) fonts.removeEventListener("loadingdone", measure);
    };
  }, [text, measure]);
  return { ref, overflowing, measure };
}
