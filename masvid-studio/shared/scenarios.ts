import type { StudioScene } from './studio-catalog.ts';
import type { DesignScenarioId } from './design-project.ts';

export const scenarioCategories = [
  { id: 'topic', label: 'Topics', icon: 'sparkling-line' },
  { id: 'campaign', label: 'Campaigns', icon: 'flashlight-line' },
  { id: 'role', label: 'Roles', icon: 'user-3-line' },
] as const;
export type ScenarioCategory = typeof scenarioCategories[number]['id'];

export const scenarioStepTypes = ['brief', 'web-page', 'image', 'video', 'audio', 'social-pack'] as const;
export type ScenarioStepType = typeof scenarioStepTypes[number];
export type PoolKind = 'image' | 'video' | 'audio' | 'page' | 'motion' | 'text';

export const socialPlatforms = [
  { id: 'x', label: 'X', maxChars: 280, maxHashtags: 2, aspect: '16:9' },
  { id: 'instagram', label: 'Instagram', maxChars: 2200, maxHashtags: 8, aspect: '4:5' },
  { id: 'tiktok', label: 'TikTok', maxChars: 2200, maxHashtags: 5, aspect: '9:16' },
  { id: 'douyin', label: 'Douyin', maxChars: 1000, maxHashtags: 5, aspect: '9:16' },
  { id: 'xiaohongshu', label: 'Xiaohongshu', maxChars: 1000, maxTitleChars: 20, maxHashtags: 10, aspect: '3:4' },
  { id: 'linkedin', label: 'LinkedIn', maxChars: 3000, maxHashtags: 3, aspect: '1:1' },
] as const;
export type SocialPlatformId = typeof socialPlatforms[number]['id'];

export type ScenarioBriefField = {
  id: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'multi' | 'list' | 'url' | 'price';
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  options?: readonly { id: string; label: string }[];
};

export type ScenarioWorkspaceMode = 'manual' | 'agent';

export type ScenarioSkillRef = {
  id: string;
  label: string;
  /** 'library' skills are loaded via openmotion_get_skill(skillId); 'workflow' guides via resources/read on resourceUri. */
  source: 'library' | 'workflow';
  resourceUri?: string;
  role: string;
};

export type PageRecipeId = 'landing' | 'sale' | 'link-in-bio' | 'code-animation';

export type ScenarioStepExecutionMode = 'input' | 'model' | 'direct' | 'agent' | 'hybrid';

export type ScenarioWorkflowEdge = {
  id: string;
  from: string;
  to: string;
};

export type ScenarioStepDefinition = {
  id: string;
  type: ScenarioStepType;
  title: string;
  hint: string;
  icon: string;
  accepts: readonly PoolKind[];
  produces: readonly PoolKind[];
  /** Explicit upstream step IDs for the visual workflow graph. Empty array marks a start node. */
  dependsOn?: readonly string[];
  /** Primary execution path for this node: user input, direct media model, direct Studio action, external Agent, or hybrid. */
  executionMode?: ScenarioStepExecutionMode;
  skills?: readonly ScenarioSkillRef[];
  /** image | video: generator scenes; the first one is the default. */
  scenes?: readonly StudioScene['id'][];
  /** Identifies prompt inputs and recognizes defaults from drafts saved before localization. */
  promptTemplate?: string;
  audioModes?: readonly ('speech' | 'music')[];
  page?: {
    recipe: PageRecipeId;
    designScenario: DesignScenarioId;
    templates: readonly string[];
    mode: 'create' | 'embed' | 'both';
    linkedStepId?: string;
  };
  motion?: {
    templateSource: 'motion' | 'black-friday' | 'none';
    skills: readonly string[];
    defaultDurationSeconds?: number;
  };
  platforms?: readonly SocialPlatformId[];
  optional?: boolean;
};

export type ScenarioId = 'motion-full-chain' | 'gemini-4-neon' | 'design-full-chain' | 'black-friday' | 'ai-influencer';

export type ScenarioLinkTarget =
  | 'motion-studio'
  | 'design-studio'
  | 'black-friday-collection'
  | 'model-hub:gemini-4'
  | 'template-library'
  | 'skills';

export type ScenarioDefinition = {
  id: ScenarioId;
  category: ScenarioCategory;
  title: string;
  subtitle: string;
  description: string;
  badge?: 'New' | 'Hot' | 'Top';
  icon: string;
  /** Existing Studio destinations that stay one click away. */
  links: readonly ScenarioLinkTarget[];
  briefFields: readonly ScenarioBriefField[];
  steps: readonly ScenarioStepDefinition[];
};

const toneOptions = [
  { id: 'bold', label: 'Bold & direct' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'premium', label: 'Premium' },
  { id: 'playful', label: 'Playful' },
  { id: 'informative', label: 'Informative' },
] as const;

const languageOptions = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: 'Simplified Chinese' },
] as const;

const durationOptions = [
  { id: '15', label: '15s' },
  { id: '30', label: '30s' },
  { id: '60', label: '60s' },
] as const;

const aspectOptions = [
  { id: '16:9', label: '16:9 Landscape' },
  { id: '9:16', label: '9:16 Vertical' },
  { id: '1:1', label: '1:1 Square' },
] as const;

const codeStyleOptions = [
  { id: 'art-animation', label: 'Art animation' },
  { id: 'product-film', label: 'Product film' },
  { id: 'explainer', label: 'Explainer' },
  { id: '3d-scene', label: '3D scene' },
  { id: 'game-interactive', label: 'Interactive game' },
] as const;

const platformOptions = socialPlatforms.map(platform => ({ id: platform.id, label: platform.label }));

const commonBriefFields: readonly ScenarioBriefField[] = [
  { id: 'idea', label: 'Core idea', kind: 'textarea', required: true, placeholder: 'Describe what you want to create and the outcome you want.', maxLength: 2000 },
  { id: 'audience', label: 'Audience', kind: 'text', placeholder: 'Who is this for?', maxLength: 200 },
  { id: 'tone', label: 'Copy tone', kind: 'select', options: toneOptions },
  { id: 'language', label: 'Copy language', kind: 'select', options: languageOptions },
  { id: 'brandName', label: 'Brand name', kind: 'text', placeholder: 'Optional brand or studio name', maxLength: 120 },
];

