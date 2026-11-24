import type { SettingsSection } from './workspacePageRouting';

export type SettingsSectionMeta = {
  id: SettingsSection;
  label: string;
  icon: string;
  group: string;
};

export const settingsCenterSections: readonly SettingsSectionMeta[] = [
  { id: 'account', label: 'Account', icon: 'user-3-line', group: 'Personal' },
  { id: 'subscription', label: 'Subscription & usage', icon: 'bank-card-line', group: 'Personal' },
  { id: 'providers', label: 'Model providers', icon: 'brain-line', group: 'Models & connections' },
  { id: 'models', label: 'Default Agent & models', icon: 'box-3-line', group: 'Models & connections' },
  { id: 'local', label: 'Local Agents', icon: 'computer-line', group: 'Models & connections' },
  { id: 'mcp', label: 'MCP · Connect Agent', icon: 'plug-line', group: 'Models & connections' },
  { id: 'general', label: 'General', icon: 'equalizer-line', group: 'Preferences' },
  { id: 'appearance', label: 'Appearance', icon: 'palette-line', group: 'Preferences' },
  { id: 'privacy', label: 'Privacy & data', icon: 'shield-check-line', group: 'Preferences' },
  { id: 'help', label: 'Help', icon: 'question-line', group: 'Resources' },
  { id: 'about', label: 'About OpenMotion', icon: 'information-line', group: 'Resources' },
];

export function settingsSectionLabel(section: SettingsSection): string {
  return settingsCenterSections.find(item => item.id === section)?.label ?? 'Settings';
}
