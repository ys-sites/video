import { createReadStream } from "node:fs";
import { attachmentDisposition } from "../shared/http-header.ts";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from "node:http";
import { brandKitsFor } from "./brand-kits.ts";
import { brandCatalogRoot, catalogEntry, catalogPoster, catalogShowcase, catalogStyleCover, readBrandCatalog } from './brand-catalog.ts';
import { brandCoversFor } from './brand-cover.ts';
import { brandCatalogArtworkUrl } from '../shared/brand-catalog.ts';
import { brandKitWebsite } from '../shared/brand-kit.ts';

export async function brandKitHttp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  directory: string,
  input: (req: IncomingMessage, limit: number) => Promise<any>,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/brand-kits")) return false;
  const library = brandKitsFor(directory);
  const sendCover = (body: Buffer | string, mime: string, maxAge = 3600) => {
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': `private, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" });
    res.end(body);
    return true;
  };
  const json = (status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
    return true;
  };
  try {
    if (url.pathname === '/api/brand-kits/catalog' && req.method === 'GET') return json(200, await readBrandCatalog());
    if (url.pathname === '/api/brand-kits/catalog/assets/gsap.min.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      res.end(await readFile(path.join(brandCatalogRoot, 'assets/gsap.min.js'))); return true;
    }
    const catalogRoute = url.pathname.match(/^\/api\/brand-kits\/catalog\/([a-z][a-z0-9-]*)\/(poster\.svg|style-cover\.svg|showcase|cover|favicon|import)$/);
    if (catalogRoute) {
      const [, id, action] = catalogRoute;
      if (action === 'import' && req.method === 'POST') return json(202, { kit: await library.importCatalog(id) });
      if (req.method !== 'GET' || action === 'import') return json(405, { error: 'Unsupported Brand Kit operation' });
      const entry = await catalogEntry(id);
      if (action === 'style-cover.svg') return sendCover(catalogStyleCover(entry), 'image/svg+xml');
      const artworkUrl = brandCatalogArtworkUrl(entry);
      if (action === 'favicon') {
        const icon = artworkUrl ? await brandCoversFor(directory).favicon(artworkUrl, entry.websiteUrl ? entry.coverPage : undefined) : undefined;
        return icon ? sendCover(icon.body, icon.mime) : json(404, { error: 'Brand favicon is unavailable' });
      }
      if (action === 'cover') {
        const cover = artworkUrl ? await brandCoversFor(directory).get(artworkUrl, entry.coverImage, entry.websiteUrl ? entry.coverPage : undefined) : undefined;
        return cover ? sendCover(cover.body, cover.mime) : sendCover(catalogStyleCover(entry), 'image/svg+xml', artworkUrl ? 60 : 3600);
      }
      if (action !== 'showcase') return sendCover(catalogPoster(entry), 'image/svg+xml');
      // The viewer remains opaque-origin. Authorize only the scripts generated here.
      const nonce = randomBytes(18).toString('base64');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'` });
      res.end(catalogShowcase(entry, url.searchParams.get('detail') === '1', nonce));
      return true;
    }
    if (url.pathname === "/api/brand-kits") {
      if (req.method === "GET")
        return json(200, { kits: await library.list() });
      if (req.method === "POST") {
        const { url, requestId } = await input(req, 16_384);
        return json(202, { kit: await library.create(url, requestId) });
      }
    }
    const coverRoute = url.pathname.match(/^\/api\/brand-kits\/([a-f0-9-]{36})\/(cover|favicon)$/);
    if (coverRoute && req.method === 'GET') {
      const kit = await library.get(coverRoute[1]);
      const entry = kit.catalogId ? await catalogEntry(kit.catalogId).catch(() => undefined) : undefined;
      // Imported style fixtures have GitHub provenance, not a brand website.
      const website = brandKitWebsite(kit);
      const artworkUrl = website || entry?.sourceUrl || kit.url;
      const coverPage = website ? entry?.coverPage : undefined;
      if (coverRoute[2] === 'favicon') {
        const icon = artworkUrl ? await brandCoversFor(directory).favicon(artworkUrl, coverPage) : undefined;
        if (icon) return sendCover(icon.body, icon.mime);
        if (kit.logo) {
          const captured = await library.file(kit.id, 'assets/logo.png').then(readFile).catch(() => undefined);
          if (captured) return sendCover(captured, 'image/png', 60);
        }
        return json(404, { error: 'Brand favicon is unavailable' });
      }
      const cover = artworkUrl ? await brandCoversFor(directory).get(artworkUrl, kit.sample?.tokens?.ogImage || entry?.coverImage, coverPage) : undefined;
      if (cover) return sendCover(cover.body, cover.mime);
      if (entry) return sendCover(catalogStyleCover(kit.sample ? { ...entry, name: kit.name, sample: kit.sample } : entry), 'image/svg+xml', artworkUrl ? 60 : 3600);
      if (!kit.catalogId) {
        const screenshot = await library.file(kit.id, 'website.png').then(readFile).catch(() => undefined);
        if (screenshot) return sendCover(screenshot, 'image/png', 60);
      }
      if (kit.poster) return sendCover(await readFile(await library.file(kit.id, 'poster.png')), 'image/png', 60);
      return json(404, { error: 'Brand cover is unavailable' });
    }
    const route = url.pathname.match(
      /^\/api\/brand-kits\/([a-f0-9-]{36})(?:\/(cancel|retry|context|files\/(package.zip|preview.mp4|poster.png|website.png|assets\/logo(?:-[2-6])?.png|context\/[a-f0-9-]{36}\.[a-z0-9]+)))?$/,
    );
    if (!route) return json(404, { error: "Unknown Brand Kit operation" });
    const [, id, action, filename] = route;
    if (!action && req.method === "GET")
      return json(200, { kit: await library.get(id) });
    if (!action && req.method === "PUT") {
      const changes = await input(req, 16_384);
      return json(202, { kit: await library.retry(id, changes, changes.expectedUpdatedAt) });
    }
    if (!action && req.method === "DELETE") {
      const changes = req.headers["content-type"]?.includes("application/json") ? await input(req, 16_384) : {};
      await library.remove(id, changes.expectedUpdatedAt);
      return json(200, { ok: true });
    }
    if (action === "context" && req.method === "PUT") {
      const changes = await input(req, 12 * 1024 * 1024);
      return json(200, { kit: await library.updateContext(id, changes, changes.expectedUpdatedAt) });
    }
    if (action === "cancel" && req.method === "POST")
      return json(200, { kit: await library.cancel(id) });
    if (action === "retry" && req.method === "POST") {
      const changes = req.headers["content-type"]?.includes("application/json") ? await input(req, 16_384) : undefined;
      return json(202, { kit: await library.retry(id, changes?.rescan ? { rescan: changes.rescan } : undefined, changes?.expectedUpdatedAt) });
    }
    if (filename && ["GET", "HEAD"].includes(req.method || "")) {
      const revision = url.searchParams.get('v');
      const file = filename === 'package.zip' && revision ? (await library.packageSnapshot(id, revision)).packageZipPath : await library.file(id, filename),
        info = await stat(file);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      res.setHeader(
        "Content-Type",
        filename.startsWith("context/") ? "application/octet-stream" : filename.endsWith(".zip")
          ? "application/zip"
          : filename.endsWith(".mp4")
            ? "video/mp4"
            : "image/png",
      );
      if (filename.endsWith(".zip"))
        res.setHeader(
          "Content-Disposition",
          attachmentDisposition(`brand-kit-${id}.zip`),
        );
      if (filename.startsWith("context/")) res.setHeader("Content-Disposition", attachmentDisposition(path.basename(filename)));
      res.setHeader("Accept-Ranges", "bytes");
      let start = 0,
        end = info.size - 1,
        status = 200;
      if (filename === 'preview.mp4' || filename === 'poster.png') {
        // Video and poster URLs are scoped to the record version. Keep saved
        // previews in the local browser cache across repeated detail visits.
        res.setHeader('Cache-Control', url.searchParams.has('v') ? 'private, max-age=3600' : 'no-cache');
      }
      if (req.headers.range) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        if (
          !range ||
          +range[1] >= info.size ||
          (range[2] && +range[2] < +range[1])
        ) {
          res.writeHead(416, { "Content-Range": `bytes */${info.size}` });
          res.end();
          return true;
        }
        start = +range[1];
        end = range[2] ? Math.min(+range[2], end) : end;
        status = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
      }
      res.setHeader("Content-Length", end - start + 1);
      res.writeHead(status);
      if (req.method === "HEAD") res.end();
      else {
        const stream = createReadStream(file, { start, end });
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      }
      return true;
    }
    return json(405, { error: "Unsupported Brand Kit operation" });
  } catch (error) {
    return json(
      (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : /^(?:BRAND_KIT_CHANGED|REQUEST_ID_CONFLICT):/.test((error as Error).message) ? 409 : 400,
      { error: (error as Error).message },
    );
  }
}
