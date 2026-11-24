import { CodeBlock } from './code-block';
import { DocLink } from './navigation';

const tokenColors = [
  ['Canvas', '--motion-bg'],
  ['Panel', '--motion-panel'],
  ['Text', '--motion-text'],
  ['Muted text', '--motion-muted'],
  ['Action', '--motion-action'],
  ['Danger', '--motion-danger'],
];

export const guideSections = [
  ['start', 'Start the preview'],
  ['work-on-a-component', 'Work on a component'],
  ['migrate-a-control', 'Migrate a control'],
  ['verify', 'Verify and share'],
] as const;
export const tokenSections = [
  ['colors', 'Semantic colors'],
  ['scales', 'Type, spacing and radius'],
  ['motion', 'Motion'],
] as const;

export function ContributionGuide() {
  return (
    <>
      <header className="page-heading">
        <h1>Contribution guide</h1>
        <p>Develop a control, review it in the browser and get it ready for Studio.</p>
      </header>
      <section id="start" className="doc-section">
        <h2>Start the preview</h2>
        <p>Open a terminal at the repository root. Install dependencies once, then start the component site.</p>
        <CodeBlock label="Terminal" text={'npm ci\nnpm run components:dev'} />
        <p>Open the local address printed by Vite. Keep the terminal running while you work. Saving a component or example updates the browser, independently of Studio.</p>
      </section>
      <section id="work-on-a-component" className="doc-section">
        <h2>Work on a component</h2>
        <ol className="doc-list">
          <li>Find the closest control in <DocLink href="/components">Components</DocLink>. Use its variants and semantic tokens as your starting point.</li>
          <li>Edit its source in <code>packages/open-design-ui/</code>. For a new control, add a catalogue entry, a live example and one real Studio use case in the same PR.</li>
          <li>Register the control as opt-in and record what to verify before requiring it. If it should stay optional, record the reason.</li>
          <li>Show the states users will encounter, including focus, disabled and loading when relevant. Check both themes from the preview toolbar.</li>
        </ol>
      </section>
      <section id="migrate-a-control" className="doc-section">
        <h2>Migrate a control</h2>
        <p>Open the target component and choose <strong>Copy migration prompt</strong>. Add the page or control you want to replace before pasting it into your Agent.</p>
        <p>Compare the original and migrated control in Studio. Check visual states, focus, keyboard input and how the value is saved. Reduce the legacy count for each native control you remove.</p>
        <p>After verifying the common use cases, review whether reuse should become mandatory. Update the registry, lint rule and legacy baseline together when it does.</p>
      </section>
      <section id="verify" className="doc-section">
        <h2>Verify and share</h2>
        <p>Try the component with the keyboard and check it in the actual Studio workflow. Run the project checks, then include the component name, relevant states and a screenshot in the PR.</p>
        <CodeBlock label="Terminal" text={'npm run design:check\nnpm run typecheck:studio\nnpm run components:build'} />
      </section>
    </>
  );
}

export function TokenGuide() {
  return (
    <>
      <header className="page-heading">
        <h1>Design tokens</h1>
        <p>Use the shared roles for color, type, spacing and interaction across OpenMotion.</p>
      </header>
      <section id="colors" className="doc-section">
        <h2>Semantic colors</h2>
        <p>Switch themes to see the same roles resolve to different values.</p>
        <div className="token-grid">{tokenColors.map(([label, token]) => (
          <div className="token-chip" key={token}>
            <div className="token-swatch" style={{ backgroundColor: `var(${token})` }} />
            <div><strong>{label}</strong><code>{token}</code></div>
          </div>
        ))}</div>
      </section>
      <section id="scales" className="doc-section">
        <h2>Type, spacing and radius</h2>
        <ul className="doc-list">
          <li>Use <code>--motion-text-body</code> for UI text and <code>--motion-text-title</code> for section titles.</li>
          <li>Use the shared space scale, such as <code>--motion-space-8</code> and <code>--motion-space-16</code>, for gaps and padding.</li>
          <li>Use <code>--motion-radius-md</code> for controls and <code>--motion-radius-xl</code> for larger surfaces.</li>
        </ul>
      </section>
      <section id="motion" className="doc-section">
        <h2>Motion</h2>
        <p>Use the shared interaction duration and easing. The component utilities respect the user’s reduced-motion preference.</p>
        <p>Update token values in <code>packages/design-system/tokens.json</code> and run <code>npm run design:tokens</code> to regenerate the styles.</p>
      </section>
    </>
  );
}
