// @vitest-environment happy-dom

/**
 * Tooltip a11y contract Base UI must not lose: focus opens it, Escape
 * dismisses it (WCAG 1.4.13), aria-describedby ties trigger to bubble (4.1.2).
 */
import React, { act } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanupMounted, mountHost } from "./mountHost.testHelpers";
import { Tooltip } from "./Tooltip";

afterEach(cleanupMounted);

function mount(): HTMLElement {
  const host = mountHost(
    <Tooltip label="Selection tool (V)" delay={0}>
      <button type="button" data-testid="trigger">
        V
      </button>
    </Tooltip>,
  );
  const trigger = host.querySelector<HTMLElement>('[data-testid="trigger"]');
  if (!trigger) throw new Error("trigger not rendered");
  return trigger;
}

/** Base UI opens and closes across a task, not synchronously. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Browsers send hover to the wrapper, never to a disabled control inside it. */
function hover(trigger: HTMLElement): void {
  const box = trigger.parentElement ?? trigger;
  act(() => {
    box.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false, composed: true }));
    box.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, composed: true }));
    box.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, composed: true }));
  });
}

function bubble(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

it("opens on focus and describes its trigger", async () => {
  const trigger = mount();

  expect(bubble()).toBeNull();
  act(() => trigger.focus());
  await settle();

  const tip = bubble();
  expect(tip?.textContent).toBe("Selection tool (V)");
  expect(trigger.getAttribute("aria-describedby")).toBe(tip?.id);
});

it("opens on pointer hover", async () => {
  const trigger = mount();

  hover(trigger);
  await settle();

  expect(bubble()?.textContent).toBe("Selection tool (V)");
});

it("keeps a tooltip inside its nearest native dialog and dismisses it independently", async () => {
  const host = mountHost(
    <dialog open aria-label="Library">
      <dialog open aria-label="Template detail">
        <Tooltip label="Recreate and submit" delay={0} withinDialog>
          <button type="button">Submit</button>
        </Tooltip>
      </dialog>
    </dialog>,
  );
  const detail = host.querySelector<HTMLDialogElement>('dialog[aria-label="Template detail"]')!;
  const trigger = detail.querySelector<HTMLButtonElement>("button")!;
  act(() => trigger.focus());
  await settle();

  expect(bubble()?.closest("dialog")).toBe(detail);
  expect(trigger.getAttribute("aria-describedby")).toBe(bubble()?.id);

  act(() => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();

  expect(bubble()).toBeNull();
  expect(detail.open).toBe(true);
});

it("supports an explicit body portal opt-out", async () => {
  const host = mountHost(<dialog open><Tooltip label="Existing control" delay={0} withinDialog={false}><button>Control</button></Tooltip></dialog>);
  act(() => host.querySelector("button")?.focus());
  await settle();

  expect(bubble()?.textContent).toBe("Existing control");
  expect(bubble()?.closest("dialog")).toBeNull();
});

it("keeps playback tooltips in the fullscreen top layer", async () => {
  const trigger = mount();
  const fullscreen = trigger.parentElement!.parentElement!;
  const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  try {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreen });
    act(() => trigger.focus());
    await settle();
    expect(bubble()?.textContent).toBe('Selection tool (V)');
    expect(fullscreen.contains(bubble())).toBe(true);
  } finally {
    if (original) Object.defineProperty(document, 'fullscreenElement', original);
    else Reflect.deleteProperty(document, 'fullscreenElement');
  }
});

it("closes on Escape and drops the description", async () => {
  const trigger = mount();
  act(() => trigger.focus());
  await settle();
  expect(bubble()).not.toBeNull();

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
  });
  await settle();

  expect(bubble()).toBeNull();
  expect(trigger.getAttribute("aria-describedby")).toBeNull();
});

it("opens on hover over a disabled child", async () => {
  const host = mountHost(
    <Tooltip label="Rendering" delay={0}>
      <button type="button" disabled data-testid="off">
        Export
      </button>
    </Tooltip>,
  );
  const off = host.querySelector<HTMLElement>('[data-testid="off"]');
  if (!off) throw new Error("trigger not rendered");

  hover(off);
  await settle();

  expect(bubble()?.textContent).toBe("Rendering");
});

