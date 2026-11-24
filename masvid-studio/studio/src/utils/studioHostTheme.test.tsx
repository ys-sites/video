// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindEmbeddedStudioTheme, shownStudioTheme, setStudioTheme, savedStudioThemePreference } from "./studioTheme";
import { ThemeToggle } from "../components/ThemeToggle";
import { cleanupMounted, mountHost } from "../components/ui/mountHost.testHelpers";

const KEY = "hf-studio-ui-preferences";
const boot = readFileSync(path.join(__dirname, "../../index.html"), "utf8")
  .match(/<script>([\s\S]*?)<\/script>/)![1]!;
let unbind = () => {};

afterEach(() => {
  unbind();
  cleanupMounted();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
});

function hostScheme(initial: boolean) {
  const preference = new EventTarget() as MediaQueryList;
  let dark = initial;
  Object.defineProperty(preference, "matches", { get: () => dark });
  vi.spyOn(window, "matchMedia").mockReturnValue(preference);
  return (next: boolean) => {
    dark = next;
    preference.dispatchEvent(new Event("change"));
  };
}

describe("embedded Studio theme before first paint", () => {
  it.each([
    { dark: true, saved: "light", expected: "dark" },
    { dark: false, saved: "dark", expected: "light" },
  ])("follows host $expected despite saved $saved", ({ dark, saved, expected }) => {
    history.replaceState(null, "", "/?embed=1");
    const preferences = JSON.stringify({ theme: saved, audioVolume: 0.4 });
    localStorage.setItem(KEY, preferences);
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: dark } as MediaQueryList);
    new Function(boot)();
    expect(shownStudioTheme()).toBe(expected);
    expect(localStorage.getItem(KEY)).toBe(preferences);
  });

  it.each([
    { dark: true, saved: "light", expected: "light" },
    { dark: false, saved: "dark", expected: "dark" },
  ])("keeps the embedded choice $saved over host $dark", ({ dark, saved, expected }) => {
    history.replaceState(null, "", "/?embed=1");
    localStorage.setItem(KEY, JSON.stringify({ theme: "system", embeddedTheme: saved }));
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: dark } as MediaQueryList);
    new Function(boot)();
    expect(shownStudioTheme()).toBe(expected);
    expect(document.documentElement.dataset.themePreference).toBe(saved);
  });

  it("defaults light without a media-query API, even when storage is unavailable", () => {
    history.replaceState(null, "", "/?embed=1");
    vi.stubGlobal("matchMedia", undefined);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    new Function(boot)();
    expect(shownStudioTheme()).toBe("light");
  });
});

describe("live embedded host theme", () => {
  it("switches both ways without changing saved preferences and stops when disposed", () => {
    history.replaceState(null, "", "/?embed=1");
    const preferences = JSON.stringify({ theme: "light", audioVolume: 0.4 });
    localStorage.setItem(KEY, preferences);
    const change = hostScheme(true);
    unbind = bindEmbeddedStudioTheme();
    expect(shownStudioTheme()).toBe("dark");
    change(false);
    expect(shownStudioTheme()).toBe("light");
    change(true);
    expect(shownStudioTheme()).toBe("dark");
    expect(localStorage.getItem(KEY)).toBe(preferences);
    unbind();
    change(false);
    expect(shownStudioTheme()).toBe("dark");
  });

  it("leaves standalone Studio's theme and manual toggle alone", () => {
    history.replaceState(null, "", "/?embed=0");
    document.documentElement.dataset.theme = "paper";
    const change = hostScheme(true);
    unbind = bindEmbeddedStudioTheme();
    expect(shownStudioTheme()).toBe("light");
    change(true);
    expect(shownStudioTheme()).toBe("light");
    expect(mountHost(<ThemeToggle />).querySelector("button")).not.toBeNull();
  });

  it("hides the manual override in embedded Studio", () => {
    history.replaceState(null, "", "/?embed=1");
    expect(mountHost(<ThemeToggle />).querySelector("button")).toBeNull();
  });

  it('follows live system changes only in System mode and persists that preference across startup', () => {
    const change = hostScheme(false);
    unbind = bindEmbeddedStudioTheme();
    setStudioTheme('system');
    expect(savedStudioThemePreference()).toBe('system');
    expect(shownStudioTheme()).toBe('light');
    change(true);
    expect(shownStudioTheme()).toBe('dark');
    new Function(boot)();
    expect(shownStudioTheme()).toBe('dark');
    expect(document.documentElement.dataset.themePreference).toBe('system');
    setStudioTheme('light');
    change(true);
    expect(shownStudioTheme()).toBe('light');
    expect(savedStudioThemePreference()).toBe('light');
  });

  it('applies preference changes from another tab', () => {
    hostScheme(true); unbind = bindEmbeddedStudioTheme();
    localStorage.setItem(KEY, JSON.stringify({ theme: 'system' }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(shownStudioTheme()).toBe('dark');
  });

  it('lets embedded users override the host and keeps that choice apart from standalone', () => {
    history.replaceState(null, '', '/?embed=1');
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark' }));
    const change = hostScheme(true); unbind = bindEmbeddedStudioTheme();
    expect(savedStudioThemePreference()).toBe('system');
    expect(shownStudioTheme()).toBe('dark');
    setStudioTheme('light');
    expect(shownStudioTheme()).toBe('light');
    change(true);
    expect(shownStudioTheme()).toBe('light');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ theme: 'dark', embeddedTheme: 'light' });
    setStudioTheme('system');
    change(false);
    expect(shownStudioTheme()).toBe('light');
    change(true);
    expect(shownStudioTheme()).toBe('dark');
    history.replaceState(null, '', '/');
    expect(savedStudioThemePreference()).toBe('dark');
  });
});
