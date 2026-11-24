import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export async function buildPlugin(output: string): Promise<void> {
  await mkdir(path.join(output, "lib"), { recursive: true });
  await copyFile(
    path.resolve(directory, "../../LICENSE"),
    path.join(output, "LICENSE"),
  );
  await copyFile(
    path.join(directory, "README.md"),
    path.join(output, "README.md"),
  );
  for (const filename of ["remix-icon-LICENSE.txt", "remix-icon-NOTICE.txt"]) {
    await copyFile(path.resolve(directory, "../../packages/design-system", filename), path.join(output, filename));
  }
  await copyFile(
    path.join(directory, "plugin/package.json"),
    path.join(output, "package.json"),
  );
  await copyFile(
    path.join(directory, "plugin/src/style.css"),
    path.join(output, "lib/style.css"),
  );
  await build({
    entryPoints: [path.join(directory, "plugin/src/index.ts")],
    outfile: path.join(output, "lib/index.js"),
    format: "esm",
    platform: "node",
    bundle: true,
    external: ["@deepseek-ai/dsh-mcp-client", "@deepseek-ai/dsh-llm"],
  });
  // The browser receives React from DSH; bundling another copy breaks its hooks.
  await build({
    entryPoints: [path.join(directory, "plugin/src/client.tsx")],
    outfile: path.join(output, "lib/client.js"),
    format: "cjs",
    platform: "browser",
    bundle: true,
    external: ["react", "react/jsx-runtime"],
    jsx: "automatic",
    loader: { '.svg': 'text' },
    banner: {
      js: 'window.__ModuleLoader__.load({id:"openmotion-dsh",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
    },
    footer: { js: "return module.exports;}});" },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await buildPlugin(path.resolve(directory, "dist/plugin"));
}
