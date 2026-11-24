import { useEffect, useState } from "react";

// DSH's public presenter attribute follows light, dark and system preferences.
export function useHostTheme(): "light" | "dark" {
  const read = () =>
    document.body.hasAttribute("data-ds-dark-theme")
      ? ("dark" as const)
      : ("light" as const);
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-ds-dark-theme"],
    });
    setTheme(read());
    return () => observer.disconnect();
  }, []);
  return theme;
}
