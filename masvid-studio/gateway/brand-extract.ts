import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { browserAutomation, browserExecutable } from "../browser.ts";
import { pluginRoot } from "../hyperframes.ts";
import { requireNativeRuntime } from "../scripts/npm-runtime.mjs";
import { brandWebsite, fetchBrandResource, resolveBrandAddresses } from "./brand-network.ts";
import { captureBrandLogos, type CapturedBrandImage } from "./brand-assets.ts";
import { brandSampleScript } from "./brand-sampler.mjs";
import { validateBrandStyle, type BrandSample } from "../shared/brand-kit.ts";

export type BrandFont = {
  path: string;
  source: string;
  family: string;
  weight: string;
  style: string;
  unicodeRange?: string;
};
export type BrandCapture = {
  sourceKind?: 'catalog';
  capturedAt?: string;
  sample: BrandSample;
  url: string;
  logo: boolean;
  fonts: BrandFont[];
  warnings: string[];
};
export async function extractBrand(
  url: string,
  directory: string,
  signal: AbortSignal,
  onExtract: () => Promise<void>,
  runtimeRoot: string,
): Promise<BrandCapture> {
  brandWebsite(url);
  signal.throwIfAborted();
  await requireNativeRuntime(pluginRoot, "capture");
  const puppeteer = await browserAutomation(runtimeRoot);
  await mkdir(path.join(directory, "assets"), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: await browserExecutable(),
    headless: true,
    timeout: 20_000,
    args: [
      "--disable-background-networking",
      "--disable-quic",
      "--host-resolver-rules=MAP * ~NOTFOUND",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
  const abort = () => {
    void browser.close();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    let requests = 0,
      bytes = 0;
    let fetching = 0;
    const waiting: (() => void)[] = [];
    const resolutions = new Map<string, ReturnType<typeof resolveBrandAddresses>>();
    const resolveHost = (hostname: string) => {
      let result = resolutions.get(hostname);
      if (!result) { result = resolveBrandAddresses(hostname, signal); resolutions.set(hostname, result); }
      return result;
    };
    const fetchResource = async (address: string) => {
      if (fetching >= 8)
        await new Promise<void>((resolve) => waiting.push(resolve));
      else fetching++;
      try {
        signal.throwIfAborted();
        if (bytes >= 40 * 1024 * 1024)
          throw new Error("Website capture exceeded its size limit");
        const response = await fetchBrandResource(address, signal, resolveHost);
        bytes += response.body.length;
        if (bytes > 40 * 1024 * 1024)
          throw new Error("Website capture exceeded its size limit");
        return response;
      } finally {
        const next = waiting.shift();
        if (next) next();
        else fetching--;
      }
    };
    let navigationError: Error | undefined;
    let failedResources = 0;
    const fonts = new Map<string, Buffer>();
    const images = new Map<string, CapturedBrandImage>();
    const stylesheets = new Map<string, string>();
    page.on("dialog", (dialog) => {
      void dialog.dismiss().catch(() => {});
    });
    page.on("popup", (popup) => {
      void popup?.close();
    });
    page.on("request", (request) => {
      void (async () => {
        if (request.isInterceptResolutionHandled()) return;
        const resource = request.resourceType();
        if (
          ++requests > 160 ||
          bytes > 40 * 1024 * 1024 ||
          request.method() !== "GET" ||
          ["media", "websocket", "eventsource", "other"].includes(resource)
        ) {
          await request.abort();
          return;
        }
        if (/^data:(?:image|font)\//.test(request.url())) {
          await request.continue();
          return;
        }
        try {
          const response = await fetchResource(request.url());
          if (
            resource === "font" &&
            response.status === 200 &&
            response.body.length < 2 * 1024 * 1024
          )
            fonts.set(request.url(), response.body);
          if (resource === "image" && response.status === 200 && images.size < 80) {
            const mime = response.headers['content-type']?.split(';')[0] || '';
            if (/^image\/(png|jpeg|webp|avif|gif|svg\+xml)$/.test(mime || '')) {
              const image = { data: response.body, mime };
              images.set(request.url(), image);
              for (const redirect of request.redirectChain()) images.set(redirect.url(), image);
            }
          }
          if (resource === "stylesheet" && response.status === 200 && response.body.length < 512 * 1024 && stylesheets.size < 24)
            stylesheets.set(request.url(), response.body.toString('utf8'));
          // Site JavaScript may lay out the document, but cannot open extra network channels.
          if (resource === "document")
            response.headers["content-security-policy"] =
              "sandbox allow-scripts allow-same-origin; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'";
          await request.respond(response);
        } catch (error) {
          failedResources++;
          if (
            request.isNavigationRequest() &&
            request.frame() === page.mainFrame()
          )
            navigationError =
              error instanceof Error
                ? error
                : new Error("Website request failed");
          if (!request.isInterceptResolutionHandled())
            await request.abort().catch(() => {});
        }
      })().catch(() => {});
    });
    const response = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch((error) => {
        throw navigationError || error;
      });
    if (
      !response?.ok() ||
      !response.headers()["content-type"]?.includes("text/html")
    )
      throw new Error(
        "The website could not be read. Try a public page without sign-in.",
      );
    brandWebsite(page.url());
    const settled = await page.waitForNetworkIdle({ idleTime: 500, timeout: 4000 }).then(() => true, () => false);
    await page.evaluate(() =>
      Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]),
    );
    // Bounded scrolling activates lazy sections without following links or changing the site.
    await page.evaluate(async () => {
      for (let step = 0; step < 6; step++) {
        const next = Math.min((step + 1) * innerHeight * .75, document.documentElement.scrollHeight - innerHeight);
        if (next <= scrollY) break;
        window.scrollTo(0, next);
        await new Promise(resolve => setTimeout(resolve, 180));
      }
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    await onExtract();
    signal.throwIfAborted();
    const sample = (await page.evaluate(brandSampleScript)) as BrandSample;
    // Computed styles are observations, never executable source or Agent instructions.
    try {
      sample.style = validateBrandStyle(sample.style);
    } catch {
      sample.style.headingFont =
        sample.style.headingFont
          .replace(/[^\p{L}\p{N} _,'".-]/gu, "")
          .slice(0, 160) || "sans-serif";
      sample.style.bodyFont =
        sample.style.bodyFont
          .replace(/[^\p{L}\p{N} _,'".-]/gu, "")
          .slice(0, 160) || "sans-serif";
      sample.style.gradient = "none";
      sample.style = validateBrandStyle(sample.style);
    }
    await page.screenshot({
      path: path.join(directory, "website.png"),
      type: "png",
    });
    sample.logos = await captureBrandLogos(page, directory, sample.name, images);
    const logo = sample.logos.length > 0;
    const capturedAt = new Date().toISOString();
    sample.sources = [{ kind: 'website', url: page.url(), capturedAt }, { kind: 'screenshot', url: 'website.png', capturedAt }];
    const faces = await page.evaluate((sheets) => {
      const found: {
        family: string;
        weight: string;
        style: string;
        urls: string[];
        unicodeRange: string;
      }[] = [];
      const walk = (rules: CSSRuleList, base: string) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSFontFaceRule) {
            const s = rule.style,
              urls = Array.from(
                s.getPropertyValue("src").matchAll(/url\(["']?([^)'"\s]+)/g),
                (m) => new URL(m[1], base).href,
              );
            found.push({
              family: s.getPropertyValue("font-family").replace(/["']/g, ""),
              weight: s.getPropertyValue("font-weight") || "400",
              style: s.getPropertyValue("font-style") || "normal",
              urls,
              unicodeRange: s.getPropertyValue("unicode-range"),
            });
          } else if ("cssRules" in rule)
            walk((rule as CSSGroupingRule).cssRules, base);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules, sheet.href || location.href);
        } catch {}
      }
      // Parse fetched external CSS in detached CSSOM; no stylesheet or remote resource is applied.
      for (const [base, css] of sheets) {
        try { const sheet = new CSSStyleSheet(); sheet.replaceSync(css); walk(sheet.cssRules, base); } catch {}
      }
      return found.slice(0, 240);
    }, [...stylesheets.entries()]);
    const saved: BrandFont[] = [];
    for (const face of faces) {
      if (
        !/^[\p{L}\p{N} _.-]{1,100}$/u.test(face.family) ||
        !/^(?:normal|bold|[1-9]\d{0,2}(?: [1-9]\d{0,2})?|1000)$/.test(face.weight) ||
        !/^(normal|italic|oblique)$/.test(face.style)
      )
        continue;
      if (
        ![sample.style.headingFont, sample.style.bodyFont, ...sample.typography.map(t => t.fontFamily)].some((stack) =>
          stack.toLowerCase().includes(face.family.toLowerCase()),
        )
      )
        continue;
      const source = face.urls.find((url) => fonts.has(url));
      if (!source || saved.length >= 16 || saved.some(f => f.source === source && f.family === face.family && f.weight === face.weight && f.style === face.style && f.unicodeRange === face.unicodeRange)) continue;
      const data = fonts.get(source)!;
      if (data.length < 4) continue;
      const magic = data.subarray(0, 4).toString("ascii");
      const extension =
        magic === "wOF2"
          ? "woff2"
          : magic === "wOFF"
            ? "woff"
            : magic === "OTTO"
              ? "otf"
              : data.readUInt32BE(0) === 0x10000
                ? "ttf"
                : null;
      if (!extension) continue;
      const relative = `assets/font-${saved.length + 1}.${extension}`;
      await writeFile(path.join(directory, relative), data);
      saved.push({
        path: relative,
        source,
        family: face.family,
        weight: face.weight,
        style: face.style,
        unicodeRange: /^[Uu+0-9a-fA-F?,\s-]*$/.test(face.unicodeRange) ? face.unicodeRange : undefined,
      });
    }
    const warnings = [
      "Website observations may need correction. Confirm brand ownership and asset/font permissions before redistribution.",
    ];
    if (!settled) warnings.push("Some website resources were still loading at capture time.");
    if (requests > 160 || bytes >= 40 * 1024 * 1024) warnings.push("Website resources exceeded the bounded capture budget; some styles or assets may be missing.");
    if (failedResources) warnings.push(`${failedResources} website resources could not be captured.`);
    if (!logo)
      warnings.push(
        "No visible logo was captured; the showcase uses the brand name.",
      );
    if (!saved.length)
      warnings.push(
        "No reusable webfont was captured. The showcase uses the detected font stack and available system fallbacks.",
      );
    signal.throwIfAborted();
    return {
      sample,
      url: page.url(),
      logo,
      fonts: saved,
      warnings,
      capturedAt,
    };
  } finally {
    signal.removeEventListener("abort", abort);
    await browser.close();
  }
}