export const scenarioDefinitions = [
  {
    id: 'motion-full-chain',
    category: 'topic',
    title: 'Idea to Motion Film',
    subtitle: 'Storyboard, animated film, soundtrack, and social posts from one brief',
    description: 'Turn a rough idea into a planned storyboard, editable motion film, matched soundtrack, and ready-to-share social posts.',
    badge: 'Top',
    icon: 'movie-line',
    links: ['motion-studio', 'template-library', 'skills'],
    briefFields: [
      ...commonBriefFields,
      { id: 'concept', label: 'Film concept', kind: 'text', placeholder: 'A crisp product reveal with kinetic typography', maxLength: 300 },
      { id: 'durationSeconds', label: 'Duration', kind: 'select', options: durationOptions },
      { id: 'aspect', label: 'Aspect ratio', kind: 'select', options: aspectOptions },
      { id: 'visualStyle', label: 'Visual style', kind: 'text', placeholder: 'Editorial minimalism, bold lighting, clean type', maxLength: 300 },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief',
        hint: 'Define the film concept, audience, duration and visual direction.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
        dependsOn: [],
        executionMode: 'input',
        skills: [
          {
            id: 'openmotion-director',
            label: 'Director Brief',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/director/start',
            role: 'Creative direction and narrative structure',
          },
          {
            id: 'openmotion-shot-breakdown',
            label: 'Shot Breakdown',
            source: 'library',
            role: 'Scene-by-scene shot plan and pacing',
          },
        ],
      },
      {
        id: 'storyboard',
        type: 'image',
        title: 'Storyboard',
        hint: 'Generate or upload key storyboard frames to anchor the motion film.',
        icon: 'image-line',
        accepts: ['image'],
        produces: ['image'],
        dependsOn: ['brief'],
        executionMode: 'model',
        skills: [
          {
            id: 'openmotion-media',
            label: 'Media Generation',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/media/start',
            role: 'Storyboard frames and visual references',
          },
        ],
        scenes: ['text-to-image'],
        promptTemplate: 'Storyboard frame for {concept}: {visualStyle}, {aspect} composition',
      },
      {
        id: 'motion-film',
        type: 'video',
        title: 'Motion film',
        hint: 'Animate a clip from your storyboard or create an editable Motion Studio project.',
        icon: 'movie-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        dependsOn: ['storyboard', 'soundtrack'],
        executionMode: 'hybrid',
        skills: [
          {
            id: 'openmotion-storyboard-to-motion',
            label: 'Storyboard to Motion',
            source: 'library',
            role: 'Turn storyboard frames into animated film',
          },
          {
            id: 'openmotion-production',
            label: 'Motion Production',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/production/start',
            role: 'Editable composition, preview and export',
          },
        ],
        scenes: ['image-to-video', 'text-to-video'],
        promptTemplate: 'Motion film sequence for {concept}: {visualStyle}, {aspect}, {durationSeconds}s',
        motion: {
          templateSource: 'motion',
          skills: ['openmotion-storyboard-to-motion', 'openmotion-bubble-field'],
          defaultDurationSeconds: 15,
        },
      },
      {
        id: 'soundtrack',
        type: 'audio',
        title: 'Soundtrack',
        hint: 'Generate background music or voiceover, or upload an audio track.',
        icon: 'music-2-line',
        accepts: ['text'],
        produces: ['audio'],
        dependsOn: ['brief'],
        executionMode: 'model',
        skills: [
          {
            id: 'openmotion-media',
            label: 'Audio & Music',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/media/start',
            role: 'Soundtrack music and voiceover generation',
          },
        ],
        audioModes: ['music', 'speech'],
        promptTemplate: '{tone} soundtrack for {concept}, {durationSeconds}s',
        optional: true,
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Draft platform-ready launch copy paired with your storyboard and film assets.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        dependsOn: ['motion-film'],
        executionMode: 'agent',
        skills: [
          {
            id: 'openmotion-ad-script',
            label: 'Launch Copy',
            source: 'library',
            role: 'Platform-ready launch hooks and captions',
          },
        ],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu'],
      },
    ],
  },
  {
    id: 'gemini-4-neon',
    category: 'topic',
    title: 'Interactive Code Animation',
    subtitle: 'Live HTML/Canvas animation, cover stills, companion video, and posts',
    description: 'Generate an interactive coded animation, pair it with cover stills and a companion video, then package social posts together.',
    badge: 'New',
    icon: 'sparkling-line',
    links: ['model-hub:gemini-4', 'design-studio', 'motion-studio'],
    briefFields: [
      ...commonBriefFields,
      { id: 'concept', label: 'Animation concept', kind: 'text', placeholder: 'Reactive neon particle ribbon spelling the launch headline', maxLength: 300 },
      { id: 'codeStyle', label: 'Code animation style', kind: 'select', options: codeStyleOptions },
      { id: 'durationSeconds', label: 'Duration', kind: 'select', options: durationOptions },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief',
        hint: 'Describe the code animation concept, check Gemini availability and browse examples.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
        dependsOn: [],
        executionMode: 'input',
        skills: [
          {
            id: 'openmotion-director',
            label: 'Creative Direction',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/director/start',
            role: 'Visual concept, rhythm and art direction',
          },
        ],
      },
      {
        id: 'code-animation',
        type: 'web-page',
        title: 'Code animation',
        hint: 'Create an interactive web animation, or let your Agent write custom Gemini code.',
        icon: 'code-s-slash-line',
        accepts: ['image'],
        produces: ['page'],
        dependsOn: ['brief'],
        executionMode: 'agent',
        skills: [
          {
            id: 'openmotion-design',
            label: 'Interactive HTML & Canvas',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/design/start',
            role: 'Self-contained HTML/CSS/Canvas animation',
          },
          {
            id: 'openmotion-aurora-gradient',
            label: 'Aurora Gradient',
            source: 'library',
            role: 'Luminous neon glow and shader-style gradients',
          },
        ],
        page: {
          recipe: 'code-animation',
          designScenario: 'live-artifact',
          templates: ['live-artifact', 'webgl-neon-grid', 'webgl-particle-galaxy', 'webgl-experience'],
          mode: 'both',
        },
      },
      {
        id: 'stills',
        type: 'image',
        title: 'Key stills',
        hint: 'Generate or upload cover stills to complement the coded animation.',
        icon: 'image-line',
        accepts: ['image'],
        produces: ['image'],
        dependsOn: ['brief'],
        executionMode: 'model',
        skills: [
          {
            id: 'openmotion-media',
            label: 'Key Stills',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/media/start',
            role: 'High-impact posters and visual frames',
          },
        ],
        scenes: ['text-to-image'],
        promptTemplate: 'Neon key still for {concept}, {codeStyle} visual direction, high contrast studio composition',
      },
      {
        id: 'film',
        type: 'video',
        title: 'Film & motion',
        hint: 'Turn your stills into a video cut or open an editable Motion project.',
        icon: 'clapperboard-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        dependsOn: ['stills'],
        executionMode: 'hybrid',
        skills: [
          {
            id: 'openmotion-bubble-field',
            label: 'Bubble Field',
            source: 'library',
            role: 'Procedural floating light and particle motion',
          },
          {
            id: 'openmotion-neon-outline-type',
            label: 'Neon Outline Type',
            source: 'library',
            role: 'Kinetic glowing headline typography',
          },
          {
            id: 'openmotion-production',
            label: 'Motion Production',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/production/start',
            role: 'Editable timeline assembly and MP4 export',
          },
        ],
        scenes: ['image-to-video', 'text-to-video'],
        promptTemplate: 'Fluid motion sequence for {concept} in {codeStyle} style, {durationSeconds}s',
        motion: {
          templateSource: 'motion',
          skills: ['openmotion-storyboard-to-motion', 'openmotion-neon-outline-type'],
          defaultDurationSeconds: 15,
        },
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Write launch posts highlighting the live animation and companion film.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        dependsOn: ['code-animation', 'film'],
        executionMode: 'agent',
        skills: [
          {
            id: 'openmotion-ad-script',
            label: 'Social Copy',
            source: 'library',
            role: 'Launch captions tailored per channel',
          },
        ],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu', 'linkedin'],
      },
    ],
  },
  {
    id: 'design-full-chain',
    category: 'topic',
    title: 'Landing Page & Launch Kit',
    subtitle: 'Landing page, custom hero visuals, promo video, and launch posts',
    description: 'Build a responsive landing page with embedded hero visuals, turn them into a launch promo video, and draft channel-ready posts.',
    badge: 'New',
    icon: 'layout-line',
    links: ['design-studio', 'motion-studio', 'template-library'],
    briefFields: [
      ...commonBriefFields,
      { id: 'productName', label: 'Product name', kind: 'text', required: true, placeholder: 'Name of the product or project', maxLength: 120 },
      { id: 'valueProps', label: 'Key value props', kind: 'list', placeholder: 'Add up to 5 concrete benefits', maxLength: 240 },
      { id: 'cta', label: 'Primary call to action', kind: 'text', placeholder: 'Start free trial', maxLength: 80 },
      { id: 'visualStyle', label: 'Visual style', kind: 'text', placeholder: 'Warm daylight photography, crisp editorial grid', maxLength: 300 },
      { id: 'pageUrl', label: 'Destination URL', kind: 'url', placeholder: 'https://example.com', maxLength: 500 },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief',
        hint: 'Capture your product story, value propositions, CTA and visual direction.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
        dependsOn: [],
        executionMode: 'input',
        skills: [
          {
            id: 'openmotion-design',
            label: 'Design Brief',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/design/start',
            role: 'Page hierarchy, sections and UX structure',
          },
        ],
      },
      {
        id: 'landing-page',
        type: 'web-page',
        title: 'Landing page',
        hint: 'Describe your page, pick a starter layout, or connect an existing page.',
        icon: 'layout-line',
        accepts: ['image'],
        produces: ['page'],
        dependsOn: ['brief'],
        executionMode: 'agent',
        skills: [
          {
            id: 'openmotion-design-styles',
            label: 'Design Styles',
            source: 'library',
            role: 'Cohesive visual tokens, typography and layout',
          },
        ],
        page: {
          recipe: 'landing',
          designScenario: 'prototype',
          templates: ['saas-landing', 'kami-landing', 'waitlist-page', 'pricing-page'],
          mode: 'create',
        },
      },
      {
        id: 'page-images',
        type: 'image',
        title: 'Page images',
        hint: 'Generate, edit or upload hero and gallery visuals for your landing page.',
        icon: 'image-line',
        accepts: ['image'],
        produces: ['image'],
        dependsOn: ['brief'],
        executionMode: 'model',
        skills: [
          {
            id: 'openmotion-media',
            label: 'Hero & Product Visuals',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/media/start',
            role: 'Generate and edit hero photography',
          },
        ],
        scenes: ['text-to-image', 'image-edit', 'remove-background', 'relight'],
        promptTemplate: 'Hero image for {productName}: {valueProps}, {visualStyle}',
      },
      {
        id: 'embed-images',
        type: 'web-page',
        title: 'Embed images',
        hint: 'Place your chosen visuals right into your landing page.',
        icon: 'file-image-line',
        accepts: ['image', 'page'],
        produces: ['page'],
        dependsOn: ['landing-page', 'page-images'],
        executionMode: 'direct',
        skills: [
          {
            id: 'openmotion-design',
            label: 'Asset Embedding',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/design/start',
            role: 'Embed pinned images into responsive HTML',
          },
        ],
        page: {
          recipe: 'landing',
          designScenario: 'prototype',
          templates: ['saas-landing', 'kami-landing', 'waitlist-page', 'pricing-page'],
          mode: 'embed',
          linkedStepId: 'landing-page',
        },
      },
      {
        id: 'promo-video',
        type: 'video',
        title: 'Promo video',
        hint: 'Animate your hero image or start an editable Motion launch video.',
        icon: 'clapperboard-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        dependsOn: ['page-images'],
        executionMode: 'hybrid',
        skills: [
          {
            id: 'openmotion-website-launch',
            label: 'Website Launch Film',
            source: 'library',
            role: 'Product and landing-page launch animation',
          },
          {
            id: 'openmotion-storyboard-to-motion',
            label: 'Storyboard to Motion',
            source: 'library',
            role: 'Animate hero visuals into a promo clip',
          },
        ],
        scenes: ['image-to-video', 'text-to-video'],
        promptTemplate: 'Launch promo video for {productName}: {valueProps}, {visualStyle}',
        motion: {
          templateSource: 'motion',
          skills: ['openmotion-website-launch', 'openmotion-storyboard-to-motion'],
          defaultDurationSeconds: 15,
        },
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Draft launch posts referencing your landing page and visuals.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        dependsOn: ['embed-images', 'promo-video'],
        executionMode: 'agent',
        skills: [
          {
            id: 'openmotion-ad-script',
            label: 'Launch Copy',
            source: 'library',
            role: 'Channel-ready launch posts and hooks',
          },
        ],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu', 'linkedin'],
      },
    ],
  },
  {
    id: 'black-friday',
    category: 'campaign',
    title: 'Black Friday Promo Kit',
    subtitle: 'Product photos, conversion sale page, 30s promo video, and social posts',
    description: 'Produce studio product shots, embed them into a Black Friday sale page, build a 30-second promo film, and draft countdown posts.',
    badge: 'Hot',
    icon: 'flashlight-line',
    links: ['black-friday-collection', 'design-studio', 'motion-studio', 'template-library', 'skills'],
    briefFields: [
      ...commonBriefFields,
      { id: 'productName', label: 'Product name', kind: 'text', required: true, placeholder: 'Holiday Weekender Tote', maxLength: 120 },
      { id: 'productDescription', label: 'Product details', kind: 'textarea', placeholder: 'Materials, standout features and why shoppers buy it', maxLength: 1200 },
      { id: 'originalPrice', label: 'Original price', kind: 'price', placeholder: '$129', maxLength: 40 },
      { id: 'salePrice', label: 'Sale price', kind: 'price', placeholder: '$79', maxLength: 40 },
      { id: 'discountPercent', label: 'Discount', kind: 'text', placeholder: '40% OFF', maxLength: 40 },
      { id: 'promoCode', label: 'Promo code', kind: 'text', placeholder: 'BF40', maxLength: 40 },
      { id: 'saleWindow', label: 'Sale window', kind: 'text', placeholder: 'Nov 27 – Dec 1', maxLength: 120 },
      { id: 'cta', label: 'Call to action', kind: 'text', placeholder: 'Shop the Black Friday offer', maxLength: 80 },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief',
        hint: 'Set your product details, Black Friday pricing, promo code and campaign dates.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
        dependsOn: [],
        executionMode: 'input',
        skills: [
          {
            id: 'openmotion-ad-script',
            label: 'Campaign Script',
            source: 'library',
            role: 'Offer positioning, hooks and conversion copy',
          },
        ],
      },
      {
        id: 'product-images',
        type: 'image',
        title: 'Product images',
        hint: 'Generate, relight, clean up or upload studio product photography.',
        icon: 'image-line',
        accepts: ['image'],
        produces: ['image'],
        dependsOn: ['brief'],
        executionMode: 'model',
        skills: [
          {
            id: 'openmotion-media',
            label: 'Studio Product Media',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/media/start',
            role: 'Product photography, relighting and cutouts',
          },
          {
            id: 'openmotion-flat-lay-product',
            label: 'Flat-Lay Product',
            source: 'library',
            role: 'Commercial product framing and composition',
          },
        ],
        scenes: ['text-to-image', 'image-edit', 'remove-background', 'relight'],
        promptTemplate: 'Commercial product photo of {productName}: {productDescription}, bold Black Friday campaign lighting',
      },
      {
        id: 'detail-page',
        type: 'web-page',
        title: 'Detail page',
        hint: 'Build your sale detail page and embed your product images directly into the layout.',
        icon: 'layout-line',
        accepts: ['image'],
        produces: ['page'],
        dependsOn: ['product-images'],
        executionMode: 'agent',
        skills: [
          {
            id: 'openmotion-design',
            label: 'Sale Detail Page',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/design/start',
            role: 'Responsive sale page with embedded product photos',
          },
        ],
        page: {
          recipe: 'sale',
          designScenario: 'prototype',
          templates: ['saas-landing', 'pricing-page', 'poster-hero'],
          mode: 'both',
        },
      },
      {
        id: 'sales-film',
        type: 'video',
        title: '30s sales film',
        hint: 'Create a 30-second product promo video or pick a Black Friday style.',
        icon: 'clapperboard-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        dependsOn: ['product-images'],
        executionMode: 'hybrid',
        skills: [
          {
            id: 'openmotion-sale-countdown',
            label: 'Sale Countdown',
            source: 'library',
            role: 'Urgency countdown intro and offer beats',
          },
          {
            id: 'openmotion-sale-promo',
            label: 'Sale Promo',
            source: 'library',
            role: 'High-impact discount showcase motion',
          },
          {
            id: 'openmotion-sale-carousel',
            label: 'Sale Carousel',
            source: 'library',
            role: 'Multi-angle product card reveal',
          },
        ],
        scenes: ['image-to-video', 'video-multi-shot'],
        promptTemplate: '30s Black Friday sales film for {productName}: {salePrice}, code {promoCode}, {saleWindow}',
        motion: {
          templateSource: 'black-friday',
          skills: ['openmotion-sale-countdown', 'openmotion-sale-promo', 'openmotion-sale-carousel'],
          defaultDurationSeconds: 30,
        },
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Draft sale announcements with pricing, promo codes and countdown dates for every channel.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        dependsOn: ['detail-page', 'sales-film'],
        executionMode: 'agent',
        skills: [
          {
            id: 'openmotion-ad-script',
            label: 'Promo Posts',
            source: 'library',
            role: 'Pricing, promo code and countdown posts',
          },
        ],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu'],
      },
    ],
  },
  {
    id: 'ai-influencer',
    category: 'role',
    title: 'Virtual Creator Episode',
    subtitle: 'Script, consistent persona visuals, bio page, voiceover, and talking video',
    description: 'Produce a complete creator episode: write the script, keep your persona consistent, build a link-in-bio page, generate voiceover and a talking video, and draft social posts.',
    badge: 'New',
    icon: 'user-3-line',
    links: ['design-studio', 'motion-studio', 'skills'],
    briefFields: [
      ...commonBriefFields,
      { id: 'personaName', label: 'Persona name', kind: 'text', required: true, placeholder: 'Mina Park', maxLength: 120 },
      { id: 'niche', label: 'Creator niche', kind: 'text', placeholder: 'Tech explainers & daily workflow tips', maxLength: 200 },
      { id: 'platformFocus', label: 'Target platforms', kind: 'multi', options: platformOptions },
      { id: 'topic', label: 'Episode topic', kind: 'text', placeholder: '3 automation habits that save 5 hours a week', maxLength: 240 },
      { id: 'scriptOutline', label: 'Script notes', kind: 'textarea', placeholder: 'Hook, 3 talking points and closing question', maxLength: 3000 },
      { id: 'voiceStyle', label: 'Voice style', kind: 'text', placeholder: 'Warm, energetic conversational delivery', maxLength: 160 },
    ],
    steps: [
      {
        id: 'brief',
        type: 'brief',
        title: 'Brief & script',
        hint: 'Define your persona, episode topic and beat-by-beat spoken script.',
        icon: 'file-text-line',
        accepts: [],
        produces: ['text'],
        skills: [
          {
            id: 'openmotion-ad-script',
            label: 'Episode Script',
            source: 'library',
            role: 'Hook, talking points and closing CTA script',
          },
        ],
      },
      {
        id: 'persona',
        type: 'image',
        title: 'Persona visuals',
        hint: 'Generate consistent character frames with up to 5 reference photos, or upload your own.',
        icon: 'user-3-line',
        accepts: ['image'],
        produces: ['image'],
        skills: [
          {
            id: 'openmotion-media',
            label: 'Character Visuals',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/media/start',
            role: 'Consistent persona portraits from references',
          },
        ],
        scenes: ['character', 'text-to-image'],
        promptTemplate: 'Consistent portrait of {personaName}, {niche} creator talking about {topic}, natural studio lighting',
      },
      {
        id: 'home-page',
        type: 'web-page',
        title: 'Link-in-bio page',
        hint: 'Build a creator profile page and embed your persona avatar and gallery visuals.',
        icon: 'global-line',
        accepts: ['image'],
        produces: ['page'],
        skills: [
          {
            id: 'openmotion-design',
            label: 'Link-in-Bio Page',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/design/start',
            role: 'Creator profile page with persona gallery',
          },
        ],
        page: {
          recipe: 'link-in-bio',
          designScenario: 'prototype',
          templates: ['kami-landing', 'waitlist-page'],
          mode: 'both',
        },
      },
      {
        id: 'voice',
        type: 'audio',
        title: 'Voiceover & audio',
        hint: 'Generate speech from your script or background music, or upload recorded audio.',
        icon: 'voiceprint-line',
        accepts: ['text'],
        produces: ['audio'],
        skills: [
          {
            id: 'openmotion-media',
            label: 'Voiceover & Music',
            source: 'workflow',
            resourceUri: 'openmotion://workflow/media/start',
            role: 'Spoken narration and background track',
          },
        ],
        audioModes: ['speech', 'music'],
        promptTemplate: '{voiceStyle} voiceover for {personaName} covering {topic}',
      },
      {
        id: 'talking-video',
        type: 'video',
        title: 'Talking video',
        hint: 'Animate your persona frame with synced audio or create a talking-head Motion project.',
        icon: 'movie-line',
        accepts: ['image', 'audio'],
        produces: ['video', 'motion'],
        skills: [
          {
            id: 'openmotion-talking-head-recreation',
            label: 'Talking Head Film',
            source: 'library',
            role: 'Presenter video pacing and motion graphics',
          },
          {
            id: 'openmotion-presenter-story',
            label: 'Presenter Story',
            source: 'library',
            role: 'Creator narrative framing and overlays',
          },
          {
            id: 'openmotion-caption-styling',
            label: 'Caption Styling',
            source: 'library',
            role: 'Dynamic synced creator subtitles',
          },
        ],
        scenes: ['image-to-video', 'text-to-video'],
        promptTemplate: 'Talking-head creator clip of {personaName} explaining {topic}, natural gestures and framing',
        motion: {
          templateSource: 'motion',
          skills: ['openmotion-talking-head-recreation'],
          defaultDurationSeconds: 30,
        },
      },
      {
        id: 'social',
        type: 'social-pack',
        title: 'Social posts',
        hint: 'Adapt the episode hook and link-in-bio CTA for every social channel.',
        icon: 'chat-1-line',
        accepts: ['image', 'video', 'page'],
        produces: ['text'],
        skills: [
          {
            id: 'openmotion-ad-script',
            label: 'Social Distribution',
            source: 'library',
            role: 'Multi-platform episode hooks and links',
          },
        ],
        platforms: ['x', 'instagram', 'tiktok', 'douyin', 'xiaohongshu', 'linkedin'],
      },
    ],
  },
] as const satisfies readonly ScenarioDefinition[];

