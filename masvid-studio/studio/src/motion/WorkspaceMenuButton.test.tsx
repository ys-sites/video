// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceFrame, WorkspaceMenuButton } from './WorkspaceFrame';
import { I18nProvider } from '../i18n/I18n';

vi.mock('./tracking', () => ({ trackMotion: vi.fn(async () => 'queued') }));
vi.mock('./useWorkspace', () => ({
  navigateWorkspace: vi.fn(),
  useWorkspace: () => ({
    status: { projectId: 'demo' }, projects: [{ id: 'demo', title: 'Demo' }], busy: false,
    error: '', errorSource: 'connection', clearError: vi.fn(), open: vi.fn(), openSession: vi.fn(),
    startSession: vi.fn(), create: vi.fn(), home: vi.fn(), rename: vi.fn(),
  }),
}));
vi.mock('./AccountSettings', () => ({ useAccountSummary: () => ({ account: null }) }));
vi.mock('./ModelSwitcher', () => ({ ModelSwitcher: () => null }));
vi.mock('./githubRepository', async importOriginal => ({ ...await importOriginal<typeof import('./githubRepository')>(), readRepositoryStars: vi.fn(async () => null) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  localStorage.clear();
  history.replaceState(null, '', '/?project=demo');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const menu = () => container.querySelector<HTMLButtonElement>('.motion-workspace-menu')!;
const sidebarToggle = () => container.querySelector<HTMLButtonElement>('#om-project-navigation .motion-sidebar-brand button')!;

it('keeps a state-aware tooltip on the project-list toggle in both states', async () => {
  await act(async () => root.render(<I18nProvider initialLocale="en"><WorkspaceFrame waitForSaves={async () => {}}><WorkspaceMenuButton /></WorkspaceFrame></I18nProvider>));
  // Collapsing the docked navigation is a toggle, so it keeps its label and tooltip.
  expect(menu().getAttribute('aria-label')).toBe('Collapse project list');
  await expectHint(menu(), 'Collapse project list');
  await act(async () => menu().click());
  expect(menu().getAttribute('aria-label')).toBe('Open project list');
  await expectHint(menu(), 'Open project list');
});

it('keeps the state-aware tooltip on the docked sidebar toggle', async () => {
  await act(async () => root.render(<I18nProvider initialLocale="en"><WorkspaceFrame waitForSaves={async () => {}}><WorkspaceMenuButton /></WorkspaceFrame></I18nProvider>));
  // The docked layout's collapse control is the same toggle, so it keeps its tooltip.
  expect(sidebarToggle().getAttribute('aria-label')).toBe('Close project list');
  await expectHint(sidebarToggle(), 'Close project list');
});

async function expectHint(trigger: HTMLButtonElement, label: string) {
  act(() => trigger.blur());
  await act(async () => { trigger.focus(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(trigger.hasAttribute('title')).toBe(false);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(label);
}
