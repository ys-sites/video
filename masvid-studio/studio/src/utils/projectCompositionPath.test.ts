import { afterEach, describe, expect, it, vi } from "vitest";
import { projectCompositionIdentity, projectCompositionPath } from "./projectCompositionPath";

const origin = "http://localhost:4173";
const resolve = (source: string) => projectCompositionPath(source, "p", origin);

describe("projectCompositionPath", () => {
  it.each([
    ["./compositions/clip.html", "compositions/clip.html"],
    ["compositions/../clip.html", "clip.html"],
    ["/api/projects/p/preview/compositions/clip.html", "compositions/clip.html"],
    [`${origin}/api/projects/p/preview/comp/compositions/clip.html?t=1#label`, "compositions/clip.html"],
    [`${origin}/api/projects/p/preview/compositions/%E5%AD%97%20%23%25.html`, "compositions/字 #%.html"],
  ])("normalizes %s", (source, expected) => {
    expect(resolve(source)).toBe(expected);
    expect(resolve(expected)).toBe(expected);
  });

  it.each([
    `${origin}/api/projects/q/preview/clip.html`,
    `${origin}/api/projects/p-other/preview/clip.html`,
    "https://foreign.invalid/api/projects/p/preview/clip.html",
    "//foreign.invalid/api/projects/p/preview/clip.html",
    `${origin}/api/projects/p/preview/../clip.html`,
    `${origin}/api/projects/p/preview/%2e%2e%2fclip.html`,
    `${origin}/api/projects/p/preview/%5c..%5cclip.html`,
    `${origin}/api/projects/p/preview/%00.html`,
    `${origin}/api/projects/p/preview/%broken.html`,
    "../clip.html", "C:\\project\\clip.html", "./C:/clip.html", "folder/../C:/clip.html", "/etc/passwd", "", ".",
  ])("refuses non-project paths: %s", source => {
    expect(resolve(source)).toBeNull();
  });
});

describe("projectCompositionIdentity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes authored paths without a project route, retaining literal filename characters", () => {
    vi.stubGlobal("location", undefined);
    expect(projectCompositionIdentity("./compositions/clip #%.html")).toBe("compositions/clip #%.html");
    const url = `${origin}/api/projects/p/preview/clip.html`;
    expect(projectCompositionIdentity(url)).toBe(url);
  });

  it("uses the active encoded project route to identify native preview URLs", () => {
    vi.stubGlobal("location", { origin, hash: "#project/My%20Project?tab=design" });
    expect(projectCompositionIdentity(`${origin}/api/projects/My%20Project/preview/comp/clip.html`)).toBe("clip.html");
  });

  it.each([
    `${origin}/api/projects/q/preview/clip.html`,
    "https://foreign.invalid/api/projects/p/preview/clip.html",
    "../clip.html",
  ])("keeps an unrelated or invalid source distinct from a local row: %s", source => {
    vi.stubGlobal("location", { origin, hash: "#project/p" });
    expect(projectCompositionIdentity(source)).toBe(source);
  });
});
