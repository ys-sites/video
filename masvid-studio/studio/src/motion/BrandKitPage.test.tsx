// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { BrandArtworkImage } from "./BrandArtworkImage";
import { BrandKitPage } from "./BrandKitPage";
import type { BrandKit } from "../../../shared/brand-kit";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const kit: BrandKit = {
  id: "11111111-1111-1111-1111-111111111111",
  kind: "brand-kit",
  name: "Sample Brand",
  url: "https://brand.example/",
  state: "ready",
  progress: 100,
  createdAt: "2026-11-15",
  updatedAt: "2026-11-15",
  preview: false,
  packagePath: "/local/brand/package",
  sample: {
    name: "Sample Brand",
    title: "",
    colors: [],
    typography: [],
    components: [],
    gradients: [],
    spacing: [],
    style: {
      background: "#ffffff",
      foreground: "#111111",
      primary: "#12604a",
      onPrimary: "#ffffff",
      surface: "#eeeeee",
      headingFont: "Arial",
      bodyFont: "Arial",
      radius: "12px",
      gradient: "none",
    },
  },
};
let root: Root,
  container: HTMLDivElement,
  records: BrandKit[],
  requests: ReturnType<typeof vi.fn>,
  copy: ReturnType<typeof vi.fn>;
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) =>
      node.getAttribute("aria-label") === label ||
      node.textContent?.trim() === label,
  )!;
const page = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Brand Kit"]')!;
const detail = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Brand details"]')!;
const click = async (label: string) => {
  expect(button(label), label).toBeTruthy();
  await act(async () => button(label).click());
};
const Harness = ({ selected = "mine" }: { selected?: string | null }) => {
  const [id, setId] = useState(selected);
  return (
    <I18nProvider initialLocale="en">
      <BrandKitPage selectedId={id} onSelect={setId} />
    </I18nProvider>
  );
};
beforeEach(() => {
  records = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  copy = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  requests = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/brand-kits")) {
      records = [{ ...kit, state: "scanning", progress: 10 }];
      return Response.json({ kit: records[0] });
    }
    if (url.endsWith("/cancel")) {
      records = [{ ...kit, state: "cancelled" }];
      return Response.json({ kit: records[0] });
    }
    if (url.endsWith("/retry")) {
      records = [{ ...kit, state: "rendering" }];
      return Response.json({ kit: records[0] });
    }
    return Response.json({ kits: records });
  });
  vi.stubGlobal("fetch", requests);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("creates a background extraction and allows cancellation without a layout notice", async () => {
  await act(async () => root.render(<Harness />));
  const input = page().querySelector<HTMLInputElement>(
    'input[aria-label="Website address"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "brand.example");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    page()
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(requests).toHaveBeenCalledWith(
    "/motion-api/brand-kits",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"url":"brand.example"'),
    }),
  );
  const createRequest = requests.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(createRequest?.[1]?.body)).requestId).toMatch(/^[a-f\d-]{36}$/);
  expect(detail().querySelector('[role="status"]')?.textContent).toContain(
    "Reading your website",
  );
  expect(page().querySelector("main")?.textContent).not.toContain(
    "Brand extraction started",
  );
  await click("Cancel extraction");
  expect(detail().textContent).toContain("Cancelled");
  expect(button("Retry extraction")).toBeTruthy();
});
it("copies a style-only local package instruction and recovers an unavailable preview", async () => {
  records = [structuredClone(kit)];
  await act(async () => root.render(<Harness selected={kit.id} />));
  await click("Copy for Agent");
  expect(copy.mock.calls[0][0]).toContain("/local/brand/package");
  expect(copy.mock.calls[0][0]).toContain("STYLE-ONLY");
  expect(copy.mock.calls[0][0]).toMatch(/Do not copy.*timing/);
  expect(page().querySelector("main")?.textContent).not.toContain(
    "Style-only instruction copied",
  );
  await click("Retry preview");
  expect(detail().textContent).toContain("Rendering brand preview");
});
it("replaces failed loading with recovery and retains explicit Brand Kit card semantics", async () => {
  requests.mockRejectedValueOnce(new Error("offline"));
  await act(async () => root.render(<Harness />));
  expect(page().textContent).toContain("Could not load Brand Kits");
  records = [structuredClone(kit)];
  await click("Retry");
  expect(button("Preview Brand Kit Sample Brand")).toBeTruthy();
  expect(button("Preview Brand Kit Sample Brand").textContent).toContain("Brand Kit");
  await click("Preview Brand Kit Sample Brand");
  expect(button("Copy for Agent")).toBeTruthy();
});

