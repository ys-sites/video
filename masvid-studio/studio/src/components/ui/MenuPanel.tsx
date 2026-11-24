import type { ComponentPropsWithRef } from "react";
import { cn } from "./cn";

/** Shared surface for command menus, option lists and menus with custom positioning. */
export function MenuPanel({ className, ...props }: ComponentPropsWithRef<"div">) {
  return <div {...props} data-menu-panel="" className={cn("motion-menu-panel", className)} />;
}
