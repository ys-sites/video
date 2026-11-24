import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import postcss from 'postcss';
import ts from 'typescript';
import { extractClassCandidates } from '../studio/src/styles/classCandidates.ts';
import { nativeControl } from './check-component-imports.ts';
import { classifyStyle, styleFamily, styleRules } from './ui-style-metrics.ts';

type Site = { file: string; line: number; kind: string; family: string; value: string; status: string; context: string };
const scope = 'Studio production JSX controls. Styles: Studio TS/TSX and CSS plus web and MCP UI CSS. Counts are source occurrences. Unknown styles are outside the rate.';
const skipped = /(?:^|\/)(?:__tests__|tests|fixtures|__fixtures__|node_modules|build|dist|__mocks__)(?:\/|$)|(?:\.test[^/]*|\.spec|TestHarness|TestMocks)\.[jt]sx?$|\/(?:test-setup|ComponentInspector|componentInspector)\.[^.]+$/;

function filesUnder(root: string, directory: string): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = directory + '/' + entry.name;
    if (skipped.test(file)) return [];
    if (entry.isDirectory()) return filesUnder(root, file);
    if (!entry.isFile() || !(/\.(?:[jt]sx?|css)$/.test(file)) || file.endsWith('.d.ts')) return [];
    return !directory.startsWith('studio/') && !file.endsWith('.css') ? [] : [file];
  }).sort();
}

function nativeStatus(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, role: string, tag: string) {
  if (/^(?:menuitem(?:radio|checkbox)?|switch|checkbox|radio|tab|treeitem)$/.test(role)) return 'specialized native';
  const attrs = node.attributes.properties.map(attr => ts.isJsxAttribute(attr) ? attr.name.getText() : 'spread');
  const click = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText() === 'onClick');
  const handler = click && ts.isJsxAttribute(click) && click.initializer && ts.isJsxExpression(click.initializer) ? click.initializer.expression : undefined;
  const simpleAction = handler && ts.isArrowFunction(handler) && handler.parameters.length === 0;
  if (tag === 'button' && !role && simpleAction && attrs.every(name => /^(?:type|className|key|title|aria-label|disabled|onClick)$/.test(name))) return 'native migration candidate';
  return 'native to review';
}

function semanticRole(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
  const attr = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText() === 'role');
  if (!attr || !ts.isJsxAttribute(attr) || !attr.initializer) return '';
  const literal = ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : attr.initializer;
  return literal && ts.isStringLiteralLike(literal) ? literal.text : '';
}

const portablePath = (value: string) => value.split(path.sep).join('/');

