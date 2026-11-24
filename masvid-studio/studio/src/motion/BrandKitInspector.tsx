import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { brandFile, type BrandKit } from './brandKitClient';
import type { BrandSample } from '../../../shared/brand-kit';

// These are measured artwork values, never application theme roles or remote CSS.
function appearance(values: CSSProperties): CSSProperties {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'string' && value.length < 2000 && !/[;{}<>\\]|url\s*\(|image\s*\(|var\s*\(/i.test(value)));
}
const sections = ['Context', 'Logos', 'Colors', 'Text styles', 'Backgrounds', 'Shapes and spacing', 'Components', 'Rules and sources'] as const;
type SaveContext = (body: unknown, expectedUpdatedAt?: string) => Promise<BrandKit | undefined>;
export function BrandKitInspector({ kit, busy, save }: { kit: BrandKit; busy: boolean; save: SaveContext }) {
  const { t } = useI18n(), sample = kit.sample!;
  const [section, setSection] = useState<string>('Context');
  const context = kit.context || { rules: [], files: [] };
  const logos = sample.logos || (kit.logo ? [{ path: 'assets/logo.png', label: kit.name }] : []);
  const counts: Record<string, number> = { Context: context.files.length + context.rules.length, Logos: logos.length, Colors: sample.colors.length,
    'Text styles': sample.typography.length, Backgrounds: 1 + sample.gradients.length + (sample.design?.glass?.length || 0),
    'Shapes and spacing': sample.spacing.length + (sample.design?.radius.length || 0), Components: sample.components.length + (sample.design?.statCells?.length || 0) };
  return <div className="om-brand-inspector om-content-enter">
    <div className="om-brand-section-nav" role="tablist" aria-label={t('Brand details')}>
      {sections.map(label => <button key={label} className="om-nav-item" role="tab" id={`brand-tab-${sections.indexOf(label)}`} aria-controls="brand-detail-panel" aria-selected={section === label}
        tabIndex={section === label ? 0 : -1} onClick={() => setSection(label)} onKeyDown={event => {
          const index = sections.indexOf(label);
          const next = event.key === 'ArrowRight' ? (index + 1) % sections.length : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : -1;
          if (next < 0) return; event.preventDefault(); setSection(sections[next]); document.getElementById(`brand-tab-${next}`)?.focus();
        }}>{t(label)}{counts[label] > 0 && <span className="om-result-count">{counts[label]}</span>}</button>)}
    </div>
    <section className="om-card om-card-stack om-brand-detail-panel" role="tabpanel" id="brand-detail-panel" aria-labelledby={`brand-tab-${sections.indexOf(section as typeof sections[number])}`}>
      <h2 className="om-subtitle">{t(section)}</h2>
      {section === 'Context' && <BrandContextEditor key={kit.id} kit={kit} busy={busy} save={save} />}
      {section === 'Logos' && <div className="om-brand-material-grid">{logos.length ? logos.map(logo => <figure className="om-card om-card-stack" key={logo.path}><div className="om-brand-logo" style={appearance({ background: sample.style.background })}><img src={brandFile(kit, logo.path)} alt={logo.label} /></div><figcaption className="om-muted">{logo.label}</figcaption></figure>) : <span className="om-muted">{t('None detected')}</span>}</div>}
      {section === 'Colors' && <div className="om-brand-swatches">{[...new Set([sample.style.primary, sample.style.background, sample.style.foreground, sample.style.onPrimary, sample.style.surface, ...sample.colors])].map(color => <div key={color}><span className="om-brand-swatch" style={appearance({ backgroundColor: color })} /><code>{color}</code></div>)}</div>}
      {section === 'Text styles' && <div className="om-brand-material-grid">{sample.typography.length ? sample.typography.map((text, index) => <div className="om-card om-card-stack" key={index}><strong>{t(text.role)}</strong><span className="om-artwork-type" style={appearance({ fontFamily: text.fontFamily, fontWeight: text.fontWeight, letterSpacing: text.letterSpacing })}>Aa Bb 0123</span><span className="om-muted">{text.fontFamily}</span><code>{text.fontSize} / {text.fontWeight} / {text.lineHeight} / {text.letterSpacing}</code></div>) : <span>{sample.style.headingFont} · {sample.style.bodyFont}</span>}</div>}
      {section === 'Backgrounds' && <div className="om-brand-material-grid">{[sample.style.background, ...sample.gradients].map((background, index) => <div className="om-card om-card-stack" key={index}><div className="om-brand-swatch om-brand-background" style={appearance({ background })} /><code>{background}</code></div>)}{sample.design?.glass?.map((glass, index) => <div className="om-card om-card-stack" key={`glass-${index}`}><strong>{t('Glass material')}</strong><div className="om-brand-material-preview" style={appearance({ background: sample.style.gradient === 'none' ? sample.style.primary : sample.style.gradient, color: sample.style.onPrimary })}><div style={appearance({ background: glass.background, backdropFilter: glass.backdropFilter, border: glass.border, borderRadius: glass.borderRadius })}>Aa</div></div><code>{glass.background}</code><code>{glass.backdropFilter}</code></div>)}</div>}
      {section === 'Shapes and spacing' && <><div className="om-control-row">{sample.spacing.map(value => <span className="om-badge" key={value}>{value}</span>)}</div><div className="om-brand-material-grid">{(sample.design?.radius.length ? sample.design.radius : [sample.style.radius]).map(value => <div className="om-card om-card-stack" key={value}><div className="om-brand-shape" style={appearance({ background: sample.style.primary, borderRadius: value })} /><code>{value}</code></div>)}{sample.design?.shadows.map(shadow => <div className="om-card om-card-stack" key={shadow.value}><div className="om-brand-shape" style={appearance({ background: sample.style.surface, boxShadow: shadow.value, borderRadius: sample.style.radius })} /><code>{shadow.value}</code></div>)}</div></>}
      {section === 'Components' && <BrandComponents sample={sample} />}
      {section === 'Rules and sources' && <>
        {context.rules.map((rule, index) => <div className="om-brand-fact" key={index}>{rule}</div>)}
        <a className="om-text-link" href={kit.url} target="_blank" rel="noreferrer">{kit.catalogId ? t('View original design system') : new URL(kit.url).hostname}<RemixIcon name="external-link-line" size={14} /></a>
        {!kit.catalogId && <a className="om-text-link" href={brandFile(kit, 'website.png')} target="_blank" rel="noreferrer">{t('View captured website')}</a>}
        {sample.sources?.filter(source => source.capturedAt).slice(0,1).map(source => <span className="om-muted" key={source.url}>{new Date(source.capturedAt!).toLocaleString()}</span>)}
        {sample.tokens && <details><summary className="om-text-link">{t('Design tokens')} · {Object.keys(sample.tokens.cssVariables).length}</summary><div className="om-brand-token-list">{Object.entries(sample.tokens.cssVariables).map(([key, value]) => <div className="om-brand-fact" key={key}><strong>{key}</strong><code>{value}</code></div>)}</div></details>}
        {!!kit.warnings?.length && <details><summary className="om-text-link">{t('Capture notes')} · {kit.warnings.length}</summary><div className="om-card-stack">{kit.warnings.map(warning => <span className="om-muted" key={warning}>{t(warning)}</span>)}</div></details>}
      </>}
    </section>
  </div>;
}
function BrandComponents({ sample }: { sample: BrandSample }) {
  const { t } = useI18n();
  return <div className="om-brand-material-grid">{sample.components.map((component, index) => <div className="om-card om-card-stack" key={index}><strong>{t(component.role)}</strong><div className="om-brand-material-preview" style={appearance({ background: sample.style.background, color: sample.style.foreground })}><div style={appearance({ backgroundColor: component.background, backgroundImage: component.backgroundImage, color: component.color, borderRadius: component.borderRadius, border: component.border, boxShadow: component.boxShadow, backdropFilter: component.backdropFilter, fontWeight: component.fontWeight })}>{component.label || t(component.role)}</div></div><code>{component.background} · {component.borderRadius}</code><code>{t('Padding')}: {component.padding}</code><code>{t('Border')}: {component.border}</code>{component.boxShadow !== 'none' && <code>{t('Shadow')}: {component.boxShadow}</code>}</div>)}
    {sample.design?.statCells?.map((stat, index) => <div className="om-card om-card-stack" key={`stat-${index}`}><strong>{t('Metric')}</strong><div className="om-brand-material-preview" style={appearance({ backgroundColor: sample.style.background, color: sample.style.foreground })}><div style={appearance({ backgroundColor: stat.background, color: stat.numberColor, borderRadius: stat.borderRadius, border: stat.border, boxShadow: stat.boxShadow })}>128</div></div><code>{stat.numberFontSize} / {stat.numberFontWeight}</code></div>)}
    {!sample.components.length && !sample.design?.statCells?.length && <span className="om-muted">{t('None detected')}</span>}
  </div>;
}
function BrandContextEditor({ kit, busy, save }: { kit: BrandKit; busy: boolean; save: SaveContext }) {
  const { t } = useI18n(), toast = useToast(), filesInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null);
  const context = kit.context || { files: [], rules: [] };
  const [rule, setRule] = useState(''), [writing, setWriting] = useState(false), [uploading, setUploading] = useState(false), [editingRule, setEditingRule] = useState<number | null>(null);
  const disabled = busy || uploading;
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      let revision = kit.updatedAt;
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) throw new Error('Brand files must be under 8 MB');
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read brand file')); reader.readAsDataURL(file); });
        const saved = await save({ file: { name: file.webkitRelativePath || file.name, data } }, revision);
        if (!saved) break;
        revision = saved.updatedAt;
      }
    } catch (error) { toast.showToast(t((error as Error).message), 'error', 'feedback'); }
    finally { setUploading(false); }
  };
  return <div className="om-card-stack" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!disabled) void upload([...event.dataTransfer.files]); }}>
    <StudioToastViewport {...toast} />
    <div className="om-control-row om-brand-context-actions">
      <Button variant="ghost" className="om-button h-auto" disabled={disabled} onClick={() => filesInput.current?.click()}><RemixIcon name="add-line" size={16} />{t(uploading ? 'Uploading' : 'Add files')}</Button>
      <Button variant="ghost" className="om-button h-auto" disabled={disabled} onClick={() => folderInput.current?.click()}>{t('Add a folder')}</Button>
      <Button variant="ghost" className="om-button h-auto" disabled={disabled} onClick={() => { setWriting(true); setEditingRule(null); setRule(''); }}>{t('Write a rule')}</Button>
    </div>
    <input ref={filesInput} type="file" hidden multiple onChange={event => { void upload([...event.target.files || []]); event.target.value = ''; }} />
    <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: '' }} onChange={event => { void upload([...event.target.files || []]); event.target.value = ''; }} />
    {context.files.map(file => <div className="om-brand-context-row" key={file.id}><a className="om-text-link" href={brandFile(kit, file.path)} download>{file.name}</a><span className="om-muted">{Math.ceil(file.size / 1024)} KB</span><IconButton variant="ghost" className="om-button om-icon-button" disabled={disabled} aria-label={`${t('Remove file')}: ${file.name}`} onClick={() => void save({ remove: file.id }).catch(() => {})} icon={<RemixIcon name="close-line" size={16} />} /></div>)}
    {context.rules.map((value, index) => <div className="om-brand-context-row" key={index}><span>{value}</span><IconButton variant="ghost" className="om-button om-icon-button" disabled={disabled} aria-label={`${t('Edit rule')}: ${index + 1}`} onClick={() => { setWriting(true); setEditingRule(index); setRule(value); }} icon={<RemixIcon name="edit-line" size={16} />} /><IconButton variant="ghost" className="om-button om-icon-button" disabled={disabled} aria-label={`${t('Remove rule')}: ${index + 1}`} onClick={() => void save({ rules: context.rules.filter((_, i) => i !== index) }).catch(() => {})} icon={<RemixIcon name="close-line" size={16} />} /></div>)}
    {writing && <form className="om-card-stack" onSubmit={event => { event.preventDefault(); const rules = [...context.rules]; if (editingRule === null) rules.push(rule); else rules[editingRule] = rule; void save({ rules }).then(() => { setWriting(false); setRule(''); }).catch(() => {}); }}><label className="om-field"><textarea aria-label={t('Brand rule')} rows={3} maxLength={2000} required value={rule} onChange={event => setRule(event.target.value)} /></label><div className="om-brand-actions"><Button variant="ghost" className="om-button h-auto" type="button" onClick={() => setWriting(false)}>{t('Cancel')}</Button><Button variant="ghost" className="om-button h-auto" data-primary disabled={disabled || !rule.trim()}>{t('Save rule')}</Button></div></form>}
  </div>;
}
