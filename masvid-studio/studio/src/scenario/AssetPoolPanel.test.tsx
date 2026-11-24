// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { PoolItem } from '../../../shared/scenario-runs';
import { findScenario } from '../../../shared/scenarios';
import { I18nProvider } from '../i18n/I18n';
import * as assetClient from '../motion/assetClient';
import { AssetUploadError } from '../motion/assetUploadError';
import { AssetPoolPanel, type AssetPoolPanelProps } from './AssetPoolPanel';

const IMG_ITEM_1: PoolItem = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'image',
  ref: {
    type: 'asset',
    assetId: '11111111-1111-4111-8111-111111111111',
    versionId: '22222222-2222-4222-8222-222222222222',
  },
  label: 'Hero Tote Shot',
  source: 'generated',
  stepId: 'product-images',
  tags: [],
  pinned: false,
  addedAt: 1700000001000,
};

const IMG_ITEM_2: PoolItem = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'image',
  ref: {
    type: 'asset',
    assetId: '33333333-3333-4333-8333-333333333333',
    versionId: '44444444-4444-4444-8444-444444444444',
  },
  label: 'Uploaded Flatlay',
  source: 'upload',
  stepId: null,
  tags: [],
  pinned: true,
  addedAt: 1700000000500,
};

const TEXT_ITEM: PoolItem = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  kind: 'text',
  ref: {
    type: 'text',
    stepId: 'social',
    iterationId: '55555555-5555-4555-8555-555555555555',
  },
  label: 'Black Friday Launch Posts',
  source: 'step-output',
  stepId: 'social',
  tags: [],
  pinned: false,
  addedAt: 1700000002000,
};

let container: HTMLDivElement;
let root: Root;

