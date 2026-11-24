import { Button } from 'open-design-ui/button';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

interface PrimaryNavigationRailProps extends ComponentPropsWithoutRef<'nav'> {
  footer?: ReactNode;
}

export function PrimaryNavigationRail({ children, footer, className = '', ...props }: PrimaryNavigationRailProps) {
  return (
    <nav {...props} className={`om-primary-navigation ${className}`}>
      <div className="om-primary-navigation-group">{children}</div>
      {footer && <div className="om-primary-navigation-group om-primary-navigation-footer">{footer}</div>}
    </nav>
  );
}

export const PrimaryNavigationButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(
  function PrimaryNavigationButton({ className = '', type = 'button', ...props }, ref) {
    return <Button variant="plain" {...props} ref={ref} type={type} className={`om-primary-navigation-button ${className}`} />;
  },
);
