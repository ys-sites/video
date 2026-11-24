import { guideUrl, setupGuideUrl, type IntegrationInfo } from './integration.ts';
import { projectAgentContext } from './project-agent-prompt.ts';

/** Editorial starting points, not platform upload limits or encoder presets. */
export const platformExportTargets = [
  { id: 'douyin', label: 'Douyin', aspect: '9:16', width: 1080, height: 1920 },
  { id: 'xiaohongshu', label: 'Xiaohongshu', aspect: '9:16', width: 1080, height: 1920 },
  { id: 'wechat', label: 'WeChat Channels', aspect: '9:16', width: 1080, height: 1920 },
  { id: 'bilibili', label: 'Bilibili', aspect: '16:9', width: 1920, height: 1080 },
  { id: 'tiktok', label: 'TikTok', aspect: '9:16', width: 1080, height: 1920 },
  { id: 'reels', label: 'Instagram Reels', aspect: '9:16', width: 1080, height: 1920 },
  { id: 'shorts', label: 'YouTube Shorts', aspect: '9:16', width: 1080, height: 1920 },
] as const;
export const platformExportGoals = [
  { id: 'shorten', label: 'Make a short version', description: 'Keep the main idea in one concise video.' },
  { id: 'highlights', label: 'Extract highlights', description: 'Choose moments that each tell a complete story.' },
  { id: 'adapt', label: 'Adapt the full video', description: 'Keep the full story and adapt its framing and layout.' },
] as const;
export type PlatformExportTarget = typeof platformExportTargets[number]['id'];
export type PlatformExportGoal = typeof platformExportGoals[number]['id'];
export const defaultPlatformExportTarget = (locale: string): PlatformExportTarget => locale === 'zh-CN' ? 'douyin' : 'shorts';

export const platformExportCanvases = [
  { id: '9:16', width: 1080, height: 1920, label: 'Vertical' },
  { id: '16:9', width: 1920, height: 1080, label: 'Landscape' },
  { id: '1:1', width: 1080, height: 1080, label: 'Square' },
  { id: '4:5', width: 1080, height: 1350, label: 'Portrait' },
] as const;
export const platformExportDurations = ['15–30', '30–60', '60–90'] as const;
export const platformExportCaptions = [
  { id: 'preserve', label: 'Keep existing captions' },
  { id: 'add', label: 'Add editable captions' },
  { id: 'none', label: 'No captions' },
] as const;
export type PlatformExportOptions = {
  canvas?: 'platform' | typeof platformExportCanvases[number]['id'];
  duration?: typeof platformExportDurations[number];
  clipCount?: 1 | 2 | 3;
  captions?: typeof platformExportCaptions[number]['id'];
};
export function platformExportSettings(target: PlatformExportTarget, options: PlatformExportOptions = {}) {
  const platform = platformExportTargets.find(item => item.id === target);
  const canvas = platformExportCanvases.find(item => item.id === (!options.canvas || options.canvas === 'platform' ? platform?.aspect : options.canvas));
  const duration = options.duration ?? '30–60', clipCount = options.clipCount ?? 3, captions = options.captions ?? 'preserve';
  if (!platform || !canvas || !platformExportDurations.includes(duration) || ![1, 2, 3].includes(clipCount) || !platformExportCaptions.some(item => item.id === captions)) throw new Error(`Unknown platform export settings: ${JSON.stringify({ canvas: options.canvas, duration, clipCount, captions })}`);
  return { canvas, duration, clipCount, captions };
}

