import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { candidateFixture } from "./release-fixture.mjs";
import { downloadCandidate, verifyDownloaded } from "../.github/scripts/motion-release.mjs";
import { runFile } from "../scripts/runtime-assets.mjs";
import { pluginCandidateFiles, publishCandidatePlugin } from "../integrations/dsh/release.ts";
import { downloadManifestUrl, downloadPrefix } from "../integrations/dsh/download.ts";

const config = { endpoint: "https://example.r2.cloudflarestorage.com", bucket: "example-releases" };

function storage(env: NodeJS.ProcessEnv) {
  const objects = new Map<string, Buffer>();
  const writes: string[] = [];
  let corrupt = false;
  return {
    env, objects, writes,
    corrupt: () => { corrupt = true; },
    currentCommit: async () => { throw new Error("Release publication must not follow a moving main commit"); },
    execute: async (command: string, args: string[]) => {
      assert.equal(command, "aws");
      const key = args[args.indexOf("--key") + 1];
      if (args.includes("--if-none-match") && objects.has(key)) throw new Error("PreconditionFailed (412)");
      objects.set(key, await readFile(args[args.indexOf("--body") + 1]));
      writes.push(key);
      return "{}";
    },
    fetcher: (async (url: string | URL | Request) => {
      const bytes = objects.get(new URL(String(url)).pathname.slice(1));
      if (corrupt) return new Response("corrupt public bytes");
      return new Response(bytes ?? "missing", { status: bytes ? 200 : 404 });
    }) as typeof fetch,
  };
}

test("new candidates seal the plugin identity and bytes; old candidates remain readable", async t => {
  const legacy = await candidateFixture(t);
  assert.equal((await verifyDownloaded(legacy.directory, legacy.candidate.tgzSHA256)).schemaVersion, 3);
  const f = await candidateFixture(t, "main", { dsh: true });
  const candidate = await verifyDownloaded(f.directory, f.candidate.tgzSHA256);
  assert.equal(candidate.schemaVersion, 4);
  assert((await readFile(path.join(f.directory, "candidate-install.md"), "utf8")).includes(`openmotion-dsh-${candidate.version}.tgz`));
  for (const name of pluginCandidateFiles(candidate.version)) assert(candidate.files[name]);
  await writeFile(path.join(f.directory, pluginCandidateFiles(candidate.version)[0]), "changed plugin bytes");
  await assert.rejects(verifyDownloaded(f.directory, f.candidate.tgzSHA256), /Candidate file changed/);
});

test("the immutable Actions artifact carries and verifies all plugin files", async t => {
  const f = await candidateFixture(t, "main", { dsh: true });
  const zip = path.join(f.work, "candidate.zip");
  await runFile("zip", ["-q", zip, "candidate.json", ...Object.keys(f.candidate.files)], { cwd: f.directory });
  const bytes = await readFile(zip);
  const artifact = { id: 456, name: `motion-candidate-${f.candidate.version}`, expired: false, workflow_run: { id: 123 },
    size_in_bytes: bytes.length, digest: "sha256:" + createHash("sha256").update(bytes).digest("hex") };
  const producer = { id: 123, run_attempt: 1, event: "workflow_dispatch", head_branch: "main", head_sha: f.provenance.head_sha,
    head_repository: { full_name: "nexu-io/openmotion" }, status: "completed", conclusion: "success", path: ".github/workflows/motion-candidate.yml" };
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    if (address.includes("/actions/artifacts?")) return Response.json({ total_count: 1, artifacts: [artifact] });
    if (address.endsWith("/actions/runs/123")) return Response.json(producer);
    if (address.endsWith("/actions/artifacts/456/zip")) return new Response(null, { status: 302, headers: { location: "https://artifact.example.invalid/candidate.zip" } });
    assert.equal(address, "https://artifact.example.invalid/candidate.zip");
    assert(!new Headers(init?.headers).has("Authorization"));
    return new Response(bytes);
  };
  const output = path.join(f.work, "downloaded");
  const downloaded = await downloadCandidate(f.candidate.version, output, f.candidate.tgzSHA256, fetcher);
  assert.equal(downloaded.schemaVersion, 4);
  for (const name of pluginCandidateFiles(f.candidate.version)) assert.deepEqual(await readFile(path.join(output, name)), await readFile(path.join(f.directory, name)));
});

