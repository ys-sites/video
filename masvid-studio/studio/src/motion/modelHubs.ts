import geminiPoster from './model-hubs/gemini-4.svg?url';
import { gemini4Videos, type HubVideo } from './gemini4Videos';

/** Local posters for posts whose X cover is a blank first frame; captured mid-video. */
const posterOverrides: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob('./model-hubs/gemini-4/posters/*.jpg', { query: '?url', import: 'default', eager: true }) as Record<string, string>)
  .map(([path, url]) => [path.split('/').pop()!.replace(/\.jpg$/, ''), url]));
const withPoster = (video: HubVideo): HubVideo => posterOverrides[video.id] ? { ...video, poster: posterOverrides[video.id] } : video;

/**
 * Model hubs are editorial landing pages for a model family. Facts come from the
 * vendor's own announcement; availability is always read from the live gateway
 * catalog, so a hub never claims a model is usable before a provider serves it.
 */
export interface ModelHub {
  id: string; title: string;
  /** Full name of the model people can use today, shown wherever access is explained. */
  modelName: string;
  /** Full name of the newest release, shown on the Explore banner. */
  latestModel: string; vendor: string; eyebrow: string; summary: string; poster: string;
  /** Matches gateway model ids or model ids served for this family. */
  modelPattern: RegExp;
  /** Matches companion media models from the same vendor already in the catalog. */
  companionPattern: RegExp;
  provider: string;
  /** Community videos made with this family; media stays on the original posts. */
  videos: HubVideo[];
}

export const modelHubs: ModelHub[] = [{
  id: 'gemini-4', title: 'Gemini 4', modelName: 'Gemini 4 Argon', latestModel: 'Gemini 4 Neon', vendor: 'Google DeepMind', eyebrow: 'New model',
  summary: 'Google’s newest frontier model writes whole animations in code. The hottest Gemini 4 videos on X are all here.',
  poster: geminiPoster, provider: 'gemini',
  modelPattern: /gemini-4/i, companionPattern: /google\/|nano-banana|veo|imagen/i,
  videos: gemini4Videos.map(withPoster),
}];

export const findModelHub = (id: string | null | undefined) => modelHubs.find(hub => hub.id === id) ?? null;
