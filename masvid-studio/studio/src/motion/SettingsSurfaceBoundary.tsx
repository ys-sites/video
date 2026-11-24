import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SettingsError } from './settingsPrimitives';
import { recordBrowserDiagnostic } from './diagnostics';

/** Settings failures must not unmount the editor or discard staged edits. */
export class SettingsSurfaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    recordBrowserDiagnostic('settings_error', error.message, info.componentStack ?? error.stack);
  }
  render() {
    return this.state.failed ? <SettingsError retry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}
