type GuideObject = { body: ReadableStream; text(): Promise<string>; writeHttpMetadata(headers: Headers): void };
type Environment = { RELEASES: { get(key: string): Promise<GuideObject | null> } };
const marker = '<!-- openmotion-utm-source-supported -->';
const sourcePattern = /^[A-Za-z0-9_.-]{1,64}$/;

export function attributeGuide(text: string, source: string | null): string {
  if (!source || !sourcePattern.test(source) || !text.includes(marker)) return text;
  return text.replace(/openmotion setup --host (codex|claude|deepseek|workbuddy)\b/g,
    command => `${command} --utm-source ${source}`);
}

export function guideKey(url: URL): string | null {
  if (url.hostname === 'releases.open-design.ai' && ['/motion', '/motion/'].includes(url.pathname)) {
    return 'open-motion/install.md';
  }
  if (url.pathname === '/motion/install.md') {
    if (url.hostname === 'open-design.powerformer.net') return 'open-motion/dev/install.md';
    if (url.hostname === 'open-design.ai') return 'open-motion/install.md';
    return null;
  }
  return /^\/open-motion\/(?:dev\/)?install\.md$/.test(url.pathname) ? url.pathname.slice(1) : null;
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url), key = guideKey(url);
    if (!key) return new Response('Not found', { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const object = await env.RELEASES.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers(); object.writeHttpMetadata(headers);
    headers.set('Content-Type', 'text/markdown; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    const source = url.searchParams.get('utm_source');
    if (!source) return new Response(request.method === 'HEAD' ? null : object.body, { headers });
    const text = attributeGuide(await object.text(), source);
    return new Response(request.method === 'HEAD' ? null : text, { headers });
  },
};
