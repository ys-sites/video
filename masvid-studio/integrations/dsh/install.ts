import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile, rename, rm, mkdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";

const execute = promisify(execFile);
const checkout = fileURLToPath(new URL("../../", import.meta.url));
type Options = { profile: string; dataDirectory: string; dshHome?: string; language?: string; url?: string; resume?: string };

export function installationPaths(options: Options, env = process.env) {
  assert(/^[a-zA-Z0-9_-]+$/.test(options.profile || ""), "Pass the current DSH --profile explicitly");
  assert(path.isAbsolute(options.dataDirectory || ""), "Pass an absolute --data-dir for this workspace");
  const dshHome = options.dshHome || env.DSH_HOME || path.join(os.homedir(), ".dsh");
  assert(path.isAbsolute(dshHome), "DSH_HOME must be absolute");
  const profileDirectory = path.join(dshHome, "profiles", options.profile);
  return { dshHome, profileDirectory, patch: path.join(profileDirectory, "cordis.patch.yml") };
}

export async function workspacePatch(text: string, root: string, data: string, node: string, inheritedModules: string[] = []) {
  const { parseDocument, isSeq, isMap } = await import("yaml");
  const doc = parseDocument(text);
  assert.equal(doc.errors.length, 0, "Invalid existing DSH profile YAML; preserve it for manual repair");
  assert(isSeq(doc.contents), "Expected a DSH patch list");
  const value = (row: unknown, key: string): unknown => (row as { get: (key: string) => unknown }).get(key);
  const modules = new Set(inheritedModules);
  let entry: any;
  for (const row of doc.contents.items) {
    if (!isMap(row)) continue;
    if (value(row, "id") === "mcp-openmotion" && value(row, "disabled") !== true)
      throw new Error("Disable the existing mcp-openmotion adapter before enabling the workspace plugin");
    const inserted = row.get("insert");
    for (const candidate of [row, ...(isSeq(inserted) ? inserted.items : [])]) {
      if (!isMap(candidate)) continue;
      if (typeof value(candidate, "name") === "string") modules.add(value(candidate, "name") as string);
      if (value(candidate, "id") === "mcp-openmotion" && value(candidate, "disabled") !== true)
        throw new Error("Disable the existing mcp-openmotion adapter before enabling the workspace plugin");
      if (value(candidate, "id") !== "openmotion-workspace") continue;
      assert(!entry, "Multiple OpenMotion workspace entries; select one before installation");
      entry = candidate;
    }
  }
  if (entry) {
    for (const [key, wanted] of [["root", root], ["dataDirectory", data]]) {
      const existing = entry.getIn(["config", key]);
      assert(typeof existing === "string" && path.resolve(existing) === wanted,
        "The profile uses another OpenMotion installation/workspace; keep it or choose a different profile");
    }
    entry.set("name", path.join(root, "integrations/dsh/dist/plugin/lib/index.js"));
    entry.setIn(["config", "node"], node);
    entry.delete("disabled");
  } else {
    doc.add({ insert: [{ id: "openmotion-workspace", name: path.join(root, "integrations/dsh/dist/plugin/lib/index.js"),
      config: { root, dataDirectory: data, node } }] });
  }
  const cards = [
    { id: "action-cards", name: "@deepseek-ai/dsh-action-cards" },
    { id: "client-ui-action-cards", name: "@deepseek-ai/dsh-client-ui-action-cards" },
  ].filter(entry => !modules.has(entry.name));
  if (cards.length) doc.add({ insert: cards });
  return doc.toString();
}

// Bind checks to the requested workspace, never another healthy DSH instance.
export function installationActive(status: any, root: string, data: string): boolean {
  return status?.applicationRoot === root && status?.dataDirectory === data && Array.isArray(status.tools)
    && ["openmotion_get_project", "openmotion_list_templates"].every(name => status.tools.includes("mcp__openmotion__" + name));
}

export async function profileModules(text: string): Promise<string[]> {
  const { parseDocument } = await import("yaml");
  const composed = parseDocument(text, { customTags: [{ tag: "tag:yaml.org,2002:js", resolve: (value: string) => value }] });
  assert.equal(composed.errors.length, 0, "Could not inspect the existing DSH profile");
  const modules: string[] = [];
  function collect(rows: any[]) {
    for (const row of rows) {
      if (typeof row.name === "string") modules.push(row.name);
      if (row.group && Array.isArray(row.config)) collect(row.config);
    }
  }
  const rows = composed.toJS();
  assert(Array.isArray(rows), "Expected a composed DSH entry list");
  collect(rows);
  return modules;
}