export async function scan(root: string) {
  const files = [...filesUnder(root, 'studio/src'), ...filesUnder(root, 'web'), ...filesUnder(root, 'mcp-ui')];
  const library = existsSync(path.join(root, 'packages/open-design-ui/registry.json')) ? 'packages/open-design-ui' : 'packages/design-system/components';
  const registry = JSON.parse(readFileSync(path.join(root, library, 'registry.json'), 'utf8'));
  const origins = new Map<string, string>(registry.items.map((item: { source: string; export: string }) => [portablePath(path.resolve(root, item.source)), item.export]));
  const program = ts.createProgram(files.filter(file => !file.endsWith('.css')).map(file => path.join(root, file)), {
    target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { 'open-design-ui/*': [path.join(root, library, '*')] }, allowJs: true, types: [], noLib: true,
  });
  const checker = program.getTypeChecker();
  const rules = await styleRules(root);
  const sites: Site[] = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    const add = (line: number, kind: string, family: string, value: string, status: string, context: string) =>
      sites.push({ file, line, kind, family, value, status, context });
    if (file.endsWith('.css')) {
      postcss.parse(readFileSync(absolute, 'utf8'), { from: absolute }).walkDecls(decl => {
        const status = classifyStyle(decl.prop, decl.value, rules.tokens);
        if (status) add(decl.source!.start!.line, 'css', styleFamily(decl.prop)!, decl.prop + ': ' + decl.value, status,
          decl.parent?.type === 'rule' ? decl.parent.selector : '');
      });
      continue;
    }
    const source = program.getSourceFile(absolute)!;
    const lineAt = (offset: number) => source.getLineAndCharacterOfPosition(offset).line + 1;
    const seenClasses = new Set<number>();
    const artwork: [number, number][] = [];
    function visit(node: ts.Node, context: string) {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node)) && node.name) context = node.name.getText(source);
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'svg') {
        artwork.push([node.getStart(source), node.end]);
        return;
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (tag === 'svg') { artwork.push([node.getStart(source), node.end]); return; }
        const line = lineAt(node.getStart(source));
        const native = nativeControl(node, source);
        if (native) {
          const role = semanticRole(node);
          add(line, 'control', native, tag + (role ? ' role=' + role : ''), nativeStatus(node, role, tag), context);
        } else if (/^[A-Z_$]|\./.test(tag)) {
          let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.tagName) ? node.tagName.name : node.tagName);
          if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
          const origin = symbol?.valueDeclaration?.getSourceFile().fileName;
          // TypeScript reports forward slashes even on Windows, so both sides of the lookup are normalised.
          const component = origin && origins.get(portablePath(origin));
          if (component && ['Button', 'IconButton', 'Slider'].includes(component) && component === symbol?.getName()) add(line, 'control', component === 'IconButton' ? 'button' : component.toLowerCase(), component, 'library', context);
        }
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || attr.name.getText(source) !== 'style' || !attr.initializer || !ts.isJsxExpression(attr.initializer)) continue;
          const expression = attr.initializer.expression;
          if (!expression || !ts.isObjectLiteralExpression(expression)) { add(line, 'inline', 'dynamic', 'style expression', 'unknown', context); continue; }
          for (const property of expression.properties) {
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
              add(lineAt(property.getStart(source)), 'inline', 'dynamic', 'style spread or method', 'unknown', context);
              continue;
            }
            const key = property.name.getText(source).replace(/^['"]|['"]$/g, '').replace(/[A-Z]/g, ch => '-' + ch.toLowerCase());
            const family = styleFamily(key);
            if (!family) continue;
            const initializer = ts.isPropertyAssignment(property) ? property.initializer : property.name;
            const literal = ts.isStringLiteralLike(initializer) ? initializer.text : ts.isNumericLiteral(initializer) ? initializer.text + 'px' : undefined;
            const status = literal === undefined ? 'unknown' : classifyStyle(key, literal, rules.tokens);
            if (status) add(lineAt(property.getStart(source)), 'inline', family, key + ': ' + initializer.getText(source), status, context);
          }
        }
      }
      ts.forEachChild(node, child => visit(child, context));
    }
    visit(source, '');
    extractClassCandidates(source.text, (item, offset) => {
      if (seenClasses.has(offset) || artwork.some(([from, to]) => offset >= from && offset < to)) return;
      seenClasses.add(offset);
      for (const result of rules.utility(item.base)) add(lineAt(offset), 'utility', result.family, item.raw, result.status, '');
    });
  }
  return sites;
}

function tally(sites: Site[], key: (site: Site) => string) {
  const counts: Record<string, number> = {};
  for (const site of sites) { const group = key(site); counts[group] = (counts[group] ?? 0) + 1; }
  return counts;
}

function metric(hits: number, total: number) {
  return { hits, total, percent: total ? Number((100 * hits / total).toFixed(2)) : null };
}
export function summarize(sites: Site[]) {
  const controls = sites.filter(site => site.kind === 'control');
  const styles = sites.filter(site => site.kind !== 'control');
  const coverage = (list: Site[]) => metric(list.filter(site => site.status === 'library').length, list.length);
  const styleCounts = tally(styles, site => site.status);
  const detachedRate = (list: Site[]) => metric(list.filter(site => site.status === 'detached').length, list.filter(site => site.status !== 'unknown').length);
  return {
    coverage: coverage(controls), controls: tally(controls, site => site.status === 'library' ? site.value : site.status),
    coverageByFamily: Object.fromEntries([...new Set(controls.map(site => site.family))].map(key => [key, coverage(controls.filter(site => site.family === key))])),
    detached: detachedRate(styles), styles: styleCounts,
    stylesByFamily: Object.fromEntries([...new Set(styles.map(site => site.family))].map(key => [key, detachedRate(styles.filter(site => site.family === key))])),
  };
}

