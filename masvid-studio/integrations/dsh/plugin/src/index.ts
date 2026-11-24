import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { studioOrigin } from "../../config.ts";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerOpenMotionTemplateCards } from "./templateRecommendationCards.ts";

export type Config = {
  root: string;
  dataDirectory: string;
  node?: string;
  templateSource?: "repository" | "hosted";
};
const execute = promisify(execFile);
type Route = {
  kind: "exact" | "prefix";
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
type HostContext = Parameters<typeof mcpClient.apply>[0] & {
  webServer: { register: (route: Route) => () => void };
  tools: { definitions: () => { name: string }[] };
};

export const inject = ["webServer", "tools"];
export async function apply(ctx: HostContext, config: Config) {
  if (!config?.root || !config.dataDirectory)
    throw new Error(
      "Configure the OpenMotion root and dataDirectory before enabling this plugin.",
    );
  const root = path.resolve(config.root),
    data = path.resolve(config.dataDirectory);
  const executable = config.node || process.execPath;
  const env = {
    ...process.env,
    MOTION_DATA_DIR: data,
    ...(config.templateSource
      ? { MOTION_TEMPLATE_SOURCE: config.templateSource }
      : {}),
  };
  const { stdout } = await execute(
    executable,
    ["--experimental-strip-types", "preview.ts"],
    { cwd: root, env, timeout: 120_000 },
  );
  const origin = studioOrigin(JSON.parse(stdout).previewUrl);
  const { resolveDesignSystemFile } = await import(pathToFileURL(path.join(root, "packages/design-system/index.js")).href);
  // Use DSH's maintained MCP adapter, including disposal and credential scrubbing.
  await mcpClient.apply(ctx, {
    serverName: "openmotion",
    transport: "stdio",
    command: executable,
    args: ["--experimental-strip-types", path.join(root, "mcp.ts")],
    cwd: root,
    env: {
      MOTION_DATA_DIR: data,
      ...(config.templateSource
        ? { MOTION_TEMPLATE_SOURCE: config.templateSource }
        : {}),
    },
    failOnStartupError: true,
    toolCallTimeoutMs: 180_000,
  });
  // Register when optional services become available, including after this plugin starts.
  ctx.inject(["skills", "actionCards"], (inner) => registerOpenMotionTemplateCards(inner));
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix", path: "/openmotion-dsh/design-system",
      handler: async (req, res) => {
        const pathname = new URL(req.url || "/", "http://localhost").pathname.slice("/openmotion-dsh".length);
        if (req.method !== "GET" || !resolveDesignSystemFile(pathname)) { res.writeHead(404); res.end(); return; }
        try {
          const response = await fetch(origin + pathname, { signal: AbortSignal.timeout(5000), redirect: "error" });
          res.writeHead(response.status, { "Content-Type": response.headers.get("content-type") || "application/octet-stream" });
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch { res.writeHead(503); res.end(); }
      },
    }),
  );
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/openmotion-dsh/status",
      handler: async (req, res) => {
        if (req.method !== "GET") {
          res.writeHead(405);
          res.end();
          return;
        }
        const tools = ctx.tools
          .definitions()
          .map((tool) => tool.name)
          .filter((name) => name.startsWith("mcp__openmotion__"));
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ studioUrl: origin, applicationRoot: root, dataDirectory: data,
          nativeCardsAvailable: Boolean(ctx.get("actionCards") && ctx.get("skills")), tools }));
      },
    }),
  );
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/openmotion-dsh/style.css",
      handler: async (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end(
          await readFile(new URL("./style.css", import.meta.url), "utf8"),
        );
      },
    }),
  );
  // Deliberately read-only: browser presentation and MCP use the existing APIs.
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/openmotion-dsh/data",
      handler: async (req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const endpoint = url.pathname.slice("/openmotion-dsh/data".length);
        if (
          req.method !== "GET" ||
          !["/motion-api/projects", "/api/template-catalog"].includes(endpoint)
        ) {
          res.writeHead(404);
          res.end();
          return;
        }
        try {
          const response = await fetch(origin + endpoint + url.search, {
            signal: AbortSignal.timeout(20_000),
            redirect: "error",
          });
          const body = await response.text();
          res.writeHead(response.status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(body);
        } catch {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error:
                "OpenMotion Studio is unavailable. Restart the integration.",
            }),
          );
        }
      },
    }),
  );
}
