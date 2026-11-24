import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';
import { RemixIcon } from '../../icons/RemixIcons';

/** Shared radio semantics, keyboard navigation and selected-state treatment. */
export function ChoiceTiles<T extends string>({ label, value, options, onChange, disabled, className }: {
  label: string; value: T; options: { value: T; label: string; icon: ReactNode }[];
  onChange: (value: T) => void; disabled?: boolean; className?: string;
}) {
  return <RadioGroup aria-label={label} value={value} onValueChange={onChange} disabled={disabled} className={className}>
    {options.map(option => <Radio.Root key={option.value} value={option.value} aria-label={option.label} title={option.label} className="om-choice-tile">
      {option.icon}<span className="om-choice-tile-label">{option.label}</span>
      <Radio.Indicator className="om-choice-tile-check"><RemixIcon name="check-line" size={10} /></Radio.Indicator>
    </Radio.Root>)}
  </RadioGroup>;
}
