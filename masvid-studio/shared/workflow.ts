import { fontCatalogResource } from './font-catalog.ts';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export { workflowEntryGuide } from './workflow-entry.js';

export const workflowRegistry = {
  production: {
    status: 'ready',
    sections: {
      start: 'skills/openmotion-production/SKILL.md',
      intake: 'skills/openmotion-production/references/intake.md',
      templates: 'skills/openmotion-production/references/templates.md',
      production: 'skills/openmotion-production/references/production.md',
      verification: 'skills/openmotion-production/references/verification.md',
      context: 'skills/openmotion-production/references/context.md',
      native: 'skills/openmotion-production/references/native.md',
      edit: 'skills/openmotion-production/references/edit.md',
      portable: 'skills/openmotion-production/references/portable-project.md',
      materials: 'skills/openmotion-production/references/materials.md',
      transcripts: 'docs/transcripts.md',
      decisions: 'skills/openmotion-production/references/decisions.md',
      review: 'skills/openmotion-production/references/review.md',
      sound: 'skills/openmotion-production/references/sound.md',
      // Provider guides live in openmotion-media; these production sections keep older resource URIs working.
      account: 'skills/openmotion-media/references/providers/account.md',
      compatible: 'skills/openmotion-media/references/providers/compatible.md',
      fal: 'skills/openmotion-media/references/providers/fal.md',
      opendesign: 'skills/openmotion-media/references/providers/opendesign.md',
      atlascloud: 'skills/openmotion-media/references/providers/atlascloud.md',
      wavespeed: 'skills/openmotion-media/references/providers/wavespeed.md',
      typography: 'skills/openmotion-production/references/typography.md',
      fonts: 'skills/openmotion-production/references/fonts.md',
      reference: 'skills/openmotion-production/references/reference-video.md',
    },
  },
  director: {
    status: 'ready',
    sections: {
      start: 'skills/openmotion-director/SKILL.md',
      actions: 'skills/openmotion-director/references/action-script.md',
      craft: 'skills/openmotion-director/references/motion-craft.md',
      phrases: 'skills/openmotion-director/references/motion-phrases.md',
      decisions: 'skills/openmotion-production/references/decisions.md',
      sound: 'skills/openmotion-director/references/sound-narrative.md',
      review: 'skills/openmotion-production/references/review.md',
      examples: 'skills/openmotion-director/references/examples.md',
    },
  },
  template: { status: 'ready', sections: { start: 'skills/openmotion-template-to-video/SKILL.md', unchanged: 'skills/openmotion-template-to-video/references/unchanged-export.md', firstuse: 'skills/openmotion-template-to-video/references/first-use.md', recipes: 'skills/openmotion-template-to-video/references/recipes.md', adaptation: 'skills/openmotion-template-to-video/references/adaptation.md' } },
  recreate: {
    status: 'ready',
    sections: {
      start: 'skills/openmotion-recreate/SKILL.md',
      rebuild: 'skills/openmotion-recreate/references/rebuild.md',
      reconstruction: 'skills/openmotion-recreate/references/reconstruction.md',
      rendering: 'skills/openmotion-recreate/references/rendering.md',
      rendercode: 'skills/openmotion-recreate/assets/reconstruction.js',
      verification: 'skills/openmotion-recreate/references/verify.md',
    },
  },
  'video-to-template': {
    status: 'ready',
    sections: {
      start: 'skills/openmotion-video-to-template/SKILL.md',
      measure: 'skills/openmotion-video-to-template/references/measure.md',
      rebuild: 'skills/openmotion-video-to-template/references/rebuild.md',
      project: 'skills/openmotion-production/references/portable-project.md',
      verification: 'skills/openmotion-video-to-template/references/verify.md',
      sources: 'skills/openmotion-video-to-template/references/rule-sources.md',
    },
  },
  media: {
    status: 'ready',
    sections: {
      start: 'skills/openmotion-media/SKILL.md',
      planning: 'skills/openmotion-media/references/planning.md',
      setup: 'skills/openmotion-media/references/setup.md',
      jobs: 'skills/openmotion-media/references/jobs.md',
      inspection: 'skills/openmotion-media/references/inspection.md',
      account: 'skills/openmotion-media/references/providers/account.md',
      compatible: 'skills/openmotion-media/references/providers/compatible.md',
      fal: 'skills/openmotion-media/references/providers/fal.md',
      opendesign: 'skills/openmotion-media/references/providers/opendesign.md',
      atlascloud: 'skills/openmotion-media/references/providers/atlascloud.md',
      wavespeed: 'skills/openmotion-media/references/providers/wavespeed.md',
      codex: 'skills/openmotion-media/references/providers/codex.md',
    },
  },
  game: { status: 'ready', sections: { start: 'skills/openmotion-game/SKILL.md', provenance: 'skills/openmotion-game/PROVENANCE.md', genres: 'skills/openmotion-game/references/game-genres.md', playable: 'skills/openmotion-game/references/game-playable-ad.md', flow: 'skills/openmotion-game/references/game-flow.md', design: 'skills/openmotion-game/references/game-design-system.md', style: 'skills/openmotion-game/references/game-stylization.md', sprites: 'skills/openmotion-game/references/game-2d-animation.md', animation: 'skills/openmotion-game/references/game-3d-animation.md', procedural: 'skills/openmotion-game/references/game-procedural-animation.md', audio: 'skills/openmotion-game/references/game-audio.md', textures: 'skills/openmotion-game/references/game-textures.md', review: 'skills/openmotion-game/references/review-rubric.md' } },
  design: {
    status: 'ready',
    sections: {
      start: 'skills/openmotion-design/SKILL.md',
      scenarios: 'skills/openmotion-design/references/scenarios.md',
      iterate: 'skills/openmotion-design/references/iterate.md',
      export: 'skills/openmotion-design/references/export.md',
      systems: 'skills/openmotion-design/references/systems.md',
    },
  },
} as const;

