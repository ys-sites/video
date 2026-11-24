import type { ScenarioId } from '../../../../shared/scenarios';

export type SentenceToken =
  | { type: 'text'; text: string }
  | { type: 'field'; fieldId: string };

/**
 * Conversational fill-in-the-blank prompt sentences (English keys translated in scenario-ui.json).
 * Every `{fieldId}` token renders as an inline interactive blank bound to the matching brief field.
 */
export const BRIEF_SENTENCE_TEMPLATES: Record<ScenarioId, string> = {
  'black-friday':
    'Launch a Black Friday campaign for {productName} priced at {salePrice} (was {originalPrice}, {discountPercent}) with code {promoCode} during {saleWindow}. Focus on {idea} for {audience}, with CTA {cta}.',
  'design-full-chain':
    'Launch {productName} for {audience}: {idea}. Style it in {visualStyle} and guide visitors to {cta}.',
  'motion-full-chain':
    'Create a {durationSeconds} {aspect} motion film about {concept} for {audience} in a {visualStyle} look — {idea}.',
  'gemini-4-neon':
    'Code a {durationSeconds} {codeStyle} animation about {concept} for {audience} — {idea}.',
  'ai-influencer':
    'As {personaName} in {niche}, create a {voiceStyle} episode on {topic} for {audience} — {idea}.',
};

export function parseSentenceTemplate(template: string): SentenceToken[] {
  const tokens: SentenceToken[] = [];
  const pattern = /\{([a-zA-Z0-9_]+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: template.slice(lastIndex, match.index) });
    }
    tokens.push({ type: 'field', fieldId: match[1] });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < template.length) {
    tokens.push({ type: 'text', text: template.slice(lastIndex) });
  }
  return tokens;
}

export type BriefPreset = {
  id: string;
  label: string;
  values: Record<string, string | string[]>;
};

type LocalizedPreset = {
  id: string;
  en: { label: string; values: Record<string, string | string[]> };
  zh: { label: string; values: Record<string, string | string[]> };
};

