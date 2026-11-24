import type { SkillCategory } from './skillCategories';
import type { TemplateCollection } from './workspacePageRouting';
import { createContext, useContext, type ReactNode } from 'react';
import type { useWorkspace } from './useWorkspace';
import type { GalleryTemplate } from '../../../shared/catalog';
import type { McpEntry } from './pageTracking';

export type WorkspaceChrome = {
  workspace: ReturnType<typeof useWorkspace>;
  switchingDisabled: boolean;
  saveState: string;
  openLibrary: (trigger?: HTMLElement, template?: GalleryTemplate, collection?: TemplateCollection) => void;
  /** Opens the MCP connection page; `entry` records which control opened it. */
  openConnections: (entry: McpEntry) => void;
  openModelSettings: () => void;
  openProviderSettings?: (provider: string) => void;
  openAccountSettings?: () => void;
  openSubscriptionSettings?: () => void;
  openHome: () => void;
  openAssets: () => void;
  assetsOpen: boolean;
  openSkills: (category?: SkillCategory | null, trigger?: HTMLElement) => void;
  skillsOpen: boolean;
  toggleSidebar: () => void;
  sidebarOpen: boolean;
  navigationCollapsed: boolean;
  projectNavigation?: ReactNode;
  settingsOpen?: boolean;
  registerEditor: (guard: EditorGuard | null) => void;
  beforeViewChange: () => Promise<void>;
};
export type EditorGuard = { waitForSaves: () => Promise<void>; blocked: boolean; saveState: string; message: string };
export const WorkspaceChromeContext = createContext<WorkspaceChrome | null>(null);
export const useOptionalWorkspaceChrome = () => useContext(WorkspaceChromeContext);
export function useWorkspaceChrome() {
  const value = useContext(WorkspaceChromeContext);
  if (!value) throw new Error('Workspace controls require WorkspaceFrame');
  return value;
}