function baseProps(overrides: Partial<AssetPoolPanelProps> = {}): AssetPoolPanelProps {
  const scenario = findScenario('black-friday')!;
  return {
    scenario,
    run: null,
    currentStep: scenario.steps.find(s => s.id === 'detail-page')!,
    items: [IMG_ITEM_1, IMG_ITEM_2, TEXT_ITEM],
    highlightedIds: new Set(),
    open: true,
    onOpenChange: vi.fn(),
    pickRequest: null,
    onConfirmPick: vi.fn(),
    onCancelPick: vi.fn(),
    onAddItems: vi.fn().mockResolvedValue(['new-id']),
    onUpdateItem: vi.fn().mockResolvedValue(undefined),
    onRemoveItem: vi.fn().mockResolvedValue(undefined),
    onUseInCurrentStep: vi.fn().mockResolvedValue(undefined),
    onOpenDesignProject: vi.fn(),
    onOpenMotionProject: vi.fn().mockResolvedValue(true),
    toast: { showToast: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('AssetPoolPanel', () => {
  it('sorts pinned items first, applies immediate kind filters with live counts, and uses only ODUI buttons', async () => {
    const props = baseProps();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    // Every rendered <button> must carry data-odui-component (no raw native buttons).
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.hasAttribute('data-odui-component')).toBe(true);
    }

    // Pinned item sorts first ahead of newer unpinned items.
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-pool-item]'));
    expect(cards.map(c => c.getAttribute('data-pool-item'))).toEqual([
      IMG_ITEM_2.id,
      TEXT_ITEM.id,
      IMG_ITEM_1.id,
    ]);

    // Kind chip counts reflect only non-zero asset kinds in the panel (plus All).
    const kindLabels = Array.from(container.querySelectorAll<HTMLButtonElement>('.om-scenario-kind-chips button')).map(
      btn => btn.textContent ?? '',
    );
    expect(kindLabels.some(txt => txt.includes('Video'))).toBe(false);
    expect(kindLabels.some(txt => txt.includes('Audio'))).toBe(false);
    expect(kindLabels.some(txt => txt.includes('Pages'))).toBe(false);
    expect(kindLabels.some(txt => txt.includes('Motion'))).toBe(false);
    const imagesChip = Array.from(container.querySelectorAll<HTMLButtonElement>('.om-scenario-kind-chips button')).find(
      btn => btn.textContent?.includes('Images'),
    )!;
    expect(imagesChip.textContent).toContain('2');

    // Clicking Images filters immediately to the 2 images.
    await act(async () => {
      imagesChip.click();
    });
    const filteredCards = Array.from(container.querySelectorAll<HTMLElement>('[data-pool-item]'));
    expect(filteredCards).toHaveLength(2);
    expect(filteredCards.every(card => card.getAttribute('data-kind') === 'image')).toBe(true);

    // Active filter chip appears and clicking Clear all resets filters.
    const clearAllBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.om-scenario-active-filters button'),
    ).find(btn => btn.textContent?.includes('Clear all'))!;
    await act(async () => {
      clearAllBtn.click();
    });
    expect(container.querySelectorAll('[data-pool-item]')).toHaveLength(3);
  });

  it('lists accepted formats and includes valid files when a mixed upload contains an SVG', async () => {
    const uploadSpy = vi.spyOn(assetClient, 'uploadLibraryAsset')
      .mockRejectedValueOnce(new AssetUploadError('rejected', 'unsupported'))
      .mockResolvedValue({
        id: '99999999-9999-4999-8999-999999999999',
        name: 'product.png',
        modality: 'image',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        currentVersionId: '88888888-8888-4888-8888-888888888888',
        versions: [
          {
            id: '88888888-8888-4888-8888-888888888888',
            createdAt: Date.now(),
            source: 'upload',
            filename: 'product.png',
            mimeType: 'image/png',
            bytes: 128,
            sha256: 'a'.repeat(64),
            references: [],
          },
        ],
      });

    const props = baseProps({ items: [] });
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    // Empty Assets panel hides zero-count filter chips and Step filter.
    expect(container.querySelector('.om-scenario-pool-filters')).toBeNull();
    expect(container.querySelector('.om-scenario-pool-title')?.textContent).toBe('Assets');

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept.split(',')).toEqual(expect.arrayContaining(['.png', '.mp4', '.mp3']));
    expect(input.accept).not.toContain('.svg');
    expect(container.querySelector('.om-scenario-pool-upload-hint--empty')?.textContent).toContain('Images (PNG');
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    const file = new File(['png-bytes'], 'product.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [svg, file], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(uploadSpy).toHaveBeenCalledWith(file);
    expect(props.onAddItems).toHaveBeenCalledWith([
      {
        ref: {
          type: 'asset',
          assetId: '99999999-9999-4999-8999-999999999999',
          versionId: '88888888-8888-4888-8888-888888888888',
        },
        label: 'product.png',
        stepId: null,
        source: 'upload',
      },
    ]);
    expect(props.toast.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Uploaded 1, not uploaded 1. Known issue: unsupported file formats.'),
      'error',
      'feedback',
    );
  });

  it('filters by accepted kinds in pick mode and returns selected ids on confirm', async () => {
    const onConfirmPick = vi.fn();
    const onCancelPick = vi.fn();
    const props = baseProps({
      pickRequest: {
        slot: 'embedImages',
        kinds: ['image'],
        max: 2,
        selected: [IMG_ITEM_1.id],
      },
      onConfirmPick,
      onCancelPick,
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    // Only the 2 image items are shown; text item is hidden in image pick mode.
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-pool-item]'));
    expect(cards).toHaveLength(2);
    expect(container.querySelector('.om-scenario-pool-title-group .om-badge')?.textContent).toBe('2');
    expect(container.querySelector('[data-pool-kind="all"] .om-scenario-chip-count')?.textContent).toBe('2');

    // Select the second image as well.
    const checkbox2 = container.querySelector<HTMLElement>(
      `[aria-label="Select ${IMG_ITEM_2.label}"]`,
    )!;
    await act(async () => {
      checkbox2.click();
    });

    // Click "Use 2 selected".
    const useBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.om-scenario-pick-actions button'),
    ).find(btn => btn.textContent?.includes('Use 2 selected'))!;
    expect(useBtn).toBeTruthy();
    await act(async () => {
      useBtn.click();
    });

    expect(onConfirmPick).toHaveBeenCalledWith([IMG_ITEM_1.id, IMG_ITEM_2.id]);
  });

  it('opens a picker with its own filters and counts only eligible assets still in the pool', async () => {
    const props = baseProps();
    const render = (overrides: Partial<AssetPoolPanelProps> = {}) => act(async () => {
      root.render(<I18nProvider initialLocale="en"><AssetPoolPanel {...props} {...overrides} /></I18nProvider>);
    });
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.om-scenario-kind-chip[data-pool-kind="text"]')!.click();
    });
    const cardIds = () => [...container.querySelectorAll('[data-pool-item]')].map(card => card.getAttribute('data-pool-item'));
    expect(cardIds()).toEqual([TEXT_ITEM.id]);

    const request: AssetPoolPanelProps['pickRequest'] = {
      slot: 'references', kinds: ['image'], max: 1, selected: [IMG_ITEM_1.id],
    };
    await render({ pickRequest: request });
    expect(cardIds()).toHaveLength(2);
    await render({ pickRequest: request, items: [IMG_ITEM_2, TEXT_ITEM] });
    expect(cardIds()).toEqual([IMG_ITEM_2.id]);
    expect(container.querySelector('.om-scenario-pool-title-group .om-badge')?.textContent).toBe('1');
    expect(container.querySelector('.om-scenario-pick-actions button')?.textContent).toBe('Use 0 selected');

    await render();
    expect(cardIds()).toEqual([TEXT_ITEM.id]);
  });

  it('filters by source step in the anchored step-filter popover and supports clear-all', async () => {
    const props = baseProps();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    const stepFilterBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      btn => btn.textContent?.includes('Step filter'),
    )!;
    await act(async () => {
      stepFilterBtn.click();
      await Promise.resolve();
    });

    // Check "Added manually" inside the popover portal.
    const manualCheckbox = document.querySelector<HTMLElement>('[aria-label="Added manually"]')!;
    expect(manualCheckbox).toBeTruthy();
    await act(async () => {
      manualCheckbox.click();
    });

    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-pool-item]'));
    expect(cards.map(c => c.getAttribute('data-pool-item'))).toEqual([IMG_ITEM_2.id]);

    // Clear all inside popover restores all 3 items.
    const clearAll = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.om-scenario-popover-footer button'),
    ).find(btn => btn.textContent?.includes('Clear all'))!;
    await act(async () => {
      clearAll.click();
    });
    expect(container.querySelectorAll('[data-pool-item]')).toHaveLength(3);
  });

  it('removes only the workflow binding via card menu and notifies user the original workspace asset was kept', async () => {
    const props = baseProps();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    const card = container.querySelector<HTMLElement>(`[data-pool-item="${IMG_ITEM_1.id}"]`)!;
    const menuTrigger = card.querySelector<HTMLButtonElement>('button[aria-label="Asset actions"]')!;
    await act(async () => {
      menuTrigger.click();
      await Promise.resolve();
    });

    const removeItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      item => item.textContent?.includes('Remove from workflow'),
    )!;
    expect(removeItem).toBeTruthy();
    await act(async () => {
      removeItem.click();
      await Promise.resolve();
    });

    expect(props.onRemoveItem).toHaveBeenCalledWith(IMG_ITEM_1.id);
    expect(props.toast.showToast).toHaveBeenCalledWith(
      'Removed from workflow. Original workspace asset was kept.',
      'info',
      'feedback',
    );
  });

  it('opens the workspace AssetPicker from the empty state Pick from workspace button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ assets: [], total: 0, nextOffset: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const props = baseProps({ items: [] });
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    const pickBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Pick from workspace'),
    )!;
    await act(async () => {
      pickBtn.click();
      await Promise.resolve();
    });

    expect(document.querySelector('.om-asset-picker')).toBeTruthy();
  });

  it('supports export selection bar, Export popover options, Sync assets, and Collapse shared assets', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const onExportBundle = vi.fn().mockResolvedValue(null);
    const onCopySummaryJson = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onToggleCollapsed = vi.fn();

    const props = baseProps({
      onExportBundle,
      onCopySummaryJson,
      onRefresh,
      onToggleCollapsed,
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    // Header actions: Sync assets and Collapse assets.
    const syncBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Sync assets"]')!;
    const collapseBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Collapse assets"]')!;
    await act(async () => {
      syncBtn.click();
      collapseBtn.click();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    // Enter export selection mode, select all visible items, and click Export (3).
    const selectToggleBtn = container.querySelector<HTMLButtonElement>('.om-scenario-pool-header-actions button[aria-label="Select"]')!;
    await act(async () => { selectToggleBtn.click(); });

    const selBar = container.querySelector<HTMLElement>('.om-scenario-pool-selection-bar')!;
    expect(selBar).toBeTruthy();

    const selectAllBtn = Array.from(selBar.querySelectorAll<HTMLButtonElement>('button')).find(
      btn => btn.textContent?.trim() === 'Select all',
    )!;
    await act(async () => { selectAllBtn.click(); });
    expect(selBar.textContent).toContain('3 selected');

    const exportSelectedBtn = Array.from(selBar.querySelectorAll<HTMLButtonElement>('button')).find(
      btn => btn.textContent?.includes('Export (3)'),
    )!;
    await act(async () => {
      exportSelectedBtn.click();
      await Promise.resolve();
    });
    expect(onExportBundle).toHaveBeenCalledWith({
      poolItemIds: [IMG_ITEM_1.id, IMG_ITEM_2.id, TEXT_ITEM.id],
      activeOnly: false,
      includeStandaloneHtml: true,
      includeMotionSource: false,
    });

    // Open Export popover and trigger Copy summary (JSON).
    const exportMenuTrigger = container.querySelector<HTMLButtonElement>('.om-scenario-pool-header-actions button[aria-label="Export"]')!;
    await act(async () => {
      exportMenuTrigger.click();
      await Promise.resolve();
    });
    const copySummaryBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.om-scenario-export-popover button')).find(
      btn => btn.textContent?.includes('Copy summary (JSON)'),
    )!;
    expect(copySummaryBtn).toBeTruthy();
    await act(async () => {
      copySummaryBtn.click();
      await Promise.resolve();
    });
    expect(onCopySummaryJson).toHaveBeenCalledTimes(1);
  });

  it('supports direct single-item export for media and Motion projects', async () => {
    const motionItem: PoolItem = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'motion',
      ref: { type: 'motion', projectId: 'project', sessionId: 'session-1' },
      label: 'Launch Motion Cut',
      source: 'step-output',
      stepId: 'sales-film',
      tags: [],
      pinned: false,
      addedAt: 1700000003000,
    };
    const onExportBundle = vi.fn().mockResolvedValue(null);
    const props = baseProps({ items: [IMG_ITEM_1, motionItem], onExportBundle });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    const imgExportBtn = container.querySelector<HTMLButtonElement>(`button[aria-label="Export ${IMG_ITEM_1.label}"]`)!;
    await act(async () => { imgExportBtn.click(); });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const motionExportBtn = container.querySelector<HTMLButtonElement>(`button[aria-label="Export ${motionItem.label}"]`)!;
    await act(async () => { motionExportBtn.click(); });
    expect(onExportBundle).toHaveBeenCalledWith({
      poolItemIds: [motionItem.id],
      includeMotionSource: true,
    });
  });

  it('supports Export all (ZIP) options and multi-select / import-all from workspace and Design projects', async () => {
    const mockAssets = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Studio Hero.png',
        modality: 'image',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        currentVersionId: '22222222-2222-4222-8222-222222222222',
        versions: [{ id: '22222222-2222-4222-8222-222222222222', source: 'upload', mimeType: 'image/png', createdAt: Date.now() }],
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Product Detail.png',
        modality: 'image',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        currentVersionId: '44444444-4444-4444-8444-444444444444',
        versions: [{ id: '44444444-4444-4444-8444-444444444444', source: 'generated', mimeType: 'image/png', createdAt: Date.now() }],
      },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/design/projects')) {
        return new Response(
          JSON.stringify({
            projects: [
              { id: 'd1111111-1111-4111-8111-111111111111', title: 'Landing V1', scenario: 'landing-page', versionId: null, revision: 'a'.repeat(64) },
              { id: 'd2222222-2222-4222-8222-222222222222', title: 'Sale Page', scenario: 'landing-page', versionId: null, revision: 'b'.repeat(64) },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ assets: mockAssets, total: 2, nextOffset: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const onAddItems = vi.fn().mockResolvedValue(['p1', 'p2']);
    const onExportBundle = vi.fn().mockResolvedValue(null);
    const props = baseProps({ items: [], onAddItems, onExportBundle });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    // Export popover options -> Export all (ZIP)
    const exportMenuTrigger = container.querySelector<HTMLButtonElement>('.om-scenario-pool-header-actions button[aria-label="Export"]')!;
    await act(async () => {
      exportMenuTrigger.click();
      await Promise.resolve();
    });
    const motionOpt = document.querySelector<HTMLElement>('[aria-label="Include Motion project source"]')!;
    const motionLabel = motionOpt.closest('label');
    await act(async () => {
      if (motionLabel) {
        motionLabel.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      } else {
        motionOpt.click();
      }
    });
    expect(motionOpt.getAttribute('aria-checked')).toBe('true');
    const exportAllZipBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.om-scenario-export-actions button'))
      .find(b => b.textContent?.includes('Export all (ZIP)'))!;
    await act(async () => { exportAllZipBtn.click(); });
    expect(onExportBundle).toHaveBeenCalledWith({
      activeOnly: false,
      includeStandaloneHtml: true,
      includeMotionSource: true,
    });
    await act(async () => { exportMenuTrigger.click(); });
    const activeOnly = document.querySelector<HTMLElement>('[aria-label="Active outputs only"]')!;
    expect(activeOnly.getAttribute('aria-checked')).toBe('false');
    await act(async () => { activeOnly.click(); });
    expect(activeOnly.getAttribute('aria-checked')).toBe('true');
    const exportActiveZipBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.om-scenario-export-actions button'))
      .find(b => b.textContent?.includes('Export all (ZIP)'))!;
    await act(async () => { exportActiveZipBtn.click(); });
    expect(onExportBundle).toHaveBeenLastCalledWith({
      activeOnly: true,
      includeStandaloneHtml: true,
      includeMotionSource: true,
    });

    // Open workspace AssetPicker in multi-select mode -> Select all (2) -> Import (2)
    const pickBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(btn => btn.textContent?.includes('Pick from workspace'))!;
    await act(async () => {
      pickBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const selectAllWorkspaceBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.om-asset-picker button'))
      .find(b => b.textContent?.includes('Select all (2)'))!;
    await act(async () => { selectAllWorkspaceBtn.click(); });
    const importWorkspaceBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.om-asset-picker button'))
      .find(b => b.textContent?.includes('Import (2)'))!;
    await act(async () => {
      importWorkspaceBtn.click();
      await Promise.resolve();
    });
    expect(onAddItems).toHaveBeenCalledWith([
      expect.objectContaining({ label: 'Studio Hero.png', source: 'workspace' }),
      expect.objectContaining({ label: 'Product Detail.png', source: 'workspace' }),
    ]);

    // Open Import -> Import Design pages… -> Select all (2) -> Import (2)
    const importTrigger = container.querySelector<HTMLButtonElement>('.om-scenario-pool-header-actions button[aria-label="Import"]')!;
    await act(async () => {
      importTrigger.click();
      await Promise.resolve();
    });
    const designMenuItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find(el => el.textContent?.includes('Import Design pages'))!;
    await act(async () => {
      designMenuItem.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const selectAllDesignBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.om-scenario-picker-toolbar button'))
      .find(b => b.textContent?.includes('Select all (2)'))!;
    await act(async () => { selectAllDesignBtn.click(); });
    const importDesignBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.om-scenario-picker-footer button'))
      .find(b => b.textContent?.includes('Import (2)'))!;
    await act(async () => {
      importDesignBtn.click();
      await Promise.resolve();
    });
    expect(onAddItems).toHaveBeenLastCalledWith([
      expect.objectContaining({ label: 'Landing V1', ref: expect.objectContaining({ type: 'design' }) }),
      expect.objectContaining({ label: 'Sale Page', ref: expect.objectContaining({ type: 'design' }) }),
    ]);
  });
});
