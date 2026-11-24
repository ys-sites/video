import { z } from "zod";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { languages } from "../../../../mcp-ui/template-recommendations/i18n.ts";
import { OPENMOTION_TEMPLATE_ACTION } from "./templateRecommendationAction.ts";

const mediaUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && (url.protocol === "https:" ||
    (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
}, "Use HTTPS or a local Studio media URL");
const templateSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  posterUrl: mediaUrl.optional(),
  previewUrl: mediaUrl.optional(),
  duration: z.number().finite().nonnegative().optional(),
  editable: z.boolean().optional(),
});
export const detailsSchema = z.object({
  templates: z.array(templateSchema).min(1).max(6),
  onboarding: z.boolean().optional(),
  language: z.enum(languages).optional(),
  libraryOpened: z.boolean().optional(),
}).superRefine((details, ctx) => {
  const ids = details.templates.map(template => template.id);
  if (new Set(ids).size !== ids.length || (details.onboarding && ids.length !== 3))
    ctx.addIssue({ code: "custom", message: "Use distinct templates and exactly three for onboarding" });
});
const selectionSchema = z.object({ templateId: z.string().min(1).max(200) });

const skill = {
  name: "openmotion-template-recommendations",
  description: "Show interactive OpenMotion template recommendation cards during installation onboarding or when the user asks for template ideas. Load this before recommending templates; choosing a card does not create a project until the user explicitly confirms.",
  provider: "openmotion-dsh",
  source: "bundled",
  rank: 600,
  locator: "openmotion-template-recommendations",
  invocation: { modelInvocable: true, userInvocable: false },
};

export function registerOpenMotionTemplateCards(ctx: any): void {
  const skills = ctx.skills;
  if (skills?.registerProvider) {
    ctx.effect(() => skills.registerProvider(() => ({
      name: skill.provider,
      list: () => Promise.resolve([skill]),
      get: (candidate: { name: string }) => candidate.name !== skill.name ? Promise.resolve(undefined) : Promise.resolve({
        ...skill,
        content: [
          "For OpenMotion installation onboarding and template recommendations, load this skill first. Follow the shared docs/install.md onboarding contract. During installation use exactly the three prepared IDs/order from scripts/install-onboarding.mjs --host deepseek; do not resample. Use the latest user-request language.",
          "Use openmotion_list_templates and openmotion_get_template to inspect candidate templates.",
          `Then call propose_action with action=${OPENMOTION_TEMPLATE_ACTION}, a concise title and brief, and details.templates containing one to six candidates. Include each candidate's exact id, title, description, posterUrl, previewUrl, duration and whether it is editable when available. For installation use cardPresentation.arguments from the installer: details.onboarding=true and details.language set to the request language. The native card opens the template library beside the current chat and confirms its loading; do not open a sample project or invent a libraryOpened claim. Show the shared welcome above exactly three cards, without repeating it in prose. Do not call openmotion_show_template_recommendations unless that separate MCP App tool is actually available. Do not call openmotion_create_project for a recommendation alone.`,
          "After the user chooses a card, continue with the selected template ID and ask for confirmation before creating an editable project.",
        ].join("\n\n"),
      }),
    })), "openmotion-dsh: template recommendation skill");
  }

  const actionCards = ctx.actionCards;
  if (!actionCards?.register) return;
  ctx.effect(() => actionCards.register({
    action: OPENMOTION_TEMPLATE_ACTION,
    skill: skill.name,
    details: detailsSchema,
    invitation: "Invite the user to preview a card or choose a template. Do not say that a project has already been created.",
    verbs: { preview: {}, use: {} },
    openPhases: ["failed", "unconfirmed", "preview-requested", "selected"],
    statusGuidance: "An OpenMotion template card is a recommendation only. Preview opens the selected template; use records the user's selection so the next turn can ask for confirmation. Neither action creates or overwrites a project.",
    act: async (agent: any, proposal: any, verb: string, payload: unknown) => {
      if (verb !== "preview" && verb !== "use") return { status: "refused", reason: "unavailable" };
      const details = detailsSchema.parse(proposal.details);
      const selection = selectionSchema.parse(payload);
      const template = details.templates.find((item) => item.id === selection.templateId);
      if (!template) return { status: "refused", reason: "template-unavailable" };
      const actionText = verb === "preview" ? "Open the template library preview" : "The user selected this template";
      agent.followup(createUserMessage({
        content: [{ type: "text", text: `${actionText}: ${template.title} (templateId=${template.id}). Preserve the user's choice. ${verb === "use" ? "Ask for confirmation before creating an editable project from it." : "Do not create a project just to preview it."}` }],
        source: { kind: "user" },
      }));
      const decision = {
        callId: proposal.callId,
        action: OPENMOTION_TEMPLATE_ACTION,
        phase: verb === "preview" ? "preview-requested" : "selected",
        data: { templateId: template.id },
      };
      actionCards.record(agent, decision);
      return { status: "settled", decision };
    },
  }), "openmotion-dsh: template recommendation cards");
}