it("keeps the feature name and full explanation accessible on a disabled control", async () => {
  const description = "First select clips in the timeline, then fit them into view.";
  const host = mountHost(
    <Tooltip label="Zoom to selected clips (Z)" description={description} delay={0}>
      <button type="button" disabled data-testid="explained">Zoom</button>
    </Tooltip>,
  );
  const trigger = host.querySelector<HTMLElement>('[data-testid="explained"]')!;
  hover(trigger);
  await settle();

  const tip = bubble();
  expect(tip?.textContent).toContain("Zoom to selected clips (Z)");
  expect(tip?.textContent).toContain(description);
  expect(trigger.getAttribute("aria-describedby")).toBe(tip?.id);
  expect(tip?.className).toContain("whitespace-normal");
  expect(tip?.querySelector('[style*="--tooltip-lines"]')).toBeNull();
});

it("wraps its child in a box-less span so a disabled child still gets hover", () => {
  const trigger = mount();

  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.parentElement?.tagName).toBe("SPAN");
  expect(trigger.parentElement?.className).toBe("contents");
  expect(trigger.parentElement?.parentElement?.parentElement).toBe(document.body);
});

it("keeps a label on one line unless it is given lines", async () => {
  const trigger = mount();
  act(() => trigger.focus());
  await settle();

  expect(bubble()?.className).toContain("whitespace-nowrap");
  expect(bubble()?.querySelector("span")).toBeNull();
});

it("wraps a long label at a reading width and cuts it at its lines", async () => {
  const label = "Make a 30 second launch promo for the spring release. ".repeat(6).trim();
  const host = mountHost(
    <Tooltip label={label} delay={0} lines={3}>
      <button type="button" data-testid="long">
        P
      </button>
    </Tooltip>,
  );
  act(() => host.querySelector<HTMLElement>('[data-testid="long"]')?.focus());
  await settle();

  const tip = bubble();
  expect(tip?.className).toContain("whitespace-normal");
  expect(tip?.className, "a long URL or path breaks too").toContain("break-words");
  expect(tip?.className).toContain("max-w-[min(300px,calc(100vw-16px))]");
  expect(tip?.className).not.toContain("whitespace-nowrap");
  const text = tip?.querySelector<HTMLElement>("span");
  expect(text?.textContent).toBe(label);
  expect(text?.className).toBe("line-clamp-(--tooltip-lines)");
  expect(text?.style.getPropertyValue("--tooltip-lines")).toBe("3");
});

it("reveals a complete wrapped label without a line clamp", async () => {
  const label = "A localized metadata label that needs more space. ".repeat(8).trim();
  const host = mountHost(<Tooltip label={label} wrap delay={0}><button>Metadata</button></Tooltip>);
  act(() => host.querySelector("button")?.focus());
  await settle();

  expect(bubble()?.textContent).toBe(label);
  expect(bubble()?.className).toContain("whitespace-normal");
  expect(bubble()?.querySelector('[style*="--tooltip-lines"]')).toBeNull();
});

it("portals into the nearest native modal without closing it on Escape", async () => {
  const host = mountHost(<dialog open><dialog open aria-label="Detail">
    <Tooltip label="Copy template" delay={0}><button>Copy</button></Tooltip>
  </dialog></dialog>);
  const trigger = host.querySelector("button")!;
  act(() => trigger.focus());
  await settle();
  expect(bubble()?.closest("dialog")).toBe(host.querySelector('[aria-label="Detail"]'));
  act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await settle();
  expect(bubble()).toBeNull();
  expect(host.querySelector<HTMLDialogElement>('[aria-label="Detail"]')?.open).toBe(true);
});

it("retains an existing description and reveals the complete wrapped label", async () => {
  const label = "A long project filename ".repeat(20);
  const host = mountHost(<><p id="help">Existing instructions</p>
    <Tooltip label={label} wrap><button aria-describedby="help">Filename</button></Tooltip></>);
  const trigger = host.querySelector("button")!;
  act(() => trigger.focus());
  await settle();
  expect(bubble()?.textContent).toBe(label);
  expect(bubble()?.querySelector('[style*="--tooltip-lines"]')).toBeNull();
  expect(trigger.getAttribute("aria-describedby")).toBe(`help ${bubble()?.id}`);
  act(() => trigger.blur());
  await settle();
  expect(trigger.getAttribute("aria-describedby")).toBe("help");
});

it("does not open an empty conditional hint", async () => {
  const host = mountHost(<Tooltip><button>No hint</button></Tooltip>);
  act(() => host.querySelector("button")?.focus());
  await settle();
  expect(bubble()).toBeNull();
});
