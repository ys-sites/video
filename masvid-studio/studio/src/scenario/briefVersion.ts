import type { StepIteration } from '../../../shared/scenario-runs';
import type { ScenarioBriefField } from '../../../shared/scenarios';
import type { Translate } from '../i18n/I18n';

export function briefSnapshot(iteration: StepIteration | undefined) {
  return iteration?.outputs.find(output => output.type === 'brief')?.values;
}

export function formatBriefFieldValue(
  field: ScenarioBriefField,
  value: string | string[] | undefined,
  t: Translate,
  list: Intl.ListFormat,
): string {
  const items = Array.isArray(value) ? value : [value ?? ''];
  const labels = items.filter(item => item.trim()).map(item => {
    const option = field.options?.find(({ id }) => id === item);
    return option ? t(option.label) : item;
  });
  return list.format(labels);
}
