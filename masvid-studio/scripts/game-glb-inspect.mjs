import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** GLB 2 inspector; no engine, network or third-party dependencies. */
export function inspectGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Invalid GLB 2 header');
  let doc, binary;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw Error('Truncated GLB chunk');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    if (length % 4 || offset + 8 + length > bytes.length) throw Error('Invalid GLB chunk length');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) doc = JSON.parse(chunk.toString('utf8').trim());
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!doc) throw Error('Missing GLB JSON chunk');
  function times(index) {
    const accessor = doc.accessors[index];
    if (accessor.componentType !== 5126 || accessor.type !== 'SCALAR' || accessor.sparse) throw Error('Unsupported animation time accessor');
    const view = doc.bufferViews[accessor.bufferView];
    if (!binary || view.buffer !== 0) throw Error('Animation requires an embedded buffer');
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = view.byteStride ?? 4;
    const result = [];
    for (let i = 0; i < accessor.count; i++) {
      const offset = start + i * stride;
      if (offset + 4 > binary.length || offset + 4 > (view.byteOffset ?? 0) + view.byteLength) throw Error('Truncated animation accessor');
      result.push(binary.readFloatLE(offset));
    }
    return result;
  }
  const meshes = (doc.meshes ?? []).map((mesh, i) => ({ name: mesh.name ?? `mesh-${i}`, triangles: (mesh.primitives ?? []).reduce((sum, p) => {
    const n = doc.accessors[p.indices ?? p.attributes.POSITION].count, mode = p.mode ?? 4;
    return sum + (mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0);
  }, 0) }));
  return { meshes, skins: (doc.skins ?? []).map((skin, i) => ({ name: skin.name ?? `skin-${i}`, bones: skin.joints.length })),
    boneCount: new Set((doc.skins ?? []).flatMap(s => s.joints)).size,
    animations: (doc.animations ?? []).map((clip, i) => {
      let min = Infinity, max = -Infinity;
      for (const sampler of clip.samplers) for (const time of times(sampler.input)) { min = Math.min(min, time); max = Math.max(max, time); }
      return { name: clip.name ?? `clip-${i}`, duration: Number.isFinite(max) ? +(max - min).toFixed(6) : 0 };
    }), triangleCount: meshes.reduce((sum, m) => sum + m.triangles, 0) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw Error('Usage: node scripts/game-glb-inspect.mjs character.glb');
    console.log(JSON.stringify(inspectGlb(await readFile(process.argv[2])), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
