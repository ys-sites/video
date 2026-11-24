import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateDownload, type PluginDownload } from "./download.ts";

const json = async (filename: string) => JSON.parse(await readFile(filename, "utf8"));

export function pluginCandidateFiles(version: string): string[] {
  const archive = `openmotion-dsh-${version}.tgz`;
  assert.equal(path.basename(archive), archive, "Invalid plugin archive name");
  return [archive, "dsh-plugin.json", "dsh-package-scan.json"];
}

export async function verifyCandidatePlugin(directory: string, version: string, commit: string): Promise<PluginDownload> {
  const [archive] = pluginCandidateFiles(version);
  const manifest = validateDownload(await json(path.join(directory, "dsh-plugin.json")));
  assert.equal(manifest.version, version, "Plugin version must match the application candidate");
  assert.equal(manifest.sourceCommit, commit, "Plugin source must match the application candidate");
  const bytes = await readFile(path.join(directory, archive));
  assert.equal(bytes.length, manifest.bytes, "Candidate plugin size differs");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256, "Candidate plugin checksum differs");
  const scan = await json(path.join(directory, "dsh-package-scan.json"));
  assert.equal(scan.status, "passed", "Candidate plugin scan must pass");
  assert.equal(scan.tgzSHA256, manifest.sha256, "Plugin scan belongs to different bytes");
  assert.equal(scan.version, version, "Plugin scan belongs to a different version");
  return manifest;
}
