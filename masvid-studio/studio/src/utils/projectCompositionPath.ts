import { buildProjectApiPath, parseProjectIdFromHash } from "./projectRouting";

/** Convert runtime preview URLs to the same file identity used by authored paths. */
export function projectCompositionPath(
  source: string,
  projectId: string | null,
  origin = globalThis.location?.origin,
): string | null {
  let path = source.trim();
  if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(path)) {
    if (!origin || !projectId) return null;
    try {
      const url = new URL(path, origin);
      const base = new URL(buildProjectApiPath(projectId, "/preview/"), origin);
      if (url.origin !== base.origin || url.username || url.password || !url.pathname.startsWith(base.pathname)) return null;
      let relative = url.pathname.slice(base.pathname.length);
      // The native standalone-composition route adds /comp/ before the file.
      if (relative.startsWith("comp/")) relative = relative.slice(5);
      path = decodeURIComponent(relative);
    } catch {
      return null;
    }
  }
  // Keep the server's project boundary, including Windows separators/drives.
  if (!path || /[\\\x00-\x1f]/.test(path) || path.startsWith("/") || /^[a-z]:/i.test(path)) return null;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  const normalized = parts.join("/");
  return normalized && !/^[a-z]:/i.test(normalized) ? normalized : null;
}

/** Stable timeline/cache identity; unresolved URLs retain their separate scope. */
export function projectCompositionIdentity(source: string): string {
  const projectId = parseProjectIdFromHash(globalThis.location?.hash ?? "");
  return projectCompositionPath(source, projectId) ?? source;
}
