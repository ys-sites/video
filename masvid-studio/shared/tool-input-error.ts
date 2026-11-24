import type { validationRules } from '../tracking/tool-fields.ts';
type ValidationRule = typeof validationRules[number];

export class ToolInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';

  readonly invalid_field: string;
  readonly validation_rule: ValidationRule;

  constructor(message: string, field: string, rule: ValidationRule) {
    super('INVALID_ARGUMENT: ' + message);
    this.invalid_field = field;
    this.validation_rule = rule;
  }
}