const catalogEntries = [
  { id: 'azure', name: 'Azure', category: 'Developer Tools', appearance: 'Dark', colors: ['Blue'] },
  { id: 'amber', name: 'Amber', category: 'Developer Tools', appearance: 'Light', colors: ['Orange'] },
  { id: 'moss', name: 'Moss', category: 'Creative & Artistic', appearance: 'Dark', colors: ['Green'] },
].map(entry => ({ ...entry, description: 'An expressive design system', tags: ['brand-kit'], sample: kit.sample, files: [], sourceUrl: 'https://github.com/example/' + entry.id }));
const galleryCards = () => [...page().querySelectorAll('[data-template-id]')].map(node => node.getAttribute('data-template-id'));
function serveCatalog() {
  requests.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/catalog')) return Response.json({ schemaVersion: 1, entries: catalogEntries });
    if (url.endsWith('/import') && init?.method === 'POST') {
      records = [{ ...kit, catalogId: 'azure', preview: false }];
      return Response.json({ kit: records[0] });
    }
    return Response.json({ kits: records });
  });
}
it.each([null, 'official'])('opens the official catalogue for %s and lets the user switch to their kits', async selected => {
  serveCatalog();
  records = [kit];
  await act(async () => root.render(<Harness selected={selected} />));
  const activeTab = () => page().querySelector('nav [aria-current="page"]')?.textContent;
  expect(activeTab()).toBe('Official collection');
  expect(page().querySelector('main')?.getAttribute('aria-hidden')).toBeNull();
  expect(galleryCards()).toEqual(['azure', 'amber', 'moss']);
  await click('My brand kits');
  expect(activeTab()).toBe('My brand kits');
  expect(galleryCards()).toEqual([kit.id]);
  await click('Preview Brand Kit Sample Brand');
  await click('Close Brand Kit preview');
  expect(activeTab()).toBe('My brand kits');
  expect(galleryCards()).toEqual([kit.id]);
  await click('Official collection');
  expect(activeTab()).toBe('Official collection');
  expect(galleryCards()).toEqual(['azure', 'amber', 'moss']);
});
it('browses the official collection with shared draft filters, search, sorting and removable choices', async () => {
  serveCatalog();
  await act(async () => root.render(<Harness selected="official" />));
  expect(galleryCards()).toEqual(['azure', 'amber', 'moss']);
  await click('Filters');
  const choice = document.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="Developer Tools"]')!;
  await act(async () => choice.click());
  expect(galleryCards()).toHaveLength(3);
  const appearance = document.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Appearance"]')!;
  await act(async () => appearance.click());
  await click('Dark');
  expect(document.querySelector('.om-gallery-filter-footer')?.textContent).toContain('1 brand kits');
  await click('Apply filters');
  expect(galleryCards()).toEqual(['azure']);
  await click('Remove filter Dark');
  expect(galleryCards()).toEqual(['azure', 'amber']);
  await click('Sort');
  const name = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(node => node.textContent?.includes('Name A–Z'))!;
  await act(async () => name.click());
  expect(galleryCards()).toEqual(['amber', 'azure']);
  const input = page().querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Azure expressive');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(galleryCards()).toEqual(['azure']);
  await click('Clear filters');
  expect(galleryCards()).toHaveLength(3);
});
it('imports a catalogue style into the local detail and hands original design references to the Agent', async () => {
  serveCatalog();
  await act(async () => root.render(<Harness selected="official" />));
  await click('Preview Brand Kit Azure');
  expect(requests).toHaveBeenCalledWith('/motion-api/brand-kits/catalog/azure/import', expect.objectContaining({ method: 'POST' }));
  expect(button('Copy for Agent')).toBeTruthy();
  await click('Rules and sources');
  expect(detail().textContent).toContain('View original design system');
  expect(detail().textContent).not.toContain('View captured website');
  await click('Copy for Agent');
  expect(copy.mock.calls[0][0]).toContain('source/tokens.css');
  expect(copy.mock.calls[0][0]).toContain('STYLE-ONLY');
});
it('navigates in catalogue order when the first opened entry was saved in a previous session', async () => {
  serveCatalog();
  records = [
    { ...kit, catalogId: 'azure', name: 'Azure' },
    { ...kit, id: '22222222-2222-2222-2222-222222222222', catalogId: 'amber', name: 'Amber' },
  ];
  await act(async () => root.render(<Harness selected="official" />));
  await click('Preview Brand Kit Azure');
  expect(detail().querySelector('h1')?.textContent).toBe('Azure');
  expect(detail().querySelector('.om-media-detail-nav .om-result-count')?.textContent).toBe('1 / 3');
  await click('Next Brand Kit');
  expect(detail().querySelector('h1')?.textContent).toBe('Amber');
  expect(detail().querySelector('.om-media-detail-nav .om-result-count')?.textContent).toBe('2 / 3');
  await click('Previous Brand Kit');
  expect(detail().querySelector('h1')?.textContent).toBe('Azure');
  expect(requests.mock.calls.some(([, request]) => request?.method === 'POST')).toBe(false);
});
it('recovers catalogue loading separately from the personal library', async () => {
  requests.mockImplementation(async (url: string) => {
    if (url.endsWith('/catalog')) throw new Error('Unavailable');
    return Response.json({ kits: [] });
  });
  await act(async () => root.render(<Harness selected="official" />));
  expect(page().textContent).toContain('Could not load the official collection');
  expect(page().querySelector('[aria-label="Loading Brand Kits"]')).toBeNull();
  serveCatalog();
  await click('Retry');
  expect(galleryCards()).toHaveLength(3);
});

