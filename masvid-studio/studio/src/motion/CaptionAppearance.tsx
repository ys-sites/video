import { CAPTION_STYLES, type CaptionSettings } from '../../../shared/caption-style';
import { Button } from 'open-design-ui/button';
import { Select } from '../components/ui/Select';
import { useI18n } from '../i18n/I18n';

/** Native caption artwork is previewed inside shared Studio controls. */
export function CaptionAppearance({ settings, disabled, existing, onChange, onRecreate }: {
  settings: CaptionSettings;
  disabled: boolean;
  existing: boolean;
  onChange: (patch: Partial<CaptionSettings>) => void;
  onRecreate?: (pacing: CaptionSettings['pacing']) => void;
}) {
  const { t } = useI18n();
  return <>
    <div className="flex flex-col gap-3">
      <h3 className="text-step-11 font-semibold text-text-2">{t('Caption style')}</h3>
      <div className="grid grid-cols-1 gap-1 @min-[300px]:grid-cols-2" role="group" aria-label={t('Caption style')}>
        {CAPTION_STYLES.map(style => <Button key={style.id} aria-label={t(style.label)} aria-pressed={settings.preset === style.id} disabled={disabled} variant={settings.preset === style.id ? 'secondary' : 'ghost'} className="h-auto min-w-0 justify-start gap-2 p-2 text-left" onClick={() => onChange({ preset: style.id })}>
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm" style={{ background: style.background, color: style.color, textShadow: style.shadow, fontWeight: style.weight, fontFamily: style.id === 'cinema' ? 'Georgia,serif' : 'Arial,sans-serif', fontSize: 18 }}>Cc</span>
          <span className="min-w-0 whitespace-normal text-step-11">{t(style.label)}</span>
        </Button>)}
      </div>
      <p className="min-h-8 text-step-11 text-text-3">{t(CAPTION_STYLES.find(style => style.id === settings.preset)!.description)}</p>
    </div>
    {(!existing || onRecreate) && <div className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="text-step-11 font-semibold text-text-2">{t('Pacing')}</h3>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('Caption pacing')}>
        {(['sentence', 'word'] as const).map(pacing => <Button key={pacing} size="sm" className="h-auto min-h-8 flex-1 whitespace-normal" aria-pressed={settings.pacing === pacing} disabled={disabled || (existing && !onRecreate)} variant={settings.pacing === pacing ? 'secondary' : 'ghost'} onClick={() => { if (settings.pacing === pacing) return; if (existing) onRecreate?.(pacing); else onChange({ pacing }); }}>{t(pacing === 'sentence' ? 'By sentence' : 'Word highlight')}</Button>)}
      </div>
      <p className="text-step-11 text-text-3">{t(existing && !onRecreate ? 'Pacing is set when creating captions. Create from transcript to change it.' : existing ? 'Change pacing, then recreate captions to apply it.' : settings.pacing === 'word' ? 'Requires word timestamps from the speech model.' : 'Show one sentence or phrase at a time.')}</p>
    </div>}
    <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 @min-[300px]:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5"><span className="text-step-11 font-medium text-text-2">{t('Position')}</span>
        <Select label={t('Caption position')} value={settings.position} disabled={disabled} options={['bottom', 'center', 'top'].map(value => ({ value, label: t(value === 'bottom' ? 'Bottom' : value === 'center' ? 'Center' : 'Top') }))} onCommit={position => onChange({ position: position as CaptionSettings['position'] })} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5"><span className="text-step-11 font-medium text-text-2">{t('Text size')}</span>
        <Select label={t('Caption size')} value={String(settings.scale)} disabled={disabled} options={[...new Set([0.75, 1, 1.25, 1.5, settings.scale])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${Math.round(value * 100)}%` }))} onCommit={scale => onChange({ scale: Number(scale) })} />
      </div>
    </div>
  </>;
}
