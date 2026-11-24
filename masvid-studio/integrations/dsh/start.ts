import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugin } from "./build.ts";
import { integrationConfig, integrationPatch } from "./config.ts";
import { profileModules } from "./install.ts";

const directory = path.dirname(fileURLToPath(import.meta.url));
const config = integrationConfig(path.resolve(directory, "../.."));
await mkdir(config.home, { recursive: true, mode: 0o700 });
// Refuse to rebuild the files used by another active instance of this launcher.
const lockPath = path.join(config.home, "launch.lock");
const lock = await open(lockPath, "wx", 0o600).catch(() => {
  throw new Error(
    `Another launcher may be using this home. Stop it first. After a crash, remove ${lockPath} only after confirming DSH has stopped.`,
  );
});
try {
  // Do not attach to or replace an unrelated service already using the port.
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(config.port, "127.0.0.1", () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const env = {
    ...process.env,
    MOTION_DATA_DIR: config.data,
    DSH_HOME: config.dshHome,
  };
  await buildPlugin(config.plugin);
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(directory, "node_modules/@deepseek-ai/dsh/lib/bin.js"), "--profile", "web", "--dump-config"], { env, cwd: directory });
  await writeFile(
    config.patch,
    integrationPatch(config, process.execPath, env, await profileModules(stdout)),
    { mode: 0o600 },
  );
  console.log(
    `DSH state: ${config.home}\nConfigure your model in DSH. Press Ctrl+C to stop DSH; the shared OpenMotion editor remains available.`,
  );
  const child = spawn(
    process.execPath,
    [
      path.join(directory, "node_modules/@deepseek-ai/dsh/lib/bin.js"),
      "--profile",
      "web",
      "--patch",
      config.patch,
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      String(config.port),
    ],
    { cwd: directory, env, stdio: "inherit" },
  );
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        resolve(code ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1)),
      );
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
} finally {
  await lock.close();
  await rm(lockPath, { force: true });
}
