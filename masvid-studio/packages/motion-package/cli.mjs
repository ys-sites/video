import { inspectPackage, lockPackage, packPackage } from './index.mjs';

const [command, source, destination, ...extra] = process.argv.slice(2);
try {
  if (!source || extra.length || !['check', 'lock', 'pack'].includes(command)
    || (command === 'pack' ? !destination : destination !== undefined)) {
    throw new Error('Usage: node cli.mjs check|lock <package> | pack <package> <new-directory>');
  }
  let result;
  if (command === 'pack') result = await packPackage(source, destination);
  else if (command === 'lock') result = await lockPackage(source);
  else {
    const { manifest, entries } = await inspectPackage(source);
    result = { name: manifest.name, version: manifest.version, files: entries.size,
      scope: 'manifest, local file inventory and hashes; design/skill semantics and renders are not checked' };
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
