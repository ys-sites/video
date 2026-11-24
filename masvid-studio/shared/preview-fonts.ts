import type { InjectDeterministicFontFacesOptions } from '@hyperframes/core/fonts/embed';

type EmbedFonts = (html: string, options?: InjectDeterministicFontFacesOptions) => Promise<string>;
type Stylesheet = { body: string; status: number; headers: Headers };
type FontFile = { body: ArrayBuffer; status: number; headers: Headers };

/** Reuse the default caption font across edits instead of downloading a new character subset. */
export function createPreviewFontPreparation(embed: EmbedFonts, fetchFont: typeof fetch = fetch) {
  const stylesheets = new Map<string, Promise<Stylesheet>>();
  const fontFiles = new Map<string, Promise<FontFile>>();
  const reuseFontFile: typeof fetch = async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const key = `${input instanceof Request ? input.url : String(input)}\n${JSON.stringify([...headers])}`;
    let pending = fontFiles.get(key);
    if (!pending) {
      pending = (async () => {
        const response = await fetchFont(input, init);
        const body = await response.arrayBuffer();
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete('content-length');
        responseHeaders.delete('content-encoding');
        return { body, status: response.status, headers: responseHeaders };
      })();
      fontFiles.set(key, pending);
      const forget = () => { if (fontFiles.get(key) === pending) fontFiles.delete(key); };
      void pending.then(result => {
        if (result.status < 200 || result.status >= 300 || result.body.byteLength > 1024 * 1024) forget();
      }, forget);
      if (fontFiles.size > 32) fontFiles.delete(fontFiles.keys().next().value!);
    }
    const cached = await pending;
    return new Response(cached.body.slice(0), { status: cached.status, headers: cached.headers });
  };
  const fullFamilyFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    // Native disk entries are keyed by weight, while variable faces can share
    // one file across many weights. Avoid downloading that file once per face
    // during the first preview as well as across simultaneous previews.
    if (url.origin === 'https://fonts.gstatic.com' && /\.woff2?$/.test(url.pathname)) {
      return reuseFontFile(input, init);
    }
    // Arial maps to Inter in the native engine. Keep custom/CJK fonts on the
    // engine's subset path: fetching their entire families can be very large.
    const families = url.searchParams.getAll('family');
    if (url.origin !== 'https://fonts.googleapis.com' || url.pathname !== '/css2' || !url.searchParams.has('text') ||
        families.length !== 1 || families[0].split(':')[0] !== 'Inter') {
      return fetchFont(input, init);
    }
    url.searchParams.delete('text');
    // Google varies its font format by user agent. Do not share different representations.
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const key = `${url.href}\n${JSON.stringify([...headers])}`;
    let pending = stylesheets.get(key);
    if (!pending) {
      pending = (async () => {
        const response = await fetchFont(input instanceof Request ? new Request(url, input) : url, init);
        const body = await response.text();
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete('content-length');
        responseHeaders.delete('content-encoding');
        return { body, status: response.status, headers: responseHeaders };
      })();
      stylesheets.set(key, pending);
      const forget = () => { if (stylesheets.get(key) === pending) stylesheets.delete(key); };
      void pending.then(result => {
        if (result.status < 200 || result.status >= 300 || !/@font-face\s*\{/i.test(result.body)) forget();
      }, forget);
      if (stylesheets.size > 32) stylesheets.delete(stylesheets.keys().next().value!);
    }
    const cached = await pending;
    return new Response(cached.body, { status: cached.status, headers: cached.headers });
  };
  return (html: string) => embed(html, {
    // An explicitly authored text subset is a project decision; retain its exact semantics.
    // This includes escaped ampersands inside link/style declarations.
    fetchImpl: /(?:[?&]|&amp;)text\s*=/i.test(html) ? fetchFont : fullFamilyFetch,
  });
}
