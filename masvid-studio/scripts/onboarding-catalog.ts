import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadTemplatePresentation, showTemplateRecommendations } from '../shared/mcp-template-recommendations.ts';
import { onboardingTemplateIds, selectOnboardingTemplateIds } from '../shared/onboarding-templates.ts';
import { parseArgs } from 'node:util';
import { templateConfig } from '../shared/template-config.ts';

export async function onboardingCatalog(appRoot: string, _dataDirectory?: string, templateIds = selectOnboardingTemplateIds(), language = 'en') {
  // All hosts receive the same verified references, including hosts without inline cards.
  // Preparation reads shipped source identities; it neither fetches media nor creates projects.
  const presentation = loadTemplatePresentation({ applicationRoot: appRoot,
    directory: path.join(appRoot, 'mcp-ui/template-recommendations') });
  const recommendation = showTemplateRecommendations(presentation, { templateIds, onboarding: true, language });
  const templates = recommendation.cards.map(item => {
    const source = presentation.templates.find(template => template.id === item.templateId)!;
    return {
      templateId: item.templateId, name: item.title, summary: item.description, durationSeconds: item.durationSeconds,
      ...(source.kind === 'reference' ? { previewUrl: source.videoUrl, posterUrl: source.posterUrl } : {}),
      kind: 'reference' as const, eligibility: 'requires_recreation' as const,
      requirements: 'Read this exact ID with openmotion_get_template and check hasHtmlProject before choosing template reuse or recreation. Presentation provenance does not determine editable source.',
    };
  });
  return { source: 'approved-onboarding', environment: templateConfig().environment,
    catalogVersion: presentation.resourceVersion, catalogTotal: onboardingTemplateIds.length, included: templates.length,
    truncated: false, stale: false, selectionMode: 'random', recommendedTemplateId: templateIds[0],
    selectionGuide: recommendation.selectionGuide, templates };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const appRoot = fileURLToPath(new URL('../', import.meta.url));
  const { values } = parseArgs({ allowPositionals: true, options: { 'template-ids': { type: 'string' }, language: { type: 'string' } } });
  console.log(JSON.stringify(await onboardingCatalog(appRoot, undefined,
    values['template-ids'] ? JSON.parse(values['template-ids']) : undefined, values.language)));
}
