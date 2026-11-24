import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { posix, sep } from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const designSystem = 'packages/design-system/';
const components = 'packages/open-design-ui/';
const site = components + 'site/';
const studio = 'studio/src/';
const alias = 'open-design-ui/';
const dependencies = /^(?:react|react-dom|@base-ui\/react|cn)(?:\/|$)/;
const previewDependencies = new Set(['@lezer/highlight', '@lezer/javascript']);
const legacyEntries = new Set([studio + 'components/ui/Button', studio + 'components/ui/IconButton', studio + 'components/ui/Slider']);
const nativeControls = { button: '<button>', slider: '<input type="range">' } as const;
type NativeControl = keyof typeof nativeControls;
type NativeControlCounts = Partial<Record<NativeControl, number>>;
type RegistryComponent = {
  name: string;
  import: string;
  export: string;
  consumer: string;
  adoption?: { mode?: string; review?: string };
};

export function componentImportViolation(file: string, specifier: string) {
  const relative = specifier.startsWith('.');
  const target = relative
    ? posix.normalize(posix.join(posix.dirname(file), specifier.split(/[?#]/)[0])).replace(/\.[cm]?tsx?$/, '')
    : specifier;

  if (file.startsWith(components)) {
    const preview = file.startsWith(site);
    if (relative) {
      if (target.startsWith(components) && (preview || !target.startsWith(site))) return;
      if (preview && (target.startsWith(designSystem + 'react/') || target === designSystem + 'studio.css')) return;
    } else if (dependencies.test(target) || preview && (target.startsWith(alias) || previewDependencies.has(target))) {
      return;
    }
    return 'Component code must depend on library source and shared UI dependencies';
  }

  if (legacyEntries.has(target) || target.startsWith(components) && target !== components + 'cn') {
    return 'Import shared controls through open-design-ui';
  }
}

export function nativeControl(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, parsed: ts.SourceFile) {
  const tag = node.tagName.getText(parsed);
  if (tag === 'button') return 'button';
  if (tag !== 'input') return;
  const type = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(parsed) === 'type');
  const value = type && ts.isJsxAttribute(type) ? type.initializer : undefined;
  const literal = value && ts.isJsxExpression(value) ? value.expression : value;
  if (literal && ts.isStringLiteralLike(literal) && literal.text.toLowerCase() === 'range') return 'slider';
}

function nativeControlLines(file: string, source: string) {
  const lines: Record<NativeControl, number[]> = { button: [], slider: [] };
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const control = nativeControl(node, parsed);
      if (control) lines[control].push(parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return lines;
}

export function nativeControlViolations(file: string, source: string, baseline: NativeControlCounts) {
  const lines = nativeControlLines(file, source);
  // shortcut: legacy counts are tracked per file, track individual sites if same-count substitutions need enforcement.
  return (Object.keys(nativeControls) as NativeControl[]).flatMap(control => {
    const allowed = baseline[control] ?? 0;
    const actual = lines[control];
    if (actual.length > allowed) {
      return [`${file}:${actual.join(',')}: ${actual.length} native ${nativeControls[control]} elements (baseline ${allowed}). Use open-design-ui/${control}.`];
    }
    if (actual.length < allowed) {
      return [`${file}: reduce the ${control} count in studio-native-controls.json to ${actual.length}.`];
    }
    return [];
  });
}

function rendersRegisteredComponent(item: RegistryComponent, source: string) {
  const parsed = ts.createSourceFile(item.consumer, source, ts.ScriptTarget.Latest);
  const names = new Set<string>();
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== item.import || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      if (!binding.isTypeOnly && (binding.propertyName ?? binding.name).text === item.export) names.add(binding.name.text);
    }
  }
  if (!names.size) return false;
  return ts.forEachChild(parsed, function visit(node): true | undefined {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) && names.has(node.tagName.text)) return true;
    return ts.forEachChild(node, visit);
  });
}

function checkRegistryAdoption(items: RegistryComponent[], consumers: Map<string, string>) {
  for (const item of items) {
    const mode = Object.hasOwn(nativeControls, item.name) ? 'enforced' : 'opt-in';
    assert.equal(item.adoption?.mode, mode,
      `registry.json: ${item.name} must declare adoption.mode "${mode}" to match its native control rule.`);
    if (mode === 'opt-in') {
      assert.ok(typeof item.adoption?.review === 'string' && item.adoption.review.trim(),
        `registry.json: ${item.name} needs an adoption.review note describing when to revisit enforcement or why it stays opt-in.`);
    }
    const source = consumers.get(item.consumer);
    assert.ok(source && rendersRegisteredComponent(item, source),
      `registry.json: ${item.name} needs a Studio consumer that renders ${item.export} from ${item.import}. Check ${item.consumer}.`);
  }
}

export async function checkComponentUsage() {
  const violations: string[] = [];
  const nativeViolations: string[] = [];
  const baseline: Record<string, NativeControlCounts> = JSON.parse(
    await readFile(new URL('studio-native-controls.json', import.meta.url), 'utf8'),
  );
  const { items }: { items: RegistryComponent[] } = JSON.parse(
    await readFile(new URL(components + 'registry.json', root), 'utf8'),
  );
  const registryConsumers = new Map(items.map(item => [item.consumer, '']));
  const remainingBaseline = new Set(Object.keys(baseline));
  for (const directory of [components, studio]) {
    const files = (await readdir(new URL(directory, root), { recursive: true }))
      .map(name => directory + name.split(sep).join('/'))
      .filter(name => /\.(?:[cm]?tsx?|jsx)$/.test(name) && name !== components + 'vite.config.ts' && !name.startsWith(components + 'dist/'));
    await Promise.all(files.map(async file => {
      const source = await readFile(new URL(file, root), 'utf8');
      for (const { fileName: specifier } of ts.preProcessFile(source, true, true).importedFiles) {
        const violation = componentImportViolation(file, specifier);
        if (violation) violations.push(`${file}: ${specifier}. ${violation}.`);
      }
      if (directory === studio && /\.[jt]sx$/.test(file) && !/\/(?:__tests__|tests)\/|\.(?:test|spec)\./.test(file)) {
        const relative = file.slice(studio.length);
        remainingBaseline.delete(relative);
        nativeViolations.push(...nativeControlViolations(file, source, baseline[relative] ?? {}));
        if (registryConsumers.has(file)) registryConsumers.set(file, source);
      }
    }));
  }
  assert.deepEqual(violations.sort(), [], 'Component import boundaries');
  for (const file of remainingBaseline) nativeViolations.push(`${studio}${file}: remove the entry from studio-native-controls.json.`);
  assert.deepEqual(nativeViolations.sort(), [], 'Studio native control boundaries');
  checkRegistryAdoption(items, registryConsumers);
}
