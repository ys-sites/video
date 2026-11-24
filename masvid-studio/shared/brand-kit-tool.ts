const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const revision = { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$' };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const styles = Object.fromEntries([
  'background', 'foreground', 'primary', 'onPrimary', 'surface', 'headingFont', 'bodyFont', 'radius', 'gradient',
].map(key => [key, text(key === 'gradient' ? 2000 : 160)]));
const pinned = { kitId: uuid, expectedUpdatedAt: revision };
const pinnedKeys = Object.keys(pinned);
const command = (operation: string, fields: Record<string, unknown> = {}, required = Object.keys(fields)) =>
  object({ operation: { enum: [operation] }, ...fields }, ['operation', ...required]);

export const brandKitToolArguments = {
  description: 'Brand Kit command for action=brand_kit. Brand Kits are visual references, separate from templates and project timing.',
  oneOf: [
    command('catalog', { query: text(200) }, []), command('list'), command('get', { kitId: uuid }),
    command('create', { url: text(2000), requestId: { ...text(100), pattern: '^[\\w-]+$' } }),
    command('import', { catalogId: { ...text(100), pattern: '^[a-z][a-z0-9-]*$' } }),
    command('preview', { kitId: uuid }), command('package', pinned),
    command('retry', pinned), command('rescan', pinned),
    command('cancel', { kitId: uuid }), command('remove', pinned),
    command('edit', { ...pinned, name: text(100), style: object(styles, Object.keys(styles)) }, pinnedKeys),
    command('context', { ...pinned, rules: { type: 'array', maxItems: 40, items: text(2000) },
      file: object({ name: text(240), data: text(11_184_812) }, ['name', 'data']), remove: uuid }, pinnedKeys),
  ],
};
