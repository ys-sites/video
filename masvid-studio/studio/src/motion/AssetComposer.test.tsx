import { findMediaStudio, findTechniqueStudio } from '../../../shared/studio-catalog';
// @vitest-environment happy-dom
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetComposer, type AssetDraft } from './AssetComposer';
import type { Model } from '../../../shared/gateway';
const { generate, loadGateway, gatewayRequest, chrome } = vi.hoisted(() => ({
  generate: vi.fn(), loadGateway: vi.fn(), gatewayRequest: vi.fn(),
  chrome: { openModelSettings: vi.fn(), openProviderSettings: vi.fn(), openAccountSettings: vi.fn(), openSubscriptionSettings: vi.fn() },
}));
vi.mock('./assetClient', () => ({ assetRequest: generate }));
vi.mock('./gatewayClient', () => ({ loadGateway, gatewayRequest }));
vi.mock('./AssetConversation', () => ({ AssetConversation: () => null }));
vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('./WorkspaceFrame', () => ({ useWorkspaceChrome: () => chrome }));
const model: Model = { id: 'codex:image', provider: 'codex', modelId: 'image', label: 'Codex Image', modality: 'image', source: 'builtin', mode: 'text-to-image' };
let root: Root, container: HTMLDivElement;
const created = vi.fn();
const props: ComponentProps<typeof AssetComposer> = {
  active: true, draft: { modality: 'image', model: model.id, prompt: 'Continue the original', parameters: { size: '1536x1024', custom: { value: 7 } }, references: [] },
  setDraft: vi.fn(), agentReferences: [], setAgentReferences: vi.fn(), jobs: [], mode: 'direct', onMode: vi.fn(), taskIds: {},
  history: { tasks: [], loading: false, onRetry: vi.fn(), onSelect: vi.fn() }, selectingTask: false,
  onNew: vi.fn(), onChatChanged: vi.fn(), onChatStarted: vi.fn(), onCancel: vi.fn(), onView: vi.fn(), onReference: vi.fn(), onCreated: created, onError: vi.fn(), onClose: vi.fn(),
};
beforeEach(() => { vi.clearAllMocks(); loadGateway.mockResolvedValue({ models: [model], status: { providers: [{ id: 'codex', available: true }], routes: {} } }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('temporarily hides the Agent tab and keeps direct generation available when viewing a conversation', async () => {
  await act(async () => root.render(<AssetComposer {...props} mode="agent" />));
  expect(container.querySelector('button[aria-label="Agent conversation"]')).toBeNull();
  const direct = container.querySelector<HTMLButtonElement>('button[aria-label="Direct generation"]')!;
  expect(direct.textContent).toBe('Generate');
  expect(direct.getAttribute('aria-pressed')).toBe('false');
  await act(async () => direct.click());
  expect(props.onMode).toHaveBeenCalledExactlyOnceWith('direct');
});
it('restores native and custom parameters without submitting until explicitly requested', async () => {
  generate.mockResolvedValue({ job: { id: 'new-job' } });
  await act(async () => root.render(<AssetComposer {...props} />));
  expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Continue the original');
  expect(generate).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'generate', model: model.id, prompt: 'Continue the original', parameters: props.draft.parameters }));
  expect(created).toHaveBeenCalledWith({ id: 'new-job' });
});
it('does not silently replace the historical model with an available default', async () => {
  await act(async () => root.render(<AssetComposer {...props} draft={{ ...props.draft, model: 'missing:model' }} />));
  expect(container.textContent).toContain('This task’s model is unavailable');
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')?.disabled).toBe(true);
  expect(generate).not.toHaveBeenCalled();
});
it.each([
  ['prompt', { prompt: 'A new idea typed while waiting' }],
  ['model', { model: 'other:image' }],
  ['references', { references: [{ name: 'New reference', reference: { assetId: 'asset', versionId: 'version' } }] }],
  ['parameters', { parameters: { size: '1024x1024' } }],
] as const)('preserves pending %s edits while recording the submitted job', async (_field, changes) => {
  let resolve!: (value: unknown) => void;
  generate.mockImplementation(() => new Promise(done => { resolve = done; }));
  let latest!: AssetDraft, update!: ComponentProps<typeof AssetComposer>['setDraft'];
  function Harness() {
    const [draft, setDraft] = useState(props.draft); latest = draft; update = setDraft;
    return <AssetComposer {...props} draft={draft} setDraft={setDraft} />;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  const edited = { ...props.draft, ...structuredClone(changes) } as AssetDraft;
  await act(async () => update(edited));
  await act(async () => resolve({ job: { id: 'submitted-job' } }));
  expect(latest).toBe(edited);
  expect(created).toHaveBeenCalledExactlyOnceWith({ id: 'submitted-job' });
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ prompt: props.draft.prompt, model: model.id, parameters: props.draft.parameters, references: [] }));
});
it('sends one reference to an account image model that reports editing support', async () => {
  const account: Model = { id: 'account:image', provider: 'account', modelId: 'image', label: 'Account Image', modality: 'image', source: 'live', mode: 'text-to-image', supportsImageReference: true };
  const basic: Model = { ...account, id: 'account:basic', modelId: 'basic', label: 'Account Basic', supportsImageReference: undefined };
  loadGateway.mockResolvedValue({ models: [account, basic], status: { providers: [{ id: 'account', available: true }], routes: {} } });
  generate.mockResolvedValue({ job: { id: 'edit-job' } });
  const references = [{ name: 'Cup', reference: { assetId: 'asset', versionId: 'version' } }];
  const draft = { ...props.draft, model: basic.id, parameters: {}, references };
  await act(async () => root.render(<AssetComposer {...props} draft={draft} />));
  expect(container.textContent).toContain('This model cannot use asset references');
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')?.disabled).toBe(true);
  await act(async () => root.render(<AssetComposer {...props} draft={{ ...draft, model: account.id }} />));
  expect(container.textContent).toContain('This model edits up to {count} image references.');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'generate', model: account.id, mode: 'text-to-image', references: [references[0].reference] }));
});

it.each(['image', 'video'] as const)('uses the model reference contract for Cloud %s', async modality => {
  const cloud: Model = { id: 'opendesign:references', provider: 'opendesign', modelId: 'references', label: 'Cloud', modality,
    source: 'live', mode: `text-to-${modality}`, supportsImageReference: modality === 'image', maxInputImages: modality === 'image' ? 20 : 1 };
  loadGateway.mockResolvedValue({ models: [cloud], status: { providers: [{ id: 'opendesign', available: true }], routes: {} } });
  generate.mockResolvedValue({ job: { id: 'cloud-reference-job' } });
  const references = Array.from({ length: cloud.maxInputImages! }, (_, index) => ({ name: `Reference ${index}`, reference: { assetId: `asset-${index}`, versionId: 'version' } }));
  await act(async () => root.render(<AssetComposer {...props} draft={{ ...props.draft, modality, model: cloud.id, parameters: {}, references }} />));
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')?.disabled).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('.om-creation-reference')?.disabled).toBe(true);
  expect(container.textContent).toContain(modality === 'video' ? 'This video model uses one image as its first frame.' : 'This model edits up to {count} image references.');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: cloud.id, references: references.map(item => item.reference) }));
  await act(async () => root.render(<AssetComposer {...props} draft={{ ...props.draft, modality, model: cloud.id, references: [...references, references[0]] }} />));
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')?.disabled).toBe(true);
});

const cloudImage: Model = { ...model, id: 'opendesign:sunburst', provider: 'opendesign', source: 'live', supportsImageReference: undefined };
const cloudState = (models: Model[]) => ({ models, status: { providers: [{ id: 'opendesign', available: true }], routes: {} } });
it('syncs unknown Cloud capability without remounting or losing the draft and references', async () => {
  loadGateway.mockResolvedValue(cloudState([cloudImage])); gatewayRequest.mockResolvedValue({});
  const draft = { ...props.draft, model: cloudImage.id, references: [{ name: 'Cup', reference: { assetId: 'a', versionId: 'v' } }] };
  await act(async () => root.render(<AssetComposer {...props} draft={draft} />));
  expect(container.textContent).toContain('Image editing capability is unknown');
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.disabled).toBe(true);
  loadGateway.mockResolvedValue(cloudState([{ ...cloudImage, supportsImageReference: true, maxInputImages: 3 }]));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Sync models')!.click());
  expect(gatewayRequest).toHaveBeenCalledExactlyOnceWith('settings/providers/opendesign/sync', 'POST', {});
  expect(container.querySelector<HTMLButtonElement>('.om-creation-reference')!.disabled).toBe(false);
  expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(draft.prompt);
  expect(container.textContent).toContain('Cup'); expect(props.setDraft).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
});
it('discards an earlier model response after settings change and keeps a removed model selected for validation', async () => {
  let release!: (value: unknown) => void;
  loadGateway.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(cloudState([]));
  await act(async () => root.render(<AssetComposer {...props} draft={{ ...props.draft, model: cloudImage.id }} />));
  await act(async () => window.dispatchEvent(new Event('motion:gateway-changed')));
  await act(async () => release(cloudState([{ ...cloudImage, supportsImageReference: true }])));
  expect(container.textContent).toContain('This task’s model is unavailable');
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.disabled).toBe(true);
  expect(props.setDraft).not.toHaveBeenCalled();
  gatewayRequest.mockResolvedValue({}); loadGateway.mockResolvedValue(cloudState([{ ...cloudImage, supportsImageReference: true }]));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Sync models')!.click());
  expect(gatewayRequest).toHaveBeenCalledExactlyOnceWith('settings/providers/opendesign/sync', 'POST', {});
  expect(container.textContent).not.toContain('This task’s model is unavailable');
});
it('distinguishes explicit unsupported capability from unknown and reports failed sync', async () => {
  const draft = { ...props.draft, model: cloudImage.id, references: [{ name: 'Cup', reference: { assetId: 'a', versionId: 'v' } }] };
  loadGateway.mockResolvedValue(cloudState([{ ...cloudImage, supportsImageReference: false }]));
  await act(async () => root.render(<AssetComposer {...props} draft={draft} />));
  expect(container.textContent).toContain('This model cannot use asset references');
  expect(container.textContent).not.toContain('Sync models');
  loadGateway.mockResolvedValue(cloudState([cloudImage]));
  await act(async () => window.dispatchEvent(new Event('motion:gateway-changed')));
  gatewayRequest.mockRejectedValue(new Error('Catalogue unavailable'));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Sync models')!.click());
  expect(props.onError).toHaveBeenCalledWith('Catalogue unavailable'); expect(generate).not.toHaveBeenCalled();
});

