import mediaTitles from './scenario-media-titles.json' with { type: 'json' };
import type { PoolItem, ScenarioRun } from './scenario-runs.ts';
import { cleanLegacyScenarioTitle, findScenarioStep, type ScenarioDefinition } from './scenarios.ts';

const dictionaries: Record<string, Record<string, string>> = mediaTitles;
const locales = Object.keys(dictionaries);
const titleSeparator = ' · ';

function matchesTitle(source: string, title: string): boolean {
  return source === title || locales.some(locale => dictionaries[locale][source] === title);
}

function localizedTitle(source: string, locale: string): string {
  const requested = locale.trim().toLowerCase().replaceAll('_', '-');
  const language = locales.find(tag => tag.toLowerCase() === requested)
    ?? locales.find(tag => tag.split('-')[0] === requested.split('-')[0]);
  return (language ? dictionaries[language][source] : undefined) ?? source;
}

export function localizedScenarioDraftTitle(draftTitle: string, scenarioTitle: string, locale: string): string {
  const cleaned = cleanLegacyScenarioTitle(draftTitle);
  const dateSuffix = cleaned.match(/\s*[·•-]\s*\d{4}-\d{2}-\d{2}$/)?.[0] ?? '';
  const workflowTitle = cleaned.slice(0, cleaned.length - dateSuffix.length);
  return matchesTitle(scenarioTitle, workflowTitle)
    ? localizedTitle(scenarioTitle, locale) + dateSuffix
    : draftTitle;
}

export function generatedScenarioMediaName(
  draftTitle: string, scenarioTitle: string, stepTitle: string, version: number | string, locale: string,
): string {
  const name = localizedScenarioDraftTitle(draftTitle, scenarioTitle, locale);
  return `${name}${titleSeparator}${localizedTitle(stepTitle, locale)} v${version}`;
}

export function localizedScenarioMediaLabel(
  item: PoolItem, run: Pick<ScenarioRun, 'steps'>, scenario: ScenarioDefinition, locale: string,
): string {
  if (item.source !== 'generated' || item.ref.type !== 'asset' || (item.kind !== 'audio' && item.kind !== 'video') || !item.stepId) {
    return item.label;
  }
  const step = findScenarioStep(scenario, item.stepId);
  const separator = item.label.lastIndexOf(titleSeparator);
  if (!step || separator <= 0) return item.label;
  const suffix = /^(.*) v([1-9]\d*)$/.exec(item.label.slice(separator + titleSeparator.length));
  if (!suffix || !matchesTitle(step.title, suffix[1])) return item.label;
  const generated = run.steps[item.stepId]?.iterations.some(iteration => iteration.job?.modality === item.kind
    && iteration.outputs.some(output => output.type === 'pool' && output.poolItemId === item.id));
  return generated
    ? generatedScenarioMediaName(item.label.slice(0, separator), scenario.title, step.title, suffix[2], locale)
    : item.label;
}