it('saves brand rules through context, keeps source sections accessible and reports success with a Toast', async () => {
  records = [structuredClone(kit)];
  requests.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/context') && init?.method === 'PUT') {
      const update = JSON.parse(String(init.body));
      records = [{ ...records[0], context: { files: [], rules: update.rules } }];
      return Response.json({ kit: records[0] });
    }
    return Response.json({ kits: records });
  });
  await act(async () => root.render(<Harness selected={kit.id} />));
  await click('Write a rule');
  const textarea = detail().querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep the wordmark intact.');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => textarea.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(requests).toHaveBeenCalledWith(`/motion-api/brand-kits/${kit.id}/context`, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ rules: ['Keep the wordmark intact.'], expectedUpdatedAt: kit.updatedAt }) }));
  expect(detail().textContent).toContain('Keep the wordmark intact.');
  expect(document.querySelector('.studio-toast-viewport')?.textContent || document.body.textContent).toContain('Brand context saved');
  const contextTab = detail().querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
  await act(async () => contextTab.dispatchEvent(new KeyboardEvent('keydown', { key:'End', bubbles:true })));
  expect(detail().querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Rules and sources');
  expect(detail().querySelector('[role="tabpanel"]')?.textContent).toContain('Keep the wordmark intact.');
});

it('uses each saved revision when attaching several files from one folder selection', async () => {
  records = [structuredClone(kit)];
  const revisions: string[] = [];
  requests.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/context') && init?.method === 'PUT') {
      const { expectedUpdatedAt, file } = JSON.parse(String(init.body));
      const old = records[0];
      if (expectedUpdatedAt !== old.updatedAt) return Response.json({ error: 'BRAND_KIT_CHANGED' }, { status: 409 });
      revisions.push(expectedUpdatedAt);
      const saved = { id: crypto.randomUUID(), name: file.name, path: 'context/file.txt', size: 12, sha256: 'fixture' };
      records = [{ ...old, updatedAt: `2026-11-15T00:00:0${revisions.length}.000Z`, context: { rules: [], files: [...(old.context?.files || []), saved] } }];
      return Response.json({ kit: records[0] });
    }
    return Response.json({ kits: records });
  });
  await act(async () => root.render(<Harness selected={kit.id} />));
  const input = detail().querySelector<HTMLInputElement>('input[webkitdirectory]')!;
  const files = ['logo.txt', 'color.txt'].map(name =>
    Object.defineProperty(new File(['brand detail'], name), 'webkitRelativePath', { value: `Guide/${name}` }));
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(revisions).toHaveLength(2));
  });
  expect(revisions).toEqual([kit.updatedAt, '2026-11-15T00:00:01.000Z']);
  expect(detail().textContent).toContain('Guide/logo.txt');
  expect(detail().textContent).toContain('Guide/color.txt');
});

it('keeps measured styles accessible while rendering and replaces progress with the completed package without reload', async () => {
  vi.useFakeTimers();
  records = [{ ...kit, state: 'rendering', progress: 80 }];
  await act(async () => root.render(<Harness selected={kit.id} />));
  expect(button('Copy for Agent').disabled).toBe(true);
  await click('Colors');
  expect(detail().querySelector('[role="tabpanel"]')?.textContent).toContain('#12604a');
  records = [{ ...kit }];
  const requestsBeforePoll = requests.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(1800));
  expect(button('Copy for Agent').disabled).toBe(false);
  expect(detail().querySelector('[role="progressbar"]')).toBeNull();
  expect(detail().querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Colors');
  expect(requests.mock.calls.slice(requestsBeforePoll)).toContainEqual([
    '/motion-api/brand-kits', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
  ]);
});