export const findScenario = (id: unknown): ScenarioDefinition | undefined =>
  scenarioDefinitions.find(scenario => scenario.id === id);

export const findScenarioStep = (scenario: ScenarioDefinition, stepId: unknown): ScenarioStepDefinition | undefined =>
  scenario.steps.find(step => step.id === stepId);

export const scenariosByCategory = (category: ScenarioCategory): ScenarioDefinition[] =>
  scenarioDefinitions.filter(scenario => scenario.category === category);

const LEGACY_SCENARIO_TITLE_PREFIXES: readonly [RegExp, string][] = [
  [/^Motion Studio full chain\b/i, 'Idea to Motion Film'],
  [/^Motion Studio\b(?=\s*[·•-]\s*\d{4}-\d{2}-\d{2}|$)/i, 'Idea to Motion Film'],
  [/^Gemini 4 Neon\b(?=\s*[·•-]\s*\d{4}-\d{2}-\d{2}|$)/i, 'Interactive Code Animation'],
  [/^Design Studio full chain\b/i, 'Landing Page & Launch Kit'],
  [/^Design Studio\b(?=\s*[·•-]\s*\d{4}-\d{2}-\d{2}|$)/i, 'Landing Page & Launch Kit'],
  [/^Black Friday e-commerce\b/i, 'Black Friday Promo Kit'],
  [/^Black Friday Sale\b(?=\s*[·•-]\s*\d{4}-\d{2}-\d{2}|$)/i, 'Black Friday Promo Kit'],
  [/^AI Influencer\b(?=\s*[·•-]\s*\d{4}-\d{2}-\d{2}|$)/i, 'Virtual Creator Episode'],
];