// Keep the original production section export and getWorkflow(section) API.
export const workflowFiles = workflowRegistry.production.sections;
export const workflowNames = Object.keys(workflowRegistry);
export const workflowSections = [...new Set(Object.values(workflowRegistry).flatMap(workflow => Object.keys(workflow.sections)))];
export const phase1WorkflowNames = ['production', 'director', 'template', 'recreate', 'video-to-template', 'media', 'design', 'game'];
export const phase1Skills = ['openmotion-production', 'openmotion-director', 'openmotion-template-to-video', 'openmotion-recreate', 'openmotion-video-to-template'];
export const supportingSkills = ['openmotion-media', 'openmotion-design', 'openmotion-game'];
export const packagedSkills = [...phase1Skills, ...supportingSkills];
export function workflowResources() {
  return Object.entries(workflowRegistry).filter(([name]) => phase1WorkflowNames.includes(name)).flatMap(([workflow, definition]) => Object.keys(definition.sections).map(section => ({
    uri: `openmotion://workflow/${workflow}/${section}`, name: `${workflow}/${section}`, title: `OpenMotion · ${workflow}/${section}`, mimeType: 'application/json',
  }))).concat([{ uri: 'openmotion://fonts/index', name: 'fonts/index', title: 'OpenMotion · Curated fonts', mimeType: 'application/json' }, { uri: 'openmotion://engine/SKILL.md', name: 'Hyperframes pinned authoring guide', title: 'OpenMotion · Hyperframes authoring guide', mimeType: 'text/markdown' }]);
}
/**
 * Resolve one file inside the pinned guide root, rejecting anything that escapes it.
 * Exported so the containment rule can be tested without an installed runtime.
 */
export async function resolveGuideFile(root: string, relative: string) {
  // A missing or unreadable target is a rejected URI, not a filesystem error: the raw
  // ENOENT message would echo the resolved absolute path back to the caller.
  const file = await realpath(path.join(root, relative)).catch(() => { throw new Error('INVALID_RESOURCE_URI'); });
  if (!file.startsWith(root + path.sep)) throw new Error('INVALID_RESOURCE_URI');
  return file;
}