const PRESETS_BY_SCENARIO: Record<ScenarioId, readonly LocalizedPreset[]> = {
  'black-friday': [
    {
      id: 'bf-tote',
      en: {
        label: 'Weekender Tote · $79',
        values: {
          productName: 'Holiday Weekender Tote',
          brandName: 'Northline Studio',
          originalPrice: '$129',
          salePrice: '$79',
          discountPercent: '39% OFF',
          promoCode: 'BF40',
          saleWindow: 'Nov 27 – Dec 1',
          audience: 'holiday travelers & gift shoppers',
          idea: 'full-grain leather texture, carry-on capacity, and limited gift packaging',
          productDescription: 'Full-grain Italian leather tote with padded 16-inch laptop sleeve, brass hardware, and complimentary monogram gift box.',
          cta: 'Shop the Black Friday offer',
          tone: 'bold',
          language: 'en',
        },
      },
      zh: {
        label: '假日托特包 · ¥599',
        values: {
          productName: '假日皮质周末托特包',
          brandName: 'Northline Studio',
          originalPrice: '¥999',
          salePrice: '¥599',
          discountPercent: '立减 40%',
          promoCode: 'BF40',
          saleWindow: '11 月 27 日 – 12 月 1 日',
          audience: '年末出行与送礼人群',
          idea: '头层牛皮质感、16 寸登机大容量与限量礼盒包装',
          productDescription: '采用头层小牛皮与黄铜五金，内置 16 寸电脑隔层，黑五下单赠送定制礼盒。',
          cta: '立即抢购黑五特惠',
          tone: 'bold',
          language: 'zh-CN',
        },
      },
    },
    {
      id: 'bf-keyboard',
      en: {
        label: 'Magnetic Keyboard · $99',
        values: {
          productName: 'KeyPulse Pro Magnetic Keyboard',
          brandName: 'PulseLab',
          originalPrice: '$199',
          salePrice: '$99',
          discountPercent: '50% OFF',
          promoCode: 'BF50',
          saleWindow: 'Nov 27 – Dec 1',
          audience: 'gamers & desk-setup builders',
          idea: 'CNC aluminum frame, 0.1mm rapid-trigger switches, and hot-swap RGB',
          productDescription: 'CNC anodized aluminum 75% keyboard with magnetic Hall-effect switches, rapid trigger, and acoustic gasket mount.',
          cta: 'Claim 50% off now',
          tone: 'bold',
          language: 'en',
        },
      },
      zh: {
        label: '磁轴机械键盘 · ¥699',
        values: {
          productName: 'KeyPulse Pro 磁轴键盘',
          brandName: 'PulseLab',
          originalPrice: '¥1399',
          salePrice: '¥699',
          discountPercent: '限时 5 折',
          promoCode: 'BF50',
          saleWindow: '11 月 27 日 – 12 月 1 日',
          audience: '电竞玩家与桌搭爱好者',
          idea: 'CNC 铝坨坨机身、0.1mm 快速触发磁轴与定制消音结构',
          productDescription: '75% 配列 CNC 阳极氧化铝机身，霍尔磁轴支持快速触发与全键热插拔。',
          cta: '抢 5 折限量席位',
          tone: 'bold',
          language: 'zh-CN',
        },
      },
    },
  ],
  'design-full-chain': [
    {
      id: 'design-lamp',
      en: {
        label: 'Smart Desk Lamp',
        values: {
          productName: 'AeroDesk Optical Lamp',
          brandName: 'LumaForm',
          audience: 'designers & late-night creators',
          idea: 'precision anodized aluminum desk lamp with glare-free asymmetric beam and auto daylight tuning',
          valueProps: [
            'Zero screen glare asymmetric optics',
            'CRI 98+ true-color daylight spectrum',
            'Wireless rotary dimmer puck',
          ],
          visualStyle: 'warm studio daylight, crisp editorial grid, tactile aluminum close-ups',
          cta: 'Pre-order early bird',
          pageUrl: 'https://example.com/aerodesk',
          tone: 'premium',
          language: 'en',
        },
      },
      zh: {
        label: '智能护眼桌面台灯',
        values: {
          productName: 'AeroDesk 光学桌面台灯',
          brandName: 'LumaForm',
          audience: '设计师与深夜创作者',
          idea: '阳极氧化铝一体化机身，非对称防眩光光束与全天候自然光色温自适应',
          valueProps: [
            '非对称光学结构，屏幕零反光',
            'Ra98+ 全光谱高显色还原真实色彩',
            '无线旋钮控制器，一旋即调光',
          ],
          visualStyle: '柔和自然光棚拍、极简杂志网格、金属细节特写',
          cta: '预约早鸟优惠',
          pageUrl: 'https://example.com/aerodesk',
          tone: 'premium',
          language: 'zh-CN',
        },
      },
    },
    {
      id: 'design-saas',
      en: {
        label: 'AI Analytics SaaS',
        values: {
          productName: 'MetricFlow Studio',
          brandName: 'MetricFlow',
          audience: 'growth & product teams',
          idea: 'turn messy product events into live funnel boards and weekly launch decks in minutes',
          valueProps: [
            'One-line SDK with instant funnel tracking',
            'Plain-English anomaly summaries',
            'One-click shareable stakeholder snapshots',
          ],
          visualStyle: 'high-contrast Swiss editorial layout, crisp product UI cards',
          cta: 'Start free trial',
          pageUrl: 'https://example.com/metricflow',
          tone: 'informative',
          language: 'en',
        },
      },
      zh: {
        label: 'AI 数据增长看板',
        values: {
          productName: 'MetricFlow 增长看板',
          brandName: 'MetricFlow',
          audience: '产品与增长团队',
          idea: '把零散埋点一键变成实时转化漏斗与每周复盘报告',
          valueProps: [
            '一行代码接入，实时追踪核心漏斗',
            '自动定位异常波动与转化断点',
            '一键导出可分享的周报视图',
          ],
          visualStyle: '高对比瑞士平面排版、清晰的产品界面卡片',
          cta: '免费开始试用',
          pageUrl: 'https://example.com/metricflow',
          tone: 'informative',
          language: 'zh-CN',
        },
      },
    },
  ],
  'motion-full-chain': [
    {
      id: 'motion-launch',
      en: {
        label: 'Product Launch Film · 30s',
        values: {
          concept: 'Flagship Wireless Earbuds Launch Reveal',
          durationSeconds: '30',
          aspect: '16:9',
          audience: 'design-conscious audio fans',
          visualStyle: 'kinetic Swiss typography, crisp studio rims, rhythmic beat cuts',
          idea: 'open with bold beat-synced headline cards, cut into sculpted hardware close-ups, and close on the launch date',
          brandName: 'Kora Audio',
          tone: 'bold',
          language: 'en',
        },
      },
      zh: {
        label: '新品发布动效片 · 30 秒',
        values: {
          concept: '旗舰无线降噪耳机发布片',
          durationSeconds: '30',
          aspect: '16:9',
          audience: '数码与影音发烧友',
          visualStyle: '强节奏动态排版、干净棚拍轮廓光、卡点转场',
          idea: '开场用大字卡点引出核心卖点，中段切入产品悬浮特写与声波图形，结尾定格发布时间',
          brandName: 'Kora Audio',
          tone: 'bold',
          language: 'zh-CN',
        },
      },
    },
    {
      id: 'motion-reel',
      en: {
        label: 'Vertical Brand Teaser · 15s',
        values: {
          concept: 'Autumn Capsule Drop Countdown',
          durationSeconds: '15',
          aspect: '9:16',
          audience: 'short-form social viewers',
          visualStyle: 'editorial minimalism, masked photo reveals, crisp motion blur',
          idea: 'fast 15-second vertical teaser cycling 3 signature silhouettes with animated price badges',
          brandName: 'Studio Velo',
          tone: 'premium',
          language: 'en',
        },
      },
      zh: {
        label: '竖屏品牌预告 · 15 秒',
        values: {
          concept: '秋季限定系列上新倒计时',
          durationSeconds: '15',
          aspect: '9:16',
          audience: '短视频与小红书受众',
          visualStyle: '极简杂志风、遮罩快切与流畅运动模糊',
          idea: '15 秒高能竖屏预告，依次展示 3 套核心单品与动态上新日期',
          brandName: 'Studio Velo',
          tone: 'premium',
          language: 'zh-CN',
        },
      },
    },
  ],
  'gemini-4-neon': [
    {
      id: 'gemini-ribbon',
      en: {
        label: 'Neon Particle Ribbon',
        values: {
          concept: 'Reactive neon particle ribbon morphing into a launch headline',
          codeStyle: 'art-animation',
          durationSeconds: '30',
          audience: 'creative technologists & developers',
          idea: 'thousands of glowing particles sweep along Bézier currents, react to cursor velocity, and lock into bold vector typography',
          tone: 'bold',
          language: 'en',
        },
      },
      zh: {
        label: '霓虹粒子流光文字',
        values: {
          concept: '响应交互的霓虹粒子丝带汇聚成发布标题',
          codeStyle: 'art-animation',
          durationSeconds: '30',
          audience: '创意开发者与视觉设计师',
          idea: '数千枚发光粒子沿贝塞尔流场流动，随鼠标轨迹扰动并最终定格成高对比矢量大字',
          tone: 'bold',
          language: 'zh-CN',
        },
      },
    },
    {
      id: 'gemini-3d',
      en: {
        label: '3D Orbital Data Story',
        values: {
          concept: 'Interactive 3D orbital benchmark visualizer',
          codeStyle: '3d-scene',
          durationSeconds: '30',
          audience: 'AI builders & launch viewers',
          idea: 'sleek glassmorphic orbital rings showing real-time speed and quality gains with smooth camera sweeps',
          tone: 'informative',
          language: 'en',
        },
      },
      zh: {
        label: '3D 轨道数据可视化',
        values: {
          concept: '交互式 3D 轨道性能演进可视化',
          codeStyle: '3d-scene',
          durationSeconds: '30',
          audience: 'AI 开发者与科技媒体读者',
          idea: '多层次发光轨道环呈现速度与画质跃迁，配合平滑镜头环绕推进',
          tone: 'informative',
          language: 'zh-CN',
        },
      },
    },
  ],
  'ai-influencer': [
    {
      id: 'inf-habits',
      en: {
        label: '3 AI Workflow Habits',
        values: {
          personaName: 'Mina Park',
          niche: 'AI tools & solo-creator systems',
          voiceStyle: 'warm, punchy conversational',
          topic: '3 AI workflow habits that save 5 hours every week',
          audience: 'indie creators & product builders',
          idea: 'share 3 concrete before/after clips showing how one brief produces visuals, a landing page, and social posts',
          platformFocus: ['x', 'tiktok', 'instagram'],
          scriptOutline: 'Hook: Stop rebuilding assets 5 times.\n1. Start from shared assets.\n2. Embed visuals straight into your launch page.\n3. Export video + channel copy in one pass.\nCTA: Comment WORKFLOW for the template.',
          tone: 'friendly',
          language: 'en',
        },
      },
      zh: {
        label: '3 个提效 AI 工作流习惯',
        values: {
          personaName: '林小安 Mina',
          niche: 'AI 效率工具与独立创作者实战',
          voiceStyle: '亲切自然、节奏利落的口播',
          topic: '每周省下 5 小时的 3 个 AI 工作流习惯',
          audience: '自媒体博主与独立开发者',
          idea: '用真实前后对比展示如何靠共享素材一次出齐配图、落地页、口播视频和多平台文案',
          platformFocus: ['xiaohongshu', 'douyin', 'tiktok'],
          scriptOutline: '开头钩子：别再把同一套素材重复做 5 遍了！\n1. 先准备好共享素材，图和音频全流程复用。\n2. 生成的图片直接嵌入落地页。\n3. 一次导出视频与各平台帖文。\n结尾互动：评论区扣「工作流」领取同款模板。',
          tone: 'friendly',
          language: 'zh-CN',
        },
      },
    },
    {
      id: 'inf-review',
      en: {
        label: '60s New Tool Breakdown',
        values: {
          personaName: 'Leo Vance',
          niche: 'creative tech teardowns',
          voiceStyle: 'crisp, high-energy studio host',
          topic: 'Can one workflow replace 4 separate creator apps?',
          audience: 'designers & video editors',
          idea: 'live 60-second challenge taking a raw idea all the way to an exported campaign zip',
          platformFocus: ['x', 'instagram', 'tiktok'],
          scriptOutline: 'Hook: 60 seconds, 1 idea, 1 complete launch kit.\nDemo: Brief -> visuals -> embedded web page -> video -> ZIP export.\nTakeaway: Shared assets kill copy-paste busywork.',
          tone: 'bold',
          language: 'en',
        },
      },
      zh: {
        label: '60 秒新工具实测拆解',
        values: {
          personaName: '阿哲 Leo',
          niche: '创意科技与效率测评',
          voiceStyle: '干脆利落、信息密度高的评测口播',
          topic: '一套工作流能替代 4 个创作软件吗？60 秒实测',
          audience: '设计师与短视频创作者',
          idea: '从一句话创意开始，现场跑通配图、嵌图网页、宣传视频到一键打包导出',
          platformFocus: ['douyin', 'xiaohongshu', 'x'],
          scriptOutline: '开头：60 秒挑战，只靠一个页面做完一整套宣发物料。\n演示：填空需求 → 出图 → 嵌进网页 → 宣传片 → 一键打包 ZIP。\n总结：共享素材彻底告别来回导出导入。',
          tone: 'bold',
          language: 'zh-CN',
        },
      },
    },
  ],
};

export function briefPresetsFor(scenarioId: ScenarioId, locale: string): readonly BriefPreset[] {
  const isZh = locale.toLowerCase().startsWith('zh');
  return PRESETS_BY_SCENARIO[scenarioId].map(entry => ({
    id: entry.id,
    ...(isZh ? entry.zh : entry.en),
  }));
}
