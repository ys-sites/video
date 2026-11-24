import { useEffect, useState, type AnchorHTMLAttributes } from 'react';
import registry from '../registry.json';

export function navigate(path: string) {
  if (path === window.location.pathname && !window.location.search && !window.location.hash) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function readPath() {
  const { pathname, hash } = window.location;
  if (pathname === '/' && /^#\/(?:components|guide|tokens)(?:\/|$)/.test(hash)) {
    return hash.slice(1).replace(/\/+$/, '');
  }
  if (pathname === '/' && registry.items.some(item => hash === '#' + item.name)) {
    return '/components/' + hash.slice(1);
  }
  return pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/components';
}

export function useCatalogPath() {
  const [path, setPath] = useState(readPath);
  useEffect(() => {
    const syncPath = () => {
      const current = readPath();
      if (window.location.pathname !== current || window.location.hash) {
        window.history.replaceState(null, '', current + window.location.search);
      }
      setPath(current);
    };
    syncPath();
    window.addEventListener('popstate', syncPath);
    window.addEventListener('hashchange', syncPath);
    return () => {
      window.removeEventListener('popstate', syncPath);
      window.removeEventListener('hashchange', syncPath);
    };
  }, []);
  return path;
}

export function DocLink({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a {...props} href={href} onClick={event => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      navigate(href);
    }} />
  );
}