const firstFrame = [{ name: 'Portrait', reference: { assetId: 'portrait', versionId: 'first-version' } }];
const cloudVideo = (modelId = 'wan-2.7'): Model => ({
  id: `opendesign:${modelId}`, provider: 'opendesign', modelId, label: 'Cloud video', modality: 'video', source: 'live',
  mode: 'text-to-video', maxInputImages: 1, defaults: { ratio: '16:9', duration: 5 },
  generationOptions: { delivery: 'provider', fields: [{ key: 'ratio', label: 'Aspect ratio', kind: 'choice', presentation: 'ratio',
    choices: ['16:9', '9:16', 'adaptive'].map(value => ({ value, label: value })) }] },
});

it.each(['wan-2.7', 'doubao-seedance-2-5-260628'])('shows first-frame geometry and excludes inherited ratio when submitting %s', async modelId => {
  const selected = cloudVideo(modelId);
  loadGateway.mockResolvedValue(cloudState([selected])); generate.mockResolvedValue({ job: { id: 'i2v-job' } });
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'video', model: selected.id, prompt: 'Walk forward', references: firstFrame }} />));
  expect(container.textContent).toContain('Aspect ratio follows the first frame.');
  expect(container.querySelector('.om-generation-summary')!.textContent).toContain('Follows first frame');
  expect(container.querySelector('.om-generation-summary')!.textContent).not.toContain('16:9');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());
  expect(document.querySelector('.om-generation-ratios')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ parameters: {}, references: firstFrame.map(item => item.reference) }));
});

it('holds the text-to-video quick choice while a first frame is attached and restores it after removal', async () => {
  const selected = cloudVideo();
  loadGateway.mockResolvedValue(cloudState([selected])); generate.mockResolvedValue({ job: { id: 'i2v-job' } });
  let update!: ComponentProps<typeof AssetComposer>['setDraft'];
  function Harness() {
    const [draft, setDraft] = useState<AssetDraft>({ modality: 'video', model: selected.id, prompt: 'Walk forward', references: [] });
    update = setDraft;
    return <AssetComposer {...props} draft={draft} setDraft={setDraft} />;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());
  const ratio = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.om-generation-ratios button')).find(button => button.textContent === '9:16');
  await act(async () => ratio()!.click());
  expect(ratio()!.getAttribute('aria-pressed')).toBe('true');
  await act(async () => update(current => ({ ...current, references: firstFrame })));
  expect(ratio()).toBeUndefined();
  expect(container.textContent).toContain('Remove it to restore your text-to-video ratio.');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate.mock.calls[0][0].parameters).toEqual({});
  await act(async () => container.querySelector<HTMLButtonElement>('.om-asset-references .om-badge')!.click());
  expect(container.textContent).not.toContain('Aspect ratio follows the first frame.');
  expect(container.querySelector('.om-generation-summary')!.textContent).toContain('9:16');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());
  expect(ratio()!.getAttribute('aria-pressed')).toBe('true');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate.mock.calls[1][0]).toEqual(expect.objectContaining({ parameters: { ratio: '9:16' }, references: [] }));
});

it('rejects explicit fixed-ratio JSON without discarding it or submitting a paid request', async () => {
  const selected = cloudVideo(); loadGateway.mockResolvedValue(cloudState([selected]));
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'video', model: selected.id, prompt: 'Walk forward', parameters: { ratio: '16:9', seed: 7 }, references: firstFrame }} />));
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).not.toHaveBeenCalled();
  expect(props.onError).toHaveBeenCalledExactlyOnceWith('First-frame video follows the input image ratio. Remove parameters.ratio or set it to "adaptive".');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());
  expect(JSON.parse(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Model parameters"]')!.value)).toEqual({ ratio: '16:9', seed: 7 });
  expect(props.setDraft).not.toHaveBeenCalled();
});

it('recognizes a provider-native first frame in advanced JSON and leaves unrelated models unchanged', async () => {
  const selected = cloudVideo();
  const other = { ...selected, id: 'opendesign:other-video', modelId: 'other-video' };
  loadGateway.mockResolvedValue(cloudState([selected, other])); generate.mockResolvedValue({ job: { id: 'other-job' } });
  const parameters = { images: [{ role: 'first_frame', url: 'https://example.test/portrait.png' }], ratio: '16:9' };
  const draft: AssetDraft = { modality: 'video', model: selected.id, prompt: 'Walk forward', parameters, references: [] };
  await act(async () => root.render(<AssetComposer {...props} draft={draft} />));
  expect(container.textContent).toContain('Aspect ratio follows the first frame.');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).not.toHaveBeenCalled();
  await act(async () => root.render(<AssetComposer {...props} draft={{ ...draft, model: other.id }} />));
  expect(container.textContent).not.toContain('Aspect ratio follows the first frame.');
});

it('keeps unsupported account reference drafts blocked without promising first-frame behavior', async () => {
  const selected = { ...cloudVideo(), id: 'account:wan-2.7', provider: 'account', maxInputImages: 0 };
  loadGateway.mockResolvedValue({ models: [selected], status: { providers: [{ id: 'account', available: true }], routes: {} } });
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'video', model: selected.id, prompt: 'Walk forward', references: firstFrame }} />));
  expect(container.textContent).toContain('This model cannot use asset references');
  expect(container.textContent).not.toContain('Aspect ratio follows the first frame.');
  expect(container.querySelector('.om-generation-summary')!.textContent).not.toContain('Follows first frame');
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.disabled).toBe(true);
  expect(generate).not.toHaveBeenCalled();
});

it('requires a pinned image and a capable model for the image-editing scene', async () => {
  const { studioDestination } = await import('./creativeStudios');
  const editing = { ...model, id: 'codex:edit', label: 'Edit model', supportsImageReference: true };
  loadGateway.mockResolvedValue({ models: [model, editing], status: { providers: [{ id: 'codex', available: true }], routes: { image: model.id } } });
  const studio = { catalog: { catalog: await loadGateway(), failed: false, retry: vi.fn() }, destination: studioDestination(findMediaStudio('design')!, 'image-edit', editing.id), remember: vi.fn(), chooseModel: vi.fn() };
  const draft = { modality: 'image' as const, prompt: 'Change the light', references: [] };
  await act(async () => root.render(<AssetComposer {...props} studio={studio} draft={draft} />));
  const submit = () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
  expect(submit().disabled).toBe(true);
  const reference = { assetId: 'asset', versionId: 'pinned' };
  await act(async () => root.render(<AssetComposer {...props} studio={studio} draft={{ ...draft, references: [{ reference, name: 'First' }] }} />));
  expect(submit().disabled).toBe(false);
  generate.mockResolvedValue({ job: { id: 'job' } });
  await act(async () => submit().click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: editing.id, references: [reference] }));
});

it('never substitutes a music model for a routed speech model', async () => {
  const { studioDestination } = await import('./creativeStudios');
  const music = { ...model, id: 'p:music', modality: 'audio', mode: 'text-to-audio' };
  loadGateway.mockResolvedValue({ models: [music], status: { providers: [{ id: 'codex', available: true }], routes: { audio: music.id } } });
  const studio = { catalog: { catalog: await loadGateway(), failed: false, retry: vi.fn() }, destination: studioDestination(findMediaStudio('sound')!, 'speech', 'p:voice'), remember: vi.fn(), chooseModel: vi.fn() };
  await act(async () => root.render(<AssetComposer {...props} studio={studio} draft={{ modality: 'audio', prompt: 'Hello', references: [] }} />));
  expect(container.textContent).toContain('p:voice');
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')?.disabled).toBe(true);
  expect(generate).not.toHaveBeenCalled();
});

