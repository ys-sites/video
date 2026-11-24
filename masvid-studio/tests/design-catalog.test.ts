import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { designCatalog, designLibraryRoot, resetDesignCatalogCache } from '../shared/design-catalog.ts';
import { designScenarios } from '../shared/design-project.ts';

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test('design catalog resolves all scenarios, templates, systems, skills and craft docs', () => {
  resetDesignCatalogCache();
  const catalog = designCatalog();

  const scenarios = catalog.scenarios();
  assert.equal(scenarios.length, designScenarios.length);
  for (const scenario of scenarios) {
    assert(scenario.guide.length > 200, `scenario ${scenario.id} should have a real guide`);
    assert(!/\$OD_BIN|\$OD_NODE_BIN|\$OD_PROJECT_DIR|od media generate|od tools live-artifacts/.test(scenario.guide),
      `scenario ${scenario.id} must not retain Open Design CLI invocations`);
  }

  const allTemplates = catalog.templates({ limit: 200 });
  assert(allTemplates.items.length >= 100, `expected >=100 templates, got ${allTemplates.items.length}`);
  const tplIds = new Set<string>();
  const byScenario = new Map<string, number>();
  for (const summary of allTemplates.items) {
    assert(!tplIds.has(summary.id), `duplicate template id ${summary.id}`);
    tplIds.add(summary.id);
    byScenario.set(summary.scenario, (byScenario.get(summary.scenario) ?? 0) + 1);
    const detail = catalog.template(summary.id);
    assert(detail, `template ${summary.id} should resolve`);
    assert(detail.files.includes(summary.entry), `template ${summary.id} missing entry ${summary.entry}`);
    const resolved = catalog.templateFile(summary.id, summary.entry);
    assert(resolved && existsSync(resolved), `templateFile failed for ${summary.id}/${summary.entry}`);
  }
  for (const scenario of designScenarios) {
    assert(catalog.templates({ scenario: scenario.id, limit: 1 }).items.length >= 1, `expected at least 1 template for scenario ${scenario.id}`);
  }
  assert.equal(catalog.templateFile(allTemplates.items[0].id, '../catalog.json'), null);

  const systems = catalog.systems();
  assert(systems.length >= 100, `expected >=100 design systems, got ${systems.length}`);
  const sysIds = new Set<string>();
  for (const summary of systems) {
    assert(!sysIds.has(summary.id), `duplicate system id ${summary.id}`);
    sysIds.add(summary.id);
    const detail = catalog.system(summary.id);
    assert(detail && detail.designMd.length > 50, `system ${summary.id} missing DESIGN.md`);
  }

  const skills = catalog.skills();
  assert(skills.length >= 100, `expected >=100 design skills, got ${skills.length}`);
  for (const summary of skills) {
    const detail = catalog.skill(summary.id);
    assert(detail && detail.content.length > 20, `skill ${summary.id} missing SKILL.md`);
  }

  const craft = catalog.craft();
  assert(craft.length >= 10, `expected >=10 craft guides, got ${craft.length}`);
  for (const doc of craft) {
    const body = catalog.craftDoc(doc.id);
    assert(body && body.length > 50, `craft doc ${doc.id} missing`);
  }
  assert.equal(catalog.craftDoc('../README'), null);
});

test('library/design enforces 200 KB per-file limit and keeps attribution notices', () => {
  assert(existsSync(path.join(designLibraryRoot, 'LICENSE-open-design')));
  assert(existsSync(path.join(designLibraryRoot, 'NOTICE.md')));
  assert(existsSync(path.join(designLibraryRoot, 'README.md')));
  for (const file of walkFiles(designLibraryRoot)) {
    const size = statSync(file).size;
    assert(size <= 200 * 1024, `${path.relative(designLibraryRoot, file)} exceeds 200 KB (${size} bytes)`);
  }
  const deckGuide = readFileSync(path.join(designLibraryRoot, 'scenarios', 'deck.md'), 'utf8');
  assert(deckGuide.includes('od:slide-state'), 'deck guide must document the deck host protocol');
});
