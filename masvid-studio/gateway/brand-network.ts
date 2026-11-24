import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { isPublicAddress } from "./network.ts";

// Brand capture and provider traffic must agree on what counts as a public address.
export const publicBrandAddress = isPublicAddress;
export function brandWebsite(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048)
    throw new Error("Enter a public HTTPS website");
  const url = new URL(
    raw.includes("://") ? raw.trim() : "https://" + raw.trim(),
  );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    hostname === "localhost" ||
    /\.(?:localhost|local|internal)$/.test(hostname) ||
    (isIP(hostname) && !publicBrandAddress(hostname))
  )
    throw new Error("Enter a public HTTPS website");
  url.hash = "";
  return url.href;
}
export type BrandResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};
type BrandAddress = { address: string; family: number };
const syntheticAddress = (address: string) => /^198\.(?:18|19)\./.test(address);

/** A public resolver handles proxy Fake-IP answers without admitting synthetic/private peers. */
async function publicDns(hostname: string, signal: AbortSignal): Promise<BrandAddress[]> {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', 'A');
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      signal,
      headers: { Accept: 'application/dns-json' },
      // Bootstrap the resolver independently of the synthetic OS DNS. TLS still verifies its hostname.
      lookup: (_host, options, done) => {
        if ((options as { all?: boolean }).all) (done as Function)(null, [{ address: '1.1.1.1', family: 4 }]);
        else done(null, '1.1.1.1', 4);
      },
    }, response => {
      const chunks: Buffer[] = []; let length = 0;
      response.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 65_536) response.destroy(new Error('Public DNS response is too large'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('Public DNS lookup failed');
          const answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (answer.Status !== 0 || !Array.isArray(answer.Answer)) throw new Error('Public DNS lookup failed');
          resolve(answer.Answer.filter((record: { type: number; data: string }) => record.type === 1)
            .map((record: { data: string }) => ({ address: record.data, family: 4 })));
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error('Public DNS lookup timed out')));
    request.on('error', reject);
  });
}
export async function resolveBrandAddresses(hostname: string, signal: AbortSignal, dependencies = {
  lookup: (name: string) => lookup(name, { all: true }),
  publicDns,
}): Promise<BrandAddress[]> {
  let addresses = await dependencies.lookup(hostname);
  signal.throwIfAborted();
  // Only the well-defined benchmarking/Fake-IP range gets a second resolution path.
  // A loopback, RFC1918, mixed private or link-local DNS answer remains a hard rejection.
  if (addresses.length && addresses.every(({ address }) => syntheticAddress(address)))
    addresses = await dependencies.publicDns(hostname, signal);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !publicBrandAddress(address)))
    throw new Error('Website points to a private network');
  return addresses;
}
const defaultUserAgent = "Mozilla/5.0 OpenMotion-BrandKit/1.0";
const browserUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function fetchWithAgent(
  url: URL,
  addresses: BrandAddress[],
  signal: AbortSignal,
  userAgent: string,
  limit: number,
): Promise<BrandResponse> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        signal,
        headers: {
          "User-Agent": userAgent,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        },
        lookup: (_host, options, done) => {
          if ((options as { all?: boolean }).all)
            (done as Function)(null, addresses);
          else done(null, addresses[0].address, addresses[0].family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit)
            res.destroy(new Error("Website resource is too large"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            let body = Buffer.concat(chunks);
            const options = { maxOutputLength: limit };
            const encoding = typeof res.headers["content-encoding"] === "string"
              ? res.headers["content-encoding"].trim().toLowerCase()
              : "";
            if (body.length) {
              if (encoding === "gzip")
                body = gunzipSync(body, options);
              else if (encoding === "br")
                body = brotliDecompressSync(body, options);
              else if (encoding === "deflate")
                body = inflateSync(body, options);
            }
            const headers: Record<string, string> = {};
            for (const key of [
              "content-type",
              "location",
              "access-control-allow-origin",
            ])
              if (typeof res.headers[key] === "string")
                headers[key] = res.headers[key];
            resolve({ status: res.statusCode || 502, headers, body });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(12_000, () =>
      req.destroy(new Error("Website request timed out")),
    );
    req.on("error", reject);
  });
}

/** Every browser request is fulfilled through this bounded, DNS-pinned transport. */
export async function fetchBrandResource(
  raw: string,
  signal: AbortSignal,
  resolveAddresses = resolveBrandAddresses,
): Promise<BrandResponse> {
  const url = new URL(brandWebsite(raw)),
    hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolveAddresses(hostname, signal);
  const limit = 5 * 1024 * 1024;
  const response = await fetchWithAgent(url, addresses, signal, defaultUserAgent, limit);
  // Keep the honest default UA first so Akamai/TLS checks don't tarpit,
  // and retry once with a browser UA only when a host immediately rejects with 403/406.
  if ((response.status === 403 || response.status === 406) && !signal.aborted) {
    try {
      const retry = await fetchWithAgent(url, addresses, signal, browserUserAgent, limit);
      if (retry.status < 400) return retry;
    } catch { /* Preserve the original status when retry fails or times out. */ }
  }
  return response;
}
