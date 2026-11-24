import { useEffect, useState } from "react";
import { buildProjectApiPath } from "../utils/projectRouting";
import { studioApiFetch } from "../utils/studioApiFetch";

interface AssetMetadata {
  description?: string;
  duration?: number;
  width?: number;
  height?: number;
}

const MANIFEST_PATH = ".media/manifest.jsonl";
const EMPTY_METADATA = new Map<string, AssetMetadata>();

/** The project file listing includes optional .media files; absence is normal. */
export function useProjectAssetManifest(projectId: string, assets: string[]): ReadonlyMap<string, AssetMetadata> {
  const [loaded, setLoaded] = useState<{ projectId: string; metadata: Map<string, AssetMetadata> } | null>(null);
  const assetsKey = assets.join("|");
  const hasManifest = assets.includes(MANIFEST_PATH);

  useEffect(() => {
    setLoaded(null);
    if (!hasManifest) return;
    const controller = new AbortController();
    studioApiFetch(buildProjectApiPath(projectId, `/preview/${MANIFEST_PATH}`), { signal: controller.signal })
      .then(async response => {
        // A file removed since the listing was fetched is also optional absence.
        if (response.status === 404) return;
        if (!response.ok) throw new Error(`Asset metadata request failed: ${response.status}`);
        const text = await response.text();
        if (controller.signal.aborted) return;
        const metadata = new Map<string, AssetMetadata>();
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const record = JSON.parse(line);
            if (typeof record?.path === "string") metadata.set(record.path, record);
          } catch {
            // One malformed record must not hide the remaining assets.
          }
        }
        setLoaded({ projectId, metadata });
      })
      .catch(error => {
        if (!controller.signal.aborted) console.warn("[Studio] Failed to load project asset metadata", error);
      });
    return () => controller.abort();
  }, [projectId, hasManifest, assetsKey]);

  return hasManifest && loaded?.projectId === projectId ? loaded.metadata : EMPTY_METADATA;
}
