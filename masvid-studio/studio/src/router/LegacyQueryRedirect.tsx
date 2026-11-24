import { Navigate, useLocation } from 'react-router';
import { findLandingScene } from '../../../shared/studio-catalog';
import { workspacePageHref } from '../motion/workspacePageRouting';

/**
 * Legacy `/?page=...` pages migrated to canonical semantic paths across
 * Phase 4a -> 4b -> 4c so outbound links and inbound `/` redirects stay
 * in lockstep with zero double-navigation.
 */
const MIGRATED_LEGACY_QUERY_PAGES = new Set([
  // Phase 4a — low-coupling standalone surfaces
  'brand-kit',
  'mcp',
  'model',
  'model-hub',
  'skills',
  // Phase 4b — creative studios domain
  'assets',
  'audio',
  'cinema',
  'create',
  'design',
  'scenarios',
  'scenario',
  'sound',
  'shorts',
  'marketing',
  'explainer',
  '3d',
  'game',
  // Phase 4c — core surfaces
  'explore',
  'motion',
  'settings',
  'editor',
  'api',
]);

/**
 * Resolve a legacy root-path URL (`/?page=...`, bare `/`, or
 * `/?project=...#project/...`) to its canonical semantic path URL, preserving
 * orthogonal query parameters (`embed`, `hostChrome`, `templates`, `template`,
 * `project`, `session`, `tracking_context`, etc.) and the `#project/...` hash.
 *
 * Returns `null` when the URL is already canonical, incomplete, or a root
 * template/hostChrome overlay embed.
 */
export function resolveLegacyQueryRedirect(
  pathname: string,
  search: string,
  hash = '',
): string | null {
  const normalizedPath = pathname || '/';
  if (normalizedPath !== '/') return null;

  const query = new URLSearchParams(search);
  const rawPage = query.get('page');
  if (rawPage !== null) {
    if (!MIGRATED_LEGACY_QUERY_PAGES.has(rawPage)) return null;
    if (rawPage === 'model' && !query.get('model')) return null;
    if (rawPage === 'model-hub' && !query.get('hub')) return null;
    if (rawPage === 'create' && !findLandingScene(query.get('scene'))) return null;
  } else if (query.get('templates') === '1' || query.get('hostChrome') === '1') {
    return null;
  }

  const origin = 'http://workspace.local';
  const current = `${normalizedPath}${search}${hash}`;
  const canonical = workspacePageHref(`${origin}${current}`, {});
  const parsedCanonical = new URL(canonical, origin);
  if (parsedCanonical.pathname === '/' || canonical === current) return null;
  return canonical;
}

/**
 * Mounted on the root `/` index route to transparently `replace` legacy
 * query-driven bookmarks onto their canonical semantic path URLs without
 * adding an extra browser history entry or losing `location.state`.
 */
export function LegacyQueryRedirect() {
  const routerLocation = useLocation();
  const target = resolveLegacyQueryRedirect(
    routerLocation.pathname,
    routerLocation.search,
    routerLocation.hash,
  );
  if (!target) return null;
  return <Navigate to={target} replace state={routerLocation.state} />;
}
