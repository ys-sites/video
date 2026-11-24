import { cloneElement, createContext, useState, type ReactElement } from "react";
import { Tooltip } from "../../components/ui/Tooltip";

export const ClipPeakDescriptionContext = createContext<((detail: string | null) => void) | null>(
  null,
);

export function ClipPeakTooltip({
  children,
  label,
}: {
  label?: string;
  children: ReactElement<{ title?: string; "aria-describedby"?: string }>;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const text = detail ?? label ?? children.props.title;
  return (
    <ClipPeakDescriptionContext.Provider value={setDetail}>
      <Tooltip label={text} wrap>
        {cloneElement(children, { title: undefined })}
      </Tooltip>
    </ClipPeakDescriptionContext.Provider>
  );
}
