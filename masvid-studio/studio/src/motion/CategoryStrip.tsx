import type { ReactNode } from 'react';
import { HorizontalRail } from './HorizontalRail';

export function CategoryStrip({ label, selection, neutral, plainArrows, children }: {
  label: string; selection?: string | null; neutral?: boolean; plainArrows?: boolean; children: ReactNode;
}) {
  return <HorizontalRail label={label} className="om-category-strip" viewportClassName="om-category-strip-viewport" selection={selection} plainArrows={plainArrows}>
    <div className={neutral ? 'om-category-strip-track om-gallery-categories' : 'om-category-strip-track'}
      data-neutral={neutral || undefined}>{children}</div>
  </HorizontalRail>;
}
