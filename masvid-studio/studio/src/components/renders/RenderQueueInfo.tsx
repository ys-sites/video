import { Tooltip } from "../ui/Tooltip";
import { useI18n } from "../../i18n/I18n";
import type { Translate } from "../../i18n/messages";
import type { RenderJob } from "./useRenderQueue";
import { CANVAS_DIMENSIONS } from '@hyperframes/parsers';

function renderStageLabel(stage: string | undefined, t: Translate, locale: string): string {
  if (!stage) return t("Rendering");
  if (locale === "en") return stage;
  const frames = /^(Capturing frame|Encoding frame) (\d+\/\d+)(?: \(\d+ workers?\))?$/.exec(stage);
  if (frames) return `${t(frames[1])} ${frames[2]}`;
  const browsers = /^Starting browsers \((\d+\/\d+) ready\)$/.exec(stage);
  if (browsers) return `${t("Starting browsers")} ${browsers[1]}`;
  const translated = t(stage);
  return translated;
}

function formatTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(timestamp);
}

function outputSettings(settings: RenderJob['settings'], t: Translate): string {
  if (!settings) return '';
  const value = (key: string) => settings[key] ?? settings[`render_${key}`];
  const format = value('format');
  const quality = value('quality');
  const fps = value('fps');
  const resolution = value('resolution');
  const qualityLabels: Record<string, string> = { draft: 'Draft', standard: 'Standard', high: 'High Quality' };
  const dimensions = typeof resolution === 'string' && Object.hasOwn(CANVAS_DIMENSIONS, resolution)
    ? CANVAS_DIMENSIONS[resolution as keyof typeof CANVAS_DIMENSIONS] : undefined;
  return [
    typeof format === 'string' && /^(mp4|mov|webm|gif)$/.test(format) ? format.toUpperCase() : '',
    format !== 'mov' && typeof quality === 'string' && Object.hasOwn(qualityLabels, quality) ? t(qualityLabels[quality]) : '',
    typeof fps === 'number' && Number.isFinite(fps) ? t('{fps} fps', { fps }) : '',
    dimensions ? `${dimensions.width}×${dimensions.height}` : resolution === 'auto' ? t('Auto') : '',
  ].filter(Boolean).join(' · ');
}

export function RenderQueueInfo({ job }: { job: RenderJob }) {
  const { t, locale } = useI18n();
  const isRendering = job.status === "rendering";
  const awaitingResult = job.status === 'unknown' || job.status === 'cancelling';
  const settings = outputSettings(job.settings, t);
  const statusLabels: Record<RenderJob['status'], string> = {
    rendering: 'Rendering', complete: 'Export completed', failed: 'Export failed', cancelled: 'Cancelled',
    cancelling: 'Cancelling…', unknown: 'Result needs checking',
  };
  const authoredFilename = (job.status === 'failed' && ['Export failed', 'Export blocked'].includes(job.filename))
    || (job.status === 'unknown' && job.filename === 'Export result pending');
  const filename = authoredFilename ? t(job.filename) : job.filename;
  return (
    <div className="flex-1 min-w-0 pr-2">
      <div className="flex items-center gap-1.5">
        <Tooltip label={filename} wrap><span className="text-step-12 font-medium text-text-2 truncate">{filename}</span></Tooltip>
      </div>

      {isRendering && (
        <div className="mt-1">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-step-11 text-text-4">{renderStageLabel(job.stage, t, locale)}</span>
            <span className="text-step-11 font-mono text-accent-ink">{job.progress}%</span>
          </div>
          <div
            className="w-full h-1 bg-border rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={job.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("Render progress: {value0}%", { value0: job.progress })}
          >
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      )}

      {!isRendering && <span className="text-step-11 text-text-3 mt-0.5 block">{t(statusLabels[job.status])}</span>}
      {awaitingResult && job.stage && <div className="mt-1 text-step-11 text-text-4">{t('Last confirmed stage: {stage}', { stage: renderStageLabel(job.stage, t, locale) })}</div>}
      {awaitingResult && job.lastCheckedAt !== undefined && <div className="mt-1 text-step-11 text-text-5">{t('Last checked: {time}', { time: formatTime(job.lastCheckedAt, locale) })}</div>}
      <div className="mt-1 text-step-11 text-text-5">
        <time dateTime={new Date(job.createdAt).toISOString()}>{t('Started: {time}', { time: formatTime(job.createdAt, locale) })}</time>
        {settings && <span className="block">{settings}</span>}
      </div>
    </div>
  );
}
