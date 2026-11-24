// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import * as icons from "./RemixIcons";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("bundles a real vector for every exported Remix editor icon and its filled state", () => {
  const sprite = new DOMParser().parseFromString(readFileSync(path.resolve(import.meta.dirname, "../../../packages/design-system/icons.svg"), "utf8"), "image/svg+xml");
  const host = document.createElement("div");
  const root = createRoot(host);
  // Magnet is a deliberately custom stroked SVG rather than a Remix glyph.
  // Keep it in its own contract below instead of treating it as a sprite entry.
  const components = Object.entries(icons).filter(([name]) => !["RemixIcon", "Magnet", "MagnetStraight"].includes(name));
  try {
    for (const weight of ["regular", "fill"] as const) {
      act(() => root.render(<>{components.map(([name, Component]) => <Component key={name} weight={weight} />)}</>));
      expect(host.querySelectorAll('svg')).toHaveLength(components.length);
      expect(host.querySelector('use')).toBeNull();
      for (const svg of host.querySelectorAll('svg')) {
        const id = `ri-${svg.dataset.remixIcon}`;
        expect(svg.querySelector('path')?.getAttribute('d'), id).toBe(sprite.getElementById(id)?.querySelector('path')?.getAttribute('d'));
        expect(svg.getAttribute('fill')).toBe('currentColor');
      }
    }
  } finally { act(() => root.unmount()); }
});

it("keeps the custom snapping magnet as a stroked vector", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(<icons.Magnet size={20} />));
    const svg = host.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("fill")).toBe("none");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.querySelectorAll("path")).toHaveLength(2);
    expect(svg?.dataset.remixIcon).toBeUndefined();
  } finally { act(() => root.unmount()); }
});

it("preserves refs, accessible labels, sizing, and distinct visibility states", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const ref = createRef<SVGSVGElement>();
  try {
    act(() => root.render(<icons.Eye ref={ref} size={20} alt="Show layer" />));
    expect(ref.current?.getAttribute("width")).toBe("20");
    expect(ref.current?.getAttribute("aria-label")).toBe("Show layer");
    expect(ref.current?.getAttribute("data-remix-icon")).toContain("eye-line");
    act(() => root.render(<icons.EyeSlash ref={ref} />));
    expect(ref.current?.getAttribute("aria-hidden")).toBe("true");
    expect(ref.current?.getAttribute("data-remix-icon")).toContain("eye-off-line");
  } finally { act(() => root.unmount()); }
});

it("renders every Motion alias without an external SVG request, including dialog navigation", async () => {
  const { MotionIcon } = await import('../motion/icons');
  const source = readFileSync(path.resolve(import.meta.dirname, '../../../packages/design-system/icons.svg'), 'utf8');
  const sprite = new DOMParser().parseFromString(source, 'image/svg+xml');
  const names = Array.from(source.matchAll(/id="icon-([^"\s]+)"/g), match => match[1]);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    for (const name of names) {
      act(() => root.render(<MotionIcon name={name} size={20} />));
      const svg = host.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('fill')).toBe('currentColor');
      expect(svg.querySelector('use')).toBeNull();
      expect(svg.querySelector('g')?.innerHTML).toBe(sprite.getElementById(`icon-${name}`)?.innerHTML);
    }
  } finally { act(() => root.unmount()); }
});
