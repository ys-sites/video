/** Names that cannot survive a round trip through a portable project archive. */
const reservedDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** One path segment a Windows or default macOS volume cannot store safely. */
export function unsafePortableSegment(segment: string): boolean {
  return reservedDeviceName.test(segment) || /[. ]$/.test(segment);
}

/** The first unsafe segment of a project-relative path, or null when every segment is portable. */
export function portableNameProblem(name: string): string | null {
  for (const segment of name.split('/')) if (unsafePortableSegment(segment)) return segment;
  return null;
}

/** Case and Unicode folding is a filesystem property, so callers pass the policy instead of reading it here. */
export function foldProjectName(name: string): string { return name.normalize('NFC').toLowerCase(); }

export const foldsProjectNames = process.platform === 'win32' || process.platform === 'darwin';

/** The first name that collides with an earlier one once folding is applied, or null. */
export function firstFoldedDuplicate(names: string[], fold: boolean): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    const key = fold ? foldProjectName(name) : name;
    if (seen.has(key)) return name;
    seen.add(key);
  }
  return null;
}