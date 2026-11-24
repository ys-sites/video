// Reports for Explore, the top creative navigation and the creative Studio pages (Design, Cinema, Sound,
// Motion landing and model overview). They follow the page_name + area + element convention of the
// other page reporters. Destinations are catalogue ids only; prompts, example copy and model labels never leave the browser.
import type { StudioDestination } from './creativeStudios';
import { embeddedView, modelFields, newTrackingId, optionId, send, slugField, type Fields } from './reporting';

type Click = Fields<'ui_click'>;
export type CreativePage = NonNullable<Click['page_name']>;
type CreativeArea = Extract<Click['area'], 'creative_nav' | 'explore_tabs' | 'explore_spotlight' | 'explore_featured' | 'explore_feed' | 'explore_collection' | 'capability_index' | 'studio_bar' | 'model_overview'>;
type Medium = NonNullable<Click['medium']>;

/** What a click or view is about, as catalogue ids. Values that are not bounded slugs are left out. */
export type CreativeTarget = {
  studio?: string; scene?: string; model?: string | null; skill?: string; template?: string; community?: string | null;
  navTarget?: string; slide?: string; collection?: string; medium?: Medium | null; position?: number; inOverflow?: boolean;
  client?: Click['mcp_client']; expanded?: boolean; selected?: boolean;
};

export const destinationTarget = (destination: StudioDestination | null | undefined): CreativeTarget =>
  destination ? { studio: destination.studio.id, scene: destination.scene.id, model: destination.model } : {};

function targetFields(target: CreativeTarget) {
  return {
    ...slugField('studio_id', target.studio), ...slugField('scene_id', target.scene), ...modelFields(target.model),
    ...slugField('skill_id', target.skill), ...slugField('template_id', target.template), ...slugField('explore_community', target.community ?? undefined),
    ...slugField('nav_target', target.navTarget), ...slugField('slide_id', target.slide), ...slugField('collection_id', target.collection),
    ...(target.medium ? { medium: target.medium } : {}), ...(target.position === undefined ? {} : { position: target.position }),
    ...(target.inOverflow === undefined ? {} : { in_overflow: target.inOverflow }), ...(target.client ? { mcp_client: target.client } : {}),
    ...(target.expanded === undefined ? {} : { expanded: target.expanded }), ...(target.selected === undefined ? {} : { selected: target.selected }),
  };
}

export function reportCreativeClick(page: CreativePage, area: CreativeArea, element: Click['element'], target: CreativeTarget = {}) {
  send('ui_click', { page_name: page, area, element, ...targetFields(target) });
}

type ViewPage = Extract<CreativePage, 'explore' | 'creative_studio' | 'model_overview'>;
export function reportCreativePageView(page: ViewPage, hasProject: boolean, target: CreativeTarget & { landing?: boolean } = {}) {
  const { studio, scene, model, community, medium, landing } = target;
  send('page_view', { page_name: page, view_id: newTrackingId(), embedded: embeddedView(), has_project: hasProject,
    ...slugField('studio_id', studio), ...slugField('scene_id', scene), ...modelFields(model),
    ...slugField('explore_community', community ?? undefined), ...(medium ? { medium } : {}), ...(landing === undefined ? {} : { landing }) });
}



// ---------- Model hub ----------
type HubArea = Extract<Click['area'], `hub_${string}`>;
/** A model hub click. Video titles, creators and search text never become fields; a scene filter is sent as a stable id. */
export function reportHubClick(hub: string, area: HubArea, element: Click['element'],
  fields: { video?: string; position?: number; model?: string; signedIn?: boolean; filter?: string; action?: Click['template_action'] } = {}) {
  const { video, position, model, signedIn, filter, action } = fields;
  const filterId = filter === undefined ? {} : optionId(filter);
  send('ui_click', { page_name: 'model_hub', area, element, ...slugField('hub_id', hub), ...slugField('hub_video_id', video), ...modelFields(model),
    ...(position === undefined ? {} : { position }), ...(signedIn === undefined ? {} : { signed_in: signedIn }), ...filterId, ...(action ? { template_action: action } : {}) });
}
export function reportHubPageView(hub: string, hasProject: boolean, signedIn: boolean) {
  send('page_view', { page_name: 'model_hub', view_id: newTrackingId(), embedded: embeddedView(), has_project: hasProject, ...slugField('hub_id', hub), signed_in: signedIn });
}