it('keeps the prompt and pinned reference while switching providers serving the same model', async () => {
  const { studioDestination } = await import('./creativeStudios');
  const base = { modality: 'image' as const, mode: 'text-to-image' as const, source: 'live' as const, label: 'seedream-5.5', modelId: 'seedream-5.5', supportsImageReference: true, maxInputImages: 1 };
  const account: Model = { ...base, id: 'account:seedream-5.5', provider: 'account' };
  const cloud: Model = { ...base, id: 'opendesign:seedream-5.5', provider: 'opendesign' };
  const codex: Model = { ...base, id: 'codex:image-generation', provider: 'codex', modelId: 'image-generation', label: 'Codex Image' };
  const reference = { assetId: 'product', versionId: 'v1' };
  const catalog = { models: [account, cloud, codex], status: {
    providers: [{ id: 'codex', label: 'Codex', available: false }, { id: 'account', label: 'OpenDesign', available: true }, { id: 'opendesign', label: 'OpenDesign Cloud', available: true }],
    routes: {}
  } };
  loadGateway.mockResolvedValue(catalog);
  const loaded = await loadGateway();
  function Harness() {
    const [id, chooseModel] = useState(account.id);
    const [draft, setDraft] = useState<AssetDraft>({ ...props.draft, references: [{ reference, name: 'Photo' }] });
    return <AssetComposer {...props} draft={draft} setDraft={setDraft} studio={{
      catalog: { catalog: loaded, failed: false, retry: vi.fn() }, chooseModel, remember: vi.fn(),
      destination: studioDestination(findMediaStudio('design')!, 'image-edit', id)
    }} />;
  }
  const option = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.textContent?.includes(label))!;
  await act(async () => root.render(<Harness />));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Provider"]')!.click());
  expect(option('Codex').disabled).toBe(true);
  await act(async () => option('OpenDesign Cloud').click());
  expect(container.querySelector('button[aria-label="Generation model"]')!.textContent).toContain('Seedream 5.5');
  const submit = () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
  expect(container.querySelector<HTMLTextAreaElement>('.om-image-prompt')!.value).toBe(props.draft.prompt);
  expect(generate).not.toHaveBeenCalled();
  generate.mockResolvedValue({ job: { id: 'new' } });
  await act(async () => submit().click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'generate', model: cloud.id, mode: cloud.mode,
    prompt: props.draft.prompt, references: [reference] }));
});
it.each([
  { scene: 'text-to-video', duration: 10, expected: { duration: 10, ratio: '9:16' } },
  { scene: 'image-to-video', duration: 30, expected: {} },
] as const)('submits the requested shot once using compatible preferences for $scene', async ({ scene, duration, expected }) => {
  const { studioDestination } = await import('./creativeStudios');
  const selected = cloudVideo();
  selected.generationOptions!.fields.push({ key: 'duration', kind: 'choice', label: 'Duration (seconds)', choices: [{ value: 10, label: '10' }] });
  loadGateway.mockResolvedValue(cloudState([selected]));
  const studio = { catalog: { catalog: await loadGateway(), failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: studioDestination(findTechniqueStudio('shorts')!, scene, selected.id) };
  const references = scene === 'image-to-video' ? firstFrame : [];
  const draft: AssetDraft = { modality: 'video', prompt: 'A vertical shot of a ceramic vase', references, shotPreferences: { aspect: '9:16', duration } };
  await act(async () => root.render(<AssetComposer {...props} draft={draft} studio={studio} />));
  expect(generate).not.toHaveBeenCalled();
  generate.mockResolvedValue({ job: { id: 'test-shot' } });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'generate', model: selected.id,
    prompt: draft.prompt, references: references.map(item => item.reference), parameters: expected }));
});

it('resumes an old account task while preserving a newer prompt draft', async () => {
  const account: Model = { ...model, id: 'account:image', provider: 'account', modelId: 'image' };
  loadGateway.mockResolvedValue({ models: [account], status: { providers: [{ id: 'account', available: true }], routes: {} } });
  const job = { id: 'old-job', model: account, prompt: 'old prompt', parameters: {}, modality: 'image' as const, state: 'failed' as const, phase: 'failed', remoteId: 'original-remote', assets: [], requestHash: 'snapshot', createdAt: 1, updatedAt: 2 };
  const resume = vi.fn(async () => {}), setDraft = vi.fn();
  const draft = { ...props.draft, model: account.id, prompt: 'new prompt for next generation', parameters: {} };
  await act(async () => root.render(<AssetComposer {...props} draft={draft} setDraft={setDraft} jobs={[job]} taskIds={{ direct: job.id }} onResume={resume} />));
  const button = [...container.querySelectorAll('button')].find(node => node.textContent === 'Continue download')!;
  await act(async () => button.click());
  expect(resume).toHaveBeenCalledExactlyOnceWith(job);
  expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(draft.prompt);
  expect(setDraft).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
});

it('shows a non-blocking subscription prompt for Free/Go OpenDesign accounts while keeping submit enabled', async () => {
  const account: Model = { ...model, id: 'account:image', provider: 'account', modelId: 'image', label: 'Account Image' };
  loadGateway.mockResolvedValue({
    models: [account],
    status: { providers: [{ id: 'account', label: 'OpenDesign', available: true, mediaEntitlement: 'not-included', plan: 'free', hasBalance: false }], routes: { image: account.id } },
  });
  await act(async () => root.render(<AssetComposer {...props} draft={{ ...props.draft, model: account.id, parameters: {} }} />));
  expect(container.textContent).toContain('Signed in; multimodal generation requires OpenDesign Plus or above');
  const submit = container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
  expect(submit.disabled).toBe(false);
  const manage = [...container.querySelectorAll('button')].find(node => node.textContent === 'Manage subscription')!;
  await act(async () => manage.click());
  expect(chrome.openSubscriptionSettings).toHaveBeenCalledTimes(1);
});

it('disables image generation and keeps setup actions in the provider picker', async () => {
  const { mediaEditorDestination, studioDestination } = await import('./creativeStudios');
  const falModel: Model = { ...model, id: 'fal:flux', provider: 'fal', modelId: 'flux', label: 'Flux' };
  const accountModel: Model = { ...model, id: 'account:img', provider: 'account', modelId: 'img', label: 'Account Image' };
  const catalog = {
    models: [falModel, accountModel],
    status: {
      providers: [
        { id: 'fal', label: 'fal.ai', available: false },
        { id: 'account', label: 'OpenDesign', available: false },
      ],
      routes: {},
    },
  };
  const submit = () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
  const openSetup = async (label: string) => {
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Provider"]')!.click());
    const row = [...document.querySelectorAll('.om-picker-provider-row')].find(node => node.querySelector('strong')?.textContent === label)!;
    await act(async () => row.querySelector<HTMLButtonElement>('.om-picker-setup')!.click());
  };
  await act(async () => root.render(<AssetComposer {...props} draft={{ ...props.draft, model: undefined }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: mediaEditorDestination('text-to-image', falModel.id),
  }} />));
  expect(container.textContent).toContain('{provider} needs setup before generating.');
  const setup = container.querySelector('.om-provider-setup[role="status"]')!;
  expect(setup.querySelector('[data-remix-icon="information-line"]')).not.toBeNull();
  expect(submit().textContent).toBe('Generate image');
  expect(submit().disabled).toBe(true);
  await act(async () => submit().click());
  expect(chrome.openProviderSettings).not.toHaveBeenCalled();
  await act(async () => setup.querySelector<HTMLButtonElement>('button')!.click());
  expect(chrome.openProviderSettings).toHaveBeenCalledExactlyOnceWith('fal');
  await openSetup('fal.ai');
  expect(chrome.openProviderSettings).toHaveBeenCalledTimes(2);

  await act(async () => root.render(<AssetComposer {...props} draft={{ ...props.draft, model: undefined }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: studioDestination(findMediaStudio('design')!, 'text-to-image', accountModel.id),
  }} />));
  expect(submit().disabled).toBe(true);
  expect(container.querySelector('.om-provider-setup [data-remix-icon="information-line"]')).not.toBeNull();
  await openSetup('OpenDesign');
  expect(chrome.openAccountSettings).toHaveBeenCalledTimes(1);
  expect(generate).not.toHaveBeenCalled();
});

it('defaults Shorts Studio to 9:16 on OpenDesign video models publishing ratios and filters paired image resolutions', async () => {
  const { studioDestination } = await import('./creativeStudios');
  const { generationOptions } = await import('../../../shared/generation-options');
  const videoBase: Model = {
    id: 'opendesign:wan-2.7', provider: 'opendesign', modelId: 'wan-2.7', label: 'Wan 2.7', modality: 'video', mode: 'text-to-video', source: 'live',
    nativeOptions: { ratios: { values: ['16:9', '9:16'], default: '16:9' }, durations: { values: [5, 10], default: 5 } },
  };
  const video: Model = { ...videoBase, generationOptions: generationOptions(videoBase) };
  loadGateway.mockResolvedValue(cloudState([video]));
  const studio = {
    catalog: { catalog: await loadGateway(), failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: studioDestination(findTechniqueStudio('shorts')!, 'text-to-video', video.id),
  };
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'video', prompt: 'Vertical skyline', references: [] }} studio={studio} />));
  generate.mockResolvedValue({ job: { id: 'shorts-job' } });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: video.id, parameters: { ratio: '9:16' } }));

  const imageBase: Model = {
    id: 'opendesign:nano-banana-2', provider: 'opendesign', modelId: 'nano-banana-2', label: 'Nano Banana 2', modality: 'image', mode: 'text-to-image', source: 'live',
    nativeOptions: {
      profiles: {
        generations: {
          profiles: [
            { aspect_ratio: '1:1', resolution: '1K' },
            { aspect_ratio: '1:1', resolution: '2K' },
            { aspect_ratio: '16:9', resolution: '2K' },
          ],
          default: { aspect_ratio: '1:1', resolution: '1K' },
        },
      },
    },
  };
  const image: Model = { ...imageBase, generationOptions: generationOptions(imageBase) };
  loadGateway.mockResolvedValue(cloudState([image]));
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', model: image.id, prompt: 'Poster', references: [] }} />));
  await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());
  const ratio16x9 = [...document.querySelectorAll<HTMLButtonElement>('.om-generation-ratios button')].find(b => b.textContent === '16:9')!;
  await act(async () => ratio16x9.click());
  const resolutionSelect = document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Resolution"]')!;
  await act(async () => resolutionSelect.click());
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(el => el.textContent);
  expect(options).toContain('2K');
  expect(options).not.toContain('1K');
});

