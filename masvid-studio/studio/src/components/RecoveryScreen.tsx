import { useId, type ReactNode } from 'react';
import { ErrorNotice } from './ui/ErrorNotice';
import { DiagnosticExport } from '../motion/DiagnosticExport';

/** Shared recovery surface for failed startup and a crashed editor. */
export function RecoveryScreen({ title, message, children, feedback, fullscreen = false }: {
  title: string; message: string; children: ReactNode; feedback?: ReactNode; fullscreen?: boolean;
}) {
  const id = useId();
  return <section className="om-recovery-screen" data-fullscreen={fullscreen} aria-labelledby={id}>
    <div className="om-recovery-surface"><div className="om-recovery-content">
      <span className="motion-loading-mark om-recovery-mark" aria-hidden="true" />
      <h1 className="om-title" id={id}>{title}</h1>
      <ErrorNotice message={message} />
      <div className="om-recovery-actions">{children}</div>
      <div className="om-recovery-diagnostics"><DiagnosticExport /></div>
      {feedback && <div className="om-recovery-feedback">{feedback}</div>}
    </div></div>
  </section>;
}
