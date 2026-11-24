import { randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { ensureRuntime } from "../hyperframes.ts";
import {
  isBrandKitBusy,
  validateBrandStyle,
  type BrandKit,
} from "../shared/brand-kit.ts";
import { brandRules, brandContextUpload, storeContextFile, copyBrandContext, type ContextUpdate } from "./brand-context.ts";
import { brandWebsite } from "./brand-network.ts";
import { extractBrand, type BrandCapture } from "./brand-extract.ts";
import { catalogEntry, catalogCapture, copyCatalogSource, readBrandCatalog } from './brand-catalog.ts';
import {
  packageBrandKit,
  renderBrandPreview,
  writeBrandProject,
} from "./brand-package.ts";

export type BrandKitDependencies = {
  extract: typeof extractBrand;
  render: typeof renderBrandPreview;
  runtime: (directory: string) => Promise<string>;
};
const defaults: BrandKitDependencies = {
  extract: extractBrand,
  render: renderBrandPreview,
  runtime: (directory) => ensureRuntime(directory, false),
};
function checkKitRevision(kit: BrandKit, expectedUpdatedAt?: unknown) {
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== kit.updatedAt)
    throw new Error('BRAND_KIT_CHANGED: Read the current Brand Kit before retrying.');
}
export class BrandKitLibrary {
  readonly root: string;
  private initialized?: Promise<void>;
  private work: Promise<void> = Promise.resolve();
  private mutation: Promise<unknown> = Promise.resolve();
  private controls = new Map<string, AbortController>();
  readonly dataDirectory: string;
  private dependencies: BrandKitDependencies;
  constructor(dataDirectory: string, dependencies = defaults) {
    this.dataDirectory = dataDirectory;
    this.dependencies = dependencies;
    this.root = path.join(dataDirectory, "brand-kits");
  }
  private async save(kit: BrandKit) {
    kit.updatedAt = new Date(Math.max(Date.now(), Date.parse(kit.updatedAt) + 1)).toISOString();
    const file = path.join(this.folder(kit.id), "record.json"),
      temporary = file + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(kit, null, 2), { mode: 0o600 });
    await rename(temporary, file);
  }
  private init() {
    return (this.initialized ??= (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      for (const id of await readdir(this.root)) {
        if (!/^[a-f0-9-]{36}$/.test(id)) continue;
        const kit = await this.read(id);
        if (isBrandKitBusy(kit)) {
          kit.state = "failed";
          kit.error = "Extraction was interrupted. Retry to continue.";
          await this.save(kit);
        }
      }
    })());
  }
  private lock<T>(action: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(action);
    this.mutation = next.catch(() => {});
    return next;
  }
  folder(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(id))
      throw new Error("Invalid Brand Kit ID");
    return path.join(this.root, id);
  }
  private async read(id: string): Promise<BrandKit> {
    const kit: BrandKit = JSON.parse(
      await readFile(path.join(this.folder(id), "record.json"), "utf8"),
    );
    if (kit.catalogId) kit.websiteUrl = (await catalogEntry(kit.catalogId).catch(() => undefined))?.websiteUrl ?? kit.websiteUrl;
    return kit;
  }
  async get(id: string) {
    await this.init();
    return this.read(id);
  }
  async list() {
    await this.init();
    const records = await Promise.all(
      (await readdir(this.root))
        .filter((id) => /^[a-f0-9-]{36}$/.test(id))
        .map((id) => this.read(id)),
    );
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(raw: unknown, requestId?: unknown) {
    const url = brandWebsite(raw);
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId)))
      throw new Error('INVALID_ARGUMENT: Supply a valid Brand Kit requestId.');
    await this.init();
    return this.lock(async () => {
      if (typeof requestId === 'string') {
        const previous = (await this.list()).find(kit => kit.requestId === requestId);
        if (previous) {
          if (previous.url !== url) throw new Error('REQUEST_ID_CONFLICT: This requestId belongs to another Brand Kit website.');
          return previous;
        }
      }
      if (this.controls.size >= 5)
        throw new Error(
          "Five Brand Kits are already queued. Wait for one to finish.",
        );
      const now = new Date().toISOString(),
        id = randomUUID();
      const kit: BrandKit = {
        id,
        kind: "brand-kit",
        name: new URL(url).hostname,
        url,
        createdAt: now,
        updatedAt: now,
        state: "queued",
        progress: 0,
        ...(typeof requestId === 'string' ? { requestId } : {}),
      };
      // List polling must only see complete records, including after a crash.
      const staging = path.join(this.root, `.${id}.create`);
      try {
        await mkdir(staging, { mode: 0o700 });
        await writeFile(path.join(staging, "record.json"), JSON.stringify(kit, null, 2), { mode: 0o600 });
        await rename(staging, this.folder(id));
        this.enqueue(kit);
        return kit;
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }
  private enqueue(kit: BrandKit, saved?: BrandCapture) {
    const controller = new AbortController();
    this.controls.set(kit.id, controller);
    this.work = this.work
      .then(async () => {
        if (controller.signal.aborted) {
          this.controls.delete(kit.id);
          return;
        }
        const directory = path.join(this.folder(kit.id), "package"),
          signal = controller.signal;
        const stage = (state: BrandKit["state"], progress: number) =>
          this.lock(async () => {
            signal.throwIfAborted();
            kit.state = state;
            kit.progress = progress;
            await this.save(kit);
          });
        try {
          await stage(saved ? "packaging" : "scanning", saved ? 65 : 10);
          const runtime = await this.dependencies.runtime(this.dataDirectory);
          signal.throwIfAborted();
          const captureSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
          await mkdir(directory, { recursive: true });
          const capture =
            saved ??
            (await this.dependencies.extract(
              kit.url,
              directory,
              captureSignal,
              () => stage("extracting", 45),
              runtime,
            ));
          signal.throwIfAborted();
          if (!saved) {
            capture.sample.style = validateBrandStyle({ ...capture.sample.style, ...kit.styleOverrides });
            if (kit.nameOverride) capture.sample.name = kit.nameOverride;
          }
          kit.warnings = capture.warnings;
          kit.sample = capture.sample;
          kit.name = capture.sample.name;
          kit.logo = capture.logo;
          await writeFile(
            path.join(this.folder(kit.id), "capture.json"),
            JSON.stringify(capture),
            { mode: 0o600 },
          );
          await stage("packaging", 65);
          signal.throwIfAborted();
          await writeBrandProject(directory, capture, runtime);
          kit.packagePath = directory;
          await stage("rendering", 80);
          try {
            await this.dependencies.render(directory, runtime, signal);
            kit.preview = true;
            delete kit.previewError;
          } catch (error) {
            signal.throwIfAborted();
            kit.preview = false;
            kit.previewError =
              error instanceof Error
                ? error.message.slice(0, 350)
                : "Video preview could not be rendered. Check the local browser and video runtime.";
            await rm(path.join(directory, "preview.mp4"), { force: true });
          }
          kit.poster = await access(path.join(directory, "poster.png")).then(
            () => true,
            () => false,
          );
          signal.throwIfAborted();
          await copyBrandContext(this.folder(kit.id), kit.context);
          await packageBrandKit(directory, kit, capture);
          await stage("ready", 100);
        } catch (error) {
          await this.lock(async () => {
            kit.state = signal.aborted ? "cancelled" : "failed";
            kit.error = signal.aborted
              ? undefined
              : error instanceof Error
                ? error.message.slice(0, 350)
                : "Brand extraction failed";
            await this.save(kit);
          });
        } finally {
          this.controls.delete(kit.id);
        }
      })
      .catch(() => {
        this.controls.delete(kit.id);
      });
  }
  async importCatalog(id: string) {
    const entry = await catalogEntry(id), catalog = await readBrandCatalog();
    await this.init();
    return this.lock(async () => {
      const existing = (await this.list()).find(kit => kit.catalogId === id && kit.catalogRevision === catalog.revision);
      if (existing) return existing;
      const now = new Date().toISOString();
      const kit: BrandKit = { id: randomUUID(), kind: 'brand-kit', name: entry.name, url: entry.sourceUrl, websiteUrl: entry.websiteUrl, createdAt: now, updatedAt: now, state: 'ready', progress: 100, catalogId: id, catalogRevision: catalog.revision, category: entry.category };
      // The official showcase already has playable HTML. Package it with the
      // verified sources and publish atomically without starting the video renderer.
      const staging = path.join(this.root, `.${kit.id}.import`);
      const directory = path.join(staging, 'package');
      try {
        await copyCatalogSource(entry, directory);
        const capture = catalogCapture(entry);
        kit.sample = capture.sample;
        kit.warnings = capture.warnings;
        kit.packagePath = path.join(this.folder(kit.id), 'package');
        await writeBrandProject(directory, capture);
        await packageBrandKit(directory, kit, capture);
        await writeFile(path.join(staging, 'capture.json'), JSON.stringify(capture), { mode: 0o600 });
        await writeFile(path.join(staging, 'record.json'), JSON.stringify(kit, null, 2), { mode: 0o600 });
        await rename(staging, this.folder(kit.id));
        return kit;
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }
  async retry(id: string, updates?: { name?: unknown; style?: unknown; rescan?: boolean }, expectedUpdatedAt?: unknown) {
    await this.init();
    return this.lock(async () => {
      const kit = await this.read(id);
      checkKitRevision(kit, expectedUpdatedAt);
      if (isBrandKitBusy(kit) || this.controls.has(id))
        throw new Error("This Brand Kit is still processing");
      if (this.controls.size >= 5)
        throw new Error("Five Brand Kits are already queued");
      let capture: BrandCapture | undefined;
      if (kit.sample && (!updates?.rescan || kit.catalogId) && (updates || kit.previewError || kit.catalogId)) {
        capture = JSON.parse(
          await readFile(path.join(this.folder(id), "capture.json"), "utf8"),
        );
        if (updates?.style) {
          const style = validateBrandStyle(updates.style);
          kit.styleOverrides = { ...kit.styleOverrides, ...Object.fromEntries(Object.entries(style).filter(([key, value]) => capture!.sample.style[key as keyof typeof style] !== value)) };
          capture!.sample.style = style;
        }
        if (updates?.name !== undefined) {
          if (
            typeof updates.name !== "string" ||
            !updates.name.trim() ||
            updates.name.length > 100
          )
            throw new Error("Enter a brand name of 1–100 characters");
          capture!.sample.name = updates.name.trim();
          kit.nameOverride = capture!.sample.name;
        }
      }
      if (!capture)
        await rm(path.join(this.folder(id), "package"), {
          recursive: true,
          force: true,
        });
      await rm(path.join(this.folder(id), "package", "preview.mp4"), {
        force: true,
      });
      await rm(path.join(this.folder(id), "package", "poster.png"), {
        force: true,
      });
      kit.state = "queued";
      kit.progress = 0;
      kit.preview = false;
      kit.poster = false;
      delete kit.error;
      await this.save(kit);
      this.enqueue(kit, capture);
      return kit;
    });
  }
  async updateContext(id: string, updates: ContextUpdate, expectedUpdatedAt?: unknown) {
    await this.init();
    return this.lock(async () => {
      const kit = await this.read(id);
      checkKitRevision(kit, expectedUpdatedAt);
      if (kit.state !== "ready" || this.controls.has(id)) throw new Error("This Brand Kit is still processing");
      const previous = structuredClone(kit);
      const context = kit.context ??= { rules: [], files: [] };
      if (updates.rules !== undefined) context.rules = brandRules(updates.rules);
      const upload = updates.file !== undefined ? brandContextUpload(updates.file, context) : undefined;
      const removed = context.files.find(file => file.id === updates.remove);
      if (updates.remove !== undefined && !removed) throw new Error("Unknown brand context file");
      if (removed) context.files = context.files.filter(file => file.id !== removed.id);
      const capture: BrandCapture = JSON.parse(await readFile(path.join(this.folder(id), "capture.json"), "utf8"));
      if (upload) { await storeContextFile(this.folder(id), upload.file, upload.data); context.files.push(upload.file); }
      try {
        kit.updatedAt = new Date().toISOString();
        await copyBrandContext(this.folder(id), context);
        await packageBrandKit(path.join(this.folder(id), "package"), kit, capture);
        await this.save(kit);
      } catch (error) {
        if (upload) await rm(path.join(this.folder(id), upload.file.path), { force: true });
        await copyBrandContext(this.folder(id), previous.context);
        await packageBrandKit(path.join(this.folder(id), "package"), previous, capture);
        throw error;
      }
      if (removed) await rm(path.join(this.folder(id), removed.path), { force: true });
      return kit;
    });
  }
  async cancel(id: string) {
    await this.init();
    return this.lock(async () => {
      const kit = await this.read(id);
      this.controls.get(id)?.abort();
      if (isBrandKitBusy(kit)) {
        kit.state = "cancelled";
        await this.save(kit);
      }
      return kit;
    });
  }
  async remove(id: string, expectedUpdatedAt?: unknown) {
    await this.init();
    return this.lock(async () => {
      const kit = await this.read(id);
      checkKitRevision(kit, expectedUpdatedAt);
      if (isBrandKitBusy(kit) || this.controls.has(id))
        throw new Error("Wait for this Brand Kit to stop before deleting");
      await rm(this.folder(id), { recursive: true });
    });
  }
  async file(id: string, name: string) {
    const kit = await this.get(id);
    const capturedAsset = name === "website.png" || name === "assets/logo.png" || kit.sample?.logos?.some(logo => logo.path === name);
    const captured = kit.sample && ["packaging", "rendering"].includes(kit.state) && capturedAsset;
    if (
      (kit.state !== "ready" && !captured) || (
      !kit.sample?.logos?.some(logo => logo.path === name) &&
      !kit.context?.files.some(file => file.path === name) &&
      ![
        "package.zip",
        "preview.mp4",
        "poster.png",
        "website.png",
        "assets/logo.png",
      ].includes(name))
    )
      throw new Error("Brand Kit file is not ready");
    if (
      (name === "preview.mp4" && !kit.preview) ||
      (name === "poster.png" && !kit.poster) ||
      (name === "assets/logo.png" && !kit.logo)
    )
      throw new Error("Brand Kit file is unavailable");
    return path.join(this.folder(id), "package", name);
  }
  async packageSnapshot(id: string, expectedUpdatedAt: string) {
    await this.init();
    return this.lock(async () => {
      const kit = await this.read(id);
      checkKitRevision(kit, expectedUpdatedAt);
      const source = await this.file(id, 'package.zip');
      const directory = path.join(this.folder(id), 'handoffs');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const packageZipPath = path.join(directory, encodeURIComponent(kit.updatedAt) + '.zip');
      // Packaging replaces its ZIP by rename, so the old inode remains intact.
      await link(source, packageZipPath).catch(error => { if (error.code !== 'EEXIST') throw error; });
      return { kit, packageZipPath };
    });
  }
  async idle() {
    await this.work;
  }
  async close() {
    for (const control of this.controls.values()) control.abort();
    await this.work;
  }
}
const libraries = new Map<string, BrandKitLibrary>();
export function brandKitsFor(directory: string) {
  let library = libraries.get(directory);
  if (!library) {
    library = new BrandKitLibrary(directory);
    libraries.set(directory, library);
  }
  return library;
}
