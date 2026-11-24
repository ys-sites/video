export const templateContributionUrl = 'https://github.com/nexu-io/openmotion/blob/main/CONTRIBUTING.md';

/** Keep the selected template and environment-specific handoff intact. */
export function templateSubmissionPrompt(recreatePrompt: string, locale = 'en'): string {
  if (locale === 'zh-CN') return `${recreatePrompt}\n\n在本次制作之外，将结果整理为可复用、可编辑的 OpenMotion 模板，准备贡献。先阅读 ${templateContributionUrl} 及其关联的模板贡献指南。包含可编辑源码、预览、改编说明、准确的来源署名与素材许可，执行适用的模板及存储检查。准备面向 nexu-io/openmotion 的聚焦 PR，标题与描述使用英文，展示结果供我评审。不要合并或发布软件包或 CMS 内容。`;
  return `${recreatePrompt}\n\nCreate a reusable, editable template from this recreation and prepare it for contribution to OpenMotion. Read ${templateContributionUrl} and the linked template catalog contribution guide first. Include editable source, a preview, adaptation instructions, accurate source attribution and asset licenses; run the applicable template and storage checks. Prepare a focused pull request against nexu-io/openmotion with an English title and description, and show me the result for review. Do not merge or publish packages or CMS content.`;
}
