import type { RenderJob } from "./useRenderQueue";

export function isPendingRender(job: Pick<RenderJob, "status">): boolean {
  return job.status === "rendering" || job.status === "cancelling" || job.status === "unknown";
}

/** A lost progress connection does not prove that the worker stopped. */
export function blocksProjectWork(job: Pick<RenderJob, "status" | "workerActive">): boolean {
  return job.status === "rendering" || job.status === "cancelling"
    || job.status === "unknown" && job.workerActive !== false;
}

export function readRenderStatus(value: unknown): RenderJob["status"] | undefined {
  return ["rendering", "cancelling", "unknown", "complete", "failed", "cancelled"].includes(String(value))
    ? value as RenderJob["status"] : undefined;
}

export function serverRenderJobs(value: unknown): RenderJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(record => {
    if (!record || typeof record.id !== "string" || typeof record.filename !== "string") return [];
    // Old hosts only list finished files. New hosts provide their actual state.
    const status = record.status === undefined ? "complete" : readRenderStatus(record.status) ?? "unknown";
    return [{
      id: record.id,
      nativeJobId: typeof record.nativeJobId === "string" ? record.nativeJobId : undefined,
      requestId: typeof record.requestId === "string" ? record.requestId : undefined,
      workerActive: typeof record.workerActive === "boolean" ? record.workerActive : undefined,
      filename: record.filename,
      createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
      status,
      progress: typeof record.progress === "number" ? record.progress : status === "complete" ? 100 : 0,
      stage: typeof record.stage === "string" ? record.stage : undefined,
      error: typeof record.error === "string" ? record.error : undefined,
      durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
      lastCheckedAt: typeof record.lastCheckedAt === "number" ? record.lastCheckedAt : undefined,
      fileAvailable: typeof record.fileAvailable === "boolean" ? record.fileAvailable : undefined,
      settings: record.settings && typeof record.settings === "object" ? record.settings : undefined,
    }];
  });
}

/** Never associate attempts by their display name or output filename. */
export function mergeRenderJobs(previous: RenderJob[], incoming: RenderJob[]): RenderJob[] {
  const remaining = [...previous];
  const merged = incoming.map(job => {
    const index = remaining.findIndex(old => old.id === job.id || Boolean(old.requestId && old.requestId === job.requestId));
    if (index < 0) return job;
    const old = remaining.splice(index, 1)[0];
    // An older history response must not undo a terminal event received via SSE.
    if (!isPendingRender(old) && isPendingRender(job)) return old;
    return { ...old, ...job };
  });
  return [...remaining, ...merged];
}
