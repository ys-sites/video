import React from "react";
import { useHostTheme } from "./theme";
import { studio } from "./studio";

type StudioProps = {
  useTabInfo: () => { tab: { visible: boolean; navigation: { params?: { projectId?: string; page?: string } } } };
  sessionId?: string;
};

// The host owns tab chrome, resizing, fullscreen, visibility and the composer.
export function StudioWorkspace({ useTabInfo, sessionId }: StudioProps): React.JSX.Element | null {
  const { tab } = useTabInfo();
  const theme = useHostTheme();
  const params = tab.navigation.params;
  const templates = params?.page === "templates" || (!params?.projectId && sessionId !== undefined && localStorage.getItem("omd-session-page:" + sessionId) === "templates");
  if (!tab.visible) return null;
  const url = templates ? studio + "/?embed=1&templates=1"
    : studio + "/?embed=1&hostChrome=1#project/" + encodeURIComponent(params?.projectId || "project");
  return <section className="omd-studio-seat" data-motion-ui data-theme={theme}>
    <iframe title={templates ? "OpenMotion Templates" : "OpenMotion Studio"} src={url}
      onLoad={() => { if (templates) window.dispatchEvent(new Event("openmotion:library-ready")); }}
      allow="clipboard-write; fullscreen" />
  </section>;
}

export function registerEditingWorkspace(ctx: any): void {
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
    name: "sidebar.right.pane.tab", key: "openmotion.studio", inject: (sessionId: string) => ({ sessionId }),
  }, StudioWorkspace));
}
