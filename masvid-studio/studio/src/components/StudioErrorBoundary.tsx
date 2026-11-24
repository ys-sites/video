import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { useStudioHost } from '../motion/StudioHost';
import { Component, type ErrorInfo, type ReactNode } from "react";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { CrashFeedbackPrompt } from "./feedback/CrashFeedbackPrompt";
import { RecoveryScreen } from './RecoveryScreen';
import { recordBrowserDiagnostic } from '../motion/diagnostics';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class StudioErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordBrowserDiagnostic('react_crash', error.message, error.stack);
    console.error("[Studio] Uncaught error:", error, info.componentStack);
    trackStudioEvent("crash", {
      error_message: error.message,
      error_name: error.name,
      stack_trace: error.stack?.slice(0, 4000) ?? null,
      component_stack: info.componentStack?.slice(0, 2000) ?? null,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return <CrashScreen error={this.state.error} retry={() => this.setState({ error: null })} />;
  }
}

function CrashScreen({ error, retry }: { error: Error; retry: () => void }) {
  const { t } = useI18n();
  const host = useStudioHost();
  return (
      <RecoveryScreen fullscreen title={t('Something went wrong')} message={error.message}
        feedback={host?.feedback !== false ? <CrashFeedbackPrompt /> : undefined}>
        <Button variant="ghost" className="om-button h-auto" data-primary onClick={retry}>{t('Try again')}</Button>
        <Button variant="ghost" className="om-button h-auto" onClick={() => window.location.reload()}>{t('Reload Studio')}</Button>
      </RecoveryScreen>
  );
}
