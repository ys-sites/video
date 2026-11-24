import { isWorkspaceSettingsPage } from './workspace-url.ts';

/**
 * Prefixes owned by local/cloud HTTP APIs, MCP protocol endpoints, static build
 * assets, or host integration handlers. Neither the local server nor dev proxies
 * may rewrite these paths to `studio/build/index.html`.
 */
export const RESERVED_BACKEND_PREFIXES = [
  '/api',
  '/motion-api',
  '/design-api',
  '/mcp',
  '/mcp-ui',
  '/connect',
  '/sessions',
  '/editor-assets',
  '/guide-assets',
  '/design-system',
  '/web',
  '/.well-known',
  '/__hyperframes_config',
] as const;

/**
 * Explicit allowlist of Studio SPA route prefixes served with `studio/build/index.html`.
 * Keeping an allowlist (instead of a blind wildcard) guarantees unknown backend routes,
 * missing assets, and repository source paths continue returning 404.
 */
export const SPA_ROUTE_PREFIXES = [
  '/',
  '/explore',
  '/create',
  '/motion',
  '/cinema',
  '/design',
  '/sound',
  '/audio',
  '/studios',
  '/scenarios',
  '/game',
  '/skills',
  '/models',
  '/model-hub',
  '/assets',
  '/brand-kit',
  '/settings',
  '/mcp-setup',
  '/templates',
  '/editor',
] as const;

/**
 * Standalone SPA path prefixes that render without requiring a local native
 * Hyperframes editor process to start beforehand.
 */
export const STANDALONE_SPA_PREFIXES = SPA_ROUTE_PREFIXES.filter(
  prefix => prefix !== '/' && prefix !== '/editor',
);

const NON_SPA_FILE_EXTENSION = /\.(?:js|mjs|cjs|ts|tsx|jsx|css|map|json|html|htm|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|eot|mp4|webm|mov|m4a|mp3|wav|txt|md|ya?ml|xml|zip|tgz|pdf)$/i;

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function isReservedBackendPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return RESERVED_BACKEND_PREFIXES.some(prefix => matchesPrefix(normalized, prefix));
}

export function isSpaRoutePath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  if (normalized === '/') return true;
  if (isReservedBackendPath(normalized)) return false;
  if (NON_SPA_FILE_EXTENSION.test(normalized)) return false;
  return SPA_ROUTE_PREFIXES.some(prefix => prefix !== '/' && matchesPrefix(normalized, prefix));
}

/**
 * Standalone Studio routes stay usable even when the local native project
 * cannot initialize (for example Settings, MCP setup, Explore, or Studios).
 */
export function isStandaloneSpaPath(pathname: string, search = '', hash = ''): boolean {
  const normalized = normalizePathname(pathname);
  if (normalized === '/') return isWorkspaceSettingsPage(search, hash);
  if (matchesPrefix(normalized, '/editor')) return false;
  if (!STANDALONE_SPA_PREFIXES.some(prefix => matchesPrefix(normalized, prefix))) return false;
  if (normalized === '/templates') return true;
  return isWorkspaceSettingsPage(spaPathnameToSearch(normalized, search), hash);
}

/** Extract the project ID from `/editor/:projectId`, if present. */
export function editorProjectIdFromPath(pathname: string): string | null {
  const normalized = normalizePathname(pathname);
  const match = normalized.match(/^\/editor\/([^/]+)$/);
  if (!match) return null;
  return decodeSegment(match[1]);
}

/**
 * Translate a whitelisted semantic SPA pathname (such as `/settings/providers`
 * or `/cinema/text-to-video`) into the equivalent Studio workspace query string
 * so direct loads and refreshes render the requested page while query-based
 * navigation remains backward compatible.
 */
export function spaPathnameToSearch(pathname: string, search = ''): string {
  const normalized = normalizePathname(pathname);
  if (normalized === '/' || !isSpaRoutePath(normalized)) return search;

  const query = new URLSearchParams(search);
  const parts = normalized.slice(1).split('/').map(decodeSegment);
  const [head, second, third] = parts;

  if (!query.has('page')) {
    switch (head) {
      case 'explore':
        query.set('page', 'explore');
        if (second && !query.has('community')) query.set('community', second);
        break;
      case 'create':
        query.set('page', 'create');
        if (second && !query.has('scene')) query.set('scene', second);
        break;
      case 'motion':
        query.set('page', 'motion');
        break;
      case 'cinema':
        query.set('page', 'cinema');
        if (second && !query.has('scene')) query.set('scene', second);
        break;
      case 'design':
        query.set('page', 'design');
        if (second === 'projects' && third) {
          if (!query.has('scene')) query.set('scene', 'projects');
          if (!query.has('designProject')) query.set('designProject', third);
        } else if (second && !query.has('scene')) {
          query.set('scene', second);
        }
        break;
      case 'sound':
        query.set('page', 'sound');
        if (second && !query.has('scene')) query.set('scene', second);
        else if (!second && !query.has('scene') && !query.has('home')) query.set('home', '1');
        break;
      case 'audio':
        query.set('page', 'audio');
        if (second && !query.has('scene')) query.set('scene', second);
        break;
      case 'studios':
        query.set('page', second || 'studios');
        if (second && third && !query.has('scene')) query.set('scene', third);
        else if (second === 'sound' && !third && !query.has('scene') && !query.has('home')) query.set('home', '1');
        break;
      case 'scenarios':
        if (second) {
          query.set('page', 'scenario');
          if (!query.has('scenario')) query.set('scenario', second);
        } else {
          query.set('page', 'scenarios');
        }
        break;
      case 'game':
        query.set('page', 'game');
        break;
      case 'skills':
        query.set('page', 'skills');
        if (second && !query.has('skill')) query.set('skill', second);
        break;
      case 'models':
        if (second === 'hub' && third) {
          query.set('page', 'model-hub');
          if (!query.has('hub')) query.set('hub', third);
        } else if (second) {
          query.set('page', 'model');
          if (!query.has('model')) query.set('model', parts.slice(1).join('/'));
        }
        break;
      case 'model-hub':
        query.set('page', 'model-hub');
        if (second && !query.has('hub')) query.set('hub', second);
        break;
      case 'assets':
        query.set('page', 'assets');
        if (second && !query.has('asset')) query.set('asset', second);
        break;
      case 'brand-kit':
        query.set('page', 'brand-kit');
        if (second && !query.has('kit')) query.set('kit', second);
        break;
      case 'settings':
        query.set('page', 'settings');
        if (second && !query.has('section')) query.set('section', second);
        break;
      case 'mcp-setup':
        query.set('page', 'mcp');
        if (second && !query.has('host')) query.set('host', second);
        break;
      case 'templates':
        if (!query.has('templates')) query.set('templates', '1');
        break;
      case 'editor':
        query.set('page', 'editor');
        if (second && !query.has('project')) query.set('project', second);
        break;
    }
  }

  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}
