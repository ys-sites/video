import { existsSync, readFileSync } from 'node:fs';

const defaults = JSON.parse(readFileSync(new URL('./template-config.json', import.meta.url), 'utf8'));
export type TemplateSource = 'repository' | 'hosted' | 'cms';

export function packageTemplateConfig(environment = 'prod', source: TemplateSource = 'cms') {
  if (environment !== 'dev' && environment !== 'prod') throw new Error('Template environment must be dev or prod');
  return { ...defaults, environment, source } as { environment: 'dev' | 'prod'; resourceId: string; locale: string; source: TemplateSource };
}

export function templateConfig(): ReturnType<typeof packageTemplateConfig> {
  const source = process.env.MOTION_TEMPLATE_SOURCE ?? (existsSync(new URL('../library/templates/catalog/catalog.json', import.meta.url)) ? 'repository' : (defaults.source ?? 'cms'));
  if (source !== 'repository' && source !== 'hosted' && source !== 'cms') throw new Error('MOTION_TEMPLATE_SOURCE must be repository, hosted or cms');
  return {
    ...packageTemplateConfig(process.env.MOTION_TEMPLATE_ENV ?? defaults.environment, source),
    resourceId: process.env.MOTION_TEMPLATE_RESOURCE_ID ?? defaults.resourceId,
    locale: process.env.MOTION_TEMPLATE_LOCALE ?? defaults.locale,
    source,
  };
}
