import { Button } from "open-design-ui/button";
import { useI18n } from "../../i18n/I18n";
import { ArrowLeft } from "../../icons/RemixIcons";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import type { CompositionLevel } from "./CompositionBreadcrumb";

export function TimelineCompositionNavigation({ stack, onNavigate, disabled = false }: {
  stack: CompositionLevel[];
  onNavigate: (index: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  if (stack.length <= 1) return null;
  const current = stack[stack.length - 1];
  const parent = stack[stack.length - 2];

  return (
    <nav className="motion-timeline-composition-nav om-breadcrumb" aria-label={t("Composition navigation")} onDoubleClick={(event) => event.stopPropagation()}>
      <Button variant="plain"
        type="button"
        className="motion-timeline-composition-back"
        aria-label={t("Back to parent composition")}
        title={`${t("Back to parent composition")} · ${parent.label}`}
        disabled={disabled}
        onClick={() => {
          trackStudioEvent("navigation", { action: "back", target: parent.label });
          onNavigate(stack.length - 2);
        }}
      >
        <ArrowLeft size={14} />
        <span aria-current="location">{current.label}</span>
      </Button>
    </nav>
  );
}
