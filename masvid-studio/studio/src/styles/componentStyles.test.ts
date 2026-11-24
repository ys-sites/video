/** Guards the split between Studio's app sheet and the component rules an embedder imports. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { loadStylesheet, STYLES_DIR } from "./styleSources";

/** Class names in a stylesheet's selectors, at any nesting depth (inside @layer or @media too). */
function selectorClasses(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@(?:import|source)[^;]*;/g, "");
  return [...source.matchAll(/([^{};]+)\{/g)]
    .map((match) => match[1].trim())
    .filter((prelude) => !prelude.startsWith("@"))
    .flatMap((selector) => classNames(selector));
}

/** Class names in a selector string. */
function classNames(selector: string): string[] {
  return [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
}

/** Every flat rule whose selector class list contains `className`, without its own comments. */
function rulesFor(css: string, className: string): { selector: string; body: string }[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }))
    .filter(({ selector }) => classNames(selector).includes(className));
}

/** The body of `@container motion-player (max-width: <width>px)`, so its fallbacks read together. */
function containerBlock(css: string, width: number): string {
  const start = css.indexOf(`@container motion-player (max-width: ${width}px)`);
  expect(start, `components.css: missing the ${width}px control-row breakpoint`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("studio component styles", () => {
  it("keeps class rules out of the app sheet, where an embedder never sees them", () => {
    const appSheet = readFileSync(path.join(STYLES_DIR, "studio.css"), "utf8");

    expect(selectorClasses(appSheet), "move these rules to components.css").toEqual([]);
    expect(
      selectorClasses(readFileSync(path.join(STYLES_DIR, "components.css"), "utf8")),
    ).toContain("timeline-clip__label");
  });

  it("gives an embedder the timeline rules from theme.css and components.css alone", async () => {
    const entry = '@import "tailwindcss";\n@import "./theme.css";\n@import "./components.css";';
    const css = (await compile(entry, { base: STYLES_DIR, loadStylesheet })).build([]);

    expect(css).toMatch(/^\s*\.timeline-clip__label \{/m);
    expect(css).not.toContain("#root");
  });

  it("keeps the control row's responsive tracks in the shared recipe", () => {
    const components = readFileSync(path.join(STYLES_DIR, "components.css"), "utf8");
    const preview = readFileSync(
      path.join(STYLES_DIR, "../components/nle/audioPreview.css"),
      "utf8",
    );
    const declaresTracks = ({ body }: { body: string }) => /\bgrid-template-columns\s*:/.test(body);

    // Container queries add no specificity, so a feature sheet that redeclares the tracks wins
    // against them at every width. The audio preview only adds the variant class instead.
    expect(rulesFor(preview, "motion-player-control-row").some(declaresTracks)).toBe(false);
    expect(rulesFor(components, "motion-player-control-row-lg").some(declaresTracks)).toBe(true);
    for (const width of [420, 300]) expect(rulesFor(containerBlock(components, width), "motion-player-control-row-lg").filter(declaresTracks)).toHaveLength(1);
    expect(containerBlock(components, 420)).toContain("var(--motion-space-40) auto");
  });
});