/** Normalizes legacy auto-generated default draft titles to current semantic workflow titles. */
export function cleanLegacyScenarioTitle(title: string): string {
  let out = title.trim();
  for (const [pattern, replacement] of LEGACY_SCENARIO_TITLE_PREFIXES) {
    if (pattern.test(out)) {
      out = out.replace(pattern, replacement);
      break;
    }
  }
  return out;
}

function formatBriefValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) {
    return raw.map(item => String(item).trim()).filter(Boolean).join(', ');
  }
  return typeof raw === 'string' ? raw.trim() : '';
}

export function fillScenarioTemplate(template: string, brief: Record<string, string | string[]>): string {
  const EMPTY = '\u0000';
  // Clean optional template-only prefixes and empty-placeholder separators before
  // substituting user brief values so user prose (e.g. "Learn to code." or trailing punctuation) is never altered.
  let prepared = template.replace(/\bcode\s+\{([a-zA-Z0-9_]+)\}/gi, (match, key: string) =>
    formatBriefValue(brief[key]) ? match : EMPTY,
  );
  prepared = prepared.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    formatBriefValue(brief[key]) ? match : EMPTY,
  );
  let prev = '';
  while (prev !== prepared) {
    prev = prepared;
    prepared = prepared
      .replace(/,\s*\u0000(?=\s*(?:[,;.]|$))/g, '')
      .replace(/:\s*\u0000\s*,\s*/g, ': ')
      .replace(/:\s*\u0000(?=\s*$)/g, '')
      .replace(/\u0000\s*,\s*/g, '')
      .replace(/\s*\u0000\s*/g, ' ');
  }
  prepared = prepared.replace(/\s{2,}/g, ' ').trim();
  return prepared.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => formatBriefValue(brief[key])).trim();
}

