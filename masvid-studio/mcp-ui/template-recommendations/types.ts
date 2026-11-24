export { recommendationTemplateIds as templateIds } from '../../shared/onboarding-templates.ts';
import { recommendationTemplateIds } from '../../shared/onboarding-templates.ts';
export type Language = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'es' | 'pt';
export type TemplateId = typeof recommendationTemplateIds[number];
export type TemplateAsset = Readonly<{
  id: string; title: string; description: string; durationSeconds: number;
  kind?: 'reference'; descriptions?: Partial<Record<Language, string>>;
  videoCategories?: Partial<Record<Language, string>>;
} & ({ videoBase64: string; videoMimeType?: 'video/mp4' | 'video/webm'; posterBase64: string; posterMimeType: 'image/jpeg'; videoUrl?: never; posterUrl?: never }
  | { videoUrl: string; posterUrl: string; videoBase64?: never; videoMimeType?: never; posterBase64?: never; posterMimeType?: never })>;
export type TemplateCardsBootstrap = Readonly<{ resourceVersion: string; templates: readonly TemplateAsset[] }>;
export type CreateArgs = Readonly<{
  requestId: string; projectType: 'template'; templateId: string; title: string; requirements: string;
}>;
export type RecommendationCard = Readonly<{
  position: number; templateId: string; title: string; description: string; durationSeconds: number;
  actionRequestId: string; createArgs?: CreateArgs; templateKind?: 'reference';
}>;
export type Recommendation = Readonly<{
  schemaVersion: 1; resourceVersion: string; recommendationId: string;
  cards: readonly RecommendationCard[]; selectionGuide: string;
  onboarding?: boolean; language?: Language;
}>;
export type HostContext = { locale?: string; theme?: string };
export type TemplateCardsHost = {
  sendMessage(params: { role: 'user'; content: { type: 'text'; text: string }[];
    _meta: { 'openai/message': { target: 'active'; send: false } } }): Promise<{ isError?: boolean; [key: string]: unknown }>;
  getHostCapabilities(): { message?: unknown; experimental?: Record<string, unknown> } | undefined;
  getHostContext?(): HostContext | undefined;
};
