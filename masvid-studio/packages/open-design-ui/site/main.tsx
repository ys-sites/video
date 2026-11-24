import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Tabs } from '@base-ui/react/tabs';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../design-system/react/RemixIcons';
import registry from '../registry.json';
import registryUrl from '../registry.json?url&no-inline';
import { CodeBlock } from './code-block';
import { CopyButton, CopyFeedback } from './copy-button';
import { componentDocs } from './examples';
import { ContributionGuide, guideSections, TokenGuide, tokenSections } from './handbook';
import { DocLink, navigate, useCatalogPath } from './navigation';
import './site.css';

const libraryName = 'Open Design UI';
const components = registry.items;
const componentHref = (name: string) => `/components/${name}`;
type Item = (typeof components)[number];
type Section = readonly [id: string, title: string];
const componentSections: Section[] = [
  ['preview', 'Preview'], ['usage', 'Usage'], ['examples', 'Examples'],
  ['api-reference', 'API reference'], ['accessibility', 'Accessibility'],
];
const overviewSections: Section[] = [['all-components', 'All components']];
const libraryLinks = [
  { name: 'Components', href: '/components', icon: 'stack-line' },
  { name: 'Design tokens', href: '/tokens', icon: 'palette-line' },
  { name: 'Contribution guide', href: '/guide', icon: 'book-open-line' },
];
const searchEntries = [
  ...libraryLinks.map(({ name, href, icon }) => ({ name, href, icon, group: 'Library', words: name })),
  ...components.map(item => ({
    name: item.title, href: componentHref(item.name), icon: componentDocs[item.name]?.icon ?? 'stack-line',
    group: 'Components', words: `${item.title} ${item.description}`,
  })),
];

function Search() {
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const open = () => {
    if (dialog.current?.open) return;
    setQuery('');
    dialog.current?.showModal();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const matches = searchEntries.filter(entry => entry.words.toLowerCase().includes(query.trim().toLowerCase()));

  return <>
    <Button type="button" variant="ghost" className="search-trigger" aria-label="Search documentation" aria-haspopup="dialog" onClick={open}>
      <RemixIcon name="search-line" />
      <span>Search documentation</span>
      <kbd>Ctrl / ⌘ K</kbd>
    </Button>
    <dialog className="search-dialog" ref={dialog} aria-label="Search documentation">
      <form className="search-form" onSubmit={event => {
        event.preventDefault();
        if (matches[0]) {
          navigate(matches[0].href);
          dialog.current?.close();
        }
      }}>
        <RemixIcon name="search-line" size={18} />
        <input aria-label="Search documentation" autoFocus placeholder="Find a component or guide"
          type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} />
        <Button type="button" variant="ghost" size="sm" aria-label="Close search"
          icon={<RemixIcon name="close-line" />} onClick={() => dialog.current?.close()} />
      </form>
      <ul className="search-results">
        {matches.map(entry => <li key={entry.href}>
          <DocLink href={entry.href} onClick={() => dialog.current?.close()}>
            <RemixIcon name={entry.icon} />
            <span>{entry.name}</span>
            <small>{entry.group}</small>
          </DocLink>
        </li>)}
        {matches.length === 0 && <li className="search-empty">No results for “{query.trim()}”.</li>}
      </ul>
    </dialog>
  </>;
}

function ComponentIndex() {
  return <>
    <header className="page-heading">
      <h1>Components</h1>
      <p>Explore the shared UI controls used in OpenMotion Studio. Open a component to try it, compare its states and copy an example.</p>
    </header>
    <section className="doc-section" id="all-components">
      <h2>All components</h2>
      <div className="catalog-grid">
        {components.map(item => {
          const Preview = componentDocs[item.name]?.Preview;
          return <article className="catalog-card" key={item.name}>
            {Preview && <div className="catalog-sample" aria-hidden="true" inert><Preview /></div>}
            <div className="catalog-meta">
              <div>
                <h3><DocLink href={componentHref(item.name)}>{item.title}</DocLink></h3>
                <p>{item.description}</p>
              </div>
              <RemixIcon name="arrow-right-s-line" className="catalog-arrow" size={20} />
            </div>
          </article>;
        })}
      </div>
    </section>
  </>;
}