/** Tools the scenario recipe composes. The handbook test asserts that the prompt contains each one. */
export const scenarioRecipeTools = [
  'openmotion_media_use',
  'openmotion_assets_use',
  'openmotion_design_project',
  'openmotion_design_edit',
  'openmotion_create_project',
  'openmotion_open_preview',
] as const;

export type ScenarioPromptIntegration = { previewUrl?: string; dataDirectory?: string };

export type ScenarioRunSummaryForPrompt = {
  id: string;
  title: string;
  revision: number;
  locale?: string;
  brief: Record<string, string | string[]>;
  activeStepId: string;
  steps: Record<string, {
    stepId: string;
    status: string;
    activeIterationId: string | null;
    links: { designProjectId?: string; motionProjectId?: string; motionSessionId?: string };
  }>;
  pool: readonly {
    id: string;
    kind: PoolKind;
    label: string;
    stepId: string | null;
    pinned?: boolean;
    ref:
      | { type: 'asset'; assetId: string; versionId: string }
      | { type: 'design'; projectId: string; versionId: string | null; revision: string }
      | { type: 'motion'; projectId: string; sessionId: string | null }
      | { type: 'text'; stepId: string; iterationId: string };
  }[];
};

function stepToolGuide(step: ScenarioStepDefinition): string {
  switch (step.type) {
    case 'brief':
      return 'Record brief updates with openmotion_assets_use (action=scenario, command=update_brief or command=add_iteration).';
    case 'web-page':
      return 'Create or open the HTML project with openmotion_design_project (action=create/get/open), write HTML/CSS/JS with openmotion_design_edit (action=write), and embed pinned images via openmotion_design_edit (action=import_asset) or scenario command=embed_image.';
    case 'image':
    case 'audio':
      return 'Inspect providers and models with openmotion_media_use (action=inspect/models), then generate with openmotion_assets_use (action=generate or scenario command=generate) and poll openmotion_assets_use (action=status or scenario command=sync).';
    case 'video':
      return 'Generate clips via openmotion_media_use + openmotion_assets_use, or create an editable film with openmotion_create_project, import pinned assets using openmotion_assets_use (action=import_to_project), and inspect with openmotion_open_preview.';
    case 'social-pack':
      return 'Save platform copy as a new iteration with openmotion_assets_use (action=scenario, command=add_iteration).';
  }
}

