import { IconGlyph } from "../../../../packages/design-system/react/IconGlyph";
import { useHostTheme } from "./theme";
import React, { useEffect, useState } from "react";
import { registerEditingWorkspace } from "./editing";
import { studio, configureStudio, studioAssetUrl } from "./studio";
import { useDashboardList } from "./useDashboardList";
import { OPENMOTION_TEMPLATE_ACTION } from "./templateRecommendationAction";
import { TemplateRecommendationCard } from "./TemplateRecommendationCard";
const selectedKey = "openmotion-dsh-project";
type Page = "home" | "templates" | "brands" | "assets";
const pageNames: Record<Page, string> = {
  home: "Workspace",
  templates: "Templates",
  brands: "Brand Kits",
  assets: "Assets",
};
function libraryUrl(page: Page, templateId: string | null): string {
  if (page === "templates")
    return (
      studio +
      "/?hostChrome=1&templates=1" +
      (templateId ? "&template=" + encodeURIComponent(templateId) : "")
    );
  return (
    studio +
    "/?hostChrome=1&page=" +
    (page === "brands" ? "brand-kit" : "assets")
  );
}
type Project = { id: string; title: string; trashedAt?: number };
type Template = {
  id: string;
  title: string;
  description?: string;
  posterUrl?: string;
  previewUrl?: string;
  duration?: number;
  brand?: string;
  hasHtmlProject?: boolean;
  editable?: boolean;
};
function Icon({ name = "play", size = 18 }: { name?: string; size?: number }) {
  const ids: Record<string, string> = {
    play: "ri-play-fill",
    arrow: "ri-arrow-right-line",
    grid: "ri-layout-grid-line",
    plus: "ri-add-line",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <IconGlyph id={ids[name] || ids.play} />
    </svg>
  );
}
const Mark = () => (
  <img
    alt=""
    src={studio + "/design-system/brand/favicon.svg"}
    width="24"
    height="24"
  />
);

