import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Dashboard } from "../src/client";
import { configureStudio } from "../src/studio";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function mount() {
  configureStudio("http://127.0.0.1:4173");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<Dashboard begin={vi.fn()} openConversation={vi.fn()} openProject={vi.fn()} />));
}

it("omits unknown duration badges and resolves local template covers", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("template-catalog")
    ? { items: [{ id: "unknown", title: "Unknown duration", posterUrl: "/api/templates/example/poster" }, { id: "known", title: "Known duration", duration: 20 }] }
    : { projects: [] })));
  await act(async () => mount());
  expect(document.querySelectorAll(".omd-duration")).toHaveLength(1);
  expect(document.querySelector(".omd-duration")?.textContent).toBe("20s");
  expect(document.body.textContent).not.toContain("NaN");
  expect(document.querySelector(".omd-template-art img")?.getAttribute("src")).toBe("http://127.0.0.1:4173/api/templates/example/poster");
});

it("shows projects while templates are pending and recovers templates independently", async () => {
  let finishTemplates!: (response: Response) => void;
  const templates = new Promise<Response>(resolve => { finishTemplates = resolve; });
  let failTemplates = true;
  const fetcher = vi.fn((url: string) => {
    if (url.includes("template-catalog")) return failTemplates ? templates : Promise.resolve(Response.json({ items: [{ id: "t", title: "Recovered template" }] }));
    return Promise.resolve(Response.json({ projects: [{ id: "p", title: "Saved project" }, { id: "trash", title: "Trashed project", trashedAt: 123 }] }));
  });
  vi.stubGlobal("fetch", fetcher);
  mount();
  expect(document.querySelectorAll("[aria-label='Projects'] .ui-skeleton").length).toBeGreaterThan(0);
  await act(async () => {});
  expect(document.body.textContent).toContain("Saved project");
  expect(document.body.textContent).not.toContain("Trashed project");
  expect(document.querySelector("[aria-label='Templates']")?.getAttribute("aria-busy")).toBe("true");
  expect(document.querySelectorAll("[aria-label='Templates'] .ui-skeleton").length).toBeGreaterThan(0);
  await act(async () => finishTemplates(new Response("unavailable", { status: 503 })));
  expect(document.body.textContent).toContain("Saved project");
  expect(document.querySelector("[aria-label='Templates'] [role=alert]")?.textContent).toContain("Could not load templates");
  failTemplates = false;
  await act(async () => (document.querySelector("[aria-label='Templates'] [role=alert] button") as HTMLButtonElement).click());
  expect(document.body.textContent).toContain("Recovered template");
  expect(fetcher.mock.calls.filter(([url]) => !url.includes("template-catalog"))).toHaveLength(1);
});

it("keeps templates usable when projects fail and retries only projects", async () => {
  let failProjects = true;
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("template-catalog")) return Response.json({ items: [{ id: "t", title: "Available template" }] });
    return failProjects ? new Response("unavailable", { status: 503 }) : Response.json({ projects: [{ id: "p", title: "Recovered project" }] });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => mount());
  expect(document.body.textContent).toContain("Available template");
  expect(document.querySelector("[aria-label='Projects'] [role=alert]")?.textContent).toContain("Could not load projects");
  failProjects = false;
  await act(async () => (document.querySelector("[aria-label='Projects'] [role=alert] button") as HTMLButtonElement).click());
  expect(document.body.textContent).toContain("Recovered project");
  expect(fetcher.mock.calls.filter(([url]) => url.includes("template-catalog"))).toHaveLength(1);
});