it('filters OpenDesign image quick controls to the edits profile envelope when a reference image is attached', async () => {
  const { generationOptions } = await import('../../../shared/generation-options');
  const editableBase: Model = {
    id: 'opendesign:nano-banana-2', provider: 'opendesign', modelId: 'nano-banana-2', label: 'Nano Banana 2', modality: 'image', mode: 'text-to-image', source: 'live',
    supportsImageReference: true,
    nativeOptions: {
      profiles: {
        generations: {
          profiles: [
            { aspect_ratio: '1:1', resolution: '1K' },
            { aspect_ratio: '16:9', resolution: '2K' },
          ],
          default: { aspect_ratio: '1:1', resolution: '1K' },
        },
        edits: {
          profiles: [{ aspect_ratio: '1:1', resolution: '2K' }],
          default: { aspect_ratio: '1:1', resolution: '2K' },
        },
      },
    },
  };
  const editable: Model = { ...editableBase, generationOptions: generationOptions(editableBase) };
  loadGateway.mockResolvedValue(cloudState([editable]));
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', model: editable.id, prompt: 'Edit poster', references: firstFrame }} />));
  await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());
  const editRatios = [...document.querySelectorAll<HTMLButtonElement>('.om-generation-ratios button')].map(b => b.textContent);
  expect(editRatios).toEqual(['1:1']);
  const editResSelect = document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Resolution"]')!;
  await act(async () => editResSelect.click());
  const editResOptions = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(el => el.textContent);
  expect(editResOptions).toContain('2K');
  expect(editResOptions).not.toContain('1K');
});

it('clears draft parameters when switching models so stale parameters do not leak across models', async () => {
  const { generationOptions } = await import('../../../shared/generation-options');
  const profiledBase: Model = {
    id: 'account:nano-banana-2', provider: 'account', modelId: 'nano-banana-2', label: 'Nano Banana 2', modality: 'image', mode: 'text-to-image', source: 'live',
    nativeOptions: { profiles: { generations: { profiles: [{ aspect_ratio: '16:9', resolution: '2K' }], default: { aspect_ratio: '16:9', resolution: '2K' } } } },
  };
  const sizedBase: Model = {
    id: 'account:seedream-5.0-flash', provider: 'account', modelId: 'seedream-5.0-flash', label: 'Seedream 5.0 Flash', modality: 'image', mode: 'text-to-image', source: 'live',
    nativeOptions: { sizes: { values: ['1K', '2K'], default: '2K' } },
  };
  const profiled: Model = { ...profiledBase, generationOptions: generationOptions(profiledBase) };
  const sized: Model = { ...sizedBase, generationOptions: generationOptions(sizedBase) };
  loadGateway.mockResolvedValue({ models: [profiled, sized], status: { providers: [{ id: 'account', label: 'OpenDesign', available: true }], routes: { image: profiled.id } } });
  let latest!: AssetDraft;
  function Harness() {
    const [draft, setDraft] = useState<AssetDraft>({ modality: 'image', model: profiled.id, prompt: 'A ceramic cup', parameters: { resolution: '2K' }, references: [] });
    latest = draft;
    return <AssetComposer {...props} draft={draft} setDraft={setDraft} />;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Generation model"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes('Seedream 5.0 Flash'))!.click());
  expect(latest.model).toBe(sized.id);
  expect(latest.parameters).toBeUndefined();
  generate.mockResolvedValue({ job: { id: 'clean-job' } });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: sized.id, parameters: {} }));
});

it('enables first-frame video submission for account video models that advertise maxInputImages', async () => {
  const accountVideo = { ...cloudVideo('wan-2.7'), id: 'account:wan-2.7', provider: 'account', maxInputImages: 1 };
  loadGateway.mockResolvedValue({ models: [accountVideo], status: { providers: [{ id: 'account', available: true }], routes: {} } });
  generate.mockResolvedValue({ job: { id: 'account-i2v-job' } });
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'video', model: accountVideo.id, prompt: 'Walk forward', references: firstFrame }} />));
  expect(container.textContent).toContain('Aspect ratio follows the first frame.');
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.disabled).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: accountVideo.id, parameters: {}, references: firstFrame.map(item => item.reference) }));
});

it('renders quick parameter cards, slider duration ticks, resolution pills, and Seedance native audio toggle in Cinema Studio', async () => {
  const { studioDestination } = await import('./creativeStudios');
  const { generationOptions } = await import('../../../shared/generation-options');
  const makeVideo = (modelId: string, nativeOptions: Record<string, unknown>): Model => {
    const base: Model = {
      id: `account:${modelId}`, provider: 'account', modelId, label: modelId, modality: 'video', mode: 'text-to-video', source: 'live',
      nativeOptions,
    };
    return { ...base, generationOptions: generationOptions(base) };
  };
  const seedance = makeVideo('doubao-seedance-2-5-260628', {
    durations: { values: [5, 4, ...Array.from({ length: 25 }, (_, i) => i + 6)], default: 5 },
    ratios: { values: ['16:9', '9:16', 'adaptive'], default: '16:9' },
    resolutions: { values: ['720p', '480p', '1080p'], default: '720p' },
  });
  const wan = makeVideo('wan-2.7', {
    durations: { values: [5, 2, 3, 4, ...Array.from({ length: 10 }, (_, i) => i + 6)], default: 5 },
    ratios: { values: ['16:9', '9:16', 'adaptive'], default: '16:9' },
    resolutions: { values: ['720p', '1080p'], default: '720p' },
  });
  const seedance20 = makeVideo('doubao-seedance-2-0-260128', {
    durations: { values: [5, 10], default: 5 },
    ratios: { values: ['16:9', '9:16'], default: '16:9' },
    resolutions: { values: ['720p', '1080p'], default: '720p' },
  });
  const catalog = {
    models: [seedance, wan, seedance20],
    status: { providers: [{ id: 'account', label: 'OpenDesign', available: true }], routes: { video: seedance.id } },
  };
  loadGateway.mockResolvedValue(catalog);
  const loaded = await loadGateway();
  let pick!: (id: string) => void;
  function Harness() {
    const [id, chooseModel] = useState(seedance.id);
    pick = chooseModel;
    const [draft, setDraft] = useState<AssetDraft>({ modality: 'video', prompt: 'Drive on Los Santos Blvd', references: [] });
    return <AssetComposer {...props} draft={draft} setDraft={setDraft} studio={{
      catalog: { catalog: loaded, failed: false, retry: vi.fn() }, chooseModel, remember: vi.fn(),
      destination: studioDestination(findMediaStudio('cinema')!, 'text-to-video', id),
    }} />;
  }
  await act(async () => root.render(<Harness />));

  // Seedance 2.5 renders quick parameter cards including Duration, Resolution, Aspect ratio, and Generate audio (On by default),
  // and keeps the summary row compact as "Advanced parameters" rather than repeating values.
  const durationCard = () => container.querySelector<HTMLButtonElement>('.om-param-card[aria-label="Duration"]')!;
  const resolutionCard = () => container.querySelector<HTMLButtonElement>('.om-param-card[aria-label="Resolution"]')!;
  const audioCard = () => container.querySelector<HTMLButtonElement>('.om-param-audio[aria-label="Generate audio"]')!;
  expect(durationCard().textContent).toContain('5s');
  expect(resolutionCard().textContent).toContain('720p');
  expect(audioCard().getAttribute('aria-checked')).toBe('true');
  expect(container.querySelector('.om-generation-summary')?.textContent).toBe('Advanced parameters');

  // Clicking Duration card opens slider + tick buttons [4, 10, 15, 20, 30] instead of a 27-item dropdown.
  await act(async () => durationCard().click());
  expect(document.querySelector('[role="combobox"][aria-label="Duration (seconds)"]')).toBeNull();
  const ticks = [...document.querySelectorAll<HTMLButtonElement>('.om-duration-tick')];
  expect(ticks.map(node => node.textContent?.trim())).toEqual(['4', '10', '15', '20', '30']);
  await act(async () => ticks.find(node => node.textContent?.trim() === '15')!.click());
  expect(durationCard().textContent).toContain('15s');

  // Toggle Generate audio off via quick card and verify submission carries duration: 15 and generate_audio: false.
  await act(async () => audioCard().click());
  expect(audioCard().getAttribute('aria-checked')).toBe('false');
  generate.mockResolvedValue({ job: { id: 'seedance-15s' } });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({
    action: 'generate', model: seedance.id, parameters: { duration: 15, generate_audio: false },
  }));

  // Switch model to wan-2.7: audio renders as a static always-on card (no switch), resolution has [720p, 1080p], duration ticks update to [2, 5, 10, 15].
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(node => node.textContent?.includes('Wan 2.7'))!.click());
  expect(container.querySelector('.om-param-audio[role="switch"]')).toBeNull();
  const staticAudio = container.querySelector('.om-param-card-static[aria-label="Generate audio"]')!;
  expect(staticAudio.textContent).toContain('Generate audio');
  expect(staticAudio.textContent).toContain('On');
  await act(async () => durationCard().click());
  expect([...document.querySelectorAll<HTMLButtonElement>('.om-duration-tick')].map(node => node.textContent?.trim())).toEqual(['2', '5', '10', '15']);
  await act(async () => resolutionCard().click());
  expect([...document.querySelectorAll<HTMLButtonElement>('.om-option-pill')].map(node => node.textContent?.trim())).toEqual(['720p', '1080p']);

  // A pinned doubao-seedance-2-0-260128 (outside the fixed menu list): discrete durations [5, 10] render as compact pills, not a slider.
  await act(async () => pick(seedance20.id));
  await act(async () => durationCard().click());
  expect(document.querySelector('.om-duration-track')).toBeNull();
  expect([...document.querySelectorAll<HTMLButtonElement>('.om-option-pill')].map(node => node.textContent?.trim())).toEqual(['5s', '10s']);
});