it('bounds a stalled status request, preserves the detail and recovers with a fresh read', async () => {
  vi.useFakeTimers();
  records = [{ ...kit, state: 'rendering', progress: 80 }];
  await act(async () => root.render(<Harness selected={kit.id} />));
  requests.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  }));
  await act(async () => vi.advanceTimersByTimeAsync(11_800));
  expect(detail().textContent).toContain('Could not refresh Brand Kit status');
  expect(detail().querySelector('[role="tablist"]')).toBeTruthy();
  expect(button('Close Brand Kit preview').disabled).toBe(false);
  records = [{ ...kit }];
  await click('Retry');
  expect(button('Copy for Agent').disabled).toBe(false);
  expect(detail().textContent).not.toContain('Could not refresh Brand Kit status');
});

it('ignores an outdated polling response after cancellation', async () => {
  vi.useFakeTimers();
  records = [{ ...kit, state: 'rendering', progress: 80 }];
  await act(async () => root.render(<Harness selected={kit.id} />));
  let complete!: (value: Response) => void;
  requests.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await act(async () => vi.advanceTimersByTimeAsync(1800));
  await click('Cancel extraction');
  expect(detail().textContent).toContain('Cancelled');
  await act(async () => complete(Response.json({ kits: [{ ...kit, state: 'rendering', progress: 80 }] })));
  expect(detail().textContent).toContain('Cancelled');
  expect(detail().querySelector('[role="progressbar"]')).toBeNull();
});

it('recovers a stalled video locally while keeping package actions available', async () => {
  vi.useFakeTimers();
  records = [{ ...kit, preview: true }];
  await act(async () => root.render(<Harness selected={kit.id} />));
  expect(detail().querySelector('video')).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(detail().querySelector('video')).toBeNull();
  expect(button('Copy for Agent').disabled).toBe(false);
  await click('Retry');
  expect(detail().querySelector('video')).toBeTruthy();
  expect(requests.mock.calls.some(([url]) => url.endsWith('/retry'))).toBe(false);
});

it('navigates between kits and closes the detail without changing their saved state', async () => {
  records = [{ ...kit }, { ...kit, id: '22222222-2222-2222-2222-222222222222', name: 'Second Brand' }];
  await act(async () => root.render(<Harness selected={kit.id} />));
  await click('Next Brand Kit');
  expect(detail().querySelector('h1')?.textContent).toBe('Second Brand');
  await click('Previous Brand Kit');
  expect(detail().querySelector('h1')?.textContent).toBe('Sample Brand');
  await act(async () => button('Close Brand Kit preview').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(button('Preview Brand Kit Sample Brand')).toBeTruthy();
});


it('keeps nested actions and editors inside the full-window detail dismissal boundary', async () => {
  records = [structuredClone(kit)];
  await act(async () => root.render(<Harness selected={kit.id} />));
  expect(detail()).toBeTruthy();
  expect(container.contains(detail())).toBe(false);
  await click('Brand Kit actions');
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu).toBeTruthy();
  await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(detail()).toBeTruthy();
  await click('Brand Kit actions');
  const edit = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === 'Edit brand styles')!;
  await act(async () => edit.click());
  const editor = document.querySelector<HTMLInputElement>('.om-brand-edit input')!;
  expect(editor.value).toBe('Sample Brand');
  expect(document.querySelector('.om-settings-backdrop')).toBeTruthy();
  await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('.om-brand-edit')).toBeNull();
  expect(document.querySelector('.om-settings-backdrop')).toBeNull();
  expect(detail()).toBeTruthy();
  await click('Close Brand Kit preview');
  expect(detail()).toBeNull();
  expect(button('Preview Brand Kit Sample Brand')).toBeTruthy();
});


it('limits surprise to matching official kits and retains discovery state after closing detail', async () => {
  serveCatalog();
  await act(async () => root.render(<Harness selected="official" />));
  const input = page().querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Azure');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Surprise me');
  expect(requests).toHaveBeenCalledWith('/motion-api/brand-kits/catalog/azure/import', expect.objectContaining({ method: 'POST' }));
  expect(detail().querySelector('.om-result-count')?.textContent).toBe('1 / 1');
  await click('Close Brand Kit preview');
  expect(page().querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('Azure');
  expect(galleryCards()).toEqual(['azure']);
  expect(page().querySelector('a[href="https://github.com/nexu-io/openmotion/blob/main/CONTRIBUTING.md"]')?.textContent).toContain('Submit Brand Kit');
});

