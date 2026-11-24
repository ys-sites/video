import test from "node:test";
import assert from "node:assert/strict";
import { registerOpenMotionTemplateCards } from "../integrations/dsh/plugin/src/templateRecommendationCards.ts";

function fixture() {
  const registered: any[] = [], providers: any[] = [], decisions: any[] = [], follows: any[] = [];
  const ctx = {
    effect: (run: () => unknown) => run(),
    skills: { registerProvider: (provider: unknown) => { providers.push(provider); return () => {}; } },
    actionCards: { register: (kind: unknown) => { registered.push(kind); return () => {}; }, record: (_agent: unknown, decision: unknown) => decisions.push(decision) },
  };
  registerOpenMotionTemplateCards(ctx);
  const agent = { followup: (message: unknown) => follows.push(message) };
  return { ctx, kind: registered[0], provider: providers[0](), decisions, follows, agent };
}
const templates = ["one", "two", "three"].map(id => ({ id, title: id, previewUrl: "https://example.test/" + id + ".mp4" }));

test("DSH onboarding requires three distinct cards and preserves request language and library visibility", async () => {
  const { kind, provider } = fixture();
  assert.equal((await provider.list()).length, 1);
  const definition = await provider.get({ name: "openmotion-template-recommendations" });
  assert.match(definition.content, /installation onboarding/);
  assert.match(definition.content, /exactly the three prepared IDs\/order/);
  assert.match(definition.content, /details.onboarding=true/);
  assert(definition.content.includes("\n\n") && !definition.content.includes("\\n\\n"));
  assert.equal(await provider.get({ name: "unrelated" }), undefined);
  const details = { templates, onboarding: true, language: "zh", libraryOpened: true };
  assert.deepEqual(kind.details.parse(details), details);
  assert.throws(() => kind.details.parse({ ...details, templates: templates.slice(0, 2) }));
  assert.throws(() => kind.details.parse({ templates: [templates[0], templates[0]] }));
  assert.throws(() => kind.details.parse({ templates: [{ id: "bad", title: "bad", posterUrl: "file:///private/file" }] }));
  assert(kind.openPhases.includes("preview-requested"), "Preview must not disable subsequent template selection");
});

test("card preview and selection keep exact IDs and never request automatic project creation", async () => {
  const { kind, decisions, follows, agent } = fixture();
  const proposal = { callId: "call-1", details: { templates } };
  const preview = await kind.act(agent, proposal, "preview", { templateId: "two" });
  assert.equal(preview.status, "settled");
  assert.equal(decisions[0].phase, "preview-requested");
  assert.match(follows[0].content[0].text, /templateId=two/);
  assert.match(follows[0].content[0].text, /Do not create a project/);
  const selected = await kind.act(agent, proposal, "use", { templateId: "three" });
  assert.equal(selected.decision.data.templateId, "three");
  assert.equal(decisions[1].phase, "selected");
  assert.equal(follows[1].source.kind, "user");
  assert.match(follows[1].content[0].text, /Ask for confirmation before creating/);
  assert.equal((await kind.act(agent, proposal, "use", { templateId: "missing" })).status, "refused");
  assert.equal((await kind.act(agent, proposal, "unknown", { templateId: "one" })).status, "refused");
  assert.equal(follows.length, 2);
  assert.equal(decisions.length, 2);
});

test("a host without optional card services retains its existing MCP flow", () => {
  assert.doesNotThrow(() => registerOpenMotionTemplateCards({ effect: () => {}, skills: undefined, actionCards: undefined }));
});
