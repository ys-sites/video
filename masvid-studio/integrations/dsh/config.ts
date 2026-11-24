import path from "node:path";
import { homedir } from "node:os";

/** DSH and MCP must use the same OpenMotion data root as Studio. */
export function integrationConfig(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const home = path.resolve(
    env.OPENMOTION_DSH_HOME || path.join(homedir(), ".openmotion-dsh"),
  );
  const port = Number(env.OPENMOTION_DSH_PORT || 3080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("OPENMOTION_DSH_PORT must be between 1 and 65535.");
  return {
    root,
    home,
    port,
    data: path.resolve(env.MOTION_DATA_DIR || path.join(home, "data")),
    dshHome: path.join(home, "dsh"),
    plugin: path.join(root, "integrations/dsh/dist/plugin"),
    patch: path.join(home, "openmotion.patch.yml"),
  };
}

/** Only the local OpenMotion origin can be compiled into the host adapter. */
export function studioOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Studio must be a loopback HTTP origin without credentials, a path or query.",
    );
  }
  return url.origin;
}

// JSON strings are valid YAML scalars, including paths with spaces or backslashes.
export function integrationPatch(
  config: ReturnType<typeof integrationConfig>,
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
  modules: string[] = [],
): string {
  const scalar = JSON.stringify;
  return `- insert:
    - id: openmotion-workspace
      name: ${scalar(path.join(config.plugin, "lib/index.js"))}
      config:
        root: ${scalar(config.root)}
        dataDirectory: ${scalar(config.data)}
        node: ${scalar(executable)}
${env.MOTION_TEMPLATE_SOURCE ? `        templateSource: ${scalar(env.MOTION_TEMPLATE_SOURCE)}\n` : ""}${[
    ["action-cards", "@deepseek-ai/dsh-action-cards"],
    ["client-ui-action-cards", "@deepseek-ai/dsh-client-ui-action-cards"],
  ].filter(([, name]) => !modules.includes(name)).map(([id, name]) => `    - id: ${id}\n      name: ${scalar(name)}\n`).join("")}`;
}
