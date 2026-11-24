import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isMain } from '../shared/entry.ts';
import {
  RESERVED_BACKEND_PREFIXES,
  SPA_ROUTE_PREFIXES,
  isSpaRoutePath,
} from '../shared/spa-routes.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const studioSrcDir = path.resolve(root, 'studio/src');

const REQUIRED_RESERVED_BACKEND_PREFIXES = [
  '/api',
  '/motion-api',
  '/design-api',
  '/mcp',
  '/mcp-ui',
  '/connect',
  '/sessions',
  '/editor-assets',
  '/guide-assets',
  '/design-system',
  '/web',
  '/.well-known',
  '/__hyperframes_config',
] as const;

const FORBIDDEN_SHELL_EXTERNALS = [
  '@hyperframes/parsers',
  '@babel/parser',
  'recast',
  'esprima',
  'acorn',
  'cssomnom',
  'linkedom',
] as const;

const FORBIDDEN_SHELL_STATIC_MODULES = [
  'utils/sourcePatcher.ts',
  'utils/studioHelpers.ts',
  'i18n/sourceCatalog.ts',
  'i18n/skill-library/index.ts',
] as const;

const RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'] as const;
const JS_TO_TS_SWAPS: readonly [RegExp, readonly string[]][] = [
  [/\.jsx$/i, ['.tsx', '.ts']],
  [/\.js$/i, ['.ts', '.tsx']],
  [/\.mjs$/i, ['.mts', '.ts']],
  [/\.cjs$/i, ['.cts', '.ts']],
];

function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const [pattern, replacements] of JS_TO_TS_SWAPS) {
    if (!pattern.test(base)) continue;
    for (const replacement of replacements) {
      const candidate = base.replace(pattern, replacement);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function isTypeOnlyImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (!clause || ts.isNamespaceExport(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every(element => element.isTypeOnly);
}

function parseSourceFile(sourceText: string, fileName: string): ts.SourceFile {
  const scriptKind = fileName.endsWith('.tsx') || fileName.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, false, scriptKind);
}

function collectRuntimeSpecifiers(sourceText: string, fileName: string): string[] {
  const sourceFile = parseSourceFile(sourceText, fileName);
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (!isTypeOnlyImport(statement.importClause)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      if (!isTypeOnlyExport(statement)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
  }

  return specifiers;
}

function collectStaticImportGraph(entryFile: string): {
  files: Set<string>;
  externals: Set<string>;
  fileChain: Map<string, string[]>;
  externalChain: Map<string, string[]>;
} {
  const files = new Set<string>([entryFile]);
  const externals = new Set<string>();
  const fileChain = new Map<string, string[]>([[entryFile, [entryFile]]]);
  const externalChain = new Map<string, string[]>();
  const queue = [entryFile];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!/\.(?:[cm]?[jt]sx?)$/i.test(current)) continue;
    const source = readFileSync(current, 'utf8');
    const chain = fileChain.get(current)!;

    for (const specifier of collectRuntimeSpecifiers(source, current)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveRelativeModule(current, specifier);
        if (resolved && !files.has(resolved)) {
          files.add(resolved);
          fileChain.set(resolved, [...chain, resolved]);
          queue.push(resolved);
        }
      } else {
        externals.add(specifier);
        if (!externalChain.has(specifier)) {
          externalChain.set(specifier, [...chain, specifier]);
        }
      }
    }
  }

  return { files, externals, fileChain, externalChain };
}

function formatChain(chain: string[] | undefined): string {
  if (!chain || chain.length === 0) return '(unknown)';
  return chain
    .map(step => (step.startsWith(root) ? path.relative(root, step).replace(/\\/g, '/') : step))
    .join(' -> ');
}

function extractLazyPageModulePaths(sourceText: string, fileName: string): string[] {
  const sourceFile = parseSourceFile(sourceText, fileName);
  const paths: string[] = [];

  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)
      ? unwrap(node.expression)
      : node;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== 'LAZY_PAGE_MODULE_PATHS' || !decl.initializer) continue;
      const expr = unwrap(decl.initializer);
      if (ts.isArrayLiteralExpression(expr)) {
        for (const el of expr.elements) {
          if (ts.isStringLiteral(el)) paths.push(el.text);
        }
      }
    }
  }

  return paths;
}