it('opens extraction in the detail layout and returns to its source collection', async () => {
  serveCatalog();
  await act(async () => root.render(<Harness selected="official" />));
  await click('New Brand Kit');
  expect(page().querySelector('input[aria-label="Website address"]')).toBeTruthy();
  await click('All brand kits');
  expect(galleryCards()).toHaveLength(3);
});

it('shows loading skeletons before website covers load, keeps fixed geometry and falls back to the poster on image failure', async () => {
  records = [{ ...kit, poster: true, preview: true }];
  let intersect!: IntersectionObserverCallback;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  await act(async () => root.render(<Harness />));
  const card = page().querySelector<HTMLElement>('[data-template-id]')!;
  await act(async () => intersect([{ target: card, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], {} as IntersectionObserver));
  const cover = card.querySelector<HTMLImageElement>('.om-gallery-poster-cover')!;
  const initialAspect = card.querySelector('button')?.style.aspectRatio;
  expect(cover.getAttribute('data-artwork-src')).toContain(`/brand-kits/${kit.id}/cover`);
  expect(card.querySelector('.om-gallery-poster-skeleton')).toBeTruthy();
  expect(card.querySelectorAll('.om-gallery-poster img')).toHaveLength(1);
  expect(card.querySelector('.om-gallery-avatar-skeleton')).toBeTruthy();
  expect(card.querySelector('.om-gallery-avatar')?.textContent).toBe('');
  expect(card.querySelector('video[src]')).toBeNull();
  Object.defineProperty(cover, 'naturalWidth', { value: 600 });
  Object.defineProperty(cover, 'naturalHeight', { value: 600 });
  await act(async () => cover.dispatchEvent(new Event('load')));
  expect(cover.style.opacity).toBe('1');
  expect(card.querySelector('.om-gallery-poster-skeleton')).toBeNull();
  expect(card.querySelector('button')?.style.aspectRatio).toBe(initialAspect);
  const avatarImg = card.querySelector<HTMLImageElement>('.om-gallery-avatar img')!;
  await act(async () => avatarImg.dispatchEvent(new Event('load')));
  expect(card.querySelector('.om-gallery-avatar-skeleton')).toBeNull();
  await act(async () => card.querySelector('button')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(card.querySelector('video')?.getAttribute('src')).toContain('/files/preview.mp4');
  await act(async () => card.querySelector('button')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
  expect(card.querySelector('video[src]')).toBeNull();
  await act(async () => cover.dispatchEvent(new Event('error')));
  expect(card.querySelector('.om-gallery-poster-cover')).toBeNull();
  expect(card.querySelector('.om-gallery-poster img')?.getAttribute('src')).toContain('/files/poster.png');
});

it('requests both favicon and cover artwork for every official catalogue card, including source-only entries', async () => {
  serveCatalog();
  await act(async () => root.render(<Harness selected="official" />));
  const cards = [...page().querySelectorAll<HTMLElement>('[data-template-id]')];
  expect(cards).toHaveLength(3);
  for (const card of cards) {
    const id = card.getAttribute('data-template-id')!;
    expect(card.querySelector('.om-gallery-poster-cover')?.getAttribute('data-artwork-src')).toContain(`/brand-kits/catalog/${id}/cover`);
    expect(card.querySelector('.om-gallery-avatar img')?.getAttribute('data-artwork-src')).toContain(`/brand-kits/catalog/${id}/favicon`);
  }
});

it('starts artwork requests immediately and drains queued slots when IntersectionObserver is unavailable', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  await act(async () => root.render(<>
    {Array.from({ length: 7 }, (_, i) => (
      <BrandArtworkImage key={i} channel="cover" src={`/motion-api/brand-kits/catalog/brand-${i}/cover`} alt="" />
    ))}
  </>));
  const images = [...container.querySelectorAll<HTMLImageElement>('img')];
  expect(images).toHaveLength(7);
  for (let i = 0; i < 6; i++) expect(images[i].getAttribute('src')).toBe(`/motion-api/brand-kits/catalog/brand-${i}/cover`);
  expect(images[6].getAttribute('src')).toBeNull();
  await act(async () => images[0].dispatchEvent(new Event('load')));
  expect(images[6].getAttribute('src')).toBe('/motion-api/brand-kits/catalog/brand-6/cover');
  await act(async () => { for (let i = 1; i < 7; i++) images[i].dispatchEvent(new Event('load')); });
});
