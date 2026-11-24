import { describe, expect, it } from 'vitest';
import { scenarioPromptLocales } from '../../../shared/scenario-prompt-locales';
import scenarioMediaTitles from '../../../shared/scenario-media-titles.json';
import { scenarioCategories, scenarioDefinitions, socialPlatforms } from '../../../shared/scenarios';
import { isKnownMessage, languages, translate } from './messages';
import scenarioUi from './scenario-ui.json';
import studioNavigationUi from './studio-navigation-ui.json';
import mcpUi from './mcp-ui.json';

const nonEnglishLocales = languages.map(language => language.locale).filter(locale => locale !== 'en');
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const mcpTools = (text: string) => (text.match(/openmotion_\w+/g) ?? []).sort();

describe('scenario workflow i18n resources', () => {
  it('shares localized workflow and audio/video titles with the generation service', () => {
    expect(Object.keys(scenarioMediaTitles).sort()).toEqual([...nonEnglishLocales].sort());
    for (const locale of nonEnglishLocales) {
      const titles: Record<string, string> = scenarioMediaTitles[locale];
      for (const scenario of scenarioDefinitions) {
        const mediaSteps = scenario.steps.filter(step => step.type === 'audio' || step.type === 'video');
        for (const source of [scenario.title, ...mediaSteps.map(step => step.title)]) {
          expect(titles[source]?.trim(), `${locale}: ${source}`).toBeTruthy();
          expect(translate(locale, source)).toBe(titles[source]);
        }
      }
    }
  });

  it('localizes every automatically seeded media prompt and its brief terms', () => {
    expect(Object.keys(scenarioPromptLocales).sort()).toEqual(languages.map(({ locale }) => locale).sort());
    for (const scenario of scenarioDefinitions) {
      for (const step of scenario.steps) {
        if (!('promptTemplate' in step)) continue;
        const fieldIds = Array.from(step.promptTemplate.matchAll(/\{(\w+)\}/g), match => match[1]);
        const fields = scenario.briefFields.filter(field => fieldIds.includes(field.id));
        for (const { locale } of languages) {
          const { actions, terms } = scenarioPromptLocales[locale];
          expect(actions[step.id]?.trim(), `${locale}: ${step.id}`).toBeTruthy();
          if (locale === 'en') continue;
          expect(actions[step.id], `${locale}: ${step.id}`).not.toBe(scenarioPromptLocales.en.actions[step.id]);
          for (const field of fields) {
            for (const label of [field.label, ...(field.options?.map(option => option.label) ?? [])]) {
              expect(terms[label]?.trim(), `${locale}: ${label}`).toBeTruthy();
            }
          }
        }
      }
    }
  });

  it('keeps identical key sets, non-empty translations and matching placeholders across all 10 non-English locales', () => {
    expect(Object.keys(scenarioUi).sort()).toEqual([...nonEnglishLocales].sort());
    const keys = Object.keys(scenarioUi['zh-CN']).sort();
    expect(keys.length).toBeGreaterThan(150);

    for (const locale of nonEnglishLocales) {
      const entries = scenarioUi[locale as keyof typeof scenarioUi] as Record<string, string>;
      expect(Object.keys(entries).sort(), locale).toEqual(keys);
      for (const [source, value] of Object.entries(entries)) {
        expect(value.trim(), `${locale}: ${source}`).not.toBe('');
        expect(placeholders(value), `${locale}: ${source}`).toEqual(placeholders(source));
        expect(mcpTools(value), `${locale}: ${source}`).toEqual(mcpTools(source));
      }
    }
  });

  it('forbids 工程 in zh-CN scenario translations and new navigation/MCP entries', () => {
    for (const [source, value] of Object.entries(scenarioUi['zh-CN'])) {
      expect(value, `scenario-ui.json: ${source}`).not.toContain('工程');
    }
    const navKeys = [
      'Workflows', 'Topics', 'Campaigns', 'Roles', 'All workflows', 'Topics, campaigns and roles',
      'Start workflow', 'Recent', 'Start Gemini 4 Neon workflow', 'Start Black Friday workflow', 'AI Influencer',
      'Pick a goal and go from idea to finished visuals, pages, videos, and posts.',
      'Featured', 'Recreate this template', 'Templates could not be loaded.',
    ];
    for (const key of navKeys) {
      const value = studioNavigationUi['zh-CN'][key as keyof typeof studioNavigationUi['zh-CN']];
      expect(value, `studio-navigation-ui.json: ${key}`).toBeTruthy();
      expect(value, `studio-navigation-ui.json: ${key}`).not.toContain('工程');
      for (const locale of nonEnglishLocales) {
        expect(translate(locale, key).trim(), `${locale}: ${key}`).not.toBe('');
      }
    }
    expect(studioNavigationUi['zh-CN']['Workflows']).toBe('工作流');
    const mcpKeys = [
      'Run a workflow end to end',
      'Open a Topic, Campaign or Role from Workflows to build step by step with shared Assets, or switch to Agent mode to copy concise metadata and grouped Skills for your Agent via MCP.',
      'List available Workflows with openmotion_assets_use (action=scenario, command=catalog) and open or create a run with command=list / command=get / command=create. Load the workflow’s grouped Skills via openmotion_get_skill and workflow guides via openmotion://workflow/* before authoring. Generate media directly with command=generate + command=sync, refine HTML pages with openmotion_design_project and openmotion_design_edit (action=write and action=import_asset) then link with command=link_design, save Agent-created workspace assets directly into the active run’s Assets and step history with command=add_pool (recordIteration=true), and export selected or all deliverables with command=export.',
      'Run a workflow and save back to Assets',
      'Copy concise workflow metadata and Skills instructions into your Agent so it identifies your active project and workflow, runs the right Skills via MCP, and writes every deliverable directly into Assets.',
      'Help me run or refine my active OpenMotion workflow and save every deliverable back into Assets. First call openmotion_assets_use (action=scenario, command=list) and command=get to read the active runId, expectedRevision, brief and existing Assets, and load the workflow’s grouped Skills via openmotion_get_skill or openmotion://workflow/*. Inspect configured providers/models with openmotion_media_use, generate images, video or audio directly via openmotion_assets_use (action=scenario, command=generate + command=sync), or save refined workspace assets into Assets and step history atomically via action=scenario command=add_pool with recordIteration=true (passing stepId, source="agent" and stable requestId). For HTML pages use openmotion_design_project and openmotion_design_edit (action=write / action=import_asset) then link with command=link_design; for editable Motion films use openmotion_create_project, openmotion_open_preview and command=link_motion.',
      'How does my Agent run a workflow and save results to Assets?',
      'In Agent mode inside any workflow, fill in your task and click Copy for Agent to copy concise metadata, step-grouped Skills, and Assets references into your Agent; or switch to Step-by-step mode and click Copy MCP prompt on any step. Your Agent loads each library Skill with openmotion_get_skill (and workflow guides via openmotion://workflow/*), generates media directly (action=scenario, command=generate + sync), saves workspace assets into Assets and step history (command=add_pool with recordIteration=true), or links Design pages (command=link_design) and Motion projects (command=link_motion). Click Sync or return to Studio to see new deliverables immediately in Assets.',
      'Run the Black Friday campaign workflow',
      'Embed workspace images into an HTML page',
    ];
    for (const key of mcpKeys) {
      const value = mcpUi['zh-CN'][key as keyof typeof mcpUi['zh-CN']];
      expect(value, `mcp-ui.json: ${key}`).toBeTruthy();
      expect(value, `mcp-ui.json: ${key}`).not.toContain('工程');
      for (const locale of nonEnglishLocales) {
        const translated = translate(locale, key);
        expect(translated.trim(), `${locale}: ${key}`).not.toBe('');
        expect(translated, `${locale}: ${key} was not localized`).not.toBe(key);
      }
    }
    expect(mcpUi['zh-CN']['Run the Black Friday campaign workflow']).toBe('运行黑五电商活动工作流');
  });

  it('covers every scenario catalog string across all 10 non-English locales', () => {
    const strings = new Set<string>();
    const skillStrings = new Set<string>();
    for (const category of scenarioCategories) strings.add(category.label);
    for (const platform of socialPlatforms) strings.add(platform.label);
    for (const scenario of scenarioDefinitions) {
      strings.add(scenario.title);
      strings.add(scenario.subtitle);
      strings.add(scenario.description);
      for (const field of scenario.briefFields) {
        strings.add(field.label);
        if (field.placeholder) strings.add(field.placeholder);
        if (field.options) {
          for (const option of field.options) strings.add(option.label);
        }
      }
      for (const step of scenario.steps) {
        strings.add(step.title);
        strings.add(step.hint);
        for (const skill of step.skills ?? []) {
          strings.add(skill.label);
          strings.add(skill.role);
          skillStrings.add(skill.label);
          skillStrings.add(skill.role);
        }
      }
    }

    for (const source of strings) {
      expect(isKnownMessage(source), `missing zh-CN mapping for "${source}"`).toBe(true);
      for (const locale of nonEnglishLocales) {
        const translated = translate(locale, source);
        expect(translated.trim(), `${locale}: ${source}`).not.toBe('');
        if (skillStrings.has(source)) {
          expect(translated, `${locale}: ${source} was not localized`).not.toBe(source);
        }
      }
    }
  });

  it('covers StepCapabilityBar, Assets sidebar, disclosures, and export/import controls across all 10 non-English locales', () => {
    const uiStrings = [
      'Hot',
      'Assets',
      'Assets ({count})',
      'Show assets ({count})',
      'Hide assets',
      'Collapse assets',
      'Close assets',
      'Import assets',
      'Upload files to assets',
      'Drop files to upload to assets',
      'Resize assets panel',
      'No assets yet',
      'Added {count} file(s) to assets',
      'Added to assets',
      'Import to assets',
      'Sync assets',
      'Synced latest assets',
      'Agent tools',
      'Models and Agent tools',
      'Create with models or an Agent',
      'Work with your Agent via MCP',
      'Generate media',
      'Audio',
      'MCP guide',
      'Copy MCP prompt',
      'Copied MCP prompt. Paste into your Agent to write assets back into this step.',
      'Sync',
      'Media type',
      'Attach reference image',
      'Change reference image',
      'Describe the image to generate',
      'Describe the video clip to generate',
      'Describe the music or voiceover to generate',
      '{count} generating',
      'No audio model is configured.',
      'Generation started. New outputs will appear in Assets.',
      'Generate images, video, or audio directly into Assets, or copy an MCP prompt so your Agent refines and saves back here.',
      'Copy an MCP prompt for this step so your Agent writes assets back here and to Assets.',
      'Or reuse an existing Design page',
      'Or link an existing Motion project',
      'Stage reference templates',
      '{count} available',
      'Include assets ({count})',
      'Optional. Attach images from Assets to place automatically.',
      'Place images from Assets directly into the page layout.',
      'Pick your channels, attach images or video from Assets, and generate ready-to-post copy.',
      'Pick up right where you left off — your notes, versions, and assets are all saved.',
      'Import',
      'Import ({count})',
      'Import all ({count})',
      'Import from workspace',
      'Import from workspace…',
      'Import Design pages',
      'Import Design pages…',
      'Import Motion projects',
      'Import Motion projects…',
      'Select',
      'Select all',
      'Select all ({count})',
      'Deselect all',
      'Export',
      'Export ({count})',
      'Export all',
      'Export all (ZIP)',
      'Export selected ({count})',
      'Export filtered ({count})',
      'Export options',
      'Export ready',
      'Could not build export ZIP',
      'Summary JSON copied',
      'Copy summary (JSON)',
      'Copy for Agent',
      'That asset is no longer in Assets.',
      'Drag assets here or choose from Assets.',
      'Optional. Drag assets here or choose from Assets.',
      'Could not save brief version.',
      'Page version',
      'Version',
      'All later steps already have custom prompts.',
      'Step export ready',
      'Could not build step export',
      'Gemini 4 & Neon inspiration',
      'View details',
      'Hide details',
      'Gemini connected',
      'Write or generate script',
      'Hide script',
      'Model providers',
      'Retry with {model}',
      'Your current model provider hit a limit or needs access. Switch models above or connect another provider to continue.',
      'Workflows',
      'All workflows',
      'Start workflow',
      'Step by step',
      'Agent mode',
      'Workflow mode',
      'Skills workflow',
      'Input',
      'Examples',
      'Example preview',
      'Hide preview',
      'Preview prompt',
      'Hide prompt',
      'Prompt',
      'Describe what you want this workflow to create…',
      '{count} assets ready for Agent',
      'Add reference files above to share with your Agent.',
      'Switch to step by step',
      'Copies concise metadata, attached Assets, and this workflow’s Skills for your Agent.',
      '{steps} steps · {skills} skills',
      '{count} steps · {skills} skills',
      '{count} versions',
      'Open {step} in step-by-step mode',
      'Hide parameters',
      'More parameters',
      'Open draft history',
      'Remove from workflow',
      '{count} selected',
      'Workflow steps',
      'Workflow actions',
      'More workflow actions',
      'Workflow categories',
      'Pick a workflow to build step by step with shared Assets, or copy its Skills to your Agent.',
      'Start any workflow above to keep your ideas, visuals, and exports organized in one place.',
      'Loading workflow…',
      'Could not load workflow',
      'This workflow changed elsewhere. Showing the latest version.',
      'Copied. Paste into your Agent.',
      'Clear',
      'Save',
      'Save version',
      'Generating…',
      'Generation cancelled',
      'Project title',
      'Recommended',
      'Reload preview',
      'Start Gemini 4 Neon workflow',
      'Start Black Friday workflow',
    ];

    for (const source of uiStrings) {
      expect(isKnownMessage(source), `missing zh-CN mapping for "${source}"`).toBe(true);
      expect(translate('zh-CN', source), `zh-CN: ${source}`).not.toBe(source);
      for (const locale of nonEnglishLocales) {
        const translated = translate(locale, source);
        expect(translated.trim(), `${locale}: ${source}`).not.toBe('');
        if (!(
          (source === 'Workflows' && locale === 'de') ||
          (source === 'Version' && (locale === 'de' || locale === 'fr')) ||
          ((source === 'Assets' || source === 'Assets ({count})') && locale === 'de') ||
          (source === 'Audio' && ['de', 'fr', 'es', 'it'].includes(locale))
        )) {
          expect(translated, `${locale}: ${source} was not localized`).not.toBe(source);
        }
      }
    }
  });
});