it('hides reference controls when unsupported and clears image references when switching to audio', async () => {
  const imageModel = model;
  const audioModel: Model = { id: 'codex:audio', provider: 'codex', modelId: 'audio', label: 'Audio', modality: 'audio', source: 'builtin', mode: 'text-to-audio' };
  loadGateway.mockResolvedValue({ models: [imageModel, audioModel], status: { providers: [{ id: 'codex', available: true }], routes: {} } });
  let latest!: AssetDraft, update!: ComponentProps<typeof AssetComposer>['setDraft'];
  function Harness() {
    const [draft, setDraft] = useState<AssetDraft>({ modality: 'image', model: imageModel.id, prompt: 'Keep going', references: [{ name: 'Still', reference: { assetId: 'a', versionId: 'v1' } }] });
    latest = draft; update = setDraft;
    return <AssetComposer {...props} draft={draft} setDraft={setDraft} />;
  }
  await act(async () => root.render(<Harness />));
  // Reference control is visible while a reference is attached even if the image model does not support references.
  expect(container.querySelector('.om-creation-reference')).not.toBeNull();
  await act(async () => update(current => ({ ...current, references: [] })));
  expect(container.querySelector('.om-creation-reference')).toBeNull();

  // Re-attach an image reference and switch media type to audio: references are cleared.
  await act(async () => update(current => ({ ...current, references: [{ name: 'Still', reference: { assetId: 'a', versionId: 'v1' } }] })));
  await act(async () => container.querySelectorAll<HTMLButtonElement>('.om-creation-types button')[2].click());
  expect(latest.modality).toBe('audio');
  expect(latest.references).toEqual([]);
  expect(container.querySelector('.om-creation-reference')).toBeNull();
});

it('chooses a provider, then one of its fixed-list models, keeping unconfigured providers visible but unavailable', async () => {
  const { findMediaStudio } = await import('../../../shared/studio-catalog');
  const { studioDestination } = await import('./creativeStudios');
  const base = { modality: 'image' as const, mode: 'text-to-image' as const, source: 'live' as const };
  const seedream: Model = { ...base, id: 'account:seedream-5.5', provider: 'account', modelId: 'seedream-5.5', label: 'seedream-5.5' };
  const flare: Model = { ...base, id: 'account:gpt-image-2.6-flare', provider: 'account', modelId: 'gpt-image-2.6-flare', label: 'gpt-image-2.6-flare' };
  const nano: Model = { ...base, id: 'account:nano-banana-2', provider: 'account', modelId: 'nano-banana-2', label: 'nano-banana-2' };
  const flux: Model = { ...base, id: 'fal:fal-ai/flux/schnell', provider: 'fal', modelId: 'fal-ai/flux/schnell', label: 'FLUX Schnell' };
  const codex: Model = { ...base, id: 'codex:image-generation', provider: 'codex', modelId: 'image-generation', label: 'Codex Image', source: 'builtin' };
  const catalog = { models: [nano, seedream, flux, flare, codex], status: { routes: {}, providers: [
    { id: 'account', label: 'OpenDesign', available: true }, { id: 'opendesign', label: 'OpenDesign Cloud', available: false },
    { id: 'fal', label: 'fal.ai', available: true }, { id: 'codex', label: 'Codex', available: true },
  ] } };
  const chooseModel = vi.fn();
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', prompt: 'Neon skyline', references: [] }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel, remember: vi.fn(),
    destination: studioDestination(findMediaStudio('design')!, 'text-to-image', seedream.id),
  }} />));
  const options = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  const names = () => options().map(option => option.querySelector('strong')?.textContent);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Provider"]')!.click());
  expect(names()).toEqual(['OpenDesign', 'OpenDesign Cloud', 'Codex']);
  expect(document.querySelector('.om-picker-popover .om-picker-footer')?.textContent).toContain('Manage providers & API keys');
  expect(options()[0].disabled).toBe(false);
  expect(options()[1].disabled).toBe(true);
  expect(options()[1].textContent).toContain('API key required');
  await act(async () => document.querySelector<HTMLButtonElement>('.om-picker-setup')!.click());
  expect(chrome.openProviderSettings).toHaveBeenCalledExactlyOnceWith('opendesign');
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')!.click());
  // Only the chosen provider's models from the fixed list; others such as Nano Banana and FLUX are not offered.
  expect(names()).toEqual(['GPT Image 2.6 Flare', 'Seedream 5.5']);
  expect(document.querySelector('.om-picker-popover .om-picker-footer')).toBeNull();
  await act(async () => options()[0].click());
  expect(chooseModel).toHaveBeenCalledExactlyOnceWith(flare.id);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Provider"]')!.click());
  await act(async () => options()[2].click());
  expect(chooseModel).toHaveBeenLastCalledWith(codex.id);
});

it('offers only OpenDesign providers for feature entries and keeps the prompt while asking for setup', async () => {
  const { findMediaStudio } = await import('../../../shared/studio-catalog');
  const { studioDestination } = await import('./creativeStudios');
  const base = { modality: 'image' as const, mode: 'text-to-image' as const, source: 'live' as const, supportsImageReference: true, maxInputImages: 1 };
  const cloud: Model = { ...base, id: 'opendesign:seedream-5.5', provider: 'opendesign', modelId: 'seedream-5.5', label: 'seedream-5.5' };
  const flux: Model = { ...base, id: 'fal:fal-ai/flux/schnell', provider: 'fal', modelId: 'fal-ai/flux/schnell', label: 'FLUX Schnell' };
  const codex: Model = { ...base, id: 'codex:image-generation', provider: 'codex', modelId: 'image-generation', label: 'Codex Image', source: 'builtin' };
  const chooseModel = vi.fn();
  const render = (sceneId: 'relight' | 'text-to-image', models: Model[], providers: { id: string; label: string; available: boolean }[]) => act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', prompt: 'Neon skyline', references: [] }} studio={{
    catalog: { catalog: { models, status: { routes: {}, providers } }, failed: false, retry: vi.fn() }, chooseModel, remember: vi.fn(),
    destination: studioDestination(findMediaStudio('design')!, sceneId, null),
  }} />));
  const names = () => [...document.querySelectorAll('[role="option"] strong')].map(node => node.textContent);
  // Ordinary non-feature Studio entries keep Codex Image alongside OpenDesign and persist choices via studio.chooseModel.
  await render('text-to-image', [flux, cloud, codex], [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }, { id: 'fal', label: 'fal.ai', available: true }, { id: 'codex', label: 'Codex', available: true }, { id: 'account', label: 'OpenDesign', available: false }]);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Provider"]')!.click());
  expect(names()).toEqual(['OpenDesign Cloud', 'OpenDesign', 'Codex']);
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')][2].click());
  expect(chooseModel).toHaveBeenCalledWith(codex.id);
  // Feature scenes restrict strictly to OpenDesign providers and preserve the prompt when OpenDesign needs setup.
  await render('relight', [flux, cloud, codex], [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }, { id: 'fal', label: 'fal.ai', available: true }, { id: 'codex', label: 'Codex', available: true }, { id: 'account', label: 'OpenDesign', available: false }]);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Provider"]')!.click());
  expect(names()).toEqual(['OpenDesign Cloud', 'OpenDesign']);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')!.click());
  expect(names()).toEqual(['Seedream 5.5']);
  await render('relight', [flux], [{ id: 'opendesign', label: 'OpenDesign Cloud', available: false }, { id: 'fal', label: 'fal.ai', available: true }, { id: 'account', label: 'OpenDesign', available: false }]);
  const submit = container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
  expect(submit.textContent).toBe('Relight');
  expect(submit.disabled).toBe(true);
  await act(async () => submit.click());
  expect(chrome.openProviderSettings).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLTextAreaElement>('.om-image-prompt')!.value).toBe('Neon skyline');
  expect(generate).not.toHaveBeenCalled();
});

it('preserves configured BYOK models on an unpinned ordinary Assets library draft', async () => {
  const flux: Model = { id: 'fal:fal-ai/flux/schnell', provider: 'fal', modelId: 'fal-ai/flux/schnell', label: 'FLUX Schnell', modality: 'image', mode: 'text-to-image', source: 'builtin' };
  loadGateway.mockResolvedValue({ models: [flux], status: { routes: { image: flux.id }, providers: [{ id: 'fal', label: 'fal.ai', available: true }] } });
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', prompt: 'Sunrise poster', references: [] }} />));
  const submit = container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
  expect(submit.disabled).toBe(false);
  generate.mockResolvedValue({ job: { id: 'fal-job' } });
  await act(async () => submit.click());
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: flux.id, prompt: 'Sunrise poster' }));
});

const featureModels = () => {
  const base = { modality: 'image' as const, mode: 'text-to-image' as const, source: 'live' as const, supportsImageReference: true, maxInputImages: 16 };
  return {
    sunburst: { ...base, id: 'opendesign:gpt-image-2.6-sunburst', provider: 'opendesign', modelId: 'gpt-image-2.6-sunburst', label: 'gpt-image-2.6-sunburst' } as Model,
    flare: { ...base, id: 'opendesign:gpt-image-2.6-flare', provider: 'opendesign', modelId: 'gpt-image-2.6-flare', label: 'gpt-image-2.6-flare' } as Model,
    seedream: { ...base, id: 'opendesign:seedream-5.5', provider: 'opendesign', modelId: 'seedream-5.5', label: 'seedream-5.5' } as Model,
    flash: { ...base, id: 'opendesign:seedream-5.0-flash', provider: 'opendesign', modelId: 'seedream-5.0-flash', label: 'seedream-5.0-flash', maxInputImages: 10 } as Model,
    accountGpt: { ...base, id: 'account:gpt-image-2.6-sunburst', provider: 'account', modelId: 'gpt-image-2.6-sunburst', label: 'gpt-image-2.6-sunburst' } as Model,
  };
};
async function renderFeature(scene: 'remove-background' | 'relight' | 'character', draft: Partial<AssetDraft>) {
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const models = Object.values(featureModels());
  const catalog = { models, status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }, { id: 'account', label: 'OpenDesign', available: true }] } };
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', prompt: '', references: [], ...draft }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: sceneDestination(studioScenes.find(item => item.id === scene)!),
  }} />));
}
const optionNames = () => [...document.querySelectorAll('[role="option"] strong')].map(node => node.textContent);
const reference = (id: string) => ({ reference: { assetId: id, versionId: 'v1' }, name: id });