function ComponentPage({ item }: { item: Item }) {
  const docs = componentDocs[item.name];
  if (!docs) return <header className="page-heading">
    <DocLink className="breadcrumb" href="/components">Components</DocLink>
    <h1>{item.title}</h1>
    <p>{item.description}</p>
  </header>;
  const { Preview, code, examples, props, guidance, migration } = docs;
  const importLine = `import { ${item.export} } from "${item.import}"`;
  const index = components.indexOf(item);
  const agentPrompt = [
    `Use Open Design UI's ${item.title} in the feature I specify.`,
    importLine,
    `Usage: ${item.example}`,
    'Keep feature behavior and layout intact, use shared tokens, and run the relevant UI checks.',
  ].join('\n');
  const migrationPrompt = [
    `Migrate the existing control I specify to Open Design UI's ${item.title}. Keep the change scoped to that use case.`,
    importLine,
    migration,
    'Preserve appearance in both themes, behavior, focus, accessible labels and keyboard interaction.',
    'If an equivalent shared option is missing, describe the gap before replacing the control.',
    'Run the relevant type and interaction checks for the feature.',
  ].join('\n');

  return <>
    <header className="page-heading detail-heading">
      <div className="breadcrumb">
        <DocLink href="/components">Components</DocLink>
        <RemixIcon name="arrow-right-s-line" size={14} />
        <span>{item.title}</span>
      </div>
      <h1>{item.title}</h1>
      <p>{item.description}</p>
      <div className="component-actions" role="group" aria-label="Agent prompts">
        <CopyButton label="Copy to Agent" icon="robot-line" text={agentPrompt} />
        <CopyButton label="Copy migration prompt" icon="refresh-line" text={migrationPrompt} />
      </div>
    </header>
    <section className="doc-section demo-section" id="preview" aria-label="Component preview">
      <Tabs.Root defaultValue="preview" className="preview-switch">
        <Tabs.List aria-label="Preview and code" className="preview-tabs">
          <Tabs.Tab value="preview"><RemixIcon name="eye-line" size={16} />Preview</Tabs.Tab>
          <Tabs.Tab value="code"><RemixIcon name="code-s-slash-line" size={16} />Code</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="preview" className="preview-surface" keepMounted><Preview /></Tabs.Panel>
        <Tabs.Panel value="code"><CodeBlock text={code} /></Tabs.Panel>
      </Tabs.Root>
    </section>
    <section className="doc-section" id="usage">
      <h2>Usage</h2>
      <CodeBlock text={importLine} />
    </section>
    <section className="doc-section" id="examples">
      <h2>Examples</h2>
      <div className="example-list">
        {examples.map(({ title, Demo, description }) => <div className="example" key={title}>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
          <div className="preview-surface example-surface"><Demo /></div>
        </div>)}
      </div>
    </section>
    <section className="doc-section" id="api-reference">
      <h2>API reference</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`${item.title} properties`}>
        <table>
          <thead><tr><th scope="col">Prop</th><th scope="col">Type</th><th scope="col">Default</th><th scope="col">Description</th></tr></thead>
          <tbody>{props.map(([name, type, defaultValue, description]) => <tr key={name}>
            <th scope="row"><code>{name}</code></th><td><code>{type}</code></td><td>{defaultValue}</td><td>{description}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="doc-section" id="accessibility">
      <h2>Accessibility</h2>
      <ul className="doc-list">{guidance.map(text => <li key={text}>{text}</li>)}</ul>
    </section>
    <nav aria-label="Adjacent components" className="adjacent-links">
      {[components[index - 1], components[index + 1]].map((neighbor, i) => neighbor && (
        <DocLink href={componentHref(neighbor.name)} key={neighbor.name}>
          <span>{i === 0 ? 'Previous component' : 'Next component'}</span>{neighbor.title}
        </DocLink>
      ))}
    </nav>
  </>;
}

function useRoute() {
  const parts = useCatalogPath().slice(1).split('/');
  const item = parts[0] === 'components' ? components.find(entry => entry.name === parts[1]) : undefined;
  const section = parts[0] === 'components' && item ? parts[2] : parts[1];
  const page = parts[0] === 'guide' || parts[0] === 'tokens' ? parts[0] : 'components';
  const base = item ? componentHref(item.name) : `/${page}`;
  return { item, page, base, section };
}

function Library() {
  const { item, page, base, section } = useRoute();
  const [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const title = item?.title ?? libraryLinks.find(entry => entry.href === base)?.name;
  const sections = item ? (componentDocs[item.name] ? componentSections : [])
    : page === 'guide' ? guideSections : page === 'tokens' ? tokenSections : overviewSections;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme === 'light' ? 'paper' : 'dark';
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  useLayoutEffect(() => {
    document.title = `${title} · ${libraryName}`;
    if (section) document.getElementById(section)?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [base, section, title]);

  return <>
    <link rel="alternate" type="application/json" href={registryUrl} title="Component registry" />
    <a href="#main-content" className="skip-link" onClick={event => {
      event.preventDefault();
      document.getElementById('main-content')?.focus();
    }}>Skip to content</a>
    <header className="app-header">
      <div className="header-inner">
        <DocLink className="wordmark" href="/components" onClick={() => setMobileNav(false)}>
          <span className="brand-mark"><RemixIcon name="layout-2-line" size={19} /></span>
          {libraryName}
        </DocLink>
        <div className="toolbar">
          <Search />
          <Button type="button" variant="ghost" className="toolbar-icon"
            icon={<RemixIcon name={theme === 'light' ? 'moon-line' : 'sun-line'} size={18} />}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
          <Button type="button" variant="ghost" className="toolbar-icon mobile-nav-toggle"
            icon={<RemixIcon name="menu-line" size={19} />} aria-label="Toggle navigation"
            aria-expanded={mobileNav} aria-controls="library-navigation" onClick={() => setMobileNav(!mobileNav)} />
        </div>
      </div>
    </header>
    <div className="docs-shell">
      <aside className="sidebar" data-open={mobileNav}>
        <nav id="library-navigation" aria-label="Library" onClick={event => {
          if (event.target instanceof Element && event.target.closest('a')) setMobileNav(false);
        }}>
          <div className="sidebar-group">
            <p>Library</p>
            {libraryLinks.map(entry => <DocLink href={entry.href} key={entry.name} aria-current={base === entry.href ? 'page' : undefined}>
              <RemixIcon name={entry.icon} />{entry.name}
            </DocLink>)}
          </div>
          <div className="sidebar-group">
            <p>Components</p>
            {components.map(entry => <DocLink href={componentHref(entry.name)} key={entry.name}
              aria-current={item === entry ? 'page' : undefined}>
              <RemixIcon name={componentDocs[entry.name]?.icon ?? 'stack-line'} />{entry.title}
            </DocLink>)}
          </div>
        </nav>
      </aside>
      <main className="main-content" id="main-content" tabIndex={-1}>
        {item ? <ComponentPage key={item.name} item={item} />
          : page === 'guide' ? <ContributionGuide /> : page === 'tokens' ? <TokenGuide /> : <ComponentIndex />}
      </main>
      {sections.length > 0 && <aside className="contents">
        <nav aria-label="On this page">
          <p>On this page</p>
          {sections.map(([id, label], i) => <DocLink key={id} href={`${base}/${id}`}
            aria-current={(section ? id === section : i === 0) ? 'location' : undefined}>{label}</DocLink>)}
        </nav>
      </aside>}
    </div>
  </>;
}

createRoot(document.getElementById('catalog-root')!).render(<CopyFeedback><Library /></CopyFeedback>);