export async function installDsh(options: Options) {
  assert(Number(process.versions.node.split(".")[0]) >= 24, "Use Node.js 26.11.1 for source installation (24+ required)");
  const paths = installationPaths(options);
  const root = await realpath(checkout);
  await mkdir(options.dataDirectory, { recursive: true });
  const data = await realpath(options.dataDirectory);
  assert((await stat(path.join(paths.profileDirectory, "package.json"))).isFile(), "Use an existing DSH profile");
  const original = await readFile(paths.patch, "utf8");
  const language = options.language || process.env.OPENMOTION_ONBOARDING_LANGUAGE || "en";
  assert(["en", "zh", "ja", "ko", "fr", "es", "pt"].includes(language), "Use a supported --language");
  const env = { ...process.env, DSH_HOME: paths.dshHome, MOTION_DATA_DIR: data, OPENMOTION_ONBOARDING_LANGUAGE: language,
    PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || "") };
  const phases: { phase: string; milliseconds: number }[] = [];
  async function stage<T>(phase: string, run: () => Promise<T>): Promise<T> {
    console.error("[OpenMotion] " + phase);
    const started = Date.now(), result = await run();
    phases.push({ phase, milliseconds: Date.now() - started });
    return result;
  }
  const run = (command: string, args: string[], cwd = root) => execute(command, args, { cwd, env, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
  const state = await import(new URL("../../scripts/source-build-state.mjs", import.meta.url).href);
  async function dependencies(directory: string) {
    if (!await state.dependenciesCurrent(directory, { inspectInstalledLock: true })) await run("npm", ["ci", "--include=dev"], directory);
    await state.recordDependencies(directory);
  }
  await stage("dependencies (reuse matching locks)", async () => {
    await dependencies(root);
    await dependencies(path.join(root, "integrations/dsh"));
  });
  const dump = await run(process.execPath, [path.join(root, "integrations/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"),
    "--profile", options.profile, "--dump-config"]);
  const patch = await workspacePatch(original, root, data, process.execPath, await profileModules(dump.stdout));
  await stage("Studio (reuse matching build)", async () => {
    if (!await state.sourceBuildCurrent(root)) {
      await run("npm", ["run", "build:studio"]);
      await state.recordSourceBuild(root);
    }
  });
  // A local source plugin needs no tarball, profile package installation or new host.
  await stage("workspace plugin", async () => {
    const { buildPlugin } = await import("./build.ts");
    await buildPlugin(path.join(root, "integrations/dsh/dist/plugin"));
  });
  const temporary = paths.patch + ".openmotion-" + process.pid;
  try {
    await writeFile(temporary, patch, { flag: "wx", mode: 0o600 });
    assert.equal(await readFile(paths.patch, "utf8"), original, "Profile changed during installation; retry without overwriting it");
    if (patch !== original) await rename(temporary, paths.patch);
  } finally { await rm(temporary, { force: true }); }
  const publicSkill = await stage("official OpenMotion Skill", async () => {
    try {
      const { installPublicSkill } = await import("../../scripts/install-public-skill.ts");
      const ref = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
      return await installPublicSkill({ host: "deepseek", ref, projectDirectory: paths.profileDirectory, env,
        run: async (_command, args, settings: any) => {
          // Resolve npm through PATH, including standalone Node distributions.
          await execute("npm", args.slice(1), { ...settings, env, cwd: paths.profileDirectory });
        } });
    } catch (error) { return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) }; }
  });
  const flow = await import(new URL("../../scripts/install-onboarding.mjs", import.meta.url).href);
  const receiptFile = options.resume || path.join(paths.profileDirectory, "openmotion-onboarding.json");
  let onboarding;
  try { onboarding = JSON.parse(await readFile(receiptFile, "utf8")); }
  catch (error) { if (options.resume || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (onboarding) {
    assert(onboarding.applicationRoot === root && onboarding.dataDirectory === data && onboarding.host === "deepseek",
      "Resume the original installation/workspace");
    // Upgrade only the host handoff; retain the receipt's frozen selections and language.
    if (onboarding.cardPresentation.tool !== "propose_action") {
      const prepared = await flow.prepareInstallationOnboarding({ appRoot: root, dataDirectory: data, host: "deepseek",
        language: onboarding.inlinePresentation.language, templateIds: onboarding.inlinePresentation.templateIds });
      onboarding.cardPresentation = prepared.cardPresentation;
    }
  } else onboarding = await stage("prepare welcome and three recommendations", () => flow.prepareInstallationFlow({
    appRoot: root, dataDirectory: data, host: "deepseek", language,
  }));
  await writeFile(path.join(paths.profileDirectory, "openmotion-onboarding.json"), JSON.stringify(onboarding, null, 2) + "\n", { mode: 0o600 });
  let active = false;
  let nativeCardsAvailable = false;
  const webUrl = options.url || process.env.DSH_WEB_URL;
  if (webUrl) {
    const url = new URL(webUrl);
    assert(["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && !url.username && !url.password, "Use the actual local DSH_WEB_URL");
    const statusUrl = new URL("openmotion-dsh/status", url.href.endsWith("/") ? url : url.href + "/");
    await stage("check live workspace activation", async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const status = await (await fetch(statusUrl, { signal: AbortSignal.timeout(1500), redirect: "error" })).json();
          active = installationActive(status, root, data);
          nativeCardsAvailable = active && status.nativeCardsAvailable === true;
        }
        catch { /* A watched profile can take a moment to activate. */ }
        if (active && nativeCardsAvailable) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    });
  }
  return { installationStatus: active ? "active" : "configured", onboardingStatus: "awaiting_host_delivery", onboardingComplete: false,
    profile: options.profile, dataDirectory: data, publicSkill, phases, nativeCardsAvailable,
    detailsFile: path.join(paths.profileDirectory, "openmotion-onboarding.json"),
    cardPresentation: onboarding.cardPresentation, preview: { previewUrl: onboarding.preview?.previewUrl },
    nextActions: [active ? "Refresh the current DSH browser page once if OpenMotion is missing; keep this chat and do not restart DSH."
      : "Check activation in this DSH profile. Do not kill the current host or claim MCP is connected yet.",
    "Load cardPresentation.skill, then call cardPresentation.tool with cardPresentation.arguments in this same turn. The native card opens the template library beside this chat.",
    "A prepared receipt, tools or healthy Studio do not complete onboarding. Show the shared welcome and three recommendations; report any display blocker instead of declaring completion."] };
}

if (process.argv[1] && pathToFileURL(await realpath(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { profile: { type: "string" }, "data-dir": { type: "string" }, "dsh-home": { type: "string" }, language: { type: "string" }, url: { type: "string" }, resume: { type: "string" } } });
  try { console.log(JSON.stringify(await installDsh({ profile: values.profile!, dataDirectory: values["data-dir"]!, dshHome: values["dsh-home"], language: values.language, url: values.url, resume: values.resume }), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