export function registerTemplateRecommendationBody(ctx: any): void {
  if (!ctx.actionCards?.register) return;
  ctx.effect(() => ctx.locale?.register("openmotionTemplateRecommendations", {
    en: {},
    zh: {},
    ja: {},
    ko: {},
    fr: {},
    es: {},
    de: {},
    ru: {},
    pt: {},
  }));
  ctx.effect(() => ctx.actionCards.register({
    action: OPENMOTION_TEMPLATE_ACTION,
    locale: "openmotionTemplateRecommendations",
    Body: function RecommendationBody(props: React.ComponentProps<typeof TemplateRecommendationCard>) {
      const [libraryOpened, setLibraryOpened] = useState(false);
      useEffect(() => {
        if (!props.proposal.details.onboarding) return;
        const ready = () => setLibraryOpened(true);
        window.addEventListener("openmotion:library-ready", ready);
        // Open the library in the current conversation's native right-hand pane.
        // This is browsing, so do not select or create a project.
        const callId = props.proposal.callId;
        const key = callId ? "omd-onboarding:" + callId : undefined;
        if (!key || localStorage.getItem(key) !== "requested") {
          ctx.sidebarRight.openTab("openmotion-studio", { params: { page: "templates" } });
          const sessionId = ctx.sidebarRight.mounted?.getSnapshot();
          if (sessionId) localStorage.setItem("omd-session-page:" + sessionId, "templates");
          if (key) localStorage.setItem(key, "requested");
        }
        return () => window.removeEventListener("openmotion:library-ready", ready);
      }, [props.proposal.callId, props.proposal.details.onboarding]);
      return <TemplateRecommendationCard {...props} proposal={{ ...props.proposal,
        details: { ...props.proposal.details, libraryOpened } }} />;
    },
  }), "openmotion-dsh: template recommendation body");
}
export function Dashboard({
  begin,
  openConversation,
  openProject,
}: {
  begin: (prompt: string) => void;
  openConversation: () => void;
  openProject: (id: string) => void;
}) {
  const theme = useHostTheme();
  const [page, setPage] = useState<Page>("home"),
    [templateId, setTemplateId] = useState<string | null>(null),
    [project, setProject] = useState(
      localStorage.getItem(selectedKey) || "project",
    );
  const [prompt, setPrompt] = useState("");
  const { items: projects, loading: projectsLoading, error: projectsError, reload: loadProjects } = useDashboardList<Project>(
    "/openmotion-dsh/data/motion-api/projects", "projects", "Could not load projects",
  );
  const { items: templates, loading: templatesLoading, error: templatesError, reload: loadTemplates } = useDashboardList<Template>(
    "/openmotion-dsh/data/api/template-catalog?limit=6&locale=en&covered=true", "items", "Could not load templates",
  );
  const choose = (id: string) => {
    localStorage.setItem(selectedKey, id);
    setProject(id);
    openProject(id);
  };
  const current = projects.find((p) => p.id === project);
  const start = (text = prompt) =>
    begin(
      `${text || "Help me create a short product video. Ask me about the product, audience and style first."}\n\nOpenMotion project: ${current?.title || project} (${project}). Use OpenMotion tools to read the latest project before editing. Confirm the brief with me before creating a new project.`,
    );
  return (
    <section className="omd" data-motion-ui data-theme={theme}>
      <header className="omd-top">
        <div className="omd-breadcrumb">
          <Mark />
          <strong>OpenMotion</strong>
          <span>/</span>
          <span>{pageNames[page]}</span>
        </div>
        <div className="omd-top-right">
          <span className="ui-badge ui-badge--accent">
            <i className="omd-dot" /> Local workspace
          </span>
          <button
            className="ui-button ui-button--ghost ui-button--sm"
            onClick={openConversation}
          >
            Agent chat <Icon name="arrow" size={14} />
          </button>
        </div>
      </header>
      <nav className="omd-nav" aria-label="OpenMotion workspace">
        {[
          ["home", "Overview"],
          ["studio", "Studio"],
          ["templates", "Templates"],
          ["brands", "Brand Kits"],
          ["assets", "Assets"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={page === id ? "page" : undefined}
            className={
              "ui-button ui-button--ghost " +
              (page === id ? "omd-nav-active" : "")
            }
            onClick={() => {
              if (id === "studio") {
                openProject(project);
                return;
              }
              setTemplateId(null);
              setPage(id as Page);
            }}
          >
            {label}
          </button>
        ))}
        <a
          className="omd-external"
          href={studio}
          target="_blank"
          rel="noreferrer"
        >
          Open standalone ↗
        </a>
      </nav>
      {page !== "home" ? (
        <div className="omd-embedded">
          <iframe
            title={"OpenMotion " + page}
            key={page}
            src={libraryUrl(page, templateId)}
            allow="clipboard-write; fullscreen"
          />
        </div>
      ) : (
        <main className="omd-main">
          <div className="omd-kicker">YOUR IDEAS. IN MOTION.</div>
          <div className="omd-heading">
            <div>
              <h1>What will you bring to life?</h1>
              <p>
                Start with an idea. Shape it with your agent. Make it yours in
                Studio.
              </p>
            </div>
            <span className="omd-version">OPENMOTION / DSH</span>
          </div>
          <form
            className="omd-compose"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <label className="omd-sr" htmlFor="omd-prompt">
              Describe your video
            </label>
            <textarea
              id="omd-prompt"
              placeholder="A launch video for your next big thing…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="omd-compose-bottom">
              <span>Idea → Agent → Editable video</span>
              <button className="ui-button ui-button--primary" type="submit">
                Create with agent <Icon name="arrow" size={16} />
              </button>
            </div>
          </form>
          <div className="omd-quick">
            {[
              "Create a product launch",
              "Recreate a reference video",
              "Adapt a template",
            ].map((s) => (
              <button
                className="ui-button ui-button--ghost ui-button--sm"
                key={s}
                onClick={() => setPrompt(s)}
              >
                {s} <span>↗</span>
              </button>
            ))}
          </div>
          <section className="omd-section" aria-label="Projects" aria-busy={projectsLoading}>
            <div className="omd-section-head">
              <h2>Pick up where you left off</h2>
              <button
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={loadProjects}
                disabled={projectsLoading}
              >
                {projectsLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
            {projectsError && (
              <div className="omd-error" role="alert">
                {projectsError}{" "}
                <button className="ui-button ui-button--sm" onClick={loadProjects}>
                  Retry
                </button>
              </div>
            )}
            <div className="omd-project-grid">
              {projectsLoading && projects.length === 0 && <>
                <span className="omd-sr" role="status">Loading projects…</span>
                {Array.from({ length: 2 }, (_, index) => <div className="omd-project" aria-hidden="true" key={index}>
                  <div className="omd-project-art ui-skeleton" />
                  <div className="omd-project-meta"><span className="ui-skeleton omd-placeholder-line" /></div>
                </div>)}
              </>}
              {projects
                .filter((p) => !p.trashedAt)
                .map((p) => (
                  <button
                    className="omd-project"
                    key={p.id}
                    onClick={() => choose(p.id)}
                  >
                    <div className="omd-project-art">
                      <Mark />
                      <span>
                        Make something
                        <br />
                        <em>move.</em>
                      </span>
                      <span className="omd-project-play">
                        <Icon />
                      </span>
                    </div>
                    <div className="omd-project-meta">
                      <div>
                        <strong>{p.title}</strong>
                        <small>Local project · Open in Studio</small>
                      </div>
                      <Icon name="arrow" size={16} />
                    </div>
                  </button>
                ))}
              <button
                className="omd-new"
                onClick={() => start("Help me plan a new video project.")}
              >
                <Icon name="plus" size={24} />
                <strong>A fresh start</strong>
                <small>Bring an idea to your agent</small>
              </button>
            </div>
          </section>
          <section className="omd-section" aria-label="Templates" aria-busy={templatesLoading}>
            <div className="omd-section-head">
              <div>
                <h2>A little inspiration goes a long way</h2>
                <p>
                  Motion references and editable templates, ready to explore.
                </p>
              </div>
              <div className="omd-list-actions">
                <button className="ui-button ui-button--ghost ui-button--sm" onClick={loadTemplates} disabled={templatesLoading}>
                  {templatesLoading ? "Loading…" : "Refresh templates"}
                </button>
                <button className="ui-button ui-button--ghost ui-button--sm" onClick={() => setPage("templates")}>
                  Explore library <Icon name="arrow" size={14} />
                </button>
              </div>
            </div>
            {templatesError && <div className="omd-error" role="alert">
              {templatesError}{" "}
              <button className="ui-button ui-button--sm" onClick={loadTemplates}>Retry</button>
            </div>}
            <div className="omd-template-grid">
              {templatesLoading && templates.length === 0 && <>
                <span className="omd-sr" role="status">Loading templates…</span>
                {Array.from({ length: 6 }, (_, index) => <div className="omd-template" aria-hidden="true" key={index}>
                  <div className="omd-template-art ui-skeleton" />
                  <div className="omd-template-meta"><span className="ui-skeleton omd-placeholder-line" /></div>
                </div>)}
              </>}
              {templates.map((t) => (
                <button
                  className="omd-template"
                  key={t.id}
                  onClick={() => {
                    setTemplateId(t.id);
                    setPage("templates");
                  }}
                >
                  <div className="omd-template-art">
                    <img src={studioAssetUrl(t.posterUrl)} alt="" loading="eager" />
                    {t.duration != null && Number.isFinite(t.duration) && <span className="omd-duration">
                      {Math.round(t.duration)}s
                    </span>}
                    <span className="omd-template-play">
                      <Icon size={22} />
                    </span>
                  </div>
                  <div className="omd-template-meta">
                    <strong>{t.title}</strong>
                    <span>
                      {t.hasHtmlProject
                        ? "Editable template"
                        : "Motion reference"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
          <footer className="omd-foot">
            <span>One workspace. Your agent and your Studio.</span>
            <span>Projects are stored locally</span>
          </footer>
        </main>
      )}
    </section>
  );
}
export const inject = [
  "slots",
  "layout",
  "uiWorkspace",
  "sidebarRight",
  "sidebarRightTabs",
  "actionCards",
  "locale",
];
export async function apply(ctx: any) {
  const response = await fetch("/openmotion-dsh/status");
  if (!response.ok)
    throw new Error(
      "OpenMotion host connection is unavailable. Restart DSH and inspect its log.",
    );
  configureStudio((await response.json()).studioUrl);
  registerTemplateRecommendationBody(ctx);
  const links = [
    "/openmotion-dsh/design-system/ui.css",
    "/openmotion-dsh/design-system/studio/feedback.css",
    "/openmotion-dsh/style.css",
  ].map((href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
    return link;
  });
  ctx.effect(() => () => links.forEach((l) => l.remove()));
  const begin = (prompt: string) =>
    ctx.uiWorkspace.startSession(undefined, {
      prompt,
      whenDraftExists: "keep",
    });
  const openConversation = () => ctx.layout.selectPanel(null);
  let cancelPendingOpen: (() => void) | undefined;
  ctx.effect(() => () => cancelPendingOpen?.());
  function openProject(projectId: string): void {
    cancelPendingOpen?.();
    openConversation();
    const mounted = ctx.sidebarRight.mounted;
    function openWhenMounted(): boolean {
      const sessionId = mounted.getSnapshot();
      if (!sessionId) return false;
      cancelPendingOpen?.();
      cancelPendingOpen = undefined;
      // The selection is published before React adopts the session's tab store.
      requestAnimationFrame(() => {
        if (mounted.getSnapshot() !== sessionId) return;
        localStorage.setItem("omd-session:" + sessionId, projectId);
        localStorage.removeItem("omd-session-page:" + sessionId);
        ctx.sidebarRight.openTab("openmotion-studio", { params: { projectId } });
      });
      return true;
    }
    // A fresh DSH profile has no session seat yet. Wait for its native blank
    // session instead of losing the tab-open request before that seat mounts.
    requestAnimationFrame(() => {
      if (openWhenMounted()) return;
      cancelPendingOpen = mounted.subscribe(openWhenMounted);
      ctx.uiWorkspace.startSession();
    });
  }
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      {
        name: "main",
        key: "openmotion",
        inject: () => ({ begin, openConversation, openProject }),
      },
      Dashboard,
    ),
  );
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "openmotion",
        order: -100,
        label: "OpenMotion",
      },
      () => <Mark />,
    ),
  );
  ctx.effect(() =>
    ctx.sidebarRightTabs.register({
      id: "openmotion.studio",
      kind: "openmotion-studio",
      title: () => "OpenMotion",
      guide: [
        {
          id: "studio",
          order: -20,
          title: () => "OpenMotion",
          description: () => "Edit and preview your video project",
        },
      ],
    }),
  );
  registerEditingWorkspace(ctx);
  const studioActions = (sessionId: string) => ({
    openStudio: () => {
      const key = "omd-session:" + sessionId;
      const project =
        localStorage.getItem(key) ||
        localStorage.getItem(selectedKey) ||
        "project";
      localStorage.setItem(key, project);
      ctx.sidebarRight.openTab("openmotion-studio", {
        params: localStorage.getItem("omd-session-page:" + sessionId) === "templates" ? { page: "templates" } : { projectId: project },
      });
    },
  });
  const StudioAction = ({ openStudio }: { openStudio: () => void }) => (
    <span data-motion-ui data-theme={useHostTheme()}>
      <button
        className="ui-button ui-button--ghost ui-button--sm"
        onClick={openStudio}
        title="Open current OpenMotion project"
      >
        <Icon size={15} /> OpenMotion
      </button>
    </span>
  );
  for (const slot of ["conversation.session.header.actions"])
    ctx.slots.inject(slot, () =>
      ctx.slots.register(
        { name: slot, id: "openmotion-studio", inject: studioActions },
        StudioAction,
      ),
    );
}
