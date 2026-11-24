// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { validProperties } from '../../../tracking/core.ts';
import { studioEvents } from '../../../tracking/events.ts';

const sent: { event: string; properties: Record<string, unknown> }[] = [];
vi.mock('./tracking', () => ({ trackMotion: vi.fn(async (event: string, properties: Record<string, unknown>) => { sent.push({ event, properties }); return 'queued'; }) }));

const explore = await import('./exploreTracking');
const pages = await import('./pageTracking');
await (await import('./reporting')).loadReportingTransport();

const of = (event: string) => sent.filter(row => row.event === event);
/** Every report must pass the closed schema the server admits and never carry prompts or display copy. */
function expectAdmitted() {
  for (const row of sent) expect(validProperties(studioEvents, row.event, row.properties), `${row.event} ${JSON.stringify(row.properties)}`).toBe(true);
  expect(JSON.stringify(sent)).not.toMatch(/Describe|First project|prompt/i);
}

beforeEach(() => { sent.length = 0; });

it('admits Studio views and generations, splits real provider:model keys and leaves out custom providers', () => {
  explore.reportCreativePageView('creative_studio', false, { studio: 'cinema', scene: 'text-to-video', model: 'custom-1f2e:my-private-model', landing: true });
  pages.reportAssetGenerationSubmit('video', 'success', 1, false, { studio: 'cinema', scene: 'image-to-video', model: 'fal:bytedance-seedance-2.0' });
  pages.reportAssetGenerationSubmit('image', 'failure', 0, false);
  explore.reportCreativeClick('creative_studio', 'studio_bar', 'scene_tab', { studio: 'design', scene: 'image-edit', model: null });
  expect(of('page_view')[0].properties).toMatchObject({ page_name: 'creative_studio', studio_id: 'cinema', scene_id: 'text-to-video', landing: true });
  expect(of('page_view')[0].properties).not.toHaveProperty('model_id');
  expect(of('page_view')[0].properties).not.toHaveProperty('model_provider');
  expect(of('asset_generation_submit_result').map(row => row.properties)).toEqual([
    expect.objectContaining({ page_name: 'creative_studio', studio_id: 'cinema', scene_id: 'image-to-video', model_provider: 'fal', model_id: 'bytedance-seedance-2.0', modality: 'video' }),
    { page_name: 'assets', modality: 'image', outcome: 'failure', reference_count: 0, new_version: false },
  ]);
  expectAdmitted();
});
