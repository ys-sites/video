import type { GalleryTemplate } from '../../../shared/catalog';

/** Editorial observations tied to catalogue works, not claims about brand strategy or outcomes. */
type WorkLesson = { takeaway: string; steps: [string, string, string]; adapt: string };
const lessons: Record<string, WorkLesson> = {
  'motion-dfb1a35a-a70e-489f-8e02-b74068fc0b8c': { takeaway: '先让结果吸引人，再解释怎么做到', steps: ['先展示完成作品', '操作控制点与参数', '用前后变化证明功能'], adapt: '换成你的最佳产出、一段关键操作、一个清楚的前后对比。先让用户看到能得到什么。' },
  'motion-d214ebc1-b1cd-4615-8d40-d580632e8f29': { takeaway: '一次只演示一个可见的变化', steps: ['选中要修改的区域', '展示一个编辑动作', '呈现变化后的结果'], adapt: '选一个最常用的任务，用自己的界面串起「选中 → 操作 → 结果」，让每一步都能被看懂。' },
  'motion-f4b325fd-64ba-42da-9f7e-6a6b77cfafd2': { takeaway: '让一个关键数字占据画面', steps: ['用大字突出核心数字', '以色块与裁切建立节奏', '保留固定的信息落点'], adapt: '挑出最想被记住的一个指标，补齐统计周期与口径；替换数字、品牌和色块，保持信息的主次。' },
  'motion-92cf4fa2-b65b-4ca2-a6ac-40d4bed47bdd': { takeaway: '先建立识别，再用作品邀请参与', steps: ['图形与字形建立识别', '快速展示参与作品', '落到活动上线信息'], adapt: '准备活动主视觉、三到五个代表作品和一个行动入口，沿着「认出你 → 看见成果 → 加入」组织。' },
  'motion-d9465c0d-9d09-43d3-a1e7-c5617022db9d': { takeaway: '把等待也变成品牌记忆', steps: ['字形碎片制造悬念', '聚合成活动标题', '进度线收住期待'], adapt: '用你的活动名称构造聚散过程，把时间、地点或下一步放在最后的清晰停留中。' },
  'motion-f878182e-c863-45eb-ac54-2e472890987b': { takeaway: '让参与者成为活动的主角', steps: ['双品牌建立活动身份', '人物气泡从四周加入', '集体回应引出预告'], adapt: '用真实参与者或用户内容替换周边气泡，保留中间的活动信息，让观众知道自己为何参与。' },
  'motion-80640920-4ab0-4ac0-b66e-3b64726e7960': { takeaway: '用同一件作品，讲清连续能力', steps: ['对当前作品提出建议', '应用样式与内容变化', '展示连续迭代的结果'], adapt: '围绕同一个用户任务，录下两到三步连续操作；保持同一作品，观众才容易理解变化从何而来。' },
  'motion-c9623fa3-6ecd-4045-9c6e-7ad574562563': { takeaway: '把抽象能力放回真实画布', steps: ['把生成界面放入画布', '并置比较设计变体', '更新同一个代码层'], adapt: '用自己的真实产物展示不同方案，保留同一对象的更新关系，避免只有功能名称却没有证明。' },
  'motion-c2ff6df1-76b3-4045-878b-bc91f1962464': { takeaway: '用后续操作证明可编辑', steps: ['生成一份矢量素材', '选中并修改颜色', '编排素材的动画'], adapt: '如果卖点是可编辑，就别停在生成结果。补一段改色或调整结构的操作，让用户看见可控性。' },
  'motion-b35abe81-509c-424a-9acf-347a8831b857': { takeaway: '从生态全景，落到一个核心连接', steps: ['先给出工具往返的主张', '巡览合作方图标', '聚焦核心工具'], adapt: '先选一个最有价值的连接场景，再展示兼容范围；让用户知道这些连接能帮自己完成什么。' },
  'motion-e6ac921a-f56f-4170-a2be-938cec5d028b': { takeaway: '把看不见的时间，变成可见的变化', steps: ['呈现运动中的对象', '露出对应时间线', '让播放头与预览同步'], adapt: '演示时间或状态相关的功能时，把操作依据与结果放在同一画面，让观众能对上每一步。' },
  'motion-6b58e785-aace-4d84-9229-7d68d6ed247b': { takeaway: '前景讲产品，背景建立声量', steps: ['用巨字建立画面底层', '将功能窗口放在前景', '保持主次清晰'], adapt: '用一个核心进展作标题，配自己的真实产品画面；检查背景是否抢走了界面信息的注意力。' },
  'motion-4d2c0503-a324-49e7-924d-0eae443f54d7': { takeaway: '用连接关系，解释工作流', steps: ['把设计帧变成节点', '连接文本和图像输入', '展示输出的多个去向'], adapt: '准备一份输入、一个处理步骤和最终产物，用连线说明因果，避免把工作流讲成图标列表。' },
  'motion-ccb4e364-1666-4672-80d4-cb68fb591bad': { takeaway: '让交接的前后保持对应', steps: ['选择带批注的设计帧', '传递选中的上下文', '展示对应实现结果'], adapt: '用同一屏设计和实现做对照，保留关键批注，让用户看懂信息如何传递到下一步。' },
  'motion-e558c471-28db-4353-a1c8-9ce5089838b1': { takeaway: '从杂乱信息，走向可执行结论', steps: ['聚合业务与设计证据', '用评论推动结构调整', '收束成交接规格'], adapt: '用你的真实资料展示一次整理过程，结尾给一个明确可执行的产物，让变化有落点。' },
  'motion-a09000a0-dc1b-47a8-a807-1ede9667e144': { takeaway: '把接入，讲成一次完整任务', steps: ['读取外部反馈', '将反馈变成设计修改', '输出记录修改原因的文档'], adapt: '选一条真实反馈，让它经历读取、处理与输出；用闭环展示接入价值，而不只展示连接成功。' },
};
export function brandWorkLesson(item: GalleryTemplate): WorkLesson | undefined { return lessons[item.id]; }

