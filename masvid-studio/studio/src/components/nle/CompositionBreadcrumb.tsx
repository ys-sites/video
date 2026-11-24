import { IconButton } from "open-design-ui/icon-button";
import { Button } from "open-design-ui/button";
import { useI18n } from "../../i18n/I18n";
import { ArrowLeft, CaretRight } from "../../icons/RemixIcons";
import { trackStudioEvent } from "../../utils/studioTelemetry";

export interface CompositionLevel {
  /** Unique id — "master" or composition file path */
  id: string;
  /** Display label — clip name, falling back to filename without extension */
  label: string;
  /** Preview URL for this composition level */
  previewUrl: string;
}

interface CompositionBreadcrumbProps {
  stack: CompositionLevel[];
  onNavigate: (index: number) => void;
}

export function CompositionBreadcrumb({ stack, onNavigate }: CompositionBreadcrumbProps) {
  const { t } = useI18n();
  if (stack.length <= 1) return null;

  return (
    <nav
      aria-label={t("Composition navigation")}
      className="om-breadcrumb flex items-center gap-1 px-2 h-8 border-b border-hairline bg-bg-1 shrink-0"
    >
      {/* Back button — always goes to parent */}
      <IconButton variant="plain"
        type="button"
        onClick={() => {
          trackStudioEvent("navigation", {
            action: "back",
            target: stack[stack.length - 2]?.label,
          });
          onNavigate(stack.length - 2);
        }}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-xs text-text-3 hover:text-text-0 hover:bg-hover active:scale-[0.98] transition-colors"
        title={t("Back (Esc, or double-click empty timeline)")}
        aria-label={t("Back to parent composition")}
        icon={<ArrowLeft size={12} weight="bold" />}
      />

      {/* Breadcrumb path */}
      {stack.map((level, i) => {
        const isLast = i === stack.length - 1;
        return (
          <span key={level.id} className="flex items-center gap-1">
            {i > 0 && <CaretRight size={10} className="text-text-4 shrink-0" />}
            {isLast ? (
              <span className="text-xs font-medium" aria-current="location">{level.label}</span>
            ) : (
              <Button variant="plain"
                type="button"
                onClick={() => {
                  trackStudioEvent("navigation", { action: "breadcrumb", target: level.label });
                  onNavigate(i);
                }}
                className="text-xs hover:underline"
              >
                {level.label}
              </Button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
