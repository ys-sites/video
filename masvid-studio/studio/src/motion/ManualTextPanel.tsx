import { useRef, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { usePlayerStore } from '../player/store/playerStore';
import { useStudioShellContext } from '../contexts/StudioContext';
import { useNativeCaptionWrite } from './useNativeCaptionWrite';

export function ManualTextPanel({ kind = 'text' }: { kind?: 'text' | 'caption' }) {
  const { t } = useI18n(), shell = useStudioShellContext(), { write, busy, disabled } = useNativeCaptionWrite();
  const [text, setText] = useState(''), [duration, setDuration] = useState(3);
  const input = useRef<HTMLTextAreaElement>(null);
  const add = async () => {
    const content = text.trim() || t('Default text');
    const lines = kind === 'caption' ? content.split(/\n+/).filter(Boolean) : [content];
    const ok = await write({ command: 'caption_add', textKind: kind, timelineStart: usePlayerStore.getState().currentTime,
      segments: lines.map((text, index) => ({ id: `cue-${index + 1}`, text, start: index * duration, end: (index + 1) * duration })) });
    if (ok && kind === 'caption') setText('');
  };
  return <section aria-label={t(kind === 'text' ? 'Text' : 'Manual captions')} className="flex min-h-0 flex-1 flex-col" onKeyDown={event => event.stopPropagation()}>
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      <label className="flex flex-col gap-2 text-step-11 text-text-2">{t(kind === 'text' ? 'Text' : 'Caption text')}
        <span className="om-field"><textarea ref={input} aria-label={t(kind === 'text' ? 'Text content' : 'Caption text')} rows={5} maxLength={20000} value={text} placeholder={t('Default text')} disabled={disabled} onChange={event => setText(event.target.value)} /></span>
      </label>
      {kind === 'caption' && <p className="text-step-11 text-text-3">{t('Each line becomes a caption. Adjust its timing on the timeline.')}</p>}
      <label className="flex items-center justify-between gap-3 text-step-11 text-text-2">{t(kind === 'text' ? 'Duration (seconds)' : 'Seconds per caption')}
        <span className="om-field w-24"><input aria-label={t('Duration (seconds)')} type="number" min={0.1} max={3600} step={0.1} disabled={disabled} value={Number.isFinite(duration) ? duration : ''} onChange={event => setDuration(event.target.value === '' ? NaN : Number(event.target.value))} /></span>
      </label>
      <p className="text-step-11 leading-relaxed text-text-3">{t('Added at the playhead. Select the clip to edit its text, font and position.')}</p>
    </div>
    <div className="shrink-0 border-t border-border p-3"><Button variant="primary" className="w-full" disabled={disabled || !Number.isFinite(duration) || duration < 0.1 || duration > 3600 || (kind === 'caption' && !text.trim()) || Boolean(shell.writeBlockedReason)} onClick={() => void add()}>{t(busy ? 'Adding…' : kind === 'text' ? 'Add text' : 'Add captions')}</Button></div>
  </section>;
}
