export function CoverPlaceholder({ fill = false, className = '' }: { fill?: boolean; className?: string }) {
  return <span aria-hidden="true" className={['om-cover-placeholder', fill && 'om-cover-placeholder--fill', className].filter(Boolean).join(' ')} />;
}