export function difference(current: Site[], other: Site[]) {
  const key = (site: Site) => JSON.stringify([site.file, site.kind, site.family, site.value, site.status, site.context]);
  const remaining = tally(other, key);
  return current.filter(site => {
    const id = key(site);
    if (!remaining[id]) return true;
    remaining[id]--;
    return false;
  });
}

const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
async function baseSites(revision: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'openmotion-ui-base-'));
  try {
    const archive = path.join(dir, 'source.tar');
    execFileSync('git', ['archive', '--format=tar', '-o', archive, revision, '--', 'studio/src', ':(glob)web/**/*.css', ':(glob)mcp-ui/**/*.css', ':(glob)packages/**/registry.json', ':(glob)packages/**/*.tsx', ':(glob)packages/**/*.css']);
    execFileSync('tar', ['-xf', archive, '-C', dir]);
    return await scan(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, out: { type: 'string', default: 'dist/ui-metrics' } } });
  const root = git(['rev-parse', '--show-toplevel']);
  const revision = git(['rev-parse', 'HEAD']);
  const base = values.base && git(['rev-parse', '--verify', '--end-of-options', values.base + '^{commit}']);
  const sites = await scan(root);
  const totals = summarize(sites);
  const before = base ? await baseSites(base) : undefined;
  const delta = before && { added: difference(sites, before), removed: difference(before, sites) };
  const baseline = before && summarize(before);
  const report = { scope, revision, source: 'working tree', base, totals, baseline, delta, sites };
  const format = (m: ReturnType<typeof metric>) => m.percent === null ? '— (0/0)' : m.percent + '% (' + m.hits + '/' + m.total + ')';
  const md = ['# UI adoption and style metrics', '', scope, '', 'Working tree at ' + revision + (base ? ' compared with ' + base : ''), '',
    '| Metric | Current | Base |', '| --- | ---: | ---: |',
    '| Component library coverage | ' + format(totals.coverage) + ' | ' + (baseline ? format(baseline.coverage) : '—') + ' |',
    '| Detached style rate | ' + format(totals.detached) + ' | ' + (baseline ? format(baseline.detached) : '—') + ' |', '',
    ...Object.entries(totals.coverageByFamily).map(([name, m]) => '- ' + name + ' coverage: ' + format(m)),
    ...Object.entries(totals.controls).map(([name, count]) => '- ' + name + ': ' + count),
    ...Object.entries(totals.stylesByFamily).filter(([key]) => key !== 'dynamic').map(([name, m]) => '- ' + name + ' detached: ' + format(m)),
    '- Unknown style occurrences: ' + (totals.styles.unknown ?? 0), ''];
  const issue = (site: Site) => site.status === 'detached' || site.status.includes('native');
  for (const [label, list] of Object.entries(delta ? { 'New findings': delta.added, 'Resolved findings': delta.removed, 'Current findings': sites } : { 'Current findings': sites })) {
    const findings = list.filter(issue);
    md.push('## ' + label + ' (' + findings.length + ')', '', ...findings.slice(0, 12).map(site => '- ' + site.file + ':' + site.line + ' — ' + site.status + ' · ' + site.value.replace(/\s+/g, ' ')), '');
  }
  md.push('Full locations, including unknowns and changes to adopted controls, are in report.json.');
  mkdirSync(values.out!, { recursive: true });
  writeFileSync(path.join(values.out!, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(values.out!, 'report.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
}
if (import.meta.main) await main();
