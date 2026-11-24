import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import type { ComponentPropsWithoutRef } from 'react';
import { RemixIcon } from '../../icons/RemixIcons';

type Props = Pick<ComponentPropsWithoutRef<typeof BaseCheckbox.Root>, 'aria-label' | 'checked' | 'disabled' | 'onCheckedChange'> & { mixed?: boolean };

export function Checkbox({ mixed, ...props }: Props) {
  return <BaseCheckbox.Root {...props} indeterminate={mixed} className="om-checkbox">
    <BaseCheckbox.Indicator><RemixIcon name={mixed ? 'subtract-line' : 'check-line'} size={14} /></BaseCheckbox.Indicator>
  </BaseCheckbox.Root>;
}
