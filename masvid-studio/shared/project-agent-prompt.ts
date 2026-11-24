import { guideUrl, type IntegrationInfo } from './integration.ts';

/** A continuation brief identifies saved work; it never carries provider credentials. */
export function projectAgentContext(info: Pick<IntegrationInfo, 'previewUrl' | 'dataDirectory'>, project: { id: string; title: string }, locale = 'en') {
  const origin = new URL(info.previewUrl).origin;
  const projectUrl = `${origin}/#project/${encodeURIComponent(project.id)}`;
  const connectionGuide = guideUrl({ previewUrl: origin }, 'mcp');
  if (locale === 'zh-CN') return `项目：${project.title}
项目 ID：${project.id}
工作区：${info.dataDirectory}
项目地址：${projectUrl}
接入指引：${connectionGuide}`;
  return `Project: ${project.title}
Project ID: ${project.id}
Workspace: ${info.dataDirectory}
Project URL: ${projectUrl}
Connection guide: ${connectionGuide}`;
}

export function projectAgentPrompt(info: Pick<IntegrationInfo, 'previewUrl' | 'dataDirectory'>, project: { id: string; title: string }, locale = 'en') {
  return projectAgentContext(info, project, locale) + (locale === 'zh-CN'
    ? '\n\n请继续编辑这个 OpenMotion 项目。先读取最新内容，再根据我的要求修改，保留已有内容和编辑历史。如果我还没有说明修改要求，先问我想改什么。完成后打开项目预览，方便我查看和继续调整。'
    : '\n\nPlease continue editing this OpenMotion project. Read the latest content first, then make the changes I request, preserving existing content and edit history. If I have not specified any changes, ask me what I would like to change. When finished, open the project preview so I can review it and continue editing.');
}
