import type { ScenarioBriefField } from '../../../shared/scenarios';
import { useI18n } from '../i18n/I18n';
import { formatBriefFieldValue } from './briefVersion';

type TextPart = { kind: 'same' | 'removed' | 'added'; text: string };

function textChanges(before: string, after: string, segmenter?: Intl.Segmenter): TextPart[] {
  const replacement: TextPart[] = [{ kind: 'removed', text: before }, { kind: 'added', text: after }];
  if (!segmenter || !before || !after) return replacement;

  const left = Array.from(segmenter.segment(before), part => part.segment);
  const right = Array.from(segmenter.segment(after), part => part.segment);
  const width = right.length + 1;
  const cells = (left.length + 1) * width;
  if (cells > 200_000) return replacement;

  // Use the longest common token sequence to preserve text between separate edits.
  const lengths = new Uint16Array(cells);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const cell = i * width + j;
      lengths[cell] = left[i] === right[j]
        ? 1 + lengths[cell + width + 1]
        : Math.max(lengths[cell + width], lengths[cell + 1]);
    }
  }

  const parts: TextPart[] = [];
  const append = (kind: TextPart['kind'], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      append('same', left[i++]);
      j++;
    } else if (lengths[i * width + j + width] >= lengths[i * width + j + 1]) {
      append('removed', left[i++]);
    } else {
      append('added', right[j++]);
    }
  }
  if (i < left.length) append('removed', left.slice(i).join(''));
  if (j < right.length) append('added', right.slice(j).join(''));
  return parts;
}

function ComparedValue({ side, parts }: { side: 'before' | 'after'; parts: TextPart[] }) {
  const { t } = useI18n();
  const before = side === 'before';
  const Mark = before ? 'del' : 'ins';
  return (
    <div className="om-scenario-brief-compare-value">
      <dt>{t(before ? 'Before' : 'After')}</dt>
      <dd>
        {parts.length > 0 ? parts.map((part, index) =>
          part.kind === 'same' ? part.text : <Mark key={index}>{part.text}</Mark>,
        ) : <span className="om-muted">{t('Not set')}</span>}
      </dd>
    </div>
  );
}

export function BriefVersionComparison({ fields, before, after }: {
  fields: readonly ScenarioBriefField[];
  before: Record<string, string | string[]>;
  after: Record<string, string | string[]>;
}) {
  const { locale, t } = useI18n();
  const list = new Intl.ListFormat(locale, { style: 'short', type: 'unit' });
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  const changes = fields.flatMap(field => {
    const previous = formatBriefFieldValue(field, before[field.id], t, list);
    const next = formatBriefFieldValue(field, after[field.id], t, list);
    if (previous === next) return [];
    const parts = textChanges(previous, next, field.options || field.kind === 'list' ? undefined : segmenter);
    return [{ field, parts }];
  });

  return (
    <div className="om-scenario-brief-compare">
      <p className="om-muted">
        {changes.length ? t('Changed fields ({count})', { count: changes.length }) : t('No field changes')}
      </p>
      {changes.map(({ field, parts }) => (
        <div key={field.id} className="om-scenario-brief-compare-field" data-brief-change={field.id}>
          <strong>{t(field.label)}</strong>
          <dl>
            <ComparedValue side="before" parts={parts.filter(part => part.text && part.kind !== 'added')} />
            <ComparedValue side="after" parts={parts.filter(part => part.text && part.kind !== 'removed')} />
          </dl>
        </div>
      ))}
    </div>
  );
}