it('removes an image reference only when its remove button is activated', async () => {
  const references = [reference('first'), reference('second')];
  await renderFeature('character', { references });
  const row = container.querySelector('.om-scene-source-file')!;
  await act(async () => row.querySelector('span')!.click());
  expect(props.setDraft).not.toHaveBeenCalled();

  await act(async () => row.querySelector('button')!.click());
  expect(props.setDraft).toHaveBeenCalledTimes(1);
  const [update] = vi.mocked(props.setDraft).mock.calls[0];
  expect(typeof update === 'function' ? update({ ...props.draft, references }).references : update.references).toEqual([references[1]]);
});

it('removes a background with GPT Image 2.6 on either OpenDesign route, an optional prompt and a fixed transparent background', async () => {
  await renderFeature('remove-background', { references: [reference('product')] });
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Provider"]')!.click());
  expect(optionNames()).toEqual(['OpenDesign Cloud', 'OpenDesign']);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Provider"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')!.click());
  expect(optionNames()).toEqual(['GPT Image 2.6 Flare', 'GPT Image 2.6 Sunburst']);
  expect(container.querySelector('.om-scene-source')?.textContent).not.toContain('The result is a PNG with a transparent background.');
  const settings = container.querySelector<HTMLButtonElement>('.om-generation-summary')!;
  expect(settings.getAttribute('data-form-control')).toBe('boxed');
  expect(document.getElementById(settings.getAttribute('aria-labelledby')!)?.textContent).toBe('Generation settings');
  await act(async () => settings.click());
  expect(document.querySelector('.om-generation-popover')?.textContent).toContain('Quality');
  expect(document.querySelector('.om-generation-popover')?.textContent).not.toContain('Background');
  const picker = container.querySelector('.om-creation-model')!;
  const submit = container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
  expect(settings.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(picker.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(submit.parentElement).toBe(container.querySelector('.om-asset-direct-scroll > .om-image-submit:last-child'));
  expect(submit.disabled).toBe(false);
  generate.mockResolvedValue({ job: { id: 'job' } });
  await act(async () => submit.click());
  const request = generate.mock.calls[0][0];
  expect(request).toMatchObject({ model: 'opendesign:gpt-image-2.6-sunburst', parameters: { background: 'transparent' }, references: [{ assetId: 'product', versionId: 'v1' }] });
  expect(request.prompt).toMatch(/^Remove the entire background.*transparent background/);
});

it('seeds GPT Image 2.6 studio generation to medium quality by default and forwards quality=medium on submit', async () => {
  const { findMediaStudio } = await import('../../../shared/studio-catalog');
  const { studioDestination } = await import('./creativeStudios');
  const { generationOptions } = await import('../../../shared/generation-options');
  const base: Model = {
    id: 'account:gpt-image-2.6-flare',
    provider: 'account',
    modelId: 'gpt-image-2.6-flare',
    label: 'gpt-image-2.6-flare',
    modality: 'image',
    mode: 'text-to-image',
    source: 'live',
    supportsImageReference: true,
    maxInputImages: 16,
    nativeOptions: { quality: { values: ['high', 'low', 'medium'], default: 'low' } },
  };
  const flare: Model = { ...base, generationOptions: generationOptions(base) };
  const catalog = { models: [flare], status: { routes: {}, providers: [{ id: 'account', label: 'OpenDesign', available: true }] } };
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', prompt: 'Amber glass bottle', references: [] }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: studioDestination(findMediaStudio('design')!, 'text-to-image', flare.id),
  }} />));
  expect(container.querySelector('.om-generation-summary')?.textContent).toBe('Quality medium');
  generate.mockResolvedValue({ job: { id: 'gpt-medium' } });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    model: flare.id,
    parameters: { quality: 'medium' },
  }));

  // Explicit Advanced JSON quality must override the Studio medium default, and Reset must return to medium.
  await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());
  const advancedInput = document.querySelector<HTMLTextAreaElement>('.om-generation-popover textarea[aria-label="Model parameters"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(advancedInput, '{"quality":"high"}');
    advancedInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector('.om-generation-summary')?.textContent).toBe('Quality high');
  generate.mockClear();
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    model: flare.id,
    parameters: { quality: 'high' },
  }));
  await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());
  const resetButton = [...document.querySelectorAll<HTMLButtonElement>('.om-generation-popover button')].find(btn => btn.textContent === 'Reset')!;
  await act(async () => resetButton.click());
  expect(container.querySelector('.om-generation-summary')?.textContent).toBe('Quality medium');
});

it('relights one image with Seedream 5.5 by default and writes the chosen light into the prompt', async () => {
  await renderFeature('relight', { prompt: 'Keep the logo sharp.', references: [reference('room')], relight: { direction: 'back', temperature: 'cool', mood: 'neon' } });
  expect(container.querySelector('.om-asset-composer')?.getAttribute('data-form-surface')).toBe('subtle');
  expect([...container.querySelectorAll('.om-relight-field .om-eyebrow')].map(node => node.textContent)).toEqual(['Light direction', 'Color temperature', 'Lighting mood']);
  expect(container.querySelectorAll('.om-relight-field [data-form-control="boxed"]')).toHaveLength(3);
  expect(container.querySelectorAll('.om-creation-model .om-picker-trigger[data-form-control="boxed"]')).toHaveLength(2);
  const promptInput = container.querySelector<HTMLTextAreaElement>('.om-image-prompt')!;
  expect(promptInput.labels?.[0]?.textContent).toBe('Detailed description');
  expect(promptInput.parentElement?.getAttribute('data-form-field')).toBe('intrinsic');
  expect([...promptInput.parentElement!.children]).toEqual([promptInput]);
  expect(promptInput.maxLength).toBe(20000);
  expect(container.querySelector('button[aria-label="Generation model"]')?.textContent).toContain('Seedream 5.5');
  // One reference is the limit, so the picker offers no second one.
  expect(container.querySelector('.om-source-actions')).toBeNull();
  generate.mockResolvedValue({ job: { id: 'job' } });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  const { prompt, model: chosen } = generate.mock.calls[0][0];
  expect(chosen).toBe('opendesign:seedream-5.5');
  expect(prompt).toContain('backlight with a rim of light');
  expect(prompt).toContain('cool color temperature');
  expect(prompt).toContain('neon night lighting');
  expect(prompt.endsWith('Keep the logo sharp.')).toBe(true);
});

it('keeps a character consistent across up to five references and drops Seedream 5.5 from two references', async () => {
  await renderFeature('character', { references: [reference('one')] });
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')!.click());
  expect(optionNames()).toEqual(['GPT Image 2.6 Flare', 'GPT Image 2.6 Sunburst', 'Seedream 5.5', 'Seedream 5.0 Flash']);
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.disabled).toBe(true);
  await act(async () => root.unmount()); root = createRoot(container);
  await renderFeature('character', { prompt: 'Walk through a night market.', model: 'opendesign:seedream-5.5', references: [reference('one'), reference('two')] });
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')!.click());
  expect(optionNames()).toEqual(['GPT Image 2.6 Flare', 'GPT Image 2.6 Sunburst', 'Seedream 5.0 Flash']);
  generate.mockResolvedValue({ job: { id: 'job' } });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  const request = generate.mock.calls[0][0];
  expect(request.model).toBe('opendesign:gpt-image-2.6-sunburst');
  expect(request.prompt).toMatch(/^Keep the character from the reference images consistent.*Walk through a night market\.$/);
  expect(request.references).toHaveLength(2);
});

it('seeds 10s duration and composes camera/multi-shot prompts on video feature scenes', async () => {
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const { generationOptions } = await import('../../../shared/generation-options');
  const seedanceBase: Model = {
    id: 'opendesign:doubao-seedance-2-5-260628', provider: 'opendesign', modelId: 'doubao-seedance-2-5-260628',
    label: 'Seedance 2.5', modality: 'video', mode: 'text-to-video', source: 'live', maxInputImages: 1,
    nativeOptions: { durations: [5, 4, 6, 7, 8, 9, 10, 12, 15], resolutions: ['480p', '720p', '1080p'], ratios: ['16:9', '9:16', 'adaptive'], audio: { values: ['on', 'off'], default: 'on' } },
  };
  const seedance: Model = { ...seedanceBase, generationOptions: generationOptions(seedanceBase) };
  const catalog = { models: [seedance], status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] } };
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'video', prompt: 'An astronaut crossing a silver ridge', references: [], videoChoices: { shots: '3', style: 'narrative' } }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: sceneDestination(studioScenes.find(item => item.id === 'video-multi-shot')!),
  }} />));
  expect([...container.querySelectorAll('.om-relight-field .om-eyebrow')].map(node => node.textContent)).toEqual(['Shot count', 'Shot progression']);
  expect(container.querySelector('.om-scene-source')?.textContent).toContain('First frame');
  generate.mockResolvedValue({ job: { id: 'video-job' } });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  const request = generate.mock.calls[0][0];
  expect(request.model).toBe(seedance.id);
  expect(request.parameters).toMatchObject({ duration: 10 });
  expect(request.prompt).toContain('3-shot narrative sequence');
  expect(request.prompt).toContain('An astronaut crossing a silver ridge');
});