test("candidate sealing rejects a mismatched or unscanned plugin", async t => {
  const { sealCandidate } = await import("../.github/scripts/motion-release.mjs");
  const f = await candidateFixture(t, "main", { dsh: true });
  const filename = path.join(f.build, "dsh-plugin.json");
  const original = await readFile(filename, "utf8");
  const manifest = JSON.parse(original);
  const env = { ...f.env, MOTION_SOURCE_SHA: f.candidate.sourceCommit, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "nexu-io/openmotion/.github/workflows/motion-candidate.yml@refs/heads/main" };
  const seal = () => sealCandidate(f.build, path.join(f.work, "mismatch"), f.root, env);
  await writeFile(filename, "null");
  await assert.rejects(seal(), "A malformed manifest cannot downgrade to a legacy candidate");
  for (const patch of [{ version: "1.2.3" }, { sourceCommit: "a".repeat(40) }]) {
    const changed = { ...manifest, ...patch };
    changed.tarballUrl = changed.tarballUrl.replace(manifest.sourceCommit, changed.sourceCommit);
    await writeFile(filename, JSON.stringify(changed));
    await assert.rejects(seal(), /must match/);
  }
  await writeFile(filename, original);
  await writeFile(path.join(f.build, "dsh-package-scan.json"), JSON.stringify({ status: "failed" }));
  await assert.rejects(seal(), /scan must pass/);
});

test("formal plugin publication reuses frozen bytes and separates stable, test and main", async t => {
  for (const version of ["0.0.2", "0.0.3-test.7"]) {
    const f = await candidateFixture(t, "main", { version, dsh: true });
    const store = storage(f.env);
    await writeFile(path.join(f.directory, "publication.json"), JSON.stringify({ version, phase: "verified" }));
    const result = await publishCandidatePlugin(f.directory, config, store);
    assert("manifest" in result);
    const channel = version.includes("-test.") ? "test" : "stable";
    assert.equal(result.channel, channel);
    assert.equal(result.promoted, true);
    const snapshot = new URL(result.manifest.tarballUrl).pathname.slice(1);
    assert.deepEqual(store.objects.get(snapshot), await readFile(path.join(f.directory, pluginCandidateFiles(version)[0])));
    assert.deepEqual(store.writes, [snapshot, `${downloadPrefix}/${channel}/latest.json`]);
    assert(!store.objects.has(`${downloadPrefix}/main/latest.json`));
    await publishCandidatePlugin(f.directory, config, store);
    assert.equal(store.writes.filter(key => key.includes("/snapshots/")).length, 1, "Retry reuses the same immutable upload");
  }
});

test("superseded and archive-only releases retain snapshots without moving a plugin channel", async t => {
  for (const [phase, action] of [["superseded", "publish-test"], ["version-verified", "archive-only"]]) {
    const f = await candidateFixture(t, "main", { dsh: true });
    const store = storage({ ...f.env, MOTION_RELEASE_ACTION: action });
    await writeFile(path.join(f.directory, "publication.json"), JSON.stringify({ version: f.candidate.version, phase }));
    const result = await publishCandidatePlugin(f.directory, config, store);
    assert("promoted" in result && !result.promoted);
    assert.equal(store.writes.length, 1);
    assert(store.writes[0].includes("/snapshots/"));
  }
});

