import type { ComponentType } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { RemixIcon } from '../../design-system/react/RemixIcons';
import { IconButtonDemo } from './demos/icon-button-demo';
import iconButtonCode from './demos/icon-button-demo.tsx?raw';
import { Slider } from 'open-design-ui/slider';
import { ButtonDemo } from './demos/button-demo';
import buttonCode from './demos/button-demo.tsx?raw';
import { SliderDemo } from './demos/slider-demo';
import sliderCode from './demos/slider-demo.tsx?raw';

const buttonVariants: { variant: ButtonVariant; label: string }[] = [
  { variant: 'primary', label: 'Publish' },
  { variant: 'secondary', label: 'Cancel' },
  { variant: 'ghost', label: 'Details' },
  { variant: 'danger', label: 'Delete' },
  { variant: 'plain', label: 'Plain' },
];
const buttonSizes: ButtonSize[] = ['sm', 'md', 'lg'];

function ButtonVariants() {
  return <div className="demo-row">{buttonVariants.map(({ variant, label }) =>
    <Button key={variant} type="button" variant={variant}>{label}</Button>,
  )}</div>;
}

function ButtonStates() {
  return (
    <div className="demo-row">
      <Button type="button" variant="primary" data-preview-state="hover">Hover</Button>
      <Button type="button" variant="primary" data-preview-state="active">Pressed</Button>
      <Button type="button" variant="primary" data-preview-state="focus">Focus</Button>
      <Button type="button" loading>Saving</Button>
      <Button type="button" disabled>Disabled</Button>
    </div>
  );
}

function ButtonSizes() {
  return <div className="demo-row">{buttonSizes.map(size =>
    <Button key={size} type="button" size={size}>{size.toUpperCase()}</Button>,
  )}</div>;
}

function DisabledSlider() {
  return (
    <div className="range-demo">
      <div className="range-label"><span>Opacity</span><span>60%</span></div>
      <Slider label="Disabled opacity" min={0} max={100} value={60} disabled onCommit={() => {}} />
    </div>
  );
}

type Example = { title: string; Demo: ComponentType; description?: string };
type Prop = [name: string, type: string, defaultValue: string, description: string];
type ComponentDocs = {
  icon: string;
  Preview: ComponentType;
  code: string;
  examples: Example[];
  props: Prop[];
  guidance: string[];
  migration: string;
};

export const componentDocs: Partial<Record<string, ComponentDocs>> = {
  button: {
    icon: 'cursor-line',
    Preview: ButtonDemo,
    code: buttonCode.trim(),
    migration: 'Map the existing action to a Button variant and size. Preserve native type (especially submit), handlers, disabled and loading behavior, and visible or accessible labels.',
    examples: [
      { title: 'Variants', Demo: ButtonVariants, description: 'Use primary for the main action, secondary for alternatives, ghost for low-emphasis actions and danger for destructive actions. Plain keeps the layout and surface supplied by the caller.' },
      { title: 'Sizes', Demo: ButtonSizes, description: 'Match neighboring controls to the same size.' },
      { title: 'Interaction states', Demo: ButtonStates, description: 'Hover, pressed and focus are shown side by side for visual review.' },
    ],
    props: [
      ['variant', '"primary" | "secondary" | "danger" | "ghost" | "plain"', '"secondary"', 'Sets emphasis. Use plain to keep the surrounding layout and styles with keyboard focus.'],
      ['size', '"sm" | "md" | "lg"', '"md"', 'Sets the control height, padding and label size.'],
      ['type', '"button" | "submit" | "reset"', 'Browser default', 'Use button for regular actions and submit for form submission.'],
      ['icon', 'ReactNode', '—', 'Renders a leading icon.'],
      ['loading', 'boolean', 'false', 'Shows a spinner and disables activation.'],
      ['disabled', 'boolean', 'false', 'Disables activation using native button semantics.'],
    ],
    guidance: [
      'Use an action label that describes the outcome, such as Save changes.',
      'Tab moves focus to the button. Enter or Space activates it.',
      'Use the shared IconButton for icon-only actions and provide an accessible name.',
    ],
  },
  'icon-button': {
    icon: 'music-2-line',
    Preview: IconButtonDemo,
    code: iconButtonCode.trim(),
    migration: 'Preserve the icon, accessible name, tooltip, disabled state and native button behavior.',
    examples: [
      { title: 'Sizes', Demo: () => <div className="demo-row">{buttonSizes.map(size =>
        <IconButton key={size} type="button" size={size} aria-label="Add music" icon={<RemixIcon name="music-2-line" />} />,
      )}</div> },
      { title: 'Disabled', Demo: () => <IconButton type="button" disabled aria-label="Add music" icon={<RemixIcon name="music-2-line" />} /> },
    ],
    props: [
      ['icon', 'ReactNode', 'Required', 'The icon displayed in the square button.'],
      ['aria-label', 'string', 'Required', 'Names the action for assistive technology.'],
      ['variant', '"primary" | "secondary" | "danger" | "ghost" | "plain"', '"ghost"', 'Sets emphasis. Use plain to keep the surrounding layout and styles with keyboard focus.'],
      ['size', '"sm" | "md" | "lg"', '"md"', 'Sets both width and height to 24, 28 or 32 pixels.'],
      ['disabled', 'boolean', 'false', 'Disables native button activation.'],
    ],
    guidance: [
      'Name the action, for example Add music. Use aria-pressed for a two-state toggle with a stable label.',
      'Use type="button" for toolbar actions. Enter and Space activate the focused control.',
    ],
  },
  slider: {
    icon: 'equalizer-line',
    Preview: SliderDemo,
    code: sliderCode.trim(),
    migration: 'Keep the range, step, accessible label and committed value. Use onPreview for transient feedback and onCommit for persistence.',
    examples: [
      { title: 'Disabled', Demo: DisabledSlider, description: 'Disable the slider when the value cannot be edited in the current state.' },
    ],
    props: [
      ['label', 'string', 'Required', 'Provides the accessible name.'],
      ['value', 'number', 'Required', 'The committed value controlled by the caller.'],
      ['min / max', 'number', 'Required', 'Set the lower and upper bounds.'],
      ['step', 'number', '1', 'Sets the increment for pointer and keyboard changes.'],
      ['onPreview', '(next: number) => void', '—', 'Receives temporary values while editing.'],
      ['onCommit', '(next: number) => void', 'Required', 'Receives the changed value when the edit commits.'],
      ['onTrack', '() => void', '—', 'Records the interaction at a commit boundary.'],
      ['disabled', 'boolean', 'false', 'Prevents editing by pointer and keyboard.'],
    ],
    guidance: [
      'Give the thumb an accessible name and keep the current value visible beside the track.',
      'Arrow keys adjust the value by one step. Escape cancels an active drag.',
      'Keep provisional feedback in onPreview and persist changes from onCommit.',
    ],
  },
};