export function platformExportPrompt({ target, goal, locale = 'en', notes = '', languages = '', context, workspace, options }: {
  target: PlatformExportTarget;
  goal: PlatformExportGoal;
  locale?: string;
  notes?: string;
  languages?: string;
  options?: PlatformExportOptions;
  context?: { info: Pick<IntegrationInfo, 'previewUrl' | 'dataDirectory'>; project: { id: string; title: string } };
  workspace?: Pick<IntegrationInfo, 'previewUrl' | 'dataDirectory'>;
}): string {
  const platform = platformExportTargets.find(item => item.id === target);
  if (!platform || !platformExportGoals.some(item => item.id === goal)) throw new Error('Unknown platform export scenario');
  const { canvas, duration, clipCount, captions } = platformExportSettings(target, options);
  const zh = locale === 'zh-CN';
  const selection = zh ? '先用 openmotion_get_project 列出工程，让我指定源工程；不要猜测或修改其他工程。'
    : 'First list projects with openmotion_get_project and ask me to identify the source project; do not guess or modify another project.';
  const connection = workspace ? (zh ? `工作区：${workspace.dataDirectory}\nStudio 地址：${workspace.previewUrl}\n接入指引：${guideUrl(workspace, 'mcp')}`
    : `Workspace: ${workspace.dataDirectory}\nStudio URL: ${workspace.previewUrl}\nConnection guide: ${guideUrl(workspace, 'mcp')}`)
    : `${zh ? '接入指引' : 'Connection guide'}: ${setupGuideUrl(null)}`;
  const identity = context ? projectAgentContext(context.info, context.project, locale) : `${connection}\n\n${selection}`;
  const intentions = zh ? {
    shorten: `将长视频精简为一条内容完整的 ${duration} 秒短片，保留核心观点和必要上下文。`,
    highlights: `从长视频中选择最多 ${clipCount} 段可独立理解的精彩内容，每条以 ${duration} 秒为目标，并分别交付。宁可少选，也不要凑数。`,
    adapt: '保留完整内容、顺序和原有时长，只适配画幅、构图、文字与字幕布局。',
  } : {
    shorten: `Condense the long video into one self-contained ${duration} second short, preserving its main point and necessary context.`,
    highlights: `Select up to ${['zero', 'one', 'two', 'three'][clipCount]} standalone highlights, targeting ${duration} seconds each, and deliver them separately. Prefer fewer strong clips to filling a quota.`,
    adapt: 'Preserve the complete content, sequence and original duration; adapt only the aspect ratio, framing, text and subtitle layout.',
  };
  const brief = zh ? `请通过 OpenMotion MCP 为 ${platform.label} 制作平台版本。
创作目标：${intentions[goal]}
建议画幅：${canvas.id}，${canvas.width}×${canvas.height}。这是创作目标，不是平台上传限制或编码预设。原片较短时不要为了凑时长补内容。`
    : `Use OpenMotion MCP to prepare a version for ${platform.label}.
Creative goal: ${intentions[goal]}
Suggested canvas: ${canvas.id}, ${canvas.width}×${canvas.height}. These are creative targets, not platform upload limits or encoding presets. Do not pad a shorter source to meet the duration target.
Respond in the user's language (${locale}).`;
  const captionBrief = zh ? {
    preserve: '字幕：保留现有字幕并适配布局，不自动添加新字幕。',
    add: '字幕：根据真实转录、脚本或已确认字幕添加可编辑字幕。缺少内容时先索取，不编造。',
    none: '字幕：在副本中移除可编辑字幕，保留原始声音与其他文字。若字幕已烧录进素材，说明无法无损移除，不承诺去除。',
  } : {
    preserve: 'Captions: preserve existing captions and adapt their layout; do not add new captions automatically.',
    add: 'Captions: add editable captions from a real transcript, script or confirmed captions. Ask for missing content; never invent it.',
    none: 'Captions: remove editable caption layers in the copy, keeping original audio and other text. Disclose burned-in captions that cannot be removed losslessly; do not promise their removal.',
  };
  const steps = zh ? `1. 连接上面指定的工作区，读取 openmotion_get_project 的最新内容、revision 和 currentVersionId。根据叙事改编任务读取 openmotion-director 及相关共享工程指引。
2. 根据真实素材、字幕、脚本或已确认时间码制定剪辑计划。通过 openmotion_assets_use(action=transcript) 的 sources/list/get 获取现有文稿；缺失时 models/submit/status 使用已配置的转写模型，保留稳定 requestId，不重试计费任务。使用宿主已有的画面分析工具；若不可用，说明缺少什么并索取字幕或时间码，不编造台词、选段或人脸追踪结果。
3. 用 openmotion_manage_project(action=duplicate) 和 expectedRevision 创建独立适配工程，每条成片一份；保留源工程不变。为本次操作使用稳定 requestId，重试复用已有副本，不重复创建。
4. 对副本读取最新 revision 和 currentVersionId，再用 openmotion_edit_project 携带每次编辑稳定的 requestId、expectedRevision、expectedVersionId 修改原生工程。保持品牌、事实和声音含义，重排布局，避免拉伸主体或裁掉文字；将保留或新增的字幕保持为可编辑内容。冲突后重读并核对变化，不盲目覆盖。
5. 用 openmotion_open_preview 打开副本检查画面、字幕和声音，保留可编辑工程。预览初始化可能更新版本，导出前再次读取最新身份。
6. 用 openmotion_export_request 提交该副本的 projectId、versionId、expectedRevision 和稳定 requestId。按素材决定 audio 为 required 或 silent，跟踪同一任务，用 openmotion_get_project(projectId, exportJobId) 等待完成及技术验证通过；失败时说明原因，不把旧文件作为本次结果。
7. 实际播放最终 MP4，检查声音、定位与重播；如无法播放，明确未验证的环节。交付每条视频的文件和对应工程。仅记录真实执行的审阅，不自动上传或发布平台。`
    : `1. Connect to the identified workspace and read the latest content, revision and currentVersionId with openmotion_get_project. Read openmotion-director and the applicable shared native editing guidance for this editorial adaptation.
2. Plan from real media, captions, scripts or confirmed timecodes. Discover existing speech with openmotion_assets_use(action=transcript), commands sources/list/get. For missing transcripts use models/submit/status with the configured transcription model and stable requestId; never resubmit paid jobs on timeout. Use host visual-analysis tools for pictures. If unavailable, explain the missing input and ask for captions or timecodes; never invent speech, selections or face-tracking results.
3. Use openmotion_manage_project(action=duplicate) with expectedRevision to create an independent adaptation, one project per output, leaving the source unchanged. Use stable requestIds and reuse the same copies on retries.
4. Read each copy's latest revision and currentVersionId, then edit its native files with openmotion_edit_project using a stable requestId for each edit, expectedRevision and expectedVersionId. Preserve the brand, facts and audio meaning; recompose layouts without stretching subjects or clipping text, and keep retained or added captions editable. Reread and reconcile conflicts rather than overwriting blindly.
5. Open each copy with openmotion_open_preview to inspect picture, captions and sound, keeping the editable project. Preview initialization can update its version; read the latest identity again before export.
6. Call openmotion_export_request with the copy's projectId, versionId, expectedRevision and a stable requestId. Set audio to required or silent according to the source. Track the same job with openmotion_get_project(projectId, exportJobId) until completed and technical verification passes. Report failures; never substitute an old file.
7. Play the actual final MP4, check sound, seeking and replay; disclose any playback checks you cannot perform. Deliver each video file and its project. Record only reviews actually performed. Do not upload or publish to platforms automatically.`;
  const subtitles = languages.trim() ? (zh ? `\n\n字幕语言：${languages.trim()}。通过 action=transcript 的 get/export 读取校对后的真实文稿；保留 source-relative start/end 和 speaker，仅翻译文本并移除旧 word alignment。为每种语言创建独立副本，以 import 保存带 language 的文稿，再通过 captions 或原生剪辑写入映射后的可编辑字幕，携带 expectedTranscriptRevision 和工程版本保护。保留原声；字幕翻译不等于配音。使用 action=transcript command=caption_export（projectId、compositionPath、format=srt 或 vtt）导出最终时间轴字幕，交付字幕文件与每个语言版本。` : `\n\nSubtitle languages: ${languages.trim()}. Read reviewed speech using action=transcript get/export. Preserve source-relative start/end and speaker, translate only the text and remove obsolete word alignment. Make an independent copy per language, import its language-labelled transcript, then apply mapped editable captions using captions or native editing with expectedTranscriptRevision and project version guards. Retain the original voice; subtitle translation is not dubbing. Use action=transcript command=caption_export (projectId, compositionPath, format=srt or vtt) for final timeline subtitles. Deliver subtitle files and each language version.`) : '';
  return `${identity}\n\n${brief}\n${captionBrief[captions]}${subtitles}\n\n${steps}${notes.trim() ? `\n\n${zh ? '我的补充要求' : 'My additional requirements'}:\n${notes.trim()}` : ''}`;
}