test("failed readback, incomplete application publication and untrusted entry cannot advance downloads", async t => {
  const f = await candidateFixture(t, "main", { dsh: true });
  const store = storage(f.env);
  await writeFile(path.join(f.directory, "publication.json"), JSON.stringify({ version: f.candidate.version, phase: "failed" }));
  await assert.rejects(publishCandidatePlugin(f.directory, config, store), /completed application publication/);
  assert.equal(store.writes.length, 0);
  await assert.rejects(publishCandidatePlugin(f.directory, config, { ...store, env: { ...f.env, GITHUB_EVENT_NAME: "push" } }), /Manual invocation/);
  await writeFile(path.join(f.directory, "publication.json"), JSON.stringify({ version: f.candidate.version, phase: "verified" }));
  const pointer = new URL(downloadManifestUrl("test")).pathname.slice(1);
  const previous = Buffer.from("previous download");
  store.objects.set(pointer, previous);
  store.corrupt();
  await assert.rejects(publishCandidatePlugin(f.directory, config, store), /verification failed/);
  assert.deepEqual(store.objects.get(pointer), previous);
});

test("publishing a retained legacy candidate does not rebuild or invent a plugin", async t => {
  const f = await candidateFixture(t);
  const store = storage(f.env);
  assert.deepEqual(await publishCandidatePlugin(f.directory, config, store), { skipped: "legacy-candidate-without-dsh" });
  assert.equal(store.writes.length, 0);
});

test("release workflows build the plugin before sealing and consume it without rebuilding", async () => {
  const build = await readFile(new URL("../.github/workflows/motion-candidate.yml", import.meta.url), "utf8");
  assert(build.indexOf("release.ts prepare") < build.indexOf("motion-release.mjs seal"));
  assert(build.includes("motion-scan.mjs plugin"));
  assert(!build.includes("secrets."));
  const workflow = await readFile(new URL("../.github/workflows/motion-publish-test.yml", import.meta.url), "utf8");
  for (const id of ["snapshot", "stable-snapshot"]) {
    const job = workflow.split("\n  " + id + ":\n")[1].split(/\n  [a-z][\w-]*:/)[0];
    assert(job.indexOf("motion-release.mjs archive") < job.indexOf("release.ts publish"));
    assert(job.includes("dsh-publication.json"));
    assert(!job.includes("release.ts prepare") && !job.includes("npm run pack"));
  }
});

test("the publication CLI completes with simulated storage and never rebuilds", async t => {
  const f = await candidateFixture(t, "main", { dsh: true });
  await writeFile(path.join(f.directory, "publication.json"), JSON.stringify({ version: f.candidate.version, phase: "verified" }));
  const preload = path.join(f.work, "storage.mjs"), writes = path.join(f.work, "writes.json");
  await writeFile(preload, `import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
const objects=new Map(), keys=[];
const execute=async(command,args)=>{
  if(command!=='aws') throw Error('Publication cannot build or spawn another command: '+command);
  const key=args[args.indexOf('--key')+1];
  objects.set(key,await readFile(args[args.indexOf('--body')+1]));
  keys.push(key); await writeFile(process.env.DSH_TEST_WRITES,JSON.stringify(keys));
  return {stdout:'{}',stderr:''};
};
const wrapped=()=>{throw Error('Use the promise adapter');};
wrapped[promisify.custom]=execute; cp.execFile=wrapped; syncBuiltinESMExports();
globalThis.fetch=async url=>{const bytes=objects.get(new URL(String(url)).pathname.slice(1)); return new Response(bytes||'missing',{status:bytes?200:404});};
`);
  const result = await runFile(process.execPath, ["--import", preload, fileURLToPath(new URL("../integrations/dsh/release.ts", import.meta.url)), "publish", f.directory], {
    env: { ...process.env, ...f.env, MOTION_R2_ENDPOINT: config.endpoint, MOTION_R2_BUCKET: config.bucket, DSH_TEST_WRITES: writes }, timeout: 10_000,
  });
  assert.equal(JSON.parse(result).promoted, true);
  assert.deepEqual(JSON.parse(await readFile(writes, "utf8")).at(-1), `${downloadPrefix}/test/latest.json`);
});
