import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TemplateRecommendationCard } from "../src/TemplateRecommendationCard";
import { configureStudio } from "../src/studio";
import type { RecommendationDetails } from "../src/templateRecommendationAction";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); document.body.removeAttribute("data-ds-dark-theme"); vi.restoreAllMocks(); });
const details: RecommendationDetails = {
  onboarding: true, language: "zh", libraryOpened: true,
  templates: ["one", "two", "three"].map(id => ({ id, title: id, description: "简介", previewUrl: "/" + id + ".mp4", posterUrl: "/" + id + ".jpg" })),
};
function mount(value: RecommendationDetails, actCard = vi.fn().mockResolvedValue({ status: "settled" })) {
  configureStudio("http://localhost:4173");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(<TemplateRecommendationCard proposal={{ details: value }} act={actCard} />));
  return actCard;
}
it("shows the shared Chinese onboarding with cover previews and separate template choices", async () => {
  const actCard = mount(details);
  expect(document.body.textContent).toContain("我是你的开源视频创作搭档");
  expect(document.body.textContent).toContain("先看看我挑的这 3 个");
  expect([...document.querySelectorAll("[data-template-id]")].map(el => el.getAttribute("data-template-id"))).toEqual(["one", "two", "three"]);
  expect(document.querySelectorAll(".omd-recommendation-cover video")).toHaveLength(3);
  expect(document.querySelectorAll("video[controls]")).toHaveLength(0);
  expect(document.querySelector("video")?.getAttribute("src")).toBe("http://localhost:4173/one.mp4");
  expect(document.querySelector("video")?.hasAttribute("autoplay")).toBe(false);
  await act(async () => (document.querySelectorAll<HTMLButtonElement>(".omd-recommendation-cover")[1]).click());
  expect(actCard).not.toHaveBeenCalled();
  expect(document.querySelector('dialog')?.open).toBe(true);
  expect(document.querySelector('dialog video')?.getAttribute('src')).toBe('http://localhost:4173/two.mp4');
  expect(document.querySelector('dialog button')?.getAttribute('aria-label')).toBe('关闭预览');
  await act(async () => (document.querySelector('dialog button') as HTMLButtonElement).click());
  expect(document.querySelector('dialog')?.open).toBe(false);
  expect(document.querySelector('dialog video')).toBeNull();
  expect(actCard).not.toHaveBeenCalled();
  await act(async () => (document.querySelectorAll<HTMLButtonElement>(".omd-recommendation-clone")[2]).click());
  expect(actCard).toHaveBeenLastCalledWith("use", { templateId: "three" });
});
it("does not claim a right-hand library opened when opening was not confirmed", () => {
  mount({ ...details, libraryOpened: false, language: "en" });
  expect(document.body.textContent).toContain("open-source video creation partner");
  expect(document.body.textContent).not.toContain("right");
});
it("keeps selection available after an action fails", async () => {
  mount(details, vi.fn().mockResolvedValue({ status: "refused" }));
  await act(async () => (document.querySelector('.omd-recommendation-clone') as HTMLButtonElement).click());
  expect(document.querySelector("[role=status]")?.textContent).toContain("未能填入");
  expect((document.querySelector("button") as HTMLButtonElement).disabled).toBe(false);
});

it("tracks the host theme without resetting cards or their template identities", async () => {
  mount(details);
  expect(document.querySelector(".omd-recommendation-card")?.getAttribute("data-theme")).toBe("light");
  await act(async () => { document.body.setAttribute("data-ds-dark-theme", ""); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(document.querySelector(".omd-recommendation-card")?.getAttribute("data-theme")).toBe("dark");
  expect(document.querySelectorAll("[data-template-id]")).toHaveLength(3);
});

it("opens the template library beside the current chat and waits for its load before claiming it opened", async () => {
  const { registerTemplateRecommendationBody } = await import('../src/client');
  let Body: React.ComponentType<any> | undefined;
  const openTab = vi.fn();
  registerTemplateRecommendationBody({
    effect: (run: () => unknown) => run(),
    locale: { register: vi.fn() },
    actionCards: { register: (registration: any) => { Body = registration.Body; return () => {}; } },
    sidebarRight: { openTab },
  });
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(React.createElement(Body!, { proposal: { details }, act: vi.fn() })));
  expect(openTab).toHaveBeenCalledExactlyOnceWith('openmotion-studio', { params: { page: 'templates' } });
  expect(document.body.textContent).not.toContain('右侧就是模板库');
  await act(async () => { window.dispatchEvent(new Event('openmotion:library-ready')); });
  expect(document.body.textContent).toContain('右侧就是模板库');
  expect(openTab).toHaveBeenCalledTimes(1);
  await act(async () => (document.querySelector('.omd-recommendation-cover') as HTMLButtonElement).click());
  expect(openTab).toHaveBeenCalledTimes(1);
  expect(document.querySelector('dialog')?.open).toBe(true);
});

it("does not reopen the library over a user's later editor when an old installation card mounts again", async () => {
  const { registerTemplateRecommendationBody } = await import('../src/client');
  let Body: React.ComponentType<any> | undefined;
  const openTab = vi.fn();
  localStorage.setItem('omd-onboarding:previous-call', 'requested');
  registerTemplateRecommendationBody({ effect: (run: () => unknown) => run(), locale: { register: vi.fn() },
    actionCards: { register: (registration: any) => { Body = registration.Body; return () => {}; } }, sidebarRight: { openTab } });
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(React.createElement(Body!, { proposal: { callId: 'previous-call', details }, act: vi.fn() })));
  expect(openTab).not.toHaveBeenCalled();
  localStorage.removeItem('omd-onboarding:previous-call');
});

it("restores the library after refresh when DSH does not persist tab navigation parameters", async () => {
  const { StudioWorkspace } = await import('../src/editing');
  const settings = (window as any).happyDOM?.settings;
  if (settings) settings.disableIframePageLoading = true;
  localStorage.setItem('omd-session-page:welcome-session', 'templates');
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<StudioWorkspace sessionId="welcome-session" useTabInfo={() => ({ tab: { visible: true, navigation: {} } })} />));
  const frame = document.querySelector('iframe');
  expect(frame?.title).toBe('OpenMotion Templates');
  expect(frame?.src).toContain('templates=1');
  expect(frame?.src).not.toContain('#project/');
  localStorage.removeItem('omd-session-page:welcome-session');
});
