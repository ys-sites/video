import type { Language } from "../../../../mcp-ui/template-recommendations/types.ts";

export const OPENMOTION_TEMPLATE_ACTION = "openmotion_template_recommendation";
export type RecommendedTemplate = {
  id: string;
  title: string;
  description?: string;
  posterUrl?: string;
  previewUrl?: string;
  duration?: number;
  editable?: boolean;
};
export type RecommendationDetails = {
  templates: RecommendedTemplate[];
  onboarding?: boolean;
  language?: Language;
  libraryOpened?: boolean;
};