it('exposes the native audio toggle on Text to video and preserves user control over generate_audio', async () => {
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const { generationOptions } = await import('../../../shared/generation-options');
  const seedanceBase: Model = {
    id: 'opendesign:doubao-seedance-2-5-260628', provider: 'opendesign', modelId: 'doubao-seedance-2-5-260628',
    label: 'Seedance 2.5', modality: 'video', mode: 'text-to-video', source: 'live', maxInputImages: 1,
    nativeOptions: { durations: [5, 4, 6, 10], resolutions: ['480p', '720p', '1080p'], ratios: ['16:9', '9:16', 'adaptive'], audio: { values: ['on', 'off'], default: 'on' } },
  };
  const seedance: Model = { ...seedanceBase, generationOptions: generationOptions(seedanceBase) };
  const catalog = { models: [seedance], status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] } };
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'video', prompt: 'Rain in a neon alley', references: [] }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: sceneDestination(studioScenes.find(item => item.id === 'text-to-video')!),
  }} />));
  const audioSwitch = container.querySelector('[role="switch"]');
  expect(audioSwitch).not.toBeNull();
  expect(audioSwitch?.getAttribute('aria-checked')).toBe('true');
  generate.mockResolvedValue({ job: { id: 'audio-video-job' } });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click());
  const request = generate.mock.calls[0][0];
  expect(request.prompt).toBe('Rain in a neon alley');
});

it('renders VideoMegaMenu with open video scenes, Omni reference, Soon items, and OpenDesign video models', async () => {
  const { VideoMegaMenu } = await import('./VideoMegaMenu');
  const navigate = vi.fn();
  const seedance: Model = { id: 'opendesign:doubao-seedance-2-5-260628', provider: 'opendesign', modelId: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5', modality: 'video', mode: 'text-to-video', source: 'live', maxInputImages: 1 };
  const wan: Model = { id: 'opendesign:wan-2.7', provider: 'opendesign', modelId: 'wan-2.7', label: 'Wan 2.7', modality: 'video', mode: 'text-to-video', source: 'live', maxInputImages: 1 };
  await act(async () => root.render(<VideoMegaMenu
    catalog={{ models: [seedance, wan], status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] } }}
    destination={null}
    onNavigate={navigate}
  />));
  const buttons = [...container.querySelectorAll('button')];
  expect(buttons.some(button => button.textContent?.includes('Create video') && !button.disabled)).toBe(true);
  expect(buttons.some(button => button.textContent?.includes('Camera control') && !button.disabled)).toBe(true);
  expect(buttons.some(button => button.textContent?.includes('Start & end frames') && button.disabled)).toBe(true);
  expect(buttons.some(button => button.textContent?.includes('Omni reference') && button.disabled)).toBe(true);
  expect(buttons.some(button => button.textContent?.includes('Native audio video'))).toBe(false);
  expect(buttons.some(button => button.textContent?.includes('Video first frame'))).toBe(false);
  expect(buttons.some(button => button.textContent?.includes('Seedance 2.5') && !button.disabled)).toBe(true);
  expect(buttons.some(button => button.textContent?.includes('Wan 2.7') && !button.disabled)).toBe(true);
  expect(buttons.some(button => button.textContent?.includes('Seedance 2.5 Flash') && button.disabled)).toBe(true);
  await act(async () => buttons.find(button => button.textContent?.includes('Multi-shot'))!.click());
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ scene: expect.objectContaining({ id: 'video-multi-shot' }), model: null }));
});

it('automatically includes newly published capable OpenDesign models in feature pickers without hardcoded allowlists', async () => {
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const existing = featureModels();
  const futureTransparent: Model = {
    id: 'opendesign:future-studio-image-v3',
    provider: 'opendesign',
    modelId: 'future-studio-image-v3',
    label: 'Future Studio Image v3',
    modality: 'image',
    mode: 'text-to-image',
    source: 'live',
    supportsImageReference: true,
    maxInputImages: 8,
    nativeOptions: { background: ['opaque', 'transparent'] },
  };
  const futureTextOnly: Model = {
    id: 'opendesign:future-txt2img-only',
    provider: 'opendesign',
    modelId: 'future-txt2img-only',
    label: 'Future Txt2Img Only',
    modality: 'image',
    mode: 'text-to-image',
    source: 'live',
    supportsImageReference: false,
    maxInputImages: 0,
  };
  const catalog = {
    models: [existing.sunburst, existing.seedream, futureTransparent, futureTextOnly],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', prompt: '', references: [reference('product')] }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: sceneDestination(studioScenes.find(item => item.id === 'remove-background')!),
  }} />));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')!.click());
  // Known flagship model stays ranked first; the newly published transparent-capable model joins automatically.
  expect(optionNames()).toEqual(['GPT Image 2.6 Sunburst', 'Future Studio Image v3']);
});

it('drops an unknown single-reference OpenDesign image model when two or more references are attached on Character consistency', async () => {
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const existing = featureModels();
  // Unknown OpenDesign model with supportsImageReference: true and no maxInputImages falls back to limit 1.
  const unknownSingleRef: Model = {
    id: 'opendesign:future-single-ref-image',
    provider: 'opendesign',
    modelId: 'future-single-ref-image',
    label: 'Future Single Ref Image',
    modality: 'image',
    mode: 'text-to-image',
    source: 'live',
    supportsImageReference: true,
  };
  const catalog = {
    models: [existing.sunburst, unknownSingleRef],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', prompt: 'Walk through the park', references: [reference('one')] }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: sceneDestination(studioScenes.find(item => item.id === 'character')!),
  }} />));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')!.click());
  expect(optionNames()).toEqual(['GPT Image 2.6 Sunburst', 'Future Single Ref Image']);

  await act(async () => root.unmount()); root = createRoot(container);
  await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', prompt: 'Walk through the park', references: [reference('one'), reference('two')] }} studio={{
    catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: sceneDestination(studioScenes.find(item => item.id === 'character')!),
  }} />));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')!.click());
  expect(optionNames()).toEqual(['GPT Image 2.6 Sunburst']);
});

it('keeps BYOK text-to-video models eligible in Workflows selectScenarioModels on multi-shot steps', async () => {
  const { selectScenarioModels } = await import('../scenario/steps/stepUtils');
  const { studioScenes } = await import('./creativeStudios');
  const falWan: Model = {
    id: 'fal:fal-ai/wan/v2.2',
    provider: 'fal',
    modelId: 'fal-ai/wan/v2.2',
    label: 'Wan 2.2',
    modality: 'video',
    mode: 'text-to-video',
    source: 'builtin',
  };
  const multiShot = studioScenes.find(item => item.id === 'video-multi-shot')!;
  const selected = selectScenarioModels(
    { models: [falWan], status: { routes: {}, providers: [{ id: 'fal', label: 'fal.ai', available: true }] } } as never,
    'video',
    multiShot,
  );
  expect(selected.map(item => item.id)).toEqual([falWan.id]);
});

it('uses action-verb CTAs for remove-background and relight, exposes full picker tooltips, and aligns video upload actions', async () => {
  const { mediaEditorDestination } = await import('./creativeStudios');
  const existing = featureModels();
  const catalog = {
    models: [existing.sunburst, existing.seedream],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };

  for (const [sceneId, expectedAction] of [
    ['remove-background', 'Remove background'],
    ['relight', 'Relight'],
    ['character', 'Generate image'],
  ] as const) {
    await act(async () => root.render(<AssetComposer {...props} draft={{ modality: 'image', prompt: 'Warm rim light', references: [reference('product')] }} studio={{
      catalog: { catalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
      destination: mediaEditorDestination(sceneId),
    }} />));
    expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')?.textContent).toBe(expectedAction);
    const providerTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="Provider"]');
    const modelTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]');
    expect(providerTrigger?.getAttribute('title')).toBeNull();
    expect(modelTrigger?.getAttribute('title')).toBeNull();
    expect(providerTrigger?.closest('span.contents')).not.toBeNull();
    expect(modelTrigger?.closest('span.contents')).not.toBeNull();
    await act(async () => root.unmount()); root = createRoot(container);
  }

  const seedance: Model = { id: 'opendesign:doubao-seedance-2-5-260628', provider: 'opendesign', modelId: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5', modality: 'video', mode: 'text-to-video', source: 'live', maxInputImages: 1 };
  await act(async () => root.render(<AssetComposer {...props} onUploadReference={vi.fn()} draft={{ modality: 'video', prompt: 'An astronaut', references: [] }} studio={{
    catalog: { catalog: { models: [seedance], status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] } }, failed: false, retry: vi.fn() },
    chooseModel: vi.fn(), remember: vi.fn(),
    destination: mediaEditorDestination('video-multi-shot'),
  }} />));
  const sourceButtons = [...container.querySelectorAll<HTMLButtonElement>('.om-source-actions button')].map(node => node.textContent);
  expect(sourceButtons).toEqual(['Upload image', 'Choose an asset']);
  expect(container.querySelector('.om-studio-form-heading')).toBeNull();
});