function extractRouterLeafPrefixes(sourceText: string, fileName: string): Set<string> {
  const sourceFile = parseSourceFile(sourceText, fileName);
  const prefixes = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'leaf' &&
      node.arguments.length >= 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const routePath = node.arguments[0].text;
      if (routePath !== '*') {
        const firstSegment = routePath.split('/')[0];
        if (firstSegment) prefixes.add(`/${firstSegment}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return prefixes;
}

function prefixesCollide(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function checkSpaRoutePrefixes(routerLeafPrefixes: Set<string>): void {
  const seen = new Set<string>();
  const reservedSet = new Set<string>(RESERVED_BACKEND_PREFIXES);

  for (const required of REQUIRED_RESERVED_BACKEND_PREFIXES) {
    assert.ok(
      reservedSet.has(required),
      `shared/spa-routes.ts RESERVED_BACKEND_PREFIXES is missing required backend/cloud prefix "${required}".`,
    );
    assert.equal(
      isSpaRoutePath(required),
      false,
      `Reserved backend/cloud prefix "${required}" must never match isSpaRoutePath().`,
    );
    assert.equal(
      isSpaRoutePath(`${required}/probe`),
      false,
      `Nested reserved backend/cloud path "${required}/probe" must never match isSpaRoutePath().`,
    );
  }

  for (const prefix of SPA_ROUTE_PREFIXES) {
    assert.ok(prefix.startsWith('/'), `SPA_ROUTE_PREFIXES entry "${prefix}" must start with "/".`);
    if (prefix !== '/') {
      assert.ok(!prefix.endsWith('/'), `SPA_ROUTE_PREFIXES entry "${prefix}" must not have a trailing slash.`);
    }
    assert.ok(!seen.has(prefix), `Duplicate entry "${prefix}" in SPA_ROUTE_PREFIXES.`);
    seen.add(prefix);

    if (prefix === '/') continue;

    for (const reserved of RESERVED_BACKEND_PREFIXES) {
      assert.ok(
        !prefixesCollide(prefix, reserved),
        `SPA_ROUTE_PREFIXES entry "${prefix}" collides with reserved backend/cloud prefix "${reserved}" in shared/spa-routes.ts.`,
      );
    }

    assert.ok(
      routerLeafPrefixes.has(prefix),
      `SPA_ROUTE_PREFIXES entry "${prefix}" has no matching top-level leaf in studio/src/router/createAppRouter.tsx.`,
    );
  }
}

export async function checkRouting(): Promise<void> {
  const lazyPagesFile = path.resolve(studioSrcDir, 'router/lazyPages.ts');
  const routerFile = path.resolve(studioSrcDir, 'router/createAppRouter.tsx');
  const [lazyPagesSource, routerSource] = await Promise.all([
    readFile(lazyPagesFile, 'utf8'),
    readFile(routerFile, 'utf8'),
  ]);

  const routerLeafPrefixes = extractRouterLeafPrefixes(routerSource, routerFile);
  assert.ok(
    routerLeafPrefixes.size > 0,
    'Failed to parse route leaves from studio/src/router/createAppRouter.tsx.',
  );
  checkSpaRoutePrefixes(routerLeafPrefixes);

  const lazyPagePaths = extractLazyPageModulePaths(lazyPagesSource, lazyPagesFile);
  assert.ok(
    lazyPagePaths.length > 0,
    'Failed to parse LAZY_PAGE_MODULE_PATHS from studio/src/router/lazyPages.ts.',
  );

  const mainEntry = path.resolve(studioSrcDir, 'main.tsx');
  const graph = collectStaticImportGraph(mainEntry);

  // Positive traversal controls so a broken resolver cannot silently pass negative assertions.
  for (const expectedRel of ['motion/MotionApp.tsx', 'motion/WorkspaceFrame.tsx', 'router/RouteViewport.tsx']) {
    const fullPath = path.resolve(studioSrcDir, expectedRel);
    assert.ok(
      graph.files.has(fullPath),
      `Routing boundary check positive control failed: ${expectedRel} was not reached from studio/src/main.tsx.`,
    );
  }
  assert.ok(
    graph.externals.has('react'),
    'Routing boundary check positive control failed: "react" was not reached from studio/src/main.tsx.',
  );

  for (const pkg of FORBIDDEN_SHELL_EXTERNALS) {
    assert.ok(
      !graph.externals.has(pkg),
      `Studio App Shell must not statically import heavy parser package "${pkg}" (import chain: ${formatChain(graph.externalChain.get(pkg))}).`,
    );
  }

  for (const rel of [...FORBIDDEN_SHELL_STATIC_MODULES, ...lazyPagePaths]) {
    const fullPath = path.resolve(studioSrcDir, rel);
    assert.ok(existsSync(fullPath), `Guarded Studio module does not exist: studio/src/${rel}`);
    assert.ok(
      !graph.files.has(fullPath),
      `Studio App Shell must not statically import lazy/editor module "studio/src/${rel}" (import chain: ${formatChain(graph.fileChain.get(fullPath))}).`,
    );
  }

  const i18nDir = path.resolve(studioSrcDir, 'i18n') + path.sep;
  for (const file of graph.files) {
    assert.ok(
      !(file.startsWith(i18nDir) && file.endsWith('.json')),
      `Studio App Shell must not statically import locale dictionary JSON "${path.relative(root, file)}" (import chain: ${formatChain(graph.fileChain.get(file))}).`,
    );
  }
  for (const ext of graph.externals) {
    assert.ok(
      !ext.startsWith('virtual:openmotion-i18n/locale/'),
      `Studio App Shell must load locale virtual chunk "${ext}" dynamically, not statically (import chain: ${formatChain(graph.externalChain.get(ext))}).`,
    );
  }

  const breadcrumbEntry = path.resolve(studioSrcDir, 'motion/WorkspaceBreadcrumb.tsx');
  const settingsMetaPath = path.resolve(studioSrcDir, 'motion/settingsMeta.ts');
  const settingsCenterPath = path.resolve(studioSrcDir, 'motion/SettingsCenter.tsx');
  const breadcrumbGraph = collectStaticImportGraph(breadcrumbEntry);
  assert.ok(
    breadcrumbGraph.files.has(settingsMetaPath),
    'WorkspaceBreadcrumb.tsx positive control failed: motion/settingsMeta.ts was not reached.',
  );
  assert.ok(
    !breadcrumbGraph.files.has(settingsCenterPath),
    `WorkspaceBreadcrumb.tsx must not statically import SettingsCenter.tsx (import chain: ${formatChain(breadcrumbGraph.fileChain.get(settingsCenterPath))}).`,
  );
}

if (isMain(import.meta.url)) {
  await checkRouting();
  console.log('Studio routing prefixes and App Shell static boundary checks passed.');
}
