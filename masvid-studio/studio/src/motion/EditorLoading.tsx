import { Skeleton } from '../components/ui/Skeleton';
import { MotionLoading } from './MotionLoading';

export type EditorLoadingLayout = { header: number; timeline: number; left: number; right: number };

/** Keep only measured chrome geometry; never retain another project's DOM or data. */
export function readEditorLoadingLayout(surface: HTMLElement | null): EditorLoadingLayout | null {
  const editor = surface?.querySelector('[data-editor-initializing="false"]');
  if (!surface || !editor) return null;
  const header = editor.querySelector('.motion-studio-header')?.getBoundingClientRect();
  const timeline = editor.querySelector('[data-studio-timeline]')?.getBoundingClientRect();
  const preview = editor.querySelector('[data-preview-pan-surface]')?.closest('.dv-groupview')?.getBoundingClientRect();
  const bounds = surface.getBoundingClientRect();
  if (!header || !timeline || !bounds.height) return null;
  return { header: header.height, timeline: timeline.height,
    left: preview ? Math.max(0, preview.left - bounds.left) : 0,
    right: preview ? Math.max(0, bounds.right - preview.right) : 0 };
}

export function EditorLoading({ layout }: { layout?: EditorLoadingLayout | null }) {
  if (!layout) return <div className="motion-editor-loading"><MotionLoading /></div>;
  return <div className="motion-editor-loading">
    <div className="motion-editor-placeholder" aria-hidden="true"
      style={{ gridTemplateRows: `${layout.header}px minmax(0, 1fr) min(${layout.timeline}px, calc(100% - ${layout.header}px))` }}>
      <div className="motion-editor-placeholder-header"><Skeleton animated={false} style={{ width: '20%', height: 'var(--motion-space-16)' }} /></div>
      <div className="motion-editor-placeholder-panels" style={{ gridTemplateColumns: `${layout.left}px minmax(0, 1fr) ${layout.right}px` }}><div /><div /><div /></div>
      <div className="motion-editor-placeholder-timeline">{['75%', '55%'].map(width => <Skeleton key={width} animated={false} style={{ width, height: 'var(--motion-space-24)' }} />)}</div>
    </div>
    <MotionLoading overlay />
  </div>;
}
