import { useEffect, useState } from "react";

/** Keep metadata work out of long off-screen asset lists. */
export function useNearViewport(element: Element | null) {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "100px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return visible;
}
