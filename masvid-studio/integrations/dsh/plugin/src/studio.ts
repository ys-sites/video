// Resolved once from the host plugin's authenticated local configuration.
export let studio = "";
export function studioAssetUrl(value?: string): string | undefined {
  return value ? new URL(value, studio + "/").href : undefined;
}

export function configureStudio(origin: string): void {
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("OpenMotion requires a local Studio origin.");
  studio = url.origin;
}
