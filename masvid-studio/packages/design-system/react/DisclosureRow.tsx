import type { ComponentPropsWithoutRef, ReactNode } from 'react';

interface DisclosureRowProps extends ComponentPropsWithoutRef<'div'> {
  active: boolean;
  action: ReactNode;
}

/** Project-group row presentation with an independent trailing action. */
export function DisclosureRow({ active, action, children, className, ...props }: DisclosureRowProps) {
  return (
    <div {...props} className={className ? `om-disclosure-row ${className}` : 'om-disclosure-row'} data-active={active}>
      {children}
      <div className="om-disclosure-row-action">{action}</div>
    </div>
  );
}
