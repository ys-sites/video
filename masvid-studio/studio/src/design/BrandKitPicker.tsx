import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Popover } from '@base-ui/react/popover';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../packages/design-system/react/RemixIcons';
import { brandCatalogFile, type BrandCatalog, type BrandCatalogEntry } from '../../../shared/brand-catalog';
import { IconButton } from 'open-design-ui/icon-button';
import { useI18n } from '../i18n/I18n';
import { BrandKitLivePreview } from '../motion/BrandKitLivePreview';
import { brandFile, brandRequest, loadBrandKits, type BrandKit } from '../motion/brandKitClient';
import './design.css';

export type SelectedBrandKit = {
  id: string;
  catalogId?: string;
  name: string;
  category: string;
  appearance?: string;
  description: string;
  posterUrl?: string;
  swatches: string[];
  tags: string[];
  websiteUrl?: string;
  isCustom?: boolean;
};

function fromUserKit(kit: BrandKit): SelectedBrandKit {
  const style = kit.sample?.style;
  const swatches = [
    style?.background,
    style?.surface,
    style?.primary,
    style?.foreground,
  ].filter((c): c is string => Boolean(c && c.startsWith('#')));
  return {
    id: kit.catalogId || kit.id,
    catalogId: kit.catalogId,
    name: kit.name,
    category: kit.catalogId ? 'Brand Kit' : 'My Brand Kit',
    description: kit.sample?.title || kit.websiteUrl || kit.url || '',
    posterUrl: kit.poster ? brandFile(kit, 'poster.png') : kit.catalogId ? brandCatalogFile(kit.catalogId, 'style-cover.svg') : undefined,
    swatches,
    tags: [],
    websiteUrl: kit.websiteUrl || kit.url || undefined,
    isCustom: !kit.catalogId,
  };
}

function fromCatalogEntry(entry: BrandCatalogEntry): SelectedBrandKit {
  return {
    id: entry.id,
    catalogId: entry.id,
    name: entry.name,
    category: entry.category,
    appearance: entry.appearance,
    description: entry.description,
    posterUrl: brandCatalogFile(entry.id, 'style-cover.svg'),
    swatches: [],
    tags: entry.tags || [],
    websiteUrl: entry.websiteUrl || entry.sourceUrl || undefined,
  };
}

/**
 * Brand Kit selector for Design Studio backed by OpenMotion's Brand Kit library.
 * Supports search, hover live cover preview, selection, and clicking to inspect full Brand Kit details.
 */