/** Shared instruction builder: Studio "Copy Agent handoff", the handbook mcpScenarios entry and the MCP docs. */
export function scenarioAgentPrompt(
  scenario: ScenarioDefinition,
  options?: { locale?: string | null; integration?: ScenarioPromptIntegration | null },
): string {
  const stepLines = scenario.steps.map(
    (step, index) => `${index + 1}. ${step.title} (${step.id}, ${step.type}): ${step.hint} ${stepToolGuide(step)}`,
  );
  const lines = [
    `Run the OpenMotion "${scenario.title}" (${scenario.id}) end-to-end workflow.`,
    `Goal: ${scenario.description}`,
    options?.locale ? `Reply and write visible copy in: ${options.locale}` : null,
    options?.integration?.previewUrl ? `Studio URL: ${options.integration.previewUrl}` : null,
    options?.integration?.dataDirectory ? `Workspace: ${options.integration.dataDirectory}` : null,
    '',
    'Run tracking:',
    `- Use openmotion_assets_use with action=scenario (command=create, command=list, command=get, command=update_brief, command=sync) to track this workflow run and save every output into this run's Assets.`,
    '',
    'Ordered steps:',
    ...stepLines,
    '',
    'Tool composition across the workflow:',
    '- Media discovery & direct generation: call openmotion_media_use (action=inspect, action=models), then generate directly into this workflow run with openmotion_assets_use (action=scenario, command=generate) and poll command=sync; or use openmotion_assets_use (action=generate/status) and save edited/selected asset versions back via action=scenario command=add_pool with recordIteration=true.',
    '- HTML web pages: call openmotion_design_project (action=create/get/open), then openmotion_design_edit (action=write and action=import_asset) to author HTML and embed pinned workspace assets; link or refresh in the workflow run via command=link_design.',
    '- Editable Motion films: call openmotion_create_project, import selected asset versions via openmotion_assets_use (action=import_to_project), preview via openmotion_open_preview, and link to the step via command=link_motion.',
    '- Export from Assets or header: call openmotion_assets_use with action=scenario, command=export (optionally passing poolItemIds or stepIds) to build a downloadable ZIP package of selected assets or all deliverables.',
    '',
    'Delivery & safety requirements:',
    '- Pass an explicit stable requestId on every mutating call and current expectedRevision on run and design edits.',
    '- Never resubmit paid generation jobs automatically; poll the original jobId with status/sync.',
    '- Verify rendered pages, images and videos visually before marking steps done.',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

function formatPoolRef(ref: ScenarioRunSummaryForPrompt['pool'][number]['ref']): string {
  switch (ref.type) {
    case 'asset':
      return `asset:${ref.assetId}@${ref.versionId}`;
    case 'design':
      return `design:${ref.projectId}@${ref.revision.slice(0, 12)}`;
    case 'motion':
      return `motion:${ref.projectId}${ref.sessionId ? ` (session ${ref.sessionId})` : ''}`;
    case 'text':
      return `text:${ref.stepId}/${ref.iterationId}`;
  }
}

function stepWriteBackLines(
  run: ScenarioRunSummaryForPrompt,
  focusStep: ScenarioStepDefinition,
  stepPrompt?: string,
): string[] {
  const trimmedPrompt = stepPrompt?.trim();
  const lines: string[] = [
    '',
    'Step write-back instructions:',
    trimmedPrompt ? `- Current step prompt: ${trimmedPrompt}` : '',
    `- Direct multimodal generation into this step and Assets: openmotion_assets_use(action="scenario", scenario={ command: "generate", runId: "${run.id}", expectedRevision: ${run.revision}, stepId: "${focusStep.id}", requestId: "<stable-id>", modality, model, prompt }), then poll openmotion_assets_use(action="scenario", scenario={ command: "sync", runId: "${run.id}" }) until completed.`,
    `- Save Agent-created or refined workspace assets into this workflow version's Assets and step history atomically: openmotion_assets_use(action="scenario", scenario={ command: "add_pool", runId: "${run.id}", expectedRevision: ${run.revision}, requestId: "<stable-id>", recordIteration: true, items: [{ ref: { type: "asset", assetId, versionId }, stepId: "${focusStep.id}", source: "agent", label }] }).`,
  ].filter(Boolean);

  if (focusStep.type === 'web-page') {
    lines.push(
      `- Author or update the HTML page via openmotion_design_project + openmotion_design_edit (action=write / action=import_asset), then link it back to this step and Assets with openmotion_assets_use(action="scenario", scenario={ command: "link_design", runId: "${run.id}", expectedRevision: ${run.revision}, stepId: "${focusStep.id}", requestId: "<stable-id>", designProjectId: "<id>" }).`,
    );
  } else if (focusStep.type === 'brief') {
    lines.push(
      `- Save brief fields or scripts via openmotion_assets_use(action="scenario", scenario={ command: "update_brief" | "add_iteration", runId: "${run.id}", expectedRevision: ${run.revision}, stepId: "${focusStep.id}", requestId: "<stable-id>" }), plus command="add_pool" (recordIteration=true) for any accompanying visuals, audio, or video.`,
    );
  } else if (focusStep.type === 'social-pack') {
    lines.push(
      `- Save platform posts via openmotion_assets_use(action="scenario", scenario={ command: "add_iteration", runId: "${run.id}", expectedRevision: ${run.revision}, stepId: "${focusStep.id}", requestId: "<stable-id>", iteration: { source: "agent", outputs: [{ type: "social", posts }] } }), plus command="add_pool" (recordIteration=true) for any accompanying visuals or video.`,
    );
  } else if (focusStep.type === 'video') {
    lines.push(
      `- For an editable Motion project: openmotion_create_project + openmotion_assets_use(action="import_to_project") + openmotion_assets_use(action="scenario", scenario={ command: "link_motion", runId: "${run.id}", expectedRevision: ${run.revision}, stepId: "${focusStep.id}", requestId: "<stable-id>", projectId: "<id>" }).`,
    );
  }
  lines.push(
    `- Package all deliverables or specific Assets into a ZIP via openmotion_assets_use(action="scenario", scenario={ command: "export", runId: "${run.id}", requestId: "<stable-id>", poolItemIds: [...] }).`,
  );
  return lines;
}

/** Run-bound variant: adds runId, the current brief, pinned pool refs, linked design/motion ids, remaining steps and step write-back commands. */
export function scenarioRunAgentPrompt(
  scenario: ScenarioDefinition,
  run: ScenarioRunSummaryForPrompt,
  options?: { stepId?: string; stepPrompt?: string; locale?: string | null; integration?: ScenarioPromptIntegration | null },
): string {
  const focusStep = options?.stepId ? findScenarioStep(scenario, options.stepId) : undefined;
  const briefEntries = Object.entries(run.brief)
    .map(([key, value]) => {
      const formatted = formatBriefValue(value);
      return formatted ? `- ${key}: ${formatted}` : null;
    })
    .filter((entry): entry is string => entry !== null);

  const poolLines = run.pool.slice(0, 30).map(item =>
    `- [${item.id}] (${item.kind}${item.pinned ? ', pinned' : ''}${item.stepId ? `, step=${item.stepId}` : ''}) "${item.label}" -> ${formatPoolRef(item.ref)}`,
  );

  const linkLines: string[] = [];
  const remainingSteps: string[] = [];
  for (const step of scenario.steps) {
    const st = run.steps[step.id];
    if (st?.links.designProjectId) linkLines.push(`- ${step.id}: designProjectId=${st.links.designProjectId}`);
    if (st?.links.motionProjectId) {
      linkLines.push(`- ${step.id}: motionProjectId=${st.links.motionProjectId}${st.links.motionSessionId ? ` sessionId=${st.links.motionSessionId}` : ''}`);
    }
    if (!st || (st.status !== 'done' && st.status !== 'skipped')) {
      remainingSteps.push(`${step.id} (${st?.status ?? 'todo'})`);
    }
  }

  const lines = [
    scenarioAgentPrompt(scenario, { locale: options?.locale ?? run.locale, integration: options?.integration }),
    '',
    'Current run state:',
    `- runId: ${run.id}`,
    `- title: ${run.title}`,
    `- expectedRevision: ${run.revision}`,
    `- activeStepId: ${run.activeStepId}`,
    focusStep ? `- focusedStep: ${focusStep.id} (${focusStep.title} — ${focusStep.hint})` : null,
    remainingSteps.length ? `- remainingSteps: ${remainingSteps.join(', ')}` : '- remainingSteps: none',
    ...(focusStep ? stepWriteBackLines(run, focusStep, options?.stepPrompt) : []),
    '',
    'Current brief:',
    ...(briefEntries.length ? briefEntries : ['- (no brief values recorded yet)']),
    '',
    'Linked projects:',
    ...(linkLines.length ? linkLines : ['- (none yet)']),
    '',
    'Workflow assets:',
    ...(poolLines.length ? poolLines : ['- (empty)']),
    '',
    `Read the latest state first with openmotion_assets_use action=scenario command=get runId=${run.id}.`,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

/** Deduplicate Skills across a scenario's steps while preserving first-seen order. */
export function scenarioSkills(scenario: ScenarioDefinition): ScenarioSkillRef[] {
  const seen = new Set<string>();
  const skills: ScenarioSkillRef[] = [];
  for (const step of scenario.steps) {
    for (const skill of step.skills ?? []) {
      if (seen.has(skill.id)) continue;
      seen.add(skill.id);
      skills.push(skill);
    }
  }
  return skills;
}

function collectLinkedProjectSummary(scenario: ScenarioDefinition, run?: ScenarioRunSummaryForPrompt | null): string {
  if (!run) return '';
  const linked: string[] = [];
  for (const step of scenario.steps) {
    const links = run.steps[step.id]?.links;
    if (links?.designProjectId) linked.push(`${step.id}:design=${links.designProjectId}`);
    if (links?.motionProjectId) {
      linked.push(`${step.id}:motion=${links.motionProjectId}${links.motionSessionId ? `(session=${links.motionSessionId})` : ''}`);
    }
  }
  return linked.join('; ');
}

function formatConciseAssetsSummary(run?: ScenarioRunSummaryForPrompt | null): string {
  if (!run?.pool.length) return 'none';
  return [...run.pool]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    .slice(0, 20)
    .map(item => `${formatPoolRef(item.ref)} "${item.label}"${item.pinned ? ' (pinned)' : ''}`)
    .join('; ');
}

/** Compact workflow handoff combining high-signal metadata, step Skills pipeline, and executable MCP instructions. */
export function scenarioConcisePrompt(
  scenario: ScenarioDefinition,
  run?: ScenarioRunSummaryForPrompt | null,
  options?: { customPrompt?: string; locale?: string | null; integration?: ScenarioPromptIntegration | null },
): string {
  const customTask = options?.customPrompt?.trim() ?? '';
  const briefIdea = formatBriefValue(run?.brief?.idea);
  const mainTask = (customTask || briefIdea || scenario.description).replace(/\s*\r?\n+\s*/g, ' ').trim();
  const ideaShownAsMain = !customTask && Boolean(briefIdea);

  const effectiveLocale = (options?.locale ?? run?.locale)?.trim() || '';
  const workspace = options?.integration?.dataDirectory?.trim() || '';
  const studioUrl = options?.integration?.previewUrl?.trim() || '';
  const linkedSummary = collectLinkedProjectSummary(scenario, run);

  const paramParts: string[] = [];
  if (run) {
    for (const [key, value] of Object.entries(run.brief)) {
      const formatted = formatBriefValue(value).replace(/\s+/g, ' ');
      if (!formatted) continue;
      if (key === 'idea' && (ideaShownAsMain || formatted === mainTask)) continue;
      paramParts.push(`${key}=${formatted}`);
    }
  }

  const pipelineLines = scenario.steps.map((step, idx) => {
    const refs = (step.skills ?? [])
      .map(skill => (skill.source === 'library' ? `library:${skill.id}` : `resource:${skill.resourceUri ?? skill.id}`))
      .join(', ');
    return `${idx + 1}. ${step.id} (${step.title}) -> ${refs || 'none'}`;
  });

  const firstInstruction = run
    ? `1. Read current state first: openmotion_assets_use(action="scenario", scenario={ command: "get", runId: ${JSON.stringify(run.id)} })`
    : `1. Read current state first: openmotion_assets_use(action="scenario", scenario={ command: "create", scenarioId: ${JSON.stringify(scenario.id)}, requestId: "<stable-id>" })`;

  const lines: (string | null)[] = [
    `Run OpenMotion Workflow: "${scenario.title}" (${scenario.id}).`,
    '',
    '[Metadata]',
    `workflow: ${scenario.id}`,
    run ? `runId: ${run.id}` : 'runId: (create via openmotion_assets_use action=scenario command=create)',
    run ? `expectedRevision: ${run.revision}` : null,
    workspace ? `workspace: ${workspace}` : null,
    studioUrl ? `studioUrl: ${studioUrl}` : null,
    effectiveLocale ? `locale: ${effectiveLocale}` : null,
    linkedSummary ? `linkedProjects: ${linkedSummary}` : null,
    `assets: ${formatConciseAssetsSummary(run)}`,
    '',
    '[Task & Parameters]',
    `task: ${mainTask}`,
    paramParts.length ? `params: ${paramParts.join(' | ')}` : null,
    '',
    '[Skills Pipeline]',
    ...pipelineLines,
    '',
    '[Instructions]',
    firstInstruction,
    '2. Load the workflow\'s Skills before authoring: call openmotion_get_skill(skillId) for every library:* Skill and resources/read for every resource:* guide.',
    `3. Execute steps end to end with OpenMotion MCP tools (${scenarioRecipeTools.join(', ')}).`,
    '4. Write every output back to this run\'s Assets (command="generate" + command="sync", command="add_pool" with recordIteration=true, command="link_design", command="link_motion", command="add_iteration", optional command="export") using current expectedRevision and a stable requestId.',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}
