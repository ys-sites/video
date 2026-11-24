import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import tailwindcss from '@tailwindcss/vite';
import { build as viteBuild } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'packages/open-design-ui');
const output = path.join(root, 'dist/open-design-ui');
const packageDist = path.join(source, 'dist');
const packageManifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));

const { name, items } = JSON.parse(await readFile(path.join(source, 'registry.json'), 'utf8'));
assert.equal(name, packageManifest.name);
assert.ok(items.length, 'Register at least one component before building the package');
const entryPoints = {};
const exports = { './styles.css': './dist/styles.css' };
for (const item of items) {
  assert.match(item.name, /^[a-z][a-z0-9-]*$/);
  assert.ok(!Object.hasOwn(entryPoints, item.name), `Duplicate component: ${item.name}`);
  assert.equal(item.import, `${name}/${item.name}`);
  const entry = path.resolve(root, item.source);
  const relative = path.relative(source, entry).split(path.sep).join('/');
  assert.ok(!path.isAbsolute(relative) && !relative.startsWith('../') && !relative.startsWith('site/') && /\.tsx?$/.test(relative),
    `Component source must be inside the library: ${item.source}`);
  entryPoints[item.name] = entry;
  exports[`./${item.name}`] = {
    types: `./dist/${relative.replace(/\.tsx?$/, '.d.ts')}`,
    import: `./dist/${item.name}.js`,
  };
}

assert.deepEqual(packageManifest.exports, exports, 'Keep package exports in sync with the registry');

const readme = `# Open Design UI

Shared React controls from Open Design and OpenMotion.

## Install

\`\`\`sh
npm install open-design-ui
\`\`\`

## Use

Set \`data-motion-ui\` on the document's \`<html>\` element to enable the theme tokens. Use \`data-theme="light"\` or \`data-theme="dark"\` to choose a theme explicitly.

\`\`\`tsx
import { useState } from 'react';
import { Button } from 'open-design-ui/button';
import { Slider } from 'open-design-ui/slider';
import 'open-design-ui/styles.css';

export function Controls() {
  const [value, setValue] = useState(5);
  return (
    <>
      <Button type="button" variant="primary" onClick={() => setValue(5)}>Reset</Button>
      <Slider label="Guidance scale" min={1} max={10} value={value} onCommit={setValue} />
    </>
  );
}
\`\`\`
`;

await rm(output, { recursive: true, force: true });
await rm(packageDist, { recursive: true, force: true });
await mkdir(packageDist, { recursive: true });

const { metafile } = await esbuild({
  absWorkingDir: root,
  entryPoints,
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  platform: 'browser',
  outdir: packageDist,
  external: ['react', 'react-dom', '@base-ui/react/*', 'cn'],
  metafile: true,
});
const bundledExports = new Map(Object.entries(metafile.outputs).map(([file, data]) => [path.resolve(root, file), data.exports]));
for (const item of items) {
  const entry = path.resolve(source, exports[`./${item.name}`].import);
  assert.ok(bundledExports.get(entry)?.includes(item.export), `Missing ${item.export} export from ${item.import}`);
}

const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const { stdout, stderr } = await promisify(execFile)(process.execPath, [
  tsc,
  '--declaration',
  '--emitDeclarationOnly',
  '--jsx', 'react-jsx',
  '--module', 'ESNext',
  '--moduleResolution', 'Bundler',
  '--target', 'ES2022',
  '--strict',
  '--skipLibCheck',
  '--rootDir', source,
  '--outDir', packageDist,
  ...Object.values(entryPoints),
], { cwd: root });
if (stdout.trim()) process.stdout.write(stdout);
if (stderr.trim()) process.stderr.write(stderr);

await viteBuild({
  root: source,
  configFile: false,
  publicDir: false,
  plugins: [tailwindcss()],
  build: {
    outDir: packageDist,
    emptyOutDir: false,
    rollupOptions: {
      input: path.join(source, 'styles.css'),
      output: { assetFileNames: '[name][extname]' },
    },
  },
});

for (const entry of Object.values(exports)) {
  for (const file of typeof entry === 'string' ? [entry] : Object.values(entry)) {
    await readFile(path.resolve(source, file));
  }
}
await mkdir(output, { recursive: true });
await cp(packageDist, path.join(output, 'dist'), { recursive: true });
await writeFile(path.join(output, 'README.md'), readme);
await copyFile(path.join(source, 'LICENSE'), path.join(output, 'LICENSE'));
const { scripts, ...distributionManifest } = packageManifest;
await writeFile(path.join(output, 'package.json'), `${JSON.stringify(distributionManifest, null, 2)}\n`);
console.log(`Built ${packageManifest.name}@${packageManifest.version} at ${path.relative(root, output)}`);
