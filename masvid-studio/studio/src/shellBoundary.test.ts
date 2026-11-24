import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { escapeRegex } from "./utils/regex";
import { getHistoryShortcutLabel } from "./utils/historyShortcuts";
import { settingsSectionLabel } from "./motion/settingsMeta";
import { LAZY_PAGE_MODULE_PATHS } from "./router/lazyPages";
import { readWorkspacePage } from "./motion/workspacePageRouting";
import {
  isWorkspacePageOpen,
  resolveActiveWorkspaceRoute,
  resolveNavTrackingPage,
  resolveRouteArrival,
  workspaceRouteRegistry,
} from "./router/routeRegistry";

const studioSrcDir = import.meta.dirname;
const resolveExts = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];
const jsToTsSwaps: readonly [RegExp, readonly string[]][] = [
  [/\.jsx$/i, [".tsx", ".ts"]],
  [/\.js$/i, [".ts", ".tsx"]],
  [/\.mjs$/i, [".mts", ".ts"]],
  [/\.cjs$/i, [".cts", ".ts"]],
];

function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const ext of resolveExts) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const [pattern, replacements] of jsToTsSwaps) {
    if (!pattern.test(base)) continue;
    for (const replacement of replacements) {
      const candidate = base.replace(pattern, replacement);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function isTypeOnlyImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false; // Side-effect import: `import "pkg"`
  if (clause.isTypeOnly) return true;
  if (clause.name) return false; // Default value import
  const bindings = clause.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((el) => el.isTypeOnly);
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (!clause || ts.isNamespaceExport(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every((el) => el.isTypeOnly);
}

function collectRuntimeSpecifiers(sourceText: string, fileName: string): string[] {
  const scriptKind = fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, false, scriptKind);
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
} {
  const files = new Set<string>([entryFile]);
  const externals = new Set<string>();
  const queue = [entryFile];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!/\.(?:[cm]?[jt]sx?)$/i.test(current)) continue;
    const source = readFileSync(current, "utf8");
    for (const specifier of collectRuntimeSpecifiers(source, current)) {
      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeModule(current, specifier);
        if (resolved && !files.has(resolved)) {
          files.add(resolved);
          queue.push(resolved);
        }
      } else {
        externals.add(specifier);
      }
    }
  }

  return { files, externals };
}

