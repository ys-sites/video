import { scenarioPromptLocales } from './scenario-prompt-locales.ts';
import { fillScenarioTemplate, type ScenarioDefinition, type ScenarioStepDefinition } from './scenarios.ts';

type Brief = Record<string, string | string[]>;
type Draft = Record<string, unknown>;

function promptLocale(locale: string): string {
  const requested = locale.toLowerCase().replaceAll('_', '-');
  const language = requested.split('-')[0];
  const supported = Object.keys(scenarioPromptLocales);
  return supported.find(key => key.toLowerCase() === requested)
    ?? supported.find(key => key.toLowerCase().split('-')[0] === language)
    ?? 'en';
}

export function scenarioStepPrompt(
  scenario: ScenarioDefinition,
  step: ScenarioStepDefinition,
  brief: Brief,
  locale: string,
): string {
  if (!step.promptTemplate) return '';
  const language = promptLocale(locale);
  const { actions, terms } = scenarioPromptLocales[language];
  const instruction = actions[step.id];
  if (!instruction) return fillScenarioTemplate(step.promptTemplate, brief);

  const list = new Intl.ListFormat(language, { style: 'short', type: 'unit' });
  const separator = language === 'zh-CN' || language === 'ja' ? '：' : language === 'fr' ? '\u00a0: ' : ': ';
  const fieldIds = [...new Set(Array.from(step.promptTemplate.matchAll(/\{(\w+)\}/g), match => match[1]))];
  const lines = [instruction];
  for (const id of fieldIds) {
    const field = scenario.briefFields.find(item => item.id === id);
    const raw = brief[id];
    const values = (Array.isArray(raw) ? raw : [raw ?? '']).map(value => value.trim()).filter(Boolean);
    if (!field || !values.length) continue;
    const localized = values.map(value => {
      const option = field.options?.find(item => item.id === value);
      return option ? terms[option.label] ?? option.label : value;
    });
    lines.push(`${terms[field.label] ?? field.label}${separator}${list.format(localized)}`);
  }
  return lines.join('\n');
}

export function isAutomaticScenarioPrompt(
  scenario: ScenarioDefinition,
  step: ScenarioStepDefinition,
  brief: Brief,
  draft: Draft,
): boolean {
  if (!step.promptTemplate || draft.promptEdited === true) return false;
  if (typeof draft.prompt !== 'string' || !draft.prompt.trim()) return true;
  // A step with a saved iteration can still carry the seed from before the brief was filled in.
  const storedLocale = draft.promptLocale;
  if (typeof storedLocale === 'string') {
    return draft.prompt === scenarioStepPrompt(scenario, step, brief, storedLocale)
      || draft.prompt === scenarioStepPrompt(scenario, step, {}, storedLocale);
  }
  // Legacy drafts stored the English template output without identifying its locale.
  return draft.prompt === fillScenarioTemplate(step.promptTemplate, brief)
    || draft.prompt === fillScenarioTemplate(step.promptTemplate, {});
}

export function resolveScenarioStepPrompt(
  scenario: ScenarioDefinition,
  step: ScenarioStepDefinition,
  brief: Brief,
  draft: Draft,
  locale: string,
): string {
  return isAutomaticScenarioPrompt(scenario, step, brief, draft)
    ? scenarioStepPrompt(scenario, step, brief, locale)
    : typeof draft.prompt === 'string' ? draft.prompt : '';
}
