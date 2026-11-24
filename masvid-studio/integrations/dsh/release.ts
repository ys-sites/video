import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { downloadOrigin, downloadPrefix, validateDownload, type PluginDownload } from "./download.ts";
import { publishPlugin } from "./publish.ts";
import { pluginCandidateFiles, verifyCandidatePlugin } from "./candidate.ts";
export { pluginCandidateFiles, verifyCandidatePlugin } from "./candidate.ts";

const execute = promisify(execFile);
const json = async (filename: string) => JSON.parse(await readFile(filename, "utf8"));

type PluginPublication = { skipped: "legacy-candidate-without-dsh" } | {
  version: string;
  sourceCommit: string;
  channel: "test" | "stable";
  promoted: boolean;
  manifest: PluginDownload;
};

export async function prepareCandidatePlugin(source: string, output: string, version: string, commit: string): Promise<PluginDownload> {
  const versions = await import(new URL("../../scripts/release-version.mjs", import.meta.url).href);
  versions.checkReleaseVersion(version);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal((await execute("git", ["rev-parse", "HEAD"], { cwd: source })).stdout.trim(), commit);
  const staging = await mkdtemp(path.join(tmpdir(), "dsh-candidate-build-"));
  try {
    const builder = await import(pathToFileURL(path.join(source, "integrations/dsh/build.ts")).href);
    await builder.buildPlugin(staging);
    const pkg = await json(path.join(staging, "package.json"));
    pkg.version = version;
    await writeFile(path.join(staging, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    await execute("npm", ["pack", staging, "--ignore-scripts", "--pack-destination", path.resolve(output)], { cwd: source });
    const bytes = await readFile(path.join(output, pluginCandidateFiles(version)[0]));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const host = await json(path.join(source, "integrations/dsh/package.json"));
    const manifest = validateDownload({ schemaVersion: 1, name: "openmotion-dsh", version, sourceCommit: commit,
      dshVersion: host.dependencies["@deepseek-ai/dsh"], sha256, bytes: bytes.length,
      tarballUrl: `${downloadOrigin}/${downloadPrefix}/snapshots/${commit}/${sha256}/openmotion-dsh.tgz` });
    await writeFile(path.join(output, "dsh-plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function publishCandidatePlugin(
  directory: string,
  config: { endpoint: string; bucket: string },
  dependencies: NonNullable<Parameters<typeof publishPlugin>[1]> & { env?: NodeJS.ProcessEnv } = {},
): Promise<PluginPublication> {
  // The maintained release controller is dependency-free and validates manual entry/provenance.
  const release = await import(new URL("../../.github/scripts/motion-release.mjs", import.meta.url).href);
  const { env = process.env, ...storage } = dependencies;
  const inputs = release.releaseInputs(env);
  const candidate = await release.verifyDownloaded(directory, inputs.expectedSHA256, inputs.version);
  if (candidate.schemaVersion < 4) return { skipped: "legacy-candidate-without-dsh" };
  const manifest = await verifyCandidatePlugin(directory, candidate.version, candidate.sourceCommit);
  const publication = await json(path.join(directory, "publication.json"));
  assert.equal(publication.version, candidate.version);
  assert(["verified", "version-verified", "superseded"].includes(publication.phase), "Require completed application publication");
  const promote = inputs.action !== "archive-only" && publication.phase === "verified";
  const channel: "test" | "stable" = release.releaseChannel(candidate.version);
  await publishPlugin({ ...config, commit: manifest.sourceCommit, archive: path.join(directory, pluginCandidateFiles(candidate.version)[0]),
    version: manifest.version, dshVersion: manifest.dshVersion, channel, promote }, storage);
  const result = { version: candidate.version, sourceCommit: candidate.sourceCommit, channel, promoted: promote, manifest };
  await writeFile(path.join(directory, "dsh-publication.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, directory, source] = process.argv.slice(2);
  assert(directory, "Usage: release.ts prepare|publish <candidate-directory> [source-root]");
  if (command === "prepare") {
    assert(source, "Candidate preparation requires its frozen source checkout");
    console.log(JSON.stringify(await prepareCandidatePlugin(path.resolve(source), path.resolve(directory), process.env.MOTION_VERSION || "", process.env.MOTION_SOURCE_SHA || "")));
  } else {
    assert.equal(command, "publish");
    console.log(JSON.stringify(await publishCandidatePlugin(path.resolve(directory), { endpoint: process.env.MOTION_R2_ENDPOINT || "", bucket: process.env.MOTION_R2_BUCKET || "" })));
  }
}
