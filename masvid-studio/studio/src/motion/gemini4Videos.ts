import videos from './model-hubs/gemini-4/videos.json';
/** Gemini 4 videos shared on X, collected 2026-11-19. Media stays on the original posts; cards link back to each author. */
export interface HubVideo { id: string; title: string; authorName: string; avatar: string; variant: string; code: boolean; author: string; post: string; views: number; likes: number; poster: string; video: string; source: string; category: string; notes: string; /** English rendering of `notes`, shown outside Chinese. */ notesEn?: string; palette: string[]; duration: number; ratio: string; /** Where the original was shared; only X posts carry view counts. */ platform: 'x' | 'web' }

/** Data lives in JSON: reference palettes are content, not interface colours. */
export const gemini4Videos = videos as HubVideo[];
