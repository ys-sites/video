import stylesRaw from '../master-video-styles/data/styles.json';
import reelsRaw from '../master-video-styles/data/reels.json';
import sumitKelsiePlaybook from '../master-video-styles/playbooks/sumit-kelsie-edit-styles.md?raw';
import overstimulatedPlaybook from '../master-video-styles/playbooks/overstimulated-mind-edit-process.md?raw';
import invideoCutoutPlaybook from '../master-video-styles/playbooks/invideo-paper-cutout-guide.md?raw';
import aeClaudeMcpPlaybook from '../master-video-styles/playbooks/after-effects-claude-mcp.md?raw';
import sumitPrompt from '../master-video-styles/prompts/sumit-style-video-edit-prompt.md?raw';
import type { StyleProfile } from './styles';

export type CloudStyleStep = {
  days: string;
  detail: string;
  title: string;
  tools: string[];
};

export type CloudCategory = 'featured' | 'process' | 'skill' | 'workflow' | 'library';

export type CloudStyleRecord = {
  id: string;
  slug: string;
  number: number;
  title: string;
  tag: string;
  category: CloudCategory;
  accent: string;
  creator: string;
  creator_handle: string;
  creator_role: string;
  look: string;
  best_for: string;
  prompt: string;
  reference_reel_url: string;
  reference_reel_note: string;
  rules: string[];
  steps: CloudStyleStep[];
  tools: string[];
};

export type MotionDictionaryItem = {
  name: string;
  demo: string;
  source_style: string;
};

export type CloudToolItem = {
  name: string;
  price: string;
  notes: string;
  link: string;
};

export type StudiedReel = {
  id: string;
  url: string;
  creator: string;
  style_tags: string[];
  notes: string;
};

export type CloudPlaybookDoc = {
  id: string;
  title: string;
  kind: 'playbook' | 'prompt';
  sourcePath: string;
  summary: string;
  relatedStyleIds: string[];
  content: string;
};

export const cloudSiteMeta = stylesRaw.site;
export const cloudStylesRaw = stylesRaw.styles as CloudStyleRecord[];
export const motionDictionary = stylesRaw.motion_dictionary as MotionDictionaryItem[];
export const cloudTools = stylesRaw.tools as CloudToolItem[];
export const studiedReels = reelsRaw.reels as StudiedReel[];
export const reelsHarvestStatus = reelsRaw.harvest_status as string;

export const cloudPlaybooks: CloudPlaybookDoc[] = [
  {
    id: 'sumit-kelsie-edit-styles',
    title: 'Sumit & Kelsie Edit Styles — Master Playbook',
    kind: 'playbook',
    sourcePath: 'master-video-styles/playbooks/sumit-kelsie-edit-styles.md',
    summary: 'Complete rules, shot pacing, text hierarchy, and prompting guide for Sumit documentary explainers and Kelsie listicle / tour formats.',
    relatedStyleIds: ['sumit', 'kelsie-listicle', 'kelsie-listing-tour', 'melissa-vision-pitch'],
    content: sumitKelsiePlaybook,
  },
  {
    id: 'overstimulated-mind-edit-process',
    title: 'Overstimulated Mind — 6-Step Edit Process',
    kind: 'playbook',
    sourcePath: 'master-video-styles/playbooks/overstimulated-mind-edit-process.md',
    summary: 'Day-by-day 7-day build process covering hook setup, roto neon outlines, PiP collages, scattered kinetic type, and audio polish.',
    relatedStyleIds: ['overstimulated-mind', 'sumit'],
    content: overstimulatedPlaybook,
  },
  {
    id: 'invideo-paper-cutout-guide',
    title: 'Paper-Cutout Collage Animation — InVideo + Claude',
    kind: 'playbook',
    sourcePath: 'master-video-styles/playbooks/invideo-paper-cutout-guide.md',
    summary: '7-step workflow for building layered paper-cutout documentary collages with editable timelines through InVideo MCP and Claude.',
    relatedStyleIds: ['invideo-paper-cutout'],
    content: invideoCutoutPlaybook,
  },
  {
    id: 'after-effects-claude-mcp',
    title: 'After Effects + Claude — Community MCP Bridges',
    kind: 'playbook',
    sourcePath: 'master-video-styles/playbooks/after-effects-claude-mcp.md',
    summary: 'Comparison and setup guidance for Engine Room MCP, Kumo MCP, Higgsfield Bridge, and AE GPT when driving desktop After Effects.',
    relatedStyleIds: ['ae-claude-mcp', 'sumit', 'overstimulated-mind'],
    content: aeClaudeMcpPlaybook,
  },
  {
    id: 'sumit-style-video-edit-prompt',
    title: 'Video Edit Styles — Master Prompt for Claude',
    kind: 'prompt',
    sourcePath: 'master-video-styles/prompts/sumit-style-video-edit-prompt.md',
    summary: 'Ready-to-use director prompt covering Style 1 (Sumit) and Style 2 (Kelsie) for raw footage ingestion.',
    relatedStyleIds: ['sumit', 'kelsie-listicle', 'kelsie-listing-tour', 'kelsie-flythrough'],
    content: sumitPrompt,
  },
];

const STUDY_CLOUD_IDS = new Set(['sumit', 'motionsmith-vox', 'invideo-paper-cutout']);
const DUAL_ASPECT_CLOUD_IDS = new Set(['motionsmith-saas-launch', 'motionsmith-vox', 'ae-claude-mcp']);

/** Converts pulled Master Video Styles records into StyleProfile objects for the Studio. */
export function mapCloudStylesToProfiles(records: CloudStyleRecord[] = cloudStylesRaw): StyleProfile[] {
  return records.map((st) => {
    const stepRules = st.steps.map(
      (s) => `${s.title}${s.days ? ` (${s.days})` : ''}: ${s.detail}`
    );
    const motion = [...st.rules, ...stepRules];
    if (motion.length === 0) {
      if (st.best_for) motion.push(st.best_for);
      if (st.look) motion.push(st.look);
    }

    const pieces = [...st.tools];
    if (st.reference_reel_url) {
      pieces.push(`Reference reel: ${st.reference_reel_url}`);
    }
    if (pieces.length === 0) {
      pieces.push(st.tag || st.title);
    }

    const attribution = st.creator_handle || st.creator;

    return {
      id: st.id,
      name: st.title,
      category: STUDY_CLOUD_IDS.has(st.id) ? 'study' : 'creator',
      cloudCategory: st.category,
      description: st.look,
      palette: `Accent ${st.accent} · ${st.tag}`,
      format: DUAL_ASPECT_CLOUD_IDS.has(st.id)
        ? '16:9 / 9:16 · adapt to brief'
        : '9:16 vertical · adapt to brief',
      duration:
        st.steps.length > 0
          ? `${st.steps.length}-step playbook`
          : 'Adapt to footage and story',
      motion,
      pieces,
      promptSuffix: st.prompt || st.best_for || st.look,
      source: `master-video-styles/data/styles.json (#${st.number}${attribution ? ` · ${attribution}` : ''})`,
      accent: st.accent,
      tag: st.tag,
      creator: st.creator || undefined,
      creatorHandle: st.creator_handle || undefined,
      referenceReelUrl: st.reference_reel_url || undefined,
      referenceReelNote: st.reference_reel_note || undefined,
      steps: st.steps.length > 0 ? st.steps : undefined,
      tools: st.tools,
      bestFor: st.best_for,
    };
  });
}

export const cloudStyleProfiles: StyleProfile[] = mapCloudStylesToProfiles();
