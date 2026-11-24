import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { RemixIcon } from '../../design-system/react/RemixIcons';
import { Button } from 'open-design-ui/button';

interface CopyButtonProps {
  text: string;
  label: string;
  accessibleLabel?: string;
  icon?: string;
  compact?: boolean;
  failure?: string;
}

const CopyFeedbackContext = createContext<(message: string) => void>(() => {});

export function CopyFeedback({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ message: string }>();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <CopyFeedbackContext.Provider value={message => setNotice({ message })}>
      {children}
      <div className="motion-inline-toast" role="status" hidden={!notice}>{notice?.message}</div>
    </CopyFeedbackContext.Provider>
  );
}

export function CopyButton({ text, label, accessibleLabel = label, icon = 'file-copy-line', compact, failure = 'Could not copy.' }: CopyButtonProps) {
  const notify = useContext(CopyFeedbackContext);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Copied to clipboard');
    } catch {
      notify(failure);
    }
  };

  return (
    <Button type="button" variant={compact ? 'ghost' : 'secondary'} size={compact ? 'sm' : 'md'}
      aria-label={accessibleLabel} onClick={copy} icon={<RemixIcon name={icon} size={14} />}>
      {label}
    </Button>
  );
}
