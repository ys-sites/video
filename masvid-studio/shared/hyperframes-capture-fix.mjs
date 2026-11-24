import { registerHooks } from 'node:module';

const chromeLauncher = /\/node_modules\/puppeteer-core\/lib\/puppeteer\/node\/ChromeLauncher\.js$/;

function replace(source, before, after, count = 1) {
  if (source.split(before).length - 1 !== count) {
    throw new Error('Unsupported Hyperframes capture code; review the pinned 0.9.7 compatibility fix');
  }
  return source.replaceAll(before, after);
}

// shortcut: patch only the pinned engine in memory; remove when upstream handles current canvas APIs and socket-buffer exhaustion.
export function fixCaptureModule(url, source) {
  if (process.platform === 'darwin' && chromeLauncher.test(url)) {
    // Chrome's desktop search can register a menu bar icon even in headless mode.
    const anchor = '        const disabledFeatures = [';
    if (source.split(anchor).length !== 2) {
      process.emitWarning('OpenMotion could not disable Chrome desktop search because the Puppeteer launcher has changed.');
      return source;
    }
    return source.replace(anchor, anchor + "\n            'OmniboxEverywhere',");
  }
  if (url.endsWith('/node_modules/hyperframes/dist/chunk-IAZ2A7D6.js')) {
    source = replace(source, '      canvas.setAttribute("layoutsubtree", "");',
      `      canvas.setAttribute("layoutsubtree", "");
      if ("content" in HTMLCanvasElement.prototype) {
        canvas.setAttribute("content", "drawable");
        root.setAttribute("drawable", "");
      }`);
    return replace(source, 'var TRANSIENT_BROWSER_ERROR_PATTERNS = [',
      'var TRANSIENT_BROWSER_ERROR_PATTERNS = [\n  /net::ERR_NO_BUFFER_SPACE\\b/i,');
  }
  if (!url.endsWith('/node_modules/hyperframes/dist/chunk-Y2R4N6HQ.js')) return source;
  source = replace(source,
    '      if (options.allowRetry && isTransientCaptureRetryEligible(failure.kind, remaining, transientRetriesUsed)) {',
    `      const bufferExhaustion = failure.kind === "transient_browser" && /net::ERR_NO_BUFFER_SPACE\\b/i.test(failure.message);
      if (bufferExhaustion && transientRetriesUsed >= MAX_TRANSIENT_CAPTURE_RETRIES) {
        options.log.warn("[Render] Socket buffers remain unavailable after the automatic retry. Close unused applications or other exports, then retry the export (CLI: --workers 1).", { error: failure.message });
        throw error;
      }
      if (options.allowRetry && isTransientCaptureRetryEligible(failure.kind, remaining, transientRetriesUsed)) {`);
  source = replace(source,
    `        transientRetriesUsed++;
        options.log.warn(
          "[Render] Transient browser failure during capture; retrying once with a fresh session.",`,
    `        transientRetriesUsed++;
        const nextWorkers = bufferExhaustion ? getNextRetryWorkerCount(currentWorkers) : currentWorkers;
        options.log.warn(
          bufferExhaustion
            ? "[Render] Socket buffers unavailable; retrying once with fewer workers and fresh sessions."
            : "[Render] Transient browser failure during capture; retrying once with a fresh session.",`);
  source = replace(source,
    `            workers: currentWorkers,
            missingFrames: remainingCount,
            transientRetriesUsed,`,
    `            workers: currentWorkers,
            nextWorkers,
            missingFrames: remainingCount,
            transientRetriesUsed,`);
  source = replace(source,
    `        pendingTransientRetry = true;
        continue;`,
    `        pendingTransientRetry = true;
        currentWorkers = nextWorkers;
        continue;`);
  return replace(source,
    'Capture attempt made no forward progress; composition is likely structurally broken, not retrying.',
    'Capture attempt produced no frames; see the capture error for the cause. No further automatic retry is available.', 2);
}

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!/\/node_modules\/hyperframes\/dist\/chunk-(?:IAZ2A7D6|Y2R4N6HQ)\.js$/.test(url) &&
        !(process.platform === 'darwin' && chromeLauncher.test(url))) return loaded;
    return { ...loaded, source: fixCaptureModule(url, typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8')) };
  },
});