export async function readWorkflowResource(uri: unknown, dataDirectory: string) {
  if (typeof uri !== 'string') throw new Error('INVALID_RESOURCE_URI');
  if (/^(?:openmotion|motion):\/\/fonts\//.test(uri)) return { uri, mimeType: 'application/json', text: JSON.stringify(await fontCatalogResource(uri)) };
  const match = /^(?:openmotion|motion):\/\/workflow\/([a-z]+(?:-[a-z]+)*)\/([a-z]+)$/.exec(uri);
  if (match && phase1WorkflowNames.includes(match[1])) return { uri, mimeType: 'application/json', text: JSON.stringify({ ...await getWorkflow(match[2], match[1]), workflows: phase1WorkflowNames }) };
  const engine = /^(?:openmotion|motion):\/\/engine\/([a-zA-Z0-9_/-]+\.md)$/.exec(uri);
  if (!engine) throw new Error('INVALID_RESOURCE_URI');
  const { ensureRuntime } = await import('../hyperframes.ts');
  const root = await realpath(path.join(await ensureRuntime(dataDirectory, false), 'node_modules/hyperframes/dist/skills/hyperframes'));
  const file = await resolveGuideFile(root, engine[1]);
  return { uri, mimeType: 'text/markdown', text: await readFile(file, 'utf8').catch(() => { throw new Error('INVALID_RESOURCE_URI'); }) };
}

// A document shared by several workflows takes its identity from the workflow whose Skill directory holds it, else the first registration.
const skillDirectory = (documentId: string) => documentId.split('/').slice(0, 2).join('/');
const documents = new Map<string, { workflow: string; section: string; documentId: string }>();
for (const [workflow, definition] of Object.entries(workflowRegistry)) for (const [section, documentId] of Object.entries(definition.sections)) {
  const owner = skillDirectory(documentId) === skillDirectory(definition.sections.start);
  const current = documents.get(documentId);
  if (!current || owner && skillDirectory(documentId) !== skillDirectory(workflowRegistry[current.workflow as keyof typeof workflowRegistry].sections.start)) documents.set(documentId, { workflow, section, documentId });
}

// Old installed Markdown paths resolve to the maintained production body. Keep the
// requested director route on direct reads, but canonical production identity in references.
export const workflowDocumentAliases = {
  'skills/openmotion-director/references/production-decisions.md': 'skills/openmotion-production/references/decisions.md',
  'skills/openmotion-director/references/motion-review.md': 'skills/openmotion-production/references/review.md',
} as const;
for (const [legacy, canonical] of Object.entries(workflowDocumentAliases)) {
  const target = documents.get(canonical);
  if (!target) throw new Error('Unknown canonical workflow document: ' + canonical);
  documents.set(legacy, target);
}

// A fence closes only on a run of the same character at least as long as its opener; an unclosed fence runs to the end of the document.
function withoutFences(content: string) {
  let fence: string | undefined;
  return content.split(/\r\n?|\n/).filter(line => {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`).test(line)) fence = undefined;
      return false;
    }
    fence = line.match(/^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/)?.[1];
    return !fence;
  }).join('\n');
}

// Inline links and reference-link definitions; ignore fenced examples and inline code.
function markdownHrefs(content: string) {
  const prose = withoutFences(content).replace(/(`+)[^\n]*?\1/g, '');
  return [
    ...prose.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g),
    ...prose.matchAll(/^ {0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm),
  ].map(link => link[1] ?? link[2]);
}

function registeredTarget(href: string, documentId: string) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return null;
  const target = decodeURIComponent(href.split(/[?#]/, 1)[0]);
  if (!/\.md$/i.test(target)) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(documentId), target));
  const reference = !target.startsWith('/') && !target.includes('\\') ? documents.get(resolved) : undefined;
  if (!reference) throw new Error(`Unregistered workflow Markdown link in ${documentId}: ${href}`);
  return reference;
}

/** Resolve packaged Markdown links through the registry, never through a caller-supplied path. */
export function workflowReferences(content: string, documentId: string) {
  if (!documents.has(documentId)) throw new Error('Unknown workflow document: ' + documentId);
  const references = new Map<string, { workflow: string; section: string; documentId: string }>();
  for (const href of markdownHrefs(content)) {
    const reference = registeredTarget(href, documentId);
    if (reference) references.set(reference.documentId, reference);
  }
  return [...references.values()];
}

/**
 * GitHub-style anchors for ATX (`#`) headings: visible text without link, emphasis or HTML markup,
 * with -1, -2 suffixes that never collide with another heading's slug. Setext headings and custom
 * HTML anchors are outside the supported subset for workflow documents.
 */
export function markdownAnchors(content: string) {
  const anchors = new Set<string>();
  const repeats = new Map<string, number>();
  for (const [, heading] of withoutFences(content).matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm)) {
    const visible = heading.split(/(`+[^`]*`+)/).map((part, index) => index % 2 ? part
      : part.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/(^|[^\p{L}\p{N}_])(_+)(?=\S)(.+?)(?<=\S)\2(?=$|[^\p{L}\p{N}_])/gu, '$1$3')).join('');
    const base = visible.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    let anchor = base;
    while (anchors.has(anchor)) {
      const repeat = (repeats.get(base) ?? 0) + 1;
      repeats.set(base, repeat);
      anchor = `${base}-${repeat}`;
    }
    anchors.add(anchor);
  }
  return anchors;
}

/** `#fragment` links to registered documents, including same-document links. Stripping fragments in workflowReferences keeps them out of MCP identity, so they are validated separately. */
export function workflowLinkAnchors(content: string, documentId: string) {
  const self = documents.get(documentId);
  if (!self) throw new Error('Unknown workflow document: ' + documentId);
  const anchors: Array<{ workflow: string; section: string; documentId: string; anchor: string; href: string }> = [];
  for (const href of markdownHrefs(content)) {
    const hash = href.indexOf('#');
    if (hash < 0 || hash === href.length - 1) continue;
    const reference = href.startsWith('#') ? self : registeredTarget(href, documentId);
    if (reference) anchors.push({ ...reference, anchor: decodeURIComponent(href.slice(hash + 1)), href });
  }
  return anchors;
}

export async function getWorkflow(section: unknown = 'start', workflow: unknown = 'production') {
  if (typeof workflow !== 'string' || !Object.hasOwn(workflowRegistry, workflow)) {
    throw new Error('Unknown workflow. Use ' + workflowNames.join(', ') + '.');
  }
  const definition = workflowRegistry[workflow as keyof typeof workflowRegistry];
  const files: Record<string, string> = definition.sections;
  if (typeof section !== 'string' || !Object.hasOwn(files, section)) {
    throw new Error(`Unknown workflow section for ${workflow}. Use ${Object.keys(files).join(', ')}.`);
  }
  const documentId = files[section];
  const url = new URL('../' + documentId, import.meta.url);
  const content = await readFile(url, 'utf8');
  return {
    workflow, section, status: definition.status, documentId,
    contentHash: createHash('sha256').update(content).digest('hex'),
    content, path: fileURLToPath(url), sections: Object.keys(files), workflows: workflowNames,
    references: workflowReferences(content, documentId),
    readNext: 'Use production/context for required dependencies; changes to existing content also use production/edit. Reuse complete bodies still available. Read missing instructions and target sources in a read-only call that finishes and returns to the model before a later call performs dependent template application, imports, writes or export. Sequential read/write operations inside one outer tool call do not satisfy this boundary. Check actual returned output for truncation; split long reads as needed. Record documentId/contentHash only after complete return. Reload only missing, truncated or changed content, not merely for a new turn. Do not restart routing or repeat completed operations. Guidance is not execution or verification evidence.',
  };
}