it('keeps Character reference upload actions available up to 5 images even with a 1-ref model selected or before setup', async () => {
  const { mediaEditorDestination } = await import('./creativeStudios');
  const existing = featureModels();
  const multiCatalog = {
    models: [existing.sunburst, existing.seedream],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };
  const oneRef = [reference('hero-1')];
  const fiveRefs = ['hero-1', 'hero-2', 'hero-3', 'hero-4', 'hero-5'].map(id => reference(id));

  // Even when Seedream 5.5 (1-ref) is selected, Character reference keeps Upload/Choose open because Sunburst (multi-ref) is available.
  await act(async () => root.render(<AssetComposer {...props} onUploadReference={vi.fn()} draft={{ modality: 'image', prompt: 'Hero in Tokyo', model: existing.seedream.id, references: oneRef }} studio={{
    catalog: { catalog: multiCatalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: mediaEditorDestination('character'),
  }} />));
  expect(container.querySelector('.om-source-actions')).not.toBeNull();
  await act(async () => root.unmount()); root = createRoot(container);

  // Hides Upload/Choose once all 5 Character reference slots are filled.
  await act(async () => root.render(<AssetComposer {...props} onUploadReference={vi.fn()} draft={{ modality: 'image', prompt: 'Hero in Tokyo', references: fiveRefs }} studio={{
    catalog: { catalog: multiCatalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: mediaEditorDestination('character'),
  }} />));
  expect(container.querySelector('.om-source-actions')).toBeNull();
  await act(async () => root.unmount()); root = createRoot(container);

  // Before provider setup (!selected), Character reference still allows attaching up to 5 images.
  await act(async () => root.render(<AssetComposer {...props} onUploadReference={vi.fn()} draft={{ modality: 'image', prompt: 'Hero in Tokyo', references: oneRef }} studio={{
    catalog: { catalog: { models: [], status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: false }] } }, failed: false, retry: vi.fn() },
    chooseModel: vi.fn(), remember: vi.fn(),
    destination: mediaEditorDestination('character'),
  }} />));
  expect(container.querySelector('.om-source-actions')).not.toBeNull();
  await act(async () => root.unmount()); root = createRoot(container);

  // While catalog is still loading (undefined), Character reference falls back to its 5-image limit.
  await act(async () => root.render(<AssetComposer {...props} onUploadReference={vi.fn()} draft={{ modality: 'image', prompt: 'Hero in Tokyo', references: oneRef }} studio={{
    catalog: { catalog: undefined, failed: false, retry: vi.fn() },
    chooseModel: vi.fn(), remember: vi.fn(),
    destination: mediaEditorDestination('character'),
  }} />));
  expect(container.querySelector('.om-source-actions')).not.toBeNull();
  await act(async () => root.unmount()); root = createRoot(container);

  // Going from 1 -> 2 references with Seedream 5.5 selected switches the active model to Sunburst.
  await act(async () => root.render(<AssetComposer {...props} onUploadReference={vi.fn()} draft={{ modality: 'image', prompt: 'Hero in Tokyo', model: existing.seedream.id, references: [reference('hero-1'), reference('hero-2')] }} studio={{
    catalog: { catalog: multiCatalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: mediaEditorDestination('character'),
  }} />));
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="Generation model"]')?.textContent).toContain('GPT Image 2.6 Sunburst');
  expect(container.querySelector('.om-source-actions')).not.toBeNull();
  await act(async () => root.unmount()); root = createRoot(container);

  // When only a 1-ref model is available on Character reference, Upload/Choose closes after 1 image.
  await act(async () => root.render(<AssetComposer {...props} onUploadReference={vi.fn()} draft={{ modality: 'image', prompt: 'Hero in Tokyo', references: oneRef }} studio={{
    catalog: { catalog: { models: [existing.seedream], status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] } }, failed: false, retry: vi.fn() },
    chooseModel: vi.fn(), remember: vi.fn(),
    destination: mediaEditorDestination('character'),
  }} />));
  expect(container.querySelector('.om-source-actions')).toBeNull();
  await act(async () => root.unmount()); root = createRoot(container);

  // Single-reference features (remove-background) still close after 1 image.
  await act(async () => root.render(<AssetComposer {...props} onUploadReference={vi.fn()} draft={{ modality: 'image', prompt: '', references: oneRef }} studio={{
    catalog: { catalog: multiCatalog, failed: false, retry: vi.fn() }, chooseModel: vi.fn(), remember: vi.fn(),
    destination: mediaEditorDestination('remove-background'),
  }} />));
  expect(container.querySelector('.om-source-actions')).toBeNull();
  expect(container.querySelector('.om-scene-source-count')).toBeNull();
  expect(container.querySelector('.om-scene-source-files')?.getAttribute('data-layout')).toBeNull();
});

it('shows reference quota counter, compact thumbnail grid, drag/paste upload, stable uploading button, and auto-switch toast', async () => {
  const { mediaEditorDestination } = await import('./creativeStudios');
  const existing = featureModels();
  const multiCatalog = {
    models: [existing.sunburst, existing.seedream],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };
  const onUploadFiles = vi.fn();
  const onInfo = vi.fn();
  const studio = {
    catalog: { catalog: multiCatalog, failed: false, retry: vi.fn() },
    chooseModel: vi.fn(),
    remember: vi.fn(),
    destination: mediaEditorDestination('character'),
  };

  // 1 reference with Seedream 5.5 selected -> shows 1 / 5 counter and grid layout.
  await act(async () => root.render(<AssetComposer
    {...props}
    onUploadReference={vi.fn()}
    onUploadFiles={onUploadFiles}
    onInfo={onInfo}
    draft={{ modality: 'image', prompt: 'Hero in Tokyo', model: existing.seedream.id, references: [reference('hero-1')] }}
    studio={studio}
  />));
  expect(container.querySelector('.om-scene-source-count')?.textContent).toBe('1 / 5');
  expect(container.querySelector('.om-scene-source-files')?.getAttribute('data-layout')).toBe('grid');
  expect(container.querySelector('.om-scene-source-file')?.getAttribute('data-layout')).toBe('grid');
  expect(container.querySelector('.om-source-hint')?.textContent).toBe('Drop or paste images here');

  // Dragging & dropping image files onto the reference section triggers onUploadFiles.
  const sourceSection = container.querySelector<HTMLElement>('.om-scene-source')!;
  const dropped = new File(['img'], 'drop.png', { type: 'image/png' });
  const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true });
  Object.defineProperty(dragEnter, 'dataTransfer', { value: { types: ['Files'], files: [dropped] } });
  await act(async () => sourceSection.dispatchEvent(dragEnter));
  expect(sourceSection.getAttribute('data-dragging')).toBe('true');

  const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, 'dataTransfer', { value: { types: ['Files'], files: [dropped] } });
  await act(async () => sourceSection.dispatchEvent(dropEvent));
  expect(sourceSection.getAttribute('data-dragging')).toBeNull();
  expect(onUploadFiles).toHaveBeenCalledWith([dropped], 'drop');

  // Pasting an image works even when focus is on document.body (e.g. after clicking the drop zone).
  onUploadFiles.mockClear();
  const pasted = new File(['clip'], 'clip.png', { type: 'image/png' });
  const bodyImagePaste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(bodyImagePaste, 'clipboardData', {
    value: {
      getData: () => '',
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => pasted }],
      files: [pasted],
    },
  });
  await act(async () => document.body.dispatchEvent(bodyImagePaste));
  expect(bodyImagePaste.defaultPrevented).toBe(true);
  expect(onUploadFiles).toHaveBeenCalledWith([pasted], 'paste');

  // Pasting rich text + image from Word/Excel into the prompt textarea does not hijack text paste.
  onUploadFiles.mockClear();
  const promptTextarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
  const richPaste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(richPaste, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? 'Copied prompt text' : ''),
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => pasted }],
      files: [pasted],
    },
  });
  await act(async () => promptTextarea.dispatchEvent(richPaste));
  expect(richPaste.defaultPrevented).toBe(false);
  expect(onUploadFiles).not.toHaveBeenCalled();

  // Uploading state keeps the upload button mounted/disabled AND disables Generate so credits cannot be spent mid-upload.
  await act(async () => root.render(<AssetComposer
    {...props}
    onUploadReference={vi.fn()}
    onUploadFiles={onUploadFiles}
    uploadingReferences
    onInfo={onInfo}
    draft={{ modality: 'image', prompt: 'Hero in Tokyo', model: existing.seedream.id, references: [reference('hero-1')] }}
    studio={studio}
  />));
  const uploadingBtn = container.querySelector<HTMLButtonElement>('.om-source-actions button')!;
  expect(uploadingBtn.disabled).toBe(true);
  expect(uploadingBtn.textContent).toBe('Uploading…');
  expect(container.querySelector<HTMLButtonElement>('.om-creation-submit-button')?.disabled).toBe(true);

  // Growing from 1 -> 2 references triggers model switch from Seedream 5.5 to Sunburst and emits one info notice.
  await act(async () => root.render(<AssetComposer
    {...props}
    onUploadReference={vi.fn()}
    onUploadFiles={onUploadFiles}
    onInfo={onInfo}
    draft={{ modality: 'image', prompt: 'Hero in Tokyo', model: existing.seedream.id, references: [reference('hero-1'), reference('hero-2')] }}
    studio={studio}
  />));
  expect(container.querySelector('.om-scene-source-count')?.textContent).toBe('2 / 5');
  expect(onInfo).toHaveBeenCalledTimes(1);
  expect(onInfo).toHaveBeenCalledWith('{from} supports 1 reference image. Switched to {to}.');

  // Adding a 3rd reference does not repeat the switch notice.
  onInfo.mockClear();
  await act(async () => root.render(<AssetComposer
    {...props}
    onUploadReference={vi.fn()}
    onUploadFiles={onUploadFiles}
    onInfo={onInfo}
    draft={{ modality: 'image', prompt: 'Hero in Tokyo', model: existing.seedream.id, references: [reference('hero-1'), reference('hero-2'), reference('hero-3')] }}
    studio={studio}
  />));
  expect(onInfo).not.toHaveBeenCalled();
});