export type StoryChapter = { start: number; end: number; label: string };
export type BrandStoryNotes = { summary: string; adaptation: string; chapters: StoryChapter[] };
const plainText = (value: string) => value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').replace(/^\s*[-+]\s+/gm, '').replace(/\s+/g, ' ').trim();

/** Read authored notes as data only. Source timings remain approximate review cues. */
export function readBrandStoryNotes(source: string, duration?: number): BrandStoryNotes {
  const prose = source.replace(/```[^\n]*\n[\s\S]*?```/g, '');
  const summary = plainText(prose.replace(/^#[^\n]*\n/, '').split(/^##\s/m)[0]).slice(0, 320);
  const sections = [...prose.matchAll(/^##\s+([^\n]+)\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/gm)];
  const adaptation = plainText(sections.find(([, title]) => /^(换成|换一|内容替换|如何改编)/.test(title.trim()))?.[2] ?? '').slice(0, 320);
  let chapters: StoryChapter[] = [];
  const board = source.match(/```motion-board\s*\n([\s\S]*?)```/);
  try {
    const value: unknown = board && JSON.parse(board[1]);
    const stages = value && typeof value === 'object' && 'stages' in value ? value.stages : undefined;
    if (Array.isArray(stages)) {
      chapters = stages.flatMap(stage => {
        if (!stage || typeof stage !== 'object' || typeof stage.start !== 'number' || !Number.isFinite(stage.start) || stage.start < 0
          || typeof stage.end !== 'number' || !Number.isFinite(stage.end) || stage.end <= stage.start
          || typeof stage.label !== 'string' || !stage.label.trim() || (duration != null && stage.start >= duration)) return [];
        return [{ start: stage.start, end: duration == null ? stage.end : Math.min(stage.end, duration), label: stage.label.trim().slice(0, 100) }];
      }).sort((a, b) => a.start - b.start).filter((stage, index, all) => index === 0 || stage.start !== all[index - 1].start);
    }
  } catch { /* Incomplete or unsupported notes never create fictional timing cues. */ }
  return { summary, adaptation, chapters };
}

/** A compact overview samples the opening, middle and closing authored chapters. */
export function storyChapterHighlights(chapters: StoryChapter[]) {
  return [...new Set([0, Math.floor((chapters.length - 1) / 2), chapters.length - 1])]
    .filter(index => index >= 0 && index < chapters.length).map(index => chapters[index]);
}

export const figmaLearningPaths = [
  { label: '功能要有视觉证明', ids: ['motion-dfb1a35a-a70e-489f-8e02-b74068fc0b8c','motion-d214ebc1-b1cd-4615-8d40-d580632e8f29'], description: 'Draw 与 AI Image Editing 都把操作和可见结果连起来。可借鉴：一个卖点，配一段变化。' },
  { label: '同一任务串起多步能力', ids: ['motion-80640920-4ab0-4ac0-b66e-3b64726e7960','motion-c2ff6df1-76b3-4045-878b-bc91f1962464'], description: '画布 Agent 与 Agent Vectors 延续同一个产物。可借鉴：别把每个功能剪成彼此无关的片段。' },
  { label: '活动既有识别，也有参与感', ids: ['motion-92cf4fa2-b65b-4ca2-a6ac-40d4bed47bdd','motion-f878182e-c863-45eb-ac54-2e472890987b'], description: 'Config Makeathon 与 Make-a-thon 从活动识别走向作品或参与者。可借鉴：主视觉之后，用真实内容接住注意力。' },
];
