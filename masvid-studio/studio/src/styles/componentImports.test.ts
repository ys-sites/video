import { describe, expect, it } from 'vitest';
import { componentImportViolation, nativeControlViolations } from '../../../scripts/check-component-imports';

describe('shared component imports', () => {
  const library = 'packages/open-design-ui/';
  const consumer = 'studio/src/motion/GenerationParameters.tsx';

  it('keeps component implementations inside the library', () => {
    expect(componentImportViolation(library + 'slider.tsx', './cn')).toBeUndefined();
    expect(componentImportViolation(library + 'slider.tsx', '@base-ui/react/slider')).toBeUndefined();
    expect(componentImportViolation(library + 'slider.tsx', '../../../studio/src/i18n/I18n')).toBeDefined();
    expect(componentImportViolation(library + 'slider.tsx', '../design-system/react/BrandLogo')).toBeDefined();
    expect(componentImportViolation(library + 'slider.tsx', './site/main')).toBeDefined();
    expect(componentImportViolation(library + 'slider.tsx', '@lezer/javascript')).toBeDefined();
  });

  it('lets the preview import the alias and reuse design system artwork', () => {
    expect(componentImportViolation(library + 'site/main.tsx', 'open-design-ui/button')).toBeUndefined();
    expect(componentImportViolation(library + 'site/main.tsx', '../../design-system/react/BrandLogo')).toBeUndefined();
    expect(componentImportViolation(library + 'site/code-block.tsx', '@lezer/javascript')).toBeUndefined();
    expect(componentImportViolation(library + 'site/code-block.tsx', '@lezer/highlight')).toBeUndefined();
    expect(componentImportViolation(library + 'site/main.tsx', '../../../../studio/src/ui')).toBeDefined();
  });

  it('requires Studio consumers to use shared control aliases', () => {
    expect(componentImportViolation(consumer, 'open-design-ui/slider')).toBeUndefined();
    expect(componentImportViolation(consumer, '../components/ui/Button')).toBeDefined();
    expect(componentImportViolation(consumer, '../../../packages/open-design-ui/slider')).toBeDefined();
    expect(componentImportViolation(consumer, '../components/ui/Select')).toBeUndefined();
  });
});

describe('native Studio controls', () => {
  const file = 'studio/src/motion/Example.tsx';
  const controls = [
    'const example = "<button />";',
    'export const Example = () => <>',
    '  {/* <button /> */}',
    '  <Button type="button">Save</Button>',
    '  <Slider label="Volume" />',
    '  <input type="file" />',
    '  <button className="om-button">Retry</button>',
    '  <button />',
    '  <input type={"range"} />',
    '</>;',
  ].join('\n');

  it('rejects native controls above the per-file baseline', () => {
    expect(nativeControlViolations(file, controls, { button: 1 })).toEqual([
      expect.stringContaining(`${file}:7,8: 2 native <button> elements (baseline 1). Use open-design-ui/button.`),
      expect.stringContaining(`${file}:9: 1 native <input type="range"> elements (baseline 0). Use open-design-ui/slider.`),
    ]);
  });

  it('allows existing controls and requires the baseline to shrink on migration', () => {
    expect(nativeControlViolations(file, controls, { button: 2, slider: 1 })).toEqual([]);
    const migrated = controls.replace('  <button />', '  <Button />');
    expect(nativeControlViolations(file, migrated, { button: 2, slider: 1 })).toEqual([
      `${file}: reduce the button count in studio-native-controls.json to 1.`,
    ]);
    expect(nativeControlViolations(file, migrated, { button: 1, slider: 1 })).toEqual([]);
  });
});