describe("Studio entry shell dependency boundary", () => {
  it("keeps @hyperframes/parsers barrel, heavy editor helpers, and lazy workspace pages out of main.tsx static graph", () => {
    const mainEntry = path.resolve(studioSrcDir, "main.tsx");
    const graph = collectStaticImportGraph(mainEntry);

    // Positive traversal controls so a broken resolver cannot make negative assertions pass vacuously.
    expect(graph.files.has(path.resolve(studioSrcDir, "motion/MotionApp.tsx"))).toBe(true);
    expect(graph.files.has(path.resolve(studioSrcDir, "motion/WorkspaceFrame.tsx"))).toBe(true);
    expect(graph.files.has(path.resolve(studioSrcDir, "router/RouteViewport.tsx"))).toBe(true);
    expect(graph.externals.has("react")).toBe(true);

    const forbiddenExternals = [
      "@hyperframes/parsers",
      "@babel/parser",
      "recast",
      "esprima",
      "acorn",
      "cssomnom",
      "linkedom",
    ];
    for (const pkg of forbiddenExternals) {
      expect(graph.externals.has(pkg), `main.tsx must not statically import ${pkg}`).toBe(false);
    }

    const forbiddenEditorModules = [
      "utils/sourcePatcher.ts",
      "utils/studioHelpers.ts",
      "i18n/sourceCatalog.ts",
      "i18n/skill-library/index.ts",
      ...LAZY_PAGE_MODULE_PATHS,
    ];
    for (const rel of forbiddenEditorModules) {
      const fullPath = path.resolve(studioSrcDir, rel);
      expect(existsSync(fullPath), `guarded module must exist: ${rel}`).toBe(true);
      expect(graph.files.has(fullPath), `main.tsx must not statically import ${rel}`).toBe(false);
    }

    // Ensure no raw Studio i18n locale JSON files or per-locale virtual bundles are statically pulled into main.tsx.
    const i18nDir = path.resolve(studioSrcDir, "i18n") + path.sep;
    for (const file of graph.files) {
      expect(
        file.startsWith(i18nDir) && file.endsWith(".json"),
        `main.tsx must not statically import locale dictionary JSON: ${file}`,
      ).toBe(false);
    }
    for (const ext of graph.externals) {
      expect(
        ext.startsWith("virtual:openmotion-i18n/locale/"),
        `main.tsx must load per-locale virtual chunks dynamically, not statically: ${ext}`,
      ).toBe(false);
    }
  });

  it("keeps WorkspaceBreadcrumb decoupled from SettingsCenter", () => {
    const breadcrumb = path.resolve(studioSrcDir, "motion/WorkspaceBreadcrumb.tsx");
    const settingsCenter = path.resolve(studioSrcDir, "motion/SettingsCenter.tsx");
    const graph = collectStaticImportGraph(breadcrumb);
    expect(graph.files.has(path.resolve(studioSrcDir, "motion/settingsMeta.ts"))).toBe(true);
    expect(graph.files.has(settingsCenter)).toBe(false);
  });

  it("captures side-effect imports and resolves bundler .js -> .ts/.tsx specifiers", () => {
    const sample = [
      'import "@hyperframes/parsers";',
      'import type { Foo } from "type-only-pkg";',
      'import { type Bar } from "inline-type-only-pkg";',
      'import { type Baz, realValue } from "mixed-pkg";',
      'export { helper } from "./utils/regex.js";',
      'export type { SettingsSectionMeta } from "./motion/settingsMeta.js";',
    ].join("\n");

    expect(collectRuntimeSpecifiers(sample, "virtual.tsx")).toEqual([
      "@hyperframes/parsers",
      "mixed-pkg",
      "./utils/regex.js",
    ]);

    expect(
      resolveRelativeModule(path.resolve(studioSrcDir, "main.tsx"), "./utils/regex.js"),
    ).toBe(path.resolve(studioSrcDir, "utils/regex.ts"));
    expect(
      resolveRelativeModule(
        path.resolve(studioSrcDir, "components/editor/PropertyPanelFlat.tsx"),
        "./propertyPanelAudioFxGroup.js",
      ),
    ).toBe(path.resolve(studioSrcDir, "components/editor/propertyPanelAudioFxGroup.tsx"));
  });

  it("preserves extracted lightweight shell helper behavior", () => {
    expect(escapeRegex("a+b*(c)?[d]")).toBe("a\\+b\\*\\(c\\)\\?\\[d\\]");
    expect(getHistoryShortcutLabel("undo")).toMatch(/^(?:Cmd|Ctrl)\+Z$/);
    expect(getHistoryShortcutLabel("redo")).toMatch(/^(?:Cmd|Ctrl)\+Shift\+Z$/);
    expect(settingsSectionLabel("providers")).toBe("Model providers");
    expect(settingsSectionLabel("brand-kit")).toBe("Settings");
  });
});

describe("workspace route registry", () => {
  it("marks only editor, explore, and assets as keepAlive", () => {
    const keepAliveIds = workspaceRouteRegistry.filter((r) => r.keepAlive).map((r) => r.id);
    expect(keepAliveIds.sort()).toEqual(["assets", "editor", "explore"]);
  });

  it("resolves active routes, tracking pages, and arrival views consistently", () => {
    const explore = readWorkspacePage("");
    expect(resolveActiveWorkspaceRoute(explore, { templatesPage: false, standaloneMcp: false }).id).toBe("explore");
    expect(resolveNavTrackingPage(explore, { templatesPage: false, standaloneMcp: false })).toBe("explore");
    expect(resolveRouteArrival(explore, false)).toBe("explore");
    expect(isWorkspacePageOpen(explore, false)).toBe(true);

    const cinemaScene = readWorkspacePage("?page=cinema&scene=text-to-video");
    expect(resolveActiveWorkspaceRoute(cinemaScene, { templatesPage: false, standaloneMcp: false }).id).toBe("studio");
    expect(resolveNavTrackingPage(cinemaScene, { templatesPage: false, standaloneMcp: false })).toBe("creative_studio");
    expect(resolveRouteArrival(cinemaScene, false)).toBeNull();

    const cinemaLanding = readWorkspacePage("?page=cinema");
    expect(resolveActiveWorkspaceRoute(cinemaLanding, { templatesPage: false, standaloneMcp: false }).id).toBe("cinema");
    expect(resolveRouteArrival(cinemaLanding, false)).toBe("cinema");

    const editor = readWorkspacePage("?project=project", "#project/project");
    expect(resolveActiveWorkspaceRoute(editor, { templatesPage: false, standaloneMcp: false }).id).toBe("editor");
    expect(isWorkspacePageOpen(editor, false)).toBe(false);

    const mcp = readWorkspacePage("?page=mcp");
    expect(resolveActiveWorkspaceRoute(mcp, { templatesPage: false, standaloneMcp: true }).id).toBe("mcp");
    expect(resolveNavTrackingPage(mcp, { templatesPage: false, standaloneMcp: true })).toBe("mcp");
  });
});
