import { Button } from "open-design-ui/button";
import type { ComponentPropsWithRef } from "react";

type FieldDensity = "compact" | "regular" | "intrinsic";

interface FieldAppearance {
  density?: FieldDensity;
  /** The surrounding field owns the surface, or the value is edited in place. */
  appearance?: "boxed" | "embedded" | "inline";
}

// Some editors already own a draft or stream changes as the user types.
// These primitives keep the native event, form and ref contracts for those callers.
export function FieldInput({ appearance = "boxed", density = "regular", ...props }:
  ComponentPropsWithRef<"input"> & FieldAppearance) {
  return <input {...props} data-form-control={appearance} data-form-density={density} />;
}

export function FieldTextarea({ appearance = "boxed", density = "regular", ...props }:
  ComponentPropsWithRef<"textarea"> & FieldAppearance) {
  return <textarea {...props} data-form-control={appearance} data-form-density={density} />;
}

export function NativeSelect({ appearance = "boxed", density = "regular", ...props }:
  ComponentPropsWithRef<"select"> & FieldAppearance) {
  return <select {...props} data-form-control={appearance} data-form-density={density} />;
}

export function FieldTrigger({ appearance = "boxed", density = "regular", ...props }:
  ComponentPropsWithRef<"button"> & FieldAppearance) {
  return <Button variant="plain" type="button" {...props} data-form-control={appearance} data-form-density={density} />;
}
