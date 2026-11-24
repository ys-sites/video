import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { authoredTemplateGuide, jsonForHtml, parseTemplateGuideDraft, type TemplateGuideDraft } from '../shared/template-guide.ts';
import type { TemplateCatalog } from '../prism-templates.ts';
import { createBlankProject } from '../workspace.ts';

const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
/** Convert the selected guide's actual canvas example, never a different built-in film. */
export async function materializeTemplateGuide(catalog: TemplateCatalog, templateId: string, directory: string, runtimeRoot: string, input: TemplateGuideDraft) {
  const draft = parseTemplateGuideDraft(input);
  const guide = authoredTemplateGuide((await catalog.sourceFile(templateId, 'preview.html')).toString());
  if (!guide) throw new Error('GUIDE_NOT_EDITABLE: this guide has no supported authored example');
  const sequence = (await catalog.sourceFile(templateId, guide.src)).toString();
  const canvas = sequence.match(/<canvas\s+width="(\d+)"\s+height="(\d+)"/);
  if (!canvas || Number(canvas[1]) > 4096 || Number(canvas[2]) > 4096) throw new Error('GUIDE_CANVAS_UNAVAILABLE');
  const [width, height] = canvas.slice(1).map(Number);
  const manifestBytes = await catalog.sourceFile(templateId, 'manifest.json');
  const manifest = JSON.parse(manifestBytes.toString()) as { files: { path: string }[] };
  // Preserve the selected document's complete relative resource bundle.
  // Native project authority and generated entry files must never come from it.
  const declared = [...new Set(['manifest.json', ...manifest.files.map(file => file.path)])];
  for (const name of declared) {
    if (!name || path.isAbsolute(name) || /^[a-z]:/i.test(name) || name.includes('\\')
      || name.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error('GUIDE_SOURCE_PATH_UNAVAILABLE');
  }
  const reserved = new Set(['index.html', 'hyperframes.json', 'motion-project.json', 'motion-assets.json', 'guide-draft.json', 'assets/gsap.min.js']);
  const names = declared.filter(name => !reserved.has(name));
  const documents = await Promise.all(names.filter(name => !name.startsWith('assets/')).map(async name => [name, name === 'manifest.json' ? manifestBytes : await catalog.sourceFile(templateId, name)] as const));
  // Source manifests retain omitted original-image identities for provenance.
  // Their published renditions already use absolute URLs in the documents;
  // copy only assets still referenced by a local relative path.
  const localReferences = documents.filter(([name]) => name !== 'manifest.json').map(([, bytes]) => bytes.toString()).join('\n');
  const assets = await Promise.all(names.filter(name => name.startsWith('assets/') && localReferences.includes(name)).map(async name => [name, await catalog.sourceFile(templateId, name)] as const));
  const files = [...documents, ...assets];
  await createBlankProject(directory, runtimeRoot, draft.title);
  for (const [name, bytes] of files) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), bytes);
  }
  await writeFile(path.join(directory, 'guide-draft.json'), jsonForHtml({ templateId, ...draft }));
  const variables = [{ id: 'title', label: 'Title', type: 'string', default: draft.title }, { id: 'accent', label: 'Accent color', type: 'color', default: draft.accent }];
  const html = `<!doctype html><html data-composition-variables='${attribute(jsonForHtml(variables))}'><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%;object-fit:contain}
</style></head><body data-mode="sequence"><div id="main" data-composition-id="main" data-start="0" data-duration="${guide.duration}" data-width="${width}" data-height="${height}" style="width:${width}px;height:${height}px;position:relative"><div id="guide-example" class="clip" data-composition-id="guide-example" data-start="0" data-duration="${guide.duration}" data-track-index="0" data-track-kind="graphics" data-width="${width}" data-height="${height}"><canvas width="${width}" height="${height}"></canvas></div></div>
<script src="assets/gsap.min.js"></script><script src="demos/data.js"></script><script src="demos/common.js"></script><script src="demos/scene.js"></script><script>
(() => { const defaults=${jsonForHtml(draft)}, clock={time:0};
const draw=()=>{const values=window.__hyperframes?.getVariables?.()||defaults;window.motionDemo.setParams({...defaults,...values});window.motionDemo.renderAt(clock.time)};
const timeline=gsap.timeline({paused:true});timeline.to(clock,{time:${guide.duration},duration:${guide.duration},ease:'none',onUpdate:draw},0);
window.__timelines=window.__timelines||{};window.__timelines.main=gsap.timeline({paused:true});window.__timelines['guide-example']=timeline;draw();
})();</script></body></html>`;
  await writeFile(path.join(directory, 'index.html'), html);
  return { draft, source: { id: templateId, provenance: 'authored-motion-guide-example', durationSeconds: guide.duration, width, height,
    editing: 'Canvas example. Title and accent are declared as native variables for Agent editing; change demos/*.js for deeper edits; the reference film is not reconstructed.' } };
}