export function BrandKitPicker({
  selected,
  onSelect,
}: {
  selected: SelectedBrandKit | null;
  onSelect: (kit: SelectedBrandKit | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [kits, setKits] = useState<SelectedBrandKit[]>([]);
  const [hovered, setHovered] = useState<SelectedBrandKit | null>(null);
  const [detailKit, setDetailKit] = useState<SelectedBrandKit | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    Promise.all([
      loadBrandKits(controller.signal).catch(() => [] as BrandKit[]),
      brandRequest<BrandCatalog>('/catalog').catch(() => null),
    ]).then(([userKits, catalog]) => {
      if (!active) return;
      const merged: SelectedBrandKit[] = [];
      const seen = new Set<string>();
      for (const uk of userKits) {
        if (uk.state !== 'ready') continue;
        const item = fromUserKit(uk);
        if (!seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
        }
      }
      for (const entry of catalog?.entries ?? []) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        merged.push(fromCatalogEntry(entry));
      }
      setKits(merged);
    });
    return () => { active = false; controller.abort(); };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return kits.filter(k => !q
      || k.name.toLowerCase().includes(q)
      || k.category.toLowerCase().includes(q)
      || k.description.toLowerCase().includes(q)
      || k.tags.some(tag => tag.toLowerCase().includes(q))).slice(0, 60);
  }, [kits, query]);

  const previewKit = hovered ?? selected ?? filtered[0] ?? null;

  return (
    <>
      <Popover.Root modal={false} open={open} onOpenChange={next => { setOpen(next); if (!next) setHovered(null); }}>
        <Popover.Trigger render={
          <Button type="button" size="sm" variant={selected ? 'secondary' : 'ghost'} icon={<RemixIcon name="palette-line" size={14} />}>
            <span>{selected ? selected.name : t('Brand Kit')}</span>
            {selected && selected.swatches.length > 0 && (
              <span className="om-design-swatches">
                {selected.swatches.slice(0, 3).map(hex => (
                  <span key={hex} className="om-design-swatch" style={{ backgroundColor: hex }} />
                ))}
              </span>
            )}
          </Button>
        } />
        <Popover.Portal>
          <Popover.Positioner side="top" align="start" sideOffset={8} className="z-150">
            <Popover.Popup className="om-design-popover om-design-bk-popover">
              <div className="om-design-bk-split">
                <div className="om-design-bk-list-col">
                  <input
                    type="search"
                    className="om-design-input"
                    style={{ minWidth: 0, width: '100%' }}
                    placeholder={t('Search Brand Kits…')}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                  />
                  <div className="om-design-bk-list">
                    {selected && (
                      <Button type="button" size="sm" variant="ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { onSelect(null); setOpen(false); }}>
                        {t('Clear Brand Kit')}
                      </Button>
                    )}
                    {filtered.map(kit => (
                      <div
                        key={kit.id}
                        className="om-design-bk-row"
                        data-active={selected?.id === kit.id}
                        onMouseEnter={() => setHovered(kit)}
                      >
                        <Button
                          type="button"
                          size="sm"
                          variant={selected?.id === kit.id ? 'secondary' : 'ghost'}
                          className="om-design-bk-row-btn"
                          onClick={() => { onSelect(kit); setOpen(false); }}
                        >
                          <span className="om-design-bk-row-name">{kit.name}</span>
                          <span className="om-design-muted" style={{ fontSize: 11 }}>{kit.category}</span>
                        </Button>
                        <IconButton
                          aria-label={t('View Brand Kit details')}
                          icon={<RemixIcon name="eye-line" size={14} />}
                          onClick={() => { setDetailKit(kit); setOpen(false); }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {previewKit && (
                  <div className="om-design-bk-preview-col">
                    <div className="om-design-bk-preview-cover" onClick={() => { setDetailKit(previewKit); setOpen(false); }}>
                      {previewKit.posterUrl ? (
                        <img src={previewKit.posterUrl} alt={previewKit.name} />
                      ) : (
                        <div className="om-design-muted">{previewKit.name}</div>
                      )}
                    </div>
                    <div className="om-design-bk-preview-meta">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <strong style={{ fontSize: 14 }}>{previewKit.name}</strong>
                        <span className="om-design-badge">{previewKit.appearance || previewKit.category}</span>
                      </div>
                      {previewKit.description && (
                        <p className="om-design-card-desc" style={{ margin: 0 }}>{previewKit.description}</p>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <Button type="button" size="sm" variant="primary" onClick={() => { onSelect(previewKit); setOpen(false); }}>
                          {t('Select')}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" icon={<RemixIcon name="eye-line" size={13} />} onClick={() => { setDetailKit(previewKit); setOpen(false); }}>
                          {t('View details')}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {/* Full Brand Kit detail dialog with live animated preview */}
      <Dialog.Root open={Boolean(detailKit)} onOpenChange={v => { if (!v) setDetailKit(null); }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="om-design-dialog-backdrop" />
          <Dialog.Popup className="om-design-dialog-popup" aria-label={detailKit?.name ?? t('Brand Kit')}>
            {detailKit && (
              <div className="om-design-bk-detail">
                <div className="om-design-bk-detail-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{detailKit.name}</h3>
                    <span className="om-design-badge">{detailKit.category}</span>
                    {detailKit.appearance && <span className="om-design-badge">{detailKit.appearance}</span>}
                  </div>
                  <IconButton aria-label={t('Close')} icon={<RemixIcon name="close-line" size={16} />} onClick={() => setDetailKit(null)} />
                </div>

                <div className="om-design-bk-detail-stage">
                  {detailKit.catalogId ? (
                    <BrandKitLivePreview
                      id={detailKit.catalogId}
                      poster={brandCatalogFile(detailKit.catalogId, 'poster.svg')}
                      enabled={true}
                    />
                  ) : detailKit.posterUrl ? (
                    <img src={detailKit.posterUrl} alt={detailKit.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </div>

                {detailKit.description && (
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--motion-muted)' }}>{detailKit.description}</p>
                )}

                {detailKit.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {detailKit.tags.slice(0, 8).map(tag => (
                      <span key={tag} className="om-design-badge">{tag}</span>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  {detailKit.websiteUrl ? (
                    <a href={detailKit.websiteUrl} target="_blank" rel="noopener noreferrer" className="om-design-muted" style={{ textDecoration: 'underline' }}>
                      {detailKit.websiteUrl}
                    </a>
                  ) : <span />}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDetailKit(null)}>{t('Close')}</Button>
                    <Button type="button" size="sm" variant="primary" onClick={() => { onSelect(detailKit); setDetailKit(null); }}>
                      {t('Use this Brand Kit')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
