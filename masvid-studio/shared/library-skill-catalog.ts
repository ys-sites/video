import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LibrarySkill = { id: string; kind: 'skill'; title: string; description: string; tags: string[]; repository?: string; license?: string; instructions: string; files: string[]; objects?: SkillObject[]; localSource?: string };
export type SkillObject = { path: string; bytes: number; sha256: string };
const root = fileURLToPath(new URL('../', import.meta.url));
export const skillNextStep = 'Follow SKILL.md. When a new project is needed, use openmotion_create_project with projectType=natural_language. Skills are instructions, not copyable projects.';
export const skillUsage = 'This ID is a library Skill, not a template. Read it with openmotion_get_skill(skillId). ' + skillNextStep;

// Cards are build-time Studio sources with media imports, not a Node module.
function fields(source: string): Record<string, string> {
  return Object.fromEntries([...source.matchAll(/\b(id|title|useWhen|repository|license|category):\s*'((?:\\.|[^'\\])*)'/g)].map(m => [m[1], m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')]));
}
function frontmatter(content: string, key: string): string {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? '';
  const lines = header.split('\n');
  const index = lines.findIndex(line => line.startsWith(key + ':'));
  let value = index < 0 ? '' : lines[index].slice(key.length + 1).trim();
  if (/^[>|][-+]?$/.test(value)) {
    value = lines.slice(index + 1).join('\n').split(/\n(?=\S)/)[0].trim();
  }
  return value.replace(/^[>|][-+]?\s*/, '').replace(/\s*\n\s*/g, ' ').replace(/^(['"])(.*)\1$/, '$2');
}
export async function loadLibrarySkills(appRoot = root, local = true): Promise<LibrarySkill[]> {
  const directory = path.join(appRoot, 'library/skills');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  let cards = '';
  try { cards = await readFile(path.join(appRoot, 'studio/src/motion/skillCatalog.ts'), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const metadata = new Map([...cards.matchAll(/\{ id: '[^\n]+/g)].map(m => { const f = fields(m[0].split('cover:')[0]); return [f.id, f]; }));
  const result: LibrarySkill[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const base = path.join(directory, entry.name);
    let instructions: string;
    try { instructions = await readFile(path.join(base, 'SKILL.md'), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const files: string[] = [];
    const walk = async (relative: string) => {
      for (const child of await readdir(path.join(base, relative), { withFileTypes: true })) {
        const name = relative ? relative + '/' + child.name : child.name;
        if (child.isDirectory()) await walk(name);
        else if (child.isFile()) files.push(name);
      }
    };
    await walk('');
    const card = metadata.get(entry.name) ?? {};
    result.push({ id: entry.name, kind: 'skill', title: card.title || frontmatter(instructions, 'name') || entry.name,
      description: card.useWhen || frontmatter(instructions, 'description'), tags: card.category ? [card.category] : [],
      ...(card.repository ? { repository: card.repository } : {}), ...(card.license ? { license: card.license } : {}),
      instructions, files: files.sort(), ...(local ? { localSource: base } : {}) });
  }
  return result;
}
export function assertSkillIds(skills: LibrarySkill[], templateIds: string[]) {
  const ids = new Set(templateIds);
  for (const skill of skills) { if (ids.has(skill.id)) throw new Error('Duplicate template/skill ID: ' + skill.id); ids.add(skill.id); }
}
