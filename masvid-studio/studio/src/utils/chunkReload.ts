import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_ERROR_PATTERN =
  /dynamically imported module|loading (?:css )?chunk|importing a module script|chunkloaderror/i;

const RELOAD_STORAGE_KEY = 'openmotion.chunk-reload';
const RELOAD_COOLDOWN_MS = 15_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return CHUNK_ERROR_PATTERN.test(message);
}

type ReloadDeps = {
  href?: string;
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload?: () => void;
};

/**
 * Triggers a single full-page reload when a lazily loaded JS/CSS chunk goes stale
 * after Studio is rebuilt or upgraded while a tab is still open.
 * Returns true if a reload was initiated; false if one was already attempted
 * recently for the same URL (preventing reload loops when offline).
 */
export function attemptChunkReload(deps: ReloadDeps = {}): boolean {
  if (typeof window === 'undefined' && !deps.reload) return false;
  const href = deps.href ?? window.location.href;
  const now = (deps.now ?? Date.now)();
  const reload = deps.reload ?? (() => window.location.reload());

  let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;
  if ('storage' in deps) {
    storage = deps.storage ?? null;
  } else {
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
  }

  if (storage) {
    try {
      const raw = storage.getItem(RELOAD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { href?: unknown; at?: unknown };
        if (
          parsed.href === href &&
          typeof parsed.at === 'number' &&
          now - parsed.at >= 0 &&
          now - parsed.at < RELOAD_COOLDOWN_MS
        ) {
          return false;
        }
      }
      storage.setItem(RELOAD_STORAGE_KEY, JSON.stringify({ href, at: now }));
    } catch {
      // If sessionStorage is blocked, avoid an unguarded infinite reload loop.
      return false;
    }
  }

  reload();
  return true;
}

export function lazyWithChunkReload<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  deps?: ReloadDeps,
): LazyExoticComponent<T> {
  return lazy(() =>
    importer().catch((error: unknown) => {
      if (isChunkLoadError(error) && attemptChunkReload(deps)) {
        // Keep Suspense fallback visible while the browser reloads the fresh entry HTML.
        return new Promise<never>(() => {});
      }
      throw error;
    }),
  );
}

export function bindVitePreloadErrorReload(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  deps?: ReloadDeps,
): () => void {
  const onPreloadError = (event: Event) => {
    if (attemptChunkReload(deps)) {
      event.preventDefault();
    }
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
